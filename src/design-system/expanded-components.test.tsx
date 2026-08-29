/* @vitest-environment jsdom */

import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { Checkbox, ListRow, Progress, SegmentedControl, Switch, Tabs } from '.'

describe('expanded design system components', () => {
  it('forwards checkbox changes through the boolean API', () => {
    const onChange = vi.fn()
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<Checkbox checked={false} onChange={onChange} label="自动保存" />)
    })

    const input = renderer!.root.findByType('input')
    expect(input.props.type).toBe('checkbox')
    act(() => input.props.onChange({ target: { checked: true } }))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('exposes switch semantics and a complete label', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(
        <Switch checked onCheckedChange={() => undefined} label="启用安全检查" description="立即生效" />,
      )
    })

    const input = renderer!.root.findByType('input')
    expect(input.props.role).toBe('switch')
    expect(input.props.checked).toBe(true)
    expect(renderer!.root.findByType('label').props.htmlFor).toBe(input.props.id)
  })

  it('uses radio semantics for segmented controls', () => {
    const onValueChange = vi.fn()
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(
        <SegmentedControl
          aria-label="工作模式"
          value="gallery"
          onValueChange={onValueChange}
          options={['gallery', 'agent']}
        />,
      )
    })

    const items = renderer!.root.findAllByProps({ role: 'radio' })
    expect(items[0].props['aria-checked']).toBe(true)
    expect(items[0].props.tabIndex).toBe(0)
    expect(items[1].props.tabIndex).toBe(-1)
    act(() => items[1].props.onClick())
    expect(onValueChange).toHaveBeenCalledWith('agent')

    onValueChange.mockClear()
    const focus = vi.fn()
    const preventDefault = vi.fn()
    act(() =>
      items[0].props.onKeyDown({
        key: 'ArrowRight',
        preventDefault,
        currentTarget: {
          parentElement: {
            querySelector: () => ({ focus }),
          },
        },
      }),
    )
    expect(preventDefault).toHaveBeenCalled()
    expect(focus).toHaveBeenCalled()
    expect(onValueChange).toHaveBeenCalledWith('agent')
  })

  it('connects tabs to the controlled value', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(
        <Tabs
          aria-label="设置"
          value="general"
          onValueChange={() => undefined}
          items={[
            { value: 'general', label: '常规' },
            { value: 'api', label: 'API' },
          ]}
        />,
      )
    })

    const tabs = renderer!.root.findAllByProps({ role: 'tab' })
    expect(tabs[0].props['aria-selected']).toBe(true)
    expect(tabs[0].props.tabIndex).toBe(0)
    expect(tabs[1].props.tabIndex).toBe(-1)
  })

  it('provides determinate progressbar values', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<Progress label="导出进度" value={68} showValue />)
    })

    const progressbar = renderer!.root.findByProps({ role: 'progressbar' })
    expect(progressbar.props['aria-valuenow']).toBe(68)
    expect(progressbar.props['aria-valuemax']).toBe(100)
  })

  it('renders interactive list rows with a native button', () => {
    const onClick = vi.fn()
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(
        <ListRow
          title="默认标签"
          description="3 个任务"
          selected
          variant="divided"
          interactive={{ 'aria-current': 'page', onClick }}
        />,
      )
    })

    const button = renderer!.root.findByType('button')
    expect(
      renderer!.root.findByProps({
        className: 'ds-list-row ds-list-row--selected ds-list-row--divided',
      }),
    ).toBeTruthy()
    expect(button.props['aria-current']).toBe('page')
    act(() => button.props.onClick())
    expect(onClick).toHaveBeenCalledOnce()
  })
})
