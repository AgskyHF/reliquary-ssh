/**
 * Tab layout persistence.
 * Stage 3 keeps the layout in a JSON file under userData; Stage 6 swaps in a
 * SQLite-backed repository behind the same TabRepository interface.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { TabLayoutInput, TabLayoutSnapshot, TabState } from '@shared/types'

export interface TabRepository {
  load(): Promise<TabLayoutSnapshot>
  save(input: TabLayoutInput): Promise<TabLayoutSnapshot>
}

export function emptySnapshot(): TabLayoutSnapshot {
  return { tabs: [], activeTabId: null, savedAt: new Date(0).toISOString(), deviceId: '' }
}

export class JsonFileTabStore implements TabRepository {
  constructor(
    private readonly filePath: string,
    private readonly deviceId: () => string
  ) {}

  async load(): Promise<TabLayoutSnapshot> {
    if (!existsSync(this.filePath)) return emptySnapshot()

    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<TabLayoutSnapshot>
      if (!Array.isArray(parsed.tabs)) return emptySnapshot()

      return {
        tabs: parsed.tabs.filter(
          (tab): tab is TabState => !!tab && typeof tab.id === 'string'
        ),
        activeTabId: typeof parsed.activeTabId === 'string' ? parsed.activeTabId : null,
        savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date(0).toISOString(),
        deviceId: typeof parsed.deviceId === 'string' ? parsed.deviceId : ''
      }
    } catch {
      // A corrupt layout file must never block startup — start fresh instead.
      return emptySnapshot()
    }
  }

  async save(input: TabLayoutInput): Promise<TabLayoutSnapshot> {
    const deviceId = this.deviceId()
    const snapshot: TabLayoutSnapshot = {
      tabs: input.tabs.map((tab) => ({ ...tab, deviceId })),
      activeTabId: input.activeTabId,
      savedAt: new Date().toISOString(),
      deviceId
    }
    this.writeAtomic(snapshot)
    return snapshot
  }

  /** tmp file + rename, so a crash mid-write cannot truncate the layout. */
  private writeAtomic(snapshot: TabLayoutSnapshot): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify(snapshot, null, 2), 'utf8')
      renameSync(tmp, this.filePath)
    } catch (error) {
      rmSync(tmp, { force: true })
      throw error
    }
  }
}
