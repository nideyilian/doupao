import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  ImagePlusIcon,
  StarIcon,
  TrashIcon,
  Wand2Icon,
  WrenchIcon,
  XIcon,
} from '../../design-system/icons'
import { ensureImageCached, ensureImageThumbnailCached, subscribeImageThumbnail, useStore } from '../../store'
import { copyImageSourceToClipboard, getClipboardFailureMessage } from '../../lib/clipboard'
import { assetCommands } from '../../lib/assetCommands'
import { cycleColorLabel } from '../../lib/assetLibraryModel'
import type { AssetColorLabel, AssetRating, GeneratedAsset } from '../../types'
import { useAssetLibraryStore } from './store'
import AssetParamBreakdown from './AssetParamBreakdown'
import { DerivedChain, NotesEditor } from './AssetDetailPanel'
import { COLOR_LABELS_WITH_NAMES } from './colorLabels'

const MIN_SCALE = 1
const MAX_SCALE = 8

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

/** Eagle 式全屏查看器：大图缩放/拖拽 + 前后导航 + 右信息面板 + 底部类似图。 */
function AssetViewerInner() {
  const viewerAssetId = useAssetLibraryStore((state) => state.viewerAssetId)
  const viewerAssetIds = useAssetLibraryStore((state) => state.viewerAssetIds)
  const assetsById = useAssetLibraryStore((state) => state.assetsById)
  const patchAssets = useAssetLibraryStore((state) => state.patchAssets)
  const closeViewer = useAssetLibraryStore((state) => state.closeViewer)
  const setViewerAsset = useAssetLibraryStore((state) => state.setViewerAsset)

  const asset = viewerAssetId ? assetsById[viewerAssetId] : undefined
  const [src, setSrc] = useState('')
  const [similarAssets, setSimilarAssets] = useState<GeneratedAsset[]>([])
  const [infoOpen, setInfoOpen] = useState(true)
  const [showToast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const scaleRef = useRef(1)
  const txRef = useRef(0)
  const tyRef = useRef(0)
  const dragRef = useRef({ active: false, startX: 0, startY: 0, baseTx: 0, baseTy: 0 })
  const [, forceRender] = useState(0)
  const rerender = useCallback(() => forceRender((n) => n + 1), [])

  // 打开后立即把焦点拉进查看器：否则焦点停留在背后卡片上，空格/Esc 会被卡片 keydown
  // 拦截（stopPropagation 挡掉 window 冒泡监听），表现为「要先点击查看器内其他地方才生效」。
  // 关闭时把焦点还给打开前的元素，保证「空格开、空格关、再空格开」连续可用。
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    containerRef.current?.focus({ preventScroll: true })
    return () => {
      previous?.focus({ preventScroll: true })
    }
  }, [])

  const toast = (message: string, tone: 'success' | 'error' = 'success') => {
    setToast({ message, tone })
    window.setTimeout(() => setToast(null), 2000)
  }

  // 图片加载 + 重置变换
  useEffect(() => {
    if (!asset) {
      setSrc('')
      return
    }
    let cancelled = false
    setSrc('')
    scaleRef.current = 1
    txRef.current = 0
    tyRef.current = 0
    ensureImageCached(asset.imageId)
      .then((dataUrl) => {
        if (!cancelled && dataUrl) setSrc(dataUrl)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [asset, asset?.imageId])

  // 类似图 strip
  useEffect(() => {
    if (!asset) {
      setSimilarAssets([])
      return
    }
    let active = true
    setSimilarAssets([])
    void assetCommands
      .recommend({ similarToAssetId: asset.id, limit: 12 })
      .then((items) => {
        if (!active) setSimilarAssets(items.map((item) => item.asset))
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [asset, asset?.id])

  const currentIndex = viewerAssetId ? viewerAssetIds.indexOf(viewerAssetId) : -1
  const total = viewerAssetIds.length
  const navigate = useCallback(
    (delta: number) => {
      if (viewerAssetIds.length === 0) return
      const next = (((currentIndex + delta) % viewerAssetIds.length) + viewerAssetIds.length) % viewerAssetIds.length
      const id = viewerAssetIds[next]
      if (id) setViewerAsset(id)
    },
    [currentIndex, setViewerAsset, viewerAssetIds],
  )

  // 键盘：Esc/空格 关闭、←/→ 导航、1-5/0 评分、F 收藏、C 轮换颜色（Eagle 式）。
  // capture 阶段拦截：查看器打开后（含图片加载中、焦点仍在背后卡片时）空格/Esc 立即生效，
  // 不会被卡片的 keydown（打开查看器）抢先。
  useEffect(() => {
    if (!viewerAssetId) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === ' ') {
        event.preventDefault()
        event.stopImmediatePropagation()
        closeViewer()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        navigate(-1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        navigate(1)
      } else if (event.key >= '1' && event.key <= '5') {
        void patchAssets([viewerAssetId], { rating: Number(event.key) as AssetRating }).catch(() =>
          useStore.getState().showToast('操作失败', 'error'),
        )
      } else if (event.key === '0') {
        void patchAssets([viewerAssetId], { rating: 0 }).catch(() => useStore.getState().showToast('操作失败', 'error'))
      } else if (event.key.toLocaleLowerCase() === 'f') {
        const current = assetsById[viewerAssetId]
        if (current)
          void patchAssets([viewerAssetId], { favorite: !current.favorite }).catch(() =>
            useStore.getState().showToast('操作失败', 'error'),
          )
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'c') {
        // Ctrl/Cmd+C：复制素材（须在普通 'c'（循环颜色）之前判断，否则永远不可达）
        event.preventDefault()
        useAssetLibraryStore.getState().copyAssets([viewerAssetId])
        useStore.getState().showToast('已复制素材', 'success')
      } else if (event.key.toLocaleLowerCase() === 'c') {
        const current = assetsById[viewerAssetId]
        if (current)
          void patchAssets([viewerAssetId], { colorLabel: cycleColorLabel(current.colorLabel) }).catch(() =>
            useStore.getState().showToast('操作失败', 'error'),
          )
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [assetsById, closeViewer, navigate, patchAssets, viewerAssetId])

  // 滚轮缩放 + 拖拽平移
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      const mx = event.clientX - rect.left - rect.width / 2
      const my = event.clientY - rect.top - rect.height / 2
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15
      const next = clamp(scaleRef.current * factor, MIN_SCALE, MAX_SCALE)
      const ratio = next / scaleRef.current
      scaleRef.current = next
      if (next <= 1) {
        txRef.current = 0
        tyRef.current = 0
      } else {
        txRef.current = mx - ratio * (mx - txRef.current)
        tyRef.current = my - ratio * (my - tyRef.current)
      }
      rerender()
    }
    const onDown = (event: MouseEvent) => {
      if (event.button !== 0 || scaleRef.current <= 1) return
      event.preventDefault()
      dragRef.current = {
        active: true,
        startX: event.clientX,
        startY: event.clientY,
        baseTx: txRef.current,
        baseTy: tyRef.current,
      }
    }
    const onMove = (event: MouseEvent) => {
      const drag = dragRef.current
      if (!drag.active) return
      txRef.current = drag.baseTx + (event.clientX - drag.startX)
      tyRef.current = drag.baseTy + (event.clientY - drag.startY)
      rerender()
    }
    const onUp = () => {
      dragRef.current.active = false
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [rerender])

  if (!viewerAssetId || !asset) return null

  const primaryOrigin = asset.origins.find((origin) => origin.key === asset.primaryOriginKey) ?? asset.origins[0]
  const s = scaleRef.current
  const isZoomed = s > 1

  const setColorLabel = (label: AssetColorLabel | null) => {
    void patchAssets([asset.id], { colorLabel: label }).catch(() => useStore.getState().showToast('操作失败', 'error'))
  }
  const copyImage = async () => {
    try {
      await copyImageSourceToClipboard(src || (await ensureImageCached(asset.imageId)) || '')
      toast('图片已复制')
    } catch (error) {
      toast(getClipboardFailureMessage('复制失败', error), 'error')
    }
  }
  const openDetail = () => {
    useAssetLibraryStore.getState().setActiveAsset(asset.id)
    useAssetLibraryStore.getState().setDetailOpen(true)
    closeViewer()
  }

  const actionButtonClass =
    'flex min-h-ds-control-lg min-w-11 items-center justify-center rounded-md text-ds-muted outline-none hover:bg-ds-surface/10 hover:text-white focus-visible:ring-2 focus-visible:ring-ds-focus/70'

  return (
    <div
      ref={containerRef}
      data-testid="asset-viewer"
      role="dialog"
      aria-modal="true"
      aria-label="素材查看器"
      tabIndex={-1}
      className="fixed inset-0 z-modal flex bg-black/95"
    >
      {/* 主图区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-ds-12 shrink-0 items-center justify-between gap-3 px-3">
          <div className="min-w-0 flex-1 truncate text-sm text-white/90">
            {primaryOrigin?.prompt || `素材 ${asset.id}`}
            {total > 1 && (
              <span className="ml-2 text-xs tabular-nums text-white/50">
                {currentIndex + 1} / {total}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" className={actionButtonClass} aria-label="查看详情" onClick={openDetail}>
              <EyeIcon size={16} />
            </button>
            <button type="button" className={actionButtonClass} aria-label="复制图片" onClick={() => void copyImage()}>
              <CopyIcon size={16} />
            </button>
            <button
              type="button"
              className={actionButtonClass}
              aria-label="导出原图"
              onClick={() =>
                void assetCommands
                  .exportAsset(asset.id)
                  .then((ok) => toast(ok ? '已开始导出' : '导出失败', ok ? 'success' : 'error'))
              }
            >
              <DownloadIcon size={16} />
            </button>
            <button
              type="button"
              className={actionButtonClass}
              aria-label="加入参考图"
              onClick={() =>
                void assetCommands.useAsReference(asset.id).then((ok) => {
                  if (ok) toast('已加入参考图')
                })
              }
            >
              <ImagePlusIcon size={16} />
            </button>
            <button
              type="button"
              className={actionButtonClass}
              aria-label="发送到后期处理"
              onClick={() => {
                void assetCommands.openInPostprocess(asset.id)
                closeViewer()
              }}
            >
              <WrenchIcon size={16} />
            </button>
            <button
              type="button"
              className={actionButtonClass}
              aria-label="找相似"
              onClick={() => {
                useAssetLibraryStore.getState().setSimilarToAsset(asset.id)
                closeViewer()
              }}
            >
              <Wand2Icon size={16} />
            </button>
            <button
              type="button"
              className={actionButtonClass}
              aria-label="移入回收站"
              onClick={() => {
                void useAssetLibraryStore
                  .getState()
                  .moveToTrash([asset.id])
                  .then(() => useStore.getState().showToast('已移入回收站', 'success'))
                  .catch(() => useStore.getState().showToast('操作失败', 'error'))
                closeViewer()
              }}
            >
              <TrashIcon size={16} />
            </button>
            <button type="button" className={actionButtonClass} aria-label="关闭查看器" onClick={closeViewer}>
              <XIcon size={18} />
            </button>
          </div>
        </div>

        <div
          ref={containerRef}
          className="relative min-h-0 flex-1 overflow-hidden"
          style={{ cursor: isZoomed ? 'grab' : 'default' }}
          onDoubleClick={() => {
            if (s > 1) {
              scaleRef.current = 1
              txRef.current = 0
              tyRef.current = 0
            } else {
              scaleRef.current = 2.5
            }
            rerender()
          }}
        >
          {src ? (
            <img
              src={src}
              alt=""
              draggable={false}
              className="absolute left-1/2 top-1/2 max-h-full max-w-full select-none object-contain"
              style={{
                transform: `translate(calc(-50% + ${txRef.current}px), calc(-50% + ${tyRef.current}px)) scale(${s})`,
                transition: dragRef.current.active ? 'none' : 'transform 0.15s ease-out',
              }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-white/50">加载中…</div>
          )}
          {isZoomed && (
            <span className="absolute bottom-3 left-3 rounded-full bg-black/50 px-2 py-1 text-xs text-white/80">
              {Math.round(s * 100)}%
            </span>
          )}
        </div>

        {/* 底部类似图 */}
        {similarAssets.length > 0 && (
          <div className="shrink-0 border-t border-white/10 px-3 py-2">
            <p className="mb-1.5 text-xs text-white/50">类似图片</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {similarAssets.map((item) => (
                <SimilarThumbnail key={item.id} asset={item} onClick={() => setViewerAsset(item.id)} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 右侧信息面板 */}
      <aside
        data-testid="asset-viewer-info"
        className={`${infoOpen ? 'flex' : 'hidden'} w-80 shrink-0 flex-col overflow-y-auto border-l border-white/10 bg-ds-surface/95`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ds-border bg-ds-surface px-3 py-2">
          <span className="text-sm font-medium">素材信息</span>
          <button
            type="button"
            aria-label="隐藏信息面板"
            className="grid h-ds-control-sm w-ds-control-sm place-items-center rounded-md text-ds-muted outline-none hover:bg-ds-muted/20"
            onClick={() => setInfoOpen(false)}
          >
            <XIcon size={14} />
          </button>
        </div>
        <div className="space-y-4 p-3">
          <div className="flex items-center justify-between">
            <div role="radiogroup" aria-label="评分" className="flex items-center">
              {[1, 2, 3, 4, 5].map((rating) => (
                <button
                  key={rating}
                  type="button"
                  role="radio"
                  aria-checked={asset.rating === rating}
                  aria-label={`${rating} 星`}
                  onClick={() =>
                    void patchAssets([asset.id], {
                      rating: (asset.rating === rating ? 0 : rating) as AssetRating,
                    }).catch(() => useStore.getState().showToast('操作失败', 'error'))
                  }
                  className="grid h-ds-control-sm w-ds-control-sm place-items-center text-ds-muted hover:text-ds-warning"
                >
                  <StarIcon
                    size={15}
                    fill={rating <= asset.rating ? 'currentColor' : 'none'}
                    className={rating <= asset.rating ? 'text-ds-warning' : ''}
                  />
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-pressed={asset.favorite}
              onClick={() =>
                void patchAssets([asset.id], { favorite: !asset.favorite }).catch(() =>
                  useStore.getState().showToast('操作失败', 'error'),
                )
              }
              className={`flex h-ds-control-sm items-center gap-1 rounded-md px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ds-focus/70 ${asset.favorite ? 'text-ds-warning' : 'text-ds-muted hover:text-ds-warning'}`}
            >
              <StarIcon size={14} fill={asset.favorite ? 'currentColor' : 'none'} />
              {asset.favorite ? '已收藏' : '收藏'}
            </button>
          </div>

          {/* 颜色标签 */}
          <div>
            <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-ds-muted">颜色标签</h4>
            <div className="flex flex-wrap items-center gap-1.5">
              {COLOR_LABELS_WITH_NAMES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-label={item.label}
                  title={item.label}
                  onClick={() => setColorLabel(asset.colorLabel === item.value ? null : item.value)}
                  className={`h-5 w-5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ds-focus/70 ${asset.colorLabel === item.value ? 'ring-2 ring-ds-focus ring-offset-1' : ''}`}
                  style={{ backgroundColor: item.color }}
                />
              ))}
            </div>
          </div>

          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-ds-muted">尺寸</dt>
            <dd>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : '—'}</dd>
            <dt className="text-ds-muted">格式</dt>
            <dd>{asset.mimeType ?? '—'}</dd>
            <dt className="text-ds-muted">大小</dt>
            <dd>{asset.byteSize ? `${(asset.byteSize / 1024 / 1024).toFixed(1)} MB` : '—'}</dd>
            <dt className="text-ds-muted">生成时间</dt>
            <dd>{new Date(asset.createdAt).toLocaleString()}</dd>
            <dt className="text-ds-muted">来源</dt>
            <dd>{asset.origins.length} 个</dd>
          </dl>

          {/* 参数解耦展示：任务级共享参数 + 本图专属参数（seed / 实际差异 / 文件名） */}
          <AssetParamBreakdown origin={primaryOrigin} />

          <NotesEditor assetId={asset.id} value={asset.notes ?? ''} />

          <div>
            <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-ds-muted">提示词</h4>
            <p className="whitespace-pre-wrap break-words text-xs leading-5">{primaryOrigin?.prompt || '—'}</p>
            {primaryOrigin?.revisedPrompt && (
              <p className="mt-1 text-xs leading-5 text-ds-muted">修订：{primaryOrigin.revisedPrompt}</p>
            )}
          </div>

          <DerivedChain asset={asset} onNavigate={(id) => setViewerAsset(id)} />

          <button
            type="button"
            onClick={() =>
              void useAssetLibraryStore
                .getState()
                .moveToTrash([asset.id])
                .then(() => {
                  useStore.getState().showToast('已移入回收站', 'success')
                  closeViewer()
                })
                .catch(() => useStore.getState().showToast('操作失败', 'error'))
            }
            className="flex min-h-ds-control-lg w-full items-center justify-center gap-1 rounded-md border border-ds-danger/35 text-xs text-ds-danger outline-none hover:bg-ds-danger/10 focus-visible:ring-2 focus-visible:ring-red-500/70"
          >
            <TrashIcon size={13} /> 移入回收站
          </button>
        </div>
      </aside>

      {/* 窄屏信息面板切换 */}
      {!infoOpen && (
        <button
          type="button"
          onClick={() => setInfoOpen(true)}
          className="absolute right-3 top-14 z-10 rounded-md bg-ds-surface/10 px-2 py-1 text-xs text-white outline-none hover:bg-ds-surface/20"
        >
          信息
        </button>
      )}

      {total > 1 && (
        <>
          <button
            type="button"
            aria-label="上一张"
            onClick={() => navigate(-1)}
            className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white outline-none hover:bg-black/60 focus-visible:ring-2 focus-visible:ring-ds-focus/70"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="下一张"
            onClick={() => navigate(1)}
            className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white outline-none hover:bg-black/60 focus-visible:ring-2 focus-visible:ring-ds-focus/70"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </>
      )}

      {showToast && (
        <div
          className={`absolute bottom-20 left-1/2 z-10 -translate-x-1/2 rounded-full px-3 py-1.5 text-xs ${
            showToast.tone === 'error' ? 'bg-ds-danger text-ds-text-inverse' : 'bg-black/70 text-white'
          }`}
        >
          {showToast.message}
        </div>
      )}
    </div>
  )
}

function SimilarThumbnail({ asset, onClick }: { asset: GeneratedAsset; onClick: () => void }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let active = true
    const apply = (thumbnail: { dataUrl: string }) => {
      if (active) setSrc(thumbnail.dataUrl)
    }
    const unsubscribe = subscribeImageThumbnail(asset.imageId, apply)
    void ensureImageThumbnailCached(asset.imageId).then((thumbnail) => {
      if (thumbnail) apply(thumbnail)
    })
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [asset.imageId])
  return (
    <button
      type="button"
      onClick={onClick}
      title={asset.origins[0]?.prompt || asset.id}
      className="h-ds-16 w-ds-16 shrink-0 overflow-hidden rounded-md border border-white/10 outline-none hover:border-ds-primary focus-visible:ring-2 focus-visible:ring-ds-focus/70"
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-ds-surface/5 text-white/40">
          <EyeIcon size={14} />
        </span>
      )}
    </button>
  )
}

export default memo(AssetViewerInner)
