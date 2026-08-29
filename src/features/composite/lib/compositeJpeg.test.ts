import { describe, expect, it } from 'vitest'
import { chooseJpegQuality } from './compositeJpeg'

describe('chooseJpegQuality', () => {
  it('chooses the highest quality that fits within max KB', () => {
    const result = chooseJpegQuality({
      maxSizeKb: 100,
      estimateSizeKb: (quality) => (quality >= 0.8 ? 120 : quality >= 0.7 ? 100 : 90),
    })

    expect(result.quality).toBeGreaterThan(0.79)
    expect(result.quality).toBeLessThan(0.8)
  })

  it('returns the minimum quality with a warning when minimum still exceeds max KB', () => {
    const result = chooseJpegQuality({
      maxSizeKb: 100,
      minQuality: 0.6,
      estimateSizeKb: () => 150,
    })

    expect(result).toEqual({
      quality: 0.6,
      warning: '最低质量 0.6 仍超过 100KB',
    })
  })

  it('rejects invalid quality search parameters', () => {
    expect(() =>
      chooseJpegQuality({
        maxSizeKb: 100,
        minQuality: 0.9,
        maxQuality: 0.5,
        estimateSizeKb: () => 90,
      }),
    ).toThrow(/无效的/i)
  })
})
