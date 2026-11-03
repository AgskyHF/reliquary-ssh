/**
 * Auth client — the renderer's view of the session.
 *
 * The requests run in the Electron main process: the app is loaded from a
 * file:// origin, and Chromium blocks such pages from reaching the local
 * network (Private Network Access). The renderer only goes through IPC.
 */
import type { AuthSession } from '@shared/api'
import { api } from './api'

export interface AuthClient {
  register(email: string, password: string): Promise<AuthSession>
  login(email: string, password: string): Promise<AuthSession>
  loginWithGoogle(): Promise<AuthSession>
  me(): Promise<AuthSession['user']>
  status(): Promise<{ signedIn: boolean; email: string | null; serverUrl: string }>
  signOut(): Promise<void>
  setServerUrl(url: string): Promise<{ serverUrl: string }>
  /** The Google client id of this build; empty when it is not configured. */
  googleClientId(): string
}

/** The auth client used by the renderer. */
export const auth: AuthClient = {
  register(email, password) {
    return api.auth.register({ email, password })
  },

  login(email, password) {
    return api.auth.login({ email, password })
  },

  async loginWithGoogle() {
    // The OAuth window is opened by the renderer; the code is exchanged
    // for a session in the main process.
    const { code, codeVerifier } = await runGooglePkce()
    return api.auth.loginWithGoogle({ code, codeVerifier })
  },

  me() {
    return api.auth.me()
  },

  status() {
    return api.auth.status()
  },

  signOut() {
    return api.auth.signOut()
  },

  setServerUrl(url) {
    return api.auth.setServerUrl(url)
  },

  googleClientId() {
    const meta = import.meta as unknown as { env?: Record<string, string | undefined> }
    return meta.env?.VITE_GOOGLE_CLIENT_ID ?? ''
  }
}

interface GooglePkceResult {
  code: string
  codeVerifier: string
}

/**
 * Runs the OAuth 2.0 PKCE flow in a popup window.
 *
 * The desktop client opens the authorization URL, the user signs in, and
 * the callback window posts the code back.
 */
async function runGooglePkce(): Promise<GooglePkceResult> {
  const clientId = auth.googleClientId()

  if (!clientId) {
    throw new Error('Google sign-in is not configured for this build')
  }

  const status = await api.auth.status()
  const codeVerifier = randomString(64)
  const codeChallenge = await sha256Base64Url(codeVerifier)
  const state = randomString(24)

  const redirectUri = `${status.serverUrl}/auth/google/callback`
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state
  })

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  const popup = window.open(authUrl, 'reliquary-google', 'width=520,height=680')

  if (!popup) throw new Error('The sign-in window was blocked')

  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as { type?: string; code?: string; error?: string }

      if (data?.type === 'reliquary-google-code' && data.code) {
        window.removeEventListener('message', onMessage)
        popup.close()
        resolve({ code: data.code, codeVerifier })
        return
      }

      if (data?.type === 'reliquary-google-error') {
        window.removeEventListener('message', onMessage)
        popup.close()
        reject(new Error(data.error ?? 'Google sign-in was cancelled'))
      }
    }

    window.addEventListener('message', onMessage)

    // The user may close the window without signing in.
    const watcher = setInterval(() => {
      if (popup.closed) {
        clearInterval(watcher)
        window.removeEventListener('message', onMessage)
        reject(new Error('Google sign-in was cancelled'))
      }
    }, 500)
  })
}

/** A random string from the browser's crypto. */
function randomString(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/u, '')
}

/** The SHA256 challenge of the PKCE flow, base64url encoded. */
async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  const bytes = new Uint8Array(digest)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/u, '')
}
