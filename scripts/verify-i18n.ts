/**
 * Verification harness for the interface language and the logo.
 *
 * Scenario (all through the real UI over CDP):
 *  1. the app starts in English;
 *  2. the Settings panel offers a language picker with English and Russian;
 *  3. picking Russian translates the interface right away;
 *  4. the language survives a restart of the app;
 *  5. the header shows the logo next to the title.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { ChildProcess } from 'node:child_process'
import {
  Checks,
  attach,
  cleanupApp,
  portIsFree,
  startElectron,
  waitFor,
  type CdpClient
} from './lib/cdp.ts'

/**
 * Stops the app but keeps the profile — the restart check needs the
 * settings the first run wrote.
 */
async function stopApp(app: ChildProcess | null): Promise<void> {
  app?.kill('SIGKILL')
  await delay(1000)
}

const CDP_PORT = 9241

const checks = new Checks()

/** Reads the visible text of the sidebar and the top bar. */
async function shellText(cdp: CdpClient): Promise<string> {
  return cdp.text(`(() => {
    const top = document.querySelector('.topbar')?.textContent ?? ''
    const nav = Array.from(document.querySelectorAll('.sidebar__item'))
      .map((i) => i.textContent ?? '')
      .join(' ')
    return top + ' | ' + nav
  })()`)
}

/** Opens the Settings section of the sidebar. */
async function openSettings(cdp: CdpClient): Promise<void> {
  await cdp.evaluate(
    `(() => {
      const items = Array.from(document.querySelectorAll('.sidebar__item'))
      const last = items[items.length - 1]
      last?.click()
      return true
    })()`
  )
  await delay(400)
}

/** Picks a language in the language selector. */
async function pickLanguage(cdp: CdpClient, value: string): Promise<boolean> {
  const ok = await cdp.evaluate(`(() => {
    const select = document.querySelector('select[name="language"]')
    if (!select) return false
    const proto = Object.getPrototypeOf(select)
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(select, ${JSON.stringify(value)})
    select.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  return ok === true
}

/** The language the app is currently showing. */
async function currentLanguage(cdp: CdpClient): Promise<string> {
  return cdp.text(`document.querySelector('select[name="language"]')?.value ?? ''`)
}

async function run(cdp: CdpClient): Promise<void> {
  // 1. The app starts in English.
  await waitFor(cdp, `document.querySelector('.sidebar__item')`)
  const english = await shellText(cdp)
  checks.check('the interface starts in English', english.includes('Hosts'))
  checks.check('the subtitle is English', english.includes('terminal client'))

  // 2. The logo is in the header, next to the title.
  const logo = await cdp.evaluate(`(() => {
    const svg = document.querySelector('.topbar__brand .logo')
    if (!svg) return null
    const box = svg.getBoundingClientRect()
    return { width: Math.round(box.width), height: Math.round(box.height) }
  })()`)
  checks.check(
    'the header shows the logo',
    typeof logo === 'object' && logo !== null && (logo as { width: number }).width >= 16
  )

  // 3. The settings offer a language picker with both languages.
  await openSettings(cdp)
  const options = await cdp.text(
    `Array.from(document.querySelectorAll('select[name="language"] option'))
      .map((o) => o.value)
      .join(',')`
  )
  checks.check('the language picker offers English and Russian', options === 'en,ru')

  // 4. Picking Russian translates the interface.
  const picked = await pickLanguage(cdp, 'ru')
  checks.check('the language can be picked', picked)
  await delay(600)

  const russian = await shellText(cdp)
  checks.check('the interface is in Russian', russian.includes('Хосты'))
  checks.check('the subtitle is translated', russian.includes('терминальный клиент'))
  checks.check(
    'the language picker shows the picked language',
    (await currentLanguage(cdp)) === 'ru'
  )

  // 5. The language is stored as a device setting.
  const stored = await cdp.evaluate(
    `window.reliquary.settings.get().then((s) => s.language)`
  )
  checks.check('the language is stored in the settings', stored === 'ru')
}

async function main(): Promise<void> {
  if (!(await portIsFree(CDP_PORT))) throw new Error(`CDP port ${CDP_PORT} is busy`)

  const userData = mkdtempSync(join(tmpdir(), 'reliquary-i18n-'))

  let app: ChildProcess | null = null
  try {
    app = startElectron(userData, CDP_PORT)
    const { cdp, socket } = await attach(CDP_PORT)

    await run(cdp)

    socket.close()
    await stopApp(app)
    app = null

    // Restart with the same profile — the language must still be Russian.
    app = startElectron(userData, CDP_PORT)
    const second = await attach(CDP_PORT)
    await waitFor(second.cdp, `document.querySelector('.sidebar__item')`)
    await delay(800)

    const afterRestart = await shellText(second.cdp)
    checks.check('the language survives a restart', afterRestart.includes('Хосты'))

    second.socket.close()
  } finally {
    await cleanupApp(app, userData)
  }

  console.log(`\n${checks.total - checks.failed}/${checks.total} checks passed`)
  if (!checks.allPassed) process.exitCode = 1
}

await main()
