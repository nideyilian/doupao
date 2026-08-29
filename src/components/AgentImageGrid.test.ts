import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { getAgentImageGridEntries } from './AgentImageGrid'

function task(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    id: 'task-a',
    prompt: '测试提示词',
    params: { ...DEFAULT_PARAMS, n: 1 },
    inputImageIds: [],
    outputImages: [],
    status: 'running',
    error: null,
    createdAt: 1,
    finishedAt: null,
    elapsed: null,
    ...overrides,
  }
}

describe('Agent image grid entries', () => {
  it('flattens output images without changing task or image order', () => {
    const taskA = task({ id: 'task-a', outputImages: ['image-a', 'image-b'], status: 'done' })
    const taskB = task({ id: 'task-b', outputImages: ['image-c'], status: 'done' })

    const entries = getAgentImageGridEntries([
      { task: taskA, taskId: taskA.id },
      { task: taskB, taskId: taskB.id },
    ])

    expect(entries.map((entry) => entry.imageId)).toEqual(['image-a', 'image-b', 'image-c'])
    expect(entries.map((entry) => entry.taskId)).toEqual(['task-a', 'task-a', 'task-b'])
  })

  it('keeps stable placeholders for running and deleted tasks', () => {
    const runningTask = task({ id: 'task-running' })

    const entries = getAgentImageGridEntries([
      { task: runningTask, taskId: runningTask.id },
      { task: null, taskId: 'task-deleted' },
    ])

    expect(entries).toMatchObject([
      { taskId: 'task-running', imageId: null, task: runningTask },
      { taskId: 'task-deleted', imageId: null, task: null },
    ])
  })
})
