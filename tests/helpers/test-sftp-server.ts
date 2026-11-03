/**
 * Minimal SFTP-capable SSH server used by the integration tests.
 *
 * It speaks the real SSH protocol (ssh2's server mode) and serves a real
 * SFTP subsystem backed by a temporary directory, so the SFTP adapter is
 * exercised end to end instead of against a mock.
 *
 * The SFTP handlers are implemented here rather than pulled from a package:
 * the published server helpers target ssh2 0.x/1.0 and rely on statics that
 * no longer exist on the SFTP class in ssh2 1.17.
 */
import ssh2 from 'ssh2'
import { createServer, type Socket } from 'node:net'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readdirSync, statSync, existsSync, openSync, readSync, writeSync, closeSync, unlinkSync, rmdirSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, basename } from 'node:path'

const { Server, utils } = ssh2
const sftpConstants = (ssh2.utils as unknown as { sftp: Record<string, unknown> }).sftp as unknown as {
  OPEN_MODE: Record<string, number>
  STATUS_CODE: Record<string, number>
  flagsToString: (flags: number) => string | null
}

const { OPEN_MODE, STATUS_CODE } = sftpConstants

export interface TestSftpServer {
  port: number
  host: string
  username: string
  password: string
  /** Root directory the SFTP subsystem exposes. */
  root: string
  close(): Promise<void>
  /** RST every established TCP connection. */
  resetConnections(): void
}

/**
 * Maps a remote path into the served root.
 *
 * The test server exposes the temporary directory under its real absolute
 * path (like a real server exposing /var/...), and additionally accepts the
 * virtual root "/" and relative paths. Anything outside the root is refused.
 */
function resolveInside(root: string, remotePath: string): string | null {
  if (remotePath === '/' || remotePath === '.') return root

  // An absolute path that already points inside the root is used as is.
  if (remotePath.startsWith(root)) {
    const target = resolve(remotePath)
    return target === root || target.startsWith(`${root}/`) ? target : null
  }

  const normalized = remotePath.startsWith('/') ? remotePath : `/${remotePath}`
  const target = resolve(root, `.${normalized}`)
  if (target !== root && !target.startsWith(`${root}/`)) return null
  return target
}

/** Builds the `ls -l` style longname the SFTP client parses for rights. */
function longName(name: string, stats: { mode: number; isDirectory(): boolean; isFile(): boolean; size: number; mtime: Date }): string {
  const type = stats.isDirectory() ? 'd' : stats.isFile() ? '-' : 'l'
  const mode = stats.mode & 0o777
  const rwx = (value: number): string =>
    `${value & 4 ? 'r' : '-'}${value & 2 ? 'w' : '-'}${value & 1 ? 'x' : '-'}`
  const perms = `${rwx((mode >> 6) & 7)}${rwx((mode >> 3) & 7)}${rwx(mode & 7)}`
  const date = stats.mtime.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric'
  })
  return `${type}${perms} 1 user group ${String(stats.size).padStart(8)} ${date} ${name}`
}

/**
 * Starts an SSH server that accepts password `tester`/`secret` and serves an
 * SFTP subsystem over a fresh temporary directory.
 *
 * @param fixedPort Port to listen on; 0 (default) picks an ephemeral one.
 */
export async function startTestSftpServer(fixedPort = 0): Promise<TestSftpServer> {
  const root = mkdtempSync(join(tmpdir(), 'reliquary-sftp-'))
  const sockets: Socket[] = []

  const sshServer = new Server({ hostKeys: [utils.generateKeyPairSync('ed25519').private] }, (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === 'tester' && ctx.password === 'secret') {
        ctx.accept()
      } else {
        ctx.reject(['password'], false)
      }
    })

    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept()

        session.on('sftp', (acceptSftp) => {
          const sftp = acceptSftp()
          serveSftp(sftp, root)
        })
      })
    })
  })

  const port = await new Promise<number>((resolvePort, reject) => {
    const raw = (sshServer as unknown as { _srv: ReturnType<typeof createServer> })._srv
    raw.on('connection', (socket) => {
      sockets.push(socket)
      socket.on('close', () => {
        const index = sockets.indexOf(socket)
        if (index >= 0) sockets.splice(index, 1)
      })
    })
    sshServer.once('error', reject)
    sshServer.listen(fixedPort, '127.0.0.1', () => {
      const address = sshServer.address()
      if (address && typeof address === 'object') resolvePort(address.port)
      else reject(new Error('Failed to determine test server port'))
    })
  })

  return {
    port,
    host: '127.0.0.1',
    username: 'tester',
    password: 'secret',
    root,
    close: () =>
      new Promise<void>((done) => {
        sshServer.close(() => {
          rmSync(root, { recursive: true, force: true })
          done()
        })
      }),
    resetConnections: () => {
      for (const socket of [...sockets]) {
        try {
          socket.resetAndDestroy()
        } catch {
          // Already destroyed — nothing to reset.
        }
      }
    }
  }
}

/** Minimal shape of the ssh2 server-mode SFTP stream the handlers use. */
interface SftpServerStream {
  on(event: string, listener: (...args: never[]) => void): void
  status(reqid: number, code: number, message?: string): void
  handle(reqid: number, handle: Buffer): void
  data(reqid: number, data: Buffer | string, encoding?: string): void
  name(reqid: number, names: { filename: string; longname?: string; attrs?: unknown }[]): void
  attrs(reqid: number, attrs: unknown): void
}

/** Handles the SFTP requests the client sends. */
function serveSftp(sftp: SftpServerStream, root: string): void {
  // Handles are 4-byte identifiers into this map.
  const handles = new Map<string, { kind: 'file' | 'dir'; path: string; fd?: number; entries?: string[] }>()
  let handleCounter = 0

  const newHandle = (entry: { kind: 'file' | 'dir'; path: string; fd?: number; entries?: string[] }): Buffer => {
    const buffer = Buffer.alloc(4)
    buffer.writeUInt32BE(handleCounter++, 0)
    handles.set(buffer.toString('hex'), entry)
    return buffer
  }

  const lookup = (handle: Buffer): { kind: 'file' | 'dir'; path: string; fd?: number; entries?: string[] } | undefined =>
    handles.get(handle.toString('hex'))

  const attrsOf = (stats: {
    mode: number
    uid: number
    gid: number
    size: number
    atime: Date
    mtime: Date
  }) => ({
    mode: stats.mode,
    uid: stats.uid,
    gid: stats.gid,
    size: stats.size,
    atime: Math.floor(stats.atime.getTime() / 1000),
    mtime: Math.floor(stats.mtime.getTime() / 1000)
  })

  const fail = (reqid: number, code: number = STATUS_CODE.FAILURE): void => {
    sftp.status(reqid, code)
  }

  sftp.on('REALPATH', (reqid: number, path: string) => {
    // A real server answers with the absolute path of the home directory;
    // the test server exposes its temporary root under its real path.
    const target = resolveInside(root, path === '.' ? '/' : path)
    if (!target) return fail(reqid, STATUS_CODE.NO_SUCH_FILE)
    sftp.name(reqid, [{ filename: target }])
  })

  sftp.on('STAT', (reqid: number, path: string) => {
    const target = resolveInside(root, path)
    if (!target || !existsSync(target)) return fail(reqid, STATUS_CODE.NO_SUCH_FILE)
    try {
      sftp.attrs(reqid, attrsOf(statSync(target)))
    } catch {
      fail(reqid)
    }
  })

  sftp.on('LSTAT', (reqid: number, path: string) => {
    const target = resolveInside(root, path)
    if (!target || !existsSync(target)) return fail(reqid, STATUS_CODE.NO_SUCH_FILE)
    try {
      sftp.attrs(reqid, attrsOf(statSync(target)))
    } catch {
      fail(reqid)
    }
  })

  sftp.on('FSTAT', (reqid: number, handle: Buffer) => {
    const entry = lookup(handle)
    if (!entry) return fail(reqid)
    try {
      sftp.attrs(reqid, attrsOf(statSync(entry.path)))
    } catch {
      fail(reqid)
    }
  })

  sftp.on('OPENDIR', (reqid: number, path: string) => {
    const target = resolveInside(root, path)
    if (!target || !existsSync(target)) return fail(reqid, STATUS_CODE.NO_SUCH_FILE)
    try {
      const stats = statSync(target)
      if (!stats.isDirectory()) return fail(reqid, STATUS_CODE.FAILURE)
      sftp.handle(reqid, newHandle({ kind: 'dir', path: target }))
    } catch {
      fail(reqid)
    }
  })

  sftp.on('READDIR', (reqid: number, handle: Buffer) => {
    const entry = lookup(handle)
    if (!entry || entry.kind !== 'dir') return fail(reqid)

    // The client keeps sending READDIR until the server answers EOF.
    // The first request returns the entries, every later one EOF.
    if (entry.entries) {
      sftp.status(reqid, STATUS_CODE.EOF)
      return
    }

    const names = readdirSync(entry.path)
    const payload = names.map((name) => {
      const stats = statSync(join(entry.path, name))
      return { filename: name, longname: longName(name, stats), attrs: attrsOf(stats) }
    })

    entry.entries = names
    sftp.name(reqid, payload)
  })

  sftp.on('OPEN', (reqid: number, path: string, flags: number) => {
    const target = resolveInside(root, path)
    if (!target) return fail(reqid, STATUS_CODE.NO_SUCH_FILE)

    const mode = sftpConstants.flagsToString(flags) ?? 'r'
    const writable = Boolean(flags & OPEN_MODE.WRITE)

    try {
      if (writable) {
        const fd = openSync(target, mode === 'r' ? 'w' : mode, 0o644)
        sftp.handle(reqid, newHandle({ kind: 'file', path: target, fd }))
      } else {
        if (!existsSync(target)) return fail(reqid, STATUS_CODE.NO_SUCH_FILE)
        sftp.handle(reqid, newHandle({ kind: 'file', path: target }))
      }
    } catch {
      fail(reqid)
    }
  })

  sftp.on('READ', (reqid: number, handle: Buffer, offset: number, length: number) => {
    const entry = lookup(handle)
    if (!entry) return fail(reqid)

    try {
      const stats = statSync(entry.path)
      if (offset >= stats.size) return sftp.status(reqid, STATUS_CODE.EOF)

      const size = Math.min(length, stats.size - offset)
      const buffer = Buffer.alloc(size)
      const fd = openSync(entry.path, 'r')
      try {
        readSync(fd, buffer, 0, size, offset)
      } finally {
        closeSync(fd)
      }
      sftp.data(reqid, buffer)
    } catch {
      fail(reqid)
    }
  })

  sftp.on('WRITE', (reqid: number, handle: Buffer, offset: number, data: Buffer) => {
    const entry = lookup(handle)
    if (!entry || typeof entry.fd !== 'number') return fail(reqid)

    try {
      writeSync(entry.fd, data, 0, data.length, offset)
      sftp.status(reqid, STATUS_CODE.OK)
    } catch {
      fail(reqid)
    }
  })

  sftp.on('CLOSE', (reqid: number, handle: Buffer) => {
    const entry = lookup(handle)
    if (!entry) return fail(reqid)

    if (typeof entry.fd === 'number') {
      try {
        closeSync(entry.fd)
      } catch {
        // The fd may already be gone.
      }
    }
    handles.delete(handle.toString('hex'))
    sftp.status(reqid, STATUS_CODE.OK)
  })

  sftp.on('MKDIR', (reqid: number, path: string) => {
    const target = resolveInside(root, path)
    if (!target) return fail(reqid)
    try {
      mkdirSync(target)
      sftp.status(reqid, STATUS_CODE.OK)
    } catch {
      fail(reqid)
    }
  })

  sftp.on('RMDIR', (reqid: number, path: string) => {
    const target = resolveInside(root, path)
    if (!target) return fail(reqid)
    try {
      rmdirSync(target)
      sftp.status(reqid, STATUS_CODE.OK)
    } catch {
      fail(reqid)
    }
  })

  sftp.on('REMOVE', (reqid: number, path: string) => {
    const target = resolveInside(root, path)
    if (!target) return fail(reqid)
    try {
      unlinkSync(target)
      sftp.status(reqid, STATUS_CODE.OK)
    } catch {
      fail(reqid)
    }
  })

  sftp.on('RENAME', (reqid: number, oldPath: string, newPath: string) => {
    const from = resolveInside(root, oldPath)
    const to = resolveInside(root, newPath)
    if (!from || !to) return fail(reqid)
    try {
      renameSync(from, to)
      sftp.status(reqid, STATUS_CODE.OK)
    } catch {
      fail(reqid)
    }
  })

  sftp.on('SETSTAT', (reqid: number) => {
    sftp.status(reqid, STATUS_CODE.OK)
  })

  sftp.on('FSETSTAT', (reqid: number) => {
    sftp.status(reqid, STATUS_CODE.OK)
  })
}

/** Creates a file with the given content inside the server root. */
export function writeServerFile(root: string, name: string, content: string): string {
  mkdirSync(root, { recursive: true })
  const path = join(root, name)
  writeFileSync(path, content, 'utf8')
  return path
}

/** Creates a subdirectory inside the server root. */
export function makeServerDir(root: string, name: string): string {
  const path = join(root, name)
  mkdirSync(path, { recursive: true })
  return path
}

export { basename }
