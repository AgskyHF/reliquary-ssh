/**
 * Verification harness for the deletion of a remote file.
 *
 * Scenario (all through the real UI over CDP):
 *  1. a real SFTP session is opened against the test SFTP server;
 *  2. the file manager lists the directory — the files are there;
 *  3. the delete button asks before it deletes — the question is in the
 *     language of the interface, not a system dialog;
 *  4. cancelling the question leaves the file alone;
 *  5. confirming removes the file from the server — the listing shows it
 *     is gone, which is the consequence, not the label of the button.
 */
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { ChildProcess } from 'node:child_process'
import { attach, cleanupApp, portIsFree, startElectron, waitFor } from './lib/cdp.ts'
import { startTestSftpServer } from '../tests/helpers/test-sftp-server.ts'

const CDP_PORT = 9258
const SFTP_PORT = 22223

let checks = 0
let failed = 0

function check(name: string, ok: boolean): void {
  checks += 1
  if (ok) {
    console.log(`  ok — ${name}`)
  } else {
    failed += 1
    console.log(`  FAIL — ${name}`)
  }
}

async function main(): Promise<void> {
  if (!(await portIsFree(CDP_PORT))) throw new Error(`CDP port ${CDP_PORT} is busy`)

  const server = await startTestSftpServer(SFTP_PORT)
  const target = join(server.root, 'doomed.txt')
  writeFileSync(target, 'goodbye\n', 'utf8')
  writeFileSync(join(server.root, 'keeper.txt'), 'stay\n', 'utf8')
  mkdirSync(join(server.root, 'doomed-dir'), { recursive: true })
  writeFileSync(join(server.root, 'doomed-dir', 'inner.txt'), 'inner\n', 'utf8')

  const userData = mkdtempSync(join(tmpdir(), 'reliquary-delete-'))
  let app: ChildProcess | null = null

  try {
    app = startElectron(userData, CDP_PORT)
    const { cdp, socket } = await attach(CDP_PORT)
    await waitFor(cdp, `document.querySelector('.sidebar__item')`)
    await delay(800)

    // A host with the SFTP protocol, pointing at the test server.
    const saved = (await cdp.evaluate(`window.reliquary.host.save({
      name: 'SftpDeleteHost',
      protocol: 'sftp',
      host: '127.0.0.1',
      port: ${SFTP_PORT},
      username: 'tester',
      authMethod: 'password'
    })`)) as { id?: string } | null
    check('the host was saved', Boolean(saved?.id))

    // The password of the host is stored encrypted — it is put in through
    // the same API the connect form uses.
    await cdp.evaluate(`window.reliquary.hostPassword.set({
      hostId: ${JSON.stringify(saved?.id ?? '')},
      password: 'secret'
    })`)
    await delay(400)

    await cdp.send('Page.reload')
    await delay(1800)
    await waitFor(cdp, `document.querySelector('.sidebar__item')`)
    await delay(900)

    // Open the SFTP session through the context menu of the host.
    await cdp.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('.host-list__item'))
      const item = items.find((i) =>
        (i.querySelector('.host-list__name')?.textContent || '').trim() === 'SftpDeleteHost'
      )
      if (!item) return false
      const box = item.getBoundingClientRect()
      item.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: Math.round(box.left + 40),
        clientY: Math.round(box.top + 10)
      }))
      return true
    })()`)
    await delay(500)
    await cdp.evaluate(`(() => {
      const submenu = document.querySelector('.host-menu__item--submenu')
      submenu?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      return true
    })()`)
    await delay(500)
    await cdp.evaluate(`(() => {
      const columns = document.querySelectorAll('.host-menu__column')
      const items = columns.length > 1
        ? Array.from(columns[1].querySelectorAll('.host-menu__item'))
        : []
      const sftp = items.find((i) => /SFTP/i.test(i.textContent || ''))
      sftp?.click()
      return true
    })()`)
    await delay(6000)

    // The file manager is up and the files are listed.
    const listed = (await cdp.evaluate(`(() => {
      const manager = document.querySelector('.file-manager')
      if (!manager) return null
      const names = Array.from(document.querySelectorAll('.file-manager__cell--name'))
        .map((n) => (n.textContent || '').trim())
      return {
        names,
        hasDelete: Boolean(document.querySelector('.file-manager__delete'))
      }
    })()`)) as { names: string[]; hasDelete: boolean } | null
    console.log(`  info — the listing: ${JSON.stringify(listed?.names)}`)
    check('the file manager is shown', listed !== null)
    check('the file is listed', (listed?.names ?? []).some((n) => n.includes('doomed.txt')))
    check('the delete button is there', listed?.hasDelete === true)

    // The question comes in the language of the interface — a system
    // dialog would not be translated.
    await cdp.evaluate(`(() => {
      const rows = Array.from(document.querySelectorAll('.file-manager__row'))
      const row = rows.find((r) =>
        (r.querySelector('.file-manager__cell--name')?.textContent || '').includes('doomed.txt')
      )
      row?.querySelector('.file-manager__delete')?.click()
      return true
    })()`)
    await delay(600)

    const question = (await cdp.evaluate(`(() => {
      const row = Array.from(document.querySelectorAll('.file-manager__row')).find((r) =>
        (r.querySelector('.file-manager__cell--name')?.textContent || '').includes('doomed.txt')
      )
      const status = document.querySelector('.file-manager__status--message')
      return {
        text: (status?.textContent ?? '').trim(),
        hasYes: Boolean(row?.querySelector('.file-manager__confirm-yes')),
        hasNo: Boolean(row?.querySelector('.file-manager__confirm-no'))
      }
    })()`)) as {
      text: string
      hasYes: boolean
      hasNo: boolean
    }
    console.log(`  info — the question: ${JSON.stringify(question.text)}`)
    check('the question is asked', question.text.length > 0)
    check('the question names the file', question.text.includes('doomed.txt'))
    check('there is a way to confirm', question.hasYes === true)
    check('there is a way to cancel', question.hasNo === true)

    // Cancelling leaves the file alone.
    await cdp.evaluate(`(() => {
      const row = Array.from(document.querySelectorAll('.file-manager__row')).find((r) =>
        (r.querySelector('.file-manager__cell--name')?.textContent || '').includes('doomed.txt')
      )
      row?.querySelector('.file-manager__confirm-no')?.click()
      return true
    })()`)
    await delay(600)
    check('the file survives the cancel', existsSync(target))
    const stillListed = (await cdp.evaluate(`(() => {
      const names = Array.from(document.querySelectorAll('.file-manager__cell--name'))
        .map((n) => (n.textContent || '').trim())
      return names.some((n) => n.includes('doomed.txt'))
    })()`)) as boolean
    check('the file is still listed after the cancel', stillListed === true)

    // Confirming removes it from the server — the consequence, not the label.
    await cdp.evaluate(`(() => {
      const row = Array.from(document.querySelectorAll('.file-manager__row')).find((r) =>
        (r.querySelector('.file-manager__cell--name')?.textContent || '').includes('doomed.txt')
      )
      row?.querySelector('.file-manager__delete')?.click()
      return true
    })()`)
    await delay(500)
    await cdp.evaluate(`(() => {
      const row = Array.from(document.querySelectorAll('.file-manager__row')).find((r) =>
        (r.querySelector('.file-manager__cell--name')?.textContent || '').includes('doomed.txt')
      )
      row?.querySelector('.file-manager__confirm-yes')?.click()
      return true
    })()`)
    await delay(2000)

    check('the file is gone from the server', !existsSync(target))
    const afterDelete = (await cdp.evaluate(`(() => {
      const names = Array.from(document.querySelectorAll('.file-manager__cell--name'))
        .map((n) => (n.textContent || '').trim())
      return {
        gone: !names.some((n) => n.includes('doomed.txt')),
        keeper: names.some((n) => n.includes('keeper.txt'))
      }
    })()`)) as { gone: boolean; keeper: boolean }
    check('the file is gone from the listing', afterDelete.gone === true)
    check('the other file is untouched', afterDelete.keeper === true)

    // A folder goes with everything inside it — the question says so.
    await cdp.evaluate(`(() => {
      const row = Array.from(document.querySelectorAll('.file-manager__row')).find((r) =>
        (r.querySelector('.file-manager__cell--name')?.textContent || '').includes('doomed-dir')
      )
      row?.querySelector('.file-manager__delete')?.click()
      return true
    })()`)
    await delay(600)

    const dirQuestion = (await cdp.evaluate(
      `(() => (document.querySelector('.file-manager__status--message')?.textContent ?? '').trim())()`
    )) as string
    console.log(`  info — the question about the folder: ${JSON.stringify(dirQuestion)}`)
    check('the question names the folder', dirQuestion.includes('doomed-dir'))
    check('the question mentions the contents', /everything|всем|содержимым/i.test(dirQuestion))

    await cdp.evaluate(`(() => {
      const row = Array.from(document.querySelectorAll('.file-manager__row')).find((r) =>
        (r.querySelector('.file-manager__cell--name')?.textContent || '').includes('doomed-dir')
      )
      row?.querySelector('.file-manager__confirm-yes')?.click()
      return true
    })()`)
    await delay(2000)

    check('the folder is gone from the server', !existsSync(join(server.root, 'doomed-dir')))
    const dirGone = (await cdp.evaluate(`(() => {
      const names = Array.from(document.querySelectorAll('.file-manager__cell--name'))
        .map((n) => (n.textContent || '').trim())
      return !names.some((n) => n.includes('doomed-dir'))
    })()`)) as boolean
    check('the folder is gone from the listing', dirGone === true)

    socket.close()
  } finally {
    await cleanupApp(app, userData)
    await server.close()
  }

  console.log(`RESULT: ${checks - failed}/${checks}`)
  if (failed > 0) process.exitCode = 1
}

await main()
