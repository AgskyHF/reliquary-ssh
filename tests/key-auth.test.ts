import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AuthMethod, ProtocolType } from '@shared/types'
import { SessionManager } from '@app/services/session-manager'
import { startTestSshServer, type TestSshServer } from './helpers/test-ssh-server'

describe('key authentication against a real SSH server', () => {
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

  it('connects with a private key', async () => {
    const chunks: string[] = []
    manager.on('data', (payload) => chunks.push(payload.chunk))

    await manager.connect('key-session', ProtocolType.SSH, {
      host: server.host,
      port: server.port,
      username: server.username,
      authMethod: AuthMethod.KEY,
      privateKey: server.authorizedPrivateKey
    })

    expect(manager.list()).toEqual(['key-session'])
    expect(chunks.join('')).toContain('Welcome to ReliquarySSH test server')

    await manager.disconnect('key-session')
    expect(manager.list()).toEqual([])
  })

  it('rejects a private key the server does not authorize', async () => {
    const { utils } = await import('ssh2')
    const other = utils.generateKeyPairSync('ed25519')

    await expect(
      manager.connect('wrong-key-session', ProtocolType.SSH, {
        host: server.host,
        port: server.port,
        username: server.username,
        authMethod: AuthMethod.KEY,
        privateKey: other.private
      })
    ).rejects.toThrow()

    expect(manager.list()).toEqual([])
  })

  it('rejects key authentication without key material', async () => {
    await expect(
      manager.connect('empty-key-session', ProtocolType.SSH, {
        host: server.host,
        port: server.port,
        username: server.username,
        authMethod: AuthMethod.KEY
      })
    ).rejects.toThrow()
  })
})
