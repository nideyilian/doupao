import type { CompositeV2TextLayer } from './compositeV2Types'

export type CompositeTextLineMeasurer = (line: string) => number

export function measureCompositeTextBox(
  layer: CompositeV2TextLayer,
  measureLine: CompositeTextLineMeasurer = (line) => measureLineWithCanvas(layer, line),
) {
  const lines = layer.text.split('\n')
  const padding = Number.isFinite(layer.padding) ? Math.max(0, layer.padding) : 5
  const contentWidth = Math.max(
    ...lines.map((line) => measureLine(line) + Math.max(0, [...line].length - 1) * layer.letterSpacing),
    0,
  )
  const contentHeight = Math.max(1, lines.length) * layer.fontSize * layer.lineHeight

  return {
    width: Math.max(1, Math.ceil(contentWidth + padding * 2)),
    height: Math.max(1, Math.ceil(contentHeight + padding * 2)),
  }
}

export function fitCompositeTextLayer(layer: CompositeV2TextLayer): CompositeV2TextLayer {
  const size = measureCompositeTextBox(layer)
  return {
    ...layer,
    position: {
      ...layer.position,
      width: size.width,
      height: size.height,
    },
  }
}

function measureLineWithCanvas(layer: CompositeV2TextLayer, line: string) {
  if (typeof document === 'undefined') return [...line].length * layer.fontSize * 0.6
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('jsdom')) {
    return [...line].length * layer.fontSize * 0.6
  }
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return [...line].length * layer.fontSize * 0.6
  context.font = `${layer.fontWeight} ${layer.fontSize}px ${layer.fontFamily}`
  return context.measureText(line || ' ').width
}
