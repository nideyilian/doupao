import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeAsset } from '../../lib/assetLibraryModel'
import AssetGrid, { buildAssetMasonryLayout } from './AssetGrid'
import { useAssetLibraryStore } from './store'

const thumbnailMocks = vi.hoisted(() => ({
  ensureImageCached: vi.fn(async () => null),
  ensureImageThumbnailCached: vi.fn(async () => null),
  getCachedThumbnail: vi.fn(() => null),
  subscribeImageThumbnail: vi.fn(() => () => {}),
}))

vi.mock('../../store', () => thumbnailMocks)

let resizeCallback: (() => void) | undefined

beforeEach(() => {
  resizeCallback = undefined
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resizeCallback = callback
      }
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  useAssetLibraryStore.setState({ selectedAssetIds: [], activeAssetId: null, detailOpen: false })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('buildAssetMasonryLayout', () => {
  it('lays out ten thousand assets without creating pagination state', () => {
    const assets = Array.from({ length: 10_000 }, (_, index) =>
      normalizeAsset({
        id: `asset-${index}`,
        imageId: `asset-${index}`,
        width: index % 2 ? 1600 : 900,
        height: index % 2 ? 900 : 1600,
        origins: [],
      }),
    )
    const layout = buildAssetMasonryLayout(assets, 1200)
    expect(layout.items).toHaveLength(10_000)
    expect(layout.height).toBeGreaterThan(0)
    expect(layout.items.every((item) => item.left >= 0 && item.top >= 0 && item.height > 0)).toBe(true)
  })

  it('uses two columns on a phone-sized viewport', () => {
    const assets = Array.from({ length: 4 }, (_, index) =>
      normalizeAsset({ id: `${index}`, imageId: `${index}`, origins: [] }),
    )
    const layout = buildAssetMasonryLayout(assets, 360)
    expect(new Set(layout.items.map((item) => item.left)).size).toBe(2)
  })

  it('adjusts column count by grid density', () => {
    const assets = Array.from({ length: 8 }, (_, index) =>
      normalizeAsset({ id: `${index}`, imageId: `${index}`, origins: [] }),
    )
    const standard = buildAssetMasonryLayout(assets, 1200)
    const compact = buildAssetMasonryLayout(assets, 1200, 'compact')
    const cozy = buildAssetMasonryLayout(assets, 1200, 'cozy')
    expect(standard.columns).toBe(4)
    expect(compact.columns).toBe(5)
    expect(cozy.columns).toBe(2)
    expect(compact.items.every((item) => item.width < standard.items[0]!.width)).toBe(true)
  })

  it('fills columns left-to-right first, then moves down (先横后竖，从左开始算)', () => {
    const assets = Array.from({ length: 6 }, (_, index) =>
      normalizeAsset({ id: `img-${index}`, imageId: `img-${index}`, origins: [] }),
    )
    const layout = buildAssetMasonryLayout(assets, 1200)
    expect(layout.columns).toBe(4)
    // 行主序：第 1 张在最左，第 2~4 张依次向右，第 5 张回到最左开始第二行
    const lefts = layout.items.map((item) => item.left)
    expect(lefts[0]).toBeLessThan(lefts[1])
    expect(lefts[1]).toBeLessThan(lefts[2])
    expect(lefts[2]).toBeLessThan(lefts[3])
    expect(lefts[4]).toBe(lefts[0])
    expect(lefts[5]).toBe(lefts[1])
    // 每列纵向累加：第二行的 top 应大于第一行对应列
    expect(layout.items[4].top).toBeGreaterThan(layout.items[0].top)
    expect(layout.items[5].top).toBeGreaterThan(layout.items[1].top)
  })

  it('preserves a valid layout through a transient zero-width scope switch', async () => {
    const first = normalizeAsset({ id: 'first', imageId: 'first', width: 800, height: 600, origins: [] })
    const second = normalizeAsset({ id: 'second', imageId: 'second', width: 800, height: 600, origins: [] })
    const scrollNode = { clientHeight: 600, scrollTop: 0 }
    const layoutNode = { clientWidth: 800 }
    let renderer: ReactTestRenderer

    await act(async () => {
      renderer = create(createElement(AssetGrid, { assets: [first] }), {
        createNodeMock: (element) => {
          const props = element.props as Record<string, unknown>
          if (props['data-testid'] === 'asset-grid') return scrollNode
          if (props['data-testid'] === 'asset-grid-layout') return layoutNode
          return {}
        },
      })
    })
    expect(renderer!.root.findAllByProps({ 'data-asset-id': 'first' })).toHaveLength(1)

    layoutNode.clientWidth = 0
    await act(async () => resizeCallback?.())
    layoutNode.clientWidth = 800
    await act(async () => renderer!.update(createElement(AssetGrid, { assets: [second] })))

    expect(renderer!.root.findAllByProps({ 'data-asset-id': 'second' })).toHaveLength(1)
    await act(async () => renderer!.unmount())
  })
})
