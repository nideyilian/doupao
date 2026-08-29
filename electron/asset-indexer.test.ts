import { describe, expect, it } from 'vitest'
import { indexAssetTexts } from './asset-indexer'

describe('asset utility indexer', () => {
  it('returns rebuildable model metadata and normalized vectors', () => {
    const [record] = indexAssetTexts([{ assetId: 'a', text: '橘猫产品海报' }], 100)
    expect(record.assetId).toBe('a')
    expect(record.modelId).toBe('doupao-multilingual-hash')
    expect(record.generatedAt).toBe(100)
    expect(Math.sqrt(record.textVector.reduce((sum, value) => sum + value * value, 0))).toBeCloseTo(1)
  })
})
