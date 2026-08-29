export type CompositeV2ImageFormat = 'jpg'

export type CompositeV2FitMode = 'crop-fill' | 'contain-blur' | 'stretch'

export type CompositeV2Anchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

export type CompositeV2Position =
  | {
      mode: 'anchor'
      anchor: CompositeV2Anchor
      marginX: number
      marginY: number
      offsetX: number
      offsetY: number
      width: number
      height: number
    }
  | {
      mode: 'free'
      x: number
      y: number
      width: number
      height: number
    }

export type CompositeV2Shadow = {
  enabled: boolean
  color: string
  x: number
  y: number
  blur: number
  opacity: number
}

export type CompositeV2Stroke = {
  enabled: boolean
  color: string
  width: number
}

export type CompositeV2LayerBase = {
  id: string
  name: string
  visible: boolean
  locked: boolean
  opacity: number
  rotation: number
  position: CompositeV2Position
  shadow: CompositeV2Shadow
  stroke?: CompositeV2Stroke
}

export type CompositeV2ImageAssetRef =
  | { kind: 'path'; path: string }
  | { kind: 'internal'; path: string; originalPath?: string }
  | { kind: 'dataUrl'; dataUrl: string; name?: string }
  | { kind: 'project'; id: string }
  | { kind: 'stored'; assetId: string; name?: string }

export type CompositeV2MediaLayer = CompositeV2LayerBase & {
  type: 'image' | 'logo'
  asset: CompositeV2ImageAssetRef | null
  radius: number
  clip: boolean
}

export type CompositeV2ImageLayer = CompositeV2MediaLayer & {
  type: 'image'
}

export type CompositeV2LogoLayer = CompositeV2MediaLayer & {
  type: 'logo'
}

export type CompositeV2TextLayer = CompositeV2LayerBase & {
  type: 'text'
  text: string
  fontFamily: string
  fontSize: number
  fontWeight: number
  color: string
  align: 'left' | 'center' | 'right'
  lineHeight: number
  letterSpacing: number
  padding: number
}

export type CompositeV2Layer = CompositeV2ImageLayer | CompositeV2LogoLayer | CompositeV2TextLayer

export type CompositeV2OutputSizeRule = {
  id: string
  name: string
  enabled: boolean
  width: number
  height: number
  maxSizeKb: number
  format: CompositeV2ImageFormat
  filenameTemplate: string
}

export type CompositeV2OutputRuleGroup = {
  id: string
  name: string
  rules: CompositeV2OutputSizeRule[]
  distributionPaths: string[]
}

export type CompositeV2CustomVariable = {
  id: string
  name: string
  value: string
}

export type CompositeV2Preset = {
  id: string
  name: string
  outputRootPath: string
  distributionPath: string
  filenameTemplate: string
  customVariableValues: Record<string, string>
  namingTemplate?: string
  baseCanvas: { width: number; height: number }
  sampleBackgroundPath: string
  layers: CompositeV2Layer[]
  useOutputOverrides: boolean
  outputRuleGroupsOverride: CompositeV2OutputRuleGroup[]
  updatedAt: number
}

export type CompositeV2PresetGroup = {
  id: string
  name: string
  presetIds: string[]
  updatedAt: number
}

export type CompositeV2BackgroundImage = {
  path: string
  name: string
  relativeDir: string
  width: number
  height: number
  /**
   * 图片数据（可选）。素材库送入的无本地文件的生成图走 dataUrl 模式：
   * 渲染/预览时优先用 dataUrl，否则回退到 readImageFile(path) 读本地文件。
   */
  dataUrl?: string
}

export type CompositeV2ExportStatus = 'idle' | 'running' | 'paused' | 'canceling' | 'completed' | 'canceled' | 'failed'

export type CompositeV2SuccessItem = {
  path: string
  /** 源素材（背景图）路径：任务记录溯源（素材 → 输出 → 分配）用；旧历史数据可能缺失 */
  backgroundPath?: string
  presetId: string
  presetName: string
  channel: string
  size: string
  index: number
  warning?: string
}

export type CompositeV2FailureItem = {
  backgroundPath: string
  presetId: string
  presetName: string
  channel: string
  size: string
  reason: string
  /** 该失败项在规则内的背景序号（用于任务流精确匹配；旧历史数据可能缺失） */
  index?: number
}

/** 导出任务流中的单个任务（不参与持久化） */
export type CompositeV2ExportTaskStatus = 'pending' | 'running' | 'done' | 'failed'

export type CompositeV2ExportTask = {
  key: string
  backgroundPath: string
  presetId: string
  presetName: string
  channel: string
  size: string
  index: number
  /** 导出日期（YYYYMMDD）与自定义参数，用于失败重试时重建导出项 */
  date: string
  custom: string
  status: CompositeV2ExportTaskStatus
  reason?: string
  outputPath?: string
}

export type CompositeV2DistributionSuccessItem = {
  originalPath: string
  targetPath: string
}

export type CompositeV2DistributionFailureItem = {
  originalPath: string
  targetPath: string
  error: string
}

export type CompositeV2HistoryRecord = {
  id: string
  status: 'completed' | 'canceled' | 'completed-with-failures'
  startedAt: number
  endedAt: number
  backgroundFolders: string[]
  recursive: boolean
  backgroundCount: number
  presetGroupName: string
  enabledPresetCount: number
  plannedCount: number
  successCount: number
  failureCount: number
  successes: CompositeV2SuccessItem[]
  failures: CompositeV2FailureItem[]
  cleanup?: { deleted: string[]; failed: string[] }
  distributionStatus?: 'pending' | 'running' | 'completed' | 'failed' | 'canceled'
  distributionSuccessCount?: number
  distributionFailureCount?: number
  distributionErrors?: string[]
  distributionSuccesses?: CompositeV2DistributionSuccessItem[]
  distributionFailures?: CompositeV2DistributionFailureItem[]
}

export type CompositeV2DistributionConfig = {
  enabled: boolean
  startDate: string // YYYYMMDD
  days: number
  mode: 'copy' | 'move'
  randomize: boolean
  skipWeekends: boolean
  renameMode: 'date' | 'sequence'
  modifyMd5: boolean
}

type CompositeV2ProjectLogoBase = {
  id: string
  name: string
  width?: number
  height?: number
}

export type CompositeV2ProjectLogo = CompositeV2ProjectLogoBase &
  ({ assetId: string; dataUrl?: never } | { assetId?: never; dataUrl: string })

export type CompositeV2State = {
  logoLibraryPath: string
  logoOrder: string[]
  projectLogos: CompositeV2ProjectLogo[]
  customVariables: CompositeV2CustomVariable[]
  presets: CompositeV2Preset[]
  presetGroups: CompositeV2PresetGroup[]
  outputRuleGroups: CompositeV2OutputRuleGroup[]
  globalFitMode: CompositeV2FitMode
  historyRetention: number
  history: CompositeV2HistoryRecord[]
  distributionConfig: CompositeV2DistributionConfig
  backgroundFolders?: string[]
  recursiveBackgrounds?: boolean
  enabledPresetIdsForRun?: string[]
  smartMatchOrientation?: boolean
  /**
   * 导出后是否把成图归档到素材库（IndexedDB + cache-images + 素材目录）。
   * 默认 false：成图只写入预设的输出文件夹，不进入素材库。
   */
  archiveExportsToLibrary?: boolean
}

export type CompositeV2PersistedSnapshot = CompositeV2State & {
  selectedPresetGroupId?: string
  selectedPreviewPresetId?: string
}
