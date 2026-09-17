/**
 * Blob ⇄ data URL 编解码（不依赖 FileReader / fetch，Node 测试环境与渲染进程都可用）。
 *
 * 用途：Electron 端的应用数据存储是 SQLite + `JSON.stringify`（见 electron/app-data-store.ts），
 * Blob 会被序列化成 `{}`，字节与 MIME 全部丢失且事后无法察觉——读回后把 `{}` 交给
 * `URL.createObjectURL` 会抛 "Overload resolution failed"。因此任何要落该存储的二进制
 * 都必须先转成 base64 data URL 字符串（与同库的 thumbnails 命名空间一致）。
 */

/** 分块编码，避免一次性 `String.fromCharCode(...)` 超出参数上限。 */
const BASE64_CHUNK_SIZE = 0x8000

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE))
  }
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return `data:${blob.type || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`
}

/**
 * data URL → Blob。
 *
 * `fallbackType` 仅在 data URL 没带 mime 时生效（与原来那份基于 `fetch` 的实现对齐；
 * 同步解析不依赖 `connect-src`，打包版也不会因为 CSP 少一条 `data:` 就 Failed to fetch）。
 */
export function dataUrlToBlob(dataUrl: string, fallbackType = 'application/octet-stream'): Blob {
  const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(dataUrl)
  if (!match) throw new Error('无法解析 data URL')
  const type = match[1] || fallbackType
  const payload = match[3] ?? ''
  if (!match[2]) return new Blob([decodeURIComponent(payload)], { type })
  return new Blob([base64ToBytes(payload)], { type })
}
