import type { TaskRecord } from '../types'

/**
 * 在任务的本地落盘记录（localSavedOutputImagePaths）中查找某张图片的
 * 「树状工作区」目录副本路径（如 `库根/images/分组/标签页/xxx.png`，硬链接）。
 *
 * 键格式为 `${imageIndex}:${imageId}`（见 store.ts getLocalSavedOutputImageKey）；
 * 同一张图出现在多个任务时取 createdAt 最新的任务。
 */
export function findTaskSavedImagePath(
  tasks: readonly TaskRecord[],
  imageId: string,
): { taskId: string; path: string } | null {
  if (!imageId) return null
  const suffix = `:${imageId}`
  let best: { taskId: string; path: string } | null = null
  let bestCreatedAt = Number.NEGATIVE_INFINITY
  for (const task of tasks) {
    const paths = task?.localSavedOutputImagePaths
    if (!paths) continue
    for (const [key, path] of Object.entries(paths)) {
      if (typeof path !== 'string' || !path) continue
      if (key.endsWith(suffix) && (task.createdAt ?? 0) >= bestCreatedAt) {
        bestCreatedAt = task.createdAt ?? 0
        best = { taskId: task.id, path }
      }
    }
  }
  return best
}

/**
 * 「打开文件位置」的目标路径：优先返回树状工作区目录中的落盘副本
 * （images/分组/标签页/...，硬链接，用户可直接看到按工作区树组织的文件夹结构），
 * 找不到落盘记录（如旧库素材）时回退到素材库权威原图（cache-images）。
 */
export function resolveImageRevealPath(
  imageId: string,
  tasks: readonly TaskRecord[],
  image?: { localPath?: string } | null,
): string | null {
  const saved = findTaskSavedImagePath(tasks, imageId)
  if (saved?.path) return saved.path
  return image?.localPath ?? null
}
