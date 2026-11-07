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
