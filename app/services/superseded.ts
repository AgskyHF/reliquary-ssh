/**
 * The superseded versions.
 *
 * When two copies of a connection meet and one of them is older, the older
 * one is not thrown away: it is stored here and travels with the export.
 * The user may still need the old password, and a silent overwrite is the
 * one thing that must never happen.
 */
import type { SqliteDatabase } from './database'

/** Why a version was superseded. */
export type SupersedeReason = 'newer' | 'deleted'

/** One version that lost a merge. */
export interface SupersededConnection {
  id: string
  /** The host the version belonged to. */
  hostId: string
  /** The whole record as JSON — the host and its encrypted password. */
  payload: string
  /** When it was replaced. */
  replacedAt: string
  /** The id of the version that won. */
  replacedBy: string
  reason: SupersedeReason
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  version: number
  deviceId: string
}

interface SupersededRow {
  id: string
  host_id: string
  payload: string
  replaced_at: string
  replaced_by: string
  reason: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  version: number
  device_id: string
}

function rowToSuperseded(row: SupersededRow): SupersededConnection {
  return {
    id: row.id,
    hostId: row.host_id,
    payload: row.payload,
    replacedAt: row.replaced_at,
    replacedBy: row.replaced_by,
    reason: row.reason as SupersedeReason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    version: row.version,
    deviceId: row.device_id
  }
}

export class SupersededRepository {
  constructor(private readonly db: SqliteDatabase) {}

  /** All superseded versions, newest first. */
  list(): SupersededConnection[] {
    const rows = this.db
      .prepare('SELECT * FROM superseded_connections WHERE deleted_at IS NULL ORDER BY replaced_at DESC')
      .all() as SupersededRow[]

    return rows.map(rowToSuperseded)
  }

  /** The superseded versions of one host. */
  listForHost(hostId: string): SupersededConnection[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM superseded_connections WHERE host_id = ? AND deleted_at IS NULL ORDER BY replaced_at DESC'
      )
      .all(hostId) as SupersededRow[]

    return rows.map(rowToSuperseded)
  }

  /** Stores a version that lost a merge. */
  record(params: {
    hostId: string
    payload: unknown
    replacedBy: string
    reason: SupersedeReason
    deviceId?: string
    replacedAt?: string
  }): SupersededConnection {
    const now = new Date().toISOString()

    const record: SupersededConnection = {
      id: crypto.randomUUID(),
      hostId: params.hostId,
      payload: JSON.stringify(params.payload),
      replacedAt: params.replacedAt ?? now,
      replacedBy: params.replacedBy,
      reason: params.reason,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1,
      deviceId: params.deviceId ?? ''
    }

    this.db
      .prepare(
        `INSERT INTO superseded_connections (id, host_id, payload, replaced_at, replaced_by,
           reason, created_at, updated_at, deleted_at, version, device_id)
         VALUES (@id, @host_id, @payload, @replaced_at, @replaced_by, @reason,
           @created_at, @updated_at, NULL, @version, @device_id)`
      )
      .run({
        id: record.id,
        host_id: record.hostId,
        payload: record.payload,
        replaced_at: record.replacedAt,
        replaced_by: record.replacedBy,
        reason: record.reason,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
        version: record.version,
        device_id: record.deviceId
      })

    return record
  }

  /** Removes a superseded version — the user said it is not needed. */
  remove(id: string): void {
    const now = new Date().toISOString()
    this.db
      .prepare(
        'UPDATE superseded_connections SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ?'
      )
      .run(now, now, id)
  }

  /** The number of stored versions. */
  count(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS total FROM superseded_connections WHERE deleted_at IS NULL')
      .get() as { total: number }
    return row.total
  }
}
