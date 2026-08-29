import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  collectCompositeAssetIds,
  dataUrlToCompositeBlob,
  isCompositeAssetReferenced,
  storeCompositeBlobs,
} from './compositeAssets'
import { createDefaultCompositeV2Preset } from './compositeV2Defaults'

afterEach(() => vi.restoreAllMocks())

describe('composite assets', () => {
  it('deduplicates equal blobs and returns one id per input', async () => {
    const putMany = vi.fn().mockResolvedValue(undefined)
    const ids = await storeCompositeBlobs([new Blob(['same']), new Blob(['same'])], { putMany, now: () => 1 })

    expect(ids[0]).toBe(ids[1])
    expect(putMany).toHaveBeenCalledTimes(1)
    expect(putMany.mock.calls[0]![0]).toHaveLength(1)
  })

  it('converts a data URL to a Blob with its MIME type', async () => {
    const blob = await dataUrlToCompositeBlob('data:image/png;base64,YQ==')
    expect(blob.type).toBe('image/png')
    await expect(blob.text()).resolves.toBe('a')
  })

  it('collects unique library and preset references', () => {
    const preset = createDefaultCompositeV2Preset(1)
    preset.layers = [
      {
        id: 'logo-layer',
        type: 'logo',
        name: 'Logo',
        visible: true,
        locked: false,
        opacity: 1,
        rotation: 0,
        position: { mode: 'free', x: 0, y: 0, width: 10, height: 10 },
        shadow: { enabled: false, color: '#000', x: 0, y: 0, blur: 0, opacity: 0 },
        asset: { kind: 'stored', assetId: 'asset-b', name: 'b.png' },
        radius: 0,
        clip: false,
      },
    ]
    const state = {
      projectLogos: [{ id: 'logo-a', name: 'A', assetId: 'asset-a' }],
      presets: [preset],
    }

    expect(collectCompositeAssetIds(state)).toEqual(['asset-a', 'asset-b'])
    expect(isCompositeAssetReferenced(state, 'asset-b')).toBe(true)
    expect(isCompositeAssetReferenced(state, 'missing')).toBe(false)
  })
})
