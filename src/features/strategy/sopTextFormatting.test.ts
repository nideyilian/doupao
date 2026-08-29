import { describe, expect, it } from 'vitest'
import { autoParagraphSopText, cleanPastedSopText, formatSopDocument, normalizeSopNumbering } from './sopTextFormatting'

describe('SOP text formatting tools', () => {
  it('cleans copied whitespace without changing document content', () => {
    expect(cleanPastedSopText('  第一步\u00A0 \r\n\r\n\r\n第二步\u200B  ')).toBe('第一步\n\n第二步')
  })

  it('normalizes mixed bullet and ordered-list markers', () => {
    expect(normalizeSopNumbering('● 准备素材\n1、检查尺寸\n2）导出')).toBe('- 准备素材\n1. 检查尺寸\n2. 导出')
  })

  it('keeps code blocks intact while unifying Markdown spacing', () => {
    expect(formatSopDocument('#目标\n内容\n```text\n  keep  \n```\n##  验收')).toBe(
      '# 目标\n\n内容\n```text\n  keep  \n```\n\n## 验收',
    )
  })

  it('splits long prose while preserving list structure', () => {
    const result = autoParagraphSopText(
      '第一句用于说明目标。第二句用于说明输入。第三句用于说明约束。\n- 保留列表一\n- 保留列表二',
      18,
    )
    expect(result).toContain('第一句用于说明目标。\n\n第二句用于说明输入。')
    expect(result).toContain('- 保留列表一\n- 保留列表二')
  })

  it('joins hard-wrapped Chinese prose before segmenting it', () => {
    expect(autoParagraphSopText('确认输入素材，\n检查尺寸与格式。\n输出最终文件。', 100)).toBe(
      '确认输入素材，检查尺寸与格式。输出最终文件。',
    )
  })
})
