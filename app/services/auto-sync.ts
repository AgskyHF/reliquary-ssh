/**
 * The auto-sync scheduler.
 *
 * The sync runs on a timer instead of only on demand. The interval is a
 * device setting, so a user with a slow link can make it longer.
 *
 * The scheduler lives in the main process: it needs the master key and
 * the database, neither of which the renderer may touch.
 *
 * The timer only fires when it can do something useful:
 *  - the master password is unlocked (otherwise nothing can be encrypted);
 *  - a transport is available (a signed-in account or a shared folder);
 *  - no other sync is running.
 */
import { logger } from './logger'

export interface AutoSyncOptions {
  /** The interval in milliseconds. */
  intervalMs: number
  /** True when a sync may run right now. */
  canSync: () => boolean
  /** Runs one sync. */
  run: () => Promise<unknown>
  /** Called when a scheduled sync failed. */
  onError?: (error: Error) => void
}

export class AutoSyncScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = true

  constructor(private readonly options: AutoSyncOptions) {}

  /** True when the scheduler is armed. */
  get running(): boolean {
    return !this.stopped
  }

  /** Starts the timer. It replaces an already running one. */
  start(): void {
    this.stop()

    if (this.options.intervalMs <= 0) {
      logger.info('The auto sync is off')
      return
    }

    this.stopped = false
    this.schedule()
    logger.info(`The auto sync is armed every ${Math.round(this.options.intervalMs / 1000)}s`)
  }

  /** Stops the timer. */
  stop(): void {
    this.stopped = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** Changes the interval and re-arms the timer. */
  setInterval(intervalMs: number): void {
    this.options.intervalMs = intervalMs
    if (!this.stopped) this.start()
  }

  /**
   * Runs a sync right away, outside the timer.
   * Used when the user asks for it and when the app wakes up.
   */
  async runNow(): Promise<boolean> {
    if (!this.options.canSync()) return false

    try {
      await this.options.run()
      return true
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      logger.warn(`The scheduled sync failed: ${err.message}`)
      this.options.onError?.(err)
      return false
    }
  }

  /** Arms the next run. */
  private schedule(): void {
    if (this.stopped) return

    this.timer = setTimeout(() => {
      this.timer = null
      void this.runNow().finally(() => this.schedule())
    }, this.options.intervalMs)

    // The timer must not keep the process alive on its own.
    this.timer.unref?.()
  }
}
