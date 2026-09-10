import { describe, expect, it } from 'vitest'
import { compileSopGenerationBrief, parseSopGenerationBrief } from './sopGenerationBrief'

describe('SOP generation brief', () => {
  it('compiles only completed sections into a readable brief', () => {
    expect(
      compileSopGenerationBrief({
        goal: '生成商品摄影 SOP',
        inputs: '',
        output: '输出可执行步骤',
        constraints: '保持品牌色',
        exclusions: '',
      }),
    ).toBe('生成目标：\n生成商品摄影 SOP\n\n期望产出：\n输出可执行步骤\n\n必须遵守：\n保持品牌色')
  })

  it('parses compiled briefs and keeps legacy free text as the goal', () => {
    const compiled = '生成目标：\n生成商品摄影 SOP\n\n不要出现：\n水印和 Logo'
    expect(parseSopGenerationBrief(compiled)).toMatchObject({
      goal: '生成商品摄影 SOP',
      exclusions: '水印和 Logo',
    })
    expect(parseSopGenerationBrief('旧版自由说明')).toMatchObject({ goal: '旧版自由说明' })
  })
})
