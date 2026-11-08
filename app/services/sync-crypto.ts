/**
 * Encryption of the sync payloads.
 *
 * The key is the one derived from the master password (PBKDF2 → 32 bytes);
 * every entry gets a fresh random IV, and AES-256-GCM authenticates it.
 * Nothing here knows about the transport — the service composes blobs into
 * wire entries.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { ENVELOPE_ALGORITHM, IV_BYTES } from '@shared/crypto'
import type { SyncBlob } from '@shared/types'
import type { MasterKeyMaterial } from './crypto'

/** Version of the blob layout — the sync contract fixes it. */
export const SYNC_BLOB_VERSION = 1

/** Encrypts a UTF-8 string into a sync blob. */
export function encryptSyncPayload(
  plaintext: string,
  material: MasterKeyMaterial,
  updatedAt: string = new Date().toISOString()
): SyncBlob {
  const key = Buffer.from(material.key, 'base64')
  const iv = randomBytes(IV_BYTES)

  const cipher = createCipheriv(ENVELOPE_ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    version: SYNC_BLOB_VERSION,
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: tag.toString('base64'),
    updated_at: updatedAt
  }
}

/**
 * Decrypts a sync blob.
 * A wrong master key or a tampered payload fails the GCM check and throws.
 */
export function decryptSyncPayload(blob: SyncBlob, material: MasterKeyMaterial): string {
  if (blob.version !== SYNC_BLOB_VERSION) {
    throw new Error(`Unsupported sync blob version: ${blob.version}`)
  }

  const key = Buffer.from(material.key, 'base64')
  const iv = Buffer.from(blob.iv, 'base64')
  const tag = Buffer.from(blob.tag, 'base64')
  const ciphertext = Buffer.from(blob.ciphertext, 'base64')

  const decipher = createDecipheriv(ENVELOPE_ALGORITHM, key, iv)
  decipher.setAuthTag(tag)

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

