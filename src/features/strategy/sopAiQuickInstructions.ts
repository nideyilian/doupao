export type SopQuickInstructionScope = 'all' | 'sop' | 'element-pool' | 'variable-prompt' | 'meta-instruction'

export type SopQuickInstructionParameter = {
  key: string
  label: string
  kind: 'text' | 'number' | 'select' | 'multi-select'
  description?: string
  placeholder?: string
  defaultValue?: string
  min?: number
  max?: number
  required?: boolean
  options?: ReadonlyArray<{ value: string; label: string }>
}

export type SopQuickInstruction = {
  id?: string
  label: string
  description?: string
  scope?: SopQuickInstructionScope
  instruction?: string
  /** 带参数指令的可编辑模板，参数占位符使用 [[参数 key]]。 */
  instructionTemplate?: string
  parameters?: ReadonlyArray<SopQuickInstructionParameter>
  buildInstruction?: (values: Record<string, string>) => string
}

export const SOP_QUICK_INSTRUCTIONS: ReadonlyArray<SopQuickInstruction> = [
  {
    id: 'sop-generalize',
    label: '将具体词泛化',
    description: '直接泛化正文或元素池中的具体描述，不创建可变项。',
    scope: 'sop',
    instruction:
      '只对当前 SOP 中已有的具体描述词做语义泛化：把具体实例直接改写为更通用、更可迁移的类别或描述范围，以降低大批量生图时的重复度、提高随机性。若当前 SOP 含有层级式元素池，只修改各层现有选项里的具体词，不新增或删除选项，不改变层级结构。泛化不是变量化：严禁新增、删除或修改 {{变量}}、可变项：区块或变量定义；不得把具体词转换成变量。数字、ID、阈值、价格、禁止项、验收标准、固定画风、排版约束和输出格式一律原样保留。输出完整修订后的 SOP，并逐条列出「泛化前 → 泛化后」。',
  },
  {
    id: 'sop-structure',
    label: '结构化重排',
    description: '按正文已有信息重排为更易执行、易扫读的 SOP。',
    scope: 'sop',
    instruction:
      '把正文重排为规范、易扫读的 Markdown SOP：只使用原文能支撑的章节（目标、适用范围、前置条件、输入、执行步骤、验收标准、异常处理、禁止项、输出）；执行步骤编号化，条件与约束归入对应步骤；结构上必要但缺失的字段写「待补充」，不要臆造；删除重复表述但保留全部独立要求。输出完整修订后的 SOP 与变更摘要。',
  },
  {
    id: 'sop-compress',
    label: '精简压缩',
    description: '删除重复和填充表达，但不丢失任何可执行约束。',
    scope: 'sop',
    instruction:
      '在保留全部步骤、数字、约束、禁止项和验收标准的前提下压缩正文：删除重复说明与填充词，合并冗余段落，保持每条要求仍然可执行。若某处删除会丢失信息，保留原文并在变更摘要中说明。',
  },
  {
    id: 'sop-split-steps',
    label: '拆分步骤',
    description: '把过长的执行段落拆成一条一事的编号步骤。',
    scope: 'sop',
    instruction:
      '把正文中过长的执行段落拆分为编号步骤，每步只做一件事；前置条件、注意事项、异常处理归入对应步骤；必要的缺失步骤用「待补充」占位，不要臆造操作。',
  },
  {
    id: 'sop-complete',
    label: '补全缺失',
    description: '检查 SOP 结构缺口，并用“待补充”保留待确认位置。',
    scope: 'sop',
    instruction:
      '对照 目标 / 适用范围 / 输入 / 执行步骤 / 异常处理 / 验收标准 / 禁止项 检查这份 SOP：缺失的环节用「待补充」补齐框架，把歧义动词改明确；不要臆造业务规则、数字或系统。',
  },
  {
    id: 'sop-terminology',
    label: '统一术语',
    description: '找出同一概念的不同说法，输出术语对照表。',
    scope: 'sop',
    instruction:
      '找出正文中指向同一概念的多种说法，统一为同一种表述，并在变更摘要中列出术语对照表；不改变任何规则、数字与禁止项的内容。',
  },
]

export const META_QUICK_INSTRUCTIONS: ReadonlyArray<SopQuickInstruction> = [
  {
    id: 'meta-diagnose-drift',
    label: '诊断输出漂移',
    description: '定位最容易导致元指令输出不稳定的约束缺口。',
    scope: 'meta-instruction',
    instruction: '先诊断这份元指令最容易导致输出漂移的三个问题，再给出完整修订版，并逐条说明修改原因。',
  },
  {
    id: 'meta-strengthen-contract',
    label: '强化输入输出契约',
    description: '强化输入分析、约束保留和输出格式。',
    scope: 'meta-instruction',
    instruction:
      '强化这份元指令的输入分析、约束保留和输出格式，减少重复说明；缺失但必要的部分标记为「待补充」，不要臆造业务规则。输出完整修订版与变更摘要。',
  },
  {
    id: 'meta-check-conflicts',
    label: '检查歧义冲突',
    description: '检查歧义、指令冲突和失败处理是否完整。',
    scope: 'meta-instruction',
    instruction: '检查这份元指令是否存在歧义、指令冲突或缺失的失败处理要求；给出完整修订版，并列出每处风险与对应修复。',
  },
]

const POOL_SCOPE_OPTIONS = (levels: ReadonlyArray<{ key: string; title: string }>) => [
  { value: '全部层', label: '全部层' },
  ...levels.map((level) => ({ value: level.key, label: level.title })),
]

const POOL_LEVEL_OPTIONS = (levels: ReadonlyArray<{ key: string; title: string }>) =>
  levels.map((level) => ({ value: level.key, label: level.title }))

export function createElementPoolQuickInstructions(
  levels: ReadonlyArray<{ key: string; title: string }>,
): ReadonlyArray<SopQuickInstruction> {
  const scopeOptions = POOL_SCOPE_OPTIONS(levels)
  const levelOptions = POOL_LEVEL_OPTIONS(levels)

  return [
    {
      id: 'pool-generalize',
      label: '将具体词泛化',
      description: '只泛化元素池现有选项，不创建可变项。',
      scope: 'element-pool',
      parameters: [
        {
          key: 'scope',
          label: '作用域',
          kind: 'multi-select',
          description: '可同时选择多个层级；选择“全部层”时作用于所有层级。',
          options: scopeOptions,
          defaultValue: '全部层',
        },
        {
          key: 'strength',
          label: '强度',
          kind: 'select',
          options: [
            { value: '轻微', label: '轻微' },
            { value: '中等', label: '中等' },
            { value: '彻底', label: '彻底' },
          ],
          defaultValue: '中等',
        },
      ],
      instructionTemplate:
        '只对元素池中「[[scope]]」各层现有选项里的具体实例和过窄描述做上钻泛化。强度：[[strength]]。目标是降低大批量生图时的重复度、提高随机性。要求：1) 每个选项从具体实例向上一级语义类别移动，保持意思相关，为 AI 生成留出变化空间；2) 泛化后的内容直接写回选项文本，不得把任何选项转换为 {{变量}}；3) 严禁新增、删除或修改“可变项：”区块、变量定义或其它变量提示词结构；4) 不新增选项，不改变层级标题、每层选项数量、画风常量、文案排版常量与排他性红线；5) 同层泛化程度一致，多层时保持跨层语义关联；6) 泛化后仍是完整可直接使用的描述；7) 变更摘要逐条列出「泛化前 → 泛化后」对照，并标注与其它层的关联建议。输出完整修订后的元素池（未修改的层原样保留）。',
      buildInstruction: ({ scope = '全部层', strength = '中等' }) =>
        `只对元素池中「${scope}」各层现有选项里的具体实例和过窄描述做上钻泛化。强度：${strength}。目标是降低大批量生图时的重复度、提高随机性。要求：1) 每个选项从具体实例向上一级语义类别移动，保持意思相关，为 AI 生成留出变化空间；2) 泛化后的内容直接写回选项文本，不得把任何选项转换为 {{变量}}；3) 严禁新增、删除或修改“可变项：”区块、变量定义或其它变量提示词结构；4) 不新增选项，不改变层级标题、每层选项数量、画风常量、文案排版常量与排他性红线；5) 同层泛化程度一致，多层时保持跨层语义关联；6) 泛化后仍是完整可直接使用的描述；7) 变更摘要逐条列出「泛化前 → 泛化后」对照，并标注与其它层的关联建议。输出完整修订后的元素池（未修改的层原样保留）。`,
    },
    {
      id: 'pool-derive',
      label: '衍生选项',
      description: '选择目标层并填写数量，增量补充不重复的选项。',
      scope: 'element-pool',
      parameters: [
        {
          key: 'level',
          label: '目标层级',
          kind: 'select',
          options: levelOptions,
          required: true,
        },
        {
          key: 'count',
          label: '新增数量',
          kind: 'number',
          min: 1,
          max: 60,
          defaultValue: '4',
          required: true,
        },
      ],
      instructionTemplate:
        '为元素池中「[[level]]」追加 [[count]] 个新选项。要求：1) 与现有选项同粒度、同风格、同抽象层级；2) 与其它层的既有主题线契合，保持层间关联；3) 不重复、不近义改写现有选项；4) 输出完整修订后的元素池（未修改的层原样保留），变更摘要列出新增项。',
      buildInstruction: ({ level, count }) =>
        `为元素池中「${level}」追加 ${count} 个新选项。要求：1) 与现有选项同粒度、同风格、同抽象层级；2) 与其它层的既有主题线契合，保持层间关联；3) 不重复、不近义改写现有选项；4) 输出完整修订后的元素池（未修改的层原样保留），变更摘要列出新增项。`,
    },
    {
      id: 'pool-rewrite',
      label: '改写选项',
      description: '选择目标层并填写主题，重写该层全部选项。',
      scope: 'element-pool',
      parameters: [
        {
          key: 'level',
          label: '目标层级',
          kind: 'select',
          options: levelOptions,
          required: true,
        },
        {
          key: 'theme',
          label: '重写主题',
          kind: 'text',
          placeholder: '例如：新年主题',
          required: true,
        },
      ],
      instructionTemplate:
        '按主题「[[theme]]」重写元素池中「[[level]]」的全部选项。要求：1) 新选项保持原层的语义槽位与粒度；2) 保留画风常量与排他性红线；3) 输出完整修订后的元素池，变更摘要说明重写逻辑。',
      buildInstruction: ({ level, theme }) =>
        `按主题「${theme}」重写元素池中「${level}」的全部选项。要求：1) 新选项保持原层的语义槽位与粒度；2) 保留画风常量与排他性红线；3) 输出完整修订后的元素池，变更摘要说明重写逻辑。`,
    },
  ]
}

export function matchesSopQuickInstructionScope(
  instructionScope: SopQuickInstructionScope | undefined,
  activeScope: SopQuickInstructionScope,
): boolean {
  const scope = instructionScope ?? activeScope
  if (scope === 'all' || scope === activeScope) return true
  return (activeScope === 'element-pool' || activeScope === 'variable-prompt') && scope === 'sop'
}

export function getSopQuickInstructionScopeLabel(scope: SopQuickInstructionScope | undefined): string {
  switch (scope) {
    case 'sop':
      return '通用 SOP'
    case 'element-pool':
      return '元素池'
    case 'variable-prompt':
      return '变量提示词'
    case 'meta-instruction':
      return '元指令'
    default:
      return '全部场景'
  }
}
