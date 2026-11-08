/**
 * The E2EE sync contract.
 *
 * The sync travels in a file the user carries between the devices himself —
 * no server, no account, no background traffic. The file holds encrypted
 * blobs only: the device that reads it learns nothing without the master
 * password.
 *
 * A bundle holds the PBKDF2 parameters of the account and one replica per
 * (entity, device). The replicas are kept per device so two devices never
 * overwrite each other; the merge on the client takes the newest replica of
 * every entity. A replica that travels through a third device keeps
 * travelling, so a file can be passed along a chain of devices.
 */
import type { Host, SshKey, SyncBlob } from './types'

/** Entities that travel through the sync file. Tabs stay on the device. */
export type SyncEntity = 'hosts' | 'keys' | 'settings'

/** A sync entry as it appears in the file. */
export interface SyncEntry {
  entity: SyncEntity
  entityId: string
  version: number
  /** Base64 AES-GCM initialization vector. */
  iv: string
  /** Base64 ciphertext. */
  ciphertext: string
  /** Base64 GCM authentication tag. */
  tag: string
  /** The device that produced this replica. */
  deviceId: string
  updatedAt: string
  /** Soft-delete tombstone. */
  deletedAt: string | null
}

/** PBKDF2 parameters of the account, shared between devices. */
export interface SyncMasterParams {
  salt: string
  iterations: number
}

/** Marker of the bundle format. */
export const SYNC_FILE_FORMAT = 'reliquaryssh-sync'

/** The version of the bundle layout. */
export const SYNC_FILE_VERSION = 1

/** The name of the file the user carries between the devices. */
export const SYNC_FILE_NAME = 'reliquary-sync.json'

/** The file as it is written and read. */
export interface SyncBundle {
  format: typeof SYNC_FILE_FORMAT
  version: number
  /** When the bundle was made. */
  exportedAt: string
  /** The device that made it. */
  deviceId: string
  /** The PBKDF2 parameters — not a secret, but every device needs them. */
  kdf: SyncMasterParams | null
  /** One replica per (entity, device). */
  entries: SyncEntry[]
}

/** State of the sync engine as the renderer sees it. */
export interface SyncStatus {
  /** True when a master password is configured on this device. */
  configured: boolean
  /** True when the master key is loaded in memory. */
  unlocked: boolean
  /** Local changes waiting to be put into the next bundle. */
  pending: number
  /** Replicas this device knows — they travel in the next bundle. */
  replicas: number
  lastSyncAt: string | null
  lastError: string | null
}

/** Outcome of one sync run. */
export interface SyncResult {
  /** How many replicas went into the bundle. */
  exported: number
  /** How many replicas the file carried. */
  imported: number
  /** How many of them changed the local database. */
  applied: number
  skipped: number
  conflicts: number
  /** Replicas that could not be decrypted — another master password. */
  undecryptable: number
  syncedAt: string
}

/** Version vector of a row — the only input of the merge. */
export interface SyncVector {
  version: number
  updatedAt: string
}

/** The decrypted payload of a host entry. */
export interface HostPayload {
  kind: 'host'
  host: Host
  /** The master-password envelope of the host password, if there is one. */
  encryptedPassword?: string | null
}

/** The decrypted payload of a key entry. The private part stays encrypted. */
export interface KeyPayload {
  kind: 'key'
  key: SshKey
}

export type SyncPayload = HostPayload | KeyPayload

/**
 * True when the remote replica is newer than the local one.
 *
 * The version wins first; equal versions fall back to the timestamp. A row
 * that does not exist locally is always newer, and a tombstone takes part
 * in the same comparison as any other state — a delete is just a version.
 */
export function isRemoteNewer(local: SyncVector | null, remote: SyncVector): boolean {
  if (!local) return true
  if (remote.version !== local.version) return remote.version > local.version
  return remote.updatedAt > local.updatedAt
}

/** The side that survives a merge. */
export function pickWinner(local: SyncVector | null, remote: SyncVector): 'local' | 'remote' {
  return isRemoteNewer(local, remote) ? 'remote' : 'local'
}

/** Converts a blob into the wire entry the file accepts. */
export function createSyncEntry(params: {
  entity: SyncEntity
  entityId: string
  blob: SyncBlob
  version: number
  deviceId: string
  deletedAt?: string | null
}): SyncEntry {
  return {
    entity: params.entity,
    entityId: params.entityId,
    version: params.version,
    iv: params.blob.iv,
    ciphertext: params.blob.ciphertext,
    tag: params.blob.tag,
    deviceId: params.deviceId,
    updatedAt: params.blob.updated_at,
    deletedAt: params.deletedAt ?? null
  }
}

/** Restores the blob shape from a wire entry. */
export function entryToBlob(entry: SyncEntry): SyncBlob {
  return {
    version: 1,
    iv: entry.iv,
    ciphertext: entry.ciphertext,
    tag: entry.tag,
    updated_at: entry.updatedAt
  }
}

/**
 * Parses a bundle file.
 *
 * A broken file throws — the caller reports it to the user. A file of a
 * foreign format is rejected too: it is better to say so than to import
 * nothing silently.
 */
export function parseSyncBundle(text: string): SyncBundle {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('The file is not a valid sync file')
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('The file is not a valid sync file')
  }

  const bundle = parsed as Partial<SyncBundle>
  if (bundle.format !== SYNC_FILE_FORMAT) {
    throw new Error('The file is not a ReliquarySSH sync file')
  }
  if (bundle.version !== SYNC_FILE_VERSION) {
    throw new Error(`Unsupported sync file version: ${String(bundle.version)}`)
  }

  const entries: SyncEntry[] = []
  for (const item of bundle.entries ?? []) {
    if (!isSyncEntry(item)) continue
    entries.push(item)
  }

  const kdf = bundle.kdf
  const validKdf =
    kdf && typeof kdf.salt === 'string' && kdf.salt !== '' && typeof kdf.iterations === 'number'
      ? { salt: kdf.salt, iterations: kdf.iterations }
      : null

  return {
    format: SYNC_FILE_FORMAT,
    version: SYNC_FILE_VERSION,
    exportedAt: typeof bundle.exportedAt === 'string' ? bundle.exportedAt : '',
    deviceId: typeof bundle.deviceId === 'string' ? bundle.deviceId : '',
    kdf: validKdf,
    entries
  }
}

/** True when the value is a usable entry. */
function isSyncEntry(value: unknown): value is SyncEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Partial<SyncEntry>

  return (
    typeof entry.entity === 'string' &&
    typeof entry.entityId === 'string' &&
    typeof entry.ciphertext === 'string' &&
    typeof entry.deviceId === 'string' &&
    typeof entry.version === 'number' &&
    typeof entry.updatedAt === 'string'
  )
}
