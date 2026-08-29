import { describe, expect, it } from 'vitest'
import { chooseRenderBranch, mapLayerPositionToCanvas, planBackgroundFit } from './compositeRenderPlan'

describe('composite render plan', () => {
  it('chooses source-first when source and target ratios match within tolerance', () => {
    expect(chooseRenderBranch({ width: 1280, height: 720 }, { width: 1920, height: 1080 })).toBe('source-first')
  })

  it('chooses target-first when source and target ratios differ beyond tolerance', () => {
    expect(chooseRenderBranch({ width: 1280, height: 720 }, { width: 1080, height: 1920 })).toBe('target-first')
  })

  it('plans crop-fill as a centered source crop that fills the target', () => {
    expect(planBackgroundFit('crop-fill', { width: 1000, height: 500 }, { width: 300, height: 300 })).toMatchObject({
      sx: 250,
      sy: 0,
      sw: 500,
      sh: 500,
      dx: 0,
      dy: 0,
      dw: 300,
      dh: 300,
    })
  })

  it('plans contain-blur as a centered full-image fit inside the target', () => {
    expect(planBackgroundFit('contain-blur', { width: 400, height: 200 }, { width: 300, height: 300 })).toMatchObject({
      sx: 0,
      sy: 0,
      sw: 400,
      sh: 200,
      dx: 0,
      dy: 75,
      dw: 300,
      dh: 150,
    })
  })

  it('plans stretch as a direct source-to-target draw', () => {
    expect(planBackgroundFit('stretch', { width: 400, height: 200 }, { width: 300, height: 300 })).toMatchObject({
      sx: 0,
      sy: 0,
      sw: 400,
      sh: 200,
      dx: 0,
      dy: 0,
      dw: 300,
      dh: 300,
    })
  })

  it('rejects unknown background fit modes', () => {
    expect(() =>
      planBackgroundFit('mystery' as never, { width: 400, height: 200 }, { width: 300, height: 300 }),
    ).toThrow(/未知的/i)
  })

  it('maps free position from base canvas to target canvas', () => {
    expect(
      mapLayerPositionToCanvas(
        { mode: 'free', x: 128, y: 72, width: 256, height: 144 },
        { width: 1280, height: 720 },
        { width: 640, height: 360 },
      ),
    ).toEqual({ x: 64, y: 36, width: 128, height: 72 })
  })

  it('maps anchor position using scaled size, margins, and offsets', () => {
    expect(
      mapLayerPositionToCanvas(
        {
          mode: 'anchor',
          anchor: 'top-left',
          marginX: 128,
          marginY: 72,
          offsetX: 32,
          offsetY: 16,
          width: 256,
          height: 144,
        },
        { width: 1280, height: 720 },
        { width: 640, height: 360 },
      ),
    ).toEqual({ x: 80, y: 44, width: 128, height: 72 })
  })

  it('rejects invalid sizes when choosing a render branch', () => {
    expect(() => chooseRenderBranch({ width: 0, height: 720 }, { width: 1920, height: 1080 })).toThrow(/无效的/i)
  })

  it('rejects invalid sizes when planning background fit', () => {
    expect(() =>
      planBackgroundFit('crop-fill', { width: 1000, height: 500 }, { width: Number.NaN, height: 300 }),
    ).toThrow(/无效的/i)
  })

  it('rejects invalid sizes when mapping layer positions', () => {
    expect(() =>
      mapLayerPositionToCanvas(
        { mode: 'free', x: 1, y: 2, width: 3, height: 4 },
        { width: 1280, height: -1 },
        { width: 640, height: 360 },
      ),
    ).toThrow(/无效的/i)
  })

  it('rejects invalid free layer dimensions', () => {
    expect(() =>
      mapLayerPositionToCanvas(
        { mode: 'free', x: 1, y: 2, width: 0, height: 4 },
        { width: 1280, height: 720 },
        { width: 640, height: 360 },
      ),
    ).toThrow(/无效的/i)
  })

  it('rejects non-finite free layer coordinates', () => {
    expect(() =>
      mapLayerPositionToCanvas(
        { mode: 'free', x: Number.POSITIVE_INFINITY, y: 2, width: 3, height: 4 },
        { width: 1280, height: 720 },
        { width: 640, height: 360 },
      ),
    ).toThrow(/无效的/i)
  })

  it('rejects invalid anchor layer dimensions', () => {
    expect(() =>
      mapLayerPositionToCanvas(
        {
          mode: 'anchor',
          anchor: 'center',
          marginX: 0,
          marginY: 0,
          offsetX: 0,
          offsetY: 0,
          width: Number.NaN,
          height: 4,
        },
        { width: 1280, height: 720 },
        { width: 640, height: 360 },
      ),
    ).toThrow(/无效的/i)
  })

  it('rejects non-finite anchor margins and offsets', () => {
    expect(() =>
      mapLayerPositionToCanvas(
        {
          mode: 'anchor',
          anchor: 'center',
          marginX: Number.POSITIVE_INFINITY,
          marginY: 0,
          offsetX: 0,
          offsetY: Number.NaN,
          width: 3,
          height: 4,
        },
        { width: 1280, height: 720 },
        { width: 640, height: 360 },
      ),
    ).toThrow(/无效的/i)
  })

  it('rejects unknown position modes', () => {
    expect(() =>
      mapLayerPositionToCanvas(
        { mode: 'mystery' as never, x: 1, y: 2, width: 3, height: 4 },
        { width: 1280, height: 720 },
        { width: 640, height: 360 },
      ),
    ).toThrow(/未知的/i)
  })

  it('rejects unknown anchor values', () => {
    expect(() =>
      mapLayerPositionToCanvas(
        {
          mode: 'anchor',
          anchor: 'mystery' as never,
          marginX: 0,
          marginY: 0,
          offsetX: 0,
          offsetY: 0,
          width: 3,
          height: 4,
        },
        { width: 1280, height: 720 },
        { width: 640, height: 360 },
      ),
    ).toThrow(/未知的/i)
  })
})
