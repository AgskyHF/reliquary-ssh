/**
 * Backend entry point.
 *
 * Usage: npm run server
 */
import express, { type NextFunction, type Request, type Response } from 'express'
import { dirname, resolve } from 'node:path'
import { AuthError, AuthService } from './auth.ts'
import { loadConfig } from './config.ts'
import { SyncRepository, UserRepository, openServerDatabase } from './database.ts'
import { ServerLogger } from './logger.ts'
import { createRoutes } from './routes.ts'

// Started only when the file is executed directly, so the tests can import
// createServerApp without opening a port.
const isDirectRun = process.argv[1]?.includes('server/index.ts') === true

export interface ServerApp {
  app: express.Express
  close(): void
}

/** Builds the Express app without starting the listener — used by the tests. */
export function createServerApp(overrides?: { jwtSecret?: string; databasePath?: string }): ServerApp {
  const config = loadConfig()
  const jwtSecret = overrides?.jwtSecret ?? config.jwtSecret
  const databasePath = overrides?.databasePath ?? config.databasePath

  if (!jwtSecret) {
    throw new Error('JWT_SECRET is not set — the server refuses to start')
  }

  // The log lives next to the database unless the path is set explicitly.
  const log = new ServerLogger({
    filePath: config.logPath || resolve(dirname(databasePath), 'reliquary-server.log'),
    level: config.logLevel
  })

  const db = openServerDatabase(databasePath)
  const users = new UserRepository(db)
  const sync = new SyncRepository(db)
  const auth = new AuthService({
    users,
    jwtSecret,
    jwtExpiresIn: config.jwtExpiresIn
  })

  const app = express()
  app.use(express.json({ limit: '10mb' }))

  app.use((request, response, next) => {
    // The sync API is used from a desktop client, not from a browser.
    response.header('Access-Control-Allow-Origin', '*')
    response.header('Access-Control-Allow-Headers', 'authorization, content-type')
    response.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')

    if (request.method === 'OPTIONS') {
      response.sendStatus(204)
      return
    }
    next()
  })

  app.use(createRoutes({ auth, sync, config: { ...config, jwtSecret } }))

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof AuthError) {
      response.status(error.status).json({ error: error.message })
      return
    }

    const message = error instanceof Error ? error.message : 'Internal server error'
    log.error(`Request failed: ${message}`, error instanceof Error ? error.stack : '')
    response.status(500).json({ error: message })
  })

  return {
    app,
    close: () => db.close()
  }
}

/** Starts the server. */
export function startServer(): void {
  const config = loadConfig()
  const { app, close } = createServerApp()

  const log = new ServerLogger({ filePath: config.logPath, level: config.logLevel })

  const server = app.listen(config.port, () => {
    log.info(`ReliquarySSH sync server listening on http://localhost:${config.port}`)
  })
  const shutdown = (): void => {
    log.info('The sync server is shutting down')
    server.close(() => {
      close()
      process.exit(0)
    })
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

if (isDirectRun) {
  startServer()
}
