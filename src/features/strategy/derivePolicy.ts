/**
 * 衍生维度策略：控制变量提示词模板中「哪些维度衍生、哪些锁定」。
 *
 * 每个维度三档：
 * - lock   锁定：原样保留参考图/输入中的内容，禁止出现该维度变量
 * - tweak  微调：同类变化（换颜色深浅、换角度、换材质质感），保持语义同层
 * - change 大改：跨类衍生（换主体类别、换风格流派、换场景类型），提升语义层级
 */

/**
 * 文案处理模式：控制衍生时如何处理参考图上的文字/文案。
 * - visual-only  纯视觉：排除全部文字与文案排版，只提取视觉策略
 * - preserve     保留原文案：参考图上的文字按原样保留，衍生时不改变
 * - derive       文案也衍生：把标题/卖点/价格等作为变量一起衍生（使用带文案策略）
 */
export type DeriveCopyMode = 'visual-only' | 'preserve' | 'derive'

export const DEFAULT_DERIVE_COPY_MODE: DeriveCopyMode = 'visual-only'

/**
 * 把文案处理模式编译成注入提示词生成器的指令块。
 */
export function buildCopyModeInstruction(mode: DeriveCopyMode): string {
  if (mode === 'visual-only') {
    return '文字处理：排除全部文字与文案排版，只提取纯视觉策略；模板正文与可变项中不得包含任何文字、标题、卖点、价格等内容。'
  }
  if (mode === 'preserve') {
    return '文字处理：保留参考图中的原文案。逐字识别标题、副标题、卖点、价格、配料等文字并将其原样写入模板固定正文（不得改写、不得省略、不得新增）；OCR 不确定的字符标记为 [OCR不确定]；只排除指定文案之外的额外文字、Logo、水印和二维码。'
  }
  return [
    '文字处理：文案也参与衍生（本模式最重要的要求）。',
    '参考图中的标题、副标题、卖点、价格、配料等画面文字【必须】变成模板的可变项（如 {{标题}}、{{卖点}}、{{价格}}），不得写死在正文中。',
    '每个文案变量至少提供 8 个互不相同的选项：选项内容必须完全不同（不同文案、不同卖点、不同标题、不同价格），禁止把原文案做同义改写后充数。',
    '原文案本身可以作为第一个选项保留，但其余选项必须与之有实质内容差异。',
    'OCR 不确定的字符标记为 [OCR不确定]，不得自行补写。',
    '只排除指定文案之外的额外文字、Logo、水印和二维码。',
  ].join('\n')
}

/**
 * 文案处理模式与 excludeText 的映射：供生成器调用方使用。
 */
export function copyModeToExcludeText(mode: DeriveCopyMode): boolean {
  return mode === 'visual-only'
}

/**
 * 变量模板质量校验：检查锁定维度是否泄漏进变量、选项数量与去重。
 * 返回空数组表示通过；否则返回具体问题描述。
 */
export function validateVariablePromptTemplate(
  body: string,
  variables: Array<{ name: string; options: string[] }>,
  policy: DeriveDimensionPolicy,
  minOptionsPerVariable = 8,
): string[] {
  const issues: string[] = []
  if (variables.length === 0) {
    issues.push('模板没有生成任何变量')
    return issues
  }

  // 1. 锁定维度不得出现在变量名中
  for (const [dimension, mode] of Object.entries(policy) as Array<[keyof DeriveDimensionPolicy, DeriveMode]>) {
    if (mode !== 'lock') continue
    const leaked = variables.filter((variable) => variable.name.includes(String(dimension)))
    if (leaked.length > 0) {
      issues.push(`锁定维度「${String(dimension)}」出现在变量中：${leaked.map((item) => item.name).join('、')}`)
    }
  }

  // 2. 每个变量选项数量与去重
  for (const variable of variables) {
    if (variable.options.length < minOptionsPerVariable) {
      issues.push(`变量「${variable.name}」只有 ${variable.options.length} 个选项，少于 ${minOptionsPerVariable} 个`)
    }
    const uniqueCount = new Set(variable.options.map((option) => option.trim())).size
    if (uniqueCount < variable.options.length) {
      issues.push(`变量「${variable.name}」存在重复选项`)
    }
  }

  // 3. 正文确实使用了所有变量（防模型定义未使用变量）
  for (const variable of variables) {
    if (!body.includes(`{{${variable.name}}}`)) {
      issues.push(`变量「${variable.name}」未在正文中使用`)
    }
  }

  // 4. 「大改」维度的变量选项必须跨语义层级：检查同义改写（共享核心词且仅形容词/修饰差异）
  for (const [dimension, mode] of Object.entries(policy) as Array<[keyof DeriveDimensionPolicy, DeriveMode]>) {
    if (mode !== 'change') continue
    for (const variable of variables) {
      if (!variable.name.includes(String(dimension))) continue
      const nearDuplicatePairs = findNearDuplicatePairs(variable.options)
      if (nearDuplicatePairs.length > 0) {
        const samples = nearDuplicatePairs
          .slice(0, 2)
          .map((pair) => `「${pair[0]}」≈「${pair[1]}」`)
          .join('、')
        issues.push(`变量「${variable.name}」（大改维度）选项趋同，疑似同义改写：${samples}`)
      }
    }
  }

  return issues
}

/** 提取选项中的核心词（去掉常见修饰词后剩余部分），用于判断同义改写。 */
function coreWord(option: string): string {
  const modifiers = [
    '深',
    '浅',
    '亮',
    '暗',
    '暖',
    '冷',
    '淡',
    '浓',
    '清新',
    '柔和',
    '复古',
    '现代',
    '简约',
    '精致',
    '可爱',
    '酷炫',
    '高级',
    '梦幻',
    '自然',
    '卡通',
    '风格',
    '色调',
    '色系',
    '感',
    '的',
  ]
  let word = option.trim()
  for (const modifier of modifiers) {
    word = word.replaceAll(modifier, '')
  }
  return word
}

/** 找出语义趋同的选项对（核心词相同或互相包含，且都不是短词）。 */
function findNearDuplicatePairs(options: string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = []
  for (let i = 0; i < options.length; i += 1) {
    for (let j = i + 1; j < options.length; j += 1) {
      const left = options[i].trim()
      const right = options[j].trim()
      if (!left || !right) continue
      const leftCore = coreWord(left)
      const rightCore = coreWord(right)
      if (leftCore.length < 2 || rightCore.length < 2) continue
      const sameCore = leftCore === rightCore
      const contains = leftCore.includes(rightCore) || rightCore.includes(leftCore)
      if (sameCore || contains) {
        pairs.push([left, right])
      }
    }
  }
  return pairs
}

export const DERIVE_DIMENSIONS = ['主体', '风格', '配色', '场景', '构图', '光影', '材质', '氛围'] as const

export type DeriveDimension = (typeof DERIVE_DIMENSIONS)[number]

export type DeriveMode = 'lock' | 'tweak' | 'change'

export type DeriveDimensionPolicy = Record<DeriveDimension, DeriveMode>

export const DEFAULT_DERIVE_DIMENSION_POLICY: DeriveDimensionPolicy = {
  主体: 'tweak',
  风格: 'tweak',
  配色: 'tweak',
  场景: 'tweak',
  构图: 'lock',
  光影: 'tweak',
  材质: 'tweak',
  氛围: 'tweak',
}

const MODE_LABEL: Record<DeriveMode, string> = {
  lock: '锁定',
  tweak: '微调',
  change: '大改',
}

const MODE_INSTRUCTION: Record<DeriveMode, string> = {
  lock: '该维度锁定：严格保留参考图/输入中的原始内容，模板正文中写死该维度的具体描述，不得为其创建变量，也不得在选项中改变它。',
  tweak:
    '该维度微调：可创建变量，但选项必须与原始内容语义同级、保持同一类别（如换颜色深浅、角度、质感、氛围强弱），不得跳到另一个类别。',
  change:
    '该维度大改：可创建变量，且选项必须跨越语义层级（如主体从「柴犬」提升到「动物/萌宠」再换其他主体；风格从「水彩」提升到「插画媒介」再换其他画风），每个选项与原内容有实质结构差异，禁止只换形容词。',
}

/**
 * 把维度策略编译成注入提示词生成器的指令块。
 * 只列出「非默认档位」的维度可减少指令噪音，但为稳妥这里全部列出。
 */
export function buildDerivePolicyInstruction(policy: DeriveDimensionPolicy): string {
  const lines = DERIVE_DIMENSIONS.map((dimension) => {
    const mode = policy[dimension]
    return `- ${dimension}：${MODE_LABEL[mode]}。${MODE_INSTRUCTION[mode]}`
  })
  return [
    '本批次变量提示词模板的衍生维度策略（必须严格遵守）：',
    ...lines,
    '生成「可变项」时只允许为「微调」和「大改」的维度创建变量；「锁定」维度必须写死在正文中。',
    '「微调」与「大改」维度的每个变量至少要提供 8 个选项，且选项之间必须有可感知的差异，禁止用近义词凑数。',
  ].join('\n')
}
