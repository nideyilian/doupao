import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetTombstone, TaskParams, TaskRecord } from '../types'

const mock = vi.hoisted(() => {
  const assets = new Map<string, any>()
  const collections = new Map<string, any>()
  const tags = new Map<string, any>()
  const tombstones = new Map<string, any>()
  return {
    assets,
    collections,
    tags,
    tombstones,
    reset() {
      assets.clear()
      collections.clear()
      tags.clear()
      tombstones.clear()
    },
  }
})

vi.mock('./db', () => ({
  batchGetImages: () => Promise.resolve(new Map()),
  getAllGeneratedAssets: () => Promise.resolve([...mock.assets.values()]),
  getGeneratedAsset: (id: string) => Promise.resolve(mock.assets.get(id)),
  batchGetGeneratedAssets: (ids: string[]) =>
    Promise.resolve(new Map(ids.filter((id) => mock.assets.has(id)).map((id) => [id, mock.assets.get(id)]))),
  batchGetGeneratedAssetsByImageIds: (ids: string[]) =>
    Promise.resolve(
      new Map(
        ids.flatMap((imageId) => {
          const asset = [...mock.assets.values()].find((item) => item.imageId === imageId)
          return asset ? [[imageId, asset] as const] : []
        }),
      ),
    ),
  putGeneratedAsset: (asset: any) => {
    mock.assets.set(asset.id, asset)
    return Promise.resolve(asset.id)
  },
  putGeneratedAssets: (list: any[]) => {
    for (const asset of list) mock.assets.set(asset.id, asset)
    return Promise.resolve()
  },
  putAssetBlobs: () => Promise.resolve(),
  putAssetVersions: () => Promise.resolve(),
  deleteGeneratedAsset: (id: string) => {
    mock.assets.delete(id)
    return Promise.resolve(undefined)
  },
  getAllAssetCollections: () => Promise.resolve([...mock.collections.values()]),
  getAssetCollection: (id: string) => Promise.resolve(mock.collections.get(id)),
  putAssetCollection: (c: any) => {
    mock.collections.set(c.id, c)
    return Promise.resolve(c.id)
  },
  putAssetCollections: (list: any[]) => {
    for (const c of list) mock.collections.set(c.id, c)
    return Promise.resolve()
  },
  deleteAssetCollection: (id: string) => {
    mock.collections.delete(id)
    return Promise.resolve(undefined)
  },
  getAllAssetTags: () => Promise.resolve([...mock.tags.values()]),
  getAssetTag: (id: string) => Promise.resolve(mock.tags.get(id)),
  putAssetTag: (t: any) => {
    mock.tags.set(t.id, t)
    return Promise.resolve(t.id)
  },
  putAssetTags: (list: any[]) => {
    for (const t of list) mock.tags.set(t.id, t)
    return Promise.resolve()
  },
  deleteAssetTag: (id: string) => {
    mock.tags.delete(id)
    return Promise.resolve(undefined)
  },
  getAllAssetTombstones: () => Promise.resolve([...mock.tombstones.values()]),
  batchGetAssetTombstones: (imageIds: string[]) =>
    Promise.resolve(
      new Map(
        imageIds.flatMap((imageId) => {
          const tombstone = [...mock.tombstones.values()].find((item) => item.imageId === imageId)
          return tombstone ? [[imageId, tombstone] as const] : []
        }),
      ),
    ),
  getAssetTombstone: (id: string) => Promise.resolve(mock.tombstones.get(id)),
  putAssetTombstones: (list: any[]) => {
    for (const t of list) mock.tombstones.set(t.id, t)
    return Promise.resolve()
  },
  deleteAssetTombstone: (id: string) => {
    mock.tombstones.delete(id)
    return Promise.resolve(undefined)
  },
}))

import {
  getAsset,
  getAssetsByIds,
  hydrate,
  listCollections,
  mergeImportedAssetLibrary,
  moveToTrash,
  patchAssets,
  putCollection,
  putTombstone,
  removeCollection,
  restore,
  upsertFromTask,
} from './assetLibraryRepository'

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-1',
    prompt: 'a cat',
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
    isFavorite: false,
    ...overrides,
  }
}

beforeEach(() => mock.reset())

describe('hydrate / reads', () => {
  it('hydrates normalized snapshot from all stores', async () => {
    mock.assets.set('a', { id: 'a', imageId: 'a', origins: [], status: 'trashed' })
    mock.collections.set('c1', { id: 'c1', name: '项目', normalizedName: '项目' })
    mock.tags.set('t1', { id: 't1', name: '高清', normalizedName: '高清' })
    mock.tombstones.set('tomb-1', { id: 'tomb-1', imageId: 'hash-x', purgedAt: 1, lastOriginOccurredAt: 1 })

    const snapshot = await hydrate()
    expect(snapshot.assets[0].status).toBe('trashed')
    expect(snapshot.assets[0].rating).toBe(0)
    expect(snapshot.collections.map((c) => c.id)).toEqual(['c1'])
    expect(snapshot.tags.map((t) => t.id)).toEqual(['t1'])
    expect(snapshot.tombstones.map((t) => t.imageId)).toEqual(['hash-x'])
  })

  it('returns assets by ids', async () => {
    mock.assets.set('a', { id: 'a', imageId: 'a', origins: [] })
    mock.assets.set('b', { id: 'b', imageId: 'b', origins: [] })
    const byId = await getAssetsByIds(['a', 'b', 'missing'])
    expect([...byId.keys()].sort()).toEqual(['a', 'b'])
  })

  it('returns a single asset normalized', async () => {
    mock.assets.set('a', { id: 'a', imageId: 'a', origins: [], status: 'trashed' })
    const asset = await getAsset('a')
    expect(asset!.status).toBe('trashed')
  })
})

describe('upsertFromTask', () => {
  it('creates a new asset for the first task output', async () => {
    const changed = await upsertFromTask(makeTask(), { sourceMode: 'gallery' })
    expect(changed).toHaveLength(1)
    const asset = changed[0]
    expect(asset.id).toBe('asset:img-1')
    expect(asset.imageId).toBe('img-1')
    expect(asset.status).toBe('active')
    expect(asset.origins).toEqual([
      expect.objectContaining({ key: 'task-1:0', taskId: 'task-1', outputSlot: 0, prompt: 'a cat' }),
    ])
    expect(asset.primaryOriginKey).toBe('task-1:0')
    expect(asset.favorite).toBe(false)
    expect(asset.rating).toBe(0)
  })

  it('is idempotent for the same task', async () => {
    await upsertFromTask(makeTask(), { sourceMode: 'gallery' })
    await upsertFromTask(makeTask(), { sourceMode: 'gallery' })
    const asset = await getAsset('img-1')
    expect(asset!.origins).toHaveLength(1)
  })

  it('appends a new origin when a different task produces the same content', async () => {
    await upsertFromTask(makeTask(), { sourceMode: 'gallery' })
    await upsertFromTask(makeTask({ id: 'task-2', createdAt: 3000, finishedAt: 4000, prompt: 'a dog' }), {
      sourceMode: 'agent',
    })
    const asset = await getAsset('img-1')
    expect(asset!.origins).toHaveLength(2)
    expect(asset!.origins[1].key).toBe('task-2:0')
    expect(asset!.origins[1].sourceMode).toBe('agent')
    expect(asset!.primaryOriginKey).toBe('task-1:0')
  })

  it('updates the origin snapshot in place when the same slot is refreshed', async () => {
    await upsertFromTask(makeTask({ status: 'running', finishedAt: null }), { sourceMode: 'gallery' })
    await upsertFromTask(makeTask({ status: 'done' }), { sourceMode: 'gallery' })
    const asset = await getAsset('img-1')
    expect(asset!.origins).toHaveLength(1)
    expect(asset!.origins[0].taskFinishedAt).toBe(2000)
  })

  it('skips slots listed in purgedOutputSlots', async () => {
    const changed = await upsertFromTask(makeTask({ outputImages: ['img-1', 'img-2'], purgedOutputSlots: [1] }), {
      sourceMode: 'gallery',
    })
    expect(changed.map((a) => a.id)).toEqual(['asset:img-1'])
  })

  it('does not resurrect an asset purged after the task', async () => {
    await upsertFromTask(makeTask({ createdAt: 1000 }), { sourceMode: 'gallery' })
    mock.tombstones.set('tomb-img-1', {
      id: 'tomb-img-1',
      imageId: 'img-1',
      purgedAt: 5000,
      lastOriginOccurredAt: 2000,
    })
    const changed = await upsertFromTask(makeTask({ createdAt: 1000 }), { sourceMode: 'gallery' })
    expect(changed).toEqual([])
  })

  it('allows a newer task to recreate a purged asset', async () => {
    await upsertFromTask(makeTask({ createdAt: 1000 }), { sourceMode: 'gallery' })
    mock.tombstones.set('tomb-img-1', {
      id: 'tomb-img-1',
      imageId: 'img-1',
      purgedAt: 5000,
      lastOriginOccurredAt: 2000,
    })
    const changed = await upsertFromTask(makeTask({ id: 'task-new', createdAt: 9000 }), { sourceMode: 'gallery' })
    expect(changed).toHaveLength(1)
    expect(changed[0].id).toBe('asset:img-1')
  })

  it('builds parent assets from inputs that already exist in the library', async () => {
    mock.assets.set('input-a', { id: 'input-a', imageId: 'input-a', origins: [] })
    const changed = await upsertFromTask(makeTask({ inputImageIds: ['input-a', 'input-b'] }), { sourceMode: 'gallery' })
    expect(changed[0].parentAssetIds).toEqual(['input-a'])
  })
})

describe('patchAssets / moveToTrash / restore', () => {
  it('applies patches to matching assets only', async () => {
    mock.assets.set('a', { id: 'a', imageId: 'a', origins: [] })
    mock.assets.set('b', { id: 'b', imageId: 'b', origins: [] })
    const updated = await patchAssets(['a', 'missing'], { favorite: true, rating: 4 })
    expect(updated.map((a) => a.id)).toEqual(['a'])
    expect(updated[0].favorite).toBe(true)
    expect(updated[0].rating).toBe(4)
    expect((await getAsset('b'))!.favorite).toBe(false)
  })

  it('moves assets to trash and restores them', async () => {
    await upsertFromTask(makeTask(), { sourceMode: 'gallery' })
    const trashed = await moveToTrash(['img-1'], 5000)
    expect(trashed[0].status).toBe('trashed')
    expect(trashed[0].trashedAt).toBe(5000)
    const restored = await restore(['img-1'], 6000)
    expect(restored[0].status).toBe('active')
    expect(restored[0].trashedAt).toBeNull()
  })

  it('is a no-op when already in the target state', async () => {
    mock.assets.set('a', { id: 'a', imageId: 'a', origins: [], status: 'trashed', trashedAt: 1, updatedAt: 1 })
    const trashed = await moveToTrash(['a'], 5000)
    expect(trashed).toEqual([])
    expect(mock.assets.get('a').trashedAt).toBe(1)
  })
})

describe('collections / tags / tombstones', () => {
  it('creates and removes collections', async () => {
    await putCollection({
      id: 'c1',
      name: '项目',
      normalizedName: '项目',
      parentId: null,
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    })
    mock.assets.set('a', { id: 'a', imageId: 'a', origins: [], collectionIds: ['c1'] })
    expect(await listCollections()).toHaveLength(1)
    await removeCollection('c1')
    expect(await listCollections()).toHaveLength(0)
    expect((await getAsset('a'))!.collectionIds).toEqual([])
  })

  it('writes and reads tombstones', async () => {
    const tombstone: AssetTombstone = { id: 'hash-1', imageId: 'hash-1', purgedAt: 100, lastOriginOccurredAt: 90 }
    await putTombstone(tombstone)
    const { getTombstone } = await import('./assetLibraryRepository')
    expect(await getTombstone('hash-1')).toEqual(tombstone)
  })
})

describe('asset library import merge', () => {
  it('unions local annotations and imported origins instead of overwriting them', async () => {
    mock.assets.set('a', {
      id: 'a',
      imageId: 'a',
      favorite: true,
      rating: 2,
      collectionIds: ['local'],
      tagIds: [],
      origins: [{ key: 'local:0', taskId: 'local', outputSlot: 0, prompt: 'local', requestedParams: {} }],
    })
    const snapshot = await mergeImportedAssetLibrary({
      assets: [
        {
          id: 'a',
          imageId: 'a',
          status: 'active',
          createdAt: 2,
          updatedAt: 3,
          trashedAt: null,
          favorite: false,
          rating: 4,
          collectionIds: ['imported'],
          tagIds: ['tag'],
          origins: [
            {
              key: 'imported:0',
              taskId: 'imported',
              outputSlot: 0,
              taskCreatedAt: 2,
              taskFinishedAt: 3,
              sourceMode: 'gallery',
              prompt: 'imported',
              requestedParams: {} as TaskParams,
              inputImageIds: [],
            },
          ],
          primaryOriginKey: 'imported:0',
          parentAssetIds: [],
          metadataVersion: 1,
        },
      ],
      collections: [],
      tags: [],
      tombstones: [],
    })
    expect(snapshot.assets[0].favorite).toBe(true)
    expect(snapshot.assets[0].rating).toBe(4)
    expect(snapshot.assets[0].collectionIds).toEqual(['local', 'imported'])
    expect(snapshot.assets[0].origins.map((origin) => origin.key)).toEqual(['local:0', 'imported:0'])
  })
})

describe('catalog backend (Electron SQLite authoritative)', () => {
  type JsonRecord = Record<string, unknown>
  const apiMock = vi.hoisted(() => {
    const assets = new Map<string, JsonRecord>()
    const collections = new Map<string, JsonRecord>()
    const tags = new Map<string, JsonRecord>()
    const tombstones = new Map<string, JsonRecord>()
    const meta = new Map<string, string>()
    return {
      assets,
      collections,
      tags,
      tombstones,
      meta,
      reset() {
        assets.clear()
        collections.clear()
        tags.clear()
        tombstones.clear()
        meta.clear()
      },
    }
  })

  function installApi() {
    Object.assign(globalThis, {
      window: {
        electronAPI: {
          isElectron: true,
          assetCatalogQuery: async (input: { limit: number }) => ({
            assets: [...apiMock.assets.values()].slice(0, input.limit),
            totalCount: apiMock.assets.size,
            nextCursor: null,
            counts: {
              all: apiMock.assets.size,
              recent: 0,
              favorites: 0,
              unorganized: 0,
              trash: 0,
              byCollection: {},
              byTag: {},
            },
          }),
          assetCatalogUpsert: async (records: Array<{ asset: JsonRecord }>) => {
            for (const record of records) apiMock.assets.set(record.asset.id as string, record.asset)
            return { success: true }
          },
          assetCatalogPurge: async (assetIds: string[]) => {
            const purged: string[] = []
            for (const id of assetIds) if (apiMock.assets.delete(id)) purged.push(id)
            return {
              purged,
              tombstones: purged.map((id) => ({ id, imageId: id, purgedAt: 1, lastOriginOccurredAt: 1 })),
            }
          },
          assetCatalogDelete: async (assetIds: string[]) => {
            for (const id of assetIds) apiMock.assets.delete(id)
            return { success: true }
          },
          assetCatalogExportAll: async () => [...apiMock.assets.values()],
          assetCatalogGetAssetsByIds: async (ids: string[]) =>
            ids.filter((id) => apiMock.assets.has(id)).map((id) => apiMock.assets.get(id)),
          assetCatalogGetCollections: async () => [...apiMock.collections.values()],
          assetCatalogPutCollections: async (records: JsonRecord[]) => {
            for (const record of records) apiMock.collections.set(record.id as string, record)
            return { success: true }
          },
          assetCatalogDeleteCollection: async (id: string) => {
            apiMock.collections.delete(id)
            return { success: true }
          },
          assetCatalogGetTags: async () => [...apiMock.tags.values()],
          assetCatalogPutTags: async (records: JsonRecord[]) => {
            for (const record of records) apiMock.tags.set(record.id as string, record)
            return { success: true }
          },
          assetCatalogDeleteTag: async (id: string) => {
            apiMock.tags.delete(id)
            return { success: true }
          },
          assetCatalogGetTombstones: async (imageIds: string[]) =>
            imageIds
              .map((imageId) => apiMock.tombstones.get(imageId))
              .filter((tombstone): tombstone is JsonRecord => Boolean(tombstone)),
          assetCatalogGetAllTombstones: async () => [...apiMock.tombstones.values()],
          assetCatalogPutTombstones: async (records: JsonRecord[]) => {
            for (const record of records) apiMock.tombstones.set(record.imageId as string, record)
            return { success: true }
          },
          assetCatalogDeleteTombstone: async (imageId: string) => {
            apiMock.tombstones.delete(imageId)
            return { success: true }
          },
          assetCatalogMetaGet: async (key: string) => apiMock.meta.get(key) ?? null,
          assetCatalogMetaSet: async (key: string, value: string) => {
            apiMock.meta.set(key, value)
            return { success: true }
          },
        },
      },
    })
  }

  function uninstallApi() {
    delete (globalThis as Record<string, unknown>).window
  }

  beforeEach(() => {
    apiMock.reset()
    vi.clearAllMocks()
  })

  afterEach(() => {
    uninstallApi()
  })

  it('hydrates from the catalog backend and backfills legacy IndexedDB metadata once', async () => {
    installApi()
    // 旧 IDB 侧有数据（模拟升级场景）
    mock.collections.set('c1', {
      id: 'c1',
      name: '旧项目',
      normalizedName: '旧项目',
      parentId: null,
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    })
    mock.tags.set('t1', { id: 't1', name: '旧标签', normalizedName: '旧标签', createdAt: 1, updatedAt: 1 })
    apiMock.assets.set('a', { id: 'a', imageId: 'a', origins: [] })

    const { hydrate } = await import('./assetLibraryRepository')
    const snapshot = await hydrate()

    expect(snapshot.assets.map((asset) => asset.id)).toEqual(['a'])
    // 一次回填后 meta 门控置位；IDB 数据已进入 SQLite 侧
    expect(apiMock.meta.get('idb-asset-library-v1')).toBeTruthy()
    expect(apiMock.collections.has('c1')).toBe(true)
    expect(apiMock.tags.has('t1')).toBe(true)
    expect(snapshot.collections[0]?.name).toBe('旧项目')

    // 再次 hydrate：进程内门控生效，本会话不再重复回填（生产环境 IDB 侧此后不再被写入）
    mock.assets.set('legacy-only', { id: 'legacy-only', imageId: 'legacy-only', origins: [] })
    mock.collections.set('c2', {
      id: 'c2',
      name: '新项目',
      normalizedName: '新项目',
      parentId: null,
      order: 1,
      createdAt: 2,
      updatedAt: 2,
    })
    await hydrate()
    expect(apiMock.assets.has('legacy-only')).toBe(false)
    expect(apiMock.collections.has('c2')).toBe(false)
  })

  it('routes reads and writes to the catalog backend when available', async () => {
    installApi()
    apiMock.assets.set('a', {
      id: 'a',
      imageId: 'a',
      favorite: true,
      rating: 3,
      collectionIds: ['c1'],
      tagIds: ['t1'],
      origins: [],
    })
    apiMock.collections.set('c1', {
      id: 'c1',
      name: '广告图',
      normalizedName: '广告图',
      parentId: null,
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    })
    apiMock.tags.set('t1', { id: 't1', name: '高清', normalizedName: '高清', createdAt: 1, updatedAt: 1 })

    const {
      getAsset,
      getAssetsByIds,
      listCollections,
      putCollection,
      putTombstones,
      listTombstones,
      getTombstone,
      hydrateFull,
    } = await import('./assetLibraryRepository')

    expect((await getAsset('a'))?.rating).toBe(3)
    expect((await getAssetsByIds(['a', 'missing'])).has('a')).toBe(true)
    expect((await listCollections())[0]?.name).toBe('广告图')

    await putCollection({
      id: 'c2',
      name: '新项目',
      normalizedName: '新项目',
      parentId: null,
      order: 1,
      createdAt: 2,
      updatedAt: 2,
    })
    expect(apiMock.collections.has('c2')).toBe(true)

    await putTombstones([{ id: 'img-x', imageId: 'img-x', purgedAt: 1, lastOriginOccurredAt: 1 }])
    expect((await listTombstones()).map((t) => t.imageId)).toEqual(['img-x'])
    expect((await getTombstone('img-x'))?.purgedAt).toBe(1)

    const full = await hydrateFull()
    expect(full.assets.map((asset) => asset.id)).toEqual(['a'])
    expect(full.collections.map((c) => c.id).sort()).toEqual(['c1', 'c2'])
    expect(full.tags.map((t) => t.id).sort()).toEqual(['t1'])
    // 写入走 SQLite 侧，IndexedDB 不再被写入
    expect(mock.assets.has('c2')).toBe(false)
    expect(mock.collections.has('c2')).toBe(false)
  })

  it('writes assets through upsert and reads them back from the backend', async () => {
    installApi()
    const { putGeneratedAssets, listAssets } = await import('./assetLibraryRepository')
    await putGeneratedAssets([{ id: 'x', imageId: 'x', origins: [] } as unknown as import('../types').GeneratedAsset])
    expect(apiMock.assets.has('x')).toBe(true)
    expect((await listAssets()).map((asset) => asset.id)).toEqual(['x'])
    // IndexedDB 侧不写素材（权威在 SQLite）
    expect(mock.assets.has('x')).toBe(false)
  })

  it('finds generated assets (asset:<imageId>) by image hash so upserts never rebuild them as new', async () => {
    installApi()
    // 生成素材：id 带 `asset:` 前缀，imageId 是内容哈希；主进程按 id 精确查询
    apiMock.assets.set('asset:img-1', {
      id: 'asset:img-1',
      imageId: 'img-1',
      collectionIds: ['c1'],
      favorite: true,
      rating: 4,
      tagIds: ['t1'],
      origins: [
        { key: 'task-1:0', taskId: 'task-1', outputSlot: 0, taskCreatedAt: 1, prompt: 'p', requestedParams: {} },
      ],
    })
    apiMock.assets.set('img-2', { id: 'img-2', imageId: 'img-2', collectionIds: ['c2'], origins: [] })

    const { getAssetsByImageIds } = await import('./assetLibraryRepository')
    const found = await getAssetsByImageIds(['img-1', 'img-2'])

    // 修复前：只查 ['img-1','img-2']，`asset:img-1` 查不到 → 生成素材被误判不存在
    // 修复后：同时查 `asset:` 前缀，两个都能按 imageId 命中
    expect(found.get('img-1')).toMatchObject({ id: 'asset:img-1', collectionIds: ['c1'] })
    expect(found.get('img-2')).toMatchObject({ id: 'img-2', collectionIds: ['c2'] })
    expect(found.size).toBe(2)
  })
})
