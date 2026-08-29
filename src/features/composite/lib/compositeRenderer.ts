import type {
  CompositeColorBlockLayer,
  CompositeImageLayer,
  CompositeLayer,
  CompositeLayerStyle,
  CompositePaintStyle,
  CompositePreset,
  CompositeTextLayer,
} from './compositeTypes'
import { createDefaultCompositeLayerStyle } from './compositeDefaults'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = src
  })
}

function layerRect(layer: CompositeLayer, canvas: HTMLCanvasElement) {
  return {
    x: canvas.width * (layer.x / 100),
    y: canvas.height * (layer.y / 100),
    width: canvas.width * (layer.width / 100),
    height: canvas.height * (layer.height / 100),
  }
}

function getLayerStyle(layer: CompositeLayer): CompositeLayerStyle {
  if (layer.style) return layer.style
  if (layer.type === 'text' || layer.type === 'watermark') return createDefaultCompositeLayerStyle(layer.color)
  if (layer.type === 'colorBlock') return createDefaultCompositeLayerStyle(layer.fill)
  return createDefaultCompositeLayerStyle('#ffffff')
}

function createPaint(ctx: CanvasRenderingContext2D, rect: ReturnType<typeof layerRect>, paint: CompositePaintStyle) {
  if (paint.type === 'linear-gradient') {
    const gradient = ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height)
    gradient.addColorStop(0, paint.color)
    gradient.addColorStop(1, paint.color2)
    return gradient
  }
  return paint.color
}

function applyShadow(ctx: CanvasRenderingContext2D, style: CompositeLayerStyle, scale: number) {
  if (!style.shadow.enabled) return
  ctx.shadowColor = hexToRgba(style.shadow.color, style.shadow.opacity)
  ctx.shadowOffsetX = style.shadow.x * scale
  ctx.shadowOffsetY = style.shadow.y * scale
  ctx.shadowBlur = style.shadow.blur * scale
}

function hexToRgba(hex: string, opacity: number) {
  const clean = hex.replace('#', '')
  const value =
    clean.length === 3
      ? clean
          .split('')
          .map((char) => char + char)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6)
  const r = Number.parseInt(value.slice(0, 2), 16)
  const g = Number.parseInt(value.slice(2, 4), 16)
  const b = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, opacity))})`
}

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2))
  ctx.beginPath()
  ctx.moveTo(x + safeRadius, y)
  ctx.lineTo(x + width - safeRadius, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius)
  ctx.lineTo(x + width, y + height - safeRadius)
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height)
  ctx.lineTo(x + safeRadius, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius)
  ctx.lineTo(x, y + safeRadius)
  ctx.quadraticCurveTo(x, y, x + safeRadius, y)
  ctx.closePath()
}

async function drawImageLayer(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, layer: CompositeImageLayer) {
  const src = layer.sourceDataUrl || layer.sourcePath
  if (!src) return
  const image = await loadImage(src)
  const rect = layerRect(layer, canvas)
  const style = getLayerStyle(layer)
  const scale = canvas.width / 1280
  const imageRatio = image.width / image.height
  const rectRatio = rect.width / rect.height
  const drawWidth = imageRatio > rectRatio ? rect.width : rect.height * imageRatio
  const drawHeight = imageRatio > rectRatio ? rect.width / imageRatio : rect.height
  const drawX = rect.x + (rect.width - drawWidth) / 2
  const drawY = rect.y + (rect.height - drawHeight) / 2
  ctx.save()
  applyShadow(ctx, style, scale)
  if (layer.mirrorX || layer.mirrorY) {
    ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2)
    ctx.scale(layer.mirrorX ? -1 : 1, layer.mirrorY ? -1 : 1)
    ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
  } else {
    ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight)
  }
  ctx.restore()
  if (style.stroke.enabled && style.stroke.width > 0) {
    ctx.save()
    ctx.strokeStyle = createPaint(ctx, rect, style.stroke.paint)
    ctx.lineWidth = style.stroke.width * scale
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)
    ctx.restore()
  }
}

function drawTextLayer(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, layer: CompositeTextLayer) {
  const rect = layerRect(layer, canvas)
  const style = getLayerStyle(layer)
  const scale = canvas.width / 1280
  const fontSize = Math.max(8, Math.round(layer.fontSize * (canvas.width / 1280)))
  ctx.font = `${layer.fontWeight} ${fontSize}px ${layer.fontFamily}`
  ctx.fillStyle = createPaint(ctx, rect, style.fill)
  ctx.strokeStyle = createPaint(ctx, rect, style.stroke.paint)
  ctx.lineWidth = Math.max(0, (style.stroke.enabled ? style.stroke.width : layer.strokeWidth) * scale)
  ctx.textAlign = layer.align
  ctx.textBaseline = 'middle'
  applyShadow(ctx, style, scale)
  const x = layer.align === 'left' ? rect.x : layer.align === 'right' ? rect.x + rect.width : rect.x + rect.width / 2
  const y = rect.y + rect.height / 2
  if ((style.stroke.enabled && style.stroke.width > 0) || layer.strokeWidth > 0)
    ctx.strokeText(layer.text, x, y, rect.width)
  ctx.fillText(layer.text, x, y, rect.width)
}

function drawColorBlockLayer(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  layer: CompositeColorBlockLayer,
) {
  const rect = layerRect(layer, canvas)
  const style = getLayerStyle(layer)
  const scale = canvas.width / 1280
  applyShadow(ctx, style, scale)
  if (style.outerGlow.enabled) {
    ctx.shadowColor = hexToRgba(style.outerGlow.color, style.outerGlow.opacity)
    ctx.shadowBlur = style.outerGlow.size * scale
  }
  ctx.fillStyle = createPaint(ctx, rect, style.fill)
  drawRoundRect(ctx, rect.x, rect.y, rect.width, rect.height, layer.radius * (canvas.width / 1280))
  ctx.fill()
  if (style.stroke.enabled && style.stroke.width > 0) {
    ctx.strokeStyle = createPaint(ctx, rect, style.stroke.paint)
    ctx.lineWidth = style.stroke.width * scale
    ctx.stroke()
  }
}

export async function renderCompositePresetToCanvas(preset: CompositePreset, canvas: HTMLCanvasElement) {
  canvas.width = preset.canvas.width
  canvas.height = preset.canvas.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前环境不支持 Canvas')
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  for (const layer of preset.layers) {
    if (!layer.enabled) continue
    ctx.save()
    ctx.globalAlpha = layer.opacity
    if (layer.type === 'background') {
      const src = layer.sourceDataUrl || layer.sourcePath
      if (src) {
        const image = await loadImage(src)
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      }
    } else if (layer.type === 'image' || layer.type === 'logo') {
      await drawImageLayer(ctx, canvas, layer)
    } else if (layer.type === 'text' || layer.type === 'watermark') {
      drawTextLayer(ctx, canvas, layer)
    } else if (layer.type === 'colorBlock') {
      drawColorBlockLayer(ctx, canvas, layer)
    }
    ctx.restore()
  }
}

export async function renderCompositePresetToDataUrl(preset: CompositePreset, quality = 0.92) {
  const canvas = document.createElement('canvas')
  await renderCompositePresetToCanvas(preset, canvas)
  return canvas.toDataURL('image/jpeg', quality)
}
