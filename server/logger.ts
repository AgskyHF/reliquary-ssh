/**
 * Backend logging.
 *
 * The server writes to stdout and to a log file next to its database.
 * The format matches the app log, so both can be read the same way.
 */
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

export type ServerLogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<ServerLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
}

const MAX_BYTES = 5 * 1024 * 1024
const KEEP = 3

export class ServerLogger {
  private readonly level: ServerLogLevel
  private readonly filePath: string | null

  constructor(options: { filePath?: string; level?: string }) {
    this.filePath = options.filePath && options.filePath !== '' ? options.filePath : null
    const requested = options.level ?? 'info'
    this.level = requested in LEVELS ? (requested as ServerLogLevel) : 'info'
  }

  debug(message: string, context?: unknown): void {
    this.write('debug', message, context)
  }

  info(message: string, context?: unknown): void {
    this.write('info', message, context)
  }

  warn(message: string, context?: unknown): void {
    this.write('warn', message, context)
  }

  error(message: string, context?: unknown): void {
    this.write('error', message, context)
  }

  private write(level: ServerLogLevel, message: string, context?: unknown): void {
    if (LEVELS[level] < LEVELS[this.level]) return

    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`
    const suffix = context === undefined ? '' : ` ${JSON.stringify(context)}`

    if (level === 'error') console.error(line + suffix)
    else if (level === 'warn') console.warn(line + suffix)
    else console.log(line + suffix)

    if (!this.filePath) return

    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      this.rotateIfNeeded()
      appendFileSync(this.filePath, `${line}${suffix}\n`, 'utf8')
    } catch {
      // A broken log must never take the server down.
    }
  }

  private rotateIfNeeded(): void {
    if (!this.filePath) return

    try {
      if (statSync(this.filePath).size < MAX_BYTES) return

      for (let index = KEEP - 1; index >= 1; index--) {
        try {
          renameSync(`${this.filePath}.${index}`, `${this.filePath}.${index + 1}`)
        } catch {
          // The rotated file does not exist.
        }
      }
      renameSync(this.filePath, `${this.filePath}.1`)
    } catch {
      // The log file does not exist yet.
    }
  }
}
