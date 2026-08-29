import { memo, useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { GeneratedAsset } from '../../types'
import { Button, Dialog, EmptyState } from '../../design-system'
import { CheckIcon, ImageIcon, SearchIcon } from '../../design-system/icons'
import {
  ensureImageThumbnailCached,
  getCachedThumbnail,
  prefetchImageThumbnails,
  subscribeImageThumbnail,
  useStore,
} from '../../store'
import { queryAssets } from './query'
import { useAssetLibraryStore } from './store'
import { assetCommands } from '../../lib/assetCommands'

/**
 * 缩略图砖比例：按素材原始宽高比（钳制 0.5–2，与素材库主网格同一规则），
 * 缺尺寸时回退正方形。用真实比例渲染，避免固定正方形把横版/竖版图拉伸变形。
 */
function getAssetAspectRatio(asset: GeneratedAsset): number {
  if (!asset.width || !asset.height) return 1
  return Math.min(2, Math.max(0.5, asset.width / asset.height))
}

interface AssetPickerThumbnailProps {
  asset: GeneratedAsset
  selected: boolean
  onToggle: () => void
}

function AssetPickerThumbnail({ asset, onToggle, selected }: AssetPickerThumbnailProps) {
  const [src, setSrc] = useState(() => getCachedThumbnail(asset.imageId)?.dataUrl ?? '')

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

  const label =
    asset.origins.find((origin) => origin.key === asset.primaryOriginKey)?.prompt ||
    asset.origins[0]?.prompt ||
    '参考素材'

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      onClick={onToggle}
      className={`group relative min-w-0 overflow-hidden rounded-lg border text-left transition-[border-color,box-shadow,transform] active:scale-[0.98] ${
        selected ? 'border-ds-primary ring-2 ring-ds-focus/30' : 'border-ds-border hover:border-ds-muted'
      }`}
      style={{ aspectRatio: getAssetAspectRatio(asset) }}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-ds-muted/20 text-ds-muted">
          <ImageIcon size={22} />
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 line-clamp-2 bg-gradient-to-t from-black/70 to-transparent px-2 pb-2 pt-8 text-xs leading-4 text-white">
        {label}
      </span>
      {selected && (
        <span className="absolute right-2 top-2 rounded-full bg-ds-primary p-1 text-ds-text-inverse shadow-sm">
          <CheckIcon size={12} />
        </span>
      )}
    </button>
  )
}

export interface AssetPickerModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (assets: GeneratedAsset[]) => void | Promise<void>
  title?: string
  description?: string
  selectionLimit?: number
}

function AssetPickerModalInner({
  description = '从已归档素材中选择，不需要下载后重新上传。',
  onOpenChange,
  onSelect,
  open,
  selectionLimit = 1,
  title = '选择素材',
}: AssetPickerModalProps) {
  const assetsById = useAssetLibraryStore((state) => state.assetsById)
  const assetOrder = useAssetLibraryStore((state) => state.assetOrder)
  const collections = useAssetLibraryStore((state) => state.collections)
  const hydrationStatus = useAssetLibraryStore((state) => state.hydrationStatus)
  const hydrate = useAssetLibraryStore((state) => state.hydrate)
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [catalogAssets, setCatalogAssets] = useState<GeneratedAsset[] | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const deferredQuery = useDeferredValue(query)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelectedIds([])
    if (hydrationStatus === 'idle' || hydrationStatus === 'error') void hydrate()
  }, [hydrate, hydrationStatus, open])

  const assets = useMemo(
    () => assetOrder.flatMap((id) => (assetsById[id] ? [assetsById[id]] : [])),
    [assetOrder, assetsById],
  )
  const result = useMemo(
    () =>
      queryAssets(
        { assets, collections },
        {
          scope: 'all',
          query: deferredQuery,
          filters: {},
          sortKey: 'updatedAt',
          sortOrder: 'desc',
        },
      ),
    [assets, collections, deferredQuery],
  )
  useEffect(() => {
    if (!open || !window.electronAPI?.assetCatalogQuery || hydrationStatus !== 'ready') return
    let active = true
    setCatalogLoading(true)
    void assetCommands
      .searchAssetPage({
        scope: 'all',
        query: deferredQuery,
        filters: {},
        sortKey: 'updatedAt',
        sortOrder: 'desc',
        limit: 120,
        semantic: { enabled: Boolean(deferredQuery.trim()), context: deferredQuery },
      })
      .then((page) => {
        if (active) {
          setCatalogAssets(page.assets)
          prefetchImageThumbnails(page.assets.map((asset) => asset.imageId))
        }
      })
      .finally(() => {
        if (active) setCatalogLoading(false)
      })
    return () => {
      active = false
    }
  }, [deferredQuery, hydrationStatus, open])
  const displayedAssets = catalogAssets ?? result.assets
  const displayedById = useMemo(() => new Map(displayedAssets.map((asset) => [asset.id, asset])), [displayedAssets])
  const selectedAssets = selectedIds.flatMap((id) => {
    const asset = displayedById.get(id) ?? assetsById[id]
    return asset ? [asset] : []
  })

  const toggleAsset = (assetId: string) => {
    setSelectedIds((current) => {
      if (current.includes(assetId)) return current.filter((id) => id !== assetId)
      if (selectionLimit <= 1) return [assetId]
      return [...current, assetId].slice(-selectionLimit)
    })
  }

  const confirmSelection = async () => {
    if (selectedAssets.length === 0 || submitting) return
    setSubmitting(true)
    try {
      await onSelect(selectedAssets)
      onOpenChange(false)
    } catch {
      useStore.getState().showToast('操作失败，请重试', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const loading = hydrationStatus === 'idle' || hydrationStatus === 'loading' || catalogLoading

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="xl"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-xs text-ds-muted">
            {selectionLimit > 1
              ? `已选择 ${selectedAssets.length} / ${selectionLimit}（最多 ${selectionLimit} 张，超出时自动保留最新选择）`
              : selectedAssets.length
                ? '已选择 1 张'
                : '请选择一张素材'}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button disabled={selectedAssets.length === 0} loading={submitting} onClick={() => void confirmSelection()}>
              使用所选素材
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex h-[min(68dvh,720px)] min-h-[360px] flex-col gap-3">
        <label className="relative block shrink-0">
          <SearchIcon
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ds-muted"
          />
          <span className="sr-only">搜索素材</span>
          <input
            data-autofocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索提示词、模型或项目"
            className="min-h-ds-control-lg w-full rounded-md border border-ds-border bg-ds-surface pl-9 pr-3 text-sm outline-none focus:border-ds-primary focus:ring-2 focus:ring-ds-focus/20"
          />
        </label>

        {loading ? (
          <div
            className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-hidden sm:grid-cols-3 lg:grid-cols-5"
            aria-label="素材加载中"
          >
            {Array.from({ length: 10 }, (_, index) => (
              <div key={index} className="aspect-square animate-pulse rounded-lg bg-ds-muted/25" />
            ))}
          </div>
        ) : hydrationStatus === 'error' ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <EmptyState
              icon={<ImageIcon size={22} />}
              title="素材加载失败"
              description="请重试，现有素材不会受到影响。"
              action={
                <Button variant="secondary" onClick={() => void hydrate()}>
                  重试
                </Button>
              }
            />
          </div>
        ) : displayedAssets.length === 0 ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <EmptyState
              icon={<ImageIcon size={22} />}
              title={assets.length === 0 ? '还没有可用素材' : '没有匹配的素材'}
              description={
                assets.length === 0 ? '完成生成或使用外部参考图后，素材会自动归档。' : '换一个关键词，或清空搜索条件。'
              }
            />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="grid grid-cols-2 items-start gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {displayedAssets.map((asset) => (
                <AssetPickerThumbnail
                  key={asset.id}
                  asset={asset}
                  selected={selectedIds.includes(asset.id)}
                  onToggle={() => toggleAsset(asset.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}

export default memo(AssetPickerModalInner)
