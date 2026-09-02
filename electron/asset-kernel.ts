import {
  app,
  ipcMain,
  nativeImage,
  protocol,
  utilityProcess,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type UtilityProcess,
} from 'electron'
import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  AssetCatalogQuery,
  AssetCollection,
  AssetTag,
  AssetTombstone,
  AssetUsageEvent,
  GeneratedAsset,
} from '../src/types'
import { AssetCatalog, assetSearchText, type AssetCatalogUpsert } from './asset-catalog'
import { CatalogClient } from './catalog-client'
import { AssetApiServer, type ExternalAssetCommand } from './asset-api-server'
import { assertTrustedSender } from './ipc-guard'
import { resolveCatalogDbPath } from './library-paths'
import { migrateCatalogIntoLibrary } from './catalog-migration'

interface AssetApiConfig {
  enabled: boolean
  port: number
  token: string
}

type PendingCommand = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

const APP_DATA_NAMESPACES = new Set([
  'tasks',
  'images',
  'thumbnails',
  'agentConversations',
  'wordLibrary',
  'compositeAssets',
  'meta',
  'sopBatchSnapshots',
  'sopGenerationRecords',
  'assetUsageEvents',
  'assetBlobs',
  'assetVersions',
  'zustand',
  'postprocess',
  'compositeWorkspace',
  'requirementPrototype',
  'assetLibraryUi',
])

function appDataNamespace(value: unknown): string {
  if (typeof value !== 'string' || !APP_DATA_NAMESPACES.has(value)) throw new Error('invalid app data namespace')
  return value
}

function appDataId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) throw new Error('invalid app data id')
  return value
}

function appDataRecords(value: unknown): Array<{ id: string; value: unknown }> {
  if (!Array.isArray(value)) throw new Error('invalid app data records')
  return value.map((record) => {
    if (!record || typeof record !== 'object') throw new Error('invalid app data record')
    const item = record as { id?: unknown; value?: unknown }
    return { id: appDataId(item.id), value: item.value }
  })
}

function normalizeApiConfig(value: unknown): AssetApiConfig {
  const raw = (value ?? {}) as Partial<AssetApiConfig>
  return {
    enabled: raw.enabled === true,
    port:
      Number.isInteger(raw.port) && Number(raw.port) >= 1024 && Number(raw.port) <= 65535 ? Number(raw.port) : 32191,
    token: typeof raw.token === 'string' && raw.token.length >= 32 ? raw.token : randomBytes(32).toString('base64url'),
  }
}

// 感知哈希：缩放到 9×8 后按相邻像素亮度比较生成 16 位十六进制。
// 注意：Electron utility process 的 electron 模块不提供 nativeImage 导出，
// 因此该计算保留在主进程（曾尝试移入 indexer，运行时 SyntaxError，已回退）。
function perceptualHash(filePath: string | undefined): string | undefined {
  if (!filePath) return undefined
  try {
    const image = nativeImage.createFromPath(filePath)
    if (image.isEmpty()) return undefined
    const bitmap = image.resize({ width: 9, height: 8, quality: 'good' }).toBitmap()
    let bits = ''
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const offset = (y * 9 + x) * 4
        const next = offset + 4
        const left = bitmap[offset + 2] * 299 + bitmap[offset + 1] * 587 + bitmap[offset] * 114
        const right = bitmap[next + 2] * 299 + bitmap[next + 1] * 587 + bitmap[next] * 114
        bits += left > right ? '1' : '0'
      }
    }
    return Array.from({ length: 16 }, (_, index) =>
      Number.parseInt(bits.slice(index * 4, index * 4 + 4), 2).toString(16),
    ).join('')
  } catch {
    return undefined
  }
}

export class AssetKernelManager {
  /** SQLite 目录客户端：查询/写入在 UtilityProcess 事件循环上执行，主进程不被同步 DatabaseSync 阻塞。 */
  catalog: CatalogClient
  private apiServer: AssetApiServer | null = null
  private apiConfig: AssetApiConfig = normalizeApiConfig(null)
  private readonly configPath: string
  private sequence = 0
  private readonly pendingCommands = new Map<string, PendingCommand>()
  private indexer: UtilityProcess | null = null
  private indexSequence = 0
  private readonly pendingIndexes = new Map<
    string,
    {
      resolve: (records: Array<{ assetId: string; textVector: number[] }>) => void
      reject: (error: Error) => void
      timeout: ReturnType<typeof setTimeout>
    }
  >()

  constructor(private readonly getMainWindow: () => BrowserWindow | null) {
    // 启动迁移：把 SQLite 权威目录迁入库根（单实例锁内、DB 未打开时执行；完整性失败保留旧路径）
    migrateCatalogIntoLibrary()
    this.catalog = new CatalogClient(resolveCatalogDbPath())
    this.configPath = path.join(app.getPath('userData'), 'asset-api.json')
  }

  async initialize() {
    await this.loadApiConfig()
    this.startIndexer()
    this.registerIpc()
    this.registerProtocol()
    if (this.apiConfig.enabled || process.argv.includes('--enable-asset-api')) await this.startApi()
  }

  private trusted(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
    const window = this.getMainWindow()
    if (!window || window.isDestroyed() || event.sender.id !== window.webContents.id) return false
    try {
      assertTrustedSender(event)
      return true
    } catch {
      return false
    }
  }

  private registerIpc() {
    const handle = <T extends unknown[]>(channel: string, fn: (...args: T) => unknown) => {
      ipcMain.handle(channel, (event, ...args: T) => {
        if (!this.trusted(event)) throw new Error('untrusted renderer')
        return fn(...args)
      })
    }
    handle<[AssetCatalogUpsert[]]>('asset-catalog:upsert', async (records) => {
      const indexed = await this.indexRecords(records).catch(() => [])
      const vectors = new Map(indexed.map((record) => [record.assetId, record.textVector]))
      const normalized = records.map((record) => ({
        ...record,
        textVector: record.textVector ?? vectors.get(record.asset.id),
        // 感知哈希在主进程计算（utility process 不支持 nativeImage，见 perceptualHash 注释）
        perceptualHash: record.perceptualHash ?? perceptualHash(record.localPath),
      }))
      const existing = new Set<string>()
      for (const record of normalized) {
        if (await this.catalog.getAsset(record.asset.id)) existing.add(record.asset.id)
      }
      await this.catalog.upsertAssets(normalized)
      for (const record of normalized)
        this.apiServer?.publish(existing.has(record.asset.id) ? 'asset.updated' : 'asset.created', {
          assetId: record.asset.id,
        })
      return { success: true }
    })
    handle<[AssetUsageEvent[]]>('asset-catalog:usage', (events) => {
      this.catalog.putUsageEvents(events)
      for (const event of events) if (event.action === 'derived') this.apiServer?.publish('asset.derived', event)
      return { success: true }
    })
    handle<[]>('asset-catalog:usage-export-all', () => this.catalog.getAllUsageEvents())
    handle<[string]>('asset-catalog:usage-by-asset', (assetId) => this.catalog.getUsageEvents(assetId))
    handle<[]>('asset-catalog:usage-clear', () => {
      this.catalog.clearUsageEvents()
      return { success: true }
    })
    handle<[string[]]>('asset-catalog:delete', (assetIds) => {
      this.catalog.deleteAssets(assetIds)
      return { success: true }
    })
    handle<[]>('asset-catalog:clear', () => {
      this.catalog.clear()
      return { success: true }
    })
    handle<[AssetCatalogQuery]>('asset-catalog:query', (query) => this.catalog.query(query))
    handle<[]>('asset-catalog:export-all', () => this.catalog.exportAllAssets())
    handle<[string]>('asset-catalog:get', (assetId) => this.catalog.getAsset(assetId))
    handle<[string]>('asset-catalog:get-by-image-id', (imageId) => this.catalog.getAssetByImageId(imageId))
    handle<[string[]]>('asset-catalog:get-assets-by-ids', (ids) => this.catalog.getAssetsByIds(ids))
    handle<[AssetCollection[]]>('asset-catalog:put-collections', (records) => {
      this.catalog.putCollections(records)
      return { success: true }
    })
    handle<[string]>('asset-catalog:delete-collection', (id) => {
      this.catalog.deleteCollection(id)
      return { success: true }
    })
    handle<[string]>('asset-catalog:trash-collection', (id) => {
      this.catalog.trashCollection(id)
      return { success: true }
    })
    handle<[string]>('asset-catalog:restore-collection', (id) => {
      this.catalog.restoreCollection(id)
      return { success: true }
    })
    handle<[]>('asset-catalog:get-collections', () => this.catalog.getAllCollections())
    handle<[AssetTag[]]>('asset-catalog:put-tags', (records) => {
      this.catalog.putTags(records)
      return { success: true }
    })
    handle<[string]>('asset-catalog:delete-tag', (id) => {
      this.catalog.deleteTag(id)
      return { success: true }
    })
    handle<[]>('asset-catalog:get-tags', () => this.catalog.getAllTags())
    handle<[AssetTombstone[]]>('asset-catalog:put-tombstones', (records) => {
      this.catalog.putTombstones(records)
      return { success: true }
    })
    handle<[string]>('asset-catalog:delete-tombstone', (imageId) => {
      this.catalog.deleteTombstone(imageId)
      return { success: true }
    })
    handle<[string[]]>('asset-catalog:get-tombstones', async (imageIds) => [
      ...(await this.catalog.getTombstonesByImageIds(imageIds)).values(),
    ])
    handle<[]>('asset-catalog:get-all-tombstones', () => this.catalog.getAllTombstones())
    handle<[string]>('asset-catalog:meta-get', (key) => this.catalog.getMeta(key))
    handle<[{ key: string; value: string }]>('asset-catalog:meta-set', ({ key, value }) => {
      this.catalog.setMeta(key, value)
      return { success: true }
    })
    handle<[string[], number, Array<{ id: string; value: unknown }>?]>(
      'asset-catalog:purge',
      (assetIds, now, tasksToPatch) => this.catalog.purgeAssets(assetIds, now, tasksToPatch ?? []),
    )
    handle<[]>('asset-catalog:cleanup-reference-assets', () => this.catalog.cleanupReferenceOnlyAssets())
    handle<[number | undefined]>('asset-catalog:near-duplicates', (threshold) =>
      this.catalog.findNearDuplicates(threshold ?? 8),
    )
    handle<[string]>('asset-catalog:derived-assets', (assetId) => this.catalog.getDerivedAssets(assetId))
    handle<[{ query?: string; context?: string; similarToAssetId?: string; limit?: number }]>(
      'asset-catalog:recommend',
      (input) => this.catalog.recommend(input),
    )
    handle<[]>('asset-catalog:status', async () => ({
      ready: true,
      assetCount: await this.catalog.size(),
      backend: 'sqlite-fts5' as const,
    }))
    handle<[string, string]>('app-data:get', (namespace, id) =>
      this.catalog.appDataGet(appDataNamespace(namespace), appDataId(id)),
    )
    handle<[string]>('app-data:get-all', (namespace) => this.catalog.appDataGetAll(appDataNamespace(namespace)))
    handle<[string, string[]]>('app-data:get-many', (namespace, ids) =>
      this.catalog.appDataGetMany(appDataNamespace(namespace), ids.map(appDataId)),
    )
    handle<[string, string, unknown]>('app-data:put', (namespace, id, value) => {
      this.catalog.appDataPut(appDataNamespace(namespace), appDataId(id), value)
      return { success: true }
    })
    handle<[string, Array<{ id: string; value: unknown }>]>('app-data:put-many', (namespace, records) => {
      this.catalog.appDataPutMany(appDataNamespace(namespace), appDataRecords(records))
      return { success: true }
    })
    handle<[string, Array<{ id: string; value: unknown }>]>('app-data:replace', (namespace, records) => {
      this.catalog.appDataReplace(appDataNamespace(namespace), appDataRecords(records))
      return { success: true }
    })
    handle<[string, string]>('app-data:delete', (namespace, id) => {
      this.catalog.appDataDelete(appDataNamespace(namespace), appDataId(id))
      return { success: true }
    })
    handle<[string, string[]]>('app-data:delete-many', (namespace, ids) => {
      this.catalog.appDataDeleteMany(appDataNamespace(namespace), ids.map(appDataId))
      return { success: true }
    })
    handle<[string[]]>('app-data:delete-image-records', (ids) => {
      this.catalog.appDataDeleteImageRecords(ids.map(appDataId))
      return { success: true }
    })
    handle<[]>('app-data:clear-image-records', () => {
      this.catalog.appDataClearImageRecords()
      return { success: true }
    })
    handle<[string]>('app-data:clear', (namespace) => {
      this.catalog.appDataClear(appDataNamespace(namespace))
      return { success: true }
    })
    handle<[string[]]>('app-data:counts', (namespaces) => {
      return this.catalog.appDataCounts(namespaces.map(appDataNamespace))
    })
    handle<[Record<string, unknown[]>]>('app-data:import-stores', (stores) => {
      if (!stores || typeof stores !== 'object' || Array.isArray(stores)) throw new Error('invalid app data stores')
      const normalized: Record<string, unknown[]> = {}
      for (const [namespace, values] of Object.entries(stores)) {
        appDataNamespace(namespace)
        if (!Array.isArray(values)) throw new Error('invalid app data store values')
        normalized[namespace] = values
      }
      this.catalog.appDataImportStores(normalized)
      return { success: true }
    })
    handle<
      [
        {
          images: unknown[]
          thumbnails: unknown[]
          tasks: unknown[]
          replaceTasks?: boolean
        },
      ]
    >('app-data:commit-imported-records', (records) => {
      if (
        !records ||
        !Array.isArray(records.images) ||
        !Array.isArray(records.thumbnails) ||
        !Array.isArray(records.tasks)
      ) {
        throw new Error('invalid imported app data')
      }
      this.catalog.appDataCommitImportedRecords(records)
      return { success: true }
    })
    handle<[Array<{ from: string; to: string }>]>('app-data:update-image-local-paths', (mappings) => {
      if (!Array.isArray(mappings)) throw new Error('invalid image path mappings')
      this.catalog.appDataUpdateImageLocalPaths(mappings)
      return { success: true }
    })
    handle<[]>('asset-api:status', () => this.getApiStatus())
    handle<[{ enabled: boolean; port?: number }]>('asset-api:configure', async (input) => {
      this.apiConfig = normalizeApiConfig({
        ...this.apiConfig,
        enabled: input.enabled,
        port: input.port ?? this.apiConfig.port,
      })
      await writeFile(this.configPath, JSON.stringify(this.apiConfig, null, 2), { encoding: 'utf8', mode: 0o600 })
      if (this.apiConfig.enabled) await this.startApi()
      else await this.stopApi()
      return this.getApiStatus()
    })
    ipcMain.on(
      'asset-kernel:external-command-result',
      (event, payload: { id?: string; result?: unknown; error?: string }) => {
        if (!this.trusted(event) || !payload?.id) return
        const pending = this.pendingCommands.get(payload.id)
        if (!pending) return
        clearTimeout(pending.timeout)
        this.pendingCommands.delete(payload.id)
        if (payload.error) pending.reject(new Error(payload.error))
        else pending.resolve(payload.result)
      },
    )
  }

  private startIndexer() {
    try {
      const modulePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'electron', 'asset-indexer.js')
      this.indexer = utilityProcess.fork(modulePath, [], { serviceName: 'DOUPAO Asset Indexer' })
      this.indexer.on('message', (payload: unknown) => {
        const message = payload as {
          id?: string
          records?: Array<{ assetId: string; textVector: number[] }>
          error?: string
        }
        if (!message.id) return
        const pending = this.pendingIndexes.get(message.id)
        if (!pending) return
        clearTimeout(pending.timeout)
        this.pendingIndexes.delete(message.id)
        if (message.error) pending.reject(new Error(message.error))
        else pending.resolve(message.records ?? [])
      })
      this.indexer.once('exit', () => {
        this.indexer = null
        for (const pending of this.pendingIndexes.values()) {
          clearTimeout(pending.timeout)
          pending.reject(new Error('asset indexer stopped'))
        }
        this.pendingIndexes.clear()
      })
    } catch (error) {
      console.warn('[asset-indexer-unavailable]', error)
      this.indexer = null
    }
  }

  private indexRecords(records: AssetCatalogUpsert[]): Promise<Array<{ assetId: string; textVector: number[] }>> {
    if (!this.indexer) return Promise.resolve([])
    const id = `index-${Date.now().toString(36)}-${(++this.indexSequence).toString(36)}`
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingIndexes.delete(id)
        resolve([])
      }, 15_000)
      this.pendingIndexes.set(id, { resolve, reject, timeout })
      this.indexer!.postMessage({
        id,
        items: records.map((record) => ({
          assetId: record.asset.id,
          text: assetSearchText(record.asset),
        })),
      })
    })
  }

  private registerProtocol() {
    protocol.handle('doupao', async (request) => {
      try {
        const url = new URL(request.url)
        if (url.hostname !== 'assets') return new Response('Not found', { status: 404 })
        const assetId = decodeURIComponent(url.pathname.replace(/^\//, ''))
        const details = await this.catalog.getAsset(assetId)
        if (!details?.blob.localPath) return new Response('Asset content unavailable', { status: 404 })
        const data = await readFile(details.blob.localPath)
        // MIME 白名单：资产文件只允许按图片/二进制下发，防止 DB 中被替换为 HTML 等
        // 可执行内容后在 standard+secure 的 doupao 源执行脚本（配合 nosniff）。
        const rawMime = details.blob.mimeType ?? 'application/octet-stream'
        const safeMime =
          typeof rawMime === 'string' && rawMime.startsWith('image/') ? rawMime : 'application/octet-stream'
        return new Response(data, {
          status: 200,
          headers: {
            'Content-Type': safeMime,
            'Cache-Control': 'private, max-age=31536000, immutable',
            'X-Content-Type-Options': 'nosniff',
          },
        })
      } catch {
        return new Response('Asset content unavailable', { status: 404 })
      }
    })
  }

  private async loadApiConfig() {
    try {
      this.apiConfig = normalizeApiConfig(JSON.parse(await readFile(this.configPath, 'utf8')))
    } catch {
      this.apiConfig = normalizeApiConfig(null)
      await writeFile(this.configPath, JSON.stringify(this.apiConfig, null, 2), { encoding: 'utf8', mode: 0o600 })
    }
  }

  private async startApi() {
    if (!this.apiServer)
      this.apiServer = new AssetApiServer({
        token: this.apiConfig.token,
        catalog: this.catalog,
        runCommand: (command) => this.requestRendererCommand(command),
      })
    const address = await this.apiServer.start(this.apiConfig.port)
    this.apiConfig.port = address.port
  }

  private async stopApi() {
    await this.apiServer?.stop()
    this.apiServer = null
  }

  private getApiStatus() {
    return {
      enabled: Boolean(this.apiServer),
      host: '127.0.0.1' as const,
      port: this.apiConfig.port,
      token: this.apiConfig.token,
      baseUrl: `http://127.0.0.1:${this.apiConfig.port}/v1`,
    }
  }

  private requestRendererCommand(command: ExternalAssetCommand): Promise<unknown> {
    const window = this.getMainWindow()
    if (!window || window.isDestroyed()) return Promise.reject(new Error('renderer unavailable'))
    const id = `external-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(id)
        reject(new Error('renderer command timed out'))
      }, 30_000)
      this.pendingCommands.set(id, { resolve, reject, timeout })
      window.webContents.send('asset-kernel:external-command', { id, command })
    })
  }

  async close() {
    await this.stopApi()
    for (const pending of this.pendingCommands.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('asset kernel shutting down'))
    }
    this.pendingCommands.clear()
    this.indexer?.kill()
    this.indexer = null
    await this.catalog.close()
  }

  /** 库根变更后在新路径重开目录：关 API → 关旧 worker → 新路径重启 worker → 按需重启 API 与索引器。 */
  async reopenCatalog(dbPath: string): Promise<void> {
    const shouldRestartApi = this.apiConfig.enabled
    await this.stopApi()
    await this.catalog.reopen(dbPath)
    this.startIndexer()
    if (shouldRestartApi) await this.startApi()
  }
}

export function registerAssetScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'doupao',
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false },
    },
  ])
}
