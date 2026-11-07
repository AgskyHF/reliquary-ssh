import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthMethod, ProtocolType } from '@shared/types'
import { Storage } from '@app/services/storage'
import { MasterPasswordManager } from '@app/services/master-password'
import { SyncService } from '@app/services/sync'
import { FolderSyncBackend } from '@app/services/sync-folder'
import { SyncTransportRouter } from '@app/services/sync-transport'
import { BackendClient } from '@app/services/backend-client'

const PASSWORD = 'correct horse battery'

describe('the folder transport', () => {
  let dirs: string[] = []
  let folder: string

  beforeEach(() => {
    dirs = []
    folder = mkdtempSync(join(tmpdir(), 'reliquary-folder-'))
    dirs.push(folder)
  })

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  })

  it('writes one file per device and entity', async () => {
    const backend = new FolderSyncBackend(folder)

    await backend.pushEntries([
      {
        entity: 'hosts',
        entityId: 'host-1',
        version: 1,
        iv: 'aXY=',
        ciphertext: 'Y2lwaGVy',
        tag: 'dGFn',
        deviceId: 'device-a',
        updatedAt: '2026-11-07T10:00:00.000Z',
        deletedAt: null
      }
    ])

    const hosts = join(folder, 'hosts')
    expect(existsSync(hosts)).toBe(true)
    expect(readdirSync(hosts)).toHaveLength(1)
    expect(readdirSync(hosts)[0]).toContain('device-a')
  })

  it('reads the entries back', async () => {
    const backend = new FolderSyncBackend(folder)

    await backend.pushEntries([
      {
        entity: 'hosts',
        entityId: 'host-1',
        version: 2,
        iv: 'aXY=',
        ciphertext: 'Y2lwaGVy',
        tag: 'dGFn',
        deviceId: 'device-a',
        updatedAt: '2026-11-07T10:00:00.000Z',
        deletedAt: null
      }
    ])

    const entries = await backend.pullEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.entityId).toBe('host-1')
    expect(entries[0]?.ciphertext).toBe('Y2lwaGVy')
    expect(entries[0]?.version).toBe(2)
  })

  it('filters by entity', async () => {
    const backend = new FolderSyncBackend(folder)
    const base = {
      version: 1,
      iv: '',
      ciphertext: 'x',
      tag: '',
      deviceId: 'device-a',
      updatedAt: '2026-11-07T10:00:00.000Z',
      deletedAt: null
    }

    await backend.pushEntries([
      { ...base, entity: 'hosts', entityId: 'h1' },
      { ...base, entity: 'keys', entityId: 'k1' }
    ])

    const keys = await backend.pullEntries('keys')
    expect(keys).toHaveLength(1)
    expect(keys[0]?.entity).toBe('keys')
  })

  it('keeps the salt in one shared file', async () => {
    const backend = new FolderSyncBackend(folder)
    const base = {
      version: 1,
      iv: '',
      ciphertext: 'x',
      tag: '',
      updatedAt: '2026-11-07T10:00:00.000Z',
      deletedAt: null
    }

    await backend.pushEntries([
      { ...base, entity: 'settings', entityId: 'sync.kdf', deviceId: 'device-a' },
      { ...base, entity: 'settings', entityId: 'sync.kdf', deviceId: 'device-b' }
    ])

    const files = readdirSync(join(folder, 'settings'))
    expect(files).toHaveLength(1)

    const entries = await backend.pullEntries('settings')
    expect(entries).toHaveLength(1)
  })

  it('ignores a broken file', async () => {
    const backend = new FolderSyncBackend(folder)
    await backend.pushEntries([
      {
        entity: 'hosts',
        entityId: 'host-1',
        version: 1,
        iv: '',
        ciphertext: 'x',
        tag: '',
        deviceId: 'device-a',
        updatedAt: '2026-11-07T10:00:00.000Z',
        deletedAt: null
      }
    ])

    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(folder, 'hosts', 'broken.json'), '{not json', 'utf8')

    const entries = await backend.pullEntries()
    expect(entries).toHaveLength(1)
  })

  it('refuses to push into a missing folder', async () => {
    const backend = new FolderSyncBackend(join(folder, 'nope'))

    await expect(
      backend.pushEntries([
        {
          entity: 'hosts',
          entityId: 'h1',
          version: 1,
          iv: '',
          ciphertext: 'x',
          tag: '',
          deviceId: 'device-a',
          updatedAt: '2026-11-07T10:00:00.000Z',
          deletedAt: null
        }
      ])
    ).rejects.toThrow(/does not exist/u)
  })

  it('is not signed in when the folder is missing', () => {
    expect(new FolderSyncBackend(join(folder, 'nope')).isSignedIn()).toBe(false)
    expect(new FolderSyncBackend(folder).isSignedIn()).toBe(true)
  })
})

describe('sync over a shared folder', () => {
  let dirs: string[] = []
  let folder: string

  beforeEach(() => {
    dirs = []
    folder = mkdtempSync(join(tmpdir(), 'reliquary-folder-sync-'))
    dirs.push(folder)
  })

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  })

  function makeDevice(name: string, secretByte: number) {
    const dir = mkdtempSync(join(tmpdir(), `reliquary-folder-sync-${name}-`))
    dirs.push(dir)

    const storage = new Storage(join(dir, 'reliquary.db'), () => name)
    const master = new MasterPasswordManager(join(dir, 'master.json'), Buffer.alloc(32, secretByte))
    master.init()

    const transport = new SyncTransportRouter(
      new BackendClient({ serverUrl: 'http://127.0.0.1:1' }),
      { transport: 'folder', serverUrl: '', folder }
    )

    const service = new SyncService(storage, master, transport, () => name)
    return { storage, master, service, id: name }
  }

  it('needs no account at all', () => {
    const a = makeDevice('device-a', 1)
    expect(a.service.status().signedIn).toBe(true)
  })

  it('moves a host between two devices through the folder', async () => {
    const a = makeDevice('device-a', 1)
    const b = makeDevice('device-b', 2)

    await a.master.set(PASSWORD)

    const now = new Date().toISOString()
    const host = a.storage.hosts.save({
      name: 'prod',
      protocol: ProtocolType.SSH,
      host: 'example.com',
      port: 22,
      username: 'root',
      authMethod: AuthMethod.PASSWORD,
      createdAt: now,
      updatedAt: now,
      version: 1,
      deviceId: 'device-a'
    })
    a.storage.changes.record({
      id: crypto.randomUUID(),
      entity: 'hosts',
      entityId: host.id,
      operation: 'upsert',
      payload: JSON.stringify(host),
      synced: false,
      createdAt: now,
      updatedAt: now,
      version: 1,
      deviceId: 'device-a'
    })

    await a.service.syncNow()

    // The folder holds encrypted entries only.
    const onDisk = readFileSync(join(folder, 'hosts', readdirSync(join(folder, 'hosts'))[0]!), 'utf8')
    expect(onDisk).not.toContain('example.com')
    expect(onDisk).not.toContain('"root"')
    expect(onDisk).not.toContain('prod')

    // The second device takes the salt from the folder and reads the host.
    const params = await b.service.fetchKdfParams()
    expect(params).toBeTruthy()
    await b.master.set(PASSWORD, params ?? undefined)

    const result = await b.service.syncNow()
    expect(result.applied).toBe(1)
    expect(b.storage.hosts.list().map((row) => row.name)).toEqual(['prod'])
  })

  it('merges the changes of two devices without a server', async () => {
    const a = makeDevice('device-a', 1)
    const b = makeDevice('device-b', 2)

    await a.master.set(PASSWORD)

    // The first device publishes the salt of the folder — the second one
    // needs it to derive the same key.
    await a.service.syncNow()

    const params = await b.service.fetchKdfParams()
    expect(params).toBeTruthy()
    await b.master.set(PASSWORD, params ?? undefined)

    const now = new Date().toISOString()
    const hostA = a.storage.hosts.save({
      name: 'from-a',
      protocol: ProtocolType.SSH,
      host: 'a.example.com',
      port: 22,
      username: 'root',
      authMethod: AuthMethod.PASSWORD,
      createdAt: now,
      updatedAt: now,
      version: 1,
      deviceId: 'device-a'
    })
    a.storage.changes.record({
      id: crypto.randomUUID(),
      entity: 'hosts',
      entityId: hostA.id,
      operation: 'upsert',
      payload: JSON.stringify(hostA),
      synced: false,
      createdAt: now,
      updatedAt: now,
      version: 1,
      deviceId: 'device-a'
    })

    const hostB = b.storage.hosts.save({
      name: 'from-b',
      protocol: ProtocolType.SSH,
      host: 'b.example.com',
      port: 22,
      username: 'root',
      authMethod: AuthMethod.PASSWORD,
      createdAt: now,
      updatedAt: now,
      version: 1,
      deviceId: 'device-b'
    })
    b.storage.changes.record({
      id: crypto.randomUUID(),
      entity: 'hosts',
      entityId: hostB.id,
      operation: 'upsert',
      payload: JSON.stringify(hostB),
      synced: false,
      createdAt: now,
      updatedAt: now,
      version: 1,
      deviceId: 'device-b'
    })

    await a.service.syncNow()
    await b.service.syncNow()

    // Both devices know both hosts after the round trip.
    await a.service.syncNow()
    await b.service.syncNow()

    expect(a.storage.hosts.list().map((row) => row.name).sort()).toEqual(['from-a', 'from-b'])
    expect(b.storage.hosts.list().map((row) => row.name).sort()).toEqual(['from-a', 'from-b'])
  })
})
