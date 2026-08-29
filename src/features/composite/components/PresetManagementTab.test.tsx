/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import {
  createDefaultCompositeV2OutputRuleGroups,
  createDefaultCompositeV2Preset,
  createDefaultCompositeV2PresetGroup,
} from '../lib/compositeV2Defaults'
import { useStore } from '../../../store'
import { createCompositeV2StoreState, useCompositeV2Store } from '../storeV2'
import * as compositeAssets from '../lib/compositeAssets'
import { PresetCanvasEditor } from './PresetCanvasEditor'
import { FloatingLogoLibrary } from './FloatingLogoLibrary'
import { PresetManagementTab } from './PresetManagementTab'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mountedRenderers: Array<ReturnType<typeof create>> = []

afterEach(() => {
  while (mountedRenderers.length) {
    mountedRenderers.pop()?.unmount()
  }
  useCompositeV2Store.setState(createCompositeV2StoreState())
  useStore.getState().setConfirmDialog(null)
  vi.restoreAllMocks()
  delete (window as Window & { electronAPI?: typeof window.electronAPI }).electronAPI
})

function getNodeText(node: ReactTestInstance): string {
  return node.children
    .map((child: string | ReactTestInstance) => (typeof child === 'string' ? child : getNodeText(child)))
    .join('')
}

function findButtonByText(root: ReactTestInstance, text: string) {
  return root
    .findAll((node: ReactTestInstance) => node.type === 'button')
    .find((node: ReactTestInstance) => getNodeText(node).includes(text))
}

function findInputByAriaLabel(root: ReactTestInstance, label: string) {
  return root.findAllByType('input').find((node: ReactTestInstance) => node.props['aria-label'] === label)
}

describe('PresetManagementTab', () => {
  it('stores imported LOGO bytes before adding metadata', async () => {
    let resolveIds!: (ids: string[]) => void
    vi.spyOn(compositeAssets, 'storeCompositeBlobs').mockReturnValue(
      new Promise((resolve) => {
        resolveIds = resolve
      }),
    )
    const file = new File(['logo'], 'logo.png', { type: 'image/png' })
    const files = {
      0: file,
      length: 1,
      item: () => null,
      [Symbol.iterator]: function* () {
        yield file
      },
    } as unknown as FileList
    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    let importing!: Promise<void>
    act(() => {
      importing = renderer!.root.findByType(FloatingLogoLibrary).props.onImportFiles(files)
    })
    expect(useCompositeV2Store.getState().projectLogos).toEqual([])

    await act(async () => {
      resolveIds(['asset-logo'])
      await importing
    })
    expect(useCompositeV2Store.getState().projectLogos[0]).toMatchObject({
      name: 'logo.png',
      assetId: 'asset-logo',
    })
  })

  it('uses a stacked library rail beside a full preview workspace', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'preset-management-workspace')).toHaveLength(
      1,
    )
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'stacked-library-rail')).toHaveLength(1)
    expect(
      renderer!.root.find((node) => node.props['data-layout'] === 'stacked-library-rail').props.style.gridTemplateRows,
    ).toContain('50%')
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'rail-resizer')).toHaveLength(1)
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'canvas-pane')).toHaveLength(1)
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'logo-sidebar')).toHaveLength(1)
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'layer-bottom-panel')).toHaveLength(1)

    const workspace = renderer!.root.find((node) => node.props['data-layout'] === 'preset-management-workspace')
    expect(workspace.props.className).toContain('h-full')
    expect(workspace.props.className).not.toContain('min-h-[680px]')

    const fixedMinimumHeightNodes = renderer!.root.findAll(
      (node) => typeof node.props.className === 'string' && node.props.className.includes('min-h-[680px]'),
    )
    expect(fixedMinimumHeightNodes).toHaveLength(0)
  })

  it('resizes the two left library panes from their shared divider', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    const divider = renderer!.root.findByProps({ 'data-layout': 'rail-resizer' })
    const pointerTarget = {
      parentElement: { getBoundingClientRect: () => ({ top: 100, height: 400 }) },
      setPointerCapture: () => {},
      releasePointerCapture: () => {},
    }
    act(() => {
      divider.props.onPointerDown({ pointerId: 1, clientY: 300, currentTarget: pointerTarget })
      divider.props.onPointerMove({ pointerId: 1, clientY: 220, currentTarget: pointerTarget })
      divider.props.onPointerUp({ pointerId: 1, currentTarget: pointerTarget })
    })

    expect(
      renderer!.root.find((node) => node.props['data-layout'] === 'stacked-library-rail').props.style.gridTemplateRows,
    ).toContain('30%')
  })

  it('creates and renames preset groups without browser prompts', () => {
    const initialCount = useCompositeV2Store.getState().presetGroups.length
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    const addButton = renderer!.root.findByProps({ title: '新建预设组' })
    act(() => {
      addButton.props.onClick()
    })
    expect(useCompositeV2Store.getState().presetGroups).toHaveLength(initialCount + 1)

    const created = useCompositeV2Store.getState().presetGroups.at(-1)!
    const groupButton = findButtonByText(renderer!.root, created.name)
    act(() => {
      groupButton?.props.onDoubleClick()
    })

    const renameInput = findInputByAriaLabel(renderer!.root, `重命名预设组 ${created.name}`)
    expect(renameInput).toBeDefined()
    act(() => {
      renameInput?.props.onChange({ target: { value: '已重命名组' } })
    })
    act(() => {
      findInputByAriaLabel(renderer!.root, `重命名预设组 ${created.name}`)?.props.onKeyDown({
        key: 'Enter',
        preventDefault: () => {},
      })
    })
    expect(useCompositeV2Store.getState().presetGroups.at(-1)?.name).toBe('已重命名组')
  })

  it('reorders preset groups by dragging', () => {
    const groupA = { ...createDefaultCompositeV2PresetGroup(1), id: 'group-a', name: 'Group A' }
    const groupB = { ...createDefaultCompositeV2PresetGroup(2), id: 'group-b', name: 'Group B' }
    useCompositeV2Store.setState({
      presetGroups: [groupA, groupB],
      selectedPresetGroupId: groupA.id,
    })

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    const source = renderer!.root.findByProps({ 'data-preset-group-id': groupB.id })
    act(() => {
      source.props.onDragStart({ dataTransfer: { effectAllowed: '' } })
    })
    const target = renderer!.root.findByProps({ 'data-preset-group-id': groupA.id })
    act(() => {
      target.props.onDragOver({ preventDefault: () => {} })
      target.props.onDrop({ preventDefault: () => {} })
    })

    expect(useCompositeV2Store.getState().presetGroups.map((group) => group.id)).toEqual([groupB.id, groupA.id])
  })

  it('replaces an existing LOGO layer instead of adding an image layer', async () => {
    const preset = { ...createDefaultCompositeV2Preset(1), id: 'preset-logo' }
    const group = { ...createDefaultCompositeV2PresetGroup(1), presetIds: [preset.id] }
    useCompositeV2Store.setState({
      presets: [preset],
      presetGroups: [group],
      selectedPresetGroupId: group.id,
      selectedPreviewPresetId: preset.id,
      logoLibraryPath: 'D:/logos',
    })
    const logoId = useCompositeV2Store.getState().replaceOrAddLogoLayer(preset.id, { kind: 'project', id: 'old-logo' })
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {},
    })

    useCompositeV2Store.setState({
      projectLogos: [{ id: 'new-logo', name: 'new.png', dataUrl: 'data:image/png;base64,AAAA' }],
    })

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<PresetManagementTab />)
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    const logoButton = renderer!.root
      .findAllByType('button')
      .find(
        (node) =>
          node.props['aria-label'] === '应用LOGO' &&
          node.parent?.parent?.children.some((c: any) => c.props?.title === 'new.png'),
      )
    act(() => {
      logoButton?.props.onClick()
    })

    const layers = useCompositeV2Store.getState().presets[0]!.layers
    expect(layers).toHaveLength(1)
    expect(layers[0]).toMatchObject({
      id: logoId,
      type: 'logo',
      asset: {
        kind: 'project',
        id: 'old-logo',
      },
    })
  })

  it('toggles every override size in a channel from its select-all checkbox', () => {
    const outputRuleGroupsOverride = createDefaultCompositeV2OutputRuleGroups()
    const targetGroup = outputRuleGroupsOverride[1]!
    const preset = {
      ...createDefaultCompositeV2Preset(1),
      useOutputOverrides: true,
      outputRuleGroupsOverride,
    }
    const group = { ...createDefaultCompositeV2PresetGroup(1), presetIds: [preset.id] }
    useCompositeV2Store.setState({
      presets: [preset],
      presetGroups: [group],
      selectedPresetGroupId: group.id,
      selectedPreviewPresetId: preset.id,
    })

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    const selectAll = findInputByAriaLabel(renderer!.root, `全选覆盖 ${targetGroup.name} 尺寸`)
    expect(selectAll).toBeDefined()

    act(() => {
      selectAll?.props.onChange({ target: { checked: true } })
    })

    expect(
      useCompositeV2Store.getState().presets[0]!.outputRuleGroupsOverride[1]!.rules.every((rule) => rule.enabled),
    ).toBe(true)
  })

  it('edits per-preset output root, filename template, and custom variables outside channel overrides', () => {
    const preset = createDefaultCompositeV2Preset(1)
    const group = { ...createDefaultCompositeV2PresetGroup(1), presetIds: [preset.id] }
    useCompositeV2Store.setState({
      presets: [preset],
      presetGroups: [group],
      selectedPresetGroupId: group.id,
      selectedPreviewPresetId: preset.id,
    })

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    const outputRootEditor = renderer!.root.find((node) => node.props['aria-label'] === '输出根目录')
    const filenameEditor = renderer!.root.find((node) => node.props['aria-label'] === `预设文件名模板 ${preset.name}`)
    expect(outputRootEditor.props.contentEditable).toBe(true)
    expect(filenameEditor.props.contentEditable).toBe(true)
    expect(renderer!.root.findAll((node) => node.props['aria-label'] === `预设目录模板 ${preset.name}`)).toHaveLength(0)
    expect(renderer!.root.findAllByProps({ 'aria-label': '插入变量 {date}' })).toHaveLength(1)
    expect(renderer!.root.findAllByProps({ 'aria-label': '插入变量 {channel}' })).toHaveLength(1)

    const outputRootHost = document.createElement('div')
    outputRootHost.textContent = 'D:\\Exports'
    const filenameHost = document.createElement('div')
    filenameHost.innerHTML =
      '<span data-variable-name="preset">默认产品预设</span>-<span data-variable-name="index">1</span>'
    act(() => {
      outputRootEditor.props.onInput({ currentTarget: outputRootHost })
      filenameEditor.props.onInput({ currentTarget: filenameHost })
    })
    expect(useCompositeV2Store.getState().presets[0]).toMatchObject({
      outputRootPath: 'D:\\Exports',
      filenameTemplate: '{preset}-{index}',
    })

    act(() => {
      findInputByAriaLabel(renderer!.root, '自定义变量名')?.props.onChange({ target: { value: 'project' } })
    })
    act(() => {
      findInputByAriaLabel(renderer!.root, '自定义变量值')?.props.onChange({ target: { value: '快手极速版' } })
    })
    act(() => {
      renderer!.root.findByProps({ 'aria-label': '添加自定义变量' }).props.onClick()
    })

    expect(useCompositeV2Store.getState().customVariables).toEqual([
      expect.objectContaining({ name: 'project', value: '快手极速版' }),
    ])
    expect(useCompositeV2Store.getState().presets[0]!.customVariableValues).toEqual({
      project: '快手极速版',
    })
    expect(renderer!.root.findAllByProps({ 'aria-label': '插入变量 {project}' })).toHaveLength(1)
  })

  it('selects the preset base canvas from the three supported sizes', () => {
    const preset = createDefaultCompositeV2Preset(1)
    const group = { ...createDefaultCompositeV2PresetGroup(1), presetIds: [preset.id] }
    useCompositeV2Store.setState({
      presets: [preset],
      presetGroups: [group],
      selectedPresetGroupId: group.id,
      selectedPreviewPresetId: preset.id,
    })

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    const sizeSelect = renderer!.root.findByProps({ 'aria-label': '基准尺寸' })
    expect(
      sizeSelect.findAllByType('option').map((option) => ({
        value: option.props.value,
        label: getNodeText(option),
      })),
    ).toEqual([
      { value: '1280x720', label: '1280×720' },
      { value: '1080x1920', label: '1080×1920' },
      { value: '800x800', label: '800×800' },
    ])

    act(() => {
      sizeSelect.props.onChange({ target: { value: '1080x1920' } })
    })

    expect(useCompositeV2Store.getState().presets[0]!.baseCanvas).toEqual({
      width: 1080,
      height: 1920,
    })
  })

  it('keeps the output root above the global distribution path', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    expect(
      renderer!.root
        .findAll((node) => node.props['aria-label'] === '输出根目录' || node.props['aria-label'] === '全局分配地址')
        .map((node) => node.props['aria-label']),
    ).toEqual(['输出根目录', '全局分配地址'])
  })

  it('auto-selects the newly created layer after adding text', () => {
    const preset = createDefaultCompositeV2Preset(1)
    const group = { ...createDefaultCompositeV2PresetGroup(1), presetIds: [preset.id] }
    useCompositeV2Store.setState({
      presets: [preset],
      presetGroups: [group],
      selectedPresetGroupId: group.id,
      selectedPreviewPresetId: preset.id,
    })

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    const addTextButton = renderer!.root
      .findAllByType('button')
      .find((node) => node.props['aria-label'] === '添加文字图层')
    act(() => {
      addTextButton?.props.onClick()
    })

    const latestPreset = useCompositeV2Store.getState().presets[0]!
    const newestLayerId = latestPreset.layers.at(-1)?.id
    const canvasEditor = renderer!.root.findByType(PresetCanvasEditor)

    expect(latestPreset.layers).toHaveLength(1)
    expect(newestLayerId).toBeTruthy()
    expect(canvasEditor.props.selectedLayerId).toBe(newestLayerId)
  })

  it('reloads the persisted LOGO library when preset management opens', async () => {
    const listImageFiles = vi
      .fn()
      .mockResolvedValue([{ path: 'D:/logos/logo.png', name: 'logo.png', dataUrl: 'data:image/png;base64,AAAA' }])
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { listImageFiles },
    })
    useCompositeV2Store.setState({
      logoLibraryPath: 'D:/logos',
      projectLogos: [{ id: 'new-logo', name: 'new.png', dataUrl: 'data:image/png;base64,AAAA' }],
    } as never)

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<PresetManagementTab />)
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(useCompositeV2Store.getState().projectLogos).toHaveLength(1)
    expect(useCompositeV2Store.getState().projectLogos[0]?.name).toBe('new.png')
  })

  it('uses aria-pressed and syncs store selection when switching groups', () => {
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'preset-a', name: 'Preset A' }
    const presetB = { ...createDefaultCompositeV2Preset(2), id: 'preset-b', name: 'Preset B' }
    const groupA = {
      ...createDefaultCompositeV2PresetGroup(1),
      id: 'group-a',
      name: 'Group A',
      presetIds: [presetA.id],
    }
    const groupB = {
      ...createDefaultCompositeV2PresetGroup(2),
      id: 'group-b',
      name: 'Group B',
      presetIds: [presetB.id],
    }

    useCompositeV2Store.setState({
      presets: [presetA, presetB],
      presetGroups: [groupA, groupB],
      selectedPresetGroupId: groupA.id,
      selectedPreviewPresetId: presetA.id,
      enabledPresetIdsForRun: [presetA.id],
    })

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    const groupAButton = findButtonByText(renderer!.root, 'Group A')
    const groupBButton = findButtonByText(renderer!.root, 'Group B')

    expect(groupAButton?.props['aria-pressed']).toBe(true)
    expect(groupBButton?.props['aria-pressed']).toBe(false)

    act(() => {
      groupBButton?.props.onClick()
    })

    expect(useCompositeV2Store.getState().selectedPresetGroupId).toBe(groupB.id)
    expect(useCompositeV2Store.getState().selectedPreviewPresetId).toBe(presetA.id)
    expect(getNodeText(renderer!.root)).toContain('Preset A')
  })

  it('adds the currently selected library preset into the selected group', () => {
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'preset-a', name: 'Alpha Preset' }
    const presetB = { ...createDefaultCompositeV2Preset(2), id: 'preset-b', name: 'Beta Preset' }
    const groupA = { ...createDefaultCompositeV2PresetGroup(1), id: 'group-a', name: 'Group A', presetIds: [] }
    const groupB = {
      ...createDefaultCompositeV2PresetGroup(2),
      id: 'group-b',
      name: 'Group B',
      presetIds: [presetB.id],
    }

    useCompositeV2Store.setState({
      presets: [presetA, presetB],
      presetGroups: [groupA, groupB],
      selectedPresetGroupId: groupA.id,
      selectedPreviewPresetId: presetB.id,
      enabledPresetIdsForRun: [],
    })

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    const addButton = renderer!.root.findByProps({ title: '添加当前选中预设到组' })

    act(() => {
      addButton.props.onClick({ stopPropagation: () => {} })
    })

    expect(useCompositeV2Store.getState().presetGroups[0]?.presetIds).toEqual([presetB.id])
    expect(useCompositeV2Store.getState().presets).toHaveLength(2)
  })

  it('creates a preset only in the global preset library', () => {
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'preset-a', name: 'Alpha Preset' }
    const group = { ...createDefaultCompositeV2PresetGroup(1), id: 'group-a', name: 'Group A', presetIds: [presetA.id] }

    useCompositeV2Store.setState({
      presets: [presetA],
      presetGroups: [group],
      selectedPresetGroupId: group.id,
      selectedPreviewPresetId: presetA.id,
      enabledPresetIdsForRun: [presetA.id],
    })

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    const createPresetButtons = renderer!.root.findAllByProps({ title: '新建预设' })
    const libraryCreateButton = createPresetButtons.at(-1)

    act(() => {
      libraryCreateButton?.props.onClick()
    })

    expect(useCompositeV2Store.getState().presets).toHaveLength(2)
    expect(useCompositeV2Store.getState().presetGroups[0]?.presetIds).toEqual([presetA.id])
  })

  it('deletes a preset from the global preset library and removes group references', () => {
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'preset-a', name: 'Alpha Preset' }
    const presetB = { ...createDefaultCompositeV2Preset(2), id: 'preset-b', name: 'Beta Preset' }
    const groupA = {
      ...createDefaultCompositeV2PresetGroup(1),
      id: 'group-a',
      name: 'Group A',
      presetIds: [presetA.id, presetB.id],
    }
    const groupB = {
      ...createDefaultCompositeV2PresetGroup(2),
      id: 'group-b',
      name: 'Group B',
      presetIds: [presetB.id],
    }

    useCompositeV2Store.setState({
      presets: [presetA, presetB],
      presetGroups: [groupA, groupB],
      selectedPresetGroupId: groupA.id,
      selectedPreviewPresetId: presetB.id,
      enabledPresetIdsForRun: [presetA.id, presetB.id],
    })
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    const deleteButton = renderer!.root.findByProps({ title: '删除预设' })

    act(() => {
      deleteButton.props.onClick()
    })
    const confirmDialog = useStore.getState().confirmDialog
    expect(confirmDialog).toMatchObject({
      title: '删除预设？',
      confirmText: '确认删除',
      tone: 'danger',
    })
    act(() => {
      confirmDialog?.action?.()
      useStore.getState().setConfirmDialog(null)
    })

    expect(useCompositeV2Store.getState().presets.map((preset) => preset.id)).toEqual([presetA.id])
    expect(useCompositeV2Store.getState().presetGroups[0]?.presetIds).toEqual([presetA.id])
    expect(useCompositeV2Store.getState().presetGroups[1]?.presetIds).toEqual([])
    expect(useCompositeV2Store.getState().enabledPresetIdsForRun).toEqual([presetA.id])
    expect(useCompositeV2Store.getState().selectedPreviewPresetId).toBe(presetA.id)
  })

  it('adds a preset into a group by dragging from the global preset library', () => {
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'preset-a', name: 'Alpha Preset' }
    const presetB = { ...createDefaultCompositeV2Preset(2), id: 'preset-b', name: 'Beta Preset' }
    const group = { ...createDefaultCompositeV2PresetGroup(1), id: 'group-a', name: 'Group A', presetIds: [presetA.id] }

    useCompositeV2Store.setState({
      presets: [presetA, presetB],
      presetGroups: [group],
      selectedPresetGroupId: group.id,
      selectedPreviewPresetId: presetA.id,
      enabledPresetIdsForRun: [presetA.id],
    })

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      types: [] as string[],
      store: new Map<string, string>(),
      setData(type: string, value: string) {
        this.store.set(type, value)
        if (!this.types.includes(type)) this.types.push(type)
      },
      getData(type: string) {
        return this.store.get(type) ?? ''
      },
    }

    const libraryPreset = renderer!.root.findAll(
      (node: ReactTestInstance) => node.props.draggable === true && getNodeText(node).includes('Beta Preset'),
    )[0]
    const groupCard = renderer!.root.findByProps({ 'data-preset-group-id': group.id })

    act(() => {
      libraryPreset?.props.onDragStart({ dataTransfer })
      groupCard.props.onDragOver({ preventDefault: () => {}, dataTransfer })
      groupCard.props.onDrop({ preventDefault: () => {}, dataTransfer })
      libraryPreset?.props.onDragEnd()
    })

    expect(useCompositeV2Store.getState().presetGroups[0]?.presetIds).toEqual([presetA.id, presetB.id])
  })

  it('keeps the current preset details when filtering hides it from the library list', () => {
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'preset-a', name: 'Alpha Preset' }
    const presetB = { ...createDefaultCompositeV2Preset(2), id: 'preset-b', name: 'Beta Preset' }
    const group = {
      ...createDefaultCompositeV2PresetGroup(1),
      id: 'group-a',
      name: 'Group A',
      presetIds: [presetA.id, presetB.id],
    }

    useCompositeV2Store.setState({
      presets: [presetA, presetB],
      presetGroups: [group],
      selectedPresetGroupId: group.id,
      selectedPreviewPresetId: presetB.id,
      enabledPresetIdsForRun: [presetA.id, presetB.id],
    })

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    const searchInput = findInputByAriaLabel(renderer!.root, '搜索预设')
    act(() => {
      searchInput?.props.onChange({ target: { value: 'Alpha' } })
    })

    expect(useCompositeV2Store.getState().selectedPreviewPresetId).toBe(presetB.id)
    expect(getNodeText(renderer!.root)).toContain('Beta Preset')
  })

  it('keeps rendering the current preset details when the library filter returns no results', () => {
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'preset-a', name: 'Alpha Preset' }
    const presetB = { ...createDefaultCompositeV2Preset(2), id: 'preset-b', name: 'Beta Preset' }
    const group = {
      ...createDefaultCompositeV2PresetGroup(1),
      id: 'group-a',
      name: 'Group A',
      presetIds: [presetA.id, presetB.id],
    }

    useCompositeV2Store.setState({
      presets: [presetA, presetB],
      presetGroups: [group],
      selectedPresetGroupId: group.id,
      selectedPreviewPresetId: presetB.id,
      enabledPresetIdsForRun: [presetA.id, presetB.id],
    })

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    const searchInput = findInputByAriaLabel(renderer!.root, '搜索预设')
    act(() => {
      searchInput?.props.onChange({ target: { value: 'No Match' } })
    })

    expect(useCompositeV2Store.getState().selectedPreviewPresetId).toBe(presetB.id)
    expect(getNodeText(renderer!.root)).toContain('Beta Preset')
  })
})
