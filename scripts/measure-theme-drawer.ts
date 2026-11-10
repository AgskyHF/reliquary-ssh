/**
 * The geometry of the theme drawer.
 *
 * The drawer is a column of its own — the terminal gets narrower while
 * it slides out. The measure answers: how wide is it, how tall is the
 * list, and how much of the column stays empty.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { ChildProcess } from 'node:child_process'
import { attach, cleanupApp, portIsFree, startElectron, waitFor } from './lib/cdp.ts'


// The name of the local user the test sshd accepts. It is the
// system user of this machine — it must not be written down here,
// the pictures and the logs of the harnesses travel to a public
// repository.
const SSH_USER = process.env.USER ?? 'tester'

const CDP_PORT = 9265
const SSH_PORT = 22222
const CLIENT_KEY = '/tmp/reliquary_client_key'

const OPEN_DRAWER = `(() => {
  const pane = document.querySelector('.tab-pane:not([hidden])')
  const button = pane?.querySelector('.theme-button__toggle')
  if (!button) return false
  button.click()
  return true
})()`

const GEOMETRY = `(() => {
  const panel = document.querySelector('.theme-panel--open')
  if (!panel) return null
  const body = panel.querySelector('.theme-panel__body')
  const picker = panel.querySelector('.theme-picker')
  const item = panel.querySelector('.theme-picker__item')
  const panelBox = panel.getBoundingClientRect()
  const bodyBox = body.getBoundingClientRect()
  const pickerBox = picker.getBoundingClientRect()
  const itemBox = item.getBoundingClientRect()
  return {
    panel: { w: panelBox.width, h: panelBox.height },
    body: { h: bodyBox.height, scrollH: body.scrollHeight, scrollTop: body.scrollTop },
    picker: { h: pickerBox.height, scrollH: picker.scrollHeight },
    item: { w: itemBox.width, h: itemBox.height },
    items: panel.querySelectorAll('.theme-picker__item').length,
    emptyBelow: panelBox.bottom - pickerBox.bottom,
    window: { w: innerWidth, h: innerHeight }
  }
})()`

async function main(): Promise<void> {
  if (!(await portIsFree(CDP_PORT))) throw new Error(`CDP port ${CDP_PORT} is busy`)

  const userData = mkdtempSync(join(tmpdir(), 'reliquary-geom-'))
  let app: ChildProcess | null = null

  try {
    app = startElectron(userData, CDP_PORT)
    const { cdp, socket } = await attach(CDP_PORT)
    await waitFor(cdp, `document.querySelector('.sidebar__item')`)
    await delay(900)

    // A session, so the drawer has a tab to live in.
    await cdp.evaluate(`window.reliquary.master.set('test-master-password')`)
    await delay(300)
    const privateKey = (await import('node:fs')).readFileSync(CLIENT_KEY, 'utf8')
    const imported = (await cdp.evaluate(
      `window.reliquary.key.import(${JSON.stringify({ name: 'k', privateKey })})`
    )) as { id?: string } | null

    await cdp.evaluate(`window.reliquary.host.save({
      name: 'TestHost',
      protocol: 'ssh',
      host: '127.0.0.1',
      port: ${SSH_PORT},
      username: ${JSON.stringify(SSH_USER)},
      authMethod: 'key',
      keyId: ${JSON.stringify(imported?.id ?? null)}
    })`)
    await delay(500)
    await cdp.send('Page.reload')
    await delay(1800)
    await waitFor(cdp, `document.querySelector('.sidebar__item')`)
    await delay(800)

    await cdp.evaluate(`(() => {
      const item = Array.from(document.querySelectorAll('.host-list__item'))
        .find((i) => (i.querySelector('.host-list__name')?.textContent || '').trim() === 'TestHost')
      item?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      return true
    })()`)
    await delay(3500)

    await cdp.evaluate(OPEN_DRAWER)
    await delay(900)

    const geometry = (await cdp.evaluate(GEOMETRY)) as Record<string, unknown> | null
    console.log('  info — the geometry: ' + JSON.stringify(geometry, null, 2))

    // The window gets smaller — the drawer has to scroll and stay inside.
    for (const [w, h] of [[1100, 700], [900, 600], [760, 520]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: w,
        height: h,
        deviceScaleFactor: 1,
        mobile: false
      })
      await delay(700)

      const small = (await cdp.evaluate(GEOMETRY)) as Record<string, unknown> | null
      const panel = small?.panel as { w: number; h: number } | undefined
      const picker = small?.picker as { h: number; scrollH: number } | undefined

      console.log(`  info — ${w}x${h}: ${JSON.stringify(small)}`)

      // The drawer is inside the window.
      console.log(
        `  ${panel && panel.h <= h ? 'ok' : 'FAIL'} — the drawer fits the window (${panel?.h} <= ${h})`
      )
      // The list scrolls instead of being cut off.
      console.log(
        `  ${picker && picker.scrollH > picker.h ? 'ok' : 'FAIL'} — the list scrolls (${picker?.scrollH} > ${picker?.h})`
      )

      // The card fills the drawer — no empty band under it.
      const empty = small?.emptyBelow as number | undefined
      console.log(
        `  ${empty !== undefined && empty >= -8 ? 'ok' : 'FAIL'} — no empty band under the card (${empty})`
      )
    }

    await cdp.send('Emulation.clearDeviceMetricsOverride')
    await delay(500)

    // The wheel scrolls the list, and the page stays where it is.
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 900,
      height: 600,
      deviceScaleFactor: 1,
      mobile: false
    })
    await delay(600)

    const before = (await cdp.evaluate(`(() => {
      const body = document.querySelector('.theme-picker')
      return JSON.stringify({
        scrollTop: body.scrollTop,
        pageScroll: document.documentElement.scrollTop
      })
    })()`)) as string

    // The wheel over the list.
    const point = (await cdp.evaluate(`(() => {
      const body = document.querySelector('.theme-picker')
      const box = body.getBoundingClientRect()
      return JSON.stringify({ x: Math.round(box.left + box.width / 2), y: Math.round(box.top + 40) })
    })()`)) as string
    const { x, y } = JSON.parse(point) as { x: number; y: number }

    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x,
      y,
      deltaX: 0,
      deltaY: 300
    })
    await delay(600)

    const after = (await cdp.evaluate(`(() => {
      const body = document.querySelector('.theme-picker')
      return JSON.stringify({
        scrollTop: body.scrollTop,
        pageScroll: document.documentElement.scrollTop
      })
    })()`)) as string

    console.log(`  info — the wheel: before ${before}, after ${after}`)

    const parsed = JSON.parse(after) as { scrollTop: number; pageScroll: number }
    console.log(`  ${parsed.scrollTop > 0 ? 'ok' : 'FAIL'} — the wheel scrolls the list (${parsed.scrollTop})`)
    console.log(`  ${parsed.pageScroll === 0 ? 'ok' : 'FAIL'} — the page does not scroll (${parsed.pageScroll})`)

    await cdp.send('Emulation.clearDeviceMetricsOverride')
    await delay(400)

    socket.close()
  } catch (error) {
    console.error('RESULT: ERROR —', error instanceof Error ? (error.stack ?? error.message) : error)
  } finally {
    await cleanupApp(app, userData)
  }
}

await main()
