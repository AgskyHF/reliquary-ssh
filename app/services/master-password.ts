/**
 * Master-password manager.
 *
 * The master password encrypts the private keys and the synced data. It is
 * never stored — only the derived key material is, encrypted with a
 * device-bound secret so the file is useless on another machine.
 *
 * The key material stays in memory only while the app is unlocked:
 *  - on startup the manager only learns that a password was configured;
 *  - `unlock(password)` verifies the password and loads the material;
 *  - `lock()` drops the material from memory.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { MasterStatus } from '@shared/types'
import { KDF_ITERATIONS } from '@shared/crypto'
import type { SyncMasterParams } from '@shared/sync'
import {
  MASTER_MARKER,
  createMasterKey,
  decryptWithMasterKey,
  encryptWithMasterKey,
  verifyMasterPassword,
  type MasterKeyMaterial
} from './crypto'

interface MasterStoreFile {
  version: number
  /** The key material, encrypted with the device secret. */
  material: string
  /** Encrypted marker used to verify a password. */
  check: string
  /** PBKDF2 iterations of the account; missing in files of older builds. */
  iterations?: number
}

export class MasterPasswordManager {
  /** The key material, in memory only while unlocked. */
  private material: MasterKeyMaterial | null = null

  /** The stored material, encrypted with the device secret. */
  private stored: MasterStoreFile | null = null

  private configured = false

  /**
   * Reads the PBKDF2 parameters an import brought.
   *
   * The import writes them into the settings table; the manager does not
   * know the table, so the caller provides the reader.
   */
  readImportedKdf: (() => string | null) | null = null

  constructor(
    private readonly filePath: string,
    /** Device-bound secret the stored material is encrypted with. */
    private readonly deviceSecret: Buffer
  ) {}

  /**
   * Loads the stored file. The material itself stays locked — it is only
   * put into memory after `unlock()` verifies the password.
   */
  init(): void {
    const stored = this.read()
    if (!stored) {
      this.configured = false
      this.stored = null
      return
    }

    this.stored = stored
    this.configured = true
  }

  /** True when a master password has been configured. */
  has(): boolean {
    return this.configured
  }

  /** True when the key material is loaded in memory. */
  get unlocked(): boolean {
    return this.material !== null
  }

  /** The current status for the renderer. */
  status(): MasterStatus {
    return { unlocked: this.unlocked, configured: this.configured }
  }

  /**
   * Sets the master password. The password itself is never stored — only
   * the derived key and a verification marker.
   *
   * `kdf` carries the PBKDF2 parameters of the account. A device that joins
   * an existing account must reuse them, otherwise the same password would
   * derive a different key and the synced data would be unreadable.
   *
   * When no parameters are given, the ones an import brought are used —
   * that is how a second device of the same account derives the same key.
   */
  async set(password: string, kdf?: SyncMasterParams): Promise<MasterStatus> {
    if (!password) throw new Error('The master password must not be empty')

    const params = kdf ?? this.importedKdf()

    const salt = params ? Buffer.from(params.salt, 'base64') : undefined
    const iterations = params?.iterations ?? KDF_ITERATIONS
    const material = createMasterKey(password, salt, iterations)
    const stored: MasterStoreFile = {
      version: 1,
      material: encryptWithMasterKey(JSON.stringify(material), this.deviceMaterial()),
      check: encryptWithMasterKey(MASTER_MARKER, material),
      iterations
    }

    this.write(stored)
    this.stored = stored
    this.material = material
    this.configured = true

    return this.status()
  }

  /**
   * The PBKDF2 parameters an import brought, or null when there are none.
   *
   * They are read from the settings table, which the import filled. A
   * device that imported a sync file adopts them, so the same master
   * password derives the same key as on the other devices.
   */
  getImportedParams(): SyncMasterParams | null {
    return this.importedKdf()
  }

  /** The PBKDF2 parameters an import brought, or null when there are none. */
  private importedKdf(): SyncMasterParams | null {
    try {
      const raw = this.readImportedKdf?.()
      if (!raw) return null

      const parsed = JSON.parse(raw) as Partial<SyncMasterParams>
      if (typeof parsed.salt !== 'string' || !parsed.salt) return null
      if (typeof parsed.iterations !== 'number' || parsed.iterations <= 0) return null

      return { salt: parsed.salt, iterations: parsed.iterations }
    } catch {
      return null
    }
  }

  /**
   * Verifies the password and loads the key material into memory.
   * The verification uses the marker envelope, which carries its own salt.
   */
  unlock(password: string): boolean {
    if (!this.configured || !this.stored) return false

    if (!verifyMasterPassword(this.stored.check, password, this.iterations())) return false

    try {
      const material = JSON.parse(
        decryptWithMasterKey(this.stored.material, this.deviceMaterial())
      ) as MasterKeyMaterial
      this.material = material
      return true
    } catch {
      // The stored material cannot be decrypted — the device secret changed.
      this.material = null
      return false
    }
  }

  /** Checks a password without unlocking the keychain. */
  verify(password: string): boolean {
    if (!this.configured || !this.stored) return false
    return verifyMasterPassword(this.stored.check, password, this.iterations())
  }

  /** The PBKDF2 parameters of this device's material, or null when locked. */
  getParams(): SyncMasterParams | null {
    if (!this.material) return null
    return { salt: this.material.salt, iterations: this.material.iterations }
  }

  /** PBKDF2 iterations of the stored file; older files predate the field. */
  private iterations(): number {
    return this.stored?.iterations ?? KDF_ITERATIONS
  }

  /** Drops the key material from memory. */
  lock(): void {
    this.material = null
  }

  /** The master key material, or null when the app is locked. */
  getMasterKey(): MasterKeyMaterial | null {
    return this.material
  }

  /** The device-bound key the stored material is encrypted with. */
  private deviceMaterial(): MasterKeyMaterial {
    return {
      key: this.deviceSecret.toString('base64'),
      salt: this.deviceSecret.toString('base64'),
      iterations: 1
    }
  }

  private read(): MasterStoreFile | null {
    if (!existsSync(this.filePath)) return null
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<MasterStoreFile>
      if (typeof parsed.material !== 'string' || typeof parsed.check !== 'string') return null
      return parsed as MasterStoreFile
    } catch {
      return null
    }
  }

  private write(data: MasterStoreFile): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
      renameSync(tmp, this.filePath)
    } catch (error) {
      rmSync(tmp, { force: true })
      throw error
    }
  }
}
