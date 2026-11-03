/**
 * Shared helpers for the CDP verification harnesses.
 *
 * Every harness drives the real application window over the Chrome DevTools
 * Protocol: the app is started in offscreen mode (no visible window), then
 * the renderer is evaluated with Runtime.evaluate.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { rmSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { WebSocket } from 'ws'

export const APP_DIR = process.env.RELIQUARY_APP_DIR ?? `${process.env.HOME}/Projects/reliquary-ssh`

/**
 * The .bin/electron launcher is a node shim: killing it orphans the real
 * Electron.app process, which keeps the CDP port. The binary is launched
 * directly instead.
 */
export const ELECTRON_BIN =
  process.platform === 'darwin'
    ? `${APP_DIR}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`
    : `${APP_DIR}/node_modules/.bin/electron`

export function startElectron(userData: string, cdpPort: number): ChildProcess {
  const proc = spawn(ELECTRON_BIN, ['.', `--remote-debugging-port=${cdpPort}`], {
    cwd: APP_DIR,
    env: { ...process.env, RELIQUARY_USER_DATA: userData, RELIQUARY_OFFSCREEN: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  proc.stdout?.on('data', (chunk) => process.stdout.write(`[app] ${chunk}`))
  proc.stderr?.on('data', (chunk) => process.stdout.write(`[app] ${chunk}`))
  return proc
}

/** Minimal CDP client over the renderer websocket. */
export class CdpClient {
  private nextId = 1
  private readonly pending = new Map<number, (result: unknown) => void>()
  private readonly socket: WebSocket

  constructor(socket: WebSocket) {
    this.socket = socket
    socket.on('message', (raw: Buffer) => {
      const message = JSON.parse(raw.toString()) as { id?: number; result?: unknown }
      if (message.id && this.pending.has(message.id)) {
        this.pending.get(message.id)?.(message.result)
        this.pending.delete(message.id)
      }
    })
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression: string): Promise<unknown> {
    const result = (await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })) as { result?: { value?: unknown } }
    return result?.result?.value
  }

  async text(expression: string): Promise<string> {
    return String((await this.evaluate(expression)) ?? '')
  }
}

/** Waits until the renderer target shows up and attaches to it. */
export async function attach(cdpPort: number): Promise<{ cdp: CdpClient; socket: WebSocket }> {
  let target: { webSocketDebuggerUrl: string } | null = null
  for (let attempt = 0; attempt < 15 && !target; attempt++) {
    await delay(1000)
    try {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`)
      const targets = (await response.json()) as { title: string; webSocketDebuggerUrl: string }[]
      target = targets.find((t) => t.title.includes('ReliquarySSH')) ?? null
    } catch {
      // app not listening yet
    }
  }
  if (!target) throw new Error('Renderer target not found on CDP port')

  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  const cdp = new CdpClient(socket)
  await cdp.send('Runtime.enable')
  return { cdp, socket }
}

/** Polls an expression until it is truthy. */
export async function waitFor(
  cdp: CdpClient,
  expression: string,
  tries = 30
): Promise<boolean> {
  for (let attempt = 0; attempt < tries; attempt++) {
    const value = await cdp.evaluate(`Boolean(${expression})`)
    if (value === true) return true
    await delay(500)
  }
  return false
}

/** True when nothing is listening on the port. */
export async function portIsFree(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) })
    await response.body?.cancel()
    return false
  } catch {
    return true
  }
}

/**
 * Kills the app and removes its scratch profile.
 *
 * The app writes to userData while it shuts down, so the directory is
 * removed with retries and the processes are killed by their profile path
 * (killing the parent alone leaves the helper processes behind).
 */
export async function cleanupApp(app: ChildProcess | null, userData: string): Promise<void> {
  app?.kill('SIGKILL')
  await delay(500)

  // The helper processes keep the profile open; kill them by the path.
  try {
    const { execSync } = await import('node:child_process')
    execSync(`pkill -f ${JSON.stringify(`--user-data-dir=${userData}`)}`, { stdio: 'ignore' })
  } catch {
    // No matching process — nothing to kill.
  }

  await delay(500)

  try {
    rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch {
    // The scratch directory is left behind in the temp folder — harmless.
  }
}

/** Collects check results and prints them. */
export class Checks {
  readonly results: { name: string; ok: boolean }[] = []

  check(name: string, ok: boolean): boolean {
    this.results.push({ name, ok })
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}`)
    return ok
  }

  get failed(): number {
    return this.results.filter((r) => !r.ok).length
  }

  get total(): number {
    return this.results.length
  }

  get allPassed(): boolean {
    return this.results.length > 0 && this.failed === 0
  }
}

/** JS expression helpers. */
export const exists = (selector: string): string =>
  `document.querySelector(${JSON.stringify(selector)})`

export const paneText = (selector: string): string =>
  `(document.querySelector(${JSON.stringify(selector)})?.textContent ?? '')`

export const paneIncludes = (selector: string, marker: string): string =>
  `${paneText(selector)}.includes(${JSON.stringify(marker)})`
