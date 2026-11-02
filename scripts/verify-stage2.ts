/**
 * Verification harness for stage 2.
 *
 * Starts the test SSH server, launches the built Electron app, then drives the
 * real UI through the DevTools protocol: fills the connect form, submits it and
 * reads the xterm buffer back out. This proves the whole chain
 * (renderer -> IPC -> main -> ssh2 -> remote shell -> renderer).
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { WebSocket } from 'ws'

const APP_DIR = `${process.env.HOME}/Projects/reliquary-ssh`
const SSH_PORT = 2222
const CDP_PORT = 9222

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

async function startElectron(userData: string): Promise<ChildProcess> {
  // Launch the real binary, not the node shim — kill must take the app down.
  const bin =
    process.platform === 'darwin'
      ? join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
      : join(APP_DIR, 'node_modules/.bin/electron')
  const proc = spawn(bin, ['.', '--remote-debugging-port=9222'], {
    cwd: APP_DIR,
    env: { ...process.env, RELIQUARY_USER_DATA: userData, RELIQUARY_OFFSCREEN: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  proc.stdout?.on('data', (chunk) => process.stdout.write(`[app] ${chunk}`))
  proc.stderr?.on('data', (chunk) => process.stderr.write(`[app] ${chunk}`))
  await delay(4000)
  return proc
}

interface CdpTarget {
  webSocketDebuggerUrl: string
  title: string
}

async function findRendererTarget(): Promise<CdpTarget> {
  const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
  const targets = (await response.json()) as CdpTarget[]
  console.log(`[cdp] targets: ${JSON.stringify(targets, null, 2)}`)
  const renderer = targets.find((target) => target.title.includes('ReliquarySSH'))
  if (!renderer) throw new Error(`Renderer target not found: ${JSON.stringify(targets)}`)
  return renderer
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
}

async function main(): Promise<void> {
  const userData = mkdtempSync(join(tmpdir(), 'reliquary-stage2-'))
  const ssh = await startSshServer()
  const app = await startElectron(userData)

  let exitCode = 1

  try {
    const target = await findRendererTarget()
    console.log(`[cdp] renderer target: ${target.title}`)

    const socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })

    const cdp = new CdpClient(socket)
    await cdp.send('Runtime.enable')
    await cdp.send('Log.enable')

    socket.on('message', (raw: Buffer) => {
      const message = JSON.parse(raw.toString()) as {
        method?: string
        params?: {
          entry?: { text?: string; level?: string }
          exceptionDetails?: { text?: string; exception?: { description?: string } }
          args?: { value?: unknown }[]
        }
      }
      if (message.method === 'Runtime.consoleAPICalled') {
        const args = (message.params as { args?: { value?: unknown }[] })?.args ?? []
        console.log(`[console] ${args.map((a) => String(a.value)).join(' ')}`)
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params?.exceptionDetails
        console.log(`[exception] ${details?.exception?.description ?? details?.text ?? 'unknown'}`)
      }
      if (message.method === 'Log.entryAdded') {
        console.log(`[log:${message.params?.entry?.level}] ${message.params?.entry?.text}`)
      }
    })

    // 1. The connect form must be visible.
    const debugState = await cdp.evaluate(`(() => ({
      scripts: [...document.querySelectorAll('script')].map((s) => s.src),
      rootHtml: document.getElementById('root')?.innerHTML ?? null,
      readyState: document.readyState
    }))()`)
    console.log(`[debug] ${JSON.stringify(debugState, null, 2)}`)

    const formVisible = await cdp.evaluate(
      `Boolean(document.querySelector('.connect-form'))`
    )
    console.log(`[check] connect form present: ${formVisible}`)
    if (!formVisible) {
      const debug = await cdp.evaluate(`(() => ({
        root: document.getElementById('root')?.innerHTML?.slice(0, 400) ?? null,
        bodyText: document.body.innerText.slice(0, 400),
        title: document.title
      }))()`)
      console.log(`[debug] ${JSON.stringify(debug, null, 2)}`)
      throw new Error('Connect form not rendered')
    }

    // 2. Fill the form with React-compatible value setters.
    const filled = await cdp.evaluate(`(() => {
      const setValue = (selector, value) => {
        const input = document.querySelector(selector)
        if (!input) return false
        const proto = Object.getPrototypeOf(input)
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
        setter.call(input, value)
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
    console.log(`[check] form filled: ${filled}`)
    if (!filled) throw new Error('Could not fill the connect form')

    // 3. Submit the form.
    await cdp.evaluate(
      `document.querySelector('.connect-form button[type="submit"]').click(), true`
    )
    console.log('[action] submitted connect form')

    // 4. Wait for the terminal to render the remote banner.
    let banner = ''
    for (let attempt = 0; attempt < 20; attempt++) {
      await delay(500)
      banner = (await cdp.evaluate(
        `document.querySelector('.xterm-rows')?.innerText ?? ''`
      )) as string
      if (banner.includes('Welcome to ReliquarySSH test server')) break
    }
    console.log(`[check] terminal banner: ${banner ? 'received' : 'MISSING'}`)
    if (!banner.includes('Welcome to ReliquarySSH test server')) {
      console.log(`[check] terminal content was: ${JSON.stringify(banner)}`)
      throw new Error('Remote banner never reached the terminal')
    }

    // 5. Type a command and check the remote echo comes back.
    // xterm reads text from the textarea's 'input' event, so the real CDP
    // input commands are used here — synthetic KeyboardEvents do not reach it.
    await cdp.evaluate(`(() => {
      document.querySelector('.xterm-helper-textarea')?.focus()
      return true
    })()`)
    await cdp.send('Input.insertText', { text: 'whoami' })
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
      key: 'Enter',
      code: 'Enter',
      text: '\r',
      unmodifiedText: '\r'
    })
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'char',
      text: '\r'
    })
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
      key: 'Enter',
      code: 'Enter'
    })
    console.log('[action] typed whoami command')

    // xterm.js does not echo locally, so the presence of "tester" in the
    // buffer can only come from the remote shell's answer to "whoami".
    let echoed = ''
    const ANSWER = 'tester'
    for (let attempt = 0; attempt < 15; attempt++) {
      await delay(400)
      echoed = (await cdp.evaluate(
        `document.querySelector('.xterm-rows')?.innerText ?? ''`
      )) as string
      if (echoed.includes(ANSWER)) break
    }
    const occurrences = echoed.split(ANSWER).length - 1
    console.log(
      `[check] remote answer: ${occurrences >= 1 ? 'received' : 'MISSING'} (occurrences: ${occurrences})`
    )
    console.log(`[check] terminal buffer: ${JSON.stringify(echoed.slice(-200))}`)

    // 6. Connection status must be "connected".
    const status = await cdp.evaluate(
      `document.querySelector('.terminal-panel__header .status-dot')?.className ?? ''`
    )
    console.log(`[check] status class: ${status}`)

    const ok =
      banner.includes('Welcome to ReliquarySSH test server') &&
      occurrences >= 1 &&
      String(status).includes('status-dot--ok')

    console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL')
    exitCode = ok ? 0 : 1
  } catch (error) {
    console.error('RESULT: ERROR —', error instanceof Error ? error.message : error)
  } finally {
    app.kill('SIGTERM')
    ssh.kill('SIGTERM')
    rmSync(userData, { recursive: true, force: true })
    await delay(500)
    process.exit(exitCode)
  }
}

void main()
