import { DEFAULT_AD_NEGATIVE_RULE_PROFILES, type AdNegativeRuleProfile, type AppSettings } from '../types'

export function normalizeAdNegativeRuleProfiles(value: unknown): AdNegativeRuleProfile[] {
  const custom = Array.isArray(value)
    ? value.flatMap((item): AdNegativeRuleProfile[] => {
        if (!item || typeof item !== 'object') return []
        const record = item as Record<string, unknown>
        if (record.source === 'builtin') return []
        const id = typeof record.id === 'string' ? record.id.trim() : ''
        const name = typeof record.name === 'string' ? record.name.trim() : ''
        const content = typeof record.content === 'string' ? record.content.trim() : ''
        if (!id || !name || !content || DEFAULT_AD_NEGATIVE_RULE_PROFILES.some((rule) => rule.id === id)) return []
        return [
          {
            id,
            name,
            content,
            description: typeof record.description === 'string' ? record.description.trim() : '',
            source: 'custom',
            platform: 'custom',
            version:
              typeof record.version === 'number' && Number.isFinite(record.version)
                ? Math.max(1, Math.trunc(record.version))
                : 1,
            updatedAt:
              typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? record.updatedAt : Date.now(),
          },
        ]
      })
    : []
  return [
    ...DEFAULT_AD_NEGATIVE_RULE_PROFILES.map((rule) => ({ ...rule })),
    ...custom.filter((rule, index, list) => list.findIndex((item) => item.id === rule.id) === index),
  ]
}

export function getAdNegativeRule(
  settings: Pick<AppSettings, 'adNegativeRuleProfiles'>,
  ruleId: string,
): AdNegativeRuleProfile {
  return (
    settings.adNegativeRuleProfiles.find((rule) => rule.id === ruleId) ??
    settings.adNegativeRuleProfiles.find((rule) => rule.id === 'general-strict') ??
    DEFAULT_AD_NEGATIVE_RULE_PROFILES[0]
  )
}

export function createAdNegativeRuleSnapshot(settings: Pick<AppSettings, 'adNegativeRuleProfiles'>, ruleId: string) {
  const rule = getAdNegativeRule(settings, ruleId)
  return { id: rule.id, name: rule.name, content: rule.content, version: rule.version }
}

export function appendAdNegativeRule(prompt: string, content?: string): string {
  const rule = content?.trim()
  if (!rule) return prompt
  return `${prompt.trim()}\n\n【信息流广告负向约束：禁止生成以下元素】\n${rule}`
}
