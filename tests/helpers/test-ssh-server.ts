/**
 * Minimal SSH server used by the integration tests.
 * It speaks the real SSH protocol (via ssh2's server mode) so the adapter is
 * exercised end to end instead of against a mock.
 */
import { Server, utils } from 'ssh2'
import { createServer, type Socket } from 'node:net'

export interface TestSshServer {
  port: number
  host: string
  username: string
  password: string
  close(): Promise<void>
  /** RST every established TCP connection — simulates a mid-session network cut. */
  resetConnections(): void
}

const HOST_KEY = utils.generateKeyPairSync('ed25519')
/**
 * Starts an SSH server on an ephemeral port.
 * The shell echoes back a fixed banner and a prompt, and responds to "echo <text>".
 */
export async function startTestSshServer(): Promise<TestSshServer> {
  const sockets: Socket[] = []
  const sshServer = new Server({ hostKeys: [HOST_KEY.private] }, (client) => {
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

        session.on('pty', (acceptPty, _reject, info) => {
          acceptPty?.()
          void info
        })

        session.on('shell', (acceptShell) => {
          const stream = acceptShell()

          stream.write('Welcome to ReliquarySSH test server\r\n')
          stream.write('$ ')

          stream.on('data', (chunk: Buffer) => {
            const text = chunk.toString('utf8')

            if (text.includes('exit')) {
              stream.write('logout\r\n')
              stream.end()
              return
            }

            const echoMatch = /echo[ \t]+(.+?)\r?\n?$/.exec(text)
            if (echoMatch) {
              stream.write(`${echoMatch[1]}\r\n`)
            }

            stream.write('$ ')
          })
        })
      })
    })
  })

  const port = await new Promise<number>((resolve, reject) => {
    // Track raw TCP sockets through ssh2's internal net.Server (private
    // `_srv`): needed to force RSTs that reproduce mid-session ECONNRESET.
    const raw = (sshServer as unknown as { _srv: ReturnType<typeof createServer> })._srv
    raw.on('connection', (socket) => {
      sockets.push(socket)
      socket.on('close', () => {
        const index = sockets.indexOf(socket)
        if (index >= 0) sockets.splice(index, 1)
      })
    })
    sshServer.once('error', reject)
    sshServer.listen(0, '127.0.0.1', () => {
      const address = sshServer.address()
      if (address && typeof address === 'object') resolve(address.port)
      else reject(new Error('Failed to determine test server port'))
    })
  })

  // Keep the event loop referenced so the server is not garbage collected.
  return {
    port,
    host: '127.0.0.1',
    username: 'tester',
    password: 'secret',
    close: () =>
      new Promise<void>((resolve) => {
        sshServer.close(() => resolve())
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
