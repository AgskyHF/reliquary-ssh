/**
 * Takes the screenshots for the README of the repository.
 *
 * Every picture is the real app: a real SSH session against the test
 * server, a real SFTP session against the test SFTP server, the key store
 * with a real generated key, the theme drawer with the real themes.
 *
 * Run: node --experimental-strip-types scripts/shoot-readme.ts [outDir]
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { attach, cleanupApp, portIsFree, startElectron, waitFor } from './lib/cdp.ts'
import { startTestSftpServer } from '../tests/helpers/test-sftp-server.ts'
import { generateUsableKeyPair } from '../tests/helpers/test-keys.ts'

const CDP_PORT = 9263
const SSH_PORT = 22231
const SFTP_PORT = 22232

const OUT = process.argv[2] ?? join(tmpdir(), 'reliquary-readme')

async function main(): Promise<void> {
  if (!(await portIsFree(CDP_PORT))) throw new Error(`CDP port ${CDP_PORT} is busy`)
  mkdirSync(OUT, { recursive: true })

  // The SSH server — a real shell session for the terminal picture.
  const sshd = spawn(
    process.execPath,
    ['--experimental-strip-types', 'scripts/test-ssh-server.ts', String(SSH_PORT)],
    { cwd: process.env.HOME + '/Projects/reliquary-ssh', stdio: ['ignore', 'pipe', 'pipe'] }
  )
  sshd.stdout?.on('data', (c: Buffer) => {
    const text = c.toString()
    if (text.includes('AUTHORIZED_PRIVATE_KEY')) {
      console.log('  the ssh server is ready')
    }
  })
  await delay(1500)

  const sftp = await startTestSftpServer(SFTP_PORT)
  writeFileSync(join(sftp.root, 'release-notes.md'), '# Release notes\n\nEverything is ready.\n', 'utf8')
  writeFileSync(join(sftp.root, 'backup-2026-11-10.tar.gz'), 'x'.repeat(2048), 'utf8')
  mkdirSync(join(sftp.root, 'screenshots'), { recursive: true })
  writeFileSync(join(sftp.root, 'screenshots', 'terminal.png'), 'y'.repeat(900), 'utf8')

  const userData = mkdtempSync(join(tmpdir(), 'reliquary-readme-'))
  let app: ChildProcess | null = null

  try {
    app = startElectron(userData, CDP_PORT)
    const { cdp, socket } = await attach(CDP_PORT)
    await waitFor(cdp, `document.querySelector('.sidebar__item')`)
    await delay(900)

    const shoot = async (name: string): Promise<void> => {
      await cdp.send('Page.enable')
      await delay(300)
      const shot = (await cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false
      })) as { data?: string }
      if (!shot?.data) throw new Error(`The screenshot ${name} came back empty`)
      const path = join(OUT, `${name}.png`)
      writeFileSync(path, Buffer.from(shot.data, 'base64'))
      console.log(`  wrote ${path}`)
    }

    // ---- the hosts of the sidebar ----
    // The names and the addresses below are made up: the pictures of the
    // README go into a public repository, and a real host of the
    // machine that takes them must never end up in one.
    const keyPair = generateUsableKeyPair()

    await cdp.evaluate(`window.reliquary.host.save({
      name: 'Home server',
      protocol: 'ssh',
      host: '192.0.2.10',
      port: 22,
      username: 'operator',
      authMethod: 'password',
      notes: 'Ubuntu, the old box'
    })`)
    await cdp.evaluate(`window.reliquary.host.save({
      name: 'VPS — Frankfurt',
      protocol: 'ssh',
      host: '198.51.100.24',
      port: 22,
      username: 'deploy',
      authMethod: 'key'
    })`)
    await cdp.evaluate(`window.reliquary.host.save({
      name: 'Backup',
      protocol: 'sftp',
      host: '192.0.2.10',
      port: 22,
      username: 'operator',
      authMethod: 'password',
      notes: 'The old files'
    })`)
    await delay(600)

    // A key in the key store, so the picture is not empty.
    await cdp.evaluate(`window.reliquary.key.import(${JSON.stringify({
      name: 'laptop-ed25519',
      privateKey: keyPair.private
    })})`)
    await delay(600)

    await cdp.send('Page.reload')
    await delay(1800)
    await waitFor(cdp, `document.querySelector('.sidebar__item')`)
    await delay(1000)

    await shoot('01-hosts')

    // ---- a live SSH session ----
    // A new tab, so the form belongs to the active pane: the panes of the
    // other tabs are hidden but still mounted, and a query would find
    // the form of a tab that is not on screen.
    await cdp.evaluate(`document.querySelector('.tab-bar__new')?.click()`)
    await delay(1200)

    await cdp.evaluate(`(() => {
      const form = document.querySelector('.tab-pane:not([hidden]) .connect-form')
      if (!form) return false
      const set = (name, value) => {
        const field = form.querySelector('[name="' + name + '"]')
        if (!field) return false
        const proto = Object.getPrototypeOf(field)
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(field, value)
        field.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      }
      const ok = [
        set('host', '127.0.0.1'),
        set('port', '${SSH_PORT}'),
        set('username', 'tester'),
        set('password', 'secret')
      ]
      return ok.every(Boolean)
    })()`)
    await delay(500)
    await cdp.evaluate(`(() => {
      const form = document.querySelector('.tab-pane:not([hidden]) .connect-form')
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      return true
    })()`)
    await delay(5000)

    // A command in the terminal, so the picture shows a live session.
    await cdp.evaluate(`(() => {
      const term = document.querySelector('.xterm-helper-textarea')
      if (!term) return false
      term.focus()
      return true
    })()`)
    for (const char of 'whoami') {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', text: char })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', text: char })
      await delay(60)
    }
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13, text: '\r'
    })
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13
    })
    await delay(1500)

    await shoot('02-terminal')

    // ---- the SFTP file manager ----
    // A new tab, and the SFTP protocol picked in the form of that tab.
    await cdp.evaluate(`document.querySelector('.tab-bar__new')?.click()`)
    await delay(1200)

    await cdp.evaluate(`(() => {
      const pane = document.querySelector('.tab-pane:not([hidden])')
      if (!pane) return false
      const sftp = Array.from(pane.querySelectorAll('.protocol-switch__option'))
        .find((b) => /SFTP/i.test(b.textContent || ''))
      sftp?.click()
      return true
    })()`)
    await delay(700)

    await cdp.evaluate(`(() => {
      const form = document.querySelector('.tab-pane:not([hidden]) .connect-form')
      if (!form) return false
      const set = (name, value) => {
        const field = form.querySelector('[name="' + name + '"]')
        if (!field) return false
        const proto = Object.getPrototypeOf(field)
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(field, value)
        field.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      }
      const ok = [
        set('host', '127.0.0.1'),
        set('port', '${SFTP_PORT}'),
        set('username', 'tester'),
        set('password', 'secret')
      ]
      return ok.every(Boolean)
    })()`)
    await delay(400)
    await cdp.evaluate(`(() => {
      const form = document.querySelector('.tab-pane:not([hidden]) .connect-form')
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      return true
    })()`)
    await delay(7000)

    const hasManager = (await cdp.evaluate(
      `Boolean(document.querySelector('.file-manager'))`
    )) as boolean
    console.log(`  info — the file manager is shown: ${hasManager}`)

    await shoot('03-sftp')

    // ---- the key store ----
    await cdp.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('.sidebar__item'))
      const item = items.find((i) => /Keychain|Keys/i.test(i.textContent || ''))
      item?.click()
      return true
    })()`)
    await delay(1200)
    await shoot('04-keychain')

    // ---- the theme drawer ----
    await cdp.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('.sidebar__item'))
      const item = items.find((i) => /Settings|Настройки/i.test(i.textContent || ''))
      item?.click()
      return true
    })()`)
    await delay(1200)
    await cdp.evaluate(`(() => {
      document.querySelector('.theme-button__toggle')?.click()
      return true
    })()`)
    await delay(1200)
    await shoot('05-themes')

    socket.close()
  } finally {
    await cleanupApp(app, userData)
    sshd.kill('SIGTERM')
    await sftp.close()
  }

  console.log(`done — the pictures are in ${OUT}`)
}

await main()
