import { describe, expect, it } from 'vitest'
import { shouldCopyProfileImportUrl } from './profileImportUrl'

describe('profile import URL sharing', () => {
  it('copies URLs without API keys without confirmation', () => {
    let confirmCalls = 0
    const allowed = shouldCopyProfileImportUrl(false, () => {
      confirmCalls += 1
      return false
    })

    expect(allowed).toBe(true)
    expect(confirmCalls).toBe(0)
  })

  it('requires explicit confirmation before copying URLs with API keys', () => {
    expect(shouldCopyProfileImportUrl(true, () => false)).toBe(false)
    expect(shouldCopyProfileImportUrl(true, () => true)).toBe(true)
  })
})
