import { ALL_FAVORITES_COLLECTION_ID, getTaskFavoriteCollectionIds } from '../store'
import type { TaskRecord, TaskStatus } from '../types'

interface GalleryTaskFilterOptions {
  tasks: TaskRecord[]
  query: string
  filterStatus: 'all' | TaskStatus
  filterFavorite: boolean
  activeFavoriteCollectionId: string | null
}

// 每任务 params 字符串缓存：任务对象引用不变则复用，避免每次任务更新
// （含 streamPartialImageIds 等瞬态高频更新）都全量 JSON.stringify(params)。
const paramsStringCache = new WeakMap<TaskRecord, string>()

function getParamsString(task: TaskRecord): string {
  let cached = paramsStringCache.get(task)
  if (cached === undefined) {
    cached = JSON.stringify(task.params)
    paramsStringCache.set(task, cached)
  }
  return cached
}

export function filterGalleryTasks({
  activeFavoriteCollectionId,
  filterFavorite,
  filterStatus,
  query,
  tasks,
}: GalleryTaskFilterOptions) {
  const normalizedQuery = query.trim().toLowerCase()

  return [...tasks]
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter((task) => {
      if (filterFavorite) {
        if (!task.isFavorite) return false
        if (
          activeFavoriteCollectionId &&
          activeFavoriteCollectionId !== ALL_FAVORITES_COLLECTION_ID &&
          !getTaskFavoriteCollectionIds(task).includes(activeFavoriteCollectionId)
        )
          return false
      } else if (task.isFavorite) {
        return false
      }

      if (filterStatus !== 'all') {
        if (filterStatus === 'error') {
          if (
            task.status !== 'error' &&
            !(task.status === 'done' && task.batchItemStatuses?.some((status) => status === 'error'))
          )
            return false
        } else if (task.status !== filterStatus) {
          return false
        }
      }

      if (!normalizedQuery) return true
      const prompt = (task.prompt || '').toLowerCase()
      const params = getParamsString(task).toLowerCase()
      const error = task.error?.toLowerCase() ?? ''
      const batchErrors = task.batchItemErrors?.map((item) => item.error.toLowerCase()).join(' ') ?? ''
      return (
        prompt.includes(normalizedQuery) ||
        params.includes(normalizedQuery) ||
        error.includes(normalizedQuery) ||
        batchErrors.includes(normalizedQuery)
      )
    })
}
