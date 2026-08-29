import { describe, expect, it } from 'vitest'
import { shouldCycleReferenceImages } from './inputImageLimits'

describe('shouldCycleReferenceImages', () => {
  it('keeps the existing per-image behavior as the default', () => {
    expect(shouldCycleReferenceImages(undefined, 3, 3)).toBe(true)
    expect(shouldCycleReferenceImages('cycle', 3, 3)).toBe(true)
  })

  it('sends all references together in all-reference mode', () => {
    expect(shouldCycleReferenceImages('all', 3, 3)).toBe(false)
  })

  it('does not split a single-output request', () => {
    expect(shouldCycleReferenceImages('cycle', 3, 1)).toBe(false)
  })

  it('keeps cycling a single-output request when the images come from a folder input', () => {
    expect(shouldCycleReferenceImages('cycle', 3, 1, true)).toBe(true)
    expect(shouldCycleReferenceImages(undefined, 3, 1, true)).toBe(true)
  })

  it('sends all folder images together only when the user explicitly picks all-reference mode', () => {
    expect(shouldCycleReferenceImages('all', 3, 1, true)).toBe(false)
  })

  it('does not enter reference cycling without input images', () => {
    expect(shouldCycleReferenceImages('cycle', 0, 3)).toBe(false)
  })
})
