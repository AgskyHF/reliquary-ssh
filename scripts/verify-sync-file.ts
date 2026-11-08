/**
 * Verification harness for the file based sync.
 *
 * Scenario (all through the real UI over CDP):
 *  1. the Sync section offers a master password — there is no account
 *     and no sign-in any more;
 *  2. a master password is set and the panel shows the counters;
 *  3. a connection is created — it shows up as a pending change;
 *  4. the sync file is written and it holds no plaintext;
 *  5. a second device reads the file and gets the connection.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { ChildProcess } from 'node:child_process'
import {
  Checks,
  attach,
  cleanupApp,
  portIsFree,
  startElectron,
  waitFor,
  type CdpClient
} from './lib/cdp.ts'

const CDP_PORT = 9245
const MASTER_PASSWORD = 'master horse battery'

const checks = new Checks()

/** Opens the Sync section of the sidebar. */
async function openSync(cdp: CdpClient): Promise<void> {
  await cdp.evaluate(
    `(() => {
      const items = Array.from(document.querySelectorAll('.sidebar__item'))
      items[2]?.click()
      return true
    })()`
  )
  await delay(400)
}

/** Opens the Hosts section of the sidebar. */
async function openHosts(cdp: CdpClient): Promise<void> {
  await cdp.evaluate(
    `(() => {
      const items = Array.from(document.querySelectorAll('.sidebar__item'))
      items[0]?.click()
      return true
    })()`
  )
  await delay(400)
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

/** Clicks a button by its text. */
async function clickButton(cdp: CdpClient, text: string): Promise<boolean> {
  const ok = await cdp.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button'))
      .find((b) => (b.textContent ?? '').trim() === ${JSON.stringify(text)})
    if (!button) return false
    button.click()
    return true
  })()`)
  return ok === true
}

async function main(): Promise<void> {
  if (!(await portIsFree(CDP_PORT))) throw new Error(`CDP port ${CDP_PORT} is busy`)

  const userData = mkdtempSync(join(tmpdir(), 'reliquary-syncfile-'))
  const workDir = mkdtempSync(join(tmpdir(), 'reliquary-syncfile-out-'))
  const syncFile = join(workDir, 'sync.json')

  let app: ChildProcess | null = null
  try {
    app = startElectron(userData, CDP_PORT)
    const { cdp, socket } = await attach(CDP_PORT)
    await waitFor(cdp, `document.querySelector('.sidebar__item')`)

    // 1. There is no sign-in any more — the sync asks for a master password.
    await openSync(cdp)
    const hasLogin = await cdp.evaluate(
      `Boolean(document.querySelector('.login-form'))`
    )
    checks.check('there is no sign-in form any more', hasLogin === false)

    const setup = await cdp.evaluate(
      `Boolean(document.querySelector('.master-setup'))`
    )
    checks.check('the sync panel asks for a master password', setup === true)

    // 2. Set the master password.
    await setInput(cdp, 'input[name="masterPassword"]', MASTER_PASSWORD)
    await setInput(cdp, 'input[name="masterPasswordConfirm"]', MASTER_PASSWORD)
    await clickButton(cdp, 'Set master password')
    await delay(1200)

    const unlocked = await cdp.evaluate(
      `Boolean(document.querySelector('.sync-panel__export'))`
    )
    checks.check('the panel shows the export button once unlocked', unlocked === true)

    // 3. A connection becomes a pending change.
    await openHosts(cdp)
    await clickButton(cdp, 'Add a connection')
    await delay(500)
    await setInput(cdp, 'input[name="hostName"]', 'prod')
    await setInput(cdp, 'input[name="hostAddress"]', 'hidden.example.com')
    await setInput(cdp, 'input[name="hostUsername"]', 'root')
    await clickButton(cdp, 'Add the connection')
    await delay(900)

    const hostShown = await cdp.text(
      `(document.querySelector('.host-list')?.textContent ?? '')`
    )
    checks.check('the connection is in the list', hostShown.includes('prod'))

    await openSync(cdp)
    const pending = await cdp.text(
      `(document.querySelector('.sync-panel__pending')?.textContent ?? '')`
    )
    checks.check('the connection is a pending change', pending.trim() === '1')

    // 4. The sync file is written — and it holds no plaintext.
    const exported = await cdp.evaluate(
      `window.reliquary.sync.exportFile({ path: ${JSON.stringify(syncFile)} })
        .then((r) => r.path)`
    )
    checks.check('the sync file is written', exported === syncFile)

    const content = readFileSync(syncFile, 'utf8')
    checks.check('the file holds no address in clear text', !content.includes('hidden.example.com'))
    checks.check('the file holds no user name in clear text', !content.includes('root'))
    checks.check('the file carries the records', content.includes('"ciphertext"'))

    // 5. A second device reads the file and gets the connection.
    const secondUserData = mkdtempSync(join(tmpdir(), 'reliquary-syncfile-b-'))
    const second = startElectron(secondUserData, CDP_PORT + 1)
    const attached = await attach(CDP_PORT + 1)
    await waitFor(attached.cdp, `document.querySelector('.sidebar__item')`)

    await openSync(attached.cdp)
    const secondSetup = await attached.cdp.evaluate(
      `Boolean(document.querySelector('.master-setup'))`
    )
    checks.check('the second device asks for a master password too', secondSetup === true)

    // The file is imported without a master password — the records wait.
    const imported = (await attached.cdp.evaluate(
      `window.reliquary.sync.importFile({ path: ${JSON.stringify(syncFile)} })
        .then((r) => r.imported)`
    )) as number
    checks.check('the second device reads the file', imported > 0)

    // The master password is set — the salt of the file is adopted.
    await setInput(attached.cdp, 'input[name="masterPassword"]', MASTER_PASSWORD)
    await setInput(attached.cdp, 'input[name="masterPasswordConfirm"]', MASTER_PASSWORD)
    await clickButton(attached.cdp, 'Set master password')
    await delay(1500)

    await openHosts(attached.cdp)
    const secondHosts = await attached.cdp.text(
      `(document.querySelector('.host-list')?.textContent ?? '')`
    )
    checks.check('the connection arrived on the second device', secondHosts.includes('prod'))

    attached.socket.close()
    await cleanupApp(second, secondUserData)

    socket.close()
  } finally {
    await cleanupApp(app, userData)
  }

  console.log(`\n${checks.total - checks.failed}/${checks.total} checks passed`)
  if (!checks.allPassed) process.exitCode = 1
}

await main()
