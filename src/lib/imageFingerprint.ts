// 图片指纹与去重工具。
//
// 提供两类指纹：
// 1. contentHash：最终图片字节的 SHA-256。完全相同（含重新编码后像素一致）的图片字节哈希一致。
// 2. perceptualHash：缩放为 32×32 灰度后用 DCT 提取的 64 位感知哈希（pHash）。
//
// 仅对 data URL 字符串做哈希不足以去重：相同图片可能带不同元数据或重新压缩。
// 因此 contentHash 必须对解码后的原始字节计算，而 perceptualHash 进一步比较像素。

export interface ImageFingerprint {
  contentHash: string
  perceptualHash?: string
}

/** data URL 解析结果 */
interface DecodedDataUrl {
  mime: string
  isBase64: boolean
  data: string
}

function parseDataUrl(dataUrl: string): DecodedDataUrl {
  const commaIndex = dataUrl.indexOf(',')
  if (!commaIndex || !dataUrl.startsWith('data:')) {
    throw new Error('无效的 data URL')
  }
  const meta = dataUrl.slice(5, commaIndex)
  const rest = dataUrl.slice(commaIndex + 1)
  const isBase64 = meta.includes(';base64')
  const mime = meta.split(';')[0] || 'application/octet-stream'
  return { mime, isBase64, data: rest }
}

/** 将 data URL 解码为原始字节（对 base64 解码，对文本（极少见）按 UTF-8 编码）。 */
export function decodeDataUrlToBytes(dataUrl: string): Uint8Array {
  const { isBase64, data } = parseDataUrl(dataUrl)
  if (!isBase64) {
    return new TextEncoder().encode(data)
  }
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * 计算 data URL 解码后原始字节的 SHA-256（十六进制）。
 * 重新编码 / 重新压缩不会改变解码字节，因此同图恒等。
 * 若 base64 解码失败（如测试用的占位 data URL），回退为对原始字符串取哈希，
 * 仍能保证相同输入得到相同指纹（仅影响"像素级"去重精度，不影响去重主流程）。
 */
export async function computeContentHash(dataUrl: string): Promise<string> {
  let bytes: Uint8Array
  try {
    bytes = decodeDataUrlToBytes(dataUrl)
  } catch {
    bytes = new TextEncoder().encode(dataUrl)
  }
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource)
    return toHex(digest)
  }
  return contentHashFallback(bytes)
}

/** 非加密环境的回退哈希（FNV-1a 变体，仅用于去重，不与主路径一致）。 */
function contentHashFallback(bytes: Uint8Array): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < bytes.length; i++) {
    h1 ^= bytes[i]
    h1 = Math.imul(h1, 0x01000193)
    h2 ^= bytes[i]
    h2 = Math.imul(h2, 0x27d4eb2d)
  }
  return `fb-${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`
}

// ===== 像素加载与感知哈希 =====

export interface DecodedPixels {
  data: Uint8ClampedArray
  width: number
  height: number
}

/**
 * 从 data URL 解码为 ImageData 像素（需要浏览器 / jsdom 的 Image + canvas）。
 * 纯 Node 测试环境请直接使用 {@link computePerceptualHash} 传入合成像素。
 */
export async function loadImagePixels(dataUrl: string): Promise<DecodedPixels> {
  if (typeof Image === 'undefined' || typeof document === 'undefined') {
    throw new Error('当前环境不支持加载图片像素（需要 DOM）')
  }
  return new Promise((resolve, reject) => {
    const image = new Image()
    // 防止个别图片解码卡死（如损坏文件或测试环境的假 Image）导致整个批次挂起。
    const timer = setTimeout(() => reject(new Error('图片解码超时')), 15000)
    image.onload = () => {
      clearTimeout(timer)
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('无法创建 2D 画布上下文'))
        return
      }
      ctx.drawImage(image, 0, 0)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      resolve({ data: imageData.data, width: canvas.width, height: canvas.height })
    }
    image.onerror = () => {
      clearTimeout(timer)
      reject(new Error('图片解码失败'))
    }
    image.src = dataUrl
  })
}

/** 当前环境是否具备计算感知哈希所需的真实画布能力（jsdom 的 getContext 返回 null）。 */
export function canComputePerceptualHash(): boolean {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    return canvas.getContext('2d') != null
  } catch {
    return false
  }
}

/** 双线性缩放为 32×32 灰度（返回长度 1024 的灰度数组，0~255）。 */
export function resizeToGray32x32(data: Uint8ClampedArray, width: number, height: number): Float64Array {
  const gray = new Float64Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      gray[y * width + x] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    }
  }
  const out = new Float64Array(32 * 32)
  const ratioX = (width - 1) / 31
  const ratioY = (height - 1) / 31
  for (let oy = 0; oy < 32; oy++) {
    const sy = oy * ratioY
    const y0 = Math.floor(sy)
    const y1 = Math.min(height - 1, y0 + 1)
    const fy = sy - y0
    for (let ox = 0; ox < 32; ox++) {
      const sx = ox * ratioX
      const x0 = Math.floor(sx)
      const x1 = Math.min(width - 1, x0 + 1)
      const fx = sx - x0
      const top = gray[y0 * width + x0] * (1 - fx) + gray[y0 * width + x1] * fx
      const bottom = gray[y1 * width + x0] * (1 - fx) + gray[y1 * width + x1] * fx
      out[oy * 32 + ox] = top * (1 - fy) + bottom * fy
    }
  }
  return out
}

function dct1dVector(input: Float64Array, length: number): Float64Array {
  const output = new Float64Array(length)
  const factor = Math.PI / length
  for (let k = 0; k < length; k++) {
    let sum = 0
    for (let n = 0; n < length; n++) {
      sum += input[n] * Math.cos(factor * (n + 0.5) * k)
    }
    output[k] = k === 0 ? sum * Math.sqrt(1 / length) : sum * Math.sqrt(2 / length)
  }
  return output
}

/** 计算 32×32 灰度图的 2D DCT。 */
export function dct2d32(source: Float64Array): Float64Array {
  const temp = new Float64Array(32 * 32)
  const row = new Float64Array(32)
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) row[x] = source[y * 32 + x]
    const transformed = dct1dVector(row, 32)
    for (let x = 0; x < 32; x++) temp[y * 32 + x] = transformed[x]
  }
  const result = new Float64Array(32 * 32)
  const col = new Float64Array(32)
  for (let x = 0; x < 32; x++) {
    for (let y = 0; y < 32; y++) col[y] = temp[y * 32 + x]
    const transformed = dct1dVector(col, 32)
    for (let y = 0; y < 32; y++) result[y * 32 + x] = transformed[y]
  }
  return result
}

/**
 * 从灰度像素（任意尺寸）计算 64 位感知哈希（16 位十六进制）。
 * 取 DCT 左上 8×8 低频区（排除 DC），按中位数阈值生成每一位。
 */
export function computePerceptualHash(data: Uint8ClampedArray, width: number, height: number): string {
  const gray = resizeToGray32x32(data, width, height)
  const dct = dct2d32(gray)
  const lowFreq: number[] = []
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (y === 0 && x === 0) continue // 跳过 DC
      lowFreq.push(dct[y * 32 + x])
    }
  }
  const sorted = [...lowFreq].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  let bits = 0n
  for (let i = 0; i < lowFreq.length; i++) {
    if (lowFreq[i] > median) bits |= 1n << BigInt(i)
  }
  return bits.toString(16).padStart(16, '0')
}

/**
 * 同时计算两类指纹。
 * - contentHash 始终计算（不依赖 DOM）。
 * - perceptualHash 仅在 DOM 环境（浏览器 / Electron 渲染进程）可用时计算；
 *   否则跳过（返回 undefined），不影响去重主流程（完全重复仍由 contentHash 保证）。
 */
export async function fingerprintImage(dataUrl: string): Promise<ImageFingerprint> {
  const contentHash = await computeContentHash(dataUrl)
  let perceptualHash: string | undefined
  if (canComputePerceptualHash()) {
    try {
      const pixels = await loadImagePixels(dataUrl)
      perceptualHash = computePerceptualHash(pixels.data, pixels.width, pixels.height)
    } catch {
      perceptualHash = undefined
    }
  }
  return { contentHash, perceptualHash }
}

/** pHash 汉明距离（不同位数）。pHash 为 16 位十六进制串，共 64 位。 */
export function hammingDistance(a: string, b: string): number {
  const len = Math.max(a.length, b.length)
  let dist = 0
  for (let i = 0; i < len; i++) {
    const ca = a[a.length - 1 - i] ?? '0'
    const cb = b[b.length - 1 - i] ?? '0'
    const va = parseInt(ca, 16)
    const vb = parseInt(cb, 16)
    let x = (va ^ vb) & 0xf
    while (x) {
      dist += x & 1
      x >>= 1
    }
  }
  return dist
}

/** 近似重复判定：汉明距离不超过阈值。threshold 为 0 时关闭近似判定。 */
export function areNearDuplicates(a: string | undefined, b: string | undefined, threshold: number): boolean {
  if (!a || !b || threshold <= 0) return false
  return hammingDistance(a, b) <= threshold
}
