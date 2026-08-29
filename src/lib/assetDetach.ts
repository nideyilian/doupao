import type {
  AgentConversation,
  GeneratedAsset,
  InputImage,
  InputImageFolder,
  MaskDraft,
  SopBatchSnapshot,
  TaskRecord,
  WorkspaceTab,
  WordGenerationBatch,
} from '../types'
import type { SopLibraryItem, StrategyAsset } from '../features/strategy/types'
import type { OrderingOrder } from '../features/ordering/types'

/**
 * 强制清空回收站时解除引用的纯补丁工具。
 * 每个函数只做「从记录中剥离对已删除图片的引用」，返回新对象；
 * 无变化时返回原引用，便于调用方判断是否需要持久化。
 */

/** 过滤 id 列表；无变化时返回原数组引用，undefined 保持 undefined。 */
function filterImageIds(ids: string[] | undefined, imageIds: ReadonlySet<string>): string[] | undefined {
  if (!ids || ids.length === 0) return ids
  const next = ids.filter((id) => !imageIds.has(id))
  return next.length === ids.length ? ids : next
}

/** 过滤 InputImage 列表（按 id）；无变化时返回原数组引用。 */
export function patchInputImageList(images: InputImage[], imageIds: ReadonlySet<string>): InputImage[] {
  const next = images.filter((image) => !imageIds.has(image.id))
  return next.length === images.length ? images : next
}

/** 输入草稿/标签页共有的输入图、文件夹输入、遮罩草稿、遮罩编辑图字段。 */
export interface ImageInputDraftLike {
  inputImages: InputImage[]
  inputImageFolder: InputImageFolder | null
  maskDraft: MaskDraft | null
  maskEditorImageId: string | null
}

/** 解除输入草稿（工作区标签页 / Agent 输入草稿 / 画廊草稿）对已删除图片的引用。 */
export function patchInputDraftLike<T extends ImageInputDraftLike>(draft: T, imageIds: ReadonlySet<string>): T {
  const inputImages = patchInputImageList(draft.inputImages, imageIds)
  const folder = draft.inputImageFolder
  const folderImageIds = folder ? filterImageIds(folder.imageIds, imageIds) : undefined
  const inputImageFolder =
    folder && folderImageIds !== undefined && folderImageIds !== folder.imageIds
      ? { ...folder, imageIds: folderImageIds ?? [] }
      : folder
  const maskDraft = draft.maskDraft && imageIds.has(draft.maskDraft.targetImageId) ? null : draft.maskDraft
  const maskEditorImageId =
    draft.maskEditorImageId && imageIds.has(draft.maskEditorImageId) ? null : draft.maskEditorImageId
  if (
    inputImages === draft.inputImages &&
    inputImageFolder === draft.inputImageFolder &&
    maskDraft === draft.maskDraft &&
    maskEditorImageId === draft.maskEditorImageId
  ) {
    return draft
  }
  return { ...draft, inputImages, inputImageFolder, maskDraft, maskEditorImageId }
}

/** 解除任务对已删除图片的输入引用：inputImageIds / 流式中间图 / 遮罩目标 / 遮罩图。 */
export function patchTaskForDetachedInputs(task: TaskRecord, imageIds: ReadonlySet<string>): TaskRecord {
  const inputImageIds = filterImageIds(task.inputImageIds, imageIds)
  const streamPartialImageIds = filterImageIds(task.streamPartialImageIds, imageIds)
  const maskTargetImageId =
    task.maskTargetImageId && imageIds.has(task.maskTargetImageId) ? null : task.maskTargetImageId
  const maskImageId = task.maskImageId && imageIds.has(task.maskImageId) ? null : task.maskImageId
  if (
    inputImageIds === task.inputImageIds &&
    streamPartialImageIds === task.streamPartialImageIds &&
    maskTargetImageId === task.maskTargetImageId &&
    maskImageId === task.maskImageId
  ) {
    return task
  }
  return { ...task, inputImageIds: inputImageIds ?? [], streamPartialImageIds, maskTargetImageId, maskImageId }
}

/** 解除其他素材来源快照中对已删除图片的引用（asset-origin-input）。 */
export function patchAssetOriginsForDetachedImages(
  asset: GeneratedAsset,
  imageIds: ReadonlySet<string>,
): GeneratedAsset {
  let changed = false
  const origins = asset.origins.map((origin) => {
    const inputImageIds = filterImageIds(origin.inputImageIds, imageIds)
    const maskTargetImageId =
      origin.maskTargetImageId && imageIds.has(origin.maskTargetImageId) ? null : origin.maskTargetImageId
    const maskImageId = origin.maskImageId && imageIds.has(origin.maskImageId) ? null : origin.maskImageId
    if (
      inputImageIds === origin.inputImageIds &&
      maskTargetImageId === origin.maskTargetImageId &&
      maskImageId === origin.maskImageId
    ) {
      return origin
    }
    changed = true
    return { ...origin, inputImageIds: inputImageIds ?? [], maskTargetImageId, maskImageId }
  })
  if (!changed) return asset
  return { ...asset, origins, updatedAt: Date.now() }
}

/** 解除工作区标签页（及同构的输入草稿）中对已删除图片的引用：输入图 / 文件夹输入 / 遮罩草稿 / 遮罩编辑图。 */
export function patchWorkspaceTabForDetachedImages(tab: WorkspaceTab, imageIds: ReadonlySet<string>): WorkspaceTab {
  const patched = patchInputDraftLike(tab, imageIds)
  if (patched === tab) return tab
  return { ...patched, updatedAt: Date.now() }
}

/** 解除 Agent 会话（轮次 + 消息）中对已删除图片的引用。 */
export function patchAgentConversationForDetachedImages(
  conversation: AgentConversation,
  imageIds: ReadonlySet<string>,
): AgentConversation {
  let changed = false
  const rounds = conversation.rounds.map((round) => {
    const inputImageIds = filterImageIds(round.inputImageIds, imageIds)
    const maskTargetImageId =
      round.maskTargetImageId && imageIds.has(round.maskTargetImageId) ? null : round.maskTargetImageId
    const maskImageId = round.maskImageId && imageIds.has(round.maskImageId) ? null : round.maskImageId
    if (
      inputImageIds === round.inputImageIds &&
      maskTargetImageId === round.maskTargetImageId &&
      maskImageId === round.maskImageId
    ) {
      return round
    }
    changed = true
    return { ...round, inputImageIds: inputImageIds ?? [], maskTargetImageId, maskImageId }
  })
  const messages = conversation.messages.map((message) => {
    const inputImageIds = filterImageIds(message.inputImageIds, imageIds)
    const maskTargetImageId =
      message.maskTargetImageId && imageIds.has(message.maskTargetImageId) ? null : message.maskTargetImageId
    const maskImageId = message.maskImageId && imageIds.has(message.maskImageId) ? null : message.maskImageId
    if (
      inputImageIds === message.inputImageIds &&
      maskTargetImageId === message.maskTargetImageId &&
      maskImageId === message.maskImageId
    ) {
      return message
    }
    changed = true
    return { ...message, inputImageIds, maskTargetImageId, maskImageId }
  })
  if (!changed) return conversation
  return { ...conversation, rounds, messages, updatedAt: Date.now() }
}

/** 解除 SOP 批量快照中对已删除图片的引用（顶层 + 单条提示词级）。 */
export function patchSopSnapshotForDetachedImages(
  snapshot: SopBatchSnapshot,
  imageIds: ReadonlySet<string>,
): SopBatchSnapshot {
  const referenceImageIds = filterImageIds(snapshot.referenceImageIds, imageIds)
  const prompts = snapshot.prompts.map((prompt) => {
    const promptRefs = filterImageIds(prompt.referenceImageIds, imageIds)
    if (promptRefs === prompt.referenceImageIds) return prompt
    return { ...prompt, referenceImageIds: promptRefs }
  })
  const promptsChanged = prompts.some((prompt, index) => prompt !== snapshot.prompts[index])
  if (referenceImageIds === snapshot.referenceImageIds && !promptsChanged) return snapshot
  return {
    ...snapshot,
    referenceImageIds: referenceImageIds ?? [],
    prompts,
    updatedAt: Date.now(),
  }
}

/** 解除策略素材中对已删除图片的引用（封面 + 工作流参考图）。 */
export function patchStrategyAssetForDetachedImages(
  strategy: StrategyAsset,
  imageIds: ReadonlySet<string>,
): StrategyAsset {
  const coverImageId = strategy.coverImageId && imageIds.has(strategy.coverImageId) ? undefined : strategy.coverImageId
  const reference = strategy.workflow.reference
  const workflow =
    reference && reference.imageIds.some((id) => imageIds.has(id))
      ? {
          ...strategy.workflow,
          reference: { ...reference, imageIds: reference.imageIds.filter((id) => !imageIds.has(id)) },
        }
      : strategy.workflow
  if (coverImageId === strategy.coverImageId && workflow === strategy.workflow) return strategy
  return { ...strategy, coverImageId, workflow, updatedAt: Date.now() }
}

/** 解除 SOP 库条目中对已删除图片的封面引用。 */
export function patchSopLibraryItemForDetachedImages(
  item: SopLibraryItem,
  imageIds: ReadonlySet<string>,
): SopLibraryItem {
  if (!item.coverImageId || !imageIds.has(item.coverImageId)) return item
  return { ...item, coverImageId: undefined, updatedAt: Date.now() }
}

/** 解除排单订单中对已删除图片的参考图引用。 */
export function patchOrderForDetachedImages(order: OrderingOrder, imageIds: ReadonlySet<string>): OrderingOrder {
  let changed = false
  const units = order.units.map((unit) => {
    const referenceImageIds = filterImageIds(unit.referenceImageIds, imageIds)
    if (referenceImageIds === unit.referenceImageIds) return unit
    changed = true
    return { ...unit, referenceImageIds }
  })
  if (!changed) return order
  return { ...order, units }
}

/** 解除词条生成批次中对已删除图片的参考图引用。 */
export function patchWordGenerationBatchForDetachedImages(
  batch: WordGenerationBatch,
  imageIds: ReadonlySet<string>,
): WordGenerationBatch {
  const referenceImageIds = filterImageIds(batch.referenceImageIds, imageIds)
  if (referenceImageIds === batch.referenceImageIds) return batch
  return { ...batch, referenceImageIds: referenceImageIds ?? [] }
}
