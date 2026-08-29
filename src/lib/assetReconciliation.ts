import type { TaskRecord, WorkspaceTab } from '../types'
import { upsertFromTask } from './assetLibraryRepository'
import { getTaskSourceMode } from './generatedAssetOrigin'

export interface AssetReconciliationOptions {
  tasks: TaskRecord[]
  workspaceTabs: WorkspaceTab[]
  batchSize?: number
  onProgress?: (processed: number, total: number) => void
  /**
   * 上次成功对账的游标（最后一个已处理任务的 `createdAt:id`，见 cursorForTask）。
   * 传入后只处理游标之后的任务（增量）；缺省/为 null 时全量扫描。
   */
  cursor?: string | null
  /**
   * 上次对账时仍未终结（运行中）的任务 id。这些任务可能在其后崩溃导致素材未写入，
   * 因此下次启动按 id 强制重扫，不受游标位置影响。
   */
  pendingTaskIds?: string[]
}

export interface AssetReconciliationResult {
  processed: number
  updatedAssets: number
  failedTasks: number
  /**
   * 本次应写回的下一次游标：
   * - 全部成功且本次有新任务时：最后一个已处理任务的 `createdAt:id`；
   * - 有失败任务时：null（下次启动全量重扫兜底，避免失败任务被游标跳过）；
   * - 无任务可处理时：保持传入的 cursor。
   */
  nextCursor: string | null
  /** 本次处理后仍未终结（运行中）的任务 id，调用方应存入 journal 下次强制重扫。 */
  pendingTaskIds: string[]
}

/** 游标编码：`${createdAt}:${taskId}`；createdAt 数值比较 + taskId 字典序，保证全序。 */
export function cursorForTask(task: TaskRecord): string {
  return `${task.createdAt}:${task.id}`
}

export function splitTaskCursor(cursor: string): { createdAt: number; taskId: string } {
  const separator = cursor.indexOf(':')
  const createdAt = Number(cursor.slice(0, separator))
  const taskId = separator >= 0 ? cursor.slice(separator + 1) : ''
  return { createdAt: Number.isFinite(createdAt) ? createdAt : 0, taskId }
}

/** 按 createdAt:id 全序比较任务，返回 -1/0/1。 */
export function compareTasksByCursor(a: TaskRecord, b: TaskRecord): number {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id)
}

/**
 * 启动补齐：任务恢复、工作区归属恢复之后执行。
 * 幂等，只读取任务元数据并批量比对来源 key，不读取图片字节。
 * 应用在“任务写入成功、素材写入前”崩溃时，下次启动在此补齐。
 *
 * 增量：传入 cursor 时只处理游标之后的任务；无 cursor 全量扫描。
 * 运行中的任务（finishedAt 为 null）不参与游标推进，而是通过返回的 pendingTaskIds
 * 由调用方持久化，下次启动按 id 强制重扫——这样游标可以照常越过运行中任务，
 * 其后的已完成任务不会被重复扫描（避免上万任务时退化为全量）。
 * 任一任务失败即返回 nextCursor=null，调用方应清空游标，下次启动全量重扫兜底。
 */
export async function reconcileGeneratedAssets(
  options: AssetReconciliationOptions,
): Promise<AssetReconciliationResult> {
  const { tasks, workspaceTabs, batchSize = 100, onProgress, cursor, pendingTaskIds } = options
  const byTaskId = new Map<string, WorkspaceTab>()
  for (const tab of workspaceTabs) {
    for (const task of tab.tasks) byTaskId.set(task.id, tab)
    for (const taskId of tab._taskIds ?? []) {
      if (!byTaskId.has(taskId)) byTaskId.set(taskId, tab)
    }
  }

  // 按创建时间升序处理，保证同一内容的来源快照顺序稳定。
  const ordered = [...tasks].sort(compareTasksByCursor)

  let startIndex = 0
  if (cursor) {
    const { createdAt, taskId } = splitTaskCursor(cursor)
    const found = ordered.findIndex(
      (task) => task.createdAt > createdAt || (task.createdAt === createdAt && task.id > taskId),
    )
    startIndex = found >= 0 ? found : ordered.length
  }

  // 候选 = 游标之后的任务 ∪ 上次未终结（运行中）的任务；按创建时间排序去重
  const candidateById = new Map<string, TaskRecord>()
  for (const task of ordered.slice(startIndex)) candidateById.set(task.id, task)
  for (const taskId of pendingTaskIds ?? []) {
    const task = tasks.find((item) => item.id === taskId)
    if (task) candidateById.set(task.id, task)
  }
  const candidates = [...candidateById.values()].sort(compareTasksByCursor)

  let processed = 0
  let updatedAssets = 0
  let failedTasks = 0
  const stillPending: string[] = []

  // 必须串行：同内容任务并发 upsert 会读到旧值互相覆盖，丢失来源合并。
  for (let offset = 0; offset < candidates.length; offset += batchSize) {
    const batch = candidates.slice(offset, offset + batchSize)
    for (const task of batch) {
      const tab = byTaskId.get(task.id)
      try {
        const context = {
          sourceMode: getTaskSourceMode(task),
          workspaceTabId: tab?.id,
          workspaceTabName: tab?.name,
        }
        // 修复：参考图（输入图）不再自动归档（archiveTaskReferences 已停用）
        const changed = await upsertFromTask(task, context)
        updatedAssets += changed.length
        if (task.finishedAt == null) stillPending.push(task.id)
      } catch (error) {
        failedTasks++
        console.error(`素材启动补齐失败（task=${task.id}）:`, error)
      } finally {
        processed++
      }
    }
    onProgress?.(processed, candidates.length)
  }

  let nextCursor: string | null
  if (candidates.length === 0) {
    nextCursor = cursor ?? null
  } else if (failedTasks > 0) {
    nextCursor = null
  } else {
    // 游标推进到最后一个已终结任务；运行中任务靠 pendingTaskIds 兜底，不阻塞游标
    nextCursor = cursorForTask(candidates[candidates.length - 1]!)
  }

  return { processed, updatedAssets, failedTasks, nextCursor, pendingTaskIds: stillPending }
}
