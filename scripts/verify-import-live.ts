/**
 * Verification of the import on the copy of the real database.
 *
 * The scenario of the user: a host was exported, every host was deleted,
 * and the archive came back. The hosts have to come back as live hosts,
 * straight away — not as versions waiting in the old folder.
 *
 * The copy of the real database is used, not the real one: the run must
 * not touch the data of the user.
 */
import { cpSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { ChildProcess } from 'node:child_process'
import { attach, cleanupApp, portIsFree, startElectron, waitFor } from './lib/cdp.ts'

const CDP_PORT = 9261
const REAL_DB = join(
  process.env.HOME ?? '',
  'Library/Application Support/reliquary-ssh/reliquary.db'
)

let checks = 0
let failed = 0

function check(name: string, ok: boolean): void {
  checks += 1
  if (ok) {
    console.log(`  ok — ${name}`)
  } else {
    failed += 1
    console.log(`  FAIL — ${name}`)
  }
}

async function main(): Promise<void> {
  if (!(await portIsFree(CDP_PORT))) throw new Error(`CDP port ${CDP_PORT} is busy`)
  if (!existsSync(REAL_DB)) throw new Error(`The database of the user is not at ${REAL_DB}`)

  // The copy of the real database — the run must not touch the original.
  const userData = mkdtempSync(join(tmpdir(), 'reliquary-import-'))
  cpSync(REAL_DB, join(userData, 'reliquary.db'))

  const archive = join(userData, 'export.reliquary.zip')
  let app: ChildProcess | null = null

  try {
    app = startElectron(userData, CDP_PORT)
    const { cdp, socket } = await attach(CDP_PORT)
    await waitFor(cdp, `document.querySelector('.sidebar__item')`)
    await delay(900)

    // The state of the user: the live hosts and the old folder.
    const before = (await cdp.evaluate(`(async () => {
      const hosts = await window.reliquary.host.list()
      const old = await window.reliquary.transfer.superseded()
      return { hosts: hosts.length, old: old.length }
    })()`)) as { hosts: number; old: number }
    console.log(`  info — the hosts: ${before.hosts}, the old folder: ${before.old}`)

    // 1. the export, with the old folder in it — the way the panel does
    // it by default.
    const exported = (await cdp.evaluate(`(async () => {
      return window.reliquary.transfer.export({
        options: { mode: 'without-passwords', includeKeys: true, includeOld: true },
        path: ${JSON.stringify(archive)}
      })
    })()`)) as { path?: string; summary?: string }
    check('the archive is written', Boolean(exported.path))

    // 2. every host is deleted.
    const deleted = (await cdp.evaluate(`(async () => {
      const hosts = await window.reliquary.host.list()
      for (const host of hosts) await window.reliquary.host.remove(host.id)
      return (await window.reliquary.host.list()).length
    })()`)) as number
    check('every host is deleted', deleted === 0)

    // 3. the archive comes back.
    const imported = (await cdp.evaluate(`(async () => {
      return window.reliquary.transfer.import({ path: ${JSON.stringify(archive)} })
    })()`)) as { added?: number; updated?: number; superseded?: number }
    console.log(`  info — the import: ${JSON.stringify(imported)}`)
    await delay(1200)

    const after = (await cdp.evaluate(`(async () => {
      const hosts = await window.reliquary.host.list()
      const old = await window.reliquary.transfer.superseded()
      return {
        hosts: hosts.map((h) => h.name),
        old: old.length,
        oldNames: old.map((o) => o.name)
      }
    })()`)) as { hosts: string[]; old: number; oldNames: string[] }

    check('the hosts are back', after.hosts.length === before.hosts)
    check(
      'the import adds nothing to the old folder',
      after.old === before.old
    )
    console.log(`  info — the hosts after: ${JSON.stringify(after.hosts)}`)
    if (after.old > 0) console.log(`  info — the old folder: ${JSON.stringify(after.oldNames)}`)

    socket.close()
  } catch (error) {
    failed += 1
    console.error('RESULT: ERROR —', error instanceof Error ? (error.stack ?? error.message) : error)
  } finally {
    console.log(`\nChecks: ${checks}, failed: ${failed}`)
    console.log(failed > 0 ? 'RESULT: FAIL' : 'RESULT: PASS')
    await cleanupApp(app, userData)
    if (failed > 0) process.exitCode = 1
  }
}

await main()
