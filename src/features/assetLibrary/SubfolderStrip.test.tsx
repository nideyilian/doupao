// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeAsset } from '../../lib/assetLibraryModel'
import type { AssetCollection, GeneratedAsset } from '../../types'
import SubfolderStrip from './SubfolderStrip'
import { useAssetLibraryStore } from './store'

vi.mock('../../store', () => ({
  ensureImageThumbnailCached: vi.fn(async () => ({ dataUrl: 'data:image/png;base64,cover' })),
}))

function makeCollection(id: string, name: string, parentId: string | null, order = 0): AssetCollection {
  return {
    id,
    name,
    normalizedName: name,
    parentId,
    order,
    createdAt: 1000,
    updatedAt: 1000,
    trashedAt: null,
  }
}

function makeAsset(id: string, collectionId: string): GeneratedAsset {
  return normalizeAsset({
    id,
    imageId: id,
    createdAt: 1000,
    updatedAt: 1000,
    width: 1024,
    height: 1024,
    collectionIds: [collectionId],
    origins: [
      {
        key: `${id}:0`,
        taskId: 't1',
        outputSlot: 0,
        taskCreatedAt: 1000,
        taskFinishedAt: 1000,
        sourceMode: 'generated',
        prompt: `prompt-${id}`,
        requestedParams: {},
        inputImageIds: [],
      },
    ],
    primaryOriginKey: `${id}:0`,
  })
}

function nodeText(node: unknown): string {
  if (node == null) return ''
  if (typeof node === 'string') return node
  const children = (node as { children?: unknown }).children
  if (Array.isArray(children)) return children.map(nodeText).join('')
  return ''
}

const counts = {
  all: 3,
  recent: 0,
  favorites: 0,
  unorganized: 0,
  trash: 0,
  byCollection: new Map([
    ['root', 0],
    ['child-a', 2],
    ['child-b', 0],
  ]),
  byTag: new Map<string, number>(),
}

beforeEach(() => {
  useAssetLibraryStore.setState({
    scope: { kind: 'collection', id: 'root' },
    collections: [
      makeCollection('root', '根文件夹', null),
      makeCollection('child-a', '子文件夹A', 'root', 1),
      makeCollection('child-b', '子文件夹B', 'root', 2),
    ],
    assetsById: {
      a1: makeAsset('a1', 'child-a'),
      a2: makeAsset('a2', 'child-a'),
    },
    assetOrder: ['a1', 'a2'],
    query: '',
    filters: {},
    similarToAssetId: null,
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

function render() {
  let renderer: ReactTestRenderer
  act(() => {
    renderer = create(<SubfolderStrip counts={counts} />)
  })
  return renderer!
}

describe('SubfolderStrip', () => {
  it('renders nothing outside a collection scope', async () => {
    useAssetLibraryStore.setState({ scope: 'all' })
    const renderer = render()
    expect(renderer.root.findAllByProps({ 'data-testid': 'asset-subfolder-strip' })).toHaveLength(0)
    await act(async () => renderer.unmount())
  })

  it('renders nothing when the folder has no direct subfolders', async () => {
    useAssetLibraryStore.setState({ collections: [makeCollection('root', '根文件夹', null)] })
    const renderer = render()
    expect(renderer.root.findAllByProps({ 'data-testid': 'asset-subfolder-strip' })).toHaveLength(0)
    await act(async () => renderer.unmount())
  })

  it('shows subfolder cards with name and asset count', async () => {
    const renderer = render()
    expect(renderer.root.findAllByProps({ 'data-testid': 'asset-subfolder-card' })).toHaveLength(2)
    const texts = nodeText(renderer.root)
    expect(texts).toContain('子文件夹A')
    expect(texts).toContain('子文件夹B')
    expect(texts).toContain('2 张')
    await act(async () => renderer.unmount())
  })

  it('loads the cover thumbnail of the first asset in each subfolder', async () => {
    const renderer = render()
    await act(async () => {})
    const imgs = renderer.root.findAllByType('img')
    expect(imgs).toHaveLength(1)
    expect(imgs[0]!.props.src).toBe('data:image/png;base64,cover')
    await act(async () => renderer.unmount())
  })

  it('navigates into a subfolder when its card is clicked', async () => {
    const renderer = render()
    const cards = renderer.root.findAllByProps({ 'data-testid': 'asset-subfolder-card' })
    await act(async () => {
      cards[1]!.props.onClick()
    })
    expect(useAssetLibraryStore.getState().scope).toEqual({ kind: 'collection', id: 'child-b' })
    await act(async () => renderer.unmount())
  })

  it('hides while searching or filtering (results may span folders)', async () => {
    useAssetLibraryStore.setState({ query: '夏日' })
    const renderer = render()
    expect(renderer.root.findAllByProps({ 'data-testid': 'asset-subfolder-strip' })).toHaveLength(0)
    await act(async () => renderer.unmount())
  })
})
