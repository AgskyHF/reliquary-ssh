/**
 * Verification harness for the auto sync.
 *
 * Scenario, through the real UI over CDP and a real backend:
 *  1. the app signs in and sets a master password;
 *  2. the Sync panel offers the auto-sync interval;
 *  3. the interval is persisted as a device setting;
 *  4. the main process re-arms its timer — the log says so;
 *  5. turning the auto sync off disarms the timer;
 *  6. the timer actually fires and pushes a change without the button.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { WebSocket } from 'ws'
import {
  Checks,
  attach,
  cleanupApp,
  exists,
  portIsFree,
  startElectron,
  waitFor,
  type CdpClient
} from './lib/cdp.ts'

const APP_DIR = process.env.RELIQUARY_APP_DIR ?? `${process.env.HOME}/Projects/reliquary-ssh`
const SERVER_PORT = 8796
const CDP_PORT = 9238

const EMAIL = 'harness-auto@example.com'
const PASSWORD = 'correct horse'
const MASTER_PASSWORD = 'master horse battery'

const checks = new Checks()

/** Types into an input by selector. */
async function setInput(cdp: CdpClient, selector: string, value: string): Promise<boolean> {
  const ok = await cdp.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    if (!input) return false
    const proto = Object.getPrototypeOf(input)
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  return ok === true
}

/** Picks a value in a select. */
async function selectOption(cdp: CdpClient, selector: string, value: string): Promise<boolean> {
  const ok = await cdp.evaluate(`(() => {
    const select = document.querySelector(${JSON.stringify(selector)})
    if (!select) return false
    const proto = Object.getPrototypeOf(select)
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(select, ${JSON.stringify(value)})
    select.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  return ok === true
}

/** Clicks a sidebar navigation item by its label. */
async function openSection(cdp: CdpClient, label: string): Promise<void> {
  await cdp.evaluate(
    `(() => {
      const items = Array.from(document.querySelectorAll('.sidebar__item'))
      items.find((i) => (i.textContent ?? '').trim() === ${JSON.stringify(label)})?.click()
      return true
    })()`
  )
  await delay(400)
}

/** Reads the tail of the app log. */
function readLog(userData: string): string {
  try {
    return readFileSync(join(userData, 'reliquary.log'), 'utf8')
  } catch {
    return ''
  }
}

async function main(): Promise<void> {
  if (!(await portIsFree(CDP_PORT))) throw new Error(`CDP port ${CDP_PORT} is busy`)
  if (!(await portIsFree(SERVER_PORT))) throw new Error(`Server port ${SERVER_PORT} is busy`)

  const userData = mkdtempSync(join(tmpdir(), 'reliquary-autosync-'))
  const serverData = mkdtempSync(join(tmpdir(), 'reliquary-autosync-db-'))

  let server: ChildProcess | null = null
  let app: ChildProcess | null = null
  let socket: WebSocket | null = null
  let exitCode = 1
  let errored = false

  try {
    server = spawn(
      process.execPath,
      ['--experimental-strip-types', `${APP_DIR}/server/index.ts`],
      {
        cwd: APP_DIR,
        env: {
          ...process.env,
          JWT_SECRET: 'harness-secret',
          PORT: String(SERVER_PORT),
          DATABASE_PATH: join(serverData, 'server.db')
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )

    const baseUrl = `http://127.0.0.1:${SERVER_PORT}`
    let ready = false
    for (let attempt = 0; attempt < 20 && !ready; attempt++) {
      await delay(500)
      try {
        ready = (await fetch(`${baseUrl}/health`)).ok
      } catch {
        // not listening yet
      }
    }
    if (!ready) throw new Error('The backend did not start')

    const registered = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD })
    })
    const session = (await registered.json()) as { token: string }
    if (!session.token) throw new Error('Could not register the harness account')

    app = startElectron(userData, CDP_PORT, { RELIQUARY_SERVER_URL: baseUrl })
    const attached = await attach(CDP_PORT)
    const cdp = attached.cdp
    socket = attached.socket

    await waitFor(cdp, exists('.sidebar__item'))

    // 1. sign in.
    await openSection(cdp, 'Settings')
    await waitFor(cdp, exists('.login-form'), 20)
    await setInput(cdp, '.login-form input[name="email"]', EMAIL)
    await setInput(cdp, '.login-form input[name="password"]', PASSWORD)
    await cdp.evaluate(`document.querySelector('.login-form__actions .button--primary')?.click(), true`)
    checks.check(
      'the app signs in',
      await waitFor(cdp, `(document.querySelector('.topbar__status-label')?.textContent ?? '').includes(${JSON.stringify(EMAIL)})`, 20)
    )

    // The master password makes the sync possible at all.
    await openSection(cdp, 'Sync')
    await waitFor(cdp, exists('.sync-panel input[name="masterPassword"]'), 20)
    await setInput(cdp, '.sync-panel input[name="masterPassword"]', MASTER_PASSWORD)
    await setInput(cdp, '.sync-panel input[name="masterPasswordConfirm"]', MASTER_PASSWORD)
    await cdp.evaluate(`document.querySelector('.master-setup__actions .button--primary')?.click(), true`)
    checks.check(
      'the master password is set',
      await waitFor(cdp, exists('.sync-panel__now'), 30)
    )

    // 2. the interval is offered.
    checks.check(
      'the Sync panel offers the auto-sync interval',
      await waitFor(cdp, exists('.sync-panel select[name="autoSyncSeconds"]'), 15)
    )

    const options = (await cdp.evaluate(
      `Array.from(document.querySelectorAll('.sync-panel select[name="autoSyncSeconds"] option')).map(o => o.value)`
    )) as string[]
    checks.check(
      'the interval can be turned off and set to a minute',
      options.includes('0') && options.includes('60')
    )

    // 3. the interval is persisted.
    await selectOption(cdp, '.sync-panel select[name="autoSyncSeconds"]', '60')
    const persisted = (await cdp.evaluate(
      `window.reliquary.settings.get().then(s => s.autoSyncSeconds)`
    )) as number
    checks.check('the interval is stored as a device setting', persisted === 60)

    // 4. the timer is re-armed.
    const status = (await cdp.evaluate(`window.reliquary.sync.autoStatus()`)) as {
      enabled: boolean
      intervalSeconds: number
      running: boolean
    }
    checks.check(
      'the auto sync reports itself armed every minute',
      status.enabled === true && status.intervalSeconds === 60 && status.running === true
    )

    await delay(600)
    checks.check(
      'the main process re-armed its timer',
      readLog(userData).includes('The auto sync is armed every 60s')
    )

    // 5. a change is pushed by the timer, without the button.
    const before = await fetch(`${baseUrl}/sync`, {
      headers: { Authorization: `Bearer ${session.token}` }
    })
    const beforeBody = (await before.json()) as { entries?: unknown[] }
    const beforeCount = beforeBody.entries?.length ?? 0

    await cdp.evaluate(`(async () => {
      await window.reliquary.host.save({
        name: 'timer-host',
        protocol: 'ssh',
        host: 'timer.example.com',
        port: 22,
        username: 'root',
        authMethod: 'password',
        keyId: null,
        notes: ''
      })
      return true
    })()`)

    // The interval is a minute; the harness waits it out rather than
    // pretending the timer fired.
    let pushed = false
    for (let attempt = 0; attempt < 24 && !pushed; attempt++) {
      await delay(5000)
      const response = await fetch(`${baseUrl}/sync`, {
        headers: { Authorization: `Bearer ${session.token}` }
      })
      const body = (await response.json()) as { entries?: unknown[] }
      pushed = (body.entries?.length ?? 0) > beforeCount
    }
    checks.check('the timer pushes a change without the button', pushed)

    // 6. turning it off disarms the timer.
    await openSection(cdp, 'Sync')
    await selectOption(cdp, '.sync-panel select[name="autoSyncSeconds"]', '0')
    const offStatus = (await cdp.evaluate(`window.reliquary.sync.autoStatus()`)) as {
      enabled: boolean
      running: boolean
    }
    checks.check(
      'turning the auto sync off disarms the timer',
      offStatus.enabled === false && offStatus.running === false
    )

    exitCode = checks.allPassed ? 0 : 1
  } catch (error) {
    errored = true
    console.error('RESULT: ERROR —', error instanceof Error ? (error.stack ?? error.message) : error)
    exitCode = 1
  } finally {
    console.log(`\nChecks: ${checks.total}, failed: ${checks.failed}`)
    const ok = !errored && checks.allPassed
    console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL')
    socket?.close()
    await cleanupApp(app, userData)
    server?.kill('SIGTERM')
    process.exit(exitCode)
  }
}

void main()
