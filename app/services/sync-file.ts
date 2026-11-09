/**
 * The E2EE sync engine — file based.
 *
 * There is no server and no account: the user carries one file between the
 * devices himself. The file holds encrypted blobs only, so a device that
 * reads it learns nothing without the master password.
 *
 * How a device takes part:
 *  1. it writes a replica of every changed entity into its own replica
 *     table (the file is the payload of that table);
 *  2. the user exports a bundle — the file goes out;
 *  3. on the other device the user imports the file — the replicas it
 *     carries are merged into the local database.
 *
 * The replicas of the devices that came in with a file are kept too, so a
 * file can travel along a chain of devices without losing anything.
 *
 * The engine lives in the main process: it touches SQLite and the master
 * key, neither of which the renderer is allowed to see.
 */
import type { ChangeRecord, SyncBlob } from '@shared/types'
import {
  SYNC_FILE_FORMAT,
  SYNC_FILE_VERSION,
  entryToBlob,
  isRemoteNewer,
  parseSyncBundle,
  type HostPayload,
  type KeyPayload,
  type SyncBundle,
  type SyncEntry,
  type SyncMasterParams,
  type SyncResult,
  type SyncStatus,
  type SyncVector
} from '@shared/sync'
import type { MasterPasswordManager } from './master-password'
import type { MasterKeyMaterial } from './crypto'
import type { Storage } from './storage'
import type { ReplicaRepository } from './sync-replicas'
import { logger } from './logger'
import { decryptSyncPayload, encryptSyncPayload } from './sync-crypto'

/** Outcome of an import, including the entries that could not be read. */
interface PullResult {
  imported: number
  applied: number
  skipped: number
  conflicts: number
  undecryptable: number
}

export class SyncService {
  private lastSyncAt: string | null = null
  private lastError: string | null = null
  private running = false

  constructor(
    private readonly storage: Storage,
    private readonly master: MasterPasswordManager,
    private readonly replicas: ReplicaRepository,
    private readonly deviceId: () => string
  ) {}

  /** The state the renderer shows. */
  status(): SyncStatus {
    return {
      configured: this.master.has(),
      unlocked: this.master.unlocked,
      pending: this.storage.changes.count(),
      replicas: this.replicas.count(),
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError
    }
  }

  /**
   * Builds the bundle the user carries to the other devices.
   *
   * The local changes are sealed into replicas first — those are the ones
   * that were made here. The replicas that came in with an earlier file
   * travel along, so a chain of devices works.
   */
  async exportBundle(): Promise<SyncBundle> {
    const material = this.requireMaterial()
    const deviceId = this.deviceId()

    // Seal the pending changes into replicas of this device.
    const pending = this.storage.changes.pending(1000)
    const latest = new Map<string, ChangeRecord>()
    for (const change of pending) latest.set(`${change.entity}:${change.entityId}`, change)

    const sealed: SyncEntry[] = []
    for (const change of latest.values()) {
      const entry = await this.entryFor(change.entity, change.entityId, material, deviceId)
      if (entry) sealed.push(entry)
    }

    if (sealed.length > 0) this.replicas.saveAll(sealed)

    // The bundle carries every replica this device knows.
    const entries = this.replicas.list()

    const params = this.master.getParams()
    const bundle: SyncBundle = {
      format: SYNC_FILE_FORMAT,
      version: SYNC_FILE_VERSION,
      exportedAt: new Date().toISOString(),
      deviceId,
      kdf: params,
      entries
    }

    // The changes are in the file now — the journal is clean.
    this.storage.changes.markSynced(pending.map((change) => change.id))

    logger.info('The sync bundle was made', { replicas: entries.length })
    return bundle
  }

  /**
   * Reads a bundle the user picked.
   *
   * The master password is not needed to read the file: the records are
   * kept as they are, encrypted. They are applied to the database when
   * the master password is set — that is the moment the key of this
   * device becomes the key of the file.
   */
  async importBundle(text: string): Promise<SyncResult> {
    if (this.running) throw new Error('A sync is already running')

    this.running = true
    try {
      const bundle = parseSyncBundle(text)
      const material = this.master.getMasterKey()
      const pulled = await this.applyBundle(bundle, material)

      const syncedAt = new Date().toISOString()
      this.lastSyncAt = syncedAt
      if (pulled.undecryptable === 0) this.lastError = null

      logger.info('The sync bundle was read', pulled)
      return {
        exported: 0,
        imported: pulled.imported,
        applied: pulled.applied,
        skipped: pulled.skipped,
        conflicts: pulled.conflicts,
        undecryptable: pulled.undecryptable,
        syncedAt
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      logger.error('The sync bundle could not be read', error instanceof Error ? error.stack : '')
      throw error
    } finally {
      this.running = false
    }
  }

  /**
   * Applies the records this device knows.
   *
   * It runs right after the master password was set: the records that
   * came in with a file were waiting for the key.
   */
  async applyReplicas(): Promise<SyncResult> {
    const material = this.requireMaterial()

    const bundle: SyncBundle = {
      format: SYNC_FILE_FORMAT,
      version: SYNC_FILE_VERSION,
      exportedAt: '',
      deviceId: this.deviceId(),
      kdf: this.master.getParams(),
      entries: this.replicas.list()
    }

    const pulled = await this.applyBundle(bundle, material)
    const syncedAt = new Date().toISOString()
    this.lastSyncAt = syncedAt

    return {
      exported: 0,
      imported: pulled.imported,
      applied: pulled.applied,
      skipped: pulled.skipped,
      conflicts: pulled.conflicts,
      undecryptable: pulled.undecryptable,
      syncedAt
    }
  }

  /** Merges the replicas of a bundle into the local database. */
  private async applyBundle(
    bundle: SyncBundle,
    material: MasterKeyMaterial | null
  ): Promise<PullResult> {
    const result: PullResult = {
      imported: bundle.entries.length,
      applied: 0,
      skipped: 0,
      conflicts: 0,
      undecryptable: 0
    }

    // The salt of the account: a device that has no master password yet
    // adopts it, so the same password derives the same key there.
    if (bundle.kdf) this.adoptKdf(bundle.kdf)

    // Without a master password the records are only kept — they are
    // applied when the user sets the master password.
    if (!material) {
      this.replicas.saveAll(bundle.entries)
      return result
    }

    // One winner per entity: the replicas of the different devices are
    // merged with last-write-wins.
    const winners = new Map<string, SyncEntry>()
    for (const entry of bundle.entries) {
      if (entry.entity === 'settings') continue

      const key = `${entry.entity}:${entry.entityId}`
      const current = winners.get(key)
      if (!current || isRemoteNewer(current, entry)) winners.set(key, entry)
    }

    for (const entry of winners.values()) {
      const local = await this.localVector(entry)
      if (!isRemoteNewer(local, entry)) {
        result.skipped++
        continue
      }

      let plaintext: string
      try {
        plaintext = decryptSyncPayload(entryToBlob(entry), material)
      } catch {
        // The replica was encrypted with another key — the master password
        // of this device is not the one of the account.
        result.undecryptable++
        continue
      }

      // The replica is kept even when it lost the merge: it belongs to
      // another device and has to travel on.
      this.replicas.save(entry)

      const applied = await this.apply(entry, plaintext)
      if (applied) {
        result.applied++
        if (local) result.conflicts++
      } else {
        result.skipped++
      }
    }

    if (result.undecryptable > 0) {
      this.lastError =
        'Some entries could not be decrypted. Use the master password of the account.'
    }

    return result
  }

  /**
   * Adopts the PBKDF2 parameters of a bundle.
   *
   * The salt belongs to the account, not to the device: it is stored, so
   * the master password the user enters derives the same key as on the
   * device that made the file.
   */
  private adoptKdf(kdf: SyncMasterParams): void {
    if (this.master.has()) return
    this.storage.settings.set('importedKdf', JSON.stringify(kdf))
  }

  /** The encrypted entry of one local row, or null when it is gone. */
  private async entryFor(
    entity: string,
    entityId: string,
    material: MasterKeyMaterial,
    deviceId: string
  ): Promise<SyncEntry | null> {
    if (entity === 'hosts') {
      // A deleted host is a tombstone — it has to travel with the file,
      // otherwise the other device would keep a host the user removed.
      const host = this.storage.hosts.getIncludingDeleted(entityId)
      if (!host) return null

      // The password travels with the host: it is already sealed with the
      // master key, so it stays readable on the other device.
      const password = this.storage.passwords.get(entityId)
      const payload: HostPayload = {
        kind: 'host',
        host: { ...host, deviceId },
        encryptedPassword: password?.encryptedPassword ?? null
      }

      return this.seal('hosts', entityId, host, JSON.stringify(payload), material, deviceId)
    }

    if (entity === 'keys') {
      const key = await this.storage.keys.get(entityId)
      if (!key) return null

      // The private part is already encrypted with the master key; the
      // whole row is encrypted again for the file.
      const payload: KeyPayload = { kind: 'key', key: { ...key, deviceId } }
      return this.seal('keys', entityId, key, JSON.stringify(payload), material, deviceId)
    }

    return null
  }

  private seal(
    entity: 'hosts' | 'keys',
    entityId: string,
    row: SyncVector & { deletedAt: string | null },
    plaintext: string,
    material: MasterKeyMaterial,
    deviceId: string
  ): SyncEntry {
    const blob: SyncBlob = encryptSyncPayload(plaintext, material, row.updatedAt)
    return {
      entity,
      entityId,
      version: row.version,
      iv: blob.iv,
      ciphertext: blob.ciphertext,
      tag: blob.tag,
      deviceId,
      updatedAt: blob.updated_at,
      deletedAt: row.deletedAt
    }
  }

  /** Writes a decrypted remote row into the local database. */
  private async apply(entry: SyncEntry, plaintext: string): Promise<boolean> {
    const parsed = JSON.parse(plaintext) as HostPayload | KeyPayload
    const deviceId = this.deviceId()

    if (parsed.kind === 'host' && entry.entity === 'hosts') {
      this.storage.hosts.save({
        ...parsed.host,
        deviceId,
        version: entry.version,
        updatedAt: entry.updatedAt,
        deletedAt: entry.deletedAt ?? parsed.host.deletedAt
      })

      // The password came with the host — it is kept as it is, so it opens
      // with the master password of the account.
      if (parsed.encryptedPassword) {
        this.storage.passwords.saveSealed(parsed.host.id, parsed.encryptedPassword, deviceId)
      }

      return true
    }

    if (parsed.kind === 'key' && entry.entity === 'keys') {
      await this.storage.keys.save({
        ...parsed.key,
        deviceId,
        version: entry.version,
        updatedAt: entry.updatedAt,
        deletedAt: entry.deletedAt ?? parsed.key.deletedAt
      })
      return true
    }

    return false
  }

  /** The version vector of the local row, or null when it is unknown. */
  private async localVector(entry: SyncEntry): Promise<SyncVector | null> {
    if (entry.entity === 'hosts') {
      const host = this.storage.hosts.getIncludingDeleted(entry.entityId)
      return host ? { version: host.version, updatedAt: host.updatedAt } : null
    }

    if (entry.entity === 'keys') {
      const key = await this.storage.keys.get(entry.entityId)
      return key ? { version: key.version, updatedAt: key.updatedAt } : null
    }

    return null
  }

  /** The master key material, or a readable error when locked. */
  private requireMaterial(): MasterKeyMaterial {
    const material = this.master.getMasterKey()
    if (!material) {
      throw new Error('The master password is locked — unlock it to sync')
    }
    return material
  }
}
