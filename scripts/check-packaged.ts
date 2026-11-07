import { WebSocket } from 'ws'

const list = await (await fetch('http://127.0.0.1:9243/json/list')).json()
const target = list.find((t: { title: string }) => t.title.includes('ReliquarySSH'))
if (!target) throw new Error('no target')

const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 1
const pending = new Map<number, (r: unknown) => void>()
ws.on('message', (raw: Buffer) => {
  const m = JSON.parse(raw.toString())
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)?.(m.result)
    pending.delete(m.id)
  }
})
await new Promise((r) => ws.once('open', r))
const send = (method: string, params = {}) =>
  new Promise((res) => {
    const i = id++
    pending.set(i, res as (r: unknown) => void)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
await send('Runtime.enable')
const ev = async (expression: string) => {
  const r = (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })) as {
    result?: { value?: unknown }
  }
  return r?.result?.value
}

console.log('title     :', await ev('document.title'))
console.log('sections  :', await ev("Array.from(document.querySelectorAll('.sidebar__item')).map(i=>i.textContent.trim()).join(',')"))
console.log('appInfo   :', JSON.stringify(await ev('window.reliquary.appInfo()')))
console.log('sqlite    :', await ev('window.reliquary.host.list().then(h=>"ok:"+h.length).catch(e=>"ERR:"+e.message)'))
console.log('settings  :', JSON.stringify(await ev('window.reliquary.settings.get()')))
console.log('sync      :', JSON.stringify(await ev('window.reliquary.sync.status()')))
console.log('logFile   :', await ev('window.reliquary.appInfo().then(()=>"ipc ok")'))

ws.close()
process.exit(0)
