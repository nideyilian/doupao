import { describe, expect, it } from 'vitest'
import {
  DERIVE_DIMENSIONS,
  DEFAULT_DERIVE_DIMENSION_POLICY,
  DEFAULT_DERIVE_COPY_MODE,
  buildCopyModeInstruction,
  buildDerivePolicyInstruction,
  copyModeToExcludeText,
  validateVariablePromptTemplate,
  type DeriveDimensionPolicy,
} from './derivePolicy'

describe('derive policy', () => {
  it('默认策略：构图锁定，其余微调', () => {
    expect(DEFAULT_DERIVE_DIMENSION_POLICY.构图).toBe('lock')
    expect(DEFAULT_DERIVE_DIMENSION_POLICY.主体).toBe('tweak')
    expect(DERIVE_DIMENSIONS).toHaveLength(8)
  })

  it('指令包含每个维度的档位说明', () => {
    const instruction = buildDerivePolicyInstruction(DEFAULT_DERIVE_DIMENSION_POLICY)
    for (const dimension of DERIVE_DIMENSIONS) {
      expect(instruction).toContain(`- ${dimension}：`)
    }
    expect(instruction).toContain('锁定')
    expect(instruction).toContain('微调')
  })

  it('锁定维度不会被创建变量', () => {
    const instruction = buildDerivePolicyInstruction({
      ...DEFAULT_DERIVE_DIMENSION_POLICY,
      风格: 'lock',
      场景: 'change',
    })
    expect(instruction).toContain('风格：锁定')
    expect(instruction).toContain('场景：大改')
    expect(instruction).toContain('只允许为「微调」和「大改」的维度创建变量')
  })

  it('文案处理：默认纯视觉，三种模式指令不同', () => {
    expect(DEFAULT_DERIVE_COPY_MODE).toBe('visual-only')
    expect(copyModeToExcludeText('visual-only')).toBe(true)
    expect(copyModeToExcludeText('preserve')).toBe(false)
    expect(copyModeToExcludeText('derive')).toBe(false)

    const visual = buildCopyModeInstruction('visual-only')
    const preserve = buildCopyModeInstruction('preserve')
    const derive = buildCopyModeInstruction('derive')
    expect(visual).toContain('排除全部文字')
    expect(preserve).toContain('原样写入模板固定正文')
    expect(derive).toContain('文案也参与衍生')
  })

  it('模板校验：锁定维度泄漏进变量会被发现', () => {
    const policy: DeriveDimensionPolicy = { ...DEFAULT_DERIVE_DIMENSION_POLICY, 构图: 'lock' }
    const issues = validateVariablePromptTemplate(
      '{{构图}}和{{主体}}',
      [
        { name: '构图', options: ['居中', '三分'] },
        { name: '主体', options: Array.from({ length: 8 }, (_, i) => `主体${i}`) },
      ],
      policy,
    )
    expect(issues.some((issue) => issue.includes('锁定维度「构图」'))).toBe(true)
  })

  it('模板校验：选项不足与未使用变量会被发现', () => {
    const issues = validateVariablePromptTemplate(
      '只有{{主体}}',
      [
        { name: '主体', options: ['猫', '狗'] },
        { name: '风格', options: Array.from({ length: 8 }, (_, i) => `风格${i}`) },
      ],
      DEFAULT_DERIVE_DIMENSION_POLICY,
    )
    expect(issues.some((issue) => issue.includes('只有 2 个选项'))).toBe(true)
    expect(issues.some((issue) => issue.includes('未在正文中使用'))).toBe(true)
  })

  it('模板校验：合格的模板无问题', () => {
    const options = Array.from({ length: 10 }, (_, i) => `选项${i}`)
    const issues = validateVariablePromptTemplate(
      '{{主体}}和{{风格}}',
      [
        { name: '主体', options: [...options] },
        { name: '风格', options: [...options] },
      ],
      DEFAULT_DERIVE_DIMENSION_POLICY,
    )
    expect(issues).toEqual([])
  })

  it('模板校验：大改维度的选项同义改写会被发现', () => {
    const policy: DeriveDimensionPolicy = { ...DEFAULT_DERIVE_DIMENSION_POLICY, 风格: 'change' }
    // 「水彩风格 / 水彩色调 / 水彩感」核心词相同，属于同义改写
    const issues = validateVariablePromptTemplate(
      '{{风格}}风格',
      [
        {
          name: '风格',
          options: ['水彩风格', '水彩色调', '水彩感', '油画', '素描', '卡通', '3D渲染', '国画', '版画', '铅笔稿'],
        },
      ],
      policy,
    )
    expect(issues.some((issue) => issue.includes('选项趋同'))).toBe(true)
  })

  it('模板校验：大改维度选项真正跨类则通过', () => {
    const policy: DeriveDimensionPolicy = { ...DEFAULT_DERIVE_DIMENSION_POLICY, 风格: 'change' }
    const issues = validateVariablePromptTemplate(
      '{{风格}}风格',
      [
        {
          name: '风格',
          options: ['水彩插画', '油画', '素描', '卡通', '3D渲染', '国画', '版画', '铅笔稿', '像素风', '胶片摄影'],
        },
      ],
      policy,
    )
    expect(issues).toEqual([])
  })
})
