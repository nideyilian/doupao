import { describe, expect, it } from 'vitest'
import { DEFAULT_AD_NEGATIVE_RULE_PROFILES } from '../types'
import {
  appendAdNegativeRule,
  createAdNegativeRuleSnapshot,
  getAdNegativeRule,
  normalizeAdNegativeRuleProfiles,
} from './adNegativeRules'

describe('ad negative rules', () => {
  it('always restores the three built-in profiles and preserves valid custom profiles', () => {
    const profiles = normalizeAdNegativeRuleProfiles([
      {
        id: 'custom-1',
        name: '自定义',
        description: '测试',
        content: '不得生成二维码',
        source: 'custom',
        platform: 'custom',
        version: 2,
        updatedAt: 1,
      },
    ])
    expect(profiles.slice(0, 3).map((rule) => rule.id)).toEqual(
      DEFAULT_AD_NEGATIVE_RULE_PROFILES.map((rule) => rule.id),
    )
    expect(profiles.find((rule) => rule.id === 'custom-1')?.content).toBe('不得生成二维码')
  })

  it('falls back to the strict general profile and appends a separate request-only constraint', () => {
    const settings = { adNegativeRuleProfiles: normalizeAdNegativeRuleProfiles([]) }
    const rule = getAdNegativeRule(settings, 'missing')
    const snapshot = createAdNegativeRuleSnapshot(settings, rule.id)
    expect(rule.id).toBe('general-strict')
    expect(snapshot.name).toBe('通用严格')
    expect(appendAdNegativeRule('一只狗', snapshot.content)).toContain('【信息流广告负向约束：禁止生成以下元素】')
  })
})
