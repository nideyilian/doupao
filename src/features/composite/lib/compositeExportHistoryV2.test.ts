import { describe, expect, it } from 'vitest'
import { addCompositeHistoryRecord } from './compositeExportHistoryV2'
import type { CompositeV2HistoryRecord } from './compositeV2Types'

const record = (id: string, endedAt: number): CompositeV2HistoryRecord => ({
  id,
  status: 'completed',
  startedAt: endedAt - 1,
  endedAt,
  backgroundFolders: ['D:/bg'],
  recursive: false,
  backgroundCount: 1,
  presetGroupName: 'group',
  enabledPresetCount: 1,
  plannedCount: 1,
  successCount: 1,
  failureCount: 0,
  successes: [],
  failures: [],
})

describe('addCompositeHistoryRecord', () => {
  it('sorts by endedAt from newest to oldest and trims to retention', () => {
    const original = [record('a', 1), record('b', 3)]
    const history = addCompositeHistoryRecord(original, record('c', 2), 2)

    expect(history.map((item) => item.id)).toEqual(['b', 'c'])
    expect(history).not.toBe(original)
    expect(original.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('replaces older records with the same id', () => {
    const original = [record('a', 1), record('b', 2)]
    const updated = record('b', 3)

    const history = addCompositeHistoryRecord(original, updated, 10)

    expect(history.map((item) => item.id)).toEqual(['b', 'a'])
    expect(history[0]).toBe(updated)
    expect(original.map((item) => item.endedAt)).toEqual([1, 2])
  })
})
