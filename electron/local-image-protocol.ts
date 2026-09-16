import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { getLibraryRoot } from './library-paths'

/**
 * `doupao://image/` 本地图片协议（主进程侧实现，注册在 asset-kernel 的 protocol.handle 里）。
 *
 * 解决的链路：任务输出图原本走 `fs:read-file-buffer` → IPC 结构化克隆 → `new Blob` →
 * `FileReader.readAsDataURL` → `<img>` 再把 base64 解回字节。一张 5MB 原图约 30MB 内存流量，
 * 且 base64 编解码跑在渲染主线程上。改为协议 URL 后 Chromium 直接从磁盘流式读取并在
 * 解码线程池出图，渲染进程不再持有像素副本。
 *
 * 安全边界（三条都必要，缺一不可）：
 * 1. **只服务库根下的 cache-images/ 与 thumbs/**。不开放任意路径，因此刻意不接入
 *    ipc-handlers 的通用允许根列表——那份列表含桌面/文档/下载等过宽目录，按 URL 参数
 *    就能读会把攻击面放大到整个用户目录。
 * 2. **扩展名 + MIME 双重白名单配 nosniff**：即使这两个目录被塞入 .html/.js，
 *    也不会被当成可执行内容下发（同 asset-kernel 对资产文件的处理）。
 * 3. CSP 的 `connect-src` 不含 `doupao:`，所以该协议只能作为 `<img>` 的来源；
 *    `fetch('doupao://...')` 会被浏览器拦掉，无法用来把本地文件读成文本外传。
 *
 * 缓存：两个目录的文件名都自带内容标识（`cache-images/<内容哈希>.<ext>`、
 * `thumbs/<id>.v<缩略图版本>.webp`），文件名即缓存键，因此可以安全声明 immutable。
 */

/** URL 主机名：`doupao://image/?path=<encodeURIComponent(绝对路径)>`。 */
export const LOCAL_IMAGE_HOST = 'image'

/** 单张下发上限：仅用于挡住异常大文件把主进程内存打满，正常出图远小于此值。 */
export const LOCAL_IMAGE_MAX_BYTES = 64 * 1024 * 1024

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
}

/** 协议实际服务的库根子目录（与渲染进程 src/lib/localImageUrl.ts 的判定保持一致）。 */
const SERVED_SUBDIRECTORIES = ['cache-images', 'thumbs']

/**
 * 库根解析带短 TTL 缓存：滚动图库时本协议会被高频调用，不值得每张图都同步读一次
 * local-settings.json。切换库根属于低频用户操作，最长 2s 内自动生效；
 * 这段时间内旧库根路径会 404，渲染进程的 onError 回退会兜住，不会破图。
 */
const ROOTS_TTL_MS = 2_000
let cachedRoots: { value: string[]; at: number } | null = null

/** 允许下发的绝对目录列表（库根的 cache-images 与 thumbs）。导出以便测试注入。 */
export function getAllowedImageRoots(): string[] {
  const now = Date.now()
  if (cachedRoots && now - cachedRoots.at < ROOTS_TTL_MS) return cachedRoots.value
  const root = getLibraryRoot()
  const value = SERVED_SUBDIRECTORIES.map((name) => path.join(root, name))
  cachedRoots = { value, at: now }
  return value
}

/** 测试用：清掉库根缓存，避免用例之间互相污染。 */
export function resetAllowedImageRootsCache(): void {
  cachedRoots = null
}

/** 严格的「在目录内」判定：自身等于目录不算（目录不是文件，后面还有 isFile 校验）。 */
function isPathInside(targetPath: string, rootPath: string): boolean {
  const target = path.resolve(targetPath).toLowerCase()
  const root = path.resolve(rootPath).toLowerCase()
  const relative = path.relative(root, target)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

/**
 * 校验请求参数是否可下发，返回规范化绝对路径；不合法返回 null。
 * 纯函数（roots 由调用方给出），便于单测覆盖路径穿越、非白名单扩展名等边界。
 */
export function resolveServableLocalImagePath(rawPath: unknown, roots: string[]): string | null {
  if (typeof rawPath !== 'string') return null
  const trimmed = rawPath.trim()
  if (!trimmed || trimmed.includes('\0')) return null
  const resolved = path.resolve(trimmed)
  if (!roots.some((root) => isPathInside(resolved, root))) return null
  if (!MIME_BY_EXTENSION[path.extname(resolved).toLowerCase()]) return null
  return resolved
}

/**
 * 处理 `doupao://image/` 请求。主机名不匹配时返回 null，交回调用方继续分发
 * （同一 scheme 只能有一个 protocol.handle，所以路由在 asset-kernel 里合并）。
 */
export async function serveLocalImageRequest(url: URL): Promise<Response | null> {
  if (url.hostname !== LOCAL_IMAGE_HOST) return null
  const filePath = resolveServableLocalImagePath(url.searchParams.get('path'), getAllowedImageRoots())
  if (!filePath) return new Response('Not found', { status: 404 })

  try {
    const info = await stat(filePath)
    if (!info.isFile()) return new Response('Not found', { status: 404 })
    if (info.size > LOCAL_IMAGE_MAX_BYTES) return new Response('Image too large', { status: 413 })

    const data = await readFile(filePath)
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    // 文件被外部删除 / 无权限：返回 404 让渲染进程回退到 dataUrl，而不是抛异常。
    return new Response('Not found', { status: 404 })
  }
}
