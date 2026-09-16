import { isElectron, readFileBuffer } from './localSave'

/**
 * 本地图片协议地址（渲染进程侧）。
 *
 * 主进程实现对偶文件：`electron/local-image-protocol.ts`。
 * 该地址只用于纯展示的 `<img src>` —— 交给 Chromium 直接从磁盘流式读取，
 * 省掉「IPC 结构化克隆 → Blob → FileReader.readAsDataURL → <img> 再解回字节」这一串拷贝，
 * 也不再在渲染主线程上跑 base64 编解码。
 *
 * **不要把它喂给 canvas**：协议源与应用页面不同源，`drawImage` 会污染画布，
 * 之后 `getImageData()` / `toDataURL()` 会抛 SecurityError。需要像素的场景
 * （遮罩合成、导出、上传接口）继续用 `ensureImageCached` 拿到的 dataUrl。
 */

const LOCAL_IMAGE_URL_PREFIX = 'doupao://image/'

/** 协议只服务库根下这两个目录（与主进程 SERVED_SUBDIRECTORIES 保持一致）。 */
const SERVED_DIRECTORY_SEGMENTS = ['/cache-images/', '/thumbs/']

/** 提前挡掉注定 404 的路径：历史遗留/外部来源的 localPath 直接用 dataUrl，少一次失败的请求。 */
function isServableLocalPath(localPath: string): boolean {
  const normalized = localPath.replaceAll('\\', '/')
  return SERVED_DIRECTORY_SEGMENTS.some((segment) => normalized.includes(segment))
}

/**
 * 由本地文件路径构造 `<img>` 可直接使用的协议地址。
 * 非 Electron 环境、路径缺失或路径不在协议服务范围内时返回 null，调用方回退到 dataUrl。
 */
export function buildLocalImageUrl(localPath: string | null | undefined): string | null {
  if (!isElectron() || !localPath) return null
  if (!isServableLocalPath(localPath)) return null
  return `${LOCAL_IMAGE_URL_PREFIX}?path=${encodeURIComponent(localPath)}`
}

/** 判断一个已有的图片地址是否为本地图片协议地址（回退逻辑用）。 */
export function isLocalImageUrl(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(LOCAL_IMAGE_URL_PREFIX)
}

/**
 * 从协议地址还原出本地文件绝对路径；非协议地址或解析失败返回 null。
 *
 * 用途：协议地址**不能走 `fetch`**（CSP 的 connect-src 不含 `doupao:`），
 * 需要字节的场景（下载、导出、按 URL 导入）必须拿回路径再经 IPC 读文件。
 */
export function localImagePathFromUrl(value: string | null | undefined): string | null {
  if (!isLocalImageUrl(value)) return null
  try {
    return new URL(value as string).searchParams.get('path')
  } catch {
    return null
  }
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  bmp: 'image/bmp',
}

/**
 * 把展示用协议地址转回 dataUrl。
 *
 * 需要**真实字节**的场景（下载、写剪贴板、按 URL 导入参考图）都要先过这一层：
 * 它们原先直接 `fetch(src)` 或把 src 当 dataUrl 用，遇到协议地址会分别被 CSP 拦掉、
 * 或让 `nativeImage.createFromDataURL` 拿到空图。非协议地址原样返回，行为不变。
 */
export async function localImageUrlToDataUrl(src: string | null | undefined): Promise<string | null> {
  if (!isLocalImageUrl(src)) return src ?? null
  const filePath = localImagePathFromUrl(src)
  if (!filePath) return null
  const file = await readFileBuffer(filePath)
  if (!file) return null
  const extension = filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase()
  const mime = MIME_BY_EXTENSION[extension] ?? 'image/png'
  const bytes = new Uint8Array(file.data)
  let binary = ''
  // 分块转换，避免大图逐字节拼接字符串
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return `data:${mime};base64,${btoa(binary)}`
}
