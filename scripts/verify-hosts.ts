/**
 * Checks the hosts of the sidebar.
 *
 * The list opens a tab for a host, the context menu of the right button
 * holds the commands of the host.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { attach, cleanupApp, portIsFree, startElectron, waitFor } from './lib/cdp.ts'

const CDP_PORT = 9255
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

  const userData = mkdtempSync(join(tmpdir(), 'reliquary-hosts-'))
  let app: ChildProcess | null = null

  try {
    app = startElectron(userData, CDP_PORT)
    const { cdp, socket } = await attach(CDP_PORT)
    await waitFor(cdp, `document.querySelector('.sidebar__item')`)
    await delay(800)

    // The keychain has to be unlocked and hold a key.
    await cdp.evaluate(`window.reliquary.master.set('test-master-password')`)
    await delay(500)
    const fs = await import('node:fs')
    const privateKey = fs.readFileSync(CLIENT_KEY, 'utf8')
    const imported = (await cdp.evaluate(
      `window.reliquary.key.import(${JSON.stringify({ name: 'k', privateKey })})`
    )) as { id?: string } | null
    check('the key was imported', Boolean(imported?.id))
    await delay(400)

    // A host is saved. It uses the key of the keychain.
    const saved = (await cdp.evaluate(`window.reliquary.host.save({
      name: 'TestHost',
      protocol: 'ssh',
      host: '127.0.0.1',
      port: ${SSH_PORT},
      username: SSH_USER,
      authMethod: 'key',
      keyId: ${JSON.stringify(imported?.id ?? null)}
    })`)) as { id?: string } | null
    check('the host was saved', Boolean(saved?.id))

    await cdp.send('Page.reload')
    await delay(1800)
    await waitFor(cdp, `document.querySelector('.sidebar__item')`)
    await delay(900)

    const hosts = await cdp.evaluate(`document.querySelectorAll('.host-list__item').length`)
    check('the host is in the list', hosts === 1)

    // ---- the right button opens the menu ----
    const menuOpened = (await cdp.evaluate(`(() => {
      const item = document.querySelector('.host-list__item')
      if (!item) return 'no-item'
      const box = item.getBoundingClientRect()
      item.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: Math.round(box.left + 40),
        clientY: Math.round(box.top + 10)
      }))
      return 'ok'
    })()`)) as string
    check('the right button opens the menu', menuOpened === 'ok')
    await delay(500)

    const menu = (await cdp.evaluate(`(() => {
      const el = document.querySelector('.host-menu')
      if (!el) return null
      const items = Array.from(el.querySelectorAll('.host-menu__item')).map((i) =>
        (i.textContent || '').trim()
      )
      return { items, columns: el.querySelectorAll('.host-menu__column').length }
    })()`)) as { items: string[]; columns: number } | null
    check('the menu is open', menu !== null)
    console.log(`  info — the items of the menu: ${JSON.stringify(menu?.items)}`)

    const has = (needle: string): boolean =>
      (menu?.items ?? []).some((item) => item.includes(needle))

    check('the menu holds the connect command', has('Connect') || has('Подключиться'))
    check('the menu holds the edit command', has('Edit') || has('Изменить'))
    check('the menu holds the copy command', has('Copy') || has('Копировать'))
    check('the menu holds the delete command', has('Delete') || has('Удалить'))

    // The submenu of the protocol opens on the hover.
    await cdp.evaluate(`(() => {
      const item = document.querySelector('.host-menu__item--submenu')
      if (!item) return false
      // React listens to mouseover for mouseenter.
      item.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      return true
    })()`)
    await delay(500)

    const submenu = (await cdp.evaluate(`(() => {
      const columns = document.querySelectorAll('.host-menu__column')
      if (columns.length < 2) return null
      const items = Array.from(columns[1].querySelectorAll('.host-menu__item')).map((i) =>
        (i.textContent || '').trim()
      )
      return items
    })()`)) as string[] | null
    check('the submenu of the protocol opens', submenu !== null)
    console.log(`  info — the submenu: ${JSON.stringify(submenu)}`)
    check(
      'the submenu holds SSH and SFTP',
      (submenu ?? []).some((i) => /SSH/i.test(i)) &&
        (submenu ?? []).some((i) => /SFTP/i.test(i))
    )

    await cdp.send('Page.enable')
    await delay(300)
    const shot = (await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true
    })) as { data?: string }
    if (shot?.data) {
      writeFileSync('/tmp/hosts_menu.png', Buffer.from(shot.data, 'base64'))
      console.log('  wrote /tmp/hosts_menu.png')
    }

    // ---- the left button connects ----
    await cdp.evaluate(`(() => {
      const item = document.querySelector('.host-list__item')
      item?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return true
    })()`)
    await delay(5000)

    // The menu took itself away when the host was clicked.
    const menuState = (await cdp.evaluate(`(() => {
      const el = document.querySelector('.host-menu')
      return {
        present: Boolean(el),
        width: el ? Math.round(el.getBoundingClientRect().width) : null
      }
    })()`)) as { present: boolean; width: number | null }
    console.log(`  info — the menu after the click: ${JSON.stringify(menuState)}`)
    check('the menu takes itself away', menuState.present === false)

    const connected = await cdp.evaluate(`(() => {
      const dots = document.querySelectorAll('.status-dot--ok')
      const tabs = Array.from(document.querySelectorAll('.tab-bar__tab')).map((t) =>
        (t.textContent || '').trim()
      )
      return { connected: dots.length > 0, tabs }
    })()`)
    console.log(`  info — the tabs: ${JSON.stringify(connected)}`)
    check('the left button opens a session', (connected as { connected: boolean }).connected)

    const shot2 = (await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true
    })) as { data?: string }
    if (shot2?.data) {
      writeFileSync('/tmp/hosts_connected.png', Buffer.from(shot2.data, 'base64'))
      console.log('  wrote /tmp/hosts_connected.png')
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
