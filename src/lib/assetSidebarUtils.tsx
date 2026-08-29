import type { AssetCollection } from '../types'

/**
 * 素材库侧栏（AssetLibrarySidebar）的纯函数工具：
 * 树过滤、拖放数据解析、移动目标计算。
 */

export interface CollectionTreeNode {
  collection: AssetCollection
  children: CollectionTreeNode[]
}

/** 筛选树：命中节点保留整棵子树；未命中但有命中子级时保留该分支（父链自动展开）。 */
export function filterCollectionTree(
  nodes: CollectionTreeNode[],
  matches: (node: CollectionTreeNode) => boolean,
): CollectionTreeNode[] {
  return nodes.flatMap((node) => {
    if (matches(node)) return [node]
    const children = filterCollectionTree(node.children, matches)
    return children.length > 0 ? [{ ...node, children }] : []
  })
}

const ASSET_IMAGE_PREFIX = 'asset-image:'

/** 多选拖拽的附加负载类型：JSON 数组存放全部选中素材的 asset id（text/plain 仍保留单张兼容旧入口）。 */
export const ASSET_IDS_DATA_TYPE = 'application/x-doupao-asset-ids'

/** 拖拽携带的源文件夹 id（仅从文件夹 scope 拖出时存在）：用于「移动 = 剪切」语义，drop 时移除该文件夹归属。 */
export const ASSET_SOURCE_DATA_TYPE = 'application/x-doupao-asset-source'

/** 从拖拽负载解析素材 id（AssetGrid 以 text/plain 写入 `asset-image:${imageId}`）；非素材拖拽返回 null。 */
export function parseAssetImagePayload(dataTransfer: DataTransfer | null): string | null {
  if (!dataTransfer) return null
  const text = dataTransfer.getData('text/plain')
  if (!text.startsWith(ASSET_IMAGE_PREFIX)) return null
  const assetId = text.slice(ASSET_IMAGE_PREFIX.length).trim()
  return assetId || null
}

/**
 * 解析拖拽负载对应的全部素材 id：
 * 多选拖拽时优先读 `ASSET_IDS_DATA_TYPE`（JSON 数组，元素为 asset id）；
 * 否则回退单张 `asset-image:${imageId}`。返回空数组表示非素材拖拽。
 */
export function parseAssetImagePayloadList(dataTransfer: DataTransfer | null): string[] {
  if (!dataTransfer) return []
  const multi = dataTransfer.getData(ASSET_IDS_DATA_TYPE)
  if (multi) {
    try {
      const parsed = JSON.parse(multi)
      if (Array.isArray(parsed)) {
        const ids = parsed.filter((id): id is string => typeof id === 'string' && id.length > 0)
        if (ids.length > 0) return ids
      }
    } catch {
      /* 非法负载按单张回退 */
    }
  }
  const single = parseAssetImagePayload(dataTransfer)
  return single ? [single] : []
}

/** dragover 阶段无法读取内容，按类型粗判：接受 text/plain 拖拽（drop 时再严格校验前缀）。 */
export function canAcceptAssetDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false
  const types = Array.from(dataTransfer.types)
  if (types.includes('Files')) return false
  return types.includes('text/plain')
}

/** 解析拖拽携带的源文件夹 id（没有 = 从非文件夹视图拖出，drop 语义为「添加」而非「移动」）。 */
export function parseAssetSourceCollectionId(dataTransfer: DataTransfer | null): string | null {
  if (!dataTransfer) return null
  const value = dataTransfer.getData(ASSET_SOURCE_DATA_TYPE)
  return value || null
}

export interface MoveDestination {
  id: string | null
  label: string
  depth: number
}

interface TreeEntry {
  id: string
  parentId: string | null
  name: string
}

/** 计算项目树的递归计数：每个节点 = 直接素材数 + 全部后代直接素材数（「包含子文件夹」开启时的侧栏计数）。 */
export function computeRecursiveCollectionCounts(
  collections: AssetCollection[],
  byCollection: ReadonlyMap<string, number>,
): Map<string, number> {
  const result = new Map<string, number>()
  const childrenByParent = new Map<string, string[]>()
  for (const collection of collections) {
    if (!collection.parentId) continue
    const siblings = childrenByParent.get(collection.parentId) ?? []
    siblings.push(collection.id)
    childrenByParent.set(collection.parentId, siblings)
  }
  const visit = (id: string): number => {
    let total = byCollection.get(id) ?? 0
    for (const childId of childrenByParent.get(id) ?? []) total += visit(childId)
    result.set(id, total)
    return total
  }
  for (const collection of collections) {
    if (collection.parentId) continue
    visit(collection.id)
  }
  // 非根节点若因坏链未访问，单独补齐
  for (const collection of collections) {
    if (!result.has(collection.id)) result.set(collection.id, byCollection.get(collection.id) ?? 0)
  }
  return result
}

/** 计算「移动到…」的目标列表：排除自身与后代，顶级入口在前。 */
export function computeMoveDestinations<T extends TreeEntry>(treeItems: T[], targetId: string): MoveDestination[] {
  const excluded = new Set<string>([targetId])
  const childrenOf = (parentId: string) => treeItems.filter((item) => item.parentId === parentId).map((item) => item.id)
  const stack = [targetId]
  while (stack.length > 0) {
    const parentId = stack.pop()!
    for (const childId of childrenOf(parentId)) {
      if (!excluded.has(childId)) {
        excluded.add(childId)
        stack.push(childId)
      }
    }
  }
  const depthOf = new Map<string, number>()
  const resolveDepth = (id: string | null): number => {
    if (!id) return 0
    const cached = depthOf.get(id)
    if (cached !== undefined) return cached
    const item = treeItems.find((entry) => entry.id === id)
    const depth = item ? resolveDepth(item.parentId) + 1 : 0
    depthOf.set(id, depth)
    return depth
  }
  return [
    { id: null, label: '（设为顶级）', depth: 0 },
    ...treeItems
      .filter((item) => !excluded.has(item.id))
      .map((item) => ({ id: item.id, label: item.name, depth: resolveDepth(item.id) })),
  ]
}

/** 批量「移动到…」目标列表：排除多个目标及其全部后代。 */
export function computeBatchMoveDestinations<T extends TreeEntry>(
  treeItems: T[],
  targetIds: string[],
): MoveDestination[] {
  const excluded = new Set<string>()
  const childrenOf = (parentId: string) => treeItems.filter((item) => item.parentId === parentId).map((item) => item.id)
  const stack = [...targetIds]
  while (stack.length > 0) {
    const parentId = stack.pop()!
    if (excluded.has(parentId)) continue
    excluded.add(parentId)
    for (const childId of childrenOf(parentId)) stack.push(childId)
  }
  const depthOf = new Map<string, number>()
  const resolveDepth = (id: string | null): number => {
    if (!id) return 0
    const cached = depthOf.get(id)
    if (cached !== undefined) return cached
    const item = treeItems.find((entry) => entry.id === id)
    const depth = item ? resolveDepth(item.parentId) + 1 : 0
    depthOf.set(id, depth)
    return depth
  }
  return [
    { id: null, label: '（设为顶级）', depth: 0 },
    ...treeItems
      .filter((item) => !excluded.has(item.id))
      .map((item) => ({ id: item.id, label: item.name, depth: resolveDepth(item.id) })),
  ]
}
