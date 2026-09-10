/* @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { Dialog } from './overlays'
import { __resetOverlayManager } from './overlayManager'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Harness() {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        打开
      </button>
      <Dialog open={open} onOpenChange={(nextOpen) => setOpen(nextOpen)} title="测试弹窗" closeOnBackdrop={false}>
        <input value={value} onChange={(event) => setValue(event.target.value)} />
        <button type="button" data-testid="rerender-dialog" onClick={() => setValue('检查')}>
          更新
        </button>
        <output data-testid="dialog-value">{value}</output>
      </Dialog>
    </>
  )
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  container = document.createElement('div')
  document.body.appendChild(container)
  act(() => {
    root = createRoot(container)
    root.render(<Harness />)
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  __resetOverlayManager()
  vi.unstubAllGlobals()
})

describe('Dialog', () => {
  it('keeps the focused field when the open-change callback identity changes on every render', () => {
    act(() => {
      container.querySelector<HTMLButtonElement>('button')!.click()
    })

    const input = document.body.querySelector<HTMLInputElement>('[role="dialog"] input')!
    input.focus()
    expect(document.activeElement).toBe(input)

    act(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="rerender-dialog"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('检查')
    expect(document.querySelector('[data-testid="dialog-value"]')?.textContent).toBe('检查')
  })
})
