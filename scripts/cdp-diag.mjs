/**
 * 诊断：注入 appMode 后验证 localStorage 是否生效、页面渲染的 appMode。
 * 用法：node scripts/cdp-diag.mjs <mode>
 */
import { spawn } from 'node:child_process'
import http from 'node:http'

const CHROME = 'C:/Users/tt/AppData/Local/Google/Chrome/Application/chrome.exe'
const PORT = 9334
const url = 'http://127.0.0.1:41731/'
const mode = process.argv[2] ?? 'strategy'

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
  await sleep(1500)

  // 注入前：读取当前 localStorage
  const before = await send('Runtime.evaluate', {
    expression: `(() => { const raw = localStorage.getItem('gpt-image-playground'); const d = raw ? JSON.parse(raw) : null; return JSON.stringify({ has: !!raw, appMode: d && d.state && d.state.appMode, version: d && d.version }) })()`,
    returnByValue: true,
  })
  console.log('注入前 localStorage:', before.result.result.value)

  // 注入
  await send('Runtime.evaluate', {
    expression: `(() => {
      const KEY = 'gpt-image-playground'
      const raw = localStorage.getItem(KEY)
      let data = null
      try { data = raw ? JSON.parse(raw) : null } catch (e) {}
      const base = (data && data.state && typeof data.state === 'object') ? data.state : {}
      const next = JSON.stringify({ state: { ...base, appMode: '${mode}' }, version: (data && data.version) || 0 })
      localStorage.setItem(KEY, next)
      return 'injected'
    })()`,
    returnByValue: true,
  })
  console.log('注入完成')

  // 刷新
  await send('Page.reload', { ignoreCache: true })
  await sleep(4500)

  // 注入后：读取 localStorage + 页面可见文本关键片段
  const after = await send('Runtime.evaluate', {
    expression: `(() => {
      const raw = localStorage.getItem('gpt-image-playground')
      const d = raw ? JSON.parse(raw) : null
      const bodyText = document.body.innerText.slice(0, 600)
      return JSON.stringify({ appMode: d && d.state && d.state.appMode, version: d && d.version, bodyStart: bodyText })
    })()`,
    returnByValue: true,
  })
  console.log('刷新后 localStorage:', after.result.result.value)
  console.log('\n--- 页面可见文本（前600字符） ---')
  console.log(after.result.result.value)
  ws.close()
} catch (err) {
  console.error('CDP error:', err.message)
} finally {
  chrome.kill()
}
