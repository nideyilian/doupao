import { describe, expect, it } from 'vitest'
import { shouldDeleteOrphanImage } from './storageCleanup'

describe('shouldDeleteOrphanImage', () => {
  it('keeps recently created orphan images during the grace period', () => {
    const now = 10 * 24 * 60 * 60 * 1000
    expect(shouldDeleteOrphanImage({ createdAt: now - 6 * 24 * 60 * 60 * 1000 }, now, 7)).toBe(false)
  })

  it('deletes expired and timestamp-less legacy orphans', () => {
    const now = 10 * 24 * 60 * 60 * 1000
    expect(shouldDeleteOrphanImage({ createdAt: now - 8 * 24 * 60 * 60 * 1000 }, now, 7)).toBe(true)
    expect(shouldDeleteOrphanImage({}, now, 7)).toBe(true)
  })
})
