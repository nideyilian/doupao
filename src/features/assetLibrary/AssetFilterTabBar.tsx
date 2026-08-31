import { memo, useMemo, useRef, useState } from 'react'
import type { AssetLibraryFilters, PinnedFilter } from '../../types'
import { PinIcon, XIcon } from '../../design-system/icons'
import { COLOR_LABEL_NAMES } from './colorLabels'
import { useAssetLibraryStore } from './store'
import { isPinnedFilterActive, pinnedFilterKey, pinnedFilterLabel, sourceModeLabel } from './pinnedFilters'

/**
 * 顶部筛选标签栏（Eagle 式标签页交互，仅作用于筛选功能）：
 * - 固定标签（📌）：用户在筛选面板「固定到顶部」的常用条件，常驻、可拖动排序、本地持久化；
 *   点击 = 应用/取消该筛选（未激活时点击应用并激活，已激活时点击取消）。
 * - 临时标签：当前已生效的筛选条件自动「打开」为标签（如设置了服务商/日期/星级等），
 *   点击或 ✕ = 移除该条件；条件清除后标签自动消失。
 * - 固定标签的 ✕ = 取消固定：条件仍激活时转为临时标签继续显示。
 * - 「清除全部」只清除临时条件，固定标签保留（与 Eagle 固定标签不随关闭页面消失一致）。
 */
const ORIENTATION_LABELS: Record<NonNullable<AssetLibraryFilters['orientation']>, string> = {
  landscape: '横向',
  portrait: '纵向',
  square: '方形',
}

function formatShortDate(timestamp: number): string {
  const date = new Date(timestamp)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

interface TempTab {
  key: string
  label: string
  dotColor?: string
  remove: () => void
}

/** 当前生效条件 → 临时标签（key 与固定标签对齐：provider:豆包 / minRating:4 等，便于去重）。 */
function buildTempTabs(
  filters: AssetLibraryFilters,
  collections: ReturnType<typeof useAssetLibraryStore.getState>['collections'],
  tags: ReturnType<typeof useAssetLibraryStore.getState>['tags'],
  setFilters: (filters: AssetLibraryFilters) => void,
): TempTab[] {
  const tabs: TempTab[] = []
  const collectionName = (id: string) => collections.find((item) => item.id === id)?.name ?? '未命名'
  const tagName = (id: string) => tags.find((item) => item.id === id)?.name ?? '未命名'
  const tagColor = (id: string) => tags.find((item) => item.id === id)?.color
  const patch = (patch: Partial<AssetLibraryFilters>) => setFilters({ ...filters, ...patch })

  if (filters.favoriteOnly) {
    tabs.push({ key: 'favoriteOnly', label: '仅看收藏', remove: () => patch({ favoriteOnly: undefined }) })
  }
  if (filters.minRating !== undefined && filters.minRating > 0) {
    tabs.push({
      key: `minRating:${filters.minRating}`,
      label: `${filters.minRating} 星及以上`,
      remove: () => patch({ minRating: undefined }),
    })
  }
  if (filters.collectionId) {
    tabs.push({
      key: `collection:${filters.collectionId}`,
      label: `项目：${collectionName(filters.collectionId)}`,
      remove: () => patch({ collectionId: null }),
    })
  }
  const tagIdSet = new Set<string>()
  if (filters.tagId) tagIdSet.add(filters.tagId)
  for (const tagId of filters.tagIds ?? []) if (tagId) tagIdSet.add(tagId)
  for (const tagId of tagIdSet) {
    tabs.push({
      key: `tag:${tagId}`,
      label: `标签：${tagName(tagId)}`,
      dotColor: tagColor(tagId),
      remove: () => {
        const next = (filters.tagIds ?? []).filter((id) => id !== tagId)
        patch({ tagId: filters.tagId === tagId ? null : filters.tagId, tagIds: next.length > 0 ? next : undefined })
      },
    })
  }
  if (filters.dateFrom !== undefined) {
    tabs.push({
      key: 'dateFrom',
      label: `${formatShortDate(filters.dateFrom)} 起`,
      remove: () => patch({ dateFrom: undefined }),
    })
  }
  if (filters.dateTo !== undefined) {
    tabs.push({
      key: 'dateTo',
      label: `${formatShortDate(filters.dateTo)} 止`,
      remove: () => patch({ dateTo: undefined }),
    })
  }
  if (filters.model) {
    tabs.push({
      key: `model:${filters.model}`,
      label: `模型：${filters.model}`,
      remove: () => patch({ model: undefined }),
    })
  }
  if (filters.provider) {
    tabs.push({
      key: `provider:${filters.provider}`,
      label: `服务商：${filters.provider}`,
      remove: () => patch({ provider: undefined }),
    })
  }
  if (filters.colorLabel) {
    tabs.push({
      key: `colorLabel:${filters.colorLabel}`,
      label: COLOR_LABEL_NAMES[filters.colorLabel] ?? filters.colorLabel,
      remove: () => patch({ colorLabel: undefined }),
    })
  }
  if (filters.orientation) {
    tabs.push({
      key: `orientation:${filters.orientation}`,
      label: ORIENTATION_LABELS[filters.orientation],
      remove: () => patch({ orientation: undefined }),
    })
  }
  if (filters.minWidth !== undefined && filters.minWidth > 0) {
    tabs.push({
      key: 'minWidth',
      label: `宽 ≥ ${filters.minWidth}px`,
      remove: () => patch({ minWidth: undefined }),
    })
  }
  if (filters.maxWidth !== undefined && filters.maxWidth > 0) {
    tabs.push({
      key: 'maxWidth',
      label: `宽 ≤ ${filters.maxWidth}px`,
      remove: () => patch({ maxWidth: undefined }),
    })
  }
  if (filters.sourceMode) {
    tabs.push({
      key: `sourceMode:${filters.sourceMode}`,
      label: sourceModeLabel(filters.sourceMode),
      remove: () => patch({ sourceMode: undefined }),
    })
  }
  return tabs
}

interface TabDragProps {
  draggable: boolean
  onDragStart: () => void
  onDragOver: () => void
  onDrop: () => void
}

function AssetFilterTabBar() {
  const filters = useAssetLibraryStore((s) => s.filters)
  const collections = useAssetLibraryStore((s) => s.collections)
  const tags = useAssetLibraryStore((s) => s.tags)
  const pinnedFilters = useAssetLibraryStore((s) => s.pinnedFilters)
  const setFilters = useAssetLibraryStore((s) => s.setFilters)
  const applyPinnedFilter = useAssetLibraryStore((s) => s.applyPinnedFilter)
  const unpinFilter = useAssetLibraryStore((s) => s.unpinFilter)
  const reorderPinnedFilters = useAssetLibraryStore((s) => s.reorderPinnedFilters)

  const fixedKeys = useMemo(() => new Set(pinnedFilters.map(pinnedFilterKey)), [pinnedFilters])
  const fixedTabs = useMemo(
    () =>
      pinnedFilters.map((filter) => ({
        key: pinnedFilterKey(filter),
        label: pinnedFilterLabel(filter),
        active: isPinnedFilterActive(filter, filters),
        filter,
      })),
    [filters, pinnedFilters],
  )
  const tempTabs = useMemo(
    () => buildTempTabs(filters, collections, tags, setFilters).filter((tab) => !fixedKeys.has(tab.key)),
    [collections, filters, fixedKeys, setFilters, tags],
  )

  // Eagle 式拖拽排序：仅固定标签之间可排序（临时标签随条件出现，顺序由打开先后决定）
  const dragIndexRef = useRef<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const handleDrop = (toIndex: number) => {
    const fromIndex = dragIndexRef.current
    dragIndexRef.current = null
    setDragOverIndex(null)
    if (fromIndex !== null && fromIndex !== toIndex) reorderPinnedFilters(fromIndex, toIndex)
  }

  const handleDragEnd = () => {
    dragIndexRef.current = null
    setDragOverIndex(null)
  }

  if (fixedTabs.length === 0 && tempTabs.length === 0) return null

  const renderTab = (
    key: string,
    label: string,
    active: boolean,
    content: React.ReactNode,
    onClick: () => void,
    dragProps?: TabDragProps,
    isDragOverTarget = false,
  ) => (
    <span
      key={key}
      role="tab"
      tabIndex={0}
      aria-selected={active}
      data-testid={`asset-filter-tab-${key}`}
      title={active ? `点击取消筛选：${label}` : `点击筛选：${label}`}
      draggable={dragProps?.draggable}
      onDragStart={dragProps?.onDragStart}
      onDragOver={dragProps?.onDragOver}
      onDrop={dragProps?.onDrop}
      onDragEnd={handleDragEnd}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
      className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs outline-none transition focus-visible:ring-2 focus-visible:ring-ds-focus/70 ${
        isDragOverTarget ? 'border-ds-primary ring-2 ring-ds-focus/60' : ''
      } ${
        active
          ? 'border-ds-primary bg-ds-primary text-ds-text-inverse dark:bg-ds-primary/90'
          : 'border-ds-border bg-ds-surface text-ds-text hover:border-ds-primary/50 hover:bg-ds-primary-subtle dark:bg-ds-muted/5'
      }`}
    >
      {content}
    </span>
  )

  return (
    <div
      role="tablist"
      aria-label="筛选标签栏（固定的常用筛选 + 当前生效的筛选条件）"
      data-testid="asset-filter-tab-bar"
      data-no-drag-select
      className="shrink-0 border-b border-ds-border/60 bg-ds-surface/60 px-8 py-1.5"
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs font-medium text-ds-muted">筛选</span>
        <div className="custom-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {fixedTabs.map((tab, index) =>
            renderTab(
              tab.key,
              tab.label,
              tab.active,
              <>
                <PinIcon
                  size={11}
                  filled={tab.active}
                  aria-hidden="true"
                  className={tab.active ? 'text-ds-text-inverse/80' : 'shrink-0 text-ds-muted'}
                />
                <span className="whitespace-nowrap">{tab.label}</span>
                <button
                  type="button"
                  aria-label={`取消固定：${tab.label}`}
                  data-testid={`asset-filter-tab-unpin-${tab.key}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    unpinFilter(tab.key)
                  }}
                  className={`flex shrink-0 items-center rounded p-0.5 outline-none transition focus-visible:ring-2 focus-visible:ring-ds-focus/70 ${
                    tab.active
                      ? 'text-ds-text-inverse/80 hover:bg-ds-primary/80'
                      : 'text-ds-muted hover:bg-ds-muted/20 hover:text-ds-text'
                  }`}
                >
                  <XIcon size={11} />
                </button>
              </>,
              () => applyPinnedFilter(tab.filter),
              {
                draggable: true,
                onDragStart: () => {
                  dragIndexRef.current = index
                },
                onDragOver: () => setDragOverIndex(index),
                onDrop: () => handleDrop(index),
              },
              dragOverIndex === index,
            ),
          )}
          {tempTabs.map((tab) =>
            renderTab(
              tab.key,
              tab.label,
              true,
              <>
                {tab.dotColor && (
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: tab.dotColor }}
                  />
                )}
                <span className="whitespace-nowrap">{tab.label}</span>
                <button
                  type="button"
                  aria-label={`移除筛选：${tab.label}`}
                  data-testid={`asset-filter-tab-remove-${tab.key}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    tab.remove()
                  }}
                  className="flex shrink-0 items-center rounded p-0.5 text-ds-text-inverse/80 outline-none transition hover:bg-ds-primary/80 focus-visible:ring-2 focus-visible:ring-ds-focus/70"
                >
                  <XIcon size={11} />
                </button>
              </>,
              tab.remove,
            ),
          )}
        </div>
        {tempTabs.length > 0 && (
          <button
            type="button"
            data-testid="asset-filter-tab-clear-all"
            onClick={() => setFilters({})}
            className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs text-ds-primary outline-none transition hover:bg-ds-primary-subtle hover:underline focus-visible:ring-2 focus-visible:ring-ds-focus/70 dark:hover:bg-ds-primary/10"
          >
            <XIcon size={11} />
            清除全部
          </button>
        )}
      </div>
    </div>
  )
}

export default memo(AssetFilterTabBar)
