import { describe, expect, it } from 'vitest'
import { mergeSopMetaInstructions, seedSopMetaInstructions } from './sopLibrary'

describe('SOP meta-instruction library', () => {
  it('seeds one built-in image-strategy extraction instruction', () => {
    const items = seedSopMetaInstructions().filter((item) => item.name === 'extract-image-generation-strategies')

    expect(items).toHaveLength(1)
  })

  it('adds missing built-ins without overwriting persisted instructions', () => {
    const persisted = [
      {
        ...seedSopMetaInstructions()[0],
        instruction: '用户修改后的元指令',
      },
    ]
    const merged = mergeSopMetaInstructions(persisted)

    expect(merged.find((item) => item.id === persisted[0].id)?.instruction).toBe('用户修改后的元指令')
    expect(merged.find((item) => item.id === 'sop-meta-prompt-reverse')?.name).toBe('提示词反推 SOP 编译器')
    expect(merged.filter((item) => item.name === 'extract-image-generation-strategies')).toHaveLength(1)
  })

  it('does not restore unrelated built-ins that a user removed', () => {
    const custom = {
      ...seedSopMetaInstructions()[0],
      id: 'meta-custom',
      name: '自定义元指令',
    }
    const merged = mergeSopMetaInstructions([custom])

    expect(merged.some((item) => item.id === 'sop-meta-general')).toBe(false)
    expect(merged.some((item) => item.id === 'sop-meta-prompt-reverse')).toBe(true)
    expect(merged.filter((item) => item.name === 'extract-image-generation-strategies')).toHaveLength(1)
  })
})
