import {
  buildSopSeriesLockedCopy,
  buildSopSeriesLockedFixedBlock,
  getSopSeriesFreeFixedDimensions,
  isSopSeriesCopyFixed,
  mergeSopSeriesFixedBlock,
} from './sopSeriesDimensions'
import type { SopLibraryItem, SopSeriesConfig } from './types'

export const MAX_SOP_PROMPTS_PER_MODEL_REQUEST = 10
export const SOP_PROMPT_BATCH_MAX_ATTEMPTS = 2
export const MAX_SOP_IMAGES_PER_PROMPT = 20
export const SOP_HIGH_VOLUME_WARNING_THRESHOLD = 20

export interface SopPromptSourceLike {
  id: string
}

export interface SopPromptBatchContext {
  sourceLabel?: string
  sourceIndex?: number
  sourceCount?: number
  totalPromptCount?: number
  existingPrompts?: string[]
  seriesConfig?: SopSeriesConfig
  /** 单成员重生成：只输出组内一条提示词，固定块由 seriesFixedBlock 逐字沿用。 */
  seriesMemberOnly?: boolean
  /**
   * 组内固定块：非空时要求模型逐字沿用，并作为拼装时的唯一固定块。
   * 单成员重生成、批次补缺都用它保证同组画面共用同一段视觉规范。
   */
  seriesFixedBlock?: string
  /**
   * 组内画面文字段：与 seriesFixedBlock 配套，同样逐字沿用。
   * 「文案内容」固定时才有值，单独成段是因为固定块被标注为「非画面文字」。
   */
  seriesCopyBlock?: string
}

/**
 * 系列图固定块前缀。固定块单独成段，既能被逐字复用，也能被 getSopSeriesFixedBlock 重新提取；
 * 文案里显式声明「非画面文字」，避免图片模型把它当作要渲染的文字元素。
 */
export const SOP_SERIES_FIXED_PREFIX = '系列统一规范（非画面文字）：'
export const SOP_SERIES_VARIABLE_PREFIX = '本张画面：'
/**
 * 画面文字段前缀。整组共用的文案不能塞进上面的固定块 —— 那个块被显式标注「非画面文字」，
 * 图片模型会刻意不把它渲染成文字。所以文案单独成段，并显式要求逐字绘制。
 */
export const SOP_SERIES_COPY_PREFIX = '画面文字（逐字绘制）：'

export const SOP_PROMPT_GENERATOR_INSTRUCTION = `你是图像生成提示词编排专家，也是可靠的 SOP 执行器。

执行优先级：
1. 当前请求规定的数量与 JSON 传输封装最高优先，SOP 中自带的示例输出格式不得改变该封装。
2. SOP 中明确规定的内容要求、视觉常量和禁止项应当保留；不要把建议、示例或缺省字段误判为强制项。
3. 用户补充要求与参考图用于填写 SOP 的变量和未定义项；冲突时不得覆盖 SOP 的强制项与禁止项。
4. 对仍未定义的部分做专业且保守的补全，不虚构品牌、产品、文字、功效或规格事实。

先在内部理解 SOP 的目标、必要约束和可变部分，再规划批次差异并逐条自检，不要输出分析过程。每条结果应当独立、可直接用于图片生成；语言、详略、格式和需要包含的画面要素以 SOP 为准，SOP 未规定时默认使用中文。批量结果在 SOP 允许的维度上形成有意义的差异。

最终只输出请求指定的 JSON 传输封装，不要输出 Markdown、标题、编号、解释或自检记录。`

function throwIfSopPromptGenerationAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new DOMException('提示词生成已取消', 'AbortError')
}

function normalizeSopPromptCount(value: number) {
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.trunc(value))
}

export function getSopRunCounts(promptCount: number, imagesPerPrompt: number) {
  return {
    promptCount: normalizeSopPromptCount(promptCount),
    imagesPerPrompt: Math.max(1, Math.min(MAX_SOP_IMAGES_PER_PROMPT, Math.trunc(imagesPerPrompt || 1))),
  }
}

export function getSopTotalImageCount(promptCount: number, imagesPerPrompt: number) {
  const normalized = getSopRunCounts(promptCount, imagesPerPrompt)
  return normalized.promptCount * normalized.imagesPerPrompt
}

export function getSopPromptBatchSizes(totalPromptCount: number, maxBatchSize = MAX_SOP_PROMPTS_PER_MODEL_REQUEST) {
  const total = normalizeSopPromptCount(totalPromptCount)
  const batchSize = Math.max(1, Math.min(MAX_SOP_PROMPTS_PER_MODEL_REQUEST, Math.trunc(maxBatchSize || 1)))
  const sizes: number[] = []
  for (let remaining = total; remaining > 0; remaining -= batchSize) {
    sizes.push(Math.min(batchSize, remaining))
  }
  return sizes
}

export function allocateSopPromptCounts(totalPromptCount: number, sourceCount: number) {
  const count = normalizeSopPromptCount(totalPromptCount)
  const sources = Math.max(0, Math.trunc(sourceCount || 0))
  if (sources === 0) return []
  const base = Math.floor(count / sources)
  const remainder = count % sources
  return Array.from({ length: sources }, (_, index) => base + (index < remainder ? 1 : 0))
}

export function getMentionedSopSourceIndexes(text: string, sourceCount: number) {
  const indexes: number[] = []
  const seen = new Set<number>()
  for (const match of text.matchAll(/@图\s*(\d+)/g)) {
    const index = Number(match[1]) - 1
    if (Number.isInteger(index) && index >= 0 && index < sourceCount && !seen.has(index)) {
      seen.add(index)
      indexes.push(index)
    }
  }
  return indexes
}

export function selectSopPromptSources<T extends SopPromptSourceLike>(
  sources: T[],
  targetPromptCount: number,
  brief: string,
) {
  const count = normalizeSopPromptCount(targetPromptCount)
  const mentionedIndexes = getMentionedSopSourceIndexes(brief, sources.length)
  if (mentionedIndexes.length > 0) return mentionedIndexes.slice(0, count).map((index) => sources[index])
  return sources.slice(0, Math.min(sources.length, count))
}

function stripSopPromptListLabel(value: string) {
  return value
    .trim()
    .replace(/^(?:(?:prompt|提示词)\s*)?(?:第\s*)?\d+\s*(?:条)?\s*[:：、.)）-]\s*/i, '')
    .trim()
}

function getSopPromptDeduplicationKey(value: string) {
  return stripSopPromptListLabel(value)
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

function normalizeSopPromptResponseKey(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s_-]+/g, '')
}

const SOP_PROMPT_LIST_KEYS = new Set([
  'prompts',
  'promptlist',
  'promptbatch',
  'generatedprompts',
  'readytouseprompts',
  'items',
])

const SOP_PROMPT_WRAPPER_KEYS = new Set(['data', 'result', 'results', 'output', 'outputs', 'response'])
const SOP_PROMPT_VALUE_KEYS = new Set(['prompt', 'text', 'content'])

function collectSopPromptsFromStructuredValue(value: unknown, depth = 0): string[] {
  if (depth > 4) return []
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === 'string') return [item]
      if (!item || typeof item !== 'object') return []
      const record = item as Record<string, unknown>
      for (const [key, nested] of Object.entries(record)) {
        if (SOP_PROMPT_VALUE_KEYS.has(normalizeSopPromptResponseKey(key)) && typeof nested === 'string') {
          return [nested]
        }
      }
      return collectSopPromptsFromStructuredValue(record, depth + 1)
    })
  }
  if (!value || typeof value !== 'object') return []

  const entries = Object.entries(value as Record<string, unknown>)
  for (const [key, nested] of entries) {
    if (SOP_PROMPT_LIST_KEYS.has(normalizeSopPromptResponseKey(key))) {
      const prompts = collectSopPromptsFromStructuredValue(nested, depth + 1)
      if (prompts.length) return prompts
    }
  }

  const numberedPrompts = entries
    .filter(
      ([key, nested]) =>
        typeof nested === 'string' && /^(?:(?:prompt|提示词)\d+|\d+)$/.test(normalizeSopPromptResponseKey(key)),
    )
    .map(([, nested]) => nested as string)
  if (numberedPrompts.length) return numberedPrompts

  for (const [key, nested] of entries) {
    const normalizedKey = normalizeSopPromptResponseKey(key)
    if (SOP_PROMPT_VALUE_KEYS.has(normalizedKey) && typeof nested === 'string') return [nested]
    if (SOP_PROMPT_WRAPPER_KEYS.has(normalizedKey)) {
      const prompts = collectSopPromptsFromStructuredValue(nested, depth + 1)
      if (prompts.length) return prompts
    }
  }
  return []
}

function parseSopPromptJson(source: string) {
  const candidates = new Set<string>([source.trim()])
  for (const match of source.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) candidates.add(match[1].trim())
  for (const [open, close] of [
    ['{', '}'],
    ['[', ']'],
  ] as const) {
    const start = source.indexOf(open)
    const end = source.lastIndexOf(close)
    if (start >= 0 && end > start) candidates.add(source.slice(start, end + 1))
  }

  for (const candidate of candidates) {
    const repaired = candidate
      .replace(/^\uFEFF/, '')
      .replace(/([{,]\s*)([A-Za-z_][\w-]*)\s*:/g, '$1"$2":')
      .replace(/,\s*([}\]])/g, '$1')
    try {
      const prompts = collectSopPromptsFromStructuredValue(JSON.parse(repaired))
      if (prompts.length) return prompts
    } catch {
      // Try the next JSON-shaped candidate, then fall back to a recognizable text list.
    }
  }
  return []
}

function extractSopPromptTextList(source: string, expected: number) {
  const xmlPrompts = [...source.matchAll(/<prompt(?:\s+[^>]*)?>([\s\S]*?)<\/prompt>/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean)
  if (xmlPrompts.length) return xmlPrompts

  const prompts: string[] = []
  let current = ''
  const labelPattern =
    /^(?:[-*•]\s+|\d{1,3}\s*[.)、:：-]\s*|(?:prompt|提示词)\s*(?:#|第)?\s*(?:\d+|[一二三四五六七八九十]+)?\s*(?:条)?\s*[:：.)、-]\s*)(.*)$/i
  for (const rawLine of source
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .split(/\r?\n/)) {
    const line = rawLine.trim()
    const match = line.match(labelPattern)
    if (match) {
      if (current) prompts.push(current)
      current = match[1].trim()
    } else if (current && line) {
      current += `\n${line}`
    }
  }
  if (current) prompts.push(current)
  if (prompts.length) return prompts

  if (expected === 1) {
    const plainPrompt = source
      .replace(/^```(?:\w+)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .replace(/^(?:prompt|提示词)\s*[:：]\s*/i, '')
      .trim()
    if (plainPrompt && !/^[{[]/.test(plainPrompt)) return [plainPrompt]
  }
  return []
}

export function normalizeSopPromptCandidates(candidates: string[], limit: number, existingPrompts: string[] = []) {
  const seen = new Set(existingPrompts.map(getSopPromptDeduplicationKey).filter(Boolean))
  const normalized: string[] = []
  for (const candidate of candidates) {
    const prompt = stripSopPromptListLabel(candidate)
    const key = getSopPromptDeduplicationKey(prompt)
    if (!prompt || !key || seen.has(key)) continue
    seen.add(key)
    normalized.push(prompt)
    if (normalized.length >= limit) break
  }
  return normalized
}

function normalizeSopSeriesFixedBlock(value: string) {
  // 固定块必须单行：换行会破坏「首个段落即固定块」的提取约定，也让逐字复用难以核对。
  return value.replace(/\s*\n+\s*/g, ' ').trim()
}

function getSopSeriesComparisonKey(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

/**
 * 模型可能已把固定块原样写在成员提示词开头；此时剥离掉，避免拼装后固定块重复出现。
 * 严格前缀匹配失败时退化为「忽略空白与标点」的宽松匹配，再按原文位置切分。
 */
export function stripSopSeriesFixedPrefix(memberPrompt: string, fixedBlock: string) {
  const member = memberPrompt.trim()
  const fixed = normalizeSopSeriesFixedBlock(fixedBlock)
  if (!member || !fixed) return member
  if (member.startsWith(fixed))
    return member
      .slice(fixed.length)
      .replace(/^[\s，,。;；:：、-]+/, '')
      .trim()

  const fixedKey = getSopSeriesComparisonKey(fixed)
  const memberKey = getSopSeriesComparisonKey(member)
  if (!fixedKey || !memberKey.startsWith(fixedKey)) return member
  let consumed = 0
  let index = 0
  while (index < member.length && consumed < fixedKey.length) {
    if (!/[\s\p{P}\p{S}]/u.test(member[index])) consumed += 1
    index += 1
  }
  return member
    .slice(index)
    .replace(/^[\s，,。;；:：、-]+/, '')
    .trim()
}

/**
 * 把组内固定块、画面文字段与单张变化部分拼成最终提示词；固定块与画面文字逐字复用，组内成员完全一致。
 * 三段顺序固定：固定块 → 画面文字 → 本张画面。缺哪段就省哪段。
 */
export function assembleSopSeriesPrompt(fixedBlock: string, memberPrompt: string, copyBlock = '') {
  const fixed = normalizeSopSeriesFixedBlock(fixedBlock)
  const copy = normalizeSopSeriesFixedBlock(copyBlock)
  const member = stripSopSeriesFixedPrefix(memberPrompt, fixed)
  // 既没有固定块也没有画面文字时退化为裸提示词，与单条生成保持一致
  if (!fixed && !copy) return member
  const lines: string[] = []
  if (fixed) lines.push(`${SOP_SERIES_FIXED_PREFIX}${fixed}`)
  if (copy) lines.push(`${SOP_SERIES_COPY_PREFIX}${copy}`)
  if (member) lines.push(`${SOP_SERIES_VARIABLE_PREFIX}${member}`)
  return lines.join('\n')
}

/** 从已生成的系列提示词中取回固定块，供单成员重生成复用（组内成员共用同一段）。 */
export function getSopSeriesFixedBlock(prompt: string) {
  const firstLine = prompt.trim().split('\n', 1)[0]?.trim() ?? ''
  if (!firstLine.startsWith(SOP_SERIES_FIXED_PREFIX)) return ''
  return firstLine.slice(SOP_SERIES_FIXED_PREFIX.length).trim()
}

/** 从已生成的系列提示词中取回画面文字段，供单成员重生成复用（与固定块配套）。 */
export function getSopSeriesCopyBlock(prompt: string) {
  const line = prompt
    .trim()
    .split('\n')
    .find((item) => item.trim().startsWith(SOP_SERIES_COPY_PREFIX))
  if (!line) return ''
  return line.trim().slice(SOP_SERIES_COPY_PREFIX.length).trim()
}

export async function generateSopPromptBatches(
  totalPromptCount: number,
  generateBatch: (quantity: number, existingPrompts: string[]) => Promise<string[]>,
  options: {
    exact?: boolean
    existingPrompts?: string[]
    maxBatchSize?: number
    maxAttempts?: number
    onProgress?: (completed: number, total: number) => void
    onBatch?: (prompts: string[], completed: number, total: number) => void | Promise<void>
    beforeBatch?: () => void | Promise<void>
    signal?: AbortSignal
    outputUnitSize?: number
    /** 判定错误是否值得重试；超时这类「再等一次也一样」的错误应返回 false，避免等待时间成倍拉长。 */
    isRetryable?: (error: unknown) => boolean
  } = {},
) {
  const expected = normalizeSopPromptCount(totalPromptCount)
  const outputUnitSize = Math.max(1, Math.trunc(options.outputUnitSize ?? 1))
  const batchSize = getSopPromptBatchSizes(expected, options.maxBatchSize)[0]
  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts ?? SOP_PROMPT_BATCH_MAX_ATTEMPTS))
  const generated: string[] = []

  while (generated.length / outputUnitSize < expected) {
    const completedUnits = generated.length / outputUnitSize
    const quantity = Math.min(batchSize, expected - completedUnits)
    let batch: string[] = []
    let lastError: unknown
    let stoppedEarly = false

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await options.beforeBatch?.()
      throwIfSopPromptGenerationAborted(options.signal)
      const existingPrompts = [...(options.existingPrompts ?? []), ...generated]
      try {
        const candidates = await generateBatch(quantity, existingPrompts)
        throwIfSopPromptGenerationAborted(options.signal)
        batch = normalizeSopPromptCandidates(candidates, quantity * outputUnitSize, existingPrompts)
        if (!batch.length) throw new Error('模型未返回新的可用提示词')
        break
      } catch (error) {
        throwIfSopPromptGenerationAborted(options.signal)
        lastError = error
        if (options.isRetryable && !options.isRetryable(error)) {
          stoppedEarly = true
          break
        }
      }
    }

    if (!batch.length) {
      if (options.exact === false && generated.length > 0) break
      // 不可重试的错误直接抛出原始原因，避免「已自动尝试 N 次」造成误导
      if (stoppedEarly) throw lastError
      const message = lastError instanceof Error ? lastError.message : '提示词生成失败'
      throw new Error(`提示词批次生成失败，已自动尝试 ${maxAttempts} 次：${message}`)
    }
    generated.push(...batch)
    const completedOutputUnits = generated.length / outputUnitSize
    await options.onBatch?.([...batch], completedOutputUnits, expected)
    options.onProgress?.(completedOutputUnits, expected)
  }

  if (options.exact !== false && generated.length !== expected * outputUnitSize) {
    throw new Error(`模型应返回 ${expected} 组提示词，实际返回 ${generated.length / outputUnitSize} 组，请重试`)
  }
  return generated
}

/**
 * 系列模式下固定块的指令，来源按优先级：
 * 1. 已锁定的固定块（单成员重生成 / 批次补缺）—— 必须逐字沿用；
 * 2. 用户手工填了值的固定维度 —— 由客户端直接拼进固定块，模型只补其余维度；
 * 3. 模型自由撰写全部固定维度。
 * 文案内容不走这里（见 buildSopSeriesCopyInstruction）：固定块被标注「非画面文字」。
 */
function buildSopSeriesFixedInstruction(input: {
  seriesConfig: SopSeriesConfig
  seriesFixedBlock: string
  lockedFixedBlock: string
  freeFixedDimensions: string[]
}) {
  const { freeFixedDimensions, lockedFixedBlock, seriesConfig, seriesFixedBlock } = input
  if (seriesFixedBlock)
    return [
      '本组固定块已锁定，必须逐字沿用，不得改写、增删、调换顺序或重新措辞：',
      `<FIXED>\n${seriesFixedBlock}\n</FIXED>`,
    ].join('\n')
  if (!freeFixedDimensions.length && !lockedFixedBlock)
    return '本组没有需要写进固定块的视觉维度，fixed 字段返回空字符串。'
  const singleParagraph = '固定块必须是单段文本，不得换行分段，不得出现空行，不得包含“同上”“保持一致”等省略表达。'
  if (!lockedFixedBlock)
    return [
      '每组只写一次「固定块」，用于锁定本系列的视觉常量，供组内每条提示词逐字复用。',
      `固定块内容为${freeFixedDimensions.join('、')}的完整视觉规则；${singleParagraph}`,
    ].join('\n')
  return [
    '用户已逐字锁定以下固定项，客户端会直接把它们拼在固定块最前面，不要重复描述这些维度：',
    `<LOCKED>\n${lockedFixedBlock}\n</LOCKED>`,
    freeFixedDimensions.length
      ? `固定块只写其余固定维度（${freeFixedDimensions.join('、')}）的完整视觉规则；${singleParagraph}`
      : '固定维度已全部被用户锁定，fixed 字段返回空字符串。',
  ].join('\n')
}

/**
 * 系列模式下画面文字（fixedCopy 字段）的指令。
 * 画面文字单独走一个字段，因为固定块前缀写死了「非画面文字」，塞进去会被模型刻意不渲染。
 */
function buildSopSeriesCopyInstruction(input: {
  seriesConfig: SopSeriesConfig
  seriesCopyBlock: string
  lockedCopy: string
}) {
  const { lockedCopy, seriesConfig, seriesCopyBlock } = input
  if (seriesCopyBlock)
    return ['本组画面文字已锁定，必须逐字沿用，不得改写、增删或重新措辞：', `<COPY>\n${seriesCopyBlock}\n</COPY>`].join(
      '\n',
    )
  if (lockedCopy)
    return '用户已逐字锁定画面文字，客户端会直接拼在固定块之后，fixedCopy 字段返回空字符串，各条提示词也不得再写文案。'
  if (isSopSeriesCopyFixed(seriesConfig))
    return [
      '「文案内容」已固定：请在 fixedCopy 字段写出本组唯一的那一句画面文字，要求可直接绘制、逐字可用、不带任何解释或标注。',
      '组内每条提示词都不得再写自己的文案，只写画面其余部分。',
    ].join('\n')
  return '「文案内容」每张变化：fixedCopy 字段返回空字符串，文案写在各条提示词的变化部分里。'
}

/** 系列模式下变化部分的指令；未限定可变维度时退化为「写出完整画面描述」。 */
function buildSopSeriesVariableInstruction(seriesConfig: SopSeriesConfig) {
  const tail = [
    '不得重复固定块里已写过的风格、构图、排版、色彩与光线描述。',
    isSopSeriesCopyFixed(seriesConfig) ? '文案内容已整组固定，变化部分不得再写任何画面文字。' : '',
  ]
    .filter(Boolean)
    .join('')
  return seriesConfig.variableDimensions.length
    ? `每条提示词只写本张图的变化部分，内容为${seriesConfig.variableDimensions.join('、')}；${tail}`
    : `每条提示词写出完整的画面描述（本次未限定可变维度）；${tail}`
}

export function buildSopPromptBatchRequest(
  sop: SopLibraryItem,
  quantity: number,
  brief: string,
  context: SopPromptBatchContext = {},
) {
  const count = normalizeSopPromptCount(quantity)
  const comparisonPrompts = context.existingPrompts?.filter((item) => item.trim()) ?? []
  const boundedComparisonPrompts =
    comparisonPrompts.length <= 12
      ? comparisonPrompts
      : [...comparisonPrompts.slice(0, 3), ...comparisonPrompts.slice(-9)]
  const seriesConfig = context.seriesConfig
  const seriesMemberCount = seriesConfig ? (context.seriesMemberOnly ? 1 : seriesConfig.imageCount) : 0
  const seriesFixedBlock = normalizeSopSeriesFixedBlock(context.seriesFixedBlock ?? '')
  const seriesCopyBlock = normalizeSopSeriesFixedBlock(context.seriesCopyBlock ?? '')
  // 用户手工填了值的固定维度：由客户端直接拼进固定块，不交给模型改写。
  const lockedFixedBlock = seriesConfig ? buildSopSeriesLockedFixedBlock(seriesConfig) : ''
  // 用户手工填了的文案：客户端直接拼成画面文字段，模型只负责照写。
  const lockedCopy = seriesConfig ? buildSopSeriesLockedCopy(seriesConfig) : ''
  const freeFixedDimensions = seriesConfig ? getSopSeriesFreeFixedDimensions(seriesConfig) : []
  const seriesInstruction = seriesConfig
    ? [
        `当前 SOP 是系列组图模式：每组必须输出 ${seriesMemberCount} 条提示词。`,
        buildSopSeriesFixedInstruction({ seriesConfig, seriesFixedBlock, lockedFixedBlock, freeFixedDimensions }),
        buildSopSeriesCopyInstruction({ seriesConfig, seriesCopyBlock, lockedCopy }),
        buildSopSeriesVariableInstruction(seriesConfig),
        `只返回合法 JSON：{"series":[{"fixed":"本组固定块原文","fixedCopy":"本组画面文字，没有则空字符串","prompts":["系列图1变化部分"${seriesMemberCount >= 2 ? ',"系列图2变化部分"' : ''}${seriesMemberCount === 3 ? ',"系列图3变化部分"' : ''}]}]}`,
      ].join('\n')
    : ''
  return [
    `任务：依据 SOP 生成 ${count} 条彼此不同、可直接用于图片生成模型的提示词。`,
    context.totalPromptCount
      ? `本轮总目标提示词数量：${context.totalPromptCount} 条。当前只生成分配给本参考图的 ${count} 条。`
      : '',
    context.sourceLabel
      ? `当前参考图：${context.sourceLabel}${context.sourceIndex && context.sourceCount ? `（${context.sourceIndex}/${context.sourceCount}）` : ''}。将图中可见事实作为内容依据，并用 SOP 规定的视觉规则组织提示词。`
      : '',
    '',
    '执行契约：',
    '1. 先在内部理解 SOP 的目标、必要约束、建议项、示例和可变部分，再生成；不要输出拆解过程。',
    '2. 补充要求用于补全或调整 SOP 未锁定的内容；只有 SOP 明确标为必须、固定或禁止的规则才视为硬约束。',
    '3. 提示词的语言、详略、结构和画面要素以 SOP 为准；不要强行补写 SOP 不需要的字段，也不要擅自添加模型专用参数。',
    '4. 批次内应在 SOP 允许的维度形成有意义的差异；若 SOP 本身要求固定或相近的结果，优先遵循 SOP。',
    '5. SOP 内若自带 JSON、编号或其他输出示例，只提取其中对提示词内容的要求；最终仍使用本请求末尾规定的 JSON 传输封装。',
    seriesInstruction,
    brief.trim()
      ? `本批补充要求：
<BRIEF>
${brief.trim()}
</BRIEF>`
      : '本批补充要求：无',
    boundedComparisonPrompts.length
      ? `已有提示词样本（不得与已有结果重复或仅做同义改写）：
<EXISTING_PROMPTS>
${JSON.stringify(boundedComparisonPrompts)}
</EXISTING_PROMPTS>`
      : '',
    '',
    '<SOP>',
    `名称：${sop.name}`,
    sop.description.trim() ? `用途说明：${sop.description.trim()}` : '',
    sop.content,
    '</SOP>',
    '',
    '输出前逐条自检：SOP 明确硬约束无遗漏、禁止项未违反、事实未臆造、每条都能脱离上下文独立使用。',
    context.seriesConfig
      ? `严格生成 ${count} 组系列图，每组 ${seriesMemberCount} 条成员提示词；同组每条提示词必须共用同一段固定块原文。`
      : `只返回合法 JSON：{"prompts":["完整提示词 1","完整提示词 2","共严格 ${count} 条"]}`,
    '禁止 Markdown 代码围栏、解释、标题和列表编号；禁止使用“同上”“保持一致”等省略表达。',
  ]
    .filter(Boolean)
    .join('\n')
}

export function parseSopPromptBatchResponse(
  text: string,
  quantity: number,
  options: { exact?: boolean; existingPrompts?: string[] } = {},
) {
  const expected = normalizeSopPromptCount(quantity)
  const source = text.trim()
  const prompts = parseSopPromptJson(source)
  const recognizedPrompts = prompts.length ? prompts : extractSopPromptTextList(source, expected)
  const normalized = normalizeSopPromptCandidates(recognizedPrompts, expected, options.existingPrompts)
  if (options.exact !== false && normalized.length !== expected)
    throw new Error(`模型应返回 ${expected} 条提示词，实际返回 ${normalized.length} 条，请重试`)
  if (options.exact === false && normalized.length === 0) throw new Error('模型未返回可用提示词，请重试')
  return normalized
}

/** 系列提示词解析的拼装输入：固定块与画面文字段的四个来源。 */
export interface SopSeriesPromptBatchOptions {
  /** 已锁定的固定块（单成员重生成 / 批次补缺）—— 必须逐字沿用。 */
  fixedBlock?: string
  /** 与 fixedBlock 配套的画面文字段。 */
  copyBlock?: string
  /** 用户手工填了值的固定维度拼成的锁定段。 */
  lockedFixedBlock?: string
  /** 用户手工填了值的画面文字。 */
  lockedCopy?: string
}

export function parseSopSeriesPromptBatchResponse(
  text: string,
  groupCount: number,
  seriesCount: number,
  options: SopSeriesPromptBatchOptions = {},
) {
  const expectedGroups = normalizeSopPromptCount(groupCount)
  const membersPerGroup = normalizeSopPromptCount(seriesCount)
  const source = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('系列提示词返回格式不正确')
  let parsed: unknown
  try {
    parsed = JSON.parse(source.slice(start, end + 1))
  } catch {
    throw new Error('系列提示词 JSON 格式不正确')
  }
  const series =
    parsed && typeof parsed === 'object' && Array.isArray((parsed as { series?: unknown }).series)
      ? (parsed as { series: unknown[] }).series
      : []
  if (!series.length) throw new Error('系列提示词没有返回内容')

  // 不支持 json_schema 的模型可能给出偏差的组数或组内条数：组数多则截断到目标组数，
  // 少则留给批次循环补缺口；组内不足的组直接丢弃，保证每组都是完整的一组画面，
  // 批次单位换算（outputUnitSize）才不会错位。
  // 固定块与画面文字段一律由这里拼装：模型只负责写「变化部分」，组内共用同一段原文，
  // 避免各条提示词各自改写风格描述导致同组画面风格、构图、排版漂移。
  // 用户手工填了值的固定维度（lockedPrefix）永远排在模型补全段之前，保证用户填的内容逐字生效。
  // 画面文字优先级：已锁定段 > 用户填的文案 > 模型写的 fixedCopy。
  const reusedFixedBlock = normalizeSopSeriesFixedBlock(options.fixedBlock ?? '')
  const reusedCopyBlock = normalizeSopSeriesFixedBlock(options.copyBlock ?? '')
  const lockedPrefix = normalizeSopSeriesFixedBlock(options.lockedFixedBlock ?? '')
  const lockedCopy = normalizeSopSeriesFixedBlock(options.lockedCopy ?? '')
  const groups: Array<{ groupIndex: number; fixed: string; copy: string; prompts: string[] }> = []
  for (let index = 0; index < series.length && groups.length < expectedGroups; index += 1) {
    const entry = series[index]
    const record =
      entry && typeof entry === 'object' ? (entry as { fixed?: unknown; fixedCopy?: unknown; prompts?: unknown }) : {}
    const prompts = Array.isArray(record.prompts)
      ? record.prompts
          .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
          .map((item) => item.trim())
      : []
    if (prompts.length < membersPerGroup) continue
    const groupFixed =
      reusedFixedBlock ||
      mergeSopSeriesFixedBlock(
        lockedPrefix,
        normalizeSopSeriesFixedBlock(typeof record.fixed === 'string' ? record.fixed : ''),
      )
    const groupCopy =
      reusedCopyBlock ||
      lockedCopy ||
      normalizeSopSeriesFixedBlock(typeof record.fixedCopy === 'string' ? record.fixedCopy : '')
    groups.push({
      groupIndex: index,
      fixed: groupFixed,
      copy: groupCopy,
      prompts: prompts.slice(0, membersPerGroup).map((item) => assembleSopSeriesPrompt(groupFixed, item, groupCopy)),
    })
  }
  if (!groups.length) throw new Error(`模型未返回完整的一组系列提示词，每组需要 ${membersPerGroup} 条`)
  return groups
}
