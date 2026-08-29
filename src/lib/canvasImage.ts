import { assertUsableMaskCoverage, classifyMaskAlpha, type MaskCoverage } from './mask'

export interface ImageDimensions {
  width: number
  height: number
}

export async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = dataUrl
  })
}

/** 可绘制的解码结果：普通 Image 或按 EXIF 方向矫正后的 ImageBitmap */
export type OrientedImageSource = HTMLImageElement | ImageBitmap

export function getSourceWidth(source: OrientedImageSource): number {
  return 'naturalWidth' in source ? source.naturalWidth : source.width
}

export function getSourceHeight(source: OrientedImageSource): number {
  return 'naturalHeight' in source ? source.naturalHeight : source.height
}

/**
 * 加载图片并应用 EXIF 方向（手机竖拍照片不再被错误旋转）。
 * 优先使用 createImageBitmap({ imageOrientation: 'from-image' })；
 * 环境不支持或解码失败时回退到普通 Image 解码。
 */
export async function loadImageOriented(src: string): Promise<OrientedImageSource> {
  if (typeof createImageBitmap === 'function') {
    try {
      const response = await fetch(src)
      const blob = await response.blob()
      return await createImageBitmap(blob, { imageOrientation: 'from-image' })
    } catch {
      // fall through：回退到普通解码
    }
  }
  return await loadImage(src)
}

export async function getImageDimensions(dataUrl: string): Promise<ImageDimensions> {
  const image = await loadImage(dataUrl)
  return { width: image.naturalWidth, height: image.naturalHeight }
}

/**
 * 把一张图等比缩小到 maxSize 以内的 webp dataURL，用于生成记录等仅需缩略图的场景。
 * 失败或原图已经足够小时原样返回，永不 reject。
 */
export async function createImageThumbnailDataUrl(dataUrl: string, maxSize = 512, quality = 0.85): Promise<string> {
  try {
    const image = await loadImage(dataUrl)
    const width = image.naturalWidth
    const height = image.naturalHeight
    if (width <= 0 || height <= 0) return dataUrl
    const scale = Math.min(1, maxSize / Math.max(width, height))
    if (scale >= 1) return dataUrl
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return dataUrl
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/webp', quality)
  } catch {
    return dataUrl
  }
}

export async function dataUrlToBlob(dataUrl: string, fallbackType = 'image/png'): Promise<Blob> {
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  return blob.type ? blob : new Blob([await blob.arrayBuffer()], { type: fallbackType })
}

export async function imageDataUrlToPngBlob(dataUrl: string): Promise<Blob> {
  const image = await loadImage(dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas')
  ctx.drawImage(image, 0, 0)
  return canvasToBlob(canvas, 'image/png')
}

export async function maskDataUrlToPngBlob(maskDataUrl: string): Promise<Blob> {
  const blob = await dataUrlToBlob(maskDataUrl, 'image/png')
  if (blob.type !== 'image/png') {
    return imageDataUrlToPngBlob(maskDataUrl)
  }
  return blob
}

export async function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('图片导出失败'))
        else resolve(blob)
      },
      type,
      quality,
    )
  })
}

export async function validateMaskMatchesImage(maskDataUrl: string, imageDataUrl: string): Promise<MaskCoverage> {
  const [maskImage, sourceImage] = await Promise.all([loadImage(maskDataUrl), loadImage(imageDataUrl)])
  if (maskImage.naturalWidth !== sourceImage.naturalWidth || maskImage.naturalHeight !== sourceImage.naturalHeight) {
    throw new Error('遮罩尺寸与遮罩主图不一致，请重新绘制遮罩')
  }

  const canvas = document.createElement('canvas')
  canvas.width = maskImage.naturalWidth
  canvas.height = maskImage.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('当前浏览器不支持 Canvas')
  ctx.drawImage(maskImage, 0, 0)
  const coverage = classifyMaskAlpha(ctx.getImageData(0, 0, canvas.width, canvas.height))
  assertUsableMaskCoverage(coverage)
  return coverage
}

export async function createMaskPreviewDataUrl(imageDataUrl: string, maskDataUrl: string): Promise<string> {
  const [image, mask] = await Promise.all([loadImage(imageDataUrl), loadImage(maskDataUrl)])
  if (image.naturalWidth !== mask.naturalWidth || image.naturalHeight !== mask.naturalHeight) {
    throw new Error('遮罩尺寸与遮罩主图不一致，请重新绘制遮罩')
  }

  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('当前浏览器不支持 Canvas')

  ctx.drawImage(image, 0, 0)

  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = mask.naturalWidth
  maskCanvas.height = mask.naturalHeight
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true })
  if (!maskCtx) throw new Error('当前浏览器不支持 Canvas')
  maskCtx.drawImage(mask, 0, 0)
  const maskPixels = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height)

  const overlay = ctx.createImageData(canvas.width, canvas.height)
  for (let i = 0; i < maskPixels.data.length; i += 4) {
    const editStrength = 255 - maskPixels.data[i + 3]
    overlay.data[i] = 59
    overlay.data[i + 1] = 130
    overlay.data[i + 2] = 246
    overlay.data[i + 3] = Math.round(editStrength * 0.58)
  }

  const overlayCanvas = document.createElement('canvas')
  overlayCanvas.width = canvas.width
  overlayCanvas.height = canvas.height
  const overlayCtx = overlayCanvas.getContext('2d')
  if (!overlayCtx) throw new Error('当前浏览器不支持 Canvas')
  overlayCtx.putImageData(overlay, 0, 0)
  ctx.drawImage(overlayCanvas, 0, 0)
  return canvas.toDataURL('image/png')
}
