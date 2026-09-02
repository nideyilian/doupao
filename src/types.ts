// ===== 设置 =====

import type { CompositeV2PersistedSnapshot } from './features/composite/lib/compositeV2Types'
import type { AssistantActionPreferences } from './features/assistantActions/types'

export type ApiMode = 'images' | 'responses'
export type AgentApiConfigMode = 'native' | 'hybrid'
export type AgentTextProtocol = 'responses' | 'chat-completions'
export type ApiTransportMode = 'auto' | 'renderer'
export type AppMode = 'gallery' | 'strategy' | 'ordering' | 'agent' | 'postprocess'
export type AgentBackend = 'agent' | 'canny' | 'kling'
export type ThemeMode = 'light' | 'dark'
/** 皮肤 ID：由 src/theme/registry.ts 注册表自动推导，不再手写联合类型 */
export type { SkinId } from './theme/registry'
/** @deprecated 使用 SkinId（保留用于旧代码/导入兼容） */
export type ColorScheme = import('./theme/registry').SkinId
export type ImageSaveLayout = 'flat' | 'batch-folder'
export type ReferenceImageEditAction = 'ask' | 'replace-reference' | 'add-mask'
export const ZIP_DOWNLOAD_ROUTE_VALUES = [
  'task-selection',
  'favorite-collection-selection',
  'image-context-menu-all',
  'task-detail-all',
  'task-detail-partial',
  'agent-round-all',
] as const
export type ZipDownloadRoute = (typeof ZIP_DOWNLOAD_ROUTE_VALUES)[number]
export const DEFAULT_ZIP_DOWNLOAD_ROUTES: ZipDownloadRoute[] = ['task-selection', 'favorite-collection-selection']
export type BuiltInApiProvider = 'openai' | 'fal'
export type ApiProvider = BuiltInApiProvider | string
export type CustomProviderTemplate = 'http-image'
export const DEFAULT_STREAM_PARTIAL_IMAGES = 1
export const DEFAULT_AGENT_MAX_TOOL_ROUNDS = 15

export type CustomProviderRequestMethod = 'GET' | 'POST'
export type CustomProviderContentType = 'json' | 'multipart'
export type CustomProviderFileSource = 'inputImages' | 'mask'

export interface CustomProviderFileMapping {
  field: string
  source: CustomProviderFileSource
  array?: boolean
}

export interface CustomProviderResultMapping {
  imageUrlPaths?: string[]
  b64JsonPaths?: string[]
}

export interface CustomProviderSubmitMapping {
  path: string
  method?: CustomProviderRequestMethod
  contentType?: CustomProviderContentType
  query?: Record<string, string>
  body?: Record<string, unknown>
  files?: CustomProviderFileMapping[]
  taskIdPath?: string
  result?: CustomProviderResultMapping
}

export interface CustomProviderPollMapping {
  path: string
  method?: CustomProviderRequestMethod
  query?: Record<string, string>
  intervalSeconds?: number
  statusPath: string
  successValues: string[]
  failureValues: string[]
  errorPath?: string
  result: CustomProviderResultMapping
}

export interface CustomProviderDefinition {
  id: string
  name: string
  template?: CustomProviderTemplate
  submit: CustomProviderSubmitMapping
  editSubmit?: CustomProviderSubmitMapping
  poll?: CustomProviderPollMapping
}

export interface ApiProfile {
  id: string
  name: string
  provider: ApiProvider
  baseUrl: string
  apiKey: string
  model: string
  timeout: number
  apiMode: ApiMode
  codexCli: boolean
  apiProxy: boolean
  responseFormatB64Json?: boolean
  streamImages?: boolean
  streamPartialImages?: number
  maxConcurrent?: number
  maxRetries?: number
  providerDrafts?: Partial<
    Record<
      ApiProvider,
      Partial<
        Pick<
          ApiProfile,
          | 'baseUrl'
          | 'model'
          | 'apiMode'
          | 'codexCli'
          | 'apiProxy'
          | 'responseFormatB64Json'
          | 'streamImages'
          | 'streamPartialImages'
          | 'maxConcurrent'
          | 'maxRetries'
        >
      >
    >
  >
}

export interface AppSettings {
  /** 界面主题：手动浅色 / 深色 */
  themeMode: ThemeMode
  /** 皮肤：由注册表驱动的整体视觉预设，仅改变颜色/字体/圆角/阴影，不影响布局 */
  skinId: import('./theme/registry').SkinId
  /** 旧版单配置字段：保留用于导入/查询参数兼容，实际请求以 active profile 为准 */
  baseUrl: string
  apiKey: string
  model: string
  timeout: number
  apiMode: ApiMode
  codexCli: boolean
  apiProxy: boolean
  /** Electron 默认使用主进程 Node/Undici，调试时可切换回渲染进程。 */
  apiTransportMode: ApiTransportMode
  streamImages?: boolean
  streamPartialImages?: number
  customProviders: CustomProviderDefinition[]
  providerOrder?: string[]
  clearInputAfterSubmit: boolean
  persistInputOnRestart: boolean
  reuseTaskApiProfileTemporarily: boolean
  alwaysShowRetryButton: boolean
  taskCompletionNotification: boolean
  enterSubmit: boolean
  referenceImageEditAction: ReferenceImageEditAction
  zipDownloadRoutes: ZipDownloadRoute[]
  imageSaveLayout: ImageSaveLayout
  imageFilenameDatePrefix: boolean
  imageFilenameUsePrompt: boolean
  agentScrollToBottomAfterSubmit: boolean
  agentMaxToolRounds: number
  agentWebSearch: boolean
  agentApiConfigMode: AgentApiConfigMode
  agentTextProtocol: AgentTextProtocol
  allowPromptRewrite: boolean
  assistantActions: AssistantActionPreferences
  adNegativeRuleProfiles: AdNegativeRuleProfile[]
  wordLibraryDerivativeRule?: string
  wordLibraryDerivativeRuleMode: 'single' | 'multiple'
  wordLibraryDerivativeRules: WordLibraryDerivativeRule[]
  profiles: ApiProfile[]
  activeProfileId: string
  agentProfileId: string | null
  /** Agent 是否复用当前 API 配置的连接参数；模型仍由 agentProfile.model 独立指定 */
  agentShareApiParameters: boolean
  agentUseCustomProfile: boolean
  /** 独立 Agent 服务列表；agentProfile 始终等于其中当前激活的一项 */
  agentProfiles: ApiProfile[]
  /** 当前激活的独立 Agent 服务 id */
  activeAgentProfileId: string
  /** 当前激活的独立 Agent 服务（agentProfiles 的镜像，保持向后兼容） */
  agentProfile: ApiProfile
  backupInterval: number
  customBackupPath: string
  /** 用户点「不再提醒」后记住的「恢复的历史任务」异常任务 id；仅当当前无归属任务全部在此列表中时才不再弹提示（新任务仍会提醒） */
  dismissedRecoveryTaskIds?: string[]
  /** 智能体后端选择。 */
  agentBackend?: AgentBackend
}

export type AdNegativeRulePlatform = 'general' | 'ocean-engine' | 'tencent-ads' | 'custom'

/** A reusable pre-generation negative constraint for information-flow ads. */
export interface AdNegativeRuleProfile {
  id: string
  name: string
  description: string
  content: string
  source: 'builtin' | 'custom'
  platform: AdNegativeRulePlatform
  version: number
  updatedAt: number
}

export const DEFAULT_AD_NEGATIVE_RULE_PROFILES: AdNegativeRuleProfile[] = [
  {
    id: 'general-strict',
    name: '通用严格',
    description: '最严格的信息流广告画面约束',
    source: 'builtin',
    platform: 'general',
    version: 1,
    updatedAt: 0,
    content:
      '不得生成色情裸露、低俗暗示、未成年人不适宜内容、血腥暴力、武器犯罪、毒品、赌博、烟草；不得生成国家机关、官方标志、证件、印章、虚假专家或权威背书；不得生成伪造新闻、证书、奖项、订单、支付、聊天、收益、销量、数据图表或前后对比；不得生成仿系统通知、中奖提醒、未读消息、关闭/播放/下载按钮等诱导点击界面；不得生成医疗病灶、手术画面、疾病恐吓、金融收益承诺、绝对化功效、容貌焦虑、歧视、炫富或卖惨元素。',
  },
  {
    id: 'ocean-engine',
    name: '今日头条',
    description: '适用于巨量引擎／头条信息流',
    source: 'builtin',
    platform: 'ocean-engine',
    version: 1,
    updatedAt: 0,
    content:
      '不得生成政治敏感、社会热点借势、官方通知、仿新闻页面、色情、赌博、毒品、非法医疗、危险动作、血腥不适、虚假科技或虚构实验；不得生成炫富、卖惨、攀比、焦虑营销、夸大功效、虚假数据、虚假价格、虚假活动、红包领奖、订单支付、伪造系统界面或诱导点击元素；不得生成未经证实的医疗、美容、教育、招商、金融结果承诺。',
  },
  {
    id: 'tencent-ads',
    name: '广点通',
    description: '适用于腾讯广告／广点通',
    source: 'builtin',
    platform: 'tencent-ads',
    version: 1,
    updatedAt: 0,
    content:
      '不得生成或仿冒微信、QQ、腾讯新闻等腾讯产品的界面、图标、按钮、头像、聊天记录、添加好友、系统消息、未读提示、红包、支付、中奖或下载弹窗；不得生成伪造订单、折扣、倒计时、新闻、证书、专利、销量或收益数据；不得生成暗示用户年龄、收入、健康、婚姻等个人属性的内容，不得使用未经授权的品牌、版权角色或素材，不得生成诱导点击和虚假宣传元素。',
  },
]

// ===== 任务参数 =====

export interface WordLibraryDerivativeRule {
  id: string
  name: string
  content: string
  enabled: boolean
  builtIn?: boolean
}

export const DEFAULT_WORD_LIBRARY_DERIVATIVE_RULE = [
  'Identify the variable semantic role first, such as background, style, subject, material, color, composition, lighting, mood, era, or camera treatment.',
  'Analyze the existing entries as one set: infer their shared semantic core, abstraction level, variation pattern, covered range, and missing directions.',
  'Build a hierarchy from concrete instance to subtype or style school, upper-level category, and form or function archetype. Move up at least one level before deriving useful sibling or adjacent concepts for the same variable slot.',
  'Do not merely keep the same object and swap color, weather, lighting, material, or mood adjectives. For example, moon can rise to celestial body, planet, or spherical form before deriving luminous planets or cosmic spheres; dog can rise to pet or animal; Japanese hand-drawn style can rise to hand-drawn or illustration before choosing another coherent illustration treatment.',
  'Every result must remain a concise, concrete phrase that can directly replace the same prompt variable. Avoid empty category labels, unrelated concepts, duplicates, and synonyms that only rephrase an existing entry.',
].join('\n')

export interface TaskParams {
  reference_mode: 'cycle' | 'all'
  size: string
  quality: 'auto' | 'low' | 'medium' | 'high'
  output_format: 'png' | 'jpeg' | 'webp'
  output_compression: number | null
  postprocess_resize_enabled: boolean
  postprocess_size: string
  postprocess_compress_enabled: boolean
  postprocess_format: 'png' | 'jpeg' | 'webp'
  postprocess_max_size_kb: number | null
  moderation: 'auto' | 'low'
  adNegativeRuleId: string
  n: number
  /** 稳定且每槽位不同的 seed（仅支持的供应商如 fal 使用；不修改用户 prompt） */
  seed?: number
}

export const DEFAULT_PARAMS: TaskParams = {
  reference_mode: 'cycle',
  size: 'auto',
  quality: 'auto',
  output_format: 'png',
  output_compression: null,
  postprocess_resize_enabled: false,
  postprocess_size: 'auto',
  postprocess_compress_enabled: false,
  postprocess_format: 'webp',
  postprocess_max_size_kb: 399,
  moderation: 'auto',
  adNegativeRuleId: 'general-strict',
  n: 1,
}

// ===== 输入图片（UI 层面） =====

export interface InputImage {
  /** IndexedDB image store 的 id（SHA-256 hash） */
  id: string
  /** data URL，用于预览 */
  dataUrl: string
}

export interface InputImageFolder {
  /** 文件夹路径 */
  path: string
  /** 文件夹内所有图片的 ID 列表（按文件名排序） */
  imageIds: string[]
}

export interface MaskDraft {
  targetImageId: string
  maskDataUrl: string
  updatedAt: number
}

// ===== 任务记录 =====

export type TaskStatus = 'running' | 'done' | 'error'

export type TaskProgressStage =
  | 'queued'
  | 'requesting'
  | 'relay-received'
  | 'generating'
  | 'previewing'
  | 'saving'
  | 'recovering'
  | 'completed'
  | 'partial-failure'
  | 'failed'
  | 'stopped'

export type BatchItemStatus = 'done' | 'error'

export interface BatchItemError {
  index: number
  error: string
}

// ===== 批量生成编排（槽位 + 远端请求） =====
// 以下类型用于替换旧的"请求 N 张"语义：编排器负责数量、恢复和去重，
// 供应商适配器只负责提交、查询、取消和解析结果。

export type GenerationSlotStatus = 'pending' | 'submitted' | 'running' | 'validating' | 'done' | 'failed'

export interface GenerationSlot {
  index: number
  status: GenerationSlotStatus
  /** 该槽位被调度的次数（首轮计 1，每次补偿 +1） */
  attempts: number
  /** commitGeneratedImage 之后回填的图片存储 id */
  outputImageId?: string
  /** 通过指纹校验后回填的 SHA-256 内容哈希 */
  contentHash?: string
  /** 感知哈希（pHash），用于近似重复检测 */
  perceptualHash?: string
  /** 失败原因（status === 'failed' 时） */
  error?: string
}

export type RemoteGenerationProvider = 'openai' | 'fal' | 'custom'

export type RemoteGenerationRequestStatus = 'created' | 'submitted' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface RemoteGenerationRequest {
  id: string
  provider: RemoteGenerationProvider
  endpoint?: string
  /** 供应商侧 request id（如 fal requestId / 自定义 taskId） */
  remoteRequestId?: string
  /** 本次请求负责的槽位下标 */
  slotIndexes: number[]
  /** 本次请求向供应商申请的图片数量 */
  requestedCount: number
  /** 调度轮次（首轮为 0，补偿轮次递增） */
  attempt: number
  status: RemoteGenerationRequestStatus
  createdAt: number
  updatedAt: number
  /** 失败 / 错误分类（见 imageBatchOrchestrator 的 GenerationErrorKind） */
  error?: string
  /** 失败时供应商/网络层返回的原始错误消息（用于补偿用尽后向用户透传真实原因） */
  errorMessage?: string
}

export interface SopBatchTaskMeta {
  batchId: string
  snapshotId?: string
  sopId: string
  sopName: string
  promptId?: string
  promptIndex: number
  promptCount: number
  imagesPerPrompt?: number
}

export interface SopBatchSnapshot {
  id: string
  /** 用户可编辑的提示词集标题；旧记录缺省时由 SOP 名称、本次要求或日期生成。 */
  title?: string
  /** 用户自定义标签，用于检索与批量归类。 */
  tags?: string[]
  /** 提示词仓库中的可选文件夹；名称冗余保存，便于备份恢复后重建目录树。 */
  promptGroup?: {
    id: string
    name: string
  }
  /** 提示词集在所属文件夹中的自定义排序位置。 */
  promptOrder?: number
  /** 生成提示词时实际使用的文本模型；旧记录可能没有该字段。 */
  promptGenerationModel?: string
  batchId: string
  workspaceTabId: string | null
  createdAt: number
  updatedAt?: number
  status?: 'generating' | 'ready' | 'submitted' | 'failed'
  pinned?: boolean
  batchIds?: string[]
  taskIds?: string[]
  sop: {
    id: string
    name: string
    description: string
    content: string
  }
  brief: string
  referenceImageIds: string[]
  promptCount: number
  imagesPerPrompt: number
  prompts: Array<{
    id: string
    text: string
    origin: 'ai' | 'manual'
    edited: boolean
    sourceId?: string
    referenceImageIds?: string[]
    deleted?: boolean
  }>
  params: TaskParams
}

export interface SopGenerationRecord {
  id: string
  status: 'running' | 'success' | 'error'
  createdAt: number
  updatedAt: number
  elapsedMs?: number
  metaInstruction: {
    id: string
    name: string
    description: string
    instruction: string
    kind: 'general' | 'image-prompt' | 'prompt-reverse' | 'variable-prompt-skill' | 'custom'
  }
  targetGroup?: {
    id: string
    name: string
  }
  brief: string
  referenceImages: Array<{
    id: string
    name: string
    dataUrl: string
  }>
  result?: {
    id: string
    name: string
    description: string
    content: string
  }
  error?: string
}

export interface TaskRecord {
  id: string
  prompt: string
  /** 画廊 SOP 批量生成任务标识；每个任务固定对应一条提示词，可生成多张图片。 */
  sopBatch?: SopBatchTaskMeta
  params: TaskParams
  /** Immutable copy of the business compliance rule used for this request. */
  adNegativeRuleSnapshot?: Pick<AdNegativeRuleProfile, 'id' | 'name' | 'content' | 'version'>
  /** Stable one-based batch within the task's local date and filename label scope. */
  filenameBatch?: number
  /** 文件名批次标签（如用户输入的日期/描述），供素材来源快照使用 */
  filenameLabel?: string
  /** 生成文件名基础（不含扩展名），供素材来源快照与导出命名使用 */
  generatedFileNameBase?: string
  /** 生成时使用的 Provider 类型 */
  apiProvider?: ApiProvider
  /** 生成时使用的 API 配置 ID */
  apiProfileId?: string
  /** 生成时使用的 Provider 名称 */
  apiProfileName?: string
  /** 生成时使用的 API 模式 */
  apiMode?: ApiMode
  /** 生成时使用的模型 ID */
  apiModel?: string
  /** fal.ai 队列请求 ID，用于连接断开后的结果恢复 */
  falRequestId?: string
  /** fal.ai 队列 endpoint，用于连接断开后的状态和结果查询 */
  falEndpoint?: string
  /** fal.ai 任务连接断开后是否等待自动恢复 */
  falRecoverable?: boolean
  /** 自定义异步服务商任务 ID，用于重启后继续查询结果 */
  customTaskId?: string
  /** 自定义异步任务是否等待自动恢复 */
  customRecoverable?: boolean
  /**
   * 批量生成槽位，数量固定等于 params.n。
   * 旧任务可能没有该字段，UI 与编排器均应兼容（按 outputImages 直接展示）。
   */
  generationSlots?: GenerationSlot[]
  /**
   * 所有远端生成请求（fal / 自定义异步），用于应用关闭、崩溃或断网后恢复。
   * 新的多图编排不再依赖单个 falRequestId / customTaskId，但仍保留这两个字段用于兼容旧任务。
   */
  remoteGenerationRequests?: RemoteGenerationRequest[]
  /** API 返回的实际生效参数，用于标记与请求值不一致的情况 */
  actualParams?: Partial<TaskParams>
  /** 输出图片对应的实际生效参数，key 为 outputImages 中的图片 id */
  actualParamsByImage?: Record<string, Partial<TaskParams>>
  /** 输出图片对应的 API 改写提示词，key 为 outputImages 中的图片 id */
  revisedPromptByImage?: Record<string, string>
  /** 输入图片的 image store id 列表 */
  inputImageIds: string[]
  /** 输入图片文件夹路径（仅文件夹批量输入模式有值） */
  inputImageFolderPath?: string
  maskTargetImageId?: string | null
  maskImageId?: string | null
  /** 输出图片的 image store id 列表 */
  outputImages: string[]
  /** 并发多图每个请求的状态，按请求顺序排列，仅部分失败时有值 */
  batchItemStatuses?: BatchItemStatus[]
  /** 并发多图每个失败请求的错误信息 */
  batchItemErrors?: BatchItemError[]
  /** 流式生成的中间步骤图片 id 列表，仅失败时保留供排查/下载 */
  streamPartialImageIds?: string[]
  /**
   * 已被永久删除的输出槽位下标（素材库墓碑同步后写入）。
   * 用于启动回填与任务重试时跳过已删除的槽位，避免已删除素材重新出现。
   */
  purgedOutputSlots?: number[]
  /** API 返回的原始图片 HTTP URL（非 base64 时记录） */
  rawImageUrls?: string[]
  /** 发生解析错误时的原始响应 JSON */
  rawResponsePayload?: string
  status: TaskStatus
  error: string | null
  progressStage?: TaskProgressStage
  progressMessage?: string
  progressUpdatedAt?: number
  createdAt: number
  finishedAt: number | null
  /** 总耗时毫秒 */
  elapsed: number | null
  /** 是否收藏 */
  isFavorite?: boolean
  /** 所属收藏夹 ID 列表 */
  favoriteCollectionIds?: string[]
  /** 收藏任务专用输出目录；为空时按收藏夹名称回退 */
  favoriteOutputPath?: string
  favoriteOutputUseDateVariable?: boolean
  /** 日程运行任务的显式输出目录 */
  scheduledOutputPath?: string
  /** 日程运行任务的输出子目录 */
  scheduledOutputSubFolder?: string
  /** 提交任务时素材库当前所在的项目文件夹 id；生成图片自动归档到该文件夹（「在哪个文件夹发送任务，图片就归哪个文件夹」） */
  defaultCollectionId?: string
  localSaveBatchFolder?: string
  localSavedOutputImagePaths?: Record<string, string>
  /** 来源模式：画廊 / Agent */
  sourceMode?: AppMode
  /** Agent 对话 ID */
  agentConversationId?: string
  /** Agent 轮次 ID */
  agentRoundId?: string
  /** Agent 消息 ID */
  agentMessageId?: string
  /** Agent 图像工具调用 ID */
  agentToolCallId?: string
  /** Agent 批量图像工具调用 ID */
  agentBatchCallId?: string
  /** Agent 图像工具实际动作 */
  agentToolAction?: 'generate' | 'edit' | 'auto' | string
}

export interface FavoriteCollection {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

export type ScheduleItemStatus = 'idle' | 'queued' | 'running' | 'done' | 'error'

export interface ScheduleItem {
  id: string
  taskId: string
  collectionId: string | null
  date: string
  rowId: string
  order: number
  count: number
  time: string | null
  lastRunKey?: string
  status?: ScheduleItemStatus
  lastTaskIds?: string[]
  lastError?: string
}

export interface ScheduleRow {
  id: string
  name: string
  order: number
}

export interface ScheduleState {
  rows: ScheduleRow[]
  items: ScheduleItem[]
  activeWeekStart: string
  modalOpen: boolean
  runningWeekStarts: string[]
}

// ===== Agent 模式 =====

export type AgentMessageRole = 'user' | 'assistant'
export type AgentRoundStatus = 'running' | 'done' | 'error'

export interface AgentMessage {
  id: string
  role: AgentMessageRole
  content: string
  roundId: string
  inputImageIds?: string[]
  maskTargetImageId?: string | null
  maskImageId?: string | null
  outputTaskIds?: string[]
  createdAt: number
}

export interface AgentRound {
  id: string
  index: number
  parentRoundId?: string | null
  userMessageId: string
  assistantMessageId?: string
  prompt: string
  inputImageIds: string[]
  maskTargetImageId?: string | null
  maskImageId?: string | null
  outputTaskIds: string[]
  responseId?: string
  responseOutput?: ResponsesOutputItem[]
  status: AgentRoundStatus
  error: string | null
  createdAt: number
  finishedAt: number | null
}

export interface AgentConversation {
  id: string
  title: string
  order: number
  activeRoundId?: string | null
  createdAt: number
  updatedAt: number
  rounds: AgentRound[]
  messages: AgentMessage[]
}

// ===== IndexedDB 存储的图片 =====

export interface StoredImage {
  id: string
  /**
   * 图片的 Base64 数据或 Blob URL。
   * 当使用本地文件系统存储时，数据库中此字段可为空或保留为 Blob URL（不存入DB），
   * 但为了兼容 Web 版本和内存缓存，保持该字段可选。
   */
  dataUrl?: string
  /** 图片首次存储时间（ms） */
  createdAt?: number
  /** 图片来源：用户上传 / API 生成 / 遮罩 */
  source?: 'upload' | 'generated' | 'mask'
  /** 原图宽度 */
  width?: number
  /** 原图高度 */
  height?: number
  /** 本地文件绝对路径（仅 Electron 环境下存在） */
  localPath?: string
  /** 文件 MIME 类型 */
  mimeType?: string
  /** 文件大小字节 */
  byteSize?: number
}

export interface StoredImageThumbnail {
  id: string
  /** 列表缩略图，用于避免卡片页解码完整 4K 原图 */
  thumbnailDataUrl: string
  /** 原图宽度 */
  width?: number
  /** 原图高度 */
  height?: number
  /** 缩略图生成参数版本 */
  thumbnailVersion?: number
}

export interface StoredCompositeAsset {
  id: string
  blob: Blob
  createdAt: number
}

// ===== API 请求体 =====

export interface ImageGenerationRequest {
  model: string
  prompt: string
  size: string
  quality: string
  output_format: string
  moderation: string
  output_compression?: number
  n?: number
}

// ===== API 响应 =====

export interface ImageResponseItem {
  b64_json?: string
  url?: string
  revised_prompt?: string
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
}

export interface ImageApiResponse {
  data: ImageResponseItem[]
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
  n?: number
}

export interface ResponsesOutputItem {
  id?: string
  type?: string
  status?: string
  action?: string | Record<string, unknown>
  /** function_call: unique call id for sending back function_call_output */
  call_id?: string
  /** function_call: function name */
  name?: string
  /** function_call: JSON-encoded arguments string */
  arguments?: string
  /** function_call_output: JSON/text output string */
  output?: string
  annotations?: Array<{
    type?: string
    start_index?: number
    end_index?: number
    url?: string
    title?: string
  }>
  content?: Array<{
    type?: string
    text?: string
    annotations?: Array<{
      type?: string
      start_index?: number
      end_index?: number
      url?: string
      title?: string
    }>
  }>
  result?:
    | string
    | {
        b64_json?: string
        base64?: string
        image?: string
        data?: string
      }
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
  revised_prompt?: string
}

export interface ResponsesApiResponse {
  id?: string
  output?: ResponsesOutputItem[]
  tools?: Array<{
    type?: string
    size?: string
    quality?: string
    output_format?: string
    output_compression?: number
    moderation?: string
    n?: number
  }>
}

export interface FalImageFile {
  url?: string
  content_type?: string
  file_name?: string
  width?: number
  height?: number
  b64_json?: string
  base64?: string
  data?: string
}

export interface FalApiResponse {
  images?: FalImageFile[]
  image?: FalImageFile | string
  url?: string
  seed?: number
}

// ===== 词条库 =====

export interface WordLibraryGroup {
  id: string
  name: string
  sortOrder: number
  /** Only one nesting level is supported to keep large libraries navigable. */
  parentId?: string | null
  description?: string
  color?: string
  archivedAt?: number | null
}

export interface WordLibraryEntry {
  id: string
  groupId: string
  key: string
  label: string
  entries: string[]
  draw_count: number
  /** 分组内排序权重，越小越靠前（置顶词条优先） */
  sortOrder: number
  isPinned: boolean
  isFavorite: boolean
  tags: string[]
  /** 删除时间（ms）；非空表示已进入回收站（软删除），列表默认不展示 */
  deletedAt: number | null
  createdAt: number
  updatedAt: number
  /** 被引用/抽取的使用次数，用于「使用频率」排序 */
  usageCount: number
  /** Skill-generated entries keep their origin so they can be reviewed as a batch. */
  sourceSkillName?: string
  generationBatchId?: string
}

export interface WordGenerationBatch {
  id: string
  skillName: string
  sourcePrompt: string
  referenceImageIds: string[]
  entryIds: string[]
  createdAt: number
  archivedAt: number | null
}

/** 词条库视图：列表视图 / 回收站视图 */
export type WordLibraryView = 'list' | 'trash'

/** 词条排序方式 */
export type WordLibrarySortType = 'manual' | 'updatedAt' | 'createdAt' | 'usage' | 'title'

/** 词条库导入/导出数据结构（用于备份与迁移） */
export interface WordLibraryExportData {
  version: number
  exportedAt: number
  groups: WordLibraryGroup[]
  entries: WordLibraryEntry[]
  batches?: WordGenerationBatch[]
}

// ===== 生成素材库 =====
// 素材库与任务生命周期分离：GeneratedAsset 是独立引用源，一份原图多处引用。

export type AssetStatus = 'active' | 'trashed'
export type AssetRating = 0 | 1 | 2 | 3 | 4 | 5

/** Eagle 式素材级颜色标签（快速分类维度，独立于标签颜色） */
export type AssetColorLabel = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray'

export type AssetSourceMode = 'gallery' | 'agent' | 'schedule' | 'sop' | 'unknown'

/** 一个生成来源快照：某次任务的某个输出位置及其生成参数。 */
export interface GeneratedAssetOrigin {
  /** 生成输出或被任务实际采用的外部参考图；旧数据默认视为 generated。 */
  kind?: 'generated' | 'reference'
  /** `${taskId}:${outputSlot}`；旧任务没有槽位时使用迁移时记录的原始下标 */
  key: string
  taskId: string
  outputSlot: number
  taskCreatedAt: number
  taskFinishedAt: number | null
  sourceMode: AssetSourceMode
  workspaceTabId?: string
  workspaceTabName?: string
  prompt: string
  revisedPrompt?: string
  requestedParams: TaskParams
  /** 任务级实际生效参数（该任务全部输出图共有的差异，如 auto 解析后的尺寸/质量）；图级差异见 imageActualParams */
  actualParams?: Partial<TaskParams>
  /** 图级专属实际生效参数：来自任务 actualParamsByImage[imageId]，仅存与任务级不同的差异（如并发多图中单图的尺寸/seed） */
  imageActualParams?: Partial<TaskParams>
  /** 本图专属 seed（每槽位不同；旧数据可从 imageActualParams.seed 回读） */
  seed?: number
  apiProvider?: ApiProvider
  apiProfileId?: string
  apiProfileName?: string
  apiMode?: ApiMode
  apiModel?: string
  inputImageIds: string[]
  maskTargetImageId?: string | null
  maskImageId?: string | null
  filenameBatch?: number
  filenameLabel?: string
  generatedFileNameBase?: string
}

/** 一张生成图片对应的可管理素材记录；id 与 StoredImage.id（内容哈希）一致。 */
export interface GeneratedAsset {
  id: string
  imageId: string
  /** 内容寻址的物理字节记录；旧数据会在归一化时从 imageId 补齐。 */
  blobId?: string
  /** 当前可交付版本；与逻辑素材 id、物理 blob id 相互独立。 */
  currentVersionId?: string
  status: AssetStatus
  createdAt: number
  updatedAt: number
  trashedAt: number | null
  favorite: boolean
  rating: AssetRating
  /** Eagle 式素材级颜色标签（红橙黄绿蓝紫灰）；undefined 表示无 */
  colorLabel?: AssetColorLabel
  collectionIds: string[]
  tagIds: string[]
  /** 用户备注/注释（纯文本） */
  notes?: string
  /** 所有生成来源；相同内容由多个任务产生时不会覆盖 */
  origins: GeneratedAssetOrigin[]
  primaryOriginKey: string | null
  /** 输入中已经是生成素材的图片，用于衍生链 */
  parentAssetIds: string[]
  /** 查询和布局使用的派生媒体信息；原始文件路径仍只存在 StoredImage */
  width?: number
  height?: number
  mimeType?: string
  byteSize?: number
  metadataVersion: number
}

export interface AssetBlob {
  id: string
  contentHash: string
  mimeType?: string
  byteSize?: number
  localPath?: string
  createdAt: number
}

export type AssetVersionKind = 'original' | 'thumbnail' | 'crop' | 'postprocess' | 'composite'

export interface AssetVersion {
  id: string
  assetId: string
  blobId: string
  versionNumber: number
  kind: AssetVersionKind
  createdAt: number
  width?: number
  height?: number
  parentVersionIds: string[]
  /** 可删除、可重建的机器派生索引，不作为用户事实来源。 */
  machineIndex?: {
    textVector?: number[]
    perceptualHash?: string
    modelId: string
    modelVersion: string
    generatedAt: number
  }
}

export interface AssetCatalogCursorPage {
  assets: GeneratedAsset[]
  totalCount: number
  nextCursor: string | null
  counts: {
    all: number
    recent: number
    favorites: number
    unorganized: number
    trash: number
    byCollection: Record<string, number>
    /** 兼容字段：标签体系已移除（数据保留），桌面端 SQLite 仍返回该计数，渲染端不再消费。 */
    byTag?: Record<string, number>
  }
}

export interface AssetCatalogQuery {
  scope: AssetLibraryScope
  query: string
  filters: AssetLibraryFilters
  sortKey: AssetSortKey
  sortOrder: 'asc' | 'desc'
  cursor?: string | null
  limit?: number
  /** 混合搜索时文本、视觉和真实使用行为的权重。 */
  semantic?: {
    enabled: boolean
    similarToAssetId?: string
    context?: string
  }
}

export type AssetUsageAction =
  | 'selected-as-reference'
  | 'generation-input'
  | 'open-postprocess'
  | 'open-composite'
  | 'reuse-config'
  | 'export'
  | 'derived'

export type AssetUsageTarget =
  'gallery' | 'agent' | 'schedule' | 'sop' | 'postprocess' | 'composite' | 'export' | 'unknown'

/** 素材进入真实工作流的行为记录，用于复用率、衍生链与未来推荐排序。 */
export interface AssetUsageEvent {
  id: string
  assetId: string
  imageId: string
  action: AssetUsageAction
  target: AssetUsageTarget
  occurredAt: number
  taskId?: string
  workspaceTabId?: string
  sopId?: string
  parentAssetIds?: string[]
}

/** 用户创建的虚拟集合（UI 名称为“项目”）；不对应本地目录。 */
export interface AssetCollection {
  id: string
  name: string
  normalizedName: string
  parentId: string | null
  order: number
  /** 文件夹颜色（可选，用于快速区分大类） */
  color?: string
  /** 置顶：固定排在同级最前 */
  pinned?: boolean
  /** 软删除时间戳；非 null 表示在文件夹回收站中 */
  trashedAt?: number | null
  createdAt: number
  updatedAt: number
}

/** 用户手动添加的关键词标签；支持多级树（parentId）与可选颜色。 */
export interface AssetTag {
  id: string
  name: string
  normalizedName: string
  /** 父标签 id；null 为顶级标签 */
  parentId: string | null
  /** 同级排序权重 */
  order: number
  color?: string
  createdAt: number
  updatedAt: number
}

/** 永久删除墓碑：防止启动回填或迁移让已永久删除的素材重新出现。 */
export interface AssetTombstone {
  id: string
  imageId: string
  purgedAt: number
  /** 永久删除前已知的最新来源完成时间；任务未完成时回退创建时间 */
  lastOriginOccurredAt: number
}

export type AssetPatch = Partial<{
  favorite: boolean
  rating: AssetRating
  colorLabel: AssetColorLabel | null
  collectionIds: string[]
  tagIds: string[]
  notes: string
}>

export type AssetLibraryScope =
  | 'all'
  | 'recent'
  | 'favorites'
  | 'unorganized'
  | 'trash'
  | { kind: 'collection'; id: string }
  | { kind: 'tag'; id: string }

export type AssetSortKey = 'createdAt' | 'updatedAt' | 'rating' | 'width' | 'area'

/** 素材查询筛选条件；语义与查询纯函数 queryAssets 保持一致。 */
export interface AssetLibraryFilters {
  favoriteOnly?: boolean
  minRating?: number
  collectionId?: string | null
  /** 项目（文件夹）递归查询：含自身与全部后代的集合 id 列表（「包含子文件夹」开关开启时由渲染端计算传入） */
  collectionIds?: string[]
  /** 单选标签（兼容深链接 tag?id= 与旧数据） */
  tagId?: string | null
  /** 多选标签（Eagle 侧栏多选，AND 语义：素材须同时包含全部选中标签） */
  tagIds?: string[]
  /** 创建时间范围（ms 时间戳） */
  dateFrom?: number
  dateTo?: number
  /** API 模型，部分匹配（不区分大小写） */
  model?: string
  /** 服务商 */
  provider?: ApiProvider
  /** 素材级颜色标签 */
  colorLabel?: AssetColorLabel
  orientation?: 'landscape' | 'portrait' | 'square'
  minWidth?: number
  maxWidth?: number
  sourceMode?: AssetSourceMode
}

/**
 * 顶部快捷筛选：单个筛选值的固定引用（在筛选面板点「固定到顶部」添加）。
 * 点击快捷胶囊即应用/取消对应筛选条件；列表本地持久化（pinnedFilters）。
 */
export type PinnedFilter =
  | { kind: 'favoriteOnly' }
  | { kind: 'minRating'; value: number }
  | { kind: 'orientation'; value: NonNullable<AssetLibraryFilters['orientation']> }
  | { kind: 'sourceMode'; value: AssetSourceMode }
  | { kind: 'colorLabel'; value: AssetColorLabel }
  | { kind: 'provider'; value: string }
  | { kind: 'model'; value: string }

/**
 * 顶部工具栏可放出的筛选控件（维度级）：用户自主选择把哪些「整个筛选参数」
 * 常驻在工具栏直接操作（未放出的仍从筛选弹层使用）。本地持久化。
 */
export type FilterControlKey =
  | 'favoriteOnly'
  | 'minRating'
  | 'provider'
  | 'model'
  | 'orientation'
  | 'sourceMode'
  | 'colorLabel'
  | 'dateRange'
  | 'widthRange'

// ===== 导出数据 =====

/** ZIP manifest.json 格式 */
export interface ExportData {
  version: number
  exportedAt: string
  includesSecrets?: boolean
  settings?: AppSettings
  tasks?: TaskRecord[]
  sopPromptRuns?: SopBatchSnapshot[]
  favoriteCollections?: FavoriteCollection[]
  defaultFavoriteCollectionId?: string | null
  agentConversations?: AgentConversation[]
  wordLibraryGroups?: WordLibraryGroup[]
  wordLibraryEntries?: WordLibraryEntry[]
  wordGenerationBatches?: WordGenerationBatch[]
  generatedAssets?: GeneratedAsset[]
  assetCollections?: AssetCollection[]
  assetTags?: AssetTag[]
  assetTombstones?: AssetTombstone[]
  assetUsageEvents?: AssetUsageEvent[]
  /** imageId -> 图片引用元数据；不包含绝对路径或原图二进制 */
  imageRefs?: Record<
    string,
    {
      available: boolean
      createdAt?: number
      source?: 'upload' | 'generated' | 'mask'
      width?: number
      height?: number
      mimeType?: string
      byteSize?: number
    }
  >
  /** 是否在 ZIP 中包含原始图片二进制 */
  includesOriginalImages?: boolean
  /** imageId → 图片信息 */
  imageFiles?: Record<
    string,
    {
      path: string
      createdAt?: number
      source?: 'upload' | 'generated' | 'mask'
      width?: number
      height?: number
    }
  >
  /** imageId → 缩略图信息 */
  thumbnailFiles?: Record<
    string,
    {
      path: string
      width?: number
      height?: number
      thumbnailVersion?: number
    }
  >
  compositeState?: CompositeV2PersistedSnapshot
  postprocessState?: import('./storePostprocess').PostprocessPersistedState
  workspaceState?: WorkspaceBackupState
  compositeAssetFiles?: Record<
    string,
    {
      path: string
      createdAt: number
      type: string
    }
  >
}

// ===== 工作区标签页 =====

export interface WorkspaceTabGroup {
  id: string
  name: string
  order: number
  collapsed: boolean
}

export interface WorkspaceTab {
  id: string
  name: string
  groupId: string | null
  prompt: string
  inputImages: InputImage[]
  inputImageFolder: InputImageFolder | null
  params: TaskParams
  maskDraft: MaskDraft | null
  maskEditorImageId: string | null
  customOutputPath: string
  tasks: TaskRecord[]
  /** 持久化水合后、IndexedDB 任务回填前暂存的任务归属 ID。 */
  _taskIds?: string[]
  createdAt: number
  updatedAt: number
  order: number
}

export interface WorkspaceBackupTab {
  id: string
  name: string
  groupId: string | null
  prompt: string
  inputImageIds: string[]
  inputImageFolder: InputImageFolder | null
  params: TaskParams
  maskDraft: MaskDraft | null
  maskEditorImageId: string | null
  customOutputPath: string
  taskIds: string[]
  createdAt: number
  updatedAt: number
  order: number
}

export interface WorkspaceBackupState {
  tabs: WorkspaceBackupTab[]
  groups: WorkspaceTabGroup[]
  activeTabId: string | null
}
