import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetCollection, GeneratedAsset } from '../../types'
import AssetLibrarySidebar, {
  COLLECTION_DRAG_TYPE,
  buildCollectionTree,
  flattenCollectionRows,
} from './AssetLibrarySidebar'
import { useAssetLibraryStore } from './store'

const mainStoreMock = vi.hoisted(() => {
  const showToast = vi.fn()
  const setConfirmDialog = vi.fn()
  return {
    useStore: { getState: vi.fn(() => ({ showToast, setConfirmDialog })) },
    showToast,
    setConfirmDialog,
  }
})

vi.mock('../../store', () => mainStoreMock)

/** 取第一个项目树行的 drop 处理器（排除树容器的根级 onDrop，它先于行渲染）。 */
function findRowDropHandler(renderer: ReactTestRenderer) {
  const row = renderer.root.findAll((node) => node.props.role === 'treeitem')[0]!
  const dropEl = row.findAll((node) => typeof node.props.onDrop === 'function')[0]!
  return dropEl
}

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

const counts = {
  all: 2,
  recent: 2,
  favorites: 0,
  unorganized: 0,
  trash: 0,
  byCollection: new Map([
    ['parent', 1],
    ['child', 1],
  ]),
  byTag: new Map<string, number>(),
}

const mountedRenderers: Array<ReturnType<typeof create>> = []

afterEach(() => {
  while (mountedRenderers.length) mountedRenderers.pop()?.unmount()
  useAssetLibraryStore.setState({ collections: [], folderEditRequest: null, selectedFolderIds: [] })
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.stubGlobal('document', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
})

describe('folder keyboard shortcuts', () => {
  function renderSidebar() {
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(
        <AssetLibrarySidebar counts={counts} scope="all" onSelectSystemScope={vi.fn()} onSelectCollection={vi.fn()} />,
      )
    })
    mountedRenderers.push(renderer)
    return renderer
  }

  it('deletes the focused folder with the Delete key', () => {
    const deleteFolders = vi.fn(async () => {})
    useAssetLibraryStore.setState({ collections: [parent, child], deleteFolders })
    const renderer = renderSidebar()
    const row = renderer.root.findAll((node) => node.props.role === 'treeitem')[0]!
    act(() => {
      row.props.onKeyDown({
        key: 'Delete',
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        target: row,
        currentTarget: row,
      })
    })
    expect(deleteFolders).toHaveBeenCalledWith(['parent'])
  })

  it('deletes the whole multi-selection when the focused row is part of it', () => {
    const deleteFolders = vi.fn(async () => {})
    useAssetLibraryStore.setState({
      collections: [parent, child],
      deleteFolders,
      selectedFolderIds: ['parent', 'child'],
    })
    const renderer = renderSidebar()
    const row = renderer.root.findAll((node) => node.props.role === 'treeitem')[0]!
    act(() => {
      row.props.onKeyDown({
        key: 'Backspace',
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        target: row,
        currentTarget: row,
      })
    })
    expect(deleteFolders).toHaveBeenCalledWith(['parent', 'child'])
  })

  it('enters inline rename when a global F2 rename request targets the folder', () => {
    useAssetLibraryStore.setState({ collections: [parent, child] })
    const renderer = renderSidebar()
    act(() => {
      useAssetLibraryStore.getState().setFolderEditRequest({ kind: 'rename', collectionId: 'parent' })
    })
    expect(renderer.root.findAll((node) => node.props['aria-label'] === '重命名品牌素材')).toHaveLength(1)
    // 请求被行内消费后清空
    expect(useAssetLibraryStore.getState().folderEditRequest).toBeNull()
  })

  it('shows the create row under the target folder when a global Ctrl+N request arrives', () => {
    useAssetLibraryStore.setState({ collections: [parent, child] })
    const renderer = renderSidebar()
    act(() => {
      useAssetLibraryStore.getState().setFolderEditRequest({ kind: 'create', parentId: 'parent' })
    })
    expect(renderer.root.findAll((node) => node.props['aria-label'] === '子项目名称')).toHaveLength(1)
    expect(useAssetLibraryStore.getState().folderEditRequest).toBeNull()
  })

  it('shows a root-level create row for a Ctrl+N request without a parent', () => {
    useAssetLibraryStore.setState({ collections: [parent, child] })
    const renderer = renderSidebar()
    act(() => {
      useAssetLibraryStore.getState().setFolderEditRequest({ kind: 'create', parentId: null })
    })
    expect(renderer.root.findAll((node) => node.props['aria-label'] === '项目名称')).toHaveLength(1)
  })
})

describe('buildCollectionTree', () => {
  it('builds nested children and keeps invalid branches at the root', () => {
    const orphan = { ...child, id: 'orphan', parentId: 'missing' }
    const tree = buildCollectionTree([child, orphan, parent])

    expect(new Set(tree.map((node) => node.collection.id))).toEqual(new Set(['parent', 'orphan']))
    expect(tree.find((node) => node.collection.id === 'parent')?.children.map((node) => node.collection.id)).toEqual([
      'child',
    ])
  })
})

describe('flattenCollectionRows', () => {
  it('flattens visible nodes respecting collapsed state', () => {
    const tree = buildCollectionTree([parent, child])
    const rows = flattenCollectionRows(tree, new Set(), undefined, false)
    expect(rows.map((row) => (row.kind === 'node' ? row.node?.collection.id : `create:${row.parentId}`))).toEqual([
      'parent',
      'child',
    ])
    expect(rows[0]).toMatchObject({ kind: 'node', depth: 1 })
    expect(rows[1]).toMatchObject({ kind: 'node', depth: 2 })

    const collapsed = flattenCollectionRows(tree, new Set(['parent']), undefined, false)
    expect(collapsed.map((row) => (row.kind === 'node' ? row.node?.collection.id : 'create'))).toEqual(['parent'])
  })

  it('inserts the root create row and the child create row at the right positions', () => {
    const tree = buildCollectionTree([parent, child])

    const rootCreate = flattenCollectionRows(tree, new Set(), null, false)
    expect(rootCreate[0]).toMatchObject({ kind: 'create', parentId: null, label: '项目名称', depth: 1 })
    expect(rootCreate).toHaveLength(3)

    // 子级新建行深度 = 父节点深度 + 1，渲染时据此缩进体现层级
    const childCreate = flattenCollectionRows(tree, new Set(), 'parent', false)
    expect(childCreate[1]).toMatchObject({ kind: 'create', parentId: 'parent', label: '子项目名称', depth: 2 })
    expect(childCreate).toHaveLength(3)
  })

  it('forces all nodes expanded when filtering', () => {
    const tree = buildCollectionTree([parent, child])
    const rows = flattenCollectionRows(tree, new Set(['parent']), undefined, true)
    // parent 虽在折叠集合中，筛选模式仍强制全展开
    expect(rows.map((row) => (row.kind === 'node' ? row.node?.collection.id : 'create'))).toEqual(['parent', 'child'])
  })

  it('computes Eagle-style guide line masks for nested rows', () => {
    const sibling: AssetCollection = { ...parent, id: 'sibling', name: '素材库', normalizedName: '素材库', order: 1 }
    const tree = buildCollectionTree([parent, child, sibling])

    const rows = flattenCollectionRows(tree, new Set(), undefined, false)
    const nodeRows = rows.filter((row) => row.kind === 'node')

    // 顶层根：无祖先列；parent 有后续兄弟，sibling 没有
    expect(nodeRows[0]).toMatchObject({ node: { collection: { id: 'parent' } }, depth: 1, guideAncestorLines: [] })
    expect(nodeRows[0].guideOwnFollowing).toBe(true)
    // 子级：祖先列（parent 列）因 parent 有后续兄弟而贯通，自身列无后续兄弟
    expect(nodeRows[1]).toMatchObject({ node: { collection: { id: 'child' } }, depth: 2 })
    expect(nodeRows[1].guideAncestorLines).toEqual([true])
    expect(nodeRows[1].guideOwnFollowing).toBe(false)
    // 最后一个根：自身列无后续兄弟
    expect(nodeRows[2]).toMatchObject({ node: { collection: { id: 'sibling' } }, depth: 1 })
    expect(nodeRows[2].guideAncestorLines).toEqual([])
    expect(nodeRows[2].guideOwnFollowing).toBe(false)
  })

  it('carries the parent following-sibling state into a child create row', () => {
    const sibling: AssetCollection = { ...parent, id: 'sibling', name: '素材库', normalizedName: '素材库', order: 1 }
    const tree = buildCollectionTree([parent, child, sibling])
    const rows = flattenCollectionRows(tree, new Set(), 'parent', false)

    const createRow = rows.find((row) => row.kind === 'create' && row.parentId === 'parent')!
    expect(createRow).toMatchObject({ depth: 2, guideOwnFollowing: false })
    // parent 有后续兄弟（sibling），其所在列在子级新建行上贯通
    expect(createRow.guideAncestorLines).toEqual([true])
  })
})

describe('AssetLibrarySidebar', () => {
  it('renders an accessible expandable project tree', async () => {
    useAssetLibraryStore.setState({ collections: [parent, child] })
    let renderer: ReactTestRenderer
    const onSelectCollection = vi.fn()

    await act(async () => {
      renderer = create(
        <AssetLibrarySidebar
          counts={counts}
          scope="collection:child"
          onSelectSystemScope={vi.fn()}
          onSelectCollection={onSelectCollection}
        />,
      )
    })

    const treeItems = renderer!.root.findAll((node) => node.props.role === 'treeitem')
    expect(treeItems).toHaveLength(2)
    expect(treeItems[0].props['aria-level']).toBe(1)
    expect(treeItems[0].props['aria-expanded']).toBe(true)
    expect(treeItems[1].props['aria-level']).toBe(2)
    expect(treeItems[1].props['aria-selected']).toBe(true)
    expect(renderer!.root.findByType('aside').props.className).toContain('overflow-hidden')
    expect(renderer!.root.findByType('nav').props.className).toContain('overflow-x-hidden')

    treeItems[0].props.onClick({ target: { closest: () => ({}) } })
    expect(onSelectCollection).not.toHaveBeenCalled()
    treeItems[0].props.onClick({ target: { closest: () => null } })
    expect(onSelectCollection).toHaveBeenCalledWith('parent')

    const moreButton = renderer!.root.findByProps({ 'aria-label': '品牌素材更多操作' })
    await act(async () => moreButton.props.onClick({ stopPropagation: vi.fn() }))
    expect(renderer!.root.findByProps({ role: 'menu' }).props['aria-label']).toBe('品牌素材操作')
    await act(async () => moreButton.props.onClick({ stopPropagation: vi.fn() }))

    const collapseButton = renderer!.root.findByProps({ 'aria-label': '收起品牌素材' })
    await act(async () => collapseButton.props.onClick({ stopPropagation: vi.fn() }))

    expect(renderer!.root.findAll((node) => node.props.role === 'treeitem')).toHaveLength(1)
    expect(renderer!.root.findByProps({ 'aria-label': '展开品牌素材' })).toBeTruthy()

    await act(async () => renderer!.unmount())
  })

  it('opens the same actions menu from a right-click on a tree node', async () => {
    useAssetLibraryStore.setState({ collections: [parent] })
    let renderer: ReactTestRenderer

    await act(async () => {
      renderer = create(
        <AssetLibrarySidebar counts={counts} scope="all" onSelectSystemScope={vi.fn()} onSelectCollection={vi.fn()} />,
      )
    })

    const treeItem = renderer!.root.findAll((node) => node.props.role === 'treeitem')[0]!
    await act(async () =>
      treeItem.props.onContextMenu({
        preventDefault: vi.fn(),
        clientX: 120,
        clientY: 80,
        target: { closest: () => null },
      }),
    )

    const menu = renderer!.root.findByProps({ role: 'menu' })
    expect(menu.props['aria-label']).toBe('品牌素材操作')
    const labels = renderer!.root
      .findAll((node) => typeof node.props.children === 'string')
      .map((node) => node.props.children as string)
    expect(labels).toContain('新建子项')
    expect(labels).toContain('重命名')
    expect(labels).toContain('删除')

    await act(async () => renderer!.unmount())
  })

  it('filters the project tree by query and shows a no-match hint', async () => {
    useAssetLibraryStore.setState({ collections: [parent, child] })
    let renderer: ReactTestRenderer

    await act(async () => {
      renderer = create(
        <AssetLibrarySidebar counts={counts} scope="all" onSelectSystemScope={vi.fn()} onSelectCollection={vi.fn()} />,
      )
    })

    const filterInput = renderer!.root.findByProps({ 'aria-label': '筛选侧栏条目' })
    await act(async () => filterInput.props.onChange({ target: { value: '海报' } }))
    const treeItems = renderer!.root.findAll((node) => node.props.role === 'treeitem')
    expect(treeItems.map((item) => item.props['aria-selected'])).toEqual([false, false])

    await act(async () => filterInput.props.onChange({ target: { value: 'zzz' } }))
    expect(renderer!.root.findAll((node) => node.props.role === 'treeitem')).toHaveLength(0)
    const texts = renderer!.root
      .findAll((node) => typeof node.props.children === 'string')
      .map((node) => node.props.children as string)
    expect(texts).toContain('无匹配的项目')

    await act(async () => renderer!.unmount())
  })

  it('accepts a dropped asset-image payload onto a collection node', async () => {
    const applyBatch = vi.fn().mockResolvedValue(1)
    useAssetLibraryStore.setState({
      collections: [parent],
      assetsById: {
        'img-1': {
          id: 'img-1',
          imageId: 'img-1',
          status: 'active',
          createdAt: 1,
          updatedAt: 1,
          trashedAt: null,
          favorite: false,
          rating: 0,
          collectionIds: [],
          tagIds: [],
          origins: [],
          primaryOriginKey: null,
          parentAssetIds: [],
          metadataVersion: 1,
        },
      },
      assetOrder: ['img-1'],
      applyBatchCollectionChanges: applyBatch,
    })
    let renderer: ReactTestRenderer

    await act(async () => {
      renderer = create(
        <AssetLibrarySidebar counts={counts} scope="all" onSelectSystemScope={vi.fn()} onSelectCollection={vi.fn()} />,
      )
    })

    const row = findRowDropHandler(renderer!)
    await act(async () => {
      row.props.onDrop({
        dataTransfer: {
          getData: (type: string) => (type === 'application/x-doupao-asset-source' ? '' : 'asset-image:img-1'),
        },
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      })
      // flush applyAssetToCollection 的异步链（patchAssets → toast）
      await Promise.resolve()
      await Promise.resolve()
    })

    // Eagle 式批量：一次原子调用（updates + label），不再逐张 patch
    expect(applyBatch).toHaveBeenCalledWith(
      [{ id: 'img-1', collectionIds: ['parent'] }],
      expect.stringContaining('品牌素材'),
    )
    expect(mainStoreMock.useStore.getState().showToast).toHaveBeenCalledWith('已加入项目「品牌素材」', 'success')

    await act(async () => renderer!.unmount())
  })

  it('archives every selected asset when dropping a multi-selection drag payload onto a collection node', async () => {
    const applyBatch = vi.fn().mockResolvedValue(2)
    const makeAsset = (id: string): GeneratedAsset => ({
      id,
      imageId: id,
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
      trashedAt: null,
      favorite: false,
      rating: 0,
      collectionIds: [] as string[],
      tagIds: [] as string[],
      origins: [],
      primaryOriginKey: null,
      parentAssetIds: [],
      metadataVersion: 1,
    })
    useAssetLibraryStore.setState({
      collections: [parent],
      assetsById: { 'img-1': makeAsset('img-1'), 'img-2': makeAsset('img-2') },
      assetOrder: ['img-1', 'img-2'],
      applyBatchCollectionChanges: applyBatch,
    })
    let renderer: ReactTestRenderer

    await act(async () => {
      renderer = create(
        <AssetLibrarySidebar counts={counts} scope="all" onSelectSystemScope={vi.fn()} onSelectCollection={vi.fn()} />,
      )
    })

    const row = findRowDropHandler(renderer!)
    await act(async () => {
      row.props.onDrop({
        dataTransfer: {
          getData: (type: string) => {
            if (type === 'application/x-doupao-asset-source') return ''
            return type === 'application/x-doupao-asset-ids' ? JSON.stringify(['img-1', 'img-2']) : 'asset-image:img-1'
          },
        },
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(applyBatch).toHaveBeenCalledWith(
      [
        { id: 'img-1', collectionIds: ['parent'] },
        { id: 'img-2', collectionIds: ['parent'] },
      ],
      expect.stringContaining('品牌素材'),
    )
    expect(mainStoreMock.useStore.getState().showToast).toHaveBeenCalledWith(
      '已加入项目「品牌素材」（2 张）',
      'success',
    )

    await act(async () => renderer!.unmount())
  })

  it('moves (cuts) assets out of the source folder when dragging from a folder scope', async () => {
    const applyBatch = vi.fn().mockResolvedValue(1)
    useAssetLibraryStore.setState({
      collections: [parent],
      assetsById: {
        'img-1': {
          id: 'img-1',
          imageId: 'img-1',
          status: 'active',
          createdAt: 1,
          updatedAt: 1,
          trashedAt: null,
          favorite: false,
          rating: 0,
          collectionIds: ['source-folder', 'shared-folder'],
          tagIds: [],
          origins: [],
          primaryOriginKey: null,
          parentAssetIds: [],
          metadataVersion: 1,
        },
      },
      assetOrder: ['img-1'],
      applyBatchCollectionChanges: applyBatch,
    })
    let renderer: ReactTestRenderer

    await act(async () => {
      renderer = create(
        <AssetLibrarySidebar counts={counts} scope="all" onSelectSystemScope={vi.fn()} onSelectCollection={vi.fn()} />,
      )
    })

    const row = findRowDropHandler(renderer!)
    await act(async () => {
      row.props.onDrop({
        dataTransfer: {
          getData: (type: string) =>
            type === 'application/x-doupao-asset-source' ? 'source-folder' : 'asset-image:img-1',
        },
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    // 移动语义：移除源文件夹归属，保留其他归类，加入目标文件夹
    expect(applyBatch).toHaveBeenCalledWith(
      [{ id: 'img-1', collectionIds: ['shared-folder', 'parent'] }],
      expect.stringContaining('品牌素材'),
    )
    expect(mainStoreMock.useStore.getState().showToast).toHaveBeenCalledWith('已移动至项目「品牌素材」', 'success')

    await act(async () => renderer!.unmount())
  })

  it('asks the user how to handle assets that already exist in the target folder', async () => {
    const patchAssets = vi.fn().mockResolvedValue(undefined)
    useAssetLibraryStore.setState({
      collections: [parent],
      assetsById: {
        existing: {
          id: 'existing',
          imageId: 'same-image',
          status: 'active',
          createdAt: 1,
          updatedAt: 1,
          trashedAt: null,
          favorite: false,
          rating: 0,
          collectionIds: ['parent'],
          tagIds: [],
          origins: [],
          primaryOriginKey: null,
          parentAssetIds: [],
          metadataVersion: 1,
        },
        'img-1': {
          id: 'img-1',
          imageId: 'same-image',
          status: 'active',
          createdAt: 1,
          updatedAt: 1,
          trashedAt: null,
          favorite: false,
          rating: 0,
          collectionIds: ['source-folder'],
          tagIds: [],
          origins: [],
          primaryOriginKey: null,
          parentAssetIds: [],
          metadataVersion: 1,
        },
      },
      assetOrder: ['existing', 'img-1'],
      patchAssets,
    })
    mainStoreMock.setConfirmDialog.mockClear()
    let renderer: ReactTestRenderer

    await act(async () => {
      renderer = create(
        <AssetLibrarySidebar counts={counts} scope="all" onSelectSystemScope={vi.fn()} onSelectCollection={vi.fn()} />,
      )
    })

    const row = findRowDropHandler(renderer!)
    await act(async () => {
      row.props.onDrop({
        dataTransfer: {
          getData: (type: string) =>
            type === 'application/x-doupao-asset-source' ? 'source-folder' : 'asset-image:img-1',
        },
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mainStoreMock.setConfirmDialog).toHaveBeenCalledTimes(1)
    const dialog = mainStoreMock.setConfirmDialog.mock.calls[0]![0] as {
      title: string
      buttons: Array<{ label: string; action: () => void }>
    }
    expect(dialog.title).toContain('相同素材')
    expect(dialog.buttons.map((button) => button.label)).toEqual(['仍然添加', '跳过重复', '替换'])
    expect(patchAssets).not.toHaveBeenCalled()

    await act(async () => renderer!.unmount())
  })

  it('skips duplicate assets when the user picks 跳过重复', async () => {
    const applyBatch = vi.fn().mockResolvedValue(1)
    useAssetLibraryStore.setState({
      collections: [parent],
      assetsById: {
        existing: {
          id: 'existing',
          imageId: 'same-image',
          status: 'active',
          createdAt: 1,
          updatedAt: 1,
          trashedAt: null,
          favorite: false,
          rating: 0,
          collectionIds: ['parent'],
          tagIds: [],
          origins: [],
          primaryOriginKey: null,
          parentAssetIds: [],
          metadataVersion: 1,
        },
        'img-dup': {
          id: 'img-dup',
          imageId: 'same-image',
          status: 'active',
          createdAt: 1,
          updatedAt: 1,
          trashedAt: null,
          favorite: false,
          rating: 0,
          collectionIds: ['source-folder'],
          tagIds: [],
          origins: [],
          primaryOriginKey: null,
          parentAssetIds: [],
          metadataVersion: 1,
        },
        'img-new': {
          id: 'img-new',
          imageId: 'brand-new-image',
          status: 'active',
          createdAt: 1,
          updatedAt: 1,
          trashedAt: null,
          favorite: false,
          rating: 0,
          collectionIds: ['source-folder'],
          tagIds: [],
          origins: [],
          primaryOriginKey: null,
          parentAssetIds: [],
          metadataVersion: 1,
        },
      },
      assetOrder: ['existing', 'img-dup', 'img-new'],
      applyBatchCollectionChanges: applyBatch,
    })
    mainStoreMock.setConfirmDialog.mockClear()
    let renderer: ReactTestRenderer

    await act(async () => {
      renderer = create(
        <AssetLibrarySidebar counts={counts} scope="all" onSelectSystemScope={vi.fn()} onSelectCollection={vi.fn()} />,
      )
    })

    const row = findRowDropHandler(renderer!)
    await act(async () => {
      row.props.onDrop({
        dataTransfer: {
          getData: (type: string) =>
            type === 'application/x-doupao-asset-source'
              ? 'source-folder'
              : type === 'application/x-doupao-asset-ids'
                ? JSON.stringify(['img-dup', 'img-new'])
                : 'asset-image:img-dup',
        },
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    const dialog = mainStoreMock.setConfirmDialog.mock.calls[0]![0] as {
      buttons: Array<{ label: string; action: () => void }>
    }
    const skipButton = dialog.buttons.find((button) => button.label === '跳过重复')!
    await act(async () => {
      skipButton.action()
      await Promise.resolve()
      await Promise.resolve()
    })

    // 只处理不重复的 img-new（从 source-folder 移出后加入目标）；重复的 img-dup 被跳过
    expect(applyBatch).toHaveBeenCalledTimes(1)
    expect(applyBatch).toHaveBeenCalledWith(
      [{ id: 'img-new', collectionIds: ['parent'] }],
      expect.stringContaining('品牌素材'),
    )
    expect(mainStoreMock.useStore.getState().showToast).toHaveBeenCalledWith('已移动至项目「品牌素材」', 'success')

    await act(async () => renderer!.unmount())
  })

  it('replaces the existing asset in the target folder when the user picks 替换', async () => {
    const applyBatch = vi.fn().mockResolvedValue(2)
    useAssetLibraryStore.setState({
      collections: [parent],
      assetsById: {
        existing: {
          id: 'existing',
          imageId: 'same-image',
          status: 'active',
          createdAt: 1,
          updatedAt: 1,
          trashedAt: null,
          favorite: false,
          rating: 0,
          collectionIds: ['parent'],
          tagIds: [],
          origins: [],
          primaryOriginKey: null,
          parentAssetIds: [],
          metadataVersion: 1,
        },
        'img-1': {
          id: 'img-1',
          imageId: 'same-image',
          status: 'active',
          createdAt: 1,
          updatedAt: 1,
          trashedAt: null,
          favorite: false,
          rating: 0,
          collectionIds: ['source-folder'],
          tagIds: [],
          origins: [],
          primaryOriginKey: null,
          parentAssetIds: [],
          metadataVersion: 1,
        },
      },
      assetOrder: ['existing', 'img-1'],
      applyBatchCollectionChanges: applyBatch,
    })
    mainStoreMock.setConfirmDialog.mockClear()
    let renderer: ReactTestRenderer

    await act(async () => {
      renderer = create(
        <AssetLibrarySidebar counts={counts} scope="all" onSelectSystemScope={vi.fn()} onSelectCollection={vi.fn()} />,
      )
    })

    const row = findRowDropHandler(renderer!)
    await act(async () => {
      row.props.onDrop({
        dataTransfer: {
          getData: (type: string) =>
            type === 'application/x-doupao-asset-source' ? 'source-folder' : 'asset-image:img-1',
        },
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    const dialog = mainStoreMock.setConfirmDialog.mock.calls[0]![0] as {
      buttons: Array<{ label: string; action: () => void }>
    }
    const replaceButton = dialog.buttons.find((button) => button.label === '替换')!
    await act(async () => {
      replaceButton.action()
      await Promise.resolve()
      await Promise.resolve()
    })

    // 替换：旧素材 existing 移出目标文件夹（保留无其他归属时的素材本身），新素材 img-1 移入，一次原子提交
    expect(applyBatch).toHaveBeenCalledWith(
      [
        { id: 'existing', collectionIds: [] },
        { id: 'img-1', collectionIds: ['parent'] },
      ],
      expect.stringContaining('品牌素材'),
    )
    expect(mainStoreMock.useStore.getState().showToast).toHaveBeenCalledWith(
      '已替换项目「品牌素材」中的重复素材',
      'success',
    )

    await act(async () => renderer!.unmount())
  })

  it('multi-selects folders with Ctrl+click and Shift+click range', async () => {
    useAssetLibraryStore.setState({ collections: [parent, child], selectedFolderIds: [] })
    let renderer: ReactTestRenderer

    await act(async () => {
      renderer = create(
        <AssetLibrarySidebar counts={counts} scope="all" onSelectSystemScope={vi.fn()} onSelectCollection={vi.fn()} />,
      )
    })

    const treeItems = renderer!.root.findAll((node) => node.props.role === 'treeitem')
    expect(treeItems.length).toBeGreaterThanOrEqual(2)
    const clickArgs = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      target: { closest: () => null },
    }

    // Ctrl+点击「品牌素材」→ 选中它并作为范围锚点
    await act(async () => {
      treeItems[0]!.props.onClick({ ...clickArgs, ctrlKey: true })
    })
    // Shift+点击「活动海报」→ 从锚点连续选中到它
    await act(async () => {
      treeItems[1]!.props.onClick({ ...clickArgs, shiftKey: true })
    })

    expect(useAssetLibraryStore.getState().selectedFolderIds.sort()).toEqual(['child', 'parent'])

    await act(async () => renderer!.unmount())
  })

  it('toggles folder selection via the row checkbox', async () => {
    useAssetLibraryStore.setState({ collections: [parent], selectedFolderIds: [] })
    let renderer: ReactTestRenderer

    await act(async () => {
      renderer = create(
        <AssetLibrarySidebar counts={counts} scope="all" onSelectSystemScope={vi.fn()} onSelectCollection={vi.fn()} />,
      )
    })

    const checkbox = renderer!.root.findByProps({ 'aria-label': '选择 品牌素材' })
    await act(async () => {
      checkbox.props.onClick({ stopPropagation: vi.fn() })
    })
    expect(useAssetLibraryStore.getState().selectedFolderIds).toEqual(['parent'])

    // 再次点击取消选择
    const checkedBox = renderer!.root.findByProps({ 'aria-label': '取消选择 品牌素材' })
    await act(async () => {
      checkedBox.props.onClick({ stopPropagation: vi.fn() })
    })
    expect(useAssetLibraryStore.getState().selectedFolderIds).toEqual([])

    await act(async () => renderer!.unmount())
  })

  it('drags a folder row: writes the collection payload on drag start', () => {
    useAssetLibraryStore.setState({ collections: [parent, child] })
    let renderer: ReactTestRenderer
    act(() => {
      renderer = create(
        <AssetLibrarySidebar counts={counts} scope="all" onSelectSystemScope={vi.fn()} onSelectCollection={vi.fn()} />,
      )
    })
    const row = renderer!.root.findAll((node) => node.props.role === 'treeitem')[0]!
    const setData = vi.fn()
    act(() => {
      row.props.onDragStart({
        dataTransfer: { setData, effectAllowed: '' },
        target: { closest: () => null },
        preventDefault: vi.fn(),
      })
    })
    expect(setData).toHaveBeenCalledWith(COLLECTION_DRAG_TYPE, JSON.stringify(['parent']))
    expect(row.props.draggable).toBe(true)
    act(() => renderer!.unmount())
  })

  it('drops a dragged folder onto a row to nest it as a child', () => {
    const moveCollectionsToPosition = vi.fn().mockResolvedValue(undefined)
    useAssetLibraryStore.setState({ collections: [parent, child], moveCollectionsToPosition })
    let renderer: ReactTestRenderer
    act(() => {
      renderer = create(
        <AssetLibrarySidebar counts={counts} scope="all" onSelectSystemScope={vi.fn()} onSelectCollection={vi.fn()} />,
      )
    })
    const rows = renderer!.root.findAll((node) => node.props.role === 'treeitem')
    const sourceRow = rows[0]!
    const targetRow = rows[1]!
    const setData = vi.fn()
    act(() => {
      sourceRow.props.onDragStart({
        dataTransfer: { setData, effectAllowed: '' },
        target: { closest: () => null },
        preventDefault: vi.fn(),
      })
    })
    const dropEl = targetRow.findAll((node) => typeof node.props.onDrop === 'function')[0]!
    const dragEvent = (over: boolean) => ({
      dataTransfer: {
        types: [COLLECTION_DRAG_TYPE],
        getData: (type: string) => (type === COLLECTION_DRAG_TYPE ? JSON.stringify(['parent']) : ''),
        dropEffect: '',
      },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 36 }) },
      clientY: 18, // 中间 → into（嵌套）
    })
    act(() => {
      dropEl.props.onDragOver(dragEvent(true))
    })
    act(() => {
      dropEl.props.onDrop(dragEvent(false))
    })
    expect(moveCollectionsToPosition).toHaveBeenCalledWith(['parent'], { kind: 'into', parentId: 'child' })
    act(() => renderer!.unmount())
  })

  it('drops a dragged folder near the top of a row to reorder before it', () => {
    const moveCollectionsToPosition = vi.fn().mockResolvedValue(undefined)
    useAssetLibraryStore.setState({ collections: [parent, child], moveCollectionsToPosition })
    let renderer: ReactTestRenderer
    act(() => {
      renderer = create(
        <AssetLibrarySidebar counts={counts} scope="all" onSelectSystemScope={vi.fn()} onSelectCollection={vi.fn()} />,
      )
    })
    const rows = renderer!.root.findAll((node) => node.props.role === 'treeitem')
    const sourceRow = rows[0]!
    const targetRow = rows[1]!
    const setData = vi.fn()
    act(() => {
      sourceRow.props.onDragStart({
        dataTransfer: { setData, effectAllowed: '' },
        target: { closest: () => null },
        preventDefault: vi.fn(),
      })
    })
    const dropEl = targetRow.findAll((node) => typeof node.props.onDrop === 'function')[0]!
    const dropEvent = {
      dataTransfer: {
        getData: (type: string) => (type === COLLECTION_DRAG_TYPE ? JSON.stringify(['parent']) : ''),
        dropEffect: '',
      },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 36 }) },
      clientY: 2, // 上 30% → before
    }
    act(() => {
      dropEl.props.onDrop(dropEvent)
    })
    expect(moveCollectionsToPosition).toHaveBeenCalledWith(['parent'], { kind: 'before', siblingId: 'child' })
    act(() => renderer!.unmount())
  })

  it('drags every selected folder when dragging a selected row', () => {
    useAssetLibraryStore.setState({ collections: [parent, child], selectedFolderIds: ['parent', 'child'] })
    let renderer: ReactTestRenderer
    act(() => {
      renderer = create(
        <AssetLibrarySidebar counts={counts} scope="all" onSelectSystemScope={vi.fn()} onSelectCollection={vi.fn()} />,
      )
    })
    const row = renderer!.root.findAll((node) => node.props.role === 'treeitem')[0]!
    const setData = vi.fn()
    act(() => {
      row.props.onDragStart({
        dataTransfer: { setData, effectAllowed: '' },
        target: { closest: () => null },
        preventDefault: vi.fn(),
      })
    })
    expect(setData).toHaveBeenCalledWith(COLLECTION_DRAG_TYPE, JSON.stringify(['parent', 'child']))
    act(() => renderer!.unmount())
  })
})
