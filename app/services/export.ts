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
import { decryptWithMasterKey, encryptWithMasterKey, type MasterKeyMaterial } from './crypto'
import type { Storage } from './storage'
import type { MasterPasswordManager } from './master-password'
import { logger } from './logger'

/** The decrypted value of an envelope, or null when the key does not fit. */
function decryptOrNull(envelope: string, material: MasterKeyMaterial): string | null {
  try {
    return decryptWithMasterKey(envelope, material)
  } catch {
    return null
  }
}

/** The payload of a superseded version: the host and its password. */
interface SupersededPayload {
  connection: ExportedConnection
  encryptedPassword: string | null
}

/** What an export produced. */
export interface ExportBuildResult {
  /** The archive itself. */
  buffer: Buffer
  /** How many passwords went into it. */
  passwords: number
  /** How many could not be read — they are sealed with a key this device lacks. */
  unreadable: number
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
   * The passwords need no password of their own: with the option on they
   * go into the archive as they are, so any device that imports it has
   * them. Without the option the archive carries no secret at all.
   */
  async build(options: ExportOptions, appVersion = '0.1.0'): Promise<ExportBuildResult> {
    const withPasswords = options.mode === 'with-passwords'
    // The private keys travel sealed — a key needs a master password on
    // the other side anyway, and it is not what this option is about.
    const material = this.master.getMasterKey()

    const connections = this.storage.hosts.list()
    const keys = options.includeKeys ? await this.storage.keys.list() : []
    const superseded = options.includeOld ? this.storage.superseded.list() : []

    const exportedConnections: ExportedConnection[] = connections.map((host) => ({
      ...host,
      hasPassword: withPasswords && this.storage.passwords.has(host.id)
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
      format: 'plain',
      passwords: {},
      privateKeys: {},
      kdf: null
    }

    // A password that cannot be read is counted, not ignored: the user
    // has to know that the archive came out without it.
    let unreadable = 0

    if (withPasswords) {
      for (const host of connections) {
        if (!this.storage.passwords.has(host.id)) continue

        const plaintext = this.plaintextPassword(host.id)
        if (plaintext === null) {
          unreadable++
          continue
        }
        secrets.passwords[host.id] = plaintext
      }

      // A private key is a secret too, so it goes with the same option.
      // It travels sealed: a key needs a master password on the other
      // side anyway.
      if (material) {
        for (const key of keys) {
          secrets.privateKeys[key.id] = key.encryptedPrivateKey
        }
      }
    }

    const manifest: ExportManifest = {
      version: EXPORT_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      mode: withPasswords ? 'with-passwords' : 'without-passwords',
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

    // The secrets file exists only when there is something to carry.
    // Without the option the archive holds no password at all.
    const hasSecrets =
      Object.keys(secrets.passwords).length > 0 || Object.keys(secrets.privateKeys).length > 0

    if (hasSecrets) {
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
      superseded: manifest.supersededCount,
      passwords: Object.keys(secrets.passwords).length,
      unreadable
    })

    return {
      buffer: zip.toBuffer(),
      passwords: Object.keys(secrets.passwords).length,
      unreadable
    }
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
    // A 'plain' archive carries the passwords as they are. They are
    // sealed with the key of this device right away, so the rest of the
    // import works with one shape: an envelope it can store and read.
    const secrets = this.normalizeSecrets(this.readSecrets(zip))

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
      passwords: 0,
      summary: ''
    }

    // The connections, one by one.
    for (const incoming of connections) {
      const local = this.storage.hosts.get(incoming.id)

      if (!local) {
        // The host was deleted here. The tombstone is still in the
        // database, but the host does not exist for the user — so the
        // import brings it back, right away, as a live host. It does not
        // go to the old folder: there is nothing to restore it from.
        const tombstone = this.storage.hosts.getIncludingDeleted(incoming.id)

        if (tombstone) {
          if (this.applyConnection(incoming, secrets, material, tombstone.id)) result.passwords++
          result.added++
          continue
        }

        // The same host may exist under another id — it was created
        // again on another device. The endpoint decides.
        const same = this.storage.hosts.findByEndpoint(incoming)
        if (same) {
          this.mergeInto(incoming, same, secrets, material, result)
          continue
        }

        if (this.applyConnection(incoming, secrets, material)) result.passwords++
        result.added++
        continue
      }

      this.mergeInto(incoming, local, secrets, material, result)
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

  /**
   * Brings the secrets of an archive to one shape.
   *
   * A 'plain' archive (the current one) carries the passwords as they
   * are: they are sealed here, with the key of this device, and the
   * result is the same envelope the rest of the code already handles.
   * A sealed archive of an older build is taken as it is.
   */
  private normalizeSecrets(secrets: ExportSecrets | null): ExportSecrets | null {
    if (!secrets || secrets.format !== 'plain') return secrets

    const material = this.master.deviceKey()
    const passwords: Record<string, string> = {}

    for (const [hostId, plaintext] of Object.entries(secrets.passwords ?? {})) {
      if (typeof plaintext !== 'string' || plaintext === '') continue
      passwords[hostId] = encryptWithMasterKey(plaintext, material)
    }

    return { ...secrets, format: 'sealed', passwords }
  }

  /** Writes one connection into the local database. */
  private applyConnection(
    incoming: ExportedConnection,
    secrets: ExportSecrets | null,
    material: MasterKeyMaterial | null,
    targetId?: string
  ): boolean {
    const id = targetId ?? incoming.id

    this.storage.hosts.save({
      ...incoming,
      id,
      // The host comes back to life — the tombstone of the deleted row
      // must not travel with it.
      deletedAt: null,
      deviceId: incoming.deviceId || ''
    })

    const envelope = secrets?.passwords[incoming.id]
    if (!envelope) return false

    // The envelope is sealed with the key of this device — that is what
    // normalizeSecrets makes of a plain archive. The master key of an
    // older archive is tried too, so its passwords open here.
    const device = this.master.deviceKey()
    const plaintext =
      decryptOrNull(envelope, device) ?? (material ? decryptOrNull(envelope, material) : null)

    if (plaintext !== null) {
      this.storage.passwords.save(id, plaintext, device, incoming.deviceId || '')
      return true
    }

    // The password belongs to another key — it is kept, not lost: it
    // opens when the master password of that account is entered.
    this.storage.passwords.saveSealed(id, envelope, incoming.deviceId || '')
    logger.warn(`The password of ${incoming.name} stays sealed`)
    return true
  }

  /**
   * Merges an incoming version into the local one.
   *
   * The newer record wins — the dates decide, not the ids. The loser is
   * not deleted: it goes to the old folder with the password it had, so
   * the old password is never lost.
   */
  private mergeInto(
    incoming: ExportedConnection,
    local: Host,
    secrets: ExportSecrets | null,
    material: MasterKeyMaterial | null,
    result: ImportResult
  ): void {
    // The newer record wins. The timestamps are ISO strings, so the
    // lexicographic order is the chronological one.
    if (incoming.updatedAt > local.updatedAt) {
      // The local version loses — it is kept, not deleted, together
      // with the password it had.
      //
      // The winner is stored under the local id: the host keeps its
      // place in the list, only its content changes.
      this.storeSuperseded(
        local,
        this.localPasswordEnvelope(local.id),
        local.id,
        'newer'
      )
      result.superseded++

      if (this.applyConnection(incoming, secrets, material, local.id)) result.passwords++
      result.updated++
      return
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

  /**
   * Stores the local version that lost a merge.
   *
   * The same version can be stored again and again — every import of the
   * same archive would add another copy of it. One copy per host and
   * per version is enough: the old folder is a list of versions, not a
   * log of the imports.
   */
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

    if (this.touchSame(connection)) return

    this.storage.superseded.record({
      hostId: local.id,
      payload: { connection, encryptedPassword } satisfies SupersededPayload,
      replacedBy,
      reason
    })
  }

  /**
   * Finds the same version in the old folder and moves it up.
   *
   * The comparison is the connection itself: the password travels in an
   * envelope, and the same password is sealed with a fresh IV every time,
   * so comparing the bytes would pile up copies of one version.
   */
  private touchSame(connection: ExportedConnection): boolean {
    const key = JSON.stringify(connection)
    const existing = this.storage.superseded.listForHost(connection.id).find((record) => {
      try {
        const parsed = JSON.parse(record.payload) as SupersededPayload
        return JSON.stringify(parsed.connection) === key
      } catch {
        return false
      }
    })

    if (!existing) return false
    this.storage.superseded.touch(existing.id)
    return true
  }

  /** Stores a superseded version that came from the archive. */
  private storeSupersededPayload(entry: ExportSuperseded): void {
    // The archive can be imported more than once — the version it
    // carries is stored once, not once per import.
    if (this.touchSame(entry.connection)) return

    this.storage.superseded.record({
      hostId: entry.hostId,
      payload: {
        connection: entry.connection,
        encryptedPassword: entry.encryptedPassword ?? null
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

  /**
   * The plaintext password of a host, or null when it cannot be read.
   *
   * The passwords are sealed with the device secret of this Mac. One that
   * was sealed with a master password by an older build opens with it,
   * and is sealed again with the device secret while it is at hand —
   * otherwise it would need that password every time.
   */
  private plaintextPassword(hostId: string): string | null {
    const device = this.master.deviceKey()
    const direct = this.storage.passwords.reveal(hostId, device)
    if (direct !== null) return direct

    const material = this.master.getMasterKey()
    if (!material) return null

    const sealed = this.storage.passwords.reveal(hostId, material)
    if (sealed === null) return null

    this.storage.passwords.save(hostId, sealed, device)
    logger.info('A password was sealed with the key of this device again', { hostId })
    return sealed
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
    if (result.passwords > 0) parts.push(`${result.passwords} with a password`)

    return parts.length > 0 ? parts.join(', ') : 'Nothing to import'
  }
}
