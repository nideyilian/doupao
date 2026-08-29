import { describe, expect, it } from 'vitest'
import { getGalleryImageAspectRatio, getGalleryImageGridMetrics } from './galleryImageGrid'

describe('getGalleryImageGridMetrics', () => {
  it('uses the requested column count and distributes all remaining width', () => {
    const metrics = getGalleryImageGridMetrics(1_248, 4, 12)

    expect(metrics.columns).toBe(4)
    expect(metrics.columns * metrics.tileSize + (metrics.columns - 1) * 12).toBeCloseTo(1_248)
    expect(metrics.tileSize).toBeCloseTo(303)
  })

  it('keeps the requested column count in a narrow container', () => {
    expect(getGalleryImageGridMetrics(80, 3, 12)).toEqual({ columns: 3, tileSize: 56 / 3 })
  })

  it('uses the same full-width calculation for task cards', () => {
    const metrics = getGalleryImageGridMetrics(1_200, 3, 16)

    expect(metrics.columns).toBe(3)
    expect(metrics.columns * metrics.tileSize + (metrics.columns - 1) * 16).toBeCloseTo(1_200)
  })

  it('derives an image aspect ratio from the generated image size', () => {
    expect(getGalleryImageAspectRatio('1536x1024')).toBe(1.5)
    expect(getGalleryImageAspectRatio('1024 × 1536')).toBeCloseTo(2 / 3)
    expect(getGalleryImageAspectRatio('auto')).toBe(1)
  })
})
