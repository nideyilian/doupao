import { describe, expect, it } from 'vitest'
import { getCompositeOverlayCacheKey, getScaledLayerStrokeWidth, getScaledTextMetrics } from './compositeRendererV2'

describe('composite renderer v2', () => {
  it('scales text metrics from the preset base canvas', () => {
    expect(getScaledTextMetrics(48, 2, { width: 1280, height: 720 }, { width: 640, height: 360 })).toEqual({
      fontSize: 24,
      strokeWidth: 1,
    })
  })

  it('keys combined watermark overlays by preset revision and target size', () => {
    expect(getCompositeOverlayCacheKey({ id: 'p1', updatedAt: 123 }, { width: 640, height: 360 })).toBe(
      'p1:123:640x360',
    )
  })

  it('includes the project logo signature in the overlay cache key', () => {
    expect(getCompositeOverlayCacheKey({ id: 'p1', updatedAt: 123 }, { width: 640, height: 360 }, 'logoA|logoB')).toBe(
      'p1:123:640x360:logos=logoA|logoB',
    )
  })

  it('scales a shared layer stroke from the preset canvas', () => {
    expect(
      getScaledLayerStrokeWidth(
        { enabled: true, color: '#111827', width: 4 },
        { width: 1280, height: 720 },
        { width: 640, height: 360 },
      ),
    ).toBe(2)
  })
})
