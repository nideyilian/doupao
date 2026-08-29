import { describe, expect, it } from 'vitest'
import { parseVariablePrompt, renderVariablePromptBatch } from './variablePrompt'

const prompt = `图片比例为16:9。根据{{主体文案包}}生成内容图，画面加入{{参与证据}}，采用{{文案区结构}}。

可变项：
{{主体文案包}}：冬瓜丸子汤，标题“冬瓜丸子汤” / 番茄牛腩汤，标题“番茄牛腩汤”
{{参与证据}}：汤勺正在舀起主料 / 切配食材与成品同时出现
{{文案区结构}}：右侧标题加六行配料卡 / 上方标题加底部双列配料表`

describe('variable prompt templates', () => {
  it('recognizes a strict variable section and extracts the fixed aspect ratio', () => {
    const parsed = parseVariablePrompt(prompt)
    expect(parsed.enabled).toBe(true)
    expect(parsed.variables.map((variable) => variable.name)).toEqual(['主体文案包', '参与证据', '文案区结构'])
    expect(parsed.combinationCount).toBe(8)
    expect(parsed.aspectRatio).toBe('16:9')
  })

  it('renders clean prompts without sending the option pool to the image model', () => {
    const rendered = renderVariablePromptBatch(prompt, 4, 'task-1')
    expect(rendered).toHaveLength(4)
    rendered.forEach((item) => {
      expect(item).not.toContain('可变项：')
      expect(item).not.toMatch(/\{\{.+?\}\}/u)
      expect(item).toContain('图片比例为16:9')
    })
    expect(new Set(rendered).size).toBe(4)
  })

  it('reports undefined body variables instead of silently enabling the template', () => {
    const parsed = parseVariablePrompt(`生成{{主体}}和{{风格}}。\n\n可变项：\n{{主体}}：猫 / 狗`)
    expect(parsed.detected).toBe(true)
    expect(parsed.enabled).toBe(false)
    expect(parsed.errors.join('\n')).toContain('风格')
  })

  it('ignores definitions that are not used in the body', () => {
    const parsed = parseVariablePrompt(`生成{{主体}}。\n\n可变项：\n{{主体}}：猫 / 狗\n{{风格}}：水彩 / 油画`)
    expect(parsed.enabled).toBe(true)
    expect(parsed.variables.map((variable) => variable.name)).toEqual(['主体'])
    expect(parsed.warnings.join('\n')).toContain('风格')
  })

  it('requires the variable section heading to occupy its own line', () => {
    const parsed = parseVariablePrompt('生成{{主体}}。\n\n可变项：{{主体}}：猫 / 狗')
    expect(parsed.detected).toBe(true)
    expect(parsed.enabled).toBe(false)
    expect(parsed.errors[0]).toContain('单独占一行')
  })
})
