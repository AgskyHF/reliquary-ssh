/**
 * The replicas this device knows.
 *
 * A replica is one encrypted copy of one entity, produced by one device.
 * The device that made it stores it here; the devices that read a sync
 * file store the replicas it carried too, so a file can be passed along a
 * chain of devices and nobody loses anything.
 *
 * The replicas are the payload of the sync file. They hold ciphertext only
 * — the master key never leaves the device that has it.
 */
import type { SqliteDatabase } from './database'
import type { SyncEntry, SyncEntity } from '@shared/sync'

/** One row of the sync_replicas table. */
interface ReplicaRow {
  entity: string
  entity_id: string
  device_id: string
  version: number
  iv: string
  ciphertext: string
  tag: string
  updated_at: string
  deleted_at: string | null
}

function rowToEntry(row: ReplicaRow): SyncEntry {
  return {
    entity: row.entity as SyncEntity,
    entityId: row.entity_id,
    version: row.version,
    iv: row.iv,
    ciphertext: row.ciphertext,
    tag: row.tag,
    deviceId: row.device_id,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  }
}

export class ReplicaRepository {
  constructor(private readonly db: SqliteDatabase) {}

  /** Every replica this device knows. */
  list(): SyncEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM sync_replicas')
      .all() as ReplicaRow[]
    return rows.map(rowToEntry)
  }

  /** The replicas of one entity, whatever device produced them. */
  listFor(entity: SyncEntity, entityId: string): SyncEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM sync_replicas WHERE entity = ? AND entity_id = ?')
      .all(entity, entityId) as ReplicaRow[]
    return rows.map(rowToEntry)
  }

  /**
   * Stores a replica.
   *
   * The replica is keyed by (entity, entityId, deviceId), so a device
   * never overwrites the replica of another one — the merge happens on
   * the client, not here.
   */
  save(entry: SyncEntry): void {
    const now = new Date().toISOString()

    this.db
      .prepare(
        `INSERT INTO sync_replicas (entity, entity_id, device_id, version, iv, ciphertext,
           tag, updated_at, deleted_at, created_at)
         VALUES (@entity, @entity_id, @device_id, @version, @iv, @ciphertext,
           @tag, @updated_at, @deleted_at, @created_at)
         ON CONFLICT(entity, entity_id, device_id) DO UPDATE SET
           version = excluded.version, iv = excluded.iv,
           ciphertext = excluded.ciphertext, tag = excluded.tag,
           updated_at = excluded.updated_at, deleted_at = excluded.deleted_at`
      )
      .run({
        entity: entry.entity,
        entity_id: entry.entityId,
        device_id: entry.deviceId,
        version: entry.version,
        iv: entry.iv,
        ciphertext: entry.ciphertext,
        tag: entry.tag,
        updated_at: entry.updatedAt,
        deleted_at: entry.deletedAt,
        created_at: now
      })
  }

  /** Stores many replicas at once. */
  saveAll(entries: SyncEntry[]): void {
    const run = this.db.transaction((list: SyncEntry[]) => {
      for (const entry of list) this.save(entry)
    })
    run(entries)
  }

  /** How many replicas this device knows. */
  count(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS total FROM sync_replicas')
      .get() as { total: number }
    return row.total
  }

  /** Removes the replicas of an entity — used when a row is gone. */
  remove(entity: SyncEntity, entityId: string): void {
    this.db
      .prepare('DELETE FROM sync_replicas WHERE entity = ? AND entity_id = ?')
      .run(entity, entityId)
  }
}
