import { describe, expect, it } from 'vitest'
import type { WordLibraryEntry } from '../types'
import { filterWordLibraryEntries } from './WordLibraryQuickPanel'

function entry(id: string, patch: Partial<WordLibraryEntry> = {}): WordLibraryEntry {
  return {
    id,
    groupId: 'group-a',
    key: id,
    label: id,
    entries: [],
    draw_count: 1,
    sortOrder: 0,
    isPinned: false,
    isFavorite: false,
    tags: [],
    deletedAt: null,
    createdAt: 1,
    updatedAt: 1,
    usageCount: 0,
    ...patch,
  }
}

describe('filterWordLibraryEntries', () => {
  it('finds matches in names, candidate values, and tags while excluding trash', () => {
    const entries = [
      entry('name-match', { key: '产品摄影' }),
      entry('value-match', { entries: ['电影级光影'] }),
      entry('tag-match', { tags: ['光影'] }),
      entry('deleted-match', { key: '光影', deletedAt: 10 }),
    ]

    expect(
      filterWordLibraryEntries({
        entries,
        query: '光影',
        view: 'all',
        groupId: '__all__',
      }).map((item) => item.id),
    ).toEqual(['value-match', 'tag-match'])
  })

  it('keeps favorites focused and puts pinned entries first', () => {
    const entries = [
      entry('recent-favorite', { isFavorite: true, updatedAt: 30, sortOrder: 2 }),
      entry('pinned-favorite', { isFavorite: true, isPinned: true, updatedAt: 10, sortOrder: 3 }),
      entry('not-favorite', { updatedAt: 40 }),
    ]

    expect(
      filterWordLibraryEntries({
        entries,
        query: '',
        view: 'favorites',
        groupId: '__all__',
      }).map((item) => item.id),
    ).toEqual(['pinned-favorite', 'recent-favorite'])
  })

  it('limits the recent view after sorting by update time', () => {
    const entries = [entry('old', { updatedAt: 1 }), entry('middle', { updatedAt: 2 }), entry('new', { updatedAt: 3 })]

    expect(
      filterWordLibraryEntries({
        entries,
        query: '',
        view: 'recent',
        groupId: '__all__',
        limit: 2,
      }).map((item) => item.id),
    ).toEqual(['new', 'middle'])
  })
})
