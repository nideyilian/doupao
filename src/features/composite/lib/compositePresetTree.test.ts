import { describe, expect, it } from 'vitest'
import { createBlankCompositePage, createBlankCompositeCategory } from './compositeDefaults'
import { duplicateCompositePage, getEnabledCompositePages, moveCompositePage } from './compositePresetTree'

describe('composite preset tree helpers', () => {
  it('excludes child pages when the parent category is disabled', () => {
    const enabledPage = createBlankCompositePage('page-a', '页面 A')
    const categories = [{ ...createBlankCompositeCategory('cat-a', '类目 A'), enabled: false, pages: [enabledPage] }]

    expect(getEnabledCompositePages(categories)).toEqual([])
  })

  it('returns enabled pages from enabled categories only', () => {
    const pageA = createBlankCompositePage('page-a', '页面 A')
    const pageB = { ...createBlankCompositePage('page-b', '页面 B'), enabled: false }
    const categories = [{ ...createBlankCompositeCategory('cat-a', '类目 A'), enabled: true, pages: [pageA, pageB] }]

    expect(getEnabledCompositePages(categories).map((entry) => entry.page.id)).toEqual(['page-a'])
  })

  it('duplicates a page with copied preset data and a distinct id', () => {
    const page = createBlankCompositePage('page-a', '页面 A')
    const duplicate = duplicateCompositePage(page, 'page-copy')

    expect(duplicate.id).toBe('page-copy')
    expect(duplicate.name).toBe('页面 A 副本')
    expect(duplicate.preset.id).toBe('preset-page-copy')
    expect(duplicate.preset.name).toBe('页面 A 副本')
    expect(duplicate.preset.canvas).toEqual(page.preset.canvas)
    expect(duplicate.preset.layers).toEqual(page.preset.layers)
    expect(duplicate.preset.output).toEqual(page.preset.output)
    expect(duplicate.preset).not.toBe(page.preset)
  })

  it('moves a page between categories', () => {
    const page = createBlankCompositePage('page-a', '页面 A')
    const categories = [
      { ...createBlankCompositeCategory('cat-a', '类目 A'), pages: [page] },
      { ...createBlankCompositeCategory('cat-b', '类目 B'), pages: [] },
    ]

    const next = moveCompositePage(categories, 'page-a', 'cat-b', 0)

    expect(next[0].pages).toHaveLength(0)
    expect(next[1].pages.map((item) => item.id)).toEqual(['page-a'])
  })
})
