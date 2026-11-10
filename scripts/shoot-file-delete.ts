/**
 * Makes a screenshot of the file manager with the delete button and with
 * the confirmation of the deletion.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { ChildProcess } from 'node:child_process'
import { attach, cleanupApp, portIsFree, startElectron, waitFor } from './lib/cdp.ts'
import { startTestSftpServer } from '../tests/helpers/test-sftp-server.ts'

const CDP_PORT = 9259
const SFTP_PORT = 22224

async function main(): Promise<void> {
  if (!(await portIsFree(CDP_PORT))) throw new Error(`CDP port ${CDP_PORT} is busy`)

  const server = await startTestSftpServer(SFTP_PORT)
  writeFileSync(join(server.root, 'report.pdf'), 'x'.repeat(4096), 'utf8')
  writeFileSync(join(server.root, 'notes.txt'), 'hello\n', 'utf8')

  const userData = mkdtempSync(join(tmpdir(), 'reliquary-shot-'))
  let app: ChildProcess | null = null

  try {
    app = startElectron(userData, CDP_PORT)
    const { cdp, socket } = await attach(CDP_PORT)
    await waitFor(cdp, `document.querySelector('.sidebar__item')`)
    await delay(800)

    const saved = (await cdp.evaluate(`window.reliquary.host.save({
      name: 'SftpShotHost',
      protocol: 'sftp',
      host: '127.0.0.1',
      port: ${SFTP_PORT},
      username: 'tester',
      authMethod: 'password'
    })`)) as { id?: string } | null
    await cdp.evaluate(`window.reliquary.hostPassword.set({
      hostId: ${JSON.stringify(saved?.id ?? '')},
      password: 'secret'
    })`)
    await delay(400)

    await cdp.send('Page.reload')
    await delay(1800)
    await waitFor(cdp, `document.querySelector('.sidebar__item')`)
    await delay(900)

    await cdp.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('.host-list__item'))
      const item = items.find((i) =>
        (i.querySelector('.host-list__name')?.textContent || '').trim() === 'SftpShotHost'
      )
      if (!item) return false
      const box = item.getBoundingClientRect()
      item.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: Math.round(box.left + 40),
        clientY: Math.round(box.top + 10)
      }))
      return true
    })()`)
    await delay(500)
    await cdp.evaluate(`(() => {
      document.querySelector('.host-menu__item--submenu')
        ?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      return true
    })()`)
    await delay(500)
    await cdp.evaluate(`(() => {
      const columns = document.querySelectorAll('.host-menu__column')
      const items = columns.length > 1
        ? Array.from(columns[1].querySelectorAll('.host-menu__item'))
        : []
      items.find((i) => /SFTP/i.test(i.textContent || ''))?.click()
      return true
    })()`)
    await delay(6000)

    await cdp.send('Page.enable')
    await delay(300)
    const shot = (await cdp.send('Page.captureScreenshot', {
      format: 'png', fromSurface: true
    })) as { data?: string }
    if (shot?.data) {
      writeFileSync('/tmp/sftp-delete-button.png', Buffer.from(shot.data, 'base64'))
      console.log('wrote /tmp/sftp-delete-button.png')
    }

    // The confirmation of the deletion.
    await cdp.evaluate(`(() => {
      const row = Array.from(document.querySelectorAll('.file-manager__row')).find((r) =>
        (r.querySelector('.file-manager__cell--name')?.textContent || '').includes('notes.txt')
      )
      row?.querySelector('.file-manager__delete')?.click()
      return true
    })()`)
    await delay(700)

    const shot2 = (await cdp.send('Page.captureScreenshot', {
      format: 'png', fromSurface: true
    })) as { data?: string }
    if (shot2?.data) {
      writeFileSync('/tmp/sftp-delete-confirm.png', Buffer.from(shot2.data, 'base64'))
      console.log('wrote /tmp/sftp-delete-confirm.png')
    }

    socket.close()
  } finally {
    await cleanupApp(app, userData)
    await server.close()
  }
}

await main()
