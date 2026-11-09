/**
 * Checks the hosts of the sidebar.
 *
 * The list opens a tab for a host, the context menu of the right button
 * holds the commands of the host.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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

    // A host with a password. The master password is not set — the
    // password of a host has to work without one.
    const withPassword = (await cdp.evaluate(`window.reliquary.host.save({
      name: 'PasswordHost',
      protocol: 'ssh',
      host: '127.0.0.1',
      port: ${SSH_PORT},
      username: SSH_USER,
      authMethod: 'password',
      keyId: null
    })`)) as { id?: string } | null
    check('the host with a password was saved', Boolean(withPassword?.id))

    const stored = (await cdp.evaluate(`window.reliquary.hostPassword.set({
      hostId: ${JSON.stringify(withPassword?.id ?? '')},
      password: 'the-secret'
    })`)) as { stored?: boolean } | null
    check('the password of the host was stored', stored?.stored === true)

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

    // The sidebar holds the hosts only — the button to add one is gone.
    const addButton = await cdp.evaluate(
      `document.querySelectorAll('.host-list__add').length`
    )
    check('the sidebar has no add button', addButton === 0)

    const names = (await cdp.evaluate(`(() => {
      return Array.from(document.querySelectorAll('.host-list__name')).map((n) =>
        (n.textContent || '').trim()
      )
    })()`)) as string[]
    console.log(`  info — the hosts: ${JSON.stringify(names)}`)
    check('the hosts are in the list', names.length === 2 && names.includes('TestHost'))

    // The item of a host by its name — the menu works on the right one.
    const itemOf = (name: string): string => `
      (() => {
        const items = Array.from(document.querySelectorAll('.host-list__item'))
        const item = items.find((i) =>
          (i.querySelector('.host-list__name')?.textContent || '').trim() === '${name}'
        )
        if (!item) return null
        const box = item.getBoundingClientRect()
        item.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: Math.round(box.left + 40),
          clientY: Math.round(box.top + 10)
        }))
        return true
      })()
    `

    // ---- the right button opens the menu ----
    const menuOpened = (await cdp.evaluate(itemOf('TestHost'))) as boolean
    check('the right button opens the menu', menuOpened === true)
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
    check('the menu holds the duplicate command', has('Duplicate') || has('Дублировать'))
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

    // ---- a single click does not connect ----
    const before = await cdp.evaluate(`document.querySelectorAll('.tab-bar__tab').length`)
    await cdp.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('.host-list__item'))
      const item = items.find((i) =>
        (i.querySelector('.host-list__name')?.textContent || '').trim() === 'TestHost'
      )
      item?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return true
    })()`)
    await delay(2500)
    const after = await cdp.evaluate(`document.querySelectorAll('.tab-bar__tab').length`)
    check('a single click does not open a session', before === after)

    // ---- the double click connects ----
    await cdp.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('.host-list__item'))
      const item = items.find((i) =>
        (i.querySelector('.host-list__name')?.textContent || '').trim() === 'TestHost'
      )
      item?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      return true
    })()`)

    // The animation of a connection — the form of a new connection must
    // not stand in its place. It is polled: on a fast host it is over in
    // a moment.
    let animation: { present: boolean; title: string | null; steps: number } = {
      present: false,
      title: null,
      steps: 0
    }
    for (let attempt = 0; attempt < 60 && !animation.present; attempt += 1) {
      animation = (await cdp.evaluate(`(() => {
        const el = document.querySelector('.connecting')
        return {
          present: Boolean(el),
          title: el?.querySelector('.connecting__title')?.textContent ?? null,
          steps: el?.querySelectorAll('.connecting__step').length ?? 0
        }
      })()`)) as { present: boolean; title: string | null; steps: number }
      if (animation.present) break
      await delay(50)
    }
    console.log(`  info — the animation: ${JSON.stringify(animation)}`)
    check('the connection shows an animation', animation.present === true)
    check('the animation holds the steps', animation.steps === 3)

    await delay(5000)

    // The duplicate of a host.
    await cdp.evaluate(itemOf('TestHost'))
    await delay(500)
    await cdp.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('.host-menu__item'))
      const duplicate = items.find((i) => /duplicate|дублир/i.test(i.textContent || ''))
      duplicate?.click()
      return true
    })()`)
    await delay(1200)

    const afterCopy = await cdp.evaluate(`(() => {
      const names = Array.from(document.querySelectorAll('.host-list__name')).map((n) =>
        (n.textContent || '').trim()
      )
      return names
    })()`)
    console.log(`  info — the hosts after the duplicate: ${JSON.stringify(afterCopy)}`)
    check(
      'the copy of the host says that it is a copy',
      (afterCopy as string[]).some((name) => /copy/i.test(name))
    )

    // ---- a host with a password connects with the stored password ----
    // The password of the host is the one of the test server.
    await cdp.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('.host-list__item'))
      const item = items.find((i) =>
        (i.querySelector('.host-list__name')?.textContent || '').trim() === 'PasswordHost'
      )
      item?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      return true
    })()`)
    await delay(6000)

    // The test server knows only the key, so the password is refused by
    // the server — but it has to be found in the storage and sent.
    // The log of the app says which one of the two happened.
    const passwordSession = (await cdp.evaluate(`(() => {
      const dots = document.querySelectorAll('.status-dot--ok')
      const error = document.querySelector('.connect-form__error')?.textContent ?? null
      return { connected: dots.length > 0, error }
    })()`)) as { connected: boolean; error: string | null }
    console.log(`  info — the host with a password: ${JSON.stringify(passwordSession)}`)

    const logPath = join(userData, 'reliquary.log')
    let lastLines = ''
    try {
      lastLines = readFileSync(logPath, 'utf8').split('\n').slice(-40).join('\n')
    } catch {
      // The log is not there — the check below falls back to the error.
    }
    const noPassword = /no stored password/i.test(lastLines)
    check(
      'the stored password was found — the app did not claim it is missing',
      !noPassword && !/no stored password/i.test(passwordSession.error ?? '')
    )

    // The password reached the server: the server refused it, but it was
    // sent — the error is the one of the server, not of the app.
    check(
      'the stored password was sent to the server',
      /authentication methods failed/i.test(passwordSession.error ?? '')
    )

    // ---- the button "Add" puts the host into the list ----
    const formButtons = await cdp.evaluate(`(() => {
      const buttons = Array.from(document.querySelectorAll('.connect-form__actions button'))
      return buttons.map((b) => (b.textContent || '').trim())
    })()`)
    console.log(`  info — the buttons of the form: ${JSON.stringify(formButtons)}`)
    check(
      'the form holds an add button',
      (formButtons as string[]).some((b) => /add|добав/i.test(b))
    )
    check(
      'the form holds a connect button',
      (formButtons as string[]).some((b) => /connect|подключ/i.test(b))
    )

    // The host field starts empty — the address is only a hint.
    const hostField = await cdp.evaluate(`(() => {
      const el = document.querySelector('input[name="host"]')
      return el ? { value: el.value, placeholder: el.placeholder } : null
    })()`)
    console.log(`  info — the host field: ${JSON.stringify(hostField)}`)
    check('the host field starts empty', (hostField as { value: string }).value === '')

    // The form is filled and the host is added to the list.
    await cdp.evaluate(`(() => {
      const set = (name, value) => {
        const el = document.querySelector('[name="' + name + '"]')
        if (!el) return false
        const proto = Object.getPrototypeOf(el)
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      }
      set('host', '10.0.0.77')
      set('username', SSH_USER)
      return true
    })()`)
    await delay(400)
    await cdp.evaluate(`(() => {
      const buttons = Array.from(document.querySelectorAll('.connect-form__actions button'))
      const add = buttons.find((b) => /add|добав/i.test(b.textContent || ''))
      add?.click()
      return true
    })()`)
    await delay(1500)

    const afterAdd = (await cdp.evaluate(`(() => {
      return Array.from(document.querySelectorAll('.host-list__name')).map((n) =>
        (n.textContent || '').trim()
      )
    })()`)) as string[]
    console.log(`  info — the hosts after the add: ${JSON.stringify(afterAdd)}`)
    check(
      'the add button puts the host into the list',
      afterAdd.some((name) => name.includes('10.0.0.77'))
    )

    // "Add" does not connect — the tab of the session stays without a
    // connection and the form is cleared.
    const afterAddState = (await cdp.evaluate(`(() => {
      const tabs = Array.from(document.querySelectorAll('.tab-bar__tab')).map((t) => ({
        title: (t.textContent || '').trim(),
        connected: Boolean(t.querySelector('.status-dot--ok'))
      }))
      const host = document.querySelector('input[name="host"]')
      const username = document.querySelector('input[name="username"]')
      const password = document.querySelector('input[name="password"]')
      return {
        tabs,
        host: host ? host.value : null,
        username: username ? username.value : null,
        password: password ? password.value : null
      }
    })()`)) as {
      tabs: { title: string; connected: boolean }[]
      host: string | null
      username: string | null
      password: string | null
    }
    console.log(`  info — the state after the add: ${JSON.stringify(afterAddState)}`)
    check(
      'the add button does not open a session',
      !afterAddState.tabs.some((tab) => tab.connected && tab.title.includes('10.0.0.77'))
    )
    check('the host field is cleared', afterAddState.host === '')
    check('the username field is cleared', afterAddState.username === '')
    check('the password field is cleared', afterAddState.password === '')

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
    check('the double click opens a session', (connected as { connected: boolean }).connected)

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
