// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import AssetFilterTabBar from './AssetFilterTabBar'
import { useAssetLibraryStore } from './store'

function render(): ReactTestRenderer {
  let renderer: ReactTestRenderer
  act(() => {
    renderer = create(<AssetFilterTabBar />)
  })
  return renderer!
}

beforeEach(() => {
  useAssetLibraryStore.setState({ pinnedFilters: [], filters: {} })
})

afterEach(() => {
  useAssetLibraryStore.setState({ pinnedFilters: [], filters: {} })
})

describe('AssetFilterTabBar（Eagle 式筛选标签栏）', () => {
  it('renders nothing when no filter is active and nothing is pinned', () => {
    const renderer = render()
    expect(renderer.root.findAllByProps({ 'data-testid': 'asset-filter-tab-bar' })).toHaveLength(0)
    act(() => renderer.unmount())
  })

  it('auto-opens a temp tab for every active filter condition (设置筛选后自动开标签)', () => {
    useAssetLibraryStore.setState({
      filters: { provider: '豆包', minRating: 4, favoriteOnly: true },
    })
    const renderer = render()
    expect(renderer.root.findAllByProps({ 'data-testid': 'asset-filter-tab-provider:豆包' })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ 'data-testid': 'asset-filter-tab-minRating:4' })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ 'data-testid': 'asset-filter-tab-favoriteOnly' })).toHaveLength(1)
    // 全部为激活态（aria-selected）
    expect(renderer.root.findAllByProps({ role: 'tab', 'aria-selected': true })).toHaveLength(3)
    act(() => renderer.unmount())
  })

  it('clicking a temp tab removes the condition (点击临时标签 = 取消筛选)', () => {
    useAssetLibraryStore.setState({ filters: { provider: '豆包' } })
    const renderer = render()
    const tab = renderer.root.findByProps({ 'data-testid': 'asset-filter-tab-provider:豆包' })
    act(() => {
      tab.props.onClick()
    })
    expect(useAssetLibraryStore.getState().filters.provider).toBeUndefined()
    // 条件清除后标签自动消失 → 整栏不渲染
    act(() => renderer.update(<AssetFilterTabBar />))
    expect(renderer.root.findAllByProps({ 'data-testid': 'asset-filter-tab-bar' })).toHaveLength(0)
    act(() => renderer.unmount())
  })

  it('removes a temp tab via its ✕ button (只移除该条件，其余筛选保留)', () => {
    useAssetLibraryStore.setState({ filters: { provider: '豆包', minRating: 4 } })
    const renderer = render()
    const remove = renderer.root.findByProps({ 'data-testid': 'asset-filter-tab-remove-provider:豆包' })
    act(() => {
      remove.props.onClick({ stopPropagation: () => {} })
    })
    expect(useAssetLibraryStore.getState().filters.provider).toBeUndefined()
    expect(useAssetLibraryStore.getState().filters.minRating).toBe(4)
    act(() => renderer.unmount())
  })

  it('keeps pinned tabs as persistent tabs even after clearing all filters (固定标签常驻)', () => {
    useAssetLibraryStore.getState().pinFilter({ kind: 'provider', value: '豆包' })
    // 固定标签激活 + 一个临时条件（minRating）→「清除全部」按钮出现
    useAssetLibraryStore.setState({ filters: { provider: '豆包', minRating: 3 } })
    const renderer = render()
    // 固定 + 临时同 key 去重 → provider 只显示一个标签（固定）
    expect(renderer.root.findAllByProps({ 'data-testid': 'asset-filter-tab-provider:豆包' })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ 'data-testid': 'asset-filter-tab-minRating:3' })).toHaveLength(1)
    // 清除全部：只清临时条件；固定标签保留且变为未激活
    act(() => {
      renderer.root.findByProps({ 'data-testid': 'asset-filter-tab-clear-all' }).props.onClick()
    })
    expect(useAssetLibraryStore.getState().filters).toEqual({})
    act(() => renderer.update(<AssetFilterTabBar />))
    expect(renderer.root.findAllByProps({ 'data-testid': 'asset-filter-tab-provider:豆包' })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ 'data-testid': 'asset-filter-tab-minRating:3' })).toHaveLength(0)
    const tab = renderer.root.findByProps({ 'data-testid': 'asset-filter-tab-provider:豆包' })
    expect(tab.props['aria-selected']).toBe(false)
    act(() => renderer.unmount())
  })

  it('clicking an inactive pinned tab applies the filter; clicking again cancels (点击切换激活)', () => {
    useAssetLibraryStore.getState().pinFilter({ kind: 'minRating', value: 4 })
    const renderer = render()
    const tab = renderer.root.findByProps({ 'data-testid': 'asset-filter-tab-minRating:4' })
    expect(tab.props['aria-selected']).toBe(false)
    act(() => {
      tab.props.onClick()
    })
    expect(useAssetLibraryStore.getState().filters.minRating).toBe(4)
    act(() => renderer.update(<AssetFilterTabBar />))
    act(() => renderer.root.findByProps({ 'data-testid': 'asset-filter-tab-minRating:4' }).props.onClick())
    expect(useAssetLibraryStore.getState().filters.minRating).toBeUndefined()
    act(() => renderer.unmount())
  })

  it('unpinning an active fixed tab keeps the condition as a temp tab (取消固定 ≠ 移除条件)', () => {
    useAssetLibraryStore.getState().pinFilter({ kind: 'provider', value: '豆包' })
    useAssetLibraryStore.setState({ filters: { provider: '豆包' } })
    const renderer = render()
    act(() => {
      renderer.root.findByProps({ 'data-testid': 'asset-filter-tab-unpin-provider:豆包' }).props.onClick({
        stopPropagation: () => {},
      })
    })
    expect(useAssetLibraryStore.getState().pinnedFilters).toEqual([])
    // 条件仍激活 → 以临时标签继续显示
    act(() => renderer.update(<AssetFilterTabBar />))
    expect(renderer.root.findAllByProps({ 'data-testid': 'asset-filter-tab-provider:豆包' })).toHaveLength(1)
    expect(useAssetLibraryStore.getState().filters.provider).toBe('豆包')
    act(() => renderer.unmount())
  })

  it('reorders pinned tabs via drag & drop (固定标签拖动排序)', () => {
    useAssetLibraryStore.getState().pinFilter({ kind: 'provider', value: '豆包' })
    useAssetLibraryStore.getState().pinFilter({ kind: 'minRating', value: 4 })
    const renderer = render()
    const first = renderer.root.findByProps({ 'data-testid': 'asset-filter-tab-provider:豆包' })
    const second = renderer.root.findByProps({ 'data-testid': 'asset-filter-tab-minRating:4' })
    // 拖第一个到第二个位置
    act(() => {
      first.props.onDragStart()
    })
    act(() => {
      second.props.onDragOver()
    })
    act(() => {
      second.props.onDrop()
    })
    expect(useAssetLibraryStore.getState().pinnedFilters.map((item) => item.kind)).toEqual(['minRating', 'provider'])
    act(() => renderer.unmount())
  })
})
