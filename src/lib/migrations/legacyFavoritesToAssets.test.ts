import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AssetTombstone,
  FavoriteCollection,
  GeneratedAsset,
  TaskParams,
  TaskRecord,
  WorkspaceTab,
} from '../../types'
import { normalizeAsset } from '../assetLibraryModel'

const mock = vi.hoisted(() => ({
  getAllTasks: vi.fn(),
  hydrate: vi.fn(),
  putCollections: vi.fn(),
  putGeneratedAssets: vi.fn(),
}))

vi.mock('../db', () => ({ getAllTasks: mock.getAllTasks }))
vi.mock('../assetLibraryRepository', () => ({
  hydrate: mock.hydrate,
  putCollections: mock.putCollections,
  putGeneratedAssets: mock.putGeneratedAssets,
}))

import {
  buildFavoriteMappings,
  identifyShadowFavoriteTasks,
  runLegacyFavoritesToAssetsMigration,
} from './legacyFavoritesToAssets'

function makeTask(id: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
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
    createdAt: 1000,
    finishedAt: 2000,
    elapsed: 1000,
    ...overrides,
  }
}

function makeAsset(id: string, overrides: Partial<GeneratedAsset> = {}): GeneratedAsset {
  return normalizeAsset({ id, imageId: id, createdAt: 1, updatedAt: 1, origins: [], ...overrides })
}

function makeTab(id: string, tasks: TaskRecord[]): WorkspaceTab {
  return {
    id,
    name: 'tab',
    groupId: null,
    prompt: '',
    inputImages: [],
    inputImageFolder: null,
    params: {} as TaskParams,
    maskDraft: null,
    maskEditorImageId: null,
    customOutputPath: '',
    tasks,
    createdAt: 1,
    updatedAt: 1,
    order: 0,
  }
}

const defaultCollection: FavoriteCollection = { id: 'fav-default', name: '默认收藏', createdAt: 1, updatedAt: 1 }
const brandCollection: FavoriteCollection = { id: 'fav-brand', name: '品牌素材', createdAt: 1, updatedAt: 1 }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('identifyShadowFavoriteTasks', () => {
  it('marks favorite tasks outside any workspace tab as shadows', () => {
    const inTab = makeTask('in-tab', { isFavorite: true })
    const shadow = makeTask('shadow', { isFavorite: true })
    const normal = makeTask('normal', { isFavorite: false })
    const tabs = [makeTab('tab-1', [inTab])]
    const shadowIds = identifyShadowFavoriteTasks([inTab, shadow, normal], tabs)
    expect(shadowIds).toEqual(new Set(['shadow']))
  })

  it('recognizes tasks claimed through _taskIds', () => {
    const tab = { ...makeTab('tab-1', []), _taskIds: ['via-ids'] }
    const shadowIds = identifyShadowFavoriteTasks([makeTask('via-ids', { isFavorite: true })], [tab])
    expect(shadowIds.has('via-ids')).toBe(false)
  })
})

describe('buildFavoriteMappings', () => {
  const baseInput = (overrides: Partial<Parameters<typeof buildFavoriteMappings>[0]> = {}) => ({
    tasks: [makeTask('t1', { isFavorite: true, favoriteCollectionIds: ['fav-default'] })],
    workspaceTabs: [makeTab('tab-1', [makeTask('t1', { isFavorite: true, favoriteCollectionIds: ['fav-default'] })])],
    favoriteCollections: [defaultCollection, brandCollection],
    defaultFavoriteCollectionId: 'fav-default',
    existingAssets: new Map<string, GeneratedAsset>(),
    existingCollections: new Map<string, never>(),
    tombstones: new Map<string, AssetTombstone>(),
    ...overrides,
  })

  it('maps only the default collection to favorite state, without creating a project', () => {
    const result = buildFavoriteMappings(baseInput())
    expect(result.collections).toEqual([])
    expect(result.assets[0].favorite).toBe(true)
    expect(result.assets[0].collectionIds).toEqual([])
    expect(result.assets[0].origins).toHaveLength(1)
  })

  it('creates a project for a non-default collection and joins the asset', () => {
    const result = buildFavoriteMappings(
      baseInput({
        tasks: [makeTask('t1', { isFavorite: true, favoriteCollectionIds: ['fav-brand'] })],
        workspaceTabs: [makeTab('tab-1', [makeTask('t1', { isFavorite: true, favoriteCollectionIds: ['fav-brand'] })])],
      }),
    )
    expect(result.collections).toHaveLength(1)
    expect(result.collections[0].name).toBe('品牌素材')
    expect(result.assets[0].collectionIds).toEqual([result.collections[0].id])
  })

  it('reuses the same project for same-named collections', () => {
    const favorites = [brandCollection, { ...brandCollection, id: 'fav-brand-2' }]
    const taskA = makeTask('a', { isFavorite: true, favoriteCollectionIds: ['fav-brand'] })
    const taskB = makeTask('b', { isFavorite: true, favoriteCollectionIds: ['fav-brand-2'], outputImages: ['img-2'] })
    const result = buildFavoriteMappings({
      tasks: [taskA, taskB],
      workspaceTabs: [makeTab('tab-1', [taskA, taskB])],
      favoriteCollections: favorites,
      defaultFavoriteCollectionId: null,
      existingAssets: new Map<string, GeneratedAsset>(),
      existingCollections: new Map<string, never>(),
      tombstones: new Map<string, AssetTombstone>(),
    })
    expect(result.collections).toHaveLength(1)
    expect(result.assets.map((a) => a.collectionIds)).toEqual([[result.collections[0].id], [result.collections[0].id]])
  })

  it('does not append a pseudo origin for shadow tasks but still favorites the asset', () => {
    const existing = makeAsset('img-1', {
      origins: [
        {
          key: 'real:0',
          taskId: 'real',
          outputSlot: 0,
          taskCreatedAt: 1,
          taskFinishedAt: 2,
          prompt: 'real',
          sourceMode: 'gallery',
          inputImageIds: [],
          requestedParams: {} as TaskParams,
        },
      ],
    })
    const shadow = makeTask('shadow', { isFavorite: true, outputImages: ['img-1'] })
    const result = buildFavoriteMappings({
      tasks: [shadow],
      workspaceTabs: [],
      favoriteCollections: [defaultCollection],
      defaultFavoriteCollectionId: 'fav-default',
      existingAssets: new Map([['img-1', existing]]),
      existingCollections: new Map<string, never>(),
      tombstones: new Map<string, AssetTombstone>(),
    })
    expect(result.assets[0].favorite).toBe(true)
    expect(result.assets[0].origins).toHaveLength(1)
    expect(result.assets[0].origins[0].taskId).toBe('real')
  })

  it('converts every output image of a multi-image task to a favorite asset', () => {
    const task = makeTask('t1', {
      isFavorite: true,
      favoriteCollectionIds: ['fav-default'],
      outputImages: ['img-1', 'img-2', 'img-3'],
    })
    const result = buildFavoriteMappings({
      tasks: [task],
      workspaceTabs: [makeTab('tab-1', [task])],
      favoriteCollections: [defaultCollection],
      defaultFavoriteCollectionId: 'fav-default',
      existingAssets: new Map<string, GeneratedAsset>(),
      existingCollections: new Map<string, never>(),
      tombstones: new Map<string, AssetTombstone>(),
    })
    expect(result.assets.map((a) => a.id).sort()).toEqual(['asset:img-1', 'asset:img-2', 'asset:img-3'])
    expect(result.assets.every((a) => a.favorite)).toBe(true)
  })

  it('re-running the same input does not duplicate origins or collections', () => {
    const input = baseInput({
      tasks: [makeTask('t1', { isFavorite: true, favoriteCollectionIds: ['fav-brand'] })],
      workspaceTabs: [makeTab('tab-1', [makeTask('t1', { isFavorite: true, favoriteCollectionIds: ['fav-brand'] })])],
    })
    const first = buildFavoriteMappings(input)
    // 第二次运行时项目已存在 → 传入现有项目集合
    const secondInput = {
      ...input,
      existingCollections: new Map(first.collections.map((c) => [c.id, c])),
    }
    const second = buildFavoriteMappings(secondInput)
    expect(second.collections).toHaveLength(0)
    expect(second.assets[0].origins).toHaveLength(1)
    expect(second.assets[0].collectionIds).toEqual([first.collections[0].id])
  })
})

describe('runLegacyFavoritesToAssetsMigration', () => {
  it('hydrates and writes collections and assets through the repository', async () => {
    const task = makeTask('t1', { isFavorite: true, favoriteCollectionIds: ['fav-brand'] })
    mock.getAllTasks.mockResolvedValue([task])
    mock.hydrate.mockResolvedValue({ assets: [], collections: [], tags: [], tombstones: [] })
    const journal = new Map<string, any>()
    const store = {
      get: async (id: string) => journal.get(id),
      put: async (record: any) => {
        journal.set(record.id, record)
      },
    }

    await runLegacyFavoritesToAssetsMigration(store, {
      workspaceTabs: [makeTab('tab-1', [task])],
      favoriteCollections: [brandCollection],
      defaultFavoriteCollectionId: 'fav-default',
    })

    expect(mock.putCollections).toHaveBeenCalledTimes(1)
    expect(mock.putGeneratedAssets).toHaveBeenCalledTimes(1)
    expect(journal.get('legacy-favorites-to-assets-v1').status).toBe('completed')
  })
})
