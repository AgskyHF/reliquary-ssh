/**
 * The theme of the installed app, on the data of the user.
 *
 * The app that is installed is started with a debug port, and the tabs
 * are opened the way the user opens them: a click on the host in the
 * sidebar. The theme is picked in the drawer of the tab.
 */
import { setTimeout as delay } from 'node:timers/promises'
import { attach } from './lib/cdp.ts'

const CDP_PORT = 9262

let checks = 0
let failed = 0

function check(name: string, ok: boolean): void {
  checks += 1
  console.log(`  ${ok ? 'ok' : 'FAIL'} — ${name}`)
  if (!ok) failed += 1
}

/** The colours of every terminal, as xterm painted them. */
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

const FIND_THEME = (name: string): string => `(() => {
  const pane = document.querySelector('.tab-pane:not([hidden])')
  if (!pane) return null
  const item = Array.from(pane.querySelectorAll('.theme-picker__item'))
    .find((i) => (i.querySelector('.theme-picker__name')?.textContent || '').trim() === ${JSON.stringify(name)})
  if (!item) return null
  const box = item.getBoundingClientRect()
  return JSON.stringify({ x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) })
})()`

const OPEN_DRAWER = `(() => {
  const pane = document.querySelector('.tab-pane:not([hidden])')
  const button = pane?.querySelector('.theme-button__toggle')
  if (!button) return false
  button.click()
  return true
})()`

async function clickAt(
  cdp: { send: (method: string, params?: Record<string, unknown>) => Promise<unknown> },
  x: number,
  y: number
): Promise<void> {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', clickCount: 1
  })
  await delay(120)
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button: 'left', clickCount: 1
  })
}

async function pickTheme(
  cdp: {
    send: (method: string, params?: Record<string, unknown>) => Promise<unknown>
    evaluate: (expression: string) => Promise<unknown>
  },
  name: string
): Promise<boolean> {
  await cdp.evaluate(OPEN_DRAWER)
  await delay(700)
  const state = await cdp.evaluate(`(() => {
    const pane = document.querySelector('.tab-pane:not([hidden])')
    const panels = Array.from(document.querySelectorAll('.theme-panel')).map((p) => p.classList.contains('theme-panel--open'))
    const items = Array.from(pane?.querySelectorAll('.theme-picker__item') ?? []).map((i) => (i.querySelector('.theme-picker__name')?.textContent || '').trim())
    const button = pane?.querySelector('.theme-button__toggle')
    return JSON.stringify({ panels, items, button: Boolean(button), paneClass: pane?.className })
  })()`)
  console.log('  info — the drawer: ' + state)
  const point = await cdp.evaluate(FIND_THEME(name))
  if (typeof point !== 'string') return false
  const { x, y } = JSON.parse(point) as { x: number; y: number }
  await clickAt(cdp, x, y)
  await delay(1400)
  return true
}

async function main(): Promise<void> {
  const { cdp, socket } = await attach(CDP_PORT)

  // The hosts of the user.
  const hosts = (await cdp.evaluate(`(async () => {
    const list = await window.reliquary.host.list()
    return list.map((h) => ({ id: h.id, name: h.name, protocol: h.protocol, host: h.host, port: h.port, username: h.username }))
  })()`)) as { id: string; name: string; protocol: string; host: string; port: number; username: string }[]
  console.log(`  info — the hosts: ${JSON.stringify(hosts.map((h) => h.name))}`)

  if (hosts.length === 0) throw new Error('The user has no hosts')

  // The first host opens in a tab — the way the user opens it.
  await cdp.evaluate(`(() => {
    const item = Array.from(document.querySelectorAll('.host-list__item'))
      .find((i) => (i.querySelector('.host-list__name')?.textContent || '').trim() === ${JSON.stringify(hosts[0]!.name)})
    item?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    return true
  })()`)
  await delay(6000)

  const terminals = (await cdp.evaluate(`document.querySelectorAll('.tab-pane .xterm').length`)) as number
  console.log(`  info — the terminals: ${terminals}`)

  // The theme is picked in the tab that is on the screen.
  check('the theme was picked', await pickTheme(cdp, 'Termius Dark'))

  const first = (await cdp.evaluate(ALL_THEMES)) as { rows: string }[] | null
  console.log(`  info — after the first pick: ${JSON.stringify(first)}`)

  // A second tab opens — the SFTP one of the second host, if there is one.
  await cdp.evaluate(`document.querySelector('.tab-bar__new')?.click(), true`)
  await delay(1200)

  const protocols = (await cdp.evaluate(`(() => {
    const pane = document.querySelector('.tab-pane:not([hidden])')
    return JSON.stringify(Array.from(pane?.querySelectorAll('.protocol-switch__option') ?? []).map((o) => (o.textContent || '').trim()))
  })()`)) as string
  console.log(`  info — the protocols: ${protocols}`)

  // The tab of the first host comes back to the front.
  await cdp.evaluate(`(() => {
    const tabs = Array.from(document.querySelectorAll('.tab-bar__tab'))
    const tab = tabs.find((t) => (t.textContent || '').includes(${JSON.stringify(hosts[0]!.host)}))
    tab?.click()
    return true
  })()`)
  await delay(1500)

  // The theme is picked again — with the second tab in the way.
  check('the theme was picked again', await pickTheme(cdp, 'Termius Light'))

  const second = (await cdp.evaluate(ALL_THEMES)) as { rows: string }[] | null
  console.log(`  info — after the second pick: ${JSON.stringify(second)}`)

  const firstRows = first?.[0]?.rows ?? ''
  const secondRows = second?.[0]?.rows ?? ''
  check(
    'the terminal took the new theme with a second tab open',
    secondRows !== '' && secondRows !== firstRows
  )

  socket.close()
}

try {
  await main()
} catch (error) {
  failed += 1
  console.error('RESULT: ERROR —', error instanceof Error ? (error.stack ?? error.message) : error)
} finally {
  console.log(`\nChecks: ${checks}, failed: ${failed}`)
  console.log(failed > 0 ? 'RESULT: FAIL' : 'RESULT: PASS')
  if (failed > 0) process.exitCode = 1
}
