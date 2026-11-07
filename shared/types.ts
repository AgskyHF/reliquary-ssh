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

/** Metadata of a stored SSH key, safe to send to the renderer. */
export interface KeySummary {
  id: string
  name: string
  type: KeyType
  /** SHA256 fingerprint of the public key, e.g. "SHA256:xxxx". */
  fingerprint: string
  /** OpenSSH public key, single line. */
  publicKey: string
  comment: string
  hasPassphrase: boolean
  createdAt: string
}

/** Status of the master password in the main process. */
export interface MasterStatus {
  /** True when a master key is loaded in memory. */
  unlocked: boolean
  /** True when a master password has been set up at all. */
  configured: boolean
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

/** Remote endpoint of a tab session. Contains no credentials. */
export interface ConnectionTarget {
  host: string
  port: number
  username: string
}

/** Persisted tab state — restored on next app start. */
export interface TabState {
  id: string
  kind: TabKind
  title: string
  /** Host id for remote tabs; null for the local terminal. */
  hostId: string | null
  /** Last endpoint used by the tab (no credentials) — prefills the reconnect form. */
  connection: ConnectionTarget | null
  /** Serialized terminal buffer, so the session can be visually restored. */
  buffer: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  version: number
  deviceId: string
}

/** Persisted tab layout: which tabs were open and which one was active. */
export interface TabLayoutSnapshot {
  tabs: TabState[]
  activeTabId: string | null
  savedAt: string
  deviceId: string
}

/** What the renderer sends when saving the layout — main stamps deviceId/savedAt. */
export type TabLayoutInput = Pick<TabLayoutSnapshot, 'tabs' | 'activeTabId'>

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
 * A single entry of a remote directory listing.
 * Mirrors the subset of ssh2-sftp-client's FileInfo the UI needs.
 */
export interface RemoteFileEntry {
  /** File name without the directory part. */
  name: string
  /** Absolute remote path. */
  path: string
  /** 'd' = directory, '-' = regular file, 'l' = symlink. */
  type: 'd' | '-' | 'l'
  /** Size in bytes; 0 for directories. */
  size: number
  /** Modification time, ISO string. */
  modifiedAt: string
  /** Unix permissions in octal, e.g. "644". */
  mode: string
}

/** Result of a directory listing request. */
export interface RemoteListing {
  /** Absolute path of the listed directory. */
  path: string
  /** Absolute path of the parent directory (".." goes up). */
  parentPath: string
  entries: RemoteFileEntry[]
}

/**
 * Connection options for a file-manager session (SFTP/FTP).
 * The adapter owns the transfer; the renderer only asks for a path.
 */
export interface FileTransferRequest {
  /** Remote path (for downloads) — relative paths are resolved against cwd. */
  remotePath?: string
  /** Absolute local path (for uploads/downloads). */
  localPath?: string
}

/**
 * Adapters that expose a remote file system.
 * Implemented by SFTP (and later FTP); the UI talks to them through the
 * same session id it uses for terminals.
 */
export interface FileManagerAdapter extends ConnectionAdapter {
  /** Lists a directory. */
  list(remotePath: string): Promise<RemoteListing>
  /** Downloads a remote file to a local path. */
  download(request: FileTransferRequest): Promise<string>
  /** Uploads a local file to a remote path. */
  upload(request: FileTransferRequest): Promise<string>
  /** The directory the session starts in. */
  readonly cwd: string
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
  CHANGES_PENDING_COUNT: 'changes:pendingCount',
  AUTH_REGISTER: 'auth:register',
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGIN_GOOGLE: 'auth:loginGoogle',
  AUTH_ME: 'auth:me',
  AUTH_SIGN_OUT: 'auth:signOut',
  AUTH_STATUS: 'auth:status',
  AUTH_SERVER_URL: 'auth:serverUrl',
  SYNC_PUSH_ENTRIES: 'sync:pushEntries',
  SYNC_PULL_ENTRIES: 'sync:pullEntries',
  KEY_LIST: 'key:list',
  KEY_GENERATE: 'key:generate',
  KEY_IMPORT: 'key:import',
  KEY_DELETE: 'key:delete',
  KEY_EXPORT_PUBLIC: 'key:exportPublic',
  MASTER_SET: 'master:set',
  MASTER_SET_FROM_ACCOUNT: 'master:setFromAccount',
  MASTER_HAS: 'master:has',
  MASTER_VERIFY: 'master:verify',
  MASTER_UNLOCK: 'master:unlock',
  MASTER_CLEAR: 'master:clear',
  MASTER_STATUS: 'master:status',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  EXPORT_BUILD: 'export:build',
  EXPORT_IMPORT: 'export:import',
  EXPORT_SUPERSEDED_LIST: 'export:supersededList',
  HOST_PASSWORD_SET: 'host:passwordSet',
  HOST_PASSWORD_REMOVE: 'host:passwordRemove',
  HOST_PASSWORD_HAS: 'host:passwordHas',
  HOST_PASSWORD_SAVE_FROM_CONNECT: 'host:passwordSaveFromConnect',
  SESSION_CONNECT: 'session:connect',
  SESSION_WRITE: 'session:write',
  SESSION_RESIZE: 'session:resize',
  SESSION_DISCONNECT: 'session:disconnect',
  SESSION_DATA: 'session:data',
  SESSION_STATE: 'session:state',
  SESSION_ERROR: 'session:error',
  FILE_LIST: 'file:list',
  FILE_DOWNLOAD: 'file:download',
  FILE_UPLOAD: 'file:upload',
  FILE_CWD: 'file:cwd',
  FILE_PICK_LOCAL: 'file:pickLocal',
  TAB_SNAPSHOT_LOAD: 'tab:snapshot:load',
  TAB_SNAPSHOT_SAVE: 'tab:snapshot:save',
  SFTP_LIST: 'sftp:list',
  SFTP_DOWNLOAD: 'sftp:download',
  SFTP_UPLOAD: 'sftp:upload',
  SYNC_PULL: 'sync:pull',
  SYNC_PUSH: 'sync:push',
  SYNC_STATUS: 'sync:status',
  SYNC_NOW: 'sync:now'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
