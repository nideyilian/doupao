import { describe, expect, it } from 'vitest'
import type { FavoriteCollection, ScheduleItem } from '../types'
import {
  createDefaultScheduleRows,
  formatDateKey,
  getDueScheduleItemIds,
  getScheduleCompletionAction,
  getWeekDates,
  getWeekStartDate,
  isScheduledItemDue,
  resolveScheduleOutputTarget,
  resolveScheduleSourceCollectionId,
} from './schedule'

describe('schedule utilities', () => {
  it('calculates Monday week start and date keys', () => {
    expect(formatDateKey(getWeekStartDate(new Date(2026, 5, 18)))).toBe('2026-06-15')
    expect(formatDateKey(getWeekStartDate(new Date(2026, 5, 21)))).toBe('2026-06-15')
    expect(getWeekDates('2026-06-15').map(formatDateKey)).toEqual([
      '2026-06-15',
      '2026-06-16',
      '2026-06-17',
      '2026-06-18',
      '2026-06-19',
      '2026-06-20',
      '2026-06-21',
    ])
  })

  it('creates eight default rows', () => {
    expect(createDefaultScheduleRows()).toEqual([
      { id: 'row-1', name: '任务 1', order: 0 },
      { id: 'row-2', name: '任务 2', order: 1 },
      { id: 'row-3', name: '任务 3', order: 2 },
      { id: 'row-4', name: '任务 4', order: 3 },
      { id: 'row-5', name: '任务 5', order: 4 },
      { id: 'row-6', name: '任务 6', order: 5 },
      { id: 'row-7', name: '任务 7', order: 6 },
      { id: 'row-8', name: '任务 8', order: 7 },
    ])
  })

  it('detects due timed items once per day', () => {
    const item: ScheduleItem = {
      id: 'item-a',
      taskId: 'task-a',
      collectionId: 'collection-a',
      date: '2026-06-18',
      rowId: 'row-1',
      order: 0,
      count: 2,
      time: '09:30',
    }

    expect(isScheduledItemDue(item, new Date(2026, 5, 18, 9, 29))).toBe(false)
    expect(isScheduledItemDue(item, new Date(2026, 5, 18, 9, 30))).toBe(true)
    expect(isScheduledItemDue({ ...item, lastRunKey: '2026-06-18:item-a' }, new Date(2026, 5, 18, 10))).toBe(false)
  })

  it('resolves explicit output path before collection folder fallback', () => {
    const collections: FavoriteCollection[] = [
      { id: 'collection-a', name: '海报', createdAt: 1, updatedAt: 1 },
      { id: 'collection-b', name: '头像', createdAt: 1, updatedAt: 1 },
    ]

    expect(
      resolveScheduleOutputTarget({
        favoriteOutputPath: 'D:\\Exports\\Posters',
        collectionId: 'collection-a',
        taskCollectionIds: ['collection-b'],
        collections,
        defaultCollectionId: 'collection-b',
      }),
    ).toEqual({ path: 'D:\\Exports\\Posters' })

    expect(
      resolveScheduleOutputTarget({
        favoriteOutputPath: '',
        collectionId: 'collection-a',
        taskCollectionIds: ['collection-b'],
        collections,
        defaultCollectionId: 'collection-b',
      }),
    ).toEqual({ subFolder: '海报' })

    expect(
      resolveScheduleOutputTarget({
        favoriteOutputPath: '',
        collectionId: null,
        taskCollectionIds: ['collection-b'],
        collections,
        defaultCollectionId: 'collection-a',
      }),
    ).toEqual({ subFolder: '头像' })
  })

  it('treats all favorites as a filter instead of a source collection', () => {
    expect(
      resolveScheduleSourceCollectionId({
        selectedCollectionId: '__all_favorites__',
        allFavoritesCollectionId: '__all_favorites__',
        taskCollectionIds: ['collection-a', 'collection-b'],
        defaultCollectionId: 'collection-default',
      }),
    ).toBe('collection-a')

    expect(
      resolveScheduleSourceCollectionId({
        selectedCollectionId: 'collection-b',
        allFavoritesCollectionId: '__all_favorites__',
        taskCollectionIds: ['collection-a'],
        defaultCollectionId: 'collection-default',
      }),
    ).toBe('collection-b')
  })

  it('selects due timed items in table order and one sequential untimed item per row', () => {
    const items: ScheduleItem[] = [
      {
        id: 'timed-late',
        taskId: 'task',
        collectionId: null,
        date: '2026-06-18',
        rowId: 'row-2',
        order: 0,
        count: 1,
        time: '08:00',
      },
      {
        id: 'timed-first',
        taskId: 'task',
        collectionId: null,
        date: '2026-06-18',
        rowId: 'row-1',
        order: 0,
        count: 1,
        time: '08:00',
      },
      {
        id: 'seq-done',
        taskId: 'task',
        collectionId: null,
        date: '2026-06-18',
        rowId: 'row-3',
        order: 0,
        count: 1,
        time: null,
        status: 'done',
        lastRunKey: '2026-06-18:seq-done',
      },
      {
        id: 'seq-next',
        taskId: 'task',
        collectionId: null,
        date: '2026-06-18',
        rowId: 'row-3',
        order: 1,
        count: 1,
        time: null,
      },
      {
        id: 'seq-waiting',
        taskId: 'task',
        collectionId: null,
        date: '2026-06-18',
        rowId: 'row-4',
        order: 1,
        count: 1,
        time: null,
      },
      {
        id: 'seq-running',
        taskId: 'task',
        collectionId: null,
        date: '2026-06-18',
        rowId: 'row-4',
        order: 0,
        count: 1,
        time: null,
        status: 'running',
        lastRunKey: '2026-06-18:seq-running',
      },
    ]

    expect(getDueScheduleItemIds(items, createDefaultScheduleRows(), new Date(2026, 5, 18, 8))).toEqual([
      'timed-first',
      'timed-late',
      'seq-next',
    ])
  })

  it('asks for a supplement run when terminal scheduled tasks produce fewer images than requested', () => {
    const item: ScheduleItem = {
      id: 'schedule-a',
      taskId: 'task-a',
      collectionId: null,
      date: '2026-06-18',
      rowId: 'row-1',
      order: 0,
      count: 50,
      time: null,
      status: 'running',
      lastTaskIds: ['run-a'],
    }

    expect(
      getScheduleCompletionAction(item, [
        {
          id: 'run-a',
          status: 'done',
          outputImages: Array.from({ length: 40 }, (_, index) => `img-${index}`),
          error: null,
        },
      ]),
    ).toEqual({ type: 'supplement', count: 10 })
  })

  it('completes scheduled tasks without supplement when output count reaches the requested count', () => {
    const item: ScheduleItem = {
      id: 'schedule-a',
      taskId: 'task-a',
      collectionId: null,
      date: '2026-06-18',
      rowId: 'row-1',
      order: 0,
      count: 50,
      time: null,
      status: 'running',
      lastTaskIds: ['run-a'],
    }

    expect(
      getScheduleCompletionAction(item, [
        {
          id: 'run-a',
          status: 'done',
          outputImages: Array.from({ length: 51 }, (_, index) => `img-${index}`),
          error: null,
        },
      ]),
    ).toEqual({ type: 'done' })
  })

  it('stops supplementing when the latest terminal task errors without producing images', () => {
    const item: ScheduleItem = {
      id: 'schedule-a',
      taskId: 'task-a',
      collectionId: null,
      date: '2026-06-18',
      rowId: 'row-1',
      order: 0,
      count: 50,
      time: null,
      status: 'running',
      lastTaskIds: ['run-a', 'run-b'],
    }

    expect(
      getScheduleCompletionAction(item, [
        {
          id: 'run-a',
          status: 'done',
          outputImages: Array.from({ length: 40 }, (_, index) => `img-${index}`),
          error: null,
        },
        { id: 'run-b', status: 'error', outputImages: [], error: 'failed' },
      ]),
    ).toEqual({ type: 'error', error: 'failed' })
  })

  it('stops supplementing when a follow-up terminal task produces no images', () => {
    const item: ScheduleItem = {
      id: 'schedule-a',
      taskId: 'task-a',
      collectionId: null,
      date: '2026-06-18',
      rowId: 'row-1',
      order: 0,
      count: 50,
      time: null,
      status: 'running',
      lastTaskIds: ['run-a', 'run-b'],
    }

    expect(
      getScheduleCompletionAction(item, [
        {
          id: 'run-a',
          status: 'done',
          outputImages: Array.from({ length: 40 }, (_, index) => `img-${index}`),
          error: null,
        },
        { id: 'run-b', status: 'done', outputImages: [], error: null },
      ]),
    ).toEqual({ type: 'error', error: '日程任务补齐未产生新图片' })
  })
})
