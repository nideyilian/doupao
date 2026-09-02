import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  compressSopReferenceImageIfNeeded,
  getDataUrlDecodedByteSize,
  MAX_SOP_REFERENCE_IMAGE_SEND_BYTES,
} from './sopReferenceImageCompression'

const canvasImageMocks = vi.hoisted(() => ({
  loadImageOriented: vi.fn(),
  canvasToBlob: vi.fn(),
}))

vi.mock('./canvasImage', () => ({
  loadImageOriented: canvasImageMocks.loadImageOriented,
  getSourceWidth: (source: { naturalWidth?: number; width?: number }) => source.naturalWidth ?? source.width ?? 0,
  getSourceHeight: (source: { naturalHeight?: number; height?: number }) => source.naturalHeight ?? source.height ?? 0,
  canvasToBlob: canvasImageMocks.canvasToBlob,
}))

const originalDocument = globalThis.document
const originalFileReader = globalThis.FileReader

beforeEach(() => {
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
    createElement: vi.fn(() => canvas),
  } as unknown as Document

  class MockFileReader {
    result: string | ArrayBuffer | null = null
    onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null
    onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null

    readAsDataURL(blob: Blob) {
      this.result = `data:${blob.type};base64,compressed`
      this.onload?.call(this as unknown as FileReader, {} as ProgressEvent<FileReader>)
    }
  }

  globalThis.FileReader = MockFileReader as unknown as typeof FileReader
})

afterEach(() => {
  globalThis.document = originalDocument
  globalThis.FileReader = originalFileReader
  vi.restoreAllMocks()
})

describe('SOP reference image compression', () => {
  it('calculates decoded bytes for base64 data URLs', () => {
    expect(getDataUrlDecodedByteSize('data:image/png;base64,AAAA')).toBe(3)
    expect(getDataUrlDecodedByteSize('data:image/png;base64,AAA=')).toBe(2)
  })

  it('keeps images below the send limit unchanged', async () => {
    const dataUrl = 'data:image/png;base64,small'

    await expect(compressSopReferenceImageIfNeeded(dataUrl)).resolves.toEqual({
      dataUrl,
      compressed: false,
      originalBytes: 3,
      finalBytes: 3,
    })
    expect(canvasImageMocks.loadImageOriented).not.toHaveBeenCalled()
  })

  it('compresses oversized images into a JPEG data URL within the send limit', async () => {
    canvasImageMocks.loadImageOriented.mockResolvedValue({
      naturalWidth: 6000,
      naturalHeight: 4000,
      close: vi.fn(),
    })
    canvasImageMocks.canvasToBlob.mockResolvedValue(new Blob(['compressed'], { type: 'image/jpeg' }))
    const dataUrl = `data:image/png;base64,${'A'.repeat(
      Math.ceil(((MAX_SOP_REFERENCE_IMAGE_SEND_BYTES + 100) * 4) / 3),
    )}`

    await expect(compressSopReferenceImageIfNeeded(dataUrl)).resolves.toMatchObject({
      dataUrl: 'data:image/jpeg;base64,compressed',
      compressed: true,
      finalBytes: 10,
    })
    expect(canvasImageMocks.loadImageOriented).toHaveBeenCalledWith(dataUrl)
    expect(canvasImageMocks.canvasToBlob).toHaveBeenCalledWith(expect.any(Object), 'image/jpeg', expect.any(Number))
  })

  it('reduces the canvas when quality alone cannot reach the target', async () => {
    canvasImageMocks.loadImageOriented.mockResolvedValue({ naturalWidth: 6000, naturalHeight: 4000 })
    canvasImageMocks.canvasToBlob.mockResolvedValue(new Blob(['still-large'], { type: 'image/jpeg' }))
    const dataUrl = `data:image/png;base64,${'A'.repeat(MAX_SOP_REFERENCE_IMAGE_SEND_BYTES + 100)}`

    await expect(compressSopReferenceImageIfNeeded(dataUrl, 1)).rejects.toThrow('自动压缩后仍无法满足')
    expect(canvasImageMocks.canvasToBlob.mock.calls.length).toBeGreaterThan(7)
  })
})
