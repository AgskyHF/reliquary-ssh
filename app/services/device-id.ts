/**
 * Stable device identifier. Persisted in the userData directory; used by
 * every entity model (hosts/keys/tabs) and by the sync outbox later on.
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

let cached: string | null = null

export function getDeviceId(userDataDir: string): string {
  if (cached) return cached

  const file = join(userDataDir, 'device.id')
  try {
    cached = readFileSync(file, 'utf8').trim()
  } catch {
    cached = ''
  }

  if (!cached) {
    cached = randomUUID()
    mkdirSync(userDataDir, { recursive: true })
    writeFileSync(file, `${cached}\n`, 'utf8')
  }
  return cached
}
