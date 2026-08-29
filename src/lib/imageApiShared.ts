import type { AppSettings, TaskParams } from '../types'
import { apiFetch as fetch } from './desktopApiFetch'

export const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

export const MAX_MASK_EDIT_FILE_BYTES = 50 * 1024 * 1024
export const MAX_IMAGE_INPUT_PAYLOAD_BYTES = 512 * 1024 * 1024

export interface CallApiOptions {
  settings: AppSettings
  prompt: string
  params: TaskParams
  /** 输入图片的 data URL 列表 */
  inputImageDataUrls: string[]
  maskDataUrl?: string
  /** 任务级取消信号：任务停止时中止在途请求/轮询 */
  signal?: AbortSignal
  onFalRequestEnqueued?: (request: { requestId: string; endpoint: string }) => void | Promise<void>
  onCustomTaskEnqueued?: (task: { taskId: string }) => void | Promise<void>
  onPartialImage?: (partial: { image: string; partialImageIndex?: number; requestIndex?: number }) => void
}

export interface CallApiResult {
  /** base64 data URL 列表 */
  images: string[]
  /** API 返回的实际生效参数 */
  actualParams?: Partial<TaskParams>
  /** 每张图片对应的实际生效参数 */
  actualParamsList?: Array<Partial<TaskParams> | undefined>
  /** 每张图片对应的 API 改写提示词 */
  revisedPrompts?: Array<string | undefined>
  /** API 返回的原始图片 HTTP URL（非 base64 时记录） */
  rawImageUrls?: string[]
}

export function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

export function isDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:')
}

export function normalizeBase64Image(value: string, fallbackMime: string): string {
  return value.startsWith('data:') ? value : `data:${fallbackMime};base64,${value}`
}

function formatMiB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

export function getDataUrlEncodedByteSize(dataUrl: string): number {
  return dataUrl.length
}

export function getDataUrlDecodedByteSize(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(',')
  if (commaIndex < 0) return dataUrl.length

  const meta = dataUrl.slice(0, commaIndex)
  const payload = dataUrl.slice(commaIndex + 1)
  if (!/;base64/i.test(meta)) return decodeURIComponent(payload).length

  const normalized = payload.replace(/\s/g, '')
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding)
}

function assertMaxBytes(label: string, bytes: number, maxBytes: number) {
  if (bytes > maxBytes) {
    throw new Error(`${label}过大：${formatMiB(bytes)}，上限为 ${formatMiB(maxBytes)}`)
  }
}

export function assertImageInputPayloadSize(bytes: number) {
  assertMaxBytes('图像输入有效负载总大小', bytes, MAX_IMAGE_INPUT_PAYLOAD_BYTES)
}

export function assertMaskEditFileSize(label: string, bytes: number) {
  assertMaxBytes(label, bytes, MAX_MASK_EDIT_FILE_BYTES)
}

async function blobToDataUrl(blob: Blob, fallbackMime: string): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''

  for (let i = 0; i < bytes.length; i += 0x8000) {
    const chunk = bytes.subarray(i, i + 0x8000)
    binary += String.fromCharCode(...chunk)
  }

  return `data:${blob.type || fallbackMime};base64,${btoa(binary)}`
}

export const IMAGE_FETCH_CORS_HINT = ' 可点链接按钮复制结果链接，或尝试开启「返回 Base64 图片数据」避免此问题。'
export const STREAMING_UNSUPPORTED_HINT = '提示：当前使用的 API 可能不支持流式传输，请尝试关闭「流式传输」功能。'
export const STREAMING_FORMAT_HINT = '提示：API 返回了无法解析的流式数据格式，请尝试关闭「流式传输」功能。'

export function appendStreamingUnsupportedHint(message: string): string {
  return message ? `${message}\n${STREAMING_UNSUPPORTED_HINT}` : STREAMING_UNSUPPORTED_HINT
}

export function appendStreamingFormatHint(message: string): string {
  return message ? `${message}\n${STREAMING_FORMAT_HINT}` : STREAMING_FORMAT_HINT
}

export function maybeAppendStreamingHint(message: string, status: number, streamImages?: boolean): string {
  if (!streamImages) return message
  if (status === 401 || status === 403 || status === 404 || status === 408 || status === 429 || status >= 500)
    return message
  return appendStreamingUnsupportedHint(message)
}

async function probeNoCorsReachability(url: string, timeoutMs = 8000): Promise<'opaque' | 'reachable' | 'failed'> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    })
    return response.type === 'opaque' ? 'opaque' : 'reachable'
  } catch {
    return 'failed'
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function fetchImageUrlAsDataUrl(url: string, fallbackMime: string, signal?: AbortSignal): Promise<string> {
  if (isDataUrl(url)) return url

  let response: Response
  try {
    response = await fetch(url, {
      cache: 'no-store',
      signal,
    })
  } catch (err) {
    if (err instanceof TypeError) {
      const probe = await probeNoCorsReachability(url)
      if (probe === 'opaque') {
        throw new Error(`图片已生成，但因服务商未允许跨域，图片链接下载失败。${IMAGE_FETCH_CORS_HINT}`, { cause: err })
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error(`图片链接下载失败（网络不可用）。${IMAGE_FETCH_CORS_HINT}`, { cause: err })
      }
      throw new Error(`图片链接下载失败（可能因跨域限制、链接过期或网络异常）。${IMAGE_FETCH_CORS_HINT}`, {
        cause: err,
      })
    }
    throw err
  }

  if (!response.ok) {
    throw new Error(`图片 URL 下载失败：HTTP ${response.status}`)
  }

  const blob = await response.blob()
  return blobToDataUrl(blob, fallbackMime)
}

export async function getApiErrorMessage(response: Response): Promise<string> {
  const statusLabel = `HTTP ${response.status}`
  let errorMsg = ''
  try {
    const rawText = await response.text()
    if (!rawText.trim()) return statusLabel
    let errJson: unknown
    try {
      errJson = JSON.parse(rawText)
    } catch {
      errorMsg = rawText.trim()
      return errorMsg.startsWith(statusLabel) ? errorMsg : `${statusLabel}: ${errorMsg}`
    }
    if (errJson && typeof errJson === 'object') {
      const body = errJson as Record<string, unknown>
      const errorValue = body.error
      if (errorValue && typeof errorValue === 'object' && 'message' in errorValue && errorValue.message) {
        errorMsg = String(errorValue.message)
      } else if (typeof body.detail === 'string') {
        errorMsg = body.detail
      } else if (Array.isArray(body.detail)) {
        errorMsg = body.detail
          .map((item: unknown) => (typeof item === 'string' ? item : JSON.stringify(item)))
          .join('\n')
      } else if (typeof body.error === 'string') {
        errorMsg = body.error
      } else if (body.message) {
        errorMsg = String(body.message)
      }
    }
  } catch {
    return statusLabel
  }
  if (!errorMsg) return statusLabel
  return errorMsg.startsWith(statusLabel) ? errorMsg : `${statusLabel}: ${errorMsg}`
}

export function pickActualParams(source: unknown): Partial<TaskParams> {
  if (!source || typeof source !== 'object') return {}
  const record = source as Record<string, unknown>
  const actualParams: Partial<TaskParams> = {}

  if (typeof record.size === 'string') actualParams.size = record.size
  if (
    record.quality === 'auto' ||
    record.quality === 'low' ||
    record.quality === 'medium' ||
    record.quality === 'high'
  ) {
    actualParams.quality = record.quality
  }
  if (record.output_format === 'png' || record.output_format === 'jpeg' || record.output_format === 'webp') {
    actualParams.output_format = record.output_format
  }
  if (typeof record.output_compression === 'number') actualParams.output_compression = record.output_compression
  if (record.moderation === 'auto' || record.moderation === 'low') actualParams.moderation = record.moderation
  if (typeof record.n === 'number') actualParams.n = record.n

  return actualParams
}

export function mergeActualParams(...sources: Array<Partial<TaskParams> | undefined>): Partial<TaskParams> | undefined {
  const merged = Object.assign({}, ...sources.filter((source) => source && Object.keys(source).length))
  return Object.keys(merged).length ? merged : undefined
}

export function isRetryableError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message || ''
    if (/^HTTP (?:408|429|5\d{2})\b/.test(msg)) return true
    if (/rate.?limit/i.test(msg)) return true
    if (/timeout/i.test(msg)) return true
    if (/network|failed to fetch|fetch failed|load failed/i.test(msg)) return true
    if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(msg)) return true
  }
  return false
}

export async function retryTransientRequest<T>(
  handler: (attempt: number) => Promise<T>,
  options: {
    maxRetries: number
    signal?: AbortSignal
    shouldRetry?: (error: unknown, attempt: number) => boolean
  },
): Promise<T> {
  let lastError: unknown
  const maxRetries = Math.max(0, Math.trunc(options.maxRetries))

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (options.signal?.aborted) {
      throw options.signal.reason instanceof Error
        ? options.signal.reason
        : new DOMException('请求已停止', 'AbortError')
    }
    if (attempt > 0) {
      const delayMs = Math.min(30_000, 1000 * Math.pow(2, attempt - 1))
      await new Promise<void>((resolve, reject) => {
        const finish = () => {
          options.signal?.removeEventListener('abort', abort)
          resolve()
        }
        const abort = () => {
          clearTimeout(timer)
          reject(
            options.signal?.reason instanceof Error
              ? options.signal.reason
              : new DOMException('请求已停止', 'AbortError'),
          )
        }
        const timer = setTimeout(finish, delayMs)
        options.signal?.addEventListener('abort', abort, { once: true })
      })
    }

    try {
      return await handler(attempt)
    } catch (error) {
      lastError = error
      const retryable = options.shouldRetry ? options.shouldRetry(error, attempt) : isRetryableError(error)
      if (attempt >= maxRetries || !retryable) throw error
    }
  }

  throw lastError
}

export async function runWithConcurrencyAndRetry<T, R>(
  items: T[],
  concurrency: number,
  maxRetries: number,
  handler: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<PromiseSettledResult<R>[]> {
  if (items.length === 0) return []
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let nextIndex = 0

  const worker = async () => {
    while (nextIndex < items.length) {
      if (signal?.aborted) {
        const reason = signal.reason instanceof Error ? signal.reason : new DOMException('任务已停止', 'AbortError')
        results[nextIndex] = { status: 'rejected', reason }
        nextIndex++
        continue
      }
      const index = nextIndex++
      const item = items[index]
      let lastError: unknown = undefined
      let succeeded = false

      try {
        const result = await retryTransientRequest(() => handler(item, index), { maxRetries, signal })
        results[index] = { status: 'fulfilled', value: result }
        succeeded = true
      } catch (err) {
        lastError = err
      }

      if (!succeeded) {
        results[index] = { status: 'rejected', reason: lastError }
      }
    }
  }

  const workerCount = Math.min(concurrency, items.length)
  const workers = Array.from({ length: workerCount }, () => worker())
  await Promise.all(workers)
  return results
}
