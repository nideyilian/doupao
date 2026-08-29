/* @vitest-environment jsdom */

import { act, create } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mainStore = vi.hoisted(() => ({
  appMode: 'gallery',
  wordLibraryGroups: [],
  wordLibraryEntries: [],
  wordLibraryManagerOpen: false,
  setWordLibraryManagerOpen: vi.fn(),
  setWordLibraryEditEntryId: vi.fn(),
  prompt: '',
  setPrompt: vi.fn(),
  showToast: vi.fn(),
  toggleWordLibraryEntryFavorite: vi.fn(),
  updateWordLibraryEntry: vi.fn(),
  touchWordLibraryEntryUsage: vi.fn(),
  wordLibraryEditEntryId: null,
  wordLibraryPromptSelectedVarName: null,
  setWordLibraryPromptSelectedVarName: vi.fn(),
}))

const assetStore = vi.hoisted(() => ({
  activeAssetId: 'asset-1',
  assetsById: { 'asset-1': { id: 'asset-1', width: 1672, height: 941 } },
  assetOrder: ['asset-1'],
  collections: [],
  tags: [],
  scope: 'all',
  query: '',
  filters: {},
  sortKey: 'updatedAt',
  sortOrder: 'desc',
  detailOpen: true,
  setDetailOpen: vi.fn(),
  setActiveAsset: vi.fn(),
}))

vi.mock('../store', () => {
  const useStore = Object.assign((selector: (state: typeof mainStore) => unknown) => selector(mainStore), {
    getState: () => mainStore,
    subscribe: () => () => {},
  })
  return { useStore }
})

vi.mock('../features/assetLibrary/store', () => ({
  useAssetLibraryStore: Object.assign((selector: (state: typeof assetStore) => unknown) => selector(assetStore), {
    getState: () => assetStore,
  }),
  getVisibleAssets: ({
    assetsById,
    assetOrder,
  }: {
    assetsById: Record<string, { id: string }>
    assetOrder: string[]
  }) => assetOrder.map((id) => assetsById[id]).filter(Boolean),
}))

vi.mock('../features/assetLibrary/AssetDetailPanel', () => ({
  default: ({ embedded }: { embedded?: boolean }) => (
    <div data-testid="embedded-asset-detail" data-embedded={embedded || undefined} />
  ),
}))

vi.mock('../features/assetLibrary/query', () => ({
  queryAssets: () => ({
    assets: [],
    totalCount: 0,
    counts: {
      all: 0,
      recent: 0,
      favorites: 0,
      unorganized: 0,
      trash: 0,
      byCollection: new Map(),
    },
  }),
}))

vi.mock('../hooks/useMediaQuery', () => ({ useMediaQuery: () => false }))

import WordLibrarySidebar from './WordLibrarySidebar'

describe('WordLibrarySidebar asset detail state', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('uses one full-height right sidebar for details and words', () => {
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<WordLibrarySidebar />)
    })

    const panel = renderer.root.findByProps({ 'data-docked': 'right' })
    expect(panel.props.style.height).toBe('calc(100vh - var(--app-header-offset))')
    expect(renderer.root.findByProps({ 'data-testid': 'embedded-asset-detail' }).props['data-embedded']).toBe(true)

    const tabs = renderer.root.findAll((node) => node.props.role === 'tab')
    expect(tabs.map((tab) => tab.props.children)).toEqual(['详情', '词条'])

    act(() => tabs[1].props.onClick())
    expect(renderer.root.findAll((node) => node.props['data-testid'] === 'embedded-asset-detail')).toHaveLength(0)

    act(() => tabs[0].props.onClick())
    expect(renderer.root.findByProps({ 'data-testid': 'embedded-asset-detail' })).toBeTruthy()
    act(() => renderer.root.findByProps({ 'aria-label': '关闭素材详情' }).props.onClick())
    expect(assetStore.setDetailOpen).toHaveBeenCalledWith(false)
  })
})
