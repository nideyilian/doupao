export interface HoverPreviewPositionInput {
  pointerX: number
  pointerY: number
  previewWidth: number
  previewHeight: number
  viewportWidth: number
  viewportHeight: number
  gap?: number
  margin?: number
}

export interface HoverPreviewSizeInput {
  imageWidth: number
  imageHeight: number
  maxLongEdge: number
  viewportWidth?: number
  viewportHeight?: number
  margin?: number
}

export function getHoverPreviewSize(input: HoverPreviewSizeInput) {
  const margin = input.margin ?? 12
  const imageWidth = Math.max(1, input.imageWidth)
  const imageHeight = Math.max(1, input.imageHeight)
  const longEdge = Math.max(1, input.maxLongEdge)
  const scale = longEdge / Math.max(imageWidth, imageHeight)
  let width = Math.round(imageWidth * scale)
  let height = Math.round(imageHeight * scale)
  const viewportMaxWidth = input.viewportWidth ? Math.max(1, input.viewportWidth - margin * 2) : width
  const viewportMaxHeight = input.viewportHeight ? Math.max(1, input.viewportHeight - margin * 2) : height
  const viewportScale = Math.min(1, viewportMaxWidth / width, viewportMaxHeight / height)

  if (viewportScale < 1) {
    width = Math.round(width * viewportScale)
    height = Math.round(height * viewportScale)
  }

  return { width, height }
}

export function getHoverPreviewPosition(input: HoverPreviewPositionInput) {
  const gap = input.gap ?? 18
  const margin = input.margin ?? 12
  const maxLeft = input.viewportWidth - input.previewWidth - margin
  const maxTop = input.viewportHeight - input.previewHeight - margin
  const preferredLeft = input.pointerX + gap
  const flippedLeft = input.pointerX - input.previewWidth - gap
  const left = preferredLeft + input.previewWidth + margin <= input.viewportWidth ? preferredLeft : flippedLeft
  const top = Math.min(Math.max(input.pointerY + gap, margin), Math.max(margin, maxTop))

  return {
    left: Math.min(Math.max(left, margin), Math.max(margin, maxLeft)),
    top,
  }
}
