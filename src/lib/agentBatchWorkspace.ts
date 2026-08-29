import type { BatchExecutionMode, BatchTaskInput } from './agentBatchPlanner'

export const AGENT_BATCH_DRAFT_STORAGE_KEY = 'doupao.agent-batch-draft.v1'
export const AGENT_BATCH_PRESETS_STORAGE_KEY = 'doupao.agent-batch-presets.v1'

export interface AgentBatchStrategyPreset {
  id: string
  name: string
  version: 1
  createdAt: number
  updatedAt: number
  strategyText: string
  defaultCopyRatio: number
  redundancyPercent: number
  dailyLimit: number
  executionMode: BatchExecutionMode
}

export interface AgentBatchDraft {
  version: 1
  id: string
  name: string
  filePath: string
  rows: BatchTaskInput[]
  outputRoot: string
  referenceRoot: string
  startDate: string
  dailyLimit: string
  redundancyPercent: string
  copyPercent: string
  executionMode: BatchExecutionMode
  activePresetId?: string
  updatedAt: number
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function getStorage(): StorageLike | null {
  return typeof localStorage === 'undefined' ? null : localStorage
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

export function createAgentBatchPreset(
  input: Omit<AgentBatchStrategyPreset, 'id' | 'version' | 'createdAt' | 'updatedAt'>,
  now = Date.now(),
): AgentBatchStrategyPreset {
  return {
    ...input,
    id: `agent-batch-preset-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    version: 1,
    createdAt: now,
    updatedAt: now,
  }
}

export function loadAgentBatchPresets(storage: StorageLike | null = getStorage()): AgentBatchStrategyPreset[] {
  const parsed = parseJson<unknown>(storage?.getItem(AGENT_BATCH_PRESETS_STORAGE_KEY) ?? null)
  if (!Array.isArray(parsed)) return []
  return parsed.filter(
    (item): item is AgentBatchStrategyPreset =>
      Boolean(item) &&
      typeof item === 'object' &&
      (item as AgentBatchStrategyPreset).version === 1 &&
      typeof (item as AgentBatchStrategyPreset).id === 'string' &&
      typeof (item as AgentBatchStrategyPreset).name === 'string',
  )
}

export function saveAgentBatchPresets(presets: AgentBatchStrategyPreset[], storage: StorageLike | null = getStorage()) {
  storage?.setItem(AGENT_BATCH_PRESETS_STORAGE_KEY, JSON.stringify(presets))
}

export function upsertAgentBatchPreset(
  presets: AgentBatchStrategyPreset[],
  preset: AgentBatchStrategyPreset,
): AgentBatchStrategyPreset[] {
  const index = presets.findIndex((item) => item.id === preset.id)
  if (index < 0) return [...presets, preset]
  return presets.map((item) => (item.id === preset.id ? preset : item))
}

export function applyAgentBatchPreset(
  rows: BatchTaskInput[],
  preset: AgentBatchStrategyPreset,
  overwrite = false,
): BatchTaskInput[] {
  return rows.map((row) => ({
    ...row,
    strategy: overwrite || !row.strategy?.trim() ? preset.strategyText : row.strategy,
    copyRatio: overwrite || row.copyRatio == null ? preset.defaultCopyRatio : row.copyRatio,
  }))
}

export function loadAgentBatchDraft(storage: StorageLike | null = getStorage()): AgentBatchDraft | null {
  const parsed = parseJson<AgentBatchDraft>(storage?.getItem(AGENT_BATCH_DRAFT_STORAGE_KEY) ?? null)
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.rows) || typeof parsed.name !== 'string') return null
  return parsed
}

export function saveAgentBatchDraft(draft: AgentBatchDraft, storage: StorageLike | null = getStorage()) {
  storage?.setItem(AGENT_BATCH_DRAFT_STORAGE_KEY, JSON.stringify(draft))
}

export function clearAgentBatchDraft(storage: StorageLike | null = getStorage()) {
  storage?.removeItem(AGENT_BATCH_DRAFT_STORAGE_KEY)
}
