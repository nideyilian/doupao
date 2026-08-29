import { describe, expect, it } from 'vitest'
import type { TaskRecord } from '../types'
import { formatSopBatchElapsed, getSopBatchElapsedMs, groupSopBatchTasks } from './sopBatchTaskGrouping'

function task(
  id: string,
  createdAt: number,
  status: TaskRecord['status'],
  batchId?: string,
  promptIndex?: number,
  snapshotId?: string,
): TaskRecord {
  return {
    id,
    createdAt,
    status,
    prompt: id,
    outputImages: [],
    sopBatch: batchId
      ? { batchId, snapshotId, sopId: 'sop-1', sopName: '商品 SOP', promptIndex: promptIndex ?? 1, promptCount: 3 }
      : undefined,
  } as unknown as TaskRecord
}

describe('groupSopBatchTasks', () => {
  it('groups SOP tasks, preserves ordinary tasks, and orders prompts by index', () => {
    const result = groupSopBatchTasks([
      task('ordinary', 30, 'done'),
      task('third', 20, 'done', 'batch-1', 3),
      task('first', 10, 'running', 'batch-1', 1),
      task('second', 15, 'error', 'batch-1', 2),
    ])

    expect(result).toHaveLength(2)
    const batch = result.find((item) => item.kind === 'sop-batch')
    expect(batch).toMatchObject({ kind: 'sop-batch', summary: { total: 3, running: 1, completed: 1, failed: 1 } })
    if (batch?.kind === 'sop-batch') expect(batch.tasks.map((item) => item.id)).toEqual(['first', 'second', 'third'])
  })

  it('uses the elapsed wall time of a finished batch', () => {
    const tasks = [
      { ...task('first', 1_000, 'done', 'batch-1', 1), finishedAt: 4_000, elapsed: 3_000 },
      { ...task('second', 1_200, 'done', 'batch-1', 2), finishedAt: 7_000, elapsed: 5_800 },
    ]

    expect(getSopBatchElapsedMs(tasks, 9_000)).toBe(6_000)
    expect(formatSopBatchElapsed(getSopBatchElapsedMs(tasks, 9_000))).toBe('00:06')
  })

  it('shows only the latest retry attempt for the same prompt', () => {
    const result = groupSopBatchTasks([
      task('failed-attempt', 10, 'error', 'batch-1', 1),
      task('retry-attempt', 20, 'done', 'batch-1', 1),
    ])

    const batch = result.find((item) => item.kind === 'sop-batch')
    expect(batch).toMatchObject({ kind: 'sop-batch', summary: { total: 1, completed: 1, failed: 0 } })
    if (batch?.kind === 'sop-batch') expect(batch.tasks.map((item) => item.id)).toEqual(['retry-attempt'])
  })

  it('groups all request batches from the same SOP run into one card', () => {
    const result = groupSopBatchTasks([
      task('first-request', 10, 'done', 'request-batch-1', 1, 'snapshot-1'),
      task('second-request', 20, 'running', 'request-batch-2', 2, 'snapshot-1'),
      task('other-run', 30, 'done', 'request-batch-3', 1, 'snapshot-2'),
    ])

    const batches = result.filter((item) => item.kind === 'sop-batch')
    expect(batches).toHaveLength(2)
    const firstRun = batches.find((item) => item.groupId === 'snapshot-1')
    expect(firstRun?.id).toBe('sop-batch:snapshot-1')
    expect(firstRun?.tasks.map((item) => item.id)).toEqual(['first-request', 'second-request'])
  })

  it('falls back to request batch ids for legacy tasks without snapshots', () => {
    const result = groupSopBatchTasks([
      task('legacy-1', 10, 'done', 'legacy-batch', 1),
      task('legacy-2', 20, 'done', 'legacy-batch', 2),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ kind: 'sop-batch', groupId: 'legacy-batch' })
  })

  it('continues counting elapsed time while any batch task is running', () => {
    const tasks = [
      { ...task('first', 1_000, 'done', 'batch-1', 1), finishedAt: 2_000, elapsed: 1_000 },
      { ...task('second', 1_200, 'running', 'batch-1', 2), finishedAt: null, elapsed: null },
    ]

    expect(getSopBatchElapsedMs(tasks, 5_400)).toBe(4_400)
    expect(formatSopBatchElapsed(getSopBatchElapsedMs(tasks, 5_400))).toBe('00:04')
  })
})
