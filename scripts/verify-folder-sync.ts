/**
 * Verification harness for the folder transport.
 *
 * Scenario (all through the real UI over CDP):
 *  1. the Settings section offers both transports;
 *  2. the folder transport is selected and the path of a real folder is
 *     saved;
 *  3. the Sync section works without an account — the master password is
 *     asked for and the engine unlocks;
 *  4. a host is saved and pushed into the folder;
 *  5. the folder holds encrypted entries only — the host name and the user
 *     name are nowhere in the files;
 *  6. a second app profile points at the same folder, adopts the master
 *     password of the folder and receives the host.
 */
import { type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
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

const CDP_A = 9233
const CDP_B = 9234
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

/** Selects an option in a select element. */
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

/** Every file of the folder, as one string. */
function readFolder(root: string): string {
  const parts: string[] = []

  const walk = (dir: string): void => {
    if (!existsSync(dir)) return
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, item.name)
      if (item.isDirectory()) walk(path)
      else if (item.isFile() && item.name.endsWith('.json')) parts.push(readFileSync(path, 'utf8'))
    }
  }

  walk(root)
  return parts.join('\n')
}

async function main(): Promise<void> {
  if (!(await portIsFree(CDP_A))) throw new Error(`CDP port ${CDP_A} is busy`)
  if (!(await portIsFree(CDP_B))) throw new Error(`CDP port ${CDP_B} is busy`)

  const userDataA = mkdtempSync(join(tmpdir(), 'reliquary-folder-a-'))
  const userDataB = mkdtempSync(join(tmpdir(), 'reliquary-folder-b-'))
  const folder = mkdtempSync(join(tmpdir(), 'reliquary-folder-sync-'))

  let appA: ChildProcess | null = null
  let appB: ChildProcess | null = null
  let socketA: WebSocket | null = null
  let socketB: WebSocket | null = null
  let exitCode = 1
  let errored = false

  try {
    appA = startElectron(userDataA, CDP_A)
    const attachedA = await attach(CDP_A)
    const cdpA = attachedA.cdp
    socketA = attachedA.socket

    await waitFor(cdpA, exists('.sidebar__item'))

    // 1. the Settings section offers both transports.
    await openSection(cdpA, 'Settings')
    checks.check(
      'the settings panel is shown',
      await waitFor(cdpA, exists('.settings-panel'), 15)
    )

    const transports = await cdpA.evaluate(
      `Array.from(document.querySelectorAll('.settings-panel select[name="syncTransport"] option')).map(o => o.value).join(',')`
    )
    checks.check('both transports are offered', transports === 'server,folder')

    // 2. the folder transport is selected and saved.
    await selectOption(cdpA, '.settings-panel select[name="syncTransport"]', 'folder')
    await delay(300)
    checks.check(
      'the folder field appears for the folder transport',
      await waitFor(cdpA, exists('.settings-panel input[name="syncFolder"]'), 10)
    )

    await setInput(cdpA, '.settings-panel input[name="syncFolder"]', folder)
    await cdpA.evaluate(`document.querySelector('.settings-panel__save')?.click(), true`)
    checks.check(
      'the folder is saved',
      await waitFor(cdpA, exists('.settings-panel__saved'), 15)
    )

    const stored = await cdpA.evaluate(
      `window.reliquary.settings.get().then(s => s.syncTransport + '|' + s.syncFolder)`
    )
    checks.check(
      'the transport and the folder are stored',
      stored === `folder|${folder}`
    )

    // 3. the Sync section works without an account.
    await openSection(cdpA, 'Sync')
    checks.check(
      'the sync section asks for a master password without an account',
      await waitFor(cdpA, exists('.sync-panel input[name="masterPassword"]'), 15)
    )

    await setInput(cdpA, 'input[name="masterPassword"]', MASTER_PASSWORD)
    await setInput(cdpA, 'input[name="masterPasswordConfirm"]', MASTER_PASSWORD)
    await cdpA.evaluate(`document.querySelector('.master-setup__actions .button--primary')?.click(), true`)
    checks.check(
      'the engine unlocks with the master password',
      await waitFor(cdpA, exists('.sync-panel__now'), 25)
    )

    // 4. a host is saved and pushed.
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
    checks.check('a host is saved', created === 'prod')

    await cdpA.evaluate(`document.querySelector('.sync-panel__now')?.click(), true`)

    // 5. the folder holds encrypted entries only.
    let onDisk = ''
    for (let attempt = 0; attempt < 25; attempt++) {
      onDisk = readFolder(folder)
      if (onDisk.includes('ciphertext')) break
      await delay(500)
    }

    checks.check('the folder received the entry', onDisk.includes('ciphertext'))
    checks.check(
      'the folder holds no plaintext — no host, no user, no name',
      !onDisk.includes('hidden.example.com') &&
        !onDisk.includes('"root"') &&
        !onDisk.includes('prod') &&
        !onDisk.includes('example.com')
    )

    // The salt is stored base64-encoded in the ciphertext field of the
    // settings entry — it is not a secret, it only has to match on every
    // device. It is decoded here, in Node: the renderer has no Buffer.
    const saltPublished = readFolder(folder)
      .split('\n')
      .filter((line) => line.includes('sync.kdf'))
      .some((line) => {
        try {
          const parsed = JSON.parse(line) as { ciphertext: string }
          return Buffer.from(parsed.ciphertext, 'base64')
            .toString('utf8')
            .includes('reliquaryssh-kdf-v1:')
        } catch {
          return false
        }
      })
    checks.check('the salt is published in the folder', saltPublished)

    // 6. the second device uses the same folder.
    appB = startElectron(userDataB, CDP_B)
    const attachedB = await attach(CDP_B)
    const cdpB = attachedB.cdp
    socketB = attachedB.socket

    await waitFor(cdpB, exists('.sidebar__item'))
    await openSection(cdpB, 'Settings')
    await selectOption(cdpB, '.settings-panel select[name="syncTransport"]', 'folder')
    await delay(300)
    await setInput(cdpB, '.settings-panel input[name="syncFolder"]', folder)
    await cdpB.evaluate(`document.querySelector('.settings-panel__save')?.click(), true`)
    checks.check(
      'the second device points at the same folder',
      await waitFor(
        cdpB,
        `(async () => {
          const s = await window.reliquary.settings.get()
          return s.syncFolder === ${JSON.stringify(folder)}
        })()`,
        15
      )
    )

    await openSection(cdpB, 'Sync')
    checks.check(
      'the second device is offered the master password of the folder',
      await waitFor(cdpB, exists('.sync-panel input[name="accountMasterPassword"]'), 20)
    )

    await setInput(cdpB, 'input[name="accountMasterPassword"]', MASTER_PASSWORD)
    await cdpB.evaluate(`document.querySelector('.master-setup__actions .button--primary')?.click(), true`)
    checks.check(
      'the second device unlocks with the folder password',
      await waitFor(cdpB, exists('.sync-panel__now'), 30)
    )

    await openSection(cdpB, 'Hosts')
    checks.check(
      'the host of the first device arrives decrypted',
      await waitFor(cdpB, `(document.querySelector('.host-list')?.textContent ?? '').includes('prod')`, 25)
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
    process.exit(exitCode)
  }
}

void main()
