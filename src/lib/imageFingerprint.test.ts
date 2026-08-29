import { describe, expect, it } from 'vitest'
import {
  areNearDuplicates,
  computeContentHash,
  computePerceptualHash,
  decodeDataUrlToBytes,
  hammingDistance,
  resizeToGray32x32,
} from './imageFingerprint'

function makePixels(
  width: number,
  height: number,
  fn: (x: number, y: number) => [number, number, number],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fn(x, y)
      const i = (y * width + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
  return data
}

function toDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return `data:${mime};base64,${btoa(bin)}`
}

describe('decodeDataUrlToBytes', () => {
  it('decodes base64 regardless of mime prefix', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5])
    const a = decodeDataUrlToBytes(toDataUrl(bytes, 'image/png'))
    const b = decodeDataUrlToBytes(toDataUrl(bytes, 'application/octet-stream'))
    expect(Array.from(a)).toEqual([1, 2, 3, 4, 5])
    expect(Array.from(b)).toEqual([1, 2, 3, 4, 5])
  })
})

describe('computeContentHash', () => {
  it('is identical for same decoded bytes under different mime (re-encoded)', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 9, 9, 9])
    const h1 = await computeContentHash(toDataUrl(bytes, 'image/png'))
    const h2 = await computeContentHash(toDataUrl(bytes, 'application/octet-stream'))
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
  })

  it('differs for different bytes', async () => {
    const h1 = await computeContentHash(toDataUrl(new Uint8Array([1, 2, 3]), 'image/png'))
    const h2 = await computeContentHash(toDataUrl(new Uint8Array([1, 2, 4]), 'image/png'))
    expect(h1).not.toBe(h2)
  })
})

describe('resizeToGray32x32', () => {
  it('returns a 1024-length grayscale array', () => {
    const pixels = makePixels(64, 48, (x, y) => [x % 256, y % 256, 100])
    const gray = resizeToGray32x32(pixels, 64, 48)
    expect(gray).toHaveLength(32 * 32)
  })
})

describe('computePerceptualHash', () => {
  it('is deterministic for pixel-identical images', () => {
    const a = makePixels(32, 32, (x, y) => [x * 8, y * 8, 128])
    const b = makePixels(32, 32, (x, y) => [x * 8, y * 8, 128])
    const ha = computePerceptualHash(a, 32, 32)
    expect(ha).toBe(computePerceptualHash(b, 32, 32))
    expect(ha).toMatch(/^[0-9a-f]{16}$/)
  })

  it('near-duplicate logic respects the hamming threshold', () => {
    // 两个仅相差 3 位的 64 位 pHash
    const a = 'fffffffffffffff0'
    const b = 'fffffffffffffffd'
    expect(hammingDistance(a, b)).toBe(3)
    expect(areNearDuplicates(a, b, 4)).toBe(true)
    expect(areNearDuplicates(a, b, 0)).toBe(false)
    // 完全不同
    expect(areNearDuplicates('0000000000000000', 'ffffffffffffffff', 6)).toBe(false)
  })

  it('yields a large hamming distance for a clearly different low-frequency structure', () => {
    // 左侧暗 / 右侧亮（垂直边缘） vs 上半暗 / 下半亮（水平边缘）
    const a = makePixels(40, 40, (x) => [x < 20 ? 20 : 220, 128, 128])
    const b = makePixels(40, 40, (_x, y) => [y < 20 ? 20 : 220, 128, 128])
    const ha = computePerceptualHash(a, 40, 40)
    const hb = computePerceptualHash(b, 40, 40)
    expect(hammingDistance(ha, hb)).toBeGreaterThan(20)
  })
})

describe('hammingDistance', () => {
  it('counts differing bits', () => {
    expect(hammingDistance('ffff', '0000')).toBe(16)
    expect(hammingDistance('aaaa', 'aaaa')).toBe(0)
  })
})

describe('areNearDuplicates', () => {
  it('respects the threshold and disables when <= 0', () => {
    const a = '0000000000000000'
    const b = '000000000000000f' // 距离 4
    expect(areNearDuplicates(a, b, 6)).toBe(true)
    expect(areNearDuplicates(a, b, 0)).toBe(false)
    expect(areNearDuplicates(a, undefined, 6)).toBe(false)
  })
})
