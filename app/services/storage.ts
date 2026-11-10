/**
 * Local storage.
 *
 * Owns the SQLite database and the repositories on top of it. Everything
 * that needs persistent data goes through this service — the renderer never
 * touches the database directly.
 *
 * The schema gives every entity id, created_at, updated_at, deleted_at
 * (soft delete), version and device_id.
 */
import { join } from 'node:path'
import type { TabLayoutInput, TabLayoutSnapshot, TabState } from '@shared/types'
import { HostRepository, SqliteKeyRepository, TabRepository as SqliteTabRepository, openDatabase, type SqliteDatabase } from './database'
import { getDeviceId } from './device-id'
import { SettingsService } from './settings'
import { HostPasswordRepository } from './host-passwords'
import { SupersededRepository } from './superseded'

/** The tab repository contract the main process uses. */
export interface TabRepository {
  load(): Promise<TabLayoutSnapshot>
  save(input: TabLayoutInput): Promise<TabLayoutSnapshot>
}

/**
 * Tab layout stored in SQLite.
 *
 * The active tab id is kept in the `meta` table — it is a property of the
 * layout, not of a tab.
 */
export class SqliteTabStore implements TabRepository {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly deviceId: () => string
  ) {}

  async load(): Promise<TabLayoutSnapshot> {
    const tabs = new SqliteTabRepository(this.db).list()
    const active = this.db
      .prepare("SELECT value FROM meta WHERE key = 'active_tab_id'")
      .get() as { value: string } | undefined

    return {
      tabs,
      activeTabId: active?.value ?? null,
      savedAt: new Date().toISOString(),
      deviceId: this.deviceId()
    }
  }

  async save(input: TabLayoutInput): Promise<TabLayoutSnapshot> {
    const deviceId = this.deviceId()
    const now = new Date().toISOString()

    const tabs: TabState[] = input.tabs.map((tab) => ({
      ...tab,
      deviceId: tab.deviceId || deviceId,
      updatedAt: now
    }))

    const repository = new SqliteTabRepository(this.db)
    const run = this.db.transaction(() => {
      repository.saveAll(tabs)
      this.db
        .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('active_tab_id', ?)")
        .run(input.activeTabId ?? '')
    })
    run()

    return {
      tabs,
      activeTabId: input.activeTabId,
      savedAt: now,
      deviceId
    }
  }
}

/** The storage service — the single owner of the local database. */
export class Storage {
  readonly db: SqliteDatabase
  readonly hosts: HostRepository
  readonly keys: SqliteKeyRepository
  readonly tabs: TabRepository
  readonly settings: SettingsService
  /** The saved passwords of the hosts, encrypted with the master key. */
  readonly passwords: HostPasswordRepository
  /** The versions that lost a merge — they are never deleted. */
  readonly superseded: SupersededRepository

  constructor(
    filePath: string,
    deviceId: () => string
  ) {
    this.db = openDatabase(filePath)
    this.hosts = new HostRepository(this.db)
    this.keys = new SqliteKeyRepository(this.db)
    this.tabs = new SqliteTabStore(this.db, deviceId)
    this.settings = new SettingsService(this.db)
    this.passwords = new HostPasswordRepository(this.db)
    this.superseded = new SupersededRepository(this.db)
  }

  /** Creates the storage in the app's userData directory. */
  static inUserData(userData: string): Storage {
    return new Storage(join(userData, 'reliquary.db'), () => getDeviceId(userData))
  }

  /** Closes the database. */
  close(): void {
    this.db.close()
  }
}
