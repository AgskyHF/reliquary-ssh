/**
 * Backend schema.
 *
 * The server stores only what it needs to authenticate a user and to
 * relay encrypted sync blobs. The payloads themselves are encrypted on
 * the client — the server never sees the plaintext.
 */
export const SERVER_SCHEMA_VERSION = 1

export const SERVER_SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    email        TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    provider     TEXT NOT NULL,
    provider_id  TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS sync_blobs (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    version      INTEGER NOT NULL,
    iv           TEXT NOT NULL,
    ciphertext   TEXT NOT NULL,
    tag          TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    device_id    TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  )`,

  // One blob per device and entity — the server keeps the latest state
  // of every device so a new device can bootstrap from it.
  `CREATE TABLE IF NOT EXISTS sync_entries (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    device_id    TEXT NOT NULL,
    entity       TEXT NOT NULL,
    entity_id    TEXT NOT NULL,
    version      INTEGER NOT NULL DEFAULT 1,
    iv           TEXT NOT NULL,
    ciphertext   TEXT NOT NULL,
    tag          TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    deleted_at   TEXT,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  )`,

  `CREATE INDEX IF NOT EXISTS idx_sync_entries_user ON sync_entries (user_id, entity, entity_id)`,
  // One row per entity per device: a repeated push updates the same row.
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_entries_unique
     ON sync_entries (user_id, device_id, entity, entity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_entries_device ON sync_entries (user_id, device_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_blobs_user ON sync_blobs (user_id)`
]
