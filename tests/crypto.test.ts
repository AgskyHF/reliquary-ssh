import { describe, expect, it } from 'vitest'
import {
  MASTER_MARKER,
  createMasterKey,
  decryptWithMasterKey,
  deriveKey,
  encryptWithMasterKey,
  safeEqual,
  verifyMasterPassword
} from '@app/services/crypto'
import { isEnvelope } from '@shared/crypto'

describe('master key derivation', () => {
  it('derives a 32-byte key from the password and salt', () => {
    const salt = Buffer.alloc(16, 7)
    const key = deriveKey('correct horse', salt, 1000)
    expect(key).toHaveLength(32)
  })

  it('derives the same key for the same password and salt', () => {
    const salt = Buffer.alloc(16, 3)
    expect(deriveKey('pw', salt, 1000).equals(deriveKey('pw', salt, 1000))).toBe(true)
  })

  it('derives different keys for different passwords', () => {
    const salt = Buffer.alloc(16, 3)
    expect(deriveKey('a', salt, 1000).equals(deriveKey('b', salt, 1000))).toBe(false)
  })

  it('creates material with a random salt', () => {
    const first = createMasterKey('pw')
    const second = createMasterKey('pw')
    expect(first.salt).not.toBe(second.salt)
    expect(first.key).not.toBe(second.key)
    expect(first.iterations).toBeGreaterThan(1000)
  })
})

describe('envelope encryption', () => {
  it('round-trips a plaintext', () => {
    const material = createMasterKey('master')
    const payload = encryptWithMasterKey('private key material', material)
    expect(decryptWithMasterKey(payload, material)).toBe('private key material')
  })

  it('produces a serialized envelope', () => {
    const material = createMasterKey('master')
    const payload = encryptWithMasterKey('secret', material)
    expect(isEnvelope(payload)).toBe(true)
  })

  it('uses a fresh IV for every payload', () => {
    const material = createMasterKey('master')
    const first = JSON.parse(encryptWithMasterKey('same', material)) as { iv: string }
    const second = JSON.parse(encryptWithMasterKey('same', material)) as { iv: string }
    expect(first.iv).not.toBe(second.iv)
  })

  it('fails to decrypt with the wrong key', () => {
    const material = createMasterKey('master')
    const payload = encryptWithMasterKey('secret', material)
    const other = createMasterKey('other')

    expect(() => decryptWithMasterKey(payload, other)).toThrow()
  })

  it('fails when the ciphertext was tampered with', () => {
    const material = createMasterKey('master')
    const envelope = JSON.parse(encryptWithMasterKey('secret', material)) as {
      ciphertext: string
    }
    const tampered = Buffer.from(envelope.ciphertext, 'base64')
    tampered[0] = (tampered[0] ?? 0) ^ 0xff
    envelope.ciphertext = tampered.toString('base64')

    expect(() => decryptWithMasterKey(JSON.stringify(envelope), material)).toThrow()
  })
})

describe('master password verification', () => {
  it('accepts the correct password', () => {
    const material = createMasterKey('master')
    const check = encryptWithMasterKey(MASTER_MARKER, material)
    expect(verifyMasterPassword(check, 'master')).toBe(true)
  })

  it('rejects a wrong password', () => {
    const material = createMasterKey('master')
    const check = encryptWithMasterKey(MASTER_MARKER, material)
    expect(verifyMasterPassword(check, 'wrong')).toBe(false)
  })

  it('rejects a malformed payload', () => {
    expect(verifyMasterPassword('not json', 'master')).toBe(false)
  })
})

describe('safeEqual', () => {
  it('compares equal strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
  })

  it('rejects different strings of the same length', () => {
    expect(safeEqual('abc', 'abd')).toBe(false)
  })

  it('rejects strings of different lengths', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false)
  })
})
