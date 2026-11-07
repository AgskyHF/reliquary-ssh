/**
 * The folder transport.
 *
 * The sync engine does not care where the encrypted entries live — it only
 * needs something that stores and returns them. This backend stores them
 * as files in a folder that every device can see (a Syncthing folder, a
 * NAS share, a Dropbox directory).
 *
 * Why this works without conflicts:
 *  - an entry is addressed by (device, entity, entityId), so every device
 *    writes its own file and two devices never write the same one;
 *  - the files hold encrypted blobs only — the folder can be read by
 *    anyone, they still learn nothing;
 *  - the PBKDF2 salt of the "account" is a single shared file, so the
 *    devices derive the same key from the same master password.
 *
 * The folder transport needs no account and no server: the folder is the
 * server.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import type { SyncEntry } from '@shared/sync'

/** The file that holds the PBKDF2 parameters of the folder. */
const KDF_FILE = 'sync.kdf.json'

/** The transport of this backend. */
export const FOLDER_TRANSPORT = 'folder' as const

export class FolderSyncBackend {
  readonly transport = FOLDER_TRANSPORT

  constructor(private readonly root: string) {}

  /** The folder the entries live in. */
  get path(): string {
    return this.root
  }

  /** The transport is usable as soon as the folder exists. */
  isSignedIn(): boolean {
    return existsSync(this.root)
  }

  /** The address shown in the UI. */
  get serverUrl(): string {
    return `file://${this.root}`
  }

  /** Writes the entries — one file per device and entity. */
  async pushEntries(entries: SyncEntry[]): Promise<number> {
    if (!existsSync(this.root)) {
      throw new Error(`The sync folder does not exist: ${this.root}`)
    }

    for (const entry of entries) {
      const file = this.fileFor(entry)
      mkdirSync(join(this.root, entry.entity), { recursive: true })

      const payload = {
        entity: entry.entity,
        entityId: entry.entityId,
        version: entry.version,
        iv: entry.iv,
        ciphertext: entry.ciphertext,
        tag: entry.tag,
        deviceId: entry.deviceId,
        updatedAt: entry.updatedAt,
        deletedAt: entry.deletedAt
      }

      // Written through a temporary file: a Syncthing peer must never see
      // a half-written record.
      const temp = `${file}.tmp`
      writeFileSync(temp, JSON.stringify(payload), 'utf8')
      renameSyncSafe(temp, file)
    }

    return entries.length
  }

  /** Reads every entry of the folder, optionally filtered by entity. */
  async pullEntries(entity?: string): Promise<SyncEntry[]> {
    if (!existsSync(this.root)) return []

    const entities = entity
      ? [entity]
      : readdirSync(this.root, { withFileTypes: true })
          .filter((item) => item.isDirectory())
          .map((item) => item.name)

    const entries: SyncEntry[] = []

    for (const name of entities) {
      const directory = join(this.root, name)
      if (!existsSync(directory)) continue

      for (const item of readdirSync(directory, { withFileTypes: true })) {
        if (!item.isFile() || !item.name.endsWith('.json')) continue

        const parsed = readEntry(join(directory, item.name))
        if (parsed) entries.push(parsed)
      }
    }

    return entries
  }

  /** Removes the temporary files a crashed run could leave behind. */
  cleanTempFiles(): number {
    if (!existsSync(this.root)) return 0

    let removed = 0
    for (const name of readdirSync(this.root, { withFileTypes: true })) {
      if (!name.isDirectory()) continue

      const directory = join(this.root, name.name)
      for (const item of readdirSync(directory, { withFileTypes: true })) {
        if (!item.isFile() || !item.name.endsWith('.tmp')) continue

        rmSync(join(directory, item.name), { force: true })
        removed++
      }
    }

    return removed
  }

  /** The file an entry is stored in. */
  private fileFor(entry: SyncEntry): string {
    const directory = join(this.root, entry.entity)

    // The salt belongs to the whole folder, not to a device: a shared
    // file keeps every device on the same key.
    if (entry.entity === 'settings' && entry.entityId === 'sync.kdf') {
      return join(directory, KDF_FILE)
    }

    return join(directory, `${safeName(entry.entityId)}__${safeName(entry.deviceId)}.json`)
  }
}

/** Reads one entry file, ignoring the broken ones. */
function readEntry(path: string): SyncEntry | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<SyncEntry>

    if (typeof parsed.entity !== 'string') return null
    if (typeof parsed.entityId !== 'string') return null
    if (typeof parsed.ciphertext !== 'string') return null

    return {
      entity: parsed.entity as SyncEntry['entity'],
      entityId: parsed.entityId,
      version: typeof parsed.version === 'number' ? parsed.version : 1,
      iv: parsed.iv ?? '',
      ciphertext: parsed.ciphertext,
      tag: parsed.tag ?? '',
      deviceId: parsed.deviceId ?? '',
      updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
      deletedAt: parsed.deletedAt ?? null
    }
  } catch {
    // A broken file must not break the whole sync.
    return null
  }
}

/** Makes an id safe to use as a file name. */
function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/gu, '_').slice(0, 120) || 'entry'
}

/** Renames a file, replacing the target on platforms that allow it. */
function renameSyncSafe(from: string, to: string): void {
  try {
    renameSync(from, to)
  } catch {
    // Some file systems refuse to replace an existing file — remove it
    // first and try again.
    rmSync(to, { force: true })
    renameSync(from, to)
  }
}
