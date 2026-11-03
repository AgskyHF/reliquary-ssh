import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthMethod, KeyType, ProtocolType, TabKind } from '@shared/types'
import { Storage } from '@app/services/storage'

describe('SQLite storage', () => {
  let dir: string
  let storage: Storage

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'reliquary-storage-'))
    storage = new Storage(join(dir, 'reliquary.db'), () => 'test-device')
  })

  afterEach(() => {
    storage.close()
    rmSync(dir, { recursive: true, force: true })
  })

  describe('hosts', () => {
    it('starts empty', () => {
      expect(storage.hosts.list()).toEqual([])
    })

    it('saves and reads a host back', () => {
      const saved = storage.hosts.save({
        name: 'prod',
        protocol: ProtocolType.SSH,
        host: 'example.com',
        port: 22,
        username: 'root',
        authMethod: AuthMethod.PASSWORD
      })

      const hosts = storage.hosts.list()
      expect(hosts).toHaveLength(1)
      expect(hosts[0]?.name).toBe('prod')
      expect(hosts[0]?.host).toBe('example.com')
      expect(hosts[0]?.protocol).toBe(ProtocolType.SSH)
      expect(saved.id).toBeTruthy()
    })

    it('updates a host without duplicating it', () => {
      const saved = storage.hosts.save({
        name: 'prod',
        protocol: ProtocolType.SSH,
        host: 'example.com',
        port: 22,
        username: 'root',
        authMethod: AuthMethod.PASSWORD
      })

      storage.hosts.save({ ...saved, name: 'prod-2' })

      const hosts = storage.hosts.list()
      expect(hosts).toHaveLength(1)
      expect(hosts[0]?.name).toBe('prod-2')
    })

    it('soft-deletes a host', () => {
      const saved = storage.hosts.save({
        name: 'gone',
        protocol: ProtocolType.SSH,
        host: 'example.com',
        port: 22,
        username: 'root',
        authMethod: AuthMethod.PASSWORD
      })

      storage.hosts.remove(saved.id)

      expect(storage.hosts.list()).toEqual([])
      expect(storage.hosts.list(true)).toHaveLength(1)
      expect(storage.hosts.list(true)[0]?.deletedAt).toBeTruthy()
    })

    it('keeps the group and notes', () => {
      storage.hosts.save({
        name: 'prod',
        protocol: ProtocolType.SSH,
        host: 'example.com',
        port: 22,
        username: 'root',
        authMethod: AuthMethod.PASSWORD,
        group: 'work',
        notes: 'the main one'
      })

      const host = storage.hosts.list()[0]
      expect(host?.group).toBe('work')
      expect(host?.notes).toBe('the main one')
    })
  })

  describe('keys', () => {
    it('saves and reads a key back', async () => {
      const key = {
        id: 'key-1',
        name: 'deploy',
        type: KeyType.ED25519,
        fingerprint: 'SHA256:abc',
        publicKey: 'ssh-ed25519 AAAA test',
        encryptedPrivateKey: 'encrypted',
        privateKeyFormat: 'openssh',
        hasPassphrase: false,
        comment: 'test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
        version: 1,
        deviceId: 'test-device'
      }

      await storage.keys.save(key)
      const keys = await storage.keys.list()

      expect(keys).toHaveLength(1)
      expect(keys[0]?.name).toBe('deploy')
      expect(keys[0]?.encryptedPrivateKey).toBe('encrypted')
    })

    it('soft-deletes a key', async () => {
      const now = new Date().toISOString()
      await storage.keys.save({
        id: 'key-1',
        name: 'deploy',
        type: KeyType.ED25519,
        fingerprint: 'SHA256:abc',
        publicKey: 'ssh-ed25519 AAAA test',
        encryptedPrivateKey: 'encrypted',
        privateKeyFormat: 'openssh',
        hasPassphrase: false,
        comment: '',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        version: 1,
        deviceId: 'test-device'
      })

      await storage.keys.remove('key-1')
      expect(await storage.keys.list()).toEqual([])
    })
  })

  describe('tabs', () => {
    it('saves and restores the layout', async () => {
      const tab = {
        id: 'tab-1',
        kind: TabKind.SSH,
        title: 'tester@example.com',
        hostId: null,
        connection: { host: 'example.com', port: 22, username: 'tester' },
        buffer: 'hello',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
        version: 1,
        deviceId: 'test-device'
      }

      await storage.tabs.save({ tabs: [tab], activeTabId: 'tab-1' })
      const snapshot = await storage.tabs.load()

      expect(snapshot.tabs).toHaveLength(1)
      expect(snapshot.tabs[0]?.title).toBe('tester@example.com')
      expect(snapshot.tabs[0]?.connection?.host).toBe('example.com')
      expect(snapshot.activeTabId).toBe('tab-1')
    })

    it('remembers the active tab across saves', async () => {
      const tab = {
        id: 'tab-1',
        kind: TabKind.SSH,
        title: 'one',
        hostId: null,
        connection: null,
        buffer: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
        version: 1,
        deviceId: 'test-device'
      }

      await storage.tabs.save({ tabs: [tab], activeTabId: 'tab-1' })
      await storage.tabs.save({ tabs: [tab], activeTabId: null })

      const snapshot = await storage.tabs.load()
      expect(snapshot.activeTabId).toBe('')
    })

    it('soft-deletes a tab that was closed in the layout', async () => {
      const tab = {
        id: 'tab-1',
        kind: TabKind.SSH,
        title: 'one',
        hostId: null,
        connection: null,
        buffer: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
        version: 1,
        deviceId: 'test-device'
      }

      await storage.tabs.save({ tabs: [tab], activeTabId: 'tab-1' })
      expect((await storage.tabs.load()).tabs).toHaveLength(1)

      // The tab was closed in the UI: the layout no longer contains it.
      await storage.tabs.save({ tabs: [], activeTabId: null })

      const snapshot = await storage.tabs.load()
      expect(snapshot.tabs).toHaveLength(0)
    })

    it('survives a restart of the service', async () => {
      const tab = {
        id: 'tab-1',
        kind: TabKind.SSH,
        title: 'persisted',
        hostId: null,
        connection: null,
        buffer: 'buffer',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
        version: 1,
        deviceId: 'test-device'
      }

      await storage.tabs.save({ tabs: [tab], activeTabId: 'tab-1' })
      storage.close()

      const reopened = new Storage(join(dir, 'reliquary.db'), () => 'test-device')
      const snapshot = await reopened.tabs.load()
      reopened.close()

      expect(snapshot.tabs).toHaveLength(1)
      expect(snapshot.tabs[0]?.title).toBe('persisted')
    })
  })

  describe('outbox', () => {
    it('starts with no pending changes', () => {
      expect(storage.changes.count()).toBe(0)
    })

    it('records a change', () => {
      storage.changes.record({
        id: 'change-1',
        entity: 'hosts',
        entityId: 'host-1',
        operation: 'upsert',
        payload: '{}',
        synced: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
        deviceId: 'test-device'
      })

      expect(storage.changes.count()).toBe(1)
      expect(storage.changes.pending()).toHaveLength(1)
    })

    it('marks changes as synced', () => {
      storage.changes.record({
        id: 'change-1',
        entity: 'hosts',
        entityId: 'host-1',
        operation: 'upsert',
        payload: '{}',
        synced: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
        deviceId: 'test-device'
      })

      storage.changes.markSynced(['change-1'])

      expect(storage.changes.count()).toBe(0)
      expect(storage.changes.pending()).toHaveLength(0)
    })

    it('returns the pending changes oldest first', () => {
      const base = Date.now()
      for (let index = 0; index < 3; index++) {
        storage.changes.record({
          id: `change-${index}`,
          entity: 'hosts',
          entityId: `host-${index}`,
          operation: 'upsert',
          payload: '{}',
          synced: false,
          createdAt: new Date(base + index).toISOString(),
          updatedAt: new Date(base + index).toISOString(),
          version: 1,
          deviceId: 'test-device'
        })
      }

      const pending = storage.changes.pending()
      expect(pending.map((change) => change.id)).toEqual([
        'change-0',
        'change-1',
        'change-2'
      ])
    })
  })

  describe('schema', () => {
    it('creates every table of the sync contract', () => {
      const tables = storage.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[]
      const names = tables.map((table) => table.name)

      expect(names).toContain('hosts')
      expect(names).toContain('keys')
      expect(names).toContain('tabs')
      expect(names).toContain('settings')
      expect(names).toContain('changes')
      expect(names).toContain('meta')
    })

    it('stores the schema version', () => {
      const row = storage.db
        .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
        .get() as { value: string }
      expect(Number(row.value)).toBeGreaterThan(0)
    })

    it('is idempotent — reopening does not fail', () => {
      storage.close()
      const reopened = new Storage(join(dir, 'reliquary.db'), () => 'test-device')
      expect(reopened.hosts.list()).toEqual([])
      reopened.close()
    })
  })
})
