import type { AssetCollection, AssetLibraryFilters, AssetLibraryScope, AssetSortKey, GeneratedAsset } from '../../types'
import { assetScopeMatches } from '../../lib/assetLibraryModel'

export const ASSET_RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** 归一化标签计数：桌面端 SQLite 返回 Record，内存查询返回 Map，统一为 Map。 */
export function toByTagMap(byTag: Map<string, number> | Record<string, number> | undefined): Map<string, number> {
  if (!byTag) return new Map()
  if (byTag instanceof Map) return byTag
  return new Map(Object.entries(byTag))
}

/** 归一化标签计数为 Record（写回 SQLite 分页结果用）。 */
export function toByTagRecord(byTag: Map<string, number> | Record<string, number> | undefined): Record<string, number> {
  if (!byTag) return {}
  if (byTag instanceof Map) return Object.fromEntries(byTag)
  return byTag
}

export interface AssetQuerySnapshot {
  assets: GeneratedAsset[]
  collections: AssetCollection[]
}

export interface AssetQueryState {
  scope: AssetLibraryScope
  query: string
  filters: AssetLibraryFilters
  sortKey: AssetSortKey
  sortOrder: 'asc' | 'desc'
}

export interface AssetSidebarCounts {
  all: number
  recent: number
  favorites: number
  unorganized: number
  trash: number
  byCollection: Map<string, number>
  /** 标签计数（仅统计 active 素材；空标签由侧栏按标签列表零填充展示） */
  byTag: Map<string, number>
}

export interface AssetQueryResult {
  assets: GeneratedAsset[]
  totalCount: number
  counts: AssetSidebarCounts
}

function normalizeText(value: string): string {
  return value.toLocaleLowerCase('zh-CN').trim()
}

/** 多词 AND 搜索；匹配原始/修订提示词、模型、API 配置名、文件名与项目名。 */
function matchesQuery(
  asset: GeneratedAsset,
  terms: string[],
  collectionNameById: ReadonlyMap<string, string>,
): boolean {
  if (terms.length === 0) return true
  const haystack: string[] = []
  for (const origin of asset.origins) {
    if (origin.prompt) haystack.push(origin.prompt)
    if (origin.revisedPrompt) haystack.push(origin.revisedPrompt)
    if (origin.apiModel) haystack.push(origin.apiModel)
    if (origin.apiProfileName) haystack.push(origin.apiProfileName)
    if (origin.filenameLabel) haystack.push(origin.filenameLabel)
    if (origin.generatedFileNameBase) haystack.push(origin.generatedFileNameBase)
  }
  for (const collectionId of asset.collectionIds) {
    const name = collectionNameById.get(collectionId)
    if (name) haystack.push(name)
  }
  if (asset.notes) haystack.push(asset.notes)
  const combined = normalizeText(haystack.join(' '))
  return terms.every((term) => combined.includes(term))
}

function getOrientation(asset: GeneratedAsset): 'landscape' | 'portrait' | 'square' | undefined {
  if (!asset.width || !asset.height) return undefined
  if (asset.width === asset.height) return 'square'
  return asset.width > asset.height ? 'landscape' : 'portrait'
}

function matchesFilters(asset: GeneratedAsset, filters: AssetLibraryFilters): boolean {
  if (filters.favoriteOnly && !asset.favorite) return false
  if (filters.minRating !== undefined && asset.rating < filters.minRating) return false
  if (filters.colorLabel && asset.colorLabel !== filters.colorLabel) return false
  if (filters.collectionId && !asset.collectionIds.includes(filters.collectionId)) return false
  if (filters.collectionIds && filters.collectionIds.length > 0) {
    if (!asset.collectionIds.some((id) => filters.collectionIds!.includes(id))) return false
  }
  if (filters.tagId && !asset.tagIds.includes(filters.tagId)) return false
  // 多选标签 AND：素材须同时包含全部选中标签（Eagle 侧栏多选语义）
  if (filters.tagIds && filters.tagIds.length > 0) {
    if (!filters.tagIds.every((tagId) => asset.tagIds.includes(tagId))) return false
  }
  if (filters.dateFrom !== undefined && asset.createdAt < filters.dateFrom) return false
  if (filters.dateTo !== undefined && asset.createdAt > filters.dateTo) return false
  if (filters.minWidth !== undefined && (asset.width ?? 0) < filters.minWidth) return false
  if (filters.maxWidth !== undefined && (asset.width ?? Infinity) > filters.maxWidth) return false
  if (filters.orientation) {
    const orientation = getOrientation(asset)
    if (orientation !== filters.orientation) return false
  }
  if (filters.provider) {
    const hasProvider = asset.origins.some((origin) => origin.apiProvider === filters.provider)
    if (!hasProvider) return false
  }
  if (filters.model) {
    const model = normalizeText(filters.model)
    const hasModel = asset.origins.some((origin) => origin.apiModel && normalizeText(origin.apiModel).includes(model))
    if (!hasModel) return false
  }
  if (filters.sourceMode) {
    const hasMode = asset.origins.some((origin) => origin.sourceMode === filters.sourceMode)
    if (!hasMode) return false
  }
  return true
}

function compareAssets(a: GeneratedAsset, b: GeneratedAsset, sortKey: AssetSortKey, sortOrder: 'asc' | 'desc'): number {
  let diff = 0
  switch (sortKey) {
    case 'createdAt':
      diff = a.createdAt - b.createdAt
      break
    case 'updatedAt':
      diff = a.updatedAt - b.updatedAt
      break
    case 'rating':
      diff = a.rating - b.rating
      break
    case 'width':
      diff = (a.width ?? 0) - (b.width ?? 0)
      break
    case 'area':
      diff = (a.width ?? 0) * (a.height ?? 0) - (b.width ?? 0) * (b.height ?? 0)
      break
  }
  if (diff !== 0) return sortOrder === 'asc' ? diff : -diff
  // 稳定次序兜底：创建时间倒序、id 升序
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * 判断单个素材是否仍匹配当前查询上下文（范围 / 搜索词 / 筛选）。
 * 分页快照去陈过滤用：素材被移动、改标签、改收藏后，SQLite 重查结果只增不删
 * （mergePagedAssets 不整页替换），用最新内存态按同一套纯函数复检，让已不属于
 * 当前范围/筛选的素材立即从网格消失，无需切换文件夹。
 */
export function assetMatchesQueryState(
  asset: GeneratedAsset,
  collections: AssetCollection[],
  state: Pick<AssetQueryState, 'scope' | 'query' | 'filters'>,
): boolean {
  const collectionNameById = new Map(collections.map((collection) => [collection.id, collection.name]))
  const terms = normalizeText(state.query).split(/\s+/).filter(Boolean)
  return (
    assetScopeMatches(state.scope, asset) &&
    matchesQuery(asset, terms, collectionNameById) &&
    matchesFilters(asset, state.filters)
  )
}

/**
 * 把分页快照素材解析为「当前网格实际渲染的对象」：
 * - 优先用内存最新态（liveById）替换快照对象——底栏批量操作（收藏/评分/颜色/项目等）
 *   只更新 assetsById，若不替换，网格卡片仍渲染 SQLite 查询快照里的旧对象，操作看起来不生效；
 * - 已删除/已回收（status 变化）或不在内存中的素材剔除；
 * - 归属/标签/收藏等变化按最新内存态 + 当前查询上下文复检，不再匹配即剔除。
 */
export function resolveEffectiveAssets(
  catalogAssets: GeneratedAsset[],
  liveById: Record<string, GeneratedAsset>,
  options: {
    collections: AssetCollection[]
    scope: AssetLibraryScope
    query: string
    filters: AssetLibraryFilters
    /** 相似搜索结果是跨范围推荐，不受当前文件夹范围/筛选约束，仅按状态过滤 */
    similarToAssetId?: string | null
  },
): GeneratedAsset[] {
  return catalogAssets
    .map((asset) => liveById[asset.id] ?? asset)
    .filter((asset) => {
      const live = liveById[asset.id]
      // 本地已删除/回收（status 变化）：立即消失
      if (!live || live.status !== asset.status) return false
      if (options.similarToAssetId) return true
      // 归属/标签/收藏等变化：按最新内存态 + 当前查询上下文复检，不再匹配即剔除
      return assetMatchesQueryState(live, options.collections, {
        scope: options.scope,
        query: options.query,
        filters: options.filters,
      })
    })
}

/**
 * 把新查询结果合并进已加载的分页列表：按 id 去重（保留先出现的），并把新素材插入到
 * 当前排序下的正确位置（Array.sort 稳定，既有素材相对顺序不变，网格不整体重排）。
 * 没有新增时返回原数组引用，避免无谓重渲染。
 */
export function mergePagedAssets(
  current: GeneratedAsset[],
  incoming: GeneratedAsset[],
  sortKey: AssetSortKey,
  sortOrder: 'asc' | 'desc',
): GeneratedAsset[] {
  if (incoming.length === 0) return current
  const seen = new Set<string>()
  for (const asset of current) seen.add(asset.id)
  const fresh: GeneratedAsset[] = []
  for (const asset of incoming) {
    if (seen.has(asset.id)) continue
    seen.add(asset.id)
    fresh.push(asset)
  }
  if (fresh.length === 0) return current
  const merged = [...current, ...fresh]
  merged.sort((a, b) => compareAssets(a, b, sortKey, sortOrder))
  return merged
}

function computeCounts(assets: GeneratedAsset[], collections: AssetCollection[], now: number): AssetSidebarCounts {
  const byCollection = new Map<string, number>()
  const byTag = new Map<string, number>()
  let all = 0
  let recent = 0
  let favorites = 0
  let unorganized = 0
  let trash = 0

  for (const asset of assets) {
    if (asset.status === 'trashed') {
      trash++
      continue
    }
    all++
    if (now - asset.createdAt <= ASSET_RECENT_WINDOW_MS) recent++
    if (asset.favorite) favorites++
    if (asset.collectionIds.length === 0) unorganized++
    for (const collectionId of asset.collectionIds)
      byCollection.set(collectionId, (byCollection.get(collectionId) ?? 0) + 1)
    for (const tagId of asset.tagIds) byTag.set(tagId, (byTag.get(tagId) ?? 0) + 1)
  }
  // 集合树保留全部条目（包括空项目），供侧栏展示
  for (const collection of collections) {
    if (!byCollection.has(collection.id)) byCollection.set(collection.id, 0)
  }
  return { all, recent, favorites, unorganized, trash, byCollection, byTag }
}

/** 纯函数查询：筛选 + 搜索 + 排序 + 侧栏计数；不访问 IndexedDB。 */
export function queryAssets(snapshot: AssetQuerySnapshot, state: AssetQueryState): AssetQueryResult {
  const { assets, collections } = snapshot
  const { scope, query, filters, sortKey, sortOrder } = state
  const now = Date.now()
  const collectionNameById = new Map(collections.map((collection) => [collection.id, collection.name]))
  const terms = normalizeText(query).split(/\s+/).filter(Boolean)

  const filtered = assets.filter((asset) => {
    if (!assetScopeMatches(scope, asset, now, ASSET_RECENT_WINDOW_MS)) return false
    if (!matchesQuery(asset, terms, collectionNameById)) return false
    return matchesFilters(asset, filters)
  })

  const sorted = filtered.slice().sort((a, b) => compareAssets(a, b, sortKey, sortOrder))
  return {
    assets: sorted,
    totalCount: sorted.length,
    counts: computeCounts(assets, collections, now),
  }
}
