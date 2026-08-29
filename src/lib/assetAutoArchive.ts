import type { AssetCollection, AssetPatch, GeneratedAsset, SopBatchSnapshot, TaskRecord } from '../types'
import {
  getFolderPath,
  LEGACY_PROMPT_GROUPS_STORAGE_KEY,
  normalizePromptLibraryFolders,
  PROMPT_LIBRARY_FOLDERS_STORAGE_KEY,
  type PromptLibraryFolder,
} from '../features/strategy/adapters/promptLibraryTree'
import { getAllSopBatchSnapshots, getSopBatchSnapshot } from './db'
import { getAssetsByIds, hydrateFull, patchAssets, putCollection } from './assetLibraryRepository'
import { createEmptyCollection } from './assetLibraryModel'

/**
 * 批次 → 项目文件夹自动归档（幂等）：
 *
 * 把词库（提示词库）树状文件夹镜像到素材库「项目」树——批次快照的 promptGroup 指向词库树节点，
 * 按该节点到根的路径（名称层级，备份恢复后按名重建）在项目树中逐级查找/创建同名文件夹，
 * 并把该批次产出的素材自动加入最深层文件夹。
 *
 * 数据安全：只新增文件夹与「追加」collectionIds，绝不删除/改写既有项目、标签或素材；
 * 同名同层级的文件夹复用，重复运行不产生重复数据。
 */

export interface BatchAutoArchiveResult {
  /** 参与归档的批次数量 */
  batches: number
  /** 新建的项目文件夹数量 */
  createdFolders: number
  /** 归档（追加到文件夹）的素材数量 */
  archivedAssets: number
  /** 本次新建的项目文件夹记录（供调用方同步进素材库内存态，侧栏立即可见） */
  createdCollections?: AssetCollection[]
}

export interface BatchAutoArchiveDeps {
  readFolders: (runs: SopBatchSnapshot[]) => PromptLibraryFolder[]
  getSnapshots: () => Promise<SopBatchSnapshot[]>
  getTasks: () => Promise<TaskRecord[]>
  getFullSnapshot: () => Promise<{ assets: GeneratedAsset[]; collections: AssetCollection[] }>
  putCollection: (collection: AssetCollection) => Promise<AssetCollection>
  patchAssets: (ids: string[], patch: AssetPatch) => Promise<GeneratedAsset[]>
}

export const EMPTY_ARCHIVE_RESULT: BatchAutoArchiveResult = { batches: 0, createdFolders: 0, archivedAssets: 0 }

/** 读取词库文件夹树（localStorage v2 → v1 回退），并用批次快照补齐孤儿文件夹。 */
export function readPromptLibraryFolders(runs: SopBatchSnapshot[]): PromptLibraryFolder[] {
  let raw: unknown = []
  if (typeof window !== 'undefined') {
    try {
      const stored =
        window.localStorage.getItem(PROMPT_LIBRARY_FOLDERS_STORAGE_KEY) ??
        window.localStorage.getItem(LEGACY_PROMPT_GROUPS_STORAGE_KEY) ??
        '[]'
      raw = JSON.parse(stored)
    } catch {
      /* 忽略损坏的本地存储 */
    }
  }
  return normalizePromptLibraryFolders(raw, runs)
}

function defaultDeps(): BatchAutoArchiveDeps {
  return {
    readFolders: readPromptLibraryFolders,
    getSnapshots: () => getAllSopBatchSnapshots(),
    getTasks: async () => {
      const { useStore } = await import('../store')
      return useStore.getState().tasks as TaskRecord[]
    },
    getFullSnapshot: async () => {
      const full = await hydrateFull()
      return { assets: full.assets, collections: full.collections }
    },
    putCollection: (collection) => putCollection(collection),
    patchAssets: (ids, patch) => patchAssets(ids, patch),
  }
}

/** 在项目树中按名称层级查找/创建文件夹链；返回叶子文件夹 id、新建数量与新建的文件夹记录。 */
export async function ensureFolderChain(
  segments: string[],
  collections: AssetCollection[],
  deps: Pick<BatchAutoArchiveDeps, 'putCollection'>,
): Promise<{ leafId: string; created: number; createdCollections: AssetCollection[] }> {
  let parentId: string | null = null
  let created = 0
  const createdCollections: AssetCollection[] = []
  for (const rawSegment of segments) {
    const name = rawSegment.trim()
    if (!name) continue
    const existing = collections.find((collection) => collection.parentId === parentId && collection.name === name)
    if (existing) {
      parentId = existing.id
      continue
    }
    const collection: AssetCollection = {
      ...createEmptyCollection(),
      name,
      normalizedName: name.toLocaleLowerCase('zh-CN'),
      parentId,
      order: collections.filter((item) => item.parentId === parentId).length,
    }
    const saved = await deps.putCollection(collection)
    // 本次运行内的后续层级立即复用（幂等且避免重复创建）
    collections.push(saved)
    parentId = saved.id
    created++
    createdCollections.push(saved)
  }
  return { leafId: parentId ?? '', created, createdCollections }
}

function batchMatchesTask(run: SopBatchSnapshot, task: TaskRecord | undefined): boolean {
  if (!task?.sopBatch) return false
  return task.sopBatch.snapshotId === run.id || task.sopBatch.batchId === run.batchId
}

/** 收集批次产出的素材 id：快照 taskIds/batchIds → 任务输出；任务已删除的素材按 origins 反查。 */
export function collectBatchAssetIds(
  run: SopBatchSnapshot,
  assets: GeneratedAsset[],
  tasksById: ReadonlyMap<string, TaskRecord>,
): string[] {
  const result = new Set<string>()
  for (const taskId of run.taskIds ?? []) {
    const task = tasksById.get(taskId)
    if (task) for (const imageId of task.outputImages) result.add(imageId)
  }
  for (const batchId of run.batchIds ?? []) {
    for (const task of tasksById.values()) {
      if (task.sopBatch?.batchId === batchId) for (const imageId of task.outputImages) result.add(imageId)
    }
  }
  for (const asset of assets) {
    if (asset.origins.some((origin) => batchMatchesTask(run, tasksById.get(origin.taskId)))) result.add(asset.id)
  }
  return [...result]
}

/** 启动/按需全量补齐：扫描全部批次快照，把素材自动归档到词库路径对应的项目文件夹。幂等。 */
export async function autoArchiveBatchAssets(
  overrides: Partial<BatchAutoArchiveDeps> = {},
): Promise<BatchAutoArchiveResult> {
  const deps: BatchAutoArchiveDeps = { ...defaultDeps(), ...overrides }
  const runs = await deps.getSnapshots()
  if (runs.length === 0) return EMPTY_ARCHIVE_RESULT
  const folders = deps.readFolders(runs)
  const [full, tasks] = await Promise.all([deps.getFullSnapshot(), deps.getTasks()])
  const tasksById = new Map(tasks.map((task) => [task.id, task]))
  const collections = [...full.collections.filter((collection) => !collection.trashedAt)]
  const assetsById = new Map(full.assets.map((asset) => [asset.id, asset]))
  const patches = new Map<string, string[]>()
  let createdFolders = 0
  const createdCollections: AssetCollection[] = []
  let batches = 0

  for (const run of runs) {
    const group = run.promptGroup
    if (!group?.id || !group.name.trim()) continue
    const path = getFolderPath(folders, group.id)
    const segments = path.map((folder) => folder.name)
    if (segments.length === 0) continue
    const { leafId, created, createdCollections: chain } = await ensureFolderChain(segments, collections, deps)
    createdFolders += created
    createdCollections.push(...chain)
    if (!leafId) continue
    const assetIds = collectBatchAssetIds(run, full.assets, tasksById)
    let archived = 0
    for (const assetId of assetIds) {
      const asset = assetsById.get(assetId)
      if (!asset || asset.collectionIds.includes(leafId)) continue
      const pending = patches.get(assetId) ?? [...asset.collectionIds]
      if (pending.includes(leafId)) continue
      patches.set(assetId, [...pending, leafId])
      archived++
    }
    if (archived > 0 || assetIds.length > 0) batches++
  }

  let archivedAssets = 0
  for (const [assetId, collectionIds] of patches) {
    try {
      await deps.patchAssets([assetId], { collectionIds })
      archivedAssets++
    } catch (error) {
      console.warn('[asset-auto-archive] 归档素材失败', assetId, error)
    }
  }
  return { batches, createdFolders, archivedAssets, createdCollections }
}

/** 新任务产出即时归档：仅处理该批次，轻量路径（不做全量扫描）。幂等。 */
export async function archiveTaskToBatchFolder(task: TaskRecord): Promise<BatchAutoArchiveResult> {
  const meta = task.sopBatch
  if (!meta) return EMPTY_ARCHIVE_RESULT
  const snapshot = await getSopBatchSnapshot(meta.snapshotId || meta.batchId)
  if (!snapshot?.promptGroup) return EMPTY_ARCHIVE_RESULT
  const folders = readPromptLibraryFolders([snapshot])
  const path = getFolderPath(folders, snapshot.promptGroup.id)
  const segments = path.map((folder) => folder.name)
  if (segments.length === 0) return EMPTY_ARCHIVE_RESULT
  const full = await hydrateFull()
  const { leafId, created, createdCollections } = await ensureFolderChain(
    segments,
    [...full.collections.filter((collection) => !collection.trashedAt)],
    {
      putCollection,
    },
  )
  if (!leafId) return EMPTY_ARCHIVE_RESULT

  const existing = await getAssetsByIds(task.outputImages)
  let archived = 0
  for (const imageId of task.outputImages) {
    const asset = existing.get(imageId)
    if (!asset || asset.collectionIds.includes(leafId)) continue
    try {
      await patchAssets([imageId], { collectionIds: [...asset.collectionIds, leafId] })
      archived++
    } catch (error) {
      console.warn('[asset-auto-archive] 归档素材失败', imageId, error)
    }
  }
  return {
    batches: archived > 0 || created > 0 ? 1 : 0,
    createdFolders: created,
    archivedAssets: archived,
    createdCollections,
  }
}
