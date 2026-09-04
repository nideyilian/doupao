/* @vitest-environment jsdom */
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { GeneratedAsset } from '../types'
import { normalizeAsset } from '../lib/assetLibraryModel'
import { useAssetLibraryStore } from '../features/assetLibrary/store'
import { useAssetLibraryShortcuts } from './useAssetLibraryShortcuts'

function makeAsset(id: string): GeneratedAsset {
  return normalizeAsset({ id, imageId: id, createdAt: 1000, updatedAt: 1000, origins: [] })
}

function Host() {
  useAssetLibraryShortcuts({ onFocusSearch: vi.fn(), onOpenViewer: vi.fn() })
  return null
}

describe('useAssetLibraryShortcuts 空格快速预览', () => {
  it('空格优先预览鼠标悬停的素材，无需先点选；松开空格关闭', () => {
    useAssetLibraryStore.setState({
      assetsById: { a: makeAsset('a'), b: makeAsset('b') },
      assetOrder: ['a', 'b'],
      selectedAssetIds: [],
      quickPreviewAssetId: null,
      hoveredAssetId: null,
    })
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<Host />)
    })

    // 鼠标悬停到 b、未选中任何素材：按空格直接预览 b
    useAssetLibraryStore.setState({ hoveredAssetId: 'b' })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    })
    expect(useAssetLibraryStore.getState().quickPreviewAssetId).toBe('b')

    const repeat = new KeyboardEvent('keydown', { key: ' ', repeat: true, bubbles: true, cancelable: true })
    act(() => {
      window.dispatchEvent(repeat)
    })
    expect(repeat.defaultPrevented).toBe(true)
    expect(useAssetLibraryStore.getState().quickPreviewAssetId).toBe('b')

    // 松开空格关闭预览
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }))
    })
    expect(useAssetLibraryStore.getState().quickPreviewAssetId).toBeNull()

    act(() => renderer!.unmount())
  })

  it('无悬停素材时回退到选中素材；悬停素材已删除时同样回退', () => {
    useAssetLibraryStore.setState({
      assetsById: { a: makeAsset('a') },
      assetOrder: ['a'],
      selectedAssetIds: ['a'],
      quickPreviewAssetId: null,
      hoveredAssetId: null,
    })
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<Host />)
    })

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    })
    expect(useAssetLibraryStore.getState().quickPreviewAssetId).toBe('a')

    useAssetLibraryStore.setState({ hoveredAssetId: 'ghost' })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    })
    expect(useAssetLibraryStore.getState().quickPreviewAssetId).toBe('a')

    act(() => renderer!.unmount())
  })
})
