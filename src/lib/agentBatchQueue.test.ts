import { describe, expect, it } from 'vitest'
import {
  createAgentBatchQueue,
  getBatchQueueProgress,
  getDueBatchUnits,
  loadAgentBatchQueue,
  loadAgentBatchQueues,
  saveAgentBatchQueue,
} from './agentBatchQueue'
import type { AgentBatchPlan } from './agentBatchPlanner'

function plan(): AgentBatchPlan {
  const unit = (id: string, date: string, plannedCount: number) => ({
    id,
    sourceId: 'row',
    date,
    sku: 'S',
    product: 'P',
    channel: 'C',
    specification: '1:1',
    direction: 'D',
    strategy: 'S',
    copyMode: 'without-copy' as const,
    targetCount: plannedCount,
    plannedCount,
    outputFolder: 'D:/out',
    prompt: 'prompt',
  })
  return {
    targetCount: 5,
    plannedCount: 5,
    redundancyCount: 0,
    days: [
      { date: '2026-07-15', plannedCount: 3, units: [unit('a', '2026-07-15', 3)] },
      { date: '2026-07-16', plannedCount: 2, units: [unit('b', '2026-07-16', 2)] },
    ],
  }
}

describe('agentBatchQueue', () => {
  it('persists and restores a queue', () => {
    const memory = new Map<string, string>()
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value)
      },
      removeItem: (key: string) => {
        memory.delete(key)
      },
    }
    const queue = createAgentBatchQueue(plan(), 1)
    saveAgentBatchQueue(queue, storage)
    expect(loadAgentBatchQueue(storage)?.id).toBe('agent-batch-1')
  })

  it('returns only due and unsubmitted units', () => {
    const queue = createAgentBatchQueue(plan())
    queue.submitted.a = { taskId: 'task-a', submittedAt: 1, plannedCount: 3 }
    expect(getDueBatchUnits(queue, '2026-07-15')).toEqual([])
    expect(getDueBatchUnits(queue, '2026-07-16').map((unit) => unit.id)).toEqual(['b'])
    expect(getBatchQueueProgress(queue)).toMatchObject({ submittedUnits: 1, submittedImages: 3, completed: false })
  })

  it('returns only one planned day when catching up', () => {
    const queue = createAgentBatchQueue(plan())
    expect(getDueBatchUnits(queue, '2026-07-20').map((unit) => unit.id)).toEqual(['a'])
  })

  it('keeps multiple queue receipts instead of replacing the previous queue', () => {
    const memory = new Map<string, string>()
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value)
      },
      removeItem: (key: string) => {
        memory.delete(key)
      },
    }
    saveAgentBatchQueue(createAgentBatchQueue(plan(), 1), storage)
    saveAgentBatchQueue(createAgentBatchQueue(plan(), 2), storage)
    expect(loadAgentBatchQueues(storage).map((queue) => queue.id)).toEqual(['agent-batch-1', 'agent-batch-2'])
  })
})
