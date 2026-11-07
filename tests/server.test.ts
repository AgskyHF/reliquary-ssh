import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { createServerApp } from '../server/index'

describe('sync backend', () => {
  let dir: string
  let server: Server
  let baseUrl: string
  let close: () => void

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'reliquary-server-'))
    const created = createServerApp({
      jwtSecret: 'test-secret',
      databasePath: join(dir, 'server.db')
    })

    server = created.app.listen(0)
    await new Promise((resolve) => server.once('listening', resolve))

    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}`
    close = created.close
  })

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve))
    close()
    rmSync(dir, { recursive: true, force: true })
  })

  async function post(path: string, body: unknown, token?: string): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(body)
    })
  }

  async function get(path: string, token?: string): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
  }

  describe('health', () => {
    it('answers', async () => {
      const response = await get('/health')
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: 'ok' })
    })
  })

  describe('email registration and login', () => {
    it('registers a user and returns a session', async () => {
      const response = await post('/auth/register', {
        email: 'user@example.com',
        password: 'correct horse'
      })

      expect(response.status).toBe(201)
      const session = (await response.json()) as {
        token: string
        user: { id: string; email: string; provider: string }
      }

      expect(session.token).toBeTruthy()
      expect(session.user.email).toBe('user@example.com')
      expect(session.user.provider).toBe('email')
    })

    it('logs the user in', async () => {
      await post('/auth/register', { email: 'user@example.com', password: 'correct horse' })

      const response = await post('/auth/login', {
        email: 'user@example.com',
        password: 'correct horse'
      })

      expect(response.status).toBe(200)
      const session = (await response.json()) as { token: string }
      expect(session.token).toBeTruthy()
    })

    it('rejects a wrong password', async () => {
      await post('/auth/register', { email: 'user@example.com', password: 'correct horse' })

      const response = await post('/auth/login', {
        email: 'user@example.com',
        password: 'wrong'
      })

      expect(response.status).toBe(401)
    })

    it('gives the same answer for an unknown account and a wrong password', async () => {
      const unknown = await post('/auth/login', {
        email: 'nobody@example.com',
        password: 'whatever'
      })

      await post('/auth/register', { email: 'user@example.com', password: 'correct horse' })
      const wrong = await post('/auth/login', {
        email: 'user@example.com',
        password: 'whatever'
      })

      expect(unknown.status).toBe(wrong.status)
      expect(await unknown.text()).toBe(await wrong.text())
    })

    it('refuses a duplicate registration', async () => {
      await post('/auth/register', { email: 'user@example.com', password: 'correct horse' })

      const response = await post('/auth/register', {
        email: 'user@example.com',
        password: 'another one'
      })

      expect(response.status).toBe(409)
    })

    it('rejects a short password', async () => {
      const response = await post('/auth/register', { email: 'user@example.com', password: 'short' })
      expect(response.status).toBe(400)
    })

    it('rejects a malformed email', async () => {
      const response = await post('/auth/register', { email: 'not-an-email', password: 'correct horse' })
      expect(response.status).toBe(400)
    })
  })

  describe('sessions', () => {
    it('returns the current user', async () => {
      const registered = await post('/auth/register', {
        email: 'user@example.com',
        password: 'correct horse'
      })
      const { token } = (await registered.json()) as { token: string }

      const response = await get('/auth/me', token)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ email: 'user@example.com' })
    })

    it('rejects a request without a token', async () => {
      const response = await get('/auth/me')
      expect(response.status).toBe(401)
    })

    it('rejects a forged token', async () => {
      const response = await get('/auth/me', 'not.a.token')
      expect(response.status).toBe(401)
    })
  })

  describe('sync', () => {
    const entry = {
      entity: 'hosts',
      entityId: 'host-1',
      version: 1,
      iv: 'aXY=',
      ciphertext: 'Y2lwaGVy',
      tag: 'dGFn',
      deviceId: 'device-a'
    }

    async function token(): Promise<string> {
      const response = await post('/auth/register', {
        email: 'user@example.com',
        password: 'correct horse'
      })
      return ((await response.json()) as { token: string }).token
    }

    it('requires authentication', async () => {
      const response = await post('/sync', { entries: [entry] })
      expect(response.status).toBe(401)
    })

    it('accepts entries', async () => {
      const auth = await token()
      const response = await post('/sync', { entries: [entry] }, auth)

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ accepted: 1 })
    })

    it('returns the stored entries', async () => {
      const auth = await token()
      await post('/sync', { entries: [entry] }, auth)

      const response = await get('/sync', auth)
      const body = (await response.json()) as { entries: { entityId: string; ciphertext: string }[] }

      expect(body.entries).toHaveLength(1)
      expect(body.entries[0]?.entityId).toBe('host-1')
      expect(body.entries[0]?.ciphertext).toBe('Y2lwaGVy')
    })

    it('is idempotent — pushing the same entry twice changes nothing', async () => {
      const auth = await token()
      await post('/sync', { entries: [entry] }, auth)
      await post('/sync', { entries: [entry] }, auth)

      const response = await get('/sync', auth)
      const body = (await response.json()) as { entries: unknown[] }

      expect(body.entries).toHaveLength(1)
    })

    it('keeps the client timestamp — the devices merge on it', async () => {
      const auth = await token()
      const updatedAt = '2026-11-07T09:00:00.000Z'
      await post('/sync', { entries: [{ ...entry, updatedAt }] }, auth)

      const response = await get('/sync', auth)
      const body = (await response.json()) as { entries: { updatedAt: string }[] }

      expect(body.entries[0]?.updatedAt).toBe(updatedAt)
    })

    it('stamps an entry that carries no timestamp', async () => {
      const auth = await token()
      await post('/sync', { entries: [entry] }, auth)

      const response = await get('/sync', auth)
      const body = (await response.json()) as { entries: { updatedAt: string }[] }

      expect(Number.isNaN(Date.parse(body.entries[0]?.updatedAt ?? ''))).toBe(false)
    })

    it('keeps the users apart', async () => {
      const first = await token()
      await post('/sync', { entries: [entry] }, first)

      const secondRegistered = await post('/auth/register', {
        email: 'other@example.com',
        password: 'correct horse'
      })
      const second = ((await secondRegistered.json()) as { token: string }).token

      const response = await get('/sync', second)
      const body = (await response.json()) as { entries: unknown[] }

      expect(body.entries).toHaveLength(0)
    })

    it('filters by entity', async () => {
      const auth = await token()
      await post(
        '/sync',
        {
          entries: [
            entry,
            { ...entry, entity: 'keys', entityId: 'key-1' }
          ]
        },
        auth
      )

      const response = await get('/sync?entity=keys', auth)
      const body = (await response.json()) as { entries: { entity: string }[] }

      expect(body.entries).toHaveLength(1)
      expect(body.entries[0]?.entity).toBe('keys')
    })
  })

  describe('google sign-in', () => {
    it('refuses when it is not configured', async () => {
      const response = await post('/auth/google', { code: 'some-code' })
      expect(response.status).toBe(503)
    })

    it('requires an authorization code', async () => {
      const response = await post('/auth/google', {})
      expect(response.status).toBe(400)
    })
  })
})
