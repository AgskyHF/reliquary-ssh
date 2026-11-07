/**
 * Master-password handling.
 *
 * The master password never leaves the device. It is turned into an
 * AES-256 key with PBKDF2 (SHA-256) and a random salt; the salt lives in
 * the envelope next to the ciphertext.
 *
 * The derived key is kept in memory only, for the lifetime of the app
 * session. Persisting it (safeStorage / OS keychain) is a later stage.
 */
import {
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual
} from 'node:crypto'
import {
  ENVELOPE_ALGORITHM,
  ENVELOPE_KDF,
  ENVELOPE_VERSION,
  IV_BYTES,
  KDF_ITERATIONS,
  KEY_BYTES,
  SALT_BYTES,
  TAG_BYTES,
  type EncryptedEnvelope
} from '@shared/crypto'

/**
 * The plaintext encrypted inside the master-password check envelope.
 * It carries no secret — it only proves the password derives the right key.
 */
export const MASTER_MARKER = 'reliquaryssh-master-key'

export interface MasterKeyMaterial {
  /** Base64 32-byte AES-256 key. */
  key: string
  /** Base64 salt the key was derived from. */
  salt: string
  iterations: number
}

/** Derives an AES-256 key from the master password and a salt. */
export function deriveKey(
  password: string,
  salt: Buffer,
  iterations: number = KDF_ITERATIONS
): Buffer {
  return pbkdf2Sync(password, salt, iterations, KEY_BYTES, 'sha256')
}

/** Creates the master key material for a new master password. */
export function createMasterKey(password: string, salt?: Buffer, iterations = KDF_ITERATIONS): MasterKeyMaterial {
  const value = salt ?? randomBytes(SALT_BYTES)
  const key = deriveKey(password, value, iterations)
  return {
    key: key.toString('base64'),
    salt: value.toString('base64'),
    iterations
  }
}

/** Encrypts a UTF-8 string with the master key. */
export function encryptWithMasterKey(plaintext: string, material: MasterKeyMaterial): string {
  const key = Buffer.from(material.key, 'base64')
  const salt = Buffer.from(material.salt, 'base64')
  const iv = randomBytes(IV_BYTES)

  const cipher = createCipheriv(ENVELOPE_ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  const envelope: EncryptedEnvelope = {
    version: ENVELOPE_VERSION,
    algorithm: ENVELOPE_ALGORITHM,
    kdf: ENVELOPE_KDF,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64')
  }

  return JSON.stringify(envelope)
}

/**
 * Decrypts a payload produced by encryptWithMasterKey.
 * A wrong master password surfaces as an authentication error.
 */
export function decryptWithMasterKey(payload: string, material: MasterKeyMaterial): string {
  const envelope = JSON.parse(payload) as EncryptedEnvelope
  const key = Buffer.from(material.key, 'base64')
  const iv = Buffer.from(envelope.iv, 'base64')
  const tag = Buffer.from(envelope.tag, 'base64')
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64')

  const decipher = createDecipheriv(ENVELOPE_ALGORITHM, key, iv)
  decipher.setAuthTag(tag)

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

/**
 * Checks a master password against an existing envelope.
 *
 * The check decrypts the payload: AES-GCM verifies the authentication tag,
 * so a wrong password fails with an authentication error instead of
 * returning garbage. The comparison of the resulting marker is
 * constant-time.
 */
export function verifyMasterPassword(
  payload: string,
  password: string,
  iterations: number = KDF_ITERATIONS
): boolean {
  let envelope: EncryptedEnvelope
  try {
    envelope = JSON.parse(payload) as EncryptedEnvelope
  } catch {
    return false
  }

  const salt = Buffer.from(envelope.salt, 'base64')
  const material: MasterKeyMaterial = {
    key: deriveKey(password, salt, iterations).toString('base64'),
    salt: salt.toString('base64'),
    iterations
  }

  try {
    return safeEqual(decryptWithMasterKey(payload, material), MASTER_MARKER)
  } catch {
    // GCM authentication failed — the password is wrong.
    return false
  }
}

/** Constant-time comparison of two strings. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/** Length of the GCM tag in bytes — exported for tests. */
export const AUTH_TAG_BYTES = TAG_BYTES
