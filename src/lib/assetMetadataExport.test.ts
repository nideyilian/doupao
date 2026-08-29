import { describe, expect, it } from 'vitest'
import { buildAssetMetadataJsonl, pickAssetMetadataFields } from './assetMetadataExport'
import type { GeneratedAsset } from '../types'

function makeAsset(overrides: Partial<GeneratedAsset> = {}): GeneratedAsset {
  return {
    id: 'asset-a',
    imageId: 'sha256-abc',
    blobId: 'blob:sha256-abc',
    currentVersionId: 'version:sha256-abc',
    status: 'active',
    createdAt: 1000,
    updatedAt: 2000,
    trashedAt: null,
    favorite: true,
    rating: 4,
    colorLabel: 'red',
    collectionIds: ['c1'],
    tagIds: ['t1'],
    notes: '备注',
    origins: [
      {
        kind: 'generated',
        key: 'task:t1',
        taskId: 't1',
        outputSlot: 0,
        taskCreatedAt: 1000,
        taskFinishedAt: 1000,
        sourceMode: 'gallery',
        prompt: 'hello',
        requestedParams: {} as never,
        inputImageIds: [],
        maskTargetImageId: null,
        maskImageId: null,
      },
    ],
    primaryOriginKey: 'task:t1',
    parentAssetIds: ['parent-1'],
    width: 1024,
    height: 1024,
    mimeType: 'image/png',
    byteSize: 1234,
    metadataVersion: 2,
    ...overrides,
  }
}

describe('buildAssetMetadataJsonl', () => {
  it('emits one JSON line per asset with the documented fields', () => {
    const content = buildAssetMetadataJsonl([makeAsset(), makeAsset({ id: 'asset-b', rating: 0 })])
    const lines = content.trimEnd().split('\n')
    expect(lines).toHaveLength(2)

    const first = JSON.parse(lines[0]!) as Record<string, unknown>
    expect(first.id).toBe('asset-a')
    expect(first.imageId).toBe('sha256-abc')
    expect(first.status).toBe('active')
    expect(first.favorite).toBe(true)
    expect(first.rating).toBe(4)
    expect(first.collectionIds).toEqual(['c1'])
    expect(first.tagIds).toEqual(['t1'])
    expect(first.notes).toBe('备注')
    expect(first.origins).toHaveLength(1)
    expect((first.origins as Array<{ prompt: string }>)[0]!.prompt).toBe('hello')
    expect(first.parentAssetIds).toEqual(['parent-1'])
    expect(first.width).toBe(1024)
    expect(first.createdAt).toBe(1000)
    expect(first.metadataVersion).toBe(2)
  })

  it('omits undefined optional fields', () => {
    const asset = makeAsset({ colorLabel: undefined, notes: undefined, blobId: undefined })
    const line = buildAssetMetadataJsonl([asset]).trimEnd()
    const parsed = JSON.parse(line) as Record<string, unknown>
    expect(parsed.colorLabel).toBeUndefined()
    expect(parsed.notes).toBeUndefined()
    expect(parsed.blobId).toBeUndefined()
    // 核心字段仍然存在
    expect(parsed.id).toBe('asset-a')
  })

  it('returns an empty string for an empty library', () => {
    expect(buildAssetMetadataJsonl([])).toBe('')
  })

  it('pickAssetMetadataFields only keeps whitelisted fields', () => {
    const asset = makeAsset()
    const picked = pickAssetMetadataFields(asset) as Record<string, unknown>
    expect(Object.keys(picked).sort()).toEqual(
      [
        'blobId',
        'byteSize',
        'collectionIds',
        'colorLabel',
        'createdAt',
        'currentVersionId',
        'favorite',
        'height',
        'id',
        'imageId',
        'metadataVersion',
        'mimeType',
        'notes',
        'origins',
        'parentAssetIds',
        'primaryOriginKey',
        'rating',
        'status',
        'tagIds',
        'trashedAt',
        'updatedAt',
        'width',
      ].sort(),
    )
  })
})
