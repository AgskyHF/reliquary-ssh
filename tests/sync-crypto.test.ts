import { describe, expect, it } from 'vitest'
import { isKdfEntry, readKdfEntry } from '@app/services/sync-crypto'
import {
  createKdfEntry,
  decryptSyncPayload,
  encryptSyncPayload
} from '@app/services/sync-crypto'
import { createMasterKey } from '@app/services/crypto'

const material = createMasterKey('correct horse battery', Buffer.alloc(16, 1))

describe('sync payload encryption', () => {
  it('round-trips a payload', () => {
    const blob = encryptSyncPayload('{"hello":"world"}', material)
    expect(decryptSyncPayload(blob, material)).toBe('{"hello":"world"}')
  })

  it('produces the fixed blob shape', () => {
    const blob = encryptSyncPayload('x', material, '2026-11-07T10:00:00.000Z')

    expect(blob.version).toBe(1)
    expect(blob.updated_at).toBe('2026-11-07T10:00:00.000Z')
    expect(Buffer.from(blob.iv, 'base64')).toHaveLength(12)
    expect(Buffer.from(blob.tag, 'base64')).toHaveLength(16)
    expect(blob.ciphertext).not.toContain('x')
  })

  it('uses a fresh IV for every blob', () => {
    const first = encryptSyncPayload('same', material)
    const second = encryptSyncPayload('same', material)

    expect(first.iv).not.toBe(second.iv)
    expect(first.ciphertext).not.toBe(second.ciphertext)
  })

  it('refuses a blob encrypted with another key', () => {
    const blob = encryptSyncPayload('secret', material)
    const other = createMasterKey('another password', Buffer.alloc(16, 2))

    expect(() => decryptSyncPayload(blob, other)).toThrow()
  })

  it('refuses a tampered ciphertext', () => {
    const blob = encryptSyncPayload('secret', material)
    const bytes = Buffer.from(blob.ciphertext, 'base64')
    bytes[0] = bytes[0] === 0 ? 1 : 0

    expect(() =>
      decryptSyncPayload({ ...blob, ciphertext: bytes.toString('base64') }, material)
    ).toThrow()
  })

  it('refuses an unknown blob version', () => {
    const blob = encryptSyncPayload('secret', material)
    expect(() => decryptSyncPayload({ ...blob, version: 99 }, material)).toThrow(/version/u)
  })
})

describe('KDF parameters entry', () => {
  const params = { salt: Buffer.alloc(16, 3).toString('base64'), iterations: 210_000 }

  it('round-trips the parameters', () => {
    const entry = createKdfEntry(params, 'device-a', '2026-11-07T10:00:00.000Z')

    expect(isKdfEntry(entry)).toBe(true)
    expect(readKdfEntry(entry)).toEqual(params)
  })

  it('is not an encrypted blob — it only carries the salt', () => {
    const entry = createKdfEntry(params, 'device-a')
    expect(entry.tag).toBe('')
    expect(entry.iv).toBe('')
    expect(Buffer.from(entry.ciphertext, 'base64').toString('utf8')).toContain(params.salt)
  })

  it('ignores a tombstone and a foreign entity', () => {
    const entry = createKdfEntry(params, 'device-a')
    expect(readKdfEntry({ ...entry, deletedAt: '2026-11-07T11:00:00.000Z' })).toBeNull()
    expect(readKdfEntry({ ...entry, entity: 'hosts' })).toBeNull()
    expect(isKdfEntry({ entity: 'keys', entityId: 'sync.kdf' })).toBe(false)
  })

  it('ignores a garbage payload', () => {
    const entry = createKdfEntry(params, 'device-a')
    const broken = {
      ...entry,
      ciphertext: Buffer.from('not-a-kdf-payload', 'utf8').toString('base64')
    }
    expect(readKdfEntry(broken)).toBeNull()
  })
})
