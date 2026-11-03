/**
 * SQLite schema and migrations.
 *
 * Every entity follows the sync contract: id, created_at, updated_at,
 * deleted_at (soft delete), version and device_id. The `changes` table is
 * the outbox journal — local changes waiting to be pushed to the backend.
 */
export const SCHEMA_VERSION = 1

/**
 * The statements that create the schema. They are idempotent, so running
 * them on an existing database is a no-op.
 */
export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS hosts (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    protocol     TEXT NOT NULL,
    host         TEXT NOT NULL,
    port         INTEGER NOT NULL,
    username     TEXT NOT NULL,
    auth_method  TEXT NOT NULL,
    key_id       TEXT,
    color        TEXT NOT NULL DEFAULT '',
    "group"      TEXT,
    notes        TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    deleted_at   TEXT,
    version      INTEGER NOT NULL DEFAULT 1,
    device_id    TEXT NOT NULL DEFAULT ''
  )`,

  `CREATE TABLE IF NOT EXISTS keys (
    id                   TEXT PRIMARY KEY,
    name                 TEXT NOT NULL,
    type                 TEXT NOT NULL,
    fingerprint          TEXT NOT NULL,
    public_key           TEXT NOT NULL,
    encrypted_private_key TEXT NOT NULL,
    private_key_format   TEXT NOT NULL,
    has_passphrase       INTEGER NOT NULL DEFAULT 0,
    comment              TEXT NOT NULL DEFAULT '',
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL,
    deleted_at           TEXT,
    version              INTEGER NOT NULL DEFAULT 1,
    device_id            TEXT NOT NULL DEFAULT ''
  )`,

  `CREATE TABLE IF NOT EXISTS tabs (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    title       TEXT NOT NULL,
    host_id     TEXT,
    connection  TEXT,
    buffer      TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT,
    version     INTEGER NOT NULL DEFAULT 1,
    device_id   TEXT NOT NULL DEFAULT ''
  )`,

  `CREATE TABLE IF NOT EXISTS settings (
    id          TEXT PRIMARY KEY,
    key         TEXT NOT NULL UNIQUE,
    value       TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT,
    version     INTEGER NOT NULL DEFAULT 1,
    device_id   TEXT NOT NULL DEFAULT ''
  )`,

  // The outbox journal: every local change is recorded here and marked as
  // synced once the backend has accepted it.
  `CREATE TABLE IF NOT EXISTS changes (
    id         TEXT PRIMARY KEY,
    entity     TEXT NOT NULL,
    entity_id  TEXT NOT NULL,
    operation  TEXT NOT NULL,
    payload    TEXT NOT NULL,
    synced     INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version    INTEGER NOT NULL DEFAULT 1,
    device_id  TEXT NOT NULL DEFAULT ''
  )`,

  `CREATE INDEX IF NOT EXISTS idx_hosts_deleted ON hosts (deleted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_keys_deleted ON keys (deleted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_tabs_deleted ON tabs (deleted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_changes_synced ON changes (synced)`,
  `CREATE INDEX IF NOT EXISTS idx_changes_entity ON changes (entity, entity_id)`
]
