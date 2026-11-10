/**
 * Verification harness for the theme of a live session.
 *
 * Scenario (all through the real UI over CDP):
 *  1. an SSH session opens against the test sshd (the sidebar opens the tab);
 *  2. a theme is picked in the drawer of that tab — the terminal follows;
 *  3. an SFTP session opens in a second tab;
 *  4. the SSH tab comes back to the front and another theme is picked —
 *     the terminal has to follow.
 *
 * The bug: after an SFTP session was opened, the theme of the SSH terminal
 * stopped changing. Every tab has a drawer of its own, and the drawer of
 * the hidden SFTP tab took the click that picked the theme as a click
 * outside of itself — the drawer closed before the click reached the theme.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { attach, cleanupApp, portIsFree, startElectron, waitFor } from './lib/cdp.ts'

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

/**
 * The colours of every terminal, as xterm painted them.
 *
 * xterm 6 writes them into a style element of its own, so they are read
 * from there — the terminal does not use the CSS variables.
 */
const ALL_THEMES = `(() => {
  return Array.from(document.querySelectorAll('.tab-pane .terminal-view')).map((pane) => {
    const el = pane.querySelector('.xterm')
    if (!el) return null
    const style = Array.from(el.querySelectorAll('style'))
      .find((st) => (st.textContent || '').includes('.xterm-rows {'))
    const text = style ? (style.textContent || '') : ''
    const rows = text.match(new RegExp('\\\\.xterm-rows \\\\{([^}]*)'))
    return {
      rows: rows ? rows[1].replace(/\\\\s+/g, ' ').trim() : '',
      viewBackground: pane.style.backgroundColor
    }
  })
})()`

/** Fills a field of the form of the tab that is on the screen. */
const FILL = (name: string, value: string): string => `(() => {
  const pane = document.querySelector('.tab-pane:not([hidden])')
  const el = pane?.querySelector('[name="${name}"]')
  if (!el) return false
  const proto = Object.getPrototypeOf(el)
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)})
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return true
})()`

/** The point of a theme in the drawer of the tab that is on the screen. */
const FIND_THEME = (name: string): string => `(() => {
  const pane = document.querySelector('.tab-pane:not([hidden])')
  if (!pane) return null
  const item = Array.from(pane.querySelectorAll('.theme-picker__item'))
    .find((i) => (i.querySelector('.theme-picker__name')?.textContent || '').trim() === ${JSON.stringify(name)})
  if (!item) return null
  const box = item.getBoundingClientRect()
  return JSON.stringify({
    x: Math.round(box.left + box.width / 2),
    y: Math.round(box.top + box.height / 2)
  })
})()`

/** Opens the drawer of the tab that is on the screen. */
const OPEN_DRAWER = `(() => {
  const pane = document.querySelector('.tab-pane:not([hidden])')
  const button = pane?.querySelector('.theme-button__toggle')
  if (!button) return false
  button.click()
  return true
})()`

/** Clicks the tab that carries the given title. */
const OPEN_TAB = (title: string, index = 0): string => `(() => {
  const tabs = Array.from(document.querySelectorAll('.tab-bar__tab'))
    .filter((t) => (t.textContent || '').includes(${JSON.stringify(title)}))
  const tab = tabs[${index}] ?? tabs[0]
  tab?.click()
  return Boolean(tab)
})()`

/**
 * A real mouse click on a point of the screen.
 *
 * Input.dispatchMouseEvent goes through the hit testing of the browser,
 * so a click on an element that became invisible in the meantime does not
 * reach it — exactly like a click of a human.
 */
async function clickAt(
  cdp: { send: (method: string, params?: Record<string, unknown>) => Promise<unknown> },
  x: number,
  y: number
): Promise<void> {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 1
  })

  // The button is held down for a moment, the way a hand holds it. The
  // drawer of a hidden tab closes on the mousedown and shrinks to zero
  // width in 200 ms — a click that arrives before that still hits the
  // theme, and the bug stays invisible.
  await delay(120)

  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 1
  })
}

/** Picks a theme in the drawer of the tab that is on the screen. */
async function pickTheme(
  cdp: {
    send: (method: string, params?: Record<string, unknown>) => Promise<unknown>
    evaluate: (expression: string) => Promise<unknown>
  },
  name: string
): Promise<boolean> {
  await cdp.evaluate(OPEN_DRAWER)
  await delay(700)

  const point = await cdp.evaluate(FIND_THEME(name))
  if (typeof point !== 'string') return false

  const { x, y } = JSON.parse(point) as { x: number; y: number }
  await clickAt(cdp, x, y)
  await delay(1200)
  return true
}

async function main(): Promise<void> {
  if (!(await portIsFree(CDP_PORT))) throw new Error(`CDP port ${CDP_PORT} is busy`)

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
    await delay(800)

    // A key for the keychain.
    await cdp.evaluate(`window.reliquary.master.set('test-master-password')`)
    await delay(400)
    const privateKey = readFileSync(CLIENT_KEY, 'utf8')
    const imported = (await cdp.evaluate(
      `window.reliquary.key.import(${JSON.stringify({ name: 'k', privateKey })})`
    )) as { id?: string } | null
    check('the key was imported', Boolean(imported?.id))

    // The host for both sessions.
    await cdp.evaluate(`window.reliquary.host.save({
      name: 'TestHost',
      protocol: 'ssh',
      host: '127.0.0.1',
      port: ${SSH_PORT},
      username: SSH_USER,
      authMethod: 'key',
      keyId: ${JSON.stringify(imported?.id ?? null)}
    })`)
    await delay(600)

    // The sidebar reads the hosts on mount — a reload picks the new one up.
    await cdp.send('Page.reload')
    await delay(1800)
    await waitFor(cdp, `document.querySelector('.sidebar__item')`)
    await delay(900)

    // 1. the SSH session — the sidebar opens the tab and it connects.
    await cdp.evaluate(`(() => {
      const item = Array.from(document.querySelectorAll('.host-list__item'))
        .find((i) => (i.querySelector('.host-list__name')?.textContent || '').trim() === 'TestHost')
      item?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      return true
    })()`)
    await delay(3000)
    check('the SSH terminal is up', await waitFor(cdp, `document.querySelector('.xterm')`, 25))

    // 2. a theme is picked in the drawer of the SSH tab.
    check('the first theme was picked', await pickTheme(cdp, 'Kanagawa Wave'))

    const first = (await cdp.evaluate(ALL_THEMES)) as { rows: string }[] | null
    console.log(`  info — the terminal after the first pick: ${JSON.stringify(first)}`)
    const firstRows = first?.[0]?.rows ?? ''
    check(
      'the terminal took the theme',
      firstRows.includes('color: #') && !firstRows.includes('#33FF66')
    )

    // 3. an SFTP session in a second tab.
    await cdp.evaluate(`document.querySelector('.tab-bar__new')?.click(), true`)
    await delay(900)

    await cdp.evaluate(`(() => {
      const pane = document.querySelector('.tab-pane:not([hidden])')
      const options = Array.from(pane?.querySelectorAll('.protocol-switch__option') ?? [])
      options.find((o) => (o.textContent || '').trim() === 'SFTP')?.click()
      return true
    })()`)
    await delay(400)

    await cdp.evaluate(`(() => {
      const pane = document.querySelector('.tab-pane:not([hidden])')
      const options = Array.from(pane?.querySelectorAll('.protocol-switch__option') ?? [])
      options.find((o) => (o.textContent || '').trim() === 'Key')?.click()
      return true
    })()`)
    await delay(500)

    await cdp.evaluate(FILL('host', '127.0.0.1'))
    await cdp.evaluate(FILL('port', String(SSH_PORT)))
    await cdp.evaluate(FILL('username', SSH_USER))
    await delay(300)

    await cdp.evaluate(`(() => {
      const pane = document.querySelector('.tab-pane:not([hidden])')
      const select = pane?.querySelector('select[name="key"]')
      if (!select) return false
      const proto = Object.getPrototypeOf(select)
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(select, select.options[1]?.value ?? '')
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`)
    await delay(300)

    await cdp.evaluate(`(() => {
      const pane = document.querySelector('.tab-pane:not([hidden])')
      const buttons = Array.from(pane?.querySelectorAll('.connect-form__actions button') ?? [])
      buttons.find((b) => /connect|подключ/i.test(b.textContent || ''))?.click()
      return true
    })()`)
    await delay(4000)

    const fileManagers = (await cdp.evaluate(
      `document.querySelectorAll('.tab-pane .file-manager').length`
    )) as number
    check('the SFTP tab is a file manager', fileManagers >= 1)

    // 4. the theme is picked in the SFTP tab — the visible one. The SSH
    // terminal is hidden and has to follow anyway.
    check('the second theme was picked', await pickTheme(cdp, 'Flexoki Dark'))

    const second = (await cdp.evaluate(ALL_THEMES)) as { rows: string }[] | null
    console.log(`  info — the terminal after the second pick: ${JSON.stringify(second)}`)
    const secondRows = second?.[0]?.rows ?? ''

    check(
      'the hidden SSH terminal follows the theme of the SFTP tab',
      secondRows !== '' && secondRows !== firstRows
    )

    // 5. the SSH tab comes back to the front and the theme is picked in
    // it — the drawer of the hidden SFTP tab must not take the click.
    await cdp.evaluate(OPEN_TAB('127.0.0.1', 0))
    await delay(1500)

    check('the third theme was picked in the SSH tab', await pickTheme(cdp, 'Kanagawa Dragon'))

    const third = (await cdp.evaluate(ALL_THEMES)) as { rows: string }[] | null
    console.log(`  info — the terminal after the third pick: ${JSON.stringify(third)}`)
    const thirdRows = third?.[0]?.rows ?? ''

    check(
      'the SSH terminal follows the theme after an SFTP session',
      thirdRows !== '' && thirdRows !== secondRows
    )

    socket.close()
  } catch (error) {
    failed += 1
    console.error('RESULT: ERROR —', error instanceof Error ? (error.stack ?? error.message) : error)
  } finally {
    console.log(`\nChecks: ${checks}, failed: ${failed}`)
    console.log(failed > 0 ? 'RESULT: FAIL' : 'RESULT: PASS')
    await cleanupApp(app, userData)
    sshd.kill('SIGTERM')
    if (failed > 0) process.exitCode = 1
  }
}

await main()
