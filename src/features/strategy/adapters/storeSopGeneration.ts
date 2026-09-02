import { getAgentTextApiProfile, validateApiProfile } from '../../../lib/apiProfiles'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from '../../../lib/devProxy'
import { submitTaskWithData, useStore } from '../../../store'
import {
  buildSopRequestContent,
  extractResponseText,
  getSopGeneratorInstruction,
  parseGeneratedSop,
  parseGeneratedVariablePrompt,
  prepareSopReferenceImages,
  validateSopGenerationInput,
  type GenerateSop,
  type GeneratedSop,
} from '../sopGeneration'
import { parseVariablePrompt, renderVariablePromptBatch } from '../../../lib/variablePrompt'
import {
  applyVariablePromptTextPolicy,
  EXCLUDE_TEXT_SKILL_INSTRUCTION,
  KEEP_TEXT_SKILL_INSTRUCTION,
} from '../variablePromptTextPolicy'
import {
  buildSopPromptBatchRequest,
  generateSopPromptBatches,
  parseSopPromptBatchResponse,
  SOP_PROMPT_GENERATOR_INSTRUCTION,
  type SopPromptBatchContext,
} from '../sopPromptBatch'
import { IMAGE_GENERATION_STRATEGY_SKILL_META_INSTRUCTION } from '../skillMetaInstructions'
import { DERIVE_DIMENSIONS, validateVariablePromptTemplate, type DeriveDimensionPolicy } from '../derivePolicy'
import { VISUAL_PROFILE_INSTRUCTION, buildProfileSummary, parseVisualProfiles } from '../visualProfile'
import type { SopLibraryItem } from '../types'
import type { ApiProfile, AppSettings } from '../../../types'

const SOP_GENERATION_TEXT_FORMAT = {
  type: 'json_schema',
  name: 'generated_sop',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '专业、清晰、可识别用途的 SOP 名称' },
      description: { type: 'string', description: '一到两句话说明 SOP 的用途、输入和产出' },
      sop: { type: 'string', description: '完整、可独立执行的 Markdown SOP 正文' },
    },
    required: ['name', 'description', 'sop'],
    additionalProperties: false,
  },
} as const

const VARIABLE_PROMPT_GENERATION_TEXT_FORMAT = {
  type: 'json_schema',
  name: 'generated_variable_prompt',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '简洁、清晰、可识别用途的变量提示词策略名称' },
      description: { type: 'string', description: '一到两句话说明视觉机制和批量应用价值' },
      variablePrompt: { type: 'string', description: '可直接解析执行的变量提示词正文，包含单独一行的可变项区块' },
    },
    required: ['name', 'description', 'variablePrompt'],
    additionalProperties: false,
  },
} as const

export function getSopPromptGenerationModelFromStore() {
  const settings = useStore.getState().settings
  const profile = getAgentTextApiProfile(settings)
  return (profile.model || settings.model).trim()
}

function buildSopPromptTextFormat(quantity: number) {
  const count = Math.max(1, Math.trunc(quantity))
  return {
    type: 'json_schema',
    name: 'sop_prompt_batch',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        prompts: {
          type: 'array',
          description: `包含 ${count} 条遵循 SOP、彼此不同且可直接用于图片生成模型的提示词`,
          minItems: count,
          maxItems: count,
          items: { type: 'string' },
        },
      },
      required: ['prompts'],
      additionalProperties: false,
    },
  } as const
}

function toChatCompletionsMessageContent(content: Array<Record<string, string>>) {
  const parts: Array<Record<string, unknown>> = []
  for (const part of content) {
    if (part.type === 'input_image' && typeof part.image_url === 'string') {
      parts.push({ type: 'image_url', image_url: { url: part.image_url } })
    } else if (part.type === 'input_text' && typeof part.text === 'string') {
      parts.push({ type: 'text', text: part.text })
    }
  }
  return parts
}

function extractChatCompletionsText(payload: unknown) {
  const record = payload as { choices?: Array<{ message?: { content?: unknown } }> } | null
  const firstChoice = Array.isArray(record?.choices) ? record.choices[0] : undefined
  return firstChoice?.message && typeof firstChoice.message.content === 'string' ? firstChoice.message.content : ''
}

export const generateSopFromStore: GenerateSop = async (
  description,
  context,
  referenceImages = [],
  kind = 'general',
  metaInstruction,
  options,
) => {
  options?.onProgress?.({ stage: 'validate', message: '正在校验生成条件与模型配置' })
  validateSopGenerationInput(description, referenceImages, kind)
  const brief = description.trim()
  const variablePromptMode = kind === 'variable-prompt-skill'
  const excludeText = variablePromptMode ? (options?.excludeText ?? true) : false

  const settings = useStore.getState().settings
  const profile = getAgentTextApiProfile(settings)
  const validationError = validateApiProfile(profile)
  if (validationError || profile.provider !== 'openai') {
    const message = validationError
      ? `请先完善 Agent 配置：${validationError}`
      : 'SOP 智能生成需要管理员配置 OpenAI 兼容的 Agent 文本模型'
    throw new Error(message)
  }

  const proxy = readClientDevProxyConfig()
  options?.onProgress?.({
    stage: 'prepare',
    message:
      referenceImages.length > 0
        ? `正在整理 ${referenceImages.length} 张参考图片与生成说明`
        : '正在整理生成说明与元指令',
  })
  const preparedReferences = await prepareSopReferenceImages(referenceImages)
  if (preparedReferences.compressedCount > 0) {
    options?.onProgress?.({
      stage: 'prepare',
      message: `已自动压缩 ${preparedReferences.compressedCount} 张过大参考图，正在继续生成`,
    })
  }
  const content = buildSopRequestContent(brief, context, preparedReferences.images, kind, excludeText)
  const useChatCompletions = settings.agentTextProtocol === 'chat-completions'
  const url = buildApiUrl(
    profile.baseUrl,
    useChatCompletions ? 'chat/completions' : 'responses',
    proxy,
    shouldUseApiProxy(profile.apiProxy, proxy),
  )
  const baseInstruction = getSopGeneratorInstruction(kind, metaInstruction)
  const responseFormat = variablePromptMode ? VARIABLE_PROMPT_GENERATION_TEXT_FORMAT : SOP_GENERATION_TEXT_FORMAT
  const send = (useStructuredOutput: boolean, retryIncomplete = false) => {
    const instructions = [
      baseInstruction,
      variablePromptMode
        ? '应用只接收 name、description、variablePrompt 三个字段；不得返回 sop。variablePrompt 必须是可直接拆解生图的完整模板，包含正文变量、单独一行的“可变项：”和逐行变量定义。'
        : '应用只接收 name、description、sop 三个字段；不得省略任何字段，sop 必须包含完整正文。',
      variablePromptMode ? (excludeText ? EXCLUDE_TEXT_SKILL_INSTRUCTION : KEEP_TEXT_SKILL_INSTRUCTION) : '',
      variablePromptMode && options?.dimensionPolicyInstruction ? options.dimensionPolicyInstruction : '',
      retryIncomplete ? '上一轮结果结构不完整。请重新完整生成，不要复述错误结果。' : '',
    ]
      .filter(Boolean)
      .join('\n\n')
    const body = useChatCompletions
      ? {
          model: profile.model || settings.model,
          messages: [
            { role: 'system', content: instructions },
            { role: 'user', content: toChatCompletionsMessageContent(content) },
          ],
          max_tokens: 8000,
          ...(useStructuredOutput
            ? {
                response_format: {
                  type: 'json_schema',
                  json_schema: {
                    name: responseFormat.name,
                    strict: true,
                    schema: responseFormat.schema,
                  },
                },
              }
            : {}),
        }
      : {
          model: profile.model || settings.model,
          instructions,
          input: [{ role: 'user', content }],
          max_output_tokens: 8000,
          ...(useStructuredOutput ? { text: { format: responseFormat } } : {}),
        }
    return fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${profile.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: options?.signal,
      cache: 'no-store',
      body: JSON.stringify(body),
    })
  }

  options?.onProgress?.({
    stage: 'request',
    message:
      referenceImages.length > 1
        ? `AI 正在逐张分析 ${referenceImages.length} 张图片并${variablePromptMode ? '反推变量提示词' : '编译 SOP'}`
        : `AI 正在分析输入并${variablePromptMode ? '反推变量提示词' : '编译 SOP'}`,
  })
  let structuredOutputEnabled = true
  let response = await send(structuredOutputEnabled)
  if (!response.ok && (response.status === 400 || response.status === 422)) {
    structuredOutputEnabled = false
    options?.onProgress?.({ stage: 'request', message: '当前模型已切换为兼容生成模式' })
    response = await send(false)
  }
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`SOP 生成失败（${response.status}）：${body.slice(0, 180)}`)
  }
  options?.onProgress?.({
    stage: 'parse',
    message: variablePromptMode ? '正在校验变量提示词语法与选项池' : '正在校验名称、说明与 SOP 正文',
  })
  const parse = (payload: unknown) => {
    const text = useChatCompletions ? extractChatCompletionsText(payload) : extractResponseText(payload)
    if (!variablePromptMode) return parseGeneratedSop(text)
    const generated = parseGeneratedVariablePrompt(text)
    const contentWithTextPolicy = applyVariablePromptTextPolicy(generated.sop, excludeText)
    const validation = parseVariablePrompt(contentWithTextPolicy)
    if (!validation.enabled) {
      throw new Error(`生成的变量提示词格式有误：${validation.errors[0] ?? '未识别到有效变量'}`)
    }
    return { ...generated, sop: contentWithTextPolicy }
  }
  try {
    return parse(await response.json())
  } catch (error) {
    options?.onProgress?.({ stage: 'repair', message: '返回结构不完整，正在自动修复并重试' })
    const retryResponse = await send(structuredOutputEnabled, true)
    if (!retryResponse.ok) {
      const body = await retryResponse.text()
      throw new Error(
        `${variablePromptMode ? '变量提示词' : 'SOP'}自动修复失败（${retryResponse.status}）：${body.slice(0, 180)}`,
        { cause: error },
      )
    }
    options?.onProgress?.({
      stage: 'parse',
      message: variablePromptMode ? '正在校验修复后的变量提示词' : '正在校验修复后的 SOP 结构',
    })
    try {
      return parse(await retryResponse.json())
    } catch (retryError) {
      // 「排除文字」违规不是结构问题，重试无法修复，直接透出
      if (retryError instanceof Error && /开启“排除文字”后/.test(retryError.message)) throw retryError
      throw new Error('AI 连续两次返回不完整内容，请切换文本模型或简化元指令后重试', { cause: retryError })
    }
  }
}

export async function generatePromptsFromSopStore(
  sop: SopLibraryItem,
  quantity: number,
  brief = '',
  options: {
    context?: SopPromptBatchContext
    referenceImages?: Array<{ name: string; dataUrl: string }>
    exact?: boolean
    existingPrompts?: string[]
    onProgress?: (completed: number, total: number) => void
    maxBatchSize?: number
    onBatch?: (prompts: string[], completed: number, total: number) => void | Promise<void>
    beforeBatch?: () => void | Promise<void>
    signal?: AbortSignal
  } = {},
) {
  const settings = useStore.getState().settings
  const profile = getAgentTextApiProfile(settings)
  const validationError = validateApiProfile(profile)
  if (validationError || profile.provider !== 'openai') {
    const message = validationError
      ? `请先完善 Agent 配置：${validationError}`
      : 'SOP 提示词生成需要管理员配置 OpenAI 兼容的 Agent 文本模型'
    throw new Error(message)
  }

  const proxy = readClientDevProxyConfig()
  const useChatCompletions = settings.agentTextProtocol === 'chat-completions'
  const url = buildApiUrl(
    profile.baseUrl,
    useChatCompletions ? 'chat/completions' : 'responses',
    proxy,
    shouldUseApiProxy(profile.apiProxy, proxy),
  )
  let structuredOutputEnabled = true

  return generateSopPromptBatches(
    quantity,
    async (batchQuantity, existingPrompts) => {
      const requestText = buildSopPromptBatchRequest(sop, batchQuantity, brief, {
        ...options.context,
        existingPrompts,
      })
      const send = (useStructuredOutput: boolean) => {
        const textFormat = buildSopPromptTextFormat(batchQuantity)
        const body = useChatCompletions
          ? {
              model: profile.model || settings.model,
              messages: [
                { role: 'system', content: SOP_PROMPT_GENERATOR_INSTRUCTION },
                {
                  role: 'user',
                  content: options.referenceImages?.length
                    ? [
                        { type: 'text', text: requestText },
                        ...options.referenceImages.map((image) => ({
                          type: 'image_url',
                          image_url: { url: image.dataUrl },
                        })),
                      ]
                    : requestText,
                },
              ],
              max_tokens: 12000,
              ...(useStructuredOutput
                ? {
                    response_format: {
                      type: 'json_schema',
                      json_schema: { name: textFormat.name, strict: true, schema: textFormat.schema },
                    },
                  }
                : {}),
            }
          : {
              model: profile.model || settings.model,
              instructions: SOP_PROMPT_GENERATOR_INSTRUCTION,
              input: options.referenceImages?.length
                ? [
                    {
                      role: 'user',
                      content: [
                        { type: 'input_text', text: requestText },
                        ...options.referenceImages.map((image) => ({
                          type: 'input_image',
                          image_url: image.dataUrl,
                        })),
                      ],
                    },
                  ]
                : requestText,
              max_output_tokens: 12000,
              ...(useStructuredOutput ? { text: { format: textFormat } } : {}),
            }
        return fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${profile.apiKey}`,
            'Content-Type': 'application/json',
          },
          signal: options.signal,
          cache: 'no-store',
          body: JSON.stringify(body),
        })
      }

      let response = await send(structuredOutputEnabled)
      if (!response.ok && structuredOutputEnabled && (response.status === 400 || response.status === 422)) {
        structuredOutputEnabled = false
        response = await send(false)
      }
      if (!response.ok) {
        const body = await response.text()
        throw new Error(`提示词生成失败（${response.status}）：${body.slice(0, 180)}`)
      }
      const payload = await response.json()
      const resultText = useChatCompletions ? extractChatCompletionsText(payload) : extractResponseText(payload)
      return parseSopPromptBatchResponse(resultText, batchQuantity, {
        exact: false,
        existingPrompts,
      })
    },
    {
      exact: options.exact,
      existingPrompts: options.existingPrompts,
      onProgress: options.onProgress,
      maxBatchSize: options.maxBatchSize,
      onBatch: options.onBatch,
      beforeBatch: options.beforeBatch,
      signal: options.signal,
    },
  )
}

export async function testSopRevisionFromStore(sop: SopLibraryItem) {
  const [prompt] = await generatePromptsFromSopStore(sop, 1, '', {
    exact: true,
    maxBatchSize: 1,
  })
  if (!prompt?.trim()) throw new Error('AI 未能从该 SOP 生成可测试的生图提示词')

  const state = useStore.getState()
  const activeTab = state.workspaceTabs.find((tab) => tab.id === state.activeWorkspaceTabId)
  const taskId = await submitTaskWithData(
    {
      prompt: prompt.trim(),
      inputImages: state.inputImages,
      inputImageFolder: state.inputImageFolder,
      params: { ...state.params, n: 1 },
      maskDraft: null,
      targetTabId: state.activeWorkspaceTabId,
      scheduledOutputPath: state.customOutputPath.trim() || undefined,
      scheduledOutputSubFolder: activeTab?.name,
    },
    { silentSuccess: true },
  )
  if (!taskId) throw new Error('测试生图任务未能提交，请检查图片 API 配置')
  state.showToast('测试任务已提交，可在当前画廊查看生成结果', 'success')
}

// ---------------------------------------------------------------------------
// 变量提示词模式（executionMode='variable-prompt'）批量展开
// ---------------------------------------------------------------------------

const VARIABLE_EXPANSION_TEXT_FORMAT = {
  type: 'json_schema',
  name: 'expanded_variable_prompt',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      variablePrompt: {
        type: 'string',
        description:
          '扩词条后的完整变量提示词正文：保留原正文与全部原选项，为每个变量追加足够多的新选项，必须可直接解析执行（包含单独一行的可变项区块）',
      },
    },
    required: ['variablePrompt'],
    additionalProperties: false,
  },
} as const

const VARIABLE_EXPANSION_INSTRUCTION = `你是变量提示词词条扩充器。用户提供一条变量提示词模板与期望的批量数量，当前模板的可变项组合数不足以覆盖该数量。
你的任务：在完全保留模板正文、变量名与已有选项的前提下，为每个变量追加足够多的新选项，使总组合数达到或超过期望数量。
要求：
1. 不得修改正文中的变量占位符（{{变量名}}）和已有选项，只能新增选项。
2. 新选项必须与原选项语义同级、互不重复，并在模板原有主题方向上形成有意义的差异。
3. 保持“可变项：”单独一行、每个变量单独一行的格式，选项用「 / 」分隔。
4. 最终只输出 JSON：{"variablePrompt":"完整的变量提示词正文"}，不要 Markdown、解释或编号。`

/**
 * 变量提示词模式的批量提示词生成：本地展开组合，组合不足时自动调 AI 扩词条。
 * 与 generatePromptsFromSopStore 同签名，弹窗可无缝切换执行分支。
 */
export async function generateVariablePromptsFromSopStore(
  sop: SopLibraryItem,
  quantity: number,
  brief = '',
  options: {
    context?: SopPromptBatchContext
    referenceImages?: Array<{ name: string; dataUrl: string }>
    exact?: boolean
    existingPrompts?: string[]
    onProgress?: (completed: number, total: number) => void
    maxBatchSize?: number
    onBatch?: (prompts: string[], completed: number, total: number) => void | Promise<void>
    beforeBatch?: () => void | Promise<void>
    signal?: AbortSignal
  } = {},
) {
  const parsed = parseVariablePrompt(sop.content)
  if (!parsed.enabled) {
    throw new Error(`变量提示词模板格式有误：${parsed.errors[0] ?? '请检查可变项格式'}`)
  }

  const settings = useStore.getState().settings
  const profile = getAgentTextApiProfile(settings)
  const validationError = validateApiProfile(profile)
  if (validationError || profile.provider !== 'openai') {
    const message = validationError
      ? `请先完善 Agent 配置：${validationError}`
      : '变量提示词批量展开需要管理员配置 OpenAI 兼容的 Agent 文本模型'
    throw new Error(message)
  }

  // 模板实际可展开的组合数；请求数量不能超过组合数（否则必然重复）
  const targetCount = Math.max(1, Math.trunc(quantity))
  let template = sop.content

  // 组合不足时自动调 AI 扩词条（仅当目标数量超过组合数，且未显式关闭）
  if (targetCount > parsed.combinationCount && options.signal?.aborted !== true) {
    template = await expandSopVariablePromptOptions(template, targetCount, {
      settings,
      profile,
      brief,
      referenceImages: options.referenceImages,
      signal: options.signal,
    })
    const reparsed = parseVariablePrompt(template)
    if (!reparsed.enabled) {
      throw new Error(`扩词条后模板格式异常：${reparsed.errors[0] ?? '请检查可变项格式'}`)
    }
  }
  // 用扩词条后的模板重新计算组合上限
  const finalParsed = parseVariablePrompt(template)
  const combinationLimit = Math.min(targetCount, finalParsed.combinationCount)

  const seed = `${sop.id}:${brief.trim() || 'default'}`
  // 复用 generateSopPromptBatches 驱动：本地展开作为唯一一批，走现有 onBatch 逐条推进/提交
  return generateSopPromptBatches(
    combinationLimit,
    async () => {
      return renderVariablePromptBatch(template, combinationLimit, seed)
    },
    {
      exact: options.exact,
      existingPrompts: options.existingPrompts,
      maxBatchSize: options.maxBatchSize,
      onProgress: options.onProgress,
      onBatch: options.onBatch,
      beforeBatch: options.beforeBatch,
      signal: options.signal,
    },
  )
}

async function expandSopVariablePromptOptions(
  template: string,
  targetCount: number,
  context: {
    settings: AppSettings
    profile: ApiProfile
    brief: string
    referenceImages?: Array<{ name: string; dataUrl: string }>
    signal?: AbortSignal
  },
): Promise<string> {
  const { settings, profile, brief, referenceImages } = context
  const proxy = readClientDevProxyConfig()
  const useChatCompletions = settings.agentTextProtocol === 'chat-completions'
  const url = buildApiUrl(
    profile.baseUrl,
    useChatCompletions ? 'chat/completions' : 'responses',
    proxy,
    shouldUseApiProxy(profile.apiProxy, proxy),
  )
  const userText = [
    `期望批量数量：${targetCount} 条。`,
    brief.trim() ? `补充要求：\n${brief.trim()}` : '',
    '',
    '当前变量提示词模板：',
    '<TEMPLATE>',
    template,
    '</TEMPLATE>',
  ]
    .filter(Boolean)
    .join('\n')

  const send = (useStructuredOutput: boolean) => {
    const body = useChatCompletions
      ? {
          model: profile.model || settings.model,
          messages: [
            { role: 'system', content: VARIABLE_EXPANSION_INSTRUCTION },
            {
              role: 'user',
              content: referenceImages?.length
                ? [
                    { type: 'text', text: userText },
                    ...referenceImages.map((image) => ({
                      type: 'image_url',
                      image_url: { url: image.dataUrl },
                    })),
                  ]
                : userText,
            },
          ],
          max_tokens: 8000,
          ...(useStructuredOutput
            ? {
                response_format: {
                  type: 'json_schema',
                  json_schema: {
                    name: VARIABLE_EXPANSION_TEXT_FORMAT.name,
                    strict: true,
                    schema: VARIABLE_EXPANSION_TEXT_FORMAT.schema,
                  },
                },
              }
            : {}),
        }
      : {
          model: profile.model || settings.model,
          instructions: VARIABLE_EXPANSION_INSTRUCTION,
          input: referenceImages?.length
            ? [
                {
                  role: 'user',
                  content: [
                    { type: 'input_text', text: userText },
                    ...referenceImages.map((image) => ({
                      type: 'input_image',
                      image_url: image.dataUrl,
                    })),
                  ],
                },
              ]
            : userText,
          max_output_tokens: 8000,
          ...(useStructuredOutput ? { text: { format: VARIABLE_EXPANSION_TEXT_FORMAT } } : {}),
        }
    return fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${profile.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: context.signal,
      cache: 'no-store',
      body: JSON.stringify(body),
    })
  }

  let structuredOutputEnabled = true
  let response = await send(structuredOutputEnabled)
  if (!response.ok && (response.status === 400 || response.status === 422)) {
    structuredOutputEnabled = false
    response = await send(false)
  }
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`扩词条失败（${response.status}）：${body.slice(0, 180)}`)
  }
  const payload = (await response.json()) as unknown
  const text = useChatCompletions ? extractChatCompletionsText(payload) : extractResponseText(payload)
  const generated = parseGeneratedVariablePrompt(text)
  const validation = parseVariablePrompt(generated.sop)
  if (!validation.enabled) {
    throw new Error(`扩词条后模板仍无法解析：${validation.errors[0] ?? '请检查模型返回'}`)
  }
  return generated.sop
}

// ---------------------------------------------------------------------------
// 两阶段衍生：阶段一视觉档案 → 阶段二模板生成（带质量校验与重试）
// ---------------------------------------------------------------------------

const VISUAL_PROFILE_TEXT_FORMAT = {
  type: 'json_schema',
  name: 'visual_profiles',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      profiles: {
        type: 'array',
        description: '每张参考图的结构化视觉档案',
        items: {
          type: 'object',
          properties: {
            subject: { type: 'string' },
            subjectCategory: { type: 'string' },
            style: { type: 'string' },
            composition: { type: 'string' },
            color: { type: 'string' },
            scene: { type: 'string' },
            lighting: { type: 'string' },
            material: { type: 'string' },
            mood: { type: 'string' },
            textElements: { type: 'array', items: { type: 'string' } },
            coreVisualMechanism: { type: 'string' },
            derivableDimensions: { type: 'array', items: { type: 'string' } },
            lockedFacts: { type: 'array', items: { type: 'string' } },
          },
          required: [
            'subject',
            'subjectCategory',
            'style',
            'composition',
            'color',
            'scene',
            'lighting',
            'material',
            'mood',
            'textElements',
            'coreVisualMechanism',
            'derivableDimensions',
            'lockedFacts',
          ],
          additionalProperties: false,
        },
      },
    },
    required: ['profiles'],
    additionalProperties: false,
  },
} as const

async function requestModelJson(options: {
  settings: AppSettings
  profile: ApiProfile
  instructions: string
  userContent: unknown
  responseFormat: typeof VISUAL_PROFILE_TEXT_FORMAT | typeof VARIABLE_PROMPT_GENERATION_TEXT_FORMAT
  signal?: AbortSignal
}): Promise<string> {
  const { settings, profile, instructions, userContent, responseFormat, signal } = options
  const proxy = readClientDevProxyConfig()
  const useChatCompletions = settings.agentTextProtocol === 'chat-completions'
  const url = buildApiUrl(
    profile.baseUrl,
    useChatCompletions ? 'chat/completions' : 'responses',
    proxy,
    shouldUseApiProxy(profile.apiProxy, proxy),
  )
  const send = (useStructuredOutput: boolean) => {
    const body = useChatCompletions
      ? {
          model: profile.model || settings.model,
          messages: [
            { role: 'system', content: instructions },
            {
              role: 'user',
              // chat 协议：content 数组需用 text/image_url 类型（responses 的 input_text/input_image 不兼容）
              content: Array.isArray(userContent)
                ? toChatCompletionsMessageContent(userContent as Array<Record<string, string>>)
                : typeof userContent === 'string'
                  ? userContent
                  : JSON.stringify(userContent),
            },
          ],
          max_tokens: 12000,
          ...(useStructuredOutput
            ? {
                response_format: {
                  type: 'json_schema',
                  json_schema: { name: responseFormat.name, strict: true, schema: responseFormat.schema },
                },
              }
            : {}),
        }
      : {
          model: profile.model || settings.model,
          instructions,
          // responses 协议：input 必须是 [{role, content}]，content 内才是多模态数组/字符串
          input: [{ role: 'user', content: userContent as string | Array<Record<string, unknown>> }],
          max_output_tokens: 12000,
          ...(useStructuredOutput ? { text: { format: responseFormat } } : {}),
        }
    return fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${profile.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal,
      cache: 'no-store',
      body: JSON.stringify(body),
    })
  }

  let structuredOutputEnabled = true
  let response = await send(structuredOutputEnabled)
  if (!response.ok && (response.status === 400 || response.status === 422)) {
    structuredOutputEnabled = false
    response = await send(false)
  }
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`模型请求失败（${response.status}）：${body.slice(0, 180)}`)
  }
  const payload = (await response.json()) as unknown
  return useChatCompletions ? extractChatCompletionsText(payload) : extractResponseText(payload)
}

/**
 * 两阶段变量提示词生成：一键衍生专用。
 * 阶段一：参考图 → 结构化视觉档案（事实，不偷懒）
 * 阶段二：档案摘要 + 维度策略 → 变量模板，质量校验不合格自动重试一次
 */
export async function generateVariablePromptTwoPhase(
  description: string,
  referenceImages: Array<{ name: string; dataUrl: string }>,
  options: {
    excludeText?: boolean
    dimensionPolicyInstruction?: string
    copyModeInstruction?: string
    metaInstruction?: string
    onProgress?: (stage: string, message: string) => void
    signal?: AbortSignal
  } = {},
): Promise<GeneratedSop> {
  const settings = useStore.getState().settings
  const profile = getAgentTextApiProfile(settings)
  const validationError = validateApiProfile(profile)
  if (validationError || profile.provider !== 'openai') {
    const message = validationError
      ? `请先完善 Agent 配置：${validationError}`
      : '两阶段衍生需要管理员配置 OpenAI 兼容的 Agent 文本模型'
    throw new Error(message)
  }
  if (referenceImages.length === 0) throw new Error('两阶段衍生至少需要一张参考图片')

  const brief = description.trim()
  const imageContent: Array<Record<string, string>> = [
    { type: 'input_text', text: brief ? `用户补充需求：\n${brief}` : '未提供补充需求，请完全依据参考图分析。' },
  ]
  referenceImages.forEach((image, index) => {
    imageContent.push({ type: 'input_text', text: `参考图 ${index + 1}/${referenceImages.length}：${image.name}` })
    imageContent.push({ type: 'input_image', image_url: image.dataUrl })
  })

  options.onProgress?.('analyze', `正在逐张分析 ${referenceImages.length} 张参考图…`)
  const profileText = await requestModelJson({
    settings,
    profile,
    instructions: VISUAL_PROFILE_INSTRUCTION,
    userContent: imageContent,
    responseFormat: VISUAL_PROFILE_TEXT_FORMAT,
    signal: options.signal,
  })

  options.onProgress?.('summarize', '正在整理视觉档案…')
  const profiles = parseVisualProfiles(profileText)
  const profileSummary = buildProfileSummary(profiles)

  const baseInstruction =
    options.metaInstruction ?? (options.excludeText ? IMAGE_GENERATION_STRATEGY_SKILL_META_INSTRUCTION : '')
  const isCopyDeriveMode = !options.excludeText && /文案也参与衍生/.test(options.copyModeInstruction ?? '')
  const instructions = [
    isCopyDeriveMode
      ? '你是「带文案变量提示词生成器」。根据参考图视觉档案，生成可直接解析执行的变量提示词模板，模板必须同时包含视觉变量与文案变量。'
      : baseInstruction || '你是变量提示词模板生成器。根据参考图视觉档案，生成可直接解析执行的变量提示词模板。',
    '应用只接收 name、description、variablePrompt 三个字段。variablePrompt 必须是可直接拆解生图的完整模板：正文使用 {{变量名}} 占位，正文后空一行写“可变项：”，每个变量单独一行，格式为 {{变量名}}：选项A / 选项B / 选项C。',
    options.excludeText === false && !options.metaInstruction ? KEEP_TEXT_SKILL_INSTRUCTION : '',
    options.excludeText ? EXCLUDE_TEXT_SKILL_INSTRUCTION : '',
    options.dimensionPolicyInstruction ?? '',
    options.copyModeInstruction ?? '',
    isCopyDeriveMode
      ? '本模式为「文案也衍生」：视觉档案中的「画面文字」是必须衍生的素材，不是锁定事实。正文中不得写死任何文案，所有文字内容必须出现在可变项中。'
      : '以下视觉档案是对参考图的客观分析。模板必须忠于档案中的事实：锁定事实不得改变；可衍生维度必须来自档案列出的维度；不要编造档案中没有的视觉元素。',
    '',
    '视觉档案：',
    profileSummary,
  ]
    .filter(Boolean)
    .join('\n\n')

  options.onProgress?.('generate', '正在基于视觉档案生成变量提示词模板…')
  const generateOnce = async (retryHint: string): Promise<GeneratedSop> => {
    // 维度策略与文案模式放用户消息：贴近请求，模型必须回应而非忽略系统指令
    const userInstructions = [
      options.dimensionPolicyInstruction
        ? `【衍生维度策略（必须严格遵守）】\n${options.dimensionPolicyInstruction}`
        : '',
      options.copyModeInstruction ? `【文案处理】\n${options.copyModeInstruction}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
    const text = await requestModelJson({
      settings,
      profile,
      instructions: `${instructions}\n\n${retryHint}`,
      userContent: [
        {
          type: 'input_text',
          text: [
            '根据以下视觉档案生成变量提示词模板。',
            userInstructions,
            '',
            '【参考图视觉档案】',
            profileSummary,
            '',
            '输出要求：每个「大改」维度的选项必须跨越语义层级（换主体类别/风格流派/场景类型），禁止同义改写；每个变量至少 8 个选项。',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      responseFormat: VARIABLE_PROMPT_GENERATION_TEXT_FORMAT,
      signal: options.signal,
    })
    return parseGeneratedVariablePrompt(text)
  }

  const generated = await generateOnce('')
  // 质量校验：不合格自动重试一次（携带问题说明）
  const parsed = parseVariablePrompt(generated.sop)
  if (parsed.enabled && options.dimensionPolicyInstruction) {
    const policy = parsePolicyFromInstruction(options.dimensionPolicyInstruction)
    if (policy) {
      const issues = validateVariablePromptTemplate(parsed.body, parsed.variables, policy)
      if (issues.length > 0) {
        options.onProgress?.('validate', `模板质量校验未通过（${issues[0]}），正在重新生成…`)
        const retried = await generateOnce(`上一轮模板存在质量问题：\n- ${issues.join('\n- ')}\n请修正后重新完整生成。`)
        const retriedParsed = parseVariablePrompt(retried.sop)
        if (retriedParsed.enabled) {
          const retriedIssues = validateVariablePromptTemplate(retriedParsed.body, retriedParsed.variables, policy)
          if (retriedIssues.length === 0) return retried
          options.onProgress?.('validate', `重新生成仍存在质量问题：${retriedIssues[0]}`)
        }
      }
    }
  }
  return generated
}

/** 从维度策略指令反解出策略对象（用于质量校验）；解析失败返回 null。 */
function parsePolicyFromInstruction(instruction: string): DeriveDimensionPolicy | null {
  const policy: Partial<DeriveDimensionPolicy> = {}
  for (const dimension of DERIVE_DIMENSIONS) {
    const match = instruction.match(new RegExp(`- ${dimension}：\\s*(锁定|微调|大改)`))
    if (!match) return null
    policy[dimension] = match[1] === '锁定' ? 'lock' : match[1] === '大改' ? 'change' : 'tweak'
  }
  if (DERIVE_DIMENSIONS.some((dimension) => !policy[dimension])) return null
  return policy as DeriveDimensionPolicy
}
