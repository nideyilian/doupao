import { describe, expect, it, vi } from 'vitest'
import type { GeneratedAsset } from '../types'
import { archiveRenderedAsset } from './assetDerivation'

describe('asset derivation archival', () => {
  it('links rendered outputs to logical parent assets', async () => {
    const parent = { id: 'asset-parent' } as GeneratedAsset
    const createDerivedAsset = vi.fn(async () => null)
    await archiveRenderedAsset('data:image/png;base64,AA', 'composite', ['parent-image'], {
      storeImage: vi.fn(async () => 'output-image'),
      getAssetsByImageIds: vi.fn(async () => new Map([['parent-image', parent]])),
      createDerivedAsset,
    })
    expect(createDerivedAsset).toHaveBeenCalledWith({
      imageId: 'output-image',
      parentAssetIds: ['asset-parent'],
      target: 'composite',
    })
  })
})
