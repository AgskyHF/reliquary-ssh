/**
 * Tests for the auto-sync scheduler.
 *
 * The scheduler is the piece that decides *when* a sync may run, so the
 * tests pin three things: it fires on the interval, it skips a tick when
 * there is nothing to sync, and one failure does not kill the timer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AutoSyncScheduler } from '../app/services/auto-sync.ts'

describe('AutoSyncScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires on the interval', async () => {
    const run = vi.fn(async () => undefined)
    const scheduler = new AutoSyncScheduler({
      intervalMs: 1000,
      canSync: () => true,
      run
    })

    scheduler.start()
    expect(scheduler.running).toBe(true)

    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(2)

    scheduler.stop()
  })

  it('does not fire while it is stopped', async () => {
    const run = vi.fn(async () => undefined)
    const scheduler = new AutoSyncScheduler({
      intervalMs: 1000,
      canSync: () => true,
      run
    })

    scheduler.start()
    scheduler.stop()

    await vi.advanceTimersByTimeAsync(5000)
    expect(run).not.toHaveBeenCalled()
    expect(scheduler.running).toBe(false)
  })

  it('skips a tick when a sync may not run', async () => {
    const run = vi.fn(async () => undefined)
    let allowed = false

    const scheduler = new AutoSyncScheduler({
      intervalMs: 1000,
      canSync: () => allowed,
      run
    })

    scheduler.start()
    await vi.advanceTimersByTimeAsync(1000)
    expect(run).not.toHaveBeenCalled()

    allowed = true
    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(1)

    scheduler.stop()
  })

  it('keeps running after a failure', async () => {
    const onError = vi.fn()
    const run = vi.fn(async () => {
      throw new Error('the backend is down')
    })

    const scheduler = new AutoSyncScheduler({
      intervalMs: 1000,
      canSync: () => true,
      run,
      onError
    })

    scheduler.start()
    await vi.advanceTimersByTimeAsync(1000)
    expect(onError).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(2)
    expect(scheduler.running).toBe(true)

    scheduler.stop()
  })

  it('does nothing when the interval is zero', async () => {
    const run = vi.fn(async () => undefined)
    const scheduler = new AutoSyncScheduler({
      intervalMs: 0,
      canSync: () => true,
      run
    })

    scheduler.start()
    expect(scheduler.running).toBe(false)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(run).not.toHaveBeenCalled()
  })

  it('re-arms when the interval changes', async () => {
    const run = vi.fn(async () => undefined)
    const scheduler = new AutoSyncScheduler({
      intervalMs: 1000,
      canSync: () => true,
      run
    })

    scheduler.start()
    scheduler.setInterval(5000)

    await vi.advanceTimersByTimeAsync(1000)
    expect(run).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(4000)
    expect(run).toHaveBeenCalledTimes(1)

    scheduler.stop()
  })

  it('can run on demand, outside the timer', async () => {
    const run = vi.fn(async () => undefined)
    const scheduler = new AutoSyncScheduler({
      intervalMs: 60_000,
      canSync: () => true,
      run
    })

    expect(await scheduler.runNow()).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('does not run on demand when a sync may not run', async () => {
    const run = vi.fn(async () => undefined)
    const scheduler = new AutoSyncScheduler({
      intervalMs: 60_000,
      canSync: () => false,
      run
    })

    expect(await scheduler.runNow()).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })
})
