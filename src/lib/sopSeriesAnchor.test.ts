import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import {
  buildSopSeriesAnchoredPrompt,
  getSopSeriesAnchorImageId,
  isTaskSettled,
  SOP_SERIES_ANCHOR_INSTRUCTION,
  waitForSopSeriesAnchor,
} from './sopSeriesAnchor'

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-1',
    prompt: '系列图提示词',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    outputImages: [],
    status: 'running',
    error: null,
    createdAt: 1,
    finishedAt: null,
    ...overrides,
  } as TaskRecord
}

afterEach(() => {
  vi.useRealTimers()
})

describe('sopSeriesAnchor', () => {
  it('prepends the anchor instruction so the reference only locks the visual language', () => {
    expect(buildSopSeriesAnchoredPrompt('  本张画面：咖啡杯  ')).toBe(
      `${SOP_SERIES_ANCHOR_INSTRUCTION}\n本张画面：咖啡杯`,
    )
    expect(buildSopSeriesAnchoredPrompt('   ')).toBe('')
  })

  it('uses the first output image and only treats finished tasks as settled', () => {
    expect(getSopSeriesAnchorImageId(task({ outputImages: ['image-1', 'image-2'] }))).toBe('image-1')
    expect(getSopSeriesAnchorImageId(task({ outputImages: [] }))).toBeNull()
    expect(getSopSeriesAnchorImageId(undefined)).toBeNull()
    expect(isTaskSettled(task({ status: 'running' }))).toBe(false)
    expect(isTaskSettled(task({ status: 'done' }))).toBe(true)
    expect(isTaskSettled(undefined)).toBe(false)
  })

  it('resolves with the anchor image as soon as the first picture lands', async () => {
    vi.useFakeTimers()
    let current = task({ outputImages: [] })
    const pending = waitForSopSeriesAnchor({ taskId: 'task-1', getTask: () => current, pollMs: 10 })
    current = task({ outputImages: ['image-1'] })
    await vi.advanceTimersByTimeAsync(10)

    await expect(pending).resolves.toBe('image-1')
  })

  it('returns null when the anchor task finishes without any image', async () => {
    vi.useFakeTimers()
    const pending = waitForSopSeriesAnchor({
      taskId: 'task-1',
      getTask: () => task({ status: 'error' }),
      pollMs: 10,
    })
    await vi.advanceTimersByTimeAsync(10)

    await expect(pending).resolves.toBeNull()
  })

  it('gives up after the timeout so a slow group cannot stall the batch', async () => {
    vi.useFakeTimers()
    const pending = waitForSopSeriesAnchor({
      taskId: 'task-1',
      getTask: () => task({ outputImages: [] }),
      pollMs: 10,
      timeoutMs: 30,
    })
    await vi.advanceTimersByTimeAsync(60)

    await expect(pending).resolves.toBeNull()
  })

  it('stops waiting when the submission is cancelled', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const pending = waitForSopSeriesAnchor({
      taskId: 'task-1',
      getTask: () => task({ outputImages: [] }),
      pollMs: 10,
      signal: controller.signal,
    })
    controller.abort()

    await expect(pending).resolves.toBeNull()
  })
})
