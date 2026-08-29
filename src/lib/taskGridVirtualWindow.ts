export type TaskGridVirtualWindowInput = {
  itemCount: number
  columns: number
  rowHeight: number
  scrollTop: number
  viewportHeight: number
  overscanRows: number
}

export type TaskGridVirtualWindow = {
  start: number
  end: number
  offsetTop: number
  totalHeight: number
}

export function getTaskGridColumnCount(viewportWidth: number): number {
  if (viewportWidth >= 1_024) return 3
  if (viewportWidth >= 640) return 2
  return 1
}

export function getTaskGridVirtualWindow({
  itemCount,
  columns,
  rowHeight,
  scrollTop,
  viewportHeight,
  overscanRows,
}: TaskGridVirtualWindowInput): TaskGridVirtualWindow {
  const safeColumns = Math.max(1, columns)
  const safeRowHeight = Math.max(1, rowHeight)
  const totalRows = Math.ceil(Math.max(0, itemCount) / safeColumns)
  const totalHeight = totalRows * safeRowHeight
  if (totalRows === 0) return { start: 0, end: 0, offsetTop: 0, totalHeight: 0 }

  const firstVisibleRow = Math.min(totalRows - 1, Math.max(0, Math.floor(Math.max(0, scrollTop) / safeRowHeight)))
  const lastVisibleRow = Math.min(
    totalRows,
    Math.max(firstVisibleRow + 1, Math.ceil((Math.max(0, scrollTop) + Math.max(0, viewportHeight)) / safeRowHeight)),
  )
  const startRow = Math.max(0, firstVisibleRow - Math.max(0, overscanRows))
  const endRow = Math.min(totalRows, lastVisibleRow + Math.max(0, overscanRows))

  return {
    start: startRow * safeColumns,
    end: Math.min(itemCount, endRow * safeColumns),
    offsetTop: startRow * safeRowHeight,
    totalHeight,
  }
}
