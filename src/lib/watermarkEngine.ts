import { type WatermarkTemplate, type ExportRule, type WatermarkAnchor } from '../storePostprocess'
import { loadImage, canvasToBlob } from './canvasImage'

export interface ProcessImageOptions {
  imageDataUrl: string
  template: WatermarkTemplate | null
  rule: ExportRule
}

function calculateAnchorPosition(
  anchor: WatermarkAnchor,
  boxWidth: number,
  boxHeight: number,
  containerWidth: number,
  containerHeight: number,
  marginX: number,
  marginY: number,
): { x: number; y: number } {
  let x = 0
  let y = 0

  if (anchor.includes('left')) {
    x = marginX
  } else if (anchor.includes('right')) {
    x = containerWidth - boxWidth - marginX
  } else {
    // center horizontally
    x = (containerWidth - boxWidth) / 2
  }

  if (anchor.includes('top')) {
    y = marginY
  } else if (anchor.includes('bottom')) {
    y = containerHeight - boxHeight - marginY
  } else {
    // center vertically
    y = (containerHeight - boxHeight) / 2
  }

  return { x, y }
}

async function renderWatermark(
  ctx: CanvasRenderingContext2D,
  template: WatermarkTemplate,
  containerWidth: number,
  containerHeight: number,
) {
  const baseSize = Math.min(containerWidth, containerHeight)
  const scaleSize = baseSize * (template.scalePercent / 100)
  const marginSize = baseSize * (template.marginPercent / 100)

  let logoImage: HTMLImageElement | null = null
  let logoAspect = 1

  if ((template.type === 'image' || template.type === 'image-text') && template.logoUrl) {
    try {
      logoImage = await loadImage(template.logoUrl)
      logoAspect = logoImage.naturalWidth / Math.max(1, logoImage.naturalHeight)
    } catch (e) {
      console.warn('Failed to load watermark logo:', e)
    }
  }

  const gapSize = baseSize * ((template.gapPercent || 2) / 100)

  // Measure dimensions
  let logoW = 0
  let logoH = 0
  if (logoImage) {
    if (template.type === 'image') {
      // Scale by long edge to fit scaleSize
      if (logoAspect > 1) {
        logoW = scaleSize
        logoH = scaleSize / logoAspect
      } else {
        logoH = scaleSize
        logoW = scaleSize * logoAspect
      }
    } else {
      // In image-text, logo height is matched to scaleSize
      logoH = scaleSize
      logoW = scaleSize * logoAspect
    }
  }

  let textW = 0
  let textH = 0
  let fontString = ''
  if ((template.type === 'text' || template.type === 'image-text') && template.text) {
    const fontSize = scaleSize
    fontString = `${template.fontWeight || 700} ${fontSize}px ${template.fontFamily || 'sans-serif'}`
    ctx.font = fontString
    const metrics = ctx.measureText(template.text)
    textW = metrics.width
    textH = fontSize // Approx line height
  }

  // Calculate Bounding Box
  let boxW = 0
  let boxH = 0

  if (template.type === 'image') {
    boxW = logoW
    boxH = logoH
  } else if (template.type === 'text') {
    boxW = textW
    boxH = textH
  } else if (template.type === 'image-text') {
    if (template.layout === 'logo-top') {
      boxW = Math.max(logoW, textW)
      boxH = logoH + gapSize + textH
    } else {
      // logo-left
      boxW = logoW + gapSize + textW
      boxH = Math.max(logoH, textH)
    }
  }

  const { x, y } = calculateAnchorPosition(
    template.anchor,
    boxW,
    boxH,
    containerWidth,
    containerHeight,
    marginSize,
    marginSize,
  )

  // Draw
  ctx.save()

  if (template.type === 'image' && logoImage) {
    ctx.drawImage(logoImage, x, y, logoW, logoH)
  } else if (template.type === 'text' && template.text) {
    ctx.font = fontString
    ctx.fillStyle = template.textColor || '#ffffff'
    ctx.textBaseline = 'top'
    if (template.strokeWidth && template.strokeWidth > 0) {
      ctx.lineWidth = template.strokeWidth * (scaleSize / 40) // scale stroke relative to font size
      ctx.strokeStyle = template.strokeColor || '#000000'
      ctx.strokeText(template.text, x, y)
    }
    ctx.fillText(template.text, x, y)
  } else if (template.type === 'image-text') {
    let currentX = x
    let currentY = y

    if (template.layout === 'logo-top') {
      // Draw Logo centered horizontally
      if (logoImage) {
        ctx.drawImage(logoImage, currentX + (boxW - logoW) / 2, currentY, logoW, logoH)
      }
      currentY += logoH + gapSize
      // Draw Text centered horizontally
      if (template.text) {
        ctx.font = fontString
        ctx.fillStyle = template.textColor || '#ffffff'
        ctx.textBaseline = 'top'
        const tx = currentX + (boxW - textW) / 2
        if (template.strokeWidth && template.strokeWidth > 0) {
          ctx.lineWidth = template.strokeWidth * (scaleSize / 40)
          ctx.strokeStyle = template.strokeColor || '#000000'
          ctx.strokeText(template.text, tx, currentY)
        }
        ctx.fillText(template.text, tx, currentY)
      }
    } else {
      // logo-left
      // Draw Logo centered vertically
      if (logoImage) {
        ctx.drawImage(logoImage, currentX, currentY + (boxH - logoH) / 2, logoW, logoH)
      }
      currentX += logoW + gapSize
      // Draw Text centered vertically
      if (template.text) {
        ctx.font = fontString
        ctx.fillStyle = template.textColor || '#ffffff'
        ctx.textBaseline = 'middle' // Use middle for vertical center
        const ty = currentY + boxH / 2
        if (template.strokeWidth && template.strokeWidth > 0) {
          ctx.lineWidth = template.strokeWidth * (scaleSize / 40)
          ctx.strokeStyle = template.strokeColor || '#000000'
          ctx.strokeText(template.text, currentX, ty)
        }
        ctx.fillText(template.text, currentX, ty)
      }
    }
  }

  ctx.restore()
}

export async function processImageWithRule(options: ProcessImageOptions): Promise<Blob> {
  const { imageDataUrl, template, rule } = options
  const image = await loadImage(imageDataUrl)

  let targetW = image.naturalWidth
  let targetH = image.naturalHeight

  if (rule.resizeEnabled && rule.targetWidth && rule.targetHeight) {
    targetW = rule.targetWidth
    targetH = rule.targetHeight
  }

  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas')

  // Draw background for JPEG
  if (rule.format === 'jpeg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, targetW, targetH)
  } else {
    // Transparent background for PNG/WEBP if contain mode leaves blank space
    ctx.clearRect(0, 0, targetW, targetH)
  }

  // Draw source image
  if (rule.resizeEnabled && rule.targetWidth && rule.targetHeight) {
    const srcAspect = image.naturalWidth / image.naturalHeight
    const dstAspect = targetW / targetH

    if (rule.resizeMode === 'cover') {
      let srcW = image.naturalWidth
      let srcH = image.naturalHeight
      let srcX = 0
      let srcY = 0

      if (srcAspect > dstAspect) {
        srcW = image.naturalHeight * dstAspect
        srcX = (image.naturalWidth - srcW) / 2
      } else {
        srcH = image.naturalWidth / dstAspect
        srcY = (image.naturalHeight - srcH) / 2
      }
      ctx.drawImage(image, srcX, srcY, srcW, srcH, 0, 0, targetW, targetH)
    } else {
      // contain
      let dstW = targetW
      let dstH = targetH
      let dstX = 0
      let dstY = 0

      if (srcAspect > dstAspect) {
        dstH = targetW / srcAspect
        dstY = (targetH - dstH) / 2
      } else {
        dstW = targetH * srcAspect
        dstX = (targetW - dstW) / 2
      }
      ctx.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight, dstX, dstY, dstW, dstH)
    }
  } else {
    ctx.drawImage(image, 0, 0, targetW, targetH)
  }

  // Draw watermark
  if (template) {
    await renderWatermark(ctx, template, targetW, targetH)
  }

  // Compression
  const mime = `image/${rule.format}`

  if (!rule.compressEnabled || !rule.maxSizeKb) {
    return await canvasToBlob(canvas, mime, 0.95) // default quality
  }

  const maxSizeBytes = rule.maxSizeKb * 1024

  if (mime === 'image/png') {
    const blob = await canvasToBlob(canvas, mime)
    if (blob.size > maxSizeBytes) {
      throw new Error('PNG 格式无法压缩到指定大小')
    }
    return blob
  }

  // Binary search for JPEG/WEBP quality
  let low = 0.05
  let high = 0.95
  let bestBlob: Blob | null = null

  for (let i = 0; i < 8; i += 1) {
    const quality = (low + high) / 2
    const blob = await canvasToBlob(canvas, mime, quality)

    if (blob.size <= maxSizeBytes) {
      bestBlob = blob
      low = quality
    } else {
      high = quality
    }
  }

  if (bestBlob) return bestBlob

  const smallestBlob = await canvasToBlob(canvas, mime, 0.01)
  if (smallestBlob.size <= maxSizeBytes) return smallestBlob

  throw new Error(`无法将图片压缩至 ${rule.maxSizeKb}KB 以下，请尝试缩小尺寸`)
}

export function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}
