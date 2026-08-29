import { describe, expect, it } from 'vitest'
import { allocateDirections, allocateInteger, createAgentBatchPlan, parseDirectionCell } from './agentBatchPlanner'

describe('agentBatchPlanner', () => {
  it('allocates integers without losing the requested total', () => {
    expect(allocateInteger(11, [50, 30, 20])).toEqual([6, 3, 2])
    expect(allocateInteger(5, [0, 0])).toEqual([3, 2])
  })

  it('supports fixed direction counts mixed with weighted directions', () => {
    expect(
      allocateDirections(100, [
        { name: 'A', count: 20 },
        { name: 'B', weight: 3 },
        { name: 'C', weight: 1 },
      ]),
    ).toEqual([20, 60, 20])
  })

  it('parses direction counts and percentages', () => {
    expect(parseDirectionCell('旅游攻略:50%; 美食教程:30%; 找头像:20%')).toEqual([
      { name: '旅游攻略', weight: 50 },
      { name: '美食教程', weight: 30 },
      { name: '找头像', weight: 20 },
    ])
    expect(parseDirectionCell('人物=30张\n宠物=20张')).toEqual([
      { name: '人物', count: 30 },
      { name: '宠物', count: 20 },
    ])
  })

  it('adds redundancy, splits copy variants, creates folders, and respects daily limit', () => {
    const plan = createAgentBatchPlan(
      [
        {
          sourceId: 'row-1',
          sku: 'APP-能力中心',
          product: '快手极速版',
          channel: '穿山甲',
          specification: '竖图1080x1920',
          quantity: 200,
          directions: [
            { name: '旅游攻略', weight: 3 },
            { name: '美食教程', weight: 1, copyRatio: 0 },
          ],
        },
      ],
      {
        startDate: '2026-07-15',
        dailyLimit: 100,
        redundancyRate: 0.1,
        defaultCopyRatio: 0.5,
        executionMode: 'task-first',
        outputRoot: 'D:\\Outputs',
        referenceRoot: 'D:\\References',
      },
    )

    expect(plan.targetCount).toBe(200)
    expect(plan.plannedCount).toBe(220)
    expect(plan.redundancyCount).toBe(20)
    expect(plan.days.map((day) => day.plannedCount)).toEqual([100, 100, 20])
    expect(plan.days[0].date).toBe('2026-07-15')
    expect(plan.days[2].date).toBe('2026-07-17')

    const allUnits = plan.days.flatMap((day) => day.units)
    expect(allUnits.some((unit) => unit.copyMode === 'with-copy')).toBe(true)
    expect(allUnits.some((unit) => unit.copyMode === 'without-copy')).toBe(true)
    expect(allUnits.every((unit) => unit.outputFolder.startsWith('D:\\Outputs\\APP-能力中心'))).toBe(true)
    expect(allUnits.find((unit) => unit.direction === '美食教程')?.referenceFolder).toBe('D:\\References')
  })

  it('uses text-to-image defaults when no workspace reference directory is selected', () => {
    const input = [
      {
        sourceId: '1',
        sku: 'SKU',
        product: '产品',
        channel: '渠道',
        specification: '1:1',
        quantity: 1,
        directions: [{ name: '主视觉' }],
      },
    ]
    const result = createAgentBatchPlan(input, {
      startDate: '2026-07-16',
      dailyLimit: 10,
      redundancyRate: 0,
      defaultCopyRatio: 0,
      executionMode: 'task-first',
      outputRoot: 'D:\\Outputs',
    })
    expect(result.days[0].units[0].referenceFolder).toBeUndefined()
    expect(result.days[0].units[0].strategy).toContain('根据产品')
  })

  it('generates the entered quantity for every channel and specification combination', () => {
    const result = createAgentBatchPlan(
      [
        {
          sourceId: '1',
          sku: 'SKU',
          product: '产品',
          channel: '抖音、快手',
          specification: '1:1、9:16',
          quantity: 100,
          directions: [{ name: '主视觉' }],
        },
      ],
      {
        startDate: '2026-07-16',
        dailyLimit: 1000,
        redundancyRate: 0,
        defaultCopyRatio: 0,
        executionMode: 'task-first',
        outputRoot: 'D:\\Outputs',
      },
    )
    expect(result.targetCount).toBe(400)
  })
})
