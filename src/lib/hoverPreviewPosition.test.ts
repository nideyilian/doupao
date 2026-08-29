import { describe, expect, it } from 'vitest'
import { getHoverPreviewPosition, getHoverPreviewSize } from './hoverPreviewPosition'

describe('getHoverPreviewPosition', () => {
  it('places the preview to the right and below the pointer when there is room', () => {
    expect(
      getHoverPreviewPosition({
        pointerX: 100,
        pointerY: 120,
        previewWidth: 320,
        previewHeight: 240,
        viewportWidth: 1000,
        viewportHeight: 800,
        gap: 18,
        margin: 12,
      }),
    ).toEqual({ left: 118, top: 138 })
  })

  it('flips left and clamps vertically near viewport edges', () => {
    expect(
      getHoverPreviewPosition({
        pointerX: 930,
        pointerY: 760,
        previewWidth: 320,
        previewHeight: 240,
        viewportWidth: 1000,
        viewportHeight: 800,
        gap: 18,
        margin: 12,
      }),
    ).toEqual({ left: 592, top: 548 })
  })
})

describe('getHoverPreviewSize', () => {
  it('uses 1024px as the long edge and preserves a landscape image ratio', () => {
    expect(
      getHoverPreviewSize({
        imageWidth: 3840,
        imageHeight: 2160,
        maxLongEdge: 1024,
      }),
    ).toEqual({ width: 1024, height: 576 })
  })

  it('uses 1024px as the long edge and preserves a portrait image ratio', () => {
    expect(
      getHoverPreviewSize({
        imageWidth: 2160,
        imageHeight: 3840,
        maxLongEdge: 1024,
      }),
    ).toEqual({ width: 576, height: 1024 })
  })

  it('fits the proportional preview inside the viewport', () => {
    expect(
      getHoverPreviewSize({
        imageWidth: 3840,
        imageHeight: 2160,
        maxLongEdge: 1024,
        viewportWidth: 900,
        viewportHeight: 600,
        margin: 12,
      }),
    ).toEqual({ width: 876, height: 493 })
  })
})
