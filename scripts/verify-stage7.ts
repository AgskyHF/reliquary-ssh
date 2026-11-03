/**
 * Verification harness for stage 7 (backend + auth).
 *
 * Scenario (all through the real UI over CDP):
 *  1. the Settings section of the sidebar shows the sign-in form;
 *  2. creating an account signs the user in — the top bar shows the
 *     account and the status dot turns green;
 *  3. signing out returns the form;
 *  4. signing in again with the same credentials works;
 *  5. a wrong password shows the error from the backend.
 *
 * The backend runs in this process, so the app talks to a real server.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { WebSocket } from 'ws'
import {
  Checks,
  attach,
  cleanupApp,
  exists,
  paneText,
  portIsFree,
  startElectron,
  waitFor
} from './lib/cdp.ts'

const APP_DIR = process.env.RELIQUARY_APP_DIR ?? `${process.env.HOME}/Projects/reliquary-ssh`
const SERVER_PORT = 8792
const CDP_PORT = 9229

const checks = new Checks()

/** Types into an input by name. */
async function setInput(
  cdp: Awaited<ReturnType<typeof attach>>['cdp'],
  selector: string,
  value: string
): Promise<boolean> {
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

async function main(): Promise<void> {
  if (!(await portIsFree(CDP_PORT))) throw new Error(`CDP port ${CDP_PORT} is busy — stale harness?`)
  if (!(await portIsFree(SERVER_PORT))) throw new Error(`Server port ${SERVER_PORT} is busy`)

  const userData = mkdtempSync(join(tmpdir(), 'reliquary-stage7-'))
  const serverData = mkdtempSync(join(tmpdir(), 'reliquary-stage7-db-'))

  let server: ChildProcess | null = null
  let app: ChildProcess | null = null
  let socket: WebSocket | null = null
  let exitCode = 1
  let errored = false

  try {
    // The backend runs as a separate process on a free port.
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
    server.stdout?.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`))
    server.stderr?.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`))

    // Wait for the backend to answer.
    let ready = false
    for (let attempt = 0; attempt < 20 && !ready; attempt++) {
      await delay(500)
      try {
        const response = await fetch(`http://127.0.0.1:${SERVER_PORT}/health`)
        ready = response.ok
      } catch {
        // The backend is not listening yet.
      }
    }
    if (!ready) throw new Error('The backend did not start')
    checks.check('the backend starts and answers', true)

    app = startElectron(userData, CDP_PORT, {
      RELIQUARY_SERVER_URL: `http://127.0.0.1:${SERVER_PORT}`
    })
    const session = await attach(CDP_PORT)
    const cdp = session.cdp
    socket = session.socket

    // 1. open the Settings section.
    await waitFor(cdp, exists('.sidebar__item'))
    await cdp.evaluate(
      `(() => {
        const items = Array.from(document.querySelectorAll('.sidebar__item'))
        const item = items.find((i) => (i.textContent ?? '').trim() === 'Settings')
        item?.click()
        return !!item
      })(), true`
    )
    checks.check(
      'the sign-in form appears in the Settings section',
      await waitFor(cdp, exists('.login-form'), 10)
    )
    checks.check(
      'the form offers both ways to sign in',
      (await cdp.text(paneText('.login-form__google'))).includes('Google')
    )

    // 2. create an account.
    await setInput(cdp, '.login-form input[name="email"]', 'harness@example.com')
    await setInput(cdp, '.login-form input[name="password"]', 'correct horse')

    // Switch to the registration mode.
    await cdp.evaluate(
      `(() => {
        const buttons = Array.from(document.querySelectorAll('.login-form__actions .button'))
        const button = buttons.find((b) => (b.textContent ?? '').trim() === 'Create an account')
        button?.click()
        return !!button
      })(), true`
    )
    checks.check(
      'the form switches to registration',
      await waitFor(cdp, paneIncludesText('.login-form__title', 'Create an account'), 10)
    )

    await cdp.evaluate(
      `document.querySelector('.login-form__actions .button--primary')?.click(), true`
    )
    checks.check(
      'the account is created and the user is signed in',
      await waitFor(cdp, paneIncludesText('.topbar__status-label', 'harness@example.com'), 20)
    )
    checks.check(
      'the status dot turns green after signing in',
      await waitFor(cdp, exists('.topbar__status .status-dot--ok'), 10)
    )

    // 3. sign out.
    await cdp.evaluate(
      `(() => {
        const buttons = Array.from(document.querySelectorAll('.topbar__button'))
        const button = buttons.find((b) => (b.textContent ?? '').trim() === 'Sign out')
        button?.click()
        return !!button
      })(), true`
    )
    checks.check(
      'signing out brings the form back',
      await waitFor(cdp, exists('.login-form'), 15)
    )

    // 4. sign in again.
    await setInput(cdp, '.login-form input[name="email"]', 'harness@example.com')
    await setInput(cdp, '.login-form input[name="password"]', 'correct horse')
    await cdp.evaluate(
      `document.querySelector('.login-form__actions .button--primary')?.click(), true`
    )
    checks.check(
      'signing in with the same credentials works',
      await waitFor(cdp, paneIncludesText('.topbar__status-label', 'harness@example.com'), 20)
    )

    // 5. a wrong password shows the backend error.
    await cdp.evaluate(
      `(() => {
        const buttons = Array.from(document.querySelectorAll('.topbar__button'))
        const button = buttons.find((b) => (b.textContent ?? '').trim() === 'Sign out')
        button?.click()
        return !!button
      })(), true`
    )
    await waitFor(cdp, exists('.login-form'), 15)

    await setInput(cdp, '.login-form input[name="email"]', 'harness@example.com')
    await setInput(cdp, '.login-form input[name="password"]', 'wrong password')
    await cdp.evaluate(
      `document.querySelector('.login-form__actions .button--primary')?.click(), true`
    )
    checks.check(
      'a wrong password shows the error from the backend',
      await waitFor(cdp, paneIncludesText('.connect-form__error', 'Wrong email or password'), 15)
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
    await delay(500)
    process.exit(exitCode)
  }
}

/** JS expression: does the element contain the marker. */
function paneIncludesText(selector: string, marker: string): string {
  return `(document.querySelector(${JSON.stringify(selector)})?.textContent ?? '').includes(${JSON.stringify(marker)})`
}

void main()
