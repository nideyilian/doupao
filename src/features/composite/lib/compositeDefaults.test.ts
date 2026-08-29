import { describe, expect, it } from 'vitest'
import { createDefaultCompositeWorkspaceState } from './compositeDefaults'

describe('createDefaultCompositeWorkspaceState', () => {
  it('creates an enabled category with an enabled page and jpg main output', () => {
    const state = createDefaultCompositeWorkspaceState()

    expect(state.categories).toHaveLength(1)
    expect(state.activeCategoryId).toBe(state.categories[0].id)
    expect(state.activePageId).toBe(state.categories[0].pages[0].id)
    expect(state.categories[0].enabled).toBe(true)
    expect(state.categories[0].pages[0].enabled).toBe(true)
    expect(state.categories[0].pages[0].preset.canvas).toEqual({ width: 1280, height: 720 })
    expect(state.categories[0].pages[0].preset.output.main.format).toBe('jpg')
  })
})
