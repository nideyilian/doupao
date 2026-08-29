import type { FavoriteCollection, ScheduleItem, ScheduleRow, TaskRecord } from '../types'

export type ScheduleOutputTarget = { path: string; subFolder?: never } | { path?: never; subFolder: string } | {}
export type ScheduleCompletionAction =
  { type: 'waiting' } | { type: 'done' } | { type: 'supplement'; count: number } | { type: 'error'; error: string }

type ScheduleRelatedTask = Pick<TaskRecord, 'id' | 'status' | 'outputImages' | 'error'>

export function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map((part) => Number(part))
  return new Date(year, (month || 1) - 1, day || 1)
}

export function getWeekStartDate(date = new Date()): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = start.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  start.setDate(start.getDate() + mondayOffset)
  return start
}

export function getWeekDates(weekStartKey: string): Date[] {
  const start = parseDateKey(weekStartKey)
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return date
  })
}

export function createDefaultScheduleRows(): ScheduleRow[] {
  return Array.from({ length: 8 }, (_, index) => ({
    id: `row-${index + 1}`,
    name: `任务 ${index + 1}`,
    order: index,
  }))
}

export function getScheduleRunKey(item: Pick<ScheduleItem, 'id' | 'date'>): string {
  return `${item.date}:${item.id}`
}

export function getScheduleCompletionAction(
  item: ScheduleItem,
  relatedTasks: ScheduleRelatedTask[],
): ScheduleCompletionAction {
  if (relatedTasks.length === 0) return { type: 'waiting' }
  if (relatedTasks.some((task) => task.status !== 'done' && task.status !== 'error')) return { type: 'waiting' }

  const outputCount = relatedTasks.reduce((count, task) => count + (task.outputImages?.length ?? 0), 0)
  const requestedCount = Math.max(1, Math.floor(item.count || 1))
  if (outputCount >= requestedCount) return { type: 'done' }

  const latestTask = relatedTasks[relatedTasks.length - 1]
  if (latestTask.status === 'error' && latestTask.outputImages.length === 0) {
    return { type: 'error', error: latestTask.error || '日程任务补齐失败' }
  }
  if (relatedTasks.length > 1 && latestTask.outputImages.length === 0) {
    return { type: 'error', error: '日程任务补齐未产生新图片' }
  }

  return { type: 'supplement', count: requestedCount - outputCount }
}

export function isScheduleItemTerminal(item: ScheduleItem): boolean {
  return item.status === 'done' || item.status === 'error'
}

export function isScheduledItemDue(item: ScheduleItem, now = new Date()): boolean {
  if (!item.time) return false
  if (item.lastRunKey === getScheduleRunKey(item)) return false
  if (item.status === 'queued' || item.status === 'running') return false
  if (item.date !== formatDateKey(now)) return false
  const [hours, minutes] = item.time.split(':').map((part) => Number(part))
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return false
  const dueAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes)
  return now.getTime() >= dueAt.getTime()
}

export function getDueScheduleItemIds(items: ScheduleItem[], rows: ScheduleRow[], now = new Date()): string[] {
  const today = formatDateKey(now)
  const rowOrder = new Map(rows.map((row) => [row.id, row.order]))
  const orderedToday = items
    .filter((item) => item.date === today)
    .slice()
    .sort((a, b) => {
      const rowDiff =
        (rowOrder.get(a.rowId) ?? Number.MAX_SAFE_INTEGER) - (rowOrder.get(b.rowId) ?? Number.MAX_SAFE_INTEGER)
      if (rowDiff !== 0) return rowDiff
      return a.order - b.order
    })

  const dueTimed = orderedToday.filter((item) => isScheduledItemDue(item, now)).map((item) => item.id)
  const dueSequential: string[] = []
  const untimedByRow = new Map<string, ScheduleItem[]>()

  for (const item of orderedToday) {
    if (item.time) continue
    const list = untimedByRow.get(item.rowId) ?? []
    list.push(item)
    untimedByRow.set(item.rowId, list)
  }

  for (const row of rows.slice().sort((a, b) => a.order - b.order)) {
    const rowItems = (untimedByRow.get(row.id) ?? []).sort((a, b) => a.order - b.order)
    for (const item of rowItems) {
      if (item.lastRunKey === getScheduleRunKey(item) || item.status === 'queued' || item.status === 'running') {
        if (!isScheduleItemTerminal(item)) break
        continue
      }
      dueSequential.push(item.id)
      break
    }
  }

  return [...dueTimed, ...dueSequential]
}

export function resolveScheduleOutputTarget({
  favoriteOutputPath,
  collectionId,
  taskCollectionIds,
  collections,
  defaultCollectionId,
}: {
  favoriteOutputPath?: string | null
  collectionId: string | null
  taskCollectionIds?: string[]
  collections: FavoriteCollection[]
  defaultCollectionId: string | null
}): ScheduleOutputTarget {
  const trimmedPath = favoriteOutputPath?.trim()
  if (trimmedPath) return { path: trimmedPath }

  const fallbackCollectionId =
    collectionId && collections.some((collection) => collection.id === collectionId)
      ? collectionId
      : (taskCollectionIds?.find((id) => collections.some((collection) => collection.id === id)) ?? defaultCollectionId)
  const collection = collections.find((item) => item.id === fallbackCollectionId) ?? collections[0]
  return collection?.name ? { subFolder: collection.name } : {}
}

export function resolveScheduleSourceCollectionId({
  selectedCollectionId,
  allFavoritesCollectionId,
  taskCollectionIds,
  defaultCollectionId,
}: {
  selectedCollectionId: string | null
  allFavoritesCollectionId: string
  taskCollectionIds?: string[]
  defaultCollectionId: string | null
}): string | null {
  if (selectedCollectionId && selectedCollectionId !== allFavoritesCollectionId) return selectedCollectionId
  return taskCollectionIds?.[0] ?? defaultCollectionId
}
