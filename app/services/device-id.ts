/**
 * Stable device identifier and device-bound secret.
 *
 * The identifier is persisted in the userData directory and is used by every
 * entity model (hosts/keys/tabs).
 *
 * The secret is a 32-byte random value kept next to the identifier. It
 * encrypts the master key material on disk, so the store file is useless on
 * another machine. In a later stage it is moved into the OS keychain
 * (safeStorage) instead of the filesystem.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

let cachedId: string | null = null
let cachedSecret: Buffer | null = null

export function getDeviceId(userDataDir: string): string {
  if (cachedId) return cachedId

  const file = join(userDataDir, 'device.id')
  try {
    cachedId = readFileSync(file, 'utf8').trim()
  } catch {
    cachedId = ''
  }

  if (!cachedId) {
    cachedId = randomUUID()
    mkdirSync(userDataDir, { recursive: true })
    writeFileSync(file, `${cachedId}\n`, 'utf8')
  }
  return cachedId
}

/** The device-bound secret used to protect local key material. */
export function getDeviceSecret(userDataDir: string): Buffer {
  if (cachedSecret) return cachedSecret

  const file = join(userDataDir, 'device.secret')
  try {
    const stored = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64')
    if (stored.length === 32) {
      cachedSecret = stored
      return stored
    }
  } catch {
    // The file is missing — it is created below.
  }

  const secret = randomBytes(32)
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(file, `${secret.toString('base64')}\n`, 'utf8')
  cachedSecret = secret
  return secret
}
