/* @vitest-environment jsdom */

import { act, create } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import { Button, IconButton, TextField } from './components'

describe('design system components', () => {
  it('locks a loading button and exposes busy state', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<Button loading>保存</Button>)
    })

    const button = renderer!.root.findByType('button')
    expect(button.props.disabled).toBe(true)
    expect(button.props['aria-busy']).toBe(true)
    expect(button.props.className).toContain('ds-button--primary')
  })

  it('requires and forwards an accessible name for icon buttons', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<IconButton aria-label="添加图片" icon={<svg />} />)
    })

    expect(renderer!.root.findByType('button').props['aria-label']).toBe('添加图片')
  })

  it('connects field errors to the input', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<TextField id="api-key" label="API Key" error="不能为空" />)
    })

    const input = renderer!.root.findByType('input')
    const message = renderer!.root.findByType('p')
    expect(input.props['aria-invalid']).toBe(true)
    expect(input.props['aria-describedby']).toBe('api-key-message')
    expect(message.props.id).toBe('api-key-message')
    expect(message.props.role).toBe('alert')
  })
})

describe('Button', () => {
  it('renders with the primary variant class by default', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<Button>提交</Button>)
    })
    const button = renderer!.root.findByType('button')
    expect(button.props.className).toContain('ds-button--primary')
    expect(button.props.disabled).toBe(false)
  })

  it('exposes disabled state and prevents interaction', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<Button disabled>禁用按钮</Button>)
    })
    const button = renderer!.root.findByType('button')
    expect(button.props.disabled).toBe(true)
    expect(button.props.className).toContain('ds-button--primary')
  })

  it('disables the button while loading', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<Button loading>保存中</Button>)
    })
    const button = renderer!.root.findByType('button')
    expect(button.props.disabled).toBe(true)
    expect(button.props['aria-busy']).toBe(true)
  })

  it('renders a spinner when loading', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<Button loading>保存</Button>)
    })
    const spinner = renderer!.root.findAll(
      (node) => typeof node.props?.className === 'string' && node.props.className.includes('ds-spinner'),
    )
    expect(spinner.length).toBeGreaterThanOrEqual(1)
  })

  it('does not render a spinner when not loading', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<Button>保存</Button>)
    })
    const spinner = renderer!.root.findAll(
      (node) => typeof node.props?.className === 'string' && node.props.className.includes('ds-spinner'),
    )
    expect(spinner.length).toBe(0)
  })

  it('renders every variant with the correct CSS class', () => {
    const variants = ['primary', 'secondary', 'ghost', 'danger'] as const
    for (const variant of variants) {
      let renderer: ReturnType<typeof create>
      act(() => {
        renderer = create(<Button variant={variant}>{variant}</Button>)
      })
      const button = renderer!.root.findByType('button')
      expect(button.props.className).toContain(`ds-button--${variant}`)
    }
  })

  it('renders with the sm size class', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<Button size="sm">小按钮</Button>)
    })
    const button = renderer!.root.findByType('button')
    expect(button.props.className).toContain('ds-button--sm')
  })

  it('renders with the lg size class', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<Button size="lg">大按钮</Button>)
    })
    const button = renderer!.root.findByType('button')
    expect(button.props.className).toContain('ds-button--lg')
  })

  it('does not include a size class for the default md size', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<Button size="md">中等按钮</Button>)
    })
    const button = renderer!.root.findByType('button')
    expect(button.props.className).not.toContain('ds-button--md')
    expect(button.props.className).toContain('ds-button')
  })

  it('renders a leading icon when provided', () => {
    const icon = <svg data-testid="leading-icon" />
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<Button leadingIcon={icon}>带图标</Button>)
    })
    const button = renderer!.root.findByType('button')
    // The leading icon should be rendered (not replaced by spinner since not loading)
    expect(button.props.children.length).toBeGreaterThanOrEqual(2)
  })

  it('defaults to type="button" to prevent accidental form submission', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<Button>保存</Button>)
    })
    const button = renderer!.root.findByType('button')
    expect(button.props.type).toBe('button')
  })

  it('accepts forwarded className', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<Button className="flex-1 custom-class">保存</Button>)
    })
    const button = renderer!.root.findByType('button')
    expect(button.props.className).toContain('flex-1')
    expect(button.props.className).toContain('custom-class')
  })
})
