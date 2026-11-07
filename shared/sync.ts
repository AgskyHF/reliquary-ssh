/**
 * The E2EE sync contract.
 *
 * The client encrypts every entity with the master key and uploads an
 * opaque blob. The backend stores the blob as-is and never sees plaintext.
 *
 * An entry is identified by (user, device, entity, entityId) on the server,
 * so a repeated push of the same entity from the same device updates one
 * row instead of creating another. Merge across devices happens on the
 * client with last-write-wins on (version, updatedAt).
 */
import type { Host, SshKey, SyncBlob } from './types'

/** Entities that travel through the backend. Tabs stay on the device. */
export type SyncEntity = 'hosts' | 'keys' | 'settings'

/** A sync entry as it appears on the wire. */
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

/**
 * The settings entry that carries the PBKDF2 salt.
 *
 * The salt is not a secret — it only has to be the same on every device so
 * the same master password derives the same key. Without it a second
 * device could never decrypt the data of the first one, and the blob
 * format has no salt field of its own.
 */
export const KDF_ENTITY: SyncEntity = 'settings'
export const KDF_ENTITY_ID = 'sync.kdf'

/** Marker prefix of the KDF payload, so it cannot be confused with a blob. */
export const KDF_PAYLOAD_PREFIX = 'reliquaryssh-kdf-v1:'

/** State of the sync engine as the renderer sees it. */
export interface SyncStatus {
  signedIn: boolean
  /** True when a master password is configured on this device. */
  configured: boolean
  /** True when the master key is loaded in memory. */
  unlocked: boolean
  /** Local changes waiting to be pushed. */
  pending: number
  lastSyncAt: string | null
  lastError: string | null
}

/** What the renderer additionally learns for the sync screen. */
export interface SyncStatusView extends SyncStatus {
  serverUrl: string
  /** True when the signed-in account already has a salt on the server. */
  remoteKdf: boolean
}

/** Outcome of one sync run. */
export interface SyncResult {
  pushed: number
  pulled: number
  applied: number
  skipped: number
  conflicts: number
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

/** Converts a blob into the wire entry the backend accepts. */
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
