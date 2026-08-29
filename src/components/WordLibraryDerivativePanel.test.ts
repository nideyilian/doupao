import { describe, expect, it } from 'vitest'
import { mergeWordLibraryEntryLines, parseWordLibraryEntryLines } from './WordLibraryDerivativePanel'

describe('WordLibraryDerivativePanel helpers', () => {
  it('normalizes blank lines before sending context to the model', () => {
    expect(parseWordLibraryEntryLines(' 月球 \n\n 行星\n  ')).toEqual(['月球', '行星'])
  })

  it('appends generated entries without duplicating existing or generated values', () => {
    expect(mergeWordLibraryEntryLines('月球\n行星', [' 行星 ', '宇宙球体', '宇宙球体', ''])).toBe(
      '月球\n行星\n宇宙球体',
    )
  })
})
