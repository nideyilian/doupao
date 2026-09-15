/* @vitest-environment jsdom */

import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import SeriesConsistencyControl, { type SeriesConsistencyValue } from './SeriesConsistencyControl'
import { SOP_SERIES_DEFAULT_FIXED_DIMENSIONS, SOP_SERIES_DIMENSIONS } from './sopSeriesDimensions'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** 触发按钮（未展开时也能看到固定项计数，所以不依赖 Popover 是否打开）。 */
function trigger(root: ReactTestInstance) {
  return root.findAllByType('button').find((button) => button.props['aria-label']?.startsWith('系列一致性：'))
}

/** 某个维度的「固定 / 每张变化」chip。 */
function dimensionChip(root: ReactTestInstance, dimension: string) {
  return root.findAllByProps({ role: 'switch' }).find((button) => button.props.children === dimension)
}

/** 某个固定维度的具体值输入框。 */
function fixedValueInput(root: ReactTestInstance, dimension: string) {
  return root.findAllByType('input').find((input) => input.props['aria-label'] === `${dimension}固定值`)
}

function presetButton(root: ReactTestInstance, label: string) {
  return root.findAllByType('button').find((button) => button.props.children === label)
}

function textContent(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : textContent(child))).join('')
}

function renderControl(initial?: Partial<SeriesConsistencyValue>) {
  const state: { latest: SeriesConsistencyValue } = {
    latest: {
      fixedDimensions: [...SOP_SERIES_DEFAULT_FIXED_DIMENSIONS],
      fixedValues: {},
      ...initial,
    },
  }
  function Harness() {
    const [value, setValue] = useState<SeriesConsistencyValue>(state.latest)
    return (
      <SeriesConsistencyControl
        value={value}
        onChange={(next) => {
          state.latest = next
          setValue(next)
        }}
      />
    )
  }
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(<Harness />)
  })
  act(() => trigger(renderer.root)!.props.onClick())
  return { renderer, state }
}

describe('SeriesConsistencyControl', () => {
  it('opens a panel listing exactly the picture-affecting dimensions', () => {
    const { renderer } = renderControl()

    const chips = renderer.root.findAllByProps({ role: 'switch' })
    expect(chips).toHaveLength(SOP_SERIES_DIMENSIONS.length)
    expect(chips.map((chip) => chip.props.children)).toEqual([...SOP_SERIES_DIMENSIONS])
    // 默认固定 5 项、变化 2 项，变化项不出现值输入框
    expect(trigger(renderer.root)!.props['aria-label']).toContain('5 项组内固定')
    expect(fixedValueInput(renderer.root, '主体')).toBeUndefined()
    expect(fixedValueInput(renderer.root, '背景')).toBeUndefined()

    renderer.unmount()
  })

  it('flips a dimension between fixed and per-image and keeps a filled value in state', () => {
    const { renderer, state } = renderControl()

    act(() => fixedValueInput(renderer.root, '画风')!.props.onChange({ target: { value: '3D 皮克斯风' } }))
    expect(state.latest.fixedValues['画风']).toBe('3D 皮克斯风')

    // 切成「每张变化」：输入框消失，但已填的值留在 state 里，切回来还在
    act(() => dimensionChip(renderer.root, '画风')!.props.onClick())
    expect(state.latest.fixedDimensions).not.toContain('画风')
    expect(fixedValueInput(renderer.root, '画风')).toBeUndefined()
    expect(state.latest.fixedValues['画风']).toBe('3D 皮克斯风')

    act(() => dimensionChip(renderer.root, '画风')!.props.onClick())
    expect(state.latest.fixedDimensions).toContain('画风')
    expect(fixedValueInput(renderer.root, '画风')!.props.value).toBe('3D 皮克斯风')

    renderer.unmount()
  })

  it('keeps fixed dimensions in the canonical dimension order regardless of click order', () => {
    const { renderer, state } = renderControl({ fixedDimensions: [], fixedValues: {} })

    act(() => dimensionChip(renderer.root, '背景')!.props.onClick())
    act(() => dimensionChip(renderer.root, '画风')!.props.onClick())
    act(() => dimensionChip(renderer.root, '主体')!.props.onClick())

    expect(state.latest.fixedDimensions).toEqual(['画风', '主体', '背景'])

    renderer.unmount()
  })

  it('counts only non-blank fixed values as locked', () => {
    const { renderer } = renderControl()

    // 触发按钮收起时也要能一眼看到有几个维度被钉死
    expect(textContent(trigger(renderer.root)!)).toBe('一致性5/7')
    act(() => fixedValueInput(renderer.root, '画风')!.props.onChange({ target: { value: '   ' } }))
    expect(textContent(trigger(renderer.root)!)).toBe('一致性5/7')

    act(() => fixedValueInput(renderer.root, '画风')!.props.onChange({ target: { value: '写实' } }))
    expect(textContent(trigger(renderer.root)!)).toBe('一致性5/7· 锁定 1')

    renderer.unmount()
  })

  it('applies presets in one click', () => {
    const { renderer, state } = renderControl()

    act(() => presetButton(renderer.root, '全变化')!.props.onClick())
    expect(state.latest.fixedDimensions).toEqual([])
    // 没有固定维度时不再渲染值输入区
    expect(fixedValueInput(renderer.root, '画风')).toBeUndefined()

    act(() => presetButton(renderer.root, '全固定')!.props.onClick())
    expect(state.latest.fixedDimensions).toEqual([...SOP_SERIES_DIMENSIONS])
    expect(fixedValueInput(renderer.root, '主体')).toBeTruthy()

    act(() => presetButton(renderer.root, '推荐')!.props.onClick())
    expect(state.latest.fixedDimensions).toEqual([...SOP_SERIES_DEFAULT_FIXED_DIMENSIONS])

    renderer.unmount()
  })
})
