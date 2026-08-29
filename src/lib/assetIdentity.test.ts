import { describe, expect, it } from 'vitest'
import type { GeneratedAsset } from '../types'
import { ensureAssetIdentity, materializeAssetRecords } from './assetIdentity'

function legacyAsset(): GeneratedAsset {
  return {
    id: 'sha256-image',
    imageId: 'sha256-image',
    status: 'active',
    createdAt: 10,
    updatedAt: 20,
    trashedAt: null,
    favorite: false,
    rating: 0,
    collectionIds: [],
    tagIds: [],
    origins: [],
    primaryOriginKey: null,
    parentAssetIds: [],
    mimeType: 'image/png',
    byteSize: 42,
    metadataVersion: 1,
  }
}

describe('asset identity migration', () => {
  it('adds independent blob and version identities without changing a legacy public asset id', () => {
    const migrated = ensureAssetIdentity(legacyAsset())
    expect(migrated.id).toBe('sha256-image')
    expect(migrated.blobId).toBe('blob:sha256-image')
    expect(migrated.currentVersionId).toBe('version:sha256-image:sha256-image')
    expect(migrated.metadataVersion).toBe(2)
  })

  it('materializes one blob and one version record from the compatibility projection', () => {
    const { asset, blob, version } = materializeAssetRecords(legacyAsset(), { localPath: 'D:/images/a.png' })
    expect(asset.blobId).toBe(blob.id)
    expect(asset.currentVersionId).toBe(version.id)
    expect(blob.contentHash).toBe('sha256-image')
    expect(version.assetId).toBe('sha256-image')
    expect(version.blobId).toBe(blob.id)
    expect(blob.localPath).toBe('D:/images/a.png')
  })
})
