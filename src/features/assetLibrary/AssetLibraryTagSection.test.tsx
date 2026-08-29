import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetTag, GeneratedAsset } from '../../types'
import { normalizeAsset } from '../../lib/assetLibraryModel'
import AssetLibraryTagSection, { buildTagTree, flattenTagRows } from './AssetLibraryTagSection'
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

// 组件测试只验证 UI 接线；仓库层写路径 mock 掉（真实实现会访问 IndexedDB）
vi.mock('../../lib/assetLibraryRepository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/assetLibraryRepository')>()
  return {
    ...actual,
    putTags: vi.fn(async () => {}),
    deleteTagRecord: vi.fn(async () => {}),
    patchAssetsIndividually: vi.fn(async (patches: Array<{ id: string; patch: { tagIds?: string[] } }>) =>
      patches.map(({ id, patch }) => ({ id, tagIds: patch.tagIds ?? [] })),
    ),
  }
})

function makeTag(id: string, name: string, parentId: string | null = null, order = 0): AssetTag {
  return { id, name, normalizedName: name.toLocaleLowerCase('zh-CN'), parentId, order, createdAt: 1, updatedAt: 1 }
}

function makeAsset(id: string, overrides: Partial<GeneratedAsset> = {}): GeneratedAsset {
  return normalizeAsset({ id, imageId: id, createdAt: 1000, updatedAt: 1000, ...overrides })
}

const counts = {
  all: 1,
  recent: 0,
  favorites: 0,
  unorganized: 0,
  trash: 0,
  byCollection: new Map<string, number>(),
  byTag: new Map<string, number>([
    ['t1', 1],
    ['t2', 0],
  ]),
}

beforeEach(() => {
  vi.stubGlobal('document', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  useAssetLibraryStore.setState({
    tags: [makeTag('t1', '品牌'), makeTag('t2', '风格')],
    assetsById: { a: makeAsset('a', { tagIds: ['t1'] }) },
    assetOrder: ['a'],
    filters: {},
  })
})

afterEach(() => {
  useAssetLibraryStore.setState({ tags: [], assetsById: {}, assetOrder: [], filters: {} })
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

/** 标签行有复选框与名称两个可点击元素（同 aria-label），取第一个即可。 */
function findLabel(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const matches = renderer.root.findAllByProps({ 'aria-label': label })
  expect(matches.length).toBeGreaterThan(0)
  return matches[0]!
}

describe('buildTagTree / flattenTagRows', () => {
  it('builds parent-child tree and flattens with create rows', () => {
    const tags = [makeTag('t1', '品牌'), makeTag('t2', '风格', 't1', 0), makeTag('t3', '灵感', 't1', 1)]
    const tree = buildTagTree(tags)
    expect(tree).toHaveLength(1)
    expect(tree[0]?.children.map((node) => node.tag.id)).toEqual(['t2', 't3'])
    // 根级新建行 + 父级下的子标签新建行
    const rowsWithRootCreate = flattenTagRows(tree, null)
    expect(rowsWithRootCreate[0]).toMatchObject({ kind: 'create', parentId: null })
    const rowsWithChildCreate = flattenTagRows(tree, 't1')
    expect(rowsWithChildCreate.filter((row) => row.kind === 'create').map((row) => row.parentId)).toEqual(['t1'])
    expect(rowsWithChildCreate.find((row) => row.kind === 'create')?.depth).toBe(1)
  })
})

describe('AssetLibraryTagSection', () => {
  function render(props: { filtering?: boolean; filterNeedle?: string } = {}) {
    let renderer: ReactTestRenderer
    act(() => {
      renderer = create(
        <AssetLibraryTagSection
          counts={counts}
          filtering={props.filtering ?? false}
          filterNeedle={props.filterNeedle ?? ''}
        />,
      )
    })
    return renderer!
  }

  it('renders tag rows with counts and hides section when no tags', () => {
    const renderer = render()
    expect(findLabel(renderer, '筛选标签 品牌')).toBeDefined()
    expect(findLabel(renderer, '筛选标签 风格')).toBeDefined()
    renderer.unmount()

    useAssetLibraryStore.setState({ tags: [] })
    const emptyRenderer = render()
    expect(emptyRenderer.root.findAllByProps({ 'aria-label': '筛选标签 品牌' })).toHaveLength(0)
    emptyRenderer.unmount()
  })

  it('toggles a tag into the multi-select AND filter on click', () => {
    const renderer = render()
    const label = findLabel(renderer, '筛选标签 品牌')
    act(() => {
      label.props.onClick({ stopPropagation: vi.fn() })
    })
    expect(useAssetLibraryStore.getState().filters.tagIds).toEqual(['t1'])
    act(() => {
      label.props.onClick({ stopPropagation: vi.fn() })
    })
    expect(useAssetLibraryStore.getState().filters.tagIds).toBeUndefined()
    renderer.unmount()
  })

  it('shows a selected state on the row when the tag is filtered', () => {
    useAssetLibraryStore.setState({ filters: { tagIds: ['t1'] } })
    const renderer = render()
    expect(findLabel(renderer, '取消筛选标签 品牌')).toBeDefined()
    renderer.unmount()
  })

  it('filters the tree by the sidebar filter needle', () => {
    const renderer = render({ filtering: true, filterNeedle: '风格' })
    expect(renderer.root.findAllByProps({ 'aria-label': '筛选标签 品牌' })).toHaveLength(0)
    expect(findLabel(renderer, '筛选标签 风格')).toBeDefined()
    renderer.unmount()
  })

  it('creates a tag from the section header button', async () => {
    const renderer = render()
    const createButton = renderer.root.findAllByProps({ 'aria-label': '新建标签' })[0]!
    act(() => {
      createButton.props.onClick()
    })
    const input = renderer.root.findAllByProps({ 'aria-label': '标签名称' })[0]
    expect(input).toBeDefined()
    act(() => {
      input.props.onChange({ target: { value: '新标签' } })
    })
    const form = renderer.root.findByType('form')
    await act(async () => {
      form.props.onSubmit({ preventDefault: vi.fn() })
    })
    expect(useAssetLibraryStore.getState().tags.some((tag) => tag.name === '新标签')).toBe(true)
    renderer.unmount()
  })

  it('opens a delete confirmation dialog from the row context menu', () => {
    const renderer = render()
    const row = renderer.root.findAll((node) => node.props['data-tag-id'] === 't1')[0]!
    act(() => {
      row.props.onContextMenu({ preventDefault: vi.fn(), clientX: 10, clientY: 10 })
    })
    // 右键菜单渲染出「删除」项
    expect(renderer.root.findAll((node) => node.props.children === '删除')).not.toHaveLength(0)
    renderer.unmount()
  })

  it('confirms deletion through the confirm dialog', () => {
    const renderer = render()
    const row = renderer.root.findAll((node) => node.props['data-tag-id'] === 't1')[0]!
    act(() => {
      row.props.onContextMenu({ preventDefault: vi.fn(), clientX: 10, clientY: 10 })
    })
    const deleteItem = renderer.root.findAll((node) => node.props.children === '删除')[0]!
    act(() => {
      deleteItem.props.onClick({ stopPropagation: vi.fn() })
    })
    expect(mainStoreMock.setConfirmDialog).toHaveBeenCalledTimes(1)
    const dialog = mainStoreMock.setConfirmDialog.mock.calls[0]![0] as {
      title: string
      buttons: Array<{ label: string }>
    }
    expect(dialog.title).toContain('删除标签')
    expect(dialog.buttons.map((button) => button.label)).toEqual(['取消', '删除标签'])
    renderer.unmount()
  })
})
