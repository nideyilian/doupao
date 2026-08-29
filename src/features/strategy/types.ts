export type StrategyGenerationMode = 'text-to-image' | 'image-to-image'

export type StrategyReferenceSource = 'knowledge-material' | 'local-image' | 'generated-image'

export interface StrategyReferenceConfig {
  source: StrategyReferenceSource
  label: string
  value: string
  imageIds: string[]
}

export interface StrategyKnowledgeConfig {
  resolved: boolean
  insightIds: string[]
}

export type StrategySopMode = 'none' | 'preset' | 'custom'

export interface StrategySopConfig {
  resolved: boolean
  mode: StrategySopMode
  presetId?: string
  name?: string
  description?: string
  content: string
}

export interface StrategyWorkflow {
  reference?: StrategyReferenceConfig
  instruction: string
  knowledge: StrategyKnowledgeConfig
  sop: StrategySopConfig
}

export interface StrategyOutputs {
  channels: {
    enabled: boolean
    channelIds: string[]
  }
  sizes: {
    enabled: boolean
    ratios: Array<'16:9' | '9:16'>
  }
  export: {
    enabled: boolean
    presetId?: string
  }
  allocation: {
    enabled: boolean
    presetId?: string
  }
}

export type StrategyFlowStepKind =
  'mode' | 'reference' | 'instruction' | 'knowledge' | 'sop' | 'channel' | 'size' | 'export' | 'allocation'

export interface StrategyFlowStep {
  id: string
  kind: StrategyFlowStepKind
  label: string
  value: string
  sourceType?: 'knowledge-material' | 'knowledge-term' | 'local-image' | 'generated-image' | 'sop-preset'
  referenceImageIds?: string[]
}

export interface StrategyAsset {
  id: string
  name: string
  productId: string
  materialTypeId: string
  description: string
  coverImageId?: string
  generationMode: StrategyGenerationMode | null
  workflow: StrategyWorkflow
  outputs: StrategyOutputs
  quantity: number
  status: 'draft' | 'review' | 'published'
  version: number
  createdBy: string
  createdAt: number
  updatedAt: number
  archived?: boolean
  resultPromptOverrides?: Record<string, string>
}

export type StrategyPresetType = 'export' | 'allocation'

export interface StrategyPreset {
  id: string
  name: string
  type: StrategyPresetType
  description: string
  value: string
  global: true
  createdBy: string
  createdAt: number
  archived?: boolean
}

export interface SopGroup {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

export interface SopLibraryItem {
  id: string
  groupId?: string
  coverImageId?: string
  name: string
  description: string
  content: string
  source: 'manual' | 'generated' | 'legacy-preset'
  metaInstructionId?: string
  /** 变量提示词资产：content 为可被 parseVariablePrompt 解析的模板，可展开批量生图 */
  executionMode?: 'prompt-generator' | 'variable-prompt'
  /** 变量提示词资产的每个可变项的结构化参数（主题/类型/衍生数量）；旧资产缺省时由正文推导 */
  variableMeta?: SopVariableMeta[]
  createdBy: string
  createdAt: number
  updatedAt: number
  favorite?: boolean
  lastUsedAt?: number
}

export interface SopMetaInstruction {
  id: string
  name: string
  description: string
  instruction: string
  kind: 'general' | 'image-prompt' | 'prompt-reverse' | 'variable-prompt-skill' | 'custom'
  createdAt: number
  updatedAt: number
}

/**
 * 变量提示词资产中单个可变项的结构化参数。
 * 正文模板仍是唯一事实源；本元数据是增强层（主题/类型/数量），
 * 与正文不一致时以 parseVariablePrompt 的解析结果为准。
 */
export interface SopVariableMeta {
  /** 与模板 {{变量名}} 逐字一致的变量名 */
  name: string
  /** 衍生/改写方向的主题描述，如「高端美妆」 */
  theme: string
  /** 选项池类型，如「实物」「文案联动」「场景」 */
  type: string
  /** 目标选项数量（衍生数量）；应用后同步为实际选项数 */
  count: number
}

export interface SopVersion {
  id: string
  name: string
  content: string
  createdAt: number
  createdBy: string
}
