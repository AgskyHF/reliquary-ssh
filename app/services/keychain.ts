/**
 * Keychain service — the SSH key manager of the main process.
 *
 * The service owns every key operation: generation, import, export and
 * deletion. Private keys are never returned to the renderer in plaintext and
 * never stored unencrypted — they are encrypted with the master password
 * before they touch the storage layer.
 *
 * Storage is behind the KeyRepository interface. Stage 6 swaps the JSON
 * implementation for SQLite without touching the service.
 */
import ssh2, { type ParsedKey } from 'ssh2'

// ssh2 is a CommonJS module: the ESM build of the main process cannot use
// named imports for it, so the namespace is imported as a default.
const { utils: sshUtils } = ssh2
import { createHash } from 'node:crypto'
import {
  KeyType,
  type SshKey
} from '@shared/types'
import {
  decryptWithMasterKey,
  encryptWithMasterKey,
  type MasterKeyMaterial
} from './crypto'

export interface KeyRepository {
  list(): Promise<SshKey[]>
  save(key: SshKey): Promise<SshKey>
  remove(id: string): Promise<void>
  get(id: string): Promise<SshKey | null>
}

export interface GenerateKeyRequest {
  name: string
  /** 'rsa' | 'ed25519' | 'ecdsa' */
  type: string
  passphrase?: string
  comment?: string
  /** RSA modulus size; ignored for other types. */
  bits?: number
}

export interface ImportKeyRequest {
  name: string
  /** The private key in OpenSSH/PEM format. */
  privateKey: string
  passphrase?: string
  comment?: string
}

/** The private key never leaves the main process in plaintext. */
export interface KeySummary {
  id: string
  name: string
  type: KeyType
  fingerprint: string
  publicKey: string
  comment: string
  hasPassphrase: boolean
  createdAt: string
}

/** Maps the public key type to the app's own key type enum. */
function detectKeyType(parsed: ParsedKey): KeyType {
  const type = parsed.type.toLowerCase()
  if (type.includes('ed25519')) return KeyType.ED25519
  if (type.includes('ecdsa')) return KeyType.ECDSA
  return KeyType.RSA
}

/**
 * Computes the OpenSSH-style SHA256 fingerprint of a public key:
 * "SHA256:base64(sha256(blob))" without the padding, where blob is the
 * base64-decoded body of the public key line.
 */
export function fingerprintFromPublicKey(publicKey: string): string {
  const body = publicKey.trim().split(/\s+/u)[1] ?? ''
  const blob = Buffer.from(body, 'base64')
  const digest = createHash('sha256').update(blob).digest('base64')
  return `SHA256:${digest.replace(/=+$/u, '')}`
}

/**
 * The SSH wire format of a public key: a length-prefixed type string
 * followed by the key material. This is the blob the OpenSSH one-line
 * format is built from.
 */
function publicKeyBlob(parsed: ParsedKey): Buffer {
  return parsed.getPublicSSH()
}

/**
 * Encodes a public key as a single OpenSSH line ("ssh-ed25519 AAAA... comment").
 *
 * ssh2's getPublicSSH() returns the wire blob ("ssh-ed25519" + key material),
 * while the OpenSSH format wants the type and the base64 of the same blob.
 */
function publicKeyLine(parsed: ParsedKey, comment?: string): string {
  const blob = publicKeyBlob(parsed)

  // The blob starts with a length-prefixed type string.
  const typeLength = blob.readUInt32BE(0)
  const type = blob.subarray(4, 4 + typeLength).toString('utf8')

  const tail = comment ?? parsed.comment ?? ''
  return tail ? `${type} ${blob.toString('base64')} ${tail}` : `${type} ${blob.toString('base64')}`
}

/** Parses a private key, throwing a readable error on failure. */
function parsePrivateKey(data: string, passphrase?: string): ParsedKey {
  const parsed = sshUtils.parseKey(data, passphrase)
  if (parsed instanceof Error) {
    throw new Error(
      passphrase
        ? `Could not parse the private key: ${parsed.message}`
        : `Could not parse the private key (is it encrypted?): ${parsed.message}`
    )
  }
  return parsed
}

/**
 * Generates a key pair and verifies that the private key can be parsed back.
 *
 * ssh2 1.17 has a bug: `generateKeyPair` occasionally produces a malformed
 * OpenSSH private key for ed25519 (roughly 1 in 300 runs). The key is
 * therefore validated and regenerated when it does not parse.
 */
async function generateKeyPair(
  type: 'rsa' | 'ed25519' | 'ecdsa',
  options: Record<string, unknown>,
  attempts = 5
): Promise<{ private: string; public: string }> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt < attempts; attempt++) {
    const pair = await new Promise<{ private: string; public: string }>((resolve, reject) => {
      sshUtils.generateKeyPair(
        type as 'rsa',
        options as never,
        (error, keyPair) => (error ? reject(error) : resolve(keyPair))
      )
    })

    const parsed = sshUtils.parseKey(pair.private, options.passphrase as string | undefined)
    if (!(parsed instanceof Error)) return pair

    lastError = parsed
  }

  throw new Error(
    `Could not generate a valid key after ${attempts} attempts: ${lastError?.message ?? 'unknown error'}`
  )
}

/** Keychain service. */
export class KeychainService {
  /**
   * @param repository Storage for the key metadata and encrypted private parts.
   * @param deviceKey  The key of the device; private keys are encrypted with it.
   * @param masterKey  The master key material, when the app is unlocked.
   *   Only the keys of an older build need it — they were sealed with it.
   */
  constructor(
    private readonly repository: KeyRepository,
    private readonly deviceKey: MasterKeyMaterial,
    private readonly masterKey: () => MasterKeyMaterial | null = () => null
  ) {}

  /** All keys, newest first. Private parts are never included. */
  async list(): Promise<KeySummary[]> {
    const keys = await this.repository.list()
    return keys
      .filter((key) => !key.deletedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((key) => this.toSummary(key))
  }

  /** Generates a new key pair and stores it encrypted. */
  async generate(request: GenerateKeyRequest): Promise<KeySummary> {
    const name = request.name.trim()
    if (!name) throw new Error('The key needs a name')

    const type = request.type as 'rsa' | 'ed25519' | 'ecdsa'
    if (![KeyType.RSA, KeyType.ED25519, KeyType.ECDSA].includes(type as KeyType)) {
      throw new Error(`Unsupported key type: ${request.type}`)
    }

    const comment = request.comment?.trim() || name
    const passphrase = request.passphrase?.trim() || undefined

    const options: Record<string, unknown> = { comment }
    if (type === 'rsa') options.bits = request.bits ?? 3072
    if (type === 'ecdsa') options.bits = 256
    if (passphrase) {
      options.passphrase = passphrase
      options.cipher = 'aes256-cbc'
      options.rounds = 128
    }

    const pair = await generateKeyPair(type, options)

    const parsed = parsePrivateKey(pair.private, passphrase)
    const publicKey = publicKeyLine(parsed, comment)

    const now = new Date().toISOString()
    const key: SshKey = {
      id: createId(),
      name,
      type: detectKeyType(parsed),
      fingerprint: fingerprintFromPublicKey(publicKey),
      publicKey,
      encryptedPrivateKey: encryptWithMasterKey(pair.private, this.deviceKey),
      privateKeyFormat: 'openssh',
      hasPassphrase: Boolean(passphrase),
      comment,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1,
      deviceId: ''
    }

    await this.repository.save(key)
    return this.toSummary(key)
  }

  /** Imports an existing private key and stores it encrypted. */
  async import(request: ImportKeyRequest): Promise<KeySummary> {
    const name = request.name.trim()
    if (!name) throw new Error('The key needs a name')
    if (!request.privateKey.trim()) throw new Error('The private key is empty')

    const parsed = parsePrivateKey(request.privateKey, request.passphrase)
    if (!parsed.isPrivateKey()) throw new Error('The imported key is not a private key')

    const comment = request.comment?.trim() || parsed.comment || name
    const publicKey = publicKeyLine(parsed, comment)

    const now = new Date().toISOString()
    const key: SshKey = {
      id: createId(),
      name,
      type: detectKeyType(parsed),
      fingerprint: fingerprintFromPublicKey(publicKey),
      publicKey,
      encryptedPrivateKey: encryptWithMasterKey(request.privateKey, this.deviceKey),
      privateKeyFormat: 'openssh',
      hasPassphrase: Boolean(request.passphrase?.trim()),
      comment,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1,
      deviceId: ''
    }

    await this.repository.save(key)
    return this.toSummary(key)
  }

  /** The public key of a stored key, ready for authorized_keys. */
  async exportPublic(id: string): Promise<string> {
    const key = await this.repository.get(id)
    if (!key || key.deletedAt) throw new Error(`Unknown key: ${id}`)
    return key.publicKey
  }

  /** Deletes a key. */
  async remove(id: string): Promise<void> {
    await this.repository.remove(id)
  }

  /**
   * The decrypted private key of a stored key.
   * Used only to open a session — the value never leaves the main process.
   */
  async privateKeyMaterial(id: string): Promise<string> {
    const key = await this.repository.get(id)
    if (!key || key.deletedAt) throw new Error(`Unknown key: ${id}`)

    // The key of the device opens it. A key of an older build was sealed
    // with the master key — that one opens while the app is unlocked.
    try {
      return decryptWithMasterKey(key.encryptedPrivateKey, this.deviceKey)
    } catch {
      const material = this.masterKey()
      if (!material) {
        throw new Error(
          'This key was saved by an older build and needs the master password'
        )
      }
      return decryptWithMasterKey(key.encryptedPrivateKey, material)
    }
  }

  private toSummary(key: SshKey): KeySummary {
    return {
      id: key.id,
      name: key.name,
      type: key.type,
      fingerprint: key.fingerprint,
      publicKey: key.publicKey,
      comment: key.comment,
      hasPassphrase: key.hasPassphrase,
      createdAt: key.createdAt
    }
  }
}

/** RFC 4122-ish identifier; no external dependency for a single call. */
function createId(): string {
  return globalThis.crypto.randomUUID()
}
