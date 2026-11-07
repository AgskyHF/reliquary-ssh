/**
 * Logging.
 *
 * The app writes a rotating log file into the userData directory and
 * mirrors the important lines to the console. The renderer never logs
 * directly — it goes through IPC, so everything lands in one file.
 *
 * Log levels are read from RELIQUARY_LOG_LEVEL (debug | info | warn |
 * error). The default is 'info'; the file is always written, the console
 * mirror can be turned off with RELIQUARY_LOG_CONSOLE=0.
 */
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
}

/** The log file is rotated once it grows past this size. */
const MAX_BYTES = 2 * 1024 * 1024

/** How many rotated files are kept. */
const KEEP = 3

function parseLevel(value: string | undefined): LogLevel {
  if (value && value in LEVELS) return value as LogLevel
  return 'info'
}

export class Logger {
  private filePath: string | null = null
  private readonly level: LogLevel
  private readonly consoleMirror: boolean

  constructor(options: { filePath?: string; level?: string; consoleMirror?: boolean }) {
    this.filePath = options.filePath ?? null
    this.level = parseLevel(options.level)
    this.consoleMirror = options.consoleMirror ?? true
  }

  /**
   * Points the logger at a file.
   * The path is only known after app.getPath('userData'), so it is set
   * when the app is ready.
   */
  setFile(filePath: string): void {
    this.filePath = filePath
  }

  /** The file the logger writes to, or null when it writes nowhere. */
  get path(): string | null {
    return this.filePath
  }

  /** Creates a logger that writes into the given directory. */
  static inDirectory(directory: string): Logger {
    return new Logger({
      filePath: join(directory, 'reliquary.log'),
      level: process.env.RELIQUARY_LOG_LEVEL,
      consoleMirror: process.env.RELIQUARY_LOG_CONSOLE !== '0'
    })
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

  private write(level: LogLevel, message: string, context?: unknown): void {
    if (LEVELS[level] < LEVELS[this.level]) return

    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`

    if (this.consoleMirror) {
      if (level === 'error') console.error(line, context ?? '')
      else if (level === 'warn') console.warn(line, context ?? '')
      else console.log(line, context ?? '')
    }

    if (!this.filePath) return

    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      this.rotateIfNeeded()
      appendFileSync(this.filePath, `${line}\n`, 'utf8')
    } catch {
      // A broken log must never take the app down.
    }
  }

  /** Moves the log aside when it grew past the limit. */
  private rotateIfNeeded(): void {
    if (!this.filePath) return

    try {
      const stats = statSync(this.filePath)
      if (stats.size < MAX_BYTES) return

      for (let index = KEEP - 1; index >= 1; index--) {
        const from = `${this.filePath}.${index}`
        const to = `${this.filePath}.${index + 1}`
        try {
          renameSync(from, to)
        } catch {
          // The rotated file does not exist — nothing to move.
        }
      }

      renameSync(this.filePath, `${this.filePath}.1`)
    } catch {
      // The log file does not exist yet.
    }
  }

  /** Removes the rotated files — used by the "clear logs" action. */
  clearRotated(): void {
    if (!this.filePath) return
    for (let index = 1; index <= KEEP + 1; index++) {
      try {
        rmSync(`${this.filePath}.${index}`, { force: true })
      } catch {
        // Nothing to remove.
      }
    }
  }
}

/** The logger of the main process. */
export const logger = new Logger({})
