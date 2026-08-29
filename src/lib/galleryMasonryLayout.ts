export interface GalleryMasonryLayoutItem {
  height: number
  index: number
  left: number
  top: number
  width: number
}

interface GalleryMasonryLayoutOptions {
  aspectRatios: number[]
  columnWidth: number
  columns: number
  gap: number
}

export interface GalleryMasonryLayout {
  columns: GalleryMasonryLayoutItem[][]
  items: GalleryMasonryLayoutItem[]
  totalHeight: number
}

function normalizeAspectRatio(value: number | undefined) {
  return Number.isFinite(value) && value && value > 0 ? Math.min(4, Math.max(0.25, value)) : 1
}

// 单槽内容戳记缓存：布局位置只取决于 aspectRatios 数值序列 + columns/width/gap。
// 任务瞬态更新（如 streamPartialImageIds）不改变这些输入时直接复用结果对象，
// 让调用方 useMemo 短路，避免每帧 O(images × columns) 重排 + 大量对象分配。
let layoutCacheKey = ''
let layoutCacheResult: GalleryMasonryLayout | null = null

export function buildGalleryMasonryLayout({
  aspectRatios,
  columnWidth,
  columns,
  gap,
}: GalleryMasonryLayoutOptions): GalleryMasonryLayout {
  const safeColumns = Math.max(1, Math.round(columns))
  const safeColumnWidth = Math.max(1, columnWidth)
  const safeGap = Math.max(0, gap)
  const key = `${safeColumns}|${safeColumnWidth}|${safeGap}|${aspectRatios.join(',')}`
  if (layoutCacheKey === key && layoutCacheResult) return layoutCacheResult

  const columnHeights = Array.from({ length: safeColumns }, () => 0)
  const layoutColumns = Array.from({ length: safeColumns }, () => [] as GalleryMasonryLayoutItem[])
  const items: GalleryMasonryLayoutItem[] = []

  aspectRatios.forEach((aspectRatio, index) => {
    let column = 0
    for (let candidate = 1; candidate < safeColumns; candidate++) {
      if (columnHeights[candidate] < columnHeights[column]) column = candidate
    }

    const height = safeColumnWidth / normalizeAspectRatio(aspectRatio)
    const item = {
      index,
      left: column * (safeColumnWidth + safeGap),
      top: columnHeights[column],
      width: safeColumnWidth,
      height,
    }
    items.push(item)
    layoutColumns[column].push(item)
    columnHeights[column] += height + safeGap
  })

  const result: GalleryMasonryLayout = {
    columns: layoutColumns,
    items,
    totalHeight: Math.max(0, ...columnHeights.map((height) => height - safeGap)),
  }
  layoutCacheKey = key
  layoutCacheResult = result
  return result
}

function findFirstVisibleItem(items: GalleryMasonryLayoutItem[], start: number) {
  let lower = 0
  let upper = items.length
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2)
    if (items[middle].top + items[middle].height <= start) {
      lower = middle + 1
    } else {
      upper = middle
    }
  }
  return lower
}

export function getVisibleGalleryMasonryItems(
  layout: GalleryMasonryLayout,
  scrollTop: number,
  viewportHeight: number,
  overscan = viewportHeight,
) {
  const start = Math.max(0, scrollTop - overscan)
  const end = Math.max(start, scrollTop + viewportHeight + overscan)
  const visible: GalleryMasonryLayoutItem[] = []

  layout.columns.forEach((column) => {
    for (let index = findFirstVisibleItem(column, start); index < column.length; index++) {
      const item = column[index]
      if (item.top >= end) break
      visible.push(item)
    }
  })

  return visible.sort((first, second) => first.index - second.index)
}
