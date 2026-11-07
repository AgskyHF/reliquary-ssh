/**
 * The saved passwords of the hosts.
 *
 * A password is stored the same way a private key is: wrapped in the
 * master-password envelope. The plaintext exists only while the master
 * password is unlocked, and it never reaches the renderer.
 *
 * The password belongs to the host, not to the session — the session keeps
 * using the value the user typed.
 */
import type { SqliteDatabase } from './database'
import { decryptWithMasterKey, encryptWithMasterKey, type MasterKeyMaterial } from './crypto'

/** A stored password. */
export interface HostPassword {
  id: string
  hostId: string
  /** The master-password envelope. */
  encryptedPassword: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  version: number
  deviceId: string
}

interface HostPasswordRow {
  id: string
  host_id: string
  encrypted_password: string
  has_passphrase: number
  created_at: string
  updated_at: string
  deleted_at: string | null
  version: number
  device_id: string
}

function rowToPassword(row: HostPasswordRow): HostPassword {
  return {
    id: row.id,
    hostId: row.host_id,
    encryptedPassword: row.encrypted_password,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    version: row.version,
    deviceId: row.device_id
  }
}

export class HostPasswordRepository {
  constructor(private readonly db: SqliteDatabase) {}

  /** The stored password of a host, or null. */
  get(hostId: string): HostPassword | null {
    const row = this.db
      .prepare('SELECT * FROM host_passwords WHERE host_id = ? AND deleted_at IS NULL')
      .get(hostId) as HostPasswordRow | undefined

    return row ? rowToPassword(row) : null
  }

  /** All stored passwords. */
  list(): HostPassword[] {
    const rows = this.db
      .prepare('SELECT * FROM host_passwords WHERE deleted_at IS NULL')
      .all() as HostPasswordRow[]

    return rows.map(rowToPassword)
  }

  /** True when the host has a stored password. */
  has(hostId: string): boolean {
    return this.get(hostId) !== null
  }

  /** Stores the password of a host, encrypted with the master key. */
  save(hostId: string, password: string, material: MasterKeyMaterial, deviceId = ''): HostPassword {
    const now = new Date().toISOString()
    const existing = this.get(hostId)

    const record: HostPassword = {
      id: existing?.id ?? crypto.randomUUID(),
      hostId,
      encryptedPassword: encryptWithMasterKey(password, material),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      deletedAt: null,
      version: (existing?.version ?? 0) + 1,
      deviceId
    }

    this.db
      .prepare(
        `INSERT INTO host_passwords (id, host_id, encrypted_password, has_passphrase,
           created_at, updated_at, deleted_at, version, device_id)
         VALUES (@id, @host_id, @encrypted_password, 0, @created_at, @updated_at, NULL,
           @version, @device_id)
         ON CONFLICT(id) DO UPDATE SET
           encrypted_password = excluded.encrypted_password,
           updated_at = excluded.updated_at, version = excluded.version`
      )
      .run({
        id: record.id,
        host_id: record.hostId,
        encrypted_password: record.encryptedPassword,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
        version: record.version,
        device_id: record.deviceId
      })

    return record
  }

  /**
   * Stores the sealed password of a host as it is.
   *
   * The envelope was made with another master key, so it cannot be read
   * here yet — but it is kept, and it opens as soon as the user enters
   * the master password of the account.
   */
  saveSealed(hostId: string, envelope: string, deviceId = ''): HostPassword {
    const now = new Date().toISOString()
    const existing = this.get(hostId)

    const record: HostPassword = {
      id: existing?.id ?? crypto.randomUUID(),
      hostId,
      encryptedPassword: envelope,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      deletedAt: null,
      version: (existing?.version ?? 0) + 1,
      deviceId
    }

    this.db
      .prepare(
        `INSERT INTO host_passwords (id, host_id, encrypted_password, has_passphrase,
           created_at, updated_at, deleted_at, version, device_id)
         VALUES (@id, @host_id, @encrypted_password, 0, @created_at, @updated_at, NULL,
           @version, @device_id)
         ON CONFLICT(id) DO UPDATE SET
           encrypted_password = excluded.encrypted_password,
           updated_at = excluded.updated_at, version = excluded.version`
      )
      .run({
        id: record.id,
        host_id: record.hostId,
        encrypted_password: record.encryptedPassword,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
        version: record.version,
        device_id: record.deviceId
      })

    return record
  }

  /** Removes the stored password of a host. */
  remove(hostId: string): void {
    const now = new Date().toISOString()
    this.db
      .prepare(
        'UPDATE host_passwords SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE host_id = ?'
      )
      .run(now, now, hostId)
  }

  /** The decrypted password of a host, or null when it is not stored. */
  reveal(hostId: string, material: MasterKeyMaterial): string | null {
    const record = this.get(hostId)
    if (!record) return null

    try {
      return decryptWithMasterKey(record.encryptedPassword, material)
    } catch {
      // The master key does not match — the password stays locked.
      return null
    }
  }
}
