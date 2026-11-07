import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthMethod, ProtocolType } from '@shared/types'
import { Storage } from '@app/services/storage'
import { MasterPasswordManager } from '@app/services/master-password'
import { RestoreService } from '@app/services/restore'

const PASSWORD = 'correct horse battery'

describe('restoring a replaced version', () => {
  let dirs: string[] = []
  let storage: Storage
  let master: MasterPasswordManager
  let restore: RestoreService

  beforeEach(() => {
    dirs = []
    const dir = mkdtempSync(join(tmpdir(), 'reliquary-restore-'))
    dirs.push(dir)

    storage = new Storage(join(dir, 'reliquary.db'), () => 'device-a')
    master = new MasterPasswordManager(join(dir, 'master.json'), Buffer.alloc(32, 1))
    master.init()
    restore = new RestoreService(storage)
  })

  afterEach(() => {
    storage.close()
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  })

  /** Creates a host with a password and a replaced version of it. */
  function makeHostWithOldVersion(): string {
    const now = '2026-11-01T10:00:00.000Z'
    const material = master.getMasterKey()!

    const host = storage.hosts.save({
      id: 'host-1',
      name: 'prod-old',
      protocol: ProtocolType.SSH,
      host: 'old.example.com',
      port: 22,
      username: 'root',
      authMethod: AuthMethod.PASSWORD,
      keyId: null,
      color: '',
      group: null,
      notes: '',
      createdAt: now,
      updatedAt: now,
      version: 1,
      deviceId: 'device-a'
    })

    storage.passwords.save(host.id, 'the old password', material, 'device-a')

    storage.superseded.record({
      hostId: host.id,
      payload: {
        connection: { ...host, hasPassword: true },
        encryptedPassword: storage.passwords.get(host.id)?.encryptedPassword ?? null
      },
      replacedBy: host.id,
      reason: 'newer'
    })

    // The current version — newer, with another password.
    storage.hosts.save({
      ...host,
      name: 'prod-new',
      host: 'new.example.com',
      updatedAt: '2026-11-05T10:00:00.000Z',
      version: 2
    })
    storage.passwords.save(host.id, 'the new password', material, 'device-a')

    return host.id
  }

  it('brings the old version back', async () => {
    await master.set(PASSWORD)
    const hostId = makeHostWithOldVersion()

    const old = storage.superseded.list()
    expect(old).toHaveLength(1)

    const result = restore.restore(old[0]!.id, master.getMasterKey())

    expect(result.hostId).toBe(hostId)
    expect(result.version).toBe('prod-old')

    const current = storage.hosts.get(hostId)
    expect(current?.name).toBe('prod-old')
    expect(current?.host).toBe('old.example.com')
  })
  it('brings the old password back', async () => {
    await master.set(PASSWORD)
    const hostId = makeHostWithOldVersion()

    const old = storage.superseded.list()
    const result = restore.restore(old[0]!.id, master.getMasterKey())

    expect(result.passwordRestored).toBe(true)

    const revealed = storage.passwords.reveal(hostId, master.getMasterKey()!)
    expect(revealed).toBe('the old password')
  })

  it('keeps the version it replaced in the old folder', async () => {
    await master.set(PASSWORD)
    makeHostWithOldVersion()

    const old = storage.superseded.list()
    const result = restore.restore(old[0]!.id, master.getMasterKey())

    expect(result.replacedSaved).toBe(true)

    // The version that was current is now the replaced one.
    const now = storage.superseded.list()
    expect(now).toHaveLength(2)

    const moved = now.find((item) => item.id !== old[0]!.id)
    const payload = JSON.parse(moved!.payload) as { connection: { name: string } }
    expect(payload.connection.name).toBe('prod-new')

    // And its password is still there.
    const envelope = JSON.parse(moved!.payload) as { encryptedPassword: string | null }
    expect(envelope.encryptedPassword).toBeTruthy()
  })

  it('makes the restored version win the next merge', async () => {
    await master.set(PASSWORD)
    const hostId = makeHostWithOldVersion()

    const old = storage.superseded.list()
    restore.restore(old[0]!.id, master.getMasterKey())

    const current = storage.hosts.get(hostId)
    expect(current?.updatedAt).not.toBe('2026-11-01T10:00:00.000Z')
    expect(current?.version).toBe(3)
  })

  it('journals the restore so it reaches the other devices', async () => {
    await master.set(PASSWORD)
    const hostId = makeHostWithOldVersion()

    const old = storage.superseded.list()
    restore.restore(old[0]!.id, master.getMasterKey())

    const pending = storage.changes.pending()
    expect(pending).toHaveLength(1)
    expect(pending[0]?.entity).toBe('hosts')
    expect(pending[0]?.entityId).toBe(hostId)
  })

  it('keeps the password sealed when the master password is locked', async () => {
    await master.set(PASSWORD)
    const hostId = makeHostWithOldVersion()

    const old = storage.superseded.list()
    const result = restore.restore(old[0]!.id, null)

    expect(result.passwordRestored).toBe(false)

    // The version came back, and the password is still there — sealed.
    expect(storage.hosts.get(hostId)?.name).toBe('prod-old')
    expect(storage.passwords.has(hostId)).toBe(true)
  })
  it('refuses an unknown version', async () => {
    await master.set(PASSWORD)
    expect(() => restore.restore('nope', master.getMasterKey())).toThrow(/Unknown/u)
  })
})
