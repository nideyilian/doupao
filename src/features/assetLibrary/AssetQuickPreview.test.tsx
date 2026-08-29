import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GeneratedAsset } from '../../types'
import { normalizeAsset } from '../../lib/assetLibraryModel'
import { AssetQuickPreview } from './AssetQuickPreview'
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

vi.mock('../../store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store')>()
  return {
    ...actual,
    ...mainStoreMock,
  }
})

vi.mock('../../lib/assetLibraryRepository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/assetLibraryRepository')>()
  return { ...actual }
})

function makeAsset(id: string, overrides: Partial<GeneratedAsset> = {}): GeneratedAsset {
  return normalizeAsset({ id, imageId: id, createdAt: 1000, updatedAt: 1000, origins: [], ...overrides })
}

const asset = makeAsset('a', {
  origins: [
    {
      key: 't1:0',
      taskId: 't1',
      outputSlot: 0,
      taskCreatedAt: 1,
      prompt: '一只橘猫',
      sourceMode: 'gallery',
      inputImageIds: [],
      taskFinishedAt: null,
      requestedParams: {} as never,
    },
  ],
})

beforeEach(() => {
  vi.stubGlobal('document', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  useAssetLibraryStore.setState({
    assetsById: { a: asset },
    assetOrder: ['a'],
    quickPreviewAssetId: 'a',
  })
})

afterEach(() => {
  useAssetLibraryStore.setState({ assetsById: {}, assetOrder: [], quickPreviewAssetId: null })
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('AssetQuickPreview', () => {
  function render() {
    let renderer: ReactTestRenderer
    act(() => {
      renderer = create(<AssetQuickPreview />)
    })
    return renderer!
  }

  it('renders nothing when no asset is being previewed', () => {
    useAssetLibraryStore.setState({ quickPreviewAssetId: null })
    const renderer = render()
    expect(renderer.root.findAllByProps({ 'data-testid': 'asset-quick-preview' })).toHaveLength(0)
    renderer.unmount()
  })

  it('renders the preview overlay for the selected asset', () => {
    const renderer = render()
    expect(renderer.root.findAllByProps({ 'data-testid': 'asset-quick-preview' })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ 'aria-label': '快速预览' })).toHaveLength(1)
    renderer.unmount()
  })

  it('shows the full prompt with wrapping instead of clamping it to one line', () => {
    const longPrompt = `第一行提示词内容
第二行：更长的描述，用来验证多行提示词可以完整换行显示，不会因为过长而被截断成单行省略号。`
    useAssetLibraryStore.setState({
      assetsById: {
        a: {
          ...asset,
          origins: [{ ...asset.origins[0]!, prompt: longPrompt }],
        },
      },
    })
    const renderer = render()
    const promptText = renderer.root.findAllByType('p').find((node) => node.children.join('') === longPrompt)
    expect(promptText).toBeTruthy()
    // 换行类：whitespace-pre-wrap + break-words 保证提示词完整换行
    expect(String(promptText!.props.className)).toContain('whitespace-pre-wrap')
    expect(String(promptText!.props.className)).toContain('break-words')
    renderer.unmount()
  })

  it('closes when the backdrop is clicked', () => {
    const renderer = render()
    const overlay = renderer.root.findAllByProps({ 'data-testid': 'asset-quick-preview' })[0]!
    act(() => {
      overlay.props.onMouseDown({ target: overlay, currentTarget: overlay })
    })
    expect(useAssetLibraryStore.getState().quickPreviewAssetId).toBeNull()
    renderer.unmount()
  })
})
