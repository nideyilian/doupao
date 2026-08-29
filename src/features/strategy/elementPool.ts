/**
 * 多变体元素池 SOP 解析器。
 *
 * 「层级式元素池」是图片提示词直出型 SOP 的常见结构：
 * 正文用「层级X：标题」小节组织多个变体维度，每个小节内是编号选项列表；
 * 运行时从各层各取一项随机组合成完整提示词。典型写法：
 *
 * ```
 * * **[层级一：动态文案与标题概念变体]**：
 * 1. 粗体描边大标题"吃货de快乐时刻"，搭配黄色胶囊副标…
 * 2. …
 *
 * * **[层级二：核心视觉焦点 / 主体概念变体]**：
 * 1. …
 * ```
 *
 * 本模块只做结构识别，不修改正文；识别结果供 AI 指令（泛化/衍生/改写/诊断/试跑）
 * 与对话工作台使用。
 */

export type ElementPoolLevel = {
  /** 层级标识（原文中的「层级X」或标题名） */
  key: string
  /** 层级标题（如「层级一：动态文案与标题概念变体」） */
  title: string
  /** 该层选项列表（原文逐条保留，不去重） */
  items: string[]
}

export type ElementPoolParseResult = {
  detected: boolean
  levels: ElementPoolLevel[]
}

/** 识别「层级」小节标题：支持「层级一：」「层级1：」「Level 1:」「**[层级二：…]**」等写法。 */
const LEVEL_HEADING_PATTERN = /^[\s*>#*-]*\[*[\s*]*层级\s*[一二三四五六七八九十0-9]+\s*[：:][^\n]*\]*\s*[：:]?\s*$/u
/** 识别「Level N:」英文写法。 */
const LEVEL_HEADING_EN_PATTERN = /^[\s*>#*-]*\[*\s*[Ll]evel\s*\d+[^\n]*\]*\s*$/u

/** 识别编号选项行：「1. xxx」「1、xxx」「(1) xxx」「- xxx」等。 */
const ITEM_PATTERN = /^\s*(?:[-*•]\s+|\d+\s*[.、）)]\s*|（\d+）\s*|\s*\(\d+\)\s*)/u

function isLevelHeading(line: string) {
  const trimmed = line.trim()
  if (!trimmed) return false
  // 去掉外层 Markdown 强调/粗体符号后再匹配
  const normalized = trimmed.replace(/^\*\*+/, '').replace(/\*\*+$/, '')
  return LEVEL_HEADING_PATTERN.test(normalized) || LEVEL_HEADING_EN_PATTERN.test(normalized)
}

function extractLevelKey(title: string): string {
  const match = title.match(/层级\s*([一二三四五六七八九十0-9]+)/u)
  if (match) return `层级${match[1]}`
  const enMatch = title.match(/[Ll]evel\s*(\d+)/)
  if (enMatch) return `Level ${enMatch[1]}`
  return title.trim()
}

/**
 * 解析正文中的层级式元素池。识别规则：
 * - 至少出现 2 个「层级」小节才算检测成功（避免误判普通编号列表）；
 * - 小节标题后的缩进/编号行视为该层选项，连续收集直到下一个小节标题或段落结束。
 */
export function parseElementPool(content: string): ElementPoolParseResult {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const levels: ElementPoolLevel[] = []
  let current: ElementPoolLevel | null = null

  for (const line of lines) {
    if (isLevelHeading(line)) {
      const title = line.trim()
      current = { key: extractLevelKey(title), title, items: [] }
      levels.push(current)
      continue
    }
    if (!current) continue
    const trimmed = line.trim()
    if (!trimmed) continue
    if (ITEM_PATTERN.test(trimmed)) {
      const item = trimmed.replace(ITEM_PATTERN, '').trim()
      if (item) current.items.push(item)
    } else if (!trimmed.startsWith('[') && !trimmed.startsWith('!')) {
      // 小节内非列表行（如空行后的说明文字）——停止收集，避免把后续正文吞进上一层的选项
      current = null
    }
  }

  const detectedLevels = levels.filter((level) => level.items.length >= 1)
  return {
    detected: detectedLevels.length >= 2,
    levels: detectedLevels,
  }
}

/** 把元素池渲染为供 AI 指令引用的紧凑文本（保留层级标题与选项原文）。 */
export function formatElementPoolForPrompt(result: ElementPoolParseResult): string {
  if (!result.detected) return ''
  return result.levels
    .map((level) => `${level.title}\n${level.items.map((item) => `- ${item}`).join('\n')}`)
    .join('\n\n')
}
