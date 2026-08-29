import type { AssistantAction, AssistantActionId, AssistantSkillContract, AssistantSkillStep } from './types'

/** Current schema version of the built-in step definitions. Bumped to 2 together
 *  with the skill-set collapse to four visual-semantic skills. */
export const BUILT_IN_SKILL_VERSION = 3

/** In V2 every skill runs through the shared AI visual-semantic conversion base,
 *  so built-ins no longer carry an editable multi-step flow. The legacy step
 *  helpers are kept for migration / backward compatibility only. */
function step(
  id: string,
  title: string,
  role: AssistantSkillStep['role'],
  outputTo: AssistantSkillStep['outputTo'],
  instruction: string,
  required = false,
): AssistantSkillStep {
  return { id, title, role, outputTo, instruction, enabled: true, required }
}

export const BUILT_IN_SKILL_STEPS: Partial<Record<AssistantActionId, AssistantSkillStep[]>> = {
  'prompt-optimize': [
    step(
      'diagnose',
      '第一步：诊断原始提示词',
      'observe',
      'sections',
      '只指出画面表达、主体关系、场景、风格、约束或合规上的不足。',
    ),
    step(
      'lock',
      '第二步：锁定不可改内容',
      'lock',
      'sections',
      '明确不得改变的核心卖点、产品事实、品牌、价格、承诺、适用人群、画幅和用户指定的风格或场景。',
    ),
    step(
      'write-prompt',
      '第三步：输出优化后提示词',
      'finalPrompt',
      'finalPrompt',
      '在不改变原意、事实和承诺的前提下输出一条清晰、完整、可直接使用的最终生图提示词。',
      true,
    ),
  ],
  'image-describe': [
    step(
      'observe',
      '第一步：忠实拆解参考图',
      'observe',
      'sections',
      '分析画幅和构图、视觉主体、背景与色板、文字层级、光影与风格、广告信息结构；无法直接观察的卖点、受众或效果必须标记为“推断”。',
    ),
    step(
      'write-prompt',
      '第二步：整理为最终提示词',
      'finalPrompt',
      'finalPrompt',
      '把可观察视觉结构整理成一个可直接复用的素材风格最终提示词，保留画幅、构图、主体、背景、色板、文字层级和风格等可观察事实。',
      true,
    ),
  ],
  'super-derive': [
    step(
      'observe',
      '第一步：拆解跑量结构',
      'observe',
      'sections',
      '若有参考图先拆解首屏钩子、人物/产品主体、痛点场景、卖点表达、视觉冲突、情绪氛围、信任背书、CTA；若有文字按产品信息、目标人群、投放目标、卖点、价格/优惠、素材限制理解。',
    ),
    step(
      'extract',
      '第二步：确定衍生方向',
      'extract',
      'sections',
      '在参考图与原始文字基础上确定可衍生部分，先逐项写明保留的主体、结构、色板、排版、文案语义、场景和视觉风格，再写允许衍生的部分。',
    ),
    step(
      'write-prompt',
      '第三步：生成变量提示词',
      'variablePrompt',
      'variablePrompt',
      '把最终画面中可变的核心语义换成设置中的变量分类占位符，输出一个变量主提示词。',
    ),
    step(
      'write-entries',
      '第四步：生成词条',
      'wordEntries',
      'wordEntries',
      '按设置中的变量分类输出可替换短变量，必须能直接替换进变量主提示词。',
    ),
  ],
  'wild-derive': [
    step(
      'observe',
      '第一步：锁定语义核心',
      'observe',
      'sections',
      '只保留概念母题、明确的产品/品牌/合规事实和用户明确要求不能改变的内容。',
    ),
    step(
      'expand',
      '第二步：最大范围探索方向',
      'extract',
      'sections',
      '在保留语义核心的前提下，最大范围探索完全不同的视觉世界、商业表达和创意机制。',
    ),
    step(
      'write-prompt',
      '第三步：生成方向变量提示词',
      'variablePrompt',
      'variablePrompt',
      '输出一条包含 {{创意方向}} 的变量主提示词。',
    ),
    step(
      'write-entries',
      '第四步：生成方向词条',
      'wordEntries',
      'wordEntries',
      '按“方向套装”输出完整、连贯、可独立成立的大跨度创意方向词条。',
    ),
  ],
}

export const INFORMATION_FLOW_AD_VARIABLE_CATEGORIES = ['风格', '主体', '排版', '装饰元素', '配色', '背景', '文案']

/** Copy is intentionally opt-in because generated ad copy is more likely to
 *  alter user-provided facts or introduce unsupported claims. */
export const DEFAULT_INFORMATION_FLOW_AD_VARIABLE_CATEGORIES = INFORMATION_FLOW_AD_VARIABLE_CATEGORIES.filter(
  (category) => category !== '文案',
)

const CONTRACTS: Record<AssistantActionId, AssistantSkillContract> = {
  'prompt-optimize': {
    taskType: 'prompt-optimize',
    objective: '理解用户原始意图，将零散词语、普通描述或不完整提示词，转换成一条完整、清晰、可执行的 GPT 生图提示词。',
    preserve: [
      '核心主题',
      '主体身份',
      '产品和品牌事实',
      '用户指定的卖点和文案语义',
      '用户指定的人物、场景、风格和画幅',
    ],
    editable: [
      '主体形态',
      '主体与环境的关系',
      '动作状态',
      '场景细节',
      '材质',
      '光影',
      '构图',
      '镜头',
      '氛围',
      '必要的视觉层级',
    ],
    forbidden: [
      '将原意改成其他创意方向',
      '虚构价格、功效、优惠和背书',
      '自动套入红包、金币、箭头等固定广告符号',
      '输出多个优化版本',
    ],
    variationLevel: 'low',
    primaryOutput: 'finalPrompt',
    output: { finalPrompt: true, candidates: false, analysis: false, wordEntries: false },
  },
  'image-describe': {
    taskType: 'analyze',
    objective: '先理解图片表达的视觉主题，再按照 GPT 生图提示词规范，将图片转换为一条可以复现其画面的完整提示词。',
    preserve: ['图片中可观察到的主体关系', '构图、色彩和风格', '主要材质与光影', '画面的核心信息层级'],
    editable: [],
    forbidden: ['补造看不清的品牌、文字或产品功能', '擅自增加广告卖点', '将描述变成新的衍生方案', '输出拆解报告'],
    variationLevel: 'none',
    primaryOutput: 'finalPrompt',
    output: { finalPrompt: true, candidates: false, analysis: false, wordEntries: false },
  },
  'super-derive': {
    taskType: 'creative-expansion',
    objective:
      '在保留输入核心概念和产品事实的基础上，执行完整 AI 视觉语义转换，生成一条具有商业画面感的变量提示词和配套词条。',
    preserve: [
      '核心概念',
      '产品和品牌事实',
      '用户明确锁定的内容',
      '参考图片的主要视觉身份',
      '用户明确要求的情绪和用途',
    ],
    editable: ['核心视觉隐喻', '主体表现方式', '象征元素', '动作', '情绪表达', '材质', '光影', '背景', '商业展示方式'],
    forbidden: ['虚构功效、价格、品牌或适用人群', '把无关概念混入结果'],
    variationLevel: 'high',
    primaryOutput: 'variablePrompt',
    output: { finalPrompt: true, candidates: false, analysis: false, wordEntries: true },
  },
  'wild-derive': {
    taskType: 'creative-expansion',
    objective:
      '只锁定输入的语义核心和真实事实，最大范围探索完全不同的视觉世界、商业表达和创意机制，适合快速测试不同方向。',
    preserve: ['概念母题', '明确的产品、品牌和合规事实', '用户明确要求不能改变的内容'],
    editable: [
      '主体隐喻',
      '创意机制',
      '世界观',
      '场景',
      '人物关系',
      '情绪极性',
      '艺术风格',
      '材质语言',
      '色彩体系',
      '镜头视角',
      '构图结构',
      '商业钩子',
      '视觉冲突',
    ],
    forbidden: ['改变产品真实功能', '制造虚假承诺', '把无关概念混入结果', '为追求差异而生成逻辑不通的画面'],
    variationLevel: 'high',
    primaryOutput: 'variablePrompt',
    output: { finalPrompt: true, candidates: false, analysis: false, wordEntries: true },
  },
}

const RAW_BUILT_IN_ASSISTANT_ACTIONS: AssistantAction[] = [
  {
    id: 'prompt-optimize',
    name: '提示词优化',
    icon: 'sparkles',
    priority: 120,
    when: { text: 'required', image: 'optional' },
    trigger: 'text',
    outputMode: 'show-candidates',
    intensity: 'controlled',
    inputMode: 'text',
    wordEntries: { enabled: false, count: 0, categories: [], strategy: 'atomic' },
    instruction:
      '理解用户原始意图，将零散词语、普通描述或不完整提示词，转换成一条完整、清晰、可执行的 GPT 生图提示词；不改变原意、事实和承诺，并按技能设置决定是否生成变量词条。',
    preserveRules: CONTRACTS['prompt-optimize'].preserve,
    editableRules: CONTRACTS['prompt-optimize'].editable,
    forbiddenRules: CONTRACTS['prompt-optimize'].forbidden,
    contract: CONTRACTS['prompt-optimize'],
  },
  {
    id: 'image-describe',
    name: '图片描述',
    icon: 'image',
    priority: 115,
    when: { image: 'required', text: 'optional' },
    trigger: 'image',
    outputMode: 'show-candidates',
    intensity: 'faithful',
    inputMode: 'image',
    wordEntries: { enabled: false, count: 0, categories: [], strategy: 'atomic' },
    instruction:
      '先理解图片表达的视觉主题，再按照 GPT 生图提示词规范，将图片转换为一条可以复现其画面的完整提示词；忠实于可观察事实，不生成新衍生方案、不输出拆解报告。',
    preserveRules: CONTRACTS['image-describe'].preserve,
    editableRules: CONTRACTS['image-describe'].editable,
    forbiddenRules: CONTRACTS['image-describe'].forbidden,
    contract: CONTRACTS['image-describe'],
  },
  {
    id: 'super-derive',
    name: '超级衍生',
    icon: 'wand',
    priority: 110,
    when: { text: 'optional', image: 'optional' },
    trigger: 'always',
    outputMode: 'create-word-tags',
    intensity: 'high',
    inputMode: 'either',
    wordEntries: {
      enabled: true,
      count: 8,
      categories: DEFAULT_INFORMATION_FLOW_AD_VARIABLE_CATEGORIES,
      strategy: 'atomic',
    },
    instruction:
      '在保留输入核心概念和产品事实的基础上，执行完整 AI 视觉语义转换，生成一条具有商业画面感的变量提示词和配套词条（每类 8 个）。',
    preserveRules: CONTRACTS['super-derive'].preserve,
    editableRules: CONTRACTS['super-derive'].editable,
    forbiddenRules: CONTRACTS['super-derive'].forbidden,
    contract: CONTRACTS['super-derive'],
  },
  {
    id: 'wild-derive',
    name: '赌狗模式',
    icon: 'palette',
    priority: 105,
    when: { text: 'optional', image: 'optional' },
    trigger: 'always',
    outputMode: 'create-word-tags',
    intensity: 'maximum',
    inputMode: 'either',
    wordEntries: { enabled: true, count: 12, categories: ['创意方向'], strategy: 'direction-pack' },
    instruction:
      '只锁定输入的语义核心和真实事实，最大范围探索完全不同的视觉世界、商业表达和创意机制；采用“方向套装”输出完整、连贯、可独立成立的大跨度创意方向词条。',
    preserveRules: CONTRACTS['wild-derive'].preserve,
    editableRules: CONTRACTS['wild-derive'].editable,
    forbiddenRules: CONTRACTS['wild-derive'].forbidden,
    contract: CONTRACTS['wild-derive'],
  },
]

/** Deep-clone the default steps so callers can freely edit their own copies. */
export function cloneBuiltInSkillSteps(actionId: AssistantActionId): AssistantSkillStep[] {
  const steps = BUILT_IN_SKILL_STEPS[actionId]
  return steps ? steps.map((step) => ({ ...step })) : []
}

export const BUILT_IN_ASSISTANT_ACTIONS: AssistantAction[] = RAW_BUILT_IN_ASSISTANT_ACTIONS.map((action) => ({
  ...action,
  source: 'builtin',
  version: BUILT_IN_SKILL_VERSION,
  steps: cloneBuiltInSkillSteps(action.id),
}))

export const BUILT_IN_ASSISTANT_ACTION_IDS = BUILT_IN_ASSISTANT_ACTIONS.map(
  (action) => action.id,
) as AssistantActionId[]

/** Default order of the four built-in skills on the skill bar. */
export const DEFAULT_BUILT_IN_ORDER: AssistantActionId[] = BUILT_IN_ASSISTANT_ACTION_IDS
