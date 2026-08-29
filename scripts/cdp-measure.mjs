/**
 * 读取策略工作台关键控件的 computed 尺寸，验证高度迁移是否生效且一致。
 * 用法：node scripts/cdp-measure.mjs [--dark]
 */
import { spawn } from 'node:child_process'
import http from 'node:http'

const CHROME = 'C:/Users/tt/AppData/Local/Google/Chrome/Application/chrome.exe'
const PORT = 9336
const url = 'http://127.0.0.1:41731/'
const dark = process.argv.includes('--dark')

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`, '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getJson(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path, method }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch (e) { reject(new Error(data.slice(0, 200))) } })
    })
    req.on('error', reject)
    req.end()
  })
}

let ws
try {
  for (let i = 0; i < 30; i++) {
    try { await getJson('/json/version'); break } catch { await sleep(300) }
  }
  const tabs = await getJson('/json/new?' + encodeURIComponent(url), 'PUT')
  ws = new WebSocket(tabs.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id
    pending.set(mid, res)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  await sleep(2500)

  if (dark) {
    await send('Runtime.evaluate', {
      expression: `(() => { document.documentElement.classList.add('dark'); return 'dark' })()`,
      returnByValue: true,
    })
    await sleep(400)
  }

  // 点击策略标签
  await send('Runtime.evaluate', {
    expression: `(() => {
      const els = [...document.querySelectorAll('button, a')]
      const target = els.find(el => (el.innerText || '').trim() === '策略')
      if (target) target.click()
      return target ? 'clicked' : 'not found'
    })()`,
    returnByValue: true,
  })
  await sleep(2500)

  // 测量所有含 h-ds- / 裸 h-N 高度类的元素实际渲染高度
  const measure = await send('Runtime.evaluate', {
    expression: `(() => {
      const result = []
      const els = [...document.querySelectorAll('*')]
      const heightClassRe = /(?:^|\\s)(?:min-)?h-(?:ds-control-(?:sm|md|lg)|ds-(?:12|14|16|52)|(?:7|8|9|10|11|12|14|16))(?:\\s|$)/
      for (const el of els) {
        const c = (el.className || '').toString()
        if (!heightClassRe.test(c)) continue
        const r = el.getBoundingClientRect()
        if (r.height === 0 && r.width === 0) continue
        const m = c.match(/(?:min-)?h-(?:ds-control-(?:sm|md|lg)|ds-(?:12|14|16|52)|(?:7|8|9|10|11|12|14|16))/g)
        result.push({
          class: m.join(','),
          height: Math.round(r.height),
          text: (el.innerText || el.getAttribute('aria-label') || '').toString().trim().slice(0, 14),
        })
        if (result.length >= 40) break
      }
      return JSON.stringify(result, null, 1)
    })()`,
    returnByValue: true,
  })
  console.log('=== 页面中高度类元素的实际渲染高度 ===')
  console.log(measure.result.result.value)
  ws.close()
} catch (err) {
  console.error('CDP error:', err.message)
} finally {
  chrome.kill()
}
