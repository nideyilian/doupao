/**
 * 素材目录 SQLite 的独立事件循环（UtilityProcess）。
 *
 * 背景：AssetCatalog 使用 node:sqlite 的同步 API（DatabaseSync），若直接跑在主进程，
 * 一次带 FTS/json_each 过滤的分页查询或批量 upsert 会同步阻塞主进程事件循环，
 * 导致滚动缩略图 IPC、窗口事件等全部排队（表现为批量操作/滚动时的卡顿）。
 * 本 worker 让 SQLite 的同步工作发生在自己的事件循环上，主进程只做消息转发。
 *
 * 生命周期：
 * - 主进程 fork 后先发送 { type: 'init', dbPath }（不依赖 process.argv，utility process
 *   的 argv 语义在不同平台/版本不一致）；构造完成回发 { type: 'ready' }，失败回发
 *   { type: 'init-error', error } 并退出；
 * - 请求格式 { id, method, args }，响应 { id, ok, result } 或 { id, ok: false, error }；
 * - { type: 'close' } 触发正常关闭并退出进程。
 */
import { AssetCatalog } from './asset-catalog'

type UtilityParentPort = {
  on: (event: 'message', listener: (event: { data: unknown }) => void) => void
  postMessage: (message: unknown) => void
}

const parentPort = (process as typeof process & { parentPort?: UtilityParentPort }).parentPort
if (!parentPort) {
  console.error('[asset-catalog-worker] no parent port available')
  process.exit(1)
}

let catalog: AssetCatalog | null = null

function failInit(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  console.error('[asset-catalog-worker] failed to open catalog:', message)
  try {
    parentPort.postMessage({ type: 'init-error', error: message })
  } catch {
    // 主进程已不可达：直接退出
  }
  process.exit(1)
}

parentPort.on('message', ({ data }) => {
  const request = data as { type?: string; id?: number; method?: string; args?: unknown[]; dbPath?: unknown }
  if (request?.type === 'init') {
    if (catalog) return
    const dbPath = typeof request.dbPath === 'string' && request.dbPath.length > 0 ? request.dbPath : null
    if (!dbPath) {
      failInit(new Error('missing database path'))
      return
    }
    try {
      catalog = new AssetCatalog(dbPath)
    } catch (error) {
      failInit(error)
      return
    }
    parentPort.postMessage({ type: 'ready' })
    return
  }
  if (request?.type === 'close') {
    try {
      catalog?.close()
    } catch {
      // 关闭失败也照常退出：SQLite WAL 模式下数据已持久化
    }
    process.exit(0)
    return
  }
  if (typeof request?.id !== 'number' || typeof request.method !== 'string') return
  if (!catalog) {
    parentPort.postMessage({ id: request.id, ok: false, error: 'asset catalog not initialized' })
    return
  }

  const method = (catalog as unknown as Record<string, (...callArgs: unknown[]) => unknown>)[request.method]
  if (typeof method !== 'function') {
    parentPort.postMessage({ id: request.id, ok: false, error: `unknown catalog method: ${request.method}` })
    return
  }
  try {
    const result = method.apply(catalog, request.args ?? [])
    parentPort.postMessage({ id: request.id, ok: true, result })
  } catch (error) {
    parentPort.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})
