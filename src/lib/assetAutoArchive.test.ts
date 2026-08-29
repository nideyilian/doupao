import { describe, expect, it, vi } from 'vitest'
import type { AssetCollection, AssetPatch, GeneratedAsset, SopBatchSnapshot, TaskRecord } from '../types'
import { DEFAULT_PARAMS } from '../types'
import type { PromptLibraryFolder } from '../features/strategy/adapters/promptLibraryTree'
import {
  autoArchiveBatchAssets,
  collectBatchAssetIds,
  ensureFolderChain,
  type BatchAutoArchiveDeps,
} from './assetAutoArchive'

function makeFolder(id: string, name: string, parentId: string | null = null): PromptLibraryFolder {
  return { id, name, parentId, order: 0, createdAt: 1, updatedAt: 1 }
}

function makeTask(id: string, snapshotId?: string, batchId = 'batch-1'): TaskRecord {
  return {
    id,
    prompt: `提示词 ${id}`,
    params: DEFAULT_PARAMS,
    inputImageIds: [],
    outputImages: [`img-${id}`],
    status: 'done',
    error: null,
    createdAt: 1000,
    finishedAt: 2000,
    elapsed: 1000,
    ...(snapshotId
      ? { sopBatch: { batchId, snapshotId, sopId: 'sop-1', sopName: 'SOP', promptIndex: 0, promptCount: 1 } }
      : {}),
  }
}

function makeSnapshot(id: string, promptGroupId: string, taskIds: string[] = []): SopBatchSnapshot {
  return {
    id,
    batchId: `batch-${id}`,
    promptGroup: { id: promptGroupId, name: '占位' },
    sop: { id: 'sop-1', name: 'SOP', description: '', content: '' },
    brief: '',
    referenceImageIds: [],
    promptCount: 1,
    imagesPerPrompt: 1,
    prompts: [],
    params: DEFAULT_PARAMS,
    workspaceTabId: null,
    createdAt: 1000,
    taskIds,
  }
}

function makeAsset(id: string, origins: GeneratedAsset['origins'] = []): GeneratedAsset {
  return {
    id,
    imageId: id,
    status: 'active',
    createdAt: 1000,
    updatedAt: 1000,
    trashedAt: null,
    favorite: false,
    rating: 0,
    collectionIds: [],
    tagIds: [],
    origins,
    primaryOriginKey: origins[0]?.key ?? null,
    parentAssetIds: [],
    metadataVersion: 1,
  }
}

function makeDeps(overrides: Partial<BatchAutoArchiveDeps> = {}): BatchAutoArchiveDeps {
  return {
    readFolders: () => [],
    getSnapshots: async () => [],
    getTasks: async () => [],
    getFullSnapshot: async () => ({ assets: [], collections: [] }),
    putCollection: async (collection) => collection,
    patchAssets: async () => [],
    ...overrides,
  }
}

describe('ensureFolderChain', () => {
  it('creates a nested folder chain and reuses existing siblings by name', async () => {
    const collections: AssetCollection[] = [
      { id: 'existing', name: '品牌', normalizedName: '品牌', parentId: null, order: 0, createdAt: 1, updatedAt: 1 },
    ]
    const putCollection = vi.fn(async (collection: AssetCollection) => collection)
    const first = await ensureFolderChain(['品牌', '海报', '秋季'], collections, { putCollection })
    expect(first.created).toBe(2)
    expect(first.createdCollections.map((collection) => collection.name)).toEqual(['海报', '秋季'])
    expect(putCollection).toHaveBeenCalledTimes(2)
    const names = putCollection.mock.calls.map(([collection]) => collection.name)
    expect(names).toEqual(['海报', '秋季'])
    const leaf = collections.find((collection) => collection.name === '秋季')
    expect(leaf?.parentId).toBe(collections.find((collection) => collection.name === '海报')?.id)
    expect(first.leafId).toBe(leaf?.id)

    // 幂等：同名同层级复用，不重复创建
    const second = await ensureFolderChain(['品牌', '海报', '秋季'], [...collections], { putCollection })
    expect(second).toEqual({ leafId: leaf?.id, created: 0, createdCollections: [] })
    expect(putCollection).toHaveBeenCalledTimes(2)
  })
})

describe('collectBatchAssetIds', () => {
  it('collects outputs from snapshot taskIds, batchIds, and origin back-references', () => {
    const run = makeSnapshot('run-1', 'folder-1', ['t1'])
    const tasksById = new Map([
      ['t1', makeTask('t1', 'run-1')],
      ['t2', makeTask('t2', 'run-1')],
      ['t3', makeTask('t3', undefined, 'batch-run-1')],
    ])
    // t2 的任务快照没有列在 run.taskIds，但 origins 反查命中
    const assets = [
      makeAsset('img-t1'),
      makeAsset('img-orphan', [
        {
          key: 't2:0',
          taskId: 't2',
          outputSlot: 0,
          taskCreatedAt: 1,
          taskFinishedAt: 2,
          sourceMode: 'sop',
          prompt: 'x',
          requestedParams: DEFAULT_PARAMS,
          inputImageIds: [],
        },
      ]),
    ]
    const ids = collectBatchAssetIds(run, assets, tasksById)
    expect(ids.sort()).toEqual(['img-orphan', 'img-t1'])
  })
})

describe('autoArchiveBatchAssets', () => {
  it('mirrors the prompt library folder path into the project tree and archives assets', async () => {
    const folders = [makeFolder('folder-1', '品牌'), makeFolder('folder-2', '海报', 'folder-1')]
    const run = makeSnapshot('run-1', 'folder-2', ['t1'])
    const assets = [makeAsset('img-t1')]
    const collections: AssetCollection[] = []
    const putCollection = vi.fn(async (collection: AssetCollection) => {
      collections.push(collection)
      return collection
    })
    const patchAssets = vi.fn(async () => [])

    const deps = makeDeps({
      readFolders: () => folders,
      getSnapshots: async () => [run],
      getTasks: async () => [makeTask('t1', 'run-1')],
      getFullSnapshot: async () => ({ assets, collections: [] }),
      putCollection,
      patchAssets,
    })

    const result = await autoArchiveBatchAssets(deps)
    expect(result.batches).toBe(1)
    expect(result.createdFolders).toBe(2)
    const names = collections.map((collection) => collection.name)
    expect(names).toEqual(['品牌', '海报'])
    expect(collections[1]?.parentId).toBe(collections[0]?.id)
    expect(patchAssets).toHaveBeenCalledWith(['img-t1'], { collectionIds: [collections[1]?.id] })
    expect(result.archivedAssets).toBe(1)
  })

  it('is idempotent: reuses folders and skips already-archived assets', async () => {
    const folders = [makeFolder('folder-1', '品牌')]
    const run = makeSnapshot('run-1', 'folder-1', ['t1'])
    const existingCollection: AssetCollection = {
      id: 'col-1',
      name: '品牌',
      normalizedName: '品牌',
      parentId: null,
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    }
    const asset = makeAsset('img-t1', [
      {
        key: 't1:0',
        taskId: 't1',
        outputSlot: 0,
        taskCreatedAt: 1,
        taskFinishedAt: 2,
        sourceMode: 'sop',
        prompt: 'x',
        requestedParams: DEFAULT_PARAMS,
        inputImageIds: [],
      },
    ])
    asset.collectionIds = ['col-1']
    const putCollection = vi.fn()
    const patchAssets = vi.fn(async (_ids: string[], _patch: AssetPatch) => [])

    const deps = makeDeps({
      readFolders: () => folders,
      getSnapshots: async () => [run],
      getTasks: async () => [makeTask('t1', 'run-1')],
      getFullSnapshot: async () => ({ assets: [asset], collections: [existingCollection] }),
      putCollection,
      patchAssets,
    })

    const result = await autoArchiveBatchAssets(deps)
    expect(result.createdFolders).toBe(0)
    expect(result.archivedAssets).toBe(0)
    expect(putCollection).not.toHaveBeenCalled()
    expect(patchAssets).not.toHaveBeenCalled()
  })

  it('skips batches without a prompt group', async () => {
    const run: SopBatchSnapshot = { ...makeSnapshot('run-2', 'folder-x'), promptGroup: undefined }
    const deps = makeDeps({
      readFolders: () => [],
      getSnapshots: async () => [run],
      getTasks: async () => [],
      getFullSnapshot: async () => ({ assets: [], collections: [] }),
    })
    const result = await autoArchiveBatchAssets(deps)
    expect(result).toEqual({ batches: 0, createdFolders: 0, archivedAssets: 0, createdCollections: [] })
  })
})
