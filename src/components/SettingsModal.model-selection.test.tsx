/* @vitest-environment jsdom */

import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { ApiConnectionPanel } from './SettingsModal'

describe('SettingsModal Agent model selection', () => {
  it('marks the current model and forwards another model click', () => {
    const onSelectModel = vi.fn()
    let renderer: ReturnType<typeof create>

    act(() => {
      renderer = create(
        <ApiConnectionPanel
          loading={false}
          feedback={{ type: 'success', message: '连接正常' }}
          models={[
            { id: 'gpt-5.5', type: 'multimodal' },
            { id: 'gpt-5.6-sol', type: 'multimodal' },
          ]}
          selectedModelId="gpt-5.5"
          onInspect={vi.fn()}
          onSelectModel={onSelectModel}
        />,
      )
    })

    expect(renderer!.root.findByProps({ title: 'gpt-5.5' }).props['aria-pressed']).toBe(true)

    act(() => renderer!.root.findByProps({ title: 'gpt-5.6-sol' }).props.onClick())
    expect(onSelectModel).toHaveBeenCalledWith('gpt-5.6-sol')
  })
})
