/**
 * The geometry of the top bar of the app.
 *
 * The header carries the traffic lights of macOS, the logo and the name
 * of the app. The measure answers: how tall is the bar, where does each
 * part sit, and do they share one line.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { ChildProcess } from 'node:child_process'
import { attach, cleanupApp, portIsFree, startElectron, waitFor } from './lib/cdp.ts'

const CDP_PORT = 9269

const GEOMETRY = `(() => {
  const bar = document.querySelector('.topbar')
  if (!bar) return null
  const box = bar.getBoundingClientRect()
  const part = (selector) => {
    const el = bar.querySelector(selector)
    if (!el) return null
    const b = el.getBoundingClientRect()
    return {
      x: Math.round(b.left),
      y: Math.round(b.top),
      w: Math.round(b.width),
      h: Math.round(b.height),
      centerY: Math.round(b.top + b.height / 2)
    }
  }
  const styles = getComputedStyle(bar)
  return {
    bar: { w: Math.round(box.width), h: Math.round(box.height), y: Math.round(box.top) },
    padding: styles.padding,
    paddingLeft: styles.paddingLeft,
    logo: part('.logo'),
    title: part('.topbar__title'),
    divider: part('.topbar__divider'),
    subtitle: part('.topbar__subtitle'),
    fontTitle: getComputedStyle(bar.querySelector('.topbar__title')).fontSize,
    fontSub: getComputedStyle(bar.querySelector('.topbar__subtitle')).fontSize
  }
})()`

async function main(): Promise<void> {
  if (!(await portIsFree(CDP_PORT))) throw new Error(`CDP port ${CDP_PORT} is busy`)

  const userData = mkdtempSync(join(tmpdir(), 'reliquary-topbar-'))
  let app: ChildProcess | null = null

  try {
    app = startElectron(userData, CDP_PORT)
    const { cdp, socket } = await attach(CDP_PORT)
    await waitFor(cdp, `document.querySelector('.sidebar__item')`)
    await delay(1200)

    const geometry = (await cdp.evaluate(GEOMETRY)) as Record<string, unknown> | null
    console.log('  info — the geometry: ' + JSON.stringify(geometry, null, 2))

    // A picture of it.
    await cdp.send('Page.enable')
    const shot = (await cdp.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width: 900, height: 100, scale: 2 }
    })) as { data: string }
    const { writeFileSync } = await import('node:fs')
    writeFileSync(
      '/tmp/topbar.png',
      Buffer.from(shot.data, 'base64')
    )
    console.log('  info — the screenshot is written')

    socket.close()
  } catch (error) {
    console.error('RESULT: ERROR —', error instanceof Error ? (error.stack ?? error.message) : error)
  } finally {
    await cleanupApp(app, userData)
  }
}

await main()
