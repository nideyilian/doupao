import type {
  ApiMode,
  AgentApiConfigMode,
  AgentTextProtocol,
  ApiTransportMode,
  ApiProfile,
  ApiProvider,
  AppSettings,
  CustomProviderContentType,
  CustomProviderDefinition,
  CustomProviderFileMapping,
  CustomProviderPollMapping,
  CustomProviderRequestMethod,
  CustomProviderResultMapping,
  CustomProviderSubmitMapping,
  CustomProviderTemplate,
  ReferenceImageEditAction,
  WordLibraryDerivativeRule,
  ImageSaveLayout,
} from '../types'
import type { AssistantActionPreferences } from '../features/assistantActions/types'
import { normalizeThemeMode, normalizeSkinId } from './theme'
import {
  DEFAULT_AGENT_MAX_TOOL_ROUNDS,
  DEFAULT_STREAM_PARTIAL_IMAGES,
  DEFAULT_WORD_LIBRARY_DERIVATIVE_RULE,
  DEFAULT_ZIP_DOWNLOAD_ROUTES,
  ZIP_DOWNLOAD_ROUTE_VALUES,
} from '../types'
import { normalizeAssistantActionPreferences } from '../features/assistantActions/matcher'
import { shouldUseApiProxy } from './devProxy'
import { readRuntimeEnv } from './runtimeEnv'
import { isImportableConfigUrl } from './customProviderConfigUrl'
import { normalizeAdNegativeRuleProfiles } from './adNegativeRules'

const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const RAW_DEFAULT_API_URL = readRuntimeEnv(import.meta.env.VITE_DEFAULT_API_URL)
const DEFAULT_OPENAI_API_PROXY = readRuntimeEnv(import.meta.env.VITE_API_PROXY_AVAILABLE) === 'true'
const DOCKER_DEPLOYMENT = readRuntimeEnv(import.meta.env.VITE_DOCKER_DEPLOYMENT) === 'true'
const DEFAULT_BASE_URL = isImportableConfigUrl(RAW_DEFAULT_API_URL)
  ? ''
  : RAW_DEFAULT_API_URL || (DOCKER_DEPLOYMENT && DEFAULT_OPENAI_API_PROXY ? '' : OPENAI_DEFAULT_BASE_URL)
export const DEFAULT_IMAGES_MODEL = 'gpt-image-2'
export const DEFAULT_RESPONSES_MODEL = 'gpt-5.5'
export const DEFAULT_FAL_BASE_URL = 'https://fal.run'
export const DEFAULT_FAL_MODEL = 'openai/gpt-image-2'

export function isGeminiModel(model: string): boolean {
  return model.trim().toLowerCase().includes('gemini')
}

export function getAgentTextProtocol(
  settings: Partial<AppSettings> | unknown,
  profile?: Pick<ApiProfile, 'model'>,
): AgentTextProtocol {
  if (profile && isGeminiModel(profile.model)) return 'chat-completions'
  return normalizeSettings(settings).agentTextProtocol
}
export const DEFAULT_OPENAI_PROFILE_ID = 'default-openai'
export const DEFAULT_API_TIMEOUT = 600

const BUILT_IN_PROVIDER_IDS = new Set<ApiProvider>(['openai', 'fal'])
const DEFAULT_CUSTOM_PROVIDER_PATHS = {
  generationPath: 'images/generations',
  editPath: 'images/edits',
  taskPath: 'images/tasks/{task_id}',
}
const DEFAULT_GENERATE_BODY = {
  model: '$profile.model',
  prompt: '$prompt',
  size: '$params.size',
  quality: '$params.quality',
  output_format: '$params.output_format',
  moderation: '$params.moderation',
  output_compression: '$params.output_compression',
  n: '$params.n',
}
const DEFAULT_EDIT_BODY = DEFAULT_GENERATE_BODY
const DEFAULT_OPENAI_RESULT: CustomProviderResultMapping = {
  imageUrlPaths: ['data.*.url'],
  b64JsonPaths: ['data.*.b64_json'],
}
const DEFAULT_EDIT_FILES: CustomProviderFileMapping[] = [
  { field: 'image[]', source: 'inputImages', array: true },
  { field: 'mask', source: 'mask' },
]

type ApiProfileProviderDraft = NonNullable<ApiProfile['providerDrafts']>[ApiProvider]

export const DEFAULT_MAX_CONCURRENT = 5
export const DEFAULT_MAX_RETRIES = 3
export const API_IMAGES_MODE_MAX_N = 10

export function getApiMaxN(profile: ApiProfile): number {
  if (profile.provider === 'fal') return 4
  if (profile.apiMode === 'responses') return 1
  // DALL-E 3 only supports n=1
  if (profile.model.toLowerCase().includes('dall-e-3')) return 1
  // For other OpenAI compatible models, we default to 1 because many proxies silently drop n>1
  // If we want to allow more, we could make it configurable, but 1 is safest.
  if (profile.provider === 'openai') return 1
  return 1
}

export function normalizeMaxConcurrent(value: unknown, fallback: number | undefined = DEFAULT_MAX_CONCURRENT): number {
  const fallbackValue = fallback ?? DEFAULT_MAX_CONCURRENT
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallbackValue
  return Math.min(999, Math.max(1, Math.trunc(numeric)))
}

export function normalizeMaxRetries(value: unknown, fallback: number | undefined = DEFAULT_MAX_RETRIES): number {
  const fallbackValue = fallback ?? DEFAULT_MAX_RETRIES
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallbackValue
  return Math.min(10, Math.max(0, Math.trunc(numeric)))
}

export function normalizeStreamPartialImages(
  value: unknown,
  fallback: number | undefined = DEFAULT_STREAM_PARTIAL_IMAGES,
): number {
  const fallbackValue = fallback ?? DEFAULT_STREAM_PARTIAL_IMAGES
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallbackValue
  return Math.min(3, Math.max(0, Math.trunc(numeric)))
}

export function normalizeAgentMaxToolRounds(
  value: unknown,
  fallback: number | undefined = DEFAULT_AGENT_MAX_TOOL_ROUNDS,
): number {
  const fallbackValue = fallback ?? DEFAULT_AGENT_MAX_TOOL_ROUNDS
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallbackValue
  return Math.min(50, Math.max(1, Math.trunc(numeric)))
}

function normalizeReferenceImageEditAction(value: unknown): ReferenceImageEditAction {
  return value === 'replace-reference' || value === 'add-mask' ? value : 'ask'
}

function normalizeAgentApiConfigMode(value: unknown): AgentApiConfigMode {
  return value === 'hybrid' ? 'hybrid' : 'native'
}

function normalizeAgentTextProtocol(value: unknown): AgentTextProtocol {
  return value === 'chat-completions' ? 'chat-completions' : 'responses'
}

function normalizeApiTransportMode(value: unknown): ApiTransportMode {
  return value === 'renderer' ? 'renderer' : 'auto'
}

function normalizeImageSaveLayout(value: unknown): ImageSaveLayout {
  return value === 'batch-folder' ? 'batch-folder' : 'flat'
}

function normalizeZipDownloadRoutes(value: unknown) {
  if (!Array.isArray(value)) return [...DEFAULT_ZIP_DOWNLOAD_ROUTES]
  const allowed = new Set<string>(ZIP_DOWNLOAD_ROUTE_VALUES)
  return value.filter(
    (item): item is (typeof ZIP_DOWNLOAD_ROUTE_VALUES)[number] => typeof item === 'string' && allowed.has(item),
  )
}

function isCustomProviderTemplate(value: unknown): value is CustomProviderTemplate {
  return value === 'http-image'
}

function normalizeProviderPath(value: unknown, fallback: string): string {
  return (typeof value === 'string' && value.trim() ? value : fallback).trim().replace(/^\/+/, '').replace(/^v1\//, '')
}

function normalizeStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object') return undefined

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(
      (entry): entry is [string, string | number | boolean] =>
        typeof entry[0] === 'string' && ['string', 'number', 'boolean'].includes(typeof entry[1]),
    )
    .map(([key, item]) => [key, String(item)] as const)

  return entries.length ? Object.fromEntries(entries) : undefined
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
        .map((item) => item.trim())
    : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeDerivativeRuleMode(value: unknown): AppSettings['wordLibraryDerivativeRuleMode'] {
  return value === 'multiple' ? 'multiple' : 'single'
}

function createDefaultDerivativeRule(enabled = true): WordLibraryDerivativeRule {
  return {
    id: 'default',
    name: '默认规则',
    content: DEFAULT_WORD_LIBRARY_DERIVATIVE_RULE,
    enabled,
    builtIn: true,
  }
}

function normalizeDerivativeRules(
  record: Record<string, unknown>,
  mode: AppSettings['wordLibraryDerivativeRuleMode'],
): WordLibraryDerivativeRule[] {
  const rules: WordLibraryDerivativeRule[] = []
  const rawRules = Array.isArray(record.wordLibraryDerivativeRules) ? record.wordLibraryDerivativeRules : []

  for (const item of rawRules) {
    if (!isRecord(item)) continue
    const content = typeof item.content === 'string' ? item.content : ''
    const rawId = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `rule-${rules.length + 1}`
    const builtIn = item.builtIn === true || rawId === 'default'
    rules.push({
      id: builtIn ? 'default' : rawId,
      name: typeof item.name === 'string' ? item.name : builtIn ? '默认规则' : '自定义规则',
      content: builtIn ? DEFAULT_WORD_LIBRARY_DERIVATIVE_RULE : content,
      enabled: typeof item.enabled === 'boolean' ? item.enabled : rules.length === 0,
      ...(builtIn ? { builtIn: true } : {}),
    })
  }

  if (!rules.some((rule) => rule.id === 'default')) {
    const legacyRule =
      typeof record.wordLibraryDerivativeRule === 'string' ? record.wordLibraryDerivativeRule.trim() : ''
    const hasLegacyCustom = Boolean(legacyRule && legacyRule !== DEFAULT_WORD_LIBRARY_DERIVATIVE_RULE)
    rules.unshift(createDefaultDerivativeRule(!hasLegacyCustom))
    if (hasLegacyCustom) {
      rules.push({
        id: 'custom-legacy',
        name: '自定义规则',
        content: legacyRule,
        enabled: true,
      })
    }
  }

  const uniqueRules = rules.filter((rule, index, list) => list.findIndex((item) => item.id === rule.id) === index)
  if (mode === 'multiple') return uniqueRules.length ? uniqueRules : [createDefaultDerivativeRule(true)]

  let enabledSeen = false
  const normalized = uniqueRules.map((rule) => {
    const enabled = rule.enabled && !enabledSeen
    if (enabled) enabledSeen = true
    return { ...rule, enabled }
  })
  if (!enabledSeen && normalized[0]) normalized[0] = { ...normalized[0], enabled: true }
  return normalized.length ? normalized : [createDefaultDerivativeRule(true)]
}

function normalizeRequestMethod(
  value: unknown,
  fallback: CustomProviderRequestMethod = 'POST',
): CustomProviderRequestMethod {
  return value === 'GET' || value === 'POST' ? value : fallback
}

function normalizeContentType(value: unknown, fallback: CustomProviderContentType = 'json'): CustomProviderContentType {
  return value === 'multipart' ? 'multipart' : fallback
}

function normalizeBodyTemplate(value: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
  return isRecord(value) ? value : fallback
}

function normalizeFileMappings(
  value: unknown,
  fallback: CustomProviderFileMapping[] = [],
): CustomProviderFileMapping[] {
  if (!Array.isArray(value)) return fallback
  const files = value
    .map((item): CustomProviderFileMapping | null => {
      if (!isRecord(item) || typeof item.field !== 'string' || !item.field.trim()) return null
      if (item.source !== 'inputImages' && item.source !== 'mask') return null
      return {
        field: item.field.trim(),
        source: item.source,
        array: Boolean(item.array),
      }
    })
    .filter((item): item is CustomProviderFileMapping => Boolean(item))
  return files.length ? files : fallback
}

function normalizeResultMapping(
  value: unknown,
  fallback: CustomProviderResultMapping = DEFAULT_OPENAI_RESULT,
): CustomProviderResultMapping {
  const record = isRecord(value) ? value : {}
  const imageUrlPaths = normalizeStringArray(record.imageUrlPaths, fallback.imageUrlPaths ?? [])
  const b64JsonPaths = normalizeStringArray(record.b64JsonPaths, fallback.b64JsonPaths ?? [])
  return {
    imageUrlPaths,
    b64JsonPaths,
  }
}

function normalizeSubmitMapping(value: unknown, fallback: CustomProviderSubmitMapping): CustomProviderSubmitMapping {
  const record = isRecord(value) ? value : {}
  const contentType = normalizeContentType(record.contentType, fallback.contentType ?? 'json')
  return {
    path: normalizeProviderPath(record.path, fallback.path),
    method: normalizeRequestMethod(record.method, fallback.method ?? 'POST'),
    contentType,
    query: normalizeStringRecord(record.query) ?? fallback.query,
    body: normalizeBodyTemplate(
      record.body,
      fallback.body ?? (contentType === 'multipart' ? DEFAULT_EDIT_BODY : DEFAULT_GENERATE_BODY),
    ),
    files: contentType === 'multipart' ? normalizeFileMappings(record.files, fallback.files) : undefined,
    taskIdPath:
      typeof record.taskIdPath === 'string' && record.taskIdPath.trim()
        ? record.taskIdPath.trim()
        : fallback.taskIdPath,
    result: normalizeResultMapping(record.result, fallback.result ?? DEFAULT_OPENAI_RESULT),
  }
}

function normalizePollMapping(
  value: unknown,
  fallback?: CustomProviderPollMapping,
): CustomProviderPollMapping | undefined {
  if (!isRecord(value) && !fallback) return undefined
  const record = isRecord(value) ? value : {}
  const path = normalizeProviderPath(record.path, fallback?.path ?? DEFAULT_CUSTOM_PROVIDER_PATHS.taskPath)
  const statusPath =
    typeof record.statusPath === 'string' && record.statusPath.trim() ? record.statusPath.trim() : fallback?.statusPath
  if (!statusPath) return undefined

  return {
    path,
    method: normalizeRequestMethod(record.method, fallback?.method ?? 'GET'),
    query: normalizeStringRecord(record.query) ?? fallback?.query,
    intervalSeconds:
      typeof record.intervalSeconds === 'number' && Number.isFinite(record.intervalSeconds)
        ? Math.max(1, record.intervalSeconds)
        : (fallback?.intervalSeconds ?? 5),
    statusPath,
    successValues: normalizeStringArray(
      record.successValues,
      fallback?.successValues ?? ['SUCCESS', 'succeeded', 'completed', 'COMPLETED'],
    ),
    failureValues: normalizeStringArray(
      record.failureValues,
      fallback?.failureValues ?? ['FAILURE', 'failed', 'error', 'FAILED', 'cancelled'],
    ),
    errorPath:
      typeof record.errorPath === 'string' && record.errorPath.trim() ? record.errorPath.trim() : fallback?.errorPath,
    result: normalizeResultMapping(record.result, fallback?.result ?? DEFAULT_OPENAI_RESULT),
  }
}

function legacyCustomProviderToManifest(record: Record<string, unknown>): Record<string, unknown> | null {
  if (record.template !== 'openai-compatible' && record.template !== 'openai-compatible-async') return null
  const isAsync = record.template === 'openai-compatible-async'
  const taskResultPath =
    typeof record.taskResultPath === 'string' && record.taskResultPath.trim()
      ? record.taskResultPath.trim()
      : 'data.data'
  return {
    id: record.id,
    name: record.name,
    template: 'http-image',
    submit: {
      path: record.generationPath ?? DEFAULT_CUSTOM_PROVIDER_PATHS.generationPath,
      method: 'POST',
      contentType: 'json',
      query: isAsync ? (normalizeStringRecord(record.submitQuery) ?? { async: 'true' }) : undefined,
      body: DEFAULT_GENERATE_BODY,
      taskIdPath: isAsync ? (record.taskIdPath ?? 'data') : undefined,
      result: DEFAULT_OPENAI_RESULT,
    },
    editSubmit: {
      path: record.editPath ?? DEFAULT_CUSTOM_PROVIDER_PATHS.editPath,
      method: 'POST',
      contentType: 'multipart',
      query: isAsync ? (normalizeStringRecord(record.submitQuery) ?? { async: 'true' }) : undefined,
      body: DEFAULT_EDIT_BODY,
      files: DEFAULT_EDIT_FILES,
      taskIdPath: isAsync ? (record.taskIdPath ?? 'data') : undefined,
      result: DEFAULT_OPENAI_RESULT,
    },
    poll: isAsync
      ? {
          path: record.taskPath ?? DEFAULT_CUSTOM_PROVIDER_PATHS.taskPath,
          method: 'GET',
          statusPath: record.taskStatusPath ?? 'data.status',
          successValues: normalizeStringArray(record.taskSuccessValues, [
            'SUCCESS',
            'succeeded',
            'completed',
            'COMPLETED',
          ]),
          failureValues: normalizeStringArray(record.taskFailureValues, ['FAILURE', 'failed', 'error', 'FAILED']),
          errorPath: 'data.fail_reason',
          intervalSeconds: typeof record.pollIntervalSeconds === 'number' ? record.pollIntervalSeconds : 5,
          result: {
            imageUrlPaths: [`${taskResultPath}.data.*.url`],
            b64JsonPaths: [`${taskResultPath}.data.*.b64_json`],
          },
        }
      : undefined,
  }
}

function createCustomProviderId(name: string, usedIds: Set<string>): string {
  const slug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'custom'
  let id = `custom-${slug}`
  let index = 2
  while (usedIds.has(id) || BUILT_IN_PROVIDER_IDS.has(id)) {
    id = `custom-${slug}-${index}`
    index += 1
  }
  usedIds.add(id)
  return id
}

export function normalizeCustomProviderDefinition(
  input: unknown,
  usedIds = new Set<string>(),
): CustomProviderDefinition | null {
  if (!input || typeof input !== 'object') return null
  const rawRecord = input as Record<string, unknown>
  const record = legacyCustomProviderToManifest(rawRecord) ?? rawRecord
  const template =
    record.template == null ? 'http-image' : isCustomProviderTemplate(record.template) ? record.template : null
  if (!template || !isRecord(record.submit)) return null

  const rawName = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : '自定义服务商'
  const id =
    typeof record.id === 'string' &&
    record.id.trim() &&
    !BUILT_IN_PROVIDER_IDS.has(record.id.trim()) &&
    !usedIds.has(record.id.trim())
      ? record.id.trim()
      : createCustomProviderId(rawName, usedIds)
  usedIds.add(id)

  return {
    id,
    name: rawName,
    template,
    submit: normalizeSubmitMapping(record.submit, {
      path: DEFAULT_CUSTOM_PROVIDER_PATHS.generationPath,
      method: 'POST',
      contentType: 'json',
      body: DEFAULT_GENERATE_BODY,
      result: DEFAULT_OPENAI_RESULT,
    }),
    editSubmit: isRecord(record.editSubmit)
      ? normalizeSubmitMapping(record.editSubmit, {
          path: DEFAULT_CUSTOM_PROVIDER_PATHS.editPath,
          method: 'POST',
          contentType: 'multipart',
          body: DEFAULT_EDIT_BODY,
          files: DEFAULT_EDIT_FILES,
          result: DEFAULT_OPENAI_RESULT,
        })
      : undefined,
    poll: normalizePollMapping(record.poll),
  }
}

export function normalizeCustomProviderDefinitions(input: unknown): CustomProviderDefinition[] {
  const usedIds = new Set<string>()
  const list = Array.isArray(input) ? input : []
  return list
    .map((item) => normalizeCustomProviderDefinition(item, usedIds))
    .filter((item): item is CustomProviderDefinition => Boolean(item))
}

export function createDefaultOpenAIProfile(overrides: Partial<ApiProfile> = {}): ApiProfile {
  return {
    id: DEFAULT_OPENAI_PROFILE_ID,
    name: '默认',
    provider: 'openai',
    baseUrl: DEFAULT_BASE_URL,
    apiKey: '',
    model: DEFAULT_IMAGES_MODEL,
    timeout: DEFAULT_API_TIMEOUT,
    apiMode: 'images',
    codexCli: false,
    apiProxy: DEFAULT_OPENAI_API_PROXY,
    streamImages: true,
    streamPartialImages: DEFAULT_STREAM_PARTIAL_IMAGES,
    maxConcurrent: DEFAULT_MAX_CONCURRENT,
    maxRetries: DEFAULT_MAX_RETRIES,
    ...overrides,
  }
}

export function createDefaultFalProfile(overrides: Partial<ApiProfile> = {}): ApiProfile {
  return {
    id: `fal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: '新配置',
    provider: 'fal',
    baseUrl: DEFAULT_FAL_BASE_URL,
    apiKey: '',
    model: DEFAULT_FAL_MODEL,
    timeout: DEFAULT_API_TIMEOUT,
    apiMode: 'images',
    codexCli: false,
    apiProxy: false,
    streamImages: false,
    streamPartialImages: DEFAULT_STREAM_PARTIAL_IMAGES,
    maxConcurrent: DEFAULT_MAX_CONCURRENT,
    maxRetries: DEFAULT_MAX_RETRIES,
    ...overrides,
  }
}

export function createDefaultAgentProfile(overrides: Partial<ApiProfile> = {}): ApiProfile {
  return createDefaultOpenAIProfile({
    id: 'agent-default',
    name: 'Agent 默认',
    model: DEFAULT_RESPONSES_MODEL,
    apiMode: 'responses',
    ...overrides,
  })
}

export function switchApiProfileProvider(
  profile: ApiProfile,
  provider: ApiProvider,
  customProvider?: CustomProviderDefinition,
): ApiProfile {
  const providerDrafts = {
    ...profile.providerDrafts,
    [profile.provider]: {
      baseUrl: profile.baseUrl,
      model: profile.model,
      apiMode: profile.apiMode,
      codexCli: profile.codexCli,
      apiProxy: profile.apiProxy,
      responseFormatB64Json: profile.responseFormatB64Json,
      streamImages: profile.streamImages,
      streamPartialImages: profile.streamPartialImages,
      maxConcurrent: profile.maxConcurrent,
      maxRetries: profile.maxRetries,
    },
  }
  const savedDraft = providerDrafts[provider]

  if (provider === 'fal') {
    return {
      ...profile,
      provider,
      baseUrl: savedDraft?.baseUrl ?? DEFAULT_FAL_BASE_URL,
      model: savedDraft?.model ?? DEFAULT_FAL_MODEL,
      apiMode: savedDraft?.apiMode ?? 'images',
      codexCli: false,
      apiProxy: false,
      responseFormatB64Json: savedDraft?.responseFormatB64Json,
      streamImages: false,
      streamPartialImages: savedDraft?.streamPartialImages ?? DEFAULT_STREAM_PARTIAL_IMAGES,
      maxConcurrent: savedDraft?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
      maxRetries: savedDraft?.maxRetries ?? DEFAULT_MAX_RETRIES,
      providerDrafts,
    }
  }

  if (customProvider) {
    const shouldUseOpenAIDefaults = profile.provider === 'fal'
    return {
      ...profile,
      provider: customProvider.id,
      baseUrl:
        savedDraft?.baseUrl ?? (shouldUseOpenAIDefaults ? DEFAULT_BASE_URL : profile.baseUrl || DEFAULT_BASE_URL),
      model:
        savedDraft?.model ?? (shouldUseOpenAIDefaults ? DEFAULT_IMAGES_MODEL : profile.model || DEFAULT_IMAGES_MODEL),
      apiMode: savedDraft?.apiMode ?? 'images',
      codexCli: false,
      apiProxy: false,
      responseFormatB64Json: savedDraft?.responseFormatB64Json,
      streamImages: false,
      streamPartialImages: savedDraft?.streamPartialImages ?? DEFAULT_STREAM_PARTIAL_IMAGES,
      maxConcurrent: savedDraft?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
      maxRetries: savedDraft?.maxRetries ?? DEFAULT_MAX_RETRIES,
      providerDrafts,
    }
  }

  return {
    ...profile,
    provider,
    baseUrl: savedDraft?.baseUrl ?? DEFAULT_BASE_URL,
    model: savedDraft?.model ?? DEFAULT_IMAGES_MODEL,
    apiMode: savedDraft?.apiMode ?? profile.apiMode,
    codexCli: savedDraft?.codexCli ?? profile.codexCli,
    apiProxy: savedDraft?.apiProxy ?? DEFAULT_OPENAI_API_PROXY,
    responseFormatB64Json: savedDraft?.responseFormatB64Json,
    streamImages: savedDraft?.streamImages ?? (profile.provider === 'openai' ? profile.streamImages : true),
    streamPartialImages:
      savedDraft?.streamPartialImages ??
      (profile.provider === 'openai' ? profile.streamPartialImages : DEFAULT_STREAM_PARTIAL_IMAGES),
    maxConcurrent: savedDraft?.maxConcurrent ?? profile.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
    maxRetries: savedDraft?.maxRetries ?? profile.maxRetries ?? DEFAULT_MAX_RETRIES,
    providerDrafts,
  }
}

function normalizeProviderDraft(
  input: unknown,
  provider: ApiProvider,
  customProviderIds: Set<string>,
): ApiProfileProviderDraft {
  if (!isRecord(input)) return undefined
  const fallback = provider === 'fal' ? createDefaultFalProfile() : createDefaultOpenAIProfile()
  const baseUrl = typeof input.baseUrl === 'string' ? input.baseUrl : undefined
  const model = typeof input.model === 'string' && input.model.trim() ? input.model : undefined
  const apiMode = input.apiMode === 'responses' ? 'responses' : input.apiMode === 'images' ? 'images' : undefined
  const knownProvider = provider === 'fal' || provider === 'openai' || customProviderIds.has(provider)
  if (!knownProvider) return undefined

  return {
    baseUrl: provider === 'fal' ? baseUrl?.trim().replace(/\/+$/, '') || DEFAULT_FAL_BASE_URL : baseUrl,
    model,
    apiMode,
    codexCli: typeof input.codexCli === 'boolean' ? input.codexCli : fallback.codexCli,
    apiProxy: typeof input.apiProxy === 'boolean' ? input.apiProxy : fallback.apiProxy,
    responseFormatB64Json: input.responseFormatB64Json === true ? true : undefined,
    streamImages: typeof input.streamImages === 'boolean' ? input.streamImages : fallback.streamImages,
    streamPartialImages: normalizeStreamPartialImages(input.streamPartialImages, fallback.streamPartialImages),
    maxConcurrent: normalizeMaxConcurrent(input.maxConcurrent, fallback.maxConcurrent),
    maxRetries: normalizeMaxRetries(input.maxRetries, fallback.maxRetries),
  }
}

function normalizeProviderDrafts(input: unknown, customProviderIds: Set<string>): ApiProfile['providerDrafts'] {
  if (!isRecord(input)) return undefined
  const entries = Object.entries(input)
    .map(([provider, draft]) => [provider, normalizeProviderDraft(draft, provider, customProviderIds)] as const)
    .filter((entry): entry is [ApiProvider, NonNullable<ApiProfileProviderDraft>] => Boolean(entry[1]))

  return entries.length ? Object.fromEntries(entries) : undefined
}

export function normalizeApiProfile(
  input: unknown,
  fallback?: Partial<ApiProfile>,
  customProviderIds = new Set<string>(),
): ApiProfile {
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const rawProvider = typeof record.provider === 'string' ? record.provider : ''
  const provider: ApiProvider = rawProvider === 'fal' || customProviderIds.has(rawProvider) ? rawProvider : 'openai'
  const defaults = provider === 'fal' ? createDefaultFalProfile(fallback) : createDefaultOpenAIProfile(fallback)
  const apiMode: ApiMode =
    record.apiMode === 'responses' ? 'responses' : record.apiMode === 'images' ? 'images' : defaults.apiMode
  const rawBaseUrl = typeof record.baseUrl === 'string' ? record.baseUrl : defaults.baseUrl

  return {
    ...defaults,
    id: typeof record.id === 'string' && record.id.trim() ? record.id : defaults.id,
    name: typeof record.name === 'string' && record.name.trim() ? record.name : defaults.name,
    provider,
    baseUrl: provider === 'fal' ? rawBaseUrl.trim().replace(/\/+$/, '') || DEFAULT_FAL_BASE_URL : rawBaseUrl,
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : defaults.apiKey,
    model: typeof record.model === 'string' && record.model.trim() ? record.model : defaults.model,
    timeout: typeof record.timeout === 'number' && Number.isFinite(record.timeout) ? record.timeout : defaults.timeout,
    apiMode,
    codexCli: Boolean(record.codexCli),
    apiProxy: typeof record.apiProxy === 'boolean' ? record.apiProxy : defaults.apiProxy,
    responseFormatB64Json: record.responseFormatB64Json === true ? true : undefined,
    streamImages: typeof record.streamImages === 'boolean' ? record.streamImages : defaults.streamImages,
    streamPartialImages: normalizeStreamPartialImages(record.streamPartialImages, defaults.streamPartialImages),
    maxConcurrent: normalizeMaxConcurrent(record.maxConcurrent, defaults.maxConcurrent),
    maxRetries: normalizeMaxRetries(record.maxRetries, defaults.maxRetries),
    providerDrafts: normalizeProviderDrafts(record.providerDrafts, customProviderIds),
  }
}

function validateImportedProfileRecord(input: unknown) {
  if (!isRecord(input)) return

  const baseUrl = typeof input.baseUrl === 'string' ? input.baseUrl.trim() : ''
  if (baseUrl && (baseUrl.startsWith('[') || baseUrl.includes(']('))) {
    throw new Error('JSON 包含 Markdown 链接，请粘贴纯文本')
  }

  if (typeof input.apiMode === 'string' && input.apiMode !== 'images' && input.apiMode !== 'responses') {
    throw new Error('apiMode 格式无效，应为 images 或 responses')
  }
}

export function normalizeSettings(input: Partial<AppSettings> | unknown): AppSettings {
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const customProviders = normalizeCustomProviderDefinitions(record.customProviders)
  const customProviderIds = new Set(customProviders.map((provider) => provider.id))
  const legacyProfile = createDefaultOpenAIProfile({
    baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : DEFAULT_BASE_URL,
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : '',
    model: typeof record.model === 'string' && record.model.trim() ? record.model : DEFAULT_IMAGES_MODEL,
    timeout:
      typeof record.timeout === 'number' && Number.isFinite(record.timeout) ? record.timeout : DEFAULT_API_TIMEOUT,
    apiMode: record.apiMode === 'responses' ? 'responses' : 'images',
    codexCli: Boolean(record.codexCli),
    apiProxy: typeof record.apiProxy === 'boolean' ? record.apiProxy : DEFAULT_OPENAI_API_PROXY,
    responseFormatB64Json: record.responseFormatB64Json === true ? true : undefined,
    streamImages: typeof record.streamImages === 'boolean' ? record.streamImages : true,
    streamPartialImages: normalizeStreamPartialImages(record.streamPartialImages),
    maxConcurrent: normalizeMaxConcurrent(record.maxConcurrent),
    maxRetries: normalizeMaxRetries(record.maxRetries),
  })
  const profiles =
    Array.isArray(record.profiles) && record.profiles.length
      ? record.profiles.map((profile) => normalizeApiProfile(profile, undefined, customProviderIds))
      : [legacyProfile]
  const activeProfileId =
    typeof record.activeProfileId === 'string' && profiles.some((p) => p.id === record.activeProfileId)
      ? record.activeProfileId
      : profiles[0].id
  const active = profiles.find((p) => p.id === activeProfileId) ?? profiles[0]
  const legacyAgentProfile =
    typeof record.agentProfileId === 'string'
      ? profiles.find((profile) => profile.id === record.agentProfileId)
      : undefined
  const hasExplicitAgentSharing = typeof record.agentShareApiParameters === 'boolean'
  const legacyAgentUsesCustomProfile = typeof record.agentUseCustomProfile === 'boolean' && record.agentUseCustomProfile
  const agentShareApiParameters = hasExplicitAgentSharing
    ? Boolean(record.agentShareApiParameters)
    : !legacyAgentUsesCustomProfile && !legacyAgentProfile
  const rawAgentProfile = isRecord(record.agentProfile) ? record.agentProfile : {}
  const migrateLegacySharedDefault =
    agentShareApiParameters &&
    !hasExplicitAgentSharing &&
    (!rawAgentProfile.model || rawAgentProfile.model === DEFAULT_IMAGES_MODEL) &&
    (!rawAgentProfile.apiMode || rawAgentProfile.apiMode === 'images')
  const agentProfileSource =
    legacyAgentProfile && !hasExplicitAgentSharing
      ? legacyAgentProfile
      : migrateLegacySharedDefault
        ? {}
        : rawAgentProfile
  const normalizeAgentProfileItem = (input: unknown): ApiProfile => ({
    ...normalizeApiProfile(input, createDefaultAgentProfile(), customProviderIds),
    apiMode: 'responses',
  })
  const rawAgentProfiles = Array.isArray(record.agentProfiles) ? record.agentProfiles : []
  const agentProfiles = (rawAgentProfiles.length > 0 ? rawAgentProfiles : [agentProfileSource]).map(
    normalizeAgentProfileItem,
  )
  const activeAgentProfileId =
    typeof record.activeAgentProfileId === 'string' &&
    agentProfiles.some((profile) => profile.id === record.activeAgentProfileId)
      ? record.activeAgentProfileId
      : (agentProfiles[0]?.id ?? createDefaultAgentProfile().id)
  const activeAgentProfile = agentProfiles.find((profile) => profile.id === activeAgentProfileId) ?? agentProfiles[0]
  const configuredAgentApiConfigMode = normalizeAgentApiConfigMode(record.agentApiConfigMode)
  const configuredAgentTextProtocol = normalizeAgentTextProtocol(record.agentTextProtocol)
  const geminiAgent = isGeminiModel(activeAgentProfile.model)
  const wordLibraryDerivativeRuleMode = normalizeDerivativeRuleMode(record.wordLibraryDerivativeRuleMode)
  const wordLibraryDerivativeRules = normalizeDerivativeRules(record, wordLibraryDerivativeRuleMode)
  const adNegativeRuleProfiles = normalizeAdNegativeRuleProfiles(record.adNegativeRuleProfiles)

  return {
    themeMode: normalizeThemeMode(record.themeMode),
    // skinId 为正式字段；旧字段 colorScheme 仅在导入/迁移边界兼容
    skinId: normalizeSkinId(record.skinId ?? record.colorScheme),
    baseUrl: active.baseUrl,
    apiKey: active.apiKey,
    model: active.model,
    timeout: active.timeout,
    apiMode: active.apiMode,
    codexCli: active.codexCli,
    apiProxy: active.apiProxy,
    apiTransportMode: normalizeApiTransportMode(record.apiTransportMode),
    streamImages: active.streamImages,
    streamPartialImages: active.streamPartialImages,
    customProviders,
    providerOrder: Array.isArray(record.providerOrder) ? record.providerOrder.map(String) : undefined,
    clearInputAfterSubmit: typeof record.clearInputAfterSubmit === 'boolean' ? record.clearInputAfterSubmit : false,
    persistInputOnRestart: typeof record.persistInputOnRestart === 'boolean' ? record.persistInputOnRestart : true,
    reuseTaskApiProfileTemporarily:
      typeof record.reuseTaskApiProfileTemporarily === 'boolean' ? record.reuseTaskApiProfileTemporarily : false,
    alwaysShowRetryButton: typeof record.alwaysShowRetryButton === 'boolean' ? record.alwaysShowRetryButton : false,
    taskCompletionNotification:
      typeof record.taskCompletionNotification === 'boolean' ? record.taskCompletionNotification : false,
    enterSubmit: typeof record.enterSubmit === 'boolean' ? record.enterSubmit : false,
    referenceImageEditAction: normalizeReferenceImageEditAction(record.referenceImageEditAction),
    zipDownloadRoutes: normalizeZipDownloadRoutes(record.zipDownloadRoutes),
    imageSaveLayout: normalizeImageSaveLayout(record.imageSaveLayout),
    imageFilenameDatePrefix:
      typeof record.imageFilenameDatePrefix === 'boolean' ? record.imageFilenameDatePrefix : true,
    imageFilenameUsePrompt: typeof record.imageFilenameUsePrompt === 'boolean' ? record.imageFilenameUsePrompt : false,
    agentScrollToBottomAfterSubmit:
      typeof record.agentScrollToBottomAfterSubmit === 'boolean' ? record.agentScrollToBottomAfterSubmit : true,
    agentMaxToolRounds: normalizeAgentMaxToolRounds(record.agentMaxToolRounds),
    agentWebSearch: typeof record.agentWebSearch === 'boolean' ? record.agentWebSearch : false,
    // Gemini 的 OpenAI 兼容中转通常只提供 Chat Completions；自动切换，免得用户手动理解协议差异。
    agentApiConfigMode: geminiAgent ? 'hybrid' : configuredAgentApiConfigMode,
    agentTextProtocol: geminiAgent ? 'chat-completions' : configuredAgentTextProtocol,
    allowPromptRewrite: typeof record.allowPromptRewrite === 'boolean' ? record.allowPromptRewrite : false,
    assistantActions: normalizeAssistantActionPreferences(
      record.assistantActions as Partial<AssistantActionPreferences> | undefined,
    ),
    adNegativeRuleProfiles,
    wordLibraryDerivativeRule:
      typeof record.wordLibraryDerivativeRule === 'string' ? record.wordLibraryDerivativeRule : undefined,
    wordLibraryDerivativeRuleMode,
    wordLibraryDerivativeRules,
    profiles,
    activeProfileId,
    agentProfileId:
      typeof record.agentProfileId === 'string' && profiles.some((p) => p.id === record.agentProfileId)
        ? record.agentProfileId
        : null,
    agentShareApiParameters,
    agentUseCustomProfile: !agentShareApiParameters,
    agentProfiles,
    activeAgentProfileId,
    agentProfile: activeAgentProfile,
    backupInterval:
      typeof record.backupInterval === 'number' && Number.isFinite(record.backupInterval) && record.backupInterval >= 0
        ? record.backupInterval
        : 600,
    customBackupPath: typeof record.customBackupPath === 'string' ? record.customBackupPath : '',
    dismissedRecoveryTaskIds: normalizeStringArray(record.dismissedRecoveryTaskIds, []),
    agentBackend:
      record.agentBackend === 'agent' || record.agentBackend === 'canny' || record.agentBackend === 'kling'
        ? record.agentBackend
        : undefined,
  }
}

export function getCustomProviderDefinition(
  settings: Partial<AppSettings> | unknown,
  provider: ApiProvider,
): CustomProviderDefinition | null {
  const normalized = normalizeSettings(settings)
  return normalized.customProviders.find((item) => item.id === provider) ?? null
}

export function getApiProviderLabel(settings: Partial<AppSettings> | unknown, provider: ApiProvider): string {
  if (provider === 'fal') return 'fal.ai'
  if (provider === 'openai') return 'OpenAI'
  return getCustomProviderDefinition(settings, provider)?.name ?? provider
}

export function isOpenAICompatibleProvider(settings: Partial<AppSettings> | unknown, provider: ApiProvider): boolean {
  return provider === 'openai' || Boolean(getCustomProviderDefinition(settings, provider))
}

export interface ImportedProviderSettings {
  customProviders: CustomProviderDefinition[]
  profiles: ApiProfile[]
}

function stripMarkdownCodeFence(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```[^\r\n]*\r?\n([\s\S]*?)\r?\n```$/)
  return match ? match[1].trim() : trimmed
}

export function importCustomProviderSettingsFromJson(
  jsonText: string,
  existingProviders: CustomProviderDefinition[] = [],
): ImportedProviderSettings {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripMarkdownCodeFence(jsonText))
  } catch {
    throw new Error('JSON 格式无效')
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON 根节点必须是对象')
  }

  const record = parsed as Record<string, unknown>

  // 包裹结构：{customProviders: [...], profiles: [...]}
  if (Array.isArray(record.customProviders)) {
    const customProviders = normalizeCustomProviderDefinitions(record.customProviders)
    if (customProviders.length === 0) {
      throw new Error('customProviders 数组中没有有效的服务商配置')
    }
    const customProviderIds = new Set(customProviders.map((provider) => provider.id))
    const profiles = Array.isArray(record.profiles)
      ? record.profiles
          .map((item) => {
            validateImportedProfileRecord(item)
            return item
          })
          .map((item) => normalizeApiProfile(item, undefined, customProviderIds))
          .filter((profile) => customProviderIds.has(profile.provider))
      : []
    return { customProviders, profiles }
  }

  // 单个 Manifest 对象：{name, submit, ...}
  const usedIds = new Set(existingProviders.map((provider) => provider.id))
  const direct = normalizeCustomProviderDefinition(parsed, usedIds)
  if (direct) return { customProviders: [direct], profiles: [] }

  throw new Error('无法识别该 JSON。请粘贴自定义服务商配置。')
}

export function importCustomProviderDefinitionFromJson(
  jsonText: string,
  existingProviders: CustomProviderDefinition[] = [],
): CustomProviderDefinition {
  const result = importCustomProviderSettingsFromJson(jsonText, existingProviders)
  return result.customProviders[0]
}

export function getActiveApiProfile(settings: Partial<AppSettings> | unknown): ApiProfile {
  const record = settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : {}
  const normalized = normalizeSettings(settings)
  const profile =
    normalized.profiles.find((p) => p.id === normalized.activeProfileId) ??
    normalized.profiles[0] ??
    createDefaultOpenAIProfile()

  return {
    ...profile,
    baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : profile.baseUrl,
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : profile.apiKey,
    model: typeof record.model === 'string' && record.model.trim() ? record.model : profile.model,
    timeout: typeof record.timeout === 'number' && Number.isFinite(record.timeout) ? record.timeout : profile.timeout,
    apiMode: record.apiMode === 'images' || record.apiMode === 'responses' ? record.apiMode : profile.apiMode,
    codexCli: typeof record.codexCli === 'boolean' ? record.codexCli : profile.codexCli,
    apiProxy: typeof record.apiProxy === 'boolean' ? record.apiProxy : profile.apiProxy,
    streamImages: typeof record.streamImages === 'boolean' ? record.streamImages : profile.streamImages,
    streamPartialImages: normalizeStreamPartialImages(record.streamPartialImages, profile.streamPartialImages),
    maxConcurrent: normalizeMaxConcurrent(record.maxConcurrent, profile.maxConcurrent),
    maxRetries: normalizeMaxRetries(record.maxRetries, profile.maxRetries),
  }
}

export function getAgentApiProfile(settings: Partial<AppSettings> | unknown): ApiProfile {
  const normalized = normalizeSettings(settings)
  if (!normalized.agentShareApiParameters) {
    return normalized.agentProfile
  }
  const sharedProfile = getActiveApiProfile(settings)
  return {
    ...sharedProfile,
    id: normalized.agentProfile.id,
    name: `${sharedProfile.name} · Agent`,
    model: normalized.agentProfile.model || DEFAULT_RESPONSES_MODEL,
    apiMode: 'responses',
  }
}

export function getAgentTextApiProfile(settings: Partial<AppSettings> | unknown): ApiProfile {
  return getAgentApiProfile(settings)
}

export function getAgentImageApiProfile(settings: Partial<AppSettings> | unknown): ApiProfile {
  const normalized = normalizeSettings(settings)
  return normalized.agentApiConfigMode === 'hybrid' ? getActiveApiProfile(settings) : getAgentApiProfile(settings)
}

export function getAgentProfileValidationError(settings: Partial<AppSettings> | unknown): { message: string } | null {
  const normalized = normalizeSettings(settings)
  if (normalized.agentTextProtocol === 'chat-completions' && normalized.agentApiConfigMode !== 'hybrid') {
    return { message: 'Chat Completions 仅支持 Hybrid Agent，请先切换图像调用方式' }
  }
  const textProfile = getAgentTextApiProfile(normalized)
  const textError = validateApiProfile(textProfile)
  if (textError) return { message: `文本模型配置：${textError}` }
  if (textProfile.provider !== 'openai') {
    return { message: '文本模型必须使用 OpenAI 兼容的 Agent 服务' }
  }
  if (normalized.agentTextProtocol === 'responses' && textProfile.apiMode !== 'responses') {
    return { message: '当前文本协议需要使用 Responses API 配置' }
  }
  if (normalized.agentApiConfigMode === 'hybrid') {
    const imageError = validateApiProfile(getAgentImageApiProfile(normalized))
    if (imageError) return { message: `图像模型配置：${imageError}` }
  }
  return null
}

export function validateApiProfile(profile: ApiProfile): string | null {
  if (!profile.name.trim()) return '缺少名称'
  if (profile.provider !== 'fal' && !profile.baseUrl.trim() && !shouldUseApiProxy(profile.apiProxy))
    return '缺少 API URL'
  if (!profile.apiKey.trim()) return '缺少 API Key'
  if (!profile.model.trim()) return '缺少模型 ID'
  return null
}

function isDefaultOpenAIProfile(profile: ApiProfile): boolean {
  return (
    profile.id === DEFAULT_OPENAI_PROFILE_ID &&
    profile.name === '默认' &&
    profile.provider === 'openai' &&
    profile.baseUrl === DEFAULT_BASE_URL &&
    profile.apiKey === '' &&
    profile.model === DEFAULT_IMAGES_MODEL &&
    profile.timeout === DEFAULT_API_TIMEOUT &&
    profile.apiMode === 'images' &&
    profile.codexCli === false &&
    profile.apiProxy === DEFAULT_OPENAI_API_PROXY &&
    profile.streamImages === true &&
    profile.streamPartialImages === DEFAULT_STREAM_PARTIAL_IMAGES &&
    profile.maxConcurrent === DEFAULT_MAX_CONCURRENT &&
    profile.maxRetries === DEFAULT_MAX_RETRIES
  )
}

function hasOnlyDefaultProfiles(settings: AppSettings): boolean {
  return (
    settings.customProviders.length === 0 &&
    settings.profiles.length === 1 &&
    settings.activeProfileId === DEFAULT_OPENAI_PROFILE_ID &&
    isDefaultOpenAIProfile(settings.profiles[0])
  )
}

function createImportedProfileId(provider: ApiProvider, usedIds: Set<string>): string {
  let id = `${provider}-imported-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  while (usedIds.has(id)) {
    id = `${provider}-imported-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  }
  usedIds.add(id)
  return id
}

function getApiProfileDedupKey(profile: ApiProfile): string {
  return JSON.stringify([
    profile.provider,
    profile.baseUrl.trim().replace(/\/+$/, '').toLowerCase(),
    profile.apiKey.trim(),
    profile.model.trim(),
    profile.apiMode,
  ])
}

function getApiProfileConnectionKey(profile: ApiProfile): string {
  return JSON.stringify([
    profile.provider,
    profile.baseUrl.trim().replace(/\/+$/, '').toLowerCase(),
    profile.model.trim(),
    profile.apiMode,
  ])
}

function hasEquivalentApiProfile(existingProfiles: ApiProfile[], importedProfile: ApiProfile): boolean {
  const dedupKey = getApiProfileDedupKey(importedProfile)
  if (existingProfiles.some((profile) => getApiProfileDedupKey(profile) === dedupKey)) return true

  // LLM-generated imports intentionally omit API Key. Reuse an existing keyed profile
  // when the provider, URL, model, and mode are otherwise identical.
  if (importedProfile.apiKey.trim()) return false
  const connectionKey = getApiProfileConnectionKey(importedProfile)
  return existingProfiles.some((profile) => getApiProfileConnectionKey(profile) === connectionKey)
}

function dedupeApiProfiles(profiles: ApiProfile[]): ApiProfile[] {
  const seen = new Set<string>()
  return profiles.filter((profile) => {
    const key = getApiProfileDedupKey(profile)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function getCustomProviderDedupKey(provider: CustomProviderDefinition): string {
  return JSON.stringify([
    provider.name,
    provider.template ?? 'http-image',
    provider.submit,
    provider.editSubmit ?? null,
    provider.poll ?? null,
  ])
}

function mergeImportedCustomProviders(
  currentProviders: CustomProviderDefinition[],
  importedProviders: CustomProviderDefinition[],
) {
  const providers = [...currentProviders]
  const providerIdMap = new Map<string, string>()
  const usedIds = new Set(providers.map((provider) => provider.id))
  const existingKeys = new Map(providers.map((provider) => [getCustomProviderDedupKey(provider), provider.id] as const))

  for (const provider of importedProviders) {
    const existingId = existingKeys.get(getCustomProviderDedupKey(provider))
    if (existingId) {
      providerIdMap.set(provider.id, existingId)
      continue
    }

    const normalized = normalizeCustomProviderDefinition(provider, usedIds)
    if (!normalized) continue
    providerIdMap.set(provider.id, normalized.id)
    providers.push(normalized)
    existingKeys.set(getCustomProviderDedupKey(normalized), normalized.id)
  }

  return { providers, providerIdMap }
}

export function findEquivalentApiProfile(
  settings: Partial<AppSettings> | unknown,
  importedProfile: ApiProfile,
  importedProviders: CustomProviderDefinition[] = [],
): ApiProfile | null {
  const normalized = normalizeSettings(settings)
  const importedProvider = importedProviders.find((provider) => provider.id === importedProfile.provider)
  const provider = importedProvider
    ? (normalized.customProviders.find(
        (provider) => getCustomProviderDedupKey(provider) === getCustomProviderDedupKey(importedProvider),
      )?.id ?? importedProfile.provider)
    : importedProfile.provider
  const profile = { ...importedProfile, provider }
  const dedupKey = getApiProfileDedupKey(profile)
  const exact = normalized.profiles.find((item) => getApiProfileDedupKey(item) === dedupKey)
  if (exact) return exact

  if (profile.apiKey.trim()) return null
  const connectionKey = getApiProfileConnectionKey(profile)
  return normalized.profiles.find((item) => getApiProfileConnectionKey(item) === connectionKey) ?? null
}

export function mergeImportedSettings(
  currentSettings: Partial<AppSettings> | unknown,
  importedSettings: Partial<AppSettings> | unknown,
): AppSettings {
  const current = normalizeSettings(currentSettings)
  const normalizedImported = normalizeSettings(importedSettings)
  const imported = normalizeSettings({
    ...normalizedImported,
    profiles: dedupeApiProfiles(normalizedImported.profiles),
  })

  if (hasOnlyDefaultProfiles(current)) {
    return imported
  }

  const usedIds = new Set(current.profiles.map((profile) => profile.id))
  const existingKeys = new Set(current.profiles.map(getApiProfileDedupKey))
  const { providers: customProviders, providerIdMap } = mergeImportedCustomProviders(
    current.customProviders,
    imported.customProviders,
  )
  const importedProfiles = imported.profiles
    .map((profile) =>
      providerIdMap.has(profile.provider)
        ? { ...profile, provider: providerIdMap.get(profile.provider) ?? profile.provider }
        : profile,
    )
    .filter(
      (profile) =>
        !existingKeys.has(getApiProfileDedupKey(profile)) && !hasEquivalentApiProfile(current.profiles, profile),
    )
    .map((profile) => ({
      ...profile,
      id: createImportedProfileId(profile.provider, usedIds),
    }))
  const profiles = [...current.profiles, ...importedProfiles]

  return normalizeSettings({
    ...current,
    customProviders,
    profiles,
    activeProfileId: current.activeProfileId,
  })
}

export const DEFAULT_SETTINGS: AppSettings = normalizeSettings({
  themeMode: 'light',
  skinId: 'default',
  baseUrl: DEFAULT_BASE_URL,
  apiKey: '',
  model: DEFAULT_IMAGES_MODEL,
  timeout: DEFAULT_API_TIMEOUT,
  apiMode: 'images',
  codexCli: false,
  apiProxy: DEFAULT_OPENAI_API_PROXY,
  apiTransportMode: 'auto',
  streamImages: true,
  streamPartialImages: DEFAULT_STREAM_PARTIAL_IMAGES,
  customProviders: [],
  clearInputAfterSubmit: false,
  persistInputOnRestart: true,
  reuseTaskApiProfileTemporarily: false,
  alwaysShowRetryButton: false,
  taskCompletionNotification: false,
  enterSubmit: false,
  referenceImageEditAction: 'ask',
  zipDownloadRoutes: DEFAULT_ZIP_DOWNLOAD_ROUTES,
  imageSaveLayout: 'flat',
  imageFilenameDatePrefix: true,
  imageFilenameUsePrompt: false,
  agentScrollToBottomAfterSubmit: true,
  agentMaxToolRounds: DEFAULT_AGENT_MAX_TOOL_ROUNDS,
  agentWebSearch: false,
  agentApiConfigMode: 'native',
  agentTextProtocol: 'responses',
  allowPromptRewrite: false,
  assistantActions: normalizeAssistantActionPreferences(undefined),
  agentProfileId: null,
  agentShareApiParameters: true,
  agentUseCustomProfile: false,
  agentProfiles: [createDefaultAgentProfile()],
  activeAgentProfileId: createDefaultAgentProfile().id,
  agentProfile: createDefaultAgentProfile(),
  backupInterval: 600,
  customBackupPath: '',
  agentBackend: 'agent',
})
