/**
 * The export and import service.
 *
 * An export is a ZIP archive with the connections, the keys and the
 * versions that lost a merge. Two modes:
 *  - 'plain':  no secrets — hosts and public keys only;
 *  - 'sealed': the passwords and the private keys are included, encrypted
 *               with the master password.
 *
 * The import merges by id. The record with the newer updatedAt wins; the
 * loser is not deleted — it goes to the old folder, both locally and in
 * the archive, so the old password is never lost.
 */
import AdmZip from 'adm-zip'
import type { Host } from '@shared/types'
import {
  EXPORT_FILES,
  EXPORT_FORMAT_VERSION,
  type ExportConnections,
  type ExportKeys,
  type ExportManifest,
  type ExportOptions,
  type ExportSecrets,
  type ExportSuperseded,
  type ExportedConnection,
  type ExportedKey,
  type ImportResult
} from '@shared/export'
import { decryptWithMasterKey, type MasterKeyMaterial } from './crypto'
import type { Storage } from './storage'
import type { MasterPasswordManager } from './master-password'
import { logger } from './logger'

/** The payload of a superseded version: the host and its password. */
interface SupersededPayload {
  connection: ExportedConnection
  encryptedPassword: string | null
}

/** The export/import service of the main process. */
export class ExportService {
  constructor(
    private readonly storage: Storage,
    private readonly master: MasterPasswordManager
  ) {}

  /**
   * Builds the archive.
   *
   * A sealed export needs the master key: without it the passwords cannot
   * be included, and the archive is written in the plain mode instead.
   */
  async build(options: ExportOptions, appVersion = '0.1.0'): Promise<Buffer> {
    const material = options.mode === 'sealed' ? this.master.getMasterKey() : null

    if (options.mode === 'sealed' && !material) {
      throw new Error('The master password is locked — unlock it to export the secrets')
    }

    const connections = this.storage.hosts.list()
    const keys = options.includeKeys ? await this.storage.keys.list() : []
    const superseded = options.includeOld ? this.storage.superseded.list() : []

    const exportedConnections: ExportedConnection[] = connections.map((host) => ({
      ...host,
      hasPassword: Boolean(material && this.storage.passwords.has(host.id))
    }))

    const exportedKeys: ExportedKey[] = keys.map((key) => ({
      id: key.id,
      name: key.name,
      type: key.type,
      fingerprint: key.fingerprint,
      publicKey: key.publicKey,
      comment: key.comment,
      hasPassphrase: key.hasPassphrase,
      createdAt: key.createdAt,
      encryptedPrivateKey: material ? key.encryptedPrivateKey : null,
      privateKeyFormat: material ? key.privateKeyFormat : null
    }))

    const secrets: ExportSecrets = {
      passwords: {},
      privateKeys: {},
      kdf: material ? { salt: material.salt, iterations: material.iterations } : null
    }

    if (material) {
      for (const host of connections) {
        const stored = this.storage.passwords.get(host.id)
        if (stored) secrets.passwords[host.id] = stored.encryptedPassword
      }

      for (const key of keys) {
        secrets.privateKeys[key.id] = key.encryptedPrivateKey
      }
    }

    const manifest: ExportManifest = {
      version: EXPORT_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      mode: material ? 'sealed' : 'plain',
      appVersion,
      connectionCount: exportedConnections.length,
      keyCount: exportedKeys.length,
      supersededCount: superseded.length
    }

    const zip = new AdmZip()
    zip.addFile(EXPORT_FILES.manifest, Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'))
    zip.addFile(
      EXPORT_FILES.connections,
      Buffer.from(
        JSON.stringify({ connections: exportedConnections } satisfies ExportConnections, null, 2),
        'utf8'
      )
    )

    if (options.includeKeys) {
      zip.addFile(
        EXPORT_FILES.keys,
        Buffer.from(JSON.stringify({ keys: exportedKeys } satisfies ExportKeys, null, 2), 'utf8')
      )
    }

    if (material) {
      zip.addFile(
        EXPORT_FILES.secrets,
        Buffer.from(JSON.stringify(secrets, null, 2), 'utf8')
      )
    }

    // The old folder: one file per superseded version.
    for (const record of superseded) {
      let payload: SupersededPayload
      try {
        payload = JSON.parse(record.payload) as SupersededPayload
      } catch {
        continue
      }

      const entry: ExportSuperseded = {
        hostId: record.hostId,
        connection: payload.connection,
        encryptedPassword: payload.encryptedPassword,
        replacedAt: record.replacedAt,
        replacedBy: record.replacedBy,
        reason: record.reason
      }

      const stamp = record.replacedAt.replace(/[^0-9]/gu, '')
      zip.addFile(
        `${EXPORT_FILES.oldDirectory}/${record.hostId}-${stamp}.json`,
        Buffer.from(JSON.stringify(entry, null, 2), 'utf8')
      )
    }

    logger.info('The export was built', {
      mode: manifest.mode,
      connections: manifest.connectionCount,
      keys: manifest.keyCount,
      superseded: manifest.supersededCount
    })

    return zip.toBuffer()
  }

  /**
   * Reads an archive and merges it into the local database.
   *
   * @param material The master key of this device. It is needed to read
   *   the secrets of a sealed export and to store them.
   */
  async import(buffer: Buffer, material: MasterKeyMaterial | null): Promise<ImportResult> {
    const zip = new AdmZip(buffer)
    this.readManifest(zip)

    const connections = this.readConnections(zip)
    const keys = this.readKeys(zip)
    const secrets = this.readSecrets(zip)

    // A device that has no master password yet takes the salt of the
    // archive — that is how it derives the same key as the device that
    // made the export.
    const effectiveMaterial = material
    if (!effectiveMaterial && secrets?.kdf) {
      this.adoptKdf(secrets.kdf)
    }

    const result: ImportResult = {
      added: 0,
      updated: 0,
      unchanged: 0,
      superseded: 0,
      keysAdded: 0,
      undecryptable: 0,
      summary: ''
    }

    // The connections, one by one.
    for (const incoming of connections) {
      const local = this.storage.hosts.get(incoming.id)

      if (!local) {
        this.applyConnection(incoming, secrets, material)
        result.added++
        continue
      }

      // The newer record wins. The timestamps are ISO strings, so the
      // lexicographic order is the chronological one.
      if (incoming.updatedAt > local.updatedAt) {
        // The local version loses — it is kept, not deleted, together
        // with the password it had.
        this.storeSuperseded(
          local,
          this.localPasswordEnvelope(local.id),
          incoming.id,
          'newer'
        )
        result.superseded++

        this.applyConnection(incoming, secrets, material)
        result.updated++
        continue
      }

      // The incoming version is older — it loses. Its password goes to
      // the old folder too: that is the version the user may still need
      // (the old password of a host that was changed elsewhere).
      this.storeSuperseded(
        incoming,
        secrets?.passwords[incoming.id] ?? null,
        local.id,
        'newer'
      )
      result.superseded++
      result.unchanged++
    }

    // The keys.
    for (const incoming of keys) {
      const existing = await this.storage.keys.get(incoming.id)
      if (existing) continue

      const privateKey =
        incoming.encryptedPrivateKey ?? secrets?.privateKeys[incoming.id] ?? ''

      await this.storage.keys.save({
        id: incoming.id,
        name: incoming.name,
        type: incoming.type,
        fingerprint: incoming.fingerprint,
        publicKey: incoming.publicKey,
        encryptedPrivateKey: privateKey,
        privateKeyFormat: incoming.privateKeyFormat ?? 'openssh',
        hasPassphrase: incoming.hasPassphrase,
        comment: incoming.comment,
        createdAt: incoming.createdAt,
        updatedAt: incoming.createdAt,
        deletedAt: null,
        version: 1,
        deviceId: ''
      })
      result.keysAdded++
    }

    // The old folder of the archive comes back as superseded versions.
    for (const entry of this.readSuperseded(zip)) {
      this.storeSupersededPayload(entry)
      result.superseded++
    }

    result.summary = this.summarize(result)
    logger.info('The import finished', result)

    return result
  }

  /**
   * Adopts the PBKDF2 parameters of an archive.
   *
   * The salt belongs to the account, not to the device: it is stored, so
   * the master password the user enters after the import derives the same
   * key as on the device that made the export. The sealed passwords open
   * with it.
   */
  private adoptKdf(kdf: { salt: string; iterations: number }): void {
    if (this.master.has()) return

    this.storage.settings.set('importedKdf', JSON.stringify(kdf))
    logger.info('The archive brought the salt of the account', kdf)
  }

  /**
   * Opens the sealed passwords with the master key.
   *
   * The import may have brought passwords that were sealed with another
   * key. Once the user enters the master password of the account, they
   * open and are stored in the readable form.
   */
  async openSealedPasswords(material: MasterKeyMaterial): Promise<number> {
    let opened = 0

    for (const record of this.storage.passwords.list()) {
      try {
        const plaintext = decryptWithMasterKey(record.encryptedPassword, material)
        this.storage.passwords.save(record.hostId, plaintext, material, record.deviceId)
        opened++
      } catch {
        // The password belongs to another account — it stays sealed.
      }
    }

    if (opened > 0) logger.info(`Opened ${opened} sealed passwords`)
    return opened
  }

  /** Writes one connection into the local database. */
  private applyConnection(
    incoming: ExportedConnection,
    secrets: ExportSecrets | null,
    material: MasterKeyMaterial | null
  ): void {
    this.storage.hosts.save({
      ...incoming,
      deviceId: incoming.deviceId || ''
    })

    const envelope = secrets?.passwords[incoming.id]
    if (!envelope) return

    if (!material) {
      // The device has no master password yet. The sealed password is
      // stored as it is — it opens as soon as the user enters the master
      // password of the account.
      this.storage.passwords.saveSealed(incoming.id, envelope, incoming.deviceId || '')
      return
    }

    // The password of the archive was sealed with the master password of
    // the device that made the export. It can only be read when this
    // device derives the same key.
    try {
      const plaintext = decryptWithMasterKey(envelope, material)
      this.storage.passwords.save(incoming.id, plaintext, material, incoming.deviceId || '')
    } catch {
      // The master passwords differ — the password stays sealed. It is
      // kept, not lost: the user can unlock it with the account password.
      this.storage.passwords.saveSealed(incoming.id, envelope, incoming.deviceId || '')
      logger.warn(`The password of ${incoming.name} stays sealed`)
    }
  }

  /** Stores the local version that lost a merge. */
  private storeSuperseded(
    local: Host,
    encryptedPassword: string | null,
    replacedBy: string,
    reason: 'newer' | 'deleted'
  ): void {
    const connection: ExportedConnection = {
      ...local,
      hasPassword: Boolean(encryptedPassword)
    }

    this.storage.superseded.record({
      hostId: local.id,
      payload: { connection, encryptedPassword } satisfies SupersededPayload,
      replacedBy,
      reason
    })
  }

  /** Stores a superseded version that came from the archive. */
  private storeSupersededPayload(entry: ExportSuperseded): void {
    this.storage.superseded.record({
      hostId: entry.hostId,
      payload: {
        connection: entry.connection,
        encryptedPassword: entry.encryptedPassword
      } satisfies SupersededPayload,
      replacedBy: entry.replacedBy,
      reason: entry.reason === 'deleted' ? 'deleted' : 'newer',
      replacedAt: entry.replacedAt
    })
  }

  /** The sealed password of a local host, if it has one. */
  private localPasswordEnvelope(hostId: string): string | null {
    return this.storage.passwords.get(hostId)?.encryptedPassword ?? null
  }

  private readManifest(zip: AdmZip): ExportManifest {
    const entry = zip.getEntry(EXPORT_FILES.manifest)
    if (!entry) throw new Error('This file is not a ReliquarySSH export')

    const manifest = JSON.parse(entry.getData().toString('utf8')) as ExportManifest

    if (manifest.version > EXPORT_FORMAT_VERSION) {
      throw new Error(
        `The export was made by a newer version of the app (format ${manifest.version})`
      )
    }

    return manifest
  }

  private readConnections(zip: AdmZip): ExportedConnection[] {
    const entry = zip.getEntry(EXPORT_FILES.connections)
    if (!entry) return []

    try {
      const parsed = JSON.parse(entry.getData().toString('utf8')) as ExportConnections
      return Array.isArray(parsed.connections) ? parsed.connections : []
    } catch {
      return []
    }
  }

  private readKeys(zip: AdmZip): ExportedKey[] {
    const entry = zip.getEntry(EXPORT_FILES.keys)
    if (!entry) return []

    try {
      const parsed = JSON.parse(entry.getData().toString('utf8')) as ExportKeys
      return Array.isArray(parsed.keys) ? parsed.keys : []
    } catch {
      return []
    }
  }

  private readSecrets(zip: AdmZip): ExportSecrets | null {
    const entry = zip.getEntry(EXPORT_FILES.secrets)
    if (!entry) return null

    try {
      return JSON.parse(entry.getData().toString('utf8')) as ExportSecrets
    } catch {
      return null
    }
  }

  private readSuperseded(zip: AdmZip): ExportSuperseded[] {
    const entries = zip
      .getEntries()
      .filter(
        (entry) =>
          entry.entryName.startsWith(`${EXPORT_FILES.oldDirectory}/`) &&
          entry.entryName.endsWith('.json')
      )

    const result: ExportSuperseded[] = []

    for (const entry of entries) {
      try {
        result.push(JSON.parse(entry.getData().toString('utf8')) as ExportSuperseded)
      } catch {
        // A broken file in the old folder must not break the import.
      }
    }

    return result
  }

  private summarize(result: ImportResult): string {
    const parts: string[] = []

    if (result.added > 0) parts.push(`${result.added} added`)
    if (result.updated > 0) parts.push(`${result.updated} updated`)
    if (result.unchanged > 0) parts.push(`${result.unchanged} unchanged`)
    if (result.superseded > 0) parts.push(`${result.superseded} moved to old`)
    if (result.keysAdded > 0) parts.push(`${result.keysAdded} keys added`)

    return parts.length > 0 ? parts.join(', ') : 'Nothing to import'
  }
}
