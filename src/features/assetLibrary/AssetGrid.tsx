import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type UIEvent,
} from 'react'
import type { GeneratedAsset } from '../../types'
import { HOVER_FULL_IMAGE_LIMIT } from '../../lib/imageHover'
import { markScrollActivity } from '../../lib/scrollActivity'
import { ImageIcon } from '../../design-system/icons'
import { EmptyState } from '../../design-system'
import { useDragSelect, getMarqueeBoxStyle } from '../../hooks/useDragSelect'
import { useAssetLibraryStore } from './store'
import AssetCardMenu from './AssetCardMenu'
import AssetTile, { type TileSelectMode } from './AssetTile'

const CARD_GAP = 12
const VIRTUAL_OVERSCAN = 900

export interface AssetMasonryItem {
  asset: GeneratedAsset
  left: number
  top: number
  width: number
  height: number
  /** 预构建的定位样式：布局不变时对象引用稳定，滚动帧中不击穿卡片 memo */
  style: CSSProperties
}

function focusAssetCard(assetId: string) {
  const element = document.querySelector<HTMLElement>(`[data-asset-id="${CSS.escape(assetId)}"]`)
  element?.focus()
}

/** 网格列数：宽度断点 + 密度修正；分组视图固定按「标准」密度布局（任务卡片形式不随密度变化）。
 *  大图（cozy）比标准少 2 列，保证单张足够大；紧凑（compact）多 1 列。 */
export function getAssetGridColumns(width: number, density: 'compact' | 'standard' | 'cozy' = 'standard'): number {
  if (width <= 0) return 2
  let columns = width < 560 ? 2 : width < 960 ? 3 : width < 1440 ? 4 : 5
  if (density === 'compact') columns = Math.max(2, columns + 1)
  if (density === 'cozy') columns = Math.max(2, columns - 2)
  return columns
}

export function buildAssetMasonryLayout(
  assets: GeneratedAsset[],
  width: number,
  density: 'compact' | 'standard' | 'cozy' = 'standard',
): { height: number; columns: number; items: AssetMasonryItem[] } {
  if (width <= 0 || assets.length === 0) return { height: 0, columns: 2, items: [] }
  const columns = getAssetGridColumns(width, density)
  const itemWidth = Math.max(1, (width - CARD_GAP * (columns - 1)) / columns)
  const heights = Array.from({ length: columns }, () => 0)
  const items = assets.map((asset, index) => {
    // 先横后竖、从左开始算：按列号 0..columns-1 循环分配（行主序），
    // 图片顺序保持从左到右、排满一行再换行向下的自然阅读顺序；
    // 不再按「最短列」跳列（那会让顺序在列间跳来跳去，看起来是乱的）。
    const column = index % columns
    const ratio = asset.width && asset.height ? asset.height / asset.width : 1
    const height = itemWidth * Math.min(2, Math.max(0.5, ratio))
    const left = column * (itemWidth + CARD_GAP)
    const top = heights[column]
    const item: AssetMasonryItem = {
      asset,
      left,
      top,
      width: itemWidth,
      height,
      style: { left, top, width: itemWidth, height },
    }
    heights[column] += height + CARD_GAP
    return item
  })
  return { height: Math.max(0, ...heights) - CARD_GAP, columns, items }
}

interface AssetCardProps {
  asset: GeneratedAsset
  selected: boolean
  style: CSSProperties
  onToggleSelect: (assetId: string, mode: TileSelectMode) => void
  onOpenLightbox: (assetId: string) => void
  onQuickPreview: (assetId: string) => void
  onOpenMenu: (event: MouseEvent<HTMLDivElement>, asset: GeneratedAsset) => void
  /** 框选拖拽结束后抑制紧接着的点击事件 */
  suppressClickUntilRef: React.MutableRefObject<number>
  /** 大图库（如上万张）时置为 false：hover 只保留缩略图，不再解码原图。 */
  loadFullOnHover?: boolean
}

function AssetCard({ style, onOpenLightbox, ...tileProps }: AssetCardProps) {
  return <AssetTile {...tileProps} onOpenViewer={onOpenLightbox} style={style} className="absolute" />
}

const MemoizedAssetCard = memo(AssetCard)

export interface AssetGridProps {
  assets: GeneratedAsset[]
  libraryAssetCount?: number
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
  /** 双击卡片时以大图模式打开该素材（按当前结果前后浏览） */
  onOpenLightbox?: (assetId: string) => void
  /** 空格按住快速预览（Eagle 式） */
  onQuickPreview?: (assetId: string) => void
  /** 请求打开永久删除确认弹窗 */
  onPurgeRequest?: (assetIds: string[]) => void
  /** 以该素材为基准查找相似图片 */
  onFindSimilar?: (assetId: string) => void
  /**
   * 查询上下文签名（范围/搜索/筛选/排序）：变化时重置滚动到顶部（Eagle 式切换文件夹从顶部开始）；
   * assets 内容更新（批量操作、入库）不重置滚动，避免批量移动时图片跳动闪烁。
   */
  resetScrollKey?: string
}

/** 响应式虚拟瀑布流：只挂载视口与预加载区内的卡片，适配万级素材。 */
export default function AssetGrid({
  assets,
  hasMore = false,
  libraryAssetCount = assets.length,
  loadingMore = false,
  onLoadMore,
  onOpenLightbox,
  onQuickPreview,
  onPurgeRequest,
  onFindSimilar,
  resetScrollKey,
}: AssetGridProps) {
  const selectedAssetIds = useAssetLibraryStore((state) => state.selectedAssetIds)
  const toggleSelectAsset = useAssetLibraryStore((state) => state.toggleSelectAsset)
  const selectAsset = useAssetLibraryStore((state) => state.selectAsset)
  const clearSelection = useAssetLibraryStore((state) => state.clearSelection)
  const gridDensity = useAssetLibraryStore((state) => state.gridDensity)
  const scrollRef = useRef<HTMLDivElement>(null)
  const layoutRef = useRef<HTMLDivElement>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const suppressClickUntilRef = useRef(0)
  const [layoutWidth, setLayoutWidth] = useState(0)
  const [viewport, setViewport] = useState({ top: 0, height: 800 })
  const [menu, setMenu] = useState<{ x: number; y: number; asset: GeneratedAsset; assetIds?: string[] } | null>(null)

  const openLightbox = useCallback(
    (assetId: string) => {
      // Eagle 式：双击进入全屏查看器（按当前结果前后浏览）
      const assetIdList = assets.map((item) => item.id)
      const asset = assets.find((item) => item.id === assetId)
      if (!asset) return
      useAssetLibraryStore.getState().openViewer(asset.id, assetIdList)
    },
    [assets],
  )

  // Shift 范围选择的锚点：上次「替换/切换」点击或键盘导航的卡片
  const rangeAnchorRef = useRef<string | null>(null)
  // 拖拽中选区实时变化；handler 经 ref 读最新值，自身保持稳定引用，避免每帧击穿卡片 memo
  const selectedAssetIdsRef = useRef(selectedAssetIds)
  useEffect(() => {
    selectedAssetIdsRef.current = selectedAssetIds
  })

  const handleToggleSelect = useCallback(
    (assetId: string, mode: TileSelectMode) => {
      if (mode === 'replace') {
        rangeAnchorRef.current = assetId
        clearSelection()
        selectAsset(assetId)
        return
      }
      if (mode === 'toggle') {
        rangeAnchorRef.current = assetId
        toggleSelectAsset(assetId)
        return
      }
      // range：从锚点到目标按结果顺序连续选择（保留现有选区，Eagle 一致）
      const anchor = rangeAnchorRef.current
      const ordered = assets.map((asset) => asset.id)
      const from = anchor ? ordered.indexOf(anchor) : -1
      const to = ordered.indexOf(assetId)
      if (from === -1 || to === -1 || from === to) {
        toggleSelectAsset(assetId)
        return
      }
      const range = ordered.slice(Math.min(from, to), Math.max(from, to) + 1)
      useAssetLibraryStore.getState().replaceSelection(Array.from(new Set([...selectedAssetIdsRef.current, ...range])))
      rangeAnchorRef.current = assetId
    },
    [assets, clearSelection, selectAsset, toggleSelectAsset],
  )

  const selectRangeFromAnchor = useCallback(
    (targetAssetId: string, anchorAssetId: string | null) => {
      const ordered = assets.map((asset) => asset.id)
      const from = anchorAssetId ? ordered.indexOf(anchorAssetId) : -1
      const to = ordered.indexOf(targetAssetId)
      if (from === -1 || to === -1 || from === to) {
        useAssetLibraryStore.getState().replaceSelection([targetAssetId])
        return
      }
      const range = ordered.slice(Math.min(from, to), Math.max(from, to) + 1)
      useAssetLibraryStore.getState().replaceSelection(Array.from(new Set([...selectedAssetIdsRef.current, ...range])))
    },
    [assets],
  )

  const handleOpenMenu = useCallback((event: MouseEvent<HTMLDivElement>, asset: GeneratedAsset) => {
    // Eagle 式：右键未选中的卡片 → 以该卡片为唯一选中；右键选中的卡片 → 菜单作用于整个选区
    const selection = useAssetLibraryStore.getState().selectedAssetIds
    const included = selection.includes(asset.id)
    if (!included) useAssetLibraryStore.getState().replaceSelection([asset.id])
    setMenu({
      x: event.clientX,
      y: event.clientY,
      asset,
      assetIds: included && selection.length > 1 ? selection : [asset.id],
    })
  }, [])

  const measureGrid = useCallback((resetScroll = false) => {
    const layoutElement = layoutRef.current
    const scrollElement = scrollRef.current
    if (!layoutElement || !scrollElement) return

    const nextWidth = layoutElement.clientWidth
    const nextHeight = scrollElement.clientHeight
    if (nextWidth > 0) {
      setLayoutWidth((current) => (current === nextWidth ? current : nextWidth))
    }
    if (resetScroll) scrollElement.scrollTop = 0
    setViewport((current) => {
      const top = resetScroll ? 0 : scrollElement.scrollTop
      const height = nextHeight > 0 ? nextHeight : current.height
      return current.top === top && current.height === height ? current : { top, height }
    })
  }, [])

  useLayoutEffect(() => {
    const layoutElement = layoutRef.current
    const scrollElement = scrollRef.current
    if (!layoutElement || !scrollElement) return
    measureGrid()
    const observer = new ResizeObserver(() => measureGrid())
    observer.observe(layoutElement)
    observer.observe(scrollElement)
    return () => observer.disconnect()
  }, [measureGrid])

  // 兜底：窗口尺寸变化（含 Electron 最大化/缩放）强制重新测量列数与视口高度。
  // 首帧若为空状态（无 layoutRef/scrollRef），上面的主 effect 会提前返回，
  // ResizeObserver 从未建立——素材加载后窗口放大时布局宽度将永远停留在旧值
  // （表现为"放大全屏后图片仍按小窗口排列，只显示一半"）。此监听不依赖元素存在。
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleWindowResize = () => measureGrid()
    window.addEventListener('resize', handleWindowResize)
    return () => window.removeEventListener('resize', handleWindowResize)
  }, [measureGrid])

  // 查询上下文变化（切文件夹/搜索/筛选/排序）→ 重置滚动到顶部；
  // 仅 assets 内容更新（批量操作、入库）→ 重新测量但不重置滚动，避免批量移动时图片跳动闪烁。
  const resetScrollKeyRef = useRef(resetScrollKey)
  useLayoutEffect(() => {
    if (resetScrollKeyRef.current === resetScrollKey) return
    resetScrollKeyRef.current = resetScrollKey
    setMenu(null)
    measureGrid(true)
  }, [resetScrollKey, measureGrid])

  useLayoutEffect(() => {
    setMenu(null)
    measureGrid(false)
    const frame = requestAnimationFrame(() => measureGrid(false))
    return () => cancelAnimationFrame(frame)
  }, [assets, measureGrid])

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current)
    },
    [],
  )

  const layout = useMemo(
    () => buildAssetMasonryLayout(assets, layoutWidth, gridDensity),
    [assets, gridDensity, layoutWidth],
  )
  const selected = useMemo(() => new Set(selectedAssetIds), [selectedAssetIds])
  const visibleItems = useMemo(() => {
    const min = viewport.top - VIRTUAL_OVERSCAN
    const max = viewport.top + viewport.height + VIRTUAL_OVERSCAN
    return layout.items.filter((item) => item.top + item.height >= min && item.top <= max)
  }, [layout.items, viewport])

  // 数学命中：虚拟布局数据已知（top/left/width/height），框选拖拽每帧零强制布局。
  // 只测已挂载（可见 + 预取）的卡片，与 DOM 命中语义一致；布局层矩形随滚动自动校正。
  const hitTest = useCallback(
    (box: { minX: number; minY: number; maxX: number; maxY: number }): string[] => {
      const layoutElement = layoutRef.current
      if (!layoutElement) return []
      const rect = layoutElement.getBoundingClientRect()
      const minX = box.minX - rect.left
      const maxX = box.maxX - rect.left
      const minY = box.minY - rect.top
      const maxY = box.maxY - rect.top
      const result: string[] = []
      for (const item of visibleItems) {
        if (item.left < maxX && item.left + item.width > minX && item.top < maxY && item.top + item.height > minY) {
          result.push(item.asset.id)
        }
      }
      return result
    },
    [visibleItems],
  )

  const { selectionBox } = useDragSelect({
    containerSelector: '[data-drag-select-surface]',
    containerRef: scrollRef,
    itemSelector: '[data-asset-card]',
    getItemId: (element) => (element instanceof HTMLElement ? (element.dataset.assetId ?? null) : null),
    hitTest,
    onSelectionChange: (ids) => useAssetLibraryStore.getState().replaceSelection(ids),
    initialSelectedIds: selectedAssetIds,
    onSuppressClick: () => {
      suppressClickUntilRef.current = Date.now() + 250
    },
  })

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const element = event.currentTarget
      if (hasMore && !loadingMore && element.scrollHeight - element.scrollTop - element.clientHeight < 1200)
        onLoadMore?.()
      if (scrollFrameRef.current !== null) return
      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = null
        markScrollActivity()
        setViewport({ top: element.scrollTop, height: element.clientHeight })
      })
    },
    [hasMore, loadingMore, onLoadMore],
  )

  // 键盘方向键导航：←/→ 相邻卡片，↑/↓ 换行（按当前列数），Home/End 首尾；
  // Shift + 方向键 = 从锚点连续扩展选区（Eagle 式）
  const handleGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (visibleItems.length === 0) return
    const current = document.activeElement
    const currentIndex = visibleItems.findIndex(
      (item) => current instanceof HTMLElement && item.asset.id === current.dataset.assetId,
    )
    if (currentIndex < 0) {
      if (['ArrowRight', 'ArrowDown', 'Home'].includes(event.key)) {
        event.preventDefault()
        const first = visibleItems[0]
        if (first) focusAssetCard(first.asset.id)
      }
      return
    }
    const columns = Math.max(1, layout.columns)
    let next: number
    if (event.key === 'ArrowRight') next = Math.min(visibleItems.length - 1, currentIndex + 1)
    else if (event.key === 'ArrowLeft') next = Math.max(0, currentIndex - 1)
    else if (event.key === 'ArrowDown') next = Math.min(visibleItems.length - 1, currentIndex + columns)
    else if (event.key === 'ArrowUp') next = Math.max(0, currentIndex - columns)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = visibleItems.length - 1
    else return
    event.preventDefault()
    const target = visibleItems[next]
    if (!target) return
    if (event.shiftKey) {
      const anchorId =
        rangeAnchorRef.current ?? (current instanceof HTMLElement ? (current.dataset.assetId ?? null) : null)
      selectRangeFromAnchor(target.asset.id, anchorId)
    } else {
      rangeAnchorRef.current = target.asset.id
    }
    focusAssetCard(target.asset.id)
  }

  // 从系统拖入图片文件 → 导入为素材
  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
  }
  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith('image/'))
    if (files.length === 0) return
    event.preventDefault()
    void useAssetLibraryStore.getState().importExternalFiles(files)
  }

  if (assets.length === 0) {
    const libraryEmpty = libraryAssetCount === 0
    return (
      <div data-testid="asset-grid-empty" className="flex min-h-0 flex-1 items-center justify-center py-10 sm:py-24">
        <EmptyState
          icon={<ImageIcon size={22} />}
          title={libraryEmpty ? '还没有生成素材' : '没有匹配的素材'}
          description={
            libraryEmpty ? '完成图片生成后，素材会自动收录到这里。' : '尝试清空搜索词、筛选条件，或切换左侧范围。'
          }
        />
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      data-testid="asset-grid"
      data-drag-select-surface
      className="custom-scrollbar relative min-h-0 flex-1 overflow-y-auto [overflow-anchor:none]"
      onClick={(event) => {
        // 框选拖拽刚结束的点击会落在容器上（mousedown/up 目标不同），此时不应当清空选区
        if (Date.now() < suppressClickUntilRef.current) return
        clearSelection()
      }}
      onScroll={handleScroll}
      onKeyDown={handleGridKeyDown}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* 内容间距层：左右留白统一 32px（滚动条在最右边缘，不挤占右侧内容间距）；
          底部留白跟随输入框高度（--input-bar-clearance），保证最后一行图片不被悬浮输入框遮挡、可完整点击 */}
      <div className="px-8 pb-[var(--input-bar-clearance,12rem)]">
        <div
          ref={layoutRef}
          data-testid="asset-grid-layout"
          className="relative w-full"
          style={{ height: layout.height }}
        >
          {visibleItems.map(({ asset, style }) => (
            <MemoizedAssetCard
              key={asset.id}
              asset={asset}
              selected={selected.has(asset.id)}
              loadFullOnHover={libraryAssetCount <= HOVER_FULL_IMAGE_LIMIT}
              style={style}
              suppressClickUntilRef={suppressClickUntilRef}
              onToggleSelect={handleToggleSelect}
              onOpenLightbox={openLightbox}
              onQuickPreview={(assetId) => useAssetLibraryStore.getState().setQuickPreviewAsset(assetId)}
              onOpenMenu={handleOpenMenu}
            />
          ))}
        </div>
      </div>
      {selectionBox && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-10 rounded-sm border border-ds-selection-border bg-ds-selection/60"
          style={getMarqueeBoxStyle(selectionBox, scrollRef.current)}
        />
      )}
      <div
        role="status"
        aria-hidden={!loadingMore}
        className="flex h-10 items-center justify-center text-xs text-ds-muted"
      >
        {loadingMore ? '正在加载更多素材…' : ''}
      </div>
      {menu && (
        <AssetCardMenu
          x={menu.x}
          y={menu.y}
          asset={menu.asset}
          assetIds={menu.assetIds}
          assetIdList={assets.map((asset) => asset.id)}
          onPurgeRequest={onPurgeRequest}
          onFindSimilar={onFindSimilar}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
