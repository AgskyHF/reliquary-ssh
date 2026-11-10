/**
 * Database connection and repositories.
 *
 * The repositories are the only place that talks to SQLite. The renderer
 * never sees the database — it goes through the preload API.
 */
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  AuthMethod,
  ProtocolType,
  TabKind,
  type ConnectionTarget,
  type Host,
  type SshKey,
  type TabState
} from '@shared/types'
import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from './schema'

export type SqliteDatabase = Database.Database

/** Opens the database and applies the schema. */
export function openDatabase(filePath: string): SqliteDatabase {
  mkdirSync(dirname(filePath), { recursive: true })

  const db = new Database(filePath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  for (const statement of SCHEMA_STATEMENTS) {
    db.exec(statement)
  }

  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
    'schema_version',
    String(SCHEMA_VERSION)
  )

  return db
}

/** Row shape of the hosts table. */
interface HostRow {
  id: string
  name: string
  protocol: string
  host: string
  port: number
  username: string
  auth_method: string
  key_id: string | null
  color: string
  group: string | null
  notes: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  version: number
  device_id: string
}

function rowToHost(row: HostRow): Host {
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol as ProtocolType,
    host: row.host,
    port: row.port,
    username: row.username,
    authMethod: row.auth_method as AuthMethod,
    keyId: row.key_id,
    color: row.color,
    group: row.group,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    version: row.version,
    deviceId: row.device_id
  }
}

function hostToRow(host: Partial<Host>): HostRow {
  return {
    id: host.id ?? '',
    name: host.name ?? '',
    protocol: host.protocol ?? ProtocolType.SSH,
    host: host.host ?? '',
    port: host.port ?? 22,
    username: host.username ?? '',
    auth_method: host.authMethod ?? AuthMethod.PASSWORD,
    key_id: host.keyId ?? null,
    color: host.color ?? '',
    group: host.group ?? null,
    notes: host.notes ?? '',
    created_at: host.createdAt ?? new Date().toISOString(),
    updated_at: host.updatedAt ?? new Date().toISOString(),
    deleted_at: host.deletedAt ?? null,
    version: host.version ?? 1,
    device_id: host.deviceId ?? ''
  }
}

/** Hosts table. */
export class HostRepository {
  constructor(private readonly db: SqliteDatabase) {}

  list(includeDeleted = false): Host[] {
    const sql = includeDeleted
      ? 'SELECT * FROM hosts ORDER BY name COLLATE NOCASE'
      : 'SELECT * FROM hosts WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE'

    return (this.db.prepare(sql).all() as HostRow[]).map(rowToHost)
  }

  /**
   * One host by its id.
   *
   * A deleted host is not returned: the user deleted it, so it does not
   * exist for the app. The soft-deleted rows are kept for the merge, and
   * `getIncludingDeleted` reaches them.
   */
  get(id: string): Host | null {
    const row = this.db
      .prepare('SELECT * FROM hosts WHERE id = ? AND deleted_at IS NULL')
      .get(id) as HostRow | undefined
    return row ? rowToHost(row) : null
  }

  /** One host by its id — the deleted ones too. */
  getIncludingDeleted(id: string): Host | null {
    const row = this.db.prepare('SELECT * FROM hosts WHERE id = ?').get(id) as HostRow | undefined
    return row ? rowToHost(row) : null
  }

  /**
   * The live host with the same endpoint — the same address, port and
   * user. The id may differ: the host can have been created again on
   * another device.
   */
  findByEndpoint(host: {
    host: string
    port: number
    username: string
    protocol: string
  }): Host | null {
    const rows = this.db
      .prepare(
        `SELECT * FROM hosts WHERE deleted_at IS NULL AND host = ? AND port = ? AND username = ?
           AND protocol = ?`
      )
      .all(host.host, host.port, host.username, host.protocol) as HostRow[]

    if (rows.length === 0) return null
    return rowToHost(rows[0]!)
  }

  save(host: Partial<Host>): Host {
    const row = hostToRow({
      ...host,
      id: host.id ?? crypto.randomUUID()
    })
    this.db
      .prepare(
        `INSERT INTO hosts (id, name, protocol, host, port, username, auth_method, key_id,
           color, "group", notes, created_at, updated_at, deleted_at, version, device_id)
         VALUES (@id, @name, @protocol, @host, @port, @username, @auth_method, @key_id,
           @color, @group, @notes, @created_at, @updated_at, @deleted_at, @version, @device_id)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, protocol = excluded.protocol, host = excluded.host,
           port = excluded.port, username = excluded.username,
           auth_method = excluded.auth_method, key_id = excluded.key_id,
           color = excluded.color, "group" = excluded."group", notes = excluded.notes,
           updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
           version = excluded.version, device_id = excluded.device_id`
      )
      .run(row)

    return rowToHost(row)
  }

  remove(id: string): void {
    const now = new Date().toISOString()
    this.db
      .prepare(
        'UPDATE hosts SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ?'
      )
      .run(now, now, id)
  }
}

/** Row shape of the keys table. */
interface KeyRow {
  id: string
  name: string
  type: string
  fingerprint: string
  public_key: string
  encrypted_private_key: string
  private_key_format: string
  has_passphrase: number
  comment: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  version: number
  device_id: string
}

function rowToKey(row: KeyRow): SshKey {
  return {
    id: row.id,
    name: row.name,
    type: row.type as SshKey['type'],
    fingerprint: row.fingerprint,
    publicKey: row.public_key,
    encryptedPrivateKey: row.encrypted_private_key,
    privateKeyFormat: row.private_key_format,
    hasPassphrase: row.has_passphrase === 1,
    comment: row.comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    version: row.version,
    deviceId: row.device_id
  }
}

/** Keys table. */
export class SqliteKeyRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async list(): Promise<SshKey[]> {
    const rows = this.db
      .prepare('SELECT * FROM keys WHERE deleted_at IS NULL ORDER BY created_at DESC')
      .all() as KeyRow[]
    return rows.map(rowToKey)
  }

  async get(id: string): Promise<SshKey | null> {
    const row = this.db.prepare('SELECT * FROM keys WHERE id = ?').get(id) as KeyRow | undefined
    return row ? rowToKey(row) : null
  }

  async save(key: SshKey): Promise<SshKey> {
    this.db
      .prepare(
        `INSERT INTO keys (id, name, type, fingerprint, public_key, encrypted_private_key,
           private_key_format, has_passphrase, comment, created_at, updated_at, deleted_at,
           version, device_id)
         VALUES (@id, @name, @type, @fingerprint, @public_key, @encrypted_private_key,
           @private_key_format, @has_passphrase, @comment, @created_at, @updated_at,
           @deleted_at, @version, @device_id)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, type = excluded.type, fingerprint = excluded.fingerprint,
           public_key = excluded.public_key,
           encrypted_private_key = excluded.encrypted_private_key,
           private_key_format = excluded.private_key_format,
           has_passphrase = excluded.has_passphrase, comment = excluded.comment,
           updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
           version = excluded.version, device_id = excluded.device_id`
      )
      .run({
        id: key.id,
        name: key.name,
        type: key.type,
        fingerprint: key.fingerprint,
        public_key: key.publicKey,
        encrypted_private_key: key.encryptedPrivateKey,
        private_key_format: key.privateKeyFormat,
        has_passphrase: key.hasPassphrase ? 1 : 0,
        comment: key.comment,
        created_at: key.createdAt,
        updated_at: key.updatedAt,
        deleted_at: key.deletedAt,
        version: key.version,
        device_id: key.deviceId
      })

    return key
  }

  async remove(id: string): Promise<void> {
    const now = new Date().toISOString()
    this.db
      .prepare(
        'UPDATE keys SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ?'
      )
      .run(now, now, id)
  }
}

/** Row shape of the tabs table. */
interface TabRow {
  id: string
  kind: string
  title: string
  host_id: string | null
  connection: string | null
  buffer: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  version: number
  device_id: string
}

function rowToTab(row: TabRow): TabState {
  let connection: ConnectionTarget | null = null
  if (row.connection) {
    try {
      connection = JSON.parse(row.connection) as ConnectionTarget
    } catch {
      // A corrupt connection blob must not break the whole list.
      connection = null
    }
  }

  return {
    id: row.id,
    kind: row.kind as TabKind,
    title: row.title,
    hostId: row.host_id,
    connection,
    buffer: row.buffer,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    version: row.version,
    deviceId: row.device_id
  }
}

/** Tabs table. */
export class TabRepository {
  constructor(private readonly db: SqliteDatabase) {}

  list(): TabState[] {
    const rows = this.db
      .prepare('SELECT * FROM tabs WHERE deleted_at IS NULL ORDER BY created_at')
      .all() as TabRow[]
    return rows.map(rowToTab)
  }

  /**
   * Saves the given tabs and soft-deletes the ones that are gone.
   *
   * A tab that was closed in the UI must disappear from the storage —
   * an upsert alone would leave the old row behind and the tab would
   * come back on the next start.
   */
  saveAll(tabs: TabState[]): TabState[] {
    const upsert = this.db.prepare(
      `INSERT INTO tabs (id, kind, title, host_id, connection, buffer, created_at,
         updated_at, deleted_at, version, device_id)
       VALUES (@id, @kind, @title, @host_id, @connection, @buffer, @created_at,
         @updated_at, @deleted_at, @version, @device_id)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind, title = excluded.title, host_id = excluded.host_id,
         connection = excluded.connection, buffer = excluded.buffer,
         updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
         version = excluded.version, device_id = excluded.device_id`
    )

    const softDelete = this.db.prepare(
      'UPDATE tabs SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ?'
    )

    const run = this.db.transaction((items: TabState[]) => {
      const keep = new Set(items.map((tab) => tab.id))
      const now = new Date().toISOString()

      // The tabs that are no longer in the layout are closed.
      const stale = this.db
        .prepare('SELECT id FROM tabs WHERE deleted_at IS NULL')
        .all() as { id: string }[]
      for (const row of stale) {
        if (!keep.has(row.id)) softDelete.run(now, now, row.id)
      }

      for (const tab of items) {
        upsert.run({
          id: tab.id,
          kind: tab.kind,
          title: tab.title,
          host_id: tab.hostId,
          connection: tab.connection ? JSON.stringify(tab.connection) : null,
          buffer: tab.buffer,
          created_at: tab.createdAt,
          updated_at: tab.updatedAt,
          deleted_at: tab.deletedAt,
          version: tab.version,
          device_id: tab.deviceId
        })
      }
    })

    run(tabs)
    return tabs
  }
}
