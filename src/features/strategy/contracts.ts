export type StrategyRole = 'optimizer' | 'strategist' | 'admin'

export interface StrategyCatalogProduct {
  id: string
  name: string
  archived?: boolean
  version: number
}

export interface StrategyCatalogChannel {
  id: string
  name: string
  published: boolean
  archived?: boolean
}

export interface StrategyCatalogMaterialType {
  id: string
  name: string
  summary: string
  mode: 'fixed' | 'intelligent'
  strategy: string
  fixedRules?: string[]
  archived?: boolean
  version: number
}

export interface StrategyCatalog {
  products: StrategyCatalogProduct[]
  channels: StrategyCatalogChannel[]
  materialTypes: StrategyCatalogMaterialType[]
}

export interface StrategyKnowledgeBatch {
  id: string
  name: string
  folderPath: string
  status: 'ready' | 'analyzing' | 'review' | 'completed' | 'error'
  error?: string
}

export interface StrategyKnowledgeInsight {
  id: string
  batchId: string
  title: string
  category: 'stable' | 'exploratory'
}

export interface StrategyTestUnit {
  taskId?: string
  prompt: string
}

export interface StrategyTestOrder {
  id: string
  number: string
  createdBy: string
  createdAt: number
  status: string
  units: StrategyTestUnit[]
  totalImages: number
  isTest?: boolean
  strategyId?: string
}

export interface StrategyTask {
  id: string
  prompt: string
  outputImages: string[]
}
