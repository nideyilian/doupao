/* @vitest-environment jsdom */

import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createDefaultCompositeV2Preset } from '../lib/compositeV2Defaults'
import {
  convertNamingVariableToText,
  insertNamingVariable,
  moveNamingVariable,
  PresetNamingFields,
  readNamingTemplate,
  renderNamingTemplateHtml,
} from './PresetNamingFields'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('PresetNamingFields helpers', () => {
  it('renders variable tokens with resolved output values and preserves token identity', () => {
    const html = renderNamingTemplateHtml('{date}-快手-{size}-{channel}-{project}', {
      date: '20260625',
      size: '1080x1920',
      channel: '厂商',
      project: '极速版',
    })

    expect(html).toContain('data-variable-name="date"')
    expect(html).toContain('>20260625<')
    expect(html).toContain('>1080x1920<')
    expect(html).toContain('>厂商<')
    expect(html).toContain('>极速版<')
    expect(html).toContain('mention-tag')
  })

  it('converts resolved variable chips back to template tokens', () => {
    const host = document.createElement('div')
    host.innerHTML = '项目-<span data-variable-name="size">1080x1920</span>-文案'

    expect(readNamingTemplate(host)).toBe('项目-{size}-文案')
  })

  it('converts nested dragged variable markup back to template tokens', () => {
    const host = document.createElement('div')
    host.innerHTML = '项目-<span><span data-variable-name="size">1080x1920</span></span><span>文案</span>'

    expect(readNamingTemplate(host)).toBe('项目-{size}文案')
  })

  it('renders only the output root and filename as rich template editors', () => {
    const preset = createDefaultCompositeV2Preset(1)
    let renderer: ReturnType<typeof create>

    act(() => {
      renderer = create(
        createElement(PresetNamingFields, {
          preset,
          customVariables: [],
          previewValues: { date: '20260630', preset: preset.name, size: '1080x1920', channel: '渠道', index: '1' },
          onUpdatePreset: () => {},
          onAddCustomVariable: () => {},
          onUpdateCustomVariableValue: () => {},
          onRemoveCustomVariable: () => {},
        }),
      )
    })

    const editors = renderer!.root.findAll((node) => node.props.contentEditable === true)
    expect(editors).toHaveLength(2)
    expect(editors.map((editor) => editor.props['aria-label'])).toEqual(['输出根目录', `预设文件名模板 ${preset.name}`])
    expect(renderer!.root.findAllByProps({ 'data-testid': 'preset-subfolder-preview' })).toHaveLength(0)
  })
})

describe('insertNamingVariable', () => {
  it('inserts at a collapsed template selection without adding separators', () => {
    expect(insertNamingVariable('前-{size}-后', 'date', { start: 2, end: 2 })).toEqual({
      template: '前-{date}{size}-后',
      caret: 8,
    })
  })

  it('replaces a selected template range', () => {
    expect(insertNamingVariable('前-旧内容-后', 'size', { start: 2, end: 5 })).toEqual({
      template: '前-{size}-后',
      caret: 8,
    })
  })

  it('replaces a selected range in an absolute Windows path', () => {
    expect(insertNamingVariable('D:\\Exports\\daily', 'date', { start: 11, end: 16 })).toEqual({
      template: 'D:\\Exports\\{date}',
      caret: 17,
    })
  })

  it('appends when there is no valid editor selection', () => {
    expect(insertNamingVariable('{date}', 'index', null)).toEqual({
      template: '{date}{index}',
      caret: 13,
    })
  })
})

describe('naming variable chip operations', () => {
  it('moves a complete variable token to a new template offset', () => {
    expect(moveNamingVariable('{date}-{size}', 0, 13)).toBe('-{size}{date}')
  })

  it('converts a variable token to its current resolved text', () => {
    expect(convertNamingVariableToText('{date}-{size}', 0, { date: '20260703' })).toBe('20260703-{size}')
  })
})

describe('PresetNamingFields interactions', () => {
  function renderFields(
    preset = createDefaultCompositeV2Preset(1),
    customVariables = [] as Array<{ id: string; name: string; value: string }>,
    onUpdate = vi.fn(),
    onAddCustomVariable = vi.fn(),
    onUpdateCustomVariableValue = vi.fn(),
    onRemoveCustomVariable = vi.fn(),
  ) {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(
        createElement(PresetNamingFields, {
          preset,
          customVariables,
          previewValues: {
            date: '20260701',
            channel: '渠道',
            size: '1280x720',
            preset: preset.name,
            index: '1',
          },
          onUpdatePreset: onUpdate,
          onAddCustomVariable,
          onUpdateCustomVariableValue,
          onRemoveCustomVariable,
        }),
      )
    })
    return {
      renderer: renderer!,
      onUpdate,
      onAddCustomVariable,
      onUpdateCustomVariableValue,
      onRemoveCustomVariable,
    }
  }

  it('shows rich output-root and filename templates with only a file preview', () => {
    const preset = {
      ...createDefaultCompositeV2Preset(1),
      outputRootPath: 'D:\\Exports\\{project}',
      filenameTemplate: '{preset}-{index}',
      customVariableValues: { project: '项目A' },
    }
    const customVariables = [{ id: 'project', name: 'project', value: '默认项目' }]
    const { renderer } = renderFields(preset, customVariables)

    expect(renderer.root.findByProps({ 'aria-label': '输出根目录' }).props.dangerouslySetInnerHTML.__html).toContain(
      'data-variable-name="project"',
    )
    expect(
      renderer.root.findByProps({ 'aria-label': `预设文件名模板 ${preset.name}` }).props.dangerouslySetInnerHTML.__html,
    ).toContain('data-variable-name="preset"')
    expect(renderer.root.findAllByProps({ 'data-testid': 'preset-subfolder-preview' })).toHaveLength(0)
    expect(renderer.root.findByProps({ 'data-testid': 'preset-filename-preview' }).children.join('')).toBe(
      `${preset.name}-1.jpg`,
    )
  })

  it('switches controlled naming fields without updating either preset', () => {
    const presetA = {
      ...createDefaultCompositeV2Preset(1),
      filenameTemplate: 'A-{index}',
      customVariableValues: { project: '项目A' },
    }
    const presetB = {
      ...createDefaultCompositeV2Preset(2),
      id: 'preset-b',
      name: 'Preset B',
      filenameTemplate: 'B-{index}',
      customVariableValues: { project: '项目B' },
    }
    const onUpdate = vi.fn()
    const { renderer } = renderFields(presetA, [], onUpdate)

    act(() => {
      renderer.update(
        createElement(PresetNamingFields, {
          preset: presetB,
          customVariables: [],
          previewValues: {
            date: '20260701',
            channel: '渠道',
            size: '1280x720',
            preset: presetB.name,
            index: '1',
          },
          onUpdatePreset: onUpdate,
          onAddCustomVariable: vi.fn(),
          onUpdateCustomVariableValue: vi.fn(),
          onRemoveCustomVariable: vi.fn(),
        }),
      )
    })

    expect(
      renderer.root.findByProps({ 'aria-label': `预设文件名模板 ${presetB.name}` }).props.dangerouslySetInnerHTML
        .__html,
    ).toContain('data-variable-name="index"')
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('keeps the editor selection when a variable button is pressed', () => {
    const preset = createDefaultCompositeV2Preset(1)
    let renderer: ReturnType<typeof create>

    act(() => {
      renderer = create(
        createElement(PresetNamingFields, {
          preset,
          customVariables: [],
          previewValues: {
            date: '20260701',
            channel: '渠道',
            size: '1280x720',
            preset: preset.name,
            index: '1',
          },
          onUpdatePreset: () => {},
          onAddCustomVariable: () => {},
          onUpdateCustomVariableValue: () => {},
          onRemoveCustomVariable: () => {},
        }),
      )
    })

    const dateButton = renderer!.root.findByProps({ 'aria-label': '插入变量 {date}' })
    const preventDefault = vi.fn()
    dateButton.props.onMouseDown({ preventDefault })

    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('inserts into the active filename template field', () => {
    const preset = createDefaultCompositeV2Preset(1)
    const { renderer, onUpdate } = renderFields(preset)
    act(() => renderer.root.findByProps({ 'aria-label': '插入变量 {index}' }).props.onClick())

    expect(onUpdate).toHaveBeenLastCalledWith({
      filenameTemplate: `${preset.filenameTemplate}{index}`,
    })
  })

  it('syncs edited rich content back to the output-root template', () => {
    const preset = {
      ...createDefaultCompositeV2Preset(1),
      outputRootPath: 'D:\\Exports\\',
    }
    const { renderer, onUpdate } = renderFields(preset)
    const outputRoot = renderer.root.findByProps({ 'aria-label': '输出根目录' })
    const host = document.createElement('div')
    host.innerHTML = 'D:\\Exports\\<span data-variable-name="date">20260701</span>'
    act(() => outputRoot.props.onInput({ currentTarget: host }))

    expect(onUpdate).toHaveBeenLastCalledWith({
      outputRootPath: 'D:\\Exports\\{date}',
    })
  })

  it('converts a right-clicked filename variable chip to plain text', () => {
    const preset = createDefaultCompositeV2Preset(1)
    const { renderer, onUpdate } = renderFields(preset)
    const editor = renderer.root.findByProps({ 'aria-label': `预设文件名模板 ${preset.name}` })
    const host = document.createElement('div')
    host.innerHTML = '<span data-variable-name="preset">默认产品预设</span>-{source}-{index}'
    const chip = host.querySelector('[data-variable-name="preset"]')
    const preventDefault = vi.fn()
    act(() =>
      editor.props.onContextMenu({
        currentTarget: host,
        target: chip,
        preventDefault,
      }),
    )

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(onUpdate).toHaveBeenLastCalledWith({
      filenameTemplate: '默认产品预设-{source}-{index}',
    })
  })

  it('deletes a selected variable chip as one atomic value', () => {
    const preset = createDefaultCompositeV2Preset(1)
    const { renderer, onUpdate } = renderFields(preset)
    const editor = renderer.root.findByProps({ 'aria-label': `预设文件名模板 ${preset.name}` })
    const host = document.createElement('div')
    host.innerHTML = renderNamingTemplateHtml(preset.filenameTemplate, {
      preset: preset.name,
      source: 'source',
      index: '1',
    })
    document.body.appendChild(host)
    const chip = host.querySelector<HTMLElement>('[data-variable-name="source"]')!
    const range = document.createRange()
    range.selectNode(chip)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    const preventDefault = vi.fn()

    act(() =>
      editor.props.onKeyDown({
        key: 'Delete',
        currentTarget: host,
        preventDefault,
      }),
    )

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(onUpdate).toHaveBeenLastCalledWith({
      filenameTemplate: '{preset}--{index}',
    })
    host.remove()
  })

  it('moves a dragged variable chip to the drop position', () => {
    const preset = createDefaultCompositeV2Preset(1)
    const { renderer, onUpdate } = renderFields(preset)
    const editor = renderer.root.findByProps({ 'aria-label': `预设文件名模板 ${preset.name}` })
    const host = document.createElement('div')
    host.innerHTML = renderNamingTemplateHtml(preset.filenameTemplate, {
      preset: preset.name,
      source: 'source',
      index: '1',
    })
    const chip = host.querySelector<HTMLElement>('[data-variable-name="preset"]')!
    const dataTransfer = {
      effectAllowed: '',
      setData: vi.fn(),
    }
    const preventDefault = vi.fn()

    act(() =>
      editor.props.onDragStart({
        currentTarget: host,
        target: chip,
        dataTransfer,
      }),
    )
    act(() =>
      editor.props.onDrop({
        currentTarget: host,
        clientX: 0,
        clientY: 0,
        preventDefault,
      }),
    )

    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'preset')
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(onUpdate).toHaveBeenLastCalledWith({
      filenameTemplate: '-{source}-{index}{preset}',
    })
  })

  it('rejects a custom variable that uses a built-in name', () => {
    const { renderer, onUpdate, onAddCustomVariable } = renderFields()
    const nameInput = renderer.root.findByProps({ 'aria-label': '自定义变量名' })

    act(() => nameInput.props.onChange({ target: { value: 'date' } }))
    act(() => renderer.root.findByProps({ 'aria-label': '添加自定义变量' }).props.onClick())

    expect(onUpdate).not.toHaveBeenCalled()
    expect(onAddCustomVariable).not.toHaveBeenCalled()
    expect(renderer.root.findByProps({ 'aria-label': '自定义变量名' }).props.value).toBe('date')
    expect(renderer.root.findByProps({ 'aria-label': '自定义变量名' }).props['aria-invalid']).toBe(true)
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toBe('变量名已被使用')
  })

  it('rejects an existing custom variable name instead of updating it', () => {
    const preset = createDefaultCompositeV2Preset(1)
    const customVariables = [{ id: 'custom-project', name: 'project', value: '项目A' }]
    const { renderer, onUpdate, onAddCustomVariable } = renderFields(preset, customVariables)

    act(() =>
      renderer.root.findByProps({ 'aria-label': '自定义变量名' }).props.onChange({
        target: { value: 'project' },
      }),
    )
    act(() => renderer.root.findByProps({ 'aria-label': '添加自定义变量' }).props.onClick())

    expect(onUpdate).not.toHaveBeenCalled()
    expect(onAddCustomVariable).not.toHaveBeenCalled()
    expect(customVariables).toEqual([{ id: 'custom-project', name: 'project', value: '项目A' }])
  })

  it('clears unsubmitted custom-variable state when the preset changes', () => {
    const presetA = createDefaultCompositeV2Preset(1)
    const presetB = { ...createDefaultCompositeV2Preset(2), id: 'preset-b', name: 'Preset B' }
    const { renderer, onUpdate, onAddCustomVariable, onUpdateCustomVariableValue, onRemoveCustomVariable } =
      renderFields(presetA)

    act(() =>
      renderer.root.findByProps({ 'aria-label': '自定义变量名' }).props.onChange({
        target: { value: 'draftName' },
      }),
    )
    act(() =>
      renderer.root.findByProps({ 'aria-label': '自定义变量值' }).props.onChange({
        target: { value: '草稿值' },
      }),
    )

    act(() => {
      renderer.update(
        createElement(PresetNamingFields, {
          preset: presetB,
          customVariables: [],
          previewValues: {
            date: '20260701',
            channel: '渠道',
            size: '1280x720',
            preset: presetB.name,
            index: '1',
          },
          onUpdatePreset: onUpdate,
          onAddCustomVariable,
          onUpdateCustomVariableValue,
          onRemoveCustomVariable,
        }),
      )
    })

    expect(renderer.root.findByProps({ 'aria-label': '自定义变量名' }).props.value).toBe('')
    expect(renderer.root.findByProps({ 'aria-label': '自定义变量值' }).props.value).toBe('')
    expect(renderer.root.findByProps({ 'aria-label': '自定义变量名' }).props['aria-invalid']).toBeUndefined()
    expect(onAddCustomVariable).not.toHaveBeenCalled()
  })
})
