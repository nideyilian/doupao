import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { AssetLibraryFilters, AssetLibraryScope, GeneratedAsset, TaskRecord } from '../../types'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { useCloseOnEscape } from '../../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../../hooks/usePreventBackgroundScroll'
import { IconButton, useDialogFocusTrap } from '../../design-system'
import { XIcon } from '../../design-system/icons'
import { useAssetLibraryStore } from './store'
import {
  queryAssets,
  mergePagedAssets,
  assetMatchesQueryState,
  resolveEffectiveAssets,
  toByTagMap,
  type AssetSidebarCounts,
} from './query'
import { hasTaskFailure } from '../../lib/assetBatchGrouping'
import AssetLibrarySidebar from './AssetLibrarySidebar'
import AssetLibraryToolbar from './AssetLibraryToolbar'
import AssetFilterTabBar from './AssetFilterTabBar'
import AssetGrid from './AssetGrid'
import AssetListView from './AssetListView'
import AssetGroupedView from './AssetBatchView'
import AssetDetailPanel from './AssetDetailPanel'
import SubfolderStrip from './SubfolderStrip'
import AssetPurgeModal from './AssetPurgeModal'
import AssetDuplicateModal from './AssetDuplicateModal'
import AssetViewer from './AssetViewer'
import { AssetQuickPreview } from './AssetQuickPreview'
import { assetCommands } from '../../lib/assetCommands'
import { useAssetLibraryShortcuts } from '../../hooks/useAssetLibraryShortcuts'
import {
  useStore,
  ALL_FAVORITES_COLLECTION_ID,
  getTaskFavoriteCollectionIds,
  prefetchImageThumbnails,
} from '../../store'
import { FavoriteCollectionsView } from '../../components/FavoriteCollections'

function serializeScope(scope: AssetLibraryScope): string {
  // 兼容历史智能文件夹：旧数据可能保存了 tag 范围，仅保留序列化能力（界面已无标签入口）
  if (typeof scope === 'object') return scope.kind === 'collection' ? `collection:${scope.id}` : `tag:${scope.id}`
  return scope
}

function scopeLabel(
  scope: AssetLibraryScope,
  collectionNames: ReadonlyMap<string, string>,
  tagNames: ReadonlyMap<string, string>,
): string {
  if (typeof scope === 'object') {
    if (scope.kind === 'collection') return `项目 · ${collectionNames.get(scope.id) ?? '未命名'}`
    return `标签 · ${tagNames.get(scope.id) ?? '未命名'}`
  }
  switch (scope) {
    case 'all':
      return '全部素材'
    case 'recent':
      return '最近生成'
    case 'favorites':
      return '收藏'
    case 'unorganized':
      return '未整理'
    case 'trash':
      return '回收站'
    default:
      return '素材库'
  }
}

function AssetLibraryWorkspaceInner() {
  const assetsById = useAssetLibraryStore((state) => state.assetsById)
  const assetOrder = useAssetLibraryStore((state) => state.assetOrder)
  const collections = useAssetLibraryStore((state) => state.collections)
  const tags = useAssetLibraryStore((state) => state.tags)
  const hydrationStatus = useAssetLibraryStore((state) => state.hydrationStatus)
  const migrationStatus = useAssetLibraryStore((state) => state.migrationStatus)
  const migrationError = useAssetLibraryStore((state) => state.migrationError)
  const migrationProgress = useAssetLibraryStore((state) => state.migrationProgress)
  const hydrate = useAssetLibraryStore((state) => state.hydrate)
  const scope = useAssetLibraryStore((state) => state.scope)
  const setScope = useAssetLibraryStore((state) => state.setScope)
  const query = useAssetLibraryStore((state) => state.query)
  const filters = useAssetLibraryStore((state) => state.filters)
  const sortKey = useAssetLibraryStore((state) => state.sortKey)
  const sortOrder = useAssetLibraryStore((state) => state.sortOrder)
  const viewMode = useAssetLibraryStore((state) => state.viewMode)
  const groupBy = useAssetLibraryStore((state) => state.groupBy)
  const setGroupBy = useAssetLibraryStore((state) => state.setGroupBy)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const setFilterFavorite = useStore((s) => s.setFilterFavorite)
  const setActiveFavoriteCollectionId = useStore((s) => s.setActiveFavoriteCollectionId)
  const mainTasks = useStore((s) => s.tasks)
  const favoriteCollections = useStore((s) => s.favoriteCollections)
  const detailOpen = useAssetLibraryStore((state) => state.detailOpen)
  const sidebarOpen = useAssetLibraryStore((state) => state.sidebarOpen)
  const setSidebarOpen = useAssetLibraryStore((state) => state.setSidebarOpen)
  const setDetailOpen = useAssetLibraryStore((state) => state.setDetailOpen)
  const applyUpsertedAssets = useAssetLibraryStore((state) => state.applyUpsertedAssets)
  const operationProgress = useAssetLibraryStore((state) => state.operationProgress)
  // 素材归属/状态变更版本号：桌面端目录计数（SQLite 聚合）依赖它重新拉取，保证移动/回收后计数即时更新
  const mutationVersion = useAssetLibraryStore((state) => state.mutationVersion)
  // 批量操作防抖：连续操作（导入逐张入库 / 批量移动/删除）只合并为一次目录重查，
  // 避免每张素材都触发一次 SQLite 分页查询 + counts 聚合（主进程同步查询的批量卡顿源头之一）。
  const [debouncedMutationVersion, setDebouncedMutationVersion] = useState(mutationVersion)
  useEffect(() => {
    if (debouncedMutationVersion === mutationVersion) return
    const timer = setTimeout(() => setDebouncedMutationVersion(mutationVersion), 400)
    return () => clearTimeout(timer)
  }, [debouncedMutationVersion, mutationVersion])
  const isNarrow = useMediaQuery('(max-width: 1023px)')
  const sidebarDrawerRef = useRef<HTMLDivElement>(null)
  const detailDrawerRef = useRef<HTMLDivElement>(null)
  const modalOpen = isNarrow && (sidebarOpen || detailOpen)

  useCloseOnEscape(isNarrow && detailOpen, () => setDetailOpen(false))
  useCloseOnEscape(isNarrow && sidebarOpen && !detailOpen, () => setSidebarOpen(false))
  useDialogFocusTrap(isNarrow && sidebarOpen && !detailOpen, sidebarDrawerRef)
  useDialogFocusTrap(isNarrow && detailOpen, detailDrawerRef)
  usePreventBackgroundScroll(modalOpen, detailOpen ? detailDrawerRef : sidebarDrawerRef)

  useEffect(() => {
    if (hydrationStatus === 'idle') void hydrate()
  }, [hydrationStatus, hydrate])

  // 项目文件夹隔离：素材库范围切换时保存/恢复各文件夹的生成输入草稿（提示词/参数/参考图/遮罩）
  useEffect(() => {
    // 挂载时先按当前范围初始化/恢复一次（覆盖应用重启后输入状态与文件夹上下文的对齐）
    useStore.getState().onAssetLibraryFolderScopeChange(scope, scope)
    return useAssetLibraryStore.subscribe((state, prev) => {
      if (state.scope === prev.scope) return
      useStore.getState().onAssetLibraryFolderScopeChange(prev.scope, state.scope)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--asset-library-sidebar-width', isNarrow ? '0px' : 'var(--asset-library-panel-width)')
    return () => root.style.setProperty('--asset-library-sidebar-width', '0px')
  }, [isNarrow])

  const deferredQuery = useDeferredValue(query)
  const desktopCatalog = typeof window !== 'undefined' && Boolean(window.electronAPI?.assetCatalogQuery)
  const [catalogPage, setCatalogPage] = useState<{
    assets: GeneratedAsset[]
    totalCount: number
    nextCursor: string | null
    counts: AssetSidebarCounts
  } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const assets = useMemo(() => {
    const result: GeneratedAsset[] = []
    for (const id of assetOrder) {
      const asset = assetsById[id]
      if (asset) result.push(asset)
    }
    return result
  }, [assetOrder, assetsById])

  // 收藏夹模式：概览（卡片）与收藏夹素材（asset 网格）都在素材库界面内渲染。
  const inFavoritesOverview = filterFavorite && !activeFavoriteCollectionId
  const inFavoriteCollection = filterFavorite && activeFavoriteCollectionId !== null

  // 收藏夹 → 任务 → 素材：收藏夹素材候选集（桌面端素材库为 SQLite 全量内存，覆盖完整）
  const favoriteCollectionTaskIds = useMemo(() => {
    if (!inFavoriteCollection || !activeFavoriteCollectionId) return null
    const favoriteTasks = mainTasks.filter((task) => task.isFavorite)
    const ids =
      activeFavoriteCollectionId === ALL_FAVORITES_COLLECTION_ID
        ? favoriteTasks
        : favoriteTasks.filter((task) => getTaskFavoriteCollectionIds(task).includes(activeFavoriteCollectionId))
    return new Set(ids.map((task) => task.id))
  }, [activeFavoriteCollectionId, inFavoriteCollection, mainTasks])

  const favoriteCollectionAssets = useMemo(() => {
    if (!favoriteCollectionTaskIds) return null
    return assets.filter((asset) => asset.origins.some((origin) => favoriteCollectionTaskIds!.has(origin.taskId)))
  }, [assets, favoriteCollectionTaskIds])

  /** 退出收藏夹模式并回到素材库普通浏览 */
  const exitFavoritesMode = useCallback(() => {
    setFilterFavorite(false)
    setActiveFavoriteCollectionId(null)
  }, [setActiveFavoriteCollectionId, setFilterFavorite])

  // 「包含子文件夹」：项目 scope 下把自身与全部后代集合 id 展开进筛选（递归查询）
  const includeSubcollections = useAssetLibraryStore((state) => state.includeSubcollections)
  const collectionDescendantIds = useMemo(() => {
    if (typeof scope !== 'object' || scope.kind !== 'collection') return undefined
    const ids = new Set<string>([scope.id])
    const childrenOf = new Map<string, string[]>()
    for (const collection of collections) {
      if (!collection.parentId || collection.trashedAt) continue
      const siblings = childrenOf.get(collection.parentId) ?? []
      siblings.push(collection.id)
      childrenOf.set(collection.parentId, siblings)
    }
    const stack = [scope.id]
    while (stack.length > 0) {
      const parentId = stack.pop()!
      for (const childId of childrenOf.get(parentId) ?? []) {
        if (ids.has(childId)) continue
        ids.add(childId)
        stack.push(childId)
      }
    }
    return [...ids]
  }, [collections, scope])
  const effectiveFilters = useMemo<AssetLibraryFilters>(() => {
    if (includeSubcollections && collectionDescendantIds && collectionDescendantIds.length > 1) {
      return { ...filters, collectionIds: collectionDescendantIds }
    }
    return filters
  }, [collectionDescendantIds, filters, includeSubcollections])

  // 「包含子文件夹」递归展开时，查询范围退化为「全部」，仅靠 collectionIds 过滤，
  // 避免 scope 的「直接成员」条件与递归 collectionIds 条件被错误地 AND 叠加（导致子文件夹素材被漏掉）。
  const queryScope = useMemo<AssetLibraryScope>(
    () => (includeSubcollections && collectionDescendantIds && collectionDescendantIds.length > 1 ? 'all' : scope),
    [includeSubcollections, collectionDescendantIds, scope],
  )

  // 图片模式（groupBy === 'none'）下素材网格只展示已入库素材，生成中/失败的任务没有任何
  // 素材 → 界面上完全不可见（用户感知为「提交后无反应」）。这里统计与任务卡视图
  // includeTaskless 相同过滤语义的运行中/失败任务，在图片模式顶部给出持续可见的提示条，
  // 点击可一键切到任务卡片视图查看进度/失败原因，无需切换文件夹。
  // 注意：统计口径必须与任务卡视图完全一致（含失败任务按所属文件夹过滤），
  // 否则会出现「提示 3 个任务失败，点进去却看不到任何失败任务卡」的不一致。
  const runningFailedCounts = useMemo(() => {
    const current = serializeScope(scope)
    if (current === 'trash' || current === 'favorite' || current === 'unorganized' || current.startsWith('tag:')) {
      // 素材专属作用域：与任务卡视图一致，失败任务（含部分失败）仍计入/保留
      let failed = 0
      for (const task of mainTasks) if (hasTaskFailure(task)) failed += 1
      if (failed === 0) return null
      return { running: 0, failed }
    }
    let inSubtree: (task: TaskRecord) => boolean
    if (current.startsWith('collection:')) {
      const rootId = current.slice('collection:'.length)
      const subtree = new Set<string>()
      const stack = [rootId]
      while (stack.length > 0) {
        const id = stack.pop()!
        if (subtree.has(id)) continue
        subtree.add(id)
        for (const collection of collections) if (collection.parentId === id) stack.push(collection.id)
      }
      // 与 AssetBatchView includeTaskless 的 collection 分支同口径：
      // 生成中/失败任务都按 defaultCollectionId 归属过滤，不跨文件夹统计。
      // includeSubcollections 开关在两种场景的语义一致（任务卡视图按开关放行子树任务，
      // 素材查询在开关关闭时只返回直接成员素材，此处按子树统计对应的失败任务可被
      // 直接成员素材驱动显示；为与任务卡视图保持一致，此处同样按子树判断）。
      inSubtree = (task) => task.defaultCollectionId != null && subtree.has(task.defaultCollectionId)
    } else {
      inSubtree = () => true
    }
    let running = 0
    let failed = 0
    for (const task of mainTasks) {
      if (!inSubtree(task)) continue
      if (task.status === 'running' || task.falRecoverable || task.customRecoverable) running += 1
      else if (hasTaskFailure(task)) failed += 1
    }
    if (running === 0 && failed === 0) return null
    return { running, failed }
  }, [collections, mainTasks, scope])

  const queryResult = useMemo(
    () =>
      queryAssets(
        { assets: favoriteCollectionAssets ?? assets, collections },
        {
          scope: inFavoriteCollection ? 'all' : queryScope,
          query: deferredQuery,
          filters: effectiveFilters,
          sortKey,
          sortOrder,
        },
      ),
    [
      assets,
      collections,
      favoriteCollectionAssets,
      inFavoriteCollection,
      queryScope,
      deferredQuery,
      effectiveFilters,
      sortKey,
      sortOrder,
    ],
  )

  // 相似图片搜索：以某素材为基准，按感知哈希/文本/使用行为排序（Electron 走 SQLite）
  const similarToAssetId = useAssetLibraryStore((state) => state.similarToAssetId)
  const setSimilarToAsset = useAssetLibraryStore((state) => state.setSimilarToAsset)
  const similarAsset = similarToAssetId ? assetsById[similarToAssetId] : undefined
  const similarLabel = useMemo(() => {
    if (!similarAsset) return undefined
    const origin =
      similarAsset.origins.find((item) => item.key === similarAsset.primaryOriginKey) ?? similarAsset.origins[0]
    const prompt = origin?.prompt?.trim()
    return prompt ? (prompt.length > 24 ? `相似图片 · ${prompt.slice(0, 24)}…` : `相似图片 · ${prompt}`) : '相似图片'
  }, [similarAsset])

  // 查询上下文签名（范围/搜索/筛选/排序/相似基准）：变化时清空分页游标并重置滚动；
  // mutationVersion（删除/移动/入库）不属于上下文——内容更新时保持分页与滚动位置。
  const queryContextKey = `${serializeScope(scope)}|${deferredQuery}|${sortKey}|${sortOrder}|${JSON.stringify(effectiveFilters)}|${similarToAssetId ?? ''}`

  // 查询上下文变化 → 清空分页游标（回退内存查询并重置滚动）。
  // 注意：mutationVersion（删除/移动/入库）不属于上下文，不会清空 catalogPage，
  // 避免 assets 在「分页 ↔ 全量」间剧变导致网格滚动位置被浏览器 clamp 到顶部。
  const prevQueryContextRef = useRef(queryContextKey)
  useEffect(() => {
    if (prevQueryContextRef.current === queryContextKey) return
    prevQueryContextRef.current = queryContextKey
    setCatalogPage(null)
  }, [queryContextKey])

  useEffect(() => {
    if (hydrationStatus !== 'ready') return
    let active = true
    // 收藏夹模式走内存查询（收藏夹素材候选集已在内存中），不触发桌面 SQLite 分页搜索
    if (filterFavorite) return
    if (similarToAssetId) {
      void assetCommands
        .recommend({ similarToAssetId, limit: 50 })
        .then((items) => {
          if (!active) return
          const ranked = items.map((item) => item.asset)
          applyUpsertedAssets(ranked)
          prefetchImageThumbnails(ranked.map((asset) => asset.imageId))
          setCatalogPage({
            assets: ranked,
            totalCount: ranked.length,
            nextCursor: null,
            counts: queryResult.counts,
          })
        })
        .catch(() => {
          if (active) setCatalogPage(null)
        })
      return () => {
        active = false
      }
    }
    if (!desktopCatalog) return
    void assetCommands
      .searchAssetPage({
        scope: queryScope,
        query: deferredQuery,
        filters: effectiveFilters,
        sortKey,
        sortOrder,
        limit: 120,
        semantic: { enabled: Boolean(deferredQuery.trim()), context: deferredQuery },
      })
      .then((page) => {
        if (!active) return
        applyUpsertedAssets(page.assets)
        prefetchImageThumbnails(page.assets.map((asset) => asset.imageId))
        // mutationVersion 变化（删除/移动/入库）重跑本查询：刷新计数，并把查询结果里的
        // 新素材合并进当前分页（按 id 去重 + 按当前排序稳定重排）——新生成的图片立即
        // 出现在网格中，无需切换文件夹；已加载素材保持相对顺序，避免整页替换导致
        // 内容回卷、滚动位置被浏览器 clamp；无新增时保持原引用不触发重渲染。
        setCatalogPage((current) => {
          const counts = {
            ...page.counts,
            byCollection: new Map(collections.map((item) => [item.id, page.counts.byCollection[item.id] ?? 0])),
            byTag: toByTagMap(page.counts.byTag),
          }
          if (!current) {
            return { assets: page.assets, totalCount: page.totalCount, nextCursor: page.nextCursor, counts }
          }
          return {
            ...current,
            assets: mergePagedAssets(current.assets, page.assets, sortKey, sortOrder),
            totalCount: page.totalCount,
            counts,
          }
        })
      })
      .catch(() => {
        if (active) setCatalogPage(null)
      })
    return () => {
      active = false
    }
  }, [
    applyUpsertedAssets,
    collections,
    debouncedMutationVersion,
    deferredQuery,
    desktopCatalog,
    effectiveFilters,
    filterFavorite,
    hydrationStatus,
    queryScope,
    similarToAssetId,
    sortKey,
    sortOrder,
  ])

  const loadMore = useCallback(() => {
    if (!desktopCatalog || !catalogPage?.nextCursor || loadingMore) return
    setLoadingMore(true)
    void assetCommands
      .searchAssetPage({
        scope: queryScope,
        query: deferredQuery,
        filters: effectiveFilters,
        sortKey,
        sortOrder,
        cursor: catalogPage.nextCursor,
        limit: 120,
      })
      .then((page) => {
        applyUpsertedAssets(page.assets)
        prefetchImageThumbnails(page.assets.map((asset) => asset.imageId))
        setCatalogPage((current) =>
          current
            ? {
                ...current,
                // 去重合并：目录页可能已通过 mutationVersion 重查把新素材并入，
                // 后续游标页与已加载内容按 id 去重，避免重复卡片。
                assets: mergePagedAssets(current.assets, page.assets, sortKey, sortOrder),
                nextCursor: page.nextCursor,
                totalCount: page.totalCount,
              }
            : current,
        )
      })
      .finally(() => setLoadingMore(false))
  }, [
    applyUpsertedAssets,
    catalogPage?.nextCursor,
    deferredQuery,
    desktopCatalog,
    effectiveFilters,
    loadingMore,
    queryScope,
    sortKey,
    sortOrder,
  ])

  // 分页快照中的素材可能已被本地删除/移动/改标签/改评分/改收藏（mutationVersion 变化后
  // catalogPage 保留旧引用）：用 store 内存最新态替换快照对象并复检——
  // 1) 底栏批量操作（收藏/评分/颜色/项目）只更新 assetsById，不替换对象则网格卡片
  //    仍渲染 SQLite 查询快照里的旧值，操作看起来不生效；
  // 2) 删除的素材立即从网格消失而不等待重查，同时保持滚动位置；
  // 3) 已不属于当前文件夹/筛选的素材立即剔除。
  const effectiveResult = useMemo(() => {
    if (filterFavorite) return queryResult
    if (!catalogPage) return queryResult
    return {
      ...catalogPage,
      assets: resolveEffectiveAssets(catalogPage.assets, assetsById, {
        collections,
        scope: queryScope,
        query: deferredQuery,
        filters: effectiveFilters,
        similarToAssetId,
      }),
    }
  }, [
    assetsById,
    catalogPage,
    collections,
    deferredQuery,
    effectiveFilters,
    filterFavorite,
    queryResult,
    queryScope,
    similarToAssetId,
  ])
  const collectionNames = useMemo(
    () => new Map(collections.map((collection) => [collection.id, collection.name])),
    [collections],
  )
  const tagNames = useMemo(() => new Map(tags.map((tag) => [tag.id, tag.name])), [tags])
  const favoriteCollectionName = useMemo(() => {
    if (!inFavoriteCollection || !activeFavoriteCollectionId) return undefined
    if (activeFavoriteCollectionId === ALL_FAVORITES_COLLECTION_ID) return '全部'
    return favoriteCollections.find((item) => item.id === activeFavoriteCollectionId)?.name
  }, [activeFavoriteCollectionId, favoriteCollections, inFavoriteCollection])
  // 标签计数零填充：桌面端 SQLite 只返回有素材的标签，空标签也需在侧栏展示（与项目计数同策略）
  const counts: AssetSidebarCounts = useMemo(() => {
    const base = effectiveResult.counts
    const byTag = toByTagMap(base.byTag)
    for (const tag of tags) if (!byTag.has(tag.id)) byTag.set(tag.id, 0)
    return { ...base, byTag }
  }, [effectiveResult.counts, tags])
  const selectedScope = serializeScope(scope)

  // 查询上下文签名：切文件夹/搜索/筛选/排序 → 网格重置滚动到顶部；
  // 批量操作/素材入库（内容更新，不改变上下文）→ 保持滚动，避免图片跳动闪烁。
  const resetScrollKey = `${selectedScope}|${deferredQuery}|${sortKey}|${sortOrder}|${JSON.stringify(effectiveFilters)}`

  // 永久删除确认弹窗（含引用冲突预览）
  const [purgeRequest, setPurgeRequest] = useState<{ ids: string[]; title?: string; forceByDefault?: boolean } | null>(
    null,
  )
  const [duplicatesOpen, setDuplicatesOpen] = useState(false)
  const requestPurge = useCallback((ids: string[], title?: string, forceByDefault = false) => {
    if (ids.length === 0) return
    setPurgeRequest({ ids, title, forceByDefault })
  }, [])

  // 详情面板连续浏览：按当前查询结果前后切换
  const activeAssetId = useAssetLibraryStore((state) => state.activeAssetId)
  const goPrevAsset = useCallback(() => {
    const visible = effectiveResult.assets
    if (visible.length === 0) return
    const index = visible.findIndex((asset) => asset.id === activeAssetId)
    const prev = index <= 0 ? visible[visible.length - 1] : visible[index - 1]
    if (prev) useAssetLibraryStore.getState().setActiveAsset(prev.id)
  }, [activeAssetId, effectiveResult.assets])
  const goNextAsset = useCallback(() => {
    const visible = effectiveResult.assets
    if (visible.length === 0) return
    const index = visible.findIndex((asset) => asset.id === activeAssetId)
    const next = index < 0 || index >= visible.length - 1 ? visible[0] : visible[index + 1]
    if (next) useAssetLibraryStore.getState().setActiveAsset(next.id)
  }, [activeAssetId, effectiveResult.assets])

  // Eagle 式全局快捷键：空格/Enter 打开查看器、Esc 取消选择、Delete 回收站、1-5/F/C 评分/收藏/颜色
  const searchInputRef = useRef<HTMLInputElement>(null)
  const openViewerFromShortcut = useCallback(
    (assetId: string) => {
      const assetIdList = effectiveResult.assets.map((item) => item.id)
      const asset = effectiveResult.assets.find((item) => item.id === assetId)
      if (asset) useAssetLibraryStore.getState().openViewer(asset.id, assetIdList)
    },
    [effectiveResult.assets],
  )
  useAssetLibraryShortcuts({
    onFocusSearch: () => searchInputRef.current?.focus(),
    onOpenViewer: openViewerFromShortcut,
  })

  // Ctrl+A / Cmd+A 与「全选当前结果」按钮：遍历查询全部匹配素材后一次性选中，
  // 不再受分页加载（每页 120）限制——全选即选当前查询下的全部结果。
  const [selectingAll, setSelectingAll] = useState(false)
  const selectAllVisible = useCallback(() => {
    if (selectingAll) return
    const visibleIds = effectiveResult.assets.map((asset) => asset.id)
    if (visibleIds.length === 0) return
    void (async () => {
      setSelectingAll(true)
      try {
        if (filterFavorite) {
          // 收藏夹模式：候选集已在内存中（无分页），effectiveResult 即全量结果
          useAssetLibraryStore.getState().selectAllVisibleAssets(visibleIds)
          useStore.getState().showToast(`已全选 ${visibleIds.length} 张素材`, 'success')
          return
        }
        const result = await assetCommands.searchAllAssetIds({
          scope: queryScope,
          query: deferredQuery,
          filters: effectiveFilters,
          sortKey,
          sortOrder,
          semantic: { enabled: Boolean(deferredQuery.trim()), context: deferredQuery },
        })
        const ids = result.ids.length > 0 ? result.ids : visibleIds
        useAssetLibraryStore.getState().selectAllVisibleAssets(ids)
        const toast = useStore.getState().showToast
        if (result.truncated) {
          toast(`素材过多，已全选前 ${ids.length} 张（超出保护上限）`, 'info')
        } else if (ids.length > visibleIds.length) {
          toast(`已全选全部 ${ids.length} 张素材`, 'success')
        } else {
          toast(`已全选 ${ids.length} 张素材`, 'success')
        }
      } catch {
        // 全量遍历失败时回退为选中已加载的可见素材
        useAssetLibraryStore.getState().selectAllVisibleAssets(visibleIds)
        useStore.getState().showToast(`已全选当前可见的 ${visibleIds.length} 张素材`, 'info')
      } finally {
        setSelectingAll(false)
      }
    })()
  }, [
    deferredQuery,
    effectiveFilters,
    effectiveResult.assets,
    filterFavorite,
    queryScope,
    selectingAll,
    sortKey,
    sortOrder,
  ])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLocaleLowerCase() !== 'a') return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.closest('input, textarea, select, [contenteditable="true"]') || target.isContentEditable)
      ) {
        return
      }
      if (!document.querySelector('[data-testid="asset-library-workspace"]')) return
      event.preventDefault()
      selectAllVisible()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectAllVisible])

  // Ctrl+Z / Cmd+Z 撤销、Ctrl+Shift+Z / Ctrl+Y 重做（Eagle 式多步撤销栈；输入框内不拦截）。
  // 注意：素材库全局快捷键 hook（useAssetLibraryShortcuts，capture 阶段）已实现 Ctrl+Z/Y 处理，
  // 这里不再重复监听，避免一次按键触发两次撤销（撤销跳步、可撤销次数减半）。

  // 服务商筛选选项（来自已归档素材的来源快照）
  const providerOptions = useMemo(() => {
    const providers = new Set<string>()
    for (const asset of assets) {
      for (const origin of asset.origins) {
        if (origin.apiProvider) providers.add(origin.apiProvider)
      }
    }
    return [...providers].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }, [assets])

  const isTrashScope = scope === 'trash'
  const emptyTrash = useCallback(() => {
    void import('../../lib/assetLibraryRepository')
      .then(({ hydrateFull }) => hydrateFull())
      .then((full) => {
        const trashedIds = full.assets.filter((asset) => asset.status === 'trashed').map((asset) => asset.id)
        // 清空回收站默认勾选「解除引用并彻底删除」：被任务/工作区等引用的素材也一并清空
        requestPurge(trashedIds, '清空回收站', true)
      })
      .catch(() => {
        // 读取失败回退到内存快照（至少能清理当前已加载的回收站素材）
        const trashedIds = Object.values(useAssetLibraryStore.getState().assetsById)
          .filter((asset) => asset.status === 'trashed')
          .map((asset) => asset.id)
        requestPurge(trashedIds, '清空回收站', true)
      })
  }, [requestPurge])

  if (hydrationStatus === 'loading' || hydrationStatus === 'idle') {
    return (
      <main
        data-home-main
        data-testid="asset-library-workspace"
        className="h-[calc(100dvh-7rem)] overflow-hidden sm:h-[calc(100dvh-3.5rem)]"
      >
        <div className="flex h-full items-center justify-center text-sm text-ds-muted">素材库加载中…</div>
      </main>
    )
  }

  return (
    <main
      data-home-main
      data-testid="asset-library-workspace"
      className="relative flex h-[calc(100dvh-7rem)] min-h-0 flex-col overflow-hidden sm:h-[calc(100dvh-3.5rem)]"
    >
      <div className="flex min-h-0 flex-1">
        {!isNarrow && (
          <AssetLibrarySidebar
            counts={counts}
            scope={selectedScope}
            resizable
            onSelectSystemScope={(value) => setScope(value as AssetLibraryScope)}
            onSelectCollection={(id) => setScope({ kind: 'collection', id })}
          />
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {migrationStatus === 'running' && (
            <div
              role="status"
              className="border-b border-ds-primary/35 bg-ds-primary-subtle px-4 py-2 text-xs text-ds-primary dark:border-ds-primary/20 dark:bg-ds-primary/10 dark:text-ds-primary"
            >
              {migrationProgress
                ? `正在补齐素材索引（${migrationProgress.done}/${migrationProgress.total}），已生成的素材会自动出现…`
                : '正在补齐素材索引，已生成的素材会自动出现…'}
            </div>
          )}
          {migrationStatus === 'error' && (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 border-b border-ds-danger/35 bg-ds-danger-subtle px-4 py-2 text-xs text-ds-danger dark:border-ds-danger/20 dark:bg-ds-danger/10 dark:text-ds-danger"
            >
              <span className="truncate">素材索引补齐失败：{migrationError ?? '未知错误'}</span>
              <button
                type="button"
                className="min-h-ds-control-lg shrink-0 rounded-md px-3 font-medium hover:bg-ds-danger-subtle dark:hover:bg-ds-danger/15"
                onClick={() =>
                  void import('../../store')
                    .then(({ retryGeneratedAssetLibraryMigration }) => retryGeneratedAssetLibraryMigration())
                    .catch(() => {})
                }
              >
                重试
              </button>
            </div>
          )}
          {isNarrow && (
            <button
              type="button"
              onClick={() => {
                setDetailOpen(false)
                setSidebarOpen(true)
              }}
              className="min-h-ds-control-lg self-start rounded-md border border-ds-border px-3 text-sm hover:bg-ds-muted/20"
            >
              浏览导航
            </button>
          )}
          <AssetLibraryToolbar
            scopeLabel={
              inFavoritesOverview
                ? '收藏夹'
                : inFavoriteCollection
                  ? `收藏夹 · ${favoriteCollectionName ?? '收藏'}`
                  : filters.tagIds && filters.tagIds.length > 0
                    ? `标签 · ${filters.tagIds.map((id) => tagNames.get(id) ?? '未命名').join(' + ')}`
                    : scopeLabel(scope, collectionNames, tagNames)
            }
            totalCount={inFavoritesOverview ? favoriteCollections.length : effectiveResult.totalCount}
            visibleCount={inFavoritesOverview ? favoriteCollections.length : effectiveResult.assets.length}
            onSelectAll={selectAllVisible}
            trashCount={counts.trash}
            onEmptyTrash={isTrashScope ? emptyTrash : undefined}
            providerOptions={providerOptions}
            similarLabel={similarLabel}
            onClearSimilar={similarToAssetId ? () => setSimilarToAsset(null) : undefined}
            isCollectionScope={typeof scope === 'object' && scope.kind === 'collection'}
            searchInputRef={searchInputRef}
            onImportFiles={(files) => void useAssetLibraryStore.getState().importExternalFiles(files)}
            onOpenDuplicates={
              typeof window !== 'undefined' && Boolean(window.electronAPI?.assetCatalogNearDuplicates)
                ? () => setDuplicatesOpen(true)
                : undefined
            }
          />
          {/* 长耗时操作进度条（批量导入等）：实时反馈「正在处理 X/N」，避免无提示等待 */}
          {operationProgress && (
            <div
              role="status"
              data-testid="asset-operation-progress"
              className="shrink-0 border-b border-ds-primary/35 bg-ds-primary-subtle px-8 py-1.5 text-xs text-ds-primary dark:border-ds-primary/20 dark:bg-ds-primary/10 dark:text-ds-primary"
            >
              <div className="flex items-center gap-2">
                <span className="shrink-0">{operationProgress.label}…</span>
                <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-ds-primary/15">
                  <div
                    className="h-full rounded-full bg-ds-primary transition-[width] duration-150"
                    style={{
                      width: `${Math.round((operationProgress.done / Math.max(1, operationProgress.total)) * 100)}%`,
                    }}
                  />
                </div>
                <span className="shrink-0 tabular-nums">
                  {operationProgress.done}/{operationProgress.total}
                </span>
              </div>
            </div>
          )}
          {/* 筛选标签栏（Eagle 式）：固定标签常驻 + 当前生效条件自动开标签；相似搜索时隐藏（结果集不同，筛选无意义） */}
          {!inFavoritesOverview && !similarToAssetId && <AssetFilterTabBar />}
          {/* 子文件夹区块（Eagle 式）：进入文件夹时顶部展示直接子文件夹封面，点击进入；与「包含子文件夹」开关正交 */}
          <SubfolderStrip counts={counts} />
          {/* 图片模式运行/失败任务提示条：图片网格只展示已入库素材，生成中/失败任务不可见；
              此处给出持续可见的反馈（不打断浏览），点击一键切换到任务卡片视图查看进度与失败原因 */}
          {groupBy === 'none' && !filterFavorite && runningFailedCounts && (
            <button
              type="button"
              role="status"
              data-testid="asset-running-tasks-notice"
              onClick={() => setGroupBy('grouped')}
              className="flex shrink-0 items-center gap-3 border-b border-ds-primary/35 bg-ds-primary-subtle px-8 py-1.5 text-xs text-ds-primary transition-colors hover:bg-ds-primary/10 dark:border-ds-primary/20 dark:bg-ds-primary/10 dark:text-ds-primary dark:hover:bg-ds-primary/15"
              title="点击切换到任务卡片视图查看进度"
            >
              {runningFailedCounts.running > 0 && (
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-ds-primary" />
                  生成中 {runningFailedCounts.running} 个任务
                </span>
              )}
              {runningFailedCounts.failed > 0 && (
                <span className="flex items-center gap-1.5 text-ds-danger">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ds-danger" />
                  {runningFailedCounts.failed} 个任务失败
                </span>
              )}
              <span className="ml-auto shrink-0 underline-offset-2 hover:underline">点击查看任务卡片 →</span>
            </button>
          )}
          {inFavoritesOverview ? (
            /* 收藏夹概览：嵌入素材库内容区（侧栏与顶部工具栏保持不变），搜索框过滤收藏夹名 */
            <FavoriteCollectionsView searchQueryOverride={query} />
          ) : groupBy !== 'none' ? (
            <AssetGroupedView
              assets={effectiveResult.assets}
              libraryAssetCount={desktopCatalog ? counts.all + counts.trash : assets.length}
              hasMore={Boolean(catalogPage?.nextCursor)}
              loadingMore={loadingMore}
              onLoadMore={loadMore}
              onPurgeRequest={(ids) => requestPurge(ids)}
              onFindSimilar={(assetId) => setSimilarToAsset(assetId)}
              resetScrollKey={resetScrollKey}
              scope={selectedScope}
              includeSubcollections={includeSubcollections}
            />
          ) : viewMode === 'list' ? (
            <AssetListView
              assets={effectiveResult.assets}
              libraryAssetCount={desktopCatalog ? counts.all + counts.trash : assets.length}
              hasMore={Boolean(catalogPage?.nextCursor)}
              loadingMore={loadingMore}
              onLoadMore={loadMore}
              onOpenViewer={(assetId) => {
                const assetIdList = effectiveResult.assets.map((item) => item.id)
                const asset = effectiveResult.assets.find((item) => item.id === assetId)
                if (asset) useAssetLibraryStore.getState().openViewer(asset.id, assetIdList)
              }}
              onQuickPreview={(assetId) => useAssetLibraryStore.getState().setQuickPreviewAsset(assetId)}
              onPurgeRequest={(ids) => requestPurge(ids)}
              onFindSimilar={(assetId) => setSimilarToAsset(assetId)}
            />
          ) : (
            <AssetGrid
              assets={effectiveResult.assets}
              libraryAssetCount={desktopCatalog ? counts.all + counts.trash : assets.length}
              hasMore={Boolean(catalogPage?.nextCursor)}
              loadingMore={loadingMore}
              onLoadMore={loadMore}
              onOpenLightbox={(assetId) => {
                const assetIdList = effectiveResult.assets.map((item) => item.id)
                const asset = effectiveResult.assets.find((item) => item.id === assetId)
                if (asset) useAssetLibraryStore.getState().openViewer(asset.id, assetIdList)
              }}
              onQuickPreview={(assetId) => useAssetLibraryStore.getState().setQuickPreviewAsset(assetId)}
              onPurgeRequest={(ids) => requestPurge(ids)}
              onFindSimilar={(assetId) => setSimilarToAsset(assetId)}
              resetScrollKey={resetScrollKey}
            />
          )}
        </div>
      </div>

      {isNarrow && sidebarOpen && (
        <div
          className="absolute inset-0 z-overlay flex bg-black/40"
          data-testid="asset-library-sidebar-drawer"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSidebarOpen(false)
          }}
        >
          <div
            ref={sidebarDrawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="素材库导航"
            tabIndex={-1}
            className="relative flex max-w-[85vw] bg-ds-surface shadow-xl"
          >
            <AssetLibrarySidebar
              counts={counts}
              scope={selectedScope}
              onSelectSystemScope={(value) => {
                exitFavoritesMode()
                setScope(value as AssetLibraryScope)
                setSidebarOpen(false)
              }}
              onSelectCollection={(id) => {
                exitFavoritesMode()
                setScope({ kind: 'collection', id })
                setSidebarOpen(false)
              }}
            />
            <IconButton
              className="absolute right-2 top-2 min-h-ds-control-lg min-w-11"
              size="sm"
              aria-label="关闭导航"
              icon={<XIcon size={16} />}
              onClick={() => setSidebarOpen(false)}
            />
          </div>
        </div>
      )}
      {isNarrow && detailOpen && (
        <div
          ref={detailDrawerRef}
          role="dialog"
          aria-modal="true"
          aria-label="素材详情"
          tabIndex={-1}
          className="absolute inset-0 z-overlay overflow-y-auto bg-ds-surface"
          data-testid="asset-detail-panel-drawer"
        >
          <AssetDetailPanel onPrev={goPrevAsset} onNext={goNextAsset} onPurgeRequest={(ids) => requestPurge(ids)} />
          <button
            type="button"
            onClick={() => setDetailOpen(false)}
            className="absolute right-2 top-2 min-h-ds-control-lg rounded-md border border-ds-border px-3 text-sm"
          >
            关闭
          </button>
        </div>
      )}

      <AssetPurgeModal
        open={purgeRequest !== null}
        onOpenChange={(open) => {
          if (!open) setPurgeRequest(null)
        }}
        assetIds={purgeRequest?.ids ?? []}
        title={purgeRequest?.title ?? '永久删除素材'}
        forceByDefault={purgeRequest?.forceByDefault ?? false}
      />

      <AssetDuplicateModal open={duplicatesOpen} onOpenChange={setDuplicatesOpen} />

      <AssetViewer />
      <AssetQuickPreview />
    </main>
  )
}

export default memo(AssetLibraryWorkspaceInner)
