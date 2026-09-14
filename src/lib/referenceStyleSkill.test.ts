import { describe, expect, it } from 'vitest'
import {
  buildVisualSkillBatchPrompt,
  buildVisualSkillPrompts,
  getReferenceStyleThemes,
  parseVisualSkill,
} from './referenceStyleSkill'

describe('referenceStyleSkill', () => {
  it('parses one theme per line', () => {
    expect(getReferenceStyleThemes('咖啡\n\n甜点\r\n水果')).toEqual(['咖啡', '甜点', '水果'])
  })

  it('renders prompts from a saved visual skill', () => {
    const skill = parseVisualSkill(
      JSON.stringify({
        name: '测试 Skill',
        chinesePromptTemplate: '中文 {theme}',
        englishPromptTemplate: 'English {theme}',
        keywordTable: [{ dimension: '风格', chinese: '柔和', english: 'soft', locked: true }],
      }),
      ['image-1'],
    )
    const result = buildVisualSkillPrompts(skill, '咖啡')
    expect(result).toEqual({ chinese: '中文 咖啡', english: 'English 咖啡' })
    expect(skill.sourceImageIds).toEqual(['image-1'])
  })

  it('allocates the total count evenly across themes in one batch prompt', () => {
    const skill = parseVisualSkill(
      JSON.stringify({
        name: '批量 Skill',
        chinesePromptTemplate: '{theme} 中文',
        englishPromptTemplate: '{theme} English',
      }),
      [],
    )
    const result = buildVisualSkillBatchPrompt(skill, ['咖啡', '甜点', '水果'], 12)
    expect(result.countPerTheme).toBe(4)
    expect(result.prompt).toContain('exactly 12 images')
    expect(result.prompt.match(/\(4 images\)/g)).toHaveLength(3)
  })

  it('rejects a total count that cannot be evenly allocated', () => {
    const skill = parseVisualSkill(
      JSON.stringify({
        name: '批量 Skill',
        chinesePromptTemplate: '{theme}',
        englishPromptTemplate: '{theme}',
      }),
      [],
    )
    expect(() => buildVisualSkillBatchPrompt(skill, ['A', 'B', 'C'], 10)).toThrow('整除')
  })
})
