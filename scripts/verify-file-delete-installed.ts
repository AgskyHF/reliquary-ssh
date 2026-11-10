/**
 * Checks the installed app in /Applications: the file manager has to offer
 * the deletion, and the deletion has to reach the server.
 */
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { attach, cleanupApp, portIsFree, waitFor } from './lib/cdp.ts'
import { startTestSftpServer } from '../tests/helpers/test-sftp-server.ts'

const CDP_PORT = 9261
const SFTP_PORT = 22226
const APP = '/Applications/ReliquarySSH.app/Contents/MacOS/ReliquarySSH'

let checks = 0
let failed = 0

function check(name: string, ok: boolean): void {
  checks += 1
  console.log(ok ? `  ok — ${name}` : `  FAIL — ${name}`)
  if (!ok) failed += 1
}

async function main(): Promise<void> {
  if (!(await portIsFree(CDP_PORT))) throw new Error(`CDP port ${CDP_PORT} is busy`)

  const server = await startTestSftpServer(SFTP_PORT)
  const target = join(server.root, 'doomed.txt')
  writeFileSync(target, 'goodbye\n', 'utf8')
  mkdirSync(join(server.root, 'doomed-dir'), { recursive: true })

  const userData = mkdtempSync(join(tmpdir(), 'reliquary-installed-'))
  let app: ChildProcess | null = null

  try {
    app = spawn(APP, [`--remote-debugging-port=${CDP_PORT}`], {
      env: {
        ...process.env,
        RELIQUARY_USER_DATA: userData,
        RELIQUARY_OFFSCREEN: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    app.stdout?.on('data', (c: Buffer) => process.stdout.write(`[app] ${c}`))
    app.stderr?.on('data', (c: Buffer) => process.stdout.write(`[app] ${c}`))

    const { cdp, socket } = await attach(CDP_PORT)
    await waitFor(cdp, `document.querySelector('.sidebar__item')`)
    await delay(800)

    const version = (await cdp.evaluate(`window.reliquary.appInfo()`)) as {
      version?: string
    }
    console.log(`  info — the installed version: ${version?.version}`)
    check('the installed app is 0.1.1', version?.version === '0.1.1')

    const saved = (await cdp.evaluate(`window.reliquary.host.save({
      name: 'SftpInstalledHost',
      protocol: 'sftp',
      host: '127.0.0.1',
      port: ${SFTP_PORT},
      username: 'tester',
      authMethod: 'password'
    })`)) as { id?: string } | null
    await cdp.evaluate(`window.reliquary.hostPassword.set({
      hostId: ${JSON.stringify(saved?.id ?? '')},
      password: 'secret'
    })`)
    await delay(400)

    await cdp.send('Page.reload')
    await delay(1800)
    await waitFor(cdp, `document.querySelector('.sidebar__item')`)
    await delay(900)

    await cdp.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('.host-list__item'))
      const item = items.find((i) =>
        (i.querySelector('.host-list__name')?.textContent || '').trim() === 'SftpInstalledHost'
      )
      if (!item) return false
      const box = item.getBoundingClientRect()
      item.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: Math.round(box.left + 40),
        clientY: Math.round(box.top + 10)
      }))
      return true
    })()`)
    await delay(500)
    await cdp.evaluate(`(() => {
      document.querySelector('.host-menu__item--submenu')
        ?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      return true
    })()`)
    await delay(500)
    await cdp.evaluate(`(() => {
      const columns = document.querySelectorAll('.host-menu__column')
      const items = columns.length > 1
        ? Array.from(columns[1].querySelectorAll('.host-menu__item'))
        : []
      items.find((i) => /SFTP/i.test(i.textContent || ''))?.click()
      return true
    })()`)
    await delay(6000)

    const hasDelete = (await cdp.evaluate(
      `Boolean(document.querySelector('.file-manager__delete'))`
    )) as boolean
    check('the delete button is in the installed app', hasDelete === true)

    await cdp.evaluate(`(() => {
      const row = Array.from(document.querySelectorAll('.file-manager__row')).find((r) =>
        (r.querySelector('.file-manager__cell--name')?.textContent || '').includes('doomed.txt')
      )
      row?.querySelector('.file-manager__delete')?.click()
      return true
    })()`)
    await delay(600)
    await cdp.evaluate(`(() => {
      const row = Array.from(document.querySelectorAll('.file-manager__row')).find((r) =>
        (r.querySelector('.file-manager__cell--name')?.textContent || '').includes('doomed.txt')
      )
      row?.querySelector('.file-manager__confirm-yes')?.click()
      return true
    })()`)
    await delay(2000)

    check('the installed app deletes the file', !existsSync(target))

    socket.close()
  } finally {
    await cleanupApp(app, userData)
    await server.close()
  }

  console.log(`RESULT: ${checks - failed}/${checks}`)
  if (failed > 0) process.exitCode = 1
}

await main()
