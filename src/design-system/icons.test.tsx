/* @vitest-environment jsdom */

import { act, create } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import { CopyIcon as LegacyCopyIcon } from '../components/icons'
import { FavoriteIcon, Icon, iconRegistry } from './icons'

describe('design system icons', () => {
  it('renders decorative icons with consistent SVG defaults', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<Icon name="copy" />)
    })

    const svg = renderer!.root.findByType('svg')
    expect(svg.props.width).toBe(20)
    expect(svg.props.height).toBe(20)
    expect(svg.props.strokeWidth).toBe(2)
    expect(svg.props.focusable).toBe('false')
    expect(svg.props['aria-hidden']).toBe(true)
  })

  it('exposes an accessible image name when a title is provided', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<Icon name="download" title="下载文件" />)
    })

    const svg = renderer!.root.findByType('svg')
    expect(svg.props.role).toBe('img')
    expect(svg.props['aria-label']).toBe('下载文件')
    expect(svg.props['aria-hidden']).toBeUndefined()
  })

  it('keeps filled favorite icons as a supported semantic variant', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<FavoriteIcon filled />)
    })

    expect(renderer!.root.findByType('svg').props.fill).toBe('currentColor')
  })

  it('keeps the legacy component icon entry wired to the global library', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<LegacyCopyIcon size={16} />)
    })

    expect(renderer!.root.findByType('svg').props.width).toBe(16)
    expect(iconRegistry.copy).toBeDefined()
  })
})
