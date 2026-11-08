
/**
 * Renders the terminal in every theme of the catalogue, so the
 * differences between them can be looked at.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { spawn } from 'node:child_process'
import { attach, cleanupApp, portIsFree, startElectron, waitFor } from './lib/cdp.ts'

const CDP_PORT = 9253
const SSH_PORT = 22222
const CLIENT_KEY = '/tmp/reliquary_client_key'
const CONFIG = '/tmp/reliquary_sshd_config'

const THEMES = [
  'termius-dark',
  'termius-light',
  'flexoki-dark',
  'flexoki-light',
  'kanagawa-wave',
  'kanagawa-dragon',
  'kanagawa-lotus',
  'hacker-blue',
  'hacker-green',
  'hacker-red'
]

async function main(): Promise<void> {
  if (!(await portIsFree(CDP_PORT))) throw new Error('CDP port is busy')

  const sshd = spawn('/usr/sbin/sshd', ['-f', CONFIG, '-E', '/tmp/reliquary_sshd.log'], { stdio: 'ignore' })
  await delay(1200)

  const userData = mkdtempSync(join(tmpdir(), 'reliquary-themes-'))
  let app = null

  try {
    app = startElectron(userData, CDP_PORT)
    const { cdp, socket } = await attach(CDP_PORT)
    await waitFor(cdp, `document.querySelector('.sidebar__item')`)
    await delay(700)

    // The master password and the key.
    await cdp.evaluate(`window.reliquary.master.set('test-master-password')`)
    await delay(500)
    const fs = await import('node:fs')
    const privateKey = fs.readFileSync(CLIENT_KEY, 'utf8')
    await cdp.evaluate(`window.reliquary.key.import(${JSON.stringify({ name: 'k', privateKey })})`)
    await delay(400)
    await cdp.send('Page.reload')
    await delay(1500)
    await waitFor(cdp, `document.querySelector('.sidebar__item')`)
    await delay(800)

    // The form.
    await cdp.evaluate(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      buttons.find((b) => /^\\s*key\\s*$/i.test(b.textContent || ''))?.click()
      return true
    })()`)
    await delay(500)
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
      set('host', '127.0.0.1')
      set('port', '${SSH_PORT}')
      set('username', SSH_USER)
      return true
    })()`)
    await delay(800)

    // The list of the keys arrives after the form is mounted.
    await cdp.evaluate(`(() => {
      const select = document.querySelector('select[name="key"]')
      if (!select) return 'no-select'
      // The first option is a placeholder — the real one has a value.
      const option = Array.from(select.options).find((o) => o.value)
      if (!option) return 'no-option'
      const proto = Object.getPrototypeOf(select)
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(select, option.value)
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return 'ok'
    })()`)
    await delay(600)
    await cdp.evaluate(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      buttons.find((b) => /^\\s*(connect|подключиться)\\s*$/i.test(b.textContent || ''))?.click()
      return true
    })()`)
    await delay(6000)

    const connected = await cdp.evaluate(
      `Boolean(document.querySelector('.status-dot--ok'))`
    )
    console.log(`  the session is connected: ${connected}`)
    if (!connected) {
      const body = await cdp.evaluate(
        `document.querySelector('.terminal-panel')?.textContent?.slice(0, 300) ?? null`
      )
      console.log(`  the panel: ${JSON.stringify(body)}`)
    }

    await cdp.send('Page.enable')
    await delay(300)

    for (const [index, theme] of THEMES.entries()) {
      // The theme is picked in the drawer of the session — the way the
      // user does it. The session stays alive.
      await cdp.evaluate(`(() => {
        const drawer = document.querySelector('.theme-panel')
        if (!drawer || drawer.getBoundingClientRect().width < 100) {
          document.querySelector('.theme-button__toggle')?.click()
        }
        return true
      })()`)
      await delay(700)
      await cdp.evaluate(`(() => {
        const items = document.querySelectorAll('.theme-picker__item')
        items[${index}]?.click()
        return true
      })()`)
      await delay(1500)

      const info = await cdp.evaluate(`(() => {
        const viewport = document.querySelector('.xterm-viewport')
        const rowsEl = document.querySelector('.xterm-rows')
        const rows = rowsEl ? rowsEl.querySelectorAll('div') : []
        const marks = Array.from(rows).flatMap((r) => Array.from(r.querySelectorAll('span')))
        const colors = [...new Set(marks.map((m) => getComputedStyle(m).color))]
        return {
          bg: viewport ? getComputedStyle(viewport).backgroundColor : null,
          fg: colors[0] ?? null,
          font: rowsEl ? getComputedStyle(rowsEl).fontFamily : null,
          size: rowsEl ? getComputedStyle(rowsEl).fontSize : null
        }
      })()`)
      console.log(`${theme.padEnd(18)} ${JSON.stringify(info)}`)

      const shot = (await cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        clip: { x: 320, y: 90, width: 640, height: 300, scale: 1 }
      })) as { data?: string }
      if (shot?.data) {
        writeFileSync(`/tmp/theme-${theme}.png`, Buffer.from(shot.data, 'base64'))
      }
    }

    socket.close()
  } finally {
    await cleanupApp(app, userData)
    sshd.kill('SIGTERM')
  }
}

await main()
