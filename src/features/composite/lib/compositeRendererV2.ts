import { mapLayerPositionToCanvas, planBackgroundFit } from './compositeRenderPlan'
import { getCompositeAssetObjectUrl } from './compositeAssets'
import { ByteLruCache } from '../../../lib/byteLruCache'
import { getSourceHeight, getSourceWidth, loadImageOriented, type OrientedImageSource } from '../../../lib/canvasImage'
import type {
  CompositeV2MediaLayer,
  CompositeV2Preset,
  CompositeV2FitMode,
  CompositeV2Stroke,
  CompositeV2TextLayer,
} from './compositeV2Types'

type Size = { width: number; height: number }

// 叠加层缓存：按字节限制（基准 overlay 可能远超输出尺寸，不能用条数限制，否则内存会爆）。
const MAX_OVERLAY_CACHE_BYTES = 384 * 1024 * 1024

type OverlayCacheEntry = {
  canvas: HTMLCanvasElement
  width: number
  height: number
  lastUsed: number
}

const overlayCache = new Map<string, OverlayCacheEntry>()
let overlayCacheBytes = 0

function touchOverlayEntry(key: string, entry: OverlayCacheEntry) {
  entry.lastUsed = Date.now()
  overlayCache.delete(key)
  overlayCache.set(key, entry)
}

function evictOverlayEntries() {
  while (overlayCacheBytes > MAX_OVERLAY_CACHE_BYTES && overlayCache.size > 1) {
    const oldestKey = overlayCache.keys().next().value
    if (oldestKey === undefined) break
    const entry = overlayCache.get(oldestKey)
    overlayCache.delete(oldestKey)
    if (entry) overlayCacheBytes -= entry.width * entry.height * 4
  }
}

function cacheOverlay(key: string, canvas: HTMLCanvasElement) {
  const prev = overlayCache.get(key)
  if (prev) overlayCacheBytes -= prev.width * prev.height * 4
  const entry: OverlayCacheEntry = { canvas, width: canvas.width, height: canvas.height, lastUsed: Date.now() }
  overlayCache.set(key, entry)
  overlayCacheBytes += entry.width * entry.height * 4
  evictOverlayEntries()
}

// 解码后的图片缓存：按源地址（dataURL / objectURL / 本地路径）复用已解码的位图，
// 避免在拖拽图层时每次指针移动都重新解码大图或重新读取本地文件，导致预览更新滞后。
const IMAGE_CACHE_MAX_BYTES = 128 * 1024 * 1024
const imageCache = new ByteLruCache<string, OrientedImageSource>(IMAGE_CACHE_MAX_BYTES)

export type CompositeV2RenderInput = {
  backgroundDataUrl?: string
  preset: CompositeV2Preset
  targetSize: Size
  fitMode: CompositeV2FitMode
  quality?: number
}

export type CompositeV2RenderOptions = {
  // 返回 true 表示本次渲染已过期（有更新的渲染请求），应放弃写入画布，避免旧帧覆盖新帧。
  isStale?: () => boolean
}

async function loadImage(src: string, cacheKey = src): Promise<OrientedImageSource> {
  const cached = imageCache.get(cacheKey)
  if (cached) return Promise.resolve(cached)
  const image = await loadImageOriented(src)
  imageCache.set(cacheKey, image, (getSourceWidth(image) || 0) * (getSourceHeight(image) || 0) * 4)
  return image
}

export function getScaledTextMetrics(fontSize: number, strokeWidth: number, base: Size, target: Size) {
  const scale = Math.min(target.width / base.width, target.height / base.height)
  return { fontSize: fontSize * scale, strokeWidth: strokeWidth * scale }
}

export function getScaledLayerStrokeWidth(stroke: CompositeV2Stroke | undefined, base: Size, target: Size) {
  if (!stroke?.enabled || stroke.width <= 0) return 0
  return stroke.width * Math.min(target.width / base.width, target.height / base.height)
}

/**
 * 叠加层缓存键。除预设修订号与目标尺寸外，还纳入项目 Logo 的资产签名：
 * 更换/重命名项目 Logo 不会更新 preset.updatedAt，若不纳入签名会导致预览/导出沿用旧 Logo。
 */
export function getCompositeOverlayCacheKey(
  preset: Pick<CompositeV2Preset, 'id' | 'updatedAt'>,
  target: Size,
  logoSignature?: string,
) {
  return `${preset.id}:${preset.updatedAt}:${target.width}x${target.height}${logoSignature ? `:logos=${logoSignature}` : ''}`
}

export async function renderCombinedOverlay(preset: CompositeV2Preset, target: Size) {
  const logoSignature = await getProjectLogosSignature()

  // 与预设画布同比例的尺寸：以 baseCanvas 等比放大（覆盖最大所需尺寸）的版本渲染一次，
  // 所有同比例输出共享并缩放合成——避免每个输出尺寸都全量重绘所有图层（这是批量导出的主要加速点）。
  // 比例不同（或 baseCanvas 无效）时回退为按目标尺寸精确渲染。
  if (sameRatio(preset.baseCanvas, target)) {
    const key = `base:${preset.id}:${preset.updatedAt}:logos=${logoSignature}`
    const need = coverSize(preset.baseCanvas, target)
    const cached = overlayCache.get(key)
    if (cached && cached.width >= need.width && cached.height >= need.height) {
      touchOverlayEntry(key, cached)
      return cached.canvas
    }
    const canvas = await renderOverlayAt(preset, need)
    cacheOverlay(key, canvas)
    return canvas
  }

  const key = getCompositeOverlayCacheKey(preset, target, logoSignature)
  const cached = overlayCache.get(key)
  if (cached) {
    touchOverlayEntry(key, cached)
    return cached.canvas
  }
  const canvas = await renderOverlayAt(preset, target)
  cacheOverlay(key, canvas)
  return canvas
}

async function getProjectLogosSignature(): Promise<string> {
  const { useCompositeV2Store } = await import('../storeV2')
  const logos = useCompositeV2Store.getState().projectLogos ?? []
  return logos.map((logo) => logo.assetId ?? logo.dataUrl ?? logo.id).join('|')
}

function sameRatio(a: Size, b: Size, tolerance = 0.01) {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return false
  return Math.abs(a.width / a.height - b.width / b.height) <= tolerance
}

/** 同比例下把 base 等比放大到能完全覆盖 target：保证放大输出不糊、缩小输出保持清晰 */
function coverSize(base: Size, target: Size): Size {
  const scale = Math.max(target.width / base.width, target.height / base.height, 1)
  return {
    width: Math.max(1, Math.round(base.width * scale)),
    height: Math.max(1, Math.round(base.height * scale)),
  }
}

async function renderOverlayAt(preset: CompositeV2Preset, size: Size): Promise<HTMLCanvasElement> {
  const overlay = document.createElement('canvas')
  overlay.width = size.width
  overlay.height = size.height
  const overlayCtx = overlay.getContext('2d')
  if (!overlayCtx) throw new Error('当前环境不支持 Canvas')
  for (const layer of [...preset.layers].reverse()) {
    if (layer.visible) await drawLayer(overlayCtx, layer, preset, size)
  }
  return overlay
}

async function resolveLayerImage(layer: CompositeV2MediaLayer) {
  if (!layer.asset) return null
  if (layer.asset.kind === 'dataUrl' && layer.asset.dataUrl) {
    return loadImage(layer.asset.dataUrl)
  }
  if (layer.asset.kind === 'stored') {
    const objectUrl = await getCompositeAssetObjectUrl(layer.asset.assetId)
    return objectUrl ? loadImage(objectUrl, `stored:${layer.asset.assetId}`) : null
  }
  const asset = layer.asset
  if (asset?.kind === 'project') {
    const { useCompositeV2Store } = await import('../storeV2')
    const logo = useCompositeV2Store.getState().projectLogos.find((l) => l.id === asset.id)
    if (logo?.assetId) {
      const objectUrl = await getCompositeAssetObjectUrl(logo.assetId)
      return objectUrl ? loadImage(objectUrl, `stored:${logo.assetId}`) : null
    }
    return logo?.dataUrl ? loadImage(logo.dataUrl, `project:${asset.id}`) : null
  }
  const path = 'path' in layer.asset ? layer.asset.path : undefined
  if (!path) return null
  const cacheKey = `path:${path}`
  const cached = imageCache.get(cacheKey)
  if (cached) return cached
  const api = window.electronAPI
  const payload = await api?.readImageFile?.(path)
  if (!payload?.dataUrl) return null
  return loadImage(payload.dataUrl, cacheKey)
}

function applyShadow(
  ctx: CanvasRenderingContext2D,
  layer: CompositeV2TextLayer | CompositeV2MediaLayer,
  base: Size,
  target: Size,
) {
  if (!layer.shadow.enabled) return
  const scaleX = target.width / base.width
  const scaleY = target.height / base.height
  const scale = Math.min(scaleX, scaleY)
  const alpha = Math.max(0, Math.min(1, layer.shadow.opacity))
  const hex = layer.shadow.color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i)
  ctx.shadowColor = hex
    ? `rgba(${Number.parseInt(hex[1]!, 16)}, ${Number.parseInt(hex[2]!, 16)}, ${Number.parseInt(hex[3]!, 16)}, ${alpha})`
    : layer.shadow.color
  ctx.shadowOffsetX = layer.shadow.x * scale
  ctx.shadowOffsetY = layer.shadow.y * scale
  ctx.shadowBlur = layer.shadow.blur * scale
}

async function drawLayer(
  ctx: CanvasRenderingContext2D,
  layer: CompositeV2TextLayer | CompositeV2MediaLayer,
  preset: CompositeV2Preset,
  target: Size,
) {
  const rect = mapLayerPositionToCanvas(layer.position, preset.baseCanvas, target)
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity))
  ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2)
  ctx.rotate((layer.rotation * Math.PI) / 180)
  applyShadow(ctx, layer, preset.baseCanvas, target)

  if (layer.type !== 'text') {
    const image = await resolveLayerImage(layer)
    if (image) {
      if (layer.clip) {
        const radius = Math.min(layer.radius, rect.width / 2, rect.height / 2)
        ctx.save()
        ctx.beginPath()
        ctx.roundRect(-rect.width / 2, -rect.height / 2, rect.width, rect.height, radius)
        ctx.clip()
        ctx.drawImage(image, -rect.width / 2, -rect.height / 2, rect.width, rect.height)
        ctx.restore()
      } else {
        ctx.drawImage(image, -rect.width / 2, -rect.height / 2, rect.width, rect.height)
      }
      const strokeWidth = getScaledLayerStrokeWidth(layer.stroke, preset.baseCanvas, target)
      if (strokeWidth > 0) {
        const radius = Math.min(layer.radius, rect.width / 2, rect.height / 2)
        ctx.beginPath()
        ctx.roundRect(-rect.width / 2, -rect.height / 2, rect.width, rect.height, radius)
        ctx.strokeStyle = layer.stroke?.color || '#111827'
        ctx.lineWidth = strokeWidth
        ctx.lineJoin = 'round'
        ctx.stroke()
      }
    }
  } else {
    const metrics = getScaledTextMetrics(layer.fontSize, layer.stroke?.width || 0, preset.baseCanvas, target)
    const scale = Math.min(target.width / preset.baseCanvas.width, target.height / preset.baseCanvas.height)
    const padding = (layer.padding ?? 5) * scale
    ctx.font = `${layer.fontWeight} ${metrics.fontSize}px ${layer.fontFamily}`
    ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing =
      `${layer.letterSpacing * Math.min(target.width / preset.baseCanvas.width, target.height / preset.baseCanvas.height)}px`
    ctx.fillStyle = layer.color
    ctx.textAlign = layer.align
    ctx.textBaseline = 'middle'
    const lines = layer.text.split('\n')
    const textX =
      layer.align === 'left' ? -rect.width / 2 + padding : layer.align === 'right' ? rect.width / 2 - padding : 0
    lines.forEach((line, index) => {
      const y = (index - (lines.length - 1) / 2) * metrics.fontSize * layer.lineHeight
      if (layer.stroke?.enabled && metrics.strokeWidth > 0) {
        ctx.strokeStyle = layer.stroke.color || '#000000'
        ctx.lineWidth = metrics.strokeWidth
        ctx.lineJoin = 'round'
        ctx.strokeText(line, textX, y, Math.max(1, rect.width - padding * 2))
      }
      ctx.fillText(line, textX, y, Math.max(1, rect.width - padding * 2))
    })
  }
  ctx.restore()
}

export async function renderCompositeV2ToCanvas(
  input: CompositeV2RenderInput,
  canvas: HTMLCanvasElement,
  options?: CompositeV2RenderOptions,
) {
  const background = input.backgroundDataUrl ? await loadImage(input.backgroundDataUrl) : null
  if (options?.isStale?.()) return canvas
  const overlay = await renderCombinedOverlay(input.preset, input.targetSize)
  if (options?.isStale?.()) return canvas

  canvas.width = input.targetSize.width
  canvas.height = input.targetSize.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前环境不支持 Canvas')
  ctx.clearRect(0, 0, input.targetSize.width, input.targetSize.height)

  if (background) {
    if (input.fitMode === 'contain-blur') {
      ctx.save()
      ctx.filter = 'blur(24px)'
      ctx.drawImage(background, -24, -24, input.targetSize.width + 48, input.targetSize.height + 48)
      ctx.restore()
    }
    const rect = planBackgroundFit(
      input.fitMode,
      { width: getSourceWidth(background), height: getSourceHeight(background) },
      input.targetSize,
    )
    ctx.drawImage(background, rect.sx, rect.sy, rect.sw, rect.sh, rect.dx, rect.dy, rect.dw, rect.dh)
  }

  // overlay 可能以更大的同比例基准尺寸渲染，这里统一缩放到目标尺寸（异比例时尺寸相等，等价 1:1 绘制）
  ctx.drawImage(overlay, 0, 0, input.targetSize.width, input.targetSize.height)
  return canvas
}

export async function renderCompositeV2ToJpegDataUrl(input: CompositeV2RenderInput) {
  const canvas = document.createElement('canvas')
  await renderCompositeV2ToCanvas(input, canvas)
  return canvas.toDataURL('image/jpeg', input.quality ?? 0.9)
}
