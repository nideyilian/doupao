import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AssetCollection,
  AssetLibraryFilters,
  AssetLibraryScope,
  AssetPatch,
  AssetSortKey,
  AssetTag,
  ExportData,
  FilterControlKey,
  GeneratedAsset,
  PinnedFilter,
} from '../../types'
import {
  collectCollectionSubtreeIds,
  createEmptyCollection,
  createEmptyTag,
  isCollectionTrashed,
  planCollectionCopy,
  sortCollections,
  sortTags,
} from '../../lib/assetLibraryModel'
import * as repository from '../../lib/assetLibraryRepository'
import { isPinnedFilterActive, pinnedFilterKey, pinnedFilterRemovalPatch, pinnedFilterToPatch } from './pinnedFilters'

export type AssetHydrationStatus = 'idle' | 'loading' | 'ready' | 'error'
export type AssetMigrationStatus = 'idle' | 'running' | 'done' | 'error'

export type AssetSortOrder = 'asc' | 'desc'

export type AssetGridDensity = 'compact' | 'standard' | 'cozy'

/** 分组视图：none（纯图片流）/ grouped（按批次、任务、已删除任务聚合分组） */
export type AssetGroupBy = 'none' | 'grouped'

/** 分组模式下的两种展现形式：cards（任务卡片）/ tiles（图片砖 · 列表行），类比图片模式的密度选择 */
export type AssetGroupedViewStyle = 'cards' | 'tiles'

/** 保存的智能文件夹：快照当前范围/关键词/筛选，可随时应用 */
export interface AssetSavedFilter {
  id: string
  name: string
  scope: AssetLibraryScope
  query: string
  filters: AssetLibraryFilters
}

/** 剪贴板条目：复制/剪切项目或素材（仅内存，不持久化） */
export interface AssetClipboardEntry {
  kind: 'copy' | 'cut'
  type: 'collection' | 'asset'
  /** collection 类型：被复制/剪切的文件夹 id 与名称 */
  id?: string
  name?: string
  /** asset 类型：被复制/剪切的素材 id 列表 */
  assetIds?: string[]
}

/** 撤销条目：before/after 快照。assets 为受影响素材的完整记录；collections/tags 为受影响集合的完整列表快照。 */
export interface AssetUndoEntry {
  label: string
  assetsBefore: Record<string, GeneratedAsset>
  assetsAfter: Record<string, GeneratedAsset>
  collectionsBefore: AssetCollection[] | null
  collectionsAfter: AssetCollection[] | null
  tagsBefore: AssetTag[] | null
  tagsAfter: AssetTag[] | null
}

const UNDO_LIMIT = 50

export interface AssetLibraryStoreState {
  assetsById: Record<string, GeneratedAsset>
  assetOrder: string[]
  collections: AssetCollection[]
  /** 标签列表（水合；树形结构由 parentId 表达，排序见 sortTags） */
  tags: AssetTag[]
  /**
   * 素材数据变更版本号：素材归属/状态（collectionIds、收藏、评分、回收站等）变化时 +1。
   * 桌面端侧栏计数来自 SQLite 聚合，工作区目录查询依赖该版本号重新拉取，保证计数即时更新。
   */
  mutationVersion: number
  hydrationStatus: AssetHydrationStatus
  migrationStatus: AssetMigrationStatus
  migrationError: string | null
  /** 启动补齐/迁移的实时进度（已处理/总数）；非运行中为 null。不持久化。 */
  migrationProgress: { done: number; total: number } | null
  /** 智能文件夹（保存的筛选快照，持久化） */
  savedFilters: AssetSavedFilter[]
  /** 顶部快捷筛选（单个筛选值的固定引用，持久化）：点击即应用/取消对应筛选 */
  pinnedFilters: PinnedFilter[]
  /** 顶部工具栏放出的筛选控件（维度级，持久化）：用户自主选择把哪些筛选参数常驻工具栏 */
  visibleFilterControls: FilterControlKey[]
  selectedAssetIds: string[]
  activeAssetId: string | null
  scope: AssetLibraryScope
  query: string
  filters: AssetLibraryFilters
  /** 当前长耗时操作的实时进度（非持久化）：顶部进度条展示用，如批量导入 */
  operationProgress: { label: string; done: number; total: number } | null
  sortKey: AssetSortKey
  sortOrder: AssetSortOrder
  /** 网格密度（三档，持久化 UI 偏好） */
  gridDensity: AssetGridDensity
  /** 视图模式：网格 / 列表 */
  viewMode: 'grid' | 'list'
  /** 分组视图：none（纯图片流）/ grouped（按批次、任务、已删除任务聚合分组），持久化 */
  groupBy: AssetGroupBy
  /** 分组模式展现形式：cards（任务卡片）/ tiles（图片砖·列表行），持久化（类比图片模式的密度选择） */
  groupedViewStyle: AssetGroupedViewStyle
  /** 「包含子文件夹」：项目 scope 递归查询（含自身与后代，持久化，默认开启） */
  includeSubcollections: boolean
  /** 生成批次视图的聚焦任务（查看来源任务时跳转并高亮，不持久化） */
  batchFocusTaskId: string | null
  /** 相似图片搜索基准素材；非空时结果按与它的相似度排序（Electron 走 SQLite 感知哈希） */
  similarToAssetId: string | null
  /** 全屏查看器（Eagle 式）：当前素材与浏览列表（asset id 顺序） */
  viewerAssetId: string | null
  viewerAssetIds: string[]
  /** 空格按住快速预览的素材（Eagle 式：按住空格显示大图，松开关闭） */
  quickPreviewAssetId: string | null
  /** 当前鼠标悬停的素材（按空格直接预览悬停素材，无需先点选；仅内存，不持久化） */
  hoveredAssetId: string | null
  sidebarOpen: boolean
  detailOpen: boolean
  /** 剪贴板（复制/剪切的项目或素材；仅内存，不持久化） */
  clipboard: AssetClipboardEntry | null
  /** 撤销/重做栈（Eagle 式 Ctrl+Z / Ctrl+Shift+Z；上限 50 条，仅内存） */
  undoStack: AssetUndoEntry[]
  redoStack: AssetUndoEntry[]

  hydrate: () => Promise<void>
  applyUpsertedAssets: (assets: GeneratedAsset[]) => void
  /** 把（归档等后台链路新建的）项目文件夹同步进内存态，侧栏立即可见。 */
  upsertCollections: (collections: AssetCollection[]) => void
  setScope: (scope: AssetLibraryScope) => void
  setQuery: (query: string) => void
  setFilters: (filters: AssetLibraryFilters) => void
  setOperationProgress: (progress: { label: string; done: number; total: number } | null) => void
  setSort: (sortKey: AssetSortKey, sortOrder: AssetSortOrder) => void
  setGridDensity: (density: AssetGridDensity) => void
  setViewMode: (mode: 'grid' | 'list') => void
  /** 切换分组视图（不分组 / 分组） */
  setGroupBy: (groupBy: AssetGroupBy) => void
  /** 切换分组模式展现形式（任务卡片 / 图片砖·列表行） */
  setGroupedViewStyle: (style: AssetGroupedViewStyle) => void
  /** 切换「包含子文件夹」（项目 scope 递归查询） */
  setIncludeSubcollections: (value: boolean) => void
  /** 生成批次视图聚焦到指定任务所在分组（查看来源任务入口） */
  setBatchFocusTaskId: (taskId: string | null) => void
  /** 打开全屏查看器；list 为当前浏览顺序的素材 id */
  openViewer: (assetId: string, list: string[]) => void
  /** 在查看器内切换到指定素材 */
  setViewerAsset: (assetId: string) => void
  closeViewer: () => void
  /** 打开/关闭空格快速预览（Eagle 式按住预览） */
  setQuickPreviewAsset: (assetId: string | null) => void
  setHoveredAssetId: (assetId: string | null) => void
  /** 设置/清除相似搜索；设置时回到全部范围并清空关键词 */
  setSimilarToAsset: (assetId: string | null) => void
  /** 导入外部图片文件为素材（相同内容自动去重） */
  importExternalFiles: (files: File[]) => Promise<number>
  /** Electron：按本地路径导入外部图片 */
  importExternalPaths: (paths: string[]) => Promise<number>
  selectAsset: (id: string) => void
  toggleSelectAsset: (id: string) => void
  clearSelection: () => void
  /** 用一组 id 整体替换当前选择（框选结果、全选结果） */
  replaceSelection: (ids: string[]) => void
  /** 全选当前查询结果中的可见素材 */
  selectAllVisibleAssets: (assetIds: string[]) => void
  setActiveAsset: (id: string | null) => void
  setSidebarOpen: (open: boolean) => void
  setDetailOpen: (open: boolean) => void

  /** 保存当前范围/关键词/筛选为智能文件夹 */
  addSavedFilter: (name: string) => AssetSavedFilter | null
  removeSavedFilter: (id: string) => void
  applySavedFilter: (id: string) => void

  /** 固定单个筛选值到顶部快捷栏（同 kind+value 去重） */
  pinFilter: (filter: PinnedFilter) => void
  /** 按 pinnedFilterKey 取消固定（不影响当前筛选） */
  unpinFilter: (key: string) => void
  /** 固定/取消固定切换（筛选面板图钉按钮用） */
  togglePinFilter: (filter: PinnedFilter) => void
  /** 点击顶部快捷胶囊：该条件未生效则应用，已生效则移除（与筛选面板语义一致） */
  applyPinnedFilter: (filter: PinnedFilter) => void
  /** 拖动排序固定标签（Eagle 式标签栏）：把 from 位置的固定项移动到 to 位置 */
  reorderPinnedFilters: (from: number, to: number) => void
  /** 设置顶部工具栏放出的筛选控件（维度级，「+」菜单勾选结果） */
  setVisibleFilterControls: (keys: FilterControlKey[]) => void

  patchAssets: (ids: string[], patch: AssetPatch) => Promise<void>
  /**
   * 批量移动素材到目标项目文件夹（sourceId 为来源文件夹时执行「移动」语义，否则「加入」）。
   * Eagle 式：快照 + 分批写入（onProgress 报告进度）+ 单次 store 更新（网格不闪烁）+ 记录可撤销快照。
   */
  moveAssetsToCollection: (
    assetIds: string[],
    targetCollectionId: string,
    sourceCollectionId: string | null,
    onProgress?: (done: number, total: number) => void,
  ) => Promise<number>
  /** 批量加入/移出项目（批量操作栏「项目」菜单；Eagle 式，同 moveAssetsToCollection） */
  batchSetCollection: (
    assetIds: string[],
    collectionId: string,
    add: boolean,
    onProgress?: (done: number, total: number) => void,
  ) => Promise<number>
  /**
   * 通用批量归属更新（拖拽移动等需要「一次收集全部变更 + 一次原子写入」的场景）：
   * 每个 update 指定素材 id 与目标 collectionIds；快照 + 分批写入 + 单次 store 更新 + 可撤销。
   */
  applyBatchCollectionChanges: (
    updates: Array<{ id: string; collectionIds: string[] }>,
    label: string,
  ) => Promise<number>
  moveToTrash: (ids: string[], onProgress?: (done: number, total: number) => void) => Promise<void>
  restoreAssets: (ids: string[], onProgress?: (done: number, total: number) => void) => Promise<void>
  removeAssetLocal: (id: string) => void
  trashSelectedAssets: () => Promise<void>
  restoreSelectedAssets: () => Promise<void>
  purgeSelectedAssets: () => Promise<{ purged: string[]; blocked: unknown[] }>
  /** 清空回收站：永久删除全部回收站素材，返回删除结果与引用冲突项 */
  emptyTrashAssets: () => Promise<{ purged: string[]; blocked: unknown[] }>

  createCollection: (name: string, parentId?: string | null) => Promise<AssetCollection | null>
  renameCollection: (id: string, name: string) => Promise<void>
  moveCollection: (id: string, newParentId: string | null) => Promise<void>
  /**
   * 拖拽移动文件夹到指定位置（Eagle 式同级排序/嵌套）：
   * - before/after：以 siblingId 为参照，插入到其同级列表的该位置（同级排序）
   * - into：作为 parentId 的最后一个子级（嵌套）
   * - append：追加到 parentId（可为根）末尾
   */
  moveCollectionsToPosition: (
    ids: string[],
    target:
      | { kind: 'before' | 'after'; siblingId: string }
      | { kind: 'into'; parentId: string }
      | { kind: 'append'; parentId: string | null },
  ) => Promise<void>
  deleteCollection: (id: string) => Promise<void>
  copyCollection: (id: string) => void
  cutCollection: (id: string) => void
  pasteCollection: (targetId: string | null) => Promise<AssetCollection | null>
  clearClipboard: () => void
  /** 复制选中素材到剪贴板（粘贴 = 加入目标文件夹） */
  copyAssets: (ids: string[]) => void
  /** 剪切选中素材到剪贴板（粘贴 = 移动到目标文件夹） */
  cutAssets: (ids: string[]) => void
  /** 把剪贴板素材粘贴到文件夹：copy = 加归属，cut = 移动（替换为仅目标文件夹）；targetId null = 根（cut 时变为未整理） */
  pasteAssetsIntoCollection: (targetId: string | null) => Promise<number>
  /** 撤销最近一次素材/文件夹/标签操作（Eagle 式 Ctrl+Z） */
  undo: () => Promise<boolean>
  /** 重做（Eagle 式 Ctrl+Shift+Z / Ctrl+Y） */
  redo: () => Promise<boolean>

  // ===== 文件夹增强 =====
  /** 多选文件夹（ctrl/meta 点击），仅内存不持久化 */
  selectedFolderIds: string[]
  toggleSelectFolder: (id: string) => void
  setSelectedFolders: (ids: string[]) => void
  clearSelectedFolders: () => void
  /** 侧栏文件夹编辑请求（全局快捷键 F2 / Ctrl+N 触发，侧栏消费后清空） */
  folderEditRequest: { kind: 'rename'; collectionId: string } | { kind: 'create'; parentId: string | null } | null
  setFolderEditRequest: (request: AssetLibraryStoreState['folderEditRequest']) => void
  /** 就地复制：在当前父级生成整棵子树副本 */
  duplicateCollection: (id: string) => Promise<AssetCollection | null>
  /** 同级上移/下移（手动排序，置顶优先于 order） */
  reorderCollection: (id: string, direction: 'up' | 'down') => Promise<void>
  /** 设置文件夹颜色 */
  setCollectionColor: (id: string, color: string | null) => Promise<void>
  /** 置顶/取消置顶 */
  togglePinCollection: (id: string) => Promise<void>
  /** 恢复文件夹（从回收站，整棵子树） */
  restoreCollection: (id: string) => Promise<void>
  /** 彻底删除文件夹（整棵子树，剥离素材引用，不可恢复） */
  purgeCollection: (id: string) => Promise<void>
  /** 合并 source 到 target：素材归入 target、子文件夹挂到 target、删除 source */
  mergeCollection: (sourceId: string, targetId: string) => Promise<boolean>
  /** 把外部图片导入到指定文件夹 */
  importFilesIntoCollection: (collectionId: string, files: File[]) => Promise<number>
  /** 导出文件夹内素材为 ZIP */
  exportCollectionToZip: (collectionId: string) => Promise<boolean>
  /** 文件夹信息（数量/大小/子级/时间） */
  getCollectionInfo: (id: string) => CollectionFolderInfo | null

  // ===== 标签（Eagle 式：侧栏多选 AND 筛选 + 树形管理）=====
  createTag: (name: string, parentId?: string | null) => Promise<AssetTag | null>
  renameTag: (id: string, name: string) => Promise<void>
  deleteTag: (id: string) => Promise<void>
  /** 合并标签：sourceId 素材引用全部改挂 targetId 后删除 sourceId */
  mergeTags: (sourceId: string, targetId: string) => Promise<boolean>
  setTagColor: (id: string, color: string | null) => Promise<void>
  /** 侧栏标签多选：切换某标签在 filters.tagIds 的选中态（AND 语义） */
  toggleTagFilter: (tagId: string) => void
  clearTagFilters: () => void

  /** 批量：把选中的文件夹移入回收站 */
  /** 彻底删除文件夹（含子文件夹；文件夹内有图片时先弹确认） */
  deleteFolders: (ids: string[]) => Promise<void>
  /** 批量彻底删除选中的文件夹 */
  deleteSelectedFolders: () => Promise<void>
  /** 批量：移动选中的文件夹到目标 */
  moveSelectedFolders: (targetId: string | null) => Promise<void>
  /** 批量：把选中的文件夹合并到第一个选中项 */
  mergeSelectedFolders: () => Promise<boolean>
  /** 批量：导出选中的文件夹（逐个打包） */
  exportSelectedFolders: () => Promise<boolean>
}

/** 文件夹信息摘要（数量/大小/子级/时间）。 */
export interface CollectionFolderInfo {
  id: string
  name: string
  assetCount: number
  recursiveAssetCount: number
  byteSize: number
  childCount: number
  createdAt: number
  updatedAt: number
  trashedAt: number | null
}

function applyAssetsToState(
  state: Pick<AssetLibraryStoreState, 'assetsById' | 'assetOrder'>,
  assets: GeneratedAsset[],
) {
  const assetsById = { ...state.assetsById }
  const assetOrder = [...state.assetOrder]
  for (const asset of assets) {
    if (!(asset.id in assetsById)) assetOrder.push(asset.id)
    assetsById[asset.id] = asset
  }
  return { assetsById, assetOrder }
}

function sameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return false
  }
  return true
}

/** 判断素材是否有影响目录可见性的实际变化（新素材由调用方按「无旧记录」处理）。 */
function assetVisibleChange(prev: GeneratedAsset, next: GeneratedAsset): boolean {
  return (
    prev.status !== next.status ||
    prev.trashedAt !== next.trashedAt ||
    prev.favorite !== next.favorite ||
    prev.rating !== next.rating ||
    prev.colorLabel !== next.colorLabel ||
    prev.notes !== next.notes ||
    !sameStringArray(prev.collectionIds, next.collectionIds) ||
    !sameStringArray(prev.tagIds, next.tagIds)
  )
}

function applyCollectionsToState(state: { collections: AssetCollection[] }, collections: AssetCollection[]) {
  const byId = new Map(state.collections.map((c) => [c.id, c]))
  for (const collection of collections) byId.set(collection.id, collection)
  return { collections: sortCollections([...byId.values()]) }
}

// ===== Eagle 式批量归属操作 =====
// 快照（可撤销）→ 计算全部变更 → 分批写入（onProgress 报告进度）→ 单次 store 更新（网格不逐条闪烁）。

const BATCH_WRITE_SIZE = 200

type CollectionUndoSnapshot = Array<{ id: string; collectionIds: string[] }>

interface BatchCollectionUpdate {
  changed: GeneratedAsset[]
  snapshot: CollectionUndoSnapshot
}

type StoreSetter = (
  partial:
    | AssetLibraryStoreState
    | Partial<AssetLibraryStoreState>
    | ((state: AssetLibraryStoreState) => Partial<AssetLibraryStoreState>),
) => void

/** 记录一条撤销条目：新操作产生时清空重做栈；栈上限 UNDO_LIMIT。 */
function pushUndoEntry(set: StoreSetter, entry: AssetUndoEntry): void {
  set((state) => ({
    undoStack: [...state.undoStack, entry].slice(-UNDO_LIMIT),
    redoStack: [],
  }))
}

/** 把快照写回仓库并更新内存态（撤销/重做共用）。 */
async function applyUndoSnapshot(
  set: StoreSetter,
  get: () => AssetLibraryStoreState,
  snapshot: {
    assets?: Record<string, GeneratedAsset>
    collections?: AssetCollection[] | null
    tags?: AssetTag[] | null
  },
): Promise<void> {
  const assets = snapshot.assets ? Object.values(snapshot.assets) : []
  if (assets.length > 0) {
    await repository.putGeneratedAssets(assets)
    set((state) => ({ ...applyAssetsToState(state, assets), mutationVersion: state.mutationVersion + 1 }))
  }
  // 集合/标签快照为完整列表：即使为空（撤销新建/合并），也要把内存态恢复为快照
  if (snapshot.collections) {
    if (snapshot.collections.length > 0) await repository.putCollections(snapshot.collections)
    set((state) => ({ collections: sortCollections(snapshot.collections!) }))
  }
  if (snapshot.tags) {
    if (snapshot.tags.length > 0) await repository.putTags(snapshot.tags)
    set((state) => ({ tags: sortTags(snapshot.tags!) }))
  }
}

/**
 * 执行一次批量归属更新：
 * - 分批 putGeneratedAssets（进度回调；大批量时 UI 有「剩余 N 张」反馈）；
 * - 全部写完后再做一次 set（applyAssetsToState），避免逐张刷新导致网格跳动闪烁；
 * - pushUndoEntry 记录完整 before/after 快照，供 Ctrl+Z / 撤销按钮恢复。
 */
async function runBatchCollectionUpdate(
  set: StoreSetter,
  get: () => AssetLibraryStoreState,
  update: BatchCollectionUpdate,
  label: string,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const { changed, snapshot } = update
  if (changed.length === 0) return 0
  // 撤销快照：批量归属变更前的完整素材记录（snapshot 只含 collectionIds 差异）
  const assetsBefore: Record<string, GeneratedAsset> = {}
  for (const item of snapshot) {
    const asset = get().assetsById[item.id]
    if (asset) assetsBefore[item.id] = asset
  }
  for (let offset = 0; offset < changed.length; offset += BATCH_WRITE_SIZE) {
    await repository.putGeneratedAssets(changed.slice(offset, offset + BATCH_WRITE_SIZE))
    onProgress?.(Math.min(offset + BATCH_WRITE_SIZE, changed.length), changed.length)
  }
  set((state) => ({
    ...applyAssetsToState(state, changed),
    mutationVersion: state.mutationVersion + 1,
  }))
  const assetsAfter: Record<string, GeneratedAsset> = {}
  for (const asset of changed) assetsAfter[asset.id] = asset
  pushUndoEntry(set, {
    label,
    assetsBefore,
    assetsAfter,
    collectionsBefore: null,
    collectionsAfter: null,
    tagsBefore: null,
    tagsAfter: null,
  })
  return changed.length
}

/** 计算「移动/加入」目标文件夹后的变更（移动 = 从源文件夹移除归属 + 加入目标；加入 = 只加入）。 */
function planCollectionMove(
  state: AssetLibraryStoreState,
  assetIds: string[],
  targetCollectionId: string,
  sourceCollectionId: string | null,
  now: number,
): BatchCollectionUpdate {
  const snapshot: CollectionUndoSnapshot = []
  const changed: GeneratedAsset[] = []
  for (const id of assetIds) {
    const asset = state.assetsById[id]
    if (!asset || asset.status === 'trashed') continue
    snapshot.push({ id: asset.id, collectionIds: [...asset.collectionIds] })
    const next = new Set(asset.collectionIds)
    if (sourceCollectionId) next.delete(sourceCollectionId)
    next.add(targetCollectionId)
    const list = [...next]
    const same = list.length === asset.collectionIds.length && list.every((c) => asset.collectionIds.includes(c))
    if (same) continue
    changed.push({ ...asset, collectionIds: list, updatedAt: now })
  }
  return { changed, snapshot }
}

/** 计算「加入/移出」项目后的变更。 */
function planCollectionToggle(
  state: AssetLibraryStoreState,
  assetIds: string[],
  collectionId: string,
  add: boolean,
  now: number,
): BatchCollectionUpdate {
  const snapshot: CollectionUndoSnapshot = []
  const changed: GeneratedAsset[] = []
  for (const id of assetIds) {
    const asset = state.assetsById[id]
    if (!asset || asset.status === 'trashed') continue
    snapshot.push({ id: asset.id, collectionIds: [...asset.collectionIds] })
    const next = add
      ? Array.from(new Set([...asset.collectionIds, collectionId]))
      : asset.collectionIds.filter((c) => c !== collectionId)
    const same = next.length === asset.collectionIds.length && next.every((c) => asset.collectionIds.includes(c))
    if (same) continue
    changed.push({ ...asset, collectionIds: next, updatedAt: now })
  }
  return { changed, snapshot }
}

export const useAssetLibraryStore = create<AssetLibraryStoreState>()(
  persist(
    (set, get) => ({
      assetsById: {},
      assetOrder: [],
      collections: [],
      tags: [],
      mutationVersion: 0,
      hydrationStatus: 'idle',
      migrationStatus: 'idle',
      migrationError: null,
      migrationProgress: null,
      savedFilters: [],
      pinnedFilters: [],
      visibleFilterControls: [],
      selectedAssetIds: [],
      activeAssetId: null,
      scope: 'all',
      query: '',
      filters: {},
      operationProgress: null,
      sortKey: 'updatedAt',
      sortOrder: 'desc',
      gridDensity: 'standard',
      viewMode: 'grid',
      // 0.7.56 方案：生图由任务卡承载 —— 默认视图为「任务卡片」（生成后新任务卡置顶带进度），
      // 「图片」大图模式作为另一种展示形式可随时切换。
      groupBy: 'grouped',
      groupedViewStyle: 'cards',
      // 默认关闭「包含子文件夹」：进入文件夹先看子文件夹结构 + 本文件夹图片（Eagle 式）
      includeSubcollections: false,
      batchFocusTaskId: null,
      similarToAssetId: null,
      viewerAssetId: null,
      viewerAssetIds: [],
      quickPreviewAssetId: null,
      hoveredAssetId: null,
      sidebarOpen: false,
      detailOpen: false,
      clipboard: null,
      undoStack: [],
      redoStack: [],
      selectedFolderIds: [],
      folderEditRequest: null,

      hydrate: async () => {
        set({ hydrationStatus: 'loading' })
        try {
          const snapshot = await repository.hydrate()
          const assetsById: Record<string, GeneratedAsset> = {}
          const assetOrder: string[] = []
          for (const asset of snapshot.assets) {
            assetsById[asset.id] = asset
            assetOrder.push(asset.id)
          }
          set({
            assetsById,
            assetOrder,
            collections: sortCollections(snapshot.collections),
            tags: sortTags(snapshot.tags),
            hydrationStatus: 'ready',
          })
          // 启动补齐（幂等，失败不影响水合）：
          // 词库树文件夹 → 项目树镜像，批次素材自动归档。
          // 注意：不再自动执行「旧标签 → 同名项目」镜像——用户删除文件夹后会被每次启动重新建出来
          // （表现为"文件夹删除一直重置"）。文件夹一律由用户手动管理；标签体系已整体移除（数据保留为兼容）。
          void import('../../lib/assetAutoArchive')
            .then(async (module) => {
              const archiveResult = await module.autoArchiveBatchAssets()
              if (archiveResult.createdFolders > 0 || archiveResult.archivedAssets > 0) {
                const { useStore } = await import('../../store')
                useStore
                  .getState()
                  .showToast(
                    `已自动归档 ${archiveResult.archivedAssets} 张素材到 ${archiveResult.createdFolders} 个项目文件夹`,
                    'success',
                  )
              }
            })
            .catch(() => {
              /* 归档失败静默：下次启动或任务同步时自动重试 */
            })
        } catch (error) {
          console.error('素材库水合失败:', error)
          set({ hydrationStatus: 'error' })
        }
      },

      applyUpsertedAssets: (assets) => {
        if (assets.length === 0) return
        set((state) => {
          // 变化检测：新素材，或归属/状态等影响目录可见性的字段发生变化时才 bump
          // mutationVersion，驱动桌面 SQLite 目录页重查并把新素材合并进当前分页；
          // 完全相同的内容（如搜索结果回写）不 bump，避免「查询 → 回写 → 重查」无限循环。
          const changed = assets.some((asset) => {
            const prev = state.assetsById[asset.id]
            return prev ? assetVisibleChange(prev, asset) : true
          })
          const next = applyAssetsToState(state, assets)
          return changed ? { ...next, mutationVersion: state.mutationVersion + 1 } : next
        })
      },

      /** 把（归档等后台链路新建的）项目文件夹同步进内存态，侧栏立即可见。 */
      upsertCollections: (collections) => {
        if (collections.length === 0) return
        set((state) => applyCollectionsToState(state, collections))
      },

      setScope: (scope) => set({ scope, activeAssetId: null, selectedAssetIds: [], similarToAssetId: null }),
      setQuery: (query) => set({ query, similarToAssetId: null }),
      setFilters: (filters) => set({ filters, selectedAssetIds: [] }),
      setOperationProgress: (operationProgress) => set({ operationProgress }),
      setSort: (sortKey, sortOrder) => set({ sortKey, sortOrder }),
      setGridDensity: (gridDensity) => set({ gridDensity }),
      setViewMode: (viewMode) => set({ viewMode }),
      setGroupBy: (groupBy) => set({ groupBy, selectedAssetIds: [] }),
      setGroupedViewStyle: (groupedViewStyle) => set({ groupedViewStyle, selectedAssetIds: [] }),
      setIncludeSubcollections: (includeSubcollections) => set({ includeSubcollections }),
      setBatchFocusTaskId: (batchFocusTaskId) => set({ batchFocusTaskId }),
      openViewer: (assetId, list) =>
        set((state) => ({
          viewerAssetId: assetId,
          viewerAssetIds: list.length > 0 ? list : [assetId],
          selectedAssetIds: [],
        })),
      setViewerAsset: (assetId) => set({ viewerAssetId: assetId }),
      closeViewer: () => set({ viewerAssetId: null, viewerAssetIds: [] }),
      setQuickPreviewAsset: (quickPreviewAssetId) => set({ quickPreviewAssetId }),
      setHoveredAssetId: (hoveredAssetId) => set({ hoveredAssetId }),
      setSimilarToAsset: (assetId) =>
        set((state) => ({
          similarToAssetId: assetId,
          // 相似搜索需要全局范围 + 空关键词，避免与现有筛选组合出空结果
          scope: assetId ? 'all' : state.scope,
          query: assetId ? '' : state.query,
          filters: assetId ? {} : state.filters,
          selectedAssetIds: [],
          activeAssetId: assetId ?? state.activeAssetId,
        })),

      importExternalFiles: async (files) => {
        const { importExternalImageFile } = await import('../../lib/externalAssetImport')
        let imported = 0
        const total = files.length
        if (total > 0) get().setOperationProgress({ label: '正在导入图片', done: 0, total })
        // 批量落地：每 IMPORT_FLUSH_BATCH 张合并一次 store 更新（避免逐张全量 state 拷贝 +
        // mutationVersion 递增导致每张都触发网格重排与目录重查）
        const IMPORT_FLUSH_BATCH = 12
        let pendingBatch: GeneratedAsset[] = []
        const flushBatch = () => {
          if (pendingBatch.length === 0) return
          get().applyUpsertedAssets(pendingBatch)
          pendingBatch = []
        }
        // 进度节流：每 50ms 最多一次 setState（避免大数量导入时进度条驱动整棵工作区重渲染）
        let lastProgressAt = 0
        const reportProgress = (done: number) => {
          const now = Date.now()
          if (now - lastProgressAt < 50 && done < total) return
          lastProgressAt = now
          get().setOperationProgress({ label: '正在导入图片', done, total })
        }
        for (let index = 0; index < total; index++) {
          const file = files[index]
          try {
            const asset = await importExternalImageFile(file)
            if (asset) {
              imported++
              pendingBatch.push(asset)
              if (pendingBatch.length >= IMPORT_FLUSH_BATCH) flushBatch()
            }
          } catch (error) {
            console.warn('导入外部图片失败:', file.name, error)
          }
          reportProgress(index + 1)
        }
        flushBatch()
        get().setOperationProgress(null)
        const { useStore } = await import('../../store')
        useStore
          .getState()
          .showToast(imported > 0 ? `已导入 ${imported} 张图片` : '没有可导入的图片', imported > 0 ? 'success' : 'info')
        return imported
      },

      importExternalPaths: async (paths) => {
        const files: File[] = []
        for (const filePath of paths) {
          try {
            const { readFileBuffer } = window.electronAPI ?? {}
            const payload = readFileBuffer ? await readFileBuffer(filePath) : null
            if (!payload) continue
            const extension = filePath.split('.').pop()?.toLowerCase() ?? 'png'
            const mime =
              extension === 'jpg' || extension === 'jpeg'
                ? 'image/jpeg'
                : extension === 'webp'
                  ? 'image/webp'
                  : 'image/png'
            const name = filePath.split(/[\\/]/).pop() ?? `import-${Date.now()}.${extension}`
            files.push(new File([new Blob([payload.data], { type: mime })], name, { type: mime }))
          } catch (error) {
            console.warn('读取外部图片失败:', filePath, error)
          }
        }
        return get().importExternalFiles(files)
      },
      selectAsset: (id) =>
        set((state) => ({
          selectedAssetIds: state.selectedAssetIds.includes(id)
            ? state.selectedAssetIds
            : [...state.selectedAssetIds, id],
          activeAssetId: id,
          // 单击图片单选：同步打开右侧图片信息栏
          detailOpen: true,
        })),
      toggleSelectAsset: (id) =>
        set((state) => ({
          selectedAssetIds: state.selectedAssetIds.includes(id)
            ? state.selectedAssetIds.filter((assetId) => assetId !== id)
            : [...state.selectedAssetIds, id],
        })),
      clearSelection: () => set({ selectedAssetIds: [], activeAssetId: null }),
      replaceSelection: (ids) =>
        set((state) => {
          const next = Array.from(new Set(ids))
          return {
            selectedAssetIds: next,
            activeAssetId: next.length > 0 ? state.activeAssetId : null,
          }
        }),
      selectAllVisibleAssets: (assetIds) =>
        set((state) => {
          const next = Array.from(new Set(assetIds))
          return {
            selectedAssetIds: next,
            activeAssetId: next.length > 0 ? state.activeAssetId : null,
          }
        }),
      setActiveAsset: (id) => set((state) => ({ activeAssetId: id, detailOpen: id ? true : state.detailOpen })),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setDetailOpen: (detailOpen) => set({ detailOpen }),

      addSavedFilter: (name) => {
        const trimmed = name.trim()
        if (!trimmed) return null
        const state = get()
        const entry: AssetSavedFilter = {
          id: `filter:${crypto.randomUUID()}`,
          name: trimmed,
          scope: state.scope,
          query: state.query,
          filters: state.filters,
        }
        set((current) => ({ savedFilters: [...current.savedFilters, entry] }))
        return entry
      },
      removeSavedFilter: (id) =>
        set((state) => ({ savedFilters: state.savedFilters.filter((filter) => filter.id !== id) })),
      applySavedFilter: (id) => {
        const entry = get().savedFilters.find((filter) => filter.id === id)
        if (!entry) return
        set({
          scope: entry.scope,
          query: entry.query,
          filters: entry.filters,
          similarToAssetId: null,
          selectedAssetIds: [],
          activeAssetId: null,
        })
      },

      pinFilter: (filter) => {
        const key = pinnedFilterKey(filter)
        set((state) => {
          if (state.pinnedFilters.some((item) => pinnedFilterKey(item) === key)) return state
          return { pinnedFilters: [...state.pinnedFilters, filter] }
        })
      },
      unpinFilter: (key) =>
        set((state) => ({ pinnedFilters: state.pinnedFilters.filter((item) => pinnedFilterKey(item) !== key) })),
      togglePinFilter: (filter) => {
        const key = pinnedFilterKey(filter)
        const { pinnedFilters } = get()
        set({
          pinnedFilters: pinnedFilters.some((item) => pinnedFilterKey(item) === key)
            ? pinnedFilters.filter((item) => pinnedFilterKey(item) !== key)
            : [...pinnedFilters, filter],
        })
      },
      applyPinnedFilter: (filter) => {
        const { filters } = get()
        const patch = isPinnedFilterActive(filter, filters)
          ? pinnedFilterRemovalPatch(filter)
          : pinnedFilterToPatch(filter)
        // 与 setFilters 同语义：合并条件并清空选中
        set({ filters: { ...filters, ...patch }, selectedAssetIds: [] })
      },
      reorderPinnedFilters: (from, to) => {
        const { pinnedFilters } = get()
        if (from === to || from < 0 || from >= pinnedFilters.length || to < 0 || to >= pinnedFilters.length) return
        const next = [...pinnedFilters]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved!)
        set({ pinnedFilters: next })
      },
      setVisibleFilterControls: (visibleFilterControls) => set({ visibleFilterControls }),

      patchAssets: async (ids, patch) => {
        // 撤销快照：记录受影响素材的修改前状态
        const assetsBefore: Record<string, GeneratedAsset> = {}
        for (const id of ids) {
          const asset = get().assetsById[id]
          if (asset) assetsBefore[id] = asset
        }
        const updated = await repository.patchAssets(ids, patch)
        if (updated.length === 0) return
        const assetsAfter: Record<string, GeneratedAsset> = {}
        for (const asset of updated) assetsAfter[asset.id] = asset
        pushUndoEntry(set, {
          label: '修改素材',
          assetsBefore,
          assetsAfter,
          collectionsBefore: null,
          collectionsAfter: null,
          tagsBefore: null,
          tagsAfter: null,
        })
        set((state) => ({ ...applyAssetsToState(state, updated), mutationVersion: state.mutationVersion + 1 }))
      },

      moveAssetsToCollection: async (assetIds, targetCollectionId, sourceCollectionId, onProgress) => {
        const collection = get().collections.find((item) => item.id === targetCollectionId)
        const label = `移动 ${assetIds.length} 张至项目「${collection?.name ?? '目标'}」`
        return runBatchCollectionUpdate(
          set,
          get,
          planCollectionMove(get(), assetIds, targetCollectionId, sourceCollectionId, Date.now()),
          label,
          onProgress,
        )
      },

      batchSetCollection: async (assetIds, collectionId, add, onProgress) => {
        const collection = get().collections.find((item) => item.id === collectionId)
        const label = `${add ? '加入' : '移出'}项目「${collection?.name ?? '项目'}」 ${assetIds.length} 张`
        return runBatchCollectionUpdate(
          set,
          get,
          planCollectionToggle(get(), assetIds, collectionId, add, Date.now()),
          label,
          onProgress,
        )
      },

      applyBatchCollectionChanges: async (updates, label) => {
        const state = get()
        const now = Date.now()
        const snapshot: CollectionUndoSnapshot = []
        const changed: GeneratedAsset[] = []
        for (const { id, collectionIds } of updates) {
          const asset = state.assetsById[id]
          if (!asset || asset.status === 'trashed') continue
          snapshot.push({ id, collectionIds: [...asset.collectionIds] })
          const list = Array.from(new Set(collectionIds))
          const same = list.length === asset.collectionIds.length && list.every((c) => asset.collectionIds.includes(c))
          if (same) continue
          changed.push({ ...asset, collectionIds: list, updatedAt: now })
        }
        return runBatchCollectionUpdate(set, get, { changed, snapshot }, label)
      },

      moveToTrash: async (ids, onProgress) => {
        const assetsBefore: Record<string, GeneratedAsset> = {}
        for (const id of ids) {
          const asset = get().assetsById[id]
          if (asset) assetsBefore[id] = asset
        }
        const updated = await repository.moveToTrash(ids, undefined, onProgress)
        const assetsAfter: Record<string, GeneratedAsset> = {}
        for (const asset of updated) assetsAfter[asset.id] = asset
        if (Object.keys(assetsBefore).length > 0) {
          pushUndoEntry(set, {
            label: '移入回收站',
            assetsBefore,
            assetsAfter,
            collectionsBefore: null,
            collectionsAfter: null,
            tagsBefore: null,
            tagsAfter: null,
          })
        }
        set((state) => ({
          ...applyAssetsToState(state, updated),
          selectedAssetIds: state.selectedAssetIds.filter((id) => !ids.includes(id)),
          activeAssetId: state.activeAssetId && ids.includes(state.activeAssetId) ? null : state.activeAssetId,
          mutationVersion: state.mutationVersion + 1,
        }))
      },

      restoreAssets: async (ids, onProgress) => {
        const assetsBefore: Record<string, GeneratedAsset> = {}
        for (const id of ids) {
          const asset = get().assetsById[id]
          if (asset) assetsBefore[id] = asset
        }
        const updated = await repository.restore(ids, undefined, onProgress)
        const assetsAfter: Record<string, GeneratedAsset> = {}
        for (const asset of updated) assetsAfter[asset.id] = asset
        if (Object.keys(assetsBefore).length > 0) {
          pushUndoEntry(set, {
            label: '恢复素材',
            assetsBefore,
            assetsAfter,
            collectionsBefore: null,
            collectionsAfter: null,
            tagsBefore: null,
            tagsAfter: null,
          })
        }
        set((state) => ({ ...applyAssetsToState(state, updated), mutationVersion: state.mutationVersion + 1 }))
      },

      removeAssetLocal: (id) =>
        set((state) => {
          const { [id]: _removed, ...assetsById } = state.assetsById
          return {
            assetsById,
            assetOrder: state.assetOrder.filter((assetId) => assetId !== id),
            selectedAssetIds: state.selectedAssetIds.filter((assetId) => assetId !== id),
            activeAssetId: state.activeAssetId === id ? null : state.activeAssetId,
            mutationVersion: state.mutationVersion + 1,
          }
        }),

      trashSelectedAssets: async () => {
        const ids = get().selectedAssetIds
        if (ids.length === 0) return
        await get().moveToTrash(ids)
      },

      restoreSelectedAssets: async () => {
        const ids = get().selectedAssetIds
        if (ids.length === 0) return
        await get().restoreAssets(ids)
      },

      purgeSelectedAssets: async (): Promise<{ purged: string[]; blocked: unknown[] }> => {
        const ids = get().selectedAssetIds
        if (ids.length === 0) return { purged: [], blocked: [] }
        const { purgeGeneratedAssets } = await import('../../store')
        return purgeGeneratedAssets(ids)
      },

      emptyTrashAssets: async (): Promise<{ purged: string[]; blocked: unknown[] }> => {
        // 回收站素材可能超出内存中 200 条水合窗口，必须从权威目录全量读取，避免漏删。
        const { hydrateFull } = await import('../../lib/assetLibraryRepository')
        const full = await hydrateFull()
        const ids = full.assets.filter((asset) => asset.status === 'trashed').map((asset) => asset.id)
        if (ids.length === 0) return { purged: [], blocked: [] }
        const { purgeGeneratedAssets } = await import('../../store')
        return purgeGeneratedAssets(ids)
      },

      createCollection: async (name, parentId = null) => {
        const { useStore } = await import('../../store')
        try {
          const trimmed = name.trim()
          if (!trimmed) return null
          const normalizedName = trimmed.toLocaleLowerCase('zh-CN')
          const resolvedParentId =
            parentId && get().collections.some((collection) => collection.id === parentId) ? parentId : null
          if (
            get().collections.some(
              (collection) =>
                collection.parentId === resolvedParentId &&
                collection.normalizedName === normalizedName &&
                !isCollectionTrashed(collection),
            )
          ) {
            useStore.getState().showToast('已存在同名项目', 'error')
            return null
          }
          // 与标签一致：新建项目按同级末尾追加（order = 同级数量），而非永远 0。
          const siblings = get().collections.filter((item) => item.parentId === resolvedParentId)
          const collection = {
            ...createEmptyCollection(),
            name: trimmed,
            normalizedName,
            parentId: resolvedParentId,
            order: siblings.length,
          }
          const saved = await repository.putCollection(collection)
          const collectionsBefore = get().collections
          set((state) => applyCollectionsToState(state, [saved]))
          pushUndoEntry(set, {
            label: '新建文件夹',
            assetsBefore: {},
            assetsAfter: {},
            collectionsBefore,
            collectionsAfter: get().collections,
            tagsBefore: null,
            tagsAfter: null,
          })
          useStore.getState().showToast(`已创建项目「${saved.name}」`, 'success')
          return saved
        } catch (error) {
          console.error('创建项目失败:', error)
          useStore.getState().showToast('创建项目失败', 'error')
          return null
        }
      },

      renameCollection: async (id, name) => {
        const { useStore } = await import('../../store')
        try {
          const trimmed = name.trim()
          if (!trimmed) return
          const normalizedName = trimmed.toLocaleLowerCase('zh-CN')
          const current = get().collections.find((item) => item.id === id)
          if (!current) return
          if (
            get().collections.some(
              (item) =>
                item.id !== id &&
                item.parentId === current.parentId &&
                item.normalizedName === normalizedName &&
                !isCollectionTrashed(item),
            )
          ) {
            useStore.getState().showToast('已存在同名项目', 'error')
            return
          }
          const collection = await repository.getCollection(id)
          if (!collection) return
          const saved = await repository.putCollection({ ...collection, name: trimmed, normalizedName })
          const collectionsBefore = get().collections
          set((state) => applyCollectionsToState(state, [saved]))
          pushUndoEntry(set, {
            label: '重命名文件夹',
            assetsBefore: {},
            assetsAfter: {},
            collectionsBefore,
            collectionsAfter: get().collections,
            tagsBefore: null,
            tagsAfter: null,
          })
          useStore.getState().showToast(`已重命名项目「${saved.name}」`, 'success')
        } catch (error) {
          console.error('重命名项目失败:', error)
          useStore.getState().showToast('重命名项目失败', 'error')
        }
      },

      moveCollection: async (id, newParentId) => {
        const collections = get().collections
        const current = collections.find((item) => item.id === id)
        if (!current) return
        if (newParentId === id) return
        if (
          newParentId &&
          isCollectionTrashed(collections.find((item) => item.id === newParentId) ?? ({} as AssetCollection))
        ) {
          const { useStore } = await import('../../store')
          useStore.getState().showToast('不能移动到回收站中的文件夹', 'error')
          return
        }
        // 防环：新父级不能是自身或自身的子孙
        if (newParentId) {
          const childrenOf = (parentId: string) =>
            new Set(collections.filter((item) => item.parentId === parentId).map((item) => item.id))
          const stack = [id]
          const descendants = new Set<string>()
          while (stack.length > 0) {
            const parentId = stack.pop()!
            for (const childId of childrenOf(parentId)) {
              if (!descendants.has(childId)) {
                descendants.add(childId)
                stack.push(childId)
              }
            }
          }
          if (descendants.has(newParentId)) {
            const { useStore } = await import('../../store')
            useStore.getState().showToast('不能移动到自身的子项目中', 'error')
            return
          }
        }
        const saved = await repository.putCollection({
          ...current,
          parentId: newParentId,
          updatedAt: Date.now(),
        })
        const collectionsBefore = get().collections
        set((state) => applyCollectionsToState(state, [saved]))
        pushUndoEntry(set, {
          label: '移动文件夹',
          assetsBefore: {},
          assetsAfter: {},
          collectionsBefore,
          collectionsAfter: get().collections,
          tagsBefore: null,
          tagsAfter: null,
        })
      },

      moveCollectionsToPosition: async (ids, target) => {
        const unique = Array.from(new Set(ids))
        if (unique.length === 0) return
        const collections = get().collections
        // 防环：不能拖入自身或自身的子孙（before/after 参照物同理不能是被拖动项）
        if (target.kind === 'into' && unique.includes(target.parentId)) return
        for (const id of unique) {
          const descendants = collectCollectionSubtreeIds(collections, id)
          if (target.kind === 'into' && descendants.includes(target.parentId)) {
            const { useStore } = await import('../../store')
            useStore.getState().showToast('不能移动到自身的子项目中', 'error')
            return
          }
          if ((target.kind === 'before' || target.kind === 'after') && unique.includes(target.siblingId)) return
          if (target.kind === 'append' && target.parentId && descendants.includes(target.parentId)) {
            const { useStore } = await import('../../store')
            useStore.getState().showToast('不能移动到自身的子项目中', 'error')
            return
          }
        }
        const moved = new Set(unique)
        const compare = (a: AssetCollection, b: AssetCollection) =>
          a.order - b.order || a.normalizedName.localeCompare(b.normalizedName, 'zh-CN')
        const dragged = collections
          .filter((item) => moved.has(item.id))
          .map((item) => ({ ...item, parentId: null, updatedAt: Date.now() }))
          .sort(compare)
        let targetParentId: string | null
        let targetIndex: number
        if (target.kind === 'into' || target.kind === 'append') {
          targetParentId = target.parentId
          targetIndex = Number.POSITIVE_INFINITY
        } else {
          const sibling = collections.find((item) => item.id === target.siblingId)
          if (!sibling) return
          targetParentId = sibling.parentId
          const siblings = collections
            .filter((item) => item.parentId === targetParentId && !moved.has(item.id))
            .sort(compare)
          const index = siblings.findIndex((item) => item.id === target.siblingId)
          if (index < 0) return
          targetIndex = target.kind === 'after' ? index + 1 : index
        }
        const targetSiblings = collections
          .filter((item) => item.parentId === targetParentId && !moved.has(item.id))
          .sort(compare)
        const insertAt = Math.max(0, Math.min(targetSiblings.length, targetIndex))
        const nextSiblings = [...targetSiblings]
        nextSiblings.splice(insertAt, 0, ...dragged.map((item) => ({ ...item, parentId: targetParentId })))
        const now = Date.now()
        const changed = nextSiblings.map((item, order) =>
          item.order === order && item.parentId === targetParentId ? item : { ...item, order, updatedAt: now },
        )
        if (changed.length === 0) return
        const collectionsBefore = get().collections
        await repository.putCollections(changed)
        set((state) => applyCollectionsToState(state, changed))
        pushUndoEntry(set, {
          label: '移动文件夹',
          assetsBefore: {},
          assetsAfter: {},
          collectionsBefore,
          collectionsAfter: get().collections,
          tagsBefore: null,
          tagsAfter: null,
        })
      },

      deleteCollection: async (id) => {
        const collection = get().collections.find((item) => item.id === id)
        if (!collection) return
        // 彻底删除（不经回收站）：文件夹内有图片时先弹确认
        await get().deleteFolders([id])
      },

      /**
       * 彻底删除文件夹（整棵子树，不经回收站）：
       * - 文件夹（含子文件夹）内有图片时，先弹确认提醒（图片本身不会被删除，只会变为「未整理」）；
       * - 空文件夹直接删除。
       */
      deleteFolders: async (ids) => {
        const store = get()
        const targets = ids
          .map((id) => store.collections.find((item) => item.id === id))
          .filter((item): item is AssetCollection => item != null)
        if (targets.length === 0) return
        const subtreeIds = Array.from(
          new Set(targets.flatMap((target) => collectCollectionSubtreeIds(store.collections, target.id))),
        )
        const imageCount = Object.values(store.assetsById).filter((asset) =>
          asset.collectionIds.some((collectionId) => subtreeIds.includes(collectionId)),
        ).length
        const collectionsBefore = store.collections
        const affectedAssetIds = new Set<string>()
        for (const asset of Object.values(store.assetsById)) {
          if (asset.collectionIds.some((collectionId) => subtreeIds.includes(collectionId))) {
            affectedAssetIds.add(asset.id)
          }
        }
        const assetsBefore: Record<string, GeneratedAsset> = {}
        for (const assetId of affectedAssetIds) {
          const asset = store.assetsById[assetId]
          if (asset) assetsBefore[assetId] = asset
        }
        const doDelete = async () => {
          for (const collectionId of subtreeIds) await repository.removeCollection(collectionId)
          set((state) => ({
            collections: state.collections.filter((item) => !subtreeIds.includes(item.id)),
            scope:
              typeof state.scope === 'object' &&
              state.scope.kind === 'collection' &&
              subtreeIds.includes(state.scope.id)
                ? 'all'
                : state.scope,
            filters:
              state.filters.collectionId !== null &&
              state.filters.collectionId !== undefined &&
              subtreeIds.includes(state.filters.collectionId)
                ? { ...state.filters, collectionId: null }
                : state.filters,
            assetsById: Object.fromEntries(
              Object.entries(state.assetsById).map(([assetId, asset]) => [
                assetId,
                asset.collectionIds.some((collectionId) => subtreeIds.includes(collectionId))
                  ? {
                      ...asset,
                      collectionIds: asset.collectionIds.filter((collectionId) => !subtreeIds.includes(collectionId)),
                    }
                  : asset,
              ]),
            ),
            selectedFolderIds: state.selectedFolderIds.filter((folderId) => !subtreeIds.includes(folderId)),
          }))
          const assetsAfter: Record<string, GeneratedAsset> = {}
          for (const assetId of affectedAssetIds) {
            const asset = get().assetsById[assetId]
            if (asset) assetsAfter[assetId] = asset
          }
          pushUndoEntry(set, {
            label: '删除文件夹',
            assetsBefore,
            assetsAfter,
            collectionsBefore,
            collectionsAfter: get().collections,
            tagsBefore: null,
            tagsAfter: null,
          })
          const { useStore } = await import('../../store')
          const label = targets.length === 1 ? `「${targets[0]?.name ?? ''}」` : `${targets.length} 个文件夹`
          useStore.getState().showToast(`已删除${label}`, 'success')
        }
        if (imageCount > 0) {
          const { useStore } = await import('../../store')
          useStore.getState().setConfirmDialog({
            title: '删除文件夹？',
            message: `所选 ${targets.length} 个文件夹（含子文件夹）内共有 ${imageCount} 张图片。删除文件夹后，这些图片会变为「未整理」（图片本身不会被删除，可重新放入其他文件夹）。此操作不可恢复。`,
            confirmText: '删除',
            cancelText: '取消',
            tone: 'danger',
            action: () => {
              void doDelete()
            },
          })
          return
        }
        await doDelete()
      },

      restoreCollection: async (id) => {
        await repository.restoreCollection(id)
        set((state) => {
          const ids = collectCollectionSubtreeIds(state.collections, id)
          return {
            collections: state.collections.map((item) =>
              ids.includes(item.id) ? { ...item, trashedAt: null, updatedAt: Date.now() } : item,
            ),
          }
        })
        const collection = get().collections.find((item) => item.id === id)
        void import('../../store').then(({ useStore }) =>
          useStore.getState().showToast(`已恢复「${collection?.name ?? ''}」`, 'success'),
        )
      },

      purgeCollection: async (id) => {
        const collection = get().collections.find((item) => item.id === id)
        if (!collection) return
        const ids = collectCollectionSubtreeIds(get().collections, id)
        for (const collectionId of ids) await repository.removeCollection(collectionId)
        set((state) => ({
          collections: state.collections.filter((item) => !ids.includes(item.id)),
          scope:
            typeof state.scope === 'object' && state.scope.kind === 'collection' && ids.includes(state.scope.id)
              ? 'all'
              : state.scope,
          filters:
            state.filters.collectionId !== null &&
            state.filters.collectionId !== undefined &&
            ids.includes(state.filters.collectionId)
              ? { ...state.filters, collectionId: null }
              : state.filters,
          assetsById: Object.fromEntries(
            Object.entries(state.assetsById).map(([assetId, asset]) => [
              assetId,
              asset.collectionIds.some((collectionId) => ids.includes(collectionId))
                ? { ...asset, collectionIds: asset.collectionIds.filter((collectionId) => !ids.includes(collectionId)) }
                : asset,
            ]),
          ),
          selectedFolderIds: state.selectedFolderIds.filter((folderId) => !ids.includes(folderId)),
        }))
        void import('../../store').then(({ useStore }) =>
          useStore.getState().showToast(`已彻底删除「${collection.name}」及其内容`, 'success'),
        )
      },

      setCollectionColor: async (id, color) => {
        const { useStore } = await import('../../store')
        try {
          const collection = await repository.getCollection(id)
          if (!collection) return
          const saved = await repository.putCollection({
            ...collection,
            color: color ?? undefined,
            updatedAt: Date.now(),
          })
          set((state) => applyCollectionsToState(state, [saved]))
          useStore.getState().showToast(color ? '已设置文件夹颜色' : '已清除文件夹颜色', 'success')
        } catch (error) {
          console.error('设置文件夹颜色失败:', error)
          useStore.getState().showToast('设置文件夹颜色失败', 'error')
        }
      },

      togglePinCollection: async (id) => {
        const { useStore } = await import('../../store')
        try {
          const collection = await repository.getCollection(id)
          if (!collection) return
          const saved = await repository.putCollection({
            ...collection,
            pinned: !collection.pinned,
            updatedAt: Date.now(),
          })
          set((state) => applyCollectionsToState(state, [saved]))
          useStore.getState().showToast(saved.pinned ? '已置顶文件夹' : '已取消置顶文件夹', 'success')
        } catch (error) {
          console.error('置顶文件夹失败:', error)
          useStore.getState().showToast('置顶操作失败', 'error')
        }
      },

      reorderCollection: async (id, direction) => {
        const { useStore } = await import('../../store')
        try {
          const collections = get().collections
          const current = collections.find((item) => item.id === id)
          if (!current) return
          const siblings = collections
            .filter((item) => item.parentId === current.parentId && !isCollectionTrashed(item))
            .sort(
              (a, b) =>
                (b.pinned === true ? 1 : 0) - (a.pinned === true ? 1 : 0) ||
                a.order - b.order ||
                a.normalizedName.localeCompare(b.normalizedName, 'zh-CN'),
            )
          const index = siblings.findIndex((item) => item.id === id)
          const targetIndex = direction === 'up' ? index - 1 : index + 1
          if (index < 0 || targetIndex < 0 || targetIndex >= siblings.length) return
          const other = siblings[targetIndex]
          const now = Date.now()
          const updated = [
            { ...current, order: other.order, updatedAt: now },
            { ...other, order: current.order, updatedAt: now },
          ]
          for (const item of updated) await repository.putCollection(item)
          set((state) => applyCollectionsToState(state, updated))
          useStore.getState().showToast(direction === 'up' ? '已上移文件夹' : '已下移文件夹', 'success')
        } catch (error) {
          console.error('移动文件夹顺序失败:', error)
          useStore.getState().showToast('移动顺序失败', 'error')
        }
      },

      duplicateCollection: async (id) => {
        // 就地复制：把当前节点复制到同一父级（复用剪贴板粘贴逻辑）
        const { useStore } = await import('../../store')
        try {
          const collection = get().collections.find((item) => item.id === id)
          if (!collection) return null
          set({ clipboard: { kind: 'copy', type: 'collection', id, name: collection.name } })
          const clone = await get().pasteCollection(collection.parentId)
          return clone
        } catch (error) {
          console.error('复制项目失败:', error)
          useStore.getState().showToast('复制项目失败', 'error')
          return null
        }
      },

      mergeCollection: async (sourceId, targetId) => {
        const { useStore } = await import('../../store')
        try {
          if (sourceId === targetId) return false
          const source = get().collections.find((item) => item.id === sourceId)
          const target = get().collections.find((item) => item.id === targetId)
          if (!source || !target) return false
          const { listAssets, putGeneratedAssets } = await import('../../lib/assetLibraryRepository')
          const ids = collectCollectionSubtreeIds(get().collections, sourceId)
          const now = Date.now()
          // 素材：source（含子树）内的素材追加 targetId（素材共享）
          const affected = (await listAssets()).filter((asset) =>
            asset.collectionIds.some((collectionId) => ids.includes(collectionId)),
          )
          const assetsBefore: Record<string, GeneratedAsset> = {}
          for (const asset of affected) assetsBefore[asset.id] = asset
          const collectionsBefore = get().collections
          const updated = affected
            .filter((asset) => !asset.collectionIds.includes(targetId))
            .map((asset) => ({ ...asset, collectionIds: [...asset.collectionIds, targetId], updatedAt: now }))
          if (updated.length > 0) await putGeneratedAssets(updated)
          // 子文件夹：source 的直接子级挂到 target
          const promotedChildren = get()
            .collections.filter((item) => item.parentId === sourceId)
            .map((item) => ({ ...item, parentId: targetId, updatedAt: now }))
          for (const child of promotedChildren) await repository.putCollection(child)
          // 删除 source（硬删，剥离引用）
          await repository.removeCollection(sourceId)
          set((state) => ({
            collections: sortCollections(
              state.collections
                .filter((item) => item.id !== sourceId)
                .map((item) => promotedChildren.find((child) => child.id === item.id) ?? item),
            ),
            assetsById: { ...state.assetsById, ...Object.fromEntries(updated.map((asset) => [asset.id, asset])) },
            selectedFolderIds: state.selectedFolderIds.filter((folderId) => folderId !== sourceId),
          }))
          const assetsAfter: Record<string, GeneratedAsset> = {}
          for (const asset of updated) assetsAfter[asset.id] = asset
          pushUndoEntry(set, {
            label: '合并文件夹',
            assetsBefore,
            assetsAfter,
            collectionsBefore,
            collectionsAfter: get().collections,
            tagsBefore: null,
            tagsAfter: null,
          })
          useStore.getState().showToast(`已合并「${source.name}」到「${target.name}」`, 'success')
          return true
        } catch (error) {
          console.error('合并文件夹失败:', error)
          useStore.getState().showToast('合并文件夹失败', 'error')
          return false
        }
      },

      importFilesIntoCollection: async (collectionId, files) => {
        const collection = get().collections.find((item) => item.id === collectionId)
        if (!collection) return 0
        const { importExternalImageFile } = await import('../../lib/externalAssetImport')
        const imported: GeneratedAsset[] = []
        for (const file of files) {
          try {
            const asset = await importExternalImageFile(file)
            if (asset) imported.push(asset)
          } catch (error) {
            console.warn('导入图片失败:', file.name, error)
          }
        }
        if (imported.length === 0) return 0
        get().applyUpsertedAssets(imported)
        const { putGeneratedAssets } = await import('../../lib/assetLibraryRepository')
        const now = Date.now()
        const updated = imported
          .map((asset) => get().assetsById[asset.id])
          .filter((asset): asset is GeneratedAsset => Boolean(asset))
          .map((asset) => ({
            ...asset,
            collectionIds: [...new Set([...asset.collectionIds, collectionId])],
            updatedAt: now,
          }))
        if (updated.length > 0) await putGeneratedAssets(updated)
        set((state) => ({
          assetsById: { ...state.assetsById, ...Object.fromEntries(updated.map((asset) => [asset.id, asset])) },
        }))
        void import('../../store').then(({ useStore }) =>
          useStore.getState().showToast(`已导入 ${imported.length} 张图片到「${collection.name}」`, 'success'),
        )
        return imported.length
      },

      exportCollectionToZip: async (collectionId) => {
        const collection = get().collections.find((item) => item.id === collectionId)
        if (!collection) return false
        const ids = collectCollectionSubtreeIds(get().collections, collectionId)
        const assets = Object.values(get().assetsById).filter((asset) =>
          asset.collectionIds.some((collectionId_) => ids.includes(collectionId_)),
        )
        if (assets.length === 0) {
          void import('../../store').then(({ useStore }) => useStore.getState().showToast('该文件夹内没有素材', 'info'))
          return false
        }
        const { selectZipSavePath, exportZipToPath } = await import('../../lib/localSave')
        const { getImage, resolveImageFromCatalog } = await import('../../lib/db')
        const filePath = await selectZipSavePath(`${collection.name}.zip`)
        if (!filePath) return false
        try {
          const entries: Array<{ sourcePath: string; archivePath: string; mtime?: number }> = []
          const imageFiles: NonNullable<ExportData['imageFiles']> = {}
          for (const asset of assets) {
            const image = (await getImage(asset.imageId)) ?? (await resolveImageFromCatalog(asset.imageId))
            if (!image?.localPath) continue
            const ext = (image.localPath.match(/\.([a-zA-Z0-9]+)$/)?.[1] ?? 'png').toLowerCase()
            const archivePath = `images/${asset.imageId}.${ext}`
            entries.push({ sourcePath: image.localPath, archivePath, mtime: image.createdAt })
            imageFiles[asset.imageId] = { path: archivePath, width: image.width, height: image.height }
          }
          if (entries.length === 0) {
            void import('../../store').then(({ useStore }) =>
              useStore.getState().showToast('没有可导出的本地图片', 'error'),
            )
            return false
          }
          const manifest: ExportData = {
            version: 7,
            exportedAt: new Date().toISOString(),
            generatedAssets: assets,
            assetCollections: get().collections.filter((item) => ids.includes(item.id)),
            imageFiles,
          }
          const result = await exportZipToPath({
            destinationPath: filePath,
            manifestJson: JSON.stringify(manifest, null, 2),
            entries,
          })
          if (!result.success) throw new Error(result.error ?? '导出失败')
          void import('../../store').then(({ useStore }) =>
            useStore.getState().showToast(`已导出 ${entries.length} 张图片`, 'success'),
          )
          return true
        } catch (error) {
          console.warn('导出文件夹失败:', error)
          void import('../../store').then(({ useStore }) => useStore.getState().showToast('导出失败', 'error'))
          return false
        }
      },

      getCollectionInfo: (id) => {
        const collection = get().collections.find((item) => item.id === id)
        if (!collection) return null
        const ids = collectCollectionSubtreeIds(get().collections, id)
        const assets = Object.values(get().assetsById)
        const direct = assets.filter((asset) => asset.collectionIds.includes(id))
        const recursive = assets.filter((asset) =>
          asset.collectionIds.some((collectionId) => ids.includes(collectionId)),
        )
        return {
          id,
          name: collection.name,
          assetCount: direct.length,
          recursiveAssetCount: recursive.length,
          byteSize: recursive.reduce((sum, asset) => sum + (asset.byteSize ?? 0), 0),
          childCount: get().collections.filter((item) => item.parentId === id).length,
          createdAt: collection.createdAt,
          updatedAt: collection.updatedAt,
          trashedAt: collection.trashedAt ?? null,
        }
      },

      // ===== 标签动作（Eagle 式）=====

      createTag: async (name, parentId = null) => {
        const trimmed = name.trim()
        if (!trimmed) return null
        const normalizedName = trimmed.toLocaleLowerCase('zh-CN')
        const resolvedParentId = parentId && get().tags.some((tag) => tag.id === parentId) ? parentId : null
        if (get().tags.some((tag) => tag.parentId === resolvedParentId && tag.normalizedName === normalizedName)) {
          const { useStore } = await import('../../store')
          useStore.getState().showToast('已存在同名标签', 'error')
          return null
        }
        const siblings = get().tags.filter((tag) => tag.parentId === resolvedParentId)
        const tag: AssetTag = {
          ...createEmptyTag(),
          name: trimmed,
          normalizedName,
          parentId: resolvedParentId,
          order: siblings.length,
        }
        await repository.putTags([tag])
        const tagsBefore = get().tags
        set((state) => ({ tags: sortTags([...state.tags, tag]) }))
        pushUndoEntry(set, {
          label: '新建标签',
          assetsBefore: {},
          assetsAfter: {},
          collectionsBefore: null,
          collectionsAfter: null,
          tagsBefore,
          tagsAfter: get().tags,
        })
        return tag
      },

      renameTag: async (id, name) => {
        const trimmed = name.trim()
        if (!trimmed) return
        const normalizedName = trimmed.toLocaleLowerCase('zh-CN')
        const current = get().tags.find((tag) => tag.id === id)
        if (!current) return
        if (
          get().tags.some(
            (tag) => tag.id !== id && tag.parentId === current.parentId && tag.normalizedName === normalizedName,
          )
        ) {
          const { useStore } = await import('../../store')
          useStore.getState().showToast('已存在同名标签', 'error')
          return
        }
        const updated: AssetTag = { ...current, name: trimmed, normalizedName, updatedAt: Date.now() }
        await repository.putTags([updated])
        const tagsBefore = get().tags
        set((state) => ({ tags: sortTags(state.tags.map((tag) => (tag.id === id ? updated : tag))) }))
        pushUndoEntry(set, {
          label: '重命名标签',
          assetsBefore: {},
          assetsAfter: {},
          collectionsBefore: null,
          collectionsAfter: null,
          tagsBefore,
          tagsAfter: get().tags,
        })
      },

      deleteTag: async (id) => {
        const current = get().tags.find((tag) => tag.id === id)
        if (!current) return
        const tagsBefore = get().tags
        // 1) 剥离素材上的该标签引用（差异化补丁，一次批量写）
        const affected = Object.values(get().assetsById).filter(
          (asset) => asset.tagIds.includes(id) && asset.status !== 'trashed',
        )
        const assetsBefore: Record<string, GeneratedAsset> = {}
        for (const asset of affected) assetsBefore[asset.id] = asset
        const assetsAfter: Record<string, GeneratedAsset> = {}
        if (affected.length > 0) {
          const updated = await repository.patchAssetsIndividually(
            affected.map((asset) => ({
              id: asset.id,
              patch: { tagIds: asset.tagIds.filter((tagId) => tagId !== id) },
            })),
          )
          for (const asset of updated) assetsAfter[asset.id] = asset
          set((state) => ({ ...applyAssetsToState(state, updated), mutationVersion: state.mutationVersion + 1 }))
        }
        // 2) 删除标签记录（Electron：子标签提升为父级的子级；浏览器侧同语义）
        await repository.deleteTagRecord(id)
        set((state) => ({
          tags: sortTags(state.tags.filter((tag) => tag.id !== id)),
          // 该标签正在被筛选时清除其选中态
          filters: {
            ...state.filters,
            tagId: state.filters.tagId === id ? null : state.filters.tagId,
            tagIds: state.filters.tagIds?.filter((tagId) => tagId !== id),
          },
        }))
        pushUndoEntry(set, {
          label: '删除标签',
          assetsBefore,
          assetsAfter,
          collectionsBefore: null,
          collectionsAfter: null,
          tagsBefore,
          tagsAfter: get().tags,
        })
      },

      mergeTags: async (sourceId, targetId) => {
        if (sourceId === targetId) return false
        const source = get().tags.find((tag) => tag.id === sourceId)
        const target = get().tags.find((tag) => tag.id === targetId)
        if (!source || !target) return false
        const tagsBefore = get().tags
        // 1) 素材引用改挂 target（去重）
        const affected = Object.values(get().assetsById).filter((asset) => asset.tagIds.includes(sourceId))
        const assetsBefore: Record<string, GeneratedAsset> = {}
        for (const asset of affected) assetsBefore[asset.id] = asset
        const assetsAfter: Record<string, GeneratedAsset> = {}
        if (affected.length > 0) {
          const updated = await repository.patchAssetsIndividually(
            affected.map((asset) => ({
              id: asset.id,
              patch: { tagIds: [...new Set([...asset.tagIds.filter((tagId) => tagId !== sourceId), targetId])] },
            })),
          )
          for (const asset of updated) assetsAfter[asset.id] = asset
          set((state) => ({ ...applyAssetsToState(state, updated), mutationVersion: state.mutationVersion + 1 }))
        }
        // 2) source 的子标签改挂 target 下（与集合合并语义一致）
        const children = get().tags.filter((tag) => tag.parentId === sourceId)
        if (children.length > 0) {
          const now = Date.now()
          const promoted = children.map((child) => ({ ...child, parentId: targetId, updatedAt: now }))
          await repository.putTags(promoted)
        }
        // 3) 删除 source
        await repository.deleteTagRecord(sourceId)
        set((state) => ({
          tags: sortTags(
            state.tags
              .filter((tag) => tag.id !== sourceId)
              .map((tag) => (tag.parentId === sourceId ? { ...tag, parentId: targetId, updatedAt: Date.now() } : tag)),
          ),
          filters: {
            ...state.filters,
            tagId: state.filters.tagId === sourceId ? targetId : state.filters.tagId,
            tagIds: state.filters.tagIds ? state.filters.tagIds.filter((tagId) => tagId !== sourceId) : undefined,
          },
        }))
        pushUndoEntry(set, {
          label: '合并标签',
          assetsBefore,
          assetsAfter,
          collectionsBefore: null,
          collectionsAfter: null,
          tagsBefore,
          tagsAfter: get().tags,
        })
        const { useStore } = await import('../../store')
        useStore.getState().showToast(`已合并「${source.name}」到「${target.name}」`, 'success')
        return true
      },

      setTagColor: async (id, color) => {
        const current = get().tags.find((tag) => tag.id === id)
        if (!current) return
        const updated: AssetTag = { ...current, color: color ?? undefined, updatedAt: Date.now() }
        await repository.putTags([updated])
        const tagsBefore = get().tags
        set((state) => ({ tags: sortTags(state.tags.map((tag) => (tag.id === id ? updated : tag))) }))
        pushUndoEntry(set, {
          label: '设置标签颜色',
          assetsBefore: {},
          assetsAfter: {},
          collectionsBefore: null,
          collectionsAfter: null,
          tagsBefore,
          tagsAfter: get().tags,
        })
      },

      toggleTagFilter: (tagId) =>
        set((state) => {
          const current = state.filters.tagIds ?? []
          const next = current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId]
          return {
            filters: { ...state.filters, tagIds: next.length > 0 ? next : undefined },
            selectedAssetIds: [],
            activeAssetId: null,
            similarToAssetId: null,
          }
        }),

      clearTagFilters: () =>
        set((state) => ({
          filters: { ...state.filters, tagIds: undefined },
          selectedAssetIds: [],
          activeAssetId: null,
        })),

      toggleSelectFolder: (id) =>
        set((state) => ({
          selectedFolderIds: state.selectedFolderIds.includes(id)
            ? state.selectedFolderIds.filter((item) => item !== id)
            : [...state.selectedFolderIds, id],
        })),
      setSelectedFolders: (ids) => set({ selectedFolderIds: [...new Set(ids)] }),
      clearSelectedFolders: () => set({ selectedFolderIds: [] }),
      setFolderEditRequest: (request) => set({ folderEditRequest: request }),

      deleteSelectedFolders: async () => {
        // 彻底删除（不经回收站）；文件夹内有图片时在 deleteFolders 内弹确认
        await get().deleteFolders(get().selectedFolderIds)
      },
      moveSelectedFolders: async (targetId) => {
        const ids = get().selectedFolderIds
        try {
          for (const id of ids) await get().moveCollection(id, targetId)
          set({ selectedFolderIds: [] })
          if (ids.length > 0) {
            const { useStore } = await import('../../store')
            useStore.getState().showToast(`已移动 ${ids.length} 个文件夹`, 'success')
          }
        } catch (error) {
          console.error('批量移动文件夹失败:', error)
          const { useStore } = await import('../../store')
          useStore.getState().showToast('移动文件夹失败', 'error')
        }
      },
      mergeSelectedFolders: async () => {
        const ids = get().selectedFolderIds
        if (ids.length < 2) {
          const { useStore } = await import('../../store')
          useStore.getState().showToast('请至少选择两个文件夹进行合并', 'info')
          return false
        }
        const targetId = ids[0]
        let merged = false
        for (const id of ids.slice(1)) {
          if (await get().mergeCollection(id, targetId)) merged = true
        }
        set({ selectedFolderIds: [] })
        return merged
      },
      exportSelectedFolders: async () => {
        const ids = get().selectedFolderIds
        let ok = true
        for (const id of ids) {
          if (!(await get().exportCollectionToZip(id))) ok = false
        }
        return ok
      },

      copyCollection: (id) => {
        const collection = get().collections.find((item) => item.id === id)
        if (!collection) return
        set({ clipboard: { kind: 'copy', type: 'collection', id, name: collection.name } })
        void import('../../store').then(({ useStore }) =>
          useStore.getState().showToast(`已复制「${collection.name}」，选择目标位置粘贴`, 'info'),
        )
      },
      cutCollection: (id) => {
        const collection = get().collections.find((item) => item.id === id)
        if (!collection) return
        set({ clipboard: { kind: 'cut', type: 'collection', id, name: collection.name } })
        void import('../../store').then(({ useStore }) =>
          useStore.getState().showToast(`已剪切「${collection.name}」，选择目标位置粘贴`, 'info'),
        )
      },
      pasteCollection: async (targetId) => {
        const entry = get().clipboard
        if (!entry || entry.type !== 'collection' || !entry.id) return null
        const { useStore } = await import('../../store')
        const target = targetId ? get().collections.find((item) => item.id === targetId) : undefined
        if (entry.kind === 'cut') {
          const beforeParent = get().collections.find((item) => item.id === entry.id)?.parentId ?? null
          await get().moveCollection(entry.id, targetId)
          const after = get().collections.find((item) => item.id === entry.id)
          const afterParent = after?.parentId ?? null
          // 移动成功或同父原地粘贴：清空剪贴板并提示；被拒绝（环/自身）时保留剪贴板供重试
          if (after && (afterParent !== beforeParent || afterParent === targetId)) {
            set({ clipboard: null })
            useStore
              .getState()
              .showToast(`已移动「${entry.name}」${target ? `到「${target.name}」` : '到根目录'}`, 'success')
          }
          return after ?? null
        }
        const { listCollections, listAssets, putCollection, putGeneratedAssets } =
          await import('../../lib/assetLibraryRepository')
        const [collections, assets] = await Promise.all([listCollections(), listAssets()])
        const plan = planCollectionCopy(entry.id, targetId, collections, assets)
        if (!plan) return null
        for (const clone of plan.clones) await putCollection(clone)
        const now = Date.now()
        const updatedAssets: GeneratedAsset[] = []
        for (const [assetId, cloneIds] of plan.assetAdditions) {
          const asset = assets.find((item) => item.id === assetId)
          if (!asset) continue
          updatedAssets.push({
            ...asset,
            collectionIds: [...new Set([...asset.collectionIds, ...cloneIds])],
            updatedAt: now,
          })
        }
        if (updatedAssets.length > 0) await putGeneratedAssets(updatedAssets)
        set((state) => ({
          collections: sortCollections([...state.collections, ...plan.clones]),
          assetsById: { ...state.assetsById, ...Object.fromEntries(updatedAssets.map((asset) => [asset.id, asset])) },
        }))
        const rootClone = plan.clones[0]
        useStore
          .getState()
          .showToast(`已粘贴「${rootClone.name}」${target ? `到「${target.name}」` : '到根目录'}`, 'success')
        return rootClone
      },
      clearClipboard: () => set({ clipboard: null }),

      // ===== 素材剪贴板（Eagle 式 Ctrl+C/V/X）+ 撤销/重做 =====

      copyAssets: (ids) => {
        const unique = Array.from(new Set(ids)).filter((id) => get().assetsById[id])
        if (unique.length === 0) return
        set({ clipboard: { kind: 'copy', type: 'asset', assetIds: unique } })
      },

      cutAssets: (ids) => {
        const unique = Array.from(new Set(ids)).filter((id) => get().assetsById[id])
        if (unique.length === 0) return
        set({ clipboard: { kind: 'cut', type: 'asset', assetIds: unique } })
      },

      pasteAssetsIntoCollection: async (targetId) => {
        const entry = get().clipboard
        if (!entry || entry.type !== 'asset' || !entry.assetIds || entry.assetIds.length === 0) return 0
        const target = targetId ? get().collections.find((item) => item.id === targetId) : undefined
        const ids = entry.assetIds.filter((id) => get().assetsById[id])
        if (ids.length === 0) return 0
        const updates = ids.map((id) => {
          const asset = get().assetsById[id]
          const collectionIds = targetId
            ? Array.from(new Set(entry.kind === 'cut' ? [targetId] : [...asset.collectionIds, targetId]))
            : entry.kind === 'cut'
              ? []
              : asset.collectionIds
          return { id, collectionIds }
        })
        const count = await get().applyBatchCollectionChanges(
          updates,
          entry.kind === 'cut'
            ? `移动素材${target ? `到「${target.name}」` : '到未整理'}`
            : `粘贴素材${target ? `到「${target.name}」` : ''}`,
        )
        if (count > 0) set({ clipboard: null })
        return count
      },

      undo: async () => {
        const entry = get().undoStack[get().undoStack.length - 1]
        if (!entry) return false
        await applyUndoSnapshot(set, get, {
          assets: entry.assetsBefore,
          collections: entry.collectionsBefore,
          tags: entry.tagsBefore,
        })
        set((state) => ({
          undoStack: state.undoStack.slice(0, -1),
          redoStack: [...state.redoStack, entry],
          selectedAssetIds: [],
          activeAssetId: null,
          selectedFolderIds: [],
        }))
        return true
      },

      redo: async () => {
        const entry = get().redoStack[get().redoStack.length - 1]
        if (!entry) return false
        await applyUndoSnapshot(set, get, {
          assets: entry.assetsAfter,
          collections: entry.collectionsAfter,
          tags: entry.tagsAfter,
        })
        set((state) => ({
          redoStack: state.redoStack.slice(0, -1),
          undoStack: [...state.undoStack, entry],
          selectedAssetIds: [],
          activeAssetId: null,
          selectedFolderIds: [],
        }))
        return true
      },
    }),
    {
      name: 'doupao-asset-library-ui',
      version: 6,
      partialize: partializeAssetLibraryStore,
      migrate: (persisted) => {
        const state = persisted as Partial<
          Pick<
            AssetLibraryStoreState,
            | 'scope'
            | 'query'
            | 'filters'
            | 'sortKey'
            | 'sortOrder'
            | 'gridDensity'
            | 'viewMode'
            | 'groupBy'
            | 'groupedViewStyle'
            | 'includeSubcollections'
            | 'savedFilters'
            | 'pinnedFilters'
            | 'visibleFilterControls'
          >
        > & { viewStyle?: 'images' | 'batch'; groupBy?: unknown }
        return {
          scope: state.scope ?? 'all',
          query: state.query ?? '',
          filters: state.filters ?? {},
          sortKey: state.sortKey ?? 'updatedAt',
          sortOrder: state.sortOrder ?? 'desc',
          gridDensity: state.gridDensity ?? 'standard',
          viewMode: state.viewMode ?? 'grid',
          // v6（0.7.56 方案）：生图由任务卡承载 —— 默认视图固定为「任务卡片」。
          // 旧持久化里的「图片」（groupBy: none）与「分组·图片砖」（groupedViewStyle: tiles）
          // 一次性归一为「任务卡片」；此后用户手动切到「图片」按正常持久化保存。
          groupBy: 'grouped',
          groupedViewStyle: 'cards',
          includeSubcollections: state.includeSubcollections ?? false,
          savedFilters: Array.isArray(state.savedFilters) ? state.savedFilters : [],
          pinnedFilters: Array.isArray(state.pinnedFilters) ? state.pinnedFilters : [],
          visibleFilterControls: Array.isArray(state.visibleFilterControls) ? state.visibleFilterControls : [],
        }
      },
    },
  ),
)

/** 旧值 batch/task 统一归一化为 grouped；其余按字面量返回（none/grouped）。 */
export function normalizeGroupBy(value: unknown): AssetGroupBy {
  if (value === 'grouped' || value === 'batch' || value === 'task') return 'grouped'
  return 'none'
}

export function getVisibleAssets(state: Pick<AssetLibraryStoreState, 'assetsById' | 'assetOrder'>): GeneratedAsset[] {
  const result: GeneratedAsset[] = []
  for (const id of state.assetOrder) {
    const asset = state.assetsById[id]
    if (asset) result.push(asset)
  }
  return result
}

/** 持久化边界：只保存小型 UI 偏好、智能文件夹与顶部快捷筛选，资产元数据一律来自 SQLite/IndexedDB 水合。 */
export function partializeAssetLibraryStore(state: AssetLibraryStoreState) {
  return {
    scope: state.scope,
    query: state.query,
    filters: state.filters,
    sortKey: state.sortKey,
    sortOrder: state.sortOrder,
    gridDensity: state.gridDensity,
    viewMode: state.viewMode,
    groupBy: state.groupBy,
    groupedViewStyle: state.groupedViewStyle,
    includeSubcollections: state.includeSubcollections,
    savedFilters: state.savedFilters,
    pinnedFilters: state.pinnedFilters,
    visibleFilterControls: state.visibleFilterControls,
  }
}
