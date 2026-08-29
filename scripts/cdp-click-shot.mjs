/**
 * CDP 截图：打开应用 → 点击顶部导航"策略"标签 → 截图。
 * 通过真实的 DOM 查找按钮文本并点击，模拟用户操作。
 * 用法：node scripts/cdp-click-shot.mjs <outfile> [--dark]
 */
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import http from 'node:http'

const CHROME = 'C:/Users/tt/AppData/Local/Google/Chrome/Application/chrome.exe'
const PORT = 9335
const url = 'http://127.0.0.1:41731/'
const outFile = process.argv[2]
const dark = process.argv.includes('--dark')
const targetTab = process.argv[3] ?? '策略'

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
    // DOUPAO 用 darkMode:'class'，通过 .dark 类驱动，而非 prefers-color-scheme
    await send('Runtime.evaluate', {
      expression: `(() => { document.documentElement.classList.add('dark'); return document.documentElement.className })()`,
      returnByValue: true,
    })
    await sleep(400)
  }

  // 找到并点击目标导航标签
  const clickResult = await send('Runtime.evaluate', {
    expression: `(() => {
      // 收集所有含目标文本的可点击元素
      const els = [...document.querySelectorAll('button, a, [role="tab"], [role="button"]')]
      const target = els.find(el => {
        const t = (el.innerText || '').trim()
        return t === '${targetTab}'
      }) || els.find(el => {
        const t = (el.innerText || '').trim()
        return t.includes('${targetTab}') && t.length < 10
      })
      if (!target) {
        // fallback: 找所有短文本按钮，打印出来帮助调试
        const candidates = els.filter(el => {
          const t = (el.innerText || '').trim()
          return t && t.length < 8
        }).map(el => el.innerText.trim())
        return JSON.stringify({ found: false, candidates: [...new Set(candidates)].slice(0, 30) })
      }
      const rect = target.getBoundingClientRect()
      target.click()
      return JSON.stringify({ found: true, text: target.innerText.trim(), x: rect.x, y: rect.y, w: rect.width, h: rect.height })
    })()`,
    returnByValue: true,
  })
  console.log('点击结果:', clickResult.result.result.value)

  await sleep(2500) // 等待切换渲染

  // 输出当前可见文本确认切到了目标模式
  const text = await send('Runtime.evaluate', {
    expression: `document.body.innerText.slice(0, 400)`,
    returnByValue: true,
  })
  console.log('--- 点击后可见文本 ---')
  console.log(text.result.result.value)

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  if (!shot.result || !shot.result.data) {
    console.error('截图失败:', JSON.stringify(shot).slice(0, 300))
    process.exitCode = 1
  } else {
    mkdirSync(dirname(outFile), { recursive: true })
    writeFileSync(outFile, Buffer.from(shot.result.data, 'base64'))
    console.log('screenshot saved:', outFile)
  }
  ws.close()
} catch (err) {
  console.error('CDP error:', err.message)
  process.exitCode = 1
} finally {
  await sleep(200)
  chrome.kill()
}
