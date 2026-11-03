/**
 * Backend database and repositories.
 */
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { SERVER_SCHEMA_STATEMENTS, SERVER_SCHEMA_VERSION } from './schema.ts'

export type ServerDatabase = Database.Database

export interface User {
  id: string
  email: string
  passwordHash: string | null
  provider: 'google' | 'email'
  providerId: string | null
  createdAt: string
  updatedAt: string
}

/** The encrypted payload the client sends. The server never sees plaintext. */
export interface SyncEntry {
  id: string
  userId: string
  deviceId: string
  entity: string
  entityId: string
  version: number
  iv: string
  ciphertext: string
  tag: string
  updatedAt: string
  deletedAt: string | null
}

export function openServerDatabase(filePath: string): ServerDatabase {
  mkdirSync(dirname(filePath), { recursive: true })

  const db = new Database(filePath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  for (const statement of SERVER_SCHEMA_STATEMENTS) {
    db.exec(statement)
  }

  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
    'schema_version',
    String(SERVER_SCHEMA_VERSION)
  )

  return db
}

interface UserRow {
  id: string
  email: string
  password_hash: string | null
  provider: string
  provider_id: string | null
  created_at: string
  updated_at: string
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    provider: row.provider as User['provider'],
    providerId: row.provider_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/** Users table. */
export class UserRepository {
  private readonly db: ServerDatabase

  constructor(db: ServerDatabase) {
    this.db = db
  }

  findByEmail(email: string): User | null {
    const row = this.db
      .prepare('SELECT * FROM users WHERE email = ?')
      .get(email.toLowerCase()) as UserRow | undefined
    return row ? rowToUser(row) : null
  }

  findById(id: string): User | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
    return row ? rowToUser(row) : null
  }

  findByProvider(provider: string, providerId: string): User | null {
    const row = this.db
      .prepare('SELECT * FROM users WHERE provider = ? AND provider_id = ?')
      .get(provider, providerId) as UserRow | undefined
    return row ? rowToUser(row) : null
  }

  create(user: User): User {
    this.db
      .prepare(
        `INSERT INTO users (id, email, password_hash, provider, provider_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        user.id,
        user.email.toLowerCase(),
        user.passwordHash,
        user.provider,
        user.providerId,
        user.createdAt,
        user.updatedAt
      )
    return user
  }

  update(user: User): User {
    this.db
      .prepare(
        `UPDATE users SET email = ?, password_hash = ?, provider = ?, provider_id = ?,
           updated_at = ? WHERE id = ?`
      )
      .run(
        user.email.toLowerCase(),
        user.passwordHash,
        user.provider,
        user.providerId,
        user.updatedAt,
        user.id
      )
    return user
  }
}

interface SyncEntryRow {
  id: string
  user_id: string
  device_id: string
  entity: string
  entity_id: string
  version: number
  iv: string
  ciphertext: string
  tag: string
  updated_at: string
  deleted_at: string | null
}

function rowToEntry(row: SyncEntryRow): SyncEntry {
  return {
    id: row.id,
    userId: row.user_id,
    deviceId: row.device_id,
    entity: row.entity,
    entityId: row.entity_id,
    version: row.version,
    iv: row.iv,
    ciphertext: row.ciphertext,
    tag: row.tag,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  }
}

/** The sync entries of a user. */
export class SyncRepository {
  private readonly db: ServerDatabase

  constructor(db: ServerDatabase) {
    this.db = db
  }

  /**
   * Stores an entry. The write is idempotent: the same entry id always
   * produces the same result, so a retried request is harmless.
   */
  upsert(entry: SyncEntry): SyncEntry {
    this.db
      .prepare(
        `INSERT INTO sync_entries (id, user_id, device_id, entity, entity_id, version,
           iv, ciphertext, tag, updated_at, deleted_at)
         VALUES (@id, @user_id, @device_id, @entity, @entity_id, @version,
           @iv, @ciphertext, @tag, @updated_at, @deleted_at)
         ON CONFLICT(id) DO UPDATE SET
           version = excluded.version, iv = excluded.iv, ciphertext = excluded.ciphertext,
           tag = excluded.tag, updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at`
      )
      .run({
        id: entry.id,
        user_id: entry.userId,
        device_id: entry.deviceId,
        entity: entry.entity,
        entity_id: entry.entityId,
        version: entry.version,
        iv: entry.iv,
        ciphertext: entry.ciphertext,
        tag: entry.tag,
        updated_at: entry.updatedAt,
        deleted_at: entry.deletedAt
      })

    return entry
  }

  /** All the entries of a user, optionally filtered by entity. */
  list(userId: string, entity?: string): SyncEntry[] {
    const rows = entity
      ? (this.db
          .prepare(
            'SELECT * FROM sync_entries WHERE user_id = ? AND entity = ? ORDER BY updated_at'
          )
          .all(userId, entity) as SyncEntryRow[])
      : (this.db
          .prepare('SELECT * FROM sync_entries WHERE user_id = ? ORDER BY updated_at')
          .all(userId) as SyncEntryRow[])

    return rows.map(rowToEntry)
  }

  /** The entry of a user and device for one entity — the merge base. */
  find(userId: string, entity: string, entityId: string): SyncEntry | null {
    const row = this.db
      .prepare(
        `SELECT * FROM sync_entries WHERE user_id = ? AND entity = ? AND entity_id = ?
         ORDER BY version DESC, updated_at DESC LIMIT 1`
      )
      .get(userId, entity, entityId) as SyncEntryRow | undefined

    return row ? rowToEntry(row) : null
  }

  /** Removes everything of a user. */
  removeAll(userId: string): void {
    this.db.prepare('DELETE FROM sync_entries WHERE user_id = ?').run(userId)
  }
}
