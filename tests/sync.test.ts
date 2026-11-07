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
import { isRemoteNewer, pickWinner, type SyncEntry } from '@shared/sync'
import { Storage } from '@app/services/storage'
import { MasterPasswordManager } from '@app/services/master-password'
import { SyncService, type SyncBackend } from '@app/services/sync'

/** The backend, in memory: it stores one replica per device and entity. */
class MemoryBackend implements SyncBackend {
  readonly serverUrl = 'http://memory'
  signedIn = true
  entries: SyncEntry[] = []

  isSignedIn(): boolean {
    return this.signedIn
  }

  async pushEntries(entries: SyncEntry[]): Promise<number> {
    for (const entry of entries) {
      const index = this.entries.findIndex(
        (stored) =>
          stored.deviceId === entry.deviceId &&
          stored.entity === entry.entity &&
          stored.entityId === entry.entityId
      )
      if (index >= 0) this.entries[index] = entry
      else this.entries.push(entry)
    }
    return entries.length
  }

  async pullEntries(entity?: string): Promise<SyncEntry[]> {
    return entity ? this.entries.filter((entry) => entry.entity === entity) : [...this.entries]
  }
}

interface Device {
  storage: Storage
  master: MasterPasswordManager
  service: SyncService
  dir: string
  id: string
}

const PASSWORD = 'correct horse battery'

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

describe('sync service', () => {
  let dirs: string[] = []
  let backend: MemoryBackend
  let a: Device
  let b: Device

  function makeDevice(name: string, secretByte: number): Device {
    const dir = mkdtempSync(join(tmpdir(), `reliquary-sync-${name}-`))
    dirs.push(dir)

    const storage = new Storage(join(dir, 'reliquary.db'), () => name)
    const master = new MasterPasswordManager(join(dir, 'master.json'), Buffer.alloc(32, secretByte))
    master.init()

    return {
      dir,
      id: name,
      storage,
      master,
      service: new SyncService(storage, master, backend, () => name)
    }
  }

  beforeEach(() => {
    dirs = []
    backend = new MemoryBackend()
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

  async function joinSecondDevice(): Promise<void> {
    const params = await b.service.fetchKdfParams()
    expect(params).toBeTruthy()
    await b.master.set(PASSWORD, params ?? undefined)
  }

  it('pushes an encrypted host and the account KDF parameters', async () => {
    await a.master.set(PASSWORD)
    const host = saveHost(a, { host: 'hidden.example.com', notes: 'top secret note' })

    expect(a.service.status().pending).toBe(1)
    const pushed = await a.service.push()
    expect(pushed).toBeGreaterThanOrEqual(2)
    expect(a.service.status().pending).toBe(0)

    const hostEntry = backend.entries.find((entry) => entry.entity === 'hosts')
    expect(hostEntry?.entityId).toBe(host.id)
    expect(hostEntry?.iv).toBeTruthy()
    expect(hostEntry?.tag).toBeTruthy()

    const wire = JSON.stringify(backend.entries)
    expect(wire).not.toContain('hidden.example.com')
    expect(wire).not.toContain('top secret note')
    expect(wire).not.toContain('root')

    const kdf = await a.service.fetchKdfParams()
    expect(kdf).toEqual(a.master.getParams())
  })

  it('restores the data on a second device with the same master password', async () => {
    await a.master.set(PASSWORD)
    saveHost(a, { name: 'work' })
    await a.service.syncNow()

    await joinSecondDevice()
    const applied = await b.service.syncNow()

    expect(applied.applied).toBe(1)
    expect(b.storage.hosts.list().map((host) => host.name)).toEqual(['work'])
    expect(b.service.status().lastError).toBeNull()
  })

  it('propagates an update to the other device', async () => {
    await a.master.set(PASSWORD)
    saveHost(a, { name: 'before' })
    await a.service.syncNow()

    await joinSecondDevice()
    await b.service.syncNow()

    const [remote] = b.storage.hosts.list()
    expect(remote).toBeTruthy()
    editHost(b, remote!, { name: 'after' })
    await b.service.syncNow()

    const result = await a.service.syncNow()
    expect(result.applied).toBe(1)
    expect(a.storage.hosts.list().map((host) => host.name)).toEqual(['after'])
  })

  it('keeps the local row when it is newer than the remote replica', async () => {
    await a.master.set(PASSWORD)
    const host = saveHost(a, { name: 'before' })
    await a.service.syncNow()

    await joinSecondDevice()
    await b.service.syncNow()

    // B edits and pushes version 2.
    const [remote] = b.storage.hosts.list()
    editHost(b, remote!, { name: 'from-b' })
    await b.service.syncNow()

    // A edits without pushing: version 2 as well, but a later timestamp.
    editHost(a, host, { name: 'from-a' })
    const result = await a.service.pull()

    expect(result.applied).toBe(0)
    expect(a.storage.hosts.list().map((row) => row.name)).toEqual(['from-a'])
  })

  it('propagates a deletion as a tombstone', async () => {
    await a.master.set(PASSWORD)
    const host = saveHost(a, { name: 'temporary' })
    await a.service.syncNow()

    await joinSecondDevice()
    await b.service.syncNow()
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

    await a.service.syncNow()
    const result = await b.service.syncNow()

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

    await a.service.syncNow()

    await joinSecondDevice()
    await b.service.syncNow()

    const [synced] = await b.storage.keys.list()
    expect(synced?.name).toBe('laptop')
    expect(synced?.encryptedPrivateKey).toBe(key.encryptedPrivateKey)
    expect(JSON.stringify(backend.entries)).not.toContain('ssh-ed25519 AAAA test')
  })

  it('does not apply entries it cannot decrypt', async () => {
    await a.master.set(PASSWORD)
    saveHost(a, { name: 'secret-host' })
    await a.service.syncNow()

    // B sets a different password with its own salt — a wrong account key.
    await b.master.set('another password entirely')

    const result = await b.service.syncNow()

    expect(result.applied).toBe(0)
    expect(b.storage.hosts.list()).toEqual([])
    expect(b.service.status().lastError).toMatch(/decrypted/u)
  })

  it('refuses to sync without a session or without the master password', async () => {
    await expect(a.service.syncNow()).rejects.toThrow(/master password/u)

    await a.master.set(PASSWORD)
    backend.signedIn = false
    await expect(a.service.syncNow()).rejects.toThrow(/Sign in/u)
  })

  it('reports the pending journal until a push succeeds', async () => {
    await a.master.set(PASSWORD)
    saveHost(a)
    expect(a.service.status().pending).toBe(1)

    const original = backend.pushEntries.bind(backend)
    backend.pushEntries = async () => {
      throw new Error('network down')
    }

    await expect(a.service.push()).rejects.toThrow(/network down/u)
    expect(a.service.status().pending).toBe(1)

    backend.pushEntries = original
    await a.service.push()
    expect(a.service.status().pending).toBe(0)
  })
})
