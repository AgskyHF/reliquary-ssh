import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { utils as sshUtils } from 'ssh2'
import { KeyType } from '@shared/types'
import { KeychainService, fingerprintFromPublicKey } from '@app/services/keychain'
import { JsonFileKeyRepository } from '@app/services/key-store'
import { MasterPasswordManager } from '@app/services/master-password'
import { createMasterKey } from '@app/services/crypto'
import { getDeviceSecret } from '@app/services/device-id'

describe('KeychainService', () => {
  let dir: string
  let repository: JsonFileKeyRepository
  let keychain: KeychainService

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'reliquary-keychain-'))
    repository = new JsonFileKeyRepository(join(dir, 'keys.json'), () => 'test-device')
    keychain = new KeychainService(repository, createMasterKey('master'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('generates an ed25519 key pair', async () => {
    const key = await keychain.generate({ name: 'deploy', type: 'ed25519' })

    expect(key.name).toBe('deploy')
    expect(key.type).toBe(KeyType.ED25519)
    expect(key.publicKey).toContain('ssh-ed25519')
    expect(key.fingerprint).toMatch(/^SHA256:/)
    expect(key.hasPassphrase).toBe(false)
  })

  it('generates an RSA key pair', async () => {
    const key = await keychain.generate({ name: 'rsa-key', type: 'rsa', bits: 2048 })
    expect(key.type).toBe(KeyType.RSA)
    expect(key.publicKey).toContain('ssh-rsa')
  })

  it('generates an ECDSA key pair', async () => {
    const key = await keychain.generate({ name: 'ecdsa-key', type: 'ecdsa' })
    expect(key.type).toBe(KeyType.ECDSA)
    expect(key.publicKey).toContain('ecdsa-sha2')
  })

  it('never stores the private key in plaintext', async () => {
    await keychain.generate({ name: 'deploy', type: 'ed25519' })

    const raw = readFileSync(join(dir, 'keys.json'), 'utf8')
    expect(raw).not.toContain('PRIVATE KEY')
    expect(raw).not.toContain('deploy-key-comment')
  })

  it('decrypts the private key back for a session', async () => {
    const key = await keychain.generate({ name: 'deploy', type: 'ed25519' })
    const material = await keychain.privateKeyMaterial(key.id)

    const parsed = sshUtils.parseKey(material)
    expect(parsed instanceof Error).toBe(false)
  })

  it('imports an existing private key', async () => {
    const pair = sshUtils.generateKeyPairSync('ed25519')
    const key = await keychain.import({ name: 'imported', privateKey: pair.private })

    expect(key.name).toBe('imported')
    expect(key.type).toBe(KeyType.ED25519)
    expect(key.publicKey).toContain('ssh-ed25519')
  })

  it('rejects an unparsable private key', async () => {
    await expect(
      keychain.import({ name: 'broken', privateKey: 'not a key' })
    ).rejects.toThrow()
  })

  it('exports the public key for authorized_keys', async () => {
    const key = await keychain.generate({ name: 'deploy', type: 'ed25519' })
    const exported = await keychain.exportPublic(key.id)

    expect(exported).toBe(key.publicKey)
    expect(exported.split(' ')[0]).toBe('ssh-ed25519')
  })

  it('lists the stored keys', async () => {
    await keychain.generate({ name: 'one', type: 'ed25519' })
    await keychain.generate({ name: 'two', type: 'ed25519' })

    const keys = await keychain.list()
    expect(keys).toHaveLength(2)
    expect(keys.map((key) => key.name).sort()).toEqual(['one', 'two'])
  })

  it('deletes a key (soft delete)', async () => {
    const key = await keychain.generate({ name: 'gone', type: 'ed25519' })
    await keychain.remove(key.id)

    const keys = await keychain.list()
    expect(keys).toHaveLength(0)
  })

  it('refuses to export a deleted key', async () => {
    const key = await keychain.generate({ name: 'gone', type: 'ed25519' })
    await keychain.remove(key.id)

    await expect(keychain.exportPublic(key.id)).rejects.toThrow()
  })

  it('does not leak the private key through the summary', async () => {
    const key = await keychain.generate({ name: 'deploy', type: 'ed25519' })
    expect(Object.keys(key)).not.toContain('encryptedPrivateKey')
    expect(Object.keys(key)).not.toContain('privateKey')
  })

  it('always generates a usable private key', async () => {
    // ssh2 1.17 sometimes produces a malformed OpenSSH private key
    // (about 1 in 300 runs). The service must never store such a key.
    for (let attempt = 0; attempt < 60; attempt++) {
      const key = await keychain.generate({ name: `k${attempt}`, type: 'ed25519' })
      const material = await keychain.privateKeyMaterial(key.id)

      const parsed = sshUtils.parseKey(material)
      expect(parsed instanceof Error).toBe(false)
    }
  })
})

describe('fingerprintFromPublicKey', () => {
  it('matches the OpenSSH SHA256 format', () => {
    const pair = sshUtils.generateKeyPairSync('ed25519')
    const parsed = sshUtils.parseKey(pair.private)
    expect(parsed instanceof Error).toBe(false)
    if (parsed instanceof Error) return

    const publicKey = parsed.getPublicSSH().toString('utf8').trim()
    const fingerprint = fingerprintFromPublicKey(publicKey)

    expect(fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]+$/u)
  })

  it('is stable for the same key', () => {
    const pair = sshUtils.generateKeyPairSync('ed25519')
    const parsed = sshUtils.parseKey(pair.private)
    if (parsed instanceof Error) return

    const publicKey = parsed.getPublicSSH().toString('utf8').trim()
    expect(fingerprintFromPublicKey(publicKey)).toBe(fingerprintFromPublicKey(publicKey))
  })

  it('matches the fingerprint of the same key in OpenSSH format', () => {
    // The one-line format is "<type> <base64 blob> <comment>"; the
    // fingerprint is the SHA256 of the decoded blob. A key parsed from
    // either representation must produce the same fingerprint.
    const pair = sshUtils.generateKeyPairSync('ed25519')
    const parsed = sshUtils.parseKey(pair.private)
    if (parsed instanceof Error) return

    const blob = parsed.getPublicSSH()
    const type = blob.subarray(4, 4 + blob.readUInt32BE(0)).toString('utf8')
    const oneLine = `${type} ${blob.toString('base64')} comment`

    // Re-parsing the one-line form must yield the same blob.
    const reparsed = sshUtils.parseKey(oneLine)
    expect(reparsed instanceof Error).toBe(false)
    if (reparsed instanceof Error) return
    expect(reparsed.getPublicSSH().equals(blob)).toBe(true)

    expect(fingerprintFromPublicKey(oneLine)).toBe(
      `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/u, '')}`
    )
  })
})

describe('MasterPasswordManager', () => {
  let dir: string
  let manager: MasterPasswordManager

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'reliquary-master-'))
    manager = new MasterPasswordManager(
      join(dir, 'master.json'),
      getDeviceSecret(dir)
    )
    manager.init()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('starts without a master password', () => {
    expect(manager.has()).toBe(false)
    expect(manager.unlocked).toBe(false)
  })

  it('stores the master password material', async () => {
    await manager.set('master')

    expect(manager.has()).toBe(true)
    expect(manager.unlocked).toBe(true)
    expect(manager.getMasterKey()).not.toBeNull()
  })

  it('never writes the password itself', async () => {
    await manager.set('super-secret')
    const raw = readFileSync(join(dir, 'master.json'), 'utf8')
    expect(raw).not.toContain('super-secret')
  })

  it('verifies the correct password', async () => {
    await manager.set('master')
    expect(manager.verify('master')).toBe(true)
  })

  it('rejects a wrong password', async () => {
    await manager.set('master')
    expect(manager.verify('wrong')).toBe(false)
  })

  it('reloads the material from disk', async () => {
    await manager.set('master')

    const reloaded = new MasterPasswordManager(
      join(dir, 'master.json'),
      getDeviceSecret(dir)
    )
    reloaded.init()

    expect(reloaded.has()).toBe(true)
    expect(reloaded.verify('master')).toBe(true)
  })

  it('forgets the key on lock', async () => {
    await manager.set('master')
    manager.lock()

    expect(manager.unlocked).toBe(false)
    expect(manager.getMasterKey()).toBeNull()
  })

  it('unlocks with the correct password', async () => {
    await manager.set('master')
    manager.lock()

    expect(manager.unlock('master')).toBe(true)
    expect(manager.unlocked).toBe(true)
    expect(manager.getMasterKey()).not.toBeNull()
  })

  it('does not unlock with a wrong password', async () => {
    await manager.set('master')
    manager.lock()

    expect(manager.unlock('wrong')).toBe(false)
    expect(manager.unlocked).toBe(false)
  })

  it('stays locked after a restart until it is unlocked', async () => {
    await manager.set('master')

    const reloaded = new MasterPasswordManager(
      join(dir, 'master.json'),
      getDeviceSecret(dir)
    )
    reloaded.init()

    // The file is loaded, but the material stays in memory only.
    expect(reloaded.has()).toBe(true)
    expect(reloaded.unlocked).toBe(false)

    expect(reloaded.unlock('master')).toBe(true)
    expect(reloaded.unlocked).toBe(true)
  })
})
