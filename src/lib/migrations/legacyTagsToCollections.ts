import type { AssetCollection, AssetTag, GeneratedAsset } from '../../types'
import { hydrateFull, putCollections, putGeneratedAssets } from '../assetLibraryRepository'
import { runMigration, type MigrationJournalStore } from './registry'

export const LEGACY_TAGS_TO_COLLECTIONS_MIGRATION_ID = 'legacy-tags-to-collections-v1'

/**
 * 旧版本（0.7.56 及之前）的「标签」在用户心智里就是项目文件夹：
 * 树形、多级、可把素材归入。当前版本侧边栏移除了标签入口，标签数据保留但不再展示，
 * 导致旧用户的素材归属在升级后"看不见"。
 *
 * 本迁移把标签体系一次性镜像为项目文件夹体系：
 * - 每个标签 → 同名项目文件夹（保持 parentId 层级；同父级下已有同名文件夹时复用，不重复创建）；
 * - 素材的 tagIds → collectionIds 合并（保留已有项目归属）；
 * - 标签数据本身保留（不删除，兼容旧备份恢复）。
 *
 * 与曾经"每次启动自动镜像"不同：本迁移由迁移日志（journal）保证只执行一次，
 * 用户之后删除文件夹不会被重新创建。
 */
export interface TagToCollectionMappingInput {
  tags: AssetTag[]
  /** 已有项目文件夹（避免与手动创建的同名文件夹重复） */
  existingCollections: AssetCollection[]
  /** 全量素材（含回收站，保证恢复后归属仍在） */
  assets: GeneratedAsset[]
  now?: number
}

export interface TagToCollectionMappingResult {
  /** 需要新建的项目文件夹 */
  createdCollections: AssetCollection[]
  /** collectionIds 发生变化的素材 */
  changedAssets: GeneratedAsset[]
}

export function buildTagToCollectionMappings(input: TagToCollectionMappingInput): TagToCollectionMappingResult {
  const now = input.now ?? Date.now()
  const collectionById = new Map<string, AssetCollection>()
  const collectionByKey = new Map<string, AssetCollection>()
  for (const collection of input.existingCollections) {
    collectionById.set(collection.id, collection)
    collectionByKey.set(`${collection.parentId ?? ''}\u0000${collection.normalizedName}`, collection)
  }

  const tagById = new Map(input.tags.map((tag) => [tag.id, tag]))
  const collectionIdByTagId = new Map<string, string>()
  const created: AssetCollection[] = []
  // 成环保护：标签 parentId 异常成环时终止，避免死循环
  const visiting = new Set<string>()

  const resolveTagCollection = (tag: AssetTag): AssetCollection | null => {
    const mapped = collectionIdByTagId.get(tag.id)
    if (mapped) return collectionById.get(mapped) ?? null
    if (visiting.has(tag.id)) return null
    visiting.add(tag.id)

    const parentCollectionId = tag.parentId
      ? (resolveTagCollection(tagById.get(tag.parentId) as AssetTag)?.id ?? null)
      : null

    const key = `${parentCollectionId ?? ''}\u0000${tag.normalizedName}`
    const existing = collectionByKey.get(key)
    if (existing) {
      collectionIdByTagId.set(tag.id, existing.id)
      visiting.delete(tag.id)
      return existing
    }

    const createdCollection: AssetCollection = {
      id: `col-tag-${now}-${created.length}-${Math.random().toString(36).slice(2, 8)}`,
      name: tag.name,
      normalizedName: tag.normalizedName,
      parentId: parentCollectionId,
      order: tag.order ?? created.length,
      color: tag.color,
      trashedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    created.push(createdCollection)
    collectionById.set(createdCollection.id, createdCollection)
    collectionByKey.set(key, createdCollection)
    collectionIdByTagId.set(tag.id, createdCollection.id)
    visiting.delete(tag.id)
    return createdCollection
  }

  for (const tag of input.tags) resolveTagCollection(tag)

  // 素材归属：tagIds → collectionIds 合并（保留已有项目归属；无变化的素材不写）
  const changedAssets: GeneratedAsset[] = []
  if (collectionIdByTagId.size > 0) {
    for (const asset of input.assets) {
      if (!asset.tagIds || asset.tagIds.length === 0) continue
      const projectIds = asset.tagIds
        .map((tagId) => collectionIdByTagId.get(tagId))
        .filter((id): id is string => id != null)
      if (projectIds.length === 0) continue
      const nextCollectionIds = Array.from(new Set([...asset.collectionIds, ...projectIds]))
      if (nextCollectionIds.length === asset.collectionIds.length) continue
      changedAssets.push({ ...asset, collectionIds: nextCollectionIds, updatedAt: now })
    }
  }

  return { createdCollections: created, changedAssets }
}

export interface LegacyTagsToCollectionsMigrationOptions {
  tags?: AssetTag[]
  collections?: AssetCollection[]
  assets?: GeneratedAsset[]
  onProgress?: (processed: number, total: number) => void
}

/** 标签 → 项目文件夹迁移入口：读全量快照 → 纯转换 → 批量写。幂等，可重试。 */
export function runLegacyTagsToCollectionsMigration(
  journalStore: MigrationJournalStore,
  options: LegacyTagsToCollectionsMigrationOptions = {},
): Promise<void> {
  return runMigration(LEGACY_TAGS_TO_COLLECTIONS_MIGRATION_ID, journalStore, async () => {
    const snapshot = options.tags
      ? { tags: options.tags, collections: options.collections ?? [], assets: options.assets ?? [] }
      : await hydrateFull()
    if (snapshot.tags.length === 0) return

    const { createdCollections, changedAssets } = buildTagToCollectionMappings({
      tags: snapshot.tags,
      existingCollections: snapshot.collections,
      assets: snapshot.assets,
    })

    if (createdCollections.length > 0) await putCollections(createdCollections)
    if (changedAssets.length > 0) await putGeneratedAssets(changedAssets)
    options.onProgress?.(changedAssets.length, snapshot.assets.length)
  })
}
