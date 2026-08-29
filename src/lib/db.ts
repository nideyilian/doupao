import type {
  AgentConversation,
  AssetBlob,
  AssetCollection,
  AssetTag,
  AssetTombstone,
  AssetUsageEvent,
  AssetVersion,
  GeneratedAsset,
  SopBatchSnapshot,
  SopGenerationRecord,
  TaskRecord,
  StoredCompositeAsset,
  StoredImage,
  StoredImageThumbnail,
  WordGenerationBatch,
  WordLibraryEntry,
  WordLibraryGroup,
} from '../types'
import {
  deleteRawCacheImages,
  isElectron,
  readThumbnailFromDisk,
  saveRawCacheImageToLocal,
  writeThumbnailToDisk,
} from './localSave'
import type { MigrationJournal } from './migrations/registry'
import { computeContentHash } from './imageFingerprint'

const DB_NAME = 'gpt-image-playground'
const DB_VERSION = 15
const STORE_TASKS = 'tasks'
const STORE_IMAGES = 'images'
const STORE_THUMBNAILS = 'thumbnails'
const STORE_AGENT_CONVERSATIONS = 'agentConversations'
const STORE_WORD_LIBRARY = 'wordLibrary'
const STORE_COMPOSITE_ASSETS = 'compositeAssets'
const STORE_META = 'meta'
const STORE_SOP_BATCH_SNAPSHOTS = 'sopBatchSnapshots'
const STORE_SOP_GENERATION_RECORDS = 'sopGenerationRecords'
const STORE_GENERATED_ASSETS = 'generatedAssets'
const STORE_ASSET_COLLECTIONS = 'assetCollections'
const STORE_ASSET_TAGS = 'assetTags'
const STORE_ASSET_TOMBSTONES = 'assetTombstones'
const STORE_ASSET_USAGE_EVENTS = 'assetUsageEvents'
const STORE_ASSET_BLOBS = 'assetBlobs'
const STORE_ASSET_VERSIONS = 'assetVersions'
const THUMBNAIL_MAX_SIZE = 1024
const THUMBNAIL_QUALITY = 0.82
const THUMBNAIL_VERSION = 5

export const CURRENT_THUMBNAIL_VERSION = THUMBNAIL_VERSION

// 连接缓存：复用同一 IDB 连接，避免每次操作都重新 open。
// 缓存键是 indexedDB 全局引用——测试用 stubGlobal 替换全局时自动失效，
// 生产环境则保持单连接；版本升级时旧连接收到 onversionchange 自动关闭并重置。
let cachedDb: { idb: IDBFactory; db: Promise<IDBDatabase> } | null = null

function openDB(): Promise<IDBDatabase> {
  // 先安全取全局引用：indexedDB 不可用（如部分测试环境）时返回已拒绝的 Promise，
  // 绝不能同步抛错——否则调用方的 .then/.catch 永远挂不上，产生未处理拒绝。
  const idb = typeof indexedDB !== 'undefined' ? indexedDB : null
  if (idb === null) return Promise.reject(new Error('IndexedDB 不可用（当前环境不支持）'))
  if (cachedDb && cachedDb.idb === idb) return cachedDb.db
  const db = new Promise<IDBDatabase>((resolve, reject) => {
    const req = idb.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const database = (e.target as IDBOpenDBRequest).result
      if (!database.objectStoreNames.contains(STORE_TASKS)) {
        database.createObjectStore(STORE_TASKS, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(STORE_IMAGES)) {
        database.createObjectStore(STORE_IMAGES, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(STORE_THUMBNAILS)) {
        database.createObjectStore(STORE_THUMBNAILS, { keyPath: 'id' })
      }
      // v14 曾引入网格小缩略图 store，v15 起移除（网格改回 1024 大图），删除残留数据
      if (database.objectStoreNames.contains('thumbnails-grid')) {
        database.deleteObjectStore('thumbnails-grid')
      }
      if (!database.objectStoreNames.contains(STORE_AGENT_CONVERSATIONS)) {
        database.createObjectStore(STORE_AGENT_CONVERSATIONS, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(STORE_WORD_LIBRARY)) {
        database.createObjectStore(STORE_WORD_LIBRARY, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(STORE_COMPOSITE_ASSETS)) {
        database.createObjectStore(STORE_COMPOSITE_ASSETS, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(STORE_META)) {
        database.createObjectStore(STORE_META, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(STORE_SOP_BATCH_SNAPSHOTS)) {
        database.createObjectStore(STORE_SOP_BATCH_SNAPSHOTS, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(STORE_SOP_GENERATION_RECORDS)) {
        database.createObjectStore(STORE_SOP_GENERATION_RECORDS, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(STORE_GENERATED_ASSETS)) {
        const store = database.createObjectStore(STORE_GENERATED_ASSETS, { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt')
        store.createIndex('updatedAt', 'updatedAt')
        store.createIndex('status', 'status')
        store.createIndex('imageId', 'imageId')
      } else {
        const store = req.transaction!.objectStore(STORE_GENERATED_ASSETS)
        if (!store.indexNames.contains('imageId')) store.createIndex('imageId', 'imageId')
      }
      if (!database.objectStoreNames.contains(STORE_ASSET_COLLECTIONS)) {
        database.createObjectStore(STORE_ASSET_COLLECTIONS, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(STORE_ASSET_TAGS)) {
        database.createObjectStore(STORE_ASSET_TAGS, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(STORE_ASSET_TOMBSTONES)) {
        const store = database.createObjectStore(STORE_ASSET_TOMBSTONES, { keyPath: 'id' })
        store.createIndex('imageId', 'imageId')
      } else {
        // 旧库补齐 imageId 索引（v13 起，用于按 imageId 批量查墓碑，替代每次全表扫描）
        const store = req.transaction!.objectStore(STORE_ASSET_TOMBSTONES)
        if (!store.indexNames.contains('imageId')) store.createIndex('imageId', 'imageId')
      }
      if (!database.objectStoreNames.contains(STORE_ASSET_USAGE_EVENTS)) {
        const store = database.createObjectStore(STORE_ASSET_USAGE_EVENTS, { keyPath: 'id' })
        store.createIndex('assetId', 'assetId')
        store.createIndex('occurredAt', 'occurredAt')
      }
      if (!database.objectStoreNames.contains(STORE_ASSET_BLOBS)) {
        const store = database.createObjectStore(STORE_ASSET_BLOBS, { keyPath: 'id' })
        store.createIndex('contentHash', 'contentHash', { unique: true })
      }
      if (!database.objectStoreNames.contains(STORE_ASSET_VERSIONS)) {
        const store = database.createObjectStore(STORE_ASSET_VERSIONS, { keyPath: 'id' })
        store.createIndex('assetId', 'assetId')
        store.createIndex('blobId', 'blobId')
      }
    }
    req.onblocked = () => {
      // 旧版本连接未关闭时升级会被阻塞；记录以便排查。
      console.warn('[db] IndexedDB 升级被其他连接阻塞，等待关闭')
    }
    req.onsuccess = () => {
      const database = req.result
      database.onversionchange = () => {
        database.close()
        if (cachedDb?.db === db) cachedDb = null
      }
      resolve(database)
    }
    req.onerror = () => {
      if (cachedDb?.db === db) cachedDb = null
      reject(req.error)
    }
  })
  cachedDb = { idb, db }
  return db
}

function dbTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode)
        const store = tx.objectStore(storeName)
        const req = fn(store)
        if (mode === 'readonly') {
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => reject(req.error)
          return
        }

        let result: T
        req.onsuccess = () => {
          result = req.result
        }
        req.onerror = () => reject(req.error)
        tx.oncomplete = () => resolve(result)
        tx.onerror = () => reject(tx.error ?? req.error)
        tx.onabort = () => reject(tx.error ?? req.error ?? new Error('IndexedDB transaction aborted'))
      }),
  )
}

export function getMigrationJournal(id: string): Promise<MigrationJournal | undefined> {
  return dbTransaction(STORE_META, 'readonly', (store) => store.get(id))
}

export async function putMigrationJournal(record: MigrationJournal): Promise<void> {
  await dbTransaction(STORE_META, 'readwrite', (store) => store.put(record))
}

// ===== Tasks =====

export function getAllTasks(): Promise<TaskRecord[]> {
  return dbTransaction(STORE_TASKS, 'readonly', (s) => s.getAll())
}

export function loadTasksIncrementally(migrate: (task: TaskRecord) => TaskRecord): Promise<TaskRecord[]> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_TASKS, 'readwrite')
        const request = tx.objectStore(STORE_TASKS).openCursor()
        const tasks: TaskRecord[] = []
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) return
          const original = cursor.value as TaskRecord
          const migrated = migrate(original)
          tasks.push(migrated)
          if (migrated !== original) cursor.update(migrated)
          cursor.continue()
        }
        request.onerror = () => reject(request.error)
        tx.oncomplete = () => resolve(tasks)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB task migration aborted'))
      }),
  )
}

export function putTask(task: TaskRecord): Promise<IDBValidKey> {
  return dbTransaction(STORE_TASKS, 'readwrite', (s) => s.put(task))
}

export function deleteTask(id: string): Promise<undefined> {
  return dbTransaction(STORE_TASKS, 'readwrite', (s) => s.delete(id))
}

export function clearTasks(): Promise<undefined> {
  return dbTransaction(STORE_TASKS, 'readwrite', (s) => s.clear())
}

// ===== SOP batch snapshots =====

export function getSopBatchSnapshot(id: string): Promise<SopBatchSnapshot | undefined> {
  return dbTransaction(STORE_SOP_BATCH_SNAPSHOTS, 'readonly', (store) => store.get(id))
}

export function getAllSopBatchSnapshots(): Promise<SopBatchSnapshot[]> {
  return dbTransaction(STORE_SOP_BATCH_SNAPSHOTS, 'readonly', (store) => store.getAll())
}

export function putSopBatchSnapshot(snapshot: SopBatchSnapshot): Promise<IDBValidKey> {
  return dbTransaction(STORE_SOP_BATCH_SNAPSHOTS, 'readwrite', (store) => store.put(snapshot))
}

export function deleteSopBatchSnapshot(id: string): Promise<undefined> {
  return dbTransaction(STORE_SOP_BATCH_SNAPSHOTS, 'readwrite', (store) => store.delete(id))
}

export function clearSopBatchSnapshots(): Promise<undefined> {
  return dbTransaction(STORE_SOP_BATCH_SNAPSHOTS, 'readwrite', (store) => store.clear())
}

// ===== SOP generation records =====

export function getAllSopGenerationRecords(): Promise<SopGenerationRecord[]> {
  return dbTransaction(STORE_SOP_GENERATION_RECORDS, 'readonly', (store) => store.getAll())
}

export function putSopGenerationRecord(record: SopGenerationRecord): Promise<IDBValidKey> {
  return dbTransaction(STORE_SOP_GENERATION_RECORDS, 'readwrite', (store) => store.put(record))
}

// ===== Agent conversations =====

export function getAllAgentConversations(): Promise<AgentConversation[]> {
  return dbTransaction(STORE_AGENT_CONVERSATIONS, 'readonly', (s) => s.getAll())
}

export function putAgentConversation(conversation: AgentConversation): Promise<IDBValidKey> {
  return dbTransaction(STORE_AGENT_CONVERSATIONS, 'readwrite', (s) => s.put(conversation))
}

export function deleteAgentConversation(id: string): Promise<undefined> {
  return dbTransaction(STORE_AGENT_CONVERSATIONS, 'readwrite', (s) => s.delete(id))
}

export function clearAgentConversations(): Promise<undefined> {
  return dbTransaction(STORE_AGENT_CONVERSATIONS, 'readwrite', (s) => s.clear())
}

export function replaceAgentConversations(conversations: AgentConversation[]): Promise<undefined> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_AGENT_CONVERSATIONS, 'readwrite')
        const store = tx.objectStore(STORE_AGENT_CONVERSATIONS)
        store.clear()
        for (const conversation of conversations) store.put(conversation)
        tx.oncomplete = () => resolve(undefined)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }),
  )
}

// ===== Word library =====

export type StoredWordLibraryState = {
  id: 'word-library'
  groups: WordLibraryGroup[]
  entries: WordLibraryEntry[]
  batches?: WordGenerationBatch[]
  updatedAt: number
}

export function getWordLibraryState(): Promise<StoredWordLibraryState | undefined> {
  return dbTransaction(STORE_WORD_LIBRARY, 'readonly', (s) => s.get('word-library'))
}

export function putWordLibraryState(state: Omit<StoredWordLibraryState, 'id' | 'updatedAt'>): Promise<IDBValidKey> {
  return dbTransaction(STORE_WORD_LIBRARY, 'readwrite', (s) =>
    s.put({
      id: 'word-library',
      groups: state.groups,
      entries: state.entries,
      batches: state.batches ?? [],
      updatedAt: Date.now(),
    }),
  )
}

// ===== Composite assets =====

export function getCompositeAsset(id: string): Promise<StoredCompositeAsset | undefined> {
  return dbTransaction(STORE_COMPOSITE_ASSETS, 'readonly', (s) => s.get(id))
}

export function putCompositeAsset(asset: StoredCompositeAsset): Promise<IDBValidKey> {
  return dbTransaction(STORE_COMPOSITE_ASSETS, 'readwrite', (s) => s.put(asset))
}

export function deleteCompositeAsset(id: string): Promise<undefined> {
  return dbTransaction(STORE_COMPOSITE_ASSETS, 'readwrite', (s) => s.delete(id))
}

export function batchGetCompositeAssets(ids: string[]): Promise<Map<string, StoredCompositeAsset>> {
  if (ids.length === 0) return Promise.resolve(new Map())
  const uniqueIds = Array.from(new Set(ids))
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const store = db.transaction(STORE_COMPOSITE_ASSETS, 'readonly').objectStore(STORE_COMPOSITE_ASSETS)
        const result = new Map<string, StoredCompositeAsset>()
        let pending = uniqueIds.length
        for (const id of uniqueIds) {
          const req = store.get(id)
          req.onsuccess = () => {
            if (req.result) result.set(id, req.result as StoredCompositeAsset)
            if (--pending === 0) resolve(result)
          }
          req.onerror = () => reject(req.error)
        }
      }),
  )
}

export function putCompositeAssets(assets: StoredCompositeAsset[]): Promise<void> {
  if (assets.length === 0) return Promise.resolve()
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_COMPOSITE_ASSETS, 'readwrite')
        const store = tx.objectStore(STORE_COMPOSITE_ASSETS)
        for (const asset of assets) store.put(asset)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }),
  )
}

// ===== Images =====

/**
 * 大值记录（dataUrl/缩略图）由 Chromium 以磁盘 blob 文件存放；blob 文件缺失时
 * 单条读取会失败（"Data lost due to missing file. Affected record should be
 * considered irrecoverable"）。该记录不可恢复，读取方按"记录缺失"处理即可，
 * 不应让单条坏记录中断批量读取/迁移/导出。
 */
function isIrrecoverableBlobError(error: unknown): boolean {
  return (
    error instanceof Error && /Data lost due to missing file|Failed to read large IndexedDB value/i.test(error.message)
  )
}

export function getImage(id: string): Promise<StoredImage | undefined> {
  return dbTransaction(STORE_IMAGES, 'readonly', (s) => s.get(id)).catch((error) => {
    if (isIrrecoverableBlobError(error)) {
      console.warn('[db] 图片记录不可读（视为缺失）:', id, error.message)
      return undefined
    }
    throw error
  })
}

export function getStoredImageThumbnail(id: string): Promise<StoredImageThumbnail | undefined> {
  return dbTransaction(STORE_THUMBNAILS, 'readonly', (s) => s.get(id)).catch((error) => {
    if (isIrrecoverableBlobError(error)) {
      console.warn('[db] 缩略图记录不可读（视为缺失）:', id, error.message)
      return undefined
    }
    throw error
  })
}

export async function getStoredFreshImageThumbnail(id: string): Promise<StoredImageThumbnail | undefined> {
  const thumbnail = await getStoredImageThumbnail(id)
  return thumbnail?.thumbnailVersion === THUMBNAIL_VERSION ? thumbnail : undefined
}

export function putImageThumbnail(thumbnail: StoredImageThumbnail): Promise<IDBValidKey> {
  return dbTransaction(STORE_THUMBNAILS, 'readwrite', (s) => s.put(thumbnail))
}

/** 从磁盘缩略图缓存读取（Electron，库根 thumbs/）；浏览器或未命中返回 undefined。 */
export async function getFreshThumbnailFromDisk(id: string): Promise<StoredImageThumbnail | undefined> {
  if (!isElectron()) return undefined
  const disk = await readThumbnailFromDisk(id, THUMBNAIL_VERSION)
  if (!disk?.dataUrl) return undefined
  return {
    id,
    thumbnailDataUrl: disk.dataUrl,
    width: disk.width,
    height: disk.height,
    thumbnailVersion: THUMBNAIL_VERSION,
  }
}

/** 缩略图双写磁盘（懒迁移：生成/命中当前版本时按需回填库根 thumbs/，失败静默）。
 *  守卫：只有当前版本才写盘——旧版本缩略图绝不能以"当前版本"标签落盘，
 *  否则版本升级后的重建会被旧图顶替（历史上 512→1024 升级就因此失效过）。 */
function persistThumbnailToDisk(thumbnail: StoredImageThumbnail): void {
  if (!isElectron()) return
  if (thumbnail.thumbnailVersion !== THUMBNAIL_VERSION) return
  void writeThumbnailToDisk(thumbnail.id, THUMBNAIL_VERSION, thumbnail.thumbnailDataUrl).catch(() => {})
}

/**
 * 从主进程 SQLite 目录按原图 imageId 恢复原图本地路径（IndexedDB 缺图时的兜底）。
 * 素材 id（asset:xxx）与 imageId（内容哈希）是两套键：先按 imageId 反查素材，
 * 再取素材详情里的原图 blob 路径（快速预览 / 查看器 / 缩略图回填共用）。
 */
export async function resolveImageFromCatalog(id: string): Promise<StoredImage | null> {
  if (!isElectron()) return null
  const api = window.electronAPI
  if (!api?.assetCatalogGetByImageId || !api?.assetCatalogGet) return null
  try {
    const details = (await api.assetCatalogGetByImageId(id)) as
      | {
          asset?: { width?: number; height?: number; createdAt?: number }
          blob?: { localPath?: string; mimeType?: string; byteSize?: number }
        }
      | null
      | undefined
    const localPath = details?.blob?.localPath
    if (!localPath) return null
    return {
      id,
      localPath,
      mimeType: details?.blob?.mimeType,
      byteSize: details?.blob?.byteSize,
      width: details?.asset?.width,
      height: details?.asset?.height,
      createdAt: details?.asset?.createdAt,
    }
  } catch {
    return null
  }
}

export async function getImageThumbnail(id: string): Promise<StoredImageThumbnail | undefined> {
  // 磁盘优先（Electron）：库根 thumbs/ 命中直接返回（复制库文件夹后 IndexedDB 无缩略图也能秒出图）
  const diskThumb = await getFreshThumbnailFromDisk(id)
  if (diskThumb) return diskThumb

  const existingThumbnail = await getStoredImageThumbnail(id)
  if (existingThumbnail?.thumbnailVersion === THUMBNAIL_VERSION) {
    const image = await getImage(id)
    if (image && (!image.width || !image.height) && existingThumbnail.width && existingThumbnail.height) {
      await putImage({ ...image, width: existingThumbnail.width, height: existingThumbnail.height })
    }
    persistThumbnailToDisk(existingThumbnail)
    return existingThumbnail
  }

  let image = await getImage(id)
  if (!image) {
    // 兜底：IndexedDB 缺图时从 SQLite 目录恢复 localPath 再生成缩略图。
    const recovered = await resolveImageFromCatalog(id)
    if (!recovered) return undefined
    image = recovered
    void putImage(recovered).catch(() => {})
  }
  const legacyImage = image as StoredImage & Partial<StoredImageThumbnail>
  if (legacyImage.thumbnailDataUrl && legacyImage.thumbnailVersion === THUMBNAIL_VERSION) {
    const thumbnail: StoredImageThumbnail = {
      id,
      thumbnailDataUrl: legacyImage.thumbnailDataUrl,
      width: legacyImage.width,
      height: legacyImage.height,
      thumbnailVersion: THUMBNAIL_VERSION,
    }
    await putImageThumbnail(thumbnail)
    persistThumbnailToDisk(thumbnail)
    if ((!image.width || !image.height) && thumbnail.width && thumbnail.height) {
      await putImage({ ...image, width: thumbnail.width, height: thumbnail.height })
    }
    return thumbnail
  }

  // Fallback to reading actual image data if localPath is used instead of dataUrl
  let dataUrlToHash = image.dataUrl
  if (!dataUrlToHash && image.localPath && isElectron()) {
    try {
      const fileResult = await window.electronAPI?.readFileBuffer(image.localPath)
      if (fileResult) {
        const mime = fileResult.name.endsWith('webp')
          ? 'image/webp'
          : fileResult.name.endsWith('jpg') || fileResult.name.endsWith('jpeg')
            ? 'image/jpeg'
            : 'image/png'
        const blob = new Blob([fileResult.data], { type: mime })
        dataUrlToHash = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.readAsDataURL(blob)
        })
      }
    } catch (e) {
      console.error('Failed to read local file for thumbnail generation:', e)
    }
  }

  if (!dataUrlToHash) return undefined

  const metadata = await safeCreateImageThumbnail(dataUrlToHash)
  if (!metadata.thumbnailDataUrl) return undefined
  const thumbnail: StoredImageThumbnail = {
    id,
    thumbnailDataUrl: metadata.thumbnailDataUrl,
    width: metadata.width,
    height: metadata.height,
    thumbnailVersion: THUMBNAIL_VERSION,
  }
  await putImageThumbnail(thumbnail)
  persistThumbnailToDisk(thumbnail)
  if (metadata.width && metadata.height && (image.width !== metadata.width || image.height !== metadata.height)) {
    await putImage({ ...image, width: metadata.width, height: metadata.height })
  }
  return thumbnail
}

export function getAllImages(): Promise<StoredImage[]> {
  return dbTransaction(STORE_IMAGES, 'readonly', (s) => s.getAll())
}

export function getAllImageIds(): Promise<string[]> {
  return dbTransaction(STORE_IMAGES, 'readonly', (s) => s.getAllKeys()).then((keys) => keys.map(String))
}

export function getLegacyImageBatch(limit: number): Promise<StoredImage[]> {
  if (limit <= 0) return Promise.resolve([])
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const request = db.transaction(STORE_IMAGES, 'readonly').objectStore(STORE_IMAGES).openCursor()
        const images: StoredImage[] = []
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) {
            resolve(images)
            return
          }
          let image: StoredImage | undefined
          try {
            // 大值 blob 文件缺失时读取 value 会抛错；该记录不可恢复，跳过并继续扫描
            image = cursor.value as StoredImage
            if (image.dataUrl && !image.localPath) images.push(image)
          } catch (error) {
            console.warn('[db] 迁移扫描跳过不可读图片记录:', error)
          }
          if (images.length >= limit) resolve(images)
          else cursor.continue()
        }
        request.onerror = () => reject(request.error)
      }),
  )
}

export function putImage(image: StoredImage): Promise<IDBValidKey> {
  return dbTransaction(STORE_IMAGES, 'readwrite', (s) => s.put(image))
}

export async function deleteImage(id: string): Promise<undefined> {
  const image = await getImage(id)
  await openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_IMAGES, STORE_THUMBNAILS], 'readwrite')
        tx.objectStore(STORE_IMAGES).delete(id)
        tx.objectStore(STORE_THUMBNAILS).delete(id)
        tx.oncomplete = () => resolve(undefined)
        tx.onerror = () => reject(tx.error)
      }),
  )
  if (image?.localPath) await deleteRawCacheImages([image.localPath])
  return undefined
}

export async function clearImages(): Promise<undefined> {
  const localPaths = await getAllLocalImagePaths()
  await openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_IMAGES, STORE_THUMBNAILS], 'readwrite')
        tx.objectStore(STORE_IMAGES).clear()
        tx.objectStore(STORE_THUMBNAILS).clear()
        tx.oncomplete = () => resolve(undefined)
        tx.onerror = () => reject(tx.error)
      }),
  )
  await deleteRawCacheImages(localPaths)
  return undefined
}

export function getAllLocalImagePaths(): Promise<string[]> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const request = db.transaction(STORE_IMAGES, 'readonly').objectStore(STORE_IMAGES).openCursor()
        const paths: string[] = []
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) return resolve(paths)
          const localPath = (cursor.value as StoredImage).localPath
          if (localPath) paths.push(localPath)
          cursor.continue()
        }
        request.onerror = () => reject(request.error)
      }),
  )
}

// ===== Image hashing & dedup =====

/**
 * 存储图片，若已存在（按内容哈希去重）则跳过。
 * 返回 image id。
 *
 * 去重 id 基于 data URL 解码后的原始字节 SHA-256（见 imageFingerprint.computeContentHash）：
 * 同一张图重新编码 / 重新压缩 / 换 MIME 后字节一致时仍能去重；
 * 旧的字符串哈希 id 记录无需迁移，继续按原 id 存在。
 */
export async function storeImage(
  dataUrl: string,
  source: NonNullable<StoredImage['source']> = 'upload',
): Promise<string> {
  const id = await computeContentHash(dataUrl)
  const existing = await getImage(id)

  let localPath: string | undefined
  if (isElectron()) {
    if (existing?.localPath) {
      // 已存在且已有本地文件：跳过冗余写入（查重在写文件之前）
      localPath = existing.localPath
    } else {
      localPath = (await saveRawCacheImageToLocal(id, dataUrl)) || undefined
    }
  }

  if (!existing) {
    const thumbnail = await safeCreateImageThumbnail(dataUrl)
    await putImage({
      id,
      dataUrl: localPath ? undefined : dataUrl,
      localPath,
      createdAt: Date.now(),
      source,
      width: thumbnail.width,
      height: thumbnail.height,
    })
    if (thumbnail.thumbnailDataUrl) {
      await putImageThumbnail({
        id,
        thumbnailDataUrl: thumbnail.thumbnailDataUrl,
        width: thumbnail.width,
        height: thumbnail.height,
        thumbnailVersion: THUMBNAIL_VERSION,
      })
    }
  } else if (
    (await getStoredImageThumbnail(id))?.thumbnailVersion !== THUMBNAIL_VERSION ||
    (!existing.localPath && localPath)
  ) {
    const thumbnail = await safeCreateImageThumbnail(dataUrl)
    const updates: Partial<StoredImage> = {}
    if (
      thumbnail.width &&
      thumbnail.height &&
      (existing.width !== thumbnail.width || existing.height !== thumbnail.height)
    ) {
      updates.width = thumbnail.width
      updates.height = thumbnail.height
    }
    if (!existing.localPath && localPath) {
      updates.localPath = localPath
      updates.dataUrl = undefined // Clear dataUrl from DB if we successfully saved to localPath
    }
    if (Object.keys(updates).length > 0) {
      await putImage({ ...existing, ...updates })
    }
    if (thumbnail.thumbnailDataUrl) {
      await putImageThumbnail({
        id,
        thumbnailDataUrl: thumbnail.thumbnailDataUrl,
        width: thumbnail.width,
        height: thumbnail.height,
        thumbnailVersion: THUMBNAIL_VERSION,
      })
    }
  }
  return id
}

export async function batchDeleteImages(
  ids: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  if (ids.length === 0) return Promise.resolve()
  const uniqueIds = Array.from(new Set(ids))
  const images = await batchGetImages(uniqueIds)
  // 分批删除（IndexedDB 记录 + 磁盘缓存文件），避免超大事务/单次 IPC 阻塞主线程；
  // 同时向 UI 汇报真实进度，让「大量删除」不再是无反馈的长时间等待。
  const CHUNK_SIZE = 200
  for (let start = 0; start < uniqueIds.length; start += CHUNK_SIZE) {
    const chunk = uniqueIds.slice(start, start + CHUNK_SIZE)
    await openDB().then(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction([STORE_IMAGES, STORE_THUMBNAILS], 'readwrite')
          const imageStore = tx.objectStore(STORE_IMAGES)
          const thumbStore = tx.objectStore(STORE_THUMBNAILS)
          for (const id of chunk) {
            imageStore.delete(id)
            thumbStore.delete(id)
          }
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
          tx.onabort = () => reject(tx.error)
        }),
    )
    const chunkPaths = chunk.map((id) => images.get(id)?.localPath).filter((path): path is string => Boolean(path))
    if (chunkPaths.length > 0) await deleteRawCacheImages(chunkPaths)
    onProgress?.(Math.min(start + chunk.length, uniqueIds.length), uniqueIds.length)
  }
}

export function batchGetImages(ids: string[]): Promise<Map<string, StoredImage>> {
  if (ids.length === 0) return Promise.resolve(new Map())
  const uniqueIds = Array.from(new Set(ids))
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_IMAGES, 'readonly')
        const store = tx.objectStore(STORE_IMAGES)
        const map = new Map<string, StoredImage>()
        let pending = uniqueIds.length

        const finishOne = () => {
          pending--
          if (pending === 0) resolve(map)
        }

        for (const id of uniqueIds) {
          const req = store.get(id)
          req.onsuccess = () => {
            const image = req.result as StoredImage | undefined
            if (image) map.set(id, image)
            finishOne()
          }
          // 单条记录不可读（如 blob 文件缺失）时跳过该条，不让整批读取失败
          req.onerror = () => {
            if (isIrrecoverableBlobError(req.error)) {
              console.warn('[db] 图片记录不可读（跳过）:', id, req.error?.message)
              finishOne()
              return
            }
            reject(req.error)
          }
        }
      }),
  )
}

export function batchGetImageThumbnails(ids: string[]): Promise<Map<string, StoredImageThumbnail>> {
  if (ids.length === 0) return Promise.resolve(new Map())
  const uniqueIds = Array.from(new Set(ids))
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_THUMBNAILS, 'readonly')
        const store = tx.objectStore(STORE_THUMBNAILS)
        const map = new Map<string, StoredImageThumbnail>()
        let pending = uniqueIds.length

        const finishOne = () => {
          pending--
          if (pending === 0) resolve(map)
        }

        for (const id of uniqueIds) {
          const req = store.get(id)
          req.onsuccess = () => {
            const thumbnail = req.result as StoredImageThumbnail | undefined
            if (thumbnail) map.set(id, thumbnail)
            finishOne()
          }
          // 单条记录不可读（如 blob 文件缺失）时跳过该条，不让整批读取失败
          req.onerror = () => {
            if (isIrrecoverableBlobError(req.error)) {
              console.warn('[db] 缩略图记录不可读（跳过）:', id, req.error?.message)
              finishOne()
              return
            }
            reject(req.error)
          }
        }
      }),
  )
}

export function batchPutTasks(tasks: TaskRecord[]): Promise<void> {
  if (tasks.length === 0) return Promise.resolve()
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_TASKS, 'readwrite')
        const store = tx.objectStore(STORE_TASKS)
        for (const task of tasks) store.put(task)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }),
  )
}

export async function getStorageRecordCounts() {
  const [
    tasks,
    images,
    thumbnails,
    conversations,
    compositeAssets,
    generatedAssets,
    assetCollections,
    assetTags,
    assetTombstones,
  ] = await Promise.all([
    dbTransaction<number>(STORE_TASKS, 'readonly', (store) => store.count()),
    dbTransaction<number>(STORE_IMAGES, 'readonly', (store) => store.count()),
    dbTransaction<number>(STORE_THUMBNAILS, 'readonly', (store) => store.count()),
    dbTransaction<number>(STORE_AGENT_CONVERSATIONS, 'readonly', (store) => store.count()),
    dbTransaction<number>(STORE_COMPOSITE_ASSETS, 'readonly', (store) => store.count()),
    dbTransaction<number>(STORE_GENERATED_ASSETS, 'readonly', (store) => store.count()),
    dbTransaction<number>(STORE_ASSET_COLLECTIONS, 'readonly', (store) => store.count()),
    dbTransaction<number>(STORE_ASSET_TAGS, 'readonly', (store) => store.count()),
    dbTransaction<number>(STORE_ASSET_TOMBSTONES, 'readonly', (store) => store.count()),
  ])
  return {
    tasks,
    images,
    thumbnails,
    conversations,
    compositeAssets,
    generatedAssets,
    assetCollections,
    assetTags,
    assetTombstones,
  }
}

export function commitImportedRecords(records: {
  images: StoredImage[]
  thumbnails: StoredImageThumbnail[]
  tasks: TaskRecord[]
  replaceTasks?: boolean
}): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_IMAGES, STORE_THUMBNAILS, STORE_TASKS], 'readwrite')
        const imageStore = tx.objectStore(STORE_IMAGES)
        const thumbnailStore = tx.objectStore(STORE_THUMBNAILS)
        const taskStore = tx.objectStore(STORE_TASKS)
        if (records.replaceTasks) taskStore.clear()
        for (const image of records.images) imageStore.put(image)
        for (const thumbnail of records.thumbnails) thumbnailStore.put(thumbnail)
        for (const task of records.tasks) taskStore.put(task)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB import transaction aborted'))
      }),
  )
}

export function updateImageLocalPaths(mappings: Array<{ from: string; to: string }>): Promise<void> {
  if (mappings.length === 0) return Promise.resolve()
  const bySource = new Map(mappings.map((mapping) => [mapping.from, mapping.to]))
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_IMAGES, 'readwrite')
        const store = tx.objectStore(STORE_IMAGES)
        const request = store.openCursor()
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) return
          const image = cursor.value as StoredImage
          const localPath = image.localPath ? bySource.get(image.localPath) : undefined
          if (localPath) cursor.update({ ...image, localPath })
          cursor.continue()
        }
        request.onerror = () => reject(request.error)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB path migration aborted'))
      }),
  )
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = dataUrl
  })
}

async function createImageThumbnail(dataUrl: string): Promise<Omit<StoredImageThumbnail, 'id'>> {
  const image = await loadImage(dataUrl)
  const width = image.naturalWidth
  const height = image.naturalHeight
  if (width <= 0 || height <= 0) throw new Error('图片尺寸无效')

  const scale = Math.min(1, THUMBNAIL_MAX_SIZE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas')
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

  return {
    thumbnailDataUrl: canvas.toDataURL('image/webp', THUMBNAIL_QUALITY),
    width,
    height,
    thumbnailVersion: THUMBNAIL_VERSION,
  }
}

async function safeCreateImageThumbnail(dataUrl: string): Promise<Partial<Omit<StoredImageThumbnail, 'id'>>> {
  try {
    return await createImageThumbnail(dataUrl)
  } catch {
    return {}
  }
}

// ===== Generated asset library =====

/** 批量写入同 store；空数组直接完成，单事务保证原子性。 */
function putMany<T>(storeName: string, values: T[]): Promise<void> {
  if (values.length === 0) return Promise.resolve()
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite')
        const store = tx.objectStore(storeName)
        for (const value of values) store.put(value)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }),
  )
}

function deleteById(storeName: string, id: string): Promise<undefined> {
  return dbTransaction(storeName, 'readwrite', (s) => s.delete(id))
}

function clearStore(storeName: string): Promise<undefined> {
  return dbTransaction(storeName, 'readwrite', (s) => s.clear())
}

// ----- generatedAssets -----

export function getGeneratedAsset(id: string): Promise<GeneratedAsset | undefined> {
  return dbTransaction(STORE_GENERATED_ASSETS, 'readonly', (s) => s.get(id))
}

export function getAllGeneratedAssets(): Promise<GeneratedAsset[]> {
  return dbTransaction(STORE_GENERATED_ASSETS, 'readonly', (s) => s.getAll())
}

export function countGeneratedAssets(): Promise<number> {
  return dbTransaction(STORE_GENERATED_ASSETS, 'readonly', (s) => s.count())
}

/** 按 updatedAt 索引倒序取最近 N 条素材（用于镜像内容级校验，避免全表扫描）。 */
export function getRecentGeneratedAssets(limit: number): Promise<GeneratedAsset[]> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_GENERATED_ASSETS, 'readonly')
        const index = tx.objectStore(STORE_GENERATED_ASSETS).index('updatedAt')
        const req = index.openCursor(null, 'prev')
        const assets: GeneratedAsset[] = []
        req.onsuccess = () => {
          const cursor = req.result
          if (!cursor || assets.length >= limit) {
            resolve(assets)
            return
          }
          assets.push(cursor.value as GeneratedAsset)
          cursor.continue()
        }
        req.onerror = () => reject(req.error)
      }),
  )
}

export function putGeneratedAsset(asset: GeneratedAsset): Promise<IDBValidKey> {
  return dbTransaction(STORE_GENERATED_ASSETS, 'readwrite', (s) => s.put(asset))
}

export function putGeneratedAssets(assets: GeneratedAsset[]): Promise<void> {
  return putMany(STORE_GENERATED_ASSETS, assets)
}

export function batchGetGeneratedAssets(ids: string[]): Promise<Map<string, GeneratedAsset>> {
  if (ids.length === 0) return Promise.resolve(new Map())
  const uniqueIds = Array.from(new Set(ids))
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const store = db.transaction(STORE_GENERATED_ASSETS, 'readonly').objectStore(STORE_GENERATED_ASSETS)
        const map = new Map<string, GeneratedAsset>()
        let pending = uniqueIds.length
        for (const id of uniqueIds) {
          const req = store.get(id)
          req.onsuccess = () => {
            const asset = req.result as GeneratedAsset | undefined
            if (asset) map.set(id, asset)
            if (--pending === 0) resolve(map)
          }
          req.onerror = () => reject(req.error)
        }
      }),
  )
}

export function batchGetGeneratedAssetsByImageIds(imageIds: string[]): Promise<Map<string, GeneratedAsset>> {
  if (imageIds.length === 0) return Promise.resolve(new Map())
  const uniqueIds = Array.from(new Set(imageIds))
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const index = db
          .transaction(STORE_GENERATED_ASSETS, 'readonly')
          .objectStore(STORE_GENERATED_ASSETS)
          .index('imageId')
        const map = new Map<string, GeneratedAsset>()
        let pending = uniqueIds.length
        for (const imageId of uniqueIds) {
          const request = index.get(imageId)
          request.onsuccess = () => {
            const asset = request.result as GeneratedAsset | undefined
            if (asset) map.set(imageId, asset)
            if (--pending === 0) resolve(map)
          }
          request.onerror = () => reject(request.error)
        }
      }),
  )
}

export function deleteGeneratedAsset(id: string): Promise<undefined> {
  return deleteById(STORE_GENERATED_ASSETS, id)
}

export function clearGeneratedAssets(): Promise<undefined> {
  return clearStore(STORE_GENERATED_ASSETS)
}

// ----- assetUsageEvents -----

export function putAssetUsageEvent(event: AssetUsageEvent): Promise<IDBValidKey> {
  return dbTransaction(STORE_ASSET_USAGE_EVENTS, 'readwrite', (store) => store.put(event))
}

export function putAssetUsageEvents(events: AssetUsageEvent[]): Promise<void> {
  return putMany(STORE_ASSET_USAGE_EVENTS, events)
}

export function getAllAssetUsageEvents(): Promise<AssetUsageEvent[]> {
  return dbTransaction(STORE_ASSET_USAGE_EVENTS, 'readonly', (store) => store.getAll())
}

export function getAssetUsageEvents(assetId: string): Promise<AssetUsageEvent[]> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_ASSET_USAGE_EVENTS, 'readonly')
        const request = tx.objectStore(STORE_ASSET_USAGE_EVENTS).index('assetId').getAll(assetId)
        request.onsuccess = () =>
          resolve((request.result as AssetUsageEvent[]).sort((a, b) => b.occurredAt - a.occurredAt))
        request.onerror = () => reject(request.error)
      }),
  )
}

export function clearAssetUsageEvents(): Promise<undefined> {
  return clearStore(STORE_ASSET_USAGE_EVENTS)
}

// ----- asset identity records -----

export function putAssetBlobs(blobs: AssetBlob[]): Promise<void> {
  return putMany(STORE_ASSET_BLOBS, blobs)
}

export function getAllAssetBlobs(): Promise<AssetBlob[]> {
  return dbTransaction(STORE_ASSET_BLOBS, 'readonly', (store) => store.getAll())
}

export function clearAssetBlobs(): Promise<undefined> {
  return clearStore(STORE_ASSET_BLOBS)
}

export function putAssetVersions(versions: AssetVersion[]): Promise<void> {
  return putMany(STORE_ASSET_VERSIONS, versions)
}

export function getAllAssetVersions(): Promise<AssetVersion[]> {
  return dbTransaction(STORE_ASSET_VERSIONS, 'readonly', (store) => store.getAll())
}

export function clearAssetVersions(): Promise<undefined> {
  return clearStore(STORE_ASSET_VERSIONS)
}

export function deleteAssetVersionsForAsset(assetId: string): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_ASSET_VERSIONS, 'readwrite')
        const request = tx.objectStore(STORE_ASSET_VERSIONS).index('assetId').openCursor(IDBKeyRange.only(assetId))
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) return
          cursor.delete()
          cursor.continue()
        }
        request.onerror = () => reject(request.error)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      }),
  )
}

export function deleteAssetBlob(id: string): Promise<undefined> {
  return deleteById(STORE_ASSET_BLOBS, id)
}

export interface PurgeRecords {
  tasksToPatch: TaskRecord[]
  assetIds: string[]
  tombstones: AssetTombstone[]
}

/**
 * 永久删除素材的事务写入：任务输出补丁 + 删除素材记录 + 写墓碑在单个 IndexedDB 事务内完成。
 * 事务提交成功后才允许删除图片字节，保证“素材消失但任务仍指向旧图”的不一致状态不会出现。
 */
export function purgeGeneratedAssetsInTransaction(records: PurgeRecords): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_TASKS, STORE_GENERATED_ASSETS, STORE_ASSET_TOMBSTONES], 'readwrite')
        const tasksStore = tx.objectStore(STORE_TASKS)
        const assetsStore = tx.objectStore(STORE_GENERATED_ASSETS)
        const tombstonesStore = tx.objectStore(STORE_ASSET_TOMBSTONES)
        for (const task of records.tasksToPatch) tasksStore.put(task)
        for (const assetId of records.assetIds) assetsStore.delete(assetId)
        for (const tombstone of records.tombstones) tombstonesStore.put(tombstone)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }),
  )
}

// ----- assetCollections -----

export function getAssetCollection(id: string): Promise<AssetCollection | undefined> {
  return dbTransaction(STORE_ASSET_COLLECTIONS, 'readonly', (s) => s.get(id))
}

export function getAllAssetCollections(): Promise<AssetCollection[]> {
  return dbTransaction(STORE_ASSET_COLLECTIONS, 'readonly', (s) => s.getAll())
}

export function putAssetCollection(collection: AssetCollection): Promise<IDBValidKey> {
  return dbTransaction(STORE_ASSET_COLLECTIONS, 'readwrite', (s) => s.put(collection))
}

export function putAssetCollections(collections: AssetCollection[]): Promise<void> {
  return putMany(STORE_ASSET_COLLECTIONS, collections)
}

export function deleteAssetCollection(id: string): Promise<undefined> {
  return deleteById(STORE_ASSET_COLLECTIONS, id)
}

export function clearAssetCollections(): Promise<undefined> {
  return clearStore(STORE_ASSET_COLLECTIONS)
}

// ----- assetTags -----

export function getAssetTag(id: string): Promise<AssetTag | undefined> {
  return dbTransaction(STORE_ASSET_TAGS, 'readonly', (s) => s.get(id))
}

export function getAllAssetTags(): Promise<AssetTag[]> {
  return dbTransaction(STORE_ASSET_TAGS, 'readonly', (s) => s.getAll())
}

export function putAssetTag(tag: AssetTag): Promise<IDBValidKey> {
  return dbTransaction(STORE_ASSET_TAGS, 'readwrite', (s) => s.put(tag))
}

export function putAssetTags(tags: AssetTag[]): Promise<void> {
  return putMany(STORE_ASSET_TAGS, tags)
}

export function deleteAssetTag(id: string): Promise<undefined> {
  return deleteById(STORE_ASSET_TAGS, id)
}

export function clearAssetTags(): Promise<undefined> {
  return clearStore(STORE_ASSET_TAGS)
}

// ----- assetTombstones -----

export function getAssetTombstone(id: string): Promise<AssetTombstone | undefined> {
  return dbTransaction(STORE_ASSET_TOMBSTONES, 'readonly', (s) => s.get(id))
}

export function getAllAssetTombstones(): Promise<AssetTombstone[]> {
  return dbTransaction(STORE_ASSET_TOMBSTONES, 'readonly', (s) => s.getAll())
}

/** 按 imageId 批量查墓碑（走 imageId 索引，替代每次同步的全表扫描；v13 起索引可用）。 */
export function batchGetAssetTombstones(imageIds: string[]): Promise<Map<string, AssetTombstone>> {
  if (imageIds.length === 0) return Promise.resolve(new Map())
  const uniqueIds = Array.from(new Set(imageIds))
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_ASSET_TOMBSTONES, 'readonly')
        const store = tx.objectStore(STORE_ASSET_TOMBSTONES)
        const map = new Map<string, AssetTombstone>()
        let pending = uniqueIds.length

        const finishOne = () => {
          pending--
          if (pending === 0) resolve(map)
        }

        for (const imageId of uniqueIds) {
          const index = store.index('imageId')
          const req = index.getAll(imageId)
          req.onsuccess = () => {
            const tombstones = req.result as AssetTombstone[]
            for (const tombstone of tombstones) map.set(tombstone.imageId, tombstone)
            finishOne()
          }
          req.onerror = () => reject(req.error)
        }
      }),
  )
}

export function putAssetTombstone(tombstone: AssetTombstone): Promise<IDBValidKey> {
  return dbTransaction(STORE_ASSET_TOMBSTONES, 'readwrite', (s) => s.put(tombstone))
}

export function putAssetTombstones(tombstones: AssetTombstone[]): Promise<void> {
  return putMany(STORE_ASSET_TOMBSTONES, tombstones)
}

export function deleteAssetTombstone(id: string): Promise<undefined> {
  return deleteById(STORE_ASSET_TOMBSTONES, id)
}

export function clearAssetTombstones(): Promise<undefined> {
  return clearStore(STORE_ASSET_TOMBSTONES)
}

// ===== 旧版数据导入（设置页「数据管理」→ 导出/导入数据文件）=====

export interface LegacyStoreImportRecords {
  tasks?: TaskRecord[]
  /** 词条库（单记录 id='word-library'） */
  wordLibrary?: StoredWordLibraryState[]
  agentConversations?: AgentConversation[]
  /** 图片记录（Electron 下为轻量元数据：localPath 指向磁盘原图，dataUrl 可选） */
  images?: StoredImage[]
}

/**
 * 把「导出数据文件」的载荷写入 IndexedDB（单事务，已存在的主键默认跳过、不覆盖现有数据）。
 * replaceExisting=true 时对应 store 先清空再写入（「覆盖导入」语义，谨慎使用）。
 * 图片大字段（dataUrl/thumbnailDataUrl）缺失时不影响使用：缩略图会自动从磁盘 thumbs/ 恢复，
 * 原图经 localPath 直接读取。
 */
export function importLegacyStoreRecords(
  records: LegacyStoreImportRecords,
  replaceExisting = false,
): Promise<{ tasks: number; wordLibrary: number; agentConversations: number; images: number }> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(
          [STORE_TASKS, STORE_WORD_LIBRARY, STORE_AGENT_CONVERSATIONS, STORE_IMAGES],
          'readwrite',
        )
        const taskStore = tx.objectStore(STORE_TASKS)
        const wordStore = tx.objectStore(STORE_WORD_LIBRARY)
        const conversationStore = tx.objectStore(STORE_AGENT_CONVERSATIONS)
        const imageStore = tx.objectStore(STORE_IMAGES)

        if (replaceExisting) {
          if (records.tasks?.length) taskStore.clear()
          if (records.wordLibrary?.length) wordStore.clear()
          if (records.agentConversations?.length) conversationStore.clear()
          if (records.images?.length) imageStore.clear()
        }

        let taskCount = 0
        let wordCount = 0
        let conversationCount = 0
        let imageCount = 0

        // 事务内「先查后写」：已存在主键跳过（不覆盖）；事务会在全部请求完成后触发 oncomplete
        const putIfMissing = <T>(store: IDBObjectStore, recordsToPut: T[], count: () => void) => {
          for (const record of recordsToPut) {
            const getReq = store.get((record as { id: string }).id)
            getReq.onsuccess = () => {
              if (!getReq.result) {
                store.put(record)
                count()
              }
            }
            getReq.onerror = () => {
              // 单条读取失败不阻断其余记录
            }
          }
        }

        if (records.tasks?.length) putIfMissing(taskStore, records.tasks, () => taskCount++)
        if (records.wordLibrary?.length) putIfMissing(wordStore, records.wordLibrary, () => wordCount++)
        if (records.agentConversations?.length)
          putIfMissing(conversationStore, records.agentConversations, () => conversationCount++)
        if (records.images?.length) putIfMissing(imageStore, records.images, () => imageCount++)

        tx.oncomplete = () =>
          resolve({
            tasks: taskCount,
            wordLibrary: wordCount,
            agentConversations: conversationCount,
            images: imageCount,
          })
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB import transaction aborted'))
      }),
  )
}
