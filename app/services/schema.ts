/**
 * SQLite schema and migrations.
 *
 * Every entity carries id, created_at, updated_at, deleted_at (soft
 * delete), version and device_id.
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

  // The saved passwords of the hosts. The plaintext never leaves the
  // process: the column holds the master-password envelope, the same way
  // the private keys do.
  `CREATE TABLE IF NOT EXISTS host_passwords (
    id                   TEXT PRIMARY KEY,
    host_id              TEXT NOT NULL,
    encrypted_password   TEXT NOT NULL,
    has_passphrase       INTEGER NOT NULL DEFAULT 0,
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL,
    deleted_at           TEXT,
    version              INTEGER NOT NULL DEFAULT 1,
    device_id            TEXT NOT NULL DEFAULT ''
  )`,

  // The versions that lost a merge. They are never deleted: the user may
  // still need the old password, so they travel with the export.
  `CREATE TABLE IF NOT EXISTS superseded_connections (
    id            TEXT PRIMARY KEY,
    host_id       TEXT NOT NULL,
    payload       TEXT NOT NULL,
    replaced_at   TEXT NOT NULL,
    replaced_by   TEXT NOT NULL,
    reason        TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    deleted_at    TEXT,
    version       INTEGER NOT NULL DEFAULT 1,
    device_id     TEXT NOT NULL DEFAULT ''
  )`,

  // The tables of the removed sync engine. They held nothing but the
  // sync state, so they are dropped — the data of the hosts, the keys
  // and the tabs stays untouched.
  `DROP TABLE IF EXISTS changes`,
  `DROP TABLE IF EXISTS sync_replicas`,

  `CREATE INDEX IF NOT EXISTS idx_hosts_deleted ON hosts (deleted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_keys_deleted ON keys (deleted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_tabs_deleted ON tabs (deleted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_host_passwords_host ON host_passwords (host_id)`,
  `CREATE INDEX IF NOT EXISTS idx_superseded_host ON superseded_connections (host_id)`
]
