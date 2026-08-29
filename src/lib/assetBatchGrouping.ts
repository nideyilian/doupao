import type { GeneratedAsset, GeneratedAssetOrigin, SopBatchSnapshot, TaskRecord } from '../types'

/**
 * 素材库「生成批次」展现方式的分组纯函数。
 *
 * 把当前查询结果中的素材按「生成批次 → 任务 → 已删除任务」三级聚合：
 * - SOP 批次（task.sopBatch）→ 一个批次组（保留快照 tags 与词库树文件夹 promptGroup，只读不回写）；
 * - 普通任务 → 任务组；
 * - 任务记录已删除（素材仍在）→ 孤儿组，使用素材来源快照（origins）还原信息，不丢数据。
 */

export type AssetBatchGroupKind = 'sop-batch' | 'task' | 'orphan'

export interface AssetBatchGroupSummary {
  total: number
  running: number
  completed: number
  failed: number
}

export interface AssetBatchGroup {
  /** 稳定组键（批次 id / 任务 id / orphan 键） */
  id: string
  kind: AssetBatchGroupKind
  /** 组标题（批次标题 / SOP 名 / 任务提示词摘要 / 孤儿提示词摘要） */
  title: string
  /** 关联任务 id 列表；孤儿组为空 */
  taskIds: string[]
  /** 代表任务（SOP 组为组内首个任务）；孤儿组为 null */
  task: TaskRecord | null
  /** 组内素材（按来源输出槽位再按生成时间排序） */
  assets: GeneratedAsset[]
  /**
   * 排序基准时间：有素材的组 = 素材最新生成时间；
   * 无素材的活跃任务组（生成中 / 失败）回退为任务提交时间（0.7.56 新任务置顶方案），
   * 避免刚提交的任务因 createdAt=0 沉底、结束后又跳到最上方。
   */
  createdAt: number
  summary: AssetBatchGroupSummary
  /** SOP 批次快照所属词库树文件夹（id+名称冗余，仅展示） */
  promptGroup: { id: string; name: string } | null
  /** SOP 批次快照标题（用户可编辑的提示词集标题） */
  snapshotTitle?: string
  snapshotId?: string
  /** 来源工作区名称（素材 origins 冗余） */
  workspaceTabName?: string
  /** 展示用的提示词摘要（批次标题 / 任务 / 孤儿提示词） */
  promptExcerpt: string
}

export function getPrimaryOrigin(asset: GeneratedAsset): GeneratedAssetOrigin | undefined {
  if (asset.primaryOriginKey) {
    const found = asset.origins.find((origin) => origin.key === asset.primaryOriginKey)
    if (found) return found
  }
  return asset.origins[0]
}

export function truncatePrompt(prompt: string, max = 80): string {
  const singleLine = prompt.replace(/\s+/g, ' ').trim()
  if (singleLine.length <= max) return singleLine
  return `${singleLine.slice(0, max)}…`
}

function summarizeTasks(tasks: TaskRecord[]): AssetBatchGroupSummary {
  return tasks.reduce<AssetBatchGroupSummary>(
    (summary, task) => {
      if (task.status === 'running') summary.running += 1
      else if (task.status === 'error') summary.failed += 1
      else summary.completed += 1
      summary.total += 1
      return summary
    },
    { total: 0, running: 0, completed: 0, failed: 0 },
  )
}

/** 任务是否有失败迹象：完全失败（status=error）或部分失败（status=done 但含失败槽位）。 */
export function hasTaskFailure(task: TaskRecord): boolean {
  return task.status === 'error' || (task.batchItemErrors != null && task.batchItemErrors.length > 0)
}

export interface AssetBatchGroupingOptions {
  /** 是否把"没有素材产出"的任务也补成任务组（生成中/失败的任务必须可见，回归 0.7.56 行为）。 */
  includeTaskless?: (task: TaskRecord) => boolean
}

export function buildAssetBatchGroups(
  assets: GeneratedAsset[],
  tasksById: ReadonlyMap<string, TaskRecord>,
  snapshotsById: ReadonlyMap<string, SopBatchSnapshot>,
  options: AssetBatchGroupingOptions = {},
): AssetBatchGroup[] {
  const { includeTaskless } = options
  const groups = new Map<string, AssetBatchGroup>()

  const ensureGroup = (key: string, seed: () => Omit<AssetBatchGroup, 'assets' | 'createdAt' | 'summary'>) => {
    const existing = groups.get(key)
    if (existing) return existing
    const created: AssetBatchGroup = {
      ...seed(),
      assets: [],
      createdAt: 0,
      summary: { total: 0, running: 0, completed: 0, failed: 0 },
    }
    groups.set(key, created)
    return created
  }

  for (const asset of assets) {
    const origin = getPrimaryOrigin(asset)
    const taskId = origin?.taskId ?? ''
    const task = taskId ? tasksById.get(taskId) : undefined

    let group: AssetBatchGroup
    if (task?.sopBatch) {
      const groupId = task.sopBatch.snapshotId || task.sopBatch.batchId
      const snapshot = groupId ? snapshotsById.get(groupId) : undefined
      const existing = groups.get(`sop-batch:${groupId}`)
      if (existing) {
        group = existing
      } else {
        group = ensureGroup(`sop-batch:${groupId}`, () => {
          const batchTitle =
            snapshot?.title?.trim() ||
            task.sopBatch?.sopName?.trim() ||
            (origin?.prompt ? truncatePrompt(origin.prompt) : 'SOP 批量任务')
          return {
            id: `sop-batch:${groupId}`,
            kind: 'sop-batch',
            title: batchTitle,
            taskIds: [],
            task: null,
            promptGroup: snapshot?.promptGroup ?? null,
            snapshotTitle: snapshot?.title,
            snapshotId: snapshot?.id ?? groupId,
            workspaceTabName: origin?.workspaceTabName,
            promptExcerpt: origin?.prompt ? truncatePrompt(origin.prompt) : '',
          }
        })
      }
      if (task && !group.taskIds.includes(task.id)) {
        group.taskIds.push(task.id)
        if (!group.task) group.task = task
      }
    } else if (task) {
      const existing = groups.get(`task:${task.id}`)
      if (existing) {
        group = existing
      } else {
        group = ensureGroup(`task:${task.id}`, () => ({
          id: `task:${task.id}`,
          kind: 'task',
          title: task.prompt.trim() ? truncatePrompt(task.prompt) : `任务 ${task.id.slice(0, 8)}`,
          taskIds: [task.id],
          task,
          promptGroup: null,
          workspaceTabName: origin?.workspaceTabName,
          promptExcerpt: task.prompt.trim() ? truncatePrompt(task.prompt) : '',
        }))
      }
    } else {
      // 任务记录已删除（素材保留）：按来源任务聚合，来源信息来自素材快照
      const orphanKey = taskId ? `orphan:${taskId}` : `orphan:${asset.id}`
      const existing = groups.get(orphanKey)
      if (existing) {
        group = existing
      } else {
        group = ensureGroup(orphanKey, () => ({
          id: orphanKey,
          kind: 'orphan',
          title: origin?.prompt?.trim() ? truncatePrompt(origin.prompt) : '任务已删除',
          taskIds: [],
          task: null,
          promptGroup: null,
          workspaceTabName: origin?.workspaceTabName,
          promptExcerpt: origin?.prompt?.trim() ? truncatePrompt(origin.prompt) : '',
        }))
      }
    }

    group.assets.push(asset)
    if (asset.createdAt > group.createdAt) group.createdAt = asset.createdAt
  }

  // 组内素材按来源输出槽位再按生成时间排序
  // 补入"没有素材产出"的活跃任务（生成中 / 失败 / 已停止）：它们没有任何素材 → 上面的素材循环
  // 不会为其建组，导致提交后无卡片、失败后消失（0.7.56 任务网格回归）。
  // 成功且无素材的任务不补（历史清理后属于正常"空任务"），由 includeTaskless 谓词按作用域控制；
  // 失败任务（含部分失败）必须保留任务卡——即使素材已被清理，用户仍需看到失败状态并重试。
  if (includeTaskless) {
    for (const task of tasksById.values()) {
      if (task.status === 'done' && !hasTaskFailure(task)) continue
      if (!includeTaskless(task)) continue
      const alreadyGrouped = [...groups.values()].some((group) => group.taskIds.includes(task.id))
      if (alreadyGrouped) continue
      if (task.sopBatch) {
        const groupId = task.sopBatch.snapshotId || task.sopBatch.batchId
        const snapshot = groupId ? snapshotsById.get(groupId) : undefined
        const group = ensureGroup(`sop-batch:${groupId}`, () => ({
          id: `sop-batch:${groupId}`,
          kind: 'sop-batch',
          title:
            snapshot?.title?.trim() ||
            task.sopBatch?.sopName?.trim() ||
            (task.prompt.trim() ? truncatePrompt(task.prompt) : 'SOP 批量任务'),
          taskIds: [],
          task: null,
          promptGroup: snapshot?.promptGroup ?? null,
          snapshotTitle: snapshot?.title,
          snapshotId: snapshot?.id ?? groupId,
          workspaceTabName: undefined,
          promptExcerpt: task.prompt.trim() ? truncatePrompt(task.prompt) : '',
        }))
        if (!group.taskIds.includes(task.id)) group.taskIds.push(task.id)
        if (!group.task) group.task = task
      } else {
        ensureGroup(`task:${task.id}`, () => ({
          id: `task:${task.id}`,
          kind: 'task',
          title: task.prompt.trim() ? truncatePrompt(task.prompt) : `任务 ${task.id.slice(0, 8)}`,
          taskIds: [task.id],
          task,
          promptGroup: null,
          workspaceTabName: undefined,
          promptExcerpt: task.prompt.trim() ? truncatePrompt(task.prompt) : '',
        }))
      }
    }
  }

  // 排序基准时间：任务卡位置在创建（提交）时即确定，不随实际生成进度变化——
  // 有关联任务的组一律以任务提交时间为基准（SOP 组取组内最早提交时间 = 批次创建时间），
  // 避免「生成中沉底、生成完成跳到最上方」的卡片跳动；孤儿组（任务已删除）没有任务
  // 时间，回退为素材最新生成时间。
  for (const group of groups.values()) {
    if (group.taskIds.length === 0) continue
    let taskBaseline = Number.MAX_SAFE_INTEGER
    for (const taskId of group.taskIds) {
      const task = tasksById.get(taskId)
      if (task && task.createdAt < taskBaseline) taskBaseline = task.createdAt
    }
    if (taskBaseline !== Number.MAX_SAFE_INTEGER) group.createdAt = taskBaseline
  }

  for (const group of groups.values()) {
    group.assets.sort((a, b) => {
      const slotDelta = (getPrimaryOrigin(a)?.outputSlot ?? 0) - (getPrimaryOrigin(b)?.outputSlot ?? 0)
      return slotDelta || a.createdAt - b.createdAt
    })
    if (group.kind === 'sop-batch' && group.taskIds.length > 0) {
      const batchTasks = group.taskIds
        .map((id) => tasksById.get(id))
        .filter((task): task is TaskRecord => task != null)
        .sort(
          (a, b) =>
            (a.sopBatch?.promptIndex ?? Number.MAX_SAFE_INTEGER) -
              (b.sopBatch?.promptIndex ?? Number.MAX_SAFE_INTEGER) || a.createdAt - b.createdAt,
        )
      group.taskIds = batchTasks.map((task) => task.id)
      if (!group.task) group.task = batchTasks[0] ?? null
      group.summary = summarizeTasks(batchTasks)
    }
  }

  return [...groups.values()].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1))
}

export interface AssetBatchOverview {
  /** 分组数量（批次 + 任务 + 任务已删除组） */
  groupCount: number
  /** 涉及的任务数（孤儿组不占任务数） */
  taskCount: number
  /** 素材总数 */
  assetCount: number
  completed: number
  running: number
  failed: number
}

/** 批次视图顶部速览：对当前分组聚合任务状态（替代已移除的「任务导航」状态速览）。 */
export function buildAssetBatchOverview(
  groups: AssetBatchGroup[],
  tasksById: ReadonlyMap<string, TaskRecord>,
): AssetBatchOverview {
  const taskIds = new Set<string>()
  let assetCount = 0
  for (const group of groups) {
    assetCount += group.assets.length
    for (const taskId of group.taskIds) taskIds.add(taskId)
  }
  let completed = 0
  let running = 0
  let failed = 0
  for (const taskId of taskIds) {
    const task = tasksById.get(taskId)
    if (!task) continue
    if (task.status === 'running') running += 1
    else if (task.status === 'error') failed += 1
    else completed += 1
  }
  return {
    groupCount: groups.length,
    taskCount: taskIds.size,
    assetCount,
    completed,
    running,
    failed,
  }
}
