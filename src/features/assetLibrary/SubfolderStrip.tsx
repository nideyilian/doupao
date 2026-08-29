import { memo, useEffect, useMemo, useState } from 'react'
import { FolderIcon } from '../../design-system/icons'
import { ensureImageThumbnailCached } from '../../store'
import { sortCollections, isCollectionTrashed } from '../../lib/assetLibraryModel'
import { useAssetLibraryStore } from './store'
import type { AssetSidebarCounts } from './query'

/**
 * 子文件夹区块（Eagle 式）：
 * 进入文件夹且存在直接子文件夹时，在内容区顶部展示子文件夹封面卡片
 * （封面缩略图 + 名称 + 素材数），点击进入该子文件夹。
 *
 * - 与「包含子文件夹」开关正交：开关只决定下方图片区是否递归展开，区块两种状态下都保留。
 * - 搜索 / 筛选 / 相似搜索激活时隐藏（结果可能跨文件夹，结构导航会误导）。
 * - 封面：该文件夹内第一张素材的缩略图（异步加载，缺省显示文件夹图标）。
 */
function SubfolderStrip({ counts }: { counts: AssetSidebarCounts }) {
  const scope = useAssetLibraryStore((s) => s.scope)
  const collections = useAssetLibraryStore((s) => s.collections)
  const assetsById = useAssetLibraryStore((s) => s.assetsById)
  const assetOrder = useAssetLibraryStore((s) => s.assetOrder)
  const query = useAssetLibraryStore((s) => s.query)
  const filters = useAssetLibraryStore((s) => s.filters)
  const similarToAssetId = useAssetLibraryStore((s) => s.similarToAssetId)
  const setScope = useAssetLibraryStore((s) => s.setScope)

  const isCollectionScope = typeof scope === 'object' && scope.kind === 'collection'
  const hasActiveCriteria =
    query.trim() !== '' || similarToAssetId !== null || Object.values(filters).some((value) => Boolean(value))

  const children = useMemo(() => {
    if (typeof scope !== 'object' || scope.kind !== 'collection') return []
    // 复用树排序（置顶 → order → 拼音），保证与侧栏同级顺序一致
    return sortCollections(collections).filter(
      (collection) => collection.parentId === scope.id && !isCollectionTrashed(collection),
    )
  }, [collections, scope])

  // 每个子文件夹的封面素材：按素材顺序取该文件夹内第一张非回收站图片
  const coverAssetIds = useMemo(() => {
    const map = new Map<string, string>()
    const wanted = new Set(children.map((child) => child.id))
    for (const id of assetOrder) {
      const asset = assetsById[id]
      if (!asset || asset.status === 'trashed') continue
      for (const collectionId of asset.collectionIds) {
        if (wanted.has(collectionId) && !map.has(collectionId)) map.set(collectionId, id)
      }
    }
    return map
  }, [assetOrder, assetsById, children])

  if (!isCollectionScope || children.length === 0 || hasActiveCriteria) return null

  return (
    <div
      data-testid="asset-subfolder-strip"
      data-no-drag-select
      className="shrink-0 border-b border-ds-border/60 bg-ds-surface/60 px-8 py-2"
    >
      <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-ds-muted">
        <FolderIcon size={13} />
        子文件夹 {children.length}
      </div>
      <div className="custom-scrollbar flex gap-3 overflow-x-auto pb-1">
        {children.map((child) => (
          <SubfolderCard
            key={child.id}
            name={child.name}
            count={counts.byCollection.get(child.id) ?? 0}
            coverImageId={coverAssetIds.get(child.id)}
            onClick={() => setScope({ kind: 'collection', id: child.id })}
          />
        ))}
      </div>
    </div>
  )
}

function SubfolderCard({
  name,
  count,
  coverImageId,
  onClick,
}: {
  name: string
  count: number
  coverImageId: string | undefined
  onClick: () => void
}) {
  const [coverSrc, setCoverSrc] = useState('')

  useEffect(() => {
    let cancelled = false
    if (!coverImageId) return
    setCoverSrc('')
    ensureImageThumbnailCached(coverImageId)
      .then((thumbnail) => {
        if (!cancelled && thumbnail) setCoverSrc(thumbnail.dataUrl)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [coverImageId])

  return (
    <button
      type="button"
      data-testid="asset-subfolder-card"
      onClick={onClick}
      title={name}
      className="flex w-40 shrink-0 flex-col overflow-hidden rounded-ds-lg border border-ds-border bg-ds-surface text-left shadow-sm outline-none transition hover:border-ds-primary focus-visible:ring-2 focus-visible:ring-ds-focus/70 dark:bg-ds-surface"
    >
      <div className="relative flex h-24 items-center justify-center overflow-hidden border-b border-ds-border/40 bg-ds-muted/15">
        {coverSrc ? (
          <img src={coverSrc} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <FolderIcon size={28} className="text-ds-muted" />
        )}
      </div>
      <div className="flex min-w-0 items-center gap-1 p-2">
        <FolderIcon size={13} className="shrink-0 text-ds-muted" />
        <span className="min-w-0 flex-1 truncate text-xs text-ds-text">{name}</span>
        <span className="shrink-0 text-xs tabular-nums text-ds-muted">{count} 张</span>
      </div>
    </button>
  )
}

export default memo(SubfolderStrip)
