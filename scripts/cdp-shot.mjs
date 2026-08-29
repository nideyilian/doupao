/**
 * 用 Chrome DevTools Protocol 打开应用、设置 localStorage appMode、截图。
 * 用法：node scripts/cdp-shot.mjs <url> <mode> <outfile> [--dark]
 */
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import http from 'node:http'

const CHROME = 'C:/Users/tt/AppData/Local/Google/Chrome/Application/chrome.exe'
const PORT = 9333

const url = process.argv[2]
const mode = process.argv[3]
const outFile = process.argv[4]
const dark = process.argv.includes('--dark')

// 1) 启动 Chrome with remote debugging
const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  '--window-size=1440,900',
  'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getJson(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path, method }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch (e) { reject(new Error(`parse fail ${path}: ${data.slice(0, 200)}`)) }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

let ws
try {
  // 2) 等待 debugging 端口就绪
  for (let i = 0; i < 30; i++) {
    try { const v = await getJson('/json/version'); if (v.webSocketDebuggerUrl) break } catch { /* retry */ }
    await sleep(300)
  }

  // 3) 新建 tab 并导航（Chrome 要求 PUT）
  const tabs = await getJson('/json/new?' + encodeURIComponent(url), 'PUT')
  const wsUrl = tabs.webSocketDebuggerUrl
  ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })

  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
  const send = (method, params = {}) => new Promise((resolve) => {
    const mid = ++id
    pending.set(mid, resolve)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })

  await sleep(1500) // 等页面首帧

  // 4) 注入 appMode 到 localStorage（persist key: gpt-image-playground）
  await send('Runtime.evaluate', {
    expression: `(() => {
      const KEY = 'gpt-image-playground'
      const raw = localStorage.getItem(KEY)
      let data = null
      try { data = raw ? JSON.parse(raw) : null } catch (e) {}
      const base = (data && data.state && typeof data.state === 'object') ? data.state : {}
      const next = JSON.stringify({ state: { ...base, appMode: '${mode}' }, version: (data && data.version) || 0 })
      localStorage.setItem(KEY, next)
      return 'set appMode=${mode}'
    })()`,
    returnByValue: true,
  })

  // 5) 可选深色
  if (dark) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  }

  // 6) 刷新并等待渲染
  await send('Page.reload', { ignoreCache: true })
  await sleep(4000)

  // 7) 截图
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  mkdirSync(dirname(outFile), { recursive: true })
  writeFileSync(outFile, Buffer.from(shot.result.data, 'base64'))
  console.log('screenshot saved:', outFile)

  ws.close()
} catch (err) {
  console.error('CDP error:', err.message)
} finally {
  chrome.kill()
}
