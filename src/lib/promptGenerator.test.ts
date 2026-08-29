import { describe, it, expect } from 'vitest'
import { slugify, normalize_entries, normalize_draw_count, render_prompt } from './promptGenerator'

describe('slugify', () => {
  it('converts to lowercase and replaces spaces with underscores', () => {
    expect(slugify('Hello World')).toBe('hello_world')
  })

  it('removes non-alphanumeric chars (except Chinese), keeps Chinese, trims spaces', () => {
    expect(slugify(' 测试 Hello!! World!! ')).toBe('_测试_hello_world_')
  })

  it('truncates text longer than 48 characters', () => {
    const longText = 'a'.repeat(60)
    expect(slugify(longText)).toBe('a'.repeat(48))
    expect(slugify(longText).length).toBe(48)
  })
})

describe('normalize_entries', () => {
  it('deduplicates and removes empty strings from array', () => {
    expect(normalize_entries(['a', 'b', '', 'a'])).toEqual(['a', 'b'])
  })

  it('splits a newline-separated string into an array', () => {
    expect(normalize_entries('a\nb\nc')).toEqual(['a', 'b', 'c'])
  })

  it('returns empty array for null', () => {
    expect(normalize_entries(null)).toEqual([])
  })

  it('returns empty array for undefined', () => {
    expect(normalize_entries(undefined)).toEqual([])
  })
})

describe('normalize_draw_count', () => {
  it('returns the number as-is for valid positive integers', () => {
    expect(normalize_draw_count(3)).toBe(3)
  })

  it('parses numeric strings', () => {
    expect(normalize_draw_count('5')).toBe(5)
  })

  it('returns 1 for 0 (out of range)', () => {
    expect(normalize_draw_count(0)).toBe(1)
  })

  it('returns 1 for values > 999', () => {
    expect(normalize_draw_count(1000)).toBe(1)
  })

  it('returns 1 for non-numeric strings', () => {
    expect(normalize_draw_count('abc')).toBe(1)
  })

  it('returns 1 for null', () => {
    expect(normalize_draw_count(null)).toBe(1)
  })
})

describe('render_prompt', () => {
  it('renders pure text segments', () => {
    const [text, reports] = render_prompt({ segments: [{ type: 'text', text: 'a cat' }], library: {} }, 1)
    expect(text).toBe('a cat')
    expect(reports).toEqual([])
  })

  it('replaces wildcard segments with drawn entries and returns report', () => {
    const [text, reports] = render_prompt(
      {
        segments: [
          { type: 'text', text: 'A ' },
          { type: 'wildcard', id: 'animal' },
        ],
        library: {
          animal: { entries: ['cat', 'dog', 'bird'], draw_count: 1, label: '动物' },
        },
      },
      42,
    )

    expect(text).not.toBe('')
    expect(text).toMatch(/^A (cat|dog|bird)$/)
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({
      id: 'animal',
      label: '动物',
      drawn: [expect.stringMatching(/^(cat|dog|bird)$/)],
    })
  })

  it('returns deterministic results with the same seed', () => {
    const state = {
      segments: [
        { type: 'wildcard', id: 'color' },
        { type: 'text', text: ' ' },
        { type: 'wildcard', id: 'animal' },
      ],
      library: {
        color: { entries: ['red', 'green', 'blue', 'yellow'], draw_count: 2, label: '颜色' },
        animal: { entries: ['cat', 'dog', 'bird'], draw_count: 1, label: '动物' },
      },
    }

    const [text1, reports1] = render_prompt(state, 42)
    const [text2, reports2] = render_prompt(state, 42)

    expect(text1).toBe(text2)
    expect(reports1).toEqual(reports2)
  })

  it('produces different results without a seed (seed=0 uses Math.random)', () => {
    const state = {
      segments: [{ type: 'wildcard', id: 'animal' }],
      library: {
        animal: { entries: ['cat', 'dog', 'bird'], draw_count: 1, label: '动物' },
      },
    }

    const [text1] = render_prompt(state, 0)
    const [text2] = render_prompt(state, 0)

    // With only 3 entries and Math.random, it's extremely unlikely both calls pick the same
    // We check that at least one of multiple tries differs
    const results = new Set(Array.from({ length: 10 }, () => render_prompt(state, 0)[0]))
    expect(results.size).toBeGreaterThan(1)
  })

  it('keeps label text when wildcard id is missing from library (missing_policy defaults to keep_label)', () => {
    const [text, reports] = render_prompt(
      {
        segments: [
          { type: 'text', text: 'Hello ' },
          { type: 'wildcard', id: 'missing' },
        ],
        library: { missing: { entries: [], draw_count: 1, label: 'fallback_label' } },
      },
      1,
    )

    expect(text).toBe('Hello fallback_label')
    expect(reports).toEqual([])
  })

  it('outputs empty string for missing wildcard with missing_policy="empty"', () => {
    const [text, reports] = render_prompt(
      {
        segments: [
          { type: 'text', text: 'Hello ' },
          { type: 'wildcard', id: 'missing' },
        ],
        library: { missing: { entries: [], draw_count: 1, label: 'fallback_label' } },
      },
      1,
      'empty',
    )

    expect(text).toBe('Hello ')
    expect(reports).toEqual([])
  })

  it('draws all available entries when draw_count exceeds entries length', () => {
    const [text, reports] = render_prompt(
      {
        segments: [{ type: 'wildcard', id: 'nums' }],
        library: { nums: { entries: ['1', '2', '3'], draw_count: 5, label: '数字' } },
      },
      42,
    )

    // All 3 entries should be drawn (shuffled)
    const drawn = reports[0].drawn
    expect(drawn).toHaveLength(3)
    expect(drawn.sort()).toEqual(['1', '2', '3'])
  })

  it('returns empty string and empty reports for empty object state', () => {
    const [text, reports] = render_prompt({} as any, 1)
    expect(text).toBe('')
    expect(reports).toEqual([])
  })

  it('returns empty string and empty reports for empty string state', () => {
    const [text, reports] = render_prompt('', 1)
    expect(text).toBe('')
    expect(reports).toEqual([])
  })

  it('deduplicates and removes empty strings from entries before drawing', () => {
    const [text, reports] = render_prompt(
      {
        segments: [{ type: 'wildcard', id: 'items' }],
        library: { items: { entries: ['a', '', 'a', 'b'], draw_count: 2, label: '项目' } },
      },
      42,
    )

    const drawn = reports[0].drawn
    expect(drawn).toHaveLength(2)
    expect(drawn).toEqual(['a', 'b'])
  })

  it('auto-converts array-format library properties to standard entry format', () => {
    const [text, reports] = render_prompt(
      {
        segments: [{ type: 'wildcard', id: 'animals' }],
        library: { animals: ['猫', '狗'] },
      },
      42,
    )

    expect(text).not.toBe('')
    expect(reports).toHaveLength(1)
    expect(reports[0].drawn).toHaveLength(1)
    expect(['猫', '狗']).toContain(reports[0].drawn[0])
  })

  it('report contains id, label, and drawn fields with correct types', () => {
    const [, reports] = render_prompt(
      {
        segments: [
          { type: 'wildcard', id: 'color' },
          { type: 'wildcard', id: 'animal' },
        ],
        library: {
          color: { entries: ['red', 'blue'], draw_count: 2, label: '颜色' },
          animal: { entries: ['cat'], draw_count: 1, label: '动物' },
        },
      },
      42,
    )

    expect(reports).toHaveLength(2)

    expect(reports[0]).toHaveProperty('id')
    expect(reports[0]).toHaveProperty('label')
    expect(reports[0]).toHaveProperty('drawn')
    expect(typeof reports[0].id).toBe('string')
    expect(typeof reports[0].label).toBe('string')
    expect(Array.isArray(reports[0].drawn)).toBe(true)
    expect(reports[0].drawn.every((d) => typeof d === 'string')).toBe(true)

    expect(reports[1]).toHaveProperty('id')
    expect(reports[1]).toHaveProperty('label')
    expect(reports[1]).toHaveProperty('drawn')
    expect(typeof reports[1].id).toBe('string')
    expect(typeof reports[1].label).toBe('string')
    expect(Array.isArray(reports[1].drawn)).toBe(true)
    expect(reports[1].drawn.every((d) => typeof d === 'string')).toBe(true)
  })
})
