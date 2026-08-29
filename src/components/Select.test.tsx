/* @vitest-environment jsdom */

import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import Select from './Select'

describe('Select', () => {
  it('opens from a native button and marks the selected option semantically', () => {
    const onChange = vi.fn()
    let renderer: ReturnType<typeof create>

    act(() => {
      renderer = create(
        <Select
          value="history"
          onChange={onChange}
          options={[
            { value: 'current', label: '当前任务' },
            { value: 'history', label: '导出历史' },
          ]}
        />,
      )
    })

    const trigger = renderer!.root.findByType('button')
    expect(trigger.props['aria-haspopup']).toBe('listbox')
    expect(trigger.props['aria-expanded']).toBe(false)

    act(() => trigger.props.onClick({ preventDefault: vi.fn(), stopPropagation: vi.fn() }))

    expect(renderer!.root.findByType('button').props['aria-expanded']).toBe(true)
    const selectedOption = renderer!.root.findByProps({ role: 'option', 'aria-selected': true })
    expect(selectedOption.props.className).toContain('ds-legacy-select__option--selected')
    expect(selectedOption.props.className).not.toContain('blue-')
  })

  it('lets keyboard users choose an option', () => {
    const onChange = vi.fn()
    let renderer: ReturnType<typeof create>

    act(() => {
      renderer = create(
        <Select
          value="png"
          onChange={onChange}
          options={[
            { value: 'png', label: 'PNG' },
            { value: 'jpg', label: 'JPG' },
          ]}
        />,
      )
    })

    const trigger = renderer!.root.findByType('button')
    act(() => trigger.props.onClick({ preventDefault: vi.fn(), stopPropagation: vi.fn() }))

    const jpgOption = renderer!.root.findAllByProps({ role: 'option' })[1]
    expect(jpgOption.props.tabIndex).toBe(0)

    act(() => jpgOption.props.onKeyDown({ key: 'Enter', preventDefault: vi.fn() }))
    expect(onChange).toHaveBeenCalledWith('jpg')
  })

  it('opens with arrow keys and closes with Escape from the trigger', () => {
    let renderer: ReturnType<typeof create>

    act(() => {
      renderer = create(
        <Select
          value="png"
          onChange={vi.fn()}
          options={[
            { value: 'png', label: 'PNG' },
            { value: 'jpg', label: 'JPG' },
          ]}
        />,
      )
    })

    const trigger = renderer!.root.findByType('button')
    act(() => trigger.props.onKeyDown({ key: 'ArrowDown', preventDefault: vi.fn() }))
    expect(renderer!.root.findByType('button').props['aria-expanded']).toBe(true)

    act(() => renderer!.root.findByType('button').props.onKeyDown({ key: 'Escape', preventDefault: vi.fn() }))
    expect(renderer!.root.findByType('button').props['aria-expanded']).toBe(false)
  })
})
