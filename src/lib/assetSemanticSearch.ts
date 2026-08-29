export const ASSET_TEXT_VECTOR_DIMENSIONS = 256
export const ASSET_TEXT_MODEL_ID = 'doupao-multilingual-hash'
export const ASSET_TEXT_MODEL_VERSION = '1'

function normalizeText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/\s+/g, ' ').trim()
}

function hashToken(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function textFeatures(value: string): string[] {
  const text = normalizeText(value)
  if (!text) return []
  const chars = [...text]
  const features = new Set<string>()
  for (const word of text.split(/[^\p{L}\p{N}]+/u).filter(Boolean)) features.add(`w:${word}`)
  for (let size = 1; size <= 3; size++) {
    for (let index = 0; index <= chars.length - size; index++) {
      const gram = chars.slice(index, index + size).join('')
      if (gram.trim()) features.add(`g${size}:${gram}`)
    }
  }
  return [...features]
}

export function createTextVector(value: string, dimensions = ASSET_TEXT_VECTOR_DIMENSIONS): number[] {
  const vector = Array.from({ length: dimensions }, () => 0)
  for (const feature of textFeatures(value)) {
    const hash = hashToken(feature)
    const index = hash % dimensions
    vector[index] += (hash & 0x80000000) === 0 ? 1 : -1
  }
  const magnitude = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0))
  return magnitude > 0 ? vector.map((item) => item / magnitude) : vector
}

export function cosineSimilarity(left: readonly number[] | undefined, right: readonly number[] | undefined): number {
  if (!left?.length || !right?.length) return 0
  const length = Math.min(left.length, right.length)
  let dot = 0
  let leftMagnitude = 0
  let rightMagnitude = 0
  for (let index = 0; index < length; index++) {
    const a = Number(left[index]) || 0
    const b = Number(right[index]) || 0
    dot += a * b
    leftMagnitude += a * a
    rightMagnitude += b * b
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0
  return dot / Math.sqrt(leftMagnitude * rightMagnitude)
}

export function hammingSimilarity(left: string | undefined, right: string | undefined): number {
  if (!left || !right || left.length !== right.length) return 0
  let different = 0
  let bits = 0
  for (let index = 0; index < left.length; index++) {
    const a = Number.parseInt(left[index], 16)
    const b = Number.parseInt(right[index], 16)
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
    let value = a ^ b
    for (let bit = 0; bit < 4; bit++) {
      different += value & 1
      value >>= 1
      bits++
    }
  }
  return bits ? 1 - different / bits : 0
}

export interface AssetSemanticCandidate {
  assetId: string
  textVector?: number[]
  perceptualHash?: string
  usageScore?: number
  contextText?: string
}

export interface AssetSemanticRankingInput {
  queryVector?: number[]
  referencePerceptualHash?: string
  context?: string
  weights?: Partial<{ text: number; visual: number; context: number; usage: number }>
}

export function rankAssetCandidates<T extends AssetSemanticCandidate>(
  candidates: T[],
  input: AssetSemanticRankingInput,
): Array<T & { score: number }> {
  const weights = { text: 0.48, visual: 0.28, context: 0.14, usage: 0.1, ...input.weights }
  const contextVector = input.context ? createTextVector(input.context) : undefined
  return candidates
    .map((candidate) => {
      const textScore = cosineSimilarity(input.queryVector, candidate.textVector)
      const visualScore = hammingSimilarity(input.referencePerceptualHash, candidate.perceptualHash)
      const contextScore =
        contextVector && candidate.contextText
          ? cosineSimilarity(contextVector, createTextVector(candidate.contextText))
          : 0
      const usageScore = Math.min(1, Math.log2(1 + Math.max(0, candidate.usageScore ?? 0)) / 5)
      return {
        ...candidate,
        score:
          textScore * weights.text +
          visualScore * weights.visual +
          contextScore * weights.context +
          usageScore * weights.usage,
      }
    })
    .sort((a, b) => b.score - a.score || a.assetId.localeCompare(b.assetId))
}
