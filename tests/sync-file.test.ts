import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AuthMethod,
  KeyType,
  ProtocolType,
  type Host,
  type SshKey
} from '@shared/types'
import { isRemoteNewer, parseSyncBundle, pickWinner, type SyncBundle } from '@shared/sync'
import { Storage } from '@app/services/storage'
import { MasterPasswordManager } from '@app/services/master-password'
import { SyncService } from '@app/services/sync-file'

interface Device {
  storage: Storage
  master: MasterPasswordManager
  service: SyncService
  dir: string
  id: string
}

const PASSWORD = 'correct horse battery'

/** The bundle travels as a string — that is what the user carries. */
function carry(bundle: SyncBundle): string {
  return JSON.stringify(bundle, null, 2)
}

describe('last-write-wins merge', () => {
  it('takes a row that does not exist locally', () => {
    expect(isRemoteNewer(null, { version: 1, updatedAt: '2026-11-07T10:00:00.000Z' })).toBe(true)
  })

  it('compares the version first', () => {
    expect(
      isRemoteNewer(
        { version: 2, updatedAt: '2026-11-07T12:00:00.000Z' },
        { version: 1, updatedAt: '2026-11-07T10:00:00.000Z' }
      )
    ).toBe(false)

    expect(
      isRemoteNewer(
        { version: 1, updatedAt: '2026-11-07T12:00:00.000Z' },
        { version: 2, updatedAt: '2026-11-07T10:00:00.000Z' }
      )
    ).toBe(true)
  })

  it('falls back to the timestamp for equal versions', () => {
    expect(
      isRemoteNewer(
        { version: 2, updatedAt: '2026-11-07T10:00:00.000Z' },
        { version: 2, updatedAt: '2026-11-07T10:00:01.000Z' }
      )
    ).toBe(true)
  })

  it('keeps the local side when the remote one is older', () => {
    expect(
      pickWinner(
        { version: 3, updatedAt: '2026-11-07T10:00:00.000Z' },
        { version: 2, updatedAt: '2026-11-07T09:00:00.000Z' }
      )
    ).toBe('local')
    expect(pickWinner(null, { version: 1, updatedAt: '2026-11-07T10:00:00.000Z' })).toBe('remote')
  })
})

describe('the sync file', () => {
  it('rejects a file of a foreign format', () => {
    expect(() => parseSyncBundle('{"hello":"world"}')).toThrow(/not a ReliquarySSH sync file/u)
  })

  it('rejects a broken file', () => {
    expect(() => parseSyncBundle('not json at all')).toThrow(/not a valid sync file/u)
  })
})

describe('the sync service', () => {
  let dirs: string[] = []
  let a: Device
  let b: Device

  function makeDevice(name: string, secretByte: number): Device {
    const dir = mkdtempSync(join(tmpdir(), `reliquary-sync-${name}-`))
    dirs.push(dir)

    const storage = new Storage(join(dir, 'reliquary.db'), () => name)
    const master = new MasterPasswordManager(join(dir, 'master.json'), Buffer.alloc(32, secretByte))
    master.init()

    // The salt of the account comes from the settings, like in the app.
    master.readImportedKdf = () => {
      const raw = storage.settings.get('importedKdf')
      return raw === '' ? null : raw
    }

    return {
      dir,
      id: name,
      storage,
      master,
      service: new SyncService(storage, master, storage.replicas, () => name)
    }
  }

  beforeEach(() => {
    dirs = []
    a = makeDevice('device-a', 1)
    b = makeDevice('device-b', 2)
  })

  afterEach(() => {
    a.storage.close()
    b.storage.close()
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  })

  function saveHost(device: Device, overrides: Partial<Host> = {}): Host {
    const now = new Date().toISOString()
    const host = device.storage.hosts.save({
      name: 'prod',
      protocol: ProtocolType.SSH,
      host: 'example.com',
      port: 22,
      username: 'root',
      authMethod: AuthMethod.PASSWORD,
      createdAt: now,
      updatedAt: now,
      version: 1,
      deviceId: device.id,
      ...overrides
    })

    device.storage.changes.record({
      id: crypto.randomUUID(),
      entity: 'hosts',
      entityId: host.id,
      operation: 'upsert',
      payload: JSON.stringify(host),
      synced: false,
      createdAt: now,
      updatedAt: now,
      version: host.version,
      deviceId: device.id
    })

    return host
  }

  function editHost(device: Device, host: Host, changes: Partial<Host>): Host {
    const now = new Date(Date.now() + 60_000).toISOString()
    const updated = device.storage.hosts.save({
      ...host,
      ...changes,
      updatedAt: now,
      version: host.version + 1
    })

    device.storage.changes.record({
      id: crypto.randomUUID(),
      entity: 'hosts',
      entityId: updated.id,
      operation: 'upsert',
      payload: JSON.stringify(updated),
      synced: false,
      createdAt: now,
      updatedAt: now,
      version: updated.version,
      deviceId: device.id
    })

    return updated
  }

  /**
   * The second device reads the file first — the records wait for the
   * master password — and adopts the salt the file carries.
   */
  async function joinSecondDevice(file: string): Promise<void> {
    const bundle = parseSyncBundle(file)
    expect(bundle.kdf).toBeTruthy()

    await b.service.importBundle(file)
    b.storage.settings.set('importedKdf', JSON.stringify(bundle.kdf))
    await b.master.set(PASSWORD)
    await b.service.applyReplicas()
  }

  /** The result of the import the second device made. */
  async function importOnSecondDevice(file: string) {
    await b.service.importBundle(file)
    b.storage.settings.set('importedKdf', JSON.stringify(parseSyncBundle(file).kdf))
    await b.master.set(PASSWORD)
    return b.service.applyReplicas()
  }

  it('writes an encrypted host into the file', async () => {
    await a.master.set(PASSWORD)
    const host = saveHost(a, { host: 'hidden.example.com', notes: 'top secret note' })

    expect(a.service.status().pending).toBe(1)
    const bundle = await a.service.exportBundle()
    expect(bundle.entries.length).toBeGreaterThanOrEqual(1)
    expect(a.service.status().pending).toBe(0)

    const hostEntry = bundle.entries.find((entry) => entry.entity === 'hosts')
    expect(hostEntry?.entityId).toBe(host.id)
    expect(hostEntry?.iv).toBeTruthy()
    expect(hostEntry?.tag).toBeTruthy()

    const wire = carry(bundle)
    expect(wire).not.toContain('hidden.example.com')
    expect(wire).not.toContain('top secret note')
    expect(wire).not.toContain('root')

    expect(bundle.kdf).toEqual(a.master.getParams())
  })

  it('restores the data on a second device with the same master password', async () => {
    await a.master.set(PASSWORD)
    saveHost(a, { name: 'work' })
    const file = carry(await a.service.exportBundle())

    const applied = await importOnSecondDevice(file)

    expect(applied.applied).toBe(1)
    expect(b.storage.hosts.list().map((host) => host.name)).toEqual(['work'])
    expect(b.service.status().lastError).toBeNull()
  })

  it('propagates an update to the other device', async () => {
    await a.master.set(PASSWORD)
    saveHost(a, { name: 'before' })
    const first = carry(await a.service.exportBundle())

    await joinSecondDevice(first)
    await b.service.importBundle(first)

    const [remote] = b.storage.hosts.list()
    expect(remote).toBeTruthy()
    editHost(b, remote!, { name: 'after' })
    const second = carry(await b.service.exportBundle())

    const result = await a.service.importBundle(second)
    expect(result.applied).toBe(1)
    expect(a.storage.hosts.list().map((host) => host.name)).toEqual(['after'])
  })

  it('keeps the local row when it is newer than the one in the file', async () => {
    await a.master.set(PASSWORD)
    const host = saveHost(a, { name: 'before' })
    const first = carry(await a.service.exportBundle())

    await joinSecondDevice(first)
    await b.service.importBundle(first)

    // B edits and exports version 2.
    const [remote] = b.storage.hosts.list()
    editHost(b, remote!, { name: 'from-b' })
    const second = carry(await b.service.exportBundle())

    // A edits without exporting: version 2 as well, but a later timestamp.
    editHost(a, host, { name: 'from-a' })
    const result = await a.service.importBundle(second)

    expect(result.applied).toBe(0)
    expect(a.storage.hosts.list().map((row) => row.name)).toEqual(['from-a'])
  })

  it('propagates a deletion as a tombstone', async () => {
    await a.master.set(PASSWORD)
    const host = saveHost(a, { name: 'temporary' })
    const first = carry(await a.service.exportBundle())

    await joinSecondDevice(first)
    await b.service.importBundle(first)
    expect(b.storage.hosts.list()).toHaveLength(1)

    a.storage.hosts.remove(host.id)
    a.storage.changes.record({
      id: crypto.randomUUID(),
      entity: 'hosts',
      entityId: host.id,
      operation: 'delete',
      payload: JSON.stringify({ id: host.id }),
      synced: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 2,
      deviceId: a.id
    })

    const second = carry(await a.service.exportBundle())
    const result = await b.service.importBundle(second)

    expect(result.applied).toBe(1)
    expect(b.storage.hosts.list()).toEqual([])
    expect(b.storage.hosts.get(host.id)?.deletedAt).not.toBeNull()
  })

  it('syncs keys, and keeps the private part encrypted', async () => {
    await a.master.set(PASSWORD)

    const now = new Date().toISOString()
    const key: SshKey = {
      id: crypto.randomUUID(),
      name: 'laptop',
      type: KeyType.ED25519,
      fingerprint: 'SHA256:test',
      publicKey: 'ssh-ed25519 AAAA test',
      encryptedPrivateKey: '{"version":1,"ciphertext":"sealed"}',
      privateKeyFormat: 'openssh',
      hasPassphrase: false,
      comment: 'laptop',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1,
      deviceId: a.id
    }
    await a.storage.keys.save(key)
    a.storage.changes.record({
      id: crypto.randomUUID(),
      entity: 'keys',
      entityId: key.id,
      operation: 'upsert',
      payload: JSON.stringify(key),
      synced: false,
      createdAt: now,
      updatedAt: now,
      version: 1,
      deviceId: a.id
    })

    const file = carry(await a.service.exportBundle())

    await joinSecondDevice(file)
    await b.service.importBundle(file)

    const [synced] = await b.storage.keys.list()
    expect(synced?.name).toBe('laptop')
    expect(synced?.encryptedPrivateKey).toBe(key.encryptedPrivateKey)
    expect(file).not.toContain('ssh-ed25519 AAAA test')
  })

  it('does not apply the records it cannot decrypt', async () => {
    await a.master.set(PASSWORD)
    saveHost(a, { name: 'secret-host' })
    const file = carry(await a.service.exportBundle())

    // B sets a different password with its own salt — a wrong key.
    await b.master.set('another password entirely')

    const result = await b.service.importBundle(file)

    expect(result.applied).toBe(0)
    expect(b.storage.hosts.list()).toEqual([])
    expect(b.service.status().lastError).toMatch(/decrypted/u)
  })

  it('refuses to export without the master password', async () => {
    await expect(a.service.exportBundle()).rejects.toThrow(/master password/u)
  })

  it('keeps the records of a file until the master password is set', async () => {
    await a.master.set(PASSWORD)
    saveHost(a, { name: 'waiting' })
    const file = carry(await a.service.exportBundle())

    // The second device has no master password yet.
    const result = await b.service.importBundle(file)
    expect(result.applied).toBe(0)
    expect(b.storage.hosts.list()).toEqual([])
    expect(b.storage.replicas.count()).toBeGreaterThanOrEqual(1)

    // The salt of the file is adopted, and the password opens the records.
    const bundle = parseSyncBundle(file)
    b.storage.settings.set('importedKdf', JSON.stringify(bundle.kdf))
    await b.master.set(PASSWORD)
    await b.service.applyReplicas()

    expect(b.storage.hosts.list().map((host) => host.name)).toEqual(['waiting'])
  })

  it('reports the pending journal until the file is written', async () => {
    await a.master.set(PASSWORD)
    saveHost(a)
    expect(a.service.status().pending).toBe(1)

    await a.service.exportBundle()
    expect(a.service.status().pending).toBe(0)
  })

  it('carries the records of the other devices along', async () => {
    await a.master.set(PASSWORD)
    saveHost(a, { name: 'from-a' })
    const first = carry(await a.service.exportBundle())

    await joinSecondDevice(first)
    await b.service.importBundle(first)

    // B writes its own record and exports — A's record travels along.
    const [remote] = b.storage.hosts.list()
    editHost(b, remote!, { name: 'from-b' })
    const second = await b.service.exportBundle()

    expect(second.entries.length).toBeGreaterThanOrEqual(2)
    expect(second.entries.filter((entry) => entry.deviceId === 'device-a')).toHaveLength(1)
    expect(second.entries.filter((entry) => entry.deviceId === 'device-b')).toHaveLength(1)
  })
})
