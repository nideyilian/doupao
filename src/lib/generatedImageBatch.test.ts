import { describe, expect, it } from 'vitest'
import type { TaskRecord, WorkspaceTab } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { assignMissingGeneratedImageBatches, getNextGeneratedImageBatch } from './generatedImageBatch'

function task(overrides: Partial<TaskRecord> & Pick<TaskRecord, 'id' | 'createdAt'>): TaskRecord {
  return {
    prompt: '',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    outputImages: [],
    status: 'done',
    error: null,
    finishedAt: overrides.createdAt,
    elapsed: 1,
    ...overrides,
  }
}

function tab(id: string, tasks: TaskRecord[]): WorkspaceTab {
  return {
    id,
    name: id,
    groupId: null,
    prompt: '',
    inputImages: [],
    inputImageFolder: null,
    params: { ...DEFAULT_PARAMS },
    maskDraft: null,
    maskEditorImageId: null,
    customOutputPath: '',
    tasks,
    createdAt: 0,
    updatedAt: 0,
    order: 0,
  }
}

describe('generated image batches', () => {
  const july2 = new Date(2026, 6, 2, 12).getTime()
  const july3Morning = new Date(2026, 6, 3, 8).getTime()
  const july3Noon = new Date(2026, 6, 3, 12).getTime()
  const july3Evening = new Date(2026, 6, 3, 18).getTime()
  const july4 = new Date(2026, 6, 4, 8).getTime()

  it('continues after the largest batch on the same local date', () => {
    expect(
      getNextGeneratedImageBatch(
        [
          { createdAt: july3Morning, filenameBatch: 1 },
          { createdAt: july3Noon, filenameBatch: 3 },
          { createdAt: july2, filenameBatch: 9 },
        ],
        july3Evening,
      ),
    ).toBe(4)
  })

  it('restarts at one on the next local date', () => {
    expect(getNextGeneratedImageBatch([{ createdAt: july3Morning, filenameBatch: 4 }], july4)).toBe(1)
  })

  it('backfills each tab independently in creation order', () => {
    const kuaishouOlder = task({ id: 'ks-old', createdAt: july3Morning })
    const kuaishouNewer = task({ id: 'ks-new', createdAt: july3Noon })
    const xiaohongshu = task({ id: 'xhs', createdAt: july3Evening })

    const result = assignMissingGeneratedImageBatches(
      [kuaishouNewer, xiaohongshu, kuaishouOlder],
      [tab('kuaishou', [kuaishouNewer, kuaishouOlder]), tab('xiaohongshu', [xiaohongshu])],
    )

    expect(result.tasks.map((item) => [item.id, item.filenameBatch])).toEqual([
      ['ks-new', 2],
      ['xhs', 1],
      ['ks-old', 1],
    ])
    expect(result.changedTaskIds).toEqual(['ks-old', 'ks-new', 'xhs'])
  })

  it('preserves valid batches and assigns missing values after the maximum', () => {
    const persisted = task({ id: 'persisted', createdAt: july3Noon, filenameBatch: 4 })
    const missing = task({ id: 'missing', createdAt: july3Morning })

    const result = assignMissingGeneratedImageBatches([persisted, missing], [tab('kuaishou', [persisted, missing])])

    expect(result.tasks[0]).toBe(persisted)
    expect(result.tasks.map((item) => item.filenameBatch)).toEqual([4, 5])
    expect(result.changedTaskIds).toEqual(['missing'])
  })

  it('uses scheduled output labels as independent fallback scopes', () => {
    const kuaishou = task({
      id: 'scheduled-ks',
      createdAt: july3Morning,
      scheduledOutputSubFolder: '快手',
    })
    const xiaohongshu = task({
      id: 'scheduled-xhs',
      createdAt: july3Noon,
      scheduledOutputSubFolder: '小红书',
    })

    const result = assignMissingGeneratedImageBatches([kuaishou, xiaohongshu], [])

    expect(result.tasks.map((item) => item.filenameBatch)).toEqual([1, 1])
  })
})
