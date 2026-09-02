import { afterEach, describe, expect, it } from 'vitest'
import type { GeneratedAsset } from '../src/types'
import { AssetCatalog } from './asset-catalog'

const catalogs: AssetCatalog[] = []

function makeAsset(id: string, prompt: string, updatedAt: number): GeneratedAsset {
  return {
    id,
    imageId: `hash-${id}`,
    blobId: `blob:hash-${id}`,
    currentVersionId: `version:${id}`,
    status: 'active',
    createdAt: updatedAt,
    updatedAt,
    trashedAt: null,
    favorite: id === 'a',
    rating: id === 'a' ? 5 : 0,
    collectionIds: [],
    tagIds: [],
    origins: [
      {
        kind: 'generated',
        key: `task:${id}`,
        taskId: `task-${id}`,
        outputSlot: 0,
        taskCreatedAt: updatedAt,
        taskFinishedAt: updatedAt,
        sourceMode: 'gallery',
        prompt,
        requestedParams: {} as never,
        inputImageIds: [],
        maskTargetImageId: null,
        maskImageId: null,
      },
    ],
    primaryOriginKey: `task:${id}`,
    parentAssetIds: [],
    metadataVersion: 2,
  }
}

afterEach(() => {
  while (catalogs.length) catalogs.pop()?.close()
})

describe('SQLite asset catalog', () => {
  it('stores independent asset/blob/version records and performs FTS queries', () => {
    const catalog = new AssetCatalog(':memory:')
    catalogs.push(catalog)
    catalog.upsertAssets([
      { asset: makeAsset('a', '橘猫 电商海报', 30), localPath: 'D:/a.png' },
      { asset: makeAsset('b', '雪山摄影', 20), localPath: 'D:/b.png' },
    ])

    const page = catalog.query({
      scope: 'all',
      query: '橘猫',
      filters: {},
      sortKey: 'updatedAt',
      sortOrder: 'desc',
      limit: 20,
    })
    expect(page.assets.map((asset) => asset.id)).toEqual(['a'])
    expect(page.counts.all).toBe(2)
    expect(catalog.getAsset('a')?.blob.localPath).toBe('D:/a.png')
  })

  it('uses a stable cursor instead of loading the full result set', () => {
    const catalog = new AssetCatalog(':memory:')
    catalogs.push(catalog)
    catalog.upsertAssets([
      { asset: makeAsset('a', 'one', 30) },
      { asset: makeAsset('b', 'two', 20) },
      { asset: makeAsset('c', 'three', 10) },
    ])
    const first = catalog.query({
      scope: 'all',
      query: '',
      filters: {},
      sortKey: 'updatedAt',
      sortOrder: 'desc',
      limit: 2,
    })
    const second = catalog.query({
      scope: 'all',
      query: '',
      filters: {},
      sortKey: 'updatedAt',
      sortOrder: 'desc',
      limit: 2,
      cursor: first.nextCursor,
    })
    expect(first.assets.map((asset) => asset.id)).toEqual(['a', 'b'])
    expect(second.assets.map((asset) => asset.id)).toEqual(['c'])
    expect(second.nextCursor).toBeNull()
  })

  it('keeps collections, tags and tombstones as authoritative metadata tables', () => {
    const catalog = new AssetCatalog(':memory:')
    catalogs.push(catalog)

    catalog.putCollections([
      { id: 'c1', name: '广告图', normalizedName: '广告图', parentId: null, order: 0, createdAt: 1, updatedAt: 1 },
      { id: 'c2', name: '子项目', normalizedName: '子项目', parentId: 'c1', order: 1, createdAt: 2, updatedAt: 2 },
    ])
    expect(catalog.getAllCollections().map((item) => item.id)).toEqual(['c1', 'c2'])
    expect(catalog.getAllCollections()[1]?.parentId).toBe('c1')

    catalog.putTags([
      {
        id: 't1',
        name: '高清',
        normalizedName: '高清',
        parentId: null,
        order: 0,
        color: '#ff0000',
        createdAt: 1,
        updatedAt: 1,
      },
      { id: 't2', name: '子标签', normalizedName: '子标签', parentId: 't1', order: 0, createdAt: 2, updatedAt: 2 },
    ])
    expect(catalog.getAllTags()[0]?.color).toBe('#ff0000')
    expect(catalog.getAllTags().find((tag) => tag.id === 't2')?.parentId).toBe('t1')

    catalog.putTombstones([{ id: 'img-x', imageId: 'img-x', purgedAt: 100, lastOriginOccurredAt: 90 }])
    expect(catalog.getTombstonesByImageIds(['img-x', 'missing']).get('img-x')?.purgedAt).toBe(100)
    expect(catalog.getAllTombstones()).toHaveLength(1)

    catalog.deleteCollection('c2')
    expect(catalog.getAllCollections().map((item) => item.id)).toEqual(['c1'])
    // 删除标签时子级在事务内提升为顶级（原子删除），父指针不再悬空
    catalog.deleteTag('t1')
    expect(catalog.getAllTags().map((tag) => tag.id)).toEqual(['t2'])
    expect(catalog.getAllTags()[0]?.parentId).toBeNull()
    catalog.deleteTag('t2')
    expect(catalog.getAllTags()).toHaveLength(0)
    catalog.deleteTombstone('img-x')
    expect(catalog.getAllTombstones()).toHaveLength(0)
  })

  it('deletes collections and tags atomically (promote children + strip asset references)', () => {
    const catalog = new AssetCatalog(':memory:')
    catalogs.push(catalog)
    catalog.putCollections([
      { id: 'c1', name: '根', normalizedName: '根', parentId: null, order: 0, createdAt: 1, updatedAt: 1 },
      { id: 'c2', name: '子', normalizedName: '子', parentId: 'c1', order: 1, createdAt: 2, updatedAt: 2 },
    ])
    catalog.putTags([
      { id: 't1', name: '父', normalizedName: '父', parentId: null, order: 0, createdAt: 1, updatedAt: 1 },
      { id: 't2', name: '子', normalizedName: '子', parentId: 't1', order: 0, createdAt: 2, updatedAt: 2 },
    ])
    catalog.upsertAssets([
      { asset: { ...makeAsset('a', '测试', 30), collectionIds: ['c1', 'c2'], tagIds: ['t1', 't2'] } },
    ])

    // 删除父项目：子级提升为顶级，素材剥离父引用但保留子引用
    catalog.deleteCollection('c1')
    expect(catalog.getAllCollections().map((item) => item.id)).toEqual(['c2'])
    expect(catalog.getAllCollections()[0]?.parentId).toBeNull()
    expect(catalog.getAssetsByIds(['a'])[0]?.collectionIds).toEqual(['c2'])

    // 删除父标签：子级提升为顶级，素材剥离父引用但保留子引用
    catalog.deleteTag('t1')
    expect(catalog.getAllTags().map((tag) => tag.id)).toEqual(['t2'])
    expect(catalog.getAllTags()[0]?.parentId).toBeNull()
    expect(catalog.getAssetsByIds(['a'])[0]?.tagIds).toEqual(['t2'])
  })

  it('purges assets and writes tombstones in one transaction', () => {
    const catalog = new AssetCatalog(':memory:')
    catalogs.push(catalog)
    catalog.upsertAssets([
      { asset: makeAsset('a', '橘猫', 30), localPath: 'D:/a.png' },
      { asset: makeAsset('b', '雪山', 20), localPath: 'D:/b.png' },
    ])

    const result = catalog.purgeAssets(['a', 'missing'], 500)

    expect(result.purged).toEqual(['a'])
    expect(result.tombstones).toHaveLength(1)
    expect(result.tombstones[0]).toMatchObject({ imageId: 'hash-a', purgedAt: 500 })
    // 素材与检索索引一并删除，墓碑可查
    expect(catalog.getAssetsByIds(['a', 'b']).map((asset) => asset.id)).toEqual(['b'])
    expect(catalog.getAsset('a')).toBeNull()
    expect(catalog.getTombstonesByImageIds(['hash-a']).has('hash-a')).toBe(true)
    // 检索索引同步清理：橘猫 已随素材删除，雪山 仍可检索
    expect(
      catalog.query({ scope: 'all', query: '橘猫', filters: {}, sortKey: 'updatedAt', sortOrder: 'desc', limit: 10 })
        .totalCount,
    ).toBe(0)
    expect(
      catalog.query({ scope: 'all', query: '雪山', filters: {}, sortKey: 'updatedAt', sortOrder: 'desc', limit: 10 })
        .totalCount,
    ).toBe(1)
    // blob 未被其他版本引用时回收
    expect(catalog.size()).toBe(1)
  })

  it('persists task cleanup in the same SQLite transaction as asset purge', () => {
    const catalog = new AssetCatalog(':memory:')
    catalogs.push(catalog)
    catalog.upsertAssets([{ asset: makeAsset('a', '橘猫', 30) }])

    const task = { id: 'task-a', outputImages: [] }
    const result = catalog.purgeAssets(['a'], 500, [{ id: task.id, value: task }])

    expect(result.purged).toEqual(['a'])
    expect(catalog.appDataGet('tasks', task.id)).toEqual(task)
    expect(catalog.getTombstonesByImageIds(['hash-a']).has('hash-a')).toBe(true)
  })

  it('purges duplicate-imageId assets with one tombstone and tolerates existing tombstones', () => {
    const catalog = new AssetCatalog(':memory:')
    catalogs.push(catalog)
    const first = makeAsset('a', '重复素材A', 30)
    // 历史遗留：同一 imageId 的两条素材记录（内容去重前的产物）
    const twin = { ...makeAsset('b', '重复素材B', 40), imageId: first.imageId, blobId: first.blobId }
    catalog.upsertAssets([
      { asset: first, localPath: 'D:/a.png' },
      { asset: twin, localPath: 'D:/b.png' },
    ])
    // 该 imageId 已有墓碑（此前清空过一次）
    catalog.putTombstones([{ id: first.imageId, imageId: first.imageId, purgedAt: 100, lastOriginOccurredAt: 90 }])

    const result = catalog.purgeAssets(['a', 'b'], 500)

    // 两条素材都删除，墓碑只一条且不冲突
    expect(result.purged).toEqual(['a', 'b'])
    expect(result.tombstones).toHaveLength(1)
    expect(result.tombstones[0]).toMatchObject({ imageId: first.imageId, purgedAt: 500 })
    expect(catalog.getAssetsByIds(['a', 'b'])).toHaveLength(0)
    // lastOriginOccurredAt 取历史(90)与新批次(40)的最大值，导入去重语义不倒退
    const tombstone = catalog.getTombstonesByImageIds([first.imageId]).get(first.imageId)
    expect(tombstone?.lastOriginOccurredAt).toBe(90)
  })

  it('cleans up reference-only assets without writing tombstones', () => {
    const catalog = new AssetCatalog(':memory:')
    catalogs.push(catalog)
    const generated = makeAsset('a', '生成', 30)
    const reference = makeAsset('ref-1', '参考', 10)
    reference.origins = [
      {
        kind: 'reference',
        key: 'reference:task-1:0',
        taskId: 'task-1',
        outputSlot: -1,
        taskCreatedAt: 10,
        taskFinishedAt: 20,
        sourceMode: 'gallery',
        prompt: '参考图',
        requestedParams: {} as never,
        inputImageIds: [],
      },
    ]
    reference.primaryOriginKey = 'reference:task-1:0'
    // 混合来源（先作参考图、后被真正生成）：不是纯参考图，不清
    const mixed = makeAsset('mixed-1', '混合', 40)
    mixed.origins = [
      ...reference.origins,
      {
        kind: 'generated',
        key: 'task-2:0',
        taskId: 'task-2',
        outputSlot: 0,
        taskCreatedAt: 40,
        taskFinishedAt: 40,
        sourceMode: 'gallery',
        prompt: '生成',
        requestedParams: {} as never,
        inputImageIds: [],
      },
    ]
    mixed.primaryOriginKey = 'task-2:0'
    catalog.upsertAssets([
      { asset: generated, localPath: 'D:/a.png' },
      { asset: reference, localPath: 'D:/ref.png' },
      { asset: mixed, localPath: 'D:/mixed.png' },
    ])

    const removed = catalog.cleanupReferenceOnlyAssets()

    expect(removed).toEqual(['ref-1'])
    expect(catalog.getAssetsByIds(['a', 'ref-1', 'mixed-1']).map((asset) => asset.id)).toEqual(['a', 'mixed-1'])
    // 不写墓碑：参考图并非被永久删除的生成结果，未来真正生成同内容可重新归档
    expect(catalog.getTombstonesByImageIds(['hash-ref-1']).has('hash-ref-1')).toBe(false)
    // 幂等：再次清理无残留
    expect(catalog.cleanupReferenceOnlyAssets()).toEqual([])
  })

  it('reads assets by ids and tracks catalog meta', () => {
    const catalog = new AssetCatalog(':memory:')
    catalogs.push(catalog)
    catalog.upsertAssets([{ asset: makeAsset('a', 'one', 30) }, { asset: makeAsset('b', 'two', 20) }])

    expect(catalog.getAssetsByIds(['b', 'missing']).map((asset) => asset.id)).toEqual(['b'])
    expect(
      catalog
        .exportAllAssets()
        .map((asset) => asset.id)
        .sort(),
    ).toEqual(['a', 'b'])

    expect(catalog.getMeta('flag')).toBeNull()
    catalog.setMeta('flag', '1')
    expect(catalog.getMeta('flag')).toBe('1')
  })

  it('clears catalog records, organization tables and usage events together', () => {
    const catalog = new AssetCatalog(':memory:')
    catalogs.push(catalog)
    catalog.upsertAssets([{ asset: makeAsset('a', 'one', 30) }])
    catalog.putCollections([
      { id: 'c1', name: '项目', normalizedName: '项目', parentId: null, order: 0, createdAt: 1, updatedAt: 1 },
    ])
    catalog.putTags([
      { id: 't1', name: '标签', normalizedName: '标签', parentId: null, order: 0, createdAt: 1, updatedAt: 1 },
    ])
    catalog.putTombstones([{ id: 'img-old', imageId: 'img-old', purgedAt: 1, lastOriginOccurredAt: 1 }])
    catalog.putUsageEvents([{ id: 'usage-1', assetId: 'a', action: 'view', target: 'gallery', occurredAt: 1 }])

    catalog.clear()

    expect(catalog.size()).toBe(0)
    expect(catalog.getAllCollections()).toEqual([])
    expect(catalog.getAllTags()).toEqual([])
    expect(catalog.getAllTombstones()).toEqual([])
    expect(catalog.getAllUsageEvents()).toEqual([])
  })

  it('detects near duplicates by perceptual hash Hamming distance', () => {
    const catalog = new AssetCatalog(':memory:')
    catalogs.push(catalog)
    // a 与 b 的感知哈希相差 2 bit（近重复）；c 完全不同
    catalog.upsertAssets([
      { asset: makeAsset('a', 'one', 30), perceptualHash: 'aaaaaaaaaaaaaaaa' },
      { asset: makeAsset('b', 'two', 20), perceptualHash: 'aaaaaaaaaaaafaaa' },
      { asset: makeAsset('c', 'three', 10), perceptualHash: '0123456789abcdef' },
    ])

    const groups = catalog.findNearDuplicates(8)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.assets.map((asset) => asset.id).sort()).toEqual(['a', 'b'])
    expect(groups[0]!.avgHamming).toBeLessThanOrEqual(8)

    // 收紧到 1 bit 后不再成组（实际差异为 2 bit）
    expect(catalog.findNearDuplicates(1)).toHaveLength(0)
  })

  it('resolves derived chains and suggests tags from similar assets', () => {
    const catalog = new AssetCatalog(':memory:')
    catalogs.push(catalog)
    catalog.putTags([
      { id: 't1', name: '风格', normalizedName: '风格', parentId: null, order: 0, createdAt: 1, updatedAt: 1 },
      { id: 't2', name: '赛博', normalizedName: '赛博', parentId: null, order: 0, createdAt: 1, updatedAt: 1 },
    ])
    catalog.upsertAssets([
      { asset: makeAsset('a', 'one', 30), perceptualHash: 'aaaaaaaaaaaaaaaa' },
      {
        asset: { ...makeAsset('b', 'two', 20), parentAssetIds: ['a'], tagIds: ['t1', 't2'] },
        perceptualHash: 'aaaaaaaaaaaafaaa',
      },
    ])

    const chain = catalog.getDerivedAssets('a')
    expect(chain.parents).toHaveLength(0)
    expect(chain.children.map((asset) => asset.id)).toEqual(['b'])
    const up = catalog.getDerivedAssets('b')
    expect(up.parents.map((asset) => asset.id)).toEqual(['a'])
  })

  it('filters by a recursive collectionIds list (include-subcollections)', () => {
    const catalog = new AssetCatalog(':memory:')
    catalogs.push(catalog)
    catalog.upsertAssets([
      { asset: { ...makeAsset('a', 'one', 30), collectionIds: ['c1'] } },
      { asset: { ...makeAsset('b', 'two', 20), collectionIds: ['c2'] } },
      { asset: { ...makeAsset('c', 'three', 10), collectionIds: ['c3'] } },
    ])

    const page = catalog.query({
      scope: 'all',
      query: '',
      filters: { collectionIds: ['c1', 'c2'] },
      sortKey: 'updatedAt',
      sortOrder: 'desc',
      limit: 20,
    })
    expect(page.assets.map((asset) => asset.id).sort()).toEqual(['a', 'b'])
    expect(page.counts.all).toBe(3)
  })

  it('filters by single tagId and multi tagIds with AND semantics', () => {
    const catalog = new AssetCatalog(':memory:')
    catalogs.push(catalog)
    catalog.upsertAssets([
      { asset: { ...makeAsset('a', 'one', 30), tagIds: ['t1'] } },
      { asset: { ...makeAsset('b', 'two', 20), tagIds: ['t1', 't2'] } },
      { asset: { ...makeAsset('c', 'three', 10), tagIds: ['t2', 't3'] } },
    ])

    const single = catalog.query({
      scope: 'all',
      query: '',
      filters: { tagId: 't1' },
      sortKey: 'updatedAt',
      sortOrder: 'desc',
      limit: 20,
    })
    expect(single.assets.map((asset) => asset.id).sort()).toEqual(['a', 'b'])

    const multi = catalog.query({
      scope: 'all',
      query: '',
      filters: { tagIds: ['t1', 't2'] },
      sortKey: 'updatedAt',
      sortOrder: 'desc',
      limit: 20,
    })
    expect(multi.assets.map((asset) => asset.id)).toEqual(['b'])

    const empty = catalog.query({
      scope: 'all',
      query: '',
      filters: { tagIds: ['t1', 't3'] },
      sortKey: 'updatedAt',
      sortOrder: 'desc',
      limit: 20,
    })
    expect(empty.assets).toHaveLength(0)

    // 标签计数只统计 active 素材
    expect(catalog.getCounts().byTag).toEqual({ t1: 2, t2: 2, t3: 1 })
  })
})
