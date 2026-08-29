import { describe, expect, it } from 'vitest'
import { getMaskHistoryLimit } from './maskHistory'

describe('getMaskHistoryLimit', () => {
  it('keeps the full history limit for small canvases', () => {
    expect(getMaskHistoryLimit(512, 512)).toBe(40)
  })

  it('caps full-resolution snapshots within the memory budget', () => {
    expect(getMaskHistoryLimit(2048, 2048)).toBe(6)
    expect(getMaskHistoryLimit(4096, 4096)).toBe(1)
  })
})
