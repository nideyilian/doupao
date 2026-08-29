import type { SopLibraryItem } from './types'

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
}

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
  } = {},
) {
  const expected = normalizeSopPromptCount(totalPromptCount)
  const batchSize = getSopPromptBatchSizes(expected, options.maxBatchSize)[0]
  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts ?? SOP_PROMPT_BATCH_MAX_ATTEMPTS))
  const generated: string[] = []

  while (generated.length < expected) {
    const quantity = Math.min(batchSize, expected - generated.length)
    let batch: string[] = []
    let lastError: unknown

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await options.beforeBatch?.()
      throwIfSopPromptGenerationAborted(options.signal)
      const existingPrompts = [...(options.existingPrompts ?? []), ...generated]
      try {
        const candidates = await generateBatch(quantity, existingPrompts)
        throwIfSopPromptGenerationAborted(options.signal)
        batch = normalizeSopPromptCandidates(candidates, quantity, existingPrompts)
        if (!batch.length) throw new Error('模型未返回新的可用提示词')
        break
      } catch (error) {
        throwIfSopPromptGenerationAborted(options.signal)
        lastError = error
      }
    }

    if (!batch.length) {
      if (options.exact === false && generated.length > 0) break
      const message = lastError instanceof Error ? lastError.message : '提示词生成失败'
      throw new Error(`提示词批次生成失败，已自动尝试 ${maxAttempts} 次：${message}`)
    }
    generated.push(...batch)
    await options.onBatch?.([...batch], generated.length, expected)
    options.onProgress?.(generated.length, expected)
  }

  if (options.exact !== false && generated.length !== expected) {
    throw new Error(`模型应返回 ${expected} 条提示词，实际返回 ${generated.length} 条，请重试`)
  }
  return generated
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
    `只返回合法 JSON：{"prompts":["完整提示词 1","完整提示词 2","共严格 ${count} 条"]}`,
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
