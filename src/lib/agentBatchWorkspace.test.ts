import { describe, expect, it } from 'vitest'
import {
  applyAgentBatchPreset,
  createAgentBatchPreset,
  loadAgentBatchDraft,
  loadAgentBatchPresets,
  saveAgentBatchDraft,
  saveAgentBatchPresets,
} from './agentBatchWorkspace'

function storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
}

describe('agent batch workspace persistence', () => {
  it('persists presets and applies them without overwriting explicit row values', () => {
    const memory = storage()
    const preset = createAgentBatchPreset(
      {
        name: '竖图投放',
        strategyText: '突出主体',
        defaultCopyRatio: 0.4,
        redundancyPercent: 10,
        dailyLimit: 500,
        executionMode: 'task-first',
      },
      1,
    )
    saveAgentBatchPresets([preset], memory)
    expect(loadAgentBatchPresets(memory)).toEqual([preset])

    const [row] = applyAgentBatchPreset(
      [
        {
          sourceId: '1',
          sku: 'S',
          product: 'P',
          channel: 'C',
          specification: '1:1',
          quantity: 1,
          directions: [{ name: '人物' }],
          strategy: '已有策略',
          copyRatio: 0.2,
        },
      ],
      preset,
    )
    expect(row).toMatchObject({ strategy: '已有策略', copyRatio: 0.2 })
    expect(applyAgentBatchPreset([row], preset, true)[0]).toMatchObject({ strategy: '突出主体', copyRatio: 0.4 })
  })

  it('persists the active draft', () => {
    const memory = storage()
    const draft = {
      version: 1 as const,
      id: 'draft-1',
      name: '7 月素材',
      filePath: 'D:/tasks.csv',
      rows: [],
      outputRoot: 'D:/out',
      referenceRoot: '',
      startDate: '2026-07-16',
      dailyLimit: '2000',
      redundancyPercent: '10',
      copyPercent: '50',
      executionMode: 'task-first' as const,
      updatedAt: 1,
    }
    saveAgentBatchDraft(draft, memory)
    expect(loadAgentBatchDraft(memory)).toEqual(draft)
  })
})
