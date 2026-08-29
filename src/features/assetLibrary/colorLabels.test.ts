import { describe, expect, it } from 'vitest'
import {
  COLOR_LABEL_HEX_MAP,
  COLOR_LABEL_NAMES,
  COLOR_LABEL_OPTIONS,
  COLOR_LABELS,
  COLOR_LABELS_WITH_NAMES,
  getColorLabelHex,
  TAG_COLORS_EXTENDED,
} from './colorLabels'

describe('COLOR_LABEL_HEX_MAP', () => {
  it('contains exactly 7 unique color values', () => {
    const hexes = Object.values(COLOR_LABEL_HEX_MAP)
    expect(hexes).toHaveLength(7)
    expect(new Set(hexes).size).toBe(7)
  })

  it('matches the stable palette', () => {
    expect(COLOR_LABEL_HEX_MAP).toEqual({
      red: '#ef4444',
      orange: '#f97316',
      yellow: '#eab308',
      green: '#22c55e',
      blue: '#3b82f6',
      purple: '#8b5cf6',
      gray: '#6b7280',
    })
  })
})

describe('COLOR_LABEL_NAMES', () => {
  it('has names for all 7 colors', () => {
    expect(Object.keys(COLOR_LABEL_NAMES)).toHaveLength(7)
    expect(COLOR_LABEL_NAMES.red).toBe('红色')
    expect(COLOR_LABEL_NAMES.gray).toBe('灰色')
  })
})

describe('COLOR_LABEL_OPTIONS', () => {
  it('has 7 entries with value, label, hex', () => {
    expect(COLOR_LABEL_OPTIONS).toHaveLength(7)
    for (const item of COLOR_LABEL_OPTIONS) {
      expect(item).toHaveProperty('value')
      expect(item).toHaveProperty('label')
      expect(item).toHaveProperty('hex')
      expect(item.hex).toBe(COLOR_LABEL_HEX_MAP[item.value])
      expect(item.label).toBe(COLOR_LABEL_NAMES[item.value])
    }
  })
})

describe('COLOR_LABELS', () => {
  it('has 7 entries with value and color', () => {
    expect(COLOR_LABELS).toHaveLength(7)
    for (const item of COLOR_LABELS) {
      expect(item).toHaveProperty('value')
      expect(item).toHaveProperty('color')
      expect(item.color).toBe(COLOR_LABEL_HEX_MAP[item.value])
    }
  })
})

describe('COLOR_LABELS_WITH_NAMES', () => {
  it('has 7 entries with value, color, label', () => {
    expect(COLOR_LABELS_WITH_NAMES).toHaveLength(7)
    for (const item of COLOR_LABELS_WITH_NAMES) {
      expect(item).toHaveProperty('value')
      expect(item).toHaveProperty('color')
      expect(item).toHaveProperty('label')
      expect(item.color).toBe(COLOR_LABEL_HEX_MAP[item.value])
      expect(item.label).toBe(COLOR_LABEL_NAMES[item.value])
    }
  })
})

describe('getColorLabelHex', () => {
  it('returns the correct hex for known labels', () => {
    expect(getColorLabelHex('red')).toBe('#ef4444')
    expect(getColorLabelHex('blue')).toBe('#3b82f6')
    expect(getColorLabelHex('gray')).toBe('#6b7280')
  })

  it('returns gray for unknown labels', () => {
    expect(getColorLabelHex('unknown')).toBe('#6b7280')
    expect(getColorLabelHex('')).toBe('#6b7280')
  })
})

describe('TAG_COLORS_EXTENDED', () => {
  it('contains exactly 10 unique colors', () => {
    expect(TAG_COLORS_EXTENDED).toHaveLength(10)
    expect(new Set(TAG_COLORS_EXTENDED).size).toBe(10)
  })

  it('contains 6 of the 7 base colors (gray replaced by warm-gray)', () => {
    const base7 = new Set(Object.values(COLOR_LABEL_HEX_MAP))
    const extendedSet = new Set(TAG_COLORS_EXTENDED)
    let found = 0
    for (const color of base7) {
      if (extendedSet.has(color)) found++
    }
    expect(found).toBe(6) // gray is replaced by warm-gray
  })

  it('matches the stable extended palette', () => {
    expect(TAG_COLORS_EXTENDED).toEqual([
      '#ef4444',
      '#f97316',
      '#eab308',
      '#22c55e',
      '#14b8a6',
      '#06b6d4',
      '#3b82f6',
      '#8b5cf6',
      '#ec4899',
      '#78716c',
    ])
  })
})
