/**
 * Verification harness for stage 3 (tabs & multi-session).
 *
 * Scenario (all through the real UI over CDP):
 *  1. fresh profile starts with one tab and the connect form;
 *  2. tab A connects to the test SSH server;
 *  3. "+" opens tab B, which connects to the same server —
 *     each session gets a distinct Session-Id from the server, and typed
 *     markers never cross between tabs (independent sessions);
 *  4. tab B is closed; tab A stays connected and responsive;
 *  5. the app is killed (crash simulation — only debounced saves count);
 *  6. relaunch with the same userData restores the single tab:
 *     title, buffer contents and the reconnect banner;
 *  7. the tab reconnects, the server RSTs the socket mid-session
 *     (ECONNRESET regression — the app must show the banner, not crash).
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { WebSocket } from 'ws'

const APP_DIR = `${process.env.HOME}/Projects/reliquary-ssh`
const SSH_PORT = 2223
const CDP_PORT = 9223

const ACTIVE_PANE = '.tab-pane:not([hidden])'
const results: { name: string; ok: boolean }[] = []

function check(name: string, ok: boolean): boolean {
  results.push({ name, ok })
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}`)
  return ok
}

/** JS expression: does any element match the selector. */
function exists(selector: string): string {
  return `document.querySelector(${JSON.stringify(selector)})`
}

/** JS expression: textContent of the first element matching selector. */
function paneText(selector: string): string {
  return `(document.querySelector(${JSON.stringify(selector)})?.textContent ?? '')`
}

/** JS expression: does the pane text contain the given marker. */
function paneIncludes(selector: string, marker: string): string {
  return `${paneText(selector)}.includes(${JSON.stringify(marker)})`
}

async function startSshServer(): Promise<ChildProcess> {
  const proc = spawn(
    process.execPath,
    ['--experimental-strip-types', `${APP_DIR}/scripts/test-ssh-server.ts`, String(SSH_PORT)],
    { cwd: APP_DIR, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  proc.stdout?.on('data', (chunk) => process.stdout.write(`[ssh] ${chunk}`))
  proc.stderr?.on('data', (chunk) => process.stderr.write(`[ssh] ${chunk}`))
  await delay(1500)
  return proc
}

// .bin/electron is a node shim: killing it orphans the real Electron.app
// process (it keeps the CDP port!). Launch the binary directly instead.
const ELECTRON_BIN =
  process.platform === 'darwin'
    ? join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    : join(APP_DIR, 'node_modules/.bin/electron')

function startElectron(userData: string): ChildProcess {
  const proc = spawn(
    ELECTRON_BIN,
    ['.', `--remote-debugging-port=${CDP_PORT}`],
    {
      cwd: APP_DIR,
      env: { ...process.env, RELIQUARY_USER_DATA: userData, RELIQUARY_OFFSCREEN: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  proc.stdout?.on('data', (chunk) => process.stdout.write(`[app] ${chunk}`))
  proc.stderr?.on('data', (chunk) => process.stderr.write(`[app] ${chunk}`))
  return proc
}

class CdpClient {
  private nextId = 1
  private readonly pending = new Map<number, (result: unknown) => void>()
  private readonly socket: WebSocket

  constructor(socket: WebSocket) {
    this.socket = socket
    socket.on('message', (raw: Buffer) => {
      const message = JSON.parse(raw.toString()) as { id?: number; result?: unknown }
      if (message.id && this.pending.has(message.id)) {
        this.pending.get(message.id)?.(message.result)
        this.pending.delete(message.id)
      }
    })
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression: string): Promise<unknown> {
    const result = (await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })) as { result?: { value?: unknown } }
    return result?.result?.value
  }

  async text(expression: string): Promise<string> {
    return String((await this.evaluate(expression)) ?? '')
  }
}

async function attach(): Promise<{ cdp: CdpClient; socket: WebSocket }> {
  let target: { webSocketDebuggerUrl: string } | null = null
  for (let attempt = 0; attempt < 15 && !target; attempt++) {
    await delay(1000)
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
      const targets = (await response.json()) as { title: string; webSocketDebuggerUrl: string }[]
      target = targets.find((t) => t.title.includes('ReliquarySSH')) ?? null
    } catch {
      // app not listening yet
    }
  }
  if (!target) throw new Error('Renderer target not found on CDP port')

  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  const cdp = new CdpClient(socket)
  await cdp.send('Runtime.enable')
  return { cdp, socket }
}

async function waitFor(cdp: CdpClient, expression: string, tries = 30): Promise<boolean> {
  for (let attempt = 0; attempt < tries; attempt++) {
    const value = await cdp.evaluate(`Boolean(${expression})`)
    if (value === true) return true
    await delay(500)
  }
  return false
}

async function fillActiveForm(cdp: CdpClient): Promise<boolean> {
  const filled = await cdp.evaluate(`(() => {
    const scope = ${JSON.stringify(`${ACTIVE_PANE} `)}
    const setValue = (sel, value) => {
      const input = document.querySelector(scope + sel)
      if (!input) return false
      const proto = Object.getPrototypeOf(input)
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    }
    const ok = [
      setValue('input[name="host"]', '127.0.0.1'),
      setValue('input[name="port"]', '${SSH_PORT}'),
      setValue('input[name="username"]', 'tester'),
      setValue('input[name="password"]', 'secret')
    ]
    return ok.every(Boolean)
  })()`)
  return filled === true
}

async function connectActiveTab(cdp: CdpClient): Promise<string> {
  if (!(await fillActiveForm(cdp))) throw new Error('Could not fill the active connect form')
  await cdp.evaluate(
    `document.querySelector(${JSON.stringify(`${ACTIVE_PANE} .connect-form button[type="submit"]`)}).click(), true`
  )
  const bannerSeen = await waitFor(cdp, paneIncludes(`${ACTIVE_PANE} .xterm-rows`, 'Welcome to ReliquarySSH test server'))
  if (!bannerSeen) throw new Error('Banner never appeared in the active pane')

  const text = await cdp.text(paneText(`${ACTIVE_PANE} .xterm-rows`))
  const match = /Session-Id: (\S+)/.exec(text)
  if (!match) throw new Error(`No Session-Id in banner: ${JSON.stringify(text.slice(0, 300))}`)
  return match[1] as string
}

async function typeIn(cdp: CdpClient, textareaSelector: string, text: string): Promise<void> {
  await cdp.evaluate(`document.querySelector(${JSON.stringify(textareaSelector)})?.focus(), true`)
  await cdp.send('Input.insertText', { text })
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    key: 'Enter',
    code: 'Enter',
    text: '\r',
    unmodifiedText: '\r'
  })
  await cdp.send('Input.dispatchKeyEvent', { type: 'char', text: '\r' })
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    key: 'Enter',
    code: 'Enter'
  })
}

async function portIsFree(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) })
    await response.body?.cancel()
    return false // something is listening
  } catch {
    return true
  }
}

async function main(): Promise<void> {
  if (!(await portIsFree(CDP_PORT))) throw new Error(`CDP port ${CDP_PORT} is busy — stale harness?`)
  if (!(await portIsFree(SSH_PORT))) throw new Error(`SSH test port ${SSH_PORT} is busy — stale server?`)
  const userData = mkdtempSync(join(tmpdir(), 'reliquary-stage3-'))
  const ssh = await startSshServer()
  let app: ChildProcess | null = null
  let socket: WebSocket | null = null
  let exitCode = 1
  let errored = false

  try {
    // ---------- phase 1: two tabs against one server ----------
    app = startElectron(userData)
    let session = await attach()
    let cdp = session.cdp
    socket = session.socket

    check('fresh profile shows the connect form', await waitFor(cdp, exists(`${ACTIVE_PANE} .connect-form`)))
    check(
      'fresh profile has exactly one tab',
      (await cdp.evaluate(`document.querySelectorAll('.tab-bar__tab').length`)) === 1
    )

    const sessionA = await connectActiveTab(cdp)
    const tabA = await cdp.text(`document.querySelector('.tab-bar__tab--active')?.dataset.tabId ?? ''`)
    check(
      'tab title updates to username@host',
      (await cdp.text(paneText('.tab-bar__tab--active .tab-bar__label'))).includes('tester@127.0.0.1')
    )

    await typeIn(cdp, `${ACTIVE_PANE} .xterm-helper-textarea`, 'echo MARK-ALPHA')
    check(
      'tab A shows its own marker',
      await waitFor(cdp, paneIncludes(`${ACTIVE_PANE} .xterm-rows`, 'MARK-ALPHA'))
    )

    // open tab B
    await cdp.evaluate(`document.querySelector('.tab-bar__new')?.click(), true`)
    check('second tab appears', await waitFor(cdp, `document.querySelectorAll('.tab-bar__tab').length === 2`, 10))
    check('new tab shows a fresh connect form', await waitFor(cdp, exists(`${ACTIVE_PANE} .connect-form`), 10))

    const sessionB = await connectActiveTab(cdp)
    const tabB = await cdp.text(`document.querySelector('.tab-bar__tab--active')?.dataset.tabId ?? ''`)
    check(`server sees two distinct sessions (${sessionA} vs ${sessionB})`, sessionA !== sessionB)

    await typeIn(cdp, `${ACTIVE_PANE} .xterm-helper-textarea`, 'echo MARK-BETA')
    check(
      'tab B shows its own marker',
      await waitFor(cdp, paneIncludes(`${ACTIVE_PANE} .xterm-rows`, 'MARK-BETA'))
    )
    check(
      'tab B does not contain tab A output',
      !(await cdp.text(paneText(`${ACTIVE_PANE} .xterm-rows`))).includes('MARK-ALPHA')
    )

    // back to A: its screen must still hold only its own output
    await cdp.evaluate(`document.querySelector('.tab-bar__tab[data-tab-id="${tabA}"]')?.click(), true`)
    check(
      'tab A keeps its own buffer after switching',
      await waitFor(cdp, paneIncludes(`.tab-pane[data-tab-id="${tabA}"] .xterm-rows`, 'MARK-ALPHA'))
    )
    check(
      'tab A never received tab B output',
      !(await cdp.text(paneText(`.tab-pane[data-tab-id="${tabA}"] .xterm-rows`))).includes('MARK-BETA')
    )

    // close B, A must survive
    await cdp.evaluate(
      `document.querySelector('.tab-bar__tab[data-tab-id="${tabB}"] .tab-bar__close')?.click(), true`
    )
    check('closing B leaves one tab', await waitFor(cdp, `document.querySelectorAll('.tab-bar__tab').length === 1`, 10))
    const activeAfterClose = await cdp.text(`document.querySelector('.tab-bar__tab--active')?.dataset.tabId ?? ''`)
    check('tab A becomes active again', activeAfterClose === tabA)

    await typeIn(cdp, `.tab-pane[data-tab-id="${tabA}"] .xterm-helper-textarea`, 'echo ALIVE-42')
    check(
      'tab A session survived closing tab B',
      await waitFor(cdp, paneIncludes(`.tab-pane[data-tab-id="${tabA}"] .xterm-rows`, 'ALIVE-42'))
    )

    await delay(2200) // let the debounced persistence settle
    try {
      const rawTabs = JSON.parse(readFileSync(join(userData, 'tabs.json'), 'utf8')) as {
        tabs: { title: string; buffer: string }[]
      }
      for (const t of rawTabs.tabs) {
        console.log(
          `[debug] persisted tab "${t.title}" buffer=${t.buffer.length} tail=${JSON.stringify(t.buffer.slice(-120))}`
        )
      }
    } catch (err) {
      console.log(`[debug] tabs.json unreadable: ${String(err)}`)
    }

    // ---------- phase 2: crash + relaunch ----------
    app.kill('SIGKILL')
    socket.close()
    await delay(1500)

    app = startElectron(userData)
    session = await attach()
    cdp = session.cdp
    socket = session.socket

    check('relaunch restores exactly one tab', await waitFor(cdp, `document.querySelectorAll('.tab-bar__tab').length === 1`))
    check(
      'restored tab keeps its title',
      (await cdp.text(paneText('.tab-bar__tab--active .tab-bar__label'))).includes('tester@127.0.0.1')
    )
    const bufferRestored = await waitFor(cdp, paneIncludes(`${ACTIVE_PANE} .xterm-rows`, 'ALIVE-42'))
    check('restored terminal contains the saved buffer', bufferRestored)
    if (!bufferRestored) {
      console.log(`[debug] panes: ${await cdp.text(`document.querySelectorAll('.tab-pane').length`)}`)
      console.log(
        `[debug] pane hidden flags: ${await cdp.text(`[...document.querySelectorAll('.tab-pane')].map((p) => p.hidden).join(',')`)}`
      )
      console.log(
        `[debug] active pane cls: ${await cdp.text(`document.querySelector('.tab-pane:not([hidden])')?.className ?? 'NONE'`)}`
      )
      console.log(
        `[debug] rows count: ${await cdp.text(`document.querySelectorAll('.xterm-rows').length`)}`
      )
      console.log(
        `[debug] active rows text: ${await cdp.text(`(${paneText(`${ACTIVE_PANE} .xterm-rows`)}).slice(0, 400)`)}`
      )
      console.log(
        `[debug] any rows text: ${await cdp.text(`(${paneText(`.xterm-rows`)}).slice(0, 400)`)}`
      )
    }
    check(
      'restored terminal shows the restore note',
      (await cdp.text(paneText(`${ACTIVE_PANE} .xterm-rows`))).includes('restored from previous session')
    )
    const bannerOk = await waitFor(cdp, exists('.reconnect-banner'), 10)
    check('reconnect banner is visible', bannerOk)
    if (!bannerOk) {
      console.log(
        `[debug] pane html: ${await cdp.text(`document.querySelector('.tab-pane')?.outerHTML?.slice(0, 1500) ?? 'NONE'`)}`
      )
      console.log(
        `[debug] pane text: ${await cdp.text(paneText(`${ACTIVE_PANE} .terminal-panel`))}`
      )
    }

    // ---------- phase 3: mid-session connection reset ----------
    // Reproduces the reported crash ("A JavaScript error occurred in the
    // main process — read ECONNRESET at TCP.onStreamRead"): the server RSTs
    // the socket, which is an 'error' event on the ssh2 Client *after* the
    // handshake. Without permanent listeners the app dies with a fatal dialog.
    let reconnectOk = false
    try {
      await connectActiveTab(cdp)
      reconnectOk = true
    } catch {
      // reconnect failed — reported below
    }
    check('restored tab reconnects', reconnectOk)

    if (reconnectOk) {
      await delay(500)
      ssh.kill('SIGUSR2') // force RST on every live connection
      check(
        'connection reset surfaces as reconnect banner (no crash)',
        await waitFor(cdp, exists('.reconnect-banner'), 20)
      )
    } else {
      check('connection reset surfaces as reconnect banner (no crash)', false)
    }
    check('renderer still responds after reset', (await cdp.text('document.title')).includes('ReliquarySSH'))
    check('electron main process still alive after reset', app.exitCode === null)

    exitCode = results.every((r) => r.ok) ? 0 : 1
  } catch (error) {
    errored = true
    console.error('RESULT: ERROR —', error instanceof Error ? error.stack ?? error.message : error)
    exitCode = 1
  } finally {
    const failed = results.filter((r) => !r.ok).length
    console.log(`\nChecks: ${results.length}, failed: ${failed}`)
    const ok = !errored && failed === 0 && results.length > 0
    console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL')
    socket?.close()
    app?.kill('SIGKILL')
    ssh.kill('SIGTERM')
    rmSync(userData, { recursive: true, force: true })
    await delay(500)
    process.exit(exitCode)
  }
}

void main()
