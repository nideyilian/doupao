import { describe, expect, it } from 'vitest'
import { calculateImageSize, calculatePostprocessImageSize, inferSizeTier, normalizeImageSize } from './size'

describe('calculateImageSize', () => {
  it('uses common 16:9 display resolutions for the built-in tiers', () => {
    expect(calculateImageSize('1K', '16:9')).toBe('1280x720')
    expect(calculateImageSize('2K', '16:9')).toBe('2560x1440')
    expect(calculateImageSize('4K', '16:9')).toBe('3840x2160')
  })

  it('uses matching portrait presets for common ratios', () => {
    expect(calculateImageSize('1K', '9:16')).toBe('1080x1920')
    expect(calculateImageSize('2K', '9:16')).toBe('1440x2560')
    expect(calculateImageSize('2K', '2:3')).toBe('1440x2160')
    expect(calculateImageSize('2K', '3:4')).toBe('1536x2048')
  })

  it('uses the same 1K 9:16 size for the request and postprocess target', () => {
    expect(calculatePostprocessImageSize('1K', '9:16')).toBe('1080x1920')
    expect(calculatePostprocessImageSize('1K', '16:9')).toBe('1280x720')
  })

  it('keeps the 1K 9:16 preset in the 1K tier despite its pixel count', () => {
    expect(inferSizeTier('1080x1920')).toBe('1K')
  })

  it('preserves the exact 1K 9:16 request size during normalization', () => {
    expect(normalizeImageSize('1080x1920')).toBe('1080x1920')
  })

  it('falls back to budget-based sizing for custom ratios', () => {
    expect(calculateImageSize('2K', '5:4')).toBe('2288x1824')
  })
})
