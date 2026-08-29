import type { AssetCollection } from '../types'

/**
 * 由项目文件夹 id 反查「顶级 → 该文件夹」的名称链（多级项目树）。
 *
 * 用途：生成的图片按项目层级保存到本地（如 `保存根目录/images/项目A/子项目B/`）。
 * 返回 null 表示无法解析（collection 不存在或数据未加载），调用方回退到原有目录逻辑。
 */
export function resolveCollectionFolderSegments(collections: AssetCollection[], collectionId: string): string[] | null {
  if (collections.length === 0 || !collectionId) return null
  const byId = new Map(collections.map((collection) => [collection.id, collection]))
  if (!byId.has(collectionId)) return null

  const segments: string[] = []
  let current = byId.get(collectionId)
  // 防御性上限 + 已访问检测：数据异常（parentId 成环）时避免死循环或重复段
  const visited = new Set<string>()
  let guard = 0
  while (current && !visited.has(current.id) && guard < 100) {
    visited.add(current.id)
    segments.unshift(current.name)
    current = current.parentId ? byId.get(current.parentId) : undefined
    guard++
  }
  return segments.length > 0 ? segments : null
}
