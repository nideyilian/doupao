import { describe, expect, it } from 'vitest'
import { getViewportTooltipClasses } from './ViewportTooltip'

describe('getViewportTooltipClasses', () => {
  it('uses the unified dark tooltip bubble class (design-system ds-tooltip token)', () => {
    const classes = getViewportTooltipClasses('')

    expect(classes).toContain('ds-tooltip--viewport')
    expect(classes).not.toContain('bg-ds-surface')
    expect(classes).not.toContain('border-ds-border')
  })

  it('keeps caller classes', () => {
    expect(getViewportTooltipClasses('whitespace-nowrap')).toContain('whitespace-nowrap')
  })
})
