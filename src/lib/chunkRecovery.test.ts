import { describe, expect, it } from 'vitest'
import { isChunkLoadFailure } from './chunkRecovery'

describe('chunk load recovery', () => {
  it('detects stale lazy chunk load failures', () => {
    expect(isChunkLoadFailure(new Error('Failed to fetch dynamically imported module'))).toBe(true)
    expect(isChunkLoadFailure(new Error('Loading chunk 42 failed'))).toBe(true)
    expect(isChunkLoadFailure({ message: 'error loading dynamically imported module' })).toBe(true)
  })

  it('ignores ordinary runtime errors', () => {
    expect(isChunkLoadFailure(new Error('Cannot read properties of undefined'))).toBe(false)
  })
})
