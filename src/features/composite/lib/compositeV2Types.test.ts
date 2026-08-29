import { describe, expect, it } from 'vitest'
import { createDefaultCompositeV2State } from './compositeV2Defaults'

describe('composite v2 defaults', () => {
  it('creates readable Chinese defaults and jpg output rules', () => {
    const state = createDefaultCompositeV2State()
    expect(state.presets[0]).toMatchObject({
      name: '默认产品预设',
      baseCanvas: { width: 1280, height: 720 },
      outputRootPath: '',
      useOutputOverrides: false,
    })
    expect(state.presets[0]?.layers).toEqual([])
    expect(state.globalFitMode).toBe('crop-fill')
    expect(state.historyRetention).toBe(10)
    expect(state.outputRuleGroups.map((group) => group.name)).toEqual(['广点通', '百度', '厂商', '头条'])
    expect(state.outputRuleGroups[0]?.rules[0]).toMatchObject({
      name: '1280x720',
      width: 1280,
      height: 720,
      maxSizeKb: 399,
      format: 'jpg',
    })
  })
})
