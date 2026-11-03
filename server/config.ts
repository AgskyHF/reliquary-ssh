/**
 * Backend configuration.
 *
 * Values come from the environment; the .env file is read in development
 * so the server can be started without exporting everything by hand.
 * Secrets never leave the server process.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export interface ServerConfig {
  port: number
  databasePath: string
  jwtSecret: string
  jwtExpiresIn: string
  googleServerClientId: string
  googleClientSecret: string
  googleRedirectUri: string
}

/** Reads a .env file into a plain object. Missing files are ignored. */
export function readEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {}

  const result: Record<string, string> = {}
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const separator = trimmed.indexOf('=')
    if (separator === -1) continue

    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim()
    result[key] = value.replace(/^["']/u, '').replace(/["']$/u, '')
  }
  return result
}

/** Builds the configuration from the environment and an optional .env file. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const fileEnv = readEnvFile(resolve(process.cwd(), '.env'))
  const value = (key: string, fallback = ''): string =>
    env[key] ?? fileEnv[key] ?? fallback

  return {
    port: Number(value('PORT', '8788')),
    databasePath: value('DATABASE_PATH', './data/reliquary.db'),
    jwtSecret: value('JWT_SECRET', ''),
    jwtExpiresIn: value('JWT_EXPIRES_IN', '7d'),
    googleServerClientId: value('GOOGLE_SERVER_CLIENT_ID', ''),
    googleClientSecret: value('GOOGLE_CLIENT_SECRET', ''),
    googleRedirectUri: value('GOOGLE_REDIRECT_URI', 'http://localhost:8788/auth/google/callback')
  }
}
