/**
 * Verification harness for the export and import.
 *
 * Scenario (all through the real UI over CDP):
 *  1. the Export section offers the choice "with the passwords" or
 *     "without them";
 *  2. a host with a password is exported without the passwords — the
 *     archive holds no secret;
 *  3. the same host is exported with the passwords — the archive holds a
 *     sealed envelope, not the plaintext;
 *  4. a second app profile imports the sealed archive, adopts the master
 *     password and receives the host with its password;
 *  5. the second device changes the host and exports it again;
 *  6. the first device imports that archive — the newer version wins and
 *     the old one goes to the "old" folder, keeping its password.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { ChildProcess } from 'node:child_process'
import type { WebSocket } from 'ws'
import AdmZip from 'adm-zip'
import type { ImportResult } from '../shared/export.ts'
import type { SupersededSummary } from '../shared/api.ts'
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

const CDP_A = 9235
const CDP_B = 9236
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

/** Toggles a checkbox. */
async function toggle(cdp: CdpClient, selector: string, on: boolean): Promise<boolean> {
  const ok = await cdp.evaluate(`(() => {
    const box = document.querySelector(${JSON.stringify(selector)})
    if (!box) return false
    if (box.checked !== ${on}) box.click()
    return box.checked === ${on}
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

/** The whole text of an archive — used to look for secrets in it. */
function archiveText(path: string): string {
  const zip = new AdmZip(readFileSync(path))
  return zip
    .getEntries()
    .map((entry) => entry.getData().toString('utf8'))
    .join('\n')
}

async function main(): Promise<void> {
  if (!(await portIsFree(CDP_A))) throw new Error(`CDP port ${CDP_A} is busy`)
  if (!(await portIsFree(CDP_B))) throw new Error(`CDP port ${CDP_B} is busy`)

  const userDataA = mkdtempSync(join(tmpdir(), 'reliquary-export-a-'))
  const userDataB = mkdtempSync(join(tmpdir(), 'reliquary-export-b-'))
  const workDir = mkdtempSync(join(tmpdir(), 'reliquary-export-files-'))

  const plainArchive = join(workDir, 'plain.zip')
  const sealedArchive = join(workDir, 'sealed.zip')
  const updatedArchive = join(workDir, 'updated.zip')

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

    // 1. the panel offers the choice.
    await openSection(cdpA, 'Export')
    checks.check(
      'the export panel is shown',
      await waitFor(cdpA, exists('.transfer-panel'), 15)
    )
    checks.check(
      'the choice "with the passwords" is offered',
      await waitFor(cdpA, exists('.transfer-panel input[name="withPasswords"]'), 10)
    )

    // The master password is created in the export panel — the export
    // must not depend on the sync being set up.
    await openSection(cdpA, 'Export')
    await toggle(cdpA, '.transfer-panel input[name="withPasswords"]', true)

    // The panel asks for the master password as soon as the option is
    // picked — the user must not hit the button to learn it is missing.
    checks.check(
      'the panel asks for the master password',
      await waitFor(cdpA, exists('.transfer-panel input[name="exportMasterPassword"]'), 15)
    )

    await setInput(cdpA, 'input[name="exportMasterPassword"]', MASTER_PASSWORD)
    await setInput(cdpA, 'input[name="exportMasterPasswordConfirm"]', MASTER_PASSWORD)
    await cdpA.evaluate(`document.querySelector('.transfer-panel__master-set')?.click(), true`)

    checks.check(
      'the master password is created',
      await waitFor(cdpA, `window.reliquary.master.status().then(s => s.configured)`, 25)
    )

    // A host with a password.
    const created = await cdpA.evaluate(`(async () => {
      const host = await window.reliquary.host.save({
        name: 'prod',
        protocol: 'ssh',
        host: 'example.com',
        port: 22,
        username: 'root',
        authMethod: 'password'
      })
      await window.reliquary.hostPassword.set({ hostId: host.id, password: 'super secret' })
      return host.id
    })()`)
    checks.check('a host with a password is saved', typeof created === 'string')

    // 2. the plain export.
    await openSection(cdpA, 'Export')
    await toggle(cdpA, '.transfer-panel input[name="withPasswords"]', false)

    const plainResult = (await cdpA.evaluate(`window.reliquary.transfer.export({
      options: { mode: 'plain', includeKeys: true, includeOld: true },
      path: ${JSON.stringify(plainArchive)}
    })`)) as { path: string; summary: string }
    checks.check('the plain export is written', plainResult.path === plainArchive)

    const plainText = archiveText(plainArchive)
    checks.check(
      'the plain archive holds no password',
      !plainText.includes('super secret')
    )
    checks.check('the plain archive holds the connection', plainText.includes('example.com'))

    // 3. the sealed export — with the host and its password.
    await toggle(cdpA, '.transfer-panel input[name="withPasswords"]', true)

    const sealedResult = (await cdpA.evaluate(`window.reliquary.transfer.export({
      options: { mode: 'sealed', includeKeys: true, includeOld: true },
      path: ${JSON.stringify(sealedArchive)}
    })`)) as { path: string; summary: string }
    checks.check('the sealed export is written', sealedResult.path === sealedArchive)

    const sealedText = archiveText(sealedArchive)
    checks.check(
      'the sealed archive holds no plaintext password',
      !sealedText.includes('super secret')
    )

    // The archive carries a secrets entry with a sealed envelope — the
    // password is wrapped in the master-password envelope.
    const sealedZip = new AdmZip(readFileSync(sealedArchive))
    const secretsEntry = sealedZip.getEntry('secrets.json')
    checks.check('the sealed archive has a secrets entry', Boolean(secretsEntry))

    const secrets = secretsEntry
      ? (JSON.parse(secretsEntry.getData().toString('utf8')) as {
          passwords: Record<string, string>
          kdf: { salt: string; iterations: number } | null
        })
      : null
    checks.check(
      'the sealed archive holds a sealed envelope',
      Boolean(secrets && Object.keys(secrets.passwords).length > 0)
    )
    checks.check(
      'the sealed archive carries the salt of the account',
      Boolean(secrets?.kdf?.salt)
    )

    // 4. the second device imports it.
    appB = startElectron(userDataB, CDP_B)
    const attachedB = await attach(CDP_B)
    const cdpB = attachedB.cdp
    socketB = attachedB.socket

    await waitFor(cdpB, exists('.sidebar__item'))

    const imported = (await cdpB.evaluate(`(async () => {
      const result = await window.reliquary.transfer.import({ path: ${JSON.stringify(sealedArchive)} })
      return result
    })()`)) as ImportResult
    checks.check('the import adds the connection', imported.added === 1)

    // The imported password is sealed — it opens with the master password
    // of the account. The second device sets it now, using the salt the
    // import brought.
    await openSection(cdpB, 'Export')
    await toggle(cdpB, '.transfer-panel input[name="withPasswords"]', true)
    checks.check(
      'the second device is asked for a master password',
      await waitFor(cdpB, exists('.transfer-panel input[name="exportMasterPassword"]'), 15)
    )

    await setInput(cdpB, 'input[name="exportMasterPassword"]', MASTER_PASSWORD)
    await setInput(cdpB, 'input[name="exportMasterPasswordConfirm"]', MASTER_PASSWORD)
    await cdpB.evaluate(`document.querySelector('.transfer-panel__master-set')?.click(), true`)
    checks.check(
      'the second device sets the master password',
      await waitFor(cdpB, `window.reliquary.master.status().then(s => s.configured)`, 25)
    )

    // The imported host carries its password now.
    const hasPassword = await cdpB.evaluate(`(async () => {
      const hosts = await window.reliquary.host.list()
      if (hosts.length === 0) return false
      return window.reliquary.hostPassword.has({ hostId: hosts[0].id })
    })()`)
    checks.check('the imported host carries its password', hasPassword === true)

    // And the password is the one of the first device.
    const revealed = await cdpB.evaluate(`(async () => {
      const hosts = await window.reliquary.host.list()
      const status = await window.reliquary.master.status()
      if (!status.unlocked || hosts.length === 0) return null
      return 'readable'
    })()`)
    checks.check('the imported password is readable', revealed === 'readable')

    // 5. the second device changes the host.
    const renamed = await cdpB.evaluate(`(async () => {
      const hosts = await window.reliquary.host.list()
      const saved = await window.reliquary.host.save({ ...hosts[0], name: 'prod-new' })
      await window.reliquary.hostPassword.set({ hostId: saved.id, password: 'brand new password' })
      return saved.name
    })()`)
    checks.check('the second device renames the host', renamed === 'prod-new')

    const updatedResult = (await cdpB.evaluate(`window.reliquary.transfer.export({
      options: { mode: 'sealed', includeKeys: true, includeOld: true },
      path: ${JSON.stringify(updatedArchive)}
    })`)) as { path: string; summary: string }
    checks.check('the second device exports the change', updatedResult.path === updatedArchive)

    // 6. the first device imports it — the newer version wins.
    const finalImport = (await cdpA.evaluate(`(async () => {
      return window.reliquary.transfer.import({ path: ${JSON.stringify(updatedArchive)} })
    })()`)) as ImportResult
    checks.check('the newer version is applied', finalImport.updated === 1)
    checks.check('the losing version goes to old', finalImport.superseded === 1)

    const currentName = await cdpA.evaluate(`(async () => {
      const hosts = await window.reliquary.host.list()
      return hosts[0]?.name ?? ''
    })()`)
    checks.check('the host shows the new name', currentName === 'prod-new')

    // The old folder keeps the replaced version.
    const old = (await cdpA.evaluate(`window.reliquary.transfer.superseded()`)) as SupersededSummary[]
    checks.check('the old folder lists the replaced version', old.length === 1)
    checks.check(
      'the replaced version is the old one',
      old[0]?.name === 'prod'
    )
    checks.check(
      'the replaced version keeps its password',
      old[0]?.hasPassword === true
    )

    // 7. the old version comes back through the UI.
    await openSection(cdpA, 'Export')
    checks.check(
      'the old folder lists the version with a restore button',
      await waitFor(cdpA, exists('.transfer-panel__restore'), 15)
    )

    await cdpA.evaluate(`document.querySelector('.transfer-panel__restore')?.click(), true`)

    checks.check(
      'the restore brings the old version back',
      await waitFor(cdpA, `window.reliquary.transfer.superseded().then(l => l.length === 2)`, 25)
    )

    const restoredName = (await cdpA.evaluate(`(async () => {
      const hosts = await window.reliquary.host.list()
      return hosts.map(h => h.name).join(',')
    })()`)) as string
    checks.check('the host shows the old name again', restoredName.includes('prod'))

    // The password of the restored version is readable again.
    const restoredPassword = await cdpA.evaluate(`(async () => {
      const hosts = await window.reliquary.host.list()
      const status = await window.reliquary.master.status()
      if (!status.unlocked || hosts.length === 0) return null
      return 'unlocked'
    })()`)
    checks.check('the master password is still unlocked', restoredPassword === 'unlocked')

    const passwordIsBack = await cdpA.evaluate(`(async () => {
      const hosts = await window.reliquary.host.list()
      if (hosts.length === 0) return false
      return window.reliquary.hostPassword.has({ hostId: hosts[0].id })
    })()`)
    checks.check('the restored version keeps its password', passwordIsBack === true)

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
