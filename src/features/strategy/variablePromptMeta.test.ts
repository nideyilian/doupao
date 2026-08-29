import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VARIABLE_TYPE,
  deriveVariableMetaFromContent,
  isVariablePromptAsset,
  normalizeVariableMeta,
  replaceVariableOptions,
  updateVariableMeta,
} from './variablePromptMeta'

const TEMPLATE = `图片比例为16:9。根据 {{主体}} 生成画面，并采用 {{背景}}。

可变项：
{{主体}}：猫 / 狗 / 兔子
{{背景}}：纯色 / 渐变 / 街景`

describe('variablePromptMeta', () => {
  it('detects a variable prompt asset from the 可变项 block', () => {
    expect(isVariablePromptAsset(TEMPLATE)).toBe(true)
    expect(isVariablePromptAsset('普通 SOP 正文，没有变量')).toBe(false)
  })

  it('derives default meta from the template body', () => {
    const meta = deriveVariableMetaFromContent(TEMPLATE)
    expect(meta).toEqual([
      { name: '主体', theme: '', type: DEFAULT_VARIABLE_TYPE, count: 3 },
      { name: '背景', theme: '', type: DEFAULT_VARIABLE_TYPE, count: 3 },
    ])
  })

  it('normalizes stored meta against the body as the source of truth', () => {
    const stored = [
      { name: '主体', theme: '高端美妆', type: '文案联动', count: 20 },
      { name: '已删除的变量', theme: 'x', type: 'y', count: 5 },
    ]
    const normalized = normalizeVariableMeta(TEMPLATE, stored)
    expect(normalized).toEqual([
      { name: '主体', theme: '高端美妆', type: '文案联动', count: 20 },
      // 正文没有的变量被丢弃，正文新增的变量补齐默认项
      { name: '背景', theme: '', type: DEFAULT_VARIABLE_TYPE, count: 3 },
    ])
  })

  it('fills missing stored meta for new variables and falls back count to body', () => {
    const normalized = normalizeVariableMeta(TEMPLATE, [{ name: '主体', theme: '宠物', type: '实物', count: 0 }])
    expect(normalized.find((entry) => entry.name === '主体')).toMatchObject({ theme: '宠物', type: '实物', count: 3 })
  })

  it('updates a single variable parameters without touching others', () => {
    const meta = deriveVariableMetaFromContent(TEMPLATE)
    const next = updateVariableMeta(meta, '主体', { theme: '高端美妆', type: '文案联动', count: 30 })
    expect(next[0]).toEqual({ name: '主体', theme: '高端美妆', type: '文案联动', count: 30 })
    expect(next[1]).toEqual({ name: '背景', theme: '', type: DEFAULT_VARIABLE_TYPE, count: 3 })
  })

  it('replaces variable options back into the template deterministically', () => {
    const merged = replaceVariableOptions(TEMPLATE, '主体', ['金毛犬', '布偶猫', '垂耳兔', '奶牛猫'])
    expect(merged).toBe(`图片比例为16:9。根据 {{主体}} 生成画面，并采用 {{背景}}。

可变项：
{{主体}}：金毛犬 / 布偶猫 / 垂耳兔 / 奶牛猫
{{背景}}：纯色 / 渐变 / 街景`)
  })

  it('deduplicates and trims options while keeping other variable rows untouched', () => {
    const merged = replaceVariableOptions(TEMPLATE, '背景', ['  星空  ', '星空', '森林 / 湖泊', '雾霾', ''])
    expect(merged).toContain('{{背景}}：星空 / 森林 / 湖泊 / 雾霾')
    expect(merged).toContain('{{主体}}：猫 / 狗 / 兔子')
  })

  it('rejects unknown variables and missing sections', () => {
    expect(() => replaceVariableOptions(TEMPLATE, '不存在的变量', ['x'])).toThrow('不存在变量')
    expect(() => replaceVariableOptions('没有可变项区块的正文', '主体', ['x'])).toThrow('缺少')
    expect(() => replaceVariableOptions(TEMPLATE, '主体', ['', '  '])).toThrow('没有可用的新选项')
  })
})
