import type { CompositeV2StoreState } from '../storeV2'
import { dataUrlToCompositeBlob, storeCompositeBlobs } from './compositeAssets'
import type { CompositeV2ImageAssetRef, CompositeV2ProjectLogo } from './compositeV2Types'

type MigrationDeps = {
  getState: () => CompositeV2StoreState
  setState: (patch: Partial<CompositeV2StoreState>) => void
  storeAssets?: typeof storeCompositeBlobs
}

export function hasLegacyCompositeAssets(state: Pick<CompositeV2StoreState, 'projectLogos' | 'presets'>): boolean {
  if (state.projectLogos.some((logo) => typeof logo.dataUrl === 'string')) return true
  return state.presets.some((preset) =>
    preset.layers.some((layer) => {
      if (layer.type !== 'image' && layer.type !== 'logo') return false
      return layer.asset?.kind === 'dataUrl' || layer.asset?.kind === 'project'
    }),
  )
}

export async function migrateLegacyCompositeAssets(deps: MigrationDeps): Promise<number> {
  const snapshot = deps.getState()
  if (!hasLegacyCompositeAssets(snapshot)) return 0

  const dataUrls: string[] = []
  const addDataUrl = (value?: string) => {
    if (value && !dataUrls.includes(value)) dataUrls.push(value)
  }
  snapshot.projectLogos.forEach((logo) => addDataUrl(logo.dataUrl))
  snapshot.presets.forEach((preset) =>
    preset.layers.forEach((layer) => {
      if ((layer.type === 'image' || layer.type === 'logo') && layer.asset?.kind === 'dataUrl') {
        addDataUrl(layer.asset.dataUrl)
      }
    }),
  )

  const blobs = await Promise.all(dataUrls.map(dataUrlToCompositeBlob))
  const ids = await (deps.storeAssets ?? storeCompositeBlobs)(blobs)
  const assetIdByDataUrl = new Map(dataUrls.map((dataUrl, index) => [dataUrl, ids[index]!]))
  const latest = deps.getState()
  const projectLogos = latest.projectLogos.map((logo): CompositeV2ProjectLogo => {
    if (logo.assetId) return logo
    const assetId = logo.dataUrl ? assetIdByDataUrl.get(logo.dataUrl) : undefined
    if (!assetId) return logo
    return {
      id: logo.id,
      name: logo.name,
      assetId,
      width: logo.width,
      height: logo.height,
    }
  })
  const assetByProjectId = new Map(
    projectLogos.flatMap((logo) =>
      logo.assetId ? [[logo.id, { assetId: logo.assetId, name: logo.name }] as const] : [],
    ),
  )
  const presets = latest.presets.map((preset) => ({
    ...preset,
    layers: preset.layers.map((layer) => {
      if (layer.type !== 'image' && layer.type !== 'logo') return layer
      const asset = migrateAssetRef(layer.asset, assetIdByDataUrl, assetByProjectId)
      return asset === layer.asset ? layer : { ...layer, asset }
    }),
  }))

  deps.setState({ projectLogos, presets })
  return new Set(ids).size
}

function migrateAssetRef(
  asset: CompositeV2ImageAssetRef | null,
  assetIdByDataUrl: Map<string, string>,
  assetByProjectId: Map<string, { assetId: string; name: string }>,
): CompositeV2ImageAssetRef | null {
  if (!asset) return asset
  if (asset.kind === 'dataUrl') {
    const assetId = assetIdByDataUrl.get(asset.dataUrl)
    return assetId ? { kind: 'stored', assetId, name: asset.name } : asset
  }
  if (asset.kind === 'project') {
    const resolved = assetByProjectId.get(asset.id)
    return resolved ? { kind: 'stored', ...resolved } : asset
  }
  return asset
}
