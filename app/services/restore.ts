/**
 * The restore of a replaced version.
 *
 * The versions that lost a merge are kept so the user can go back to
 * them. Restoring one is a merge in reverse: the old version becomes the
 * current one, and the version it replaces goes to the old folder in its
 * turn — nothing is ever deleted.
 */
import type { Host } from '@shared/types'
import type { ExportedConnection } from '@shared/export'
import type { Storage } from './storage'
import { decryptWithMasterKey, type MasterKeyMaterial } from './crypto'
import { logger } from './logger'

/** What a restore did. */
export interface RestoreResult {
  /** The host that was restored. */
  hostId: string
  /** The version that was restored. */
  version: string
  /** True when the password of the old version came back too. */
  passwordRestored: boolean
  /** True when the version that was replaced went to the old folder. */
  replacedSaved: boolean
  summary: string
}

export class RestoreService {
  constructor(private readonly storage: Storage) {}

  /**
   * Restores a superseded version.
   *
   * The old version becomes the current one, with a fresh timestamp — it
   * is newer than everything else now, so it wins the next merge. The
   * version it replaces goes to the old folder.
   */
  restore(
    supersededId: string,
    material: MasterKeyMaterial | null
  ): RestoreResult {
    const record = this.storage.superseded.list().find((item) => item.id === supersededId)
    if (!record) throw new Error('Unknown replaced version')

    const payload = JSON.parse(record.payload) as {
      connection?: ExportedConnection
      encryptedPassword?: string | null
    }

    const connection = payload.connection
    if (!connection) throw new Error('The replaced version is broken')

    const now = new Date().toISOString()

    // The version that is current now goes to the old folder — the
    // restore must not destroy anything either.
    const current = this.storage.hosts.get(record.hostId)
    let replacedSaved = false

    if (current) {
      this.storage.superseded.record({
        hostId: current.id,
        payload: {
          connection: { ...current, hasPassword: this.hasPassword(current.id) },
          encryptedPassword: this.passwordEnvelope(current.id)
        },
        replacedBy: record.replacedBy,
        reason: 'newer',
        deviceId: current.deviceId
      })
      replacedSaved = true
    }

    // The old version comes back, with a fresh timestamp so it wins the
    // next merge.
    const restored: Host = {
      ...connection,
      updatedAt: now,
      version: (current?.version ?? connection.version) + 1,
      deletedAt: null
    }

    this.storage.hosts.save(restored)

    // Its password comes back too, when it can be read.
    let passwordRestored = false
    const envelope = payload.encryptedPassword

    if (envelope && material) {
      try {
        const plaintext = decryptWithMasterKey(envelope, material)
        this.storage.passwords.save(restored.id, plaintext, material, restored.deviceId)
        passwordRestored = true
      } catch {
        // The password belongs to another key — the version comes back
        // without it, and it is kept sealed.
        this.storage.passwords.saveSealed(restored.id, envelope, restored.deviceId)
      }
    } else if (envelope) {
      // No master key — the password stays sealed.
      this.storage.passwords.saveSealed(restored.id, envelope, restored.deviceId)
    }

    // The journal must know about the change, so it reaches the other
    // devices.
    this.storage.changes.record({
      id: crypto.randomUUID(),
      entity: 'hosts',
      entityId: restored.id,
      operation: 'upsert',
      payload: JSON.stringify(restored),
      synced: false,
      createdAt: now,
      updatedAt: now,
      version: restored.version,
      deviceId: restored.deviceId
    })

    const summary = passwordRestored
      ? `Restored ${connection.name} with its password`
      : `Restored ${connection.name}`

    logger.info('A replaced version was restored', { hostId: restored.id, passwordRestored })

    return {
      hostId: restored.id,
      version: connection.name,
      passwordRestored,
      replacedSaved,
      summary
    }
  }

  /** True when the host has a stored password. */
  private hasPassword(hostId: string): boolean {
    return this.storage.passwords.has(hostId)
  }

  /** The sealed password of a host, if it has one. */
  private passwordEnvelope(hostId: string): string | null {
    return this.storage.passwords.get(hostId)?.encryptedPassword ?? null
  }
}
