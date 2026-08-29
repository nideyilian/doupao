/**
 * 验证 imageId → 素材反查：直接调用 preload 暴露的 assetCatalogGetByImageId。
 * 返回 blob.localPath = 修复生效；null = 仍查不到。
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
  let targets = []
  for (let i = 0; i < 30; i++) {
    try {
      targets = await getJson('/json/list')
      if (targets.some((t) => t.type === 'page')) break
    } catch {}
    await sleep(300)
  }
  const page = targets.find((t) => t.type === 'page')
  if (!page) { console.log('no page target'); process.exit(1) }
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

  const healthy = '43a9bd59463c15d7fa81811792a970fda6ca812a9aae456589e0036fa1063e1a'
  const r = await send('Runtime.evaluate', {
    expression: `(async () => {
      const api = window.electronAPI || {}
      const has = { getByImageId: typeof api.assetCatalogGetByImageId, exportAll: typeof api.assetCatalogExportAll }
      let result = null
      try {
        const d = await api.assetCatalogGetByImageId('${healthy}')
        result = d ? { assetId: d.asset && d.asset.id, localPath: d.blob && d.blob.localPath, mimeType: d.blob && d.blob.mimeType } : null
      } catch (e) { result = 'error: ' + e.message }
      return JSON.stringify({ has, result })
    })()`,
    awaitPromise: true,
    returnByValue: true,
  })
  console.log('LOOKUP:', r.result?.result?.value ?? JSON.stringify(r.result))
  ws.close()
} catch (err) {
  console.error('CDP error:', err.message)
  process.exit(1)
}
