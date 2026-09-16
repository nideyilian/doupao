import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'doupao-local-image-'))

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir,
  },
}))

// 未配置 localSavePath 时库根回退到 <userData>/local-saves，与 library-paths.ts 一致。
const libraryRoot = path.join(userDataDir, 'local-saves')
const cacheImagesDir = path.join(libraryRoot, 'cache-images')
const thumbsDir = path.join(libraryRoot, 'thumbs')
const outsideDir = path.join(userDataDir, 'outside')

function writeFile(filePath: string, content = 'image-bytes') {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
}

function toUrl(rawPath: string): URL {
  return new URL(`doupao://image/?path=${encodeURIComponent(rawPath)}`)
}

describe('resolveServableLocalImagePath', () => {
  it('接受库根 cache-images 与 thumbs 下的白名单图片', async () => {
    const { resolveServableLocalImagePath } = await import('./local-image-protocol')
    const roots = [cacheImagesDir, thumbsDir]

    expect(resolveServableLocalImagePath(path.join(cacheImagesDir, 'abc123.png'), roots)).toBe(
      path.resolve(cacheImagesDir, 'abc123.png'),
    )
    expect(resolveServableLocalImagePath(path.join(thumbsDir, 'abc123.v3.webp'), roots)).toBe(
      path.resolve(thumbsDir, 'abc123.v3.webp'),
    )
    // 大小写不敏感（Windows 路径）
    expect(resolveServableLocalImagePath(path.join(cacheImagesDir, 'A.JPEG'), roots)).toBe(
      path.resolve(cacheImagesDir, 'A.JPEG'),
    )
  })

  it('拒绝目录外路径与路径穿越', async () => {
    const { resolveServableLocalImagePath } = await import('./local-image-protocol')
    const roots = [cacheImagesDir, thumbsDir]

    expect(resolveServableLocalImagePath(path.join(outsideDir, 'secret.png'), roots)).toBeNull()
    expect(resolveServableLocalImagePath(path.join(libraryRoot, 'library.json'), roots)).toBeNull()
    // 目录本身不是文件，不应通过
    expect(resolveServableLocalImagePath(cacheImagesDir, roots)).toBeNull()
    // 前缀相同但不是同一个目录（cache-images-evil）
    expect(resolveServableLocalImagePath(path.join(libraryRoot, 'cache-images-evil', 'a.png'), roots)).toBeNull()
    // 穿越出允许目录
    expect(resolveServableLocalImagePath(path.join(cacheImagesDir, '..', '..', 'secret.png'), roots)).toBeNull()
    expect(resolveServableLocalImagePath(path.join(thumbsDir, '..', 'cache-images2', 'a.png'), roots)).toBeNull()
  })

  it('拒绝非图片扩展名与畸形输入', async () => {
    const { resolveServableLocalImagePath } = await import('./local-image-protocol')
    const roots = [cacheImagesDir, thumbsDir]

    for (const name of ['payload.html', 'payload.js', 'notes.txt', 'noext', 'a.png.exe']) {
      expect(resolveServableLocalImagePath(path.join(cacheImagesDir, name), roots)).toBeNull()
    }
    expect(resolveServableLocalImagePath(null, roots)).toBeNull()
    expect(resolveServableLocalImagePath(undefined, roots)).toBeNull()
    expect(resolveServableLocalImagePath(42, roots)).toBeNull()
    expect(resolveServableLocalImagePath('', roots)).toBeNull()
    expect(resolveServableLocalImagePath('   ', roots)).toBeNull()
    // NUL 字节：挡住路径截断类攻击
    expect(resolveServableLocalImagePath(`${path.join(cacheImagesDir, 'a.png')}\0.txt`, roots)).toBeNull()
  })
})

describe('serveLocalImageRequest', () => {
  beforeEach(() => {
    rmSync(libraryRoot, { recursive: true, force: true })
    mkdirSync(cacheImagesDir, { recursive: true })
    mkdirSync(thumbsDir, { recursive: true })
  })

  afterAll(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('非 image 主机名交给其他分支处理（返回 null）', async () => {
    const { serveLocalImageRequest } = await import('./local-image-protocol')
    expect(await serveLocalImageRequest(new URL('doupao://assets/abc'))).toBeNull()
    expect(await serveLocalImageRequest(new URL('doupao://open?assetId=1'))).toBeNull()
  })

  it('下发命中文件并声明可长期缓存', async () => {
    const { serveLocalImageRequest, resetAllowedImageRootsCache } = await import('./local-image-protocol')
    resetAllowedImageRootsCache()

    const filePath = path.join(cacheImagesDir, 'abc123.webp')
    writeFile(filePath, 'webp-bytes')

    const response = await serveLocalImageRequest(toUrl(filePath))
    expect(response?.status).toBe(200)
    expect(response?.headers.get('Content-Type')).toBe('image/webp')
    expect(response?.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable')
    expect(response?.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(await response?.text()).toBe('webp-bytes')
  })

  it('按扩展名给出正确 MIME', async () => {
    const { serveLocalImageRequest, resetAllowedImageRootsCache } = await import('./local-image-protocol')
    resetAllowedImageRootsCache()

    const cases: Array<[string, string]> = [
      ['a.png', 'image/png'],
      ['a.jpg', 'image/jpeg'],
      ['a.jpeg', 'image/jpeg'],
      ['a.avif', 'image/avif'],
    ]
    for (const [name, mime] of cases) {
      const filePath = path.join(cacheImagesDir, name)
      writeFile(filePath)
      const response = await serveLocalImageRequest(toUrl(filePath))
      expect(response?.headers.get('Content-Type')).toBe(mime)
    }
  })

  it('文件不存在或非法路径返回 404', async () => {
    const { serveLocalImageRequest, resetAllowedImageRootsCache } = await import('./local-image-protocol')
    resetAllowedImageRootsCache()

    expect((await serveLocalImageRequest(toUrl(path.join(cacheImagesDir, 'missing.png'))))?.status).toBe(404)
    expect((await serveLocalImageRequest(toUrl(path.join(outsideDir, 'a.png'))))?.status).toBe(404)
    expect((await serveLocalImageRequest(toUrl(path.join(cacheImagesDir, 'a.html'))))?.status).toBe(404)
    // 目录而非文件
    expect((await serveLocalImageRequest(toUrl(thumbsDir)))?.status).toBe(404)
    expect((await serveLocalImageRequest(new URL('doupao://image/'))).status).toBe(404)
  })

  it('超过体积上限的文件返回 413', async () => {
    const { serveLocalImageRequest, resetAllowedImageRootsCache, LOCAL_IMAGE_MAX_BYTES } =
      await import('./local-image-protocol')
    resetAllowedImageRootsCache()

    const filePath = path.join(cacheImagesDir, 'huge.png')
    mkdirSync(cacheImagesDir, { recursive: true })
    writeFileSync(filePath, '')
    // 稀疏文件：不实际占用磁盘，只撑起 size
    truncateSync(filePath, LOCAL_IMAGE_MAX_BYTES + 1)

    expect((await serveLocalImageRequest(toUrl(filePath)))?.status).toBe(413)
  })
})
