import { describe, expect, it } from 'vitest'
import type { AssetLibraryFilters } from '../../types'
import {
  isPinnedFilterActive,
  pinnedFilterKey,
  pinnedFilterLabel,
  pinnedFilterRemovalPatch,
  pinnedFilterToPatch,
} from './pinnedFilters'

describe('pinnedFilterKey', () => {
  it('builds a stable key per kind+value', () => {
    expect(pinnedFilterKey({ kind: 'favoriteOnly' })).toBe('favoriteOnly')
    expect(pinnedFilterKey({ kind: 'minRating', value: 4 })).toBe('minRating:4')
    expect(pinnedFilterKey({ kind: 'orientation', value: 'landscape' })).toBe('orientation:landscape')
    expect(pinnedFilterKey({ kind: 'sourceMode', value: 'agent' })).toBe('sourceMode:agent')
    expect(pinnedFilterKey({ kind: 'colorLabel', value: 'red' })).toBe('colorLabel:red')
    expect(pinnedFilterKey({ kind: 'provider', value: '豆包' })).toBe('provider:豆包')
    expect(pinnedFilterKey({ kind: 'model', value: 'gpt-image-1' })).toBe('model:gpt-image-1')
  })
})

describe('pinnedFilterLabel', () => {
  it('renders precise human labels consistent with the tab bar', () => {
    expect(pinnedFilterLabel({ kind: 'favoriteOnly' })).toBe('仅看收藏')
    expect(pinnedFilterLabel({ kind: 'minRating', value: 4 })).toBe('4 星及以上')
    expect(pinnedFilterLabel({ kind: 'orientation', value: 'portrait' })).toBe('纵向')
    expect(pinnedFilterLabel({ kind: 'orientation', value: 'landscape' })).toBe('横向')
    expect(pinnedFilterLabel({ kind: 'sourceMode', value: 'sop' })).toBe('SOP 生成')
    expect(pinnedFilterLabel({ kind: 'sourceMode', value: 'gallery' })).toBe('画廊生成')
    expect(pinnedFilterLabel({ kind: 'sourceMode', value: 'unknown' })).toBe('未知来源')
    expect(pinnedFilterLabel({ kind: 'colorLabel', value: 'green' })).toBe('绿色')
    expect(pinnedFilterLabel({ kind: 'provider', value: '豆包' })).toBe('服务商：豆包')
    expect(pinnedFilterLabel({ kind: 'model', value: 'gpt-image-1' })).toBe('模型：gpt-image-1')
  })
})

describe('pinnedFilterToPatch / pinnedFilterRemovalPatch', () => {
  it('maps each kind to the matching filters patch', () => {
    expect(pinnedFilterToPatch({ kind: 'favoriteOnly' })).toEqual({ favoriteOnly: true })
    expect(pinnedFilterToPatch({ kind: 'minRating', value: 3 })).toEqual({ minRating: 3 })
    expect(pinnedFilterToPatch({ kind: 'orientation', value: 'square' })).toEqual({ orientation: 'square' })
    expect(pinnedFilterToPatch({ kind: 'sourceMode', value: 'schedule' })).toEqual({ sourceMode: 'schedule' })
    expect(pinnedFilterToPatch({ kind: 'colorLabel', value: 'blue' })).toEqual({ colorLabel: 'blue' })
    expect(pinnedFilterToPatch({ kind: 'provider', value: 'fal' })).toEqual({ provider: 'fal' })
    expect(pinnedFilterToPatch({ kind: 'model', value: 'm1' })).toEqual({ model: 'm1' })
  })

  it('removal patches clear only the pinned condition', () => {
    expect(pinnedFilterRemovalPatch({ kind: 'favoriteOnly' })).toEqual({ favoriteOnly: undefined })
    expect(pinnedFilterRemovalPatch({ kind: 'minRating', value: 3 })).toEqual({ minRating: undefined })
    expect(pinnedFilterRemovalPatch({ kind: 'orientation', value: 'square' })).toEqual({ orientation: undefined })
    expect(pinnedFilterRemovalPatch({ kind: 'sourceMode', value: 'schedule' })).toEqual({ sourceMode: undefined })
    expect(pinnedFilterRemovalPatch({ kind: 'colorLabel', value: 'blue' })).toEqual({ colorLabel: undefined })
    expect(pinnedFilterRemovalPatch({ kind: 'provider', value: 'fal' })).toEqual({ provider: undefined })
    expect(pinnedFilterRemovalPatch({ kind: 'model', value: 'm1' })).toEqual({ model: undefined })
  })
})

describe('isPinnedFilterActive', () => {
  const filters: AssetLibraryFilters = {
    favoriteOnly: true,
    minRating: 4,
    orientation: 'landscape',
    sourceMode: 'gallery',
    colorLabel: 'red',
    provider: '豆包',
    model: 'gpt-image-1',
  }

  it('detects whether the pinned condition is currently applied', () => {
    expect(isPinnedFilterActive({ kind: 'favoriteOnly' }, filters)).toBe(true)
    expect(isPinnedFilterActive({ kind: 'minRating', value: 4 }, filters)).toBe(true)
    expect(isPinnedFilterActive({ kind: 'minRating', value: 3 }, filters)).toBe(false)
    expect(isPinnedFilterActive({ kind: 'orientation', value: 'landscape' }, filters)).toBe(true)
    expect(isPinnedFilterActive({ kind: 'orientation', value: 'portrait' }, filters)).toBe(false)
    expect(isPinnedFilterActive({ kind: 'sourceMode', value: 'gallery' }, filters)).toBe(true)
    expect(isPinnedFilterActive({ kind: 'colorLabel', value: 'red' }, filters)).toBe(true)
    expect(isPinnedFilterActive({ kind: 'provider', value: '豆包' }, filters)).toBe(true)
    expect(isPinnedFilterActive({ kind: 'provider', value: 'fal' }, filters)).toBe(false)
    expect(isPinnedFilterActive({ kind: 'model', value: 'gpt-image-1' }, filters)).toBe(true)
  })

  it('treats absent conditions as inactive', () => {
    expect(isPinnedFilterActive({ kind: 'favoriteOnly' }, {})).toBe(false)
    expect(isPinnedFilterActive({ kind: 'minRating', value: 5 }, {})).toBe(false)
  })
})
