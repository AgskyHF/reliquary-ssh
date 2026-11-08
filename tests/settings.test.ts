import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Storage } from '@app/services/storage'
import { DEFAULT_SETTINGS } from '@app/services/settings'

describe('device settings', () => {
  let dir: string
  let storage: Storage

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'reliquary-settings-'))
    storage = new Storage(join(dir, 'reliquary.db'), () => 'test-device')
  })

  afterEach(() => {
    storage.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('starts with the defaults', () => {
    expect(storage.settings.all()).toEqual(DEFAULT_SETTINGS)
  })

  it('stores a value and reads it back', () => {
    storage.settings.set('logLevel', 'debug')

    expect(storage.settings.get('logLevel')).toBe('debug')
    expect(storage.settings.all().logLevel).toBe('debug')
  })

  it('keeps the other settings untouched', () => {
    storage.settings.set('logLevel', 'debug')
    storage.settings.set('language', 'ru')

    const all = storage.settings.all()
    expect(all.logLevel).toBe('debug')
    expect(all.language).toBe('ru')
  })

  it('overwrites a value instead of adding a second row', () => {
    storage.settings.set('logLevel', 'debug')
    storage.settings.set('logLevel', 'warn')

    const rows = storage.db
      .prepare("SELECT COUNT(*) AS total FROM settings WHERE key = 'log.level'")
      .get() as { total: number }

    expect(rows.total).toBe(1)
    expect(storage.settings.get('logLevel')).toBe('warn')
  })

  it('survives a restart of the storage', () => {
    storage.settings.set('logLevel', 'debug')
    storage.close()

    const reopened = new Storage(join(dir, 'reliquary.db'), () => 'test-device')
    expect(reopened.settings.get('logLevel')).toBe('debug')
    reopened.close()
  })

  it('stores the interface language and reads it back', () => {
    storage.settings.set('language', 'ru')

    expect(storage.settings.get('language')).toBe('ru')
    expect(storage.settings.all().language).toBe('ru')
  })

  it('keeps the language across a restart', () => {
    storage.settings.set('language', 'ru')
    storage.close()

    const reopened = new Storage(join(dir, 'reliquary.db'), () => 'test-device')
    expect(reopened.settings.get('language')).toBe('ru')
    reopened.close()
  })

  it('defaults the language to English', () => {
    expect(storage.settings.get('language')).toBe('en')
    expect(DEFAULT_SETTINGS.language).toBe('en')
  })
})
