/**
 * Takes a screenshot of the running app — used to check the look of the
 * interface (the header logo, the panels) without a visible window.
 *
 * Run: node --experimental-strip-types scripts/shoot-ui.ts [english|russian]
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { ChildProcess } from 'node:child_process'
import { attach, cleanupApp, portIsFree, startElectron, waitFor } from './lib/cdp.ts'

const CDP_PORT = 9243
const LANG = process.argv[2] === 'russian' ? 'ru' : 'en'
const OUT = process.argv[3] ?? join(tmpdir(), `reliquary-${LANG}.png`)

async function main(): Promise<void> {
  if (!(await portIsFree(CDP_PORT))) throw new Error(`CDP port ${CDP_PORT} is busy`)

  const userData = mkdtempSync(join(tmpdir(), 'reliquary-shot-'))
  let app: ChildProcess | null = null

  try {
    app = startElectron(userData, CDP_PORT)
    const { cdp, socket } = await attach(CDP_PORT)
    await waitFor(cdp, `document.querySelector('.sidebar__item')`)

    if (LANG === 'ru') {
      await cdp.evaluate(`(() => {
        const items = Array.from(document.querySelectorAll('.sidebar__item'))
        items[items.length - 1]?.click()
        return true
      })()`)
      await delay(400)
      await cdp.evaluate(`(() => {
        const select = document.querySelector('select[name="language"]')
        const proto = Object.getPrototypeOf(select)
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(select, 'ru')
        select.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`)
      await delay(800)
    }

    await cdp.send('Page.enable')
    await delay(300)
    // The CDP client unwraps the protocol envelope already.
    // The optional clip cuts out a part of the interface — used to look
    // at the header closely.
    const clip = process.argv[4]
    const box = clip
      ? (JSON.parse(clip) as { x: number; y: number; width: number; height: number })
      : undefined

    const shot = (await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
      ...(box ? { clip: { ...box, scale: 6 } } : {})
    })) as { data?: string }
    const data = shot?.data
    if (!data) {
      throw new Error(`The screenshot came back empty: ${JSON.stringify(shot).slice(0, 200)}`)
    }
    writeFileSync(OUT, Buffer.from(data, 'base64'))
    console.log(`wrote ${OUT}`)

    socket.close()
  } finally {
    await cleanupApp(app, userData)
  }
}

await main()
