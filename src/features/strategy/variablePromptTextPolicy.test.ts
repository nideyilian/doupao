import { describe, expect, it } from 'vitest'
import { parseVariablePrompt } from '../../lib/variablePrompt'
import { applyVariablePromptTextPolicy } from './variablePromptTextPolicy'

describe('variable prompt text policy', () => {
  const visualPrompt =
    '图片比例为16:9。生成{{主体}}，采用{{构图}}。\n\n可变项：\n{{主体}}：猫 / 狗\n{{构图}}：近景 / 全景'

  it('adds a reusable no-text constraint while preserving a valid variable template', () => {
    const result = applyVariablePromptTextPolicy(visualPrompt, true)
    expect(result).toContain('忽略参考图中的所有文字与文案排版')
    expect(result).toContain('不预留文案区或文字安全区')
    expect(parseVariablePrompt(result).enabled).toBe(true)
  })

  it('leaves the template unchanged when text exclusion is disabled', () => {
    expect(applyVariablePromptTextPolicy(visualPrompt, false)).toBe(visualPrompt)
  })

  it('rejects copy and copy-layout variables when text exclusion is enabled', () => {
    expect(() =>
      applyVariablePromptTextPolicy(
        '图片比例为16:9。生成{{主体文案包}}并采用{{文案区结构}}。\n\n可变项：\n{{主体文案包}}：菜品，标题“好味道” / 饮品，标题“清爽”\n{{文案区结构}}：右侧标题 / 顶部标题',
        true,
      ),
    ).toThrow('开启“排除文字”后不能生成变量')
  })
})
