/**
 * Verification harness for the host form.
 *
 * Scenario (all through the real UI over CDP):
 *  1. the Hosts section offers a button to add a connection;
 *  2. the form opens and asks for the name, the address and the user;
 *  3. a connection is created with a password — the password is stored
 *     encrypted, so it can be exported;
 *  4. the connection shows up in the list;
 *  5. the connection can be edited — the name changes;
 *  6. a connection with the key authentication can be created as well;
 *  7. the export carries the connection with its sealed password.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { ChildProcess } from 'node:child_process'
import type { WebSocket } from 'ws'
import AdmZip from 'adm-zip'
import {
  Checks,
  attach,
  cleanupApp,
  exists,
  paneIncludes,
  portIsFree,
  startElectron,
  waitFor,
  type CdpClient
} from './lib/cdp.ts'

const CDP_PORT = 9237
const MASTER_PASSWORD = 'master horse battery'

const checks = new Checks()

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

async function main(): Promise<void> {
  if (!(await portIsFree(CDP_PORT))) throw new Error(`CDP port ${CDP_PORT} is busy`)

  const userData = mkdtempSync(join(tmpdir(), 'reliquary-hostform-'))
  const workDir = mkdtempSync(join(tmpdir(), 'reliquary-hostform-files-'))
  const archive = join(workDir, 'hosts.zip')

  let app: ChildProcess | null = null
  let socket: WebSocket | null = null
  let exitCode = 1
  let errored = false

  try {
    app = startElectron(userData, CDP_PORT)
    const session = await attach(CDP_PORT)
    const cdp = session.cdp
    socket = session.socket

    await waitFor(cdp, exists('.sidebar__item'))

    // The master password is needed to store a password. It is created in
    // the Export section — the export must not depend on the sync being
    // set up.
    await openSection(cdp, 'Export')
    await waitFor(cdp, exists('.transfer-panel input[name="withPasswords"]'), 15)
    await cdp.evaluate(`(() => {
      const box = document.querySelector('.transfer-panel input[name="withPasswords"]')
      if (box && !box.checked) box.click()
      return true
    })()`)
    checks.check(
      'the master password form appears',
      await waitFor(cdp, exists('.transfer-panel input[name="exportMasterPassword"]'), 15)
    )

    await setInput(cdp, 'input[name="exportMasterPassword"]', MASTER_PASSWORD)
    await setInput(cdp, 'input[name="exportMasterPasswordConfirm"]', MASTER_PASSWORD)
    await cdp.evaluate(`document.querySelector('.transfer-panel__master-set')?.click(), true`)
    checks.check(
      'the master password is set',
      await waitFor(cdp, `window.reliquary.master.status().then(s => s.configured)`, 25)
    )

    // 1. the Hosts section offers the button.
    await openSection(cdp, 'Hosts')
    checks.check(
      'the add button is shown',
      await waitFor(cdp, exists('.host-list__add'), 15)
    )

    // 2. the form opens.
    await cdp.evaluate(`document.querySelector('.host-list__add')?.click(), true`)
    checks.check(
      'the form opens',
      await waitFor(cdp, exists('.host-form'), 15)
    )
    checks.check(
      'the form asks for the name, the address and the user',
      (await waitFor(cdp, exists('.host-form input[name="hostName"]'), 10)) &&
        (await waitFor(cdp, exists('.host-form input[name="hostAddress"]'), 10)) &&
        (await waitFor(cdp, exists('.host-form input[name="hostUsername"]'), 10))
    )

    // 3. a connection is created with a password.
    await setInput(cdp, '.host-form input[name="hostName"]', 'prod')
    await setInput(cdp, '.host-form input[name="hostAddress"]', 'example.com')
    await setInput(cdp, '.host-form input[name="hostUsername"]', 'root')
    await setInput(cdp, '.host-form input[name="hostPort"]', '22')
    await setInput(cdp, '.host-form input[name="hostPassword"]', 'super secret')
    await cdp.evaluate(`document.querySelector('.host-form__save')?.click(), true`)

    // 4. the connection shows up in the list.
    checks.check(
      'the connection appears in the list',
      await waitFor(cdp, paneIncludes('.host-list', 'prod'), 20)
    )
    checks.check(
      'the list shows the endpoint',
      await waitFor(cdp, paneIncludes('.host-list', 'root@example.com:22'), 15)
    )

    const stored = (await cdp.evaluate(`(async () => {
      const hosts = await window.reliquary.host.list()
      if (hosts.length === 0) return null
      return {
        name: hosts[0].name,
        hasPassword: await window.reliquary.hostPassword.has({ hostId: hosts[0].id })
      }
    })()`)) as { name: string; hasPassword: boolean } | null
    checks.check(
      'the password is stored',
      Boolean(stored && stored.hasPassword === true)
    )

    // 5. the connection can be edited.
    await cdp.evaluate(
      `(() => {
        const heads = Array.from(document.querySelectorAll('.host-list__item-head'))
        heads[0]?.click()
        return true
      })()`
    )
    await delay(400)
    checks.check(
      'the edit button is shown',
      await waitFor(cdp, exists('.host-list__edit'), 10)
    )

    await cdp.evaluate(`document.querySelector('.host-list__edit')?.click(), true`)
    checks.check(
      'the edit form opens with the values',
      await waitFor(cdp, exists('.host-form'), 15)
    )

    const prefilled = await cdp.evaluate(
      `document.querySelector('.host-form input[name="hostName"]')?.value ?? ''`
    )
    checks.check('the form is filled with the old name', prefilled === 'prod')

    await setInput(cdp, '.host-form input[name="hostName"]', 'prod-renamed')
    await cdp.evaluate(`document.querySelector('.host-form__save')?.click(), true`)
    checks.check(
      'the new name shows up',
      await waitFor(cdp, paneIncludes('.host-list', 'prod-renamed'), 20)
    )

    // 6. the key authentication can be picked.
    await cdp.evaluate(`document.querySelector('.host-list__add')?.click(), true`)
    await waitFor(cdp, exists('.host-form'), 15)
    await selectOption(cdp, '.host-form select[name="hostAuthMethod"]', 'key')
    checks.check(
      'the key picker appears for the key authentication',
      await waitFor(cdp, exists('.host-form select[name="hostKeyId"]'), 10)
    )
    checks.check(
      'the password field is gone for the key authentication',
      !(await waitFor(cdp, exists('.host-form input[name="hostPassword"]'), 3))
    )

    // 7. the export carries the connection with its sealed password.
    await openSection(cdp, 'Export')
    const exported = (await cdp.evaluate(`(async () => {
      return window.reliquary.transfer.export({
        options: { mode: 'sealed', includeKeys: true, includeOld: true },
        path: ${JSON.stringify(archive)}
      })
    })()`)) as { path: string; summary: string }
    checks.check('the export is written', exported.path === archive)

    const zip = new AdmZip(archive)
    const text = zip
      .getEntries()
      .map((entry) => entry.getData().toString('utf8'))
      .join('\n')

    checks.check('the export carries the connection', text.includes('example.com'))
    checks.check('the export holds no plaintext password', !text.includes('super secret'))
    checks.check('the export carries a sealed envelope', text.includes('ciphertext'))

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
    process.exit(exitCode)
  }
}

void main()
