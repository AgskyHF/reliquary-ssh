import { describe, expect, it } from 'vitest'
import {
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
