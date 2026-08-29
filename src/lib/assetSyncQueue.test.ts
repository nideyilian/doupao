import { describe, expect, it, vi } from 'vitest'
import type { TaskParams, TaskRecord } from '../types'
import { createAssetSyncQueue } from './assetSyncQueue'

function makeTask(id: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id,
    prompt: 'p',
    params: {} as TaskParams,
    inputImageIds: [],
    outputImages: ['img-1'],
    maskTargetImageId: null,
    maskImageId: null,
    status: 'done',
    error: null,
    createdAt: 1000,
    finishedAt: 2000,
    elapsed: 1000,
    ...overrides,
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('createAssetSyncQueue', () => {
  it('processes enqueued tasks serially and reads the latest snapshot', async () => {
    const tasks = new Map([
      ['task-1', makeTask('task-1', { prompt: 'v1' })],
      ['task-2', makeTask('task-2')],
    ])
    const getTask = vi.fn(async (id: string) => tasks.get(id))
    const syncTask = vi.fn(async (task: TaskRecord) => {})
    const queue = createAssetSyncQueue({ getTask, syncTask })

    queue.enqueue('task-1')
    queue.enqueue('task-2')
    await queue.flush()

    expect(syncTask).toHaveBeenCalledTimes(2)
    expect(syncTask.mock.calls.map(([task]) => task.id)).toEqual(['task-1', 'task-2'])
    expect(getTask).toHaveBeenCalledWith('task-1')
  })

  it('merges repeated enqueues of the same task id', async () => {
    const tasks = new Map([['task-1', makeTask('task-1', { prompt: 'latest' })]])
    const getTask = vi.fn(async (id: string) => tasks.get(id))
    const syncTask = vi.fn(async (task: TaskRecord) => {})
    const queue = createAssetSyncQueue({ getTask, syncTask })

    queue.enqueue('task-1')
    queue.enqueue('task-1')
    queue.enqueue('task-1')
    await queue.flush()

    expect(syncTask).toHaveBeenCalledTimes(1)
    expect(syncTask.mock.calls[0]![0].prompt).toBe('latest')
  })

  it('continues after a failing task and reports the error', async () => {
    const tasks = new Map([
      ['bad', makeTask('bad')],
      ['good', makeTask('good')],
    ])
    const getTask = vi.fn(async (id: string) => tasks.get(id))
    const syncTask = vi.fn(async (task: TaskRecord) => {
      if (task.id === 'bad') throw new Error('sync boom')
    })
    const onError = vi.fn()
    const queue = createAssetSyncQueue({ getTask, syncTask, onError })

    queue.enqueue('bad')
    queue.enqueue('good')
    await queue.flush()

    expect(syncTask).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledWith('bad', expect.any(Error))
  })

  it('does not call sync when the task no longer exists', async () => {
    const getTask = vi.fn(async () => undefined)
    const syncTask = vi.fn(async () => {})
    const queue = createAssetSyncQueue({ getTask, syncTask })

    queue.enqueue('ghost')
    await queue.flush()

    expect(syncTask).not.toHaveBeenCalled()
  })

  it('flushes immediately when idle', async () => {
    const getTask = vi.fn()
    const syncTask = vi.fn()
    const queue = createAssetSyncQueue({ getTask, syncTask })
    await expect(queue.flush()).resolves.toBeUndefined()
    expect(syncTask).not.toHaveBeenCalled()
  })

  it('processes tasks enqueued while draining', async () => {
    const tasks = new Map([['task-1', makeTask('task-1')]])
    const getTask = vi.fn(async (id: string) => tasks.get(id))
    const syncTask = vi.fn(async () => {
      if (syncTask.mock.calls.length === 1) queue.enqueue('task-2')
    })
    const queue = createAssetSyncQueue({ getTask, syncTask })
    tasks.set('task-2', makeTask('task-2'))

    queue.enqueue('task-1')
    await queue.flush()

    expect(syncTask).toHaveBeenCalledTimes(2)
  })

  it('serializes concurrent syncs with a blocking syncTask', async () => {
    const gate = deferred()
    const tasks = new Map([
      ['a', makeTask('a')],
      ['b', makeTask('b')],
    ])
    const getTask = vi.fn(async (id: string) => tasks.get(id))
    const active = new Set<string>()
    const seen = new Set<string>()
    const syncTask = vi.fn(async (task: TaskRecord) => {
      seen.add(task.id)
      active.add(task.id)
      if (task.id === 'a') await gate.promise
      active.delete(task.id)
    })
    const queue = createAssetSyncQueue({ getTask, syncTask })

    queue.enqueue('a')
    queue.enqueue('b')
    await new Promise((r) => setTimeout(r, 0))
    expect(seen).toEqual(new Set(['a']))
    gate.resolve()
    await queue.flush()
    expect(seen).toEqual(new Set(['a', 'b']))
  })
})
