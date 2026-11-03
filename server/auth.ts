/**
 * Authentication service.
 *
 * Two ways to sign in:
 *  - email + password, the password is hashed with bcrypt;
 *  - Google OAuth 2.0, the server exchanges the authorization code and
 *    links the account by the provider id.
 *
 * Both produce the same session: a signed JWT the client sends with
 * every sync request.
 */
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import type { User } from './database.ts'
import type { UserRepository } from './database.ts'

export interface AuthSession {
  token: string
  user: {
    id: string
    email: string
    provider: 'google' | 'email'
  }
}

export interface JwtPayload {
  sub: string
  email: string
  provider: 'google' | 'email'
}

export class AuthError extends Error {
  readonly status: number

  constructor(message: string, status = 401) {
    super(message)
    this.name = 'AuthError'
    this.status = status
  }
}

export interface AuthServiceOptions {
  users: UserRepository
  jwtSecret: string
  jwtExpiresIn: string
}

export class AuthService {
  private readonly options: AuthServiceOptions

  constructor(options: AuthServiceOptions) {
    this.options = options
  }

  /** Registers a user with email and password. */
  async register(email: string, password: string): Promise<AuthSession> {
    const normalized = normalizeEmail(email)
    if (!normalized) throw new AuthError('A valid email address is required', 400)
    if (password.length < 8) {
      throw new AuthError('The password must be at least 8 characters long', 400)
    }

    if (this.options.users.findByEmail(normalized)) {
      throw new AuthError('An account with this email already exists', 409)
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const now = new Date().toISOString()

    const user = this.options.users.create({
      id: randomUUID(),
      email: normalized,
      passwordHash,
      provider: 'email',
      providerId: null,
      createdAt: now,
      updatedAt: now
    })

    return this.issueSession(user)
  }

  /** Signs a user in with email and password. */
  async login(email: string, password: string): Promise<AuthSession> {
    const normalized = normalizeEmail(email)
    const user = normalized ? this.options.users.findByEmail(normalized) : null

    // The same message for an unknown account and a wrong password — the
    // caller must not be able to tell which accounts exist.
    if (!user?.passwordHash) {
      throw new AuthError('Wrong email or password')
    }

    const ok = await bcrypt.compare(password, user.passwordHash)
    if (!ok) throw new AuthError('Wrong email or password')

    return this.issueSession(user)
  }

  /**
   * Signs a user in with a Google account.
   *
   * The account is linked by the provider id: the same Google account
   * always maps to the same user, even if the email changes.
   */
  loginWithGoogle(
    profile: { email: string; providerId: string }
  ): AuthSession {
    const normalized = normalizeEmail(profile.email)
    if (!normalized) throw new AuthError('The Google account has no email address', 400)

    const existing = this.options.users.findByProvider('google', profile.providerId)
    if (existing) return this.issueSession(existing)

    const now = new Date().toISOString()
    const user = this.options.users.create({
      id: randomUUID(),
      email: normalized,
      passwordHash: null,
      provider: 'google',
      providerId: profile.providerId,
      createdAt: now,
      updatedAt: now
    })

    return this.issueSession(user)
  }

  /** Verifies a JWT and returns its payload. */
  verify(token: string): JwtPayload {
    try {
      const payload = jwt.verify(token, this.options.jwtSecret) as JwtPayload
      if (!payload.sub) throw new Error('Missing subject')
      return payload
    } catch {
      throw new AuthError('Invalid or expired token')
    }
  }

  private issueSession(user: User): AuthSession {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      provider: user.provider
    }

    const token = jwt.sign(payload, this.options.jwtSecret, {
      expiresIn: this.options.jwtExpiresIn
    } as jwt.SignOptions)

    return {
      token,
      user: { id: user.id, email: user.email, provider: user.provider }
    }
  }
}

/** Normalizes an email address and validates its shape. */
export function normalizeEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) return null
  return normalized
}
