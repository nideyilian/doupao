import { describe, expect, it } from 'vitest'
import type { AssetCollection } from '../types'
import {
  ASSET_IDS_DATA_TYPE,
  ASSET_SOURCE_DATA_TYPE,
  canAcceptAssetDrag,
  computeMoveDestinations,
  computeRecursiveCollectionCounts,
  filterCollectionTree,
  parseAssetImagePayload,
  parseAssetImagePayloadList,
  parseAssetSourceCollectionId,
  type CollectionTreeNode,
} from './assetSidebarUtils'

function makeCollection(id: string, name: string, parentId: string | null = null, order = 0): AssetCollection {
  return { id, name, normalizedName: name, parentId, order, createdAt: 1, updatedAt: 1 }
}

describe('filterCollectionTree', () => {
  it('keeps a matched node with its whole subtree', () => {
    const tree: CollectionTreeNode[] = [
      {
        collection: makeCollection('a', '品牌'),
        children: [{ collection: makeCollection('b', '海报'), children: [] }],
      },
    ]
    const result = filterCollectionTree(tree, (node) => node.collection.name.includes('品牌'))
    expect(result).toHaveLength(1)
    expect(result[0]?.collection.id).toBe('a')
    expect(result[0]?.children).toHaveLength(1)
  })

  it('keeps the ancestor chain of a matched descendant', () => {
    const tree: CollectionTreeNode[] = [
      {
        collection: makeCollection('a', '品牌'),
        children: [{ collection: makeCollection('b', '海报'), children: [] }],
      },
    ]
    const result = filterCollectionTree(tree, (node) => node.collection.name.includes('海报'))
    expect(result).toHaveLength(1)
    expect(result[0]?.collection.id).toBe('a')
    expect(result[0]?.children.map((child) => child.collection.id)).toEqual(['b'])
  })

  it('drops branches without matches', () => {
    const tree: CollectionTreeNode[] = [
      {
        collection: makeCollection('a', '品牌'),
        children: [{ collection: makeCollection('b', '海报'), children: [] }],
      },
      { collection: makeCollection('c', '草稿'), children: [] },
    ]
    const result = filterCollectionTree(tree, (node) => node.collection.name.includes('海报'))
    expect(result.map((node) => node.collection.id)).toEqual(['a'])
  })
})

describe('parseAssetImagePayload', () => {
  it('parses asset-image payloads and rejects others', () => {
    const withText = (text: string): DataTransfer => ({ getData: () => text }) as unknown as DataTransfer
    expect(parseAssetImagePayload(withText('asset-image:abc123'))).toBe('abc123')
    expect(parseAssetImagePayload(withText('asset-image:  abc123  '))).toBe('abc123')
    expect(parseAssetImagePayload(withText('asset-image:'))).toBeNull()
    expect(parseAssetImagePayload(withText('agent-images:abc'))).toBeNull()
    expect(parseAssetImagePayload(null)).toBeNull()
  })
})

describe('parseAssetImagePayloadList', () => {
  const withData = (map: Record<string, string>): DataTransfer =>
    ({ getData: (type: string) => map[type] ?? '' }) as unknown as DataTransfer

  it('prefers the multi-drag payload with all selected asset ids', () => {
    const list = parseAssetImagePayloadList(
      withData({
        'text/plain': 'asset-image:first',
        [ASSET_IDS_DATA_TYPE]: JSON.stringify(['asset:a', 'asset:b', 'asset:c']),
      }),
    )
    expect(list).toEqual(['asset:a', 'asset:b', 'asset:c'])
  })

  it('falls back to the single asset-image payload when no multi payload exists', () => {
    expect(parseAssetImagePayloadList(withData({ 'text/plain': 'asset-image:img-1' }))).toEqual(['img-1'])
  })

  it('falls back when the multi payload is malformed or empty', () => {
    expect(
      parseAssetImagePayloadList(withData({ 'text/plain': 'asset-image:img-1', [ASSET_IDS_DATA_TYPE]: 'not-json' })),
    ).toEqual(['img-1'])
    expect(
      parseAssetImagePayloadList(withData({ 'text/plain': 'asset-image:img-1', [ASSET_IDS_DATA_TYPE]: '[]' })),
    ).toEqual(['img-1'])
  })

  it('returns an empty list for non-asset drags', () => {
    expect(parseAssetImagePayloadList(withData({ 'text/plain': 'agent-images:abc' }))).toEqual([])
    expect(parseAssetImagePayloadList(null)).toEqual([])
  })
})

describe('parseAssetSourceCollectionId', () => {
  const withData = (map: Record<string, string>): DataTransfer =>
    ({ getData: (type: string) => map[type] ?? '' }) as unknown as DataTransfer

  it('returns the source folder id when dragging from a folder scope', () => {
    expect(parseAssetSourceCollectionId(withData({ [ASSET_SOURCE_DATA_TYPE]: 'folder-a' }))).toBe('folder-a')
  })

  it('returns null when dragging from a non-folder scope or without a payload', () => {
    expect(parseAssetSourceCollectionId(withData({ 'text/plain': 'asset-image:img-1' }))).toBeNull()
    expect(parseAssetSourceCollectionId(null)).toBeNull()
  })
})

describe('canAcceptAssetDrag', () => {
  it('accepts text/plain drags and rejects files', () => {
    const withTypes = (types: string[]): DataTransfer => ({ types }) as unknown as DataTransfer
    expect(canAcceptAssetDrag(withTypes(['text/plain']))).toBe(true)
    expect(canAcceptAssetDrag(withTypes(['Files']))).toBe(false)
    expect(canAcceptAssetDrag(withTypes(['text/plain', 'Files']))).toBe(false)
    expect(canAcceptAssetDrag(null)).toBe(false)
  })
})

describe('computeMoveDestinations', () => {
  it('excludes the target and its descendants and prepends the root entry', () => {
    const items = [
      makeCollection('root', '根'),
      makeCollection('child', '子', 'root'),
      makeCollection('grand', '孙', 'child'),
      makeCollection('other', '其他'),
    ]
    const destinations = computeMoveDestinations(items, 'child')
    const ids = destinations.map((destination) => destination.id)
    expect(ids).toEqual([null, 'root', 'other'])
    expect(destinations.find((destination) => destination.id === 'root')?.depth).toBe(1)
    expect(destinations.find((destination) => destination.id === 'other')?.depth).toBe(1)
  })
})

describe('computeRecursiveCollectionCounts', () => {
  it('sums direct and descendant counts into every ancestor', () => {
    const collections = [
      makeCollection('root', '根'),
      makeCollection('child', '子', 'root'),
      makeCollection('grand', '孙', 'child'),
      makeCollection('other', '其他'),
    ]
    const byCollection = new Map([
      ['root', 1],
      ['child', 2],
      ['grand', 3],
      ['other', 5],
    ])
    const counts = computeRecursiveCollectionCounts(collections, byCollection)
    expect(counts.get('root')).toBe(6)
    expect(counts.get('child')).toBe(5)
    expect(counts.get('grand')).toBe(3)
    expect(counts.get('other')).toBe(5)
  })

  it('keeps direct counts for nodes with broken parent chains', () => {
    const collections = [makeCollection('orphan', '孤儿', 'missing-parent')]
    const byCollection = new Map([['orphan', 4]])
    const counts = computeRecursiveCollectionCounts(collections, byCollection)
    expect(counts.get('orphan')).toBe(4)
  })
})
