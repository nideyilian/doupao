export interface OrderingProduct {
  id: string
  name: string
  category: string
  summary: string
  facts: string[]
  audience: string
  scenes: string[]
  forbidden: string[]
  color: string
  published: boolean
  archived?: boolean
  version: number
  outputPath?: string
}

export interface OrderingChannel {
  id: string
  name: string
  summary: string
  ratios: Array<'16:9' | '9:16'>
  requirements: string[]
  forbidden: string[]
  published: boolean
  archived?: boolean
  version: number
  outputPath?: string
}

export interface OrderingMaterialType {
  id: string
  name: string
  summary: string
  mode: 'fixed' | 'intelligent'
  strategy: string
  fixedRules?: string[]
  supportedRatios?: Array<'16:9' | '9:16'>
  compatibleProductIds?: string[]
  compatibleChannelIds?: string[]
  color: string
  published: boolean
  archived?: boolean
  version: number
}

export interface OrderingCatalog {
  products: OrderingProduct[]
  channels: OrderingChannel[]
  materialTypes: OrderingMaterialType[]
}

export interface OrderingDraft {
  productIds: string[]
  channels: Array<{
    channelId: string
    ratios: Array<'16:9' | '9:16'>
  }>
  materialTypeIds: string[]
  quantity: number
  urgentRequested: boolean
  urgentReason?: string
  urgentTargetMinutes?: 30 | 60 | 120
}

export interface OrderingExcludedCombination {
  productId: string
  channelId: string
  ratio: '16:9' | '9:16'
  materialTypeId: string
  reason: string
}

export type OrderingUnitStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export interface OrderingUnit {
  id: string
  productId: string
  channelId: string
  ratio: '16:9' | '9:16'
  materialTypeId: string
  quantity: number
  prompt: string
  status: OrderingUnitStatus
  taskId?: string
  error?: string
  referenceImageIds?: string[]
}

export interface OrderingPreview {
  units: OrderingUnit[]
  excluded: OrderingExcludedCombination[]
  totalImages: number
  valid: boolean
  errors: string[]
}

export type OrderingStatus = 'queued' | 'running' | 'completed' | 'partially_failed' | 'failed' | 'cancelled'

export interface OrderingOrder {
  id: string
  number: string
  createdBy: string
  createdByName: string
  createdAt: number
  status: OrderingStatus
  draft: OrderingDraft
  units: OrderingUnit[]
  excluded: OrderingExcludedCombination[]
  totalImages: number
  completedImages: number
  failedImages: number
  urgentRequested: boolean
  urgentApproved: boolean
  urgentReason?: string
  estimatedFinishedAt?: number
  outputRoot?: string
  isTest?: boolean
  urgentRejected?: boolean
  strategyId?: string
}

export interface OrderingSettings {
  maxImagesPerOrder: number
  defaultDailyQuota: number
  defaultQuantity: number
  quantityShortcuts: number[]
  quantityStep: number
  generationConcurrency: number
  stableKnowledgeRatio: number
}

export interface OrderingTask {
  id: string
  scheduledOutputPath?: string
}

export type CreateOrderingOrder = (draft: OrderingDraft) => { order?: OrderingOrder; error?: string }
