import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildLocalImageUrl, isLocalImageUrl, localImagePathFromUrl, localImageUrlToDataUrl } from './localImageUrl'

function setElectronEnv(enabled: boolean, readFileBuffer?: (filePath: string) => Promise<unknown>) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: enabled ? { electronAPI: { isElectron: true, ...(readFileBuffer ? { readFileBuffer } : {}) } } : {},
  })
}

const cacheImagePath = 'D:\\LocalSaves\\cache-images\\a1b2c3.png'
const thumbPath = '/Users/me/LocalSaves/thumbs/a1b2c3.v3.webp'

describe('buildLocalImageUrl', () => {
  afterEach(() => setElectronEnv(true))

  it('把库根内的原图/缩略图路径编码成协议地址', () => {
    setElectronEnv(true)
    expect(buildLocalImageUrl(cacheImagePath)).toBe(`doupao://image/?path=${encodeURIComponent(cacheImagePath)}`)
    expect(buildLocalImageUrl(thumbPath)).toBe(`doupao://image/?path=${encodeURIComponent(thumbPath)}`)
  })

  it('浏览器环境返回 null（调用方回退 dataUrl）', () => {
    setElectronEnv(false)
    expect(buildLocalImageUrl(cacheImagePath)).toBeNull()
  })

  it('路径缺失返回 null', () => {
    setElectronEnv(true)
    expect(buildLocalImageUrl(null)).toBeNull()
    expect(buildLocalImageUrl(undefined)).toBeNull()
    expect(buildLocalImageUrl('')).toBeNull()
  })

  it('协议服务范围外的路径直接返回 null，避免注定 404 的请求', () => {
    setElectronEnv(true)
    // 用户自选的输出目录（不在库根 cache-images/thumbs 内）
    expect(buildLocalImageUrl('D:\\Output\\task-1.png')).toBeNull()
    // 名字含 cache-images 但并非该目录段
    expect(buildLocalImageUrl('D:\\LocalSaves\\cache-images-evil\\a.png')).toBeNull()
    expect(buildLocalImageUrl('D:\\LocalSaves\\images\\a.png')).toBeNull()
  })

  it('编码后 URL 不含裸反斜杠，避免被 URL 解析改写', () => {
    setElectronEnv(true)
    const url = buildLocalImageUrl(cacheImagePath)
    expect(url).toContain('%5C')
    expect(new URL(url!).searchParams.get('path')).toBe(cacheImagePath)
  })
})

describe('isLocalImageUrl', () => {
  it('只认协议前缀', () => {
    expect(isLocalImageUrl('doupao://image/?path=x')).toBe(true)
    expect(isLocalImageUrl('data:image/png;base64,AAA')).toBe(false)
    expect(isLocalImageUrl('blob:http://localhost/abc')).toBe(false)
    expect(isLocalImageUrl('doupao://assets/abc')).toBe(false)
    expect(isLocalImageUrl(null)).toBe(false)
    expect(isLocalImageUrl(undefined)).toBe(false)
  })
})

describe('localImagePathFromUrl', () => {
  it('从协议地址还原绝对路径（含中文与转义字符）', () => {
    const filePath = 'D:\\AI生图2\\cache-images\\a b&c.png'
    expect(localImagePathFromUrl(buildLocalImageUrl(filePath)!)).toBe(filePath)
  })

  it('非协议地址返回 null', () => {
    expect(localImagePathFromUrl('data:image/png;base64,AAA')).toBeNull()
    expect(localImagePathFromUrl('https://example.com/a.png')).toBeNull()
    expect(localImagePathFromUrl(null)).toBeNull()
    expect(localImagePathFromUrl('')).toBeNull()
  })

  it('协议地址缺 path 参数时返回 null，不抛错', () => {
    expect(localImagePathFromUrl('doupao://image/?other=1')).toBeNull()
  })
})

describe('localImageUrlToDataUrl', () => {
  afterEach(() => setElectronEnv(true))

  it('非协议地址原样返回（行为不变）', async () => {
    setElectronEnv(true)
    await expect(localImageUrlToDataUrl('data:image/png;base64,AAA')).resolves.toBe('data:image/png;base64,AAA')
    await expect(localImageUrlToDataUrl('https://example.com/a.png')).resolves.toBe('https://example.com/a.png')
  })

  it('协议地址经 IPC 读回字节并组装 dataUrl（fetch 会被 CSP 拦，必须走这条路）', async () => {
    const readFileBuffer = vi.fn(async (filePath: string) => ({
      data: new Uint8Array([1, 2, 3]).buffer,
      name: filePath.split('\\').pop() ?? '',
    }))
    setElectronEnv(true, readFileBuffer)

    const url = buildLocalImageUrl('D:\\LocalSaves\\cache-images\\a1.webp')!
    await expect(localImageUrlToDataUrl(url)).resolves.toBe(`data:image/webp;base64,${btoa('\x01\x02\x03')}`)
    expect(readFileBuffer).toHaveBeenCalledWith('D:\\LocalSaves\\cache-images\\a1.webp')
  })

  it('IPC 读不到文件时返回 null，交由调用方报错', async () => {
    setElectronEnv(true, async () => null)
    const url = buildLocalImageUrl('D:\\LocalSaves\\cache-images\\missing.png')!
    await expect(localImageUrlToDataUrl(url)).resolves.toBeNull()
  })
})
