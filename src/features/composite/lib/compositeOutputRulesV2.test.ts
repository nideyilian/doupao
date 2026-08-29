import { describe, expect, it } from 'vitest'
import { createDefaultCompositeV2OutputRuleGroups } from './compositeV2Defaults'
import { getEffectiveOutputRuleGroups, getEnabledOutputRules } from './compositeOutputRulesV2'
import type { CompositeV2Preset } from './compositeV2Types'

function presetWithOverride(
  useOutputOverrides: boolean,
  override = createDefaultCompositeV2OutputRuleGroups(),
): Pick<CompositeV2Preset, 'useOutputOverrides' | 'outputRuleGroupsOverride'> {
  return { useOutputOverrides, outputRuleGroupsOverride: override }
}

describe('composite v2 output rules', () => {
  it('uses global output rules when preset override is disabled', () => {
    const global = createDefaultCompositeV2OutputRuleGroups()
    global[0]!.rules[0]!.enabled = true

    const effective = getEffectiveOutputRuleGroups(presetWithOverride(false), global)

    expect(effective[0]?.rules[0]?.enabled).toBe(true)
  })

  it('uses preset output rules when override is enabled', () => {
    const global = createDefaultCompositeV2OutputRuleGroups()
    global[0]!.rules[0]!.enabled = true
    const override = createDefaultCompositeV2OutputRuleGroups()
    override[1]!.rules[1]!.enabled = true
    override[1]!.rules[1]!.maxSizeKb = 123

    const enabled = getEnabledOutputRules(getEffectiveOutputRuleGroups(presetWithOverride(true, override), global))

    expect(enabled).toHaveLength(1)
    expect(enabled[0]).toMatchObject({ channelName: '百度', name: '370x245', maxSizeKb: 299 })
  })

  it('clones global output rules before returning effective rules', () => {
    const global = createDefaultCompositeV2OutputRuleGroups()

    const effective = getEffectiveOutputRuleGroups(presetWithOverride(false), global)
    effective[0]!.name = 'mutated'
    effective[0]!.rules[0]!.enabled = true

    expect(global[0]!.name).not.toBe('mutated')
    expect(global[0]!.rules[0]!.enabled).toBe(false)
  })

  it('clones preset override output rules before returning effective rules', () => {
    const global = createDefaultCompositeV2OutputRuleGroups()
    const override = createDefaultCompositeV2OutputRuleGroups()

    const effective = getEffectiveOutputRuleGroups(presetWithOverride(true, override), global)
    effective[0]!.name = 'mutated'
    effective[0]!.rules[0]!.enabled = true

    expect(override[0]!.name).not.toBe('mutated')
    expect(override[0]!.rules[0]!.enabled).toBe(false)
  })
})
