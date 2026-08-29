import type { AgentBatchPlan } from './agentBatchPlanner'

export const AGENT_BATCH_QUEUE_STORAGE_KEY = 'doupao.agent-batch-queue.v1'
export const AGENT_BATCH_QUEUES_STORAGE_KEY = 'doupao.agent-batch-queues.v2'
export const AGENT_BATCH_QUEUE_UPDATED_EVENT = 'doupao-agent-batch-queue-updated'

export type AgentBatchQueueStatus = 'waiting' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

export interface AgentBatchQueueSubmission {
  taskId: string
  submittedAt: number
  plannedCount: number
}

export interface AgentBatchQueueReceipt {
  planName: string
  outputRoot: string
  manifestPath?: string
  apiProfileName: string
  apiModel: string
  maxConcurrent: number
  execution: 'immediate' | 'scheduled'
}

export interface AgentBatchQueue {
  version: 2
  id: string
  createdAt: number
  status: AgentBatchQueueStatus
  plan: AgentBatchPlan
  submitted: Record<string, AgentBatchQueueSubmission>
  receipt: AgentBatchQueueReceipt
  lastRunDate?: string
  lastError?: string
}

type LegacyAgentBatchQueue = {
  version: 1
  id: string
  createdAt: number
  paused: boolean
  plan: AgentBatchPlan
  submitted: Record<string, AgentBatchQueueSubmission>
  lastRunDate?: string
  lastError?: string
}
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function getStorage(): StorageLike | null {
  return typeof localStorage === 'undefined' ? null : localStorage
}

function isQueue(value: unknown): value is AgentBatchQueue {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    (value as AgentBatchQueue).version === 2 &&
    Array.isArray((value as AgentBatchQueue).plan?.days) &&
    typeof (value as AgentBatchQueue).id === 'string'
  )
}

function migrateLegacyQueue(queue: LegacyAgentBatchQueue): AgentBatchQueue {
  return {
    version: 2,
    id: queue.id,
    createdAt: queue.createdAt,
    status: queue.paused ? 'paused' : queue.lastError ? 'failed' : 'waiting',
    plan: queue.plan,
    submitted: queue.submitted ?? {},
    receipt: {
      planName: '已迁移批量计划',
      outputRoot: '',
      apiProfileName: '未知配置',
      apiModel: '未知模型',
      maxConcurrent: 0,
      execution: 'scheduled',
    },
    lastRunDate: queue.lastRunDate,
    lastError: queue.lastError,
  }
}

export function createAgentBatchQueue(
  plan: AgentBatchPlan,
  receiptOrNow: AgentBatchQueueReceipt | number = Date.now(),
  now = typeof receiptOrNow === 'number' ? receiptOrNow : Date.now(),
): AgentBatchQueue {
  const receipt: AgentBatchQueueReceipt =
    typeof receiptOrNow === 'number'
      ? {
          planName: '未命名批量任务',
          outputRoot: '',
          apiProfileName: '未知配置',
          apiModel: '未知模型',
          maxConcurrent: 0,
          execution: 'scheduled',
        }
      : receiptOrNow
  return { version: 2, id: `agent-batch-${now}`, createdAt: now, status: 'waiting', plan, submitted: {}, receipt }
}

export function loadAgentBatchQueues(storage: StorageLike | null = getStorage()): AgentBatchQueue[] {
  if (!storage) return []
  try {
    const current = JSON.parse(storage.getItem(AGENT_BATCH_QUEUES_STORAGE_KEY) ?? 'null')
    if (Array.isArray(current)) return current.filter(isQueue)
    const legacy = JSON.parse(storage.getItem(AGENT_BATCH_QUEUE_STORAGE_KEY) ?? 'null') as LegacyAgentBatchQueue | null
    return legacy?.version === 1 && Array.isArray(legacy.plan?.days) ? [migrateLegacyQueue(legacy)] : []
  } catch {
    return []
  }
}

export function saveAgentBatchQueues(queues: AgentBatchQueue[], storage: StorageLike | null = getStorage()) {
  storage?.setItem(AGENT_BATCH_QUEUES_STORAGE_KEY, JSON.stringify(queues))
}

export function updateAgentBatchQueue(queue: AgentBatchQueue, storage: StorageLike | null = getStorage()) {
  const queues = loadAgentBatchQueues(storage)
  const index = queues.findIndex((item) => item.id === queue.id)
  saveAgentBatchQueues(
    index < 0 ? [...queues, queue] : queues.map((item) => (item.id === queue.id ? queue : item)),
    storage,
  )
}

export function loadAgentBatchQueue(storage: StorageLike | null = getStorage()): AgentBatchQueue | null {
  return loadAgentBatchQueues(storage).at(-1) ?? null
}

export function saveAgentBatchQueue(queue: AgentBatchQueue, storage: StorageLike | null = getStorage()) {
  updateAgentBatchQueue(queue, storage)
}

export function clearAgentBatchQueue(storage: StorageLike | null = getStorage()) {
  storage?.removeItem(AGENT_BATCH_QUEUE_STORAGE_KEY)
  storage?.removeItem(AGENT_BATCH_QUEUES_STORAGE_KEY)
}

export function getDueBatchUnits(queue: AgentBatchQueue, dateKey: string) {
  for (const day of queue.plan.days) {
    if (day.date > dateKey) break
    const pending = day.units.filter((unit) => !queue.submitted[unit.id])
    if (pending.length > 0) return pending
  }
  return []
}

export function getBatchQueueProgress(queue: AgentBatchQueue) {
  const allUnits = queue.plan.days.flatMap((day) => day.units)
  const submittedUnits = allUnits.filter((unit) => Boolean(queue.submitted[unit.id]))
  return {
    totalUnits: allUnits.length,
    submittedUnits: submittedUnits.length,
    submittedImages: submittedUnits.reduce((sum, unit) => sum + unit.plannedCount, 0),
    totalImages: allUnits.reduce((sum, unit) => sum + unit.plannedCount, 0),
    completed: submittedUnits.length === allUnits.length,
  }
}

export function getAgentBatchQueueStatusLabel(status: AgentBatchQueueStatus) {
  return (
    {
      waiting: '等待执行',
      running: '正在提交',
      paused: '已暂停',
      completed: '已全部提交',
      failed: '提交失败',
      cancelled: '已取消',
    } as const
  )[status]
}
