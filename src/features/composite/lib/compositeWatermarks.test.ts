import { describe, expect, it } from 'vitest'
import { createCompositeLogoLayer, createCompositeTextLayer } from './compositeDefaults'
import {
  applyWatermarkPresetsToPreset,
  createWatermarkPresetFromLayers,
  duplicateWatermarkPreset,
  resolveWatermarkPresetSelection,
} from './compositeWatermarks'
import type { CompositePreset, CompositeWatermarkGroup } from './compositeTypes'

function presetWithLayers(layers: CompositePreset['layers']): CompositePreset {
  return {
    id: 'preset-a',
    name: 'Template',
    canvas: { width: 1280, height: 720 },
    pickMode: 'random',
    backgroundPath: '',
    patchPaths: '',
    layers,
    output: {
      main: { enabled: true, outputPath: '', namingTemplate: '{date}-{page}-{index}', maxSizeKb: 350, format: 'jpg' },
      custom: [],
    },
  }
}

describe('composite watermark helpers', () => {
  it('creates a reusable watermark preset from non-background layers', () => {
    const logo = createCompositeLogoLayer('logo-a')
    const text = createCompositeTextLayer('text-a', 'Brand text')

    const preset = createWatermarkPresetFromLayers({
      id: 'wm-a',
      name: 'Brand mark',
      layers: [logo, text],
    })

    expect(preset.kind).toBe('iconText')
    expect(preset.layers).toHaveLength(2)
    expect(preset.layers[0]).not.toBe(logo)
    expect(preset.sizeRules[0]).toMatchObject({
      name: '主尺寸输出',
      width: 1280,
      height: 720,
      namingTemplate: '{date}-{product}-{size}-{category}-{index}',
      maxSizeKb: 350,
      format: 'jpg',
    })
    expect(preset.namingTokens).toEqual([])
    expect(preset.distribution).toEqual({ enabled: false, outputPath: '', count: 0 })
  })

  it('duplicates a complete watermark preset with independent settings', () => {
    const preset = createWatermarkPresetFromLayers({
      id: 'wm-a',
      name: 'Brand mark',
      layers: [createCompositeTextLayer('text-a', 'Brand text')],
    })
    preset.sizeRules[0].outputPath = 'D:/out'
    preset.namingTokens = ['快手极速版', '纯AI']
    preset.distribution = { enabled: true, outputPath: 'D:/dist', count: 10 }

    const copy = duplicateWatermarkPreset(preset, 'wm-copy')

    expect(copy.id).toBe('wm-copy')
    expect(copy.name).toBe('Brand mark 副本')
    expect(copy.layers).toEqual(preset.layers)
    expect(copy.sizeRules).toEqual(preset.sizeRules)
    expect(copy.namingTokens).toEqual(preset.namingTokens)
    expect(copy.distribution).toEqual(preset.distribution)
    expect(copy.layers).not.toBe(preset.layers)
    expect(copy.sizeRules).not.toBe(preset.sizeRules)
  })

  it('resolves selected watermark presets and groups without duplicates', () => {
    const presetA = createWatermarkPresetFromLayers({ id: 'wm-a', name: 'A', layers: [createCompositeTextLayer('a')] })
    const presetB = createWatermarkPresetFromLayers({ id: 'wm-b', name: 'B', layers: [createCompositeLogoLayer('b')] })
    const group: CompositeWatermarkGroup = { id: 'group-a', name: 'Group A', presetIds: ['wm-a', 'wm-b'] }

    const resolved = resolveWatermarkPresetSelection([presetA, presetB], [group], ['wm-b'], ['group-a'])

    expect(resolved.map((item) => item.id)).toEqual(['wm-b', 'wm-a'])
  })

  it('applies selected watermark presets as cloned generated layers', () => {
    const baseLogo = createCompositeLogoLayer('base-logo')
    const base = presetWithLayers([baseLogo])
    const watermark = createWatermarkPresetFromLayers({
      id: 'wm-a',
      name: 'Mark',
      layers: [createCompositeTextLayer('wm-text')],
    })

    const next = applyWatermarkPresetsToPreset(base, [watermark])

    expect(next.layers).toHaveLength(2)
    expect(next.layers[0]).toBe(baseLogo)
    expect(next.layers[1].id).toContain('wm-a')
    expect(next.layers[1].watermarkPresetId).toBe('wm-a')
  })
})
