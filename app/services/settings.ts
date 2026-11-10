/**
 * The settings service.
 *
 * The settings live in the `settings` table of the local database. They
 * are device settings — the account ones are a separate thing (the KDF
 * parameters of the account).
 *
 * The backend address is the only setting the app really needs: it has to
 * be changeable from the UI, otherwise a user cannot point the app at
 * their own server.
 */
import type { SqliteDatabase } from './database'

/** The settings the app knows. */
export interface AppSettings {
  /** The log level: debug | info | warn | error. */
  logLevel: string
  /** The path of the log file, relative to userData. */
  logPath: string
  /**
   * The PBKDF2 parameters an import brought, as JSON.
   *
   * The salt belongs to the account, not to the device: a device that
   * imported an archive stores it here, so the master password it gets
   * derives the same key as on the device that made the export.
   */
  importedKdf: string
  /** The language of the interface: 'en' or 'ru'. */
  language: string
  /** The id of the terminal theme. */
  terminalTheme: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  logLevel: 'info',
  logPath: 'reliquary.log',
  importedKdf: '',
  language: 'en',
  terminalTheme: 'termius-dark'
}

/** The keys of the settings table. */
const KEYS = {
  logLevel: 'log.level',
  logPath: 'log.path',
  importedKdf: 'imported.kdf',
  language: 'ui.language',
  terminalTheme: 'ui.terminalTheme'
} as const

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
      logLevel: stored.get(KEYS.logLevel) ?? DEFAULT_SETTINGS.logLevel,
      logPath: stored.get(KEYS.logPath) ?? DEFAULT_SETTINGS.logPath,
      importedKdf: stored.get(KEYS.importedKdf) ?? DEFAULT_SETTINGS.importedKdf,
      language: stored.get(KEYS.language) ?? DEFAULT_SETTINGS.language,
      terminalTheme: stored.get(KEYS.terminalTheme) ?? DEFAULT_SETTINGS.terminalTheme
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
