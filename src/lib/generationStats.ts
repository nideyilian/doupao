import type { TaskRecord, WorkspaceTab } from '../types'

export type GenerationStatsRange = 'today' | '7d' | '30d'

export interface GenerationStatsCount {
  total: number
  success: number
  failure: number
  elapsedMs: number
}

export interface GenerationStatsTabCount extends GenerationStatsCount {
  id: string
  name: string
}

export interface GenerationStats {
  range: GenerationStatsRange
  totals: GenerationStatsCount
  byTab: GenerationStatsTabCount[]
}

const DAY_MS = 24 * 60 * 60 * 1000

export function getGenerationStats(
  tasks: TaskRecord[],
  workspaceTabs: WorkspaceTab[],
  range: GenerationStatsRange,
  now = Date.now(),
): GenerationStats {
  const startAt = getRangeStartAt(range, now)
  const matchingTasks = tasks.filter((task) => isTaskInRange(task, startAt, now))
  const totals = sumTaskStats(matchingTasks, now)

  return {
    range,
    totals,
    byTab: workspaceTabs
      .map((tab) => ({
        id: tab.id,
        name: tab.name,
        ...sumTaskStats(
          tab.tasks.filter((task) => isTaskInRange(task, startAt, now)),
          now,
        ),
      }))
      .filter((tab) => tab.total > 0 || tab.elapsedMs > 0),
  }
}

export function getGenerationStatsRangeLabel(range: GenerationStatsRange): string {
  if (range === 'today') return '今天'
  if (range === '7d') return '7天'
  return '30天'
}

export function getNextGenerationStatsRange(range: GenerationStatsRange): GenerationStatsRange {
  if (range === 'today') return '7d'
  if (range === '7d') return '30d'
  return 'today'
}

export function formatGenerationStatsDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  if (totalSeconds < 60) return `${totalSeconds}秒`

  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 60) return `${totalMinutes}分`

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes > 0 ? `${hours}小时${minutes}分` : `${hours}小时`
}

function getRangeStartAt(range: GenerationStatsRange, now: number) {
  if (range === 'today') {
    const date = new Date(now)
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }
  return now - (range === '7d' ? 7 : 30) * DAY_MS
}

function isTaskInRange(task: TaskRecord, startAt: number, now: number) {
  return task.createdAt >= startAt && task.createdAt <= now
}

function sumTaskStats(tasks: TaskRecord[], now: number): GenerationStatsCount {
  return tasks.reduce<GenerationStatsCount>(
    (stats, task) => {
      const success = getTaskSuccessCount(task)
      const failure = getTaskFailureCount(task)

      stats.success += success
      stats.failure += failure
      stats.total += getTaskTotalCount(task, success, failure)
      stats.elapsedMs += getTaskElapsedMs(task, now)
      return stats
    },
    { total: 0, success: 0, failure: 0, elapsedMs: 0 },
  )
}

function getTaskSuccessCount(task: TaskRecord) {
  return task.outputImages.length
}

function getTaskTotalCount(task: TaskRecord, success: number, failure: number) {
  if (task.status === 'running' || task.falRecoverable || task.customRecoverable) {
    return Math.max(success + failure, task.params.n ?? 1)
  }
  return success + failure
}

function getTaskFailureCount(task: TaskRecord) {
  if (task.batchItemStatuses?.length) {
    return task.batchItemStatuses.filter((status) => status === 'error').length
  }
  if (
    task.status === 'error' &&
    (task.outputImages?.length ?? 0) === 0 &&
    !task.falRecoverable &&
    !task.customRecoverable
  ) {
    return 1
  }
  return 0
}

function getTaskElapsedMs(task: TaskRecord, now: number) {
  if (task.status === 'running' || task.falRecoverable || task.customRecoverable) {
    return Math.max(0, now - task.createdAt)
  }
  return Math.max(0, task.elapsed ?? 0)
}
