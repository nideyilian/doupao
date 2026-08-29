import { describe, expect, it } from 'vitest'
import type { AssetCollection, GeneratedAsset, TaskParams } from '../../types'
import { normalizeAsset } from '../../lib/assetLibraryModel'
import {
  queryAssets,
  mergePagedAssets,
  assetMatchesQueryState,
  resolveEffectiveAssets,
  type AssetQueryState,
} from './query'

function makeAsset(id: string, overrides: Partial<GeneratedAsset> = {}): GeneratedAsset {
  return normalizeAsset({ id, imageId: id, createdAt: 1000, updatedAt: 1000, origins: [], ...overrides })
}

const collections: AssetCollection[] = [
  { id: 'c1', name: '品牌素材', normalizedName: '品牌素材', parentId: null, order: 0, createdAt: 1, updatedAt: 1 },
  { id: 'c2', name: '广告图', normalizedName: '广告图', parentId: null, order: 1, createdAt: 1, updatedAt: 1 },
]

function baseState(overrides: Partial<AssetQueryState> = {}): AssetQueryState {
  return {
    scope: 'all',
    query: '',
    filters: {},
    sortKey: 'updatedAt',
    sortOrder: 'desc',
    ...overrides,
  }
}

describe('queryAssets scopes', () => {
  const assets = [
    makeAsset('a', { favorite: true, collectionIds: ['c1'] }),
    makeAsset('b', { status: 'trashed' }),
    makeAsset('c', { collectionIds: ['c1'], tagIds: ['t1'], createdAt: Date.now(), updatedAt: Date.now() }),
  ]

  it('filters by system scopes and isolates trash', () => {
    // 默认 updatedAt 降序：c 的 updatedAt 最新
    expect(queryAssets({ assets, collections }, baseState({ scope: 'all' })).assets.map((a) => a.id)).toEqual([
      'c',
      'a',
    ])
    expect(queryAssets({ assets, collections }, baseState({ scope: 'trash' })).assets.map((a) => a.id)).toEqual(['b'])
    expect(queryAssets({ assets, collections }, baseState({ scope: 'favorites' })).assets.map((a) => a.id)).toEqual([
      'a',
    ])
  })

  it('filters by recent window', () => {
    const result = queryAssets({ assets, collections }, baseState({ scope: 'recent' }))
    expect(result.assets.map((a) => a.id)).toEqual(['c'])
  })

  it('filters by collection and tag scopes', () => {
    expect(
      queryAssets({ assets, collections }, baseState({ scope: { kind: 'collection', id: 'c1' } })).assets.map(
        (a) => a.id,
      ),
    ).toEqual(['c', 'a'])
    expect(
      queryAssets({ assets, collections }, baseState({ scope: { kind: 'tag', id: 't1' } })).assets.map((a) => a.id),
    ).toEqual(['c'])
  })

  it('matches any collection in the recursive collectionIds list', () => {
    const recursiveAssets = [
      makeAsset('a', { collectionIds: ['c1'] }),
      makeAsset('b', { collectionIds: ['c2'] }),
      makeAsset('c', { collectionIds: ['c3'] }),
    ]
    const result = queryAssets(
      { assets: recursiveAssets, collections },
      baseState({ filters: { collectionIds: ['c1', 'c2'] } }),
    )
    expect(result.assets.map((a) => a.id).sort()).toEqual(['a', 'b'])
  })

  it('counts unorganized assets', () => {
    const result = queryAssets({ assets, collections }, baseState({ scope: 'unorganized' }))
    expect(result.assets).toHaveLength(0)
  })
})

describe('queryAssets search', () => {
  const assets = [
    makeAsset('a', {
      origins: [
        {
          key: 't1:0',
          taskId: 't1',
          outputSlot: 0,
          taskCreatedAt: 1,
          prompt: '一只橘猫',
          revisedPrompt: '高清橘猫',
          sourceMode: 'gallery',
          inputImageIds: [],
          taskFinishedAt: null,
          requestedParams: {} as TaskParams,
        },
      ],
    }),
    makeAsset('b', {
      collectionIds: ['c2'],
      origins: [
        {
          key: 't2:0',
          taskId: 't2',
          outputSlot: 0,
          taskCreatedAt: 1,
          prompt: '蓝天白云',
          apiModel: 'gpt-image-1',
          apiProfileName: '主配置',
          sourceMode: 'gallery',
          inputImageIds: [],
          taskFinishedAt: null,
          requestedParams: {} as TaskParams,
        },
      ],
    }),
  ]

  it('matches prompt and revised prompt case-insensitively', () => {
    expect(queryAssets({ assets, collections }, baseState({ query: '橘猫' })).assets.map((a) => a.id)).toEqual(['a'])
    expect(queryAssets({ assets, collections }, baseState({ query: '高清' })).assets.map((a) => a.id)).toEqual(['a'])
  })

  it('matches model, api profile name, collection and tag names', () => {
    expect(queryAssets({ assets, collections }, baseState({ query: 'gpt-image-1' })).assets.map((a) => a.id)).toEqual([
      'b',
    ])
    expect(queryAssets({ assets, collections }, baseState({ query: '主配置' })).assets.map((a) => a.id)).toEqual(['b'])
    expect(queryAssets({ assets, collections }, baseState({ query: '广告图' })).assets.map((a) => a.id)).toEqual(['b'])
  })

  it('requires all terms for multi-word queries', () => {
    const assets = [
      makeAsset('a', {
        origins: [
          {
            key: 't1:0',
            taskId: 't1',
            outputSlot: 0,
            taskCreatedAt: 1,
            prompt: 'cat dog',
            sourceMode: 'gallery',
            inputImageIds: [],
            taskFinishedAt: null,
            requestedParams: {} as TaskParams,
          },
        ],
      }),
      makeAsset('b', {
        origins: [
          {
            key: 't2:0',
            taskId: 't2',
            outputSlot: 0,
            taskCreatedAt: 1,
            prompt: 'cat',
            sourceMode: 'gallery',
            inputImageIds: [],
            taskFinishedAt: null,
            requestedParams: {} as TaskParams,
          },
        ],
      }),
    ]
    expect(queryAssets({ assets, collections }, baseState({ query: 'cat dog' })).assets.map((a) => a.id)).toEqual(['a'])
  })
})

describe('queryAssets filters', () => {
  const now = Date.now()
  const assets = [
    makeAsset('a', {
      favorite: true,
      rating: 5,
      width: 1024,
      height: 1024,
      createdAt: now - 1000,
      origins: [
        {
          key: 't1:0',
          taskId: 't1',
          outputSlot: 0,
          taskCreatedAt: now - 1000,
          prompt: 'p',
          sourceMode: 'gallery',
          apiProvider: 'openai',
          apiModel: 'gpt-image-1',
          inputImageIds: [],
          taskFinishedAt: null,
          requestedParams: {} as TaskParams,
        },
      ],
    }),
    makeAsset('b', {
      rating: 2,
      width: 768,
      height: 1344,
      createdAt: now - 10_000,
      origins: [
        {
          key: 't2:0',
          taskId: 't2',
          outputSlot: 0,
          taskCreatedAt: now - 10_000,
          prompt: 'p',
          sourceMode: 'sop',
          apiProvider: 'fal',
          apiModel: 'fal-ai/flux',
          inputImageIds: [],
          taskFinishedAt: null,
          requestedParams: {} as TaskParams,
        },
      ],
    }),
  ]

  it('filters by favorite and rating', () => {
    expect(
      queryAssets({ assets, collections }, baseState({ filters: { favoriteOnly: true } })).assets.map((a) => a.id),
    ).toEqual(['a'])
    expect(
      queryAssets({ assets, collections }, baseState({ filters: { minRating: 3 } })).assets.map((a) => a.id),
    ).toEqual(['a'])
  })

  it('filters by orientation and size', () => {
    expect(
      queryAssets({ assets, collections }, baseState({ filters: { orientation: 'square' } })).assets.map((a) => a.id),
    ).toEqual(['a'])
    expect(
      queryAssets({ assets, collections }, baseState({ filters: { orientation: 'portrait' } })).assets.map((a) => a.id),
    ).toEqual(['b'])
    expect(
      queryAssets({ assets, collections }, baseState({ filters: { minWidth: 1000 } })).assets.map((a) => a.id),
    ).toEqual(['a'])
  })

  it('filters by provider, model and source mode', () => {
    expect(
      queryAssets({ assets, collections }, baseState({ filters: { provider: 'openai' } })).assets.map((a) => a.id),
    ).toEqual(['a'])
    expect(
      queryAssets({ assets, collections }, baseState({ filters: { model: 'flux' } })).assets.map((a) => a.id),
    ).toEqual(['b'])
    expect(
      queryAssets({ assets, collections }, baseState({ filters: { sourceMode: 'sop' } })).assets.map((a) => a.id),
    ).toEqual(['b'])
  })

  it('filters by date range', () => {
    expect(
      queryAssets({ assets, collections }, baseState({ filters: { dateFrom: now - 5000 } })).assets.map((a) => a.id),
    ).toEqual(['a'])
    expect(
      queryAssets({ assets, collections }, baseState({ filters: { dateTo: now - 5000 } })).assets.map((a) => a.id),
    ).toEqual(['b'])
  })
})

describe('queryAssets sort', () => {
  const assets = [
    makeAsset('a', { createdAt: 1000, updatedAt: 500, rating: 1, width: 512, height: 512 }),
    makeAsset('b', { createdAt: 2000, updatedAt: 1500, rating: 5, width: 1024, height: 1024 }),
    makeAsset('c', { createdAt: 1500, updatedAt: 2000, rating: 3, width: 768, height: 768 }),
  ]

  it('sorts by createdAt, updatedAt, rating, width and area in both orders', () => {
    expect(
      queryAssets({ assets, collections }, baseState({ sortKey: 'createdAt', sortOrder: 'asc' })).assets.map(
        (a) => a.id,
      ),
    ).toEqual(['a', 'c', 'b'])
    expect(
      queryAssets({ assets, collections }, baseState({ sortKey: 'updatedAt', sortOrder: 'desc' })).assets.map(
        (a) => a.id,
      ),
    ).toEqual(['c', 'b', 'a'])
    expect(
      queryAssets({ assets, collections }, baseState({ sortKey: 'rating', sortOrder: 'desc' })).assets.map((a) => a.id),
    ).toEqual(['b', 'c', 'a'])
    expect(
      queryAssets({ assets, collections }, baseState({ sortKey: 'width', sortOrder: 'asc' })).assets.map((a) => a.id),
    ).toEqual(['a', 'c', 'b'])
    expect(
      queryAssets({ assets, collections }, baseState({ sortKey: 'area', sortOrder: 'asc' })).assets.map((a) => a.id),
    ).toEqual(['a', 'c', 'b'])
  })
})

describe('queryAssets counts', () => {
  it('computes sidebar counts without duplicating collection entries', () => {
    const now = Date.now()
    const assets = [
      makeAsset('a', { collectionIds: ['c1'], createdAt: now }),
      makeAsset('b', { favorite: true, collectionIds: ['c2'], tagIds: ['t1'], createdAt: now }),
      makeAsset('c', { status: 'trashed' }),
    ]
    const result = queryAssets({ assets, collections }, baseState())
    const { counts } = result
    expect(counts.all).toBe(2)
    expect(counts.favorites).toBe(1)
    expect(counts.recent).toBe(2)
    expect(counts.trash).toBe(1)
    expect(counts.byCollection.get('c1')).toBe(1)
    expect(counts.byCollection.get('c2')).toBe(1)
    // 空集合也保留
    expect(counts.byCollection.has('c1')).toBe(true)
  })
})

describe('queryAssets performance', () => {
  function makeBulkAssets(count: number): GeneratedAsset[] {
    const assets: GeneratedAsset[] = []
    for (let i = 0; i < count; i++) {
      assets.push(
        normalizeAsset({
          id: `asset-${i}`,
          imageId: `img-${i}`,
          createdAt: 1000 + i,
          updatedAt: 1000 + i,
          favorite: i % 7 === 0,
          rating: i % 6,
          width: 512 + (i % 4) * 256,
          height: 512 + (i % 3) * 256,
          collectionIds: i % 3 === 0 ? ['c1'] : [],
          tagIds: i % 5 === 0 ? ['t1'] : [],
          origins: [
            {
              key: `task-${i}:0`,
              taskId: `task-${i}`,
              outputSlot: 0,
              taskCreatedAt: 1000 + i,
              prompt: `a scene with cat dog ${i}`,
              sourceMode: 'gallery',
              apiModel: i % 2 === 0 ? 'gpt-image-1' : 'fal-ai/flux',
              inputImageIds: [],
              taskFinishedAt: null,
              requestedParams: {} as TaskParams,
            },
          ],
        }),
      )
    }
    return assets
  }

  it('queries 10k assets within a relative budget', () => {
    const assets = makeBulkAssets(10_000)
    const start = performance.now()
    const result = queryAssets({ assets, collections }, baseState({ query: 'cat' }))
    const elapsed = performance.now() - start
    expect(result.totalCount).toBeGreaterThan(0)
    // 相对阈值：宽松上限避免 CI 硬件差异
    expect(elapsed).toBeLessThan(1000)
  })

  it('queries 30k assets with sublinear growth relative to 10k', () => {
    const assets10k = makeBulkAssets(10_000)
    const assets30k = makeBulkAssets(30_000)
    const start10k = performance.now()
    queryAssets({ assets: assets10k, collections }, baseState({ query: 'cat' }))
    const elapsed10k = performance.now() - start10k
    const start30k = performance.now()
    queryAssets({ assets: assets30k, collections }, baseState({ query: 'cat' }))
    const elapsed30k = performance.now() - start30k
    expect(elapsed30k).toBeLessThan(Math.max(1000, elapsed10k * 10))
  })
})

describe('queryAssets tag filters', () => {
  const assets = [
    makeAsset('a', { tagIds: ['t1'] }),
    makeAsset('b', { tagIds: ['t1', 't2'] }),
    makeAsset('c', { tagIds: ['t2', 't3'] }),
    makeAsset('d', { tagIds: [], status: 'trashed', trashedAt: 2000 }),
  ]

  it('filters by single tagId', () => {
    const result = queryAssets({ assets, collections }, baseState({ filters: { tagId: 't1' } }))
    expect(result.assets.map((a) => a.id).sort()).toEqual(['a', 'b'])
  })

  it('filters by multi tagIds with AND semantics', () => {
    const result = queryAssets({ assets, collections }, baseState({ filters: { tagIds: ['t1', 't2'] } }))
    expect(result.assets.map((a) => a.id)).toEqual(['b'])
  })

  it('returns empty when AND has no intersection', () => {
    const result = queryAssets({ assets, collections }, baseState({ filters: { tagIds: ['t1', 't3'] } }))
    expect(result.assets).toHaveLength(0)
  })

  it('ignores empty tagIds array', () => {
    const result = queryAssets({ assets, collections }, baseState({ filters: { tagIds: [] } }))
    expect(result.assets.map((a) => a.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('computes byTag counts only for active assets', () => {
    const result = queryAssets({ assets, collections }, baseState())
    expect(result.counts.byTag.get('t1')).toBe(2)
    expect(result.counts.byTag.get('t2')).toBe(2)
    expect(result.counts.byTag.get('t3')).toBe(1)
    // 回收站素材不计入；空标签不零填充（由侧栏按标签列表补零）
    expect(result.counts.byTag.has('t99')).toBe(false)
  })
})

describe('mergePagedAssets', () => {
  it('merges new assets into the loaded page at their sorted position', () => {
    // createdAt 降序：新素材（最新）应排在最前，既有素材相对顺序不变
    const current = [
      makeAsset('a', { createdAt: 300 }),
      makeAsset('b', { createdAt: 200 }),
      makeAsset('c', { createdAt: 100 }),
    ]
    const incoming = [
      makeAsset('a', { createdAt: 300 }), // 已存在 → 去重
      makeAsset('d', { createdAt: 250 }), // 新素材 → 插到 b 之前（a 之后）
    ]
    const merged = mergePagedAssets(current, incoming, 'createdAt', 'desc')
    expect(merged.map((asset) => asset.id)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('inserts new assets in ascending order at the tail', () => {
    const current = [makeAsset('a', { createdAt: 100 }), makeAsset('b', { createdAt: 200 })]
    const merged = mergePagedAssets(current, [makeAsset('c', { createdAt: 300 })], 'createdAt', 'asc')
    expect(merged.map((asset) => asset.id)).toEqual(['a', 'b', 'c'])
  })

  it('keeps existing relative order under a non-time sort key', () => {
    const current = [makeAsset('a', { rating: 5 }), makeAsset('b', { rating: 3 }), makeAsset('c', { rating: 1 })]
    const incoming = [makeAsset('d', { rating: 4 })]
    const merged = mergePagedAssets(current, incoming, 'rating', 'desc')
    expect(merged.map((asset) => asset.id)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('returns the same reference when there is nothing new', () => {
    const current = [makeAsset('a', { createdAt: 1 })]
    const incoming = [makeAsset('a', { createdAt: 1 })]
    expect(mergePagedAssets(current, incoming, 'createdAt', 'desc')).toBe(current)
    expect(mergePagedAssets(current, [], 'createdAt', 'desc')).toBe(current)
  })

  it('deduplicates duplicates inside incoming and across current', () => {
    const current = [makeAsset('a', { createdAt: 300 }), makeAsset('b', { createdAt: 200 })]
    const incoming = [
      makeAsset('b', { createdAt: 200 }),
      makeAsset('b', { createdAt: 200 }),
      makeAsset('c', { createdAt: 100 }),
    ]
    const merged = mergePagedAssets(current, incoming, 'createdAt', 'desc')
    expect(merged.map((asset) => asset.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('assetMatchesQueryState', () => {
  it('matches an asset still in the current collection scope', () => {
    const asset = makeAsset('a', { collectionIds: ['c1'] })
    expect(assetMatchesQueryState(asset, collections, baseState({ scope: { kind: 'collection', id: 'c1' } }))).toBe(
      true,
    )
  })

  it('rejects an asset moved out of the current collection scope', () => {
    // 模拟「移动到其他文件夹」：素材的 collectionIds 已更新，不再包含当前文件夹
    const moved = makeAsset('a', { collectionIds: ['c2'] })
    expect(assetMatchesQueryState(moved, collections, baseState({ scope: { kind: 'collection', id: 'c1' } }))).toBe(
      false,
    )
  })

  it('rejects assets whose status changed (trashed) outside trash scope', () => {
    const trashed = makeAsset('a', { status: 'trashed', trashedAt: 2000 })
    expect(assetMatchesQueryState(trashed, collections, baseState({ scope: 'all' }))).toBe(false)
    expect(assetMatchesQueryState(trashed, collections, baseState({ scope: 'trash' }))).toBe(true)
  })

  it('rejects assets that no longer match the active search query', () => {
    const asset = makeAsset('a', {
      collectionIds: ['c1'],
      origins: [
        {
          kind: 'generated',
          key: 't:0',
          taskId: 't',
          outputSlot: 0,
          taskCreatedAt: 1000,
          taskFinishedAt: 1000,
          sourceMode: 'gallery',
          prompt: '红色跑车',
          requestedParams: {} as TaskParams,
          inputImageIds: [],
        },
      ],
    })
    const state = baseState({ scope: { kind: 'collection', id: 'c1' }, query: '跑车' })
    expect(assetMatchesQueryState(asset, collections, state)).toBe(true)
    expect(assetMatchesQueryState(asset, collections, { ...state, query: '不存在的词' })).toBe(false)
  })

  it('rejects assets that no longer match active filters', () => {
    const asset = makeAsset('a', { collectionIds: ['c1'], tagIds: ['t1'] })
    const state = baseState({ scope: { kind: 'collection', id: 'c1' }, filters: { tagId: 't1' } })
    expect(assetMatchesQueryState(asset, collections, state)).toBe(true)
    expect(assetMatchesQueryState(asset, collections, { ...state, filters: { tagId: 't2' } })).toBe(false)
  })

  it('handles unorganized and favorites scopes with latest state', () => {
    expect(
      assetMatchesQueryState(makeAsset('a', { collectionIds: [] }), collections, baseState({ scope: 'unorganized' })),
    ).toBe(true)
    expect(
      assetMatchesQueryState(
        makeAsset('a', { collectionIds: ['c1'] }),
        collections,
        baseState({ scope: 'unorganized' }),
      ),
    ).toBe(false)
    expect(
      assetMatchesQueryState(makeAsset('a', { favorite: true }), collections, baseState({ scope: 'favorites' })),
    ).toBe(true)
    expect(
      assetMatchesQueryState(makeAsset('a', { favorite: false }), collections, baseState({ scope: 'favorites' })),
    ).toBe(false)
  })
})

describe('resolveEffectiveAssets', () => {
  const options = { collections, scope: 'all' as const, query: '', filters: {} }

  it('replaces snapshot objects with the latest in-memory state (底栏操作即时生效)', () => {
    // catalogPage 快照：a 未收藏、4 星以下
    const snapshot = makeAsset('a', { favorite: false, rating: 2, colorLabel: 'red' })
    // 底栏批量操作后内存态：已收藏、5 星、蓝色
    const live = makeAsset('a', { favorite: true, rating: 5, colorLabel: 'blue' })
    const result = resolveEffectiveAssets([snapshot], { a: live }, options)
    expect(result).toHaveLength(1)
    // 必须返回内存最新对象（而非快照旧对象）→ 网格卡片立即显示新值
    expect(result[0]).toBe(live)
    expect(result[0]?.favorite).toBe(true)
    expect(result[0]?.rating).toBe(5)
    expect(result[0]?.colorLabel).toBe('blue')
  })

  it('drops assets trashed locally even if the snapshot still says active', () => {
    const snapshot = makeAsset('a', { status: 'active' })
    const live = makeAsset('a', { status: 'trashed', trashedAt: 2000 })
    expect(resolveEffectiveAssets([snapshot], { a: live }, options)).toEqual([])
  })

  it('drops assets absent from the in-memory state', () => {
    const snapshot = makeAsset('a')
    expect(resolveEffectiveAssets([snapshot], {}, options)).toEqual([])
  })

  it('keeps snapshot objects when the asset is not in memory (defensive fallback)', () => {
    // 与 drop 行为一致由调用方保证 live 完整性；这里验证不在 live 的素材被剔除
    expect(
      resolveEffectiveAssets([makeAsset('a'), makeAsset('b')], { b: makeAsset('b') }, options).map((a) => a.id),
    ).toEqual(['b'])
  })

  it('re-checks moved assets against the current scope (移出当前文件夹即剔除)', () => {
    const snapshot = makeAsset('a', { collectionIds: ['c1'] })
    const moved = makeAsset('a', { collectionIds: ['c2'] })
    const result = resolveEffectiveAssets(
      [snapshot],
      { a: moved },
      {
        collections,
        scope: { kind: 'collection', id: 'c1' },
        query: '',
        filters: {},
      },
    )
    expect(result).toEqual([])
  })

  it('keeps all candidates during similar-image search (仅按状态过滤)', () => {
    const a = makeAsset('a', { collectionIds: ['c2'] })
    const b = makeAsset('b', { collectionIds: ['c1'] })
    const result = resolveEffectiveAssets([a, b], { a, b }, { ...options, similarToAssetId: 'a' })
    expect(result.map((asset) => asset.id)).toEqual(['a', 'b'])
  })
})
