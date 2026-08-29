import { describe, expect, it } from 'vitest'
import type { AssetCollection } from '../types'
import { resolveCollectionFolderSegments } from './collectionPath'

function collection(id: string, name: string, parentId: string | null = null): AssetCollection {
  return {
    id,
    name,
    normalizedName: name,
    parentId,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('resolveCollectionFolderSegments', () => {
  const collections: AssetCollection[] = [
    collection('app', 'APP'),
    collection('drama', '短剧'),
    collection('drama-sub', '古装', 'drama'),
    collection('drama-sub-2', '现代', 'drama'),
    collection('deep', '子项目', 'drama-sub'),
  ]

  it('resolves a top-level project to a single segment', () => {
    expect(resolveCollectionFolderSegments(collections, 'app')).toEqual(['APP'])
  })

  it('resolves a nested project to the full ancestor chain (top-level first)', () => {
    expect(resolveCollectionFolderSegments(collections, 'deep')).toEqual(['短剧', '古装', '子项目'])
    expect(resolveCollectionFolderSegments(collections, 'drama-sub')).toEqual(['短剧', '古装'])
  })

  it('returns null for an unknown collection id', () => {
    expect(resolveCollectionFolderSegments(collections, 'missing')).toBeNull()
  })

  it('returns null when no collections are loaded', () => {
    expect(resolveCollectionFolderSegments([], 'app')).toBeNull()
  })

  it('terminates on a cyclic parent chain instead of looping forever', () => {
    const a = collection('a', 'A', 'b')
    const b = collection('b', 'B', 'a')
    const segments = resolveCollectionFolderSegments([a, b], 'a')
    // a 的父是 b，祖先在前：B → A；回到已访问的 a 时终止
    expect(segments).toEqual(['B', 'A'])
  })

  it('stops the chain when a parent id is missing from the tree', () => {
    const child = collection('child', '孤儿子项目', 'ghost-parent')
    expect(resolveCollectionFolderSegments([child], 'child')).toEqual(['孤儿子项目'])
  })
})
