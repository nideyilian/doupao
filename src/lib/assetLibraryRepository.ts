import type {
  AssetCatalogCursorPage,
  AssetCatalogQuery,
  AssetCollection,
  AssetPatch,
  AssetTag,
  AssetTombstone,
  GeneratedAsset,
  TaskRecord,
} from '../types'
import {
  applyAssetPatch,
  collectCollectionSubtreeIds,
  normalizeAsset,
  normalizeCollection,
  normalizeTag,
  normalizeTombstone,
} from './assetLibraryModel'
import {
  batchGetAssetTombstones,
  batchGetGeneratedAssets,
  batchGetGeneratedAssetsByImageIds,
  batchGetImages,
  deleteAssetCollection,
  deleteAssetTag,
  deleteAssetTombstone,
  deleteGeneratedAsset as deleteGeneratedAssetRecord,
  getAllAssetCollections,
  getAllAssetTags,
  getAllAssetTombstones,
  getAllGeneratedAssets,
  getAssetCollection,
  getAssetTombstone,
  getGeneratedAsset,
  putAssetCollection,
  putAssetCollections,
  putAssetTags,
  putAssetTombstones,
  putGeneratedAsset as putGeneratedAssetRecord,
  putGeneratedAssets as putGeneratedAssetRecords,
  putAssetBlobs,
  putAssetVersions,
  deleteAssetVersionsForAsset,
  deleteAssetBlob,
  getAllAssetBlobs,
  getAllAssetVersions,
} from './db'
import { buildGeneratedAssetsFromTask, type AssetTaskContext } from './generatedAssetOrigin'
import { materializeAssetRecords } from './assetIdentity'
import { queryAssets, toByTagRecord } from '../features/assetLibrary/query'
import { createTextVector, rankAssetCandidates } from './assetSemanticSearch'
import { withAssetWriteLock } from './assetWriteLock'

export type { AssetTaskContext }

export interface AssetLibrarySnapshot {
  assets: GeneratedAsset[]
  collections: AssetCollection[]
  tags: AssetTag[]
  tombstones: AssetTombstone[]
}

/**
 * SQLite 目录后端（Electron 权威存储）的最小能力接口。
 * 渲染端所有素材领域读写都优先走主进程 IPC；无 electronAPI 时（浏览器/测试）回退 IndexedDB。
 */
interface CatalogBackendApi {
  assetCatalogQuery: (query: AssetCatalogQuery) => Promise<AssetCatalogCursorPage>
  assetCatalogUpsert: (records: Array<{ asset: GeneratedAsset; localPath?: string }>) => Promise<{ success: boolean }>
  assetCatalogPurge: (assetIds: string[], now: number) => Promise<{ purged: string[]; tombstones: AssetTombstone[] }>
  assetCatalogDelete: (assetIds: string[]) => Promise<{ success: boolean }>
  assetCatalogExportAll: () => Promise<GeneratedAsset[]>
  assetCatalogGetAssetsByIds: (ids: string[]) => Promise<GeneratedAsset[]>
  assetCatalogGetCollections: () => Promise<AssetCollection[]>
  assetCatalogPutCollections: (records: AssetCollection[]) => Promise<{ success: boolean }>
  assetCatalogDeleteCollection: (id: string) => Promise<{ success: boolean }>
  assetCatalogTrashCollection?: (id: string) => Promise<{ success: boolean }>
  assetCatalogRestoreCollection?: (id: string) => Promise<{ success: boolean }>
  assetCatalogGetTags: () => Promise<AssetTag[]>
  assetCatalogPutTags: (records: AssetTag[]) => Promise<{ success: boolean }>
  assetCatalogDeleteTag: (id: string) => Promise<{ success: boolean }>
  assetCatalogGetTombstones: (imageIds: string[]) => Promise<AssetTombstone[]>
  assetCatalogGetAllTombstones: () => Promise<AssetTombstone[]>
  assetCatalogPutTombstones: (records: AssetTombstone[]) => Promise<{ success: boolean }>
  assetCatalogDeleteTombstone: (imageId: string) => Promise<{ success: boolean }>
  assetCatalogMetaGet: (key: string) => Promise<string | null>
  assetCatalogMetaSet: (key: string, value: string) => Promise<{ success: boolean }>
}

function catalogApi(): CatalogBackendApi | null {
  if (typeof window === 'undefined') return null
  const api = window.electronAPI
  if (!api) return null
  if (
    !api.assetCatalogQuery ||
    !api.assetCatalogUpsert ||
    !api.assetCatalogPurge ||
    !api.assetCatalogExportAll ||
    !api.assetCatalogGetAssetsByIds ||
    !api.assetCatalogGetCollections ||
    !api.assetCatalogPutCollections ||
    !api.assetCatalogGetTags ||
    !api.assetCatalogPutTags ||
    !api.assetCatalogGetTombstones ||
    !api.assetCatalogGetAllTombstones ||
    !api.assetCatalogPutTombstones ||
    !api.assetCatalogMetaGet ||
    !api.assetCatalogMetaSet
  ) {
    return null
  }
  return api as CatalogBackendApi
}

const CATALOG_META_LEGACY_BACKFILL = 'idb-asset-library-v1'

/** 进程内门控：每个会话只做一次旧数据回填（引用图构建会频繁调用 hydrateFull）。 */
let legacySyncDone = false

/**
 * 一次性把旧版 IndexedDB 素材库数据回填到 SQLite（资产按 meta 门控跨会话执行一次；
 * 项目/标签/墓碑幂等且廉价，每个会话同步一次，保证过渡期一致性）。
 */
async function syncLegacyAssetMetadataToCatalog(api: CatalogBackendApi): Promise<void> {
  if (legacySyncDone) return
  try {
    const backfilled = await api.assetCatalogMetaGet(CATALOG_META_LEGACY_BACKFILL)
    if (backfilled === null) {
      const [collections, tags, tombstones, legacyAssets] = await Promise.all([
        getAllAssetCollections(),
        getAllAssetTags(),
        getAllAssetTombstones(),
        getAllGeneratedAssets(),
      ])
      if (legacyAssets.length > 0) {
        const images = await batchGetImages(legacyAssets.map((asset) => asset.imageId))
        await api.assetCatalogUpsert(
          legacyAssets.map((asset) => ({
            asset: normalizeAsset(asset),
            localPath: images.get(asset.imageId)?.localPath,
          })),
        )
      }
      await api.assetCatalogMetaSet(CATALOG_META_LEGACY_BACKFILL, String(Date.now()))
      if (collections.length > 0) {
        await api.assetCatalogPutCollections(
          collections.map(normalizeCollection).filter((c): c is AssetCollection => c !== null),
        )
      }
      if (tags.length > 0) {
        await api.assetCatalogPutTags(tags.map(normalizeTag).filter((t): t is AssetTag => t !== null))
      }
      if (tombstones.length > 0) {
        await api.assetCatalogPutTombstones(
          tombstones.map(normalizeTombstone).filter((t): t is AssetTombstone => t !== null),
        )
      }
    }
    legacySyncDone = true
  } catch (error) {
    // 回填失败不阻塞水合：SQLite 侧数据仍可用，缺口由启动 reconciliation 补齐
    console.warn('[asset-catalog] 旧数据回填失败（可忽略，将靠 reconciliation 补齐）', error)
  }
}

// ===== 读取 =====

export async function hydrate(): Promise<AssetLibrarySnapshot> {
  const api = catalogApi()
  if (api) {
    await syncLegacyAssetMetadataToCatalog(api)
    const [collections, tags, tombstones, page] = await Promise.all([
      api.assetCatalogGetCollections?.(),
      api.assetCatalogGetTags?.(),
      api.assetCatalogGetAllTombstones?.() ?? Promise.resolve([] as AssetTombstone[]),
      api.assetCatalogQuery({
        scope: 'all',
        query: '',
        filters: {},
        sortKey: 'updatedAt',
        sortOrder: 'desc',
        limit: 200,
      }),
    ])
    return {
      assets: (page?.assets ?? []).map((asset) => normalizeAsset(asset)),
      collections: (collections ?? []).map(normalizeCollection).filter((c): c is AssetCollection => c !== null),
      tags: (tags ?? []).map(normalizeTag).filter((t): t is AssetTag => t !== null),
      tombstones: (tombstones ?? []).map(normalizeTombstone).filter((t): t is AssetTombstone => t !== null),
    }
  }
  const [collections, tags, tombstones] = await Promise.all([
    getAllAssetCollections(),
    getAllAssetTags(),
    getAllAssetTombstones(),
  ])
  const assets = await getAllGeneratedAssets()
  return {
    assets: assets.map((a) => normalizeAsset(a)),
    collections: collections.map(normalizeCollection).filter((c): c is AssetCollection => c !== null),
    tags: tags.map(normalizeTag).filter((t): t is AssetTag => t !== null),
    tombstones: tombstones.map(normalizeTombstone).filter((t): t is AssetTombstone => t !== null),
  }
}

export async function getAsset(id: string): Promise<GeneratedAsset | undefined> {
  const api = catalogApi()
  if (api) {
    const assets = await api.assetCatalogGetAssetsByIds?.([id])
    const asset = assets?.[0]
    return asset ? normalizeAsset(asset) : undefined
  }
  const direct = await getGeneratedAsset(id)
  const asset = direct ?? (await batchGetGeneratedAssetsByImageIds([id])).get(id)
  return asset ? normalizeAsset(asset) : undefined
}

/**
 * 全量快照（供备份导出、备份合并等需要完整素材集合的场景）。
 * Electron 下直接读 SQLite 全量（不走 hydrate 的分页窗口，修复桌面端备份只含 ≤200 条素材的问题）；
 * 浏览器环境回退 IndexedDB 全量。
 */
export async function hydrateFull(): Promise<AssetLibrarySnapshot> {
  const api = catalogApi()
  if (api) {
    await syncLegacyAssetMetadataToCatalog(api)
    const [collections, tags, tombstones, assets] = await Promise.all([
      api.assetCatalogGetCollections?.(),
      api.assetCatalogGetTags?.(),
      api.assetCatalogGetAllTombstones?.() ?? Promise.resolve([] as AssetTombstone[]),
      api.assetCatalogExportAll?.(),
    ])
    return {
      assets: (assets ?? []).map((asset) => normalizeAsset(asset)),
      collections: (collections ?? []).map(normalizeCollection).filter((c): c is AssetCollection => c !== null),
      tags: (tags ?? []).map(normalizeTag).filter((t): t is AssetTag => t !== null),
      tombstones: (tombstones ?? []).map(normalizeTombstone).filter((t): t is AssetTombstone => t !== null),
    }
  }
  const [collections, tags, tombstones] = await Promise.all([
    getAllAssetCollections(),
    getAllAssetTags(),
    getAllAssetTombstones(),
  ])
  let assets: GeneratedAsset[]
  try {
    assets = await getAllGeneratedAssets()
  } catch (error) {
    console.warn('[asset-library] IndexedDB 全量读取失败', error)
    assets = []
  }
  return {
    assets: assets.map((asset) => normalizeAsset(asset)),
    collections: collections.map(normalizeCollection).filter((c): c is AssetCollection => c !== null),
    tags: tags.map(normalizeTag).filter((t): t is AssetTag => t !== null),
    tombstones: tombstones.map(normalizeTombstone).filter((t): t is AssetTombstone => t !== null),
  }
}

export async function getAssetsByIds(ids: string[]): Promise<Map<string, GeneratedAsset>> {
  const unique = Array.from(new Set(ids))
  if (unique.length === 0) return new Map()
  const api = catalogApi()
  if (api) {
    const assets = await api.assetCatalogGetAssetsByIds?.(unique)
    return new Map((assets ?? []).map((asset) => [asset.id, normalizeAsset(asset)]))
  }
  const byId = await batchGetGeneratedAssets(unique)
  const missing = unique.filter((id) => !byId.has(id))
  const byImageId = missing.length
    ? await batchGetGeneratedAssetsByImageIds(missing)
    : new Map<string, GeneratedAsset>()
  const result = new Map<string, GeneratedAsset>()
  for (const id of unique) {
    const asset = byId.get(id) ?? byImageId.get(id)
    if (asset) result.set(id, normalizeAsset(asset))
  }
  return result
}

export async function queryAssetCatalog(input: AssetCatalogQuery): Promise<AssetCatalogCursorPage> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  if (api?.assetCatalogQuery) return api.assetCatalogQuery(input)
  const snapshot = await hydrate()
  const result = queryAssets(snapshot, input)
  const offset = input.cursor ? Number.parseInt(input.cursor, 10) || 0 : 0
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 100)))
  const assets = result.assets.slice(offset, offset + limit)
  return {
    assets,
    totalCount: result.totalCount,
    nextCursor: offset + assets.length < result.totalCount ? String(offset + assets.length) : null,
    counts: {
      ...result.counts,
      byCollection: Object.fromEntries(result.counts.byCollection),
      byTag: toByTagRecord(result.counts.byTag),
    },
  }
}

export async function recommendAssets(input: {
  query?: string
  context?: string
  similarToAssetId?: string
  limit?: number
}) {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  if (api?.assetCatalogRecommend) return api.assetCatalogRecommend(input)
  const snapshot = await hydrate()
  const queryVector = createTextVector(`${input.query ?? ''} ${input.context ?? ''}`)
  const candidates = snapshot.assets
    .filter((asset) => asset.status === 'active')
    .map((asset) => {
      const text = asset.origins.map((origin) => `${origin.prompt} ${origin.revisedPrompt ?? ''}`).join(' ')
      return { assetId: asset.id, asset, textVector: createTextVector(text), contextText: text }
    })
  return rankAssetCandidates(candidates, { queryVector, context: input.context })
    .slice(0, Math.max(1, Math.min(50, input.limit ?? 12)))
    .map((item) => ({ asset: item.asset, score: item.score }))
}

export async function getAssetsByImageIds(imageIds: string[]): Promise<Map<string, GeneratedAsset>> {
  const unique = Array.from(new Set(imageIds))
  const api = catalogApi()
  if (api) {
    // 导入素材 id === imageId；生成素材 id 为 `asset:<imageId>`。主进程按 id 查询，
    // 因此必须同时带 `asset:` 前缀查询——否则生成素材会被误判为不存在，
    // upsertFromTask 会把它当新素材重建（清空 collectionIds/tagIds/评分等），导致用户整理被覆盖丢失。
    const queryIds = [...unique, ...unique.map((id) => `asset:${id}`)]
    const assets = await api.assetCatalogGetAssetsByIds?.(queryIds)
    const result = new Map<string, GeneratedAsset>()
    for (const asset of assets ?? []) {
      const key = asset.imageId || asset.id
      if (unique.includes(key)) result.set(key, normalizeAsset(asset))
    }
    return result
  }
  const byImageId = await batchGetGeneratedAssetsByImageIds(unique)
  return new Map([...byImageId].map(([imageId, asset]) => [imageId, normalizeAsset(asset)]))
}

export async function listAssets(): Promise<GeneratedAsset[]> {
  const api = catalogApi()
  if (api) {
    const assets = await api.assetCatalogExportAll?.()
    return (assets ?? []).map((asset) => normalizeAsset(asset))
  }
  const assets = await getAllGeneratedAssets()
  return assets.map((a) => normalizeAsset(a))
}

// ===== 素材写入 =====

/**
 * 内部写实现（不持锁；调用方负责持锁，避免嵌套）。
 * Electron：SQLite 是权威存储，直接走主进程 upsert（主进程负责 blob/版本/向量/感知哈希）；
 * 非 Electron：写 IndexedDB（blobs/versions 同库维护）。
 */
async function persistIdentityAndMirrorUnlocked(assets: GeneratedAsset[]): Promise<GeneratedAsset[]> {
  if (assets.length === 0) return []
  const normalized = assets.map((asset) => normalizeAsset(asset))
  const api = catalogApi()
  if (api) {
    const images = await batchGetImages(normalized.map((asset) => asset.imageId))
    const records = normalized.map((asset) => ({
      asset,
      localPath: images.get(asset.imageId)?.localPath,
    }))
    try {
      await api.assetCatalogUpsert(records)
    } catch (error) {
      // 权威写失败不静默：进入重试队列，避免目录缺素材
      console.warn('[asset-catalog] 素材写入失败，进入重试队列', error)
      enqueueMirrorRetry(
        'upsert',
        records.map((record) => ({ asset: record.asset, localPath: record.localPath })),
      )
    }
    return normalized
  }
  const images = await batchGetImages(normalized.map((asset) => asset.imageId))
  const parentIds = [...new Set(normalized.flatMap((asset) => asset.parentAssetIds))]
  const parents = parentIds.length ? await batchGetGeneratedAssets(parentIds) : new Map<string, GeneratedAsset>()
  const records = normalized.map((asset) =>
    materializeAssetRecords(
      asset,
      images.get(asset.imageId),
      asset.parentAssetIds.flatMap((id) =>
        parents.get(id)?.currentVersionId ? [parents.get(id)!.currentVersionId!] : [],
      ),
    ),
  )
  await Promise.all([
    putGeneratedAssetRecords(normalized),
    putAssetBlobs(records.map((record) => record.blob)),
    putAssetVersions(records.map((record) => record.version)),
  ])
  return normalized
}

// ===== asset-kernel 镜像重试队列 =====
// 镜像写（assetCatalogUpsert / assetCatalogDelete）失败时带退避重试，
// 防止渲染端 IndexedDB 与主进程 SQLite 镜像静默不一致；超过次数上限后放弃并记日志。

interface MirrorRetryItem {
  kind: 'upsert' | 'delete'
  payload: unknown[]
  attempts: number
}

let mirrorRetryQueue: MirrorRetryItem[] = []
let mirrorRetryTimer: ReturnType<typeof setTimeout> | null = null
const MIRROR_RETRY_MAX_ATTEMPTS = 5
const MIRROR_RETRY_INTERVAL_MS = 8000

function scheduleMirrorRetryFlush() {
  if (mirrorRetryTimer || mirrorRetryQueue.length === 0) return
  mirrorRetryTimer = setTimeout(() => {
    mirrorRetryTimer = null
    void flushMirrorRetryQueue()
  }, MIRROR_RETRY_INTERVAL_MS)
}

function enqueueMirrorRetry(kind: 'upsert' | 'delete', payload: unknown[]) {
  mirrorRetryQueue.push({ kind, payload, attempts: 0 })
  scheduleMirrorRetryFlush()
}

async function flushMirrorRetryQueue() {
  const batch = mirrorRetryQueue
  mirrorRetryQueue = []
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  if (!api?.assetCatalogUpsert || !api.assetCatalogDelete) return
  const retry: MirrorRetryItem[] = []
  for (const item of batch) {
    try {
      if (item.kind === 'upsert') {
        await api.assetCatalogUpsert(item.payload as Array<{ asset: GeneratedAsset; localPath?: string }>)
      } else {
        await api.assetCatalogDelete(item.payload as string[])
      }
    } catch (error) {
      item.attempts++
      if (item.attempts < MIRROR_RETRY_MAX_ATTEMPTS) {
        retry.push(item)
      } else {
        console.warn('[asset-mirror] 镜像写入多次失败，放弃', item.kind, error)
      }
    }
  }
  if (retry.length > 0) {
    mirrorRetryQueue = [...retry, ...mirrorRetryQueue]
    scheduleMirrorRetryFlush()
  }
}

export async function putGeneratedAsset(asset: GeneratedAsset): Promise<IDBValidKey> {
  const [saved] = await withAssetWriteLock(() => persistIdentityAndMirrorUnlocked([asset]))
  return saved.id
}

export async function putGeneratedAssets(assets: GeneratedAsset[]): Promise<void> {
  await withAssetWriteLock(() => persistIdentityAndMirrorUnlocked(assets))
}

export async function putAsset(asset: GeneratedAsset): Promise<GeneratedAsset> {
  const normalized = normalizeAsset(asset)
  await putGeneratedAsset(normalized)
  return normalized
}

/**
 * 将任务的每个输出槽位幂等 upsert 为素材。
 * - 相同 imageId 已有素材时只追加/更新来源快照，不复制文件、不新增卡片。
 * - 命中墓碑（任务早于永久删除时间）的槽位直接跳过，避免“复活”已删除素材。
 * - 被 `purgedOutputSlots` 标记的槽位跳过。
 * - 批量读取与批量写入，单个事务提交。
 * - 墓碑检查与素材写入持有同一把写锁（与 purge 串行），杜绝 TOCTOU：purge
 *   提交之后才写入的素材不会再绕过墓碑快照。
 */
export async function upsertFromTask(task: TaskRecord, context: AssetTaskContext): Promise<GeneratedAsset[]> {
  const outputs = task.outputImages ?? []
  if (outputs.length === 0) return []
  const purgedSlots = new Set(task.purgedOutputSlots ?? [])
  const activeOutputs = outputs.map((imageId, slot) => ({ imageId, slot })).filter(({ slot }) => !purgedSlots.has(slot))
  if (activeOutputs.length === 0) return []

  const candidateIds = Array.from(
    new Set([
      ...activeOutputs.map((o) => o.imageId),
      ...(task.inputImageIds ?? []),
      ...(task.maskTargetImageId ? [task.maskTargetImageId] : []),
      ...(task.maskImageId ? [task.maskImageId] : []),
    ]),
  )
  return withAssetWriteLock(async () => {
    const [assetsById, tombstoneByImage, imagesById] = await Promise.all([
      getAssetsByImageIds(candidateIds),
      // SQLite 权威读取墓碑（Electron 走 IPC；浏览器回退 IndexedDB 索引查询）
      getTombstonesByImageIds(candidateIds),
      batchGetImages(activeOutputs.map((output) => output.imageId)),
    ])
    const changed = buildGeneratedAssetsFromTask(task, context, assetsById, tombstoneByImage, Date.now(), imagesById)
    if (changed.length > 0) await persistIdentityAndMirrorUnlocked(changed)
    return changed
  })
}

export async function patchAssets(ids: string[], patch: AssetPatch): Promise<GeneratedAsset[]> {
  const unique = Array.from(new Set(ids))
  if (unique.length === 0) return []
  const assetsById = await getAssetsByIds(unique)
  const now = Date.now()
  const updated: GeneratedAsset[] = []
  for (const id of unique) {
    const asset = assetsById.get(id)
    if (!asset) continue
    updated.push(applyAssetPatch(asset, patch, now))
  }
  if (updated.length > 0) await putGeneratedAssets(updated)
  return updated
}

/** 按素材差异化补丁（如删除标签时各素材移除各自含有的引用）；一次读取、一次批量写入。 */
export async function patchAssetsIndividually(
  patches: Array<{ id: string; patch: AssetPatch }>,
): Promise<GeneratedAsset[]> {
  if (patches.length === 0) return []
  const byId = new Map(patches.map((entry) => [entry.id, entry.patch]))
  const ids = Array.from(byId.keys())
  const assetsById = await getAssetsByIds(ids)
  const now = Date.now()
  const updated: GeneratedAsset[] = []
  for (const id of ids) {
    const asset = assetsById.get(id)
    const patch = byId.get(id)
    if (!asset || !patch) continue
    updated.push(applyAssetPatch(asset, patch, now))
  }
  if (updated.length > 0) await putGeneratedAssets(updated)
  return updated
}

/** 大批量状态变更的分块大小：单次「读取 + 写入」上限，避免大选择时长时间无反馈。 */
const BATCH_MUTATION_CHUNK = 400

async function applyTrashStatus(
  ids: string[],
  status: 'trashed' | 'active',
  now: number,
  onProgress?: (done: number, total: number) => void,
): Promise<GeneratedAsset[]> {
  const unique = Array.from(new Set(ids))
  if (unique.length === 0) return []
  const updated: GeneratedAsset[] = []
  const total = unique.length
  for (let start = 0; start < unique.length; start += BATCH_MUTATION_CHUNK) {
    const chunk = unique.slice(start, start + BATCH_MUTATION_CHUNK)
    const assetsById = await getAssetsByIds(chunk)
    const changed: GeneratedAsset[] = []
    for (const id of chunk) {
      const asset = assetsById.get(id)
      if (!asset || (status === 'trashed' ? asset.status === 'trashed' : asset.status !== 'trashed')) continue
      changed.push(
        status === 'trashed'
          ? { ...asset, status: 'trashed', trashedAt: now, updatedAt: now }
          : { ...asset, status: 'active', trashedAt: null, updatedAt: now },
      )
    }
    if (changed.length > 0) await putGeneratedAssets(changed)
    updated.push(...changed)
    onProgress?.(Math.min(start + chunk.length, total), total)
  }
  return updated
}

export async function moveToTrash(
  ids: string[],
  now = Date.now(),
  onProgress?: (done: number, total: number) => void,
): Promise<GeneratedAsset[]> {
  return applyTrashStatus(ids, 'trashed', now, onProgress)
}

export async function restore(
  ids: string[],
  now = Date.now(),
  onProgress?: (done: number, total: number) => void,
): Promise<GeneratedAsset[]> {
  return applyTrashStatus(ids, 'active', now, onProgress)
}

export async function removeAsset(id: string): Promise<void> {
  await deleteGeneratedAsset(id)
}

export async function deleteGeneratedAsset(id: string): Promise<undefined> {
  // 与 persistIdentityAndMirror 串行：孤儿 blob 清理（按引用计数推断）不再与
  // 并发写入竞态误删共享 blob。
  return withAssetWriteLock(async () => {
    const api = catalogApi()
    if (api?.assetCatalogDelete) {
      await api.assetCatalogDelete([id])
      return undefined
    }
    const asset = await getAsset(id)
    if (!asset) return undefined
    await deleteGeneratedAssetRecord(asset.id)
    await deleteAssetVersionsForAsset(asset.id)
    const [versions, blobs] = await Promise.all([getAllAssetVersions(), getAllAssetBlobs()])
    const referencedBlobIds = new Set(versions.map((version) => version.blobId))
    await Promise.all(blobs.filter((blob) => !referencedBlobIds.has(blob.id)).map((blob) => deleteAssetBlob(blob.id)))
    return undefined
  })
}

// ===== 项目（集合）=====

export async function listCollections(): Promise<AssetCollection[]> {
  const api = catalogApi()
  if (api) {
    const collections = await api.assetCatalogGetCollections?.()
    return (collections ?? []).map(normalizeCollection).filter((c): c is AssetCollection => c !== null)
  }
  const collections = await getAllAssetCollections()
  return collections.map(normalizeCollection).filter((c): c is AssetCollection => c !== null)
}

export async function putCollection(collection: AssetCollection): Promise<AssetCollection> {
  const normalized = normalizeCollection(collection)
  if (!normalized) throw new Error('集合数据不合法')
  const api = catalogApi()
  if (api) {
    await api.assetCatalogPutCollections?.([normalized])
    return normalized
  }
  await putAssetCollection(normalized)
  return normalized
}

export async function putCollections(collections: AssetCollection[]): Promise<void> {
  const normalized = collections.map(normalizeCollection).filter((c): c is AssetCollection => c !== null)
  if (normalized.length === 0) return
  const api = catalogApi()
  if (api) {
    await api.assetCatalogPutCollections?.(normalized)
    return
  }
  await putAssetCollections(normalized)
}

export async function removeCollection(id: string, promotedChildren: AssetCollection[] = []): Promise<void> {
  const api = catalogApi()
  if (api) {
    // 主进程单事务完成「提升子级 + 剥离素材引用 + 删除行」，保证原子性。
    await api.assetCatalogDeleteCollection?.(id)
    return
  }
  // 浏览器回退（IndexedDB）：提升子级 + 剥离引用 + 删除。
  if (promotedChildren.length > 0) await putAssetCollections(promotedChildren)
  const assets = (await listAssets()).map(normalizeAsset)
  const updated = assets
    .filter((asset) => asset.collectionIds.includes(id))
    .map((asset) => ({
      ...asset,
      collectionIds: asset.collectionIds.filter((collectionId) => collectionId !== id),
      updatedAt: Date.now(),
    }))
  if (updated.length > 0) await putGeneratedAssets(updated)
  await deleteAssetCollection(id)
}

export async function getCollection(id: string): Promise<AssetCollection | undefined> {
  const api = catalogApi()
  if (api) {
    const collections = await api.assetCatalogGetCollections?.()
    const collection = (collections ?? []).find((item) => item.id === id)
    return collection ? (normalizeCollection(collection) ?? undefined) : undefined
  }
  const collection = await getAssetCollection(id)
  return collection ? (normalizeCollection(collection) ?? undefined) : undefined
}

/** 软删除项目：整棵子树进文件夹回收站（Electron 主进程单事务；浏览器回退 IndexedDB）。 */
export async function trashCollection(id: string): Promise<void> {
  const api = catalogApi()
  if (api) {
    await api.assetCatalogTrashCollection?.(id)
    return
  }
  const collections = (await getAllAssetCollections())
    .map(normalizeCollection)
    .filter((c): c is AssetCollection => c !== null)
  const ids = collectCollectionSubtreeIds(collections, id)
  const now = Date.now()
  await putAssetCollections(
    collections.filter((c) => ids.includes(c.id)).map((c) => ({ ...c, trashedAt: now, updatedAt: now })),
  )
}

/** 恢复项目：清除整棵子树的软删除标记。 */
export async function restoreCollection(id: string): Promise<void> {
  const api = catalogApi()
  if (api) {
    await api.assetCatalogRestoreCollection?.(id)
    return
  }
  const collections = (await getAllAssetCollections())
    .map(normalizeCollection)
    .filter((c): c is AssetCollection => c !== null)
  const ids = collectCollectionSubtreeIds(collections, id)
  const now = Date.now()
  await putAssetCollections(
    collections.filter((c) => ids.includes(c.id)).map((c) => ({ ...c, trashedAt: null, updatedAt: now })),
  )
}

// ===== 标签（兼容数据：仅备份导入/合并使用，界面已无标签入口）=====

export async function putTags(tags: AssetTag[]): Promise<void> {
  const normalized = tags.map(normalizeTag).filter((t): t is AssetTag => t !== null)
  if (normalized.length === 0) return
  const api = catalogApi()
  if (api) {
    await api.assetCatalogPutTags?.(normalized)
    return
  }
  await putAssetTags(normalized)
}

/** 删除标签：Electron 侧 SQLite 自动把子标签提升为父级父级的子级并剥离素材引用；浏览器侧同步执行相同语义。 */
export async function deleteTagRecord(id: string): Promise<void> {
  const api = catalogApi()
  if (api) {
    await api.assetCatalogDeleteTag?.(id)
    return
  }
  const tags = (await getAllAssetTags()).map(normalizeTag).filter((t): t is AssetTag => t !== null)
  const removed = tags.find((tag) => tag.id === id)
  if (!removed) return
  const now = Date.now()
  const promoted = tags
    .filter((tag) => tag.parentId === id)
    .map((tag) => ({ ...tag, parentId: removed.parentId, updatedAt: now }))
  if (promoted.length > 0) await putAssetTags(promoted)
  await deleteAssetTag(id)
}

function mergeAsset(existing: GeneratedAsset | undefined, imported: GeneratedAsset): GeneratedAsset {
  if (!existing) return imported
  const origins = new Map(existing.origins.map((origin) => [origin.key, origin]))
  for (const origin of imported.origins) origins.set(origin.key, origin)
  return normalizeAsset({
    ...existing,
    ...imported,
    status: existing.status === 'active' || imported.status === 'active' ? 'active' : 'trashed',
    createdAt: Math.min(existing.createdAt, imported.createdAt),
    updatedAt: Math.max(existing.updatedAt, imported.updatedAt),
    favorite: existing.favorite || imported.favorite,
    rating: existing.rating >= imported.rating ? existing.rating : imported.rating,
    collectionIds: [...new Set([...existing.collectionIds, ...imported.collectionIds])],
    tagIds: [...new Set([...existing.tagIds, ...imported.tagIds])],
    origins: [...origins.values()],
    parentAssetIds: [...new Set([...existing.parentAssetIds, ...imported.parentAssetIds])],
    width: imported.width ?? existing.width,
    height: imported.height ?? existing.height,
    mimeType: imported.mimeType ?? existing.mimeType,
    byteSize: imported.byteSize ?? existing.byteSize,
  })
}

/** 将备份中的素材库按稳定 id 合并，保留本地标记、来源与衍生关系。 */
export async function mergeImportedAssetLibrary(imported: AssetLibrarySnapshot): Promise<AssetLibrarySnapshot> {
  const current = await hydrateFull()
  const collections = new Map(current.collections.map((collection) => [collection.id, collection]))
  const tags = new Map(current.tags.map((tag) => [tag.id, tag]))
  const assets = new Map(current.assets.map((asset) => [asset.id, asset]))
  const tombstones = new Map(current.tombstones.map((tombstone) => [tombstone.imageId, tombstone]))

  for (const collection of imported.collections) collections.set(collection.id, collection)
  for (const tag of imported.tags) tags.set(tag.id, tag)
  for (const asset of imported.assets) assets.set(asset.id, mergeAsset(assets.get(asset.id), asset))
  for (const tombstone of imported.tombstones) {
    const existing = tombstones.get(tombstone.imageId)
    tombstones.set(
      tombstone.imageId,
      existing
        ? {
            ...tombstone,
            purgedAt: Math.max(existing.purgedAt, tombstone.purgedAt),
            lastOriginOccurredAt: Math.max(existing.lastOriginOccurredAt, tombstone.lastOriginOccurredAt),
          }
        : tombstone,
    )
  }

  const snapshot = {
    assets: [...assets.values()],
    collections: [...collections.values()],
    tags: [...tags.values()],
    tombstones: [...tombstones.values()],
  }
  await Promise.all([
    putGeneratedAssets(snapshot.assets),
    putCollections(snapshot.collections),
    putTags(snapshot.tags),
    putTombstones(snapshot.tombstones),
  ])
  return snapshot
}

// ===== 墓碑 =====

/** 按 imageId 批量读取墓碑（Electron 走 SQLite；浏览器回退 IndexedDB 索引查询）。 */
export async function getTombstonesByImageIds(imageIds: string[]): Promise<Map<string, AssetTombstone>> {
  const unique = Array.from(new Set(imageIds))
  const api = catalogApi()
  if (api) {
    const tombstones = await api.assetCatalogGetTombstones?.(unique)
    return new Map((tombstones ?? []).map((tombstone) => [tombstone.imageId, tombstone]))
  }
  return batchGetAssetTombstones(unique)
}

export async function getTombstone(imageId: string): Promise<AssetTombstone | undefined> {
  const api = catalogApi()
  if (api) {
    const tombstones = await api.assetCatalogGetTombstones?.([imageId])
    const tombstone = tombstones?.[0]
    return tombstone ? (normalizeTombstone(tombstone) ?? undefined) : undefined
  }
  const tombstone = await getAssetTombstone(imageId)
  return tombstone ? (normalizeTombstone(tombstone) ?? undefined) : undefined
}

export async function listTombstones(): Promise<AssetTombstone[]> {
  const api = catalogApi()
  if (api) {
    const tombstones = await api.assetCatalogGetAllTombstones?.()
    return (tombstones ?? []).map(normalizeTombstone).filter((t): t is AssetTombstone => t !== null)
  }
  const tombstones = await getAllAssetTombstones()
  return tombstones.map(normalizeTombstone).filter((t): t is AssetTombstone => t !== null)
}

export async function putTombstone(tombstone: AssetTombstone): Promise<void> {
  await putTombstones([tombstone])
}

export async function putTombstones(tombstones: AssetTombstone[]): Promise<void> {
  if (tombstones.length === 0) return
  const api = catalogApi()
  if (api) {
    await api.assetCatalogPutTombstones?.(tombstones)
    return
  }
  await putAssetTombstones(tombstones)
}

export async function removeTombstone(imageId: string): Promise<void> {
  const api = catalogApi()
  if (api) {
    await api.assetCatalogDeleteTombstone?.(imageId)
    return
  }
  await deleteAssetTombstone(imageId)
}
