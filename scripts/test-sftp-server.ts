/**
 * Standalone SFTP server for manual/GUI verification.
 * Usage: node --experimental-strip-types scripts/test-sftp-server.ts [port]
 *
 * Serves a real SSH + SFTP subsystem over a temporary directory and prints
 * the directory it serves, so the harness knows where to look for files.
 */
import { startTestSftpServer } from '../tests/helpers/test-sftp-server.ts'

const port = Number(process.argv[2] ?? 2224)
const server = await startTestSftpServer(port)

console.log(`Test SFTP server listening on ${server.host}:${server.port} (tester/secret)`)
console.log(`SFTP root: ${server.root}`)

const shutdown = async (): Promise<void> => {
  await server.close()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())

// SIGUSR2 -> RST every live connection (ECONNRESET reproduction).
process.on('SIGUSR2', () => {
  server.resetConnections()
  console.log('RST all connections')
})

// Keep the process alive.
setInterval(() => undefined, 1 << 30)
