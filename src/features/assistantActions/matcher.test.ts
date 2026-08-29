import { describe, expect, it } from 'vitest'
import type { AssistantInputContext } from './types'
import { BUILT_IN_ASSISTANT_ACTION_IDS, DEFAULT_INFORMATION_FLOW_AD_VARIABLE_CATEGORIES } from './builtInActions'
import {
  getDefaultBuiltInSkillSettings,
  buildCustomSkillFromDraft,
  getRecommendedAssistantActions,
  getResolvedBuiltInActions,
  isAssistantActionRunnable,
  migrateAssistantActionsToV2,
  normalizeAssistantActionPreferences,
  normalizeCustomSkills,
  resolveEffectiveVisualSkill,
  resolveWordConfig,
} from './matcher'

function context(patch: Partial<AssistantInputContext> = {}): AssistantInputContext {
  return {
    text: '',
    hasText: false,
    images: [],
    hasImage: false,
    imageCount: 0,
    ...patch,
  }
}

describe('default skill set', () => {
  it('strictly contains the four default skills in fixed order', () => {
    expect(BUILT_IN_ASSISTANT_ACTION_IDS).toEqual(['prompt-optimize', 'image-describe', 'super-derive', 'wild-derive'])
  })

  it('recommends exactly the four default skills on the bar', () => {
    const actions = getRecommendedAssistantActions(context({ hasText: true }))
    expect(actions.map((action) => action.id)).toEqual([
      'prompt-optimize',
      'image-describe',
      'super-derive',
      'wild-derive',
    ])
  })
})

describe('input-mode runnability', () => {
  const prefs = normalizeAssistantActionPreferences(undefined)
  const find = (id: string) => getResolvedBuiltInActions(prefs).find((action) => action.id === id)!

  it('disables all skills when there is no input', () => {
    const ctx = context()
    for (const id of BUILT_IN_ASSISTANT_ACTION_IDS) {
      expect(isAssistantActionRunnable(find(id), ctx)).toBe(false)
    }
  })

  it('text-only enables prompt-optimize / super-derive / wild-derive, not image-describe', () => {
    const ctx = context({ text: '产品卖点', hasText: true })
    expect(isAssistantActionRunnable(find('prompt-optimize'), ctx)).toBe(true)
    expect(isAssistantActionRunnable(find('image-describe'), ctx)).toBe(false)
    expect(isAssistantActionRunnable(find('super-derive'), ctx)).toBe(true)
    expect(isAssistantActionRunnable(find('wild-derive'), ctx)).toBe(true)
  })

  it('image-only enables image-describe / super-derive / wild-derive, not prompt-optimize', () => {
    const ctx = context({ hasImage: true, imageCount: 1 })
    expect(isAssistantActionRunnable(find('prompt-optimize'), ctx)).toBe(false)
    expect(isAssistantActionRunnable(find('image-describe'), ctx)).toBe(true)
    expect(isAssistantActionRunnable(find('super-derive'), ctx)).toBe(true)
    expect(isAssistantActionRunnable(find('wild-derive'), ctx)).toBe(true)
  })

  it('text + image enables all four default skills', () => {
    const ctx = context({ text: '产品卖点', hasText: true, hasImage: true, imageCount: 1 })
    for (const id of BUILT_IN_ASSISTANT_ACTION_IDS) {
      expect(isAssistantActionRunnable(find(id), ctx)).toBe(true)
    }
  })

  it('custom skills follow their own inputMode', () => {
    const customs = normalizeCustomSkills([
      { id: 'c-text', name: '文字技能', instruction: '只处理文字', trigger: 'text', inputMode: 'text' },
      { id: 'c-img', name: '图片技能', instruction: '只处理图片', trigger: 'image', inputMode: 'image' },
    ])
    const ctx = context({ text: 'x', hasText: true })
    expect(isAssistantActionRunnable(customs[0], ctx)).toBe(true)
    expect(isAssistantActionRunnable(customs[1], ctx)).toBe(false)
  })
})

describe('effective skill resolution', () => {
  it('super-derive defaults to six enabled information-flow dimensions with copy disabled', () => {
    const prefs = normalizeAssistantActionPreferences(undefined)
    const skill = getResolvedBuiltInActions(prefs).find((action) => action.id === 'super-derive')!
    const effective = resolveEffectiveVisualSkill(skill, prefs)
    expect(effective.intensity).toBe('high')
    expect(effective.wordEntries?.strategy).toBe('atomic')
    expect(effective.wordEntries?.categories).toEqual(['风格', '主体', '排版', '装饰元素', '配色', '背景'])
    expect(effective.wordEntries?.categories).not.toContain('文案')
    expect(effective.wordEntries?.count).toBe(8)
  })

  it('migrates the former default dimensions but preserves a custom dimension selection', () => {
    const defaults = getDefaultBuiltInSkillSettings()
    const legacy = normalizeAssistantActionPreferences({
      builtInSkillSettings: {
        ...defaults,
        'super-derive': {
          ...defaults['super-derive'],
          wordEntries: {
            ...defaults['super-derive'].wordEntries,
            categories: [
              '主视觉主体',
              '视觉符号',
              '动作状态',
              '情绪氛围',
              '材质表现',
              '光影效果',
              '背景环境',
              '商业构图',
            ],
          },
        },
      },
    })
    expect(legacy.builtInSkillSettings['super-derive'].wordEntries.categories).toEqual([
      '风格',
      '主体',
      '排版',
      '装饰元素',
      '配色',
      '背景',
    ])

    const custom = normalizeAssistantActionPreferences({
      builtInSkillSettings: {
        ...defaults,
        'super-derive': {
          ...defaults['super-derive'],
          wordEntries: { ...defaults['super-derive'].wordEntries, categories: ['主体', '文案'] },
        },
      },
    })
    expect(custom.builtInSkillSettings['super-derive'].wordEntries.categories).toEqual(['主体', '文案'])
  })

  it('wild-derive resolves to maximum intensity, direction-pack, 创意方向', () => {
    const prefs = normalizeAssistantActionPreferences(undefined)
    const skill = getResolvedBuiltInActions(prefs).find((action) => action.id === 'wild-derive')!
    const effective = resolveEffectiveVisualSkill(skill, prefs)
    expect(effective.intensity).toBe('maximum')
    expect(effective.wordEntries?.strategy).toBe('direction-pack')
    expect(effective.wordEntries?.categories).toEqual(['创意方向'])
    expect(effective.conceptCategories).toEqual(DEFAULT_INFORMATION_FLOW_AD_VARIABLE_CATEGORIES)
    expect(effective.wordEntries?.count).toBe(12)
  })

  it('per-skill settings override the skill default word config', () => {
    const prefs = normalizeAssistantActionPreferences({
      builtInSkillSettings: {
        ...getDefaultBuiltInSkillSettings(),
        'super-derive': {
          wordEntries: { enabled: true, count: 4, categories: ['主视觉主体'], strategy: 'atomic' },
          autoSave: true,
          applyMode: 'replace',
          targetGroupMode: 'new',
          targetGroupId: null,
        },
        'wild-derive': getDefaultBuiltInSkillSettings()['wild-derive'],
      },
    })
    const skill = getResolvedBuiltInActions(prefs).find((action) => action.id === 'super-derive')!
    const word = resolveWordConfig(skill, prefs)
    expect(word?.count).toBe(4)
    expect(word?.categories).toEqual(['主视觉主体'])
  })

  it('allows non-variable built-ins to enable a custom variable configuration', () => {
    const defaults = getDefaultBuiltInSkillSettings()
    const prefs = normalizeAssistantActionPreferences({
      builtInSkillSettings: {
        ...defaults,
        'image-describe': {
          ...defaults['image-describe'],
          wordEntries: { enabled: true, count: 6, categories: ['镜头语言'], strategy: 'atomic' },
        },
      },
    })
    const skill = getResolvedBuiltInActions(prefs).find((action) => action.id === 'image-describe')!
    expect(resolveWordConfig(skill, prefs)).toMatchObject({
      enabled: true,
      count: 6,
      categories: ['镜头语言'],
    })
  })

  it('locks wild-derive to its direction-pack contract, preserves its variable, and restores empty super categories', () => {
    const prefs = normalizeAssistantActionPreferences({
      builtInSkillSettings: {
        ...getDefaultBuiltInSkillSettings(),
        'super-derive': {
          wordEntries: { enabled: false, count: 4, categories: [], strategy: 'direction-pack' },
          autoSave: true,
          applyMode: 'replace',
          targetGroupMode: 'new',
          targetGroupId: null,
        },
        'wild-derive': {
          wordEntries: { enabled: false, count: 4, categories: ['任意分类'], strategy: 'atomic' },
          autoSave: true,
          applyMode: 'replace',
          targetGroupMode: 'new',
          targetGroupId: null,
        },
      },
    })
    expect(prefs.builtInSkillSettings['super-derive'].wordEntries).toMatchObject({ enabled: true, strategy: 'atomic' })
    expect(prefs.builtInSkillSettings['super-derive'].wordEntries.categories.length).toBeGreaterThan(0)
    expect(prefs.builtInSkillSettings['wild-derive'].wordEntries).toMatchObject({
      enabled: true,
      categories: ['任意分类'],
      strategy: 'direction-pack',
    })
  })

  it('keeps the existing custom skill identity and boundary rules on edit', () => {
    const skill = buildCustomSkillFromDraft(
      {
        id: 'custom-existing',
        name: '旧技能',
        icon: 'sparkles',
        enabled: false,
        priority: 90,
        contract: {
          taskType: 'prompt-optimize',
          objective: '旧规则',
          preserve: ['保留主体'],
          editable: ['只改光线'],
          forbidden: ['不得改构图'],
          variationLevel: 'low',
          primaryOutput: 'finalPrompt',
          output: { finalPrompt: true, candidates: false, analysis: false, wordEntries: false },
        },
      },
      {
        name: '新技能',
        icon: 'wand',
        instruction: '更新说明',
        inputMode: 'text',
        intensity: 'controlled',
        conceptCategories: [...DEFAULT_INFORMATION_FLOW_AD_VARIABLE_CATEGORIES],
        wordEntries: { enabled: false, count: 8, categories: [], strategy: 'atomic' },
      },
    )
    expect(skill.id).toBe('custom-existing')
    expect(skill.enabled).toBe(false)
    expect(skill.priority).toBe(90)
    expect(skill.preserveRules).toEqual(['保留主体'])
    expect(skill.forbiddenRules).toEqual(['不得改构图'])
  })

  it('preserves the shared seven-dimension selection for custom skills', () => {
    const [skill] = normalizeCustomSkills([
      {
        id: 'custom-concepts',
        name: '概念测试',
        instruction: '分析输入',
        icon: 'sparkles',
        conceptCategories: ['主体', '文案'],
        wordEntries: { enabled: false, count: 8, categories: [], strategy: 'atomic' },
      },
    ])
    expect(skill.conceptCategories).toEqual(['主体', '文案'])
    const preferences = normalizeAssistantActionPreferences({ customSkills: [skill] })
    expect(resolveEffectiveVisualSkill(skill, preferences).conceptCategories).toEqual(['主体', '文案'])
  })
})

describe('migration (pure, deterministic)', () => {
  it('drops unedited removed built-ins but converts edited ones to hidden custom skills', () => {
    const migrated = migrateAssistantActionsToV2({
      schemaVersion: 1,
      skillOverrides: [{ skillId: 'image-derive' }, { skillId: 'style-expand', name: '我的版式' }],
    } as never)
    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.skillOverrides.find((override) => override.skillId === 'image-derive')).toBeUndefined()
    const hidden = migrated.customSkills.find((skill) => skill.id === 'custom-legacy-style-expand')
    expect(hidden).toBeDefined()
    expect(hidden?.enabled).toBe(false)
  })

  it('uses stable ids and is idempotent', () => {
    const input = { schemaVersion: 1, skillOverrides: [{ skillId: 'style-expand', name: '我的版式' }] } as never
    const once = migrateAssistantActionsToV2(input)
    const twice = migrateAssistantActionsToV2(once as never)
    expect(twice.customSkills.map((skill) => skill.id).sort()).toEqual(
      once.customSkills.map((skill) => skill.id).sort(),
    )
  })

  it('preserves existing custom skills and word library settings', () => {
    const migrated = migrateAssistantActionsToV2({
      schemaVersion: 1,
      customSkills: [
        {
          id: 'my-custom',
          name: '我的技能',
          instruction: '做点什么',
          trigger: 'always',
          isCustom: true,
          source: 'custom',
          steps: [],
        },
      ],
      actionSettings: {
        wordDerive: {
          targetGroupMode: 'new',
          targetGroupId: null,
          variableCount: 12,
          categories: ['A'],
          promptMode: 'replace',
          autoSaveWordEntries: true,
        },
      },
    } as never)
    expect(migrated.customSkills.some((skill) => skill.id === 'my-custom')).toBe(true)
    expect(migrated.actionSettings.wordDerive.variableCount).toBe(12)
  })
})
