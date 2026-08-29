import { describe, expect, it } from 'vitest'
import { createDefaultCompositeOutputPresetGroups, getSelectedCompositeOutputRules } from './compositeOutputPresets'

describe('composite output presets', () => {
  it('creates the requested shared output preset groups', () => {
    const groups = createDefaultCompositeOutputPresetGroups()

    expect(groups.map((group) => group.name)).toEqual(['广点通/头条', '百度', '厂商'])
    expect(groups[0].rules.map((rule) => [rule.width, rule.height, rule.maxSizeKb])).toEqual([
      [1280, 720, 399],
      [1080, 1920, 399],
    ])
    expect(groups[1].rules.map((rule) => [rule.width, rule.height, rule.maxSizeKb])).toEqual([
      [1140, 640, 299],
      [370, 245, 299],
      [1080, 1920, 399],
    ])
    expect(groups[2].rules.map((rule) => [rule.width, rule.height, rule.maxSizeKb])).toEqual([
      [1280, 720, 99],
      [1080, 1920, 99],
      [320, 211, 80],
      [320, 210, 80],
    ])
  })

  it('returns only selected enabled output rules', () => {
    const groups = createDefaultCompositeOutputPresetGroups()
    groups[0].rules[0].enabled = true
    groups[1].rules[2].enabled = true
    groups[2].rules[0].enabled = false

    expect(getSelectedCompositeOutputRules(groups).map((rule) => rule.id)).toEqual([
      'gdt-toutiao-1280x720',
      'baidu-1080x1920',
    ])
    expect(getSelectedCompositeOutputRules(groups).map((rule) => rule.categoryName)).toEqual(['广点通/头条', '百度'])
  })
})
