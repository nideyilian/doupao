import { describe, expect, it, vi } from 'vitest'
import { blobToDataUrl, canvasToWebpDataUrl } from './canvasImage'

/** 只实现 toBlob / toDataURL 的假 canvas：绕开 jsdom 没有 2D 上下文、也无真实编码器的限制。 */
function stubCanvas(options: {
  blob?: Blob | null
  toDataURL?: () => string
  throwOnBlob?: boolean
  onEncode?: (type: string | undefined, quality: number | undefined) => void
}): HTMLCanvasElement {
  return {
    toBlob: (callback: (blob: Blob | null) => void, type?: string, quality?: number) => {
      options.onEncode?.(type, quality)
      if (options.throwOnBlob) throw new Error('toBlob 不可用')
      callback(options.blob ?? null)
    },
    toDataURL: options.toDataURL ?? (() => 'data:image/webp;base64,FROM_TO_DATA_URL'),
  } as unknown as HTMLCanvasElement
}

describe('canvasToWebpDataUrl', () => {
  it('优先走 toBlob：编码参数为 webp，dataURL 前缀取自 blob 类型', async () => {
    const onEncode = vi.fn()
    const toDataURL = vi.fn(() => 'data:image/webp;base64,FALLBACK')
    const canvas = stubCanvas({
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }),
      toDataURL,
      onEncode,
    })

    const dataUrl = await canvasToWebpDataUrl(canvas, 0.82)

    expect(onEncode).toHaveBeenCalledWith('image/webp', 0.82)
    expect(dataUrl.startsWith('data:image/webp;base64,')).toBe(true)
    // 主线程同步编码的 toDataURL 不应被触碰
    expect(toDataURL).not.toHaveBeenCalled()
  })

  it('toBlob 给不出 blob 时回退 toDataURL', async () => {
    const toDataURL = vi.fn(() => 'data:image/webp;base64,FALLBACK')
    const canvas = stubCanvas({ blob: null, toDataURL })

    await expect(canvasToWebpDataUrl(canvas, 0.82)).resolves.toBe('data:image/webp;base64,FALLBACK')
    expect(toDataURL).toHaveBeenCalledWith('image/webp', 0.82)
  })

  it('toBlob 直接抛错时同样回退 toDataURL', async () => {
    const toDataURL = vi.fn(() => 'data:image/webp;base64,FALLBACK')
    const canvas = stubCanvas({ throwOnBlob: true, toDataURL })

    await expect(canvasToWebpDataUrl(canvas, 0.8)).resolves.toBe('data:image/webp;base64,FALLBACK')
    expect(toDataURL).toHaveBeenCalledWith('image/webp', 0.8)
  })

  it('toBlob 静默降级成 png 时前缀跟随真实 mime（不谎报 webp）', async () => {
    const canvas = stubCanvas({ blob: new Blob([new Uint8Array([9])], { type: 'image/png' }) })

    const dataUrl = await canvasToWebpDataUrl(canvas, 0.82)

    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true)
  })
})

describe('blobToDataUrl', () => {
  it('按 blob 内容生成 base64 dataURL', async () => {
    const blob = new Blob([new Uint8Array([72, 105])], { type: 'image/webp' })

    await expect(blobToDataUrl(blob)).resolves.toBe('data:image/webp;base64,SGk=')
  })
})
