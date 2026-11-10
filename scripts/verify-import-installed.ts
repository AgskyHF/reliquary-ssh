/**
 * The import in the installed app, on a copy of the database of the user.
 *
 * The app under test runs against a copy in a scratch dir — the data of
 * the user is not touched.
 */
import { attach } from './lib/cdp.ts'

const CDP_PORT = 9264

const { cdp, socket } = await attach(CDP_PORT)

const before = (await cdp.evaluate(`(async () => {
  const hosts = await window.reliquary.host.list()
  const old = await window.reliquary.transfer.superseded()
  return { hosts: hosts.map((h) => h.name), old: old.length }
})()`)) as { hosts: string[]; old: number }

console.log(`до: ${JSON.stringify(before)}`)

const archive = '/tmp/reliquary_installed_check/export.reliquary.zip'

const after = (await cdp.evaluate(`(async () => {
  await window.reliquary.transfer.export({
    options: { mode: 'without-passwords', includeKeys: true, includeOld: true },
    path: ${JSON.stringify(archive)}
  })

  const hosts = await window.reliquary.host.list()
  for (const host of hosts) await window.reliquary.host.remove(host.id)

  const result = await window.reliquary.transfer.import({ path: ${JSON.stringify(archive)} })

  const live = await window.reliquary.host.list()
  const old = await window.reliquary.transfer.superseded()
  return {
    result,
    hosts: live.map((h) => h.name),
    old: old.length,
    oldNames: old.map((o) => o.name)
  }
})()`)) as {
  result: { added?: number; superseded?: number }
  hosts: string[]
  old: number
  oldNames: string[]
}

console.log(`после: ${JSON.stringify(after)}`)

socket.close()
