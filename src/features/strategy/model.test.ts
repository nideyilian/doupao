import { describe, expect, it } from 'vitest'
import { seedRequirementCatalog } from '../requirementPrototype/seed'
import {
  buildStrategyTestPrompt,
  createStrategyAsset,
  getStrategyCoreStage,
  normalizeStrategyAsset,
  seedStrategyAssets,
  seedStrategyPresets,
  validateStrategyForTest,
} from './model'

describe('strategy library model', () => {
  it('seeds one strategy for every SKU and material type combination', () => {
    const catalog = seedRequirementCatalog()
    const strategies = seedStrategyAssets(catalog)

    expect(strategies).toHaveLength(catalog.products.length * catalog.materialTypes.length)
    expect(new Set(strategies.map((item) => `${item.productId}:${item.materialTypeId}`)).size).toBe(strategies.length)
  })

  it('requires an executable SOP before optional parameters', () => {
    const strategy = createStrategyAsset('product', 'type', 'user')
    expect(getStrategyCoreStage(strategy)).toBe('sop')
  })

  it('treats outputs as optional until explicitly enabled', () => {
    const strategy = createStrategyAsset('product', 'type', 'user')
    strategy.workflow.sop = {
      resolved: true,
      mode: 'custom',
      name: '商品场景 SOP',
      content: '先确认商品卖点，再完成画面构图。',
    }

    expect(validateStrategyForTest(strategy)).toEqual([])
    strategy.outputs.channels.enabled = true
    expect(validateStrategyForTest(strategy)).toContain('已启用输出渠道，请至少选择一个渠道')
  })

  it('allows testing with only an SOP and no optional generation settings', () => {
    const strategy = createStrategyAsset('product', 'type', 'user')
    strategy.workflow.sop = { resolved: true, mode: 'custom', name: '最小 SOP', content: '先确认目标，再生成画面。' }

    expect(strategy.generationMode).toBeNull()
    expect(strategy.workflow.instruction).toBe('')
    expect(strategy.workflow.knowledge.insightIds).toEqual([])
    expect(validateStrategyForTest(strategy)).toEqual([])
  })

  it('accepts a selected or strategy-local SOP, but not an empty SOP', () => {
    const strategy = createStrategyAsset('product', 'type', 'user')
    strategy.workflow.sop = { resolved: true, mode: 'custom', content: '' }

    expect(getStrategyCoreStage(strategy)).toBe('sop')
    expect(validateStrategyForTest(strategy)).toContain('请选择或完成一份可执行的 SOP')

    strategy.workflow.sop = { resolved: true, mode: 'custom', content: '旧自定义 SOP' }
    expect(getStrategyCoreStage(strategy)).toBe('ready')
  })

  it('migrates legacy SOP mode into a later SOP step', () => {
    const strategy = normalizeStrategyAsset({
      id: 'legacy',
      generationMode: 'sop',
      promptTemplate: '旧提示词',
      sop: '旧 SOP',
      steps: [],
    })

    expect(strategy.generationMode).toBe('text-to-image')
    expect(strategy.workflow.instruction).toBe('旧提示词')
    expect(strategy.workflow.sop).toMatchObject({ resolved: true, mode: 'custom', content: '旧 SOP' })
    expect(strategy.outputs.channels.enabled).toBe(false)
  })

  it('builds a test prompt from hierarchy, workflow and knowledge', () => {
    const catalog = seedRequirementCatalog()
    const strategy = seedStrategyAssets(catalog)[0]
    const prompt = buildStrategyTestPrompt(strategy, catalog, ['高转化画面保持单一视觉焦点'])

    expect(prompt).toContain(catalog.products[0].name)
    expect(prompt).toContain(strategy.name)
    expect(prompt).toContain('高转化画面保持单一视觉焦点')
    expect(prompt).not.toContain('输出渠道：')
  })

  it('provides export and allocation presets', () => {
    expect(new Set(seedStrategyPresets().map((item) => item.type))).toEqual(new Set(['export', 'allocation']))
  })
})
