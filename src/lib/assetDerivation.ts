import type { AssetUsageTarget, GeneratedAsset } from '../types'

interface AssetDerivationDependencies {
  storeImage: (dataUrl: string, source: 'generated') => Promise<string>
  getAssetsByImageIds: (imageIds: string[]) => Promise<Map<string, GeneratedAsset>>
  createDerivedAsset: (input: {
    imageId: string
    parentAssetIds: string[]
    target: 'postprocess' | 'composite'
  }) => Promise<GeneratedAsset | null>
}

async function defaults(): Promise<AssetDerivationDependencies> {
  const [{ storeImage }, { getAssetsByImageIds }, { assetCommands }] = await Promise.all([
    import('./db'),
    import('./assetLibraryRepository'),
    import('./assetCommands'),
  ])
  return {
    storeImage: (dataUrl, source) => storeImage(dataUrl, source),
    getAssetsByImageIds,
    createDerivedAsset: (input) => assetCommands.createDerivedAsset(input),
  }
}

export async function archiveRenderedAsset(
  dataUrl: string,
  target: Extract<AssetUsageTarget, 'postprocess' | 'composite'>,
  parentImageIds: string[],
  dependencies?: AssetDerivationDependencies,
): Promise<GeneratedAsset | null> {
  if (!dependencies && typeof indexedDB === 'undefined') return null
  const deps = dependencies ?? (await defaults())
  const imageId = await deps.storeImage(dataUrl, 'generated')
  const parents = await deps.getAssetsByImageIds([...new Set(parentImageIds)])
  return deps.createDerivedAsset({
    imageId,
    parentAssetIds: [...new Set([...parents.values()].map((asset) => asset.id))],
    target,
  })
}
