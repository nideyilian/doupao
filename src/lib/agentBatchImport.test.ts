import { describe, expect, it } from 'vitest'
import { normalizeBatchTaskRows, parseBatchTaskFile, parseCsv } from './agentBatchImport'

describe('agentBatchImport', () => {
  it('parses quoted CSV cells', () => {
    expect(parseCsv('SKU,方向,备注\nA,"旅游:60%;美食:40%","包含,逗号"')).toEqual([
      ['SKU', '方向', '备注'],
      ['A', '旅游:60%;美食:40%', '包含,逗号'],
    ])
  })

  it('normalizes the Chinese task sheet headers', () => {
    const [task] = normalizeBatchTaskRows([
      {
        日期: '2026/07/12',
        SKU: 'APP-能力中心',
        所属部门: '杨家伟',
        产品: '快手极速版',
        渠道: '穿山甲',
        素材规格: '竖图1080*1920',
        数量: '200',
        对接人: '陈泽杰',
        方向: '旅游攻略:50%;美食教程:30%;找头像:20%',
        有文案占比: '40%',
      },
    ])
    expect(task).toMatchObject({
      date: '2026-07-12',
      sku: 'APP-能力中心',
      product: '快手极速版',
      quantity: 200,
      copyRatio: 0.4,
    })
    expect(task.directions.map((direction) => direction.weight)).toEqual([50, 30, 20])
  })

  it('accepts a JSON records envelope and rich direction objects', () => {
    const [task] = parseBatchTaskFile(
      JSON.stringify({
        records: [
          {
            SKU: 'A',
            产品: 'P',
            渠道: 'C',
            规格: '1:1',
            模板数量: 20,
            方向: [
              { name: '人物', count: 12, strategy: '人像写实' },
              { name: '宠物', count: 8 },
            ],
          },
        ],
      }),
      'json',
    )
    expect(task.directions).toEqual([
      { name: '人物', count: 12, strategy: '人像写实', copyRatio: undefined, referenceFolder: undefined },
      { name: '宠物', count: 8, strategy: undefined, copyRatio: undefined, referenceFolder: undefined },
    ])
  })
})
