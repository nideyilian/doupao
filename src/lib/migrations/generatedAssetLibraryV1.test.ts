import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskParams, TaskRecord, WorkspaceTab } from '../../types'
import type { MigrationJournal } from './registry'

const mock = vi.hoisted(() => ({
  getAllTasks: vi.fn(),
  upsertFromTask: vi.fn(),
}))

vi.mock('../db', () => ({ getAllTasks: mock.getAllTasks }))
vi.mock('../assetLibraryRepository', () => ({ upsertFromTask: mock.upsertFromTask }))

import { GENERATED_ASSET_LIBRARY_BATCH_SIZE, runGeneratedAssetLibraryMigration } from './generatedAssetLibraryV1'

function makeTask(id: string, createdAt: number): TaskRecord {
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
    createdAt,
    finishedAt: 2000,
    elapsed: 1000,
  }
}

function createJournalStore() {
  const records = new Map<string, MigrationJournal>()
  return {
    get: async (id: string) => records.get(id),
    put: async (record: MigrationJournal) => {
      records.set(record.id, record)
    },
    records,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mock.upsertFromTask.mockResolvedValue([])
})

describe('runGeneratedAssetLibraryMigration', () => {
  it('upserts tasks in ascending createdAt order and checkpoints per batch', async () => {
    const tasks = Array.from({ length: 205 }, (_, i) => makeTask(`task-${i}`, 1000 + i * 10))
    const journal = createJournalStore()

    await runGeneratedAssetLibraryMigration(journal, { tasks })

    expect(mock.upsertFromTask).toHaveBeenCalledTimes(205)
    const processed = mock.upsertFromTask.mock.calls.map(([task]) => task.id)
    expect(processed[0]).toBe('task-0')
    expect(processed[204]).toBe('task-204')
    expect(journal.records.get('generated-asset-library-v1')!.status).toBe('completed')
  })

  it('skips when already completed and does not re-upsert', async () => {
    const tasks = [makeTask('a', 1000)]
    const journal = createJournalStore()
    await journal.put({ id: 'generated-asset-library-v1', status: 'completed', updatedAt: Date.now() })

    await runGeneratedAssetLibraryMigration(journal, { tasks })

    expect(mock.upsertFromTask).not.toHaveBeenCalled()
  })

  it('resumes from the last checkpoint after a failure', async () => {
    const tasks = Array.from({ length: 120 }, (_, i) => makeTask(`task-${i}`, 1000 + i * 10))
    const journal = createJournalStore()
    mock.upsertFromTask.mockImplementation(async (task: TaskRecord) => {
      if (task.id === 'task-110') throw new Error('boom')
    })

    await expect(runGeneratedAssetLibraryMigration(journal, { tasks })).rejects.toThrow('boom')
    const failed = journal.records.get('generated-asset-library-v1')!
    expect(failed.status).toBe('failed')
    // 检查点落在第 100 个任务（含）处
    expect(failed.cursor).toBe(`${1000 + 99 * 10}:task-99`)

    // 第二次运行从检查点续跑，task-99 之前的不会再次处理
    const callsBeforeResume = mock.upsertFromTask.mock.calls.length
    mock.upsertFromTask.mockResolvedValue([])
    await runGeneratedAssetLibraryMigration(journal, { tasks })
    const processedAfterResume = mock.upsertFromTask.mock.calls.slice(callsBeforeResume).map(([task]) => task.id)
    expect(processedAfterResume[0]).toBe('task-100')
    expect(processedAfterResume).toContain('task-110')
    expect(journal.records.get('generated-asset-library-v1')!.status).toBe('completed')
  })

  it('derives source context from workspace tab ownership', async () => {
    const task = makeTask('task-1', 1000)
    const tab: WorkspaceTab = {
      id: 'tab-1',
      name: '品牌组',
      groupId: null,
      prompt: '',
      inputImages: [],
      inputImageFolder: null,
      params: {} as TaskParams,
      maskDraft: null,
      maskEditorImageId: null,
      customOutputPath: '',
      tasks: [task],
      createdAt: 1,
      updatedAt: 1,
      order: 0,
    }
    const journal = createJournalStore()
    await runGeneratedAssetLibraryMigration(journal, { tasks: [task], workspaceTabs: [tab] })

    const [upsertedTask, context] = mock.upsertFromTask.mock.calls[0]
    expect(upsertedTask.id).toBe('task-1')
    expect(context.workspaceTabId).toBe('tab-1')
    expect(context.workspaceTabName).toBe('品牌组')
  })

  it('loads tasks from the database when not provided', async () => {
    const tasks = [makeTask('a', 1000)]
    mock.getAllTasks.mockResolvedValue(tasks)
    const journal = createJournalStore()

    await runGeneratedAssetLibraryMigration(journal)

    expect(mock.getAllTasks).toHaveBeenCalled()
    expect(mock.upsertFromTask).toHaveBeenCalledTimes(1)
  })

  it('exposes a batch size that matches the implementation', () => {
    expect(GENERATED_ASSET_LIBRARY_BATCH_SIZE).toBe(100)
  })
})
