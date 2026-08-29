import { describe, expect, it, vi } from 'vitest'
import {
  buildGeneratedImageFileNameBase,
  findNextGeneratedImageSequence,
  formatGeneratedImageDate,
  sanitizeGeneratedImageFilenamePart,
} from './generatedImageFilename'

const context = {
  createdAt: new Date(2026, 6, 3, 8).getTime(),
  label: '快手',
  prompt: '  红色\n海报:竖版  ',
  batch: 2,
}

describe('generated image filenames', () => {
  it('uses the task generation date and omits the prompt by default', () => {
    expect(
      buildGeneratedImageFileNameBase(
        { ...context, batch: 1 },
        {
          imageFilenameDatePrefix: true,
          imageFilenameUsePrompt: false,
        },
        1,
      ),
    ).toBe('20260703-快手-1-1')
  })

  it('includes a sanitized prompt when enabled', () => {
    expect(
      buildGeneratedImageFileNameBase(
        context,
        {
          imageFilenameDatePrefix: true,
          imageFilenameUsePrompt: true,
        },
        2,
      ),
    ).toBe('20260703-快手-2-红色 海报-竖版-2')
  })

  it('supports disabling the date while keeping the prompt', () => {
    expect(
      buildGeneratedImageFileNameBase(
        context,
        {
          imageFilenameDatePrefix: false,
          imageFilenameUsePrompt: true,
        },
        3,
      ),
    ).toBe('快手-2-红色 海报-竖版-3')
  })

  it('supports disabling both optional parts', () => {
    expect(
      buildGeneratedImageFileNameBase(
        context,
        {
          imageFilenameDatePrefix: false,
          imageFilenameUsePrompt: false,
        },
        4,
      ),
    ).toBe('快手-2-4')
  })

  it('uses local calendar fields for the generation date', () => {
    expect(formatGeneratedImageDate(new Date(2026, 0, 9, 23, 59).getTime())).toBe('20260109')
  })

  it('collapses whitespace, replaces invalid characters, and truncates parts', () => {
    expect(sanitizeGeneratedImageFilenamePart('  a\n\tb:c  ')).toBe('a b-c')
    expect(sanitizeGeneratedImageFilenamePart('x'.repeat(101), 100)).toHaveLength(100)
  })

  it('limits the prompt to 100 characters', () => {
    const base = buildGeneratedImageFileNameBase(
      {
        ...context,
        prompt: 'y'.repeat(101),
      },
      {
        imageFilenameDatePrefix: true,
        imageFilenameUsePrompt: true,
      },
      12,
    )

    expect(base).toBe(`20260703-快手-2-${'y'.repeat(100)}-12`)
  })

  it('omits an empty prompt and falls back for an empty label', () => {
    expect(
      buildGeneratedImageFileNameBase(
        {
          ...context,
          label: '  ',
          prompt: ' \n ',
        },
        {
          imageFilenameDatePrefix: false,
          imageFilenameUsePrompt: true,
        },
        1,
      ),
    ).toBe('image-2-1')
  })

  it('continues after the largest matching sequence', () => {
    expect(
      findNextGeneratedImageSequence(
        ['20260703-快手-2-1.png', '20260703-快手-2-7.webp', '20260702-快手-2-9.png', 'other.txt'],
        context,
        { imageFilenameDatePrefix: true, imageFilenameUsePrompt: false },
      ),
    ).toBe(8)
  })

  it('falls back to the current date for an invalid timestamp', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 4, 10))
    expect(formatGeneratedImageDate(Number.NaN)).toBe('20260704')
    vi.useRealTimers()
  })
})
