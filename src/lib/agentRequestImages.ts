import { compressSopReferenceImageIfNeeded } from './sopReferenceImageCompression'

export const MAX_AGENT_REQUEST_IMAGE_ENCODED_BYTES = 7 * 1024 * 1024
export const MAX_AGENT_SINGLE_IMAGE_ENCODED_BYTES = 4 * 1024 * 1024

const MIN_AGENT_IMAGE_ENCODED_BYTES = 64 * 1024
const OMITTED_IMAGE_TEXT = '<image_omitted />'

type CompressAgentImage = (dataUrl: string, maxDecodedBytes: number) => Promise<{ dataUrl: string }>

export interface PrepareAgentImagesOptions {
  maxTotalEncodedBytes?: number
  maxSingleEncodedBytes?: number
  signal?: AbortSignal
  compressImage?: CompressAgentImage
}

function isDataUrl(value: string) {
  return value.startsWith('data:')
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new DOMException('任务已停止', 'AbortError')
}

function getDecodedLimitForEncodedLimit(encodedLimit: number) {
  return Math.max(1, Math.floor((Math.max(0, encodedLimit - 256) * 3) / 4))
}

export async function prepareAgentImageDataUrls(
  dataUrls: string[],
  options: PrepareAgentImagesOptions = {},
): Promise<Array<string | null>> {
  const maxTotalEncodedBytes = options.maxTotalEncodedBytes ?? MAX_AGENT_REQUEST_IMAGE_ENCODED_BYTES
  const maxSingleEncodedBytes = options.maxSingleEncodedBytes ?? MAX_AGENT_SINGLE_IMAGE_ENCODED_BYTES
  const compressImage = options.compressImage ?? compressSopReferenceImageIfNeeded
  const prepared = dataUrls.map((dataUrl) => (isDataUrl(dataUrl) ? null : dataUrl))
  let remainingBytes = maxTotalEncodedBytes
  let dataImageIndex = 0

  // 从最新图片开始分配预算，历史图片只在空间允许时继续携带。
  for (let index = dataUrls.length - 1; index >= 0; index -= 1) {
    throwIfAborted(options.signal)

    const dataUrl = dataUrls[index]
    if (!isDataUrl(dataUrl)) continue

    const isNewestDataImage = dataImageIndex === 0
    dataImageIndex += 1
    const originalBytes = dataUrl.length
    const targetBytes = Math.min(maxSingleEncodedBytes, remainingBytes)

    if (targetBytes < MIN_AGENT_IMAGE_ENCODED_BYTES) {
      if (isNewestDataImage) throw new Error('Agent 参考图片过大，请减少图片数量或尺寸后重试')
      continue
    }

    if (originalBytes <= targetBytes) {
      prepared[index] = dataUrl
      remainingBytes -= originalBytes
      continue
    }

    try {
      const result = await compressImage(dataUrl, getDecodedLimitForEncodedLimit(targetBytes))
      throwIfAborted(options.signal)
      if (!result.dataUrl || result.dataUrl.length > targetBytes) {
        throw new Error('压缩后的图片仍然过大')
      }
      prepared[index] = result.dataUrl
      remainingBytes -= result.dataUrl.length
    } catch (error) {
      if (isNewestDataImage) {
        throw new Error('Agent 参考图片过大，压缩后仍无法发送，请减少图片尺寸后重试', { cause: error })
      }
    }
  }

  return prepared
}

function collectAgentImageParts(value: unknown, result: Array<Record<string, unknown>>, seen: WeakSet<object>) {
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)

  if (Array.isArray(value)) {
    for (const item of value) collectAgentImageParts(item, result, seen)
    return
  }

  const record = value as Record<string, unknown>
  if (record.type === 'input_image' && typeof record.image_url === 'string' && isDataUrl(record.image_url)) {
    result.push(record)
    return
  }

  for (const item of Object.values(record)) collectAgentImageParts(item, result, seen)
}

function replaceAgentImageParts(value: unknown, replacements: Map<Record<string, unknown>, string | null>): unknown {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => replaceAgentImageParts(item, replacements))

  const record = value as Record<string, unknown>
  if (replacements.has(record)) {
    const replacement = replacements.get(record)
    return replacement ? { ...record, image_url: replacement } : { type: 'input_text', text: OMITTED_IMAGE_TEXT }
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, replaceAgentImageParts(item, replacements)]),
  )
}

export async function prepareAgentInputImages(
  input: unknown,
  options: PrepareAgentImagesOptions = {},
): Promise<unknown> {
  const imageParts: Array<Record<string, unknown>> = []
  collectAgentImageParts(input, imageParts, new WeakSet())
  if (imageParts.length === 0) return input

  const prepared = await prepareAgentImageDataUrls(
    imageParts.map((part) => String(part.image_url)),
    options,
  )
  const replacements = new Map<Record<string, unknown>, string | null>()
  imageParts.forEach((part, index) => replacements.set(part, prepared[index]))
  return replaceAgentImageParts(input, replacements)
}
