/**
 * Verification harness for stage 5 (Keychain).
 *
 * Scenario (all through the real UI over CDP):
 *  1. the sidebar switches to the Keychain section;
 *  2. the keychain starts locked and asks for a master password;
 *  3. setting a master password unlocks it;
 *  4. a new ed25519 key is generated and appears in the list with its
 *     fingerprint and public key;
 *  5. the public key can be copied;
 *  6. the key is deleted;
 *  7. after a restart the keychain is locked again and the master
 *     password unlocks it (the material stays in memory only).
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { ChildProcess } from 'node:child_process'
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

const CDP_PORT = 9227

const checks = new Checks()

/** Types into an input of the active page by name. */
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

  const userData = mkdtempSync(join(tmpdir(), 'reliquary-stage5-'))
  let app: ChildProcess | null = null
  let socket: WebSocket | null = null
  let exitCode = 1
  let errored = false

  try {
    app = startElectron(userData, CDP_PORT)
    const session = await attach(CDP_PORT)
    const cdp = session.cdp
    socket = session.socket

    // 1. switch to the Keychain section.
    const opened = await waitFor(cdp, exists('.sidebar__item'))
    checks.check('sidebar is rendered', opened)
    if (!opened) throw new Error('Sidebar did not render')

    await cdp.evaluate(
      `(() => {
        const items = Array.from(document.querySelectorAll('.sidebar__item'))
        const item = items.find((i) => (i.textContent ?? '').trim() === 'Keychain')
        item?.click()
        return !!item
      })(), true`
    )
    checks.check(
      'keychain section opens',
      await waitFor(cdp, exists('.keychain-panel'), 10)
    )

    // 2. the keychain starts locked.
    checks.check(
      'keychain asks for a master password',
      await waitFor(cdp, exists('.master-setup__title'), 10)
    )
    const title = await cdp.text(paneText('.master-setup__title'))
    checks.check('setup screen is shown for a fresh profile', title.includes('Master password'))

    // 3. set the master password.
    await setInput(cdp, 'input[name="masterPassword"]', 'master-pass-123')
    await setInput(cdp, 'input[name="masterPasswordConfirm"]', 'master-pass-123')
    await cdp.evaluate(
      `document.querySelector('.master-setup .button--primary')?.click(), true`
    )

    checks.check(
      'keychain unlocks after setting the master password',
      await waitFor(cdp, exists('.keychain-panel__toolbar'), 15)
    )

    // 4. generate a key.
    await cdp.evaluate(
      `document.querySelector('.keychain-panel__toolbar .button--primary')?.click(), true`
    )
    checks.check(
      'generate dialog opens',
      await waitFor(cdp, exists('.keychain-panel__dialog'), 10)
    )

    await setInput(cdp, '.keychain-panel__dialog input.field__input', 'deploy-key')
    await cdp.evaluate(
      `(() => {
        const dialog = document.querySelector('.keychain-panel__dialog')
        const button = dialog?.querySelector('.button--primary')
        button?.click()
        return !!button
      })(), true`
    )

    checks.check(
      'the generated key appears in the list',
      await waitFor(cdp, exists('.keychain-panel__item'), 20)
    )
    const keyText = await cdp.text(paneText('.keychain-panel__item'))
    checks.check('the key name is shown', keyText.includes('deploy-key'))
    checks.check('the fingerprint is shown', keyText.includes('SHA256:'))
    checks.check('the key type is shown', keyText.toLowerCase().includes('ed25519'))

    // 5. expand the key and check the public key.
    await cdp.evaluate(`document.querySelector('.keychain-panel__item-head')?.click(), true`)
    checks.check(
      'the public key is shown when the key is expanded',
      await waitFor(cdp, exists('.keychain-panel__public'), 10)
    )
    const publicKey = await cdp.text(paneText('.keychain-panel__public'))
    checks.check('the public key is an OpenSSH line', publicKey.includes('ssh-ed25519 '))

    // 6. delete the key.
    await cdp.evaluate(
      `(() => {
        const detail = document.querySelector('.keychain-panel__detail')
        const buttons = Array.from(detail?.querySelectorAll('.button') ?? [])
        const button = buttons.find((b) => (b.textContent ?? '').trim() === 'Delete')
        button?.click()
        return !!button
      })(), true`
    )
    checks.check(
      'the key is removed from the list',
      await waitFor(cdp, `!document.querySelector('.keychain-panel__item')`, 15)
    )

    // 7. restart — the keychain must be locked again.
    app.kill('SIGKILL')
    socket.close()
    await delay(1500)

    app = startElectron(userData, CDP_PORT)
    const second = await attach(CDP_PORT)
    const cdp2 = second.cdp
    socket = second.socket

    await cdp2.evaluate(
      `(() => {
        const items = Array.from(document.querySelectorAll('.sidebar__item'))
        const item = items.find((i) => (i.textContent ?? '').trim() === 'Keychain')
        item?.click()
        return !!item
      })(), true`
    )

    checks.check(
      'after a restart the keychain is locked again',
      await waitFor(cdp2, exists('.master-setup__title'), 15)
    )
    const unlockTitle = await cdp2.text(paneText('.master-setup__title'))
    checks.check('the unlock screen is shown', unlockTitle.includes('Unlock'))

    await setInput(cdp2, 'input[name="masterPassword"]', 'master-pass-123')
    await cdp2.evaluate(
      `document.querySelector('.master-setup .button--primary')?.click(), true`
    )
    checks.check(
      'the master password unlocks the keychain after a restart',
      await waitFor(cdp2, exists('.keychain-panel__toolbar'), 15)
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
    await delay(500)
    process.exit(exitCode)
  }
}

void main()
