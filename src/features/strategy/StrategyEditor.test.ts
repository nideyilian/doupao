import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { StrategyCatalog } from './contracts'
import { createStrategyAsset } from './model'
import StrategyEditor, { snapshotSelectedFiles } from './StrategyEditor'

const catalog: StrategyCatalog = {
  products: [{ id: 'product-1', name: '测试产品', version: 1 }],
  materialTypes: [{ id: 'type-1', name: '测试素材', summary: '', mode: 'fixed', strategy: '', version: 1 }],
  channels: [],
}

function editorProps(strategy = createStrategyAsset('product-1', 'type-1', 'user-1')) {
  return {
    strategy,
    catalog,
    presets: [],
    sopItems: [],
    sopGroups: [],
    versions: [],
    knowledgeBatches: [],
    knowledgeInsights: [],
    generatedImageIds: [],
    testOrders: [],
    role: 'admin' as const,
    onSave: vi.fn(),
    onTest: vi.fn(() => ({})),
    onPickLocalReference: vi.fn(async () => []),
    onPickKnowledgeMaterial: vi.fn(async () => []),
    onRollback: vi.fn(),
  }
}

describe('SOP image selection', () => {
  it('keeps selected files after the live file input list is cleared', () => {
    const liveFiles: { [index: number]: string; length: number } = { 0: 'a.png', 1: 'b.jpg', length: 2 }

    const snapshot = snapshotSelectedFiles(liveFiles)
    liveFiles.length = 0

    expect(snapshot).toEqual(['a.png', 'b.jpg'])
  })
})

describe('StrategyEditor selection changes', () => {
  it('can switch from a selected strategy to all strategies and back without changing hook order', () => {
    const strategy = createStrategyAsset('product-1', 'type-1', 'user-1')
    const selectedProps = editorProps(strategy)
    let renderer!: ReturnType<typeof create>

    act(() => {
      renderer = create(createElement(StrategyEditor, selectedProps))
    })
    act(() => {
      renderer.update(createElement(StrategyEditor, { ...selectedProps, strategy: undefined }))
    })

    expect(renderer.root.findByProps({ children: '选择一个策略' })).toBeTruthy()

    act(() => {
      renderer.update(createElement(StrategyEditor, selectedProps))
    })
    expect(renderer.root.findByProps({ children: strategy.name })).toBeTruthy()
  })
})
