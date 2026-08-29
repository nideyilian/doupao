export function getGalleryImageGridMetrics(containerWidth: number, columns: number, gap: number) {
  const safeWidth = Math.max(1, containerWidth)
  const safeColumns = Math.max(1, Math.round(columns))
  const safeGap = Math.max(0, gap)
  const tileSize = Math.max(1, (safeWidth - (safeColumns - 1) * safeGap) / safeColumns)

  return { columns: safeColumns, tileSize }
}

export function getGalleryImageAspectRatio(size: string | undefined) {
  const match = size?.match(/(\d+)\s*[x×]\s*(\d+)/i)
  if (!match) return 1

  const width = Number(match[1])
  const height = Number(match[2])
  return width > 0 && height > 0 ? width / height : 1
}
