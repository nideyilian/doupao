import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord, type WorkspaceTab } from '../types'
import { formatGenerationStatsDuration, getGenerationStats, getNextGenerationStatsRange } from './generationStats'

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-a',
    prompt: 'prompt',
    params: { ...DEFAULT_PARAMS, n: 1 },
    inputImageIds: [],
    outputImages: [],
    status: 'done',
    error: null,
    createdAt: new Date(2026, 5, 18, 1).getTime(),
    finishedAt: new Date(2026, 5, 18, 1, 1).getTime(),
    elapsed: 60_000,
    ...overrides,
  }
}

function tab(overrides: Partial<WorkspaceTab> = {}): WorkspaceTab {
  return {
    id: 'tab-a',
    name: '标签 A',
    groupId: null,
    prompt: '',
    inputImages: [],
    inputImageFolder: null,
    params: DEFAULT_PARAMS,
    maskDraft: null,
    maskEditorImageId: null,
    customOutputPath: '',
    tasks: [],
    createdAt: new Date(2026, 5, 18).getTime(),
    updatedAt: new Date(2026, 5, 18).getTime(),
    order: 0,
    ...overrides,
  }
}

describe('getGenerationStats', () => {
  const now = new Date(2026, 5, 18, 12).getTime()

  it('counts images, failures, and elapsed time for today', () => {
    const stats = getGenerationStats(
      [
        task({
          id: 'done',
          params: { ...DEFAULT_PARAMS, n: 4 },
          outputImages: ['1', '2', '3'],
          batchItemStatuses: ['done', 'done', 'done', 'error'],
          elapsed: 90_000,
        }),
        task({
          id: 'failed',
          status: 'error',
          error: 'bad',
          outputImages: [],
          elapsed: 10_000,
        }),
        task({
          id: 'yesterday',
          createdAt: new Date(2026, 5, 17, 23, 59).getTime(),
          outputImages: ['old'],
          elapsed: 5_000,
        }),
      ],
      [],
      'today',
      now,
    )

    expect(stats.totals.total).toBe(5)
    expect(stats.totals.success).toBe(3)
    expect(stats.totals.failure).toBe(2)
    expect(stats.totals.elapsedMs).toBe(100_000)
  })

  it('includes running task duration up to now', () => {
    const stats = getGenerationStats(
      [
        task({
          status: 'running',
          createdAt: now - 15_000,
          finishedAt: null,
          elapsed: null,
        }),
      ],
      [],
      'today',
      now,
    )

    expect(stats.totals.total).toBe(1)
    expect(stats.totals.elapsedMs).toBe(15_000)
  })

  it('uses rolling seven and thirty day windows', () => {
    const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000
    const twentyDaysAgo = now - 20 * 24 * 60 * 60 * 1000

    expect(
      getGenerationStats(
        [
          task({ id: 'eight', createdAt: eightDaysAgo, outputImages: ['eight'] }),
          task({ id: 'twenty', createdAt: twentyDaysAgo, outputImages: ['twenty'] }),
        ],
        [],
        '7d',
        now,
      ).totals.success,
    ).toBe(0)

    expect(
      getGenerationStats(
        [
          task({ id: 'eight', createdAt: eightDaysAgo, outputImages: ['eight'] }),
          task({ id: 'twenty', createdAt: twentyDaysAgo, outputImages: ['twenty'] }),
        ],
        [],
        '30d',
        now,
      ).totals.success,
    ).toBe(2)
  })

  it('groups matching tasks by workspace tab without double counting totals', () => {
    const shared = task({ id: 'shared', outputImages: ['1', '2'], elapsed: 20_000 })
    const failed = task({
      id: 'failed',
      status: 'error',
      error: 'bad',
      outputImages: [],
      elapsed: 5_000,
    })

    const stats = getGenerationStats(
      [shared, failed],
      [tab({ id: 'tab-a', name: '标签 A', tasks: [shared] }), tab({ id: 'tab-b', name: '标签 B', tasks: [failed] })],
      'today',
      now,
    )

    expect(stats.totals.total).toBe(3)
    expect(stats.byTab).toEqual([
      {
        id: 'tab-a',
        name: '标签 A',
        total: 2,
        success: 2,
        failure: 0,
        elapsedMs: 20_000,
      },
      {
        id: 'tab-b',
        name: '标签 B',
        total: 1,
        success: 0,
        failure: 1,
        elapsedMs: 5_000,
      },
    ])
  })
})

describe('formatGenerationStatsDuration', () => {
  it('formats compact durations for header display', () => {
    expect(formatGenerationStatsDuration(59_000)).toBe('59秒')
    expect(formatGenerationStatsDuration(61_000)).toBe('1分')
    expect(formatGenerationStatsDuration(3_660_000)).toBe('1小时1分')
  })
})

describe('getNextGenerationStatsRange', () => {
  it('cycles today, seven days, and thirty days in order', () => {
    expect(getNextGenerationStatsRange('today')).toBe('7d')
    expect(getNextGenerationStatsRange('7d')).toBe('30d')
    expect(getNextGenerationStatsRange('30d')).toBe('today')
  })
})
