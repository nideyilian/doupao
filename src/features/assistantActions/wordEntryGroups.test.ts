import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_WORD_DERIVE_SETTINGS } from './matcher'
import { buildWordGroupName, resolveAssistantWordGroupId } from './wordEntryGroups'

const baseOptions = {
  ...DEFAULT_WORD_DERIVE_SETTINGS,
  actionName: '图片衍生',
  suggestedName: '图片衍生 · 安全图标 · 07-14 14:32',
}

describe('assistant word entry groups', () => {
  it('always creates a fresh group in "new" mode, never reusing a same-named one', () => {
    const createGroup = vi.fn(() => 'new-group')
    const groupId = resolveAssistantWordGroupId(
      baseOptions,
      [
        { id: 'derive-group', name: '图片衍生', sortOrder: 1 },
        { id: 'other-group', name: '爆款衍生', sortOrder: 2 },
      ],
      createGroup,
    )

    expect(groupId).toBe('new-group')
    expect(createGroup).toHaveBeenCalledWith('图片衍生 · 安全图标 · 07-14 14:32')
  })

  it('keeps an explicitly selected group in "selected" mode', () => {
    const createGroup = vi.fn(() => 'new-group')
    const groupId = resolveAssistantWordGroupId(
      { ...baseOptions, targetGroupMode: 'selected', targetGroupId: 'fixed' },
      [{ id: 'fixed', name: '固定分组', sortOrder: 1 }],
      createGroup,
    )

    expect(groupId).toBe('fixed')
    expect(createGroup).not.toHaveBeenCalled()
  })

  it('falls back to a new group when "selected" target is missing', () => {
    const createGroup = vi.fn(() => 'new-group')
    const groupId = resolveAssistantWordGroupId(
      { ...baseOptions, targetGroupMode: 'selected', targetGroupId: 'ghost' },
      [{ id: 'other', name: '固定分组', sortOrder: 1 }],
      createGroup,
    )

    expect(groupId).toBe('new-group')
    expect(createGroup).toHaveBeenCalled()
  })

  it('saveStrategy overrides the persisted targetGroupMode', () => {
    const createGroup = vi.fn(() => 'new-group')
    // Persisted mode is 'selected', but the per-save choice is 'new'.
    const groupId = resolveAssistantWordGroupId(
      { ...baseOptions, targetGroupMode: 'selected', targetGroupId: 'fixed', saveStrategy: 'new' },
      [{ id: 'fixed', name: '固定分组', sortOrder: 1 }],
      createGroup,
    )

    expect(groupId).toBe('new-group')
    expect(createGroup).toHaveBeenCalledWith(baseOptions.suggestedName)
  })

  it('builds a name from skill, prompt summary and timestamp', () => {
    expect(buildWordGroupName('爆款衍生', '防晒霜夏季主视觉方案长文本用于验证截断逻辑', 0)).toMatch(
      /^爆款衍生 · 防晒霜夏季主视觉方案长文 · \d{2}-\d{2} \d{2}:\d{2}$/,
    )
  })

  it('falls back to image count or "未命名素材" when prompt is empty', () => {
    expect(buildWordGroupName('角度探索', '   ', 3)).toMatch(/^角度探索 · 3张参考图 · /)
    expect(buildWordGroupName('变量拆解', '', 0)).toMatch(/^变量拆解 · 未命名素材 · /)
  })
})
