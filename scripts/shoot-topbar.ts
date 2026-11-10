/**
 * A picture of the header of a real window.
 *
 * The traffic lights of macOS are drawn by the system, not by the
 * renderer — only a window shows them.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { ChildProcess } from 'node:child_process'
import { attach, cleanupApp, portIsFree, startElectron, waitFor } from './lib/cdp.ts'

const CDP_PORT = 9270

async function main(): Promise<void> {
  if (!(await portIsFree(CDP_PORT))) throw new Error(`CDP port ${CDP_PORT} is busy`)

  const userData = mkdtempSync(join(tmpdir(), 'reliquary-topbar-shot-'))
  let app: ChildProcess | null = null

  try {
    // A real window: the traffic lights of macOS are drawn by the system.
    app = startElectron(userData, CDP_PORT, { RELIQUARY_OFFSCREEN: '' })
    const { cdp, socket } = await attach(CDP_PORT)
    await waitFor(cdp, `document.querySelector('.sidebar__item')`)
    await delay(1500)

    await cdp.send('Page.enable')
    const shot = (await cdp.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width: 1280, height: 60, scale: 1.5 }
    })) as { data: string }

    writeFileSync(
      join(tmpdir(), 'reliquary-topbar2.png'),
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
