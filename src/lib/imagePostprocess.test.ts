import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskParams } from '../types'
import { getImagePostprocessPlan, mergePostprocessedActualParams, postprocessGeneratedImage } from './imagePostprocess'

const canvasImageMocks = vi.hoisted(() => ({
  loadImage: vi.fn(),
  loadImageOriented: vi.fn(),
  canvasToBlob: vi.fn(),
}))

vi.mock('./canvasImage', () => ({
  loadImage: canvasImageMocks.loadImage,
  loadImageOriented: canvasImageMocks.loadImageOriented,
  getSourceWidth: (source: { naturalWidth?: number; width?: number }) => source?.naturalWidth ?? source?.width ?? 0,
  getSourceHeight: (source: { naturalHeight?: number; height?: number }) =>
    source?.naturalHeight ?? source?.height ?? 0,
  canvasToBlob: canvasImageMocks.canvasToBlob,
}))

function params(overrides: Partial<TaskParams> = {}): TaskParams {
  return { ...DEFAULT_PARAMS, ...overrides }
}

const originalDocument = globalThis.document
const originalFileReader = globalThis.FileReader

beforeEach(() => {
  canvasImageMocks.loadImage.mockReset()
  canvasImageMocks.loadImageOriented.mockReset()
  canvasImageMocks.canvasToBlob.mockReset()

  const canvasContext = {
    fillStyle: '',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => canvasContext),
  }

  globalThis.document = {
    createElement: vi.fn((tag: string) => {
      if (tag === 'canvas') return canvas
      return null
    }),
  } as any

  class MockFileReader {
    result: string | ArrayBuffer | null = null
    onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null
    onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null

    readAsDataURL(blob: Blob) {
      this.result = `data:${blob.type};base64,encoded`
      this.onload?.call(this as any, {} as ProgressEvent<FileReader>)
    }
  }

  globalThis.FileReader = MockFileReader as any
})

afterEach(() => {
  globalThis.document = originalDocument
  globalThis.FileReader = originalFileReader
  vi.restoreAllMocks()
})

describe('image postprocess plan', () => {
  it('keeps postprocessing disabled by default', () => {
    const plan = getImagePostprocessPlan(DEFAULT_PARAMS)

    expect(plan.enabled).toBe(false)
    expect(plan.resize).toBeNull()
    expect(plan.encode.mime).toBeNull()
  })

  it('normalizes resize dimensions when resize is enabled', () => {
    const plan = getImagePostprocessPlan(
      params({
        postprocess_resize_enabled: true,
        postprocess_size: '1025x1025',
      }),
    )

    expect(plan.enabled).toBe(true)
    expect(plan.resize).toEqual({ width: 1025, height: 1025 })
  })

  it('keeps small resize targets unchanged', () => {
    const plan = getImagePostprocessPlan(
      params({
        postprocess_resize_enabled: true,
        postprocess_size: '100 x 100',
      }),
    )

    expect(plan.resize).toEqual({ width: 100, height: 100 })
  })

  it('ignores auto resize targets when resize is enabled', () => {
    const plan = getImagePostprocessPlan(
      params({
        postprocess_resize_enabled: true,
        postprocess_size: 'auto',
      }),
    )

    expect(plan).toEqual({
      enabled: false,
      resize: null,
      encode: { format: null, mime: null },
    })
  })

  it('uses selected compression format and max size for JPEG/WebP', () => {
    expect(
      getImagePostprocessPlan(
        params({
          postprocess_compress_enabled: true,
          postprocess_format: 'jpeg',
          postprocess_max_size_kb: 399,
        } as Partial<TaskParams>),
      ).encode,
    ).toEqual({ format: 'jpeg', mime: 'image/jpeg', maxSizeBytes: 399 * 1024 })

    expect(
      getImagePostprocessPlan(
        params({
          postprocess_compress_enabled: true,
          postprocess_format: 'webp',
          postprocess_max_size_kb: 128,
        } as Partial<TaskParams>),
      ).encode,
    ).toEqual({ format: 'webp', mime: 'image/webp', maxSizeBytes: 128 * 1024 })
  })

  it('uses max size for PNG compression without quality search', () => {
    expect(
      getImagePostprocessPlan(
        params({
          postprocess_compress_enabled: true,
          postprocess_format: 'png',
          postprocess_max_size_kb: 399,
        } as Partial<TaskParams>),
      ).encode,
    ).toEqual({ format: 'png', mime: 'image/png', maxSizeBytes: 399 * 1024 })
  })

  it('resizes before encoding when both switches are enabled', () => {
    const plan = getImagePostprocessPlan(
      params({
        postprocess_resize_enabled: true,
        postprocess_size: '1536x1024',
        postprocess_compress_enabled: true,
        postprocess_format: 'webp',
        postprocess_max_size_kb: 399,
      } as Partial<TaskParams>),
    )

    expect(plan.enabled).toBe(true)
    expect(plan.resize).toEqual({ width: 1536, height: 1024 })
    expect(plan.encode).toEqual({ format: 'webp', mime: 'image/webp', maxSizeBytes: 399 * 1024 })
  })

  it('merges postprocessed actual params over original values', () => {
    expect(
      mergePostprocessedActualParams(
        { size: '2048x2048', output_format: 'png', quality: 'high' },
        { size: '1024x1024', output_format: 'webp' },
      ),
    ).toEqual({
      size: '1024x1024',
      output_format: 'webp',
      quality: 'high',
    })
  })

  it('returns undefined when both actual param inputs are empty', () => {
    expect(mergePostprocessedActualParams(undefined, {})).toBeUndefined()
  })

  it('returns the original image when postprocessing is disabled', async () => {
    const dataUrl = 'data:image/png;base64,original'

    await expect(postprocessGeneratedImage(dataUrl, DEFAULT_PARAMS)).resolves.toEqual({
      dataUrl,
      actualParams: {},
    })
    expect(canvasImageMocks.loadImage).not.toHaveBeenCalled()
    expect(canvasImageMocks.canvasToBlob).not.toHaveBeenCalled()
  })

  it('accepts image/jpg as jpeg during resize-only postprocessing', async () => {
    canvasImageMocks.loadImageOriented.mockResolvedValue({ naturalWidth: 640, naturalHeight: 480 })
    canvasImageMocks.canvasToBlob.mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }))

    const result = await postprocessGeneratedImage(
      'data:image/jpg;base64,source',
      params({
        postprocess_resize_enabled: true,
        postprocess_size: '320x240',
      }),
    )

    expect(canvasImageMocks.loadImageOriented).toHaveBeenCalledWith('data:image/jpg;base64,source')
    expect(canvasImageMocks.canvasToBlob).toHaveBeenCalledWith(expect.any(Object), 'image/jpeg', undefined)
    expect(result).toEqual({
      dataUrl: 'data:image/jpeg;base64,encoded',
      actualParams: {
        size: '320x240',
        output_format: 'jpeg',
      },
    })
  })

  it('rejects unsupported browser MIME fallback for explicit compression', async () => {
    canvasImageMocks.loadImageOriented.mockResolvedValue({ naturalWidth: 640, naturalHeight: 480 })
    canvasImageMocks.canvasToBlob.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))

    await expect(
      postprocessGeneratedImage(
        'data:image/png;base64,source',
        params({
          postprocess_compress_enabled: true,
          postprocess_format: 'webp',
        }),
      ),
    ).rejects.toThrow('Local image postprocessing failed: image/webp output is not supported')
  })

  it('searches JPEG/WebP quality until the blob is below the max size', async () => {
    canvasImageMocks.loadImageOriented.mockResolvedValue({ naturalWidth: 640, naturalHeight: 480 })
    canvasImageMocks.canvasToBlob.mockImplementation(async (_canvas, mime: string, quality?: number) => {
      const size = quality && quality > 0.5 ? 2048 : 512
      return new Blob(['x'.repeat(size)], { type: mime })
    })

    const result = await postprocessGeneratedImage(
      'data:image/png;base64,source',
      params({
        postprocess_compress_enabled: true,
        postprocess_format: 'webp',
        postprocess_max_size_kb: 1,
      } as Partial<TaskParams>),
    )

    expect(canvasImageMocks.canvasToBlob).toHaveBeenCalledWith(expect.any(Object), 'image/webp', expect.any(Number))
    expect(canvasImageMocks.canvasToBlob.mock.calls.length).toBeGreaterThan(1)
    expect(result).toEqual({
      dataUrl: 'data:image/webp;base64,encoded',
      actualParams: {
        size: '640x480',
        output_format: 'webp',
      },
    })
  })

  it('rejects PNG output that is larger than the max size', async () => {
    canvasImageMocks.loadImageOriented.mockResolvedValue({ naturalWidth: 640, naturalHeight: 480 })
    canvasImageMocks.canvasToBlob.mockResolvedValue(new Blob(['x'.repeat(2048)], { type: 'image/png' }))

    await expect(
      postprocessGeneratedImage(
        'data:image/png;base64,source',
        params({
          postprocess_compress_enabled: true,
          postprocess_format: 'png',
          postprocess_max_size_kb: 1,
        } as Partial<TaskParams>),
      ),
    ).rejects.toThrow('target size')
  })
})
