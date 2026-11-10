/**
 * Envelope format for encrypted payloads.
 *
 * The same envelope is used for the private keys stored on disk and for
 * the passwords of the hosts. Keeping one format means the code does not
 * have to know about local storage.
 *
 * Layout (JSON, base64 fields):
 * {
 *   version: 1,
 *   algorithm: 'aes-256-gcm',
 *   kdf: 'pbkdf2-sha256',
 *   salt: '<base64>',
 *   iv: '<base64>',
 *   tag: '<base64>',
 *   ciphertext: '<base64>'
 * }
 */
export const ENVELOPE_VERSION = 1
export const ENVELOPE_ALGORITHM = 'aes-256-gcm'
export const ENVELOPE_KDF = 'pbkdf2-sha256'

/** PBKDF2 iteration count. */
export const KDF_ITERATIONS = 210_000

/** Salt length in bytes. */
export const SALT_BYTES = 16

/** IV length in bytes — the standard for AES-GCM. */
export const IV_BYTES = 12

/** GCM authentication tag length in bytes. */
export const TAG_BYTES = 16

/** AES-256 key length in bytes. */
export const KEY_BYTES = 32

export interface EncryptedEnvelope {
  version: number
  algorithm: string
  kdf: string
  salt: string
  iv: string
  tag: string
  ciphertext: string
}

/** True when the value looks like a serialized envelope. */
export function isEnvelope(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as Partial<EncryptedEnvelope>
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.ciphertext === 'string' &&
      typeof parsed.iv === 'string' &&
      typeof parsed.salt === 'string'
    )
  } catch {
    return false
  }
}
