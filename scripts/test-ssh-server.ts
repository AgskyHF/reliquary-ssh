/**
 * Standalone test SSH server for manual/GUI verification.
 * Usage: node --experimental-strip-types scripts/test-ssh-server.ts [port]
 */
import ssh2 from 'ssh2'
import type { Socket } from 'node:net'
import { generateUsableKeyPair } from '../tests/helpers/test-keys.ts'

const { Server, utils } = ssh2

const port = Number(process.argv[2] ?? 2222)
const HOST_KEY = generateUsableKeyPair()
let shellCounter = 0
const sockets: Socket[] = []

// SIGUSR2 -> RST every live connection: reproduces a mid-session
// ECONNRESET so the harness can prove the app survives it without a crash.
process.on('SIGUSR2', () => {
  for (const socket of [...sockets]) {
    try {
      socket.resetAndDestroy()
    } catch {
      // already gone
    }
  }
  console.log(`RST ${sockets.length} connection(s)`)
})

// A key pair the server authorizes, so the Keychain flow can be tested.
// The private key is printed on startup — the harness imports it.
const CLIENT_KEY = generateUsableKeyPair()
const AUTHORIZED = utils.parseKey(CLIENT_KEY.private)
if (AUTHORIZED instanceof Error) {
  throw new Error('Could not prepare the authorized key pair')
}
const AUTHORIZED_BLOB = AUTHORIZED.getPublicSSH()

const server = new Server({ hostKeys: [HOST_KEY.private] }, (client) => {
  client.on('authentication', (ctx) => {
    if (ctx.method === 'password' && ctx.username === 'tester' && ctx.password === 'secret') {
      ctx.accept()
      return
    }

    if (ctx.method === 'publickey' && ctx.username === 'tester') {
      if (ctx.key.data.equals(AUTHORIZED_BLOB)) {
        if (ctx.blob && ctx.signature && !AUTHORIZED.verify(ctx.blob, ctx.signature, ctx.hashAlgo)) {
          ctx.reject(['password', 'publickey'], false)
          return
        }
        ctx.accept()
        return
      }
    }

    ctx.reject(['password', 'publickey'], false)
  })

  client.on('ready', () => {
    client.on('session', (accept) => {
      const session = accept()

      session.on('pty', (acceptPty) => acceptPty?.())
      session.on('window-change', (acceptResize) => acceptResize?.())

      session.on('shell', (acceptShell) => {
        const stream = acceptShell()
        let lineBuffer = ''

        shellCounter += 1
        stream.write('\x1b[32mWelcome to ReliquarySSH test server\x1b[0m\r\n')
        stream.write(`Session-Id: test-${shellCounter}\r\n`)
        stream.write('OS: test-linux\r\n')
        stream.write('$ ')

        stream.on('data', (chunk: Buffer) => {
          // xterm sends keystrokes one by one, so the server has to buffer
          // the line before it can act on it.
          lineBuffer += chunk.toString('utf8')

          if (!lineBuffer.includes('\n') && !lineBuffer.includes('\r')) return

          const text = lineBuffer.replace(/[\r\n]+$/, '')
          lineBuffer = ''

          if (text.includes('exit')) {
            stream.write('logout\r\n')
            stream.end()
            return
          }

          if (text.includes('whoami')) {
            stream.write('tester\r\n$ ')
            return
          }

          const echoMatch = /echo[ \t]+(.+)$/.exec(text)
          if (echoMatch) {
            stream.write(`${echoMatch[1]}\r\n`)
          }

          stream.write('$ ')
        })
      })
    })
  })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Test SSH server listening on 127.0.0.1:${port} (tester/secret)`)
  console.log(`AUTHORIZED_PRIVATE_KEY:${CLIENT_KEY.private.replace(/\n/g, '\\n')}`)
  // ssh2 keeps its net.Server private as `_srv`; hook it to track raw sockets.
  const raw = (server as unknown as { _srv: { on(e: 'connection', l: (s: Socket) => void): void } })._srv
  raw.on('connection', (socket) => {
    sockets.push(socket)
    socket.on('close', () => {
      const index = sockets.indexOf(socket)
      if (index >= 0) sockets.splice(index, 1)
    })
  })
})
