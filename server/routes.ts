/**
 * HTTP routes of the sync backend.
 */
import { Router, type Request, type Response } from 'express'
import { AuthError, type AuthService, type JwtPayload } from './auth.ts'
import type { SyncRepository } from './database.ts'
import type { ServerConfig } from './config.ts'

export interface SyncEntryInput {
  id?: string
  entity: string
  entityId: string
  version?: number
  iv: string
  ciphertext: string
  tag: string
  deviceId?: string
  deletedAt?: string | null
}

export interface SyncPushBody {
  entries: SyncEntryInput[]
}

/** The shape of a sync entry on the wire. */
export interface SyncEntryResponse {
  id: string
  entity: string
  entityId: string
  version: number
  iv: string
  ciphertext: string
  tag: string
  deviceId: string
  updatedAt: string
  deletedAt: string | null
}

export interface RoutesOptions {
  auth: AuthService
  sync: SyncRepository
  config: ServerConfig
}

/** Wraps an async handler so rejections reach the error middleware. */
function asyncHandler(
  handler: (request: Request, response: Response) => Promise<void>
): (request: Request, response: Response, next: (error?: unknown) => void) => void {
  return (request, response, next) => {
    handler(request, response).catch(next)
  }
}

export function createRoutes(options: RoutesOptions): Router {
  const { auth, sync, config } = options
  const router = Router()

  /** Reads the user id from the Authorization header. */
  const requireUser = (request: Request): JwtPayload => {
    const header = request.header('authorization') ?? ''
    const [scheme, token] = header.split(' ')

    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new AuthError('A bearer token is required')
    }

    return auth.verify(token)
  }

  // ---- health ----
  router.get('/health', (_request, response) => {
    response.json({ status: 'ok' })
  })

  // ---- auth ----
  router.post(
    '/auth/register',
    asyncHandler(async (request, response) => {
      const { email, password } = request.body as { email?: string; password?: string }
      const session = await auth.register(email ?? '', password ?? '')
      response.status(201).json(session)
    })
  )

  router.post(
    '/auth/login',
    asyncHandler(async (request, response) => {
      const { email, password } = request.body as { email?: string; password?: string }
      const session = await auth.login(email ?? '', password ?? '')
      response.json(session)
    })
  )

  /**
   * Google OAuth 2.0.
   *
   * The client sends the authorization code it obtained with PKCE; the
   * server exchanges it for the profile and issues a session.
   */
  router.post(
    '/auth/google',
    asyncHandler(async (request, response) => {
      const { code, codeVerifier, redirectUri } = request.body as {
        code?: string
        codeVerifier?: string
        redirectUri?: string
      }

      if (!code) throw new AuthError('The authorization code is required', 400)
      if (!config.googleServerClientId || !config.googleClientSecret) {
        throw new AuthError('Google sign-in is not configured on the server', 503)
      }

      const profile = await exchangeGoogleCode({
        code,
        codeVerifier,
        redirectUri: redirectUri ?? config.googleRedirectUri,
        clientId: config.googleServerClientId,
        clientSecret: config.googleClientSecret
      })

      const session = auth.loginWithGoogle(profile)
      response.json(session)
    })
  )

  /**
   * The OAuth redirect target.
   *
   * Google sends the user here with the authorization code; the page
   * posts it back to the app window and closes itself.
   */
  router.get('/auth/google/callback', (request, response) => {
    const code = typeof request.query.code === 'string' ? request.query.code : ''
    const error = typeof request.query.error === 'string' ? request.query.error : ''

    const payload = error
      ? { type: 'reliquary-google-error', error }
      : { type: 'reliquary-google-code', code }

    response.type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>ReliquarySSH</title>
  </head>
  <body>
    <p>${error ? 'Sign-in failed. You can close this window.' : 'Signing in…'}</p>
    <script>
      if (window.opener) {
        window.opener.postMessage(${JSON.stringify(payload)}, '*')
        window.close()
      }
    </script>
  </body>
</html>`)
  })

  router.get('/auth/me', (request, response, next) => {
    try {
      const payload = requireUser(request)
      response.json({ id: payload.sub, email: payload.email, provider: payload.provider })
    } catch (error) {
      next(error)
    }
  })

  // ---- sync ----
  /**
   * Pushes the local changes. The request is idempotent: pushing the same
   * entry twice leaves the same state on the server.
   */
  router.post(
    '/sync',
    asyncHandler(async (request, response) => {
      const payload = requireUser(request)
      const body = request.body as SyncPushBody
      const entries = Array.isArray(body?.entries) ? body.entries : []

      const stored = entries.map((entry) =>
        sync.upsert({
          // The id is derived from the entity, so pushing the same entry
          // twice updates the same row instead of creating a second one.
          id: entityKey(payload.sub, entry),
          userId: payload.sub,
          deviceId: entry.deviceId ?? '',
          entity: entry.entity,
          entityId: entry.entityId,
          version: entry.version ?? 1,
          iv: entry.iv,
          ciphertext: entry.ciphertext,
          tag: entry.tag,
          updatedAt: new Date().toISOString(),
          deletedAt: entry.deletedAt ?? null
        })
      )

      response.json({ accepted: stored.length })
    })
  )

  /** Returns the encrypted entries of the user. */
  router.get('/sync', (request, response, next) => {
    try {
      const payload = requireUser(request)
      const entity = typeof request.query.entity === 'string' ? request.query.entity : undefined
      const entries = sync.list(payload.sub, entity)

      const result: SyncEntryResponse[] = entries.map((entry) => ({
        id: entry.id,
        entity: entry.entity,
        entityId: entry.entityId,
        version: entry.version,
        iv: entry.iv,
        ciphertext: entry.ciphertext,
        tag: entry.tag,
        deviceId: entry.deviceId,
        updatedAt: entry.updatedAt,
        deletedAt: entry.deletedAt
      }))

      response.json({ entries: result })
    } catch (error) {
      next(error)
    }
  })

  return router
}

/**
 * The storage key of an entry.
 *
 * The same entity on the same device always maps to the same row, so a
 * repeated push updates it instead of creating a second one.
 */
function entityKey(userId: string, entry: SyncEntryInput): string {
  return `${userId}:${entry.deviceId ?? ''}:${entry.entity}:${entry.entityId}`
}

interface GoogleProfile {
  email: string
  providerId: string
}

/** Exchanges an authorization code for the Google profile. */
async function exchangeGoogleCode(params: {
  code: string
  codeVerifier?: string
  redirectUri: string
  clientId: string
  clientSecret: string
}): Promise<GoogleProfile> {
  const body = new URLSearchParams({
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: 'authorization_code'
  })
  if (params.codeVerifier) body.set('code_verifier', params.codeVerifier)

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })

  if (!tokenResponse.ok) {
    throw new AuthError('Google rejected the authorization code', 401)
  }

  const token = (await tokenResponse.json()) as { access_token?: string }
  if (!token.access_token) throw new AuthError('Google did not return an access token', 401)

  const profileResponse = await fetch(
    'https://openidconnect.googleapis.com/v1/userinfo',
    { headers: { Authorization: `Bearer ${token.access_token}` } }
  )

  if (!profileResponse.ok) {
    throw new AuthError('Could not read the Google profile', 401)
  }

  const profile = (await profileResponse.json()) as {
    email?: string
    sub?: string
  }

  if (!profile.email || !profile.sub) {
    throw new AuthError('The Google profile has no email address', 400)
  }

  return { email: profile.email, providerId: profile.sub }
}
