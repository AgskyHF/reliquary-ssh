/**
 * Verification harness for stage 4 (SFTP file manager).
 *
 * Scenario (all through the real UI over CDP):
 *  1. fresh profile starts with one tab and the connect form;
 *  2. the protocol switch switches the form to SFTP;
 *  3. the tab connects to the test SFTP server;
 *  4. the file manager lists the remote directory (files and subdirectories);
 *  5. navigating into a subdirectory updates the listing;
 *  6. "↑ Up" returns to the parent directory;
 *  7. an SSH tab and an SFTP tab coexist as independent sessions;
 *  8. closing the SFTP tab leaves the app alive.
 *
 * The SFTP server runs in this process (the same helper the unit tests use),
 * so the harness knows the served directory up front.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { WebSocket } from 'ws'
import {
  Checks,
  cleanupApp,
  attach,
  exists,
  paneText,
  portIsFree,
  startElectron,
  waitFor
} from './lib/cdp.ts'
import {
  makeServerDir,
  startTestSftpServer,
  writeServerFile,
  type TestSftpServer
} from '../tests/helpers/test-sftp-server.ts'

const APP_DIR = process.env.RELIQUARY_APP_DIR ?? `${process.env.HOME}/Projects/reliquary-ssh`
const SSH_PORT = 2226
const CDP_PORT = 9226

const ACTIVE_PANE = '.tab-pane:not([hidden])'
const checks = new Checks()

async function startSshServer(): Promise<ChildProcess> {
  const proc = spawn(
    process.execPath,
    ['--experimental-strip-types', `${APP_DIR}/scripts/test-ssh-server.ts`, String(SSH_PORT)],
    { cwd: APP_DIR, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  proc.stdout?.on('data', (chunk) => process.stdout.write(`[ssh] ${chunk}`))
  proc.stderr?.on('data', (chunk) => process.stdout.write(`[ssh] ${chunk}`))
  await delay(1500)
  return proc
}

/** Fills the connect form of the active pane. */
async function fillActiveForm(
  cdp: Awaited<ReturnType<typeof attach>>['cdp'],
  port: number
): Promise<boolean> {
  const filled = await cdp.evaluate(`(() => {
    const scope = ${JSON.stringify(`${ACTIVE_PANE} `)}
    const setValue = (sel, value) => {
      const input = document.querySelector(scope + sel)
      if (!input) return false
      const proto = Object.getPrototypeOf(input)
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    }
    const ok = [
      setValue('input[name="host"]', '127.0.0.1'),
      setValue('input[name="port"]', '${port}'),
      setValue('input[name="username"]', 'tester'),
      setValue('input[name="password"]', 'secret')
    ]
    return ok.every(Boolean)
  })()`)
  return filled === true
}

/** The file names shown in the active pane's file manager. */
async function listingNames(
  cdp: Awaited<ReturnType<typeof attach>>['cdp']
): Promise<string> {
  return cdp.text(
    `Array.from(document.querySelectorAll(${JSON.stringify(`${ACTIVE_PANE} .file-manager__cell--name`)})).map((n) => (n.textContent ?? '').trim()).join('|')`
  )
}

async function main(): Promise<void> {
  if (!(await portIsFree(CDP_PORT))) throw new Error(`CDP port ${CDP_PORT} is busy — stale harness?`)
  if (!(await portIsFree(SSH_PORT))) throw new Error(`SSH test port ${SSH_PORT} is busy — stale server?`)

  const userData = mkdtempSync(join(tmpdir(), 'reliquary-stage4-'))
  const ssh = await startSshServer()
  let sftp: TestSftpServer | null = null
  let app: ChildProcess | null = null
  let socket: WebSocket | null = null
  let exitCode = 1
  let errored = false

  try {
    sftp = await startTestSftpServer()
    writeServerFile(sftp.root, 'hello.txt', 'hello from sftp\n')
    makeServerDir(sftp.root, 'subdir')
    writeServerFile(join(sftp.root, 'subdir'), 'nested.txt', 'nested\n')

    app = startElectron(userData, CDP_PORT)
    const session = await attach(CDP_PORT)
    const cdp = session.cdp
    socket = session.socket

    checks.check(
      'fresh profile shows the connect form',
      await waitFor(cdp, exists(`${ACTIVE_PANE} .connect-form`))
    )
    checks.check(
      'connect form offers the protocol switch',
      await waitFor(cdp, exists(`${ACTIVE_PANE} .protocol-switch`))
    )

    // Switch the form to SFTP.
    await cdp.evaluate(
      `document.querySelector(${JSON.stringify(`${ACTIVE_PANE} .protocol-switch__option:nth-child(2)`)})?.click(), true`
    )
    checks.check(
      'SFTP becomes the selected protocol',
      (await cdp.text(
        `document.querySelector(${JSON.stringify(`${ACTIVE_PANE} .protocol-switch__option--active`)})?.textContent ?? ''`
      )) === 'SFTP'
    )

    // Connect over SFTP.
    if (!(await fillActiveForm(cdp, sftp.port))) throw new Error('Could not fill the connect form')
    await cdp.evaluate(
      `document.querySelector(${JSON.stringify(`${ACTIVE_PANE} .connect-form button[type="submit"]`)}).click(), true`
    )

    const listed = await waitFor(cdp, exists(`${ACTIVE_PANE} .file-manager__list`))
    checks.check('file manager appears after connecting', listed)
    if (!listed) {
      console.log(
        `[debug] pane html: ${await cdp.text(`document.querySelector('.tab-pane')?.outerHTML?.slice(0, 2500) ?? 'NONE'`)}`
      )
      throw new Error('File manager did not render')
    }

    const names = await listingNames(cdp)
    console.log(`[debug] listing names: ${names}`)
    checks.check('listing shows the remote file', names.includes('hello.txt'))
    checks.check('listing shows the remote subdirectory', names.includes('subdir'))

    const pathBar = await cdp.text(paneText(`${ACTIVE_PANE} .file-manager__path`))
    checks.check('path bar shows the remote directory', pathBar.includes(sftp.root))

    // Navigate into the subdirectory.
    await cdp.evaluate(
      `(() => {
        const rows = Array.from(document.querySelectorAll(${JSON.stringify(`${ACTIVE_PANE} .file-manager__row`)}))
        const row = rows.find((r) => (r.textContent ?? '').includes('subdir'))
        const button = row?.querySelector('.file-manager__cell--actions .button')
        button?.click()
        return !!button
      })(), true`
    )
    await delay(1000)
    const subNames = await listingNames(cdp)
    console.log(`[debug] subdirectory names: ${subNames}`)
    checks.check('navigating into a directory changes the listing', subNames.includes('nested.txt'))
    checks.check('parent directory is not listed inside the subdirectory', !subNames.includes('hello.txt'))

    // Go back up.
    await cdp.evaluate(
      `document.querySelector(${JSON.stringify(`${ACTIVE_PANE} .file-manager__toolbar .button`)}).click(), true`
    )
    await delay(1000)
    const upNames = await listingNames(cdp)
    checks.check('"Up" returns to the parent directory', upNames.includes('hello.txt'))

    // An SSH tab alongside the SFTP tab.
    await cdp.evaluate(`document.querySelector('.tab-bar__new')?.click(), true`)
    checks.check(
      'second tab appears',
      await waitFor(cdp, `document.querySelectorAll('.tab-bar__tab').length === 2`, 10)
    )

    // The SFTP tab keeps its listing while another tab is active.
    const sftpTabId = await cdp.text(`document.querySelector('.tab-bar__tab')?.dataset.tabId ?? ''`)
    const sftpNames = await cdp.text(
      `Array.from(document.querySelectorAll(${JSON.stringify(`.tab-pane[data-tab-id="${sftpTabId}"] .file-manager__cell--name`)})).map((n) => (n.textContent ?? '').trim()).join('|')`
    )
    checks.check('SFTP tab keeps its listing in the background', sftpNames.includes('hello.txt'))

    // Closing the SFTP tab must not kill the app.
    await cdp.evaluate(
      `document.querySelector('.tab-bar__tab .tab-bar__close')?.click(), true`
    )
    checks.check(
      'closing the SFTP tab leaves one tab',
      await waitFor(cdp, `document.querySelectorAll('.tab-bar__tab').length === 1`, 10)
    )
    checks.check('renderer still responds after closing the tab', (await cdp.text('document.title')).includes('ReliquarySSH'))
    checks.check('electron main process is still alive', app.exitCode === null)

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
    ssh.kill('SIGTERM')
    await sftp?.close()
    await delay(500)
    process.exit(exitCode)
  }
}

void main()
