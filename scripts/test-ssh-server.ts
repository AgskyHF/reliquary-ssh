/**
 * Standalone test SSH server for manual/GUI verification.
 * Usage: node --experimental-strip-types scripts/test-ssh-server.ts [port]
 */
import ssh2 from 'ssh2'

const { Server, utils } = ssh2

const port = Number(process.argv[2] ?? 2222)
const HOST_KEY = utils.generateKeyPairSync('ed25519')

const server = new Server({ hostKeys: [HOST_KEY.private] }, (client) => {
  client.on('authentication', (ctx) => {
    if (ctx.method === 'password' && ctx.username === 'tester' && ctx.password === 'secret') {
      ctx.accept()
      return
    }
    ctx.reject(['password'], false)
  })

  client.on('ready', () => {
    client.on('session', (accept) => {
      const session = accept()

      session.on('pty', (acceptPty) => acceptPty?.())
      session.on('window-change', (acceptResize) => acceptResize?.())

      session.on('shell', (acceptShell) => {
        const stream = acceptShell()
        let lineBuffer = ''

        stream.write('\x1b[32mWelcome to ReliquarySSH test server\x1b[0m\r\n')
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
})
