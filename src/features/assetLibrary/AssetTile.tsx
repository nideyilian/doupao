import { memo, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import type { GeneratedAsset } from '../../types'
import { ensureImageCached, ensureImageThumbnailCached, getCachedThumbnail, subscribeImageThumbnail } from '../../store'
import { decodeImageDataUrl } from '../../lib/imageHover'
import { isScrollActive } from '../../lib/scrollActivity'
import { CheckIcon, ImageIcon, StarIcon } from '../../design-system/icons'
import { cx } from '../../design-system/components'
import { useAssetLibraryStore } from './store'
import { ASSET_SOURCE_DATA_TYPE } from '../../lib/assetSidebarUtils'
import { COLOR_LABELS } from './colorLabels'

export type TileSelectMode = 'replace' | 'toggle' | 'range'

export interface AssetTileProps {
  asset: GeneratedAsset
  selected: boolean
  /** 布局容器传入的定位样式（绝对定位网格 / CSS 网格单元均可） */
  style?: CSSProperties
  className?: string
  /** 点击选择语义：无修饰键 = 替换；Ctrl/⌘ = 切换；Shift = 从锚点范围选择。
   *  签名自带 assetId，父组件可传稳定引用（useCallback），让 memo 在拖拽中不被回调引用击穿。 */
  onToggleSelect: (assetId: string, mode: TileSelectMode) => void
  onOpenViewer: (assetId: string) => void
  /** 空格按住快速预览（Eagle 式） */
  onQuickPreview?: (assetId: string) => void
  onOpenMenu: (event: MouseEvent<HTMLDivElement>, asset: GeneratedAsset) => void
  /** 框选拖拽结束后抑制紧接着的点击事件 */
  suppressClickUntilRef: React.MutableRefObject<number>
  /** 大图库（如上万张）时置为 false：hover 只保留缩略图，不再解码原图。 */
  loadFullOnHover?: boolean
}

/**
 * 图片砖：图片/列表/分组三种展现方式共用的单张素材卡片。
 *
 * 只负责一张素材的视觉与交互（缩略图 + hover 原图、选择、查看器、右键菜单、
 * 颜色标签角标），不负责布局定位——定位由父级容器决定。
 */
/**
 * 启动素材拖拽（Eagle 式：直接长按左键拖卡片）：
 * 拖到输入栏/其他素材软件携带图片内容哈希 id；多选时把整个选区一起带走（归档作用于全部选中）。
 * 允许复制与移动两种效果：拖到侧栏文件夹 = 移动（剪切，移除源文件夹归属），拖到输入框作参考图 = 复制，
 * 由 drop 目标的 dropEffect 决定；从文件夹 scope 拖出时把源文件夹 id 写入负载供 drop 端执行移动。
 */
export function startAssetDrag(event: React.DragEvent<HTMLElement>, asset: GeneratedAsset) {
  event.dataTransfer.setData('text/plain', `asset-image:${asset.imageId}`)
  event.dataTransfer.effectAllowed = 'copyMove'
  const selection = useAssetLibraryStore.getState().selectedAssetIds
  if (selection.includes(asset.id) && selection.length > 1) {
    event.dataTransfer.setData('application/x-doupao-asset-ids', JSON.stringify(selection))
  }
  const scope = useAssetLibraryStore.getState().scope
  if (typeof scope === 'object' && scope.kind === 'collection') {
    event.dataTransfer.setData(ASSET_SOURCE_DATA_TYPE, scope.id)
  }
}

function AssetTile({
  asset,
  selected,
  style,
  className,
  onToggleSelect,
  onOpenViewer,
  onQuickPreview,
  onOpenMenu,
  suppressClickUntilRef,
  loadFullOnHover = true,
}: AssetTileProps) {
  const [thumbnailSrc, setThumbnailSrc] = useState(() => getCachedThumbnail(asset.imageId)?.dataUrl ?? '')
  const [fullSrc, setFullSrc] = useState('')
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoveredRef = useRef(false)
  const hoverLoadVersionRef = useRef(0)
  const loadedImageIdRef = useRef(asset.imageId)

  useEffect(() => {
    let cancelled = false
    const applyThumbnail = (thumbnail: { dataUrl: string }) => {
      if (!cancelled) setThumbnailSrc(thumbnail.dataUrl)
    }
    // 仅当 imageId 变化时复位；挂载时保留 useState 同步读取的缓存值，避免先闪占位再加载
    if (loadedImageIdRef.current !== asset.imageId) {
      loadedImageIdRef.current = asset.imageId
      setThumbnailSrc(getCachedThumbnail(asset.imageId)?.dataUrl ?? '')
    }
    const unsubscribe = subscribeImageThumbnail(asset.imageId, applyThumbnail)
    ensureImageThumbnailCached(asset.imageId)
      .then((thumbnail) => {
        if (thumbnail) applyThumbnail(thumbnail)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [asset.imageId])

  useEffect(
    () => () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    },
    [],
  )

  // hover 防抖加载全图预览（沿用任务视角模式；离开立即取消并作废在途加载）。
  // 滚动中指针会连续扫过卡片：若滚动未停就加载/解码 2K/4K 原图，主线程会被连续
  // 大图解码阻塞造成卡顿，因此滚动期间把加载推迟到滚动停止后再执行。
  const handlePointerEnter = () => {
    // 记录悬停素材：按空格直接预览该素材（Eagle 式，无需先点选）
    useAssetLibraryStore.getState().setHoveredAssetId(asset.id)
    // 框选拖拽中禁止 hover 原图加载：鼠标扫过卡片会不断触发缩略图↔原图切换与离屏解码，造成图片闪烁/卡顿
    if (document.body.classList.contains('drag-selecting')) return
    if (!loadFullOnHover) return
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoveredRef.current = true
    hoverTimerRef.current = setTimeout(function scheduleHoverFullLoad() {
      hoverTimerRef.current = null
      // 定时器触发时若正处于框选拖拽（进入后 350ms 内开始拖拽），跳过加载避免拖拽中换图闪烁
      if (!hoveredRef.current || document.body.classList.contains('drag-selecting')) return
      if (isScrollActive()) {
        // 仍在滚动：稍后再试，直到滚动停止（避免滚动全程反复解码原图）
        hoverTimerRef.current = setTimeout(scheduleHoverFullLoad, 150)
        return
      }
      const version = ++hoverLoadVersionRef.current
      void ensureImageCached(asset.imageId)
        .then(async (dataUrl) => {
          if (!dataUrl || version !== hoverLoadVersionRef.current || !hoveredRef.current) return
          // 离屏解码完成后再换 src，杜绝解码期间的空白闪烁。
          await decodeImageDataUrl(dataUrl)
          if (version !== hoverLoadVersionRef.current || !hoveredRef.current) return
          setFullSrc(dataUrl)
        })
        .catch(() => {})
    }, 350)
  }
  const handlePointerLeave = () => {
    const state = useAssetLibraryStore.getState()
    if (state.hoveredAssetId === asset.id) state.setHoveredAssetId(null)
    hoveredRef.current = false
    hoverLoadVersionRef.current++
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    setFullSrc('')
  }

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (Date.now() < suppressClickUntilRef.current) return
    // 框选 hook 的 mousedown 会 preventDefault 阻止默认聚焦；这里显式聚焦，
    // 保证点选后按空格 / Enter 能触发卡片的键盘打开查看器（Eagle 式预览）
    event.currentTarget.focus({ preventScroll: true })
    if (event.shiftKey) onToggleSelect(asset.id, 'range')
    else if (event.ctrlKey || event.metaKey) onToggleSelect(asset.id, 'toggle')
    else onToggleSelect(asset.id, 'replace')
  }
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // 按住空格/Enter 的 key repeat 不重复触发（预览/查看器已在首次触发）
    if (event.repeat) return
    // Eagle 式：空格 = 按住快速预览（松开关闭）；Enter = 打开查看器
    if (event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      onQuickPreview?.(asset.id)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      onOpenViewer(asset.id)
    }
  }

  const handleDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (Date.now() < suppressClickUntilRef.current) return
    onOpenViewer(asset.id)
  }

  const imageSrc = fullSrc || thumbnailSrc

  return (
    <div
      data-asset-card
      data-asset-id={asset.id}
      data-testid="asset-card"
      role="button"
      tabIndex={0}
      draggable
      aria-pressed={selected}
      aria-label={asset.origins[0]?.prompt || `素材 ${asset.id}`}
      title="长按左键拖到左侧项目/标签归档，或拖到输入框作为参考图"
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onDragStart={(event) => startAssetDrag(event, asset)}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onOpenMenu(event, asset)
      }}
      onKeyDown={handleKeyDown}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      style={style}
      className={cx(
        'group cursor-pointer overflow-hidden rounded-lg border bg-ds-surface transition',
        selected ? 'border-ds-primary ring-2 ring-ds-focus/40' : 'border-ds-border hover:border-ds-muted',
        className,
      )}
    >
      {imageSrc ? (
        <img
          data-image-id={asset.imageId}
          src={imageSrc}
          alt={asset.origins[0]?.prompt || ''}
          loading="lazy"
          decoding="async"
          className="block h-full w-full select-none object-cover"
          draggable={false}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-ds-muted/30">
          <ImageIcon size={22} className="text-ds-muted" />
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/50 to-transparent p-2 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
        <span className="flex items-center gap-1 text-xs text-white">
          {asset.favorite && <StarIcon size={13} fill="currentColor" />}
          {asset.rating > 0 && <span className="tabular-nums">★{asset.rating}</span>}
        </span>
        <span className="text-xs tabular-nums text-white/80">{asset.origins.length} 个来源</span>
      </div>
      {selected && (
        <div className="absolute right-2 top-2 rounded-full bg-ds-primary p-1 text-ds-text-inverse">
          <CheckIcon size={12} />
        </div>
      )}
      {/* 颜色标签角标（常驻） */}
      {asset.colorLabel && (
        <span
          aria-hidden="true"
          className="absolute left-1.5 top-1.5 h-3 w-3 rounded-full border border-white/40"
          style={{ backgroundColor: COLOR_LABELS.find((item) => item.value === asset.colorLabel)?.color }}
        />
      )}
    </div>
  )
}

export default memo(AssetTile)
