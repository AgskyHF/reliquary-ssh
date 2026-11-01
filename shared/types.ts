/**
 * Shared type definitions for ReliquarySSH.
 * Used by /app (Electron main), /renderer (React), /protocols and /server.
 */

/** Supported connection protocols. FTP/Telnet/Serial are roadmap-only stubs. */
export enum ProtocolType {
  SSH = 'ssh',
  SFTP = 'sftp',
  FTP = 'ftp',
  TELNET = 'telnet',
  SERIAL = 'serial',
  LOCAL = 'local'
}

/** Connection protocol capabilities, used to decide which adapter to build. */
export enum ProtocolCapability {
  TERMINAL = 'terminal',
  FILE_MANAGER = 'file_manager'
}

/** SSH key types supported by the Keychain. */
export enum KeyType {
  RSA = 'rsa',
  ED25519 = 'ed25519',
  ECDSA = 'ecdsa'
}

/** Authentication method used to log into a remote host. */
export enum AuthMethod {
  PASSWORD = 'password',
  KEY = 'key',
  NONE = 'none'
}

/** Tab kinds — every tab is an independent session. */
export enum TabKind {
  SSH = 'ssh',
  SFTP = 'sftp',
  LOCAL_TERMINAL = 'local_terminal'
}

/** Lifecycle of a connection/tab. */
export enum SessionState {
  IDLE = 'idle',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  CLOSING = 'closing',
  CLOSED = 'closed',
  ERROR = 'error'
}

/** A stored SSH key pair. The private part is never stored in plaintext. */
export interface SshKey {
  id: string
  name: string
  type: KeyType
  /** SHA256 fingerprint of the public key, e.g. "SHA256:xxxx". */
  fingerprint: string
  /** OpenSSH public key, single line. */
  publicKey: string
  /** Encrypted private key payload. Encrypted at rest — never plaintext. */
  encryptedPrivateKey: string
  /** Algorithm/format metadata for the private key, e.g. "pkcs8-pem". */
  privateKeyFormat: string
  /** True when the private key is protected by a passphrase. */
  hasPassphrase: boolean
  comment: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  version: number
  deviceId: string
}

/** A stored remote host. */
export interface Host {
  id: string
  name: string
  protocol: ProtocolType
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  /** Keychain key id when authMethod === Key. */
  keyId: string | null
  /** Password is never stored in the model — kept only for the active session. */
  color: string
  group: string | null
  notes: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  version: number
  deviceId: string
}

/** Persisted tab state — restored on next app start. */
export interface TabState {
  id: string
  kind: TabKind
  title: string
  /** Host id for remote tabs; null for the local terminal. */
  hostId: string | null
  /** Serialized terminal buffer, so the session can be visually restored. */
  buffer: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  version: number
  deviceId: string
}

/** Encrypted sync payload. Format is fixed by the sync contract. */
export interface SyncBlob {
  version: number
  /** Base64 initialization vector (12 bytes for AES-256-GCM). */
  iv: string
  /** Base64 ciphertext. */
  ciphertext: string
  /** Base64 GCM authentication tag. */
  tag: string
  /** ISO timestamp of the blob creation. */
  updated_at: string
}

/** Outbox journal entry — local changes waiting to be pushed to the backend. */
export interface ChangeRecord {
  id: string
  entity: 'hosts' | 'keys' | 'tabs' | 'settings'
  entityId: string
  operation: 'upsert' | 'delete'
  payload: string
  synced: boolean
  createdAt: string
  updatedAt: string
  version: number
  deviceId: string
}

/** Connection options handed to a ConnectionAdapter. */
export interface ConnectionOptions {
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  /** Plaintext password — only in memory, for the lifetime of the session. */
  password?: string
  /** Decrypted private key material — only in memory, for the lifetime of the session. */
  privateKey?: string
  privateKeyPassphrase?: string
  /** Connection timeout in milliseconds. */
  timeoutMs?: number
}

/**
 * Common interface for every protocol adapter.
 * Adapters live in /protocols/<name>/ and are registered in the main process.
 */
export interface ConnectionAdapter {
  readonly protocol: ProtocolType
  readonly capabilities: ProtocolCapability[]
  connect(options: ConnectionOptions): Promise<void>
  disconnect(): Promise<void>
  readonly state: SessionState
  /** Called by the adapter when remote data arrives (terminal output, errors). */
  on(event: 'data', listener: (chunk: string) => void): void
  on(event: 'error', listener: (error: Error) => void): void
  on(event: 'close', listener: () => void): void
  on(event: 'state', listener: (state: SessionState) => void): void
  /** Terminal-style write (SSH/Telnet/local). */
  write?(data: string): void
  /** Resize the pseudo-terminal (SSH/Telnet). */
  resize?(cols: number, rows: number): void
}

/** Metadata describing a registered adapter — used by the renderer to build forms. */
export interface ProtocolDescriptor {
  protocol: ProtocolType
  label: string
  capabilities: ProtocolCapability[]
  defaultPort: number
  implemented: boolean
}

/** Auth session returned by the backend. */
export interface AuthSession {
  token: string
  user: {
    id: string
    email: string
    provider: 'google' | 'email'
  }
}

/** Master-password derived crypto material. Never leaves the device. */
export interface MasterKeyMaterial {
  /** Base64 32-byte AES-256 key. */
  key: string
  salt: string
  iterations: number
}

/** Electron IPC channel names — single source of truth for main <-> renderer. */
export const IPC = {
  APP_INFO: 'app:info',
  HOST_LIST: 'host:list',
  HOST_SAVE: 'host:save',
  HOST_DELETE: 'host:delete',
  KEY_LIST: 'key:list',
  KEY_GENERATE: 'key:generate',
  KEY_IMPORT: 'key:import',
  KEY_DELETE: 'key:delete',
  KEY_EXPORT_PUBLIC: 'key:exportPublic',
  SESSION_CONNECT: 'session:connect',
  SESSION_WRITE: 'session:write',
  SESSION_RESIZE: 'session:resize',
  SESSION_DISCONNECT: 'session:disconnect',
  SESSION_DATA: 'session:data',
  SESSION_STATE: 'session:state',
  SESSION_ERROR: 'session:error',
  TAB_LIST: 'tab:list',
  TAB_SAVE: 'tab:save',
  TAB_DELETE: 'tab:delete',
  SFTP_LIST: 'sftp:list',
  SFTP_DOWNLOAD: 'sftp:download',
  SFTP_UPLOAD: 'sftp:upload',
  SYNC_PULL: 'sync:pull',
  SYNC_PUSH: 'sync:push'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
