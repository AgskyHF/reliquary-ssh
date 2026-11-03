/**
 * Backend client — lives in the Electron main process.
 *
 * The renderer must not talk to the backend directly: the app is loaded
 * from a file:// origin, and Chromium blocks requests from it to the
 * local network (Private Network Access). The main process has no such
 * restriction, so it performs the requests and the renderer goes through
 * IPC.
 *
 * The token is kept in the main process; the renderer only learns whether
 * a session exists.
 */
import { randomUUID } from 'node:crypto'
import type { AuthSession } from '@shared/api'

export interface AuthClientOptions {
  /** The address of the sync backend. */
  serverUrl: string
  /** The Google client id of the build; empty when it is not configured. */
  googleClientId?: string
}

export class BackendClient {
  private token: string | null = null
  private email: string | null = null
  private currentServerUrl: string

  constructor(options: AuthClientOptions) {
    this.currentServerUrl = options.serverUrl
  }

  /** The address of the backend. */
  get serverUrl(): string {
    return this.currentServerUrl
  }

  /** Points the client at another backend. The session is dropped. */
  setServerUrl(url: string): void {
    this.currentServerUrl = url
    this.signOut()
  }

  /** True when a session token is held. */
  isSignedIn(): boolean {
    return this.token !== null
  }

  /** The email of the signed-in account, when there is one. */
  signedInAs(): string | null {
    return this.email
  }

  /** Creates an account and signs in. */
  async register(email: string, password: string): Promise<AuthSession> {
    const session = await this.post('/auth/register', { email, password })
    this.remember(session)
    return session
  }

  /** Signs in with email and password. */
  async login(email: string, password: string): Promise<AuthSession> {
    const session = await this.post('/auth/login', { email, password })
    this.remember(session)
    return session
  }

  /**
   * Signs in with a Google account.
   *
   * The authorization code is obtained by the renderer, which opens the
   * OAuth window; the exchange happens here.
   */
  async loginWithGoogle(code: string, codeVerifier?: string): Promise<AuthSession> {
    const session = await this.post('/auth/google', { code, codeVerifier })
    this.remember(session)
    return session
  }

  /** Reads the current session from the backend. */
  async me(): Promise<AuthSession['user']> {
    if (!this.token) throw new Error('Not signed in')

    const response = await fetch(`${this.serverUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${this.token}` }
    })

    const body = (await response.json()) as AuthSession['user'] & { error?: string }
    if (!response.ok) throw new Error(body.error ?? 'Could not read the session')
    return body
  }

  /** Forgets the session. */
  signOut(): void {
    this.token = null
    this.email = null
  }

  /** Pushes the encrypted entries to the backend. */
  async pushEntries(entries: unknown[]): Promise<number> {
    if (!this.token) throw new Error('Not signed in')

    const response = await fetch(`${this.serverUrl}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`
      },
      body: JSON.stringify({ entries })
    })

    const body = (await response.json()) as { accepted?: number; error?: string }
    if (!response.ok) throw new Error(body.error ?? 'Could not push the changes')
    return body.accepted ?? 0
  }

  /** Reads the encrypted entries of the account. */
  async pullEntries(entity?: string): Promise<unknown[]> {
    if (!this.token) throw new Error('Not signed in')

    const query = entity ? `?entity=${encodeURIComponent(entity)}` : ''
    const response = await fetch(`${this.serverUrl}/sync${query}`, {
      headers: { Authorization: `Bearer ${this.token}` }
    })

    const body = (await response.json()) as { entries?: unknown[]; error?: string }
    if (!response.ok) throw new Error(body.error ?? 'Could not read the changes')
    return body.entries ?? []
  }

  private async post(path: string, body: unknown): Promise<AuthSession> {
    const response = await fetch(`${this.serverUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

    const payload = (await response.json()) as AuthSession & { error?: string }
    if (!response.ok) throw new Error(payload.error ?? `Request to ${path} failed`)
    return payload
  }

  private remember(session: AuthSession): void {
    this.token = session.token
    this.email = session.user.email
  }

  /** A fresh id for a sync entry. */
  static newEntryId(): string {
    return randomUUID()
  }
}
