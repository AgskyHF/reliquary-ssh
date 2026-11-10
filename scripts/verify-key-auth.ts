/**
 * Verification harness for key authentication (stage 5).
 *
 * Scenario (all through the real UI over CDP):
 *  1. the Keychain is unlocked with a master password;
 *  2. the private key of the test SSH server is imported into the Keychain;
 *  3. a new tab switches the connect form to key authentication;
 *  4. the key is picked from the Keychain and the session connects;
 *  5. the terminal shows the server banner — the connection was made
 *     with a key, not with a password.
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
  paneIncludes,
  paneText,
  portIsFree,
  startElectron,
  waitFor
} from './lib/cdp.ts'

const APP_DIR = process.env.RELIQUARY_APP_DIR ?? `${process.env.HOME}/Projects/reliquary-ssh`
const SSH_PORT = 2228
const CDP_PORT = 9228

const ACTIVE_PANE = '.tab-pane:not([hidden])'
const checks = new Checks()

interface StartedServer {
  proc: ChildProcess
  /** The private key the server authorizes. */
  privateKey: string
}

/** Starts the test SSH server and reads the authorized private key from it. */
async function startSshServer(): Promise<StartedServer> {
  const proc = spawn(
    process.execPath,
    ['--experimental-strip-types', `${APP_DIR}/scripts/test-ssh-server.ts`, String(SSH_PORT)],
    { cwd: APP_DIR, stdio: ['ignore', 'pipe', 'pipe'] }
  )

  let buffer = ''
  let privateKey = ''

  const found = new Promise<void>((resolve) => {
    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      buffer += text
      process.stdout.write(`[ssh] ${text}`)

      const match = /AUTHORIZED_PRIVATE_KEY:(.+)/.exec(buffer)
      if (match) {
        privateKey = (match[1] ?? '').replace(/\\n/g, '\n')
        resolve()
      }
    })
    proc.stderr?.on('data', (chunk) => process.stderr.write(`[ssh] ${chunk}`))
  })

  await Promise.race([found, delay(10_000)])
  if (!privateKey) throw new Error('The test server did not report its authorized key')

  return { proc, privateKey }
}

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

/** Sets a textarea value (the private key field). */
async function setTextarea(
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
  if (!(await portIsFree(SSH_PORT))) throw new Error(`SSH test port ${SSH_PORT} is busy — stale server?`)

  const userData = mkdtempSync(join(tmpdir(), 'reliquary-keyauth-'))
  const ssh = await startSshServer()
  let app: ChildProcess | null = null
  let socket: WebSocket | null = null
  let exitCode = 1
  let errored = false

  try {
    app = startElectron(userData, CDP_PORT)
    const session = await attach(CDP_PORT)
    const cdp = session.cdp
    socket = session.socket

    // 1. open the Keychain and unlock it.
    await waitFor(cdp, exists('.sidebar__item'))
    await cdp.evaluate(
      `(() => {
        const items = Array.from(document.querySelectorAll('.sidebar__item'))
        const item = items.find((i) => (i.textContent ?? '').trim() === 'Keychain')
        item?.click()
        return !!item
      })(), true`
    )
    // The keychain asks for no master password — the private keys are
    // sealed with the key of the device.
    checks.check(
      'the keychain opens without a master password',
      await waitFor(cdp, exists('.keychain-panel__toolbar'), 15)
    )
    checks.check(
      'the keychain asks for no master password',
      !(await cdp.evaluate(`document.querySelector('.master-setup__title') !== null`))
    )

    // 2. import the private key of the test server.
    await cdp.evaluate(
      `(() => {
        const buttons = Array.from(document.querySelectorAll('.keychain-panel__toolbar .button'))
        const button = buttons.find((b) => (b.textContent ?? '').trim() === 'Import')
        button?.click()
        return !!button
      })(), true`
    )
    checks.check(
      'the import dialog opens',
      await waitFor(cdp, exists('.keychain-panel__dialog textarea'), 10)
    )

    await setInput(cdp, '.keychain-panel__dialog input.field__input', 'server-key')
    await setTextarea(cdp, '.keychain-panel__dialog textarea', ssh.privateKey)
    await cdp.evaluate(
      `(() => {
        const dialog = document.querySelector('.keychain-panel__dialog')
        const button = dialog?.querySelector('.button--primary')
        button?.click()
        return !!button
      })(), true`
    )

    checks.check(
      'the imported key appears in the list',
      await waitFor(cdp, exists('.keychain-panel__item'), 20)
    )
    const keyText = await cdp.text(paneText('.keychain-panel__item'))
    checks.check('the imported key is named', keyText.includes('server-key'))

    // 3. open a new tab and switch the form to key authentication.
    await cdp.evaluate(`document.querySelector('.tab-bar__new')?.click(), true`)
    checks.check(
      'a new tab opens',
      await waitFor(cdp, `document.querySelectorAll('.tab-bar__tab').length === 2`, 10)
    )
    checks.check(
      'the connect form is shown in the new tab',
      await waitFor(cdp, exists(`${ACTIVE_PANE} .connect-form`), 10)
    )

    await cdp.evaluate(
      `(() => {
        const pane = document.querySelector(${JSON.stringify(ACTIVE_PANE)})
        const switches = pane?.querySelectorAll('.protocol-switch')
        const authSwitch = switches?.[switches.length - 1]
        const buttons = Array.from(authSwitch?.querySelectorAll('.protocol-switch__option') ?? [])
        const keyButton = buttons.find((b) => (b.textContent ?? '').trim() === 'Key')
        keyButton?.click()
        return !!keyButton
      })(), true`
    )
    checks.check(
      'the key selector appears',
      await waitFor(cdp, exists(`${ACTIVE_PANE} select[name="key"]`), 10)
    )

    // 4. pick the key and connect.
    await cdp.evaluate(
      `(() => {
        const select = document.querySelector(${JSON.stringify(`${ACTIVE_PANE} select[name="key"]`)})
        if (!select) return false
        const option = Array.from(select.options).find((o) => (o.textContent ?? '').includes('server-key'))
        if (!option) return false
        const proto = Object.getPrototypeOf(select)
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(select, option.value)
        select.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })(), true`
    )

    await setInput(cdp, `${ACTIVE_PANE} input[name="host"]`, '127.0.0.1')
    await setInput(cdp, `${ACTIVE_PANE} input[name="port"]`, String(SSH_PORT))
    await setInput(cdp, `${ACTIVE_PANE} input[name="username"]`, 'tester')

    await cdp.evaluate(
      `document.querySelector(${JSON.stringify(`${ACTIVE_PANE} .connect-form button[type="submit"]`)})?.click(), true`
    )

    // 5. the terminal shows the server banner.
    const connected = await waitFor(
      cdp,
      paneIncludes(`${ACTIVE_PANE} .xterm-rows`, 'Welcome to ReliquarySSH test server'),
      30
    )
    checks.check('the session connects with the key', connected)
    if (!connected) {
      console.log(
        `[debug] pane text: ${await cdp.text(paneText(`${ACTIVE_PANE} .terminal-panel`))}`
      )
      console.log(
        `[debug] error: ${await cdp.text(paneText(`${ACTIVE_PANE} .connect-form__error`))}`
      )
    }

    const title = await cdp.text(paneText(`${ACTIVE_PANE} .terminal-panel__title`))
    checks.check('the tab title shows the connection', title.includes('tester@127.0.0.1'))

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
    ssh.proc.kill('SIGTERM')
    await delay(500)
    process.exit(exitCode)
  }
}

void main()
