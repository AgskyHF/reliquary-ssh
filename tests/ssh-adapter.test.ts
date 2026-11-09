import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { setTimeout as delay } from 'node:timers/promises'
import { AuthMethod, ProtocolType, SessionState } from '@shared/types'
import { SshAdapter } from '@protocols/ssh'
import { startTestSshServer, type TestSshServer } from './helpers/test-ssh-server'

describe('SshAdapter against a real SSH server', () => {
  let server: TestSshServer

  beforeAll(async () => {
    server = await startTestSshServer()
  })

  afterAll(async () => {
    await server.close()
  })

  it('connects with password authentication and opens a shell', async () => {
    const adapter = new SshAdapter({ cols: 80, rows: 24 })
    const chunks: string[] = []
    adapter.on('data', (chunk) => chunks.push(chunk))

    await adapter.connect({
      host: server.host,
      port: server.port,
      username: server.username,
      authMethod: AuthMethod.PASSWORD,
      password: server.password
    })

    expect(adapter.state).toBe(SessionState.CONNECTED)
    expect(chunks.join('')).toContain('Welcome to ReliquarySSH test server')

    await adapter.disconnect()
    expect(adapter.state).toBe(SessionState.CLOSED)
  })

  it('rejects a wrong password and reports the error', async () => {
    const adapter = new SshAdapter()
    const errors: Error[] = []
    adapter.on('error', (error) => errors.push(error))

    await expect(
      adapter.connect({
        host: server.host,
        port: server.port,
        username: server.username,
        authMethod: AuthMethod.PASSWORD,
        password: 'wrong-password'
      })
    ).rejects.toThrow()

    expect(adapter.state).toBe(SessionState.ERROR)
    expect(errors.length).toBeGreaterThan(0)
  })

  it('writes to the remote shell and receives the echo back', async () => {
    const adapter = new SshAdapter()
    const chunks: string[] = []
    adapter.on('data', (chunk) => chunks.push(chunk))

    await adapter.connect({
      host: server.host,
      port: server.port,
      username: server.username,
      authMethod: AuthMethod.PASSWORD,
      password: server.password
    })

    adapter.write('echo hello-reliquary\n')

    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(chunks.join('')).toContain('hello-reliquary')

    await adapter.disconnect()
  })

  it('survives a mid-session connection reset (ECONNRESET) instead of crashing', async () => {
    const adapter = new SshAdapter()
    const errors: Error[] = []
    const events: string[] = []
    adapter.on('error', (error) => errors.push(error))
    adapter.on('close', () => events.push('close'))

    await adapter.connect({
      host: server.host,
      port: server.port,
      username: server.username,
      authMethod: AuthMethod.PASSWORD,
      password: server.password
    })

    // Server RSTs the socket: the Client emits 'error' mid-session. Before
    // the permanent error listener existed, this was an uncaught exception.
    server.resetConnections()

    await vi.waitFor(
      () => {
        expect(errors.length).toBeGreaterThan(0)
        expect(events).toContain('close')
      },
      { timeout: 3000 }
    )
  })

  it('ends the handshake when the connection is taken back', async () => {
    const adapter = new SshAdapter()

    // A host that accepts the tcp but never answers the handshake — the
    // way a host behind a black hole answers.
    const connecting = adapter.connect({
      host: '192.0.2.1',
      port: 22,
      username: 'nobody',
      authMethod: AuthMethod.PASSWORD,
      password: 'nothing',
      timeoutMs: 30_000
    })

    // The user takes the connection back while the handshake runs.
    await delay(300)
    await adapter.disconnect()

    // The promise of the connection has to end — without it the tab would
    // hang on the animation of the connection for ever.
    await expect(connecting).rejects.toThrow()
    expect(adapter.state).toBe(SessionState.CLOSED)
  })

  it('reports the protocol and terminal capability', () => {
    const adapter = new SshAdapter()
    expect(adapter.protocol).toBe(ProtocolType.SSH)
    expect(adapter.capabilities).toContain('terminal')
  })
})
