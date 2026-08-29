import type { CompositeV2OutputRuleGroup, CompositeV2OutputSizeRule, CompositeV2Preset } from './compositeV2Types'

export type CompositeV2EnabledOutputRule = CompositeV2OutputSizeRule & {
  channelId: string
  channelName: string
}

export function getEffectiveOutputRuleGroups(
  preset: Pick<CompositeV2Preset, 'useOutputOverrides' | 'outputRuleGroupsOverride'>,
  globalGroups: CompositeV2OutputRuleGroup[],
): CompositeV2OutputRuleGroup[] {
  if (!preset.useOutputOverrides) {
    return globalGroups.map((group) => ({
      ...group,
      rules: group.rules.map((rule) => ({ ...rule })),
    }))
  }

  // Merge override rules with global rules
  return globalGroups.map((globalGroup) => {
    const overrideGroup = preset.outputRuleGroupsOverride.find((g) => g.id === globalGroup.id)
    return {
      ...globalGroup,
      rules: globalGroup.rules.map((globalRule) => {
        const overrideRule = overrideGroup?.rules.find((r) => r.id === globalRule.id)
        return {
          ...globalRule,
          enabled: overrideRule ? overrideRule.enabled : globalRule.enabled,
        }
      }),
    }
  })
}

export function getEnabledOutputRules(groups: CompositeV2OutputRuleGroup[]): CompositeV2EnabledOutputRule[] {
  return groups.flatMap((group) =>
    group.rules
      .filter((rule) => rule.enabled)
      .map((rule) => ({ ...rule, channelId: group.id, channelName: group.name })),
  )
}
