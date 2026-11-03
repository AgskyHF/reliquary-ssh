/**
 * Key storage.
 *
 * Stage 5 keeps the keys in a JSON file under userData; stage 6 swaps in a
 * SQLite-backed repository behind the same KeyRepository interface.
 *
 * The file holds only metadata and the encrypted private key — the plaintext
 * private key never reaches the disk.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { SshKey } from '@shared/types'
import type { KeyRepository } from './keychain'

export function emptyKeyList(): SshKey[] {
  return []
}

export class JsonFileKeyRepository implements KeyRepository {
  constructor(
    private readonly filePath: string,
    private readonly deviceId: () => string
  ) {}

  async list(): Promise<SshKey[]> {
    if (!existsSync(this.filePath)) return emptyKeyList()

    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown
      if (!Array.isArray(parsed)) return emptyKeyList()
      return parsed.filter((item): item is SshKey => {
        if (typeof item !== 'object' || item === null) return false
        const key = item as Partial<SshKey>
        return typeof key.id === 'string' && typeof key.publicKey === 'string'
      })
    } catch {
      // A corrupt key file must never block startup — start fresh instead.
      return emptyKeyList()
    }
  }

  async get(id: string): Promise<SshKey | null> {
    const keys = await this.list()
    return keys.find((key) => key.id === id) ?? null
  }

  async save(key: SshKey): Promise<SshKey> {
    const deviceId = this.deviceId()
    const stored: SshKey = { ...key, deviceId: key.deviceId || deviceId }
    const keys = await this.list()
    const index = keys.findIndex((item) => item.id === stored.id)

    if (index >= 0) {
      keys[index] = stored
    } else {
      keys.push(stored)
    }

    this.writeAtomic(keys)
    return stored
  }

  async remove(id: string): Promise<void> {
    const keys = await this.list()
    const index = keys.findIndex((item) => item.id === id)
    if (index === -1) return

    // Soft delete — the row stays for sync purposes.
    keys[index] = {
      ...keys[index],
      deletedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: keys[index].version + 1
    }

    this.writeAtomic(keys)
  }

  /** tmp file + rename, so a crash mid-write cannot truncate the store. */
  private writeAtomic(keys: SshKey[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify(keys, null, 2), 'utf8')
      renameSync(tmp, this.filePath)
    } catch (error) {
      rmSync(tmp, { force: true })
      throw error
    }
  }
}
