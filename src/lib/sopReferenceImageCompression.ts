import { canvasToBlob, getSourceHeight, getSourceWidth, loadImageOriented } from './canvasImage'

export const MAX_SOP_REFERENCE_IMAGE_SEND_BYTES = 4 * 1024 * 1024

const MAX_SOP_REFERENCE_IMAGE_DIMENSION = 4096
const INITIAL_JPEG_QUALITY = 0.9
const MIN_JPEG_QUALITY = 0.2
const COMPRESSION_QUALITY_STEPS = 7
const MAX_RESIZE_ATTEMPTS = 6

export interface SopReferenceImageCompressionResult {
  dataUrl: string
  compressed: boolean
  originalBytes: number
  finalBytes: number
}

export function getDataUrlDecodedByteSize(dataUrl: string) {
  const commaIndex = dataUrl.indexOf(',')
  if (commaIndex < 0) return dataUrl.length

  const metadata = dataUrl.slice(0, commaIndex)
  const payload = dataUrl.slice(commaIndex + 1)
  if (!/;base64/i.test(metadata)) {
    try {
      return new TextEncoder().encode(decodeURIComponent(payload)).byteLength
    } catch {
      return payload.length
    }
  }

  const normalized = payload.replace(/\s/g, '')
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding)
}

export async function compressSopReferenceImageIfNeeded(
  dataUrl: string,
  maxBytes = MAX_SOP_REFERENCE_IMAGE_SEND_BYTES,
): Promise<SopReferenceImageCompressionResult> {
  const originalBytes = getDataUrlDecodedByteSize(dataUrl)
  if (originalBytes <= maxBytes) {
    return { dataUrl, compressed: false, originalBytes, finalBytes: originalBytes }
  }

  const image = await loadImageOriented(dataUrl)
  try {
    const sourceWidth = getSourceWidth(image)
    const sourceHeight = getSourceHeight(image)
    if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
      throw new Error('参考图片尺寸无效')
    }

    let scale = Math.min(1, MAX_SOP_REFERENCE_IMAGE_DIMENSION / Math.max(sourceWidth, sourceHeight))
    for (let attempt = 0; attempt < MAX_RESIZE_ATTEMPTS; attempt += 1) {
      const width = Math.max(1, Math.round(sourceWidth * scale))
      const height = Math.max(1, Math.round(sourceHeight * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('当前浏览器不支持图片压缩')

      context.fillStyle = 'white'
      context.fillRect(0, 0, width, height)
      context.drawImage(image, 0, 0, width, height)

      const compressed = await encodeJpegWithinLimit(canvas, maxBytes)
      if (compressed) {
        const compressedDataUrl = await blobToDataUrl(compressed)
        return {
          dataUrl: compressedDataUrl,
          compressed: true,
          originalBytes,
          finalBytes: compressed.size,
        }
      }

      scale *= 0.8
    }
  } finally {
    if ('close' in image && typeof image.close === 'function') image.close()
  }

  throw new Error('参考图片过大，自动压缩后仍无法满足发送大小限制')
}

async function encodeJpegWithinLimit(canvas: HTMLCanvasElement, maxBytes: number): Promise<Blob | null> {
  let low = MIN_JPEG_QUALITY
  let high = INITIAL_JPEG_QUALITY
  let best: Blob | null = null

  for (let step = 0; step < COMPRESSION_QUALITY_STEPS; step += 1) {
    const quality = (low + high) / 2
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality)
    if (blob.size <= maxBytes) {
      best = blob
      low = quality
    } else {
      high = quality
    }
  }

  if (best) return best

  const smallest = await canvasToBlob(canvas, 'image/jpeg', MIN_JPEG_QUALITY)
  return smallest.size <= maxBytes ? smallest : null
}

async function blobToDataUrl(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('压缩图片导出失败'))
    reader.onerror = () => reject(new Error('压缩图片导出失败'))
    reader.readAsDataURL(blob)
  })
}
