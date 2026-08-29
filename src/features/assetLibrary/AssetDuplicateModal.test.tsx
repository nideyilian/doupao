/* @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { GeneratedAsset } from '../../types'
import AssetDuplicateModal from './AssetDuplicateModal'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const storeMocks = vi.hoisted(() => ({
  ensureImageThumbnailCached: vi.fn(() => Promise.resolve(undefined)),
  subscribeImageThumbnail: vi.fn(() => () => {}),
  useStore: { getState: () => ({ showToast: vi.fn() }) },
}))

vi.mock('../../store', () => storeMocks)

const assetLibraryStoreMock = vi.hoisted(() => ({
  getState: vi.fn(),
}))

vi.mock('./store', () => ({ useAssetLibraryStore: assetLibraryStoreMock }))

function makeAsset(id: string): GeneratedAsset {
  return {
    id,
    imageId: id,
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
  }
}

const groupA = { assets: [makeAsset('a1'), makeAsset('a2'), makeAsset('a3')], avgHamming: 2 }
const groupB = { assets: [makeAsset('b1'), makeAsset('b2')], avgHamming: 5 }

let nearDuplicates: Mock
let moveToTrash: Mock
let showToast: Mock

beforeEach(() => {
  nearDuplicates = vi.fn().mockResolvedValue([groupA, groupB])
  ;(window as unknown as { electronAPI?: { assetCatalogNearDuplicates?: typeof nearDuplicates } }).electronAPI = {
    assetCatalogNearDuplicates: nearDuplicates,
  }
  moveToTrash = vi.fn().mockResolvedValue(undefined)
  assetLibraryStoreMock.getState.mockReturnValue({ moveToTrash })
  showToast = vi.fn()
  storeMocks.useStore.getState = () => ({ showToast })
})

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container.remove()
})

async function mount() {
  await act(async () => {
    root = createRoot(container)
    root.render(<AssetDuplicateModal open onOpenChange={vi.fn()} />)
  })
  // 等待查重 Promise 结算
  await act(async () => {})
}

function groupCount() {
  return document.querySelectorAll('[data-testid^="duplicate-group-"]').length
}

describe('AssetDuplicateModal', () => {
  it('detects duplicates with the default threshold on open', async () => {
    await mount()
    expect(nearDuplicates).toHaveBeenCalledWith(8)
    expect(groupCount()).toBe(2)
  })

  it('re-runs detection (debounced) when the threshold slider changes', async () => {
    vi.useFakeTimers()
    try {
      await mount()
      const slider = document.querySelector<HTMLInputElement>('#asset-duplicate-threshold')!
      await act(async () => {
        // React 受控 range：走原生 value setter + change 事件
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
        setter.call(slider, '3')
        slider.dispatchEvent(new Event('change', { bubbles: true }))
      })
      // 防抖窗口内不触发查重（连续滑动只发一次）
      expect(nearDuplicates).toHaveBeenLastCalledWith(8)
      await act(async () => {
        vi.advanceTimersByTime(300)
      })
      expect(nearDuplicates).toHaveBeenLastCalledWith(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('trashes all non-kept assets in one click', async () => {
    await mount()
    const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('全部处理'))!
    await act(async () => {
      button.click()
    })
    // 默认每组保留第一张：a1、b1 → 其余 3 张全部移入回收站
    expect(moveToTrash).toHaveBeenCalledWith(['a2', 'a3', 'b2'])
    expect(showToast).toHaveBeenCalled()
    expect(groupCount()).toBe(0)
  })

  it('trashes the other assets of a single group', async () => {
    await mount()
    const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('移入回收站'))!
    await act(async () => {
      button.click()
    })
    expect(moveToTrash).toHaveBeenCalledWith(['a2', 'a3'])
  })
})
