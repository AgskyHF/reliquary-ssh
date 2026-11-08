/**
 * The settings service.
 *
 * The settings live in the `settings` table of the local database. They
 * are device settings — the synced settings are a separate thing (the KDF
 * parameters of the account).
 *
 * The backend address is the only setting the app really needs: it has to
 * be changeable from the UI, otherwise a user cannot point the app at
 * their own server.
 */
import type { SqliteDatabase } from './database'

/** The settings the app knows. */
export interface AppSettings {
  /** The address of the sync backend. */
  serverUrl: string
  /** The log level: debug | info | warn | error. */
  logLevel: string
  /** The path of the log file, relative to userData. */
  logPath: string
  /** The transport: 'server' (HTTP backend) or 'folder' (shared folder). */
  syncTransport: 'server' | 'folder'
  /** The shared folder used by the 'folder' transport. */
  syncFolder: string
  /**
   * The PBKDF2 parameters an import brought, as JSON.
   *
   * The salt belongs to the account, not to the device: a device that
   * imported an archive stores it here, so the master password it gets
   * derives the same key as on the device that made the export.
   */
  importedKdf: string
  /**
   * The interval of the auto sync, in seconds. Zero turns it off.
   *
   * The sync also runs when the app starts and when the user asks for it.
   */
  autoSyncSeconds: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  serverUrl: 'http://127.0.0.1:8790',
  logLevel: 'info',
  logPath: 'reliquary.log',
  syncTransport: 'server',
  syncFolder: '',
  importedKdf: '',
  autoSyncSeconds: 300
}

/** The keys of the settings table. */
const KEYS = {
  serverUrl: 'server.url',
  logLevel: 'log.level',
  logPath: 'log.path',
  syncTransport: 'sync.transport',
  syncFolder: 'sync.folder',
  importedKdf: 'imported.kdf',
  autoSyncSeconds: 'sync.autoSeconds'
} as const

/** Reads a numeric setting, falling back to the default. */
function readNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback

  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) return fallback
  return value
}

export class SettingsService {
  constructor(private readonly db: SqliteDatabase) {}

  /** All settings, with the defaults filled in. */
  all(): AppSettings {
    const values = this.db.prepare('SELECT key, value FROM settings').all() as {
      key: string
      value: string
    }[]

    const stored = new Map(values.map((row) => [row.key, row.value]))

    return {
      serverUrl: stored.get(KEYS.serverUrl) ?? DEFAULT_SETTINGS.serverUrl,
      logLevel: stored.get(KEYS.logLevel) ?? DEFAULT_SETTINGS.logLevel,
      logPath: stored.get(KEYS.logPath) ?? DEFAULT_SETTINGS.logPath,
      syncTransport:
        stored.get(KEYS.syncTransport) === 'folder' ? 'folder' : DEFAULT_SETTINGS.syncTransport,
      syncFolder: stored.get(KEYS.syncFolder) ?? DEFAULT_SETTINGS.syncFolder,
      importedKdf: stored.get(KEYS.importedKdf) ?? DEFAULT_SETTINGS.importedKdf,
      autoSyncSeconds: readNumber(
        stored.get(KEYS.autoSyncSeconds),
        DEFAULT_SETTINGS.autoSyncSeconds
      )
    }
  }

  /** One setting. */
  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return this.all()[key]
  }

  /** Writes one setting and returns the new value. */
  set<K extends keyof AppSettings>(key: K, value: string): AppSettings[K] {
    const now = new Date().toISOString()
    const storageKey = KEYS[key as keyof typeof KEYS]
    this.db
      .prepare(
        `INSERT INTO settings (id, key, value, created_at, updated_at, deleted_at, version, device_id)
         VALUES (@id, @key, @value, @now, @now, NULL, 1, '')
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value, updated_at = excluded.updated_at,
           version = settings.version + 1`
      )
      .run({
        id: crypto.randomUUID(),
        key: storageKey,
        value,
        now
      })

    return value as AppSettings[K]
  }
}
