/* @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest'
import { act, create } from 'react-test-renderer'
import { createCompositeV2StoreState, useCompositeV2Store } from './storeV2'
import { PostprocessStatusBadge } from './PostprocessStatusBadge'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mountedRenderers: Array<ReturnType<typeof create>> = []

afterEach(() => {
  while (mountedRenderers.length) {
    mountedRenderers.pop()?.unmount()
  }
  useCompositeV2Store.setState(createCompositeV2StoreState())
})

function renderBadge() {
  let renderer: ReturnType<typeof create>
  act(() => {
    renderer = create(<PostprocessStatusBadge />)
  })
  mountedRenderers.push(renderer!)
  return renderer!
}

function jsonText(renderer: ReturnType<typeof create>) {
  const json = renderer.toJSON()
  if (json === null) return ''
  if (typeof json === 'string') return json
  const node = Array.isArray(json) ? (json[0] ?? null) : json
  if (node === null) return ''
  return (Array.isArray(node.children) ? node.children : [])
    .map((child) => (typeof child === 'string' ? child : ''))
    .join('')
}

describe('PostprocessStatusBadge', () => {
  it('未在导出时不渲染任何内容', () => {
    const renderer = renderBadge()
    expect(renderer.toJSON()).toBeNull()
  })

  it('导出完成/取消后同样不渲染', () => {
    const renderer = renderBadge()
    act(() => {
      useCompositeV2Store.setState({ exportStatus: 'completed', exportCompleted: 2, exportTotal: 2 })
    })
    expect(renderer.toJSON()).toBeNull()
    act(() => {
      useCompositeV2Store.setState({ exportStatus: 'canceled' })
    })
    expect(renderer.toJSON()).toBeNull()
  })

  it('运行中显示进度百分比（含脉冲动画）', () => {
    const renderer = renderBadge()
    act(() => {
      useCompositeV2Store.setState({ exportStatus: 'running', exportCompleted: 3, exportTotal: 10 })
    })
    const json = renderer.toJSON() as { props?: { className?: string } } | null
    expect(jsonText(renderer)).toContain('30%')
    expect(json?.props?.className ?? '').toContain('animate-pulse')
  })

  it('暂停时显示百分比但不带脉冲动画', () => {
    const renderer = renderBadge()
    act(() => {
      useCompositeV2Store.setState({ exportStatus: 'paused', exportCompleted: 1, exportTotal: 4 })
    })
    const json = renderer.toJSON() as { props?: { className?: string } } | null
    expect(jsonText(renderer)).toContain('25%')
    expect(json?.props?.className ?? '').not.toContain('animate-pulse')
  })

  it('取消中显示「取消中」', () => {
    const renderer = renderBadge()
    act(() => {
      useCompositeV2Store.setState({ exportStatus: 'canceling' })
    })
    expect(jsonText(renderer)).toContain('取消中')
  })

  it('未知总数时显示 0% 而不报错', () => {
    const renderer = renderBadge()
    act(() => {
      useCompositeV2Store.setState({ exportStatus: 'running', exportCompleted: 0, exportTotal: 0 })
    })
    expect(jsonText(renderer)).toContain('0%')
  })
})
