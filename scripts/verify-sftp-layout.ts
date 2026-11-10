/**
 * Checks the layout of an SFTP session.
 *
 * The file manager and the drawer of the themes have to share the row —
 * the drawer takes a column of its own, the content moves aside.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { attach, cleanupApp, portIsFree, startElectron, waitFor } from './lib/cdp.ts'


// The name of the local user the test sshd accepts. It is the
// system user of this machine — it must not be written down here,
// the pictures and the logs of the harnesses travel to a public
// repository.
const SSH_USER = process.env.USER ?? 'tester'

const CDP_PORT = 9257
const SSH_PORT = 22222
const CLIENT_KEY = '/tmp/reliquary_client_key'
const CONFIG = '/tmp/reliquary_sshd_config'

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

  const sshd = spawn('/usr/sbin/sshd', ['-f', CONFIG, '-E', '/tmp/reliquary_sshd.log'], {
    stdio: 'ignore'
  })
  await delay(1200)

  const userData = mkdtempSync(join(tmpdir(), 'reliquary-sftp-'))
  let app: ChildProcess | null = null

  try {
    app = startElectron(userData, CDP_PORT)
    const { cdp, socket } = await attach(CDP_PORT)
    await waitFor(cdp, `document.querySelector('.sidebar__item')`)
    await delay(800)

    await cdp.evaluate(`window.reliquary.master.set('test-master-password')`)
    await delay(500)
    const fs = await import('node:fs')
    const privateKey = fs.readFileSync(CLIENT_KEY, 'utf8')
    const imported = (await cdp.evaluate(
      `window.reliquary.key.import(${JSON.stringify({ name: 'k', privateKey })})`
    )) as { id?: string } | null
    check('the key was imported', Boolean(imported?.id))
    await delay(400)

    // A host with the SFTP protocol.
    const saved = (await cdp.evaluate(`window.reliquary.host.save({
      name: 'SftpHost',
      protocol: 'sftp',
      host: '127.0.0.1',
      port: ${SSH_PORT},
      username: ${JSON.stringify(SSH_USER)},
      authMethod: 'key',
      keyId: ${JSON.stringify(imported?.id ?? null)}
    })`)) as { id?: string } | null
    check('the host was saved', Boolean(saved?.id))

    await cdp.send('Page.reload')
    await delay(1800)
    await waitFor(cdp, `document.querySelector('.sidebar__item')`)
    await delay(900)

    // The context menu of the host — the submenu of the protocol.
    await cdp.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('.host-list__item'))
      const item = items.find((i) =>
        (i.querySelector('.host-list__name')?.textContent || '').trim() === 'SftpHost'
      )
      if (!item) return false
      const box = item.getBoundingClientRect()
      item.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: Math.round(box.left + 40),
        clientY: Math.round(box.top + 10)
      }))
      return true
    })()`)
    await delay(500)
    await cdp.evaluate(`(() => {
      const submenu = document.querySelector('.host-menu__item--submenu')
      submenu?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      return true
    })()`)
    await delay(500)
    await cdp.evaluate(`(() => {
      const columns = document.querySelectorAll('.host-menu__column')
      const items = columns.length > 1
        ? Array.from(columns[1].querySelectorAll('.host-menu__item'))
        : []
      const sftp = items.find((i) => /SFTP/i.test(i.textContent || ''))
      sftp?.click()
      return true
    })()`)
    await delay(6000)

    const state = (await cdp.evaluate(`(() => {
      const manager = document.querySelector('.file-manager')
      const drawer = document.querySelector('.theme-panel')
      const header = document.querySelector('.terminal-panel__header')
      const toggle = document.querySelector('.theme-button__toggle')
      return {
        hasManager: Boolean(manager),
        hasDrawer: Boolean(drawer),
        drawerInHeader: Boolean(drawer && header?.contains(drawer)),
        toggleInHeader: Boolean(toggle && header?.contains(toggle)),
        error: document.querySelector('.connect-form__error')?.textContent ?? null
      }
    })()`)) as Record<string, unknown>
    console.log(`  info — the sftp tab: ${JSON.stringify(state)}`)
    check('the file manager is shown', state.hasManager === true)
    check('the theme drawer is not in the header', state.drawerInHeader === false)
    check('the theme button is in the header', state.toggleInHeader === true)

    // The closed drawer is invisible and takes no space.
    const closed = (await cdp.evaluate(`(() => {
      const drawer = document.querySelector('.theme-panel')
      if (!drawer) return null
      const box = drawer.getBoundingClientRect()
      const styles = getComputedStyle(drawer)
      return {
        width: Math.round(box.width),
        visibility: styles.visibility
      }
    })()`)) as { width: number; visibility: string } | null
    console.log(`  info — the closed drawer: ${JSON.stringify(closed)}`)
    check('the closed drawer takes no space', (closed?.width ?? 99) < 5)
    check('the closed drawer is invisible', closed?.visibility === 'hidden')

    await cdp.send('Page.enable')
    await delay(300)
    const shot = (await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true
    })) as { data?: string }
    if (shot?.data) {
      writeFileSync('/tmp/sftp_before.png', Buffer.from(shot.data, 'base64'))
      console.log('  wrote /tmp/sftp_before.png')
    }

    // The drawer opens — the file manager has to move aside.
    await cdp.evaluate(`(() => {
      document.querySelector('.theme-button__toggle')?.click()
      return true
    })()`)
    await delay(900)

    const layout = (await cdp.evaluate(`(() => {
      const manager = document.querySelector('.file-manager')
      const drawer = document.querySelector('.theme-panel')
      if (!manager || !drawer) return null
      const m = manager.getBoundingClientRect()
      const d = drawer.getBoundingClientRect()
      return {
        managerRight: Math.round(m.right),
        drawerLeft: Math.round(d.left),
        drawerWidth: Math.round(d.width),
        window: window.innerWidth
      }
    })()`)) as {
      managerRight: number
      drawerLeft: number
      drawerWidth: number
      window: number
    } | null
    console.log(`  info — the layout with the drawer: ${JSON.stringify(layout)}`)
    check(
      'the drawer does not cover the file manager',
      layout !== null && layout.drawerLeft >= layout.managerRight - 1
    )

    const shot2 = (await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true
    })) as { data?: string }
    if (shot2?.data) {
      writeFileSync('/tmp/sftp_drawer.png', Buffer.from(shot2.data, 'base64'))
      console.log('  wrote /tmp/sftp_drawer.png')
    }

    socket.close()
  } finally {
    await cleanupApp(app, userData)
    sshd.kill('SIGTERM')
  }

  console.log(`RESULT: ${checks - failed}/${checks}`)
  if (failed > 0) process.exitCode = 1
}

await main()
