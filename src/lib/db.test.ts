import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssetCollection, AssetTag, GeneratedAsset, TaskRecord } from '../types'
import {
  CURRENT_THUMBNAIL_VERSION,
  batchGetCompositeAssets,
  batchGetImages,
  buildGridThumbnail,
  commitImportedRecords,
  deleteGeneratedAsset,
  getCompositeAsset,
  getGeneratedAsset,
  getImage,
  getFreshThumbnailFromDisk,
  getLegacyImageBatch,
  getStorageRecordCounts,
  loadTasksIncrementally,
  putAssetCollections,
  putAssetTags,
  putAssetTombstones,
  putCompositeAssets,
  putGeneratedAssets,
  putImage,
  putImageRecords,
  putTasks,
} from './db'

type MutableRequest<T = unknown> = {
  result?: T
  error?: Error | null
  onsuccess?: () => void
  onerror?: () => void
}

type TestCursor<T> = {
  readonly value: T
  update?: (value: unknown) => void
  continue: () => void
}

describe('database transaction completion', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('rejects when a write request succeeds but its transaction aborts', async () => {
    const putRequest: MutableRequest = {}
    const tx: {
      error: Error | null
      objectStore: () => { put: () => MutableRequest }
      oncomplete: (() => void) | null
      onerror: (() => void) | null
      onabort: (() => void) | null
    } = {
      error: null,
      objectStore: () => ({ put: () => putRequest }),
      oncomplete: null,
      onerror: null,
      onabort: null,
    }
    vi.stubGlobal('indexedDB', {
      open: () => requestWithResult({ transaction: () => tx }),
    })

    const write = putImage({ id: 'image-a', dataUrl: 'data:image/png;base64,a' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    putRequest.result = 'image-a'
    putRequest.onsuccess?.()
    tx.error = new Error('quota exceeded')
    tx.onabort?.()

    await expect(write).rejects.toThrow('quota exceeded')
  })

  it('commits imported images, thumbnails and tasks in one transaction', async () => {
    const puts: Record<string, string[]> = { images: [], thumbnails: [], tasks: [] }
    let complete: (() => void) | null = null
    const tx = {
      objectStore: (name: keyof typeof puts) => ({
        put: (value: { id: string }) => puts[name].push(value.id),
      }),
      set oncomplete(handler: (() => void) | null) {
        complete = handler
        queueMicrotask(() => complete?.())
      },
      onerror: null,
      onabort: null,
    }
    const transaction = vi.fn(() => tx)
    vi.stubGlobal('indexedDB', {
      open: () => requestWithResult({ transaction }),
    })

    await commitImportedRecords({
      images: [{ id: 'image-a', dataUrl: 'data:image/png;base64,a' }],
      thumbnails: [{ id: 'image-a', thumbnailDataUrl: 'data:image/webp;base64,a' }],
      tasks: [{ id: 'task-a' } as TaskRecord],
    })

    expect(transaction).toHaveBeenCalledWith(['images', 'thumbnails', 'tasks'], 'readwrite')
    expect(puts).toEqual({
      images: ['image-a'],
      thumbnails: ['image-a'],
      tasks: ['task-a'],
    })
  })

  it('clears existing tasks before committing a replacement import', async () => {
    const events: string[] = []
    let complete: (() => void) | null = null
    const tx = {
      objectStore: (name: string) => ({
        clear: () => events.push(`clear:${name}`),
        put: (value: { id: string }) => events.push(`put:${name}:${value.id}`),
      }),
      set oncomplete(handler: (() => void) | null) {
        complete = handler
        queueMicrotask(() => complete?.())
      },
      onerror: null,
      onabort: null,
    }
    vi.stubGlobal('indexedDB', {
      open: () => requestWithResult({ transaction: () => tx }),
    })

    await (
      commitImportedRecords as unknown as (records: {
        images: []
        thumbnails: []
        tasks: Array<{ id: string }>
        replaceTasks: boolean
      }) => Promise<void>
    )({
      images: [],
      thumbnails: [],
      tasks: [{ id: 'task-from-backup' }],
      replaceTasks: true,
    })

    expect(events).toEqual(['clear:tasks', 'put:tasks:task-from-backup'])
  })
})

describe('batchGetImages', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads only requested image keys instead of loading the entire image store', async () => {
    const getCalls: string[] = []
    const getAll = vi.fn()
    const records = new Map([
      ['image-a', { id: 'image-a', dataUrl: 'data:image/png;base64,a' }],
      ['image-b', { id: 'image-b', dataUrl: 'data:image/png;base64,b' }],
      ['image-c', { id: 'image-c', dataUrl: 'data:image/png;base64,c' }],
    ])
    const store = {
      get: (id: string) => {
        getCalls.push(id)
        return requestWithResult(records.get(id))
      },
      getAll,
    }
    const db = {
      transaction: () => ({
        objectStore: () => store,
      }),
    }
    const indexedDB = {
      open: vi.fn(() => requestWithResult(db)),
    }
    vi.stubGlobal('indexedDB', indexedDB)

    const result = await batchGetImages(['image-a', 'image-c'])

    expect([...result.keys()]).toEqual(['image-a', 'image-c'])
    expect(getCalls).toEqual(['image-a', 'image-c'])
    expect(getAll).not.toHaveBeenCalled()
  })
})

describe('getLegacyImageBatch', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns a bounded batch and skips migrated records', async () => {
    const values = [
      { id: 'migrated', localPath: '/cache/a.png' },
      { id: 'legacy-a', dataUrl: 'data:image/png;base64,YQ==' },
      { id: 'metadata-only' },
      { id: 'legacy-b', dataUrl: 'data:image/png;base64,Yg==' },
      { id: 'legacy-c', dataUrl: 'data:image/png;base64,Yw==' },
    ]
    let index = 0
    const request: MutableRequest<TestCursor<(typeof values)[number]> | null> = {}
    const cursor: TestCursor<(typeof values)[number]> = {
      get value() {
        return values[index]
      },
      continue() {
        index++
        queueMicrotask(() => {
          request.result = index < values.length ? cursor : null
          request.onsuccess?.()
        })
      },
    }
    const store = {
      openCursor: () => {
        queueMicrotask(() => {
          request.result = cursor
          request.onsuccess?.()
        })
        return request
      },
    }
    vi.stubGlobal('indexedDB', {
      open: () => requestWithResult({ transaction: () => ({ objectStore: () => store }) }),
    })

    const result = await getLegacyImageBatch(2)
    expect(result.map((image) => image.id)).toEqual(['legacy-a', 'legacy-b'])
  })
})

describe('loadTasksIncrementally', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('migrates one cursor record at a time before retaining it', async () => {
    const values = [
      { id: 'task-a', payload: 'large-a' },
      { id: 'task-b', payload: 'large-b' },
    ]
    const updated: unknown[] = []
    let index = 0
    const request: MutableRequest<TestCursor<(typeof values)[number]> | null> = {}
    let complete: (() => void) | null = null
    const cursor: TestCursor<(typeof values)[number]> = {
      get value() {
        return values[index]
      },
      update(value: unknown) {
        updated.push(value)
      },
      continue() {
        index++
        queueMicrotask(() => {
          request.result = index < values.length ? cursor : null
          request.onsuccess?.()
          if (index >= values.length) complete?.()
        })
      },
    }
    const tx = {
      objectStore: () => ({
        openCursor: () => {
          queueMicrotask(() => {
            request.result = cursor
            request.onsuccess?.()
          })
          return request
        },
      }),
      set oncomplete(handler: (() => void) | null) {
        complete = handler
      },
      onerror: null,
      onabort: null,
    }
    vi.stubGlobal('indexedDB', {
      open: () => requestWithResult({ transaction: () => tx }),
    })

    const result = await loadTasksIncrementally(
      (task) =>
        ({
          ...task,
          payload: undefined,
        }) as TaskRecord,
    )

    expect(result).toEqual([
      { id: 'task-a', payload: undefined },
      { id: 'task-b', payload: undefined },
    ])
    expect(updated).toEqual(result)
  })
})

describe('composite assets', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads one composite asset by id', async () => {
    const asset = { id: 'asset-a', blob: new Blob(['a']), createdAt: 1 }
    const get = vi.fn(() => requestWithResult(asset))
    vi.stubGlobal('indexedDB', {
      open: () =>
        requestWithResult({
          transaction: (name: string, mode: string) => ({
            objectStore: () => ({ get }),
          }),
        }),
    })

    await expect(getCompositeAsset('asset-a')).resolves.toEqual(asset)
    expect(get).toHaveBeenCalledWith('asset-a')
  })

  it('reads only requested composite asset keys', async () => {
    const records = new Map([
      ['asset-a', { id: 'asset-a', blob: new Blob(['a']), createdAt: 1 }],
      ['asset-b', { id: 'asset-b', blob: new Blob(['b']), createdAt: 2 }],
    ])
    const get = vi.fn((id: string) => requestWithResult(records.get(id)))
    vi.stubGlobal('indexedDB', {
      open: () =>
        requestWithResult({
          transaction: () => ({ objectStore: () => ({ get }) }),
        }),
    })

    const result = await batchGetCompositeAssets(['asset-a', 'asset-b'])
    expect([...result.keys()]).toEqual(['asset-a', 'asset-b'])
  })

  it('writes a composite asset batch in one transaction', async () => {
    const put = vi.fn()
    let complete: (() => void) | undefined
    const tx = {
      objectStore: () => ({ put }),
      set oncomplete(value: (() => void) | null) {
        complete = value ?? undefined
        queueMicrotask(() => complete?.())
      },
      onerror: null,
      onabort: null,
    }
    const transaction = vi.fn(() => tx)
    vi.stubGlobal('indexedDB', {
      open: () => requestWithResult({ transaction }),
    })
    const assets = [
      { id: 'asset-a', blob: new Blob(['a']), createdAt: 1 },
      { id: 'asset-b', blob: new Blob(['b']), createdAt: 2 },
    ]

    await putCompositeAssets(assets)

    expect(transaction).toHaveBeenCalledWith('compositeAssets', 'readwrite')
    expect(put.mock.calls.map(([asset]) => asset.id)).toEqual(['asset-a', 'asset-b'])
  })

  // 应用数据存储是 SQLite + JSON.stringify：Blob 会被序列化成 {}，字节永久丢失。
  // 所以落库前必须转成 data URL，读回时再还原成 Blob。
  it('persists composite asset bytes as a data URL instead of a Blob', async () => {
    const put = vi.fn()
    let complete: (() => void) | undefined
    const tx = {
      objectStore: () => ({ put }),
      set oncomplete(value: (() => void) | null) {
        complete = value ?? undefined
        queueMicrotask(() => complete?.())
      },
      onerror: null,
      onabort: null,
    }
    vi.stubGlobal('indexedDB', { open: () => requestWithResult({ transaction: () => tx }) })

    await putCompositeAssets([{ id: 'asset-a', blob: new Blob(['a'], { type: 'image/png' }), createdAt: 7 }])

    expect(put.mock.calls[0]![0]).toEqual({
      id: 'asset-a',
      createdAt: 7,
      blobDataUrl: 'data:image/png;base64,YQ==',
    })
  })

  it('restores composite asset bytes from a stored data URL', async () => {
    const get = vi.fn(() =>
      requestWithResult({ id: 'asset-a', createdAt: 1, blobDataUrl: 'data:image/png;base64,YQ==' }),
    )
    vi.stubGlobal('indexedDB', {
      open: () => requestWithResult({ transaction: () => ({ objectStore: () => ({ get }) }) }),
    })

    const asset = await getCompositeAsset('asset-a')

    expect(asset?.blob).toBeInstanceOf(Blob)
    expect(asset?.blob.type).toBe('image/png')
    expect(asset?.createdAt).toBe(1)
    await expect(asset!.blob.text()).resolves.toBe('a')
  })

  it('treats a JSON-damaged composite asset record as missing', async () => {
    const get = vi.fn(() => requestWithResult({ id: 'asset-a', createdAt: 1, blob: {} }))
    vi.stubGlobal('indexedDB', {
      open: () => requestWithResult({ transaction: () => ({ objectStore: () => ({ get }) }) }),
    })

    await expect(getCompositeAsset('asset-a')).resolves.toBeUndefined()
  })

  it('skips damaged composite assets when reading a batch', async () => {
    const records = new Map([
      ['asset-a', { id: 'asset-a', createdAt: 1, blobDataUrl: 'data:image/png;base64,YQ==' }],
      ['asset-b', { id: 'asset-b', createdAt: 2, blob: {} }],
    ])
    const get = vi.fn((id: string) => requestWithResult(records.get(id)))
    vi.stubGlobal('indexedDB', {
      open: () => requestWithResult({ transaction: () => ({ objectStore: () => ({ get }) }) }),
    })

    const result = await batchGetCompositeAssets(['asset-a', 'asset-b'])

    expect([...result.keys()]).toEqual(['asset-a'])
  })
})

describe('generated asset library stores', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads a generated asset from the generatedAssets store', async () => {
    const asset = { id: 'asset-a', imageId: 'hash-a', origins: [] } as unknown as GeneratedAsset
    const get = vi.fn(() => requestWithResult(asset))
    vi.stubGlobal('indexedDB', {
      open: () =>
        requestWithResult({
          transaction: () => ({ objectStore: () => ({ get }) }),
        }),
    })

    await expect(getGeneratedAsset('asset-a')).resolves.toEqual(asset)
    expect(get).toHaveBeenCalledWith('asset-a')
  })

  it('writes generated assets into generatedAssets in one transaction', async () => {
    const put = vi.fn()
    let complete: (() => void) | undefined
    const tx = {
      objectStore: () => ({ put }),
      set oncomplete(value: (() => void) | null) {
        complete = value ?? undefined
        queueMicrotask(() => complete?.())
      },
      onerror: null,
      onabort: null,
    }
    const transaction = vi.fn(() => tx)
    vi.stubGlobal('indexedDB', {
      open: () => requestWithResult({ transaction }),
    })

    await putGeneratedAssets([
      { id: 'asset-a', imageId: 'hash-a', origins: [] } as unknown as GeneratedAsset,
      { id: 'asset-b', imageId: 'hash-b', origins: [] } as unknown as GeneratedAsset,
    ])

    expect(transaction).toHaveBeenCalledWith('generatedAssets', 'readwrite')
    expect(put.mock.calls.map(([asset]) => asset.id)).toEqual(['asset-a', 'asset-b'])
  })

  it('deletes a generated asset by id', async () => {
    const del = vi.fn(() => requestWithResult(undefined))
    let complete: (() => void) | undefined
    const tx = {
      objectStore: () => ({ delete: del }),
      set oncomplete(value: (() => void) | null) {
        complete = value ?? undefined
        queueMicrotask(() => complete?.())
      },
      onerror: null,
      onabort: null,
    }
    vi.stubGlobal('indexedDB', {
      open: () => requestWithResult({ transaction: () => tx }),
    })

    await deleteGeneratedAsset('asset-a')
    expect(del).toHaveBeenCalledWith('asset-a')
  })

  it('writes collections, tags and tombstones to their own stores', async () => {
    const usedStores: string[] = []
    let complete: (() => void) | undefined
    const tx = {
      objectStore: (name: string) => {
        usedStores.push(name)
        return { put: vi.fn() }
      },
      set oncomplete(value: (() => void) | null) {
        complete = value ?? undefined
        queueMicrotask(() => complete?.())
      },
      onerror: null,
      onabort: null,
    }
    const transaction = vi.fn(() => tx)
    vi.stubGlobal('indexedDB', {
      open: () => requestWithResult({ transaction }),
    })

    const collection: AssetCollection = {
      id: 'c1',
      name: 'x',
      normalizedName: 'x',
      parentId: null,
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    }
    const tag: AssetTag = {
      id: 't1',
      name: 'y',
      normalizedName: 'y',
      parentId: null,
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    }
    await putAssetCollections([collection])
    await putAssetTags([tag])
    await putAssetTombstones([{ id: 'tomb-1', imageId: 'hash-a', purgedAt: 1, lastOriginOccurredAt: 1 }])

    expect(usedStores).toEqual(['assetCollections', 'assetTags', 'assetTombstones'])
  })

  it('counts generated asset stores in storage stats', async () => {
    const counts: Record<string, number> = {
      tasks: 3,
      images: 4,
      thumbnails: 4,
      agentConversations: 0,
      compositeAssets: 0,
      generatedAssets: 7,
      assetCollections: 2,
      assetTags: 5,
      assetTombstones: 1,
    }
    vi.stubGlobal('indexedDB', {
      open: () =>
        requestWithResult({
          transaction: (name: string) => ({
            objectStore: () => ({ count: () => requestWithResult(counts[name]) }),
          }),
        }),
    })

    const result = await getStorageRecordCounts()
    expect(result.generatedAssets).toBe(7)
    expect(result.assetCollections).toBe(2)
    expect(result.assetTags).toBe(5)
    expect(result.assetTombstones).toBe(1)
  })
})

describe('irrecoverable blob record tolerance', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stubStoreWithGets(gets: Record<string, { value?: unknown; error?: Error }>) {
    vi.stubGlobal('indexedDB', {
      open: () =>
        requestWithResult({
          transaction: () => ({
            objectStore: () => ({
              get: (id: string) => {
                const spec = gets[id]
                const request: {
                  result?: unknown
                  error?: Error
                  onsuccess?: () => void
                  onerror?: () => void
                } = {}
                queueMicrotask(() => {
                  if (spec?.error) {
                    request.error = spec.error
                    request.onerror?.()
                  } else {
                    request.result = spec?.value
                    request.onsuccess?.()
                  }
                })
                return request
              },
            }),
          }),
        }),
    })
  }

  const blobMissingError = () =>
    new DOMException(
      'Data lost due to missing file. Affected record should be considered irrecoverable',
      'UnknownError',
    )

  it('batchGetImages skips records whose blob file is missing instead of rejecting the batch', async () => {
    stubStoreWithGets({
      'lost-a': { error: blobMissingError() },
      'ok-b': { value: { id: 'ok-b', localPath: 'C:\\cache\\ok-b.png' } },
    })
    const map = await batchGetImages(['lost-a', 'ok-b'])
    expect([...map.keys()]).toEqual(['ok-b'])
    expect(map.get('lost-a')).toBeUndefined()
  })

  it('batchGetImages still rejects on non-blob read errors', async () => {
    stubStoreWithGets({
      'bad-a': { error: new DOMException('The transaction was aborted', 'AbortError') },
    })
    await expect(batchGetImages(['bad-a'])).rejects.toThrow(/abort/i)
  })

  it('getImage resolves undefined for a blob-missing record', async () => {
    stubStoreWithGets({ 'lost-a': { error: blobMissingError() } })
    await expect(getImage('lost-a')).resolves.toBeUndefined()
  })

  it('getImage still rejects on non-blob read errors', async () => {
    stubStoreWithGets({ 'bad-a': { error: new DOMException('The transaction was aborted', 'AbortError') } })
    await expect(getImage('bad-a')).rejects.toThrow(/abort/i)
  })

  it('getLegacyImageBatch skips unreadable records and continues scanning', async () => {
    const records = [
      { id: 'ok-1', dataUrl: 'data:image/png;base64,AA==' },
      { id: 'lost-2' },
      { id: 'ok-3', dataUrl: 'data:image/png;base64,BB==' },
    ]
    // 第二跳记录读取 value 时抛错（模拟 blob 文件缺失）
    const valueFor = (index: number) => {
      if (index === 1) throw blobMissingError()
      return records[index]
    }
    let index = -1
    const request: {
      result?: unknown
      onsuccess?: () => void
      onerror?: () => void
    } = {}
    const fire = () => {
      index++
      if (index >= records.length) {
        request.result = null
        request.onsuccess?.()
        return
      }
      request.result = {
        get value() {
          return valueFor(index)
        },
        continue: () => setTimeout(fire, 0),
      }
      request.onsuccess?.()
    }
    vi.stubGlobal('indexedDB', {
      open: () =>
        requestWithResult({
          transaction: () => ({
            objectStore: () => ({ openCursor: () => request }),
          }),
        }),
    })
    // 用宏任务启动游标模拟：确保 getLegacyImageBatch 已挂好 onsuccess 处理器
    setTimeout(fire, 0)

    const batch = await getLegacyImageBatch(10)
    expect(batch.map((image) => image.id)).toEqual(['ok-1', 'ok-3'])
  })
})

function requestWithResult<T>(result: T) {
  const request: {
    result?: T
    error?: Error
    onsuccess?: () => void
    onerror?: () => void
  } = {}
  queueMicrotask(() => {
    request.result = result
    request.onsuccess?.()
  })
  return request
}

describe('缩略图磁盘通道（full / grid）', () => {
  /** 注入带缩略图读写 API 的 Electron window；返回清理函数。 */
  function useElectronWindow(api: Record<string, unknown>) {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { electronAPI: { isElectron: true, ...api } },
    })
    return () => Reflect.deleteProperty(globalThis, 'window')
  }

  it('getFreshThumbnailFromDisk 把 variant 透传给主进程（默认 full）', async () => {
    const readThumbnail = vi.fn(async (_id: string, _version: number, variant?: string) =>
      variant === 'grid' ? { dataUrl: 'data:image/webp;base64,GRID', width: 288, height: 288 } : null,
    )
    const restore = useElectronWindow({ readThumbnail })
    try {
      const grid = await getFreshThumbnailFromDisk('grid-read-1', 'grid')
      expect(grid?.thumbnailDataUrl).toBe('data:image/webp;base64,GRID')
      expect(readThumbnail).toHaveBeenCalledWith('grid-read-1', CURRENT_THUMBNAIL_VERSION, 'grid')

      const fallbackFull = await getFreshThumbnailFromDisk('grid-read-1')
      expect(fallbackFull).toBeUndefined()
      expect(readThumbnail).toHaveBeenCalledWith('grid-read-1', CURRENT_THUMBNAIL_VERSION, 'full')
    } finally {
      restore()
    }
  })

  it('buildGridThumbnail 以 variant=grid 命名空间写盘，并返回可入内存缓存的小图', async () => {
    const writeThumbnail = vi.fn(async () => true)
    const restore = useElectronWindow({ writeThumbnail })
    try {
      // node 测试环境没有 canvas：createImageThumbnailDataUrl 失败后原样返回入参，
      // 这里只验证「拿到 dataUrl → 以 grid 通道落盘」这条链路。
      const dataUrl = await buildGridThumbnail('grid-write-1', 'data:image/webp;base64,FULL')
      expect(dataUrl).toBe('data:image/webp;base64,FULL')
      expect(writeThumbnail).toHaveBeenCalledWith(
        'grid-write-1',
        CURRENT_THUMBNAIL_VERSION,
        'data:image/webp;base64,FULL',
        'grid',
      )
    } finally {
      restore()
    }
  })
})

// 生成一张图会产生「images 记录 + thumbnails 记录」两条不同命名空间的写入。逐条 put 各走一次
// 渲染→主进程→UtilityProcess→SQLite 的完整往返；这里锁定合并通道与逐级回退的分支。
describe('应用记录批量写通道（跨命名空间 put-batch / 同命名空间 put-many）', () => {
  const IMAGE = {
    id: 'batch-image',
    localPath: 'cache-images/batch-image.png',
    createdAt: 1,
    source: 'generated' as const,
  }
  const THUMBNAIL = {
    id: 'batch-image',
    thumbnailDataUrl: 'data:image/webp;base64,T',
    width: 1024,
    height: 1024,
    thumbnailVersion: CURRENT_THUMBNAIL_VERSION,
  }

  /**
   * 注入「完整」的 Electron 应用记录 API（getElectronAppDataApi 要求所有必需通道都在，
   * 缺一个就会整体退化为 IndexedDB）。meta 预置迁移完成标记，跳过遗留数据迁移。
   */
  function useElectronWindow(extra: Record<string, unknown> = {}) {
    const api = {
      isElectron: true,
      appDataGet: vi.fn(async (_namespace: string, id: string) =>
        id === 'electron-app-data-migrated-v1' ? { id, status: 'completed' } : undefined,
      ),
      appDataGetAll: vi.fn(async () => []),
      appDataGetMany: vi.fn(async () => []),
      appDataPut: vi.fn(async () => ({ success: true })),
      appDataPutMany: vi.fn(async () => ({ success: true })),
      appDataReplace: vi.fn(async () => ({ success: true })),
      appDataDelete: vi.fn(async () => ({ success: true })),
      appDataDeleteMany: vi.fn(async () => ({ success: true })),
      appDataClear: vi.fn(async () => ({ success: true })),
      appDataImportStores: vi.fn(async () => ({ success: true })),
      ...extra,
    }
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI: api } })
    return { api, restore: () => Reflect.deleteProperty(globalThis, 'window') }
  }

  it('图片 + 缩略图合并为一次跨命名空间提交', async () => {
    const appDataPutBatch = vi.fn(async (_entries: Array<{ namespace: string; id: string; value: unknown }>) => ({
      success: true,
    }))
    const { api, restore } = useElectronWindow({ appDataPutBatch })
    try {
      await putImageRecords(IMAGE, THUMBNAIL)

      expect(appDataPutBatch).toHaveBeenCalledTimes(1)
      expect(appDataPutBatch.mock.calls[0][0]).toEqual([
        { namespace: 'images', id: 'batch-image', value: IMAGE },
        { namespace: 'thumbnails', id: 'batch-image', value: THUMBNAIL },
      ])
      // 关键回归点：合并通道生效时不能再逐条写一遍
      expect(api.appDataPut).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it('只写图片记录时批量载荷里不含缩略图条目', async () => {
    const appDataPutBatch = vi.fn(async (_entries: Array<{ namespace: string; id: string; value: unknown }>) => ({
      success: true,
    }))
    const { restore } = useElectronWindow({ appDataPutBatch })
    try {
      await putImageRecords(IMAGE, null)
      expect(appDataPutBatch.mock.calls[0][0]).toEqual([{ namespace: 'images', id: 'batch-image', value: IMAGE }])
    } finally {
      restore()
    }
  })

  it('两条记录都为空时一次通道都不调', async () => {
    const appDataPutBatch = vi.fn(async (_entries: Array<{ namespace: string; id: string; value: unknown }>) => ({
      success: true,
    }))
    const { api, restore } = useElectronWindow({ appDataPutBatch })
    try {
      await putImageRecords(null, null)
      expect(appDataPutBatch).not.toHaveBeenCalled()
      expect(api.appDataPut).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it('旧 preload 没有 put-batch 时回退为逐条写入，语义不变', async () => {
    const { api, restore } = useElectronWindow()
    try {
      await putImageRecords(IMAGE, THUMBNAIL)

      expect(api.appDataPut).toHaveBeenNthCalledWith(1, 'images', 'batch-image', IMAGE)
      expect(api.appDataPut).toHaveBeenNthCalledWith(2, 'thumbnails', 'batch-image', THUMBNAIL)
    } finally {
      restore()
    }
  })

  it('批量写任务记录走一次 put-many，而不是 N 次 put', async () => {
    const { api, restore } = useElectronWindow()
    try {
      const tasks = [
        { id: 't1', status: 'done', outputImages: [] },
        { id: 't2', status: 'done', outputImages: [] },
        { id: 't3', status: 'done', outputImages: [] },
      ] as unknown as Parameters<typeof putTasks>[0]

      await putTasks(tasks)

      expect(api.appDataPutMany).toHaveBeenCalledTimes(1)
      const [namespace, records] = api.appDataPutMany.mock.calls[0] as unknown as [string, Array<{ id: string }>]
      expect(namespace).toBe('tasks')
      expect(records.map((record) => record.id)).toEqual(['t1', 't2', 't3'])
      expect(api.appDataPut).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it('空任务数组不产生任何写入', async () => {
    const { api, restore } = useElectronWindow()
    try {
      await putTasks([])
      expect(api.appDataPutMany).not.toHaveBeenCalled()
      expect(api.appDataPut).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })
})
