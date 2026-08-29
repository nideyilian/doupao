import { describe, expect, it } from 'vitest'
import { cn } from '@/lib/shadcn'

describe('shadcn class merging', () => {
  it('combines conditional classes and resolves Tailwind conflicts', () => {
    expect(cn('px-2 text-sm', false, { hidden: true }, 'px-4')).toBe('text-sm hidden px-4')
  })
})
