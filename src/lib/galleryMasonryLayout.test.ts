import { describe, expect, it } from 'vitest'
import { buildGalleryMasonryLayout, getVisibleGalleryMasonryItems } from './galleryMasonryLayout'

describe('gallery masonry layout', () => {
  it('places each image in the shortest column using its aspect ratio', () => {
    const layout = buildGalleryMasonryLayout({
      aspectRatios: [1, 2, 0.5, 1],
      columnWidth: 100,
      columns: 2,
      gap: 10,
    })

    expect(layout.items).toEqual([
      expect.objectContaining({ index: 0, left: 0, top: 0, width: 100, height: 100 }),
      expect.objectContaining({ index: 1, left: 110, top: 0, width: 100, height: 50 }),
      expect.objectContaining({ index: 2, left: 110, top: 60, width: 100, height: 200 }),
      expect.objectContaining({ index: 3, left: 0, top: 110, width: 100, height: 100 }),
    ])
    expect(layout.totalHeight).toBe(260)
  })

  it('returns only items around the viewport while preserving item order', () => {
    const layout = buildGalleryMasonryLayout({
      aspectRatios: [1, 1, 1, 1, 1, 1],
      columnWidth: 100,
      columns: 2,
      gap: 10,
    })

    expect(getVisibleGalleryMasonryItems(layout, 115, 100, 0).map((item) => item.index)).toEqual([2, 3])
  })
})
