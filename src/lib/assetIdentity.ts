import type { AssetBlob, AssetVersion, GeneratedAsset, StoredImage } from '../types'

export const ASSET_METADATA_VERSION = 2

function safeIdentityPart(value: string): string {
  return encodeURIComponent(value)
}

export function ensureAssetIdentity(asset: GeneratedAsset): GeneratedAsset {
  const blobId = asset.blobId || `blob:${safeIdentityPart(asset.imageId)}`
  const currentVersionId =
    asset.currentVersionId || `version:${safeIdentityPart(asset.id)}:${safeIdentityPart(asset.imageId)}`
  if (
    blobId === asset.blobId &&
    currentVersionId === asset.currentVersionId &&
    asset.metadataVersion >= ASSET_METADATA_VERSION
  )
    return asset
  return {
    ...asset,
    blobId,
    currentVersionId,
    metadataVersion: Math.max(asset.metadataVersion || 1, ASSET_METADATA_VERSION),
  }
}

export function materializeAssetRecords(
  input: GeneratedAsset,
  image?: Pick<StoredImage, 'localPath' | 'createdAt'>,
  parentVersionIds: string[] = [],
): { asset: GeneratedAsset; blob: AssetBlob; version: AssetVersion } {
  const asset = ensureAssetIdentity(input)
  const blob: AssetBlob = {
    id: asset.blobId!,
    contentHash: asset.imageId,
    mimeType: asset.mimeType,
    byteSize: asset.byteSize,
    localPath: image?.localPath,
    createdAt: image?.createdAt ?? asset.createdAt,
  }
  const version: AssetVersion = {
    id: asset.currentVersionId!,
    assetId: asset.id,
    blobId: blob.id,
    versionNumber: 1,
    kind: asset.parentAssetIds.length > 0 ? 'postprocess' : 'original',
    createdAt: asset.createdAt,
    width: asset.width,
    height: asset.height,
    parentVersionIds: [...new Set(parentVersionIds)],
  }
  return { asset, blob, version }
}

export function createLogicalAssetId(): string {
  return `asset:${crypto.randomUUID()}`
}
