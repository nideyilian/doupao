import { memo, useEffect, useRef, useState } from 'react'
import { ensureImageCached } from '../../store'
import { useAssetLibraryStore } from './store'

/**
 * Eagle 式空格快速预览：按住空格显示选中素材的大图（悬浮层），松开关闭。
 * 与全屏查看器（Enter/双击）独立。
 */
function AssetQuickPreviewInner() {
  const assetId = useAssetLibraryStore((state) => state.quickPreviewAssetId)
  const asset = useAssetLibraryStore((state) => (assetId ? state.assetsById[assetId] : undefined))
  const setQuickPreviewAsset = useAssetLibraryStore((state) => state.setQuickPreviewAsset)
  const [src, setSrc] = useState('')
  const closeRef = useRef(() => setQuickPreviewAsset(null))
  closeRef.current = () => setQuickPreviewAsset(null)

  // 加载原图（快速预览应显示清晰大图）
  useEffect(() => {
    if (!assetId || !asset) {
      setSrc('')
      return
    }
    let active = true
    setSrc('')
    ensureImageCached(asset.imageId)
      .then((dataUrl) => {
        if (active && dataUrl) setSrc(dataUrl)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [asset, assetId])

  // Esc / 空格抬起 关闭（keyup 由全局快捷键处理；这里兜底 Esc 与点击）
  useEffect(() => {
    if (!assetId) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [assetId])

  if (!assetId || !asset) return null

  const primaryOrigin = asset.origins[0]
  const prompt = primaryOrigin?.prompt || `素材 ${asset.id}`
  const sizeLabel = asset.width && asset.height ? `${asset.width} × ${asset.height}` : (asset.mimeType ?? '')

  return (
    <div
      data-testid="asset-quick-preview"
      role="dialog"
      aria-modal="true"
      aria-label="快速预览"
      className="asset-quick-preview ds-fade-in fixed inset-0 z-modal flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm sm:p-8"
      onMouseDown={(event) => {
        // 点击遮罩关闭（图片区域不关闭）
        if (event.target === event.currentTarget) closeRef.current()
      }}
    >
      <div className="flex max-h-full max-w-full flex-col overflow-hidden rounded-[var(--ds-radius-xl)] border border-white/10 bg-ds-surface shadow-2xl shadow-black/50">
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black/40 p-4 sm:p-6">
          {src ? (
            <img
              src={src}
              alt=""
              className="max-h-[70dvh] max-w-[85vw] rounded-lg object-contain shadow-lg shadow-black/40"
            />
          ) : (
            <span className="px-10 py-16 text-sm text-ds-muted">加载中…</span>
          )}
        </div>
        <div className="shrink-0 border-t border-ds-border bg-ds-surface/95 px-4 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium uppercase tracking-wide text-ds-muted">提示词</span>
            {sizeLabel && <span className="shrink-0 text-xs text-ds-muted">{sizeLabel}</span>}
          </div>
          <p className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-5 text-ds-text">
            {prompt}
          </p>
        </div>
      </div>
    </div>
  )
}

export const AssetQuickPreview = memo(AssetQuickPreviewInner)
