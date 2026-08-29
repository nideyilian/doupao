import { describe, expect, it } from 'vitest'
import { calculateImageSize, calculatePostprocessImageSize } from './size'

describe('calculateImageSize', () => {
  it('uses common 16:9 display resolutions for the built-in tiers', () => {
    expect(calculateImageSize('1K', '16:9')).toBe('1280x720')
    expect(calculateImageSize('2K', '16:9')).toBe('2560x1440')
    expect(calculateImageSize('4K', '16:9')).toBe('3840x2160')
  })

  it('uses matching portrait presets for common ratios', () => {
    expect(calculateImageSize('1K', '9:16')).toBe('720x1280')
    expect(calculateImageSize('2K', '9:16')).toBe('1440x2560')
    expect(calculateImageSize('2K', '2:3')).toBe('1440x2160')
    expect(calculateImageSize('2K', '3:4')).toBe('1536x2048')
  })

  it('uses a larger postprocess target for 1K 9:16 while keeping the request size unchanged', () => {
    expect(calculatePostprocessImageSize('1K', '9:16')).toBe('1080x1920')
    expect(calculatePostprocessImageSize('1K', '16:9')).toBe('1280x720')
  })

  it('falls back to budget-based sizing for custom ratios', () => {
    expect(calculateImageSize('2K', '5:4')).toBe('2288x1824')
  })
})
