/**
 * catalog-worker 真实 Electron 冒烟验证（无窗口）。
 *
 * 用本机 Electron 二进制作为主进程入口运行本脚本：真实 fork 编译产物
 * dist-electron/electron/catalog-worker.js，验证：
 *   1) init → ready 握手（dbPath 经消息传递，不依赖 argv）；
 *   2) query / getAllCollections / size / getAsset / upsertAssets 全链路；
 *   3) close 正常退出；
 *   4) 非法 dbPath → init-error（失败路径不挂起）。
 *
 * 运行：npx electron scripts/verify-catalog-worker.cjs
 * 退出码：0 = 全部通过，1 = 有失败。
 */
const { app, utilityProcess } = require('electron')
const path = require('node:path')

const WORKER = path.join(__dirname, '..', 'dist-electron', 'electron', 'catalog-worker.js')

const results = []
function check(name, cond, detail) {
  results.push({ name, ok: Boolean(cond) })
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}${cond ? '' : ` :: ${String(detail ?? '')}`}`)
}

function forkWith(dbPath) {
  const child = utilityProcess.fork(WORKER, [], { serviceName: 'DOUPAO Catalog Verify', stdio: 'pipe' })
  if (child.stdout) child.stdout.on('data', (d) => console.log(`[worker.stdout] ${String(d).trim()}`))
  if (child.stderr) child.stderr.on('data', (d) => console.log(`[worker.stderr] ${String(d).trim()}`))

  let resolveReady, rejectReady
  const ready = new Promise((res, rej) => {
    resolveReady = res
    rejectReady = rej
  })
  const readyTimer = setTimeout(() => rejectReady(new Error('ready timeout')), 10_000)
  const pending = new Map()
  let seq = 0

  child.on('message', (payload) => {
    const msg = payload
    console.log(`[raw msg] ${JSON.stringify(msg)?.slice(0, 200)}`)
    if (msg && msg.type === 'ready') {
      clearTimeout(readyTimer)
      resolveReady()
      return
    }
    if (msg && msg.type === 'init-error') {
      clearTimeout(readyTimer)
      rejectReady(new Error(`init-error: ${msg.error}`))
      return
    }
    if (msg && typeof msg.id === 'number') {
      const p = pending.get(msg.id)
      if (p) {
        pending.delete(msg.id)
        msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error ?? 'call failed'))
      }
    }
  })
  child.once('exit', (code) => {
    clearTimeout(readyTimer)
    rejectReady(new Error(`worker exited before ready code=${code}`))
    for (const p of pending.values()) p.reject(new Error(`worker exited code=${code}`))
  })

  const call = (method, args) =>
    ready.then(
      () =>
        new Promise((res, rej) => {
          const id = ++seq
          pending.set(id, { resolve: res, reject: rej })
          child.postMessage({ id, method, args })
        }),
    )
  const close = async () => {
    await ready.catch(() => {})
    const exited = new Promise((res) => child.once('exit', () => res()))
    try {
      child.postMessage({ type: 'close' })
    } catch {
      // fall through to kill
    }
    const timer = setTimeout(() => child.kill(), 2_000)
    await exited
    clearTimeout(timer)
  }
  // dbPath 经 init 消息传递
  child.postMessage({ type: 'init', dbPath })
  return { ready, call, close }
}

app.whenReady().then(async () => {
  const hardTimeout = setTimeout(() => {
    console.log('FATAL - overall timeout')
    app.exit(1)
  }, 60_000)

  try {
    // —— 1. 正常路径：内存库 ——
    const w = await forkWith(':memory:')
    await w.ready
    check('init 后收到 ready', true)

    const baseQuery = {
      scope: 'all',
      query: '',
      filters: {},
      sortKey: 'updatedAt',
      sortOrder: 'desc',
      cursor: null,
      limit: 10,
    }
    const empty = await w.call('query', [baseQuery])
    check(
      '空库 query 返回空页结构',
      empty && Array.isArray(empty.assets) && empty.assets.length === 0 && typeof empty.totalCount === 'number',
      JSON.stringify(empty),
    )
    const collections = await w.call('getAllCollections', [])
    check('getAllCollections 返回数组', Array.isArray(collections), String(collections))
    const tags = await w.call('getAllTags', [])
    check('getAllTags 返回数组', Array.isArray(tags), String(tags))

    // upsert 一条素材（与渲染端同步路径一致：asset + localPath 可选）
    const now = Date.now()
    const asset = {
      id: 'verify-1',
      imageId: 'img-verify-1',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      trashedAt: null,
      collectionIds: [],
      tagIds: [],
      origins: [{ key: 'k1', taskId: 'task-1', prompt: '验证图片', apiProvider: 'mock', createdAt: now }],
      primaryOriginKey: 'k1',
      favorite: false,
      rating: 0,
      width: 100,
      height: 80,
      parentAssetIds: [],
    }
    await w.call('upsertAssets', [[{ asset }]])

    const after = await w.call('query', [baseQuery])
    check(
      'upsert 后 query 命中 1 条',
      after && after.assets.length === 1 && after.assets[0].id === 'verify-1',
      JSON.stringify(after && after.assets),
    )
    const size = await w.call('size', [])
    check('size = 1', size === 1, String(size))
    const detail = await w.call('getAsset', ['verify-1'])
    check(
      'getAsset 返回完整详情（asset/blob/version）',
      detail && detail.asset && detail.asset.id === 'verify-1' && detail.blob && detail.version,
      JSON.stringify(detail),
    )
    const byIds = await w.call('getAssetsByIds', [['verify-1', 'missing-1']])
    check('getAssetsByIds 去缺返回 1 条', Array.isArray(byIds) && byIds.length === 1, JSON.stringify(byIds))

    // 未知方法 → 明确报错而非挂起
    let unknownError = null
    try {
      await w.call('noSuchMethod', [])
    } catch (e) {
      unknownError = String(e)
    }
    check('未知方法返回明确错误', unknownError !== null && unknownError.includes('unknown catalog method'), unknownError)

    await w.close()
    check('close 正常退出', true)

    // —— 2. 失败路径：非法 dbPath → init-error，不挂起 ——
    const bad = await forkWith(path.join(process.cwd(), 'definitely-missing-dir-xyz', 'x.sqlite'))
    let initError = null
    try {
      await Promise.race([
        bad.ready,
        new Promise((_, rej) => setTimeout(() => rej(new Error('ready timeout')), 5_000)),
      ])
    } catch (e) {
      initError = String(e)
    }
    check('非法 dbPath 收到 init-error（不挂起）', initError !== null && initError.includes('init-error'), initError)
    await bad.close().catch(() => {})
  } catch (error) {
    console.log(`FATAL - ${error && error.stack ? error.stack : error}`)
    results.push({ name: 'overall', ok: false })
  }

  clearTimeout(hardTimeout)
  const allOk = results.length > 0 && results.every((r) => r.ok)
  console.log(allOk ? 'ALL PASS' : 'SOME FAILED')
  app.exit(allOk ? 0 : 1)
})
