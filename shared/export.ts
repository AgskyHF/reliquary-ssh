/**
 * The export/import format.
 *
 * An export is a ZIP archive. The layout:
 *
 *   manifest.json          the version, the export time and the options
 *   connections.json       the hosts, in full
 *   keys.json              the SSH keys (public part and metadata)
 *   secrets.json           the encrypted passwords and private keys
 *   old/                   the versions that lost a merge — never deleted
 *     connections-<ts>.json
 *
 * Two kinds of export:
 *  - 'plain':   no secrets at all — hosts and public keys only;
 *  - 'sealed':  the passwords and the private keys are included, encrypted
 *               with the master password (the same envelope the app uses
 *               at rest).
 *
 * A sealed export is only readable with the master password it was made
 * with, so moving it to another device means entering that password once
 * during the import.
 */
import type { Host, KeySummary } from './types'

/** The version of the export format. */
export const EXPORT_FORMAT_VERSION = 1

/** The name of the archive the app writes and reads. */
export const EXPORT_FILE_NAME = 'reliquary-export.zip'

/** The kinds of export. */
export type ExportMode = 'plain' | 'sealed'

/** The file names inside the archive. */
export const EXPORT_FILES = {
  manifest: 'manifest.json',
  connections: 'connections.json',
  keys: 'keys.json',
  secrets: 'secrets.json',
  oldDirectory: 'old'
} as const

/** The manifest — the header of the archive. */
export interface ExportManifest {
  /** The version of the format. */
  version: number
  /** When the export was made. */
  exportedAt: string
  /** 'plain' or 'sealed'. */
  mode: ExportMode
  /** The app version that made the export. */
  appVersion: string
  /** How many hosts the export carries. */
  connectionCount: number
  /** How many keys the export carries. */
  keyCount: number
  /** How many superseded versions travel with the export. */
  supersededCount: number
}

/** A host in the export — the same shape as the app stores. */
export interface ExportedConnection extends Host {
  /** True when the export carries the password of this host. */
  hasPassword: boolean
}

/** A key in the export. The private part is never in clear text. */
export interface ExportedKey extends KeySummary {
  /** The encrypted private key — only in a sealed export. */
  encryptedPrivateKey: string | null
  /** The format of the private key, e.g. 'openssh'. */
  privateKeyFormat: string | null
}

/** The sealed secrets of a sealed export. */
export interface ExportSecrets {
  /** The encrypted passwords, by host id. */
  passwords: Record<string, string>
  /** The encrypted private keys, by key id. */
  privateKeys: Record<string, string>
  /** The PBKDF2 parameters, so the other device derives the same key. */
  kdf: { salt: string; iterations: number } | null
}

/** The connections part of the archive. */
export interface ExportConnections {
  connections: ExportedConnection[]
}

/** The keys part of the archive. */
export interface ExportKeys {
  keys: ExportedKey[]
}

/** The old folder of the archive — one file per merge. */
export interface ExportSuperseded {
  /** The host the version belonged to. */
  hostId: string
  /** The version that lost. */
  connection: ExportedConnection
  /** The encrypted password of that version, when the export is sealed. */
  encryptedPassword: string | null
  /** When it was replaced. */
  replacedAt: string
  /** The id of the version that won. */
  replacedBy: string
  /** Why it was replaced: 'newer' or 'deleted'. */
  reason: string
}

/** The result of an import. */
export interface ImportResult {
  /** The hosts that were added. */
  added: number
  /** The hosts that were updated by a newer version. */
  updated: number
  /** The hosts that stayed as they were. */
  unchanged: number
  /** The versions that were moved to the old folder. */
  superseded: number
  /** The keys that were added. */
  keysAdded: number
  /** The hosts whose password could not be decrypted. */
  undecryptable: number
  /** A readable summary for the UI. */
  summary: string
}

/** The options of an export. */
export interface ExportOptions {
  mode: ExportMode
  /** Include the SSH keys (the public parts, or the sealed private ones). */
  includeKeys: boolean
  /** Include the superseded versions. */
  includeOld: boolean
}
