import { describe, expect, it } from 'vitest'
import { sanitizeInformationFlowAdResult, sanitizeInformationFlowAdText } from './adCompliance'

describe('information flow ad compliance', () => {
  it('rewrites high-risk claims instead of returning them to image generation', () => {
    const sanitized = sanitizeInformationFlowAdText('行业第一，100%有效，保证治愈，稳赚不赔')

    expect(sanitized).not.toMatch(/行业第一|100%有效|保证治愈|稳赚不赔/)
    expect(sanitized).toContain('高品质')
    expect(sanitized).toContain('收益存在风险')
  })

  it('sanitizes every generative field in an assistant result', () => {
    const result = sanitizeInformationFlowAdResult({
      actionId: 'prompt-optimize',
      title: '提示词优化',
      content: '全球第一，零风险',
      prompt: '全球第一，零风险',
      primaryText: '全球第一产品',
      candidates: ['包治百病', '保证就业'],
      variablePrompt: '{{卖点}}，保本保收益',
      sections: [{ title: '最佳方案', items: ['伪造专家'] }],
      wordEntries: [{ category: '卖点', entries: ['销量第一', '绝对安全'] }],
    })

    expect(JSON.stringify(result)).not.toMatch(
      /全球第一|零风险|包治百病|保证就业|保本保收益|最佳|伪造专家|销量第一|绝对安全/,
    )
  })
})
