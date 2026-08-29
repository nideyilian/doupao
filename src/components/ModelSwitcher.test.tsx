/* @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest'
import { act, create } from 'react-test-renderer'
import { useStore } from '../store'
import { DEFAULT_IMAGES_MODEL, DEFAULT_RESPONSES_MODEL, normalizeSettings } from '../lib/apiProfiles'
import ModelSwitcher from './ModelSwitcher'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** 递归收集 react-test-renderer 节点下的全部文本 */
function collectText(
  node: ReturnType<typeof create>['root'] | ReturnType<typeof create>['root']['children'][number],
): string {
  if (typeof node === 'string') return node
  return (node.children ?? []).map((child) => collectText(child as never)).join('')
}

afterEach(() => {
  window.localStorage.clear()
})

describe('ModelSwitcher', () => {
  it('renders a compact icon trigger carrying the current image/text models in its tooltip', () => {
    const previousSettings = useStore.getState().settings
    act(() => {
      useStore.setState({
        settings: normalizeSettings({
          ...previousSettings,
          model: DEFAULT_IMAGES_MODEL,
          agentProfile: {
            ...previousSettings.agentProfile,
            model: DEFAULT_RESPONSES_MODEL,
            apiMode: 'responses',
          },
        }),
      })
    })

    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<ModelSwitcher />)
    })

    const button = renderer.root.findByProps({ 'aria-haspopup': 'listbox' })
    expect(button.props['aria-expanded']).toBe(false)
    expect(button.props['aria-label']).toBe('切换模型')
    expect(String(button.props.title)).toContain(DEFAULT_IMAGES_MODEL)
    expect(String(button.props.title)).toContain(DEFAULT_RESPONSES_MODEL)

    act(() => renderer.unmount())
    act(() => {
      useStore.setState({ settings: previousSettings })
    })
  })

  it('opens the dropdown and lists image profiles plus the agent text model', () => {
    const previousSettings = useStore.getState().settings
    act(() => {
      useStore.setState({
        settings: normalizeSettings({
          ...previousSettings,
          model: DEFAULT_IMAGES_MODEL,
          agentProfile: {
            ...previousSettings.agentProfile,
            name: 'Agent 中转',
            model: DEFAULT_RESPONSES_MODEL,
            apiMode: 'responses',
          },
        }),
      })
    })

    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<ModelSwitcher />)
    })

    act(() => {
      renderer.root.findByProps({ 'aria-haspopup': 'listbox' }).props.onClick()
    })

    const dropdown = renderer.root.findByProps({ role: 'listbox', 'aria-label': '切换模型' })
    const optionText = dropdown.findAllByProps({ role: 'option' }).map((node) => node.props['aria-selected'])
    // 默认只有一条生图配置，选中；文本模型区至少有一条（当前 Agent 文本模型），选中
    expect(optionText.length).toBeGreaterThanOrEqual(2)
    expect(optionText.filter(Boolean).length).toBeGreaterThanOrEqual(2)

    // 生图条目：配置名 + 模型 ID 均可见（「配置名 · 模型ID」）
    const imageOption = renderer.root.findByProps({ 'data-profile-id': previousSettings.activeProfileId })
    expect(collectText(imageOption)).toContain('默认')
    expect(collectText(imageOption)).toContain(DEFAULT_IMAGES_MODEL)

    // 文本条目：文本配置名 + 模型 ID 均可见（「配置名 · 模型ID」）
    // 默认 agentShareApiParameters=true（共享连接），配置名显示为「生图配置名 · Agent」
    const textOption = renderer.root.findByProps({ 'data-text-model-id': DEFAULT_RESPONSES_MODEL })
    expect(collectText(textOption)).toContain('默认 · Agent')
    expect(collectText(textOption)).toContain(DEFAULT_RESPONSES_MODEL)

    act(() => renderer.unmount())
    act(() => {
      useStore.setState({ settings: previousSettings })
    })
  })

  it('switches the active image profile when an image profile option is clicked', () => {
    const previousSettings = useStore.getState().settings
    const previousToast = useStore.getState().toast
    act(() => {
      useStore.setState({
        settings: normalizeSettings({
          ...previousSettings,
          profiles: [
            {
              id: 'profile-a',
              name: '配置 A',
              provider: 'openai',
              baseUrl: 'https://api.openai.com/v1',
              apiKey: 'sk-test',
              model: 'model-a',
              timeout: 600,
              apiMode: 'images',
              codexCli: false,
              apiProxy: false,
            },
            {
              id: 'profile-b',
              name: '配置 B',
              provider: 'openai',
              baseUrl: 'https://api.openai.com/v1',
              apiKey: 'sk-test',
              model: 'model-b',
              timeout: 600,
              apiMode: 'images',
              codexCli: false,
              apiProxy: false,
            },
          ],
          activeProfileId: 'profile-a',
        }),
      })
    })

    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<ModelSwitcher />)
    })
    act(() => {
      renderer.root.findByProps({ 'aria-haspopup': 'listbox' }).props.onClick()
    })

    const profileBOption = renderer.root.findByProps({ 'data-profile-id': 'profile-b' })
    expect(profileBOption).toBeTruthy()

    act(() => profileBOption!.props.onClick())
    expect(useStore.getState().settings.activeProfileId).toBe('profile-b')
    expect(useStore.getState().settings.model).toBe('model-b')

    act(() => renderer.unmount())
    act(() => {
      useStore.setState({ settings: previousSettings, toast: previousToast })
    })
  })

  it('switches the agent text model via manual input', () => {
    const previousSettings = useStore.getState().settings
    act(() => {
      useStore.setState({
        settings: normalizeSettings({
          ...previousSettings,
          agentProfile: {
            ...previousSettings.agentProfile,
            model: DEFAULT_RESPONSES_MODEL,
            apiMode: 'responses',
          },
        }),
      })
    })

    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<ModelSwitcher />)
    })
    act(() => {
      renderer.root.findByProps({ 'aria-haspopup': 'listbox' }).props.onClick()
    })

    const input = renderer.root.findByProps({ 'aria-label': '手动输入文本模型' })
    act(() => input.props.onChange({ target: { value: 'gpt-5-custom' } }))

    const form = renderer.root.findAll((node) => node.type === 'form')[0]
    act(() => form.props.onSubmit({ preventDefault: () => {} }))

    expect(useStore.getState().settings.agentProfile.model).toBe('gpt-5-custom')

    act(() => renderer.unmount())
    act(() => {
      useStore.setState({ settings: previousSettings })
    })
  })

  it('shows the standalone agent config name when text connection is independent', () => {
    const previousSettings = useStore.getState().settings
    act(() => {
      useStore.setState({
        settings: normalizeSettings({
          ...previousSettings,
          agentShareApiParameters: false,
          agentProfiles: [
            {
              ...previousSettings.agentProfiles[0],
              name: '独立文本中转',
              model: DEFAULT_RESPONSES_MODEL,
              apiMode: 'responses',
            },
          ],
        }),
      })
    })

    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<ModelSwitcher />)
    })
    act(() => {
      renderer.root.findByProps({ 'aria-haspopup': 'listbox' }).props.onClick()
    })

    const textOption = renderer.root.findByProps({ 'data-text-model-id': DEFAULT_RESPONSES_MODEL })
    expect(collectText(textOption)).toContain('独立文本中转')
    expect(collectText(textOption)).not.toContain(' · Agent')

    act(() => renderer.unmount())
    act(() => {
      useStore.setState({ settings: previousSettings })
    })
  })
})
