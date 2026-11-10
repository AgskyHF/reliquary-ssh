/**
 * SFTP protocol adapter.
 *
 * Wraps `ssh2-sftp-client` and exposes the shared FileManagerAdapter
 * interface. The adapter owns the SSH connection and the SFTP channel;
 * the renderer only asks for a path and gets plain data back.
 */
import { posix } from 'node:path'
import SftpClient from 'ssh2-sftp-client'
import {
  AuthMethod,
  ProtocolCapability,
  ProtocolType,
  SessionState,
  type ConnectionOptions,
  type FileManagerAdapter,
  type FileTransferRequest,
  type RemoteFileEntry,
  type RemoteListing
} from '@shared/types'
import { BaseAdapter } from '../core/base-adapter'

export interface SftpAdapterOptions {
  /** Directory the session starts in. Defaults to the remote home directory. */
  initialPath?: string
}

/**
 * Builds the octal permission string from the rwx triplets the SFTP client
 * reports ('rw-r--r--' -> '644').
 */
function modeFromRights(rights: { user: string; group: string; other: string } | undefined): string {
  if (!rights) return ''
  const digits = [rights.user, rights.group, rights.other].map((triplet) => {
    const read = triplet.includes('r') ? 4 : 0
    const write = triplet.includes('w') ? 2 : 0
    const execute = triplet.includes('x') ? 1 : 0
    return String(read + write + execute)
  })
  return digits.join('')
}

/** Normalizes a remote path to an absolute POSIX path. */
function absolutePath(cwd: string, path: string): string {
  if (!path) return cwd
  if (path.startsWith('/')) return posix.normalize(path)
  return posix.normalize(posix.join(cwd, path))
}

export class SftpAdapter extends BaseAdapter implements FileManagerAdapter {
  readonly protocol = ProtocolType.SFTP
  readonly capabilities: ProtocolCapability[] = [ProtocolCapability.FILE_MANAGER]

  private client: SftpClient | null = null
  private closing = false
  private currentPath = '/'
  private readonly initialPath: string | undefined

  constructor(options: SftpAdapterOptions = {}) {
    super()
    this.initialPath = options.initialPath
  }

  get cwd(): string {
    return this.currentPath
  }

  async connect(options: ConnectionOptions): Promise<void> {
    if (this.client) throw new Error('SFTP adapter is already connected')

    this.setState(SessionState.CONNECTING)

    const client = new SftpClient('reliquary-sftp', {
      error: (error: unknown) => {
        if (this.closing) return
        this.emitter.emit('error', toError(error))
      },
      end: () => {
        if (this.closing) return
        this.setState(SessionState.CLOSED)
        this.emitter.emit('close', undefined)
      },
      close: () => {
        if (this.closing) return
        this.setState(SessionState.CLOSED)
        this.emitter.emit('close', undefined)
      }
    })

    const config: Record<string, unknown> = {
      host: options.host,
      port: options.port,
      username: options.username,
      readyTimeout: options.timeoutMs ?? 20_000
    }

    if (options.authMethod === AuthMethod.PASSWORD) {
      if (!options.password) throw new Error('Password authentication requires a password')
      config.password = options.password
    } else if (options.authMethod === AuthMethod.KEY) {
      if (!options.privateKey) throw new Error('Key authentication requires private key material')
      config.privateKey = options.privateKey
      if (options.privateKeyPassphrase) config.passphrase = options.privateKeyPassphrase
    } else {
      config.tryKeyboard = true
    }

    try {
      await client.connect(config)
    } catch (error) {
      this.setState(SessionState.ERROR)
      throw toError(error)
    }

    this.client = client

    // The remote home directory is the natural starting point; fall back to
    // '/' when the server does not report one.
    const home = this.initialPath ?? (await client.cwd().catch(() => ''))
    this.currentPath = home && home.startsWith('/') ? home : '/'

    this.setState(SessionState.CONNECTED)
  }

  async list(remotePath: string): Promise<RemoteListing> {
    const client = this.requireClient()
    const target = absolutePath(this.currentPath, remotePath)
    const list = await client.list(target)

    const entries: RemoteFileEntry[] = list
      .filter((item) => item.name !== '.' && item.name !== '..')
      .map((item) => ({
        name: item.name,
        path: posix.join(target, item.name),
        type: item.type === 'd' ? 'd' : item.type === 'l' ? 'l' : '-',
        size: item.size ?? 0,
        modifiedAt: item.modifyTime ? new Date(item.modifyTime).toISOString() : '',
        mode: modeFromRights(item.rights)
      }))

    // Directories first, then alphabetical — the order every file manager uses.
    entries.sort((a, b) => {
      if (a.type === 'd' && b.type !== 'd') return -1
      if (a.type !== 'd' && b.type === 'd') return 1
      return a.name.localeCompare(b.name)
    })

    this.currentPath = target

    return {
      path: target,
      parentPath: posix.dirname(target),
      entries
    }
  }

  async download(request: FileTransferRequest): Promise<string> {
    const client = this.requireClient()
    if (!request.remotePath) throw new Error('Download requires a remote path')
    if (!request.localPath) throw new Error('Download requires a local path')

    const remotePath = absolutePath(this.currentPath, request.remotePath)
    await client.get(remotePath, request.localPath)
    return request.localPath
  }

  async upload(request: FileTransferRequest): Promise<string> {
    const client = this.requireClient()
    if (!request.remotePath) throw new Error('Upload requires a remote path')
    if (!request.localPath) throw new Error('Upload requires a local path')

    const remotePath = absolutePath(this.currentPath, request.remotePath)
    await client.put(request.localPath, remotePath)
    return remotePath
  }

  /**
   * Deletes a remote file or directory.
   *
   * A directory goes with everything inside it: the library removes the
   * files first and the directories after them, so a tree never stays
   * half-deleted. The type of the target is asked for first — a file and a
   * directory are removed by different operations.
   */
  async delete(request: FileTransferRequest): Promise<string> {
    const client = this.requireClient()
    if (!request.remotePath) throw new Error('Delete requires a remote path')

    const remotePath = absolutePath(this.currentPath, request.remotePath)
    const kind = await client.exists(remotePath)

    if (!kind) {
      throw new Error(`No such file or directory: ${remotePath}`)
    }

    if (kind === 'd') {
      await client.rmdir(remotePath, true)
    } else {
      await client.delete(remotePath)
    }

    return remotePath
  }

  async disconnect(): Promise<void> {
    if (this.currentState === SessionState.CLOSED) return
    this.closing = true
    this.setState(SessionState.CLOSING)

    try {
      await this.client?.end()
    } catch {
      // The connection may already be gone — closing is enough.
    }

    this.client = null
    this.setState(SessionState.CLOSED)
    this.emitter.emit('close', undefined)
  }

  private requireClient(): SftpClient {
    if (!this.client) throw new Error('SFTP adapter is not connected')
    return this.client
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
