/**
 * E2EE sync engine.
 *
 * Push: every entity with a pending change is encrypted with the master key
 * and uploaded as an opaque blob. Pull: the remote replicas are decrypted,
 * merged with last-write-wins on (version, updatedAt) and written into the
 * local database. The backend never sees plaintext and cannot decrypt
 * anything.
 *
 * The engine lives in the main process: it touches SQLite and the master
 * key, neither of which the renderer is allowed to see.
 */
import type { ChangeRecord, SyncBlob } from '@shared/types'
import {
  KDF_ENTITY,
  entryToBlob,
  isRemoteNewer,
  type KeyPayload,
  type HostPayload,
  type SyncEntry,
  type SyncMasterParams,
  type SyncResult,
  type SyncStatus,
  type SyncVector
} from '@shared/sync'
import type { MasterPasswordManager } from './master-password'
import type { MasterKeyMaterial } from './crypto'
import type { Storage } from './storage'
import { logger } from './logger'
import {
  createKdfEntry,
  decryptSyncPayload,
  encryptSyncPayload,
  isKdfEntry,
  readKdfEntry
} from './sync-crypto'

/** The part of the backend client the engine needs. */
export interface SyncBackend {
  isSignedIn(): boolean
  readonly serverUrl: string
  pushEntries(entries: SyncEntry[]): Promise<number>
  pullEntries(entity?: string): Promise<SyncEntry[]>
}

/** Outcome of a pull, including the entries that could not be read. */
interface PullResult {
  pulled: number
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
    private readonly backend: SyncBackend,
    private readonly deviceId: () => string
  ) {}

  /** The state the renderer shows. */
  status(): SyncStatus {
    return {
      signedIn: this.backend.isSignedIn(),
      configured: this.master.has(),
      unlocked: this.master.unlocked,
      pending: this.storage.changes.count(),
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError
    }
  }

  /** True when the signed-in account already carries PBKDF2 parameters. */
  async hasRemoteKdf(): Promise<boolean> {
    if (!this.backend.isSignedIn()) return false
    try {
      return (await this.fetchKdfParams()) !== null
    } catch {
      return false
    }
  }

  /** Reads the PBKDF2 parameters of the account from the backend. */
  async fetchKdfParams(): Promise<SyncMasterParams | null> {
    const entries = await this.backend.pullEntries(KDF_ENTITY)
    for (const entry of entries) {
      const params = readKdfEntry(entry)
      if (params) return params
    }
    return null
  }

  /**
   * The KDF entry this device may push.
   *
   * The parameters belong to the account, not to a device: a device that
   * holds a different salt (a wrong master password) must not overwrite
   * the account's one, otherwise the other devices would lose access to
   * their own data.
   */
  private async kdfEntryForPush(
    params: SyncMasterParams,
    deviceId: string
  ): Promise<SyncEntry | null> {
    try {
      const remote = await this.fetchKdfParams()
      if (remote && (remote.salt !== params.salt || remote.iterations !== params.iterations)) {
        return null
      }
    } catch {
      // Offline or an old backend without the setting: the upsert is
      // idempotent, so pushing is safe.
    }

    return createKdfEntry(params, deviceId)
  }

  /** Encrypts and pushes every pending change plus the KDF parameters. */
  async push(): Promise<number> {
    const material = this.requireMaterial()
    const pending = this.storage.changes.pending(1000)

    // Only the newest change of an entity matters: the row itself is the
    // state, the journal entries are just triggers.
    const latest = new Map<string, ChangeRecord>()
    for (const change of pending) latest.set(`${change.entity}:${change.entityId}`, change)

    const deviceId = this.deviceId()
    const entries: SyncEntry[] = []

    const params = this.master.getParams()
    const kdf = params ? await this.kdfEntryForPush(params, deviceId) : null
    if (kdf) entries.push(kdf)

    for (const change of latest.values()) {
      const entry = await this.entryFor(change.entity, change.entityId, material, deviceId)
      if (entry) entries.push(entry)
    }

    const accepted = entries.length > 0 ? await this.backend.pushEntries(entries) : 0

    // Only after the backend accepted them — a failed push leaves the
    // journal intact so the next run retries.
    this.storage.changes.markSynced(pending.map((change) => change.id))
    logger.info(`Sync pushed ${accepted} entries`, { pending: pending.length })
    return accepted
  }

  /** Pulls, decrypts and applies the remote replicas. */
  async pull(): Promise<PullResult> {
    const material = this.requireMaterial()
    const remote = await this.backend.pullEntries()

    // One winner per entity: the backend keeps a replica per device, the
    // merged state is the newest of them.
    const winners = new Map<string, SyncEntry>()
    for (const entry of remote) {
      if (isKdfEntry(entry)) continue

      const key = `${entry.entity}:${entry.entityId}`
      const current = winners.get(key)
      if (!current || isRemoteNewer(current, entry)) winners.set(key, entry)
    }

    const result: PullResult = {
      pulled: remote.length,
      applied: 0,
      skipped: 0,
      conflicts: 0,
      undecryptable: 0
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
        // The entry was encrypted with another key — the master password of
        // this device is not the one the account uses.
        result.undecryptable++
        continue
      }

      let applied: boolean
      try {
        applied = await this.apply(entry, plaintext)
      } catch {
        result.undecryptable++
        continue
      }

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

    logger.info('Sync pull finished', {
      pulled: result.pulled,
      applied: result.applied,
      skipped: result.skipped,
      conflicts: result.conflicts,
      undecryptable: result.undecryptable
    })

    return result
  }

  /** Push, then pull. Both halves require an unlocked master password. */
  async syncNow(): Promise<SyncResult> {
    if (!this.backend.isSignedIn()) throw new Error('Sign in to sync your data')
    this.requireMaterial()
    if (this.running) throw new Error('A sync is already running')

    this.running = true
    try {
      const pushed = await this.push()
      const pulled = await this.pull()

      const syncedAt = new Date().toISOString()
      this.lastSyncAt = syncedAt
      if (pulled.undecryptable === 0) this.lastError = null

      return {
        pushed,
        pulled: pulled.pulled,
        applied: pulled.applied,
        skipped: pulled.skipped,
        conflicts: pulled.conflicts,
        syncedAt
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      logger.error('Sync failed', error instanceof Error ? error.stack : String(error))
      throw error
    } finally {
      this.running = false
    }
  }

  /** Forgets the remembered result — used when signing out. */
  reset(): void {
    this.lastSyncAt = null
    this.lastError = null
  }

  /** The encrypted entry of one local row, or null when it is gone. */
  private async entryFor(
    entity: string,
    entityId: string,
    material: MasterKeyMaterial,
    deviceId: string
  ): Promise<SyncEntry | null> {
    if (entity === 'hosts') {
      const host = this.storage.hosts.get(entityId)
      if (!host) return null

      const payload: HostPayload = { kind: 'host', host: { ...host, deviceId } }
      return this.seal('hosts', entityId, host, JSON.stringify(payload), material, deviceId)
    }

    if (entity === 'keys') {
      const key = await this.storage.keys.get(entityId)
      if (!key) return null

      // The private part is already encrypted with the master key; the
      // whole row is encrypted again for the wire.
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
      const host = this.storage.hosts.get(entry.entityId)
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
