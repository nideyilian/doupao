/**
 * 素材目录 CatalogClient：主进程侧对 catalog-worker（UtilityProcess）的异步客户端。
 *
 * 与 AssetCatalog 同名方法（Promise 化），供 asset-kernel 的 IPC handler、
 * doupao:// 协议与 AssetApiServer 共用；所有 SQLite 同步工作都在 worker 的事件循环上执行，
 * 主进程事件循环不再被 DatabaseSync 阻塞。
 *
 * 容错：worker 启动失败 / 中途退出时，在途调用以错误结束，调用方（渲染进程）已有
 * 「无 catalog → 内存查询」的降级路径，行为与旧版「catalog 打开失败」一致。
 */
import { utilityProcess, type UtilityProcess } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  AssetCatalogCursorPage,
  AssetCatalogQuery,
  AssetCollection,
  AssetTag,
  AssetTombstone,
  AssetUsageEvent,
  GeneratedAsset,
} from '../src/types'
import type { AssetCatalogUpsert, CatalogAssetDetails } from './asset-catalog'

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

type WorkerHandle = {
  worker: UtilityProcess
  ready: Promise<void>
}

/** catalog-worker 编译产物路径（与 asset-indexer.js 同一目录布局）。 */
function workerModulePath(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'electron', 'catalog-worker.js')
}

export class CatalogClient {
  private current: WorkerHandle | null = null
  private readonly pending = new Map<number, PendingCall>()
  private sequence = 0

  constructor(dbPath: string) {
    this.fork(dbPath)
  }

  private fork(dbPath: string): void {
    try {
      const worker = utilityProcess.fork(workerModulePath(), [], { serviceName: 'DOUPAO Asset Catalog' })
      let resolveReady!: () => void
      let rejectReady!: (error: Error) => void
      const ready = new Promise<void>((resolve, reject) => {
        resolveReady = resolve
        rejectReady = reject
      })
      // 启动超时保护：worker 异常（如 node:sqlite 在 utility process 不可用）时，
      // 不能让调用方无限挂起——超时后以错误结束，渲染进程走「无 catalog」降级路径。
      const readyTimer = setTimeout(() => {
        rejectReady(new Error('asset catalog worker startup timed out'))
      }, 15_000)
      worker.on('message', (payload: unknown) => {
        const message = payload as { type?: string; id?: number; ok?: boolean; result?: unknown; error?: string }
        if (message?.type === 'ready') {
          clearTimeout(readyTimer)
          resolveReady()
          return
        }
        if (message?.type === 'init-error') {
          clearTimeout(readyTimer)
          rejectReady(new Error(message.error ?? 'asset catalog worker failed to initialize'))
          return
        }
        if (typeof message?.id !== 'number') return
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        if (message.ok) pending.resolve(message.result)
        else pending.reject(new Error(message.error ?? 'asset catalog call failed'))
      })
      worker.once('exit', () => {
        clearTimeout(readyTimer)
        // 关键：worker 未 ready 就退出时也必须 reject，否则调用方永久挂起（界面卡「加载中」）
        rejectReady(new Error('asset catalog worker exited before ready'))
        if (this.current?.worker === worker) this.current = null
        for (const pending of this.pending.values()) pending.reject(new Error('asset catalog worker stopped'))
        this.pending.clear()
      })
      this.current = { worker, ready }
      // dbPath 经 init 消息传递（utility process 的 process.argv 语义不可靠，见 catalog-worker 注释）
      worker.postMessage({ type: 'init', dbPath })
    } catch (error) {
      console.warn('[asset-catalog-worker-unavailable]', error)
      this.current = null
    }
  }

  private call<T>(method: string, args: unknown[]): Promise<T> {
    const current = this.current
    if (!current) return Promise.reject(new Error('asset catalog worker unavailable'))
    return current.ready.then(() => {
      if (this.current !== current) throw new Error('asset catalog worker restarted')
      const id = ++this.sequence
      return new Promise<T>((resolve, reject) => {
        this.pending.set(id, {
          resolve: (value) => resolve(value as T),
          reject,
        })
        current.worker.postMessage({ id, method, args })
      })
    })
  }

  // ===== 与 AssetCatalog 同名的方法面（Promise 化） =====

  query(input: AssetCatalogQuery): Promise<AssetCatalogCursorPage> {
    return this.call('query', [input])
  }

  upsertAssets(records: AssetCatalogUpsert[]): Promise<void> {
    return this.call('upsertAssets', [records])
  }

  putUsageEvents(events: AssetUsageEvent[]): Promise<void> {
    return this.call('putUsageEvents', [events])
  }

  getAllUsageEvents(): Promise<AssetUsageEvent[]> {
    return this.call('getAllUsageEvents', [])
  }

  getUsageEvents(assetId: string): Promise<AssetUsageEvent[]> {
    return this.call('getUsageEvents', [assetId])
  }

  clearUsageEvents(): Promise<void> {
    return this.call('clearUsageEvents', [])
  }

  deleteAssets(assetIds: string[]): Promise<void> {
    return this.call('deleteAssets', [assetIds])
  }

  clear(): Promise<void> {
    return this.call('clear', [])
  }

  exportAllAssets(): Promise<GeneratedAsset[]> {
    return this.call('exportAllAssets', [])
  }

  getAsset(assetId: string): Promise<CatalogAssetDetails | null> {
    return this.call('getAsset', [assetId])
  }

  /** 按原图 imageId 反查素材详情（素材 id 与 imageId 是两套键） */
  getAssetByImageId(imageId: string): Promise<CatalogAssetDetails | null> {
    return this.call('getAssetByImageId', [imageId])
  }

  getAssetsByIds(ids: string[]): Promise<GeneratedAsset[]> {
    return this.call('getAssetsByIds', [ids])
  }

  putCollections(records: AssetCollection[]): Promise<void> {
    return this.call('putCollections', [records])
  }

  deleteCollection(id: string): Promise<void> {
    return this.call('deleteCollection', [id])
  }

  trashCollection(id: string): Promise<void> {
    return this.call('trashCollection', [id])
  }

  restoreCollection(id: string): Promise<void> {
    return this.call('restoreCollection', [id])
  }

  getAllCollections(): Promise<AssetCollection[]> {
    return this.call('getAllCollections', [])
  }

  putTags(records: AssetTag[]): Promise<void> {
    return this.call('putTags', [records])
  }

  deleteTag(id: string): Promise<void> {
    return this.call('deleteTag', [id])
  }

  getAllTags(): Promise<AssetTag[]> {
    return this.call('getAllTags', [])
  }

  putTombstones(records: AssetTombstone[]): Promise<void> {
    return this.call('putTombstones', [records])
  }

  deleteTombstone(imageId: string): Promise<void> {
    return this.call('deleteTombstone', [imageId])
  }

  getTombstonesByImageIds(imageIds: string[]): Promise<Map<string, AssetTombstone>> {
    return this.call('getTombstonesByImageIds', [imageIds])
  }

  getAllTombstones(): Promise<AssetTombstone[]> {
    return this.call('getAllTombstones', [])
  }

  getMeta(key: string): Promise<string | null> {
    return this.call('getMeta', [key])
  }

  setMeta(key: string, value: string): Promise<void> {
    return this.call('setMeta', [key, value])
  }

  purgeAssets(
    assetIds: string[],
    now: number,
    tasksToPatch: Array<{ id: string; value: unknown }> = [],
  ): Promise<{ purged: string[]; tombstones: AssetTombstone[] }> {
    return this.call('purgeAssets', [assetIds, now, tasksToPatch])
  }

  cleanupReferenceOnlyAssets(): Promise<string[]> {
    return this.call('cleanupReferenceOnlyAssets', [])
  }

  findNearDuplicates(threshold = 8): Promise<Array<{ assets: GeneratedAsset[]; avgHamming: number }>> {
    return this.call('findNearDuplicates', [threshold])
  }

  getDerivedAssets(assetId: string): Promise<{ parents: GeneratedAsset[]; children: GeneratedAsset[] }> {
    return this.call('getDerivedAssets', [assetId])
  }

  recommend(input: {
    query?: string
    context?: string
    similarToAssetId?: string
    limit?: number
  }): Promise<Array<{ asset: GeneratedAsset; score: number }>> {
    return this.call('recommend', [input])
  }

  size(): Promise<number> {
    return this.call('size', [])
  }

  appDataGet(namespace: string, id: string): Promise<unknown> {
    return this.call('appDataGet', [namespace, id])
  }

  appDataGetAll(namespace: string): Promise<unknown[]> {
    return this.call('appDataGetAll', [namespace])
  }

  appDataGetMany(namespace: string, ids: string[]): Promise<unknown[]> {
    return this.call('appDataGetMany', [namespace, ids])
  }

  appDataPut(namespace: string, id: string, value: unknown): Promise<void> {
    return this.call('appDataPut', [namespace, id, value])
  }

  appDataPutMany(namespace: string, records: Array<{ id: string; value: unknown }>): Promise<void> {
    return this.call('appDataPutMany', [namespace, records])
  }

  appDataReplace(namespace: string, records: Array<{ id: string; value: unknown }>): Promise<void> {
    return this.call('appDataReplace', [namespace, records])
  }

  appDataDelete(namespace: string, id: string): Promise<void> {
    return this.call('appDataDelete', [namespace, id])
  }

  appDataDeleteMany(namespace: string, ids: string[]): Promise<void> {
    return this.call('appDataDeleteMany', [namespace, ids])
  }

  appDataDeleteImageRecords(ids: string[]): Promise<void> {
    return this.call('appDataDeleteImageRecords', [ids])
  }

  appDataClearImageRecords(): Promise<void> {
    return this.call('appDataClearImageRecords', [])
  }

  appDataClear(namespace: string): Promise<void> {
    return this.call('appDataClear', [namespace])
  }

  appDataCounts(namespaces: string[]): Promise<Record<string, number>> {
    return this.call('appDataCounts', [namespaces])
  }

  appDataImportStores(stores: Record<string, unknown[]>): Promise<void> {
    return this.call('appDataImportStores', [stores])
  }

  appDataCommitImportedRecords(records: {
    images: unknown[]
    thumbnails: unknown[]
    tasks: unknown[]
    replaceTasks?: boolean
  }): Promise<void> {
    return this.call('appDataCommitImportedRecords', [records])
  }

  appDataUpdateImageLocalPaths(mappings: Array<{ from: string; to: string }>): Promise<void> {
    return this.call('appDataUpdateImageLocalPaths', [mappings])
  }

  /** 正常关闭 worker（worker 内 close DB 后退出）。 */
  async close(): Promise<void> {
    const current = this.current
    this.current = null
    if (!current) return
    await current.ready.catch(() => {})
    const exited = new Promise<void>((resolve) => current.worker.once('exit', () => resolve()))
    try {
      current.worker.postMessage({ type: 'close' })
    } catch {
      // worker 已不可用：直接 kill
    }
    const timer = setTimeout(() => current.worker.kill(), 2_000)
    await exited
    clearTimeout(timer)
  }

  /** 库根变更：关闭旧 worker，用新 DB 路径重启。 */
  async reopen(dbPath: string): Promise<void> {
    await this.close()
    this.fork(dbPath)
  }
}
