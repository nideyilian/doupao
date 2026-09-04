import type { AgentConversation, GeneratedAsset, SopBatchSnapshot, TaskRecord, WorkspaceTab } from '../types'

/**
 * 引用类型枚举：拥有型引用（阻断删除）与非阻断输出映射统一建模。
 * `blocking = true` 的引用会阻止图片被永久删除；`task-output` 属于非阻断来源引用。
 */
export type ImageReferenceType =
  | 'asset-original'
  | 'asset-origin-input'
  | 'task-output'
  | 'task-input'
  | 'mask'
  | 'gallery-draft'
  | 'agent-draft'
  | 'agent-conversation'
  | 'sop-reference'
  | 'sop-ai-conversation'
  | 'sop-cover'
  | 'strategy-reference'
  | 'strategy-cover'
  | 'postprocess'
  | 'composite'
  | 'ordering'

export interface ImageReference {
  type: ImageReferenceType
  /** 引用归属者 id：任务 id / 素材 id / 会话 id / tab id 等 */
  ownerId: string
  /** 用户可读说明 */
  label: string
  /** 是否为拥有型引用；false 表示仅来源映射（如任务输出），不阻断素材永久删除 */
  blocking: boolean
  /** 可选的导航目标，如来源任务 id */
  navigateTarget?: string
  /** 任务输出引用对应的输出槽位 */
  outputSlot?: number
}

export interface TaskOutputReference {
  taskId: string
  outputSlot: number
  imageId: string
}

export interface ImageReferenceGraph {
  ownersByImageId: Map<string, ImageReference[]>
  outputOriginsByImageId: Map<string, TaskOutputReference[]>
}

export interface ImageReferenceGraphInput {
  tasks: TaskRecord[]
  /** 有效与回收站素材；素材自身及其来源输入都属于拥有型引用 */
  assets: GeneratedAsset[]
  workspaceTabs: WorkspaceTab[]
  agentConversations: AgentConversation[]
  sopRuns: SopBatchSnapshot[]
  /** requirementPrototype SOP 库封面图 id 列表 */
  sopCoverImageIds: string[]
  currentInputImageIds: string[]
  galleryDraftInputImageIds: string[]
  agentDraftInputImageIds: string[]
  /** 由策略、排单等独立模块提供的持久化引用。 */
  additionalReferences?: Array<{ imageId: string; reference: ImageReference }>
}

/** 构建统一图片引用图，替代 store.ts 中散落的多份近似引用逻辑。 */
export function buildImageReferenceGraph(input: ImageReferenceGraphInput): ImageReferenceGraph {
  const ownersByImageId = new Map<string, ImageReference[]>()
  const outputOriginsByImageId = new Map<string, TaskOutputReference[]>()
  const seenPairs = new Set<string>()

  const add = (imageId: string | null | undefined, ref: ImageReference) => {
    if (!imageId) return
    const key = `${ref.type}:${ref.ownerId}:${imageId}`
    if (seenPairs.has(key)) return
    seenPairs.add(key)
    const list = ownersByImageId.get(imageId) ?? []
    list.push(ref)
    ownersByImageId.set(imageId, list)
  }

  const addOutput = (taskId: string, slot: number, imageId: string | undefined) => {
    if (!imageId) return
    add(imageId, {
      type: 'task-output',
      ownerId: taskId,
      label: `任务输出（${taskId}）`,
      blocking: false,
      navigateTarget: taskId,
      outputSlot: slot,
    })
    const list = outputOriginsByImageId.get(imageId) ?? []
    list.push({ taskId, outputSlot: slot, imageId })
    outputOriginsByImageId.set(imageId, list)
  }

  // 素材：自身原图 + 来源快照中的隐藏输入依赖
  for (const asset of input.assets) {
    add(asset.imageId, { type: 'asset-original', ownerId: asset.id, label: '素材原图', blocking: true })
    for (const origin of asset.origins) {
      for (const id of origin.inputImageIds) {
        add(id, { type: 'asset-origin-input', ownerId: asset.id, label: `素材来源输入（${asset.id}）`, blocking: true })
      }
      add(origin.maskTargetImageId, {
        type: 'asset-origin-input',
        ownerId: asset.id,
        label: `素材遮罩目标（${asset.id}）`,
        blocking: true,
      })
      add(origin.maskImageId, {
        type: 'asset-origin-input',
        ownerId: asset.id,
        label: `素材遮罩图（${asset.id}）`,
        blocking: true,
      })
    }
  }

  // 任务：输入、遮罩、流式诊断图为拥有型；输出为非阻断映射
  for (const task of input.tasks) {
    for (const id of task.inputImageIds ?? []) {
      add(id, { type: 'task-input', ownerId: task.id, label: `任务输入（${task.id}）`, blocking: true })
    }
    add(task.maskImageId, { type: 'mask', ownerId: task.id, label: `遮罩图（${task.id}）`, blocking: true })
    add(task.maskTargetImageId, { type: 'mask', ownerId: task.id, label: `遮罩目标（${task.id}）`, blocking: true })
    for (const id of task.streamPartialImageIds ?? []) {
      add(id, { type: 'task-input', ownerId: task.id, label: `流式中间图（${task.id}）`, blocking: true })
    }
    const outputs = task.outputImages ?? []
    for (let slot = 0; slot < outputs.length; slot++) {
      addOutput(task.id, slot, outputs[slot])
    }
  }

  // 工作区标签：当前输入、文件夹输入、遮罩草稿
  for (const tab of input.workspaceTabs) {
    for (const img of tab.inputImages) {
      add(img.id, { type: 'gallery-draft', ownerId: tab.id, label: `工作区输入（${tab.name}）`, blocking: true })
    }
    for (const id of tab.inputImageFolder?.imageIds ?? []) {
      add(id, { type: 'gallery-draft', ownerId: tab.id, label: `文件夹输入（${tab.name}）`, blocking: true })
    }
    add(tab.maskDraft?.targetImageId, {
      type: 'mask',
      ownerId: tab.id,
      label: `遮罩草稿（${tab.name}）`,
      blocking: true,
    })
    add(tab.maskEditorImageId, { type: 'mask', ownerId: tab.id, label: `遮罩编辑图片（${tab.name}）`, blocking: true })
  }

  // 当前画廊输入
  for (const id of input.currentInputImageIds) {
    add(id, { type: 'gallery-draft', ownerId: 'current-input', label: '当前画廊输入', blocking: true })
  }
  for (const id of input.galleryDraftInputImageIds) {
    add(id, { type: 'gallery-draft', ownerId: 'gallery-draft', label: '画廊草稿输入', blocking: true })
  }
  for (const id of input.agentDraftInputImageIds) {
    add(id, { type: 'agent-draft', ownerId: 'agent-draft', label: 'Agent 草稿输入', blocking: true })
  }

  // Agent 会话
  for (const conversation of input.agentConversations) {
    for (const round of conversation.rounds) {
      for (const id of round.inputImageIds) {
        add(id, {
          type: 'agent-conversation',
          ownerId: conversation.id,
          label: `Agent 会话输入（${conversation.id}）`,
          blocking: true,
        })
      }
      add(round.maskImageId, {
        type: 'agent-conversation',
        ownerId: conversation.id,
        label: `Agent 遮罩（${conversation.id}）`,
        blocking: true,
      })
    }
    for (const message of conversation.messages) {
      add(message.maskImageId, {
        type: 'agent-conversation',
        ownerId: conversation.id,
        label: `Agent 消息遮罩（${conversation.id}）`,
        blocking: true,
      })
    }
  }

  // SOP 批处理参考图与封面
  for (const run of input.sopRuns) {
    for (const id of run.referenceImageIds) {
      add(id, { type: 'sop-reference', ownerId: run.id, label: 'SOP 参考图', blocking: true })
    }
  }
  for (let index = 0; index < input.sopCoverImageIds.length; index++) {
    add(input.sopCoverImageIds[index], {
      type: 'sop-cover',
      ownerId: `sop-cover-${index}`,
      label: 'SOP 封面',
      blocking: true,
    })
  }

  for (const item of input.additionalReferences ?? []) add(item.imageId, item.reference)

  return { ownersByImageId, outputOriginsByImageId }
}

export function getImageReferences(graph: ImageReferenceGraph, imageId: string): ImageReference[] {
  return graph.ownersByImageId.get(imageId) ?? []
}

export function isImageReferenced(graph: ImageReferenceGraph, imageId: string): boolean {
  return getImageReferences(graph, imageId).length > 0
}

/** 拥有型引用（阻断永久删除）；素材原图、任务输入、Agent 引用等。 */
export function getBlockingReferences(graph: ImageReferenceGraph, imageId: string): ImageReference[] {
  return getImageReferences(graph, imageId).filter((ref) => ref.blocking)
}

export function getTaskOutputReferences(graph: ImageReferenceGraph, imageId: string): TaskOutputReference[] {
  return graph.outputOriginsByImageId.get(imageId) ?? []
}
