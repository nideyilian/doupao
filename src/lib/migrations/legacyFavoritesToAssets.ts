import type {
  AssetCollection,
  AssetTombstone,
  FavoriteCollection,
  GeneratedAsset,
  TaskRecord,
  WorkspaceTab,
} from '../../types'
import { getAllTasks } from '../db'
import { hydrate, putCollections, putGeneratedAssets } from '../assetLibraryRepository'
import { buildGeneratedAssetsFromTask, getTaskSourceMode } from '../generatedAssetOrigin'
import { runMigration, type MigrationJournalStore } from './registry'

export const LEGACY_FAVORITES_TO_ASSETS_MIGRATION_ID = 'legacy-favorites-to-assets-v1'

/**
 * 识别“收藏影子任务”：收藏标记存在但不在任何工作区标签页中的任务。
 * 这些任务是早期“收藏时复制一份”机制的副本，迁移时不得追加伪来源。
 */
export function identifyShadowFavoriteTasks(tasks: TaskRecord[], workspaceTabs: WorkspaceTab[]): Set<string> {
  const claimed = new Set<string>()
  for (const tab of workspaceTabs) {
    for (const task of tab.tasks) claimed.add(task.id)
    for (const taskId of tab._taskIds ?? []) claimed.add(taskId)
  }
  const shadow = new Set<string>()
  for (const task of tasks) {
    const isFavorite = task.isFavorite === true || (task.favoriteCollectionIds?.length ?? 0) > 0
    if (isFavorite && !claimed.has(task.id)) shadow.add(task.id)
  }
  return shadow
}

export interface FavoriteMappingInput {
  tasks: TaskRecord[]
  workspaceTabs: WorkspaceTab[]
  favoriteCollections: FavoriteCollection[]
  defaultFavoriteCollectionId: string | null
  existingAssets: ReadonlyMap<string, GeneratedAsset>
  existingCollections: ReadonlyMap<string, AssetCollection>
  tombstones: ReadonlyMap<string, AssetTombstone>
  shadowTaskIds?: ReadonlySet<string>
  now?: number
}

export interface FavoriteMappingResult {
  assets: GeneratedAsset[]
  collections: AssetCollection[]
  shadowTaskIds: ReadonlySet<string>
}

/**
 * 将旧收藏映射到素材：
 * - 影子任务只设置已存在素材的 favorite，不追加来源。
 * - 正常收藏任务先追加来源再设置 favorite。
 * - 默认收藏夹只映射收藏状态；非默认收藏夹创建/复用同名项目。
 * 纯函数，不写库。
 */
export function buildFavoriteMappings(input: FavoriteMappingInput): FavoriteMappingResult {
  const {
    tasks,
    workspaceTabs,
    favoriteCollections,
    defaultFavoriteCollectionId,
    existingAssets,
    existingCollections,
    tombstones,
    now = Date.now(),
  } = input
  const shadowTaskIds = input.shadowTaskIds ?? identifyShadowFavoriteTasks(tasks, workspaceTabs)

  const collectionsById = new Map<string, FavoriteCollection>()
  for (const collection of favoriteCollections) collectionsById.set(collection.id, collection)

  const collectionByName = new Map<string, AssetCollection>()
  for (const collection of existingCollections.values()) {
    collectionByName.set(collection.normalizedName, collection)
  }
  const createdCollections: AssetCollection[] = []

  const getOrCreateProject = (name: string): AssetCollection | null => {
    const normalizedName = name.toLocaleLowerCase('zh-CN')
    const existing = collectionByName.get(normalizedName)
    if (existing) return existing
    const created: AssetCollection = {
      id: `proj-${now}-${createdCollections.length}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      normalizedName,
      parentId: null,
      order: createdCollections.length,
      createdAt: now,
      updatedAt: now,
    }
    createdCollections.push(created)
    collectionByName.set(normalizedName, created)
    return created
  }

  const assetsById = new Map<string, GeneratedAsset>(existingAssets)
  const changedAssets = new Map<string, GeneratedAsset>()

  const markFavorite = (asset: GeneratedAsset, projectIds: string[]): GeneratedAsset => {
    const next = {
      ...asset,
      favorite: true,
      collectionIds: Array.from(new Set([...asset.collectionIds, ...projectIds])),
      updatedAt: now,
    }
    changedAssets.set(asset.id, next)
    assetsById.set(asset.id, next)
    return next
  }

  for (const task of tasks) {
    const isFavorite = task.isFavorite === true || (task.favoriteCollectionIds?.length ?? 0) > 0
    if (!isFavorite) continue
    const isShadow = shadowTaskIds.has(task.id)
    const projectIds: string[] = []
    for (const collectionId of task.favoriteCollectionIds ?? []) {
      const collection = collectionsById.get(collectionId)
      if (!collection || collection.id === defaultFavoriteCollectionId) continue
      const project = getOrCreateProject(collection.name)
      if (project) projectIds.push(project.id)
    }

    const outputs = task.outputImages ?? []
    if (outputs.length === 0) continue
    if (isShadow) {
      // 影子任务：只对已存在的素材设置收藏，不追加来源
      for (const imageId of outputs) {
        const asset = assetsById.get(imageId)
        if (asset) markFavorite(asset, projectIds)
      }
      continue
    }

    const upserted = buildGeneratedAssetsFromTask(
      task,
      { sourceMode: getTaskSourceMode(task) },
      assetsById,
      tombstones,
      now,
    )
    for (const asset of upserted) {
      assetsById.set(asset.id, asset)
      changedAssets.set(asset.id, asset)
      markFavorite(asset, projectIds)
    }
  }

  return {
    assets: [...changedAssets.values()],
    collections: createdCollections,
    shadowTaskIds,
  }
}

export interface LegacyFavoritesMigrationOptions {
  tasks?: TaskRecord[]
  workspaceTabs?: WorkspaceTab[]
  favoriteCollections?: FavoriteCollection[]
  defaultFavoriteCollectionId?: string | null
  onProgress?: (processed: number, total: number) => void
}

/** 旧收藏迁移入口：读库 → 纯转换 → 批量写。幂等，可重试。 */
export function runLegacyFavoritesToAssetsMigration(
  journalStore: MigrationJournalStore,
  options: LegacyFavoritesMigrationOptions = {},
): Promise<void> {
  return runMigration(LEGACY_FAVORITES_TO_ASSETS_MIGRATION_ID, journalStore, async () => {
    const tasks = options.tasks ?? (await getAllTasks())
    if (tasks.length === 0) return
    const snapshot = await hydrate()
    const existingCollections = new Map<string, AssetCollection>()
    for (const collection of snapshot.collections) {
      existingCollections.set(collection.id, collection)
    }

    const { assets, collections } = buildFavoriteMappings({
      tasks,
      workspaceTabs: options.workspaceTabs ?? [],
      favoriteCollections: options.favoriteCollections ?? [],
      defaultFavoriteCollectionId: options.defaultFavoriteCollectionId ?? null,
      existingAssets: new Map(snapshot.assets.map((a) => [a.id, a])),
      existingCollections,
      tombstones: new Map(snapshot.tombstones.map((t) => [t.imageId, t])),
    })

    if (collections.length > 0) await putCollections(collections)
    if (assets.length > 0) await putGeneratedAssets(assets)
    options.onProgress?.(tasks.length, tasks.length)
  })
}
