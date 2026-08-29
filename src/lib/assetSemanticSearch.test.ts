import { describe, expect, it } from 'vitest'
import { cosineSimilarity, createTextVector, hammingSimilarity, rankAssetCandidates } from './assetSemanticSearch'

describe('asset semantic search', () => {
  it('creates normalized multilingual vectors with useful Chinese similarity', () => {
    const query = createTextVector('橘猫 电商广告')
    const related = createTextVector('电商海报里的橘色猫咪')
    const unrelated = createTextVector('雪山风景摄影')
    expect(cosineSimilarity(query, related)).toBeGreaterThan(cosineSimilarity(query, unrelated))
  })

  it('compares perceptual hashes by normalized hamming distance', () => {
    expect(hammingSimilarity('ffff', 'ffff')).toBe(1)
    expect(hammingSimilarity('ffff', '0000')).toBe(0)
  })

  it('combines semantic, visual, context and real usage signals', () => {
    const queryVector = createTextVector('产品海报')
    const ranked = rankAssetCandidates(
      [
        { assetId: 'used', textVector: createTextVector('产品图'), usageScore: 8, contextText: '当前 SOP 产品海报' },
        { assetId: 'unused', textVector: createTextVector('产品图'), usageScore: 0, contextText: '' },
      ],
      { queryVector, context: '当前 SOP 产品海报' },
    )
    expect(ranked[0].assetId).toBe('used')
  })
})
