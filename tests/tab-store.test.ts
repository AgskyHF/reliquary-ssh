import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createTab } from '@shared/tabs-model'
import { JsonFileTabStore } from '@app/services/tab-store'

const dirs: string[] = []

function storeInTmp(name = 'tabs.json'): { store: JsonFileTabStore; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'reliquary-tabs-'))
  dirs.push(dir)
  const file = join(dir, name)
  return { store: new JsonFileTabStore(file, () => 'device-test'), file }
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

describe('JsonFileTabStore', () => {
  it('returns an empty snapshot when the file does not exist', async () => {
    const { store } = storeInTmp()
    const snapshot = await store.load()
    expect(snapshot.tabs).toEqual([])
    expect(snapshot.activeTabId).toBeNull()
    expect(snapshot.deviceId).toBe('')
  })

  it('round-trips tabs and stamps deviceId + savedAt', async () => {
    const { store, file } = storeInTmp()
    const a = createTab()
    const b = createTab({ title: 'tester@host' })

    const saved = await store.save({ tabs: [a, b], activeTabId: b.id })
    expect(saved.deviceId).toBe('device-test')
    expect(saved.tabs.every((tab) => tab.deviceId === 'device-test')).toBe(true)

    const loaded = await store.load()
    expect(loaded.tabs.map((tab) => tab.id)).toEqual([a.id, b.id])
    expect(loaded.activeTabId).toBe(b.id)

    const raw = JSON.parse(readFileSync(file, 'utf8')) as { savedAt: string }
    expect(Number.isNaN(Date.parse(raw.savedAt))).toBe(false)
  })

  it('starts fresh after a corrupt file instead of blocking startup', async () => {
    const { store, file } = storeInTmp()
    writeFileSync(file, '{ not json', 'utf8')
    const snapshot = await store.load()
    expect(snapshot.tabs).toEqual([])
  })

  it('drops structurally invalid tab entries on load', async () => {
    const { store, file } = storeInTmp()
    writeFileSync(file, JSON.stringify({ tabs: [{ id: 'ok' }, null, { nope: 1 }], activeTabId: 'ok' }), 'utf8')
    const snapshot = await store.load()
    expect(snapshot.tabs.map((tab) => tab.id)).toEqual(['ok'])
  })

  it('leaves no tmp file behind after save', async () => {
    const { store, file } = storeInTmp()
    await store.save({ tabs: [], activeTabId: null })
    expect(() => readFileSync(`${file}.tmp`, 'utf8')).toThrow()
  })
})
