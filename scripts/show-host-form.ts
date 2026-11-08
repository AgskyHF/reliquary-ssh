/**
 * Opens the host form in the running app and takes a screenshot, so the
 * build in release/mac-arm64 can be eyeballed without a harness around it.
 *
 * Usage: node --experimental-strip-types scripts/show-host-form.ts [port]
 */
import { writeFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { attach, exists, waitFor } from './lib/cdp.ts'

const PORT = Number(process.argv[2] ?? 9250)
const OUT = process.argv[3] ?? '/tmp/reliquary-host-form.png'

async function main(): Promise<void> {
  const session = await attach(PORT)
  const cdp = session.cdp

  await waitFor(cdp, exists('.sidebar__item'), 20)

  await cdp.evaluate(
    `(() => {
      const items = Array.from(document.querySelectorAll('.sidebar__item'))
      items.find((i) => (i.textContent ?? '').trim() === 'Hosts')?.click()
      return true
    })()`
  )
  await delay(500)

  const hasButton = await waitFor(cdp, exists('.host-list__add'), 10)
  console.log('add button:', hasButton)

  await cdp.evaluate(`document.querySelector('.host-list__add')?.click(), true`)
  const hasForm = await waitFor(cdp, exists('.host-form'), 10)
  console.log('host form:', hasForm)

  const fields = (await cdp.evaluate(
    `Array.from(document.querySelectorAll('.host-form input, .host-form select')).map(e => e.name)`
  )) as string[]
  console.log('fields:', fields.join(', '))

  const shot = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as {
    data: string
  }
  writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
  console.log('screenshot:', OUT)

  // The CDP socket keeps the loop alive otherwise.
  session.socket.close()
  process.exit(0)
}

void main()
