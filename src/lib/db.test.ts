import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GeneratedAsset } from '../types'
import {
  batchGetCompositeAssets,
  batchGetImages,
  commitImportedRecords,
  deleteGeneratedAsset,
  getCompositeAsset,
  getGeneratedAsset,
  getImage,
  getLegacyImageBatch,
  getStorageRecordCounts,
  loadTasksIncrementally,
  putAssetCollections,
  putAssetTags,
  putAssetTombstones,
  putCompositeAssets,
  putGeneratedAssets,
  putImage,
} from './db'

describe('database transaction completion', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('rejects when a write request succeeds but its transaction aborts', async () => {
    const putRequest: any = {}
    const tx: any = {
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
      tasks: [{ id: 'task-a' } as any],
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
    const request: any = {}
    const cursor = {
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
    const request: any = {}
    let complete: (() => void) | null = null
    const cursor: any = {
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

    const result = await loadTasksIncrementally((task: any) => ({
      ...task,
      payload: undefined,
    }))

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

    await putAssetCollections([{ id: 'c1', name: 'x' } as any])
    await putAssetTags([{ id: 't1', name: 'y' } as any])
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
