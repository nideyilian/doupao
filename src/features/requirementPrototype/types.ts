export type RequirementRole = 'optimizer' | 'strategist' | 'admin'

export type {
  OrderingCatalog as RequirementCatalog,
  OrderingChannel as CatalogChannel,
  OrderingDraft as RequirementDraft,
  OrderingExcludedCombination as ExcludedCombination,
  OrderingMaterialType as CatalogMaterialType,
  OrderingOrder as RequirementOrder,
  OrderingPreview as RequirementPreview,
  OrderingProduct as CatalogProduct,
  OrderingSettings as RequirementSettings,
  OrderingStatus as RequirementOrderStatus,
  OrderingUnit as RequirementUnit,
  OrderingUnitStatus as RequirementUnitStatus,
} from '../ordering/types'

export type RequirementRoute = 'order' | 'orders' | 'strategy' | 'knowledge' | 'admin' | 'legacy'

export interface RequirementUser {
  id: string
  username: string
  displayName: string
  role: RequirementRole
  dailyQuota: number
  password?: string
  disabled?: boolean
}

export interface StrategyDraft {
  materialTypeId: string
  baseVersion: number
  summary: string
  strategy: string
  fixedRules: string[]
  supportedRatios: Array<'16:9' | '9:16'>
  status: 'draft' | 'review'
  updatedBy: string
  updatedAt: number
}

export interface RequirementAuditEvent {
  id: string
  actorId: string
  actorName: string
  action: string
  detail: string
  createdAt: number
}

export interface KnowledgeBatch {
  id: string
  name: string
  folderPath: string
  productId: string
  channelId: string
  materialTypeId?: string
  fileCount: number
  status: 'ready' | 'analyzing' | 'review' | 'completed' | 'error'
  analyzedCount: number
  stableInsights: number
  exploratoryInsights: number
  createdBy: string
  createdAt: number
  error?: string
}

export interface KnowledgeInsight {
  id: string
  batchId: string
  title: string
  description: string
  category: 'stable' | 'exploratory'
  evidence: string
  smallSampleOpportunity: boolean
  createdAt: number
}

export type {
  StrategyAsset,
  StrategyFlowStep,
  StrategyFlowStepKind,
  StrategyGenerationMode,
  StrategyKnowledgeConfig,
  StrategyOutputs,
  StrategyPreset,
  StrategyPresetType,
  StrategyReferenceConfig,
  StrategyReferenceSource,
  StrategySopConfig,
  StrategySopMode,
  StrategyWorkflow,
} from '../strategy/types'
