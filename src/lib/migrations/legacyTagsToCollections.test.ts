import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetCollection, AssetTag, GeneratedAsset } from '../../types'
import { normalizeAsset, normalizeCollection, normalizeTag } from '../assetLibraryModel'
import type { MigrationJournal } from './registry'

const mock = vi.hoisted(() => ({
  hydrateFull: vi.fn(),
  putCollections: vi.fn(),
  putGeneratedAssets: vi.fn(),
}))

vi.mock('../assetLibraryRepository', () => ({
  hydrateFull: mock.hydrateFull,
  putCollections: mock.putCollections,
  putGeneratedAssets: mock.putGeneratedAssets,
}))

import {
  buildTagToCollectionMappings,
  runLegacyTagsToCollectionsMigration,
  LEGACY_TAGS_TO_COLLECTIONS_MIGRATION_ID,
} from './legacyTagsToCollections'

function tag(id: string, name: string, parentId: string | null = null, order = 0): AssetTag {
  return normalizeTag({ id, name, parentId, order, createdAt: 1, updatedAt: 1 })!
}

function collection(id: string, name: string, parentId: string | null = null): AssetCollection {
  return normalizeCollection({ id, name, parentId, order: 0, createdAt: 1, updatedAt: 1 })!
}

function asset(id: string, tagIds: string[], collectionIds: string[] = []): GeneratedAsset {
  return normalizeAsset({
    id,
    imageId: id,
    status: 'active',
    tagIds,
    collectionIds,
    origins: [],
    createdAt: 1,
    updatedAt: 1,
  })
}

const now = 1_000_000

describe('buildTagToCollectionMappings', () => {
  it('mirrors each top-level tag into a same-name top-level project folder', () => {
    const { createdCollections, changedAssets } = buildTagToCollectionMappings({
      tags: [tag('t1', '国风插画'), tag('t2', '玻璃茶杯')],
      existingCollections: [],
      assets: [],
      now,
    })
    expect(createdCollections.map((c) => c.name).sort()).toEqual(['国风插画', '玻璃茶杯'])
    expect(createdCollections.every((c) => c.parentId === null)).toBe(true)
    expect(changedAssets).toHaveLength(0)
  })

  it('keeps nested tag hierarchy as nested project folders', () => {
    const { createdCollections } = buildTagToCollectionMappings({
      tags: [tag('top', '项目A'), tag('child', '子项目', 'top')],
      existingCollections: [],
      assets: [],
      now,
    })
    const top = createdCollections.find((c) => c.name === '项目A')
    const child = createdCollections.find((c) => c.name === '子项目')
    expect(top).toBeDefined()
    expect(child).toBeDefined()
    expect(child!.parentId).toBe(top!.id)
  })

  it('reuses an existing same-name project folder instead of duplicating', () => {
    const existing = collection('col-1', '短剧')
    const { createdCollections } = buildTagToCollectionMappings({
      tags: [tag('t1', '短剧')],
      existingCollections: [existing],
      assets: [],
      now,
    })
    expect(createdCollections).toHaveLength(0)
  })

  it('merges tag ids into asset collection ids, keeping existing membership', () => {
    const { createdCollections, changedAssets } = buildTagToCollectionMappings({
      tags: [tag('t1', '月亮图')],
      existingCollections: [],
      assets: [asset('a1', ['t1'], ['existing-col'])],
      now,
    })
    expect(changedAssets).toHaveLength(1)
    expect(changedAssets[0].collectionIds).toEqual(['existing-col', createdCollections[0].id])
    expect(changedAssets[0].tagIds).toEqual(['t1']) // 标签数据保留
  })

  it('does not rewrite assets whose collection set is unchanged', () => {
    const { changedAssets } = buildTagToCollectionMappings({
      tags: [tag('t1', '月亮图')],
      existingCollections: [],
      assets: [asset('a1', ['unknown-tag'])],
      now,
    })
    expect(changedAssets).toHaveLength(0)
  })

  it('is idempotent when run twice with the created folders as existing', () => {
    const first = buildTagToCollectionMappings({
      tags: [tag('t1', '国风插画')],
      existingCollections: [],
      assets: [asset('a1', ['t1'])],
      now,
    })
    const second = buildTagToCollectionMappings({
      tags: [tag('t1', '国风插画')],
      existingCollections: first.createdCollections,
      assets: first.changedAssets,
      now,
    })
    expect(second.createdCollections).toHaveLength(0)
    expect(second.changedAssets).toHaveLength(0)
  })

  it('terminates on a cyclic tag parent chain', () => {
    const { createdCollections } = buildTagToCollectionMappings({
      tags: [tag('a', 'A', 'b'), tag('b', 'B', 'a')],
      existingCollections: [],
      assets: [],
      now,
    })
    expect(createdCollections.length).toBeLessThanOrEqual(2)
  })
})

describe('runLegacyTagsToCollectionsMigration', () => {
  beforeEach(() => {
    mock.hydrateFull.mockReset()
    mock.putCollections.mockReset()
    mock.putGeneratedAssets.mockReset()
  })

  it('hydrates the full snapshot and writes created folders + changed assets', async () => {
    mock.hydrateFull.mockResolvedValue({
      assets: [asset('a1', ['t1'])],
      collections: [],
      tags: [tag('t1', '月亮图')],
      tombstones: [],
    })
    const journal = new Map<string, MigrationJournal>()
    const store = {
      get: async (id: string) => journal.get(id),
      put: async (record: MigrationJournal) => {
        journal.set(record.id, record)
      },
    }

    await runLegacyTagsToCollectionsMigration(store)

    expect(mock.putCollections).toHaveBeenCalledTimes(1)
    expect(mock.putGeneratedAssets).toHaveBeenCalledTimes(1)
    expect(journal.get(LEGACY_TAGS_TO_COLLECTIONS_MIGRATION_ID)?.status).toBe('completed')
  })

  it('does nothing when there are no tags', async () => {
    mock.hydrateFull.mockResolvedValue({ assets: [], collections: [], tags: [], tombstones: [] })
    const store = { get: async () => undefined, put: async () => {} }

    await runLegacyTagsToCollectionsMigration(store)

    expect(mock.putCollections).not.toHaveBeenCalled()
    expect(mock.putGeneratedAssets).not.toHaveBeenCalled()
  })
})
