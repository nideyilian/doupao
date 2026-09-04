import type { AssetTombstone, GeneratedAsset, TaskRecord } from '../types'
import type { ImageReference, ImageReferenceGraph } from './imageReferenceGraph'
import { getBlockingReferences, getTaskOutputReferences } from './imageReferenceGraph'
import type { PurgeRecords } from './db'
import { withAssetWriteLock } from './assetWriteLock'

export interface AssetPurgeBlockedItem {
  assetId: string
  imageId: string
  /** 阻断引用（拥有型）；asset-original 自身与 task-output 不计入 */
  references: ImageReference[]
}

export interface TaskOutputCleanup {
  taskId: string
  outputSlots: number[]
}

/** 强制清空时需要解除的引用：删除素材前先把这些拥有型引用从归属记录中剥离。 */
export interface ForceDetachItem {
  /** 被永久删除的图片 id（即被删除素材的 imageId） */
  imageId: string
  /** 需要解除的拥有型引用（task-input / mask / gallery-draft / agent-conversation / sop-reference 等） */
  references: ImageReference[]
}

export interface AssetPurgePlan {
  allowedAssetIds: string[]
  blocked: AssetPurgeBlockedItem[]
  taskOutputCleanups: TaskOutputCleanup[]
  imageIdsToDelete: string[]
  tombstones: AssetTombstone[]
  /**
   * 需要解除的引用（force 模式下收集；非 force 模式为空数组）。
   * 与 blocked 互斥：force 时被引用素材不再阻断，而是进入 allowed 并在此登记引用。
   */
  forceDetach: ForceDetachItem[]
}

export interface AssetPurgePlannerInput {
  assetIds: string[]
  assets: GeneratedAsset[]
  tasks: TaskRecord[]
  graph: ImageReferenceGraph
  now?: number
}

export interface AssetPurgePlannerOptions {
  /**
   * 强制模式：拥有型引用不再阻断删除。被引用素材同样进入删除计划，
   * 其引用在删除前由调用方统一解除（见 forceDetach）。
   */
  force?: boolean
}

/**
 * 永久删除计划器（纯函数）。
 * - 默认：拥有型引用（素材被其他任务输入、Agent 会话等引用）阻断删除。
 * - force：被引用素材照常删除，同时把待解除的引用登记到 forceDetach，由调用方在删除前剥离。
 * - 允许删除的素材收集其所有任务输出映射与墓碑。
 */
export function planAssetPurge(input: AssetPurgePlannerInput, options: AssetPurgePlannerOptions = {}): AssetPurgePlan {
  const { assetIds, assets, graph, now = Date.now() } = input
  const force = options.force === true
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]))
  const allowed: string[] = []
  const blocked: AssetPurgeBlockedItem[] = []
  const forceDetach: ForceDetachItem[] = []
  const taskOutputCleanups = new Map<string, number[]>()
  const imageIdsToDelete = new Set<string>()
  // 墓碑按 imageId 去重：同一 imageId 的重复素材（历史遗留）只产出一条墓碑
  const tombstoneByImage = new Map<string, AssetTombstone>()

  for (const assetId of assetIds) {
    const asset = assetsById.get(assetId)
    if (!asset) continue
    const blockingRefs = getBlockingReferences(graph, asset.imageId).filter(
      (ref) => !(ref.type === 'asset-original' && ref.ownerId === asset.id),
    )
    if (blockingRefs.length > 0 && !force) {
      blocked.push({ assetId, imageId: asset.imageId, references: blockingRefs })
      continue
    }
    allowed.push(assetId)
    imageIdsToDelete.add(asset.imageId)
    if (blockingRefs.length > 0) forceDetach.push({ imageId: asset.imageId, references: blockingRefs })
    for (const ref of getTaskOutputReferences(graph, asset.imageId)) {
      const slots = taskOutputCleanups.get(ref.taskId) ?? []
      if (!slots.includes(ref.outputSlot)) slots.push(ref.outputSlot)
      taskOutputCleanups.set(ref.taskId, slots)
    }
    let lastOriginOccurredAt = asset.createdAt
    for (const origin of asset.origins) {
      const occurredAt = origin.taskFinishedAt ?? origin.taskCreatedAt
      if (occurredAt > lastOriginOccurredAt) lastOriginOccurredAt = occurredAt
    }
    const existing = tombstoneByImage.get(asset.imageId)
    if (existing) {
      if (lastOriginOccurredAt > existing.lastOriginOccurredAt) existing.lastOriginOccurredAt = lastOriginOccurredAt
    } else {
      tombstoneByImage.set(asset.imageId, {
        id: asset.imageId,
        imageId: asset.imageId,
        purgedAt: now,
        lastOriginOccurredAt,
      })
    }
  }

  return {
    allowedAssetIds: allowed,
    blocked,
    taskOutputCleanups: [...taskOutputCleanups.entries()].map(([taskId, outputSlots]) => ({ taskId, outputSlots })),
    imageIdsToDelete: [...imageIdsToDelete],
    tombstones: [...tombstoneByImage.values()],
    forceDetach,
  }
}

/** 将任务中被永久删除的输出槽位置空并清理按图索引的字段；槽位数量保持不变。 */
export function patchTaskForPurgedSlots(task: TaskRecord, slots: number[]): TaskRecord {
  const slotSet = new Set(slots)
  const outputImages = [...(task.outputImages ?? [])]
  const removedImageIds = new Set<string>()
  for (const slot of slotSet) {
    if (slot >= 0 && slot < outputImages.length) {
      const imageId = outputImages[slot]
      if (imageId) removedImageIds.add(imageId)
      outputImages[slot] = undefined as never
    }
  }
  const purgeImageMap = <T>(record: Record<string, T> | undefined): Record<string, T> | undefined => {
    if (!record) return record
    const next: Record<string, T> = {}
    for (const [imageId, value] of Object.entries(record)) {
      if (!removedImageIds.has(imageId)) next[imageId] = value
    }
    return next
  }
  const purgeLocalPathMap = (record: Record<string, string> | undefined): Record<string, string> | undefined => {
    if (!record) return record
    const next: Record<string, string> = {}
    for (const [key, value] of Object.entries(record)) {
      const imageId = key.includes(':') ? key.slice(key.indexOf(':') + 1) : key
      if (!removedImageIds.has(imageId)) next[key] = value
    }
    return next
  }
  return {
    ...task,
    outputImages,
    generationSlots: (task.generationSlots ?? []).filter((slot) => !slotSet.has(slot.index)),
    actualParamsByImage: purgeImageMap(task.actualParamsByImage),
    revisedPromptByImage: purgeImageMap(task.revisedPromptByImage),
    localSavedOutputImagePaths: purgeLocalPathMap(task.localSavedOutputImagePaths),
    // rawImageUrls 是 URL 列表（非按图索引），保留原样
    purgedOutputSlots: Array.from(new Set([...(task.purgedOutputSlots ?? []), ...slots])).sort((a, b) => a - b),
  }
}

export interface AssetPurgeExecutorDeps {
  getTask: (taskId: string) => Promise<TaskRecord | undefined>
  purgeRecords: (records: PurgeRecords) => Promise<void>
  /** 删除单张图片字节（IndexedDB 图片+缩略图，以及磁盘缓存文件）；批量接口缺省时逐张调用 */
  deleteImage?: (imageId: string) => Promise<void>
  /** 批量删除图片字节（分块提交）；性能远优于逐张删除，优先使用。onProgress 用于汇报删除进度 */
  deleteImages?: (imageIds: string[], onProgress?: (done: number, total: number) => void) => Promise<void>
}

export type AssetPurgeProgressStage = 'records' | 'images'

/**
 * 执行永久删除计划。
 * 事务（任务补丁 + 删素材 + 写墓碑）提交成功后才删除图片字节。
 * 写墓碑与删素材持有素材写锁（与 upsertFromTask 串行），保证之后同步队列的
 * 墓碑检查一定能看到本次 purge 写入的墓碑，素材不会"复活"。
 * onProgress 回调用于 UI 反馈：'records' = 删除素材记录（SQLite/IndexedDB 事务），
 * 'images' = 清理图片字节（带 done/total）。
 */
export async function executeAssetPurge(
  plan: AssetPurgePlan,
  deps: AssetPurgeExecutorDeps,
  onProgress?: (stage: AssetPurgeProgressStage, done?: number, total?: number) => void,
): Promise<void> {
  if (plan.allowedAssetIds.length === 0) return
  const tasksToPatch: TaskRecord[] = []
  for (const cleanup of plan.taskOutputCleanups) {
    const task = await deps.getTask(cleanup.taskId)
    if (task) tasksToPatch.push(patchTaskForPurgedSlots(task, cleanup.outputSlots))
  }
  onProgress?.('records')
  await withAssetWriteLock(async () => {
    await deps.purgeRecords({
      tasksToPatch,
      assetIds: plan.allowedAssetIds,
      tombstones: plan.tombstones,
    })
  })
  // 批量删除优先（分块提交）；无批量接口时回退逐张并汇报逐张进度
  const imageIds = plan.imageIdsToDelete
  if (deps.deleteImages) {
    await deps.deleteImages(imageIds, (done, total) => onProgress?.('images', done, total))
  } else {
    const total = imageIds.length
    for (let index = 0; index < total; index++) {
      await deps.deleteImage?.(imageIds[index])
      onProgress?.('images', index + 1, total)
    }
  }
}
