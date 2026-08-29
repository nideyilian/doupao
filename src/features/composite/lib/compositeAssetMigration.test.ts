import { describe, expect, it, vi } from 'vitest'
import { createCompositeV2Store } from '../storeV2'
import { migrateLegacyCompositeAssets } from './compositeAssetMigration'

describe('composite asset migration', () => {
  it('migrates library, data URL, and project references after storing blobs', async () => {
    const store = createCompositeV2Store()
    const preset = store.getState().presets[0]!
    store.setState({
      projectLogos: [{ id: 'logo-a', name: 'A', dataUrl: 'data:image/png;base64,YQ==' }],
      presets: [
        {
          ...preset,
          layers: [
            mediaLayer('layer-data', { kind: 'dataUrl', dataUrl: 'data:image/png;base64,Yg==', name: 'B' }),
            mediaLayer('layer-project', { kind: 'project', id: 'logo-a' }),
          ],
        },
      ],
    } as any)
    const storeAssets = vi.fn(async (blobs: Blob[]) => blobs.map((_, index) => `asset-${index}`))

    const count = await migrateLegacyCompositeAssets({
      getState: store.getState,
      setState: (patch) => store.setState(patch),
      storeAssets,
    })

    expect(count).toBe(2)
    expect(store.getState().projectLogos[0]).toEqual({ id: 'logo-a', name: 'A', assetId: 'asset-0' })
    expect(store.getState().presets[0]!.layers.map((layer: any) => layer.asset)).toEqual([
      { kind: 'stored', assetId: 'asset-1', name: 'B' },
      { kind: 'stored', assetId: 'asset-0', name: 'A' },
    ])
    expect(JSON.stringify(store.getState().projectLogos)).not.toContain('base64,')
  })

  it('does not change state when storing a legacy asset fails', async () => {
    const store = createCompositeV2Store()
    store.setState({
      projectLogos: [{ id: 'logo-a', name: 'A', dataUrl: 'data:image/png;base64,YQ==' }],
    } as any)
    const before = store.getState().projectLogos

    await expect(
      migrateLegacyCompositeAssets({
        getState: store.getState,
        setState: (patch) => store.setState(patch),
        storeAssets: async () => {
          throw new Error('quota')
        },
      }),
    ).rejects.toThrow('quota')

    expect(store.getState().projectLogos).toBe(before)
  })
})

function mediaLayer(id: string, asset: any) {
  return {
    id,
    type: 'logo' as const,
    name: id,
    visible: true,
    locked: false,
    opacity: 1,
    rotation: 0,
    position: { mode: 'free' as const, x: 0, y: 0, width: 10, height: 10 },
    shadow: { enabled: false, color: '#000', x: 0, y: 0, blur: 0, opacity: 0 },
    asset,
    radius: 0,
    clip: false,
  }
}
