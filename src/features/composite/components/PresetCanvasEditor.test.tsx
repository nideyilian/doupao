/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create } from 'react-test-renderer'
import { createDefaultCompositeV2Preset } from '../lib/compositeV2Defaults'
import { createCompositeV2Store } from '../storeV2'
import { PresetCanvasEditor } from './PresetCanvasEditor'

describe('PresetCanvasEditor', () => {
  afterEach(() => {
    delete (window as Window & { electronAPI?: typeof window.electronAPI }).electronAPI
    vi.restoreAllMocks()
  })

  it('opens an in-place editor when a text layer is double-clicked', () => {
    const store = createCompositeV2Store()
    const presetId = store.getState().presets[0]!.id
    store.getState().addTextLayer(presetId)
    const preset = store.getState().presets[0]!
    const textLayer = preset.layers[0]!

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(
        <PresetCanvasEditor
          preset={preset}
          selectedLayerId={textLayer.id}
          onAddText={() => {}}
          onAddImage={() => {}}
          onAddLogo={() => {}}
          onUpdatePreset={() => {}}
        />,
      )
    })

    const hitbox = renderer!.root.findAllByType('button').find((node) => node.props.title === textLayer.name)
    expect(typeof hitbox?.props.onDoubleClick).toBe('function')

    act(() => {
      hitbox?.props.onDoubleClick({
        stopPropagation: () => {},
        currentTarget: { parentElement: null },
      })
    })

    const editor = renderer!.root
      .findAllByType('textarea')
      .find((node) => node.props['aria-label'] === `Edit text ${textLayer.name}`)
    expect(editor?.props.value).toBe('New Text')
    act(() => renderer!.unmount())
  })

  it('binds a double-click handler for image layers on canvas', () => {
    const store = createCompositeV2Store()
    const presetId = store.getState().presets[0]!.id
    store.getState().addImageLayer(presetId)
    const preset = store.getState().presets[0]!
    const imageLayer = preset.layers[0]!

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(
        <PresetCanvasEditor
          preset={preset}
          selectedLayerId={imageLayer.id}
          onAddText={() => {}}
          onAddImage={() => {}}
          onAddLogo={() => {}}
          onUpdatePreset={() => {}}
        />,
      )
    })

    const hitbox = renderer!.root.findAllByType('button').find((node) => node.props.title === imageLayer.name)
    expect(typeof hitbox?.props.onDoubleClick).toBe('function')

    act(() => renderer!.unmount())
  })

  it('renders only the canvas workspace', () => {
    const html = renderToStaticMarkup(
      <PresetCanvasEditor
        preset={{ ...createDefaultCompositeV2Preset(1), name: 'Preset Shell' }}
        onAddText={() => {}}
        onAddImage={() => {}}
        onAddLogo={() => {}}
      />,
    )

    expect(html).toContain('Preset Shell')
    expect(html).toContain('aria-label="添加文字图层"')
    expect(html).toContain('<canvas')
    expect(html).toContain('data-layout="preset-canvas-stage"')
    expect(html).toContain('data-preview-backdrop="transparent"')
    expect(html).toContain('切换预览背景，当前为透明背景')
    expect(html).not.toContain('data-layout="logo-sidebar"')
    expect(html).not.toContain('data-layout="docked-layer-panel"')
    expect(html).not.toContain('data-layout="floating-layer-panel"')
    expect(html.indexOf('data-layout="preset-title"')).toBeLessThan(html.indexOf('data-layout="preset-canvas"'))
  })

  it('disables layer creation when no preset is selected', () => {
    const html = renderToStaticMarkup(
      <PresetCanvasEditor preset={null} onAddText={() => {}} onAddImage={() => {}} onAddLogo={() => {}} />,
    )

    expect(html).toContain('aria-label="未选择预设时无法添加文字图层"')
    expect(html).toContain('title="请先选择预设以添加文字图层"')
    expect(html).toContain('aria-label="未选择预设时无法添加图片图层"')
    expect(html).toContain('title="请先选择预设以添加图片图层"')
    expect((html.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('cycles preview backdrop mode in order', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(
        <PresetCanvasEditor
          preset={{ ...createDefaultCompositeV2Preset(1), name: 'Backdrop Test' }}
          onAddText={() => {}}
          onAddImage={() => {}}
          onAddLogo={() => {}}
        />,
      )
    })

    const getCanvasHost = () => renderer!.root.findByProps({ 'data-layout': 'preset-canvas' })
    const getBackdropButton = () =>
      renderer!.root
        .findAllByType('button')
        .find(
          (node) => typeof node.props['aria-label'] === 'string' && node.props['aria-label'].includes('切换预览背景'),
        )

    expect(getCanvasHost().props['data-preview-backdrop']).toBe('transparent')

    act(() => {
      getBackdropButton()?.props.onClick()
    })
    expect(getCanvasHost().props['data-preview-backdrop']).toBe('black')

    act(() => {
      getBackdropButton()?.props.onClick()
    })
    expect(getCanvasHost().props['data-preview-backdrop']).toBe('white')

    act(() => {
      getBackdropButton()?.props.onClick()
    })
    expect(getCanvasHost().props['data-preview-backdrop']).toBe('transparent')

    act(() => renderer!.unmount())
  })
})
