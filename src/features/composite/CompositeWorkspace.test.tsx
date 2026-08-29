import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import CompositeWorkspace from './CompositeWorkspace'

vi.mock('./components/BatchExportTab', () => ({
  BatchExportTab: () => <div>batch-screen</div>,
}))

vi.mock('./components/PresetManagementTab', () => ({
  PresetManagementTab: () => <div>preset-screen</div>,
}))

describe('CompositeWorkspace', () => {
  it('fills the viewport below the fixed application header', () => {
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<CompositeWorkspace />)
    })

    const workspace = renderer.root.findByType('main')
    expect(workspace.props.className).toContain('h-[calc(100vh-var(--app-header-offset))]')
    expect(workspace.props.className).toContain('overflow-hidden')
  })

  it('switches between batch export and preset management', () => {
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<CompositeWorkspace />)
    })
    expect(renderer.root.findByProps({ children: 'batch-screen' })).toBeTruthy()

    const presetTab = renderer.root.findByProps({ children: '预设管理' })
    act(() => presetTab.props.onClick())

    expect(renderer.root.findByProps({ children: 'preset-screen' })).toBeTruthy()
  })
})
