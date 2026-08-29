// @vitest-environment jsdom
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTooltip, type TooltipController, type TooltipOptions } from './useTooltip'

let controller: TooltipController | null = null

function Probe({ options }: { options?: TooltipOptions }) {
  controller = useTooltip(options)
  return null
}

function render(options?: TooltipOptions) {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(createElement(Probe, { options }))
  })
  return renderer
}

describe('useTooltip（统一工具提示控制器）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    controller = null
  })

  it('hover 显示 / 移出隐藏', () => {
    const renderer = render()
    act(() => controller!.handlers.onMouseEnter())
    expect(controller!.visible).toBe(true)
    act(() => controller!.handlers.onMouseLeave())
    expect(controller!.visible).toBe(false)
    act(() => renderer.unmount())
  })

  it('受 enabled 约束', () => {
    let enabled = false
    const renderer = render({ enabled: () => enabled })
    act(() => controller!.show())
    expect(controller!.visible).toBe(false)
    enabled = true
    act(() => controller!.show())
    expect(controller!.visible).toBe(true)
    act(() => renderer.unmount())
  })

  it('autoHideMs 到期自动隐藏', () => {
    const renderer = render({ autoHideMs: 2000 })
    act(() => controller!.show())
    expect(controller!.visible).toBe(true)
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(controller!.visible).toBe(false)
    act(() => renderer.unmount())
  })

  it('startTouch 延迟显示，clearTimer 取消', () => {
    const renderer = render()
    act(() => controller!.startTouch())
    act(() => {
      vi.advanceTimersByTime(449)
    })
    expect(controller!.visible).toBe(false)
    act(() => controller!.clearTimer())
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(controller!.visible).toBe(false)
    act(() => renderer.unmount())
  })
})
