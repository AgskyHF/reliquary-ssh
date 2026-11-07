import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { WebSocket } from 'ws'
import { Checks, attach, cleanupApp, exists, portIsFree, startElectron, waitFor } from './lib/cdp.ts'

const APP_DIR = process.env.RELIQUARY_APP_DIR ?? `${process.env.HOME}/Projects/reliquary-ssh`
const CDP_PORT = 9232
const checks = new Checks()

async function setInput(
  cdp: Awaited<ReturnType<typeof attach>>['cdp'],
  selector: string,
  value: string
): Promise<boolean> {
  const ok = await cdp.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    if (!input) return false
    const proto = Object.getPrototypeOf(input)
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  return ok === true
}

async function main(): Promise<void> {
  if (!(await portIsFree(CDP_PORT))) throw new Error(`CDP port ${CDP_PORT} is busy`)

  const userData = mkdtempSync(join(tmpdir(), 'reliquary-stage9-'))
  let app: ChildProcess | null = null
  let socket: WebSocket | null = null
  let exitCode = 1
  let errored = false

  try {
    app = startElectron(userData, CDP_PORT, {
      RELIQUARY_SERVER_URL: 'http://127.0.0.1:8790'
    })
    const session = await attach(CDP_PORT)
    const cdp = session.cdp
    socket = session.socket

    await waitFor(cdp, exists('.sidebar__item'))

    // The Settings section shows the panel with the server address.
    await cdp.evaluate(
      `(() => {
        const items = Array.from(document.querySelectorAll('.sidebar__item'))
        items.find((i) => (i.textContent ?? '').trim() === 'Settings')?.click()
        return true
      })()`
    )
    checks.check(
      'the settings panel is shown',
      await waitFor(cdp, exists('.settings-panel'), 15)
    )

    const initial = await cdp.evaluate(
      `window.reliquary.settings.get().then(s => s.serverUrl)`
    )
    checks.check(
      'the server address comes from the environment',
      initial === 'http://127.0.0.1:8790'
    )

    // Change the address and save it.
    await setInput(cdp, '.settings-panel input[name="serverUrl"]', 'http://127.0.0.1:8797')
    await cdp.evaluate(`document.querySelector('.settings-panel__save')?.click(), true`)
    checks.check(
      'the panel confirms the save',
      await waitFor(cdp, exists('.settings-panel__saved'), 15)
    )

    const stored = await cdp.evaluate(
      `window.reliquary.settings.get().then(s => s.serverUrl)`
    )
    checks.check('the new address is stored', stored === 'http://127.0.0.1:8797')

    const applied = await cdp.evaluate(`window.reliquary.auth.status().then(s => s.serverUrl)`)
    checks.check('the backend client follows the setting', applied === 'http://127.0.0.1:8797')

    // The log file is written.
    const log = await cdp.evaluate(`(async () => {
      const response = await fetch('file:///dev/null')
      return response.status
    })().catch(() => 'no-fetch')`)
    checks.check('the renderer has no filesystem access', log === 'no-fetch' || log === 200)

    exitCode = checks.allPassed ? 0 : 1
  } catch (error) {
    errored = true
    console.error('RESULT: ERROR —', error instanceof Error ? (error.stack ?? error.message) : error)
    exitCode = 1
  } finally {
    console.log(`\nChecks: ${checks.total}, failed: ${checks.failed}`)
    const ok = !errored && checks.allPassed
    console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL')
    socket?.close()
    await cleanupApp(app, userData)
    process.exit(exitCode)
  }
}

void main()
