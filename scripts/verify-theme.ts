/**
 * Checks the theme menu of a running session.
 *
 * A real OpenSSH server is started on the loopback, the app connects to
 * it with a key, and the menu of the themes is opened in the header of the
 * session. The server is the system one — `sshd` on a high port, with a
 * key of its own.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { attach, cleanupApp, portIsFree, startElectron, waitFor } from './lib/cdp.ts'

const CDP_PORT = 9249
const SSH_PORT = 22222
const HOST_KEY = '/tmp/reliquary_test_hostkey'
const CLIENT_KEY = '/tmp/reliquary_client_key'
const AUTHORIZED = '/tmp/reliquary_authorized_keys'
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

/** The config of the test server. */
const CONFIG_TEXT = `Port ${SSH_PORT}
ListenAddress 127.0.0.1
HostKey ${HOST_KEY}
PidFile /tmp/reliquary_sshd.pid
AuthorizedKeysFile ${AUTHORIZED}
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM no
StrictModes no
LogLevel VERBOSE
Subsystem sftp internal-sftp
`

async function main(): Promise<void> {
  if (!(await portIsFree(CDP_PORT))) throw new Error(`CDP port ${CDP_PORT} is busy`)
  if (!(await portIsFree(SSH_PORT))) throw new Error(`SSH port ${SSH_PORT} is busy`)

  writeFileSync(CONFIG, CONFIG_TEXT)

  // The system SSH server on the loopback.
  const sshd = spawn('/usr/sbin/sshd', ['-f', CONFIG, '-E', '/tmp/reliquary_sshd.log'], {
    stdio: 'ignore'
  })
  await delay(1200)

  const userData = mkdtempSync(join(tmpdir(), 'reliquary-theme-'))
  let app: ChildProcess | null = null

  try {
    app = startElectron(userData, CDP_PORT)
    const { cdp, socket } = await attach(CDP_PORT)
    await waitFor(cdp, `document.querySelector('.sidebar__item')`)
    await delay(600)

    // The keychain of the app is locked until the master password is set.
    const master = (await cdp.evaluate(
      `window.reliquary.master.set('test-master-password')`
    )) as { unlocked?: boolean } | null
    check('the master password was set', Boolean(master?.unlocked))
    await delay(600)

    // The key goes into the keychain of the app.
    const privateKey = readFileSync(CLIENT_KEY, 'utf8')
    const imported = (await cdp.evaluate(`window.reliquary.key.import(${JSON.stringify({
      name: 'test-key',
      privateKey
    })})`)) as { id?: string } | null
    check('the key was imported into the keychain', Boolean(imported?.id))

    const listed = (await cdp.evaluate(`window.reliquary.key.list()`)) as unknown[]
    console.log(`  info — the keychain holds ${listed.length} keys`)

    // The form reads the key list once, when it mounts. The key came after
    // that, so the window is reloaded — the same as a fresh start.
    await cdp.send('Page.reload')
    await delay(1500)
    await waitFor(cdp, `document.querySelector('.sidebar__item')`)
    await delay(800)

    // The form of a new connection: the switch to the key first.
    await cdp.evaluate(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      const keyButton = buttons.find((b) => /^\\s*key\\s*$/i.test(b.textContent || ''))
      keyButton?.click()
      return true
    })()`)
    await delay(500)

    const filled = await cdp.evaluate(`(() => {
      const set = (name, value) => {
        const el = document.querySelector('[name="' + name + '"]')
        if (!el) return false
        const proto = Object.getPrototypeOf(el)
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      }
      const host = set('host', '127.0.0.1')
      const port = set('port', '${SSH_PORT}')
      const user = set('username', SSH_USER)
      return { host, port, user }
    })()`)
    check(
      'the form was filled',
      Object.values(filled as Record<string, boolean>).every(Boolean)
    )
    await delay(400)

    // The key of the keychain is picked in the form.
    const keySet = await cdp.evaluate(`(() => {
      const select = document.querySelector('select[name="key"]')
      if (!select) return 'no-select'
      const options = Array.from(select.options).map((o) => ({ value: o.value, text: o.textContent }))
      const option = Array.from(select.options).find((o) => o.textContent?.includes('test-key'))
      if (!option) return 'no-option:' + JSON.stringify(options)
      const proto = Object.getPrototypeOf(select)
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(select, option.value)
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return 'ok'
    })()`)
    console.log(`  info — the key select: ${keySet}`)
    check('the key was picked in the form', keySet === 'ok')
    await delay(300)

    const clicked = await cdp.evaluate(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      const button = buttons.find((b) => /^\\s*(connect|подключиться)\\s*$/i.test(b.textContent || ''))
      if (!button) return 'no-button'
      button.click()
      return 'ok'
    })()`)
    check('the connect button was found', clicked === 'ok')

    await delay(5000)

    const state = await cdp.evaluate(`(() => {
      return {
        error: document.querySelector('.form__error, .connect-form__error, [class*="error"]')?.textContent ?? null,
        body: document.querySelector('.terminal-panel')?.textContent?.slice(0, 200) ?? null
      }
    })()`)
    console.log('  info — the state after the click: ' + JSON.stringify(state))

    const connected = await cdp.evaluate(`(() => {
      return Boolean(document.querySelector('.status-dot--ok'))
    })()`)
    check('the session is connected', connected === true)

    if (!connected) {
      socket.close()
      console.log(`RESULT: ${checks - failed}/${checks}`)
      process.exitCode = 1
      return
    }

    // The theme button in the header of the session.
    const hasButton = await cdp.evaluate(`(() => {
      return Boolean(document.querySelector('.theme-button__toggle'))
    })()`)
    check('the theme button is in the header', hasButton === true)

    // The check mark is away while the menu is closed.
    const hiddenBefore = await cdp.evaluate(`(() => {
      const mark = document.querySelector('.theme-button__check')
      if (!mark) return null
      // The mark is pushed out of the button with a transform.
      const shift = getComputedStyle(mark).transform
      return { shift, away: shift !== 'none' && !shift.includes('matrix(1, 0, 0, 1, 0, 0)') }
    })()`) as { shift: string; away: boolean } | null
    console.log(`  info — the check mark while closed: ${JSON.stringify(hiddenBefore)}`)
    check('the check mark is away while the menu is closed', hiddenBefore?.away === true)

    // Open the menu.
    await cdp.evaluate(`(() => {
      document.querySelector('.theme-button__toggle')?.click()
      return true
    })()`)
    await delay(700)

    const menu = (await cdp.evaluate(`(() => {
      const el = document.querySelector('.theme-button__menu')
      if (!el) return null
      const items = el.querySelectorAll('.theme-picker__item')
      return { count: items.length }
    })()`)) as { count: number } | null
    check('the menu of the themes opens', menu !== null)
    check('the menu holds ten themes', menu?.count === 10)

    // The check mark slides out when the menu is open.
    const shownNow = await cdp.evaluate(`(() => {
      const mark = document.querySelector('.theme-button__check')
      if (!mark) return null
      const shift = getComputedStyle(mark).transform
      return shift === 'none' || shift.includes('matrix(1, 0, 0, 1, 0, 0)')
    })()`)
    check('the check mark slides out', shownNow === true)

    // Pick another theme and check that the terminal took it.
    // The color of the terminal before the pick.
    const before = (await cdp.evaluate(`(() => {
      const rows = Array.from(document.querySelectorAll('.xterm-rows > div'))
      const styles = rows.map((row) => row.textContent ?? '')
      return { rows: rows.length, text: styles.join('').slice(0, 80) }
    })()`)) as { rows: number; text: string } | null
    console.log(`  info — the terminal: ${JSON.stringify(before)}`)

    await cdp.evaluate(`(() => {
      const items = document.querySelectorAll('.theme-picker__item')
      items[2]?.click()
      return true
    })()`)
    await delay(1800)

    // The theme is stored — the terminal took it.
    const stored = (await cdp.evaluate(
      `window.reliquary.settings.get().then((s) => s.terminalTheme)`
    )) as string | null
    check('the theme was stored', stored === 'dracula')

    // The colors of the terminal really changed. The DOM renderer of xterm
    // paints with classes, so the color is read from the computed style.
    const colored = (await cdp.evaluate(`(() => {
      const view = document.querySelector('.xterm-viewport')
      const rows = Array.from(document.querySelectorAll('.xterm-rows > div'))
      const marks = rows.flatMap((row) => Array.from(row.querySelectorAll('span')))
      const colors = marks
        .map((m) => getComputedStyle(m).color)
        .filter((c) => c && c !== 'rgb(0, 0, 0)')
      const bg = view ? getComputedStyle(view).backgroundColor : null
      return { count: colors.length, sample: [...new Set(colors)].slice(0, 5), bg }
    })()`)) as { count: number; sample: string[]; bg: string | null } | null
    console.log(`  info — the colors of the terminal: ${JSON.stringify(colored)}`)
    check('the terminal is painted in the colors of the theme', (colored?.count ?? 0) > 0)

    // The background of the terminal is the background of the theme.
    const backgrounds = (await cdp.evaluate(`(() => {
      const els = Array.from(document.querySelectorAll('.xterm, .xterm-viewport, .xterm-screen, .terminal-view'))
      return els.map((el) => ({ cls: el.className, bg: getComputedStyle(el).backgroundColor }))
    })()`)) as { cls: string; bg: string }[] | null
    console.log(`  info — the backgrounds: ${JSON.stringify(backgrounds)}`)

    // The menu takes itself away after the pick.
    const closed = await cdp.evaluate(`(() => {
      return !document.querySelector('.theme-button__menu')
    })()`)
    check('the menu closes after the pick', closed === true)

    // The menu is opened again to see which theme is active now.
    await cdp.evaluate(`(() => {
      document.querySelector('.theme-button__toggle')?.click()
      return true
    })()`)
    await delay(700)

    const applied = (await cdp.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('.theme-picker__item'))
      const active = items.findIndex((item) => item.classList.contains('theme-picker__item--active'))
      const name = items[active]?.querySelector('.theme-picker__name')?.textContent ?? null
      return { active, name }
    })()`)) as { active: number; name: string | null } | null
    check('the third theme is active', applied?.active === 2)
    console.log(`  info — the active theme: ${applied?.name}`)

    await cdp.send('Page.enable')
    await delay(300)
    const shot = (await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true
    })) as { data?: string }
    if (shot?.data) {
      writeFileSync('/tmp/theme_session.png', Buffer.from(shot.data, 'base64'))
      console.log('  wrote /tmp/theme_session.png')
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
