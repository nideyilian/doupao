import { describe, expect, it } from 'vitest'
import { VARIABLE_COLORS, buildVariableColorMap } from './promptVariableColors'

describe('VARIABLE_COLORS', () => {
  it('contains exactly 6 unique colors', () => {
    expect(VARIABLE_COLORS).toHaveLength(6)
    expect(new Set(VARIABLE_COLORS).size).toBe(6)
  })

  it('matches the stable palette (order matters for visual distinction)', () => {
    expect(VARIABLE_COLORS).toEqual(['#10b981', '#f97316', '#3b82f6', '#a855f7', '#ec4899', '#06b6d4'])
  })
})

describe('buildVariableColorMap', () => {
  it('assigns colors to sorted variable keys cycling through the palette', () => {
    const entries = [{ key: 'c' }, { key: 'a' }, { key: 'b' }]
    const map = buildVariableColorMap(entries)
    // sorted order: a, b, c
    expect(map['a']).toBe(VARIABLE_COLORS[0])
    expect(map['b']).toBe(VARIABLE_COLORS[1])
    expect(map['c']).toBe(VARIABLE_COLORS[2])
  })

  it('cycles back to the first color when there are more entries than colors', () => {
    const entries = Array.from({ length: 8 }, (_, i) => ({ key: String.fromCharCode(97 + i) }))
    const map = buildVariableColorMap(entries)
    expect(map['a']).toBe(VARIABLE_COLORS[0])
    expect(map['g']).toBe(VARIABLE_COLORS[0]) // wraps around
    expect(map['h']).toBe(VARIABLE_COLORS[1])
  })

  it('excludes soft-deleted entries', () => {
    const entries = [
      { key: 'a', deletedAt: 123 },
      { key: 'b', deletedAt: null },
    ]
    const map = buildVariableColorMap(entries)
    expect(map).toHaveProperty('b')
    expect(map).not.toHaveProperty('a')
  })

  it('returns an empty map for no entries', () => {
    expect(buildVariableColorMap([])).toEqual({})
  })
})
