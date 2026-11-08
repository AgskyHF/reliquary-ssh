import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Storage } from '@app/services/storage'
import { createMasterKey } from '@app/services/crypto'
import { AuthMethod, ProtocolType } from '@shared/types'

describe('the passwords of the hosts', () => {
  let dir: string
  let storage: Storage

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'reliquary-passwords-'))
    storage = new Storage(join(dir, 'reliquary.db'), () => 'test-device')
  })

  afterEach(() => {
    storage.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('stores a password and reads it back', () => {
    const host = storage.hosts.save({
      name: 'Server',
      protocol: ProtocolType.SSH,
      host: '10.0.0.1',
      port: 22,
      username: SSH_USER,
      authMethod: AuthMethod.PASSWORD,
      keyId: null
    })

    const material = createMasterKey('master-password', undefined, 1000)
    storage.passwords.save(host.id, 'the-secret', material, 'test-device')

    expect(storage.passwords.has(host.id)).toBe(true)
    expect(storage.passwords.reveal(host.id, material)).toBe('the-secret')
  })

  it('keeps the password out of the plain text', () => {
    const host = storage.hosts.save({
      name: 'Server',
      protocol: ProtocolType.SSH,
      host: '10.0.0.1',
      port: 22,
      username: SSH_USER,
      authMethod: AuthMethod.PASSWORD,
      keyId: null
    })

    const material = createMasterKey('master-password', undefined, 1000)
    storage.passwords.save(host.id, 'the-secret', material, 'test-device')

    const stored = storage.passwords.get(host.id)
    expect(stored).not.toBeNull()
    expect(stored?.encryptedPassword).not.toContain('the-secret')
  })

  it('does not open the password with the wrong key', () => {
    const host = storage.hosts.save({
      name: 'Server',
      protocol: ProtocolType.SSH,
      host: '10.0.0.1',
      port: 22,
      username: SSH_USER,
      authMethod: AuthMethod.PASSWORD,
      keyId: null
    })

    const material = createMasterKey('master-password', undefined, 1000)
    storage.passwords.save(host.id, 'the-secret', material, 'test-device')

    const other = createMasterKey('another-password', undefined, 1000)
    expect(storage.passwords.reveal(host.id, other)).toBeNull()
  })

  it('copies a sealed password to another host', () => {
    const host = storage.hosts.save({
      name: 'Server',
      protocol: ProtocolType.SSH,
      host: '10.0.0.1',
      port: 22,
      username: SSH_USER,
      authMethod: AuthMethod.PASSWORD,
      keyId: null
    })

    const material = createMasterKey('master-password', undefined, 1000)
    storage.passwords.save(host.id, 'the-secret', material, 'test-device')

    const copy = storage.hosts.save({
      ...host,
      id: 'copy-id',
      name: 'Server (copy)'
    })

    const stored = storage.passwords.get(host.id)
    storage.passwords.saveSealed(copy.id, stored!.encryptedPassword, 'test-device')

    expect(storage.passwords.reveal(copy.id, material)).toBe('the-secret')
  })
})
