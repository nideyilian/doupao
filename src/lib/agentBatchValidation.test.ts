import { describe, expect, it } from 'vitest'
import { validateBatchTaskRows } from './agentBatchValidation'

describe('validateBatchTaskRows', () => {
  it('reports each missing field with its row and label', () => {
    const issues = validateBatchTaskRows([
      {
        sourceId: 'row-1',
        sku: '',
        product: '',
        channel: '',
        specification: '',
        quantity: 0,
        directions: [],
      },
    ])

    expect(issues.map((issue) => issue.message)).toEqual([
      '第 1 行「SKU」不能为空',
      '第 1 行「产品」不能为空',
      '第 1 行「渠道」不能为空',
      '第 1 行「素材规格」不能为空',
      '第 1 行「数量」必须是大于 0 的整数',
      '第 1 行「方向」不能为空',
    ])
  })

  it('reports impossible fixed direction counts', () => {
    const issues = validateBatchTaskRows([
      {
        sourceId: 'row-1',
        sku: 'SKU',
        product: '产品',
        channel: '渠道',
        specification: '1:1',
        quantity: 3,
        directions: [{ name: '人物', count: 4 }],
      },
    ])

    expect(issues).toMatchObject([
      {
        field: 'directions',
        message: '第 1 行「方向」无效：Direction counts exceed task quantity',
      },
    ])
  })
})
