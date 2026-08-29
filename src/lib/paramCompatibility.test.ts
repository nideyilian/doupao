import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultFalProfile, createDefaultOpenAIProfile, DEFAULT_SETTINGS, normalizeSettings } from './apiProfiles'
import { getOutputImageLimitForSettings, normalizeParamsForSettings } from './paramCompatibility'

describe('parameter compatibility', () => {
  it('does not cap OpenAI output count', () => {
    const openAIProfile = createDefaultOpenAIProfile({ apiKey: 'test-key', streamImages: false })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [openAIProfile],
      activeProfileId: openAIProfile.id,
    })

    expect(getOutputImageLimitForSettings()).toBe(Infinity)
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 100 }, settings).n).toBe(100)
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 1 }, settings).n).toBe(1)
  })

  it('does not cap fal.ai output count', () => {
    const falProfile = createDefaultFalProfile({ apiKey: 'fal-key' })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [falProfile],
      activeProfileId: falProfile.id,
    })

    expect(getOutputImageLimitForSettings()).toBe(Infinity)
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 50 }, settings).n).toBe(50)
  })

  it('keeps OpenAI streaming output count so the request can disable streaming', () => {
    const openAIProfile = createDefaultOpenAIProfile({ apiKey: 'test-key', streamImages: true })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [openAIProfile],
      activeProfileId: openAIProfile.id,
    })

    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 4 }, settings).n).toBe(4)
  })

  it('keeps all-reference mode and defaults legacy values to per-image mode', () => {
    const openAIProfile = createDefaultOpenAIProfile({ apiKey: 'test-key' })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [openAIProfile],
      activeProfileId: openAIProfile.id,
    })

    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, reference_mode: 'all' }, settings).reference_mode).toBe(
      'all',
    )
    expect(
      normalizeParamsForSettings({ ...DEFAULT_PARAMS, reference_mode: undefined } as any, settings).reference_mode,
    ).toBe('cycle')
  })

  it('only replaces fal.ai auto size in text-to-image mode', () => {
    const falProfile = createDefaultFalProfile({ apiKey: 'fal-key' })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [falProfile],
      activeProfileId: falProfile.id,
    })

    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: 'auto' }, settings).size).toBe('1360x1024')
    expect(
      normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: 'auto' }, settings, { hasInputImages: true }).size,
    ).toBe('auto')
  })

  it('locks 0.7.56 generation defaults for OpenAI (n=1, auto size/quality, cycle reference)', () => {
    // 回归保护：生图链路默认行为与 0.7.56 保持一致，防止后续版本改写直觉默认值
    const openAIProfile = createDefaultOpenAIProfile({ apiKey: 'test-key' })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [openAIProfile],
      activeProfileId: openAIProfile.id,
    })

    const normalized = normalizeParamsForSettings({ ...DEFAULT_PARAMS }, settings)
    expect(normalized.n).toBe(1)
    expect(normalized.size).toBe('auto')
    expect(normalized.quality).toBe('auto')
    expect(normalized.reference_mode).toBe('cycle')
    expect(normalized.moderation).toBe('auto')
    expect(normalized.output_format).toBe('png')
    expect(normalized.adNegativeRuleId).toBe('general-strict')

    // 数量不会被抹平：用户显式设置的数量必须原样保留（0.7.56 行为）
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 4 }, settings).n).toBe(4)
  })
})
