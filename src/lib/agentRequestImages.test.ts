import { describe, expect, it, vi } from 'vitest'
import { prepareAgentImageDataUrls, prepareAgentInputImages } from './agentRequestImages'

function createDataUrl(payloadLength: number, fill = 'A') {
  return `data:image/png;base64,${fill.repeat(payloadLength)}`
}

const MAX_SINGLE_IMAGE_BYTES = 80_000
const MAX_TOTAL_IMAGE_BYTES = 100_000
const IMAGE_PAYLOAD_BYTES = 40_000

describe('Agent request images', () => {
  it('keeps the newest images and omits older images when the total budget is full', async () => {
    const oldImage = createDataUrl(IMAGE_PAYLOAD_BYTES)
    const newImage = createDataUrl(IMAGE_PAYLOAD_BYTES)

    await expect(
      prepareAgentImageDataUrls([oldImage, newImage], {
        maxTotalEncodedBytes: MAX_TOTAL_IMAGE_BYTES,
        maxSingleEncodedBytes: MAX_SINGLE_IMAGE_BYTES,
      }),
    ).resolves.toEqual([null, newImage])
  })

  it('compresses an oversized image to fit the remaining request budget', async () => {
    const image = createDataUrl(MAX_SINGLE_IMAGE_BYTES + 1)
    const compressedImage = createDataUrl(40)
    const compressImage = vi.fn(async () => ({ dataUrl: compressedImage }))

    await expect(
      prepareAgentImageDataUrls([image], {
        maxTotalEncodedBytes: MAX_TOTAL_IMAGE_BYTES,
        maxSingleEncodedBytes: MAX_SINGLE_IMAGE_BYTES,
        compressImage,
      }),
    ).resolves.toEqual([compressedImage])
    expect(compressImage).toHaveBeenCalledWith(image, expect.any(Number))
  })

  it('marks omitted input images without dropping surrounding text', async () => {
    const oldImage = createDataUrl(IMAGE_PAYLOAD_BYTES)
    const newImage = createDataUrl(IMAGE_PAYLOAD_BYTES, 'B')
    const input = [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: '旧图 <old-ref />' },
          { type: 'input_image', image_url: oldImage },
          { type: 'input_text', text: '新图 <new-ref />' },
          { type: 'input_image', image_url: newImage },
        ],
      },
    ]

    const prepared = await prepareAgentInputImages(input, {
      maxTotalEncodedBytes: MAX_TOTAL_IMAGE_BYTES,
      maxSingleEncodedBytes: MAX_SINGLE_IMAGE_BYTES,
    })

    expect(prepared).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: '旧图 <old-ref />' },
          { type: 'input_text', text: '<image_omitted />' },
          { type: 'input_text', text: '新图 <new-ref />' },
          { type: 'input_image', image_url: newImage },
        ],
      },
    ])
    expect(JSON.stringify(prepared)).not.toContain(oldImage)
  })
})
