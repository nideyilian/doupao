import { describe, expect, it } from 'vitest'
import {
  buildWatermarkExportJobs,
  createWatermarkShapeLayer,
  createWatermarkTextLayer,
  createDistributedFileName,
  replaceLogoLayer,
  type WatermarkLayer,
  type WatermarkPreset,
} from './watermarkWorkbench'

const logoLayer: WatermarkLayer = {
  id: 'logo-layer',
  type: 'image',
  x: 48,
  y: 32,
  width: 120,
  height: 120,
  opacity: 0.85,
  sourceId: 'old-logo',
  sourceName: '旧 LOGO',
  sourceDataUrl: 'data:image/png;base64,old',
}

const textLayer: WatermarkLayer = {
  id: 'text-layer',
  type: 'text',
  x: 22,
  y: 76,
  width: 280,
  height: 40,
  opacity: 1,
  text: '产品保障说明',
  fontSize: 24,
  color: '#111827',
  fontFamily: 'sans-serif',
  fontWeight: 700,
  italic: false,
  align: 'center',
  strokeColor: '#ffffff',
  strokeWidth: 0,
}

function preset(overrides: Partial<WatermarkPreset> = {}): WatermarkPreset {
  return {
    id: 'preset-a',
    name: '保障模板',
    layers: [logoLayer, textLayer],
    selected: true,
    ...overrides,
  }
}

describe('watermark workbench helpers', () => {
  it('replaces a logo layer while preserving position and size', () => {
    expect(
      replaceLogoLayer(logoLayer, {
        id: 'new-logo',
        name: '新 LOGO',
        dataUrl: 'data:image/png;base64,new',
      }),
    ).toEqual({
      ...logoLayer,
      sourceId: 'new-logo',
      sourceName: '新 LOGO',
      sourceDataUrl: 'data:image/png;base64,new',
    })
  })

  it('does not treat text layers as replaceable logo layers', () => {
    expect(
      replaceLogoLayer(textLayer, {
        id: 'new-logo',
        name: '新 LOGO',
        dataUrl: 'data:image/png;base64,new',
      }),
    ).toBe(textLayer)
  })

  it('builds one export job for each image and selected preset pair', () => {
    const jobs = buildWatermarkExportJobs(
      [
        { id: 'image-a', name: 'a.png', dataUrl: 'data:image/png;base64,a' },
        { id: 'image-b', name: 'b.png', dataUrl: 'data:image/png;base64,b' },
      ],
      [
        preset({ id: 'preset-a', name: '保障模板', selected: true }),
        preset({ id: 'preset-b', name: '头图模板', selected: false }),
        preset({ id: 'preset-c', name: '短视频模板', selected: true }),
      ],
    )

    expect(jobs.map((job) => `${job.image.id}:${job.preset.id}`)).toEqual([
      'image-a:preset-a',
      'image-a:preset-c',
      'image-b:preset-a',
      'image-b:preset-c',
    ])
  })

  it('creates distribution names from date, image, and preset tokens', () => {
    expect(
      createDistributedFileName({
        pattern: '{date}-{image}-{preset}',
        imageName: '月亮-大图.png',
        presetName: '保障/LOGO',
        date: new Date('2026-06-21T08:30:00Z'),
        extension: 'webp',
      }),
    ).toBe('2026-06-21-月亮-大图-保障-LOGO.webp')
  })
})

describe('watermark layer factories', () => {
  it('creates styled text layers with stroke controls', () => {
    expect(createWatermarkTextLayer('headline', '主标题')).toMatchObject({
      id: 'headline',
      type: 'text',
      text: '主标题',
      fontFamily: 'sans-serif',
      fontWeight: 700,
      italic: false,
      align: 'center',
      strokeColor: '#ffffff',
      strokeWidth: 0,
    })
  })

  it('creates vector shape layers', () => {
    expect(createWatermarkShapeLayer('shape-a', 'rect')).toMatchObject({
      id: 'shape-a',
      type: 'shape',
      shape: 'rect',
      fill: '#ffffff',
      strokeColor: '#111827',
      strokeWidth: 0,
      radius: 0,
    })
  })
})
