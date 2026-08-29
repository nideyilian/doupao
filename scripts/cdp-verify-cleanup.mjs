/**
 * 验证：连接运行中的应用（--remote-debugging-port=9335），
 * 在渲染进程里直接查询 IndexedDB images/thumbnails 记录数，
 * 并检查失效图 id 是否已被清理。
 * 用法：node scripts/cdp-verify-cleanup.mjs
 */
import http from 'node:http'

const PORT = 9335

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let ws
try {
  // 找到页面 target（type=page）
  let targets = []
  for (let i = 0; i < 30; i++) {
    try {
      targets = await getJson('/json/list')
      if (targets.some((t) => t.type === 'page')) break
    } catch {}
    await sleep(300)
  }
  const page = targets.find((t) => t.type === 'page')
  if (!page) {
    console.log('no page target found')
    process.exit(1)
  }
  ws = new WebSocket(page.webSocketDebuggerUrl)
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

  // 在页面上下文查询 IDB
  const expr = `(async () => {
    const LOST_ID = 'e657086492425f8ebe0d24e6950b51e196fbedef550bf685478490844abfdcaa'
    const HEALTHY_ID = '43a9bd59463c15d7fa81811792a970fda6ca812a9aae456589e0036fa1063e1a'
    const open = () => new Promise((resolve, reject) => {
      const req = indexedDB.open('gpt-image-playground')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const db = await open()
    const countStore = (name) => new Promise((resolve) => {
      try {
        const tx = db.transaction(name, 'readonly')
        const req = tx.objectStore(name).count()
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve(-1)
      } catch { resolve(-1) }
    })
    const getKey = (name, key) => new Promise((resolve) => {
      try {
        const tx = db.transaction(name, 'readonly')
        const req = tx.objectStore(name).get(key)
        req.onsuccess = () => resolve(req.result ? 'present' : 'missing')
        req.onerror = () => resolve('error')
      } catch { resolve('error') }
    })
    const stores = Array.from(db.objectStoreNames)
    const result = { stores }
    for (const s of stores) result[s] = await countStore(s)
    result.lostInImages = await getKey('images', LOST_ID)
    result.healthyInImages = await getKey('images', HEALTHY_ID)
    return JSON.stringify(result)
  })()`

  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  console.log('IDB 状态:', r.result?.result?.value ?? JSON.stringify(r.result))
  ws.close()
} catch (err) {
  console.error('CDP error:', err.message)
  process.exit(1)
}
