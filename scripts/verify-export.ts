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

const checks = new Checks()

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

    // The option is off by default and there is no password of its own:
    // the panel must never ask for a master password.
    const initial = await cdpA.evaluate(`(() => ({
      checked: document.querySelector('.transfer-panel input[name="withPasswords"]').checked,
      asksMaster: Boolean(document.querySelector('.transfer-panel input[name="exportMasterPassword"]')),
      text: document.querySelector('.transfer-panel__hint')?.textContent ?? ''
    }))()`) as { checked: boolean; asksMaster: boolean; text: string }
    checks.check('the option is off by default', initial.checked === false)
    checks.check('the panel asks for no password', initial.asksMaster === false)

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
      options: { mode: 'without-passwords', includeKeys: true, includeOld: true },
      path: ${JSON.stringify(plainArchive)}
    })`)) as { path: string; summary: string }
    checks.check('the export without the passwords is written', plainResult.path === plainArchive)

    const plainText = archiveText(plainArchive)
    checks.check(
      'the archive without the passwords holds no password',
      !plainText.includes('super secret')
    )
    checks.check('it holds the connection', plainText.includes('example.com'))

    // 3. the export with the passwords — no master password involved.
    await toggle(cdpA, '.transfer-panel input[name="withPasswords"]', true)

    const withResult = (await cdpA.evaluate(`window.reliquary.transfer.export({
      options: { mode: 'with-passwords', includeKeys: true, includeOld: true },
      path: ${JSON.stringify(sealedArchive)}
    })`)) as { path: string; summary: string }
    checks.check('the export with the passwords is written', withResult.path === sealedArchive)

    // The password is in the archive, readable: that is what makes the
    // import work on another device without a password of any kind.
    const withZip = new AdmZip(readFileSync(sealedArchive))
    const secretsEntry = withZip.getEntry('secrets.json')
    checks.check('the archive with the passwords has a secrets entry', Boolean(secretsEntry))

    const secrets = secretsEntry
      ? (JSON.parse(secretsEntry.getData().toString('utf8')) as {
          format?: string
          passwords: Record<string, string>
        })
      : null
    checks.check('the secrets are marked as plain', secrets?.format === 'plain')
    checks.check(
      'the password of the host is in the archive',
      Object.values(secrets?.passwords ?? {}).includes('super secret')
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

    // Nothing was entered anywhere: the second device has no master
    // password, and the host of the archive had one.
    checks.check('the import brings the password', imported.passwords === 1)

    const secondMaster = await cdpB.evaluate(`window.reliquary.master.status().then(s => s.configured)`)
    checks.check('the second device has no master password', secondMaster === false)

    const hasPassword = await cdpB.evaluate(`(async () => {
      const hosts = await window.reliquary.host.list()
      if (hosts.length === 0) return false
      return window.reliquary.hostPassword.has({ hostId: hosts[0].id })
    })()`)
    checks.check('the imported host carries its password', hasPassword === true)

    // 5. the second device changes the host.
    const renamed = await cdpB.evaluate(`(async () => {
      const hosts = await window.reliquary.host.list()
      const saved = await window.reliquary.host.save({ ...hosts[0], name: 'prod-new' })
      await window.reliquary.hostPassword.set({ hostId: saved.id, password: 'brand new password' })
      return saved.name
    })()`)
    checks.check('the second device renames the host', renamed === 'prod-new')

    const updatedResult = (await cdpB.evaluate(`window.reliquary.transfer.export({
      options: { mode: 'with-passwords', includeKeys: true, includeOld: true },
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

    // The version shows both sides: what was replaced and what replaced
    // it, with the date of each.
    const details = await cdpA.evaluate(`(() => {
      const item = document.querySelector('.transfer-panel__old-item')
      if (!item) return null
      return {
        tags: Array.from(item.querySelectorAll('.transfer-panel__old-tag')).map(
          (node) => node.textContent
        ),
        names: Array.from(item.querySelectorAll('.transfer-panel__old-name')).map(
          (node) => node.textContent
        ),
        times: Array.from(item.querySelectorAll('.transfer-panel__old-time')).map(
          (node) => node.textContent
        )
      }
    })()`) as { tags: string[]; names: string[]; times: string[] } | null

    checks.check('the version shows both versions', Boolean(details && details.tags.length === 2))
    checks.check(
      'the replaced version is named',
      Boolean(details?.names[0]?.includes('prod'))
    )
    checks.check(
      'the current version is named',
      Boolean(details?.names[1]?.includes('prod-new'))
    )
    checks.check(
      'both dates are shown',
      Boolean(details && details.times.length === 2 && details.times.every((time) => time.length > 0))
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

    // The password of the restored version is readable again — and no
    // master password was needed for it.
    const restoredPassword = await cdpA.evaluate(`(async () => {
      const hosts = await window.reliquary.host.list()
      if (hosts.length === 0) return null
      const has = await window.reliquary.hostPassword.has({ hostId: hosts[0].id })
      const master = await window.reliquary.master.status()
      return { has, configured: master.configured }
    })()`)
    checks.check(
      'the restored version has a password without a master password',
      (restoredPassword as { has: boolean; configured: boolean } | null)?.has === true &&
        (restoredPassword as { configured: boolean }).configured === false
    )

    const passwordIsBack = await cdpA.evaluate(`(async () => {
      const hosts = await window.reliquary.host.list()
      if (hosts.length === 0) return false
      return window.reliquary.hostPassword.has({ hostId: hosts[0].id })
    })()`)
    checks.check('the restored version keeps its password', passwordIsBack === true)

    // 8. the old folder can be emptied in one click.
    checks.check(
      'the old folder has a "forget all" button',
      await waitFor(cdpA, exists('.transfer-panel__forget-all'), 15)
    )

    await cdpA.evaluate(`document.querySelector('.transfer-panel__forget-all')?.click(), true`)

    checks.check(
      'the old folder is empty',
      await waitFor(cdpA, `window.reliquary.transfer.superseded().then(l => l.length === 0)`, 25)
    )

    // 9. the deleted host comes back with the import — right away, as a
    // live host, and not as a version waiting in the old folder.
    const roundTrip = await cdpA.evaluate(`(async () => {
      const hosts = await window.reliquary.host.list()
      const target = hosts[0]
      await window.reliquary.host.remove(target.id)
      const afterDelete = await window.reliquary.host.list()

      const result = await window.reliquary.transfer.import({
        path: ${JSON.stringify(sealedArchive)}
      })

      const afterImport = await window.reliquary.host.list()
      const old = await window.reliquary.transfer.superseded()

      return {
        deleted: afterDelete.length,
        added: result.added,
        hosts: afterImport.map((host) => host.name),
        old: old.length
      }
    })()`) as {
      deleted: number
      added: number
      hosts: string[]
      old: number
    }

    checks.check('the host was deleted', roundTrip.deleted === 0)
    checks.check('the import brings the host back', roundTrip.added === 1)
    checks.check('the host is in the list again', roundTrip.hosts.includes('prod'))
    checks.check('nothing waits in the old folder', roundTrip.old === 0)

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
