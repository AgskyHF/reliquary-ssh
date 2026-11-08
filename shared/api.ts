/**
 * The contract between the Electron main process and the renderer.
 * The preload script implements this shape; the renderer consumes it through
 * `renderer/src/services/api.ts`. Keeping it in /shared avoids the renderer
 * importing from /app.
 */
import type {
  Host,
  KeySummary,
  MasterStatus,
  RemoteListing,
  TabLayoutInput,
  TabLayoutSnapshot
} from './types'
import type { SyncEntry, SyncResult, SyncStatusView } from './sync'
import type { ExportOptions, ImportResult } from './export'

/** The session the backend returns after a successful sign-in. */
export interface AuthSession {
  token: string
  user: {
    id: string
    email: string
    provider: 'google' | 'email'
  }
}

export interface AppInfo {
  name: string
  version: string
  platform: string
}

export interface ConnectRequest {
  sessionId: string
  /** Protocol of the session. Defaults to SSH for older callers. */
  protocol?: 'ssh' | 'sftp'
  host: string
  port: number
  username: string
  authMethod: 'password' | 'key' | 'none'
  password?: string
  keyId?: string | null
  cols?: number
  rows?: number
}

export interface SessionDataEvent {
  sessionId: string
  chunk: string
}

export interface SessionStateEvent {
  sessionId: string
  state: string
}

export interface SessionErrorEvent {
  sessionId: string
  message: string
}

/** The device settings of the app. */
export interface AppSettings {
  /** The address of the sync backend. */
  serverUrl: string
  /** The log level: debug | info | warn | error. */
  logLevel: string
  /** The path of the log file, relative to userData. */
  logPath: string
  /** The transport: 'server' (HTTP backend) or 'folder' (shared folder). */
  syncTransport: 'server' | 'folder'
  /** The shared folder used by the 'folder' transport. */
  syncFolder: string
  /**
   * The PBKDF2 parameters an import brought, as JSON.
   *
   * The salt belongs to the account, not to the device: a device that
   * imported an archive stores it here, so the master password it gets
   * derives the same key as on the device that made the export.
   */
  importedKdf: string
  /**
   * The interval of the auto sync, in seconds. Zero turns it off.
   *
   * The sync also runs when the app starts and when the user asks for it.
   */
  autoSyncSeconds: number
}

/** One version that lost a merge, as the renderer sees it. */
export interface SupersededSummary {
  id: string
  hostId: string
  /** The name of the connection the version belonged to. */
  name: string
  /** The endpoint of that version. */
  target: string
  /** When it was replaced. */
  replacedAt: string
  /** Why it was replaced: 'newer' or 'deleted'. */
  reason: string
  /** True when the version carries a sealed password. */
  hasPassword: boolean
}

/** What a restore did. */
export interface RestoreSummary {
  hostId: string
  /** The name of the restored version. */
  version: string
  /** True when the password of the old version came back too. */
  passwordRestored: boolean
  /** True when the version that was replaced went to the old folder. */
  replacedSaved: boolean
  summary: string
}

export interface ReliquaryApi {
  appInfo(): Promise<AppInfo>

  host: {
    list(): Promise<Host[]>
    save(host: Partial<Host>): Promise<Host>
    remove(id: string): Promise<void>
  }

  changes: {
    /** The number of local changes waiting to be pushed to the backend. */
    pendingCount(): Promise<number>
  }

  auth: {
    /** Creates an account and signs in. */
    register(payload: { email: string; password: string }): Promise<AuthSession>
    /** Signs in with email and password. */
    login(payload: { email: string; password: string }): Promise<AuthSession>
    /** Signs in with a Google authorization code. */
    loginWithGoogle(payload: { code: string; codeVerifier?: string }): Promise<AuthSession>
    /** The current session. */
    me(): Promise<AuthSession['user']>
    /** Forgets the session. */
    signOut(): Promise<void>
    /** Whether a session exists and which account it belongs to. */
    status(): Promise<{ signedIn: boolean; email: string | null; serverUrl: string }>
    /** Changes the address of the backend. */
    setServerUrl(url: string): Promise<{ serverUrl: string }>
  }

  sync: {
    /** Pushes the encrypted entries to the backend. */
    push(payload: { entries: SyncEntry[] }): Promise<{ accepted: number }>
    /** Reads the encrypted entries of the account. */
    pull(payload?: { entity?: string }): Promise<{ entries: SyncEntry[] }>
    /** The state of the sync engine, including whether the account has KDF params. */
    status(): Promise<SyncStatusView>
    /** Encrypts the pending changes, pushes them, then pulls and applies the remote ones. */
    now(): Promise<SyncResult>
    /** The state of the auto sync: whether it is armed and how often it runs. */
    autoStatus(): Promise<{
      enabled: boolean
      intervalSeconds: number
      running: boolean
    }>
  }

  key: {
    /** All stored keys; the private part is never included. */
    list(): Promise<KeySummary[]>
    /** Generates a new key pair. */
    generate(payload: {
      name: string
      type: string
      passphrase?: string
      comment?: string
      bits?: number
    }): Promise<KeySummary>
    /** Imports an existing private key. */
    import(payload: {
      name: string
      privateKey: string
      passphrase?: string
      comment?: string
    }): Promise<KeySummary>
    remove(id: string): Promise<void>
    /** The OpenSSH public key, ready for authorized_keys. */
    exportPublic(id: string): Promise<string>
  }

  master: {
    /** Sets the master password and stores the derived key material. */
    set(password: string): Promise<MasterStatus>
    /**
     * Sets the master password of an account that already has one on the
     * server: the PBKDF2 salt is taken from the account, so this device
     * derives the same key and can read the synced data.
     */
    setFromAccount(password: string): Promise<MasterStatus>
    /** True when a master password has been configured. */
    has(): Promise<boolean>
    /** Checks a password against the stored material. */
    verify(password: string): Promise<boolean>
    /** Verifies the password and loads the key material into memory. */
    unlock(password: string): Promise<MasterStatus>
    /** Forgets the master key from memory. */
    clear(): Promise<void>
    /** Current state of the master key in the main process. */
    status(): Promise<MasterStatus>
  }

  settings: {
    /** All device settings. */
    get(): Promise<AppSettings>
    /** Writes one setting. */
    set(payload: { key: keyof AppSettings; value: string }): Promise<AppSettings>
  }

  transfer: {
    /**
     * Builds the export archive and writes it to a path the user picked.
     * Without a path the native save dialog is shown.
     */
    export(payload: { options: ExportOptions; path?: string }): Promise<{
      path: string
      summary: string
    }>
    /**
     * Reads an archive the user picked and merges it into the local
     * database. The versions that lose the merge go to the old folder.
     * Without a path the native open dialog is shown.
     */
    import(payload?: { path?: string }): Promise<ImportResult>
    /** The versions that lost a merge — they are never deleted. */
    superseded(): Promise<SupersededSummary[]>
    /**
     * Restores a version that lost a merge. It becomes the current one,
     * and the version it replaces goes to the old folder.
     */
    restore(payload: { id: string }): Promise<RestoreSummary>
    /** Removes a version from the old folder — the user said it is not needed. */
    forget(payload: { id: string }): Promise<void>
  }

  hostPassword: {
    /** Stores the password of a host, encrypted with the master key. */
    set(payload: { hostId: string; password: string }): Promise<{ stored: boolean }>
    /** Removes the stored password of a host. */
    remove(payload: { hostId: string }): Promise<void>
    /** True when the host has a stored password. */
    has(payload: { hostId: string }): Promise<boolean>
    /**
     * Saves the password of a host that was just connected to. The host
     * id is null when the connection was made from the ad-hoc form.
     */
    saveFromConnect(payload: { hostId: string | null; password: string }): Promise<{
      stored: boolean
    }>
  }

  session: {
    connect(request: ConnectRequest): Promise<void>
    write(payload: { sessionId: string; data: string }): Promise<void>
    resize(payload: { sessionId: string; cols: number; rows: number }): Promise<void>
    disconnect(sessionId: string): Promise<void>
    onData(listener: (payload: SessionDataEvent) => void): () => void
    onState(listener: (payload: SessionStateEvent) => void): () => void
    onError(listener: (payload: SessionErrorEvent) => void): () => void
  }

  file: {
    /** Lists a remote directory of a file-manager session. */
    list(payload: { sessionId: string; path: string }): Promise<RemoteListing>
    /** Downloads a remote file to a local path. */
    download(payload: {
      sessionId: string
      remotePath: string
      localPath: string
    }): Promise<string>
    /** Uploads a local file to a remote path. */
    upload(payload: {
      sessionId: string
      remotePath: string
      localPath: string
    }): Promise<string>
    /** The directory a file-manager session currently sits in. */
    cwd(sessionId: string): Promise<string>
    /**
     * Opens the native file picker and returns the chosen local path.
     * `mode` is 'open' (pick an existing file) or 'save' (pick a target name).
     */
    pickLocalPath(payload: { mode: 'open' | 'save'; defaultPath?: string }): Promise<string | null>
  }

  tab: {
    /** The layout saved on the last run (empty snapshot on first start). */
    load(): Promise<TabLayoutSnapshot>
    /** Persist the current layout; main stamps savedAt and deviceId. */
    save(input: TabLayoutInput): Promise<TabLayoutSnapshot>
  }
}
