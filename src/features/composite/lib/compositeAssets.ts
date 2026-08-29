import type { StoredCompositeAsset } from '../../../types'
import { deleteCompositeAsset, getCompositeAsset, putCompositeAssets } from '../../../lib/db'
import type { CompositeV2Preset, CompositeV2ProjectLogo } from './compositeV2Types'
import { ByteLruCache } from '../../../lib/byteLruCache'

type AssetState = {
  projectLogos: CompositeV2ProjectLogo[]
  presets: CompositeV2Preset[]
}

type StoreCompositeBlobDeps = {
  putMany: (assets: StoredCompositeAsset[]) => Promise<void>
  now: () => number
}

const objectUrlCache = new ByteLruCache<string, string>(64 * 1024 * 1024, (url) => URL.revokeObjectURL(url))

export async function hashCompositeBlob(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')
  }
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (const value of bytes) {
    h1 = Math.imul(h1 ^ value, 0x01000193)
    h2 = Math.imul(h2 ^ value, 0x27d4eb2d)
  }
  return `fallback-${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`
}

export async function dataUrlToCompositeBlob(dataUrl: string): Promise<Blob> {
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/.exec(dataUrl)
  if (!match) throw new Error('Invalid composite asset data URL')
  const mime = match[1] || 'application/octet-stream'
  const isBase64 = dataUrl.slice(0, dataUrl.indexOf(',')).includes(';base64')
  if (!isBase64) return new Blob([decodeURIComponent(match[2])], { type: mime })
  const binary = atob(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: mime })
}

export async function storeCompositeBlobs(
  blobs: Blob[],
  deps: StoreCompositeBlobDeps = { putMany: putCompositeAssets, now: Date.now },
): Promise<string[]> {
  const ids = await Promise.all(blobs.map(hashCompositeBlob))
  const unique = new Map<string, StoredCompositeAsset>()
  ids.forEach((id, index) => {
    if (!unique.has(id)) unique.set(id, { id, blob: blobs[index]!, createdAt: deps.now() })
  })
  await deps.putMany([...unique.values()])
  return ids
}

export async function getCompositeAssetObjectUrl(assetId: string): Promise<string | null> {
  const cached = objectUrlCache.get(assetId)
  if (cached) return cached
  const asset = await getCompositeAsset(assetId)
  if (!asset) return null
  const url = URL.createObjectURL(asset.blob)
  objectUrlCache.set(assetId, url, asset.blob.size)
  return url
}

export function revokeCompositeAssetObjectUrl(assetId: string): void {
  const url = objectUrlCache.get(assetId)
  if (!url) return
  objectUrlCache.delete(assetId)
}

export async function removeCompositeAsset(assetId: string): Promise<void> {
  await deleteCompositeAsset(assetId)
  revokeCompositeAssetObjectUrl(assetId)
}

export function collectCompositeAssetIds(state: AssetState): string[] {
  const ids = new Set<string>()
  for (const logo of state.projectLogos) if (logo.assetId) ids.add(logo.assetId)
  for (const preset of state.presets) {
    for (const layer of preset.layers) {
      if ((layer.type === 'image' || layer.type === 'logo') && layer.asset?.kind === 'stored') {
        ids.add(layer.asset.assetId)
      }
    }
  }
  return [...ids]
}

export function isCompositeAssetReferenced(state: AssetState, assetId: string): boolean {
  return collectCompositeAssetIds(state).includes(assetId)
}
