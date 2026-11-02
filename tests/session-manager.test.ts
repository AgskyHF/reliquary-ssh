import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AuthMethod, ProtocolType, SessionState } from '@shared/types'
import { SessionManager } from '@app/services/session-manager'
import { startTestSshServer, type TestSshServer } from './helpers/test-ssh-server'

describe('SessionManager against a real SSH server', () => {
  let server: TestSshServer
  let manager: SessionManager

  beforeAll(async () => {
    server = await startTestSshServer()
    manager = new SessionManager()
  })

  afterAll(async () => {
    await manager.disconnectAll()
    await server.close()
  })

  it('connects, streams data and disconnects', async () => {
    const chunks: string[] = []
    const states: string[] = []

    manager.on('data', (payload) => chunks.push(payload.chunk))
    manager.on('state', (payload) => states.push(payload.state))

    await manager.connect('session-a', ProtocolType.SSH, {
      host: server.host,
      port: server.port,
      username: server.username,
      authMethod: AuthMethod.PASSWORD,
      password: server.password
    })

    expect(manager.list()).toEqual(['session-a'])
    expect(chunks.join('')).toContain('Welcome to ReliquarySSH test server')
    expect(states).toContain(SessionState.CONNECTED)

    manager.write('session-a', 'echo through-manager\n')
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(chunks.join('')).toContain('through-manager')

    await manager.disconnect('session-a')
    expect(manager.list()).toEqual([])
  })

  it('keeps two independent sessions at the same time', async () => {
    const first: string[] = []
    const second: string[] = []

    manager.on('data', (payload) => {
      if (payload.sessionId === 'session-1') first.push(payload.chunk)
      if (payload.sessionId === 'session-2') second.push(payload.chunk)
    })

    await manager.connect('session-1', ProtocolType.SSH, {
      host: server.host,
      port: server.port,
      username: server.username,
      authMethod: AuthMethod.PASSWORD,
      password: server.password
    })

    await manager.connect('session-2', ProtocolType.SSH, {
      host: server.host,
      port: server.port,
      username: server.username,
      authMethod: AuthMethod.PASSWORD,
      password: server.password
    })

    expect(manager.list().sort()).toEqual(['session-1', 'session-2'])

    manager.write('session-1', 'echo only-first\n')
    manager.write('session-2', 'echo only-second\n')
    await new Promise((resolve) => setTimeout(resolve, 400))

    expect(first.join('')).toContain('only-first')
    expect(first.join('')).not.toContain('only-second')
    expect(second.join('')).toContain('only-second')
    expect(second.join('')).not.toContain('only-first')

    await manager.disconnectAll()
  })

  it('rejects a connection to a closed port', async () => {
    await expect(
      manager.connect('session-bad', ProtocolType.SSH, {
        host: '127.0.0.1',
        port: 1,
        username: 'tester',
        authMethod: AuthMethod.PASSWORD,
        password: 'secret',
        timeoutMs: 3000
      })
    ).rejects.toThrow()

    expect(manager.list()).toEqual([])
  })
})
