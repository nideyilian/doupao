import type { InputImage } from '../../types'

export type BuiltInAssistantActionId = 'prompt-optimize' | 'image-describe' | 'super-derive' | 'wild-derive'

export type AssistantActionId = BuiltInAssistantActionId | string

/** Schema version of the assistant skill system. Bumped to 2 when the skill
 *  set was collapsed to four default visual-semantic skills plus custom skills
 *  that all inherit the shared AI visual-semantic conversion base. */
export const ASSISTANT_SKILL_SCHEMA_VERSION = 2

/** V2 change-intensity ladder shared by the four default skills and custom skills. */
export type VisualSkillIntensity = 'faithful' | 'controlled' | 'high' | 'maximum'

/** V2 input requirement model (replaces the old trigger/when pair). */
export type VisualInputMode = 'text' | 'image' | 'either' | 'both'

/** How multiple word entries are organized for a variable skill. */
export type WordEntryStrategy = 'atomic' | 'direction-pack'

/** Word-entry behavior for a skill that emits reusable variable chips. */
export interface WordEntryConfig {
  enabled: boolean
  /** Entries generated per category (capped by the runner). */
  count: number
  categories: string[]
  /** 'atomic' = independent replaceable chips; 'direction-pack' = each entry is a
   *  self-contained creative direction that stays coherent when sampled. */
  strategy: WordEntryStrategy
}

/** Canonical V2 skill definition. Built-in and custom skills both follow it so
 *  the shared AI visual-semantic conversion base can be injected uniformly.
 *  At runtime this is the single source of truth; legacy fields (trigger/when/
 *  outputMode/contract/steps) are only read by the migration adapter. */
export interface VisualSkill {
  id: string
  name: string
  icon: AssistantActionIcon
  source: 'builtin' | 'custom'
  enabled: boolean
  priority: number
  /** Optional human description, surfaced in the editor / hover card. */
  description?: string
  inputMode: VisualInputMode
  intensity: VisualSkillIntensity
  /** Human instruction describing what the skill should do. Required for custom
   *  skills; for built-ins it documents the boundary the base must respect. */
  instruction: string
  preserveRules: string[]
  editableRules: string[]
  forbiddenRules: string[]
  wordEntries: WordEntryConfig
  /** Legacy steps kept for backward compatibility; not executed by the V2 runner. */
  steps?: AssistantSkillStep[]
  /** Legacy schema marker kept for migration detection. */
  version?: number
}

/** Effective, fully-resolved skill the runner consumes. Word entries are null
 *  when the skill does not emit variables. */
export interface EffectiveVisualSkill {
  id: string
  name: string
  inputMode: VisualInputMode
  intensity: VisualSkillIntensity
  instruction: string
  preserveRules: string[]
  editableRules: string[]
  forbiddenRules: string[]
  /** Selected information-flow dimensions used for upper-level concept analysis. */
  conceptCategories: string[]
  wordEntries: WordEntryConfig | null
}

/** Unified V2 result: exactly one prompt, plus optional variable word entries
 *  that are only a data source for the {{variables}} in the prompt. */
export interface VisualSkillResult {
  prompt: string
  wordEntries?: Array<{ category: string; entries: string[] }>
}

export type AssistantActionIcon = 'image' | 'wand' | 'sparkles' | 'palette' | 'tags' | 'thumbs-up'

export type AssistantSkillTrigger = 'always' | 'image' | 'text' | 'image_text'

export type AssistantSkillTaskType =
  | 'analyze'
  | 'prompt-optimize'
  | 'image-variation'
  | 'layout-variation'
  | 'creative-expansion'
  | 'extract-variables'
  | 'review-data'

export type AssistantVariationLevel = 'none' | 'low' | 'medium' | 'high'

/** Quality status of a generated result, surfaced to the user so a repaired/failed
 *  output is never mistaken for a genuine model understanding. */
export type AssistantQualityState = 'complete' | 'repaired' | 'insufficient-data' | 'failed'

/** The semantic role of a single skill step (its purpose within the flow). */
export type AssistantStepRole =
  | 'observe' // 观察输入：提取图片/文本事实
  | 'lock' // 锁定内容：明确不能改变什么
  | 'extract' // 提炼方向：总结测试方向/风格/卖点
  | 'finalPrompt' // 生成最终主提示词
  | 'variablePrompt' // 生成带 {{变量}} 的提示词
  | 'wordEntries' // 生成可替换短词条
  | 'risk' // 风险检查：合规/同质化/误判提醒

/** Where a step's output should be written. */
export type AssistantStepOutput = 'sections' | 'finalPrompt' | 'variablePrompt' | 'wordEntries'

/** One editable processing step of a skill. A skill is a flow of ordered steps
 *  instead of a single opaque instruction. */
export interface AssistantSkillStep {
  id: string
  title: string
  enabled: boolean
  role: AssistantStepRole
  instruction: string
  outputTo: AssistantStepOutput
  /** Required steps cannot be deleted (only disabled). */
  required?: boolean
}

export const STEP_ROLE_OPTIONS: Array<{ value: AssistantStepRole; label: string; defaultOutput: AssistantStepOutput }> =
  [
    { value: 'observe', label: '观察输入', defaultOutput: 'sections' },
    { value: 'lock', label: '锁定内容', defaultOutput: 'sections' },
    { value: 'extract', label: '提炼方向', defaultOutput: 'sections' },
    { value: 'finalPrompt', label: '生成最终提示词', defaultOutput: 'finalPrompt' },
    { value: 'variablePrompt', label: '生成变量提示词', defaultOutput: 'variablePrompt' },
    { value: 'wordEntries', label: '生成词条', defaultOutput: 'wordEntries' },
    { value: 'risk', label: '风险检查', defaultOutput: 'sections' },
  ]

export const STEP_OUTPUT_OPTIONS: Array<{ value: AssistantStepOutput; label: string }> = [
  { value: 'sections', label: '查看更多（分析说明）' },
  { value: 'finalPrompt', label: '主结果（最终提示词）' },
  { value: 'variablePrompt', label: '变量主提示词' },
  { value: 'wordEntries', label: '词条库' },
]

/** Defines the semantic boundary of a built-in skill, not merely its display name. */
export interface AssistantSkillContract {
  taskType: AssistantSkillTaskType
  objective: string
  preserve: string[]
  editable: string[]
  forbidden: string[]
  variationLevel: AssistantVariationLevel
  singleVariablePerCandidate?: boolean
  /** Whether the skill genuinely operates inside an information-flow ad workflow.
   *  When false, channel / selling-point / test-plan packaging must not be attached. */
  requiresAdContext?: boolean
  /** Whether the result should expose a channel label and selling-point policy. */
  channelAware?: boolean
  /** Whether this skill may explore NEW selling points (otherwise it must lock to the input). */
  allowExploreSellingPoint?: boolean
  /** Every skill emits exactly one main prompt. Analysis / candidate are never
   *  primary outputs (analysis lives in sections, candidates are永久关闭). */
  primaryOutput: 'finalPrompt' | 'variablePrompt'
  output: {
    finalPrompt: boolean
    candidates: boolean
    analysis: boolean
    wordEntries: boolean
  }
}

export interface AssistantInputContext {
  text: string
  hasText: boolean
  images: InputImage[]
  hasImage: boolean
  imageCount: number
}

export interface AssistantAction {
  id: AssistantActionId
  name: string
  icon: AssistantActionIcon
  /** Optional human description shown in the editor / hover card. */
  description?: string
  priority: number
  trigger?: AssistantSkillTrigger
  enabled?: boolean
  when: {
    text?: 'required' | 'optional' | 'none'
    image?: 'required' | 'optional' | 'none'
  }
  outputMode: 'replace-input' | 'append-input' | 'show-candidates' | 'create-word-tags'
  contract?: AssistantSkillContract
  /** Whether this skill ships with the app or was created by the user. */
  source?: 'builtin' | 'custom'
  /** Schema version, bumped when built-in step definitions change. */
  version?: number
  /** Ordered, editable processing steps. When present, execution is step-based. */
  steps?: AssistantSkillStep[]
  /** V2 fields. */
  intensity?: VisualSkillIntensity
  inputMode?: VisualInputMode
  wordEntries?: WordEntryConfig
  /** Information-flow dimensions used for upper-level concept analysis. */
  conceptCategories?: string[]
  /** Free-form instruction for custom skills (also kept for built-ins as docs). */
  instruction?: string
  /** V2 boundary rules. The runner reads these (with contract as legacy fallback). */
  preserveRules?: string[]
  editableRules?: string[]
  forbiddenRules?: string[]
}

export interface AssistantCustomSkill extends AssistantAction {
  id: string
  source: 'custom'
  isCustom: true
  /** Free-form instruction for custom skills (also kept for built-ins as docs). */
  instruction: string
  inputMode: VisualInputMode
  intensity: VisualSkillIntensity
  preserveRules: string[]
  editableRules: string[]
  forbiddenRules: string[]
  wordEntries: WordEntryConfig
  /** Legacy / compatibility fields kept for migration and storage. The V2 runner
   *  never reads these; creation and edit flows use the V2 fields above. */
  trigger?: AssistantSkillTrigger
  outputMode: AssistantAction['outputMode']
  contract?: AssistantSkillContract
  steps?: AssistantSkillStep[]
  requiresAdContext?: boolean
  allowWordEntries?: boolean
  allowExploreSellingPoint?: boolean
}

/** The single editable form value shared by the custom-skill create and edit
 *  flows (spec §四.1). There is exactly one form so the two never diverge. */
export interface VisualSkillFormValue {
  name: string
  icon: AssistantActionIcon
  instruction: string
  inputMode: VisualInputMode
  intensity: VisualSkillIntensity
  conceptCategories: string[]
  wordEntries: WordEntryConfig
}

/** A user-saved override layer applied on top of a built-in skill.
 *  Only changed fields are stored, so `builtin + override = actual`, and the
 *  original built-in definition is never lost (restore = drop the override). */
export interface AssistantSkillOverride {
  skillId: AssistantActionId
  name?: string
  icon?: AssistantActionIcon
  description?: string
  enabled?: boolean
  priority?: number
  trigger?: AssistantSkillTrigger
  /** Full replacement of the step flow once the user edits steps. */
  steps?: AssistantSkillStep[]
  /** Partial patch of the output contract (candidates stay permanently off). */
  contract?: {
    primaryOutput?: 'finalPrompt' | 'variablePrompt'
    output?: {
      finalPrompt?: boolean
      analysis?: boolean
      wordEntries?: boolean
    }
  }
}

export interface AssistantActionPreferences {
  /** Schema version of the skill system; 2 = Visual Semantic Skills V2. */
  schemaVersion?: number
  enabled: boolean
  pinnedActionIds: AssistantActionId[]
  hiddenActionIds: AssistantActionId[]
  actionOrder: AssistantActionId[]
  actionSettings: AssistantActionSettings
  customSkills: AssistantCustomSkill[]
  /** Override layers for built-in skills; empty means all built-ins use defaults. */
  skillOverrides: AssistantSkillOverride[]
  /** Editable variable-output settings for every built-in skill. Always present after normalization. */
  builtInSkillSettings: BuiltInSkillSettings
}

export type AdChannel = 'general' | 'toutiao' | 'gdt' | 'baidu' | 'multi'

export interface AdChannelOption {
  value: AdChannel
  label: string
  hint: string
}

export const AD_CHANNEL_OPTIONS: AdChannelOption[] = [
  { value: 'general', label: '通用信息流', hint: '抖音/快手/Meta 等通用竖版信息流' },
  { value: 'toutiao', label: '头条 / 巨量', hint: '强调竖版、前三秒钩子、真人感、UGC' },
  { value: 'gdt', label: '广点通', hint: '生活化、社交场景、可信感、不过度刺激' },
  { value: 'baidu', label: '百度', hint: '问题解决、搜索意图、可信背书、审核风险' },
  { value: 'multi', label: '多渠道', hint: '同一方向分别给出不同渠道版本' },
]

export type SellingPointPolicy = 'lock' | 'polish' | 'explore'

export interface SellingPointPolicyOption {
  value: SellingPointPolicy
  label: string
  hint: string
}

export const SELLING_POINT_POLICY_OPTIONS: SellingPointPolicyOption[] = [
  { value: 'lock', label: '锁定原卖点', hint: '不改卖点，只变画面、场景、钩子、版式、CTA' },
  { value: 'polish', label: '轻微润色', hint: '允许更口语化，但不得改变承诺、功效、价格、适用对象' },
  { value: 'explore', label: '允许探索新卖点', hint: '允许生成新卖点，但必须标注为“新假设”' },
]

export const OUTPUT_COUNT_OPTIONS = [3, 6, 10, 20] as const

export interface AssistantActionSettings {
  channel: AdChannel
  sellingPointPolicy: SellingPointPolicy
  outputCount: number
  superDerive: SuperDeriveActionSettings
  wordDerive: WordDeriveActionSettings
}

/** Where generated word entries land: a fresh standalone group per generation
 *  ('new', recommended) or appended into an explicitly chosen group ('selected').
 *  The old 'skill-name' auto-append mode was removed because it silently merged
 *  unrelated generations into one bucket. */
export type WordDeriveTargetGroupMode = 'new' | 'selected'

/** A per-save decision taken at the moment the user clicks "保存词条". It can
 *  override the persisted default {@link WordDeriveTargetGroupMode}:
 *  - 'new'       每次新建独立分组（推荐，默认）
 *  - 'selected'  追加到用户显式选择的固定分组 */
export type WordDeriveSaveStrategy = 'new' | 'selected'

export interface WordDeriveActionSettings {
  targetGroupMode: WordDeriveTargetGroupMode
  targetGroupId: string | null
  variableCount: number
  categories: string[]
  promptMode: 'replace' | 'append'
  autoSaveWordEntries: boolean
}

export type SuperDeriveActionSettings = WordDeriveActionSettings

/** Editable variable-output settings shared by every built-in skill. */
export interface BuiltInVisualSkillSettings {
  conceptCategories?: string[]
  wordEntries: WordEntryConfig
  autoSave: boolean
  applyMode: 'replace' | 'append'
  targetGroupMode: WordDeriveTargetGroupMode
  targetGroupId: string | null
}

export type SuperDeriveSkillSettings = BuiltInVisualSkillSettings
export type WildDeriveSkillSettings = BuiltInVisualSkillSettings

/** Per-skill settings keyed by every built-in skill id. */
export interface BuiltInSkillSettings {
  'prompt-optimize': BuiltInVisualSkillSettings
  'image-describe': BuiltInVisualSkillSettings
  'super-derive': SuperDeriveSkillSettings
  'wild-derive': WildDeriveSkillSettings
}

export interface AssistantActionResult {
  actionId: AssistantActionId
  title: string
  content: string
  /** V2 unified output: exactly one prompt. Variables (if any) appear as {{name}}. */
  prompt: string
  /** For non-variable skills, a second usable prompt built from upper-level concepts. */
  alternativePrompt?: string
  candidates?: string[]
  sections?: AssistantResultSection[]
  wordEntries?: AssistantWordEntryGroup[]
  primaryText?: string
  variablePrompt?: string
  channel?: AdChannel
  sellingPointPolicy?: SellingPointPolicy
  testPlan?: string
  qualityState?: AssistantQualityState
  qualityNote?: string
  /** The read-only input fact card built before generation, returned so the result
   *  page can let the user confirm "this is what I understood" (Layer 1). */
  grounding?: GroundingProfile
  /** Model-reported anchors that trace back to the input (Layer 3 source check). */
  sourceAnchors?: string[]
  /** Model-reported assumptions / inferred facts that are NOT in the input. */
  assumptions?: string[]
}

export interface AssistantResultSection {
  title: string
  items: string[]
}

export interface AssistantWordEntryGroup {
  category: string
  entries: string[]
}

/** The unified "content fact card" every skill consumes before generating.
 *  Facts are observed once and reused, instead of each skill re-guessing the input. */
export type GroundingFactSource = 'text' | 'image' | 'user-setting' | 'inferred'
export type GroundingFactConfidence = 'explicit' | 'high' | 'inferred'
export type GroundingFactLockPolicy = 'must-keep' | 'polish' | 'variable'

export interface GroundingFact {
  fact: string
  source: GroundingFactSource
  confidence: GroundingFactConfidence
  lockPolicy: GroundingFactLockPolicy
  sourceRef?: string
}

export interface VisualIdentity {
  subject: string
  composition: string
  color: string
  scene: string
  textLayout: string
  style: string
}

export interface GroundingProfile {
  observedFacts: GroundingFact[]
  userRequirements: string[]
  inferredFacts: GroundingFact[]
  lockedFacts: GroundingFact[]
  visualIdentity: VisualIdentity
  adContext?: { channel: AdChannel; sellingPointPolicy: SellingPointPolicy }
  missingInformation: string[]
  sourceEvidence: string[]
}
