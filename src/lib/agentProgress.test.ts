import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type AgentRound, type TaskRecord } from '../types'
import { getAgentExecutionProgress } from './agentProgress'

function round(overrides: Partial<AgentRound> = {}): AgentRound {
  return {
    id: 'round-a',
    index: 1,
    userMessageId: 'user-a',
    prompt: '生成一张产品海报',
    inputImageIds: [],
    outputTaskIds: [],
    status: 'running',
    error: null,
    createdAt: 1,
    finishedAt: null,
    ...overrides,
  }
}

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-a',
    prompt: '生成一张产品海报',
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

function getStep(
  progress: ReturnType<typeof getAgentExecutionProgress>,
  key: 'understand' | 'plan' | 'generate' | 'save',
) {
  return progress?.steps.find((step) => step.key === key)
}

describe('getAgentExecutionProgress', () => {
  it('explains the planning phase before image tasks are created', () => {
    const progress = getAgentExecutionProgress({ round: round(), tasks: [] })

    expect(progress?.summary).toContain('规划图片生成方案')
    expect(getStep(progress, 'understand')?.status).toBe('done')
    expect(getStep(progress, 'plan')?.status).toBe('running')
    expect(getStep(progress, 'generate')?.status).toBe('pending')
    expect(getStep(progress, 'save')?.status).toBe('pending')
  })

  it('reports aggregate progress for a running image batch', () => {
    const completedTask = task({ id: 'task-done', status: 'done', outputImages: ['image-a'] })
    const runningTask = task({ id: 'task-running', progressStage: 'generating' })
    const waitingTask = task({ id: 'task-waiting', progressStage: 'relay-received' })
    const progress = getAgentExecutionProgress({
      round: round({ outputTaskIds: [completedTask.id, runningTask.id, waitingTask.id] }),
      tasks: [completedTask, runningTask, waitingTask],
    })

    expect(progress?.summary).toBe('正在生成图片：已完成 1 / 3 张…')
    expect(getStep(progress, 'generate')).toMatchObject({
      status: 'running',
      detail: '已生成 1 / 3 张，继续等待剩余图片。',
    })
  })

  it('summarizes a completed image round', () => {
    const firstTask = task({ id: 'task-a', status: 'done', outputImages: ['image-a'] })
    const secondTask = task({ id: 'task-b', status: 'done', outputImages: ['image-b'] })
    const progress = getAgentExecutionProgress({
      round: round({
        outputTaskIds: [firstTask.id, secondTask.id],
        status: 'done',
        finishedAt: 2,
      }),
      tasks: [firstTask, secondTask],
      hasAssistantText: true,
    })

    expect(progress?.summary).toBe('本轮执行完成。')
    expect(progress?.steps.map((step) => step.status)).toEqual(['done', 'done', 'done', 'done'])
  })

  it('keeps partial failures visible after a round completes', () => {
    const completedTask = task({ id: 'task-a', status: 'done', outputImages: ['image-a'] })
    const failedTask = task({ id: 'task-b', status: 'error', error: '内容审核未通过' })
    const progress = getAgentExecutionProgress({
      round: round({
        outputTaskIds: [completedTask.id, failedTask.id],
        status: 'done',
        finishedAt: 2,
      }),
      tasks: [completedTask, failedTask],
    })

    expect(progress?.summary).toBe('本轮执行完成，1 / 2 张图片生成成功。')
    expect(progress?.tone).toBe('warning')
    expect(getStep(progress, 'generate')).toMatchObject({
      status: 'warning',
      detail: '已生成 1 / 2 张，1 张未完成。',
    })
  })

  it('preserves a stopped state in the execution steps', () => {
    const stoppedTask = task({ status: 'error', error: '已停止生成。' })
    const progress = getAgentExecutionProgress({
      round: round({ outputTaskIds: [stoppedTask.id], status: 'error', error: '已停止生成。' }),
      tasks: [stoppedTask],
    })

    expect(progress?.summary).toBe('已停止生成，当前结果会保留。')
    expect(progress?.tone).toBe('warning')
    expect(getStep(progress, 'generate')?.status).toBe('stopped')
    expect(getStep(progress, 'save')?.status).toBe('stopped')
  })

  it('shows a concrete failed state when no image is generated', () => {
    const failedTask = task({ status: 'error', error: 'API key 无效' })
    const progress = getAgentExecutionProgress({
      round: round({ outputTaskIds: [failedTask.id], status: 'error', error: 'API key 无效' }),
      tasks: [failedTask],
    })

    expect(progress?.summary).toBe('生成失败，已记录原因。')
    expect(progress?.tone).toBe('error')
    expect(getStep(progress, 'generate')?.status).toBe('error')
    expect(getStep(progress, 'save')?.status).toBe('error')
  })
})
