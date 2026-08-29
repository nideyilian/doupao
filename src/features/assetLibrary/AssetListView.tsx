import { memo, useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import { EmptyState } from '../../design-system'
import { ImageIcon, StarIcon } from '../../design-system/icons'
import { ensureImageThumbnailCached, getCachedThumbnail, subscribeImageThumbnail } from '../../store'
import { markScrollActivity } from '../../lib/scrollActivity'
import type { GeneratedAsset } from '../../types'
import { useAssetLibraryStore } from './store'
import AssetCardMenu from './AssetCardMenu'
import { getColorLabelHex } from './colorLabels'
import { useDragSelect, getMarqueeBoxStyle } from '../../hooks/useDragSelect'
import { startAssetDrag, type TileSelectMode } from './AssetTile'

const ROW_HEIGHT = 64
const OVERSCAN_ROWS = 8

function ListRowThumbnail({ imageId }: { imageId: string }) {
  const [src, setSrc] = useState(() => getCachedThumbnail(imageId)?.dataUrl ?? '')
  useEffect(() => {
    let active = true
    const apply = (thumbnail: { dataUrl: string }) => {
      if (active) setSrc(thumbnail.dataUrl)
    }
    const unsubscribe = subscribeImageThumbnail(imageId, apply)
    void ensureImageThumbnailCached(imageId).then((thumbnail) => {
      if (thumbnail) apply(thumbnail)
    })
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [imageId])
  return (
    <div className="h-ds-12 w-ds-12 shrink-0 overflow-hidden rounded-md border border-ds-border bg-ds-muted/20">
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-ds-muted">
          <ImageIcon size={15} />
        </div>
      )}
    </div>
  )
}

export interface AssetListViewProps {
  assets: GeneratedAsset[]
  libraryAssetCount?: number
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
  onOpenViewer?: (assetId: string) => void
  onQuickPreview?: (assetId: string) => void
  onPurgeRequest?: (assetIds: string[]) => void
  onFindSimilar?: (assetId: string) => void
}

export interface AssetListRowProps {
  asset: GeneratedAsset
  selected: boolean
  /** 签名自带 assetId，父组件可传稳定引用（useCallback），让重渲染不击穿行组件 */
  onToggleSelect: (assetId: string, mode: TileSelectMode) => void
  onOpenViewer: (assetId: string) => void
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>, asset: GeneratedAsset) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>, asset: GeneratedAsset) => void
}

/** Eagle 式列表行（网格/列表/分组列表共用）：固定行高，定位由父级容器决定。 */
export const AssetListRow = memo(function AssetListRow({
  asset,
  selected,
  onToggleSelect,
  onOpenViewer,
  onContextMenu,
  onKeyDown,
}: AssetListRowProps) {
  const origin = asset.origins.find((item) => item.key === asset.primaryOriginKey) ?? asset.origins[0]
  return (
    <div
      role="row"
      aria-selected={selected}
      data-asset-id={asset.id}
      tabIndex={0}
      draggable
      title="长按左键拖到左侧项目/标签归档，或拖到输入框作为参考图"
      onDragStart={(event) => startAssetDrag(event, asset)}
      onClick={(event) => {
        event.stopPropagation()
        // 框选 hook 的 mousedown 会 preventDefault 阻止默认聚焦；显式聚焦让空格/Enter 生效
        event.currentTarget.focus({ preventScroll: true })
        if (event.shiftKey) onToggleSelect(asset.id, 'range')
        else if (event.ctrlKey || event.metaKey) onToggleSelect(asset.id, 'toggle')
        else onToggleSelect(asset.id, 'replace')
      }}
      onDoubleClick={() => onOpenViewer(asset.id)}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onContextMenu(event, asset)
      }}
      onKeyDown={(event) => onKeyDown(event, asset)}
      onPointerEnter={() => useAssetLibraryStore.getState().setHoveredAssetId(asset.id)}
      onPointerLeave={() => {
        const state = useAssetLibraryStore.getState()
        if (state.hoveredAssetId === asset.id) state.setHoveredAssetId(null)
      }}
      className={`flex h-ds-16 cursor-pointer items-center gap-2 border-b border-ds-border/50 px-0 outline-none hover:bg-ds-muted/10 focus-visible:bg-ds-muted/10 ${selected ? 'bg-ds-primary/10' : ''}`}
    >
      <div className="relative w-14 shrink-0">
        <ListRowThumbnail imageId={asset.imageId} />
        {asset.colorLabel && (
          <span
            aria-hidden="true"
            className="absolute left-1 top-1 h-2.5 w-2.5 rounded-full border border-white/40"
            style={{ backgroundColor: getColorLabelHex(asset.colorLabel) }}
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs">{origin?.prompt || asset.id}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ds-muted">
          {asset.favorite && <StarIcon size={10} fill="currentColor" className="text-ds-warning" />}
          {asset.origins.length > 1 && <span>{asset.origins.length} 来源</span>}
          {asset.status === 'trashed' && <span className="text-ds-danger">回收站</span>}
        </p>
      </div>
      <span className="hidden w-28 shrink-0 tabular-nums text-ds-muted sm:block">
        {asset.width && asset.height ? `${asset.width} × ${asset.height}` : '—'}
      </span>
      <span className="hidden w-32 shrink-0 truncate text-ds-muted md:block">{origin?.apiModel ?? '—'}</span>
      <span className="w-16 shrink-0 text-center tabular-nums">{asset.rating > 0 ? `★${asset.rating}` : '—'}</span>
      <span className="hidden w-28 shrink-0 tabular-nums text-ds-muted md:block">
        {new Date(asset.createdAt).toLocaleDateString()}
      </span>
    </div>
  )
})

/** Eagle 式列表视图：固定行高的绝对定位虚拟列表。 */
function AssetListView({
  assets,
  hasMore = false,
  libraryAssetCount = assets.length,
  loadingMore = false,
  onLoadMore,
  onOpenViewer,
  onQuickPreview,
  onPurgeRequest,
  onFindSimilar,
}: AssetListViewProps) {
  const selectedAssetIds = useAssetLibraryStore((state) => state.selectedAssetIds)
  const toggleSelectAsset = useAssetLibraryStore((state) => state.toggleSelectAsset)
  const selectAsset = useAssetLibraryStore((state) => state.selectAsset)
  const clearSelection = useAssetLibraryStore((state) => state.clearSelection)
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const suppressClickUntilRef = useRef(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)
  const [menu, setMenu] = useState<{ x: number; y: number; asset: GeneratedAsset; assetIds?: string[] } | null>(null)

  const selected = useMemo(() => new Set(selectedAssetIds), [selectedAssetIds])

  // 框选（列表视图也支持，与网格一致：自动滚动 / Esc 取消 / Shift 加选）
  const { selectionBox } = useDragSelect({
    containerSelector: '[data-drag-select-surface]',
    containerRef: scrollRef,
    itemSelector: '[data-asset-id]',
    getItemId: (element) => (element instanceof HTMLElement ? (element.dataset.assetId ?? null) : null),
    onSelectionChange: (ids) => useAssetLibraryStore.getState().replaceSelection(ids),
    initialSelectedIds: selectedAssetIds,
    onSuppressClick: () => {
      suppressClickUntilRef.current = Date.now() + 250
    },
  })
  const rangeAnchorRef = useRef<string | null>(null)
  // 拖拽中选区实时变化；handler 经 ref 读最新值，自身保持稳定引用
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
      // range：从锚点按结果顺序连续选择（保留现有选区）
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

  const handleOpenMenu = useCallback((event: React.MouseEvent<HTMLDivElement>, asset: GeneratedAsset) => {
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

  const handleRowKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, asset: GeneratedAsset) => {
      // 按住空格/Enter 的 key repeat 不重复触发（预览/查看器已在首次触发）
      if (event.repeat) return
      // Eagle 式：空格 = 按住快速预览；Enter = 打开查看器（多选用 Ctrl/⌘ 点击）
      if (event.key === ' ') {
        event.preventDefault()
        event.stopPropagation()
        onQuickPreview?.(asset.id)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        onOpenViewer?.(asset.id)
      }
    },
    [onOpenViewer, onQuickPreview],
  )

  // 以下回调保持稳定引用（useCallback），让 memo 行在滚动帧中不被回调身份击穿
  const openViewer = useCallback((assetId: string) => onOpenViewer?.(assetId), [onOpenViewer])
  const handleToggleSelectRow = useCallback(
    (assetId: string, mode: TileSelectMode) => {
      // 框选拖拽刚结束时抑制紧随的点击，避免误切换选择
      if (Date.now() < suppressClickUntilRef.current) return
      handleToggleSelect(assetId, mode)
    },
    [handleToggleSelect],
  )

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS)
  const end = Math.min(assets.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN_ROWS)
  const visible = assets.slice(start, end)

  const measure = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    setViewportHeight(element.clientHeight)
  }, [])

  useEffect(() => {
    measure()
    const observer = new ResizeObserver(() => measure())
    const element = scrollRef.current
    if (element) observer.observe(element)
    return () => observer.disconnect()
  }, [measure])

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current)
    },
    [],
  )

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget
    if (hasMore && !loadingMore && element.scrollHeight - element.scrollTop - element.clientHeight < 600) onLoadMore?.()
    if (scrollFrameRef.current !== null) return
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null
      markScrollActivity()
      setScrollTop(element.scrollTop)
      setViewportHeight(element.clientHeight)
    })
  }

  if (assets.length === 0) {
    return (
      <div data-testid="asset-list-empty" className="flex min-h-0 flex-1 items-center justify-center py-10 sm:py-24">
        <EmptyState
          icon={<ImageIcon size={22} />}
          title={libraryAssetCount === 0 ? '还没有生成素材' : '没有匹配的素材'}
          description={
            libraryAssetCount === 0
              ? '完成图片生成后，素材会自动收录到这里。'
              : '尝试清空搜索词、筛选条件，或切换左侧范围。'
          }
        />
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      data-testid="asset-list"
      data-drag-select-surface
      className="custom-scrollbar relative min-h-0 flex-1 overflow-y-auto [overflow-anchor:none]"
      onClick={(event) => {
        // 框选拖拽刚结束的点击会落在容器上（mousedown/up 目标不同），此时不应当清空选区
        if (Date.now() < suppressClickUntilRef.current) return
        clearSelection()
      }}
      onScroll={handleScroll}
    >
      {/* 列头：全宽 sticky，内容与下方行区对齐（32px） */}
      <div className="sticky top-0 z-10 flex h-ds-control-md items-center border-b border-ds-border bg-ds-surface px-8 text-xs text-ds-muted">
        <span className="w-14 shrink-0">预览</span>
        <span className="min-w-0 flex-1 truncate">提示词</span>
        <span className="hidden w-28 shrink-0 sm:block">尺寸</span>
        <span className="hidden w-32 shrink-0 md:block">模型</span>
        <span className="w-16 shrink-0 text-center">评分</span>
        <span className="hidden w-28 shrink-0 md:block">生成时间</span>
      </div>
      {/* 内容间距层：左右留白统一 32px（滚动条在最右边缘，不挤占右侧内容间距）；
          底部留白跟随输入框高度（--input-bar-clearance），保证最后一行图片不被悬浮输入框遮挡、可完整点击 */}
      <div className="px-8 pb-[var(--input-bar-clearance,12rem)]">
        <div className="relative" style={{ height: assets.length * ROW_HEIGHT }}>
          {visible.map((asset, rowIndex) => {
            // 用切片下标直接推导全局下标，避免每帧对全部素材做 indexOf（万级素材下是明显开销）
            const index = start + rowIndex
            const isSelected = selected.has(asset.id)
            return (
              <div key={asset.id} className="absolute left-0 right-0" style={{ top: index * ROW_HEIGHT }}>
                <AssetListRow
                  asset={asset}
                  selected={isSelected}
                  onToggleSelect={handleToggleSelectRow}
                  onOpenViewer={openViewer}
                  onContextMenu={handleOpenMenu}
                  onKeyDown={handleRowKeyDown}
                />
              </div>
            )
          })}
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

export default memo(AssetListView)
