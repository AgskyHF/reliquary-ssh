/**
 * Verification harness for stage 8 (E2EE + sync).
 *
 * Scenario, all through the real UI over CDP and a real backend:
 *  1. the app signs in to an account that was registered over HTTP;
 *  2. the Sync section asks for a master password (the account has none);
 *  3. setting it stores the derived key and publishes the PBKDF2 salt;
 *  4. a host saved in the app is pushed as an encrypted blob — the server
 *     never stores the host name or the user name in plaintext;
 *  5. a second app profile signs in to the same account, is offered the
 *     "unlock this device" form (the salt comes from the account), unlocks
 *     and receives the host — E2EE round-trip across devices;
 *  6. a rename made on the second device comes back to the first one.
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
  portIsFree,
  startElectron,
  waitFor,
  type CdpClient
} from './lib/cdp.ts'

const APP_DIR = process.env.RELIQUARY_APP_DIR ?? `${process.env.HOME}/Projects/reliquary-ssh`
const SERVER_PORT = 8793
const CDP_A = 9230
const CDP_B = 9231

const EMAIL = 'harness8@example.com'
const PASSWORD = 'correct horse'
const MASTER_PASSWORD = 'master horse battery'

const checks = new Checks()

interface WireEntry {
  entity: string
  entityId: string
  iv: string
  ciphertext: string
  tag: string
  updatedAt: string
  deletedAt: string | null
}

/** Types into an input by name. */
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

/** Clicks a sidebar navigation item by its label. */
async function openSection(cdp: CdpClient, label: string): Promise<void> {
  await cdp.evaluate(
    `(() => {
      const items = Array.from(document.querySelectorAll('.sidebar__item'))
      const item = items.find((i) => (i.textContent ?? '').trim() === ${JSON.stringify(label)})
      item?.click()
      return !!item
    })()`
  )
  await delay(400)
}

/** Signs in through the Settings form. */
async function signIn(cdp: CdpClient): Promise<boolean> {
  await openSection(cdp, 'Settings')
  if (!(await waitFor(cdp, exists('.login-form'), 20))) return false

  await setInput(cdp, '.login-form input[name="email"]', EMAIL)
  await setInput(cdp, '.login-form input[name="password"]', PASSWORD)
  await cdp.evaluate(`document.querySelector('.login-form__actions .button--primary')?.click(), true`)

  return waitFor(cdp, paneIncludesText('.topbar__status-label', EMAIL), 20)
}

/** True when the element contains the marker. */
function paneIncludesText(selector: string, marker: string): string {
  return `(document.querySelector(${JSON.stringify(selector)})?.textContent ?? '').includes(${JSON.stringify(marker)})`
}

/** Clicks the "Sync now" button. */
async function syncNow(cdp: CdpClient): Promise<void> {
  await cdp.evaluate(`document.querySelector('.sync-panel__now')?.click(), true`)
}

/** The number shown in the "Pending changes" row. */
function pendingCount(): string {
  return `((document.querySelector('.sync-panel__pending')?.textContent ?? '').trim())`
}

/** Reads the server-side entries with the token of the harness account. */
async function readServerEntries(baseUrl: string, token: string): Promise<WireEntry[]> {
  const response = await fetch(`${baseUrl}/sync`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  const body = (await response.json()) as { entries?: WireEntry[] }
  return body.entries ?? []
}

/**
 * Polls the backend until a host entry shows up.
 * The push is asynchronous, so the check must not read a half-finished
 * state.
 */
async function waitForServerHost(
  baseUrl: string,
  token: string,
  tries: number
): Promise<WireEntry | null> {
  for (let attempt = 0; attempt < tries; attempt++) {
    const entries = await readServerEntries(baseUrl, token)
    const host = entries.find((entry) => entry.entity === 'hosts')
    if (host) return host
    await delay(500)
  }
  return null
}

async function main(): Promise<void> {
  if (!(await portIsFree(CDP_A))) throw new Error(`CDP port ${CDP_A} is busy — stale harness?`)
  if (!(await portIsFree(CDP_B))) throw new Error(`CDP port ${CDP_B} is busy — stale harness?`)
  if (!(await portIsFree(SERVER_PORT))) throw new Error(`Server port ${SERVER_PORT} is busy`)

  const userDataA = mkdtempSync(join(tmpdir(), 'reliquary-stage8-a-'))
  const userDataB = mkdtempSync(join(tmpdir(), 'reliquary-stage8-b-'))
  const serverData = mkdtempSync(join(tmpdir(), 'reliquary-stage8-db-'))

  let server: ChildProcess | null = null
  let appA: ChildProcess | null = null
  let appB: ChildProcess | null = null
  let socketA: WebSocket | null = null
  let socketB: WebSocket | null = null
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
    server.stdout?.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`))
    server.stderr?.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`))

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
    checks.check('the backend starts and answers', true)

    // The account is registered out of band, so both app profiles sign in.
    const registered = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD })
    })
    const session = (await registered.json()) as { token: string }
    if (!session.token) throw new Error('Could not register the harness account')
    checks.check('the account is registered on the backend', true)

    // ---- device A ----
    appA = startElectron(userDataA, CDP_A, { RELIQUARY_SERVER_URL: baseUrl })
    const attachedA = await attach(CDP_A)
    const cdpA = attachedA.cdp
    socketA = attachedA.socket

    await waitFor(cdpA, exists('.sidebar__item'))
    checks.check('the app signs in to the account', await signIn(cdpA))

    await openSection(cdpA, 'Sync')
    checks.check(
      'the Sync section offers to create a master password',
      await waitFor(cdpA, exists('.sync-panel input[name="masterPassword"]'), 15)
    )

    await setInput(cdpA, 'input[name="masterPassword"]', MASTER_PASSWORD)
    await setInput(cdpA, 'input[name="masterPasswordConfirm"]', MASTER_PASSWORD)
    await cdpA.evaluate(`document.querySelector('.master-setup__actions .button--primary')?.click(), true`)
    checks.check(
      'setting the master password unlocks the engine',
      await waitFor(cdpA, exists('.sync-panel__now'), 25)
    )
    checks.check(
      'the first sync runs on unlock and leaves nothing pending',
      await waitFor(cdpA, `${pendingCount()} === '0'`, 25)
    )

    const created = await cdpA.evaluate(`(async () => {
      const host = await window.reliquary.host.save({
        name: 'prod',
        protocol: 'ssh',
        host: 'hidden.example.com',
        port: 22,
        username: 'root',
        authMethod: 'password'
      })
      return host.name
    })()`)
    checks.check('a host is saved through the app API', created === 'prod')
    checks.check(
      'the new host is journalled as a pending change',
      await waitFor(cdpA, `${pendingCount()} === '1'`, 15)
    )

    await syncNow(cdpA)
    checks.check(
      'Sync now pushes the change',
      await waitFor(cdpA, `${pendingCount()} === '0'`, 25)
    )

    // The push is asynchronous: the server is polled until the host
    // appears, so the check never reads a half-finished state.
    const pushed = await waitForServerHost(baseUrl, session.token, 25)
    checks.check('the backend received the host as an encrypted entry', pushed !== null)

    const entries = await readServerEntries(baseUrl, session.token)
    const hostEntry = entries.find((entry) => entry.entity === 'hosts')
    checks.check(
      'the encrypted entry carries an IV, a ciphertext and a GCM tag',
      Boolean(hostEntry && hostEntry.iv && hostEntry.tag && hostEntry.ciphertext)
    )

    const wire = JSON.stringify(entries)
    checks.check(
      'the server never sees the host name, the user name or the payload',
      !wire.includes('hidden.example.com') && !wire.includes('"root"') && !wire.includes('prod')
    )
    checks.check(
      'the PBKDF2 parameters of the account are published',
      entries.some((entry) => entry.entity === 'settings' && entry.entityId === 'sync.kdf')
    )

    // ---- device B ----
    appB = startElectron(userDataB, CDP_B, { RELIQUARY_SERVER_URL: baseUrl })
    const attachedB = await attach(CDP_B)
    const cdpB = attachedB.cdp
    socketB = attachedB.socket

    await waitFor(cdpB, exists('.sidebar__item'))
    checks.check('the second device signs in to the same account', await signIn(cdpB))

    await openSection(cdpB, 'Sync')
    checks.check(
      'the second device is offered the existing master password',
      await waitFor(cdpB, exists('.sync-panel input[name="accountMasterPassword"]'), 20)
    )

    await setInput(cdpB, 'input[name="accountMasterPassword"]', MASTER_PASSWORD)
    await cdpB.evaluate(`document.querySelector('.master-setup__actions .button--primary')?.click(), true`)
    checks.check(
      'the second device unlocks with the account password',
      await waitFor(cdpB, exists('.sync-panel__now'), 30)
    )

    await openSection(cdpB, 'Hosts')
    checks.check(
      'the host of the first device arrives decrypted',
      await waitFor(cdpB, paneIncludesText('.host-list', 'prod'), 25)
    )

    const renamed = await cdpB.evaluate(`(async () => {
      const hosts = await window.reliquary.host.list()
      const host = hosts[0]
      if (!host) return null
      const saved = await window.reliquary.host.save({ ...host, name: 'prod-renamed' })
      return saved.name
    })()`)
    checks.check('the second device renames the host', renamed === 'prod-renamed')

    await openSection(cdpB, 'Sync')
    checks.check(
      'the rename is journalled on the second device',
      await waitFor(cdpB, `${pendingCount()} === '1'`, 15)
    )
    await syncNow(cdpB)
    checks.check(
      'the second device pushes the rename',
      await waitFor(cdpB, `${pendingCount()} === '0'`, 25)
    )

    // ---- back to device A ----
    await openSection(cdpA, 'Sync')
    await syncNow(cdpA)
    checks.check(
      'the first device pulls the rename',
      await waitFor(cdpA, paneIncludesText('.sync-panel__result', 'applied 1'), 25)
    )

    await openSection(cdpA, 'Hosts')
    checks.check(
      'the host list of the first device shows the new name',
      await waitFor(cdpA, paneIncludesText('.host-list', 'prod-renamed'), 20)
    )

    const afterBoth = await readServerEntries(baseUrl, session.token)
    const wireAfter = JSON.stringify(afterBoth)
    checks.check(
      'the payload stays encrypted after both devices pushed',
      afterBoth.length > 0 &&
        !wireAfter.includes('hidden.example.com') &&
        !wireAfter.includes('prod-renamed') &&
        !wireAfter.includes('"root"')
    )

    // The plaintext of the entry must not appear in the response either.
    checks.check(
      'every entry carries an IV and a GCM tag',
      afterBoth.every((entry) =>
        entry.entity === 'settings' ? entry.iv === '' : Boolean(entry.iv && entry.tag)
      )
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
    socketA?.close()
    socketB?.close()
    await cleanupApp(appA, userDataA)
    await cleanupApp(appB, userDataB)
    server?.kill('SIGTERM')
    await delay(500)
    process.exit(exitCode)
  }
}

void main()
