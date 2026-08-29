import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetCollection, GeneratedAsset } from '../../types'
import AssetCardMenu from './AssetCardMenu'
import { useAssetLibraryStore } from './store'

const storeMock = vi.hoisted(() => ({
  useStore: { getState: vi.fn(() => ({ showToast: vi.fn() })) },
}))
vi.mock('../../store', () => storeMock)

function makeAsset(id: string, collectionIds: string[] = []): GeneratedAsset {
  return {
    id,
    imageId: id,
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    trashedAt: null,
    favorite: false,
    rating: 0,
    collectionIds,
    tagIds: [],
    origins: [],
    primaryOriginKey: null,
    parentAssetIds: [],
    metadataVersion: 1,
  }
}

const collection: AssetCollection = {
  id: 'c1',
  name: '项目一',
  normalizedName: '项目一',
  parentId: null,
  order: 0,
  createdAt: 1,
  updatedAt: 1,
}

function nodeText(node: unknown): string {
  if (node == null) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  const children = (node as { children?: unknown }).children
  if (Array.isArray(children)) return children.map(nodeText).join('')
  return ''
}

function findButton(root: ReactTestRenderer['root'], text: string) {
  return root.findAll((node) => node.type === 'button' && nodeText(node).includes(text))[0]
}

beforeEach(() => {
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  useAssetLibraryStore.setState({
    collections: [collection],
    assetsById: { a: makeAsset('a'), b: makeAsset('b') },
    patchAssets: vi.fn().mockResolvedValue(undefined),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('AssetCardMenu batch actions (Eagle-style selection)', () => {
  it('applies the chosen project folder to every selected asset', async () => {
    const patchAssets = useAssetLibraryStore.getState().patchAssets as ReturnType<typeof vi.fn>
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(<AssetCardMenu x={0} y={0} asset={makeAsset('a')} assetIds={['a', 'b']} onClose={vi.fn()} />)
    })

    await act(async () => {
      findButton(renderer!.root, '添加到项目').props.onClick()
    })
    await act(async () => {
      findButton(renderer!.root, '项目一').props.onClick()
    })

    expect(patchAssets).toHaveBeenCalledWith(['a'], { collectionIds: ['c1'] })
    expect(patchAssets).toHaveBeenCalledWith(['b'], { collectionIds: ['c1'] })

    await act(async () => renderer!.unmount())
  })

  it('toggles favorite across the whole selection', async () => {
    const patchAssets = useAssetLibraryStore.getState().patchAssets as ReturnType<typeof vi.fn>
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(<AssetCardMenu x={0} y={0} asset={makeAsset('a')} assetIds={['a', 'b']} onClose={vi.fn()} />)
    })

    await act(async () => {
      findButton(renderer!.root, '收藏（2 张）').props.onClick()
    })

    expect(patchAssets).toHaveBeenCalledWith(['a', 'b'], { favorite: true })

    await act(async () => renderer!.unmount())
  })

  it('operates on the single asset only when it is not part of a multi-selection', async () => {
    const patchAssets = useAssetLibraryStore.getState().patchAssets as ReturnType<typeof vi.fn>
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(<AssetCardMenu x={0} y={0} asset={makeAsset('a')} onClose={vi.fn()} />)
    })

    await act(async () => {
      findButton(renderer!.root, '添加到项目').props.onClick()
    })
    await act(async () => {
      findButton(renderer!.root, '项目一').props.onClick()
    })

    expect(patchAssets).toHaveBeenCalledWith(['a'], { collectionIds: ['c1'] })
    expect(patchAssets).not.toHaveBeenCalledWith(['b'], expect.anything())

    await act(async () => renderer!.unmount())
  })

  it('shows nested project folders as a tree with per-level indentation', async () => {
    const parent: AssetCollection = {
      id: 'p1',
      name: '父项目',
      normalizedName: '父项目',
      parentId: null,
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    }
    const child: AssetCollection = {
      id: 'p1-child',
      name: '子项目',
      normalizedName: '子项目',
      parentId: 'p1',
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    }
    useAssetLibraryStore.setState({ collections: [parent, child] })
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(<AssetCardMenu x={0} y={0} asset={makeAsset('a')} onClose={vi.fn()} />)
    })

    await act(async () => {
      findButton(renderer!.root, '添加到项目').props.onClick()
    })

    const indentOf = (name: string) => {
      const button = findButton(renderer!.root, name)!
      const span = button.findAll(
        (node) =>
          typeof node.props.style === 'object' &&
          node.props.style !== null &&
          typeof (node.props.style as { paddingLeft?: unknown }).paddingLeft === 'string',
      )[0]!
      return (span.props.style as { paddingLeft: string }).paddingLeft
    }
    // 根级无缩进，子级按每级 12px 缩进
    expect(indentOf('父项目')).toBe('0px')
    expect(indentOf('子项目')).toBe('12px')

    await act(async () => renderer!.unmount())
  })

  it('does not offer rating, detail, reference or close entries anymore', async () => {
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(<AssetCardMenu x={0} y={0} asset={makeAsset('a')} onClose={vi.fn()} />)
    })

    const root = renderer!.root
    expect(root.findAll((node) => node.type === 'button' && nodeText(node).includes('星评分'))).toHaveLength(0)
    expect(root.findAll((node) => node.type === 'button' && nodeText(node).includes('查看详情'))).toHaveLength(0)
    expect(root.findAll((node) => node.type === 'button' && nodeText(node).includes('加入参考图'))).toHaveLength(0)
    expect(root.findAll((node) => node.type === 'button' && nodeText(node).includes('关闭'))).toHaveLength(0)
    // 新增打开文件位置
    expect(root.findAll((node) => node.type === 'button' && nodeText(node).includes('打开文件位置'))).toHaveLength(1)

    await act(async () => renderer!.unmount())
  })
})
