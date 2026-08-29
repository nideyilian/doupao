import {
  BUILT_IN_ASSISTANT_ACTIONS,
  BUILT_IN_ASSISTANT_ACTION_IDS,
  BUILT_IN_SKILL_STEPS,
  DEFAULT_INFORMATION_FLOW_AD_VARIABLE_CATEGORIES,
  INFORMATION_FLOW_AD_VARIABLE_CATEGORIES,
  cloneBuiltInSkillSteps,
} from './builtInActions'
import type {
  AssistantAction,
  AssistantActionIcon,
  AssistantActionId,
  AssistantActionPreferences,
  AssistantActionSettings,
  AssistantCustomSkill,
  AssistantInputContext,
  AssistantSkillContract,
  AssistantSkillOverride,
  AssistantSkillStep,
  AssistantSkillTaskType,
  AssistantSkillTrigger,
  AssistantStepOutput,
  AssistantStepRole,
  AssistantVariationLevel,
  BuiltInSkillSettings,
  EffectiveVisualSkill,
  SuperDeriveSkillSettings,
  VisualInputMode,
  VisualSkillFormValue,
  VisualSkillIntensity,
  WildDeriveSkillSettings,
  WordDeriveActionSettings,
  WordEntryConfig,
  WordEntryStrategy,
  WordDeriveTargetGroupMode,
} from './types'
import { ASSISTANT_SKILL_SCHEMA_VERSION } from './types'

export const DEFAULT_WORD_DERIVE_SETTINGS: WordDeriveActionSettings = {
  targetGroupMode: 'new',
  targetGroupId: null,
  variableCount: 20,
  categories: [...DEFAULT_INFORMATION_FLOW_AD_VARIABLE_CATEGORIES],
  promptMode: 'replace',
  autoSaveWordEntries: true,
}

export const DEFAULT_SUPER_DERIVE_SETTINGS = DEFAULT_WORD_DERIVE_SETTINGS

export const DEFAULT_ASSISTANT_ACTION_SETTINGS: AssistantActionSettings = {
  channel: 'general',
  sellingPointPolicy: 'lock',
  outputCount: 6,
  superDerive: DEFAULT_SUPER_DERIVE_SETTINGS,
  wordDerive: DEFAULT_WORD_DERIVE_SETTINGS,
}

export const DEFAULT_ASSISTANT_ACTION_PREFERENCES: AssistantActionPreferences = {
  enabled: true,
  pinnedActionIds: [],
  hiddenActionIds: [],
  actionOrder: [],
  actionSettings: DEFAULT_ASSISTANT_ACTION_SETTINGS,
  customSkills: [],
  skillOverrides: [],
  builtInSkillSettings: getDefaultBuiltInSkillSettings(),
}

const STEP_ROLES = new Set<AssistantStepRole>([
  'observe',
  'lock',
  'extract',
  'finalPrompt',
  'variablePrompt',
  'wordEntries',
  'risk',
])
const STEP_OUTPUTS = new Set<AssistantStepOutput>(['sections', 'finalPrompt', 'variablePrompt', 'wordEntries'])
const SKILL_ICONS = new Set<AssistantActionIcon>(['image', 'wand', 'sparkles', 'palette', 'tags', 'thumbs-up'])

const CORE_VISIBLE_ACTION_IDS = new Set<AssistantActionId>([
  'prompt-optimize',
  'image-describe',
  'super-derive',
  'wild-derive',
])

/** Built-in skills removed in V2. Their ids are stripped from ordering/hidden
 *  configs; if a user had *edited* one, it is converted to a hidden custom skill
 *  so their configuration is not lost (see {@link migrateAssistantActionsToV2}). */
const REMOVED_BUILT_IN_IDS = new Set<AssistantActionId>([
  'image-derive',
  'style-expand',
  'word-extract',
  'prompt-examples',
  'market-breakdown',
  'viral-remix',
  'angle-matrix',
  'batch-variants',
  'ad-review',
  'channel-rewrite',
])

/** Minimal description of removed built-ins, used only to rebuild an edited
 *  removed skill as a custom skill during migration. */
const LEGACY_REMOVED_BUILTINS: Record<
  string,
  {
    name: string
    objective: string
    variationLevel: AssistantVariationLevel
    wordEntries: boolean
    trigger: AssistantSkillTrigger
  }
> = {
  'image-derive': {
    name: '概念抽取',
    objective: '从参考图中提炼简短概念，输出一段只生成单张独立画面、严格沿用参考图视觉参数的图生图提示词。',
    variationLevel: 'low',
    wordEntries: false,
    trigger: 'image',
  },
  'style-expand': {
    name: '版式扩展',
    objective: '保持内容和视觉资产不变，探索信息层级和元素位置的不同布局。',
    variationLevel: 'medium',
    wordEntries: false,
    trigger: 'always',
  },
  'word-extract': {
    name: '变量拆解',
    objective: '从当前输入中提取已有的、可复用的变量，不凭空扩写。',
    variationLevel: 'none',
    wordEntries: true,
    trigger: 'text',
  },
  'prompt-examples': {
    name: '爆款案例',
    objective: '提供可供参考的高潜广告素材结构案例。',
    variationLevel: 'high',
    wordEntries: false,
    trigger: 'always',
  },
  'market-breakdown': {
    name: '大盘拆解',
    objective: '从一组参考素材中提炼一个可直接用于测试的最终生图提示词。',
    variationLevel: 'none',
    wordEntries: false,
    trigger: 'always',
  },
  'viral-remix': {
    name: '爆款复刻',
    objective: '复刻有效素材的结构逻辑和视觉节奏，不复制其具体内容。',
    variationLevel: 'high',
    wordEntries: false,
    trigger: 'always',
  },
  'angle-matrix': {
    name: '角度探索',
    objective: '围绕同一产品或素材信息探索不同营销切入角度。',
    variationLevel: 'high',
    wordEntries: true,
    trigger: 'always',
  },
  'batch-variants': {
    name: '批量变体',
    objective: '基于一个基准方向创建可归因的 A/B 测试变体。',
    variationLevel: 'medium',
    wordEntries: false,
    trigger: 'always',
  },
  'ad-review': {
    name: '投放复盘',
    objective: '根据用户提供的投放数据分析保留、淘汰和下一轮测试变量。',
    variationLevel: 'none',
    wordEntries: false,
    trigger: 'text',
  },
  'channel-rewrite': {
    name: '渠道改写',
    objective: '保持现有内容和创意方向，仅做目标渠道适配。',
    variationLevel: 'low',
    wordEntries: false,
    trigger: 'text',
  },
}

function mapVariationLevelToV2(level: AssistantVariationLevel): VisualSkillIntensity {
  switch (level) {
    case 'none':
      return 'faithful'
    case 'low':
      return 'controlled'
    case 'medium':
      return 'high'
    case 'high':
      return 'maximum'
    default:
      return 'controlled'
  }
}

function mapTriggerToInputMode(trigger: AssistantSkillTrigger): VisualInputMode {
  switch (trigger) {
    case 'image':
      return 'image'
    case 'text':
      return 'text'
    case 'image_text':
      return 'both'
    case 'always':
    default:
      return 'either'
  }
}

/** Migrate legacy (V1) assistant preferences to Visual Semantic Skills V2:
 *  strip removed built-ins from ordering, drop their overrides unless the user
 *  edited them (in which case they become hidden custom skills), and tag the
 *  schema version. Word libraries and existing custom skills are preserved. */
export function migrateAssistantActionsToV2(
  value: Partial<AssistantActionPreferences> | undefined,
): AssistantActionPreferences {
  const base = normalizeAssistantActionPreferencesRaw(value)
  if ((value?.schemaVersion ?? 1) >= ASSISTANT_SKILL_SCHEMA_VERSION) return base

  const overrides = base.skillOverrides
  const keptOverrides: AssistantSkillOverride[] = []
  const convertedCustomSkills: AssistantCustomSkill[] = []
  const convertedHiddenIds: AssistantActionId[] = []

  for (const override of overrides) {
    if (!REMOVED_BUILT_IN_IDS.has(override.skillId)) {
      keptOverrides.push(override)
      continue
    }
    // Only convert a removed built-in if the user actually edited it (changed
    // something beyond a bare enabled toggle). Pure-id overrides are dropped.
    const editKeys = Object.keys(override).filter((key) => key !== 'skillId' && key !== 'enabled')
    if (editKeys.length === 0) continue
    const legacy = LEGACY_REMOVED_BUILTINS[override.skillId]
    if (!legacy) continue
    const trigger = override.trigger ?? legacy.trigger
    const inputMode = mapTriggerToInputMode(trigger)
    const intensity = mapVariationLevelToV2(legacy.variationLevel)
    // Legacy edited steps are merged into the instruction text (V2 ignores steps).
    const stepInstruction = override.steps?.length
      ? override.steps
          .map(
            (step, index) =>
              `步骤${index + 1}：${step.title?.trim() || `第${index + 1}步`}：${step.instruction?.trim() ?? ''}`,
          )
          .join('\n')
      : ''
    const instruction = stepInstruction ? `${legacy.objective}\n${stepInstruction}` : legacy.objective
    // Stable id (no Date.now / Math.random) so migration is deterministic / idempotent.
    const custom: AssistantCustomSkill = {
      id: `custom-legacy-${override.skillId}`,
      name: override.name ?? legacy.name,
      icon: override.icon ?? 'sparkles',
      instruction,
      steps: [],
      trigger,
      enabled: false,
      priority: 65,
      when: getWhenByTrigger(trigger),
      outputMode: legacy.wordEntries ? 'create-word-tags' : 'show-candidates',
      isCustom: true,
      source: 'custom',
      intensity,
      inputMode,
      preserveRules: ['参考图片和用户原始文字中的可观察事实', '原始意图'],
      editableRules: ['技能明确允许的处理'],
      forbiddenRules: ['套用行业通用模板替换参考输入', '把推断内容当作输入事实'],
      wordEntries: {
        enabled: legacy.wordEntries,
        count: 8,
        categories: DEFAULT_WORD_DERIVE_SETTINGS.categories,
        strategy: 'atomic',
      },
      requiresAdContext: false,
      allowWordEntries: legacy.wordEntries,
      allowExploreSellingPoint: false,
    }
    convertedCustomSkills.push(custom)
    convertedHiddenIds.push(custom.id)
  }

  // Migrate the legacy global word-derive settings into the per-skill
  // super-derive settings (spec §七.2). Only do this when the ORIGINAL input
  // actually carried the legacy fields — the normalized defaults always include
  // a superDerive block, so using `base` would clobber the proper V2 categories.
  const rawActionSettings = (value?.actionSettings ?? {}) as Record<string, unknown>
  const legacyWord = (rawActionSettings.superDerive ?? rawActionSettings.wordDerive) as
    | undefined
    | {
        variableCount?: number
        categories?: string[]
        autoSaveWordEntries?: boolean
        promptMode?: string
        targetGroupMode?: WordDeriveTargetGroupMode
        targetGroupId?: string | null
      }
  const superDefaults = base.builtInSkillSettings['super-derive']
  const migratedSuper: SuperDeriveSkillSettings = legacyWord
    ? {
        wordEntries: {
          enabled: (legacyWord.variableCount ?? 0) > 0 ? true : superDefaults.wordEntries.enabled,
          count: Math.max(1, Math.min(50, legacyWord.variableCount || superDefaults.wordEntries.count)),
          categories:
            legacyWord.categories && legacyWord.categories.length
              ? legacyWord.categories
              : superDefaults.wordEntries.categories,
          strategy: 'atomic',
        },
        autoSave:
          typeof legacyWord.autoSaveWordEntries === 'boolean' ? legacyWord.autoSaveWordEntries : superDefaults.autoSave,
        applyMode: legacyWord.promptMode === 'append' ? 'append' : 'replace',
        targetGroupMode: legacyWord.targetGroupMode ?? superDefaults.targetGroupMode,
        targetGroupId: legacyWord.targetGroupId ?? superDefaults.targetGroupId,
      }
    : superDefaults

  return {
    ...base,
    schemaVersion: ASSISTANT_SKILL_SCHEMA_VERSION,
    pinnedActionIds: base.pinnedActionIds.filter((id) => !REMOVED_BUILT_IN_IDS.has(id)),
    hiddenActionIds: [...base.hiddenActionIds.filter((id) => !REMOVED_BUILT_IN_IDS.has(id)), ...convertedHiddenIds],
    actionOrder: base.actionOrder.filter((id) => !REMOVED_BUILT_IN_IDS.has(id)),
    skillOverrides: keptOverrides,
    customSkills: [...base.customSkills, ...convertedCustomSkills],
    builtInSkillSettings: { ...base.builtInSkillSettings, 'super-derive': migratedSuper },
  }
}

/** Raw preferences normalization without migration (used by the migrator). */
export function normalizeAssistantActionPreferencesRaw(
  value: Partial<AssistantActionPreferences> | undefined,
): AssistantActionPreferences {
  return {
    schemaVersion: value?.schemaVersion,
    enabled: value?.enabled ?? true,
    pinnedActionIds: normalizeActionIds(value?.pinnedActionIds),
    hiddenActionIds: normalizeHiddenActionIds(value?.hiddenActionIds),
    actionOrder: normalizeActionIds(value?.actionOrder),
    actionSettings: normalizeAssistantActionSettings(value?.actionSettings),
    customSkills: normalizeCustomSkills(value?.customSkills),
    skillOverrides: normalizeSkillOverrides(value?.skillOverrides),
    builtInSkillSettings: normalizeBuiltInSkillSettings(value?.builtInSkillSettings),
  }
}

export function normalizeAssistantActionPreferences(
  value: Partial<AssistantActionPreferences> | undefined,
): AssistantActionPreferences {
  return migrateAssistantActionsToV2(value)
}

let stepIdCounter = 0
function generateStepId(prefix = 'step'): string {
  stepIdCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${stepIdCounter.toString(36)}`
}

/** Normalize an unknown value into a list of structured skill steps.
 *  Accepts both the new structured objects and legacy string[] step hints. */
export function normalizeSkillSteps(value: unknown, opts: { allowWordEntries?: boolean } = {}): AssistantSkillStep[] {
  if (!Array.isArray(value)) return []
  const steps = value.flatMap((item, index): AssistantSkillStep[] => {
    // Legacy custom skills stored steps as plain strings.
    if (typeof item === 'string') {
      const text = item.trim()
      if (!text) return []
      const isLast = index === value.length - 1
      const role: AssistantStepRole = isLast ? (opts.allowWordEntries ? 'variablePrompt' : 'finalPrompt') : 'observe'
      const outputTo: AssistantStepOutput = isLast
        ? opts.allowWordEntries
          ? 'variablePrompt'
          : 'finalPrompt'
        : 'sections'
      return [
        {
          id: generateStepId(),
          title: `第${index + 1}步`,
          role,
          outputTo,
          instruction: text,
          enabled: true,
          required: isLast,
        },
      ]
    }
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const instruction = typeof record.instruction === 'string' ? record.instruction.trim() : ''
    const title = typeof record.title === 'string' && record.title.trim() ? record.title.trim() : `第${index + 1}步`
    if (!instruction && !title) return []
    const role = STEP_ROLES.has(record.role as AssistantStepRole) ? (record.role as AssistantStepRole) : 'observe'
    const outputTo = STEP_OUTPUTS.has(record.outputTo as AssistantStepOutput)
      ? (record.outputTo as AssistantStepOutput)
      : 'sections'
    const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : generateStepId()
    return [
      {
        id,
        title,
        role,
        outputTo,
        instruction,
        enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
        required: typeof record.required === 'boolean' ? record.required : false,
      },
    ]
  })
  return steps.slice(0, 12)
}

export function normalizeSkillOverrides(value: unknown): AssistantSkillOverride[] {
  if (!Array.isArray(value)) return []
  const triggers = new Set<AssistantSkillTrigger>(['always', 'image', 'text', 'image_text'])
  return value.flatMap((item): AssistantSkillOverride[] => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const skillId = typeof record.skillId === 'string' ? record.skillId.trim() : ''
    if (!skillId) return []
    const override: AssistantSkillOverride = { skillId }
    if (typeof record.name === 'string' && record.name.trim()) override.name = record.name.trim().slice(0, 16)
    if (typeof record.icon === 'string' && SKILL_ICONS.has(record.icon as AssistantActionIcon))
      override.icon = record.icon as AssistantActionIcon
    if (typeof record.enabled === 'boolean') override.enabled = record.enabled
    if (typeof record.priority === 'number' && Number.isFinite(record.priority)) override.priority = record.priority
    if (typeof record.trigger === 'string' && triggers.has(record.trigger as AssistantSkillTrigger))
      override.trigger = record.trigger as AssistantSkillTrigger
    if (typeof record.description === 'string' && record.description.trim())
      override.description = record.description.trim().slice(0, 120)
    if (Array.isArray(record.steps)) {
      const steps = normalizeSkillSteps(record.steps)
      if (steps.length) override.steps = steps
    }
    if (record.contract && typeof record.contract === 'object') {
      const contractRecord = record.contract as Record<string, unknown>
      const contract: NonNullable<AssistantSkillOverride['contract']> = {}
      if (contractRecord.primaryOutput === 'finalPrompt' || contractRecord.primaryOutput === 'variablePrompt') {
        contract.primaryOutput = contractRecord.primaryOutput
      }
      if (contractRecord.output && typeof contractRecord.output === 'object') {
        const out = contractRecord.output as Record<string, unknown>
        const outputPatch: NonNullable<NonNullable<AssistantSkillOverride['contract']>['output']> = {}
        // Migration guard: old / hand-written overrides may contain
        // output.finalPrompt = false. The product rule is now that every skill
        // always has one main prompt, so we no longer persist that switch.
        if (typeof out.analysis === 'boolean') outputPatch.analysis = out.analysis
        if (typeof out.wordEntries === 'boolean') outputPatch.wordEntries = out.wordEntries
        if (Object.keys(outputPatch).length) contract.output = outputPatch
      }
      if (Object.keys(contract).length) override.contract = contract
    }
    // Drop empty overrides (nothing actually changed) to keep storage minimal.
    return Object.keys(override).length > 1 ? [override] : []
  })
}

/** Apply a user override layer on top of a built-in skill so that
 *  `builtin + override = actualSkill`. Returns a new action object. */
export function applySkillOverride(base: AssistantAction, override?: AssistantSkillOverride): AssistantAction {
  if (!override) return base
  const merged: AssistantAction = { ...base }
  if (override.name) merged.name = override.name
  if (override.icon) merged.icon = override.icon
  if (override.description) merged.description = override.description
  if (typeof override.enabled === 'boolean') merged.enabled = override.enabled
  if (typeof override.priority === 'number') merged.priority = override.priority
  if (override.trigger) {
    merged.trigger = override.trigger
    merged.when = getWhenByTrigger(override.trigger)
  }
  if (override.steps?.length) merged.steps = override.steps.map((step) => ({ ...step }))
  if (override.contract && base.contract) {
    merged.contract = {
      ...base.contract,
      primaryOutput: override.contract.primaryOutput ?? base.contract.primaryOutput,
      output: {
        ...base.contract.output,
        // Candidates are permanently disabled and never exposed to the user.
        candidates: false,
        // finalPrompt is always on, including when applying legacy overrides.
        finalPrompt: true,
        ...(override.contract.output?.analysis != null ? { analysis: override.contract.output.analysis } : {}),
        ...(override.contract.output?.wordEntries != null ? { wordEntries: override.contract.output.wordEntries } : {}),
      },
    }
  }
  return merged
}

/** Built-in skills with their user overrides applied. */
export function getResolvedBuiltInActions(preferences: AssistantActionPreferences): AssistantAction[] {
  const overrides = new Map(preferences.skillOverrides.map((override) => [override.skillId, override]))
  return BUILT_IN_ASSISTANT_ACTIONS.map((action) => applySkillOverride(action, overrides.get(action.id)))
}

/** Ordered skills for the management page. Built-ins are resolved (builtin +
 *  override) so the manage list matches the skill bar and real execution. */
export function getOrderedManageActions(preferences: AssistantActionPreferences): AssistantAction[] {
  const manualOrder = new Map(preferences.actionOrder.map((id, index) => [id, index]))
  return [...getResolvedBuiltInActions(preferences), ...preferences.customSkills].sort((a, b) => {
    const aManual = manualOrder.get(a.id)
    const bManual = manualOrder.get(b.id)
    if (aManual != null && bManual != null && aManual !== bManual) return aManual - bManual
    if (aManual != null) return -1
    if (bManual != null) return 1
    return b.priority - a.priority
  })
}

/** The editor's output-rule contract. Enforces the product rule that every skill
 *  emits exactly one main prompt: finalPrompt is always on, and a variablePrompt
 *  primary output requires word entries (otherwise it falls back to finalPrompt). */
export interface EditorOutputRule {
  primaryOutput: 'finalPrompt' | 'variablePrompt'
  allowFinalPrompt: boolean
  allowWordEntries: boolean
  allowAnalysis: boolean
}

export function normalizeEditorOutputRule(rule: {
  primaryOutput: 'finalPrompt' | 'variablePrompt'
  allowWordEntries: boolean
  allowAnalysis?: boolean
}): EditorOutputRule {
  const allowAnalysis = rule.allowAnalysis ?? true
  // finalPrompt is never disabled: every skill outputs one main prompt.
  const allowFinalPrompt = true
  // variablePrompt only makes sense together with word entries.
  if (rule.primaryOutput === 'variablePrompt' && !rule.allowWordEntries) {
    return { primaryOutput: 'finalPrompt', allowFinalPrompt, allowWordEntries: false, allowAnalysis }
  }
  return { primaryOutput: rule.primaryOutput, allowFinalPrompt, allowWordEntries: rule.allowWordEntries, allowAnalysis }
}

export function getSkillOverride(
  preferences: AssistantActionPreferences,
  skillId: AssistantActionId,
): AssistantSkillOverride | undefined {
  return preferences.skillOverrides.find((override) => override.skillId === skillId)
}

/** Whether a built-in skill currently differs from its shipped default. */
export function hasSkillOverride(preferences: AssistantActionPreferences, skillId: AssistantActionId): boolean {
  const override = getSkillOverride(preferences, skillId)
  return Boolean(override && Object.keys(override).length > 1)
}

/** Remove a built-in skill's override, restoring the shipped default. */
export function restoreSkillDefault(
  preferences: AssistantActionPreferences,
  skillId: AssistantActionId,
): AssistantActionPreferences {
  return {
    ...preferences,
    skillOverrides: preferences.skillOverrides.filter((override) => override.skillId !== skillId),
  }
}

/** Insert or replace a built-in skill's override. */
export function upsertSkillOverride(
  preferences: AssistantActionPreferences,
  override: AssistantSkillOverride,
): AssistantActionPreferences {
  const rest = preferences.skillOverrides.filter((item) => item.skillId !== override.skillId)
  const isEmpty = Object.keys(override).length <= 1
  return { ...preferences, skillOverrides: isEmpty ? rest : [...rest, override] }
}

/** Copy a built-in (or any) skill into a new editable custom skill. */
export function duplicateSkillAsCustom(source: AssistantAction): AssistantCustomSkill {
  const contract = source.contract
  const allowWordEntries = source.wordEntries?.enabled ?? contract?.output.wordEntries === true
  const wordEntries: WordEntryConfig = source.wordEntries ?? {
    enabled: allowWordEntries,
    count: 8,
    categories: DEFAULT_WORD_DERIVE_SETTINGS.categories,
    strategy: 'atomic',
  }
  return {
    id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: `${source.name} 副本`.slice(0, 16),
    icon: source.icon,
    instruction: source.instruction ?? contract?.objective ?? '',
    steps: [],
    trigger: source.trigger ?? 'always',
    enabled: true,
    priority: 65,
    when: getWhenByTrigger(source.trigger ?? 'always'),
    outputMode: allowWordEntries ? 'create-word-tags' : 'show-candidates',
    isCustom: true,
    source: 'custom',
    intensity: source.intensity ?? mapVariationLevelToV2(contract?.variationLevel ?? 'low'),
    inputMode: source.inputMode ?? mapTriggerToInputMode(source.trigger ?? 'always'),
    conceptCategories: source.conceptCategories?.length
      ? [...source.conceptCategories]
      : [...DEFAULT_INFORMATION_FLOW_AD_VARIABLE_CATEGORIES],
    wordEntries,
    preserveRules: contract?.preserve ?? ['参考图片和用户原始文字中的可观察事实', '原始意图'],
    editableRules: contract?.editable ?? ['技能明确允许的处理'],
    forbiddenRules: contract?.forbidden ?? ['套用行业通用模板替换参考输入', '把推断内容当作输入事实'],
    requiresAdContext: contract?.requiresAdContext === true,
    allowWordEntries,
    allowExploreSellingPoint: contract?.allowExploreSellingPoint === true,
    contract: contract ? { ...contract } : undefined,
  }
}

export function normalizeAssistantActionSettings(
  value: Partial<AssistantActionSettings> | undefined,
): AssistantActionSettings {
  const wordDerive = normalizeWordDeriveSettings(value?.wordDerive ?? value?.superDerive)
  const channelOptions = new Set<AssistantActionSettings['channel']>(['general', 'toutiao', 'gdt', 'baidu', 'multi'])
  const policyOptions = new Set<AssistantActionSettings['sellingPointPolicy']>(['lock', 'polish', 'explore'])
  const channel = channelOptions.has(value?.channel as AssistantActionSettings['channel'])
    ? (value?.channel as AssistantActionSettings['channel'])
    : 'general'
  const sellingPointPolicy = policyOptions.has(
    value?.sellingPointPolicy as AssistantActionSettings['sellingPointPolicy'],
  )
    ? (value?.sellingPointPolicy as AssistantActionSettings['sellingPointPolicy'])
    : 'lock'
  const outputCount =
    typeof value?.outputCount === 'number' && Number.isFinite(value.outputCount)
      ? Math.max(3, Math.min(20, Math.round(value.outputCount)))
      : DEFAULT_ASSISTANT_ACTION_SETTINGS.outputCount
  return {
    channel,
    sellingPointPolicy,
    outputCount,
    superDerive: wordDerive,
    wordDerive,
  }
}

function normalizeWordDeriveSettings(value: Partial<WordDeriveActionSettings> | undefined): WordDeriveActionSettings {
  const variableCount =
    typeof value?.variableCount === 'number' && Number.isFinite(value.variableCount)
      ? Math.max(1, Math.min(50, Math.round(value.variableCount)))
      : DEFAULT_WORD_DERIVE_SETTINGS.variableCount
  const categories = Array.isArray(value?.categories)
    ? value.categories
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, 12)
    : DEFAULT_WORD_DERIVE_SETTINGS.categories
  const targetGroupId = typeof value?.targetGroupId === 'string' && value.targetGroupId ? value.targetGroupId : null
  // 'selected' only applies with an explicit target; everything else (including
  // the legacy 'skill-name' auto-append) becomes 'new' so each generation lands
  // in its own group and never merges into a shared bucket.
  const targetGroupMode = value?.targetGroupMode === 'selected' && targetGroupId ? 'selected' : 'new'

  return {
    targetGroupMode,
    targetGroupId,
    variableCount,
    categories: categories.length ? categories : DEFAULT_WORD_DERIVE_SETTINGS.categories,
    promptMode: value?.promptMode === 'append' ? 'append' : 'replace',
    autoSaveWordEntries: typeof value?.autoSaveWordEntries === 'boolean' ? value.autoSaveWordEntries : true,
  }
}

function normalizeActionIds(value: unknown): AssistantActionId[] {
  if (!Array.isArray(value)) return []
  return value.filter((id): id is AssistantActionId => typeof id === 'string' && id.length > 0)
}

function normalizeHiddenActionIds(value: unknown): AssistantActionId[] {
  return normalizeActionIds(value).filter((id) => !CORE_VISIBLE_ACTION_IDS.has(id))
}

export function normalizeCustomSkills(value: unknown): AssistantCustomSkill[] {
  if (!Array.isArray(value)) return []
  const triggers = new Set<AssistantSkillTrigger>(['always', 'image', 'text', 'image_text'])
  const intensities = new Set<VisualSkillIntensity>(['faithful', 'controlled', 'high', 'maximum'])
  const inputModes = new Set<VisualInputMode>(['text', 'image', 'either', 'both'])
  return value.flatMap((item): AssistantCustomSkill[] => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    const instruction = typeof record.instruction === 'string' ? record.instruction.trim() : ''
    // A custom skill is valid if it has either a legacy instruction or structured steps.
    const rawSteps = normalizeSkillSteps(record.steps, {
      allowWordEntries: typeof record.allowWordEntries === 'boolean' ? record.allowWordEntries : false,
    })
    if (!id || !name || (!instruction && rawSteps.length === 0)) return []
    const icon =
      typeof record.icon === 'string' && SKILL_ICONS.has(record.icon as AssistantActionIcon)
        ? (record.icon as AssistantActionIcon)
        : 'sparkles'
    const trigger =
      typeof record.trigger === 'string' && triggers.has(record.trigger as AssistantSkillTrigger)
        ? (record.trigger as AssistantSkillTrigger)
        : 'always'
    const enabled = typeof record.enabled === 'boolean' ? record.enabled : true
    // P3: 三个显式开关是契约的单一事实来源；contract 由它们推导或保留。
    const requiresAdContext = typeof record.requiresAdContext === 'boolean' ? record.requiresAdContext : false
    const allowWordEntries = typeof record.allowWordEntries === 'boolean' ? record.allowWordEntries : false
    const allowExploreSellingPoint =
      typeof record.allowExploreSellingPoint === 'boolean' ? record.allowExploreSellingPoint : false
    const contract = buildCustomSkillContract(
      record.contract,
      instruction,
      requiresAdContext,
      allowWordEntries,
      allowExploreSellingPoint,
    )
    const intensity = intensities.has(record.intensity as VisualSkillIntensity)
      ? (record.intensity as VisualSkillIntensity)
      : mapVariationLevelToV2(contract.variationLevel)
    const inputMode = inputModes.has(record.inputMode as VisualInputMode)
      ? (record.inputMode as VisualInputMode)
      : mapTriggerToInputMode(trigger)
    const wordEntries = normalizeWordEntryConfig(record.wordEntries, allowWordEntries)
    const conceptCategories = Array.isArray(record.conceptCategories)
      ? record.conceptCategories
          .map(String)
          .map((category) => category.trim())
          .filter((category) => INFORMATION_FLOW_AD_VARIABLE_CATEGORIES.includes(category))
          .slice(0, 7)
      : []
    // Legacy custom skills stored an editable multi-step flow; the V2 runner does
    // not execute steps, so merge them into the instruction text (spec §七.3).
    const mergedInstruction = [
      instruction,
      ...rawSteps.map((step, index) => `${step.title || `步骤${index + 1}`}：${step.instruction}`),
    ]
      .filter(Boolean)
      .join('\n')
    return [
      {
        id,
        name,
        instruction: mergedInstruction || instruction,
        steps: [],
        icon,
        trigger,
        enabled,
        priority: 65,
        when: getWhenByTrigger(trigger),
        outputMode: wordEntries.enabled ? 'create-word-tags' : 'show-candidates',
        isCustom: true,
        source: 'custom',
        intensity,
        inputMode,
        wordEntries,
        conceptCategories: conceptCategories.length
          ? conceptCategories
          : [...DEFAULT_INFORMATION_FLOW_AD_VARIABLE_CATEGORIES],
        preserveRules: contract.preserve,
        editableRules: contract.editable,
        forbiddenRules: contract.forbidden,
        requiresAdContext,
        allowWordEntries,
        allowExploreSellingPoint,
        contract,
      },
    ]
  })
}

/** Normalize a custom skill's word-entry config, falling back to the legacy
 *  allowWordEntries flag when the structured config is absent. */
export function normalizeWordEntryConfig(record: unknown, allowWordEntries: boolean): WordEntryConfig {
  if (!record || typeof record !== 'object') {
    return {
      enabled: allowWordEntries,
      count: 8,
      categories: DEFAULT_WORD_DERIVE_SETTINGS.categories,
      strategy: 'atomic',
    }
  }
  const rec = record as Record<string, unknown>
  const enabled = typeof rec.enabled === 'boolean' ? rec.enabled : allowWordEntries
  const count =
    typeof rec.count === 'number' && Number.isFinite(rec.count) ? Math.max(1, Math.min(50, Math.round(rec.count))) : 8
  const rawCategories = Array.isArray(rec.categories)
    ? rec.categories
        .map(String)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 12)
    : []
  const categories = enabled ? (rawCategories.length ? rawCategories : DEFAULT_WORD_DERIVE_SETTINGS.categories) : []
  const strategy: WordEntryStrategy = rec.strategy === 'direction-pack' ? 'direction-pack' : 'atomic'
  return { enabled, count, categories, strategy }
}

/** Build the stable contract for a custom skill.
 *  When the model returned a contract, keep its objective / preserve / editable /
 *  forbidden / taskType / variationLevel / primaryOutput but force the three
 *  toggle-driven fields to the explicit switch values. Old skills without a
 *  contract get a conservative default that never assumes ad context or explores
 *  new selling points. */
export function buildCustomSkillContract(
  raw: unknown,
  instruction: string,
  requiresAdContext: boolean,
  allowWordEntries: boolean,
  allowExploreSellingPoint: boolean,
): AssistantSkillContract {
  const base: AssistantSkillContract = {
    taskType: 'prompt-optimize',
    objective: instruction.slice(0, 60) || '执行自定义技能',
    preserve: ['参考图片和用户原始文字中的可观察事实', '原始意图'],
    editable: ['技能明确允许的处理'],
    forbidden: ['套用行业通用模板替换参考输入', '把推断内容当作输入事实'],
    variationLevel: 'low',
    requiresAdContext,
    allowExploreSellingPoint,
    primaryOutput: allowWordEntries ? 'variablePrompt' : 'finalPrompt',
    output: { finalPrompt: true, candidates: false, analysis: true, wordEntries: allowWordEntries },
  }
  if (!raw || typeof raw !== 'object') return base
  const record = raw as Record<string, unknown>
  const taskTypeOptions = new Set<AssistantSkillTaskType>([
    'analyze',
    'prompt-optimize',
    'image-variation',
    'layout-variation',
    'creative-expansion',
    'extract-variables',
    'review-data',
  ])
  const variationLevels = new Set<AssistantVariationLevel>(['none', 'low', 'medium', 'high'])
  const primaryOutputs = new Set<AssistantSkillContract['primaryOutput']>(['finalPrompt', 'variablePrompt'])
  const output = record.output && typeof record.output === 'object' ? (record.output as Record<string, unknown>) : null
  const stringArray = (value: unknown) =>
    Array.isArray(value) ? value.map(String).filter((item) => Boolean(item)) : []
  return {
    taskType: taskTypeOptions.has(record.taskType as AssistantSkillTaskType)
      ? (record.taskType as AssistantSkillTaskType)
      : base.taskType,
    objective:
      typeof record.objective === 'string' && record.objective.trim() ? record.objective.trim() : base.objective,
    preserve: stringArray(record.preserve).length ? stringArray(record.preserve) : base.preserve,
    editable: stringArray(record.editable).length ? stringArray(record.editable) : base.editable,
    forbidden: stringArray(record.forbidden).length ? stringArray(record.forbidden) : base.forbidden,
    variationLevel: variationLevels.has(record.variationLevel as AssistantVariationLevel)
      ? (record.variationLevel as AssistantVariationLevel)
      : base.variationLevel,
    requiresAdContext,
    allowExploreSellingPoint,
    primaryOutput: primaryOutputs.has(record.primaryOutput as AssistantSkillContract['primaryOutput'])
      ? (record.primaryOutput as AssistantSkillContract['primaryOutput'])
      : base.primaryOutput,
    output: {
      finalPrompt: true,
      candidates: false,
      analysis: output ? Boolean(output.analysis) : base.output.analysis,
      wordEntries: allowWordEntries,
    },
  }
}

export function getWhenByTrigger(trigger: AssistantSkillTrigger): AssistantAction['when'] {
  switch (trigger) {
    case 'image':
      return { image: 'required', text: 'optional' }
    case 'text':
      return { text: 'required', image: 'none' }
    case 'image_text':
      return { text: 'required', image: 'required' }
    case 'always':
    default:
      return { text: 'optional', image: 'optional' }
  }
}

/** Single source of truth for whether a skill can run against the current input.
 *  Replaces the old double trigger+when judgment with one inputMode switch. */
export function isAssistantActionRunnable(skill: AssistantAction, context: AssistantInputContext): boolean {
  const inputMode = skill.inputMode ?? 'either'
  switch (inputMode) {
    case 'text':
      return context.hasText
    case 'image':
      return context.hasImage
    case 'either':
      return context.hasText || context.hasImage
    case 'both':
      return context.hasText && context.hasImage
    default:
      return context.hasText || context.hasImage
  }
}

/** Resolve the effective word-entry config for a skill, applying the override
 *  order: user per-skill settings > skill default > (legacy global wordDerive).
 *  Returns null when the skill does not emit variables. */
export function resolveWordConfig(
  action: AssistantAction,
  preferences: AssistantActionPreferences,
): WordEntryConfig | null {
  let effective: WordEntryConfig | undefined
  if (action.id in preferences.builtInSkillSettings) {
    effective =
      preferences.builtInSkillSettings[action.id as keyof BuiltInSkillSettings]?.wordEntries ?? action.wordEntries
  } else {
    effective = action.wordEntries
  }
  if (effective?.enabled && effective.categories.length > 0) return effective
  // Legacy fallback: a custom skill that only set the old allowWordEntries flag.
  if (!effective?.enabled && action.source === 'custom' && (action as AssistantCustomSkill).allowWordEntries) {
    return {
      enabled: true,
      count: preferences.actionSettings.wordDerive.variableCount,
      categories: preferences.actionSettings.wordDerive.categories,
      strategy: 'atomic',
    }
  }
  return null
}

/** Build the fully-resolved skill the runner consumes, so the runner never reads
 *  trigger / when / outputMode / contract / steps directly. */
export function resolveEffectiveVisualSkill(
  action: AssistantAction,
  preferences: AssistantActionPreferences,
): EffectiveVisualSkill {
  const contract = action.contract
  const preserveRules = action.preserveRules?.length ? action.preserveRules : (contract?.preserve ?? [])
  const editableRules = action.editableRules?.length ? action.editableRules : (contract?.editable ?? [])
  const forbiddenRules = action.forbiddenRules?.length ? action.forbiddenRules : (contract?.forbidden ?? [])
  const intensity = action.intensity ?? mapVariationLevelToV2(contract?.variationLevel ?? 'low')
  const inputMode = action.inputMode ?? mapTriggerToInputMode(action.trigger ?? 'always')
  const instruction = action.instruction ?? contract?.objective ?? ''
  const wordEntries = resolveWordConfig(action, preferences)
  const configuredConceptCategories =
    action.id in preferences.builtInSkillSettings
      ? preferences.builtInSkillSettings[action.id as keyof BuiltInSkillSettings]?.conceptCategories
      : action.conceptCategories
  const conceptCategories = configuredConceptCategories?.length
    ? [...configuredConceptCategories]
    : [...DEFAULT_INFORMATION_FLOW_AD_VARIABLE_CATEGORIES]
  return {
    id: action.id,
    name: action.name,
    inputMode,
    intensity,
    instruction,
    preserveRules,
    editableRules,
    forbiddenRules,
    conceptCategories,
    wordEntries,
  }
}

/** Default per-skill settings for all built-in skills. */
export function getDefaultBuiltInSkillSettings(): BuiltInSkillSettings {
  const promptAction = BUILT_IN_ASSISTANT_ACTIONS.find((action) => action.id === 'prompt-optimize')!
  const imageAction = BUILT_IN_ASSISTANT_ACTIONS.find((action) => action.id === 'image-describe')!
  const superAction = BUILT_IN_ASSISTANT_ACTIONS.find((action) => action.id === 'super-derive')!
  const wildAction = BUILT_IN_ASSISTANT_ACTIONS.find((action) => action.id === 'wild-derive')!
  const defaultVariables = superAction.wordEntries!.categories
  return {
    'prompt-optimize': {
      conceptCategories: [...DEFAULT_INFORMATION_FLOW_AD_VARIABLE_CATEGORIES],
      wordEntries: { ...promptAction.wordEntries!, count: 8, categories: defaultVariables },
      autoSave: false,
      applyMode: 'replace',
      targetGroupMode: 'new',
      targetGroupId: null,
    },
    'image-describe': {
      conceptCategories: [...DEFAULT_INFORMATION_FLOW_AD_VARIABLE_CATEGORIES],
      wordEntries: { ...imageAction.wordEntries!, count: 8, categories: defaultVariables },
      autoSave: false,
      applyMode: 'replace',
      targetGroupMode: 'new',
      targetGroupId: null,
    },
    'super-derive': {
      conceptCategories: [...DEFAULT_INFORMATION_FLOW_AD_VARIABLE_CATEGORIES],
      wordEntries: superAction.wordEntries!,
      autoSave: true,
      applyMode: 'replace',
      targetGroupMode: 'new',
      targetGroupId: null,
    },
    'wild-derive': {
      conceptCategories: [...DEFAULT_INFORMATION_FLOW_AD_VARIABLE_CATEGORIES],
      wordEntries: wildAction.wordEntries!,
      autoSave: true,
      applyMode: 'replace',
      targetGroupMode: 'new',
      targetGroupId: null,
    },
  }
}

export function normalizeBuiltInSkillSettings(value: unknown): BuiltInSkillSettings {
  const defaults = getDefaultBuiltInSkillSettings()
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const legacyDefaultCategories = [
    '主视觉主体',
    '视觉符号',
    '动作状态',
    '情绪氛围',
    '材质表现',
    '光影效果',
    '背景环境',
    '商业构图',
  ]
  const normalizeWord = (raw: unknown, fallback: WordEntryConfig): WordEntryConfig => {
    const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    const enabled = typeof rec.enabled === 'boolean' ? rec.enabled : fallback.enabled
    const count =
      typeof rec.count === 'number' && Number.isFinite(rec.count)
        ? Math.max(1, Math.min(50, Math.round(rec.count)))
        : fallback.count
    const normalizedCategories = Array.isArray(rec.categories)
      ? rec.categories
          .map(String)
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 12)
      : fallback.categories
    const categories =
      normalizedCategories.length === legacyDefaultCategories.length &&
      normalizedCategories.every((category, index) => category === legacyDefaultCategories[index])
        ? [...DEFAULT_INFORMATION_FLOW_AD_VARIABLE_CATEGORIES]
        : normalizedCategories
    const strategy: WordEntryStrategy = rec.strategy === 'direction-pack' ? 'direction-pack' : fallback.strategy
    return { enabled, count, categories, strategy }
  }
  const normalizeSettings = (skillId: keyof BuiltInSkillSettings): SuperDeriveSkillSettings => {
    const raw = record[skillId] as Record<string, unknown> | undefined
    const fallback = defaults[skillId]
    const wordEntries = normalizeWord(raw?.wordEntries, fallback.wordEntries)
    const rawConceptCategories = Array.isArray(raw?.conceptCategories)
      ? raw.conceptCategories
          .map(String)
          .map((item) => item.trim())
          .filter((item) => INFORMATION_FLOW_AD_VARIABLE_CATEGORIES.includes(item))
          .slice(0, 7)
      : []
    const migratedConceptCategories =
      wordEntries.categories.length > 0 &&
      wordEntries.categories.every((category) => INFORMATION_FLOW_AD_VARIABLE_CATEGORIES.includes(category))
        ? wordEntries.categories
        : DEFAULT_INFORMATION_FLOW_AD_VARIABLE_CATEGORIES
    return {
      conceptCategories: rawConceptCategories.length ? rawConceptCategories : [...migratedConceptCategories],
      wordEntries: {
        ...wordEntries,
        categories: wordEntries.categories.length ? wordEntries.categories : fallback.wordEntries.categories,
        strategy: skillId === 'wild-derive' ? 'direction-pack' : 'atomic',
      },
      autoSave: typeof raw?.autoSave === 'boolean' ? raw.autoSave : fallback.autoSave,
      applyMode: raw?.applyMode === 'append' ? 'append' : 'replace',
      targetGroupMode: raw?.targetGroupMode === 'selected' ? 'selected' : 'new',
      targetGroupId: typeof raw?.targetGroupId === 'string' && raw.targetGroupId ? raw.targetGroupId : null,
    }
  }
  const promptSettings = normalizeSettings('prompt-optimize')
  const imageSettings = normalizeSettings('image-describe')
  const superRaw = normalizeSettings('super-derive')
  const wildRaw = normalizeSettings('wild-derive')
  const superSettings: SuperDeriveSkillSettings = {
    ...superRaw,
    wordEntries: { ...superRaw.wordEntries, enabled: true, strategy: 'atomic' },
  }
  const wildSettings: WildDeriveSkillSettings = {
    ...wildRaw,
    wordEntries: {
      ...wildRaw.wordEntries,
      enabled: true,
      categories: [wildRaw.wordEntries.categories[0]],
      strategy: 'direction-pack',
    },
  }
  return {
    'prompt-optimize': promptSettings,
    'image-describe': imageSettings,
    'super-derive': superSettings,
    'wild-derive': wildSettings,
  }
}

export function getRecommendedAssistantActions(
  context: AssistantInputContext,
  preferences: AssistantActionPreferences = DEFAULT_ASSISTANT_ACTION_PREFERENCES,
  limit = 12,
) {
  if (!preferences.enabled) return []

  const hidden = new Set(preferences.hiddenActionIds)
  const manualOrder = new Map(preferences.actionOrder.map((id, index) => [id, index]))

  // The four default skills always occupy the skill bar in a fixed order; the UI
  // disables them when input conditions are unmet rather than hiding them.
  const builtIns = getResolvedBuiltInActions(preferences)
    .filter((action) => action.enabled !== false && !hidden.has(action.id))
    .sort((a, b) => {
      const ai = manualOrder.get(a.id) ?? BUILT_IN_ASSISTANT_ACTION_IDS.indexOf(a.id)
      const bi = manualOrder.get(b.id) ?? BUILT_IN_ASSISTANT_ACTION_IDS.indexOf(b.id)
      if (ai < 0 && bi < 0) return b.priority - a.priority
      if (ai < 0) return 1
      if (bi < 0) return -1
      return ai - bi
    })

  const customs = preferences.customSkills
    .filter(
      (action) => action.enabled !== false && !hidden.has(action.id) && isAssistantActionRunnable(action, context),
    )
    .sort((a, b) => b.priority - a.priority)

  return [...builtIns, ...customs].slice(0, limit)
}

export function getMoreAssistantActions(
  _context: AssistantInputContext,
  _preferences: AssistantActionPreferences,
): AssistantAction[] {
  // V2 shows all skills on the fixed bar; there is no secondary overflow list.
  return []
}

/** Resolve the word-entry save/apply settings for a given skill, per spec §六.5.
 *  Super-derive / wild-derive read their own per-skill settings; a custom skill
 *  with word entries uses its own config; everything else falls back to the
 *  (legacy) global word-derive settings. */
export function resolveWordEntryApplySettings(
  action: AssistantAction,
  preferences: AssistantActionPreferences,
): WordDeriveActionSettings {
  const builtIn = preferences.builtInSkillSettings
  if (action.id in builtIn) {
    const settings = builtIn[action.id as keyof BuiltInSkillSettings]
    return {
      targetGroupMode: settings.targetGroupMode,
      targetGroupId: settings.targetGroupId,
      variableCount: settings.wordEntries.count,
      categories: settings.wordEntries.categories,
      promptMode: settings.applyMode,
      autoSaveWordEntries: settings.autoSave,
    }
  }
  if (isCustomAssistantSkill(action) && action.wordEntries?.enabled) {
    return {
      targetGroupMode: 'new',
      targetGroupId: null,
      variableCount: action.wordEntries.count,
      categories: action.wordEntries.categories,
      promptMode: 'replace',
      autoSaveWordEntries: false,
    }
  }
  return preferences.actionSettings.wordDerive
}

/** Pure updater for per-skill built-in settings (spec §九.3). */
export function updateBuiltInSkillSettings(
  preferences: AssistantActionPreferences,
  skillId: keyof BuiltInSkillSettings,
  patch: Partial<BuiltInSkillSettings['super-derive'] & BuiltInSkillSettings['wild-derive']>,
): AssistantActionPreferences {
  const current = preferences.builtInSkillSettings[skillId]
  const nextSettings = { ...current, ...patch } as BuiltInSkillSettings['super-derive'] &
    BuiltInSkillSettings['wild-derive']
  return {
    ...preferences,
    builtInSkillSettings: {
      ...preferences.builtInSkillSettings,
      [skillId]: nextSettings,
    },
  }
}

function createCustomSkillId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function inputModeToLegacyTrigger(inputMode: VisualInputMode): AssistantSkillTrigger {
  switch (inputMode) {
    case 'text':
      return 'text'
    case 'image':
      return 'image'
    case 'both':
      return 'image_text'
    case 'either':
    default:
      return 'always'
  }
}

/** Build a saved custom skill from the reviewed V2 form value (spec §四.3).
 *  This is the single save path for both create and edit, so V2 fields are
 *  always persisted and never rely on the legacy outputMode/trigger. */
export function buildCustomSkillFromDraft(
  draft: {
    id?: string
    name: string
    icon: AssistantCustomSkill['icon']
    contract?: AssistantSkillContract
    enabled?: boolean
    priority?: number
  },
  form: VisualSkillFormValue,
): AssistantCustomSkill {
  const trigger = inputModeToLegacyTrigger(form.inputMode)
  const contract = buildCustomSkillContract(draft.contract, form.instruction, false, form.wordEntries.enabled, false)
  return {
    id: draft.id ?? createCustomSkillId(),
    name: form.name.trim().slice(0, 16) || draft.name,
    icon: form.icon,
    instruction: form.instruction,
    steps: [],
    trigger,
    enabled: draft.enabled ?? true,
    priority: draft.priority ?? 65,
    when: getWhenByTrigger(trigger),
    outputMode: form.wordEntries.enabled ? 'create-word-tags' : 'replace-input',
    isCustom: true,
    source: 'custom',
    intensity: form.intensity,
    inputMode: form.inputMode,
    conceptCategories: form.conceptCategories,
    wordEntries: form.wordEntries,
    preserveRules: contract.preserve,
    editableRules: contract.editable,
    forbiddenRules: contract.forbidden,
    requiresAdContext: false,
    allowWordEntries: form.wordEntries.enabled,
    allowExploreSellingPoint: false,
    contract,
  }
}

function isCustomAssistantSkill(action: AssistantAction): action is AssistantCustomSkill {
  return 'isCustom' in action && action.isCustom === true
}
