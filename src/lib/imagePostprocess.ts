import type { TaskParams } from '../types'
import { MIME_MAP } from './imageApiShared'
import { canvasToBlob, getSourceHeight, getSourceWidth, loadImageOriented } from './canvasImage'

/** 浏览器 Canvas 面积上限（16384×16384），超过后绘制/编码会静默失败或花屏 */
const MAX_CANVAS_PIXELS = 16384 * 16384

export interface PostprocessResizePlan {
  width: number
  height: number
}

export interface PostprocessEncodePlan {
  format: TaskParams['output_format'] | null
  mime: string | null
  maxSizeBytes?: number
}

export interface ImagePostprocessPlan {
  enabled: boolean
  resize: PostprocessResizePlan | null
  encode: PostprocessEncodePlan
}

export interface ProcessImageResult {
  dataUrl: string
  actualParams: Partial<TaskParams>
}

export function getImagePostprocessPlan(params: TaskParams): ImagePostprocessPlan {
  const resize = params.postprocess_resize_enabled ? parseNormalizedSize(params.postprocess_size) : null
  const encode = params.postprocess_compress_enabled
    ? getEncodePlan(params.postprocess_format, params.postprocess_max_size_kb)
    : { format: null, mime: null }

  return {
    enabled: Boolean(resize || encode.mime),
    resize,
    encode,
  }
}

export async function postprocessGeneratedImage(dataUrl: string, params: TaskParams): Promise<ProcessImageResult> {
  const plan = getImagePostprocessPlan(params)
  if (!plan.enabled) {
    return { dataUrl, actualParams: {} }
  }

  const image = await loadImageOriented(dataUrl)
  const width = plan.resize?.width ?? getSourceWidth(image)
  const height = plan.resize?.height ?? getSourceHeight(image)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Local image postprocessing failed: invalid image dimensions')
  }
  if (width * height > MAX_CANVAS_PIXELS) {
    throw new Error('图片尺寸过大，超出浏览器 Canvas 上限（16384×16384），请先在生成参数中缩小尺寸')
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas')

  const requestedExplicitMime = canonicalizeImageMime(plan.encode.mime)
  const requestedMime = requestedExplicitMime ?? canonicalizeImageMime(getDataUrlMime(dataUrl)) ?? 'image/png'
  if (requestedMime === 'image/jpeg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
  }
  ctx.drawImage(image, 0, 0, width, height)

  const blob = await encodeCanvasToTargetSize(canvas, requestedMime, plan.encode.maxSizeBytes)
  const finalMime = canonicalizeImageMime(blob.type || requestedMime) ?? requestedMime
  if (requestedExplicitMime && finalMime !== requestedExplicitMime) {
    throw new Error(`Local image postprocessing failed: ${requestedMime} output is not supported`)
  }

  const outputFormat = getOutputFormatFromMime(finalMime)
  return {
    dataUrl: await blobToDataUrl(blob, finalMime),
    actualParams: {
      size: `${width}x${height}`,
      ...(outputFormat ? { output_format: outputFormat } : {}),
    },
  }
}

export function mergePostprocessedActualParams(
  original: Partial<TaskParams> | undefined,
  postprocessed: Partial<TaskParams> | undefined,
): Partial<TaskParams> | undefined {
  const merged = { ...(original ?? {}), ...(postprocessed ?? {}) }
  return Object.keys(merged).length ? merged : undefined
}

function parseNormalizedSize(size: string): PostprocessResizePlan | null {
  const match = size.trim().match(/^(\d+)\s*[xX×]\s*(\d+)$/)
  if (!match) return null

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }

  return { width, height }
}

function getEncodePlan(format: TaskParams['output_format'], maxSizeKb: number | null): PostprocessEncodePlan {
  const mime = MIME_MAP[format]
  if (!mime) throw new Error('Local postprocess format is invalid')

  return {
    format,
    mime,
    maxSizeBytes: normalizeMaxSizeBytes(maxSizeKb),
  }
}

function normalizeMaxSizeBytes(value: number | null): number {
  const maxSizeKb = value == null || !Number.isFinite(value) ? 399 : value
  return Math.max(1, Math.round(maxSizeKb)) * 1024
}

async function encodeCanvasToTargetSize(
  canvas: HTMLCanvasElement,
  mime: string,
  maxSizeBytes: number | undefined,
): Promise<Blob> {
  if (!maxSizeBytes) return await canvasToBlob(canvas, mime, undefined)

  if (mime === 'image/png') {
    const blob = await canvasToBlob(canvas, mime, undefined)
    if (blob.size > maxSizeBytes) {
      throw new Error('Local image postprocessing failed: PNG output exceeds target size')
    }
    return blob
  }

  if (mime !== 'image/jpeg' && mime !== 'image/webp') {
    const blob = await canvasToBlob(canvas, mime, undefined)
    if (blob.size > maxSizeBytes) {
      throw new Error('Local image postprocessing failed: output exceeds target size')
    }
    return blob
  }

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

  throw new Error('Local image postprocessing failed: cannot compress output to target size')
}

function canonicalizeImageMime(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase()
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'image/jpeg'
  if (normalized === 'image/png') return 'image/png'
  if (normalized === 'image/webp') return 'image/webp'
  return null
}

function getDataUrlMime(dataUrl: string): string | null {
  const match = /^data:([^;,]+)(?:;[^,]*)?,/i.exec(dataUrl)
  return match ? match[1].toLowerCase() : null
}

function getOutputFormatFromMime(mime: string | null): TaskParams['output_format'] | undefined {
  if (mime === 'image/jpeg') return 'jpeg'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/png') return 'png'
  return undefined
}

async function blobToDataUrl(blob: Blob, fallbackMime: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      resolve(typeof reader.result === 'string' ? reader.result : `data:${blob.type || fallbackMime};base64,`)
    reader.onerror = () => reject(new Error('图片导出失败'))
    reader.readAsDataURL(blob)
  })
}
