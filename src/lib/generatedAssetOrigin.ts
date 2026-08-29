import type {
  AssetSourceMode,
  AssetTombstone,
  GeneratedAsset,
  GeneratedAssetOrigin,
  TaskRecord,
  StoredImage,
} from '../types'
import { containsAssetOrigin } from './assetLibraryModel'

/** upsert 时由调用方提供的来源上下文；不能从 TaskRecord 可靠推导的信息放在这里。 */
export interface AssetTaskContext {
  sourceMode: AssetSourceMode
  workspaceTabId?: string
  workspaceTabName?: string
}

/** 从任务特征推断生成来源模式；agent / SOP / 日程 优先级高于普通画廊。 */
export function getTaskSourceMode(task: TaskRecord): AssetSourceMode {
  if (task.sopBatch) return 'sop'
  if (task.agentConversationId || task.agentRoundId || task.sourceMode === 'agent') return 'agent'
  if (task.scheduledOutputPath || task.scheduledOutputSubFolder) return 'schedule'
  if (task.sourceMode === 'gallery') return 'gallery'
  return 'unknown'
}

/**
 * 确定输出图片的稳定槽位。
 * 优先使用 `generationSlots[].outputImageId` 的稳定 index；旧任务没有槽位时回退数组下标。
 */
export function getTaskOutputSlot(task: TaskRecord, imageId: string, fallbackIndex: number): number {
  const matchedSlot = task.generationSlots?.find((slot) => slot.outputImageId === imageId)
  if (matchedSlot !== undefined && Number.isFinite(matchedSlot.index)) return matchedSlot.index
  return fallbackIndex
}

/** 从任务构建单个来源快照；绝不写入 API Key 与 rawResponsePayload。 */
export function buildGeneratedAssetOrigin(
  task: TaskRecord,
  imageId: string,
  context: AssetTaskContext,
  fallbackIndex: number,
): GeneratedAssetOrigin {
  // 解耦：任务级 actualParams（全图共有差异）与图级 actualParamsByImage[imageId]（每图专属差异）分开记录。
  // 图级差异单独入素材快照，任务删除后仍可追溯本图实际生效参数（含每槽位 seed）。
  const imageActualParams = task.actualParamsByImage?.[imageId]
  const seed =
    typeof imageActualParams?.seed === 'number'
      ? imageActualParams.seed
      : typeof task.actualParams?.seed === 'number'
        ? task.actualParams.seed
        : undefined
  return {
    key: `${task.id}:${getTaskOutputSlot(task, imageId, fallbackIndex)}`,
    taskId: task.id,
    outputSlot: getTaskOutputSlot(task, imageId, fallbackIndex),
    taskCreatedAt: task.createdAt,
    taskFinishedAt: task.finishedAt ?? null,
    sourceMode: context.sourceMode,
    workspaceTabId: context.workspaceTabId,
    workspaceTabName: context.workspaceTabName,
    prompt: task.prompt ?? '',
    revisedPrompt: task.revisedPromptByImage?.[imageId] ?? undefined,
    requestedParams: task.params ?? ({} as TaskRecord['params']),
    actualParams: task.actualParams,
    imageActualParams,
    seed,
    apiProvider: task.apiProvider,
    apiProfileId: task.apiProfileId,
    apiProfileName: task.apiProfileName,
    apiMode: task.apiMode,
    apiModel: task.apiModel,
    inputImageIds: task.inputImageIds ?? [],
    maskTargetImageId: task.maskTargetImageId ?? null,
    maskImageId: task.maskImageId ?? null,
    filenameBatch: task.filenameBatch,
    filenameLabel: task.filenameLabel ?? task.localSaveBatchFolder ?? undefined,
    generatedFileNameBase: task.generatedFileNameBase ?? undefined,
  }
}

/** 输入图中已经是素材库记录的图片作为衍生链父素材。 */
function computeParentAssetIds(
  origins: GeneratedAssetOrigin[],
  existingById: ReadonlyMap<string, GeneratedAsset>,
  current: string[] = [],
): string[] {
  const parents = new Set(current)
  for (const origin of origins) {
    for (const id of origin.inputImageIds) {
      const parent = existingById.get(id)
      if (parent) parents.add(parent.id)
    }
    if (origin.maskTargetImageId) {
      const parent = existingById.get(origin.maskTargetImageId)
      if (parent) parents.add(parent.id)
    }
  }
  return [...parents]
}

function getStoredImageMetadata(
  image: StoredImage | undefined,
): Pick<GeneratedAsset, 'width' | 'height' | 'mimeType' | 'byteSize'> {
  if (!image) return {}
  const dataUrlMatch = image.dataUrl?.match(/^data:([^;,]+)(?:;base64)?,(.*)$/s)
  const mimeType =
    dataUrlMatch?.[1] ??
    (image.localPath?.match(/\.([a-zA-Z0-9]+)$/)?.[1].toLowerCase() === 'jpg' ? 'image/jpeg' : undefined)
  const byteSize = dataUrlMatch
    ? Math.max(0, Math.floor((dataUrlMatch[2].replace(/=+$/, '').length * 3) / 4))
    : undefined
  return { width: image.width, height: image.height, mimeType, byteSize }
}

/**
 * 将任务的全部输出槽位纯转换为素材 upsert 结果（不写库）。
 * 幂等规则与 repository.upsertFromTask 一致：
 * - 相同 imageId 已有素材时只追加/更新来源快照。
 * - 命中墓碑（任务早于永久删除时间）的槽位跳过，避免“复活”已删除素材。
 * - 被 `purgedOutputSlots` 标记的槽位跳过。
 * 调用方负责提供包含输出图与输入图的最新 existingById 与墓碑映射。
 */
export function buildGeneratedAssetsFromTask(
  task: TaskRecord,
  context: AssetTaskContext,
  existingById: ReadonlyMap<string, GeneratedAsset>,
  tombstones: ReadonlyMap<string, AssetTombstone>,
  now = Date.now(),
  imagesById: ReadonlyMap<string, StoredImage> = new Map(),
): GeneratedAsset[] {
  const outputs = task.outputImages ?? []
  if (outputs.length === 0) return []
  const purgedSlots = new Set(task.purgedOutputSlots ?? [])
  const changed: GeneratedAsset[] = []
  const workingById = new Map(existingById)
  const occurredAt = Math.max(task.createdAt, task.finishedAt ?? task.createdAt)

  for (let index = 0; index < outputs.length; index++) {
    if (purgedSlots.has(index)) continue
    const imageId = outputs[index]
    if (!imageId) continue

    const tombstone = tombstones.get(imageId)
    if (tombstone && occurredAt <= tombstone.purgedAt) continue

    const origin = buildGeneratedAssetOrigin(task, imageId, context, index)
    const existing = workingById.get(imageId)
    const metadata = getStoredImageMetadata(imagesById.get(imageId))
    let next: GeneratedAsset
    if (existing) {
      next = containsAssetOrigin(existing, origin.key)
        ? {
            ...existing,
            origins: existing.origins.map((o) => (o.key === origin.key ? { ...o, ...origin } : o)),
            createdAt: Math.min(existing.createdAt, occurredAt),
            updatedAt: now,
            width: metadata.width ?? existing.width,
            height: metadata.height ?? existing.height,
            mimeType: metadata.mimeType ?? existing.mimeType,
            byteSize: metadata.byteSize ?? existing.byteSize,
          }
        : {
            ...existing,
            origins: [...existing.origins, origin],
            createdAt: Math.min(existing.createdAt, occurredAt),
            updatedAt: now,
            width: metadata.width ?? existing.width,
            height: metadata.height ?? existing.height,
            mimeType: metadata.mimeType ?? existing.mimeType,
            byteSize: metadata.byteSize ?? existing.byteSize,
          }
    } else {
      next = {
        id: `asset:${imageId}`,
        imageId,
        status: 'active',
        createdAt: occurredAt,
        updatedAt: now,
        trashedAt: null,
        favorite: false,
        rating: 0,
        // 任务提交时所在的项目文件夹：新素材直接归入该文件夹（「在哪个文件夹发送任务，图片就归哪个文件夹」）
        collectionIds: task.defaultCollectionId ? [task.defaultCollectionId] : [],
        tagIds: [],
        origins: [origin],
        primaryOriginKey: origin.key,
        parentAssetIds: [],
        metadataVersion: 1,
        ...metadata,
      }
    }
    next = { ...next, parentAssetIds: computeParentAssetIds(next.origins, existingById, next.parentAssetIds) }
    workingById.set(imageId, next)
    const changedIndex = changed.findIndex((asset) => asset.id === next.id)
    if (changedIndex >= 0) changed[changedIndex] = next
    else changed.push(next)
  }
  return changed
}
