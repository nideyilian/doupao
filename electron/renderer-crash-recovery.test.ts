import { describe, expect, it } from 'vitest'
import { decideRendererRecovery } from './renderer-crash-recovery'

describe('decideRendererRecovery', () => {
  it('enters safe mode after two crashes in 60 seconds', () => {
    expect(decideRendererRecovery([1_000, 30_000], 40_000)).toEqual({
      reload: true,
      safeMode: true,
    })
  })

  it('uses a normal reload for an isolated crash', () => {
    expect(decideRendererRecovery([1_000], 120_000)).toEqual({
      reload: true,
      safeMode: false,
    })
  })

  it('ignores crashes outside the recovery window', () => {
    expect(decideRendererRecovery([1_000, 20_000], 100_000)).toEqual({
      reload: true,
      safeMode: false,
    })
  })

  it('stops auto-reloading after three crashes in 60 seconds (backoff cap)', () => {
    expect(decideRendererRecovery([1_000, 20_000, 40_000], 50_000)).toEqual({
      reload: false,
    })
  })
})
