import { describe, expect, it } from 'vitest'
import { blobToDataUrl, dataUrlToBlob } from './blobDataUrl'

describe('blobDataUrl', () => {
  it('round-trips bytes and MIME type', async () => {
    const source = new Blob([new Uint8Array([0, 1, 127, 128, 255])], { type: 'image/png' })

    const dataUrl = await blobToDataUrl(source)

    expect(dataUrl).toBe('data:image/png;base64,AAF/gP8=')
    const restored = dataUrlToBlob(dataUrl)
    expect(restored.type).toBe('image/png')
    expect(new Uint8Array(await restored.arrayBuffer())).toEqual(new Uint8Array([0, 1, 127, 128, 255]))
  })

  it('falls back to a generic MIME type when the blob has none', async () => {
    expect(await blobToDataUrl(new Blob(['a']))).toBe('data:application/octet-stream;base64,YQ==')
  })

  it('decodes a non-base64 data URL', () => {
    const blob = dataUrlToBlob('data:image/svg+xml,%3Csvg%3E')
    expect(blob.type).toBe('image/svg+xml')
  })

  it('rejects a malformed data URL instead of returning an empty blob', () => {
    expect(() => dataUrlToBlob('not-a-data-url')).toThrow()
  })

  it('handles payloads larger than the base64 chunk size', async () => {
    const bytes = new Uint8Array(0x8000 * 2 + 17).fill(7)
    const dataUrl = await blobToDataUrl(new Blob([bytes]))

    const restored = new Uint8Array(await dataUrlToBlob(dataUrl).arrayBuffer())

    expect(restored.length).toBe(bytes.length)
    expect(restored[restored.length - 1]).toBe(7)
  })
})
