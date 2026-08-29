/* @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRef } from 'react'
import { useDragSelect } from './useDragSelect'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * 回归测试：is-drag-selecting（CSS 会让项 pointer-events: none）只能在真正开始拖拽
 * （越过 6px 阈值）后加到容器上。若 mousedown 瞬间就加，单击时 mouseup 的命中测试
 * 会因卡片 pointer-events: none 落到容器上，click 派发到容器导致「单击选中失效」。
 */

function Harness() {
  const surfaceRef = useRef<HTMLDivElement>(null)
  useDragSelect({
    containerSelector: '[data-test-surface]',
    containerRef: surfaceRef,
    itemSelector: '[data-item]',
    getItemId: (element) => (element instanceof HTMLElement ? (element.dataset.itemId ?? null) : null),
    onSelectionChange: vi.fn(),
  })
  return (
    <div ref={surfaceRef} data-test-surface>
      <div data-item data-item-id="a" />
      <div data-item data-item-id="b" />
    </div>
  )
}

function fireMouse(target: EventTarget, type: string, clientX: number, clientY: number, button = 0) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button }))
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  act(() => {
    root = createRoot(container)
    root.render(<Harness />)
  })
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

describe('useDragSelect drag surface class timing', () => {
  it('does not add is-drag-selecting on plain mousedown (single click must stay clickable)', () => {
    const surface = document.querySelector<HTMLDivElement>('[data-test-surface]')!
    const first = document.querySelector<HTMLElement>('[data-item]')!
    act(() => {
      fireMouse(first, 'mousedown', 100, 100)
    })
    expect(surface.classList.contains('is-drag-selecting')).toBe(false)
    act(() => {
      fireMouse(first, 'mouseup', 100, 100)
    })
    expect(surface.classList.contains('is-drag-selecting')).toBe(false)
  })

  it('clears any lingering text selection when a marquee gesture starts', () => {
    // 双击提示词/参数残留的浏览器原生文字选中，应在框选开始时被清除，避免干扰后续操作
    const removeAllRanges = vi.fn()
    const originalGetSelection = window.getSelection
    Object.defineProperty(window, 'getSelection', {
      configurable: true,
      writable: true,
      value: () => ({ removeAllRanges, isCollapsed: false }),
    })
    try {
      const first = document.querySelector<HTMLElement>('[data-item]')!
      act(() => {
        fireMouse(first, 'mousedown', 100, 100)
      })
      expect(removeAllRanges).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(window, 'getSelection', {
        configurable: true,
        writable: true,
        value: originalGetSelection,
      })
    }
  })

  it('adds is-drag-selecting only after the drag exceeds the 6px threshold and removes it on release', () => {
    const surface = document.querySelector<HTMLDivElement>('[data-test-surface]')!
    const first = document.querySelector<HTMLElement>('[data-item]')!
    act(() => {
      fireMouse(first, 'mousedown', 100, 100)
    })
    expect(surface.classList.contains('is-drag-selecting')).toBe(false)
    // 小于阈值：仍未进入拖拽
    act(() => {
      fireMouse(document, 'mousemove', 103, 102)
    })
    expect(surface.classList.contains('is-drag-selecting')).toBe(false)
    // 超过阈值：进入拖拽
    act(() => {
      fireMouse(document, 'mousemove', 130, 140)
    })
    expect(surface.classList.contains('is-drag-selecting')).toBe(true)
    act(() => {
      fireMouse(document, 'mouseup', 130, 140)
    })
    expect(surface.classList.contains('is-drag-selecting')).toBe(false)
  })
})
