import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetCollection, GeneratedAsset } from '../../types'
import { normalizeAsset } from '../../lib/assetLibraryModel'

// 该文件是重 store 测试：被测模块动态 import 主 store 且 mock 依赖注入链较长，
// 全量并行运行时（CI 多 worker）偶发超过默认 5s 超时，超时中断会在途动态 import，
// 导致后续用例拿到损坏的模块命名空间（useStore 为 undefined）。放宽到 20s。
vi.setConfig({ testTimeout: 20_000 })

const mock = vi.hoisted(() => ({
  hydrate: vi.fn(),
  hydrateFull: vi.fn(),
  patchAssets: vi.fn(),
  moveToTrash: vi.fn(),
  restore: vi.fn(),
  putCollection: vi.fn(),
  putCollections: vi.fn(),
  getCollection: vi.fn(),
  removeCollection: vi.fn(),
  listCollections: vi.fn(),
  listAssets: vi.fn(),
  putGeneratedAssets: vi.fn(),
  trashCollection: vi.fn(),
  restoreCollection: vi.fn(),
  putTags: vi.fn(),
  deleteTagRecord: vi.fn(),
  patchAssetsIndividually: vi.fn(),
  // assetCommands 模块初始化时也会读取这些导出（该链在运行时动态 import 时 store 被触发）
  getAsset: vi.fn(),
  getAssetsByIds: vi.fn(),
  getAssetsByImageIds: vi.fn(),
  getImagesByIds: vi.fn(),
  saveAssets: vi.fn(),
  publishAssets: vi.fn(),
  ensureImageDataUrl: vi.fn(),
  addReference: vi.fn(),
  openComposite: vi.fn(),
  getTask: vi.fn(),
  reuseTask: vi.fn(),
  download: vi.fn(),
  trashAssets: vi.fn(),
  recordUsage: vi.fn(),
  queryCatalog: vi.fn(),
  queryAssetCatalog: vi.fn(),
  recommendAssets: vi.fn(),
  showToast: vi.fn(),
  now: vi.fn(),
  createId: vi.fn(),
}))

// 全量 mock：assetCommands 链（运行时动态 import 时 store 被触发）会在模块初始化时
// 解构仓库的 getAsset/getAssetsByIds/getAssetsByImageIds/queryAssetCatalog/recommendAssets，
// 因此这些导出也以 vi.fn 提供。使用同步工厂（而非 async importOriginal 展开），
// 避免高并发全量测试下异步工厂初始化竞态导致的偶发超时 / useStore 为 undefined。
vi.mock('../../lib/assetLibraryRepository', () => ({
  hydrate: mock.hydrate,
  hydrateFull: mock.hydrateFull,
  patchAssets: mock.patchAssets,
  moveToTrash: mock.moveToTrash,
  restore: mock.restore,
  putCollection: mock.putCollection,
  putCollections: mock.putCollections,
  getCollection: mock.getCollection,
  removeCollection: mock.removeCollection,
  listCollections: mock.listCollections,
  listAssets: mock.listAssets,
  putGeneratedAssets: mock.putGeneratedAssets,
  trashCollection: mock.trashCollection,
  restoreCollection: mock.restoreCollection,
  putTags: mock.putTags,
  deleteTagRecord: mock.deleteTagRecord,
  patchAssetsIndividually: mock.patchAssetsIndividually,
  getAsset: mock.getAsset,
  getAssetsByIds: mock.getAssetsByIds,
  getAssetsByImageIds: mock.getAssetsByImageIds,
  queryAssetCatalog: mock.queryAssetCatalog,
  recommendAssets: mock.recommendAssets,
}))

const mainStoreMock = vi.hoisted(() => {
  const showToast = vi.fn()
  const setConfirmDialog = vi.fn()
  return {
    purgeGeneratedAssets: vi.fn(),
    showToast,
    setConfirmDialog,
    useStore: { getState: vi.fn(() => ({ showToast, setConfirmDialog })) },
  }
})

vi.mock('../../store', () => mainStoreMock)

import { normalizeGroupBy, partializeAssetLibraryStore, useAssetLibraryStore } from './store'

function makeAsset(id: string, overrides: Partial<GeneratedAsset> = {}): GeneratedAsset {
  return normalizeAsset({ id, imageId: id, createdAt: 1000, updatedAt: 1000, ...overrides })
}

function resetState() {
  useAssetLibraryStore.setState({
    assetsById: {},
    assetOrder: [],
    collections: [],
    tags: [],
    hydrationStatus: 'idle',
    migrationStatus: 'idle',
    migrationError: null,
    selectedAssetIds: [],
    activeAssetId: null,
    scope: 'all',
    query: '',
    filters: {},
    sortKey: 'updatedAt',
    sortOrder: 'desc',
    sidebarOpen: true,
    detailOpen: false,
    viewMode: 'grid',
    groupBy: 'none',
    includeSubcollections: false,
    batchFocusTaskId: null,
    viewerAssetId: null,
    viewerAssetIds: [],
    quickPreviewAssetId: null,
    hoveredAssetId: null,
    savedFilters: [],
    pinnedFilters: [],
    visibleFilterControls: [],
    similarToAssetId: null,
    undoStack: [],
    redoStack: [],
  })
}

beforeEach(() => {
  resetState()
  vi.clearAllMocks()
})

describe('hydrate', () => {
  it('loads assets and collections in order', async () => {
    mock.hydrate.mockResolvedValue({
      assets: [makeAsset('a'), makeAsset('b')],
      collections: [
        { id: 'c1', name: '项目', normalizedName: '项目', parentId: null, order: 0, createdAt: 1, updatedAt: 1 },
      ],
      tags: [{ id: 't1', name: '高清', normalizedName: '高清', createdAt: 1, updatedAt: 1 }],
      tombstones: [],
    })
    await useAssetLibraryStore.getState().hydrate()
    const state = useAssetLibraryStore.getState()
    expect(state.hydrationStatus).toBe('ready')
    expect(state.assetOrder).toEqual(['a', 'b'])
    expect(state.assetsById.a.id).toBe('a')
    expect(state.collections).toHaveLength(1)
  })

  it('marks hydration as failed on error', async () => {
    mock.hydrate.mockRejectedValue(new Error('db failure'))
    await useAssetLibraryStore.getState().hydrate()
    expect(useAssetLibraryStore.getState().hydrationStatus).toBe('error')
  })
})

describe('view state', () => {
  it('updates scope, query, filters and sort', () => {
    useAssetLibraryStore.getState().setScope({ kind: 'collection', id: 'c1' })
    useAssetLibraryStore.getState().setQuery('cat')
    useAssetLibraryStore.getState().setFilters({ favoriteOnly: true })
    useAssetLibraryStore.getState().setSort('createdAt', 'asc')
    const state = useAssetLibraryStore.getState()
    expect(state.scope).toEqual({ kind: 'collection', id: 'c1' })
    expect(state.query).toBe('cat')
    expect(state.filters).toEqual({ favoriteOnly: true })
    expect(state.sortKey).toBe('createdAt')
    expect(state.sortOrder).toBe('asc')
  })

  it('manages selection and active asset', () => {
    useAssetLibraryStore.setState({ assetsById: { a: makeAsset('a'), b: makeAsset('b') }, assetOrder: ['a', 'b'] })
    useAssetLibraryStore.getState().selectAsset('a')
    // 单击单选图片：同步打开右侧图片信息栏
    expect(useAssetLibraryStore.getState().detailOpen).toBe(true)
    useAssetLibraryStore.getState().toggleSelectAsset('b')
    expect(useAssetLibraryStore.getState().selectedAssetIds).toEqual(['a', 'b'])
    useAssetLibraryStore.getState().toggleSelectAsset('a')
    expect(useAssetLibraryStore.getState().selectedAssetIds).toEqual(['b'])
    useAssetLibraryStore.getState().setActiveAsset('a')
    expect(useAssetLibraryStore.getState().activeAssetId).toBe('a')
    expect(useAssetLibraryStore.getState().detailOpen).toBe(true)
    useAssetLibraryStore.getState().clearSelection()
    expect(useAssetLibraryStore.getState().selectedAssetIds).toEqual([])
    expect(useAssetLibraryStore.getState().activeAssetId).toBeNull()
  })
})

describe('mutation actions', () => {
  it('patches assets through the repository and updates the store', async () => {
    useAssetLibraryStore.setState({ assetsById: { a: makeAsset('a') }, assetOrder: ['a'] })
    mock.patchAssets.mockResolvedValue([makeAsset('a', { favorite: true, rating: 5 })])
    await useAssetLibraryStore.getState().patchAssets(['a'], { favorite: true, rating: 5 })
    expect(useAssetLibraryStore.getState().assetsById.a.favorite).toBe(true)
    expect(useAssetLibraryStore.getState().assetsById.a.rating).toBe(5)
  })

  it('bumps mutationVersion on asset membership/status changes so catalog counts refresh', async () => {
    useAssetLibraryStore.setState({ assetsById: { a: makeAsset('a') }, assetOrder: ['a'], mutationVersion: 0 })
    const before = useAssetLibraryStore.getState().mutationVersion
    mock.patchAssets.mockResolvedValue([makeAsset('a', { collectionIds: ['c1'] })])
    await useAssetLibraryStore.getState().patchAssets(['a'], { collectionIds: ['c1'] })
    expect(useAssetLibraryStore.getState().mutationVersion).toBe(before + 1)

    mock.moveToTrash.mockResolvedValue([makeAsset('a', { status: 'trashed' })])
    await useAssetLibraryStore.getState().moveToTrash(['a'])
    expect(useAssetLibraryStore.getState().mutationVersion).toBe(before + 2)

    mock.restore.mockResolvedValue([makeAsset('a')])
    await useAssetLibraryStore.getState().restoreAssets(['a'])
    expect(useAssetLibraryStore.getState().mutationVersion).toBe(before + 3)

    useAssetLibraryStore.getState().removeAssetLocal('a')
    expect(useAssetLibraryStore.getState().mutationVersion).toBe(before + 4)
  })

  it('bumps mutationVersion when applyUpsertedAssets brings a new asset', () => {
    useAssetLibraryStore.setState({ assetsById: {}, assetOrder: [], mutationVersion: 0 })
    useAssetLibraryStore.getState().applyUpsertedAssets([makeAsset('a')])
    expect(useAssetLibraryStore.getState().mutationVersion).toBe(1)
    expect(useAssetLibraryStore.getState().assetOrder).toEqual(['a'])
  })

  it('bumps mutationVersion when applyUpsertedAssets changes folder membership', () => {
    useAssetLibraryStore.setState({ assetsById: { a: makeAsset('a') }, assetOrder: ['a'], mutationVersion: 0 })
    useAssetLibraryStore.getState().applyUpsertedAssets([makeAsset('a', { collectionIds: ['c1'] })])
    expect(useAssetLibraryStore.getState().mutationVersion).toBe(1)
  })

  it('does not bump mutationVersion for identical content (breaks query echo loop)', () => {
    useAssetLibraryStore.setState({
      assetsById: { a: makeAsset('a', { collectionIds: ['c1'] }) },
      assetOrder: ['a'],
      mutationVersion: 5,
    })
    useAssetLibraryStore.getState().applyUpsertedAssets([makeAsset('a', { collectionIds: ['c1'] })])
    expect(useAssetLibraryStore.getState().mutationVersion).toBe(5)
  })

  it('does not bump on volatile updatedAt drift but still syncs content', () => {
    useAssetLibraryStore.setState({
      assetsById: { a: makeAsset('a', { updatedAt: 100 }) },
      assetOrder: ['a'],
      mutationVersion: 0,
    })
    useAssetLibraryStore.getState().applyUpsertedAssets([makeAsset('a', { updatedAt: 999 })])
    expect(useAssetLibraryStore.getState().mutationVersion).toBe(0)
    expect(useAssetLibraryStore.getState().assetsById.a.updatedAt).toBe(999)
  })

  it('upsertCollections makes newly archived folders visible in the sidebar state', () => {
    useAssetLibraryStore.setState({ collections: [] })
    const folder: AssetCollection = {
      id: 'c-new',
      name: '新文件夹',
      normalizedName: '新文件夹',
      parentId: null,
      order: 0,
      createdAt: 1,
      updatedAt: 1,
      trashedAt: null,
    }
    useAssetLibraryStore.getState().upsertCollections([folder])
    expect(useAssetLibraryStore.getState().collections.map((collection) => collection.id)).toContain('c-new')
  })

  it('moves assets to trash and cleans the selection', async () => {
    useAssetLibraryStore.setState({
      assetsById: { a: makeAsset('a'), b: makeAsset('b') },
      assetOrder: ['a', 'b'],
      selectedAssetIds: ['a'],
      activeAssetId: 'a',
    })
    mock.moveToTrash.mockResolvedValue([makeAsset('a', { status: 'trashed', trashedAt: 5000 })])
    await useAssetLibraryStore.getState().moveToTrash(['a'])
    const state = useAssetLibraryStore.getState()
    expect(state.assetsById.a.status).toBe('trashed')
    expect(state.selectedAssetIds).toEqual([])
    expect(state.activeAssetId).toBeNull()
  })

  it('restores assets from trash', async () => {
    useAssetLibraryStore.setState({ assetsById: { a: makeAsset('a', { status: 'trashed' }) }, assetOrder: ['a'] })
    mock.restore.mockResolvedValue([makeAsset('a')])
    await useAssetLibraryStore.getState().restoreAssets(['a'])
    expect(useAssetLibraryStore.getState().assetsById.a.status).toBe('active')
  })

  it('trashes and restores the current selection', async () => {
    useAssetLibraryStore.setState({ assetsById: { a: makeAsset('a') }, assetOrder: ['a'], selectedAssetIds: ['a'] })
    mock.moveToTrash.mockResolvedValue([makeAsset('a', { status: 'trashed' })])
    await useAssetLibraryStore.getState().trashSelectedAssets()
    expect(mock.moveToTrash).toHaveBeenCalledWith(['a'], undefined, undefined)
    expect(useAssetLibraryStore.getState().assetsById.a.status).toBe('trashed')

    useAssetLibraryStore.getState().selectAsset('a')
    mock.restore.mockResolvedValue([makeAsset('a')])
    await useAssetLibraryStore.getState().restoreSelectedAssets()
    expect(useAssetLibraryStore.getState().assetsById.a.status).toBe('active')
  })

  it('does nothing when nothing is selected', async () => {
    useAssetLibraryStore.setState({ selectedAssetIds: [] })
    await useAssetLibraryStore.getState().trashSelectedAssets()
    expect(mock.moveToTrash).not.toHaveBeenCalled()
  })

  it('removes an asset locally without touching the repository', () => {
    useAssetLibraryStore.setState({
      assetsById: { a: makeAsset('a'), b: makeAsset('b') },
      assetOrder: ['a', 'b'],
      selectedAssetIds: ['a'],
      activeAssetId: 'a',
      viewerAssetId: 'a',
      viewerAssetIds: ['a', 'b'],
      quickPreviewAssetId: 'a',
      hoveredAssetId: 'a',
    })
    useAssetLibraryStore.getState().removeAssetLocal('a')
    const state = useAssetLibraryStore.getState()
    expect(state.assetsById.a).toBeUndefined()
    expect(state.assetOrder).toEqual(['b'])
    expect(state.selectedAssetIds).toEqual([])
    expect(state.activeAssetId).toBeNull()
    expect(state.viewerAssetId).toBeNull()
    expect(state.viewerAssetIds).toEqual(['b'])
    expect(state.quickPreviewAssetId).toBeNull()
    expect(state.hoveredAssetId).toBeNull()
  })

  it('purges the current selection through the main store', async () => {
    useAssetLibraryStore.setState({ selectedAssetIds: ['a'] })
    mainStoreMock.purgeGeneratedAssets.mockResolvedValue({ purged: ['a'], blocked: [] })
    const result = await useAssetLibraryStore.getState().purgeSelectedAssets()
    expect(mainStoreMock.purgeGeneratedAssets).toHaveBeenCalledWith(['a'])
    expect(result.purged).toEqual(['a'])
  })

  it('selects and replaces the visible selection', () => {
    useAssetLibraryStore.setState({ assetsById: { a: makeAsset('a'), b: makeAsset('b') }, assetOrder: ['a', 'b'] })
    useAssetLibraryStore.getState().selectAllVisibleAssets(['a', 'b'])
    expect(useAssetLibraryStore.getState().selectedAssetIds).toEqual(['a', 'b'])
    useAssetLibraryStore.getState().replaceSelection(['b'])
    expect(useAssetLibraryStore.getState().selectedAssetIds).toEqual(['b'])
    useAssetLibraryStore.getState().replaceSelection([])
    expect(useAssetLibraryStore.getState().selectedAssetIds).toEqual([])
  })

  it('activates similar search with global scope and clears on scope/query change', () => {
    useAssetLibraryStore.setState({
      assetsById: { a: makeAsset('a'), b: makeAsset('b') },
      assetOrder: ['a', 'b'],
      scope: { kind: 'collection', id: 'c1' },
      query: 'cat',
      filters: { favoriteOnly: true },
    })
    useAssetLibraryStore.getState().setSimilarToAsset('a')
    const similar = useAssetLibraryStore.getState()
    expect(similar.similarToAssetId).toBe('a')
    expect(similar.scope).toBe('all')
    expect(similar.query).toBe('')
    expect(similar.filters).toEqual({})

    useAssetLibraryStore.getState().setScope('favorites')
    expect(useAssetLibraryStore.getState().similarToAssetId).toBeNull()

    useAssetLibraryStore.getState().setSimilarToAsset('b')
    useAssetLibraryStore.getState().setQuery('dog')
    expect(useAssetLibraryStore.getState().similarToAssetId).toBeNull()

    useAssetLibraryStore.getState().setSimilarToAsset('b')
    useAssetLibraryStore.getState().setSimilarToAsset(null)
    expect(useAssetLibraryStore.getState().similarToAssetId).toBeNull()
    expect(useAssetLibraryStore.getState().query).toBe('')
  })

  it('empties the trash through the main store', async () => {
    // 清空回收站需从权威目录全量读取，而非依赖内存快照。
    mock.hydrateFull.mockResolvedValue({
      assets: [makeAsset('a', { status: 'trashed' }), makeAsset('b'), makeAsset('c', { status: 'trashed' })],
      collections: [],
      tags: [],
      tombstones: [],
    })
    mainStoreMock.purgeGeneratedAssets.mockResolvedValue({ purged: ['a', 'c'], blocked: [] })
    const result = await useAssetLibraryStore.getState().emptyTrashAssets()
    expect(mainStoreMock.purgeGeneratedAssets).toHaveBeenCalledWith(['a', 'c'])
    expect(result.purged).toEqual(['a', 'c'])
  })

  it('does nothing when the trash is empty', async () => {
    mock.hydrateFull.mockResolvedValue({
      assets: [makeAsset('a')],
      collections: [],
      tags: [],
      tombstones: [],
    })
    const result = await useAssetLibraryStore.getState().emptyTrashAssets()
    expect(mainStoreMock.purgeGeneratedAssets).not.toHaveBeenCalled()
    expect(result.purged).toEqual([])
  })
})

describe('collections', () => {
  it('creates a collection through the repository', async () => {
    const saved = {
      id: 'c1',
      name: '项目',
      normalizedName: '项目',
      parentId: null,
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    }
    mock.putCollection.mockResolvedValue(saved)
    const result = await useAssetLibraryStore.getState().createCollection('项目')
    expect(result).toEqual(saved)
    expect(useAssetLibraryStore.getState().collections).toHaveLength(1)
  })

  it('creates a nested collection under its parent', async () => {
    const parent = {
      id: 'parent',
      name: '父项目',
      normalizedName: '父项目',
      parentId: null,
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    }
    const child = {
      id: 'child',
      name: '子项目',
      normalizedName: '子项目',
      parentId: 'parent',
      order: 0,
      createdAt: 2,
      updatedAt: 2,
    }
    useAssetLibraryStore.setState({ collections: [parent] })
    mock.putCollection.mockResolvedValue(child)

    const result = await useAssetLibraryStore.getState().createCollection('子项目', 'parent')

    expect(result).toEqual(child)
    expect(mock.putCollection).toHaveBeenCalledWith(expect.objectContaining({ name: '子项目', parentId: 'parent' }))
  })

  it('renames a collection', async () => {
    useAssetLibraryStore.setState({
      collections: [
        { id: 'c1', name: '旧名', normalizedName: '旧名', parentId: null, order: 0, createdAt: 1, updatedAt: 1 },
      ],
    })
    mock.getCollection.mockResolvedValue({
      id: 'c1',
      name: '旧名',
      normalizedName: '旧名',
      parentId: null,
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    })
    mock.putCollection.mockResolvedValue({
      id: 'c1',
      name: '新名',
      normalizedName: '新名',
      parentId: null,
      order: 0,
      createdAt: 1,
      updatedAt: 2,
    })
    await useAssetLibraryStore.getState().renameCollection('c1', '新名')
    expect(useAssetLibraryStore.getState().collections[0].name).toBe('新名')
  })

  it('deletes an empty collection immediately without a confirmation', async () => {
    useAssetLibraryStore.setState({
      collections: [{ id: 'c1', name: 'x', normalizedName: 'x', parentId: null, order: 0, createdAt: 1, updatedAt: 1 }],
      assetsById: {},
      assetOrder: [],
      scope: { kind: 'collection', id: 'c1' },
      filters: { collectionId: 'c1' },
    })
    mock.removeCollection.mockResolvedValue(undefined)
    await useAssetLibraryStore.getState().deleteCollection('c1')
    expect(mock.removeCollection).toHaveBeenCalledWith('c1')
    expect(mainStoreMock.setConfirmDialog).not.toHaveBeenCalled()
    const state = useAssetLibraryStore.getState()
    expect(state.collections).toHaveLength(0)
    expect(state.filters.collectionId).toBeNull()
    expect(state.scope).toBe('all')
  })

  it('asks for confirmation before deleting a folder that contains images, then removes it and unassigns the assets', async () => {
    useAssetLibraryStore.setState({
      collections: [{ id: 'c1', name: 'x', normalizedName: 'x', parentId: null, order: 0, createdAt: 1, updatedAt: 1 }],
      assetsById: { a: makeAsset('a', { collectionIds: ['c1'] }) },
      assetOrder: ['a'],
      scope: { kind: 'collection', id: 'c1' },
      filters: { collectionId: 'c1' },
    })
    mock.removeCollection.mockResolvedValue(undefined)
    await useAssetLibraryStore.getState().deleteCollection('c1')

    // 含图片：先弹确认，不直接删除
    expect(mock.removeCollection).not.toHaveBeenCalled()
    expect(mainStoreMock.setConfirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({ title: '删除文件夹？', confirmText: '删除', tone: 'danger' }),
    )
    const dialog = mainStoreMock.setConfirmDialog.mock.calls[0]?.[0]
    dialog.action()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(mock.removeCollection).toHaveBeenCalledWith('c1')
    const state = useAssetLibraryStore.getState()
    expect(state.collections).toHaveLength(0)
    // 文件夹被删后，素材只是失去该文件夹归属（图片本身不删除）
    expect(state.assetsById.a.collectionIds).toEqual([])
    expect(state.filters.collectionId).toBeNull()
    expect(state.scope).toBe('all')
  })

  it('deletes the whole subtree when deleting a parent (no recycle bin)', async () => {
    const root = {
      id: 'root',
      name: '根项目',
      normalizedName: '根项目',
      parentId: null,
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    }
    const parent = {
      id: 'parent',
      name: '父项目',
      normalizedName: '父项目',
      parentId: 'root',
      order: 0,
      createdAt: 2,
      updatedAt: 2,
    }
    const child = {
      id: 'child',
      name: '子项目',
      normalizedName: '子项目',
      parentId: 'parent',
      order: 0,
      createdAt: 3,
      updatedAt: 3,
    }
    useAssetLibraryStore.setState({ collections: [root, parent, child] })
    mock.removeCollection.mockResolvedValue(undefined)

    await useAssetLibraryStore.getState().deleteCollection('parent')

    // 彻底删除整棵子树（父 + 子）
    expect(mock.removeCollection).toHaveBeenCalledWith('parent')
    expect(mock.removeCollection).toHaveBeenCalledWith('child')
    const state = useAssetLibraryStore.getState()
    expect(state.collections.map((item) => item.id)).toEqual(['root'])
  })

  it('deletes every selected folder as a batch', async () => {
    useAssetLibraryStore.setState({
      collections: [
        { id: 'a', name: 'a', normalizedName: 'a', parentId: null, order: 0, createdAt: 1, updatedAt: 1 },
        { id: 'b', name: 'b', normalizedName: 'b', parentId: null, order: 1, createdAt: 1, updatedAt: 1 },
      ],
      assetsById: {},
      assetOrder: [],
      selectedFolderIds: ['a', 'b'],
    })
    mock.removeCollection.mockResolvedValue(undefined)
    await useAssetLibraryStore.getState().deleteSelectedFolders()
    expect(mock.removeCollection).toHaveBeenCalledWith('a')
    expect(mock.removeCollection).toHaveBeenCalledWith('b')
    expect(useAssetLibraryStore.getState().selectedFolderIds).toEqual([])
  })

  it('purges a collection permanently (subtree + asset references)', async () => {
    useAssetLibraryStore.setState({
      collections: [
        {
          id: 'c1',
          name: 'x',
          normalizedName: 'x',
          parentId: null,
          order: 0,
          createdAt: 1,
          updatedAt: 1,
          trashedAt: 100,
        },
      ],
      assetsById: { a: makeAsset('a', { collectionIds: ['c1'] }) },
      assetOrder: ['a'],
    })
    mock.removeCollection.mockResolvedValue(undefined)
    await useAssetLibraryStore.getState().purgeCollection('c1')
    expect(mock.removeCollection).toHaveBeenCalledWith('c1')
    const state = useAssetLibraryStore.getState()
    expect(state.collections).toHaveLength(0)
    expect(state.assetsById.a.collectionIds).toEqual([])
  })

  it('moves a collection to a new parent', async () => {
    const root = {
      id: 'root',
      name: '根项目',
      normalizedName: '根项目',
      parentId: null,
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    }
    const child = {
      id: 'child',
      name: '子项目',
      normalizedName: '子项目',
      parentId: null,
      order: 0,
      createdAt: 2,
      updatedAt: 2,
    }
    useAssetLibraryStore.setState({ collections: [root, child] })
    mock.putCollection.mockImplementation(async (collection) => collection)

    await useAssetLibraryStore.getState().moveCollection('child', 'root')

    const updated = useAssetLibraryStore.getState().collections.find((item) => item.id === 'child')
    expect(updated?.parentId).toBe('root')
    expect(mock.putCollection).toHaveBeenCalledWith(expect.objectContaining({ id: 'child', parentId: 'root' }))
  })

  it('moves a collection back to the top level', async () => {
    const root = {
      id: 'root',
      name: '根项目',
      normalizedName: '根项目',
      parentId: null,
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    }
    const child = {
      id: 'child',
      name: '子项目',
      normalizedName: '子项目',
      parentId: 'root',
      order: 0,
      createdAt: 2,
      updatedAt: 2,
    }
    useAssetLibraryStore.setState({ collections: [root, child] })
    mock.putCollection.mockImplementation(async (collection) => collection)

    await useAssetLibraryStore.getState().moveCollection('child', null)

    expect(useAssetLibraryStore.getState().collections.find((item) => item.id === 'child')?.parentId).toBeNull()
  })

  it('refuses to move a collection into its own descendant', async () => {
    const root = {
      id: 'root',
      name: '根项目',
      normalizedName: '根项目',
      parentId: null,
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    }
    const child = {
      id: 'child',
      name: '子项目',
      normalizedName: '子项目',
      parentId: 'root',
      order: 0,
      createdAt: 2,
      updatedAt: 2,
    }
    useAssetLibraryStore.setState({ collections: [root, child] })
    mock.putCollection.mockImplementation(async (collection) => collection)

    await useAssetLibraryStore.getState().moveCollection('root', 'child')

    expect(mock.putCollection).not.toHaveBeenCalled()
    expect(useAssetLibraryStore.getState().collections.find((item) => item.id === 'root')?.parentId).toBeNull()
    expect(mainStoreMock.useStore.getState().showToast).toHaveBeenCalledWith('不能移动到自身的子项目中', 'error')
  })

  it('persists the grid density preference', () => {
    useAssetLibraryStore.getState().setGridDensity('compact')
    const persisted = partializeAssetLibraryStore(useAssetLibraryStore.getState())
    expect(persisted.gridDensity).toBe('compact')
  })
})

describe('batch collection operations (Eagle 式批量移动与撤销)', () => {
  beforeEach(() => {
    useAssetLibraryStore.setState({
      assetsById: {
        a: makeAsset('a', { collectionIds: ['src'] }),
        b: makeAsset('b', { collectionIds: ['src'] }),
        c: makeAsset('c', { collectionIds: [] }),
      },
      assetOrder: ['a', 'b', 'c'],
      collections: [
        {
          id: 'src',
          name: '来源',
          normalizedName: '来源',
          parentId: null,
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'dst',
          name: '目标',
          normalizedName: '目标',
          parentId: null,
          order: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })
    mock.putGeneratedAssets.mockResolvedValue(undefined)
  })

  it('moves many assets atomically: removes source, adds target, single write, undo entry', async () => {
    const changed = await useAssetLibraryStore.getState().moveAssetsToCollection(['a', 'b'], 'dst', 'src')

    expect(changed).toBe(2)
    // 一次批量写（不再逐张写）
    expect(mock.putGeneratedAssets).toHaveBeenCalledTimes(1)
    const written = mock.putGeneratedAssets.mock.calls[0][0] as GeneratedAsset[]
    expect(written.map((a) => a.id).sort()).toEqual(['a', 'b'])
    expect(written.every((a) => a.collectionIds.includes('dst') && !a.collectionIds.includes('src'))).toBe(true)
    // store 单次更新
    expect(useAssetLibraryStore.getState().assetsById['a'].collectionIds).toEqual(['dst'])
    // 撤销栈记录 before 快照
    const entry = useAssetLibraryStore.getState().undoStack[useAssetLibraryStore.getState().undoStack.length - 1]
    expect(Object.keys(entry.assetsBefore).sort()).toEqual(['a', 'b'])
    expect(entry.assetsBefore['a'].collectionIds).toEqual(['src'])
    expect(entry.assetsAfter['a'].collectionIds).toEqual(['dst'])
  })

  it('adds and removes a collection membership in batch', async () => {
    await useAssetLibraryStore.getState().batchSetCollection(['a', 'b'], 'dst', true)
    expect(useAssetLibraryStore.getState().assetsById['a'].collectionIds).toEqual(['src', 'dst'])

    await useAssetLibraryStore.getState().batchSetCollection(['a'], 'src', false)
    expect(useAssetLibraryStore.getState().assetsById['a'].collectionIds).toEqual(['dst'])
  })

  it('undoes the batch move via the undo stack', async () => {
    await useAssetLibraryStore.getState().moveAssetsToCollection(['a', 'b'], 'dst', 'src')
    expect(useAssetLibraryStore.getState().assetsById['a'].collectionIds).toEqual(['dst'])

    const undone = await useAssetLibraryStore.getState().undo()
    expect(undone).toBe(true)
    expect(useAssetLibraryStore.getState().assetsById['a'].collectionIds).toEqual(['src'])
    expect(useAssetLibraryStore.getState().assetsById['b'].collectionIds).toEqual(['src'])
    expect(useAssetLibraryStore.getState().undoStack).toHaveLength(0)
    // 撤销后可重做
    const redone = await useAssetLibraryStore.getState().redo()
    expect(redone).toBe(true)
    expect(useAssetLibraryStore.getState().assetsById['a'].collectionIds).toEqual(['dst'])
  })

  it('applies explicit collection changes in one atomic write (drag-drop replace + move)', async () => {
    const changed = await useAssetLibraryStore.getState().applyBatchCollectionChanges(
      [
        { id: 'c', collectionIds: ['dst'] },
        { id: 'a', collectionIds: ['dst'] }, // 替换：从 src 移除
      ],
      '移动 2 张至项目「目标项」',
    )
    expect(changed).toBe(2)
    expect(mock.putGeneratedAssets).toHaveBeenCalledTimes(1)
    expect(useAssetLibraryStore.getState().assetsById['c'].collectionIds).toEqual(['dst'])
    expect(useAssetLibraryStore.getState().assetsById['a'].collectionIds).toEqual(['dst'])
  })

  it('reports progress while writing in batches', async () => {
    const progress: Array<[number, number]> = []
    await useAssetLibraryStore
      .getState()
      .moveAssetsToCollection(['a', 'b', 'c'], 'dst', null, (done, total) => progress.push([done, total]))
    expect(progress.length).toBeGreaterThan(0)
    expect(progress[progress.length - 1]).toEqual([3, 3])
  })

  it('does nothing when assets are unchanged', async () => {
    // c 本来就不在 src：移出无变化
    const changed = await useAssetLibraryStore.getState().batchSetCollection(['c'], 'src', false)
    expect(changed).toBe(0)
    expect(mock.putGeneratedAssets).not.toHaveBeenCalled()
    expect(useAssetLibraryStore.getState().undoStack).toHaveLength(0)
  })
})

describe('copy / cut / paste (clipboard)', () => {
  const parent: AssetCollection = {
    id: 'parent',
    name: '品牌素材',
    normalizedName: '品牌素材',
    parentId: null,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
  }
  const child: AssetCollection = {
    id: 'child',
    name: '活动海报',
    normalizedName: '活动海报',
    parentId: 'parent',
    order: 0,
    createdAt: 2,
    updatedAt: 2,
  }

  it('copies a collection subtree with its asset membership into a target', async () => {
    const root: AssetCollection = {
      id: 'root',
      name: '根',
      normalizedName: '根',
      parentId: null,
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    }
    const assetA = makeAsset('a', { collectionIds: ['parent'] })
    const assetB = makeAsset('b', { collectionIds: ['child'] })
    useAssetLibraryStore.setState({
      collections: [root, parent, child],
      assetsById: { a: assetA, b: assetB },
      assetOrder: ['a', 'b'],
    })
    mock.listCollections.mockResolvedValue([root, parent, child])
    mock.listAssets.mockResolvedValue([assetA, assetB])
    mock.putCollection.mockImplementation(async (collection: unknown) => collection)
    mock.putGeneratedAssets.mockResolvedValue(undefined)

    useAssetLibraryStore.getState().copyCollection('parent')
    expect(useAssetLibraryStore.getState().clipboard).toMatchObject({
      kind: 'copy',
      type: 'collection',
      id: 'parent',
      name: '品牌素材',
    })

    const cloned = await useAssetLibraryStore.getState().pasteCollection('root')
    expect(cloned?.name).toBe('品牌素材')
    // 深拷贝 parent + child 两个节点，根克隆挂到目标下
    expect(mock.putCollection).toHaveBeenCalledTimes(2)
    const clones = mock.putCollection.mock.calls.map((call) => call[0] as AssetCollection)
    const parentClone = clones.find((item) => item.parentId === 'root')
    const childClone = clones.find((item) => item.parentId === parentClone?.id)
    expect(parentClone).toBeTruthy()
    expect(childClone?.name).toBe('活动海报')
    // 素材归属追加到对应克隆（素材共享，不复制文件）
    const persisted = mock.putGeneratedAssets.mock.calls[0][0] as GeneratedAsset[]
    expect(persisted.find((item) => item.id === 'a')?.collectionIds).toContain(parentClone!.id)
    expect(persisted.find((item) => item.id === 'b')?.collectionIds).toContain(childClone!.id)
    // 复制保留剪贴板（可多次粘贴），本地状态同步
    expect(useAssetLibraryStore.getState().clipboard?.kind).toBe('copy')
    expect(useAssetLibraryStore.getState().collections).toHaveLength(5)
    expect(useAssetLibraryStore.getState().assetsById.a.collectionIds).toContain(parentClone!.id)
  })

  it('moves a collection on cut+paste and clears the clipboard', async () => {
    useAssetLibraryStore.setState({ collections: [parent, child], assetsById: {}, assetOrder: [] })
    mock.putCollection.mockImplementation(async (collection: unknown) => collection)

    useAssetLibraryStore.getState().cutCollection('child')
    expect(useAssetLibraryStore.getState().clipboard).toMatchObject({ kind: 'cut', type: 'collection', id: 'child' })

    await useAssetLibraryStore.getState().pasteCollection(null)
    expect(mock.putCollection).toHaveBeenCalledWith(expect.objectContaining({ id: 'child', parentId: null }))
    expect(useAssetLibraryStore.getState().collections.find((item) => item.id === 'child')?.parentId).toBeNull()
    expect(useAssetLibraryStore.getState().clipboard).toBeNull()
  })
})

describe('folder enhancements', () => {
  const root: AssetCollection = {
    id: 'root',
    name: '根',
    normalizedName: '根',
    parentId: null,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
  }
  const parent: AssetCollection = {
    id: 'parent',
    name: '品牌',
    normalizedName: '品牌',
    parentId: null,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
  }
  const child: AssetCollection = {
    id: 'child',
    name: '海报',
    normalizedName: '海报',
    parentId: 'parent',
    order: 1,
    createdAt: 2,
    updatedAt: 2,
  }

  it('reorders a collection up/down among siblings', async () => {
    const a: AssetCollection = {
      id: 'a',
      name: 'A',
      normalizedName: 'a',
      parentId: null,
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    }
    const b: AssetCollection = {
      id: 'b',
      name: 'B',
      normalizedName: 'b',
      parentId: null,
      order: 1,
      createdAt: 2,
      updatedAt: 2,
    }
    useAssetLibraryStore.setState({ collections: [a, b], assetsById: {}, assetOrder: [] })
    mock.putCollection.mockImplementation(async (collection: unknown) => collection)

    await useAssetLibraryStore.getState().reorderCollection('b', 'up')
    expect(mock.putCollection).toHaveBeenCalledWith(expect.objectContaining({ id: 'b', order: 0 }))
    expect(mock.putCollection).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', order: 1 }))

    await useAssetLibraryStore.getState().reorderCollection('b', 'down')
    expect(mock.putCollection).toHaveBeenCalledWith(expect.objectContaining({ id: 'b', order: 1 }))
  })

  it('duplicates a collection at the same parent', async () => {
    useAssetLibraryStore.setState({
      collections: [root, parent, child],
      assetsById: { a: makeAsset('a', { collectionIds: ['parent'] }) },
      assetOrder: ['a'],
    })
    mock.listCollections.mockResolvedValue([root, parent, child])
    mock.listAssets.mockResolvedValue([makeAsset('a', { collectionIds: ['parent'] })])
    mock.putCollection.mockImplementation(async (collection: unknown) => collection)
    mock.putGeneratedAssets.mockResolvedValue(undefined)

    const cloned = await useAssetLibraryStore.getState().duplicateCollection('parent')
    // 复制到根级（parent.parentId = null）；源文件夹仍占用「品牌」名，克隆加「副本」后缀
    expect(cloned?.name).toBe('品牌 副本')
    const clones = mock.putCollection.mock.calls.map((call) => call[0] as AssetCollection)
    expect(clones.some((item) => item.parentId === null && item.id !== 'parent' && item.id !== 'root')).toBe(true)
    expect(useAssetLibraryStore.getState().collections).toHaveLength(5)
  })

  it('merges a source collection into a target (assets + subfolders)', async () => {
    useAssetLibraryStore.setState({
      collections: [parent, child],
      assetsById: { a: makeAsset('a', { collectionIds: ['parent'] }) },
      assetOrder: ['a'],
    })
    mock.listAssets.mockResolvedValue([makeAsset('a', { collectionIds: ['parent'] })])
    mock.putGeneratedAssets.mockResolvedValue(undefined)
    mock.putCollection.mockImplementation(async (collection: unknown) => collection)
    mock.removeCollection.mockResolvedValue(undefined)

    // 需要第二个目标文件夹
    const target: AssetCollection = {
      id: 'target',
      name: '目标',
      normalizedName: '目标',
      parentId: null,
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    }
    useAssetLibraryStore.setState((state) => ({ collections: [...state.collections, target] }))

    const ok = await useAssetLibraryStore.getState().mergeCollection('parent', 'target')
    expect(ok).toBe(true)
    // 素材追加 targetId；子文件夹挂到 target；source 被删除
    expect(mock.putGeneratedAssets.mock.calls[0][0] as GeneratedAsset[]).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'a', collectionIds: ['parent', 'target'] })]),
    )
    expect(useAssetLibraryStore.getState().collections.find((item) => item.id === 'child')?.parentId).toBe('target')
    expect(useAssetLibraryStore.getState().collections.find((item) => item.id === 'parent')).toBeUndefined()
  })

  it('sets a collection color and toggles pinned', async () => {
    useAssetLibraryStore.setState({ collections: [parent], assetsById: {}, assetOrder: [] })
    mock.getCollection.mockResolvedValue(parent)
    mock.putCollection.mockImplementation(async (collection: unknown) => collection)

    await useAssetLibraryStore.getState().setCollectionColor('parent', '#ff0000')
    expect(useAssetLibraryStore.getState().collections[0]?.color).toBe('#ff0000')

    await useAssetLibraryStore.getState().togglePinCollection('parent')
    expect(useAssetLibraryStore.getState().collections[0]?.pinned).toBe(true)
  })

  it('restores a trashed collection', async () => {
    const trashed = { ...parent, trashedAt: 100, updatedAt: 100 }
    useAssetLibraryStore.setState({ collections: [root, trashed, child], assetsById: {}, assetOrder: [] })
    mock.restoreCollection.mockResolvedValue(undefined)
    await useAssetLibraryStore.getState().restoreCollection('parent')
    expect(mock.restoreCollection).toHaveBeenCalledWith('parent')
    const state = useAssetLibraryStore.getState()
    expect(state.collections.find((item) => item.id === 'parent')?.trashedAt).toBeNull()
    expect(state.collections.find((item) => item.id === 'child')?.trashedAt).toBeNull()
  })
})

describe('persist boundary', () => {
  it('persists only UI preferences, not assets', () => {
    useAssetLibraryStore.setState({ assetsById: { a: makeAsset('a') }, assetOrder: ['a'] })
    useAssetLibraryStore.getState().setScope('favorites')
    useAssetLibraryStore.getState().setQuery('dog')
    const persisted = partializeAssetLibraryStore(useAssetLibraryStore.getState())
    const hasAssets = 'assetsById' in persisted || 'assetOrder' in persisted || 'collections' in persisted
    expect(hasAssets).toBe(false)
    expect(persisted.scope).toBe('favorites')
    expect(persisted.query).toBe('dog')
  })
})

describe('view mode', () => {
  it('switches between grid and list and persists the preference', () => {
    useAssetLibraryStore.getState().setViewMode('list')
    expect(useAssetLibraryStore.getState().viewMode).toBe('list')
    expect(partializeAssetLibraryStore(useAssetLibraryStore.getState()).viewMode).toBe('list')
    useAssetLibraryStore.getState().setViewMode('grid')
    expect(useAssetLibraryStore.getState().viewMode).toBe('grid')
  })
})

describe('include subcollections', () => {
  it('defaults to off, toggles, and persists', () => {
    expect(useAssetLibraryStore.getState().includeSubcollections).toBe(false)
    useAssetLibraryStore.getState().setIncludeSubcollections(false)
    expect(useAssetLibraryStore.getState().includeSubcollections).toBe(false)
    expect(partializeAssetLibraryStore(useAssetLibraryStore.getState()).includeSubcollections).toBe(false)
    useAssetLibraryStore.getState().setIncludeSubcollections(true)
    expect(useAssetLibraryStore.getState().includeSubcollections).toBe(true)
  })
})

describe('group by (none / grouped)', () => {
  it('switches between grouping styles, clears the selection, and persists', () => {
    useAssetLibraryStore.setState({ selectedAssetIds: ['a'] })
    useAssetLibraryStore.getState().setGroupBy('grouped')
    const state = useAssetLibraryStore.getState()
    expect(state.groupBy).toBe('grouped')
    expect(state.selectedAssetIds).toEqual([])
    expect(partializeAssetLibraryStore(state).groupBy).toBe('grouped')
    useAssetLibraryStore.getState().setGroupBy('none')
    expect(useAssetLibraryStore.getState().groupBy).toBe('none')
  })

  it('normalizes legacy batch/task grouping values into grouped', () => {
    // v4 迁移：旧持久化里的 batch/task 合并为 grouped
    expect(normalizeGroupBy('batch')).toBe('grouped')
    expect(normalizeGroupBy('task')).toBe('grouped')
    expect(normalizeGroupBy('grouped')).toBe('grouped')
    expect(normalizeGroupBy('none')).toBe('none')
    expect(normalizeGroupBy(undefined)).toBe('none')
  })

  it('switches the grouped presentation style (cards / tiles), clears the selection, and persists', () => {
    expect(useAssetLibraryStore.getState().groupedViewStyle).toBe('cards')
    useAssetLibraryStore.setState({ selectedAssetIds: ['a'] })
    useAssetLibraryStore.getState().setGroupedViewStyle('tiles')
    const state = useAssetLibraryStore.getState()
    expect(state.groupedViewStyle).toBe('tiles')
    expect(state.selectedAssetIds).toEqual([])
    expect(partializeAssetLibraryStore(state).groupedViewStyle).toBe('tiles')
    useAssetLibraryStore.getState().setGroupedViewStyle('cards')
    expect(useAssetLibraryStore.getState().groupedViewStyle).toBe('cards')
  })

  it('tracks the batch focus task without persisting it', () => {
    useAssetLibraryStore.getState().setBatchFocusTaskId('task-1')
    expect(useAssetLibraryStore.getState().batchFocusTaskId).toBe('task-1')
    const persisted = partializeAssetLibraryStore(useAssetLibraryStore.getState())
    expect('batchFocusTaskId' in persisted).toBe(false)
    useAssetLibraryStore.getState().setBatchFocusTaskId(null)
    expect(useAssetLibraryStore.getState().batchFocusTaskId).toBeNull()
  })
})

describe('fullscreen viewer', () => {
  it('opens the viewer with a navigation list and clears the selection', () => {
    useAssetLibraryStore.getState().openViewer('b', ['a', 'b', 'c'])
    const state = useAssetLibraryStore.getState()
    expect(state.viewerAssetId).toBe('b')
    expect(state.viewerAssetIds).toEqual(['a', 'b', 'c'])
    expect(state.selectedAssetIds).toEqual([])
  })

  it('falls back to a single-item list and navigates within it', () => {
    useAssetLibraryStore.getState().openViewer('a', [])
    expect(useAssetLibraryStore.getState().viewerAssetIds).toEqual(['a'])
    useAssetLibraryStore.getState().setViewerAsset('z')
    expect(useAssetLibraryStore.getState().viewerAssetId).toBe('z')
    useAssetLibraryStore.getState().closeViewer()
    expect(useAssetLibraryStore.getState().viewerAssetId).toBeNull()
    expect(useAssetLibraryStore.getState().viewerAssetIds).toEqual([])
  })
})

describe('smart folders', () => {
  it('saves the current scope/query/filters as a named filter', () => {
    useAssetLibraryStore.getState().setScope('favorites')
    useAssetLibraryStore.getState().setQuery('cat')
    useAssetLibraryStore.getState().setFilters({ minRating: 4 })
    const entry = useAssetLibraryStore.getState().addSavedFilter('  高分猫咪  ')
    expect(entry).not.toBeNull()
    const saved = useAssetLibraryStore.getState().savedFilters[0]
    expect(saved.name).toBe('高分猫咪')
    expect(saved.scope).toBe('favorites')
    expect(saved.query).toBe('cat')
    expect(saved.filters.minRating).toBe(4)
  })

  it('rejects empty names and removes saved filters', () => {
    expect(useAssetLibraryStore.getState().addSavedFilter('   ')).toBeNull()
    const entry = useAssetLibraryStore.getState().addSavedFilter('灵感')
    useAssetLibraryStore.getState().removeSavedFilter(entry!.id)
    expect(useAssetLibraryStore.getState().savedFilters).toHaveLength(0)
  })

  it('applies a saved filter and resets transient state', () => {
    const entry = useAssetLibraryStore.getState().addSavedFilter('风景')
    useAssetLibraryStore.getState().setScope('all')
    useAssetLibraryStore.getState().setQuery('')
    useAssetLibraryStore.getState().setSimilarToAsset('x')
    useAssetLibraryStore.getState().applySavedFilter(entry!.id)
    const state = useAssetLibraryStore.getState()
    expect(state.similarToAssetId).toBeNull()
    expect(state.selectedAssetIds).toEqual([])
    expect(state.activeAssetId).toBeNull()
  })

  it('persists saved filters in the UI preference boundary', () => {
    useAssetLibraryStore.getState().addSavedFilter('草稿')
    const persisted = partializeAssetLibraryStore(useAssetLibraryStore.getState())
    expect(persisted.savedFilters).toHaveLength(1)
    expect(persisted.savedFilters[0]?.name).toBe('草稿')
  })
})

describe('pinned quick filters（顶部快捷筛选）', () => {
  it('pins a single filter value with dedupe by kind+value', () => {
    useAssetLibraryStore.getState().pinFilter({ kind: 'provider', value: '豆包' })
    useAssetLibraryStore.getState().pinFilter({ kind: 'provider', value: '豆包' })
    useAssetLibraryStore.getState().pinFilter({ kind: 'minRating', value: 4 })
    expect(useAssetLibraryStore.getState().pinnedFilters).toEqual([
      { kind: 'provider', value: '豆包' },
      { kind: 'minRating', value: 4 },
    ])
  })

  it('unpins by key without touching the active filters', () => {
    useAssetLibraryStore.getState().pinFilter({ kind: 'favoriteOnly' })
    useAssetLibraryStore.getState().setFilters({ favoriteOnly: true })
    useAssetLibraryStore.getState().unpinFilter('favoriteOnly')
    expect(useAssetLibraryStore.getState().pinnedFilters).toEqual([])
    expect(useAssetLibraryStore.getState().filters.favoriteOnly).toBe(true)
  })

  it('toggles pin state (筛选面板图钉按钮)', () => {
    const { togglePinFilter } = useAssetLibraryStore.getState()
    togglePinFilter({ kind: 'model', value: 'gpt-image-1' })
    expect(useAssetLibraryStore.getState().pinnedFilters).toHaveLength(1)
    togglePinFilter({ kind: 'model', value: 'gpt-image-1' })
    expect(useAssetLibraryStore.getState().pinnedFilters).toHaveLength(0)
  })

  it('applies an inactive pinned filter and removes it when active (点击快捷胶囊)', () => {
    const { pinFilter, applyPinnedFilter } = useAssetLibraryStore.getState()
    pinFilter({ kind: 'minRating', value: 4 })
    applyPinnedFilter({ kind: 'minRating', value: 4 })
    expect(useAssetLibraryStore.getState().filters.minRating).toBe(4)
    applyPinnedFilter({ kind: 'minRating', value: 4 })
    expect(useAssetLibraryStore.getState().filters.minRating).toBeUndefined()
  })

  it('keeps other conditions when applying a pinned filter', () => {
    useAssetLibraryStore.getState().setFilters({ favoriteOnly: true, minRating: 3 })
    useAssetLibraryStore.getState().applyPinnedFilter({ kind: 'provider', value: 'fal' })
    expect(useAssetLibraryStore.getState().filters).toMatchObject({ favoriteOnly: true, minRating: 3, provider: 'fal' })
  })

  it('persists pinned filters in the UI preference boundary', () => {
    useAssetLibraryStore.getState().pinFilter({ kind: 'orientation', value: 'portrait' })
    const persisted = partializeAssetLibraryStore(useAssetLibraryStore.getState())
    expect(persisted.pinnedFilters).toEqual([{ kind: 'orientation', value: 'portrait' }])
  })

  it('reorders pinned filters (Eagle 式标签拖动排序)', () => {
    useAssetLibraryStore.getState().pinFilter({ kind: 'provider', value: '豆包' })
    useAssetLibraryStore.getState().pinFilter({ kind: 'minRating', value: 4 })
    useAssetLibraryStore.getState().reorderPinnedFilters(0, 1)
    expect(useAssetLibraryStore.getState().pinnedFilters.map((item) => item.kind)).toEqual(['minRating', 'provider'])
    // 越界与同位置为无操作
    useAssetLibraryStore.getState().reorderPinnedFilters(0, 0)
    useAssetLibraryStore.getState().reorderPinnedFilters(-1, 0)
    useAssetLibraryStore.getState().reorderPinnedFilters(0, 99)
    expect(useAssetLibraryStore.getState().pinnedFilters.map((item) => item.kind)).toEqual(['minRating', 'provider'])
  })

  it('sets visible filter controls (工具栏筛选项「+」菜单) and persists them', () => {
    expect(useAssetLibraryStore.getState().visibleFilterControls).toEqual([])
    useAssetLibraryStore.getState().setVisibleFilterControls(['provider', 'model', 'minRating'])
    expect(useAssetLibraryStore.getState().visibleFilterControls).toEqual(['provider', 'model', 'minRating'])
    const persisted = partializeAssetLibraryStore(useAssetLibraryStore.getState())
    expect(persisted.visibleFilterControls).toEqual(['provider', 'model', 'minRating'])
    // 再次设置（取消勾选）生效
    useAssetLibraryStore.getState().setVisibleFilterControls(['provider'])
    expect(useAssetLibraryStore.getState().visibleFilterControls).toEqual(['provider'])
  })
})

describe('color labels', () => {
  it('applies a color label patch through the repository', async () => {
    const asset = makeAsset('a', { colorLabel: 'blue' })
    useAssetLibraryStore.setState({ assetsById: { a: asset }, assetOrder: ['a'] })
    mock.patchAssets.mockResolvedValue([{ ...asset, colorLabel: 'red' }])
    await useAssetLibraryStore.getState().patchAssets(['a'], { colorLabel: 'red' })
    expect(useAssetLibraryStore.getState().assetsById.a.colorLabel).toBe('red')
  })

  it('clears a color label with an explicit undefined patch', async () => {
    const asset = makeAsset('a', { colorLabel: 'green' })
    useAssetLibraryStore.setState({ assetsById: { a: asset }, assetOrder: ['a'] })
    mock.patchAssets.mockResolvedValue([{ ...asset, colorLabel: undefined }])
    await useAssetLibraryStore.getState().patchAssets(['a'], { colorLabel: undefined })
    expect(useAssetLibraryStore.getState().assetsById.a.colorLabel).toBeUndefined()
  })
})

describe('tags', () => {
  function makeTag(id: string, name: string, parentId: string | null = null, order = 0) {
    return { id, name, normalizedName: name.toLocaleLowerCase('zh-CN'), parentId, order, createdAt: 1, updatedAt: 1 }
  }

  it('creates a tag and appends to siblings order', async () => {
    useAssetLibraryStore.setState({ tags: [makeTag('t1', '品牌')] })
    const created = await useAssetLibraryStore.getState().createTag('  灵感  ')
    expect(created).not.toBeNull()
    expect(mock.putTags).toHaveBeenCalledTimes(1)
    const state = useAssetLibraryStore.getState()
    expect(state.tags).toHaveLength(2)
    expect(state.tags.find((tag) => tag.id === created!.id)?.order).toBe(1)
  })

  it('rejects duplicate tag names among siblings', async () => {
    useAssetLibraryStore.setState({ tags: [makeTag('t1', '品牌')] })
    const created = await useAssetLibraryStore.getState().createTag('品牌')
    expect(created).toBeNull()
    expect(mock.putTags).not.toHaveBeenCalled()
  })

  it('creates a child tag under a parent', async () => {
    useAssetLibraryStore.setState({ tags: [makeTag('t1', '品牌')] })
    const child = await useAssetLibraryStore.getState().createTag('子类', 't1')
    expect(child?.parentId).toBe('t1')
  })

  it('renames a tag and rejects duplicate sibling names', async () => {
    useAssetLibraryStore.setState({ tags: [makeTag('t1', '品牌'), makeTag('t2', '风格')] })
    await useAssetLibraryStore.getState().renameTag('t1', '新品牌')
    expect(useAssetLibraryStore.getState().tags.find((tag) => tag.id === 't1')?.name).toBe('新品牌')
    await useAssetLibraryStore.getState().renameTag('t1', '风格')
    expect(useAssetLibraryStore.getState().tags.find((tag) => tag.id === 't1')?.name).toBe('新品牌')
  })

  it('deletes a tag: strips asset references and clears active filters', async () => {
    const asset = makeAsset('a', { tagIds: ['t1', 't2'] })
    useAssetLibraryStore.setState({
      assetsById: { a: asset },
      assetOrder: ['a'],
      tags: [makeTag('t1', '品牌'), makeTag('t2', '风格')],
      filters: { tagIds: ['t1', 't3'] },
    })
    const stripped = { ...asset, tagIds: ['t2'] }
    mock.patchAssetsIndividually.mockResolvedValue([stripped])
    await useAssetLibraryStore.getState().deleteTag('t1')
    expect(mock.patchAssetsIndividually).toHaveBeenCalledWith([{ id: 'a', patch: { tagIds: ['t2'] } }])
    expect(mock.deleteTagRecord).toHaveBeenCalledWith('t1')
    const state = useAssetLibraryStore.getState()
    expect(state.tags.map((tag) => tag.id)).toEqual(['t2'])
    expect(state.assetsById.a.tagIds).toEqual(['t2'])
    expect(state.filters.tagIds).toEqual(['t3'])
  })

  it('merges a tag into another: remaps references and promotes children', async () => {
    const asset = makeAsset('a', { tagIds: ['t1', 't2'] })
    const child = makeTag('t3', '子标签', 't1')
    useAssetLibraryStore.setState({
      assetsById: { a: asset },
      assetOrder: ['a'],
      tags: [makeTag('t1', '品牌'), makeTag('t2', '风格'), child],
    })
    const remapped = { ...asset, tagIds: ['t2'] }
    mock.patchAssetsIndividually.mockResolvedValue([remapped])
    await useAssetLibraryStore.getState().mergeTags('t1', 't2')
    const state = useAssetLibraryStore.getState()
    expect(state.assetsById.a.tagIds).toEqual(['t2'])
    expect(state.tags.map((tag) => tag.id).sort()).toEqual(['t2', 't3'])
    expect(state.tags.find((tag) => tag.id === 't3')?.parentId).toBe('t2')
    expect(mock.deleteTagRecord).toHaveBeenCalledWith('t1')
  })

  it('toggles a tag in the multi-select AND filter', () => {
    useAssetLibraryStore.getState().toggleTagFilter('t1')
    expect(useAssetLibraryStore.getState().filters.tagIds).toEqual(['t1'])
    useAssetLibraryStore.getState().toggleTagFilter('t2')
    expect(useAssetLibraryStore.getState().filters.tagIds).toEqual(['t1', 't2'])
    useAssetLibraryStore.getState().toggleTagFilter('t1')
    expect(useAssetLibraryStore.getState().filters.tagIds).toEqual(['t2'])
    useAssetLibraryStore.getState().clearTagFilters()
    expect(useAssetLibraryStore.getState().filters.tagIds).toBeUndefined()
  })

  it('keeps tagIds out of persisted UI prefs except via filters snapshot', () => {
    useAssetLibraryStore.setState({ filters: { tagIds: ['t1'] }, tags: [makeTag('t1', '品牌')] })
    const persisted = partializeAssetLibraryStore(useAssetLibraryStore.getState())
    expect(persisted.filters.tagIds).toEqual(['t1'])
    expect((persisted as Record<string, unknown>).tags).toBeUndefined()
  })
})

describe('moveCollectionsToPosition (Eagle 式拖拽排序与嵌套)', () => {
  function makeCollection(id: string, parentId: string | null, order: number) {
    return { id, name: id, normalizedName: id, parentId, order, createdAt: 1, updatedAt: 1 }
  }

  it('nests a folder as the last child of a target (into)', async () => {
    useAssetLibraryStore.setState({
      collections: [makeCollection('a', null, 0), makeCollection('b', null, 1), makeCollection('c', 'a', 0)],
    })
    await useAssetLibraryStore.getState().moveCollectionsToPosition(['b'], { kind: 'into', parentId: 'a' })
    const state = useAssetLibraryStore.getState()
    expect(state.collections.find((c) => c.id === 'b')?.parentId).toBe('a')
    expect(state.collections.find((c) => c.id === 'b')?.order).toBe(1)
    expect(mock.putCollections).toHaveBeenCalled()
  })

  it('reorders siblings with before/after references', async () => {
    useAssetLibraryStore.setState({
      collections: [makeCollection('a', null, 0), makeCollection('b', null, 1), makeCollection('c', null, 2)],
    })
    // 把 a 拖到 c 之前（before）
    await useAssetLibraryStore.getState().moveCollectionsToPosition(['a'], { kind: 'before', siblingId: 'c' })
    let order = useAssetLibraryStore
      .getState()
      .collections.filter((c) => c.parentId === null)
      .sort((x, y) => x.order - y.order)
      .map((c) => c.id)
    expect(order).toEqual(['b', 'a', 'c'])
    // 把 c 拖到 a 之后（after）
    await useAssetLibraryStore.getState().moveCollectionsToPosition(['c'], { kind: 'after', siblingId: 'a' })
    order = useAssetLibraryStore
      .getState()
      .collections.filter((c) => c.parentId === null)
      .sort((x, y) => x.order - y.order)
      .map((c) => c.id)
    expect(order).toEqual(['b', 'a', 'c'])
  })

  it('moves a folder to root with append', async () => {
    useAssetLibraryStore.setState({
      collections: [makeCollection('a', null, 0), makeCollection('b', 'a', 0)],
    })
    await useAssetLibraryStore.getState().moveCollectionsToPosition(['b'], { kind: 'append', parentId: null })
    const state = useAssetLibraryStore.getState()
    expect(state.collections.find((c) => c.id === 'b')?.parentId).toBeNull()
  })

  it('moves multiple selected folders together preserving their relative order', async () => {
    useAssetLibraryStore.setState({
      collections: [
        makeCollection('x', null, 0),
        makeCollection('y', null, 1),
        makeCollection('target', null, 2),
        makeCollection('p', 'x', 0),
        makeCollection('q', 'x', 1),
      ],
    })
    await useAssetLibraryStore.getState().moveCollectionsToPosition(['p', 'q'], { kind: 'into', parentId: 'target' })
    const state = useAssetLibraryStore.getState()
    const moved = state.collections
      .filter((c) => c.parentId === 'target')
      .sort((a, b) => a.order - b.order)
      .map((c) => c.id)
    expect(moved).toEqual(['p', 'q'])
  })

  it('rejects moving a folder into its own descendant (cycle guard)', async () => {
    useAssetLibraryStore.setState({
      collections: [makeCollection('a', null, 0), makeCollection('b', 'a', 0), makeCollection('c', 'b', 0)],
    })
    await useAssetLibraryStore.getState().moveCollectionsToPosition(['a'], { kind: 'into', parentId: 'c' })
    expect(useAssetLibraryStore.getState().collections.find((c) => c.id === 'a')?.parentId).toBeNull()
    expect(mock.putCollections).not.toHaveBeenCalled()
  })

  it('ignores a before/after reference that is itself being dragged', async () => {
    useAssetLibraryStore.setState({
      collections: [makeCollection('a', null, 0), makeCollection('b', null, 1)],
    })
    await useAssetLibraryStore.getState().moveCollectionsToPosition(['a'], { kind: 'before', siblingId: 'a' })
    expect(mock.putCollections).not.toHaveBeenCalled()
  })

  it('keeps the files of a folder attached when the folder is dragged to a new parent', async () => {
    const assetInFolder = makeAsset('file-a', { collectionIds: ['b'] })
    const assetInChild = makeAsset('file-c', { collectionIds: ['c'] })
    useAssetLibraryStore.setState({
      collections: [makeCollection('a', null, 0), makeCollection('b', null, 1), makeCollection('c', 'b', 0)],
      assetsById: { 'file-a': assetInFolder, 'file-c': assetInChild },
      assetOrder: ['file-a', 'file-c'],
    })
    // 把文件夹 b（含素材 file-a 与子文件夹 c 及其素材 file-c）拖入文件夹 a
    await useAssetLibraryStore.getState().moveCollectionsToPosition(['b'], { kind: 'into', parentId: 'a' })
    const state = useAssetLibraryStore.getState()
    expect(state.collections.find((c) => c.id === 'b')?.parentId).toBe('a')
    // 素材仍属于原文件夹（id 未变 = 文件跟随文件夹一起移动）
    expect(state.assetsById['file-a'].collectionIds).toEqual(['b'])
    expect(state.assetsById['file-c'].collectionIds).toEqual(['c'])
  })
})

describe('undo / redo (Eagle 式 Ctrl+Z / Ctrl+Shift+Z)', () => {
  function makeCollection(id: string, parentId: string | null, order: number) {
    return { id, name: id, normalizedName: id, parentId, order, createdAt: 1, updatedAt: 1 }
  }

  it('undoes and redoes an asset patch (rating)', async () => {
    const asset = makeAsset('a', { rating: 1 })
    useAssetLibraryStore.setState({ assetsById: { a: asset }, assetOrder: ['a'] })
    mock.patchAssets.mockResolvedValue([{ ...asset, rating: 5 }])
    await useAssetLibraryStore.getState().patchAssets(['a'], { rating: 5 })
    expect(useAssetLibraryStore.getState().assetsById.a.rating).toBe(5)
    expect(await useAssetLibraryStore.getState().undo()).toBe(true)
    expect(useAssetLibraryStore.getState().assetsById.a.rating).toBe(1)
    expect(await useAssetLibraryStore.getState().redo()).toBe(true)
    expect(useAssetLibraryStore.getState().assetsById.a.rating).toBe(5)
  })

  it('undoes move-to-trash and restores the asset', async () => {
    const asset = makeAsset('a', { status: 'active' })
    useAssetLibraryStore.setState({ assetsById: { a: asset }, assetOrder: ['a'] })
    mock.moveToTrash.mockResolvedValue([{ ...asset, status: 'trashed', trashedAt: 2000 }])
    await useAssetLibraryStore.getState().moveToTrash(['a'])
    expect(useAssetLibraryStore.getState().assetsById.a.status).toBe('trashed')
    await useAssetLibraryStore.getState().undo()
    expect(useAssetLibraryStore.getState().assetsById.a.status).toBe('active')
    await useAssetLibraryStore.getState().redo()
    expect(useAssetLibraryStore.getState().assetsById.a.status).toBe('trashed')
  })

  it('undoes folder creation and redo recreates it', async () => {
    useAssetLibraryStore.setState({ collections: [] })
    const created = await useAssetLibraryStore.getState().createCollection('新项目')
    expect(useAssetLibraryStore.getState().collections).toHaveLength(1)
    await useAssetLibraryStore.getState().undo()
    expect(useAssetLibraryStore.getState().collections).toHaveLength(0)
    await useAssetLibraryStore.getState().redo()
    expect(useAssetLibraryStore.getState().collections.map((c) => c.id)).toEqual([created!.id])
  })

  it('clears the redo stack when a new operation happens', async () => {
    const asset = makeAsset('a', { rating: 1 })
    useAssetLibraryStore.setState({ assetsById: { a: asset }, assetOrder: ['a'] })
    mock.patchAssets.mockResolvedValue([{ ...asset, rating: 5 }])
    await useAssetLibraryStore.getState().patchAssets(['a'], { rating: 5 })
    await useAssetLibraryStore.getState().undo()
    expect(useAssetLibraryStore.getState().redoStack).toHaveLength(1)
    mock.patchAssets.mockResolvedValue([{ ...asset, rating: 3 }])
    await useAssetLibraryStore.getState().patchAssets(['a'], { rating: 3 })
    expect(useAssetLibraryStore.getState().redoStack).toHaveLength(0)
  })
})

describe('asset clipboard (Eagle 式 Ctrl+C/V/X)', () => {
  function makeCollection(id: string, parentId: string | null = null, order = 0) {
    return { id, name: id, normalizedName: id, parentId, order, createdAt: 1, updatedAt: 1 }
  }

  it('copies selected assets and pastes them into a folder (adds membership)', async () => {
    const asset = makeAsset('a', { collectionIds: [] })
    useAssetLibraryStore.setState({
      assetsById: { a: asset },
      assetOrder: ['a'],
      collections: [makeCollection('c1')],
      selectedAssetIds: ['a'],
    })
    useAssetLibraryStore.getState().copyAssets(['a'])
    expect(useAssetLibraryStore.getState().clipboard).toMatchObject({ kind: 'copy', type: 'asset', assetIds: ['a'] })
    const count = await useAssetLibraryStore.getState().pasteAssetsIntoCollection('c1')
    expect(count).toBe(1)
    expect(useAssetLibraryStore.getState().assetsById.a.collectionIds).toEqual(['c1'])
    expect(useAssetLibraryStore.getState().clipboard).toBeNull()
  })

  it('cuts assets and pastes into a folder (moves, replacing membership)', async () => {
    const asset = makeAsset('a', { collectionIds: ['c1', 'c2'] })
    useAssetLibraryStore.setState({
      assetsById: { a: asset },
      assetOrder: ['a'],
      collections: [makeCollection('c1'), makeCollection('c2'), makeCollection('c3')],
    })
    useAssetLibraryStore.getState().cutAssets(['a'])
    await useAssetLibraryStore.getState().pasteAssetsIntoCollection('c3')
    expect(useAssetLibraryStore.getState().assetsById.a.collectionIds).toEqual(['c3'])
  })

  it('pasting with no folder scope adds membership for copy and unorganizes for cut', async () => {
    const asset = makeAsset('a', { collectionIds: ['c1'] })
    useAssetLibraryStore.setState({ assetsById: { a: asset }, assetOrder: ['a'], collections: [makeCollection('c1')] })
    useAssetLibraryStore.getState().copyAssets(['a'])
    await useAssetLibraryStore.getState().pasteAssetsIntoCollection(null)
    expect(useAssetLibraryStore.getState().assetsById.a.collectionIds).toEqual(['c1'])
    useAssetLibraryStore.getState().cutAssets(['a'])
    await useAssetLibraryStore.getState().pasteAssetsIntoCollection(null)
    expect(useAssetLibraryStore.getState().assetsById.a.collectionIds).toEqual([])
  })
})
