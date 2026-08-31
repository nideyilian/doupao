/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import {
  createDefaultCompositeV2OutputRuleGroups,
  createDefaultCompositeV2Preset,
  createDefaultCompositeV2PresetGroup,
} from '../lib/compositeV2Defaults'
import { createCompositeV2StoreState, useCompositeV2Store } from '../storeV2'
import { BatchExportTab } from './BatchExportTab'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mountedRenderers: Array<ReturnType<typeof create>> = []

afterEach(() => {
  vi.useRealTimers()
  while (mountedRenderers.length) {
    mountedRenderers.pop()?.unmount()
  }
  useCompositeV2Store.setState(createCompositeV2StoreState())
  vi.restoreAllMocks()
  if (typeof window !== 'undefined') {
    delete (window as Window & { electronAPI?: typeof window.electronAPI }).electronAPI
  }
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

function findButtonByLabel(root: ReactTestInstance, label: string) {
  return root
    .findAll((node: ReactTestInstance) => node.type === 'button')
    .find((node: ReactTestInstance) => node.props['aria-label'] === label)
}

function findInputByLabel(root: ReactTestInstance, label: string) {
  return root.findAllByType('input').find((node: ReactTestInstance) => node.props['aria-label'] === label)
}

function findFolderAddressInputs(root: ReactTestInstance) {
  return root
    .findAllByType('input')
    .filter(
      (node: ReactTestInstance) =>
        typeof node.props['aria-label'] === 'string' && node.props['aria-label'].startsWith('文件夹地址 '),
    )
}

describe('BatchExportTab', () => {
  it('toggles every size in a channel from its select-all checkbox', async () => {
    const outputRuleGroups = createDefaultCompositeV2OutputRuleGroups()
    const targetGroup = outputRuleGroups[1]!
    useCompositeV2Store.setState({ outputRuleGroups })
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { isElectron: true, readImageFile: vi.fn().mockResolvedValue(null) },
    })

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<BatchExportTab />)
    })
    mountedRenderers.push(renderer!)

    const selectAll = findInputByLabel(renderer!.root, `全选 ${targetGroup.name} 尺寸`)
    expect(selectAll).toBeDefined()

    act(() => {
      selectAll?.props.onChange({ target: { checked: true } })
    })

    expect(useCompositeV2Store.getState().outputRuleGroups[1]!.rules.every((rule) => rule.enabled)).toBe(true)
  })

  it('renders one empty folder address by default and Add only appends another row', async () => {
    const scanEnteredCompositeBackgroundFolder = vi.fn()
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        isElectron: true,
        scanEnteredCompositeBackgroundFolder,
        readImageFile: vi.fn().mockResolvedValue(null),
      },
    })

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<BatchExportTab />)
    })
    mountedRenderers.push(renderer!)

    expect(findFolderAddressInputs(renderer!.root)).toHaveLength(1)
    expect(findFolderAddressInputs(renderer!.root)[0]?.props.value).toBe('')

    await act(async () => {
      findButtonByText(renderer!.root, '添加文件夹地址')?.props.onClick()
    })

    expect(findFolderAddressInputs(renderer!.root)).toHaveLength(2)
    expect(scanEnteredCompositeBackgroundFolder).not.toHaveBeenCalled()
  })

  it('automatically scans and persists a completed folder address', async () => {
    vi.useFakeTimers()
    const scanEnteredCompositeBackgroundFolder = vi.fn().mockResolvedValue({
      success: true,
      folderPath: 'D:/images',
      files: [{ path: 'D:/images/a.jpg', name: 'a.jpg', relativeDir: '', width: 10, height: 20 }],
    })
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        isElectron: true,
        scanEnteredCompositeBackgroundFolder,
        readImageFile: vi.fn().mockResolvedValue(null),
      },
    })

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<BatchExportTab />)
    })
    mountedRenderers.push(renderer!)

    await act(async () => {
      findFolderAddressInputs(renderer!.root)[0]?.props.onChange({ target: { value: 'D:/images' } })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(scanEnteredCompositeBackgroundFolder).toHaveBeenCalledWith('D:/images', false)
    expect(useCompositeV2Store.getState().backgroundFolders).toEqual(['D:/images'])
    expect(useCompositeV2Store.getState().backgrounds[0]?.name).toBe('a.jpg')
  })

  it('fills the targeted address row from Browse and removes rows independently', async () => {
    const selectDirectory = vi.fn().mockResolvedValue('D:/picked')
    const scanEnteredCompositeBackgroundFolder = vi.fn().mockResolvedValue({
      success: true,
      folderPath: 'D:/picked',
      files: [],
    })
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        isElectron: true,
        selectDirectory,
        scanEnteredCompositeBackgroundFolder,
        readImageFile: vi.fn().mockResolvedValue(null),
      },
    })

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<BatchExportTab />)
    })
    mountedRenderers.push(renderer!)

    await act(async () => {
      findButtonByText(renderer!.root, '添加文件夹地址')?.props.onClick()
    })
    await act(async () => {
      findButtonByLabel(renderer!.root, '浏览文件夹地址 2')?.props.onClick()
      await Promise.resolve()
    })

    expect(findFolderAddressInputs(renderer!.root).map((input) => input.props.value)).toEqual(['', 'D:/picked'])

    await act(async () => {
      findButtonByLabel(renderer!.root, '删除文件夹地址 1')?.props.onClick()
      await Promise.resolve()
    })

    expect(findFolderAddressInputs(renderer!.root).map((input) => input.props.value)).toEqual(['D:/picked'])
  })

  it('ignores an older folder scan that resolves after a newer scan', async () => {
    let resolveFirstScan: ((value: unknown) => void) | null = null
    let resolveSecondScan: ((value: unknown) => void) | null = null
    const scanEnteredCompositeBackgroundFolder = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstScan = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecondScan = resolve
          }),
      )
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        isElectron: true,
        scanEnteredCompositeBackgroundFolder,
        readImageFile: vi.fn().mockResolvedValue(null),
      },
    })

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<BatchExportTab />)
    })
    mountedRenderers.push(renderer!)

    await act(async () => {
      findFolderAddressInputs(renderer!.root)[0]?.props.onChange({ target: { value: 'D:/old' } })
    })
    await act(async () => {
      findFolderAddressInputs(renderer!.root)[0]?.props.onKeyDown({ key: 'Enter', preventDefault: vi.fn() })
      await Promise.resolve()
    })
    await act(async () => {
      findFolderAddressInputs(renderer!.root)[0]?.props.onChange({ target: { value: 'D:/new' } })
    })
    await act(async () => {
      findFolderAddressInputs(renderer!.root)[0]?.props.onKeyDown({ key: 'Enter', preventDefault: vi.fn() })
      await Promise.resolve()
    })

    await act(async () => {
      resolveSecondScan?.({
        success: true,
        folderPath: 'D:/new',
        files: [{ path: 'D:/new/new.jpg', name: 'new.jpg', relativeDir: '', width: 1, height: 1 }],
      })
      await Promise.resolve()
    })
    await act(async () => {
      resolveFirstScan?.({
        success: true,
        folderPath: 'D:/old',
        files: [{ path: 'D:/old/old.jpg', name: 'old.jpg', relativeDir: '', width: 1, height: 1 }],
      })
      await Promise.resolve()
    })

    expect(useCompositeV2Store.getState().backgroundFolders).toEqual(['D:/new'])
    expect(useCompositeV2Store.getState().backgrounds[0]?.name).toBe('new.jpg')
  })

  it('leaves loading state when the address is cleared during a scan', async () => {
    const scanEnteredCompositeBackgroundFolder = vi.fn().mockImplementation(() => new Promise(() => {}))
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        isElectron: true,
        selectDirectory: vi.fn(),
        scanEnteredCompositeBackgroundFolder,
        readImageFile: vi.fn().mockResolvedValue(null),
      },
    })

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<BatchExportTab />)
    })
    mountedRenderers.push(renderer!)

    await act(async () => {
      findFolderAddressInputs(renderer!.root)[0]?.props.onChange({ target: { value: 'D:/pending' } })
    })
    await act(async () => {
      findFolderAddressInputs(renderer!.root)[0]?.props.onKeyDown({ key: 'Enter', preventDefault: vi.fn() })
      await Promise.resolve()
    })
    expect(findButtonByLabel(renderer!.root, '浏览文件夹地址 1')?.props.disabled).toBe(true)

    await act(async () => {
      findFolderAddressInputs(renderer!.root)[0]?.props.onChange({ target: { value: '' } })
    })
    await act(async () => {
      findFolderAddressInputs(renderer!.root)[0]?.props.onKeyDown({ key: 'Enter', preventDefault: vi.fn() })
      await Promise.resolve()
    })

    expect(findButtonByLabel(renderer!.root, '浏览文件夹地址 1')?.props.disabled).toBe(false)
  })

  it('browses into an address row, sorts loaded backgrounds, and rescans after recursive mode changes', async () => {
    const selectDirectory = vi.fn().mockResolvedValue('D:/backgrounds')
    let resolveFirstScan: ((value: unknown) => void) | null = null
    let resolveSecondScan: ((value: unknown) => void) | null = null
    const scanEnteredCompositeBackgroundFolder = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstScan = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecondScan = resolve
          }),
      )

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        isElectron: true,
        selectDirectory,
        scanEnteredCompositeBackgroundFolder,
        readImageFile: vi.fn().mockResolvedValue(null),
      },
    })

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<BatchExportTab />)
    })
    mountedRenderers.push(renderer!)

    await act(async () => {
      const btn = findButtonByLabel(renderer!.root, '浏览文件夹地址 1')
      void btn?.props.onClick()
      await Promise.resolve()
    })

    expect(selectDirectory).toHaveBeenCalledTimes(1)
    expect(scanEnteredCompositeBackgroundFolder).toHaveBeenNthCalledWith(1, 'D:/backgrounds', false)
    expect(findFolderAddressInputs(renderer!.root)[0]?.props.value).toBe('D:/backgrounds')
    expect(useCompositeV2Store.getState().backgroundFolders).toEqual([])
    expect(useCompositeV2Store.getState().backgrounds).toEqual([])

    await act(async () => {
      resolveFirstScan?.({
        success: true,
        folderPath: 'D:/backgrounds',
        files: [
          { path: 'D:/backgrounds/10.jpg', name: '10.jpg', relativeDir: '', width: 1, height: 1 },
          { path: 'D:/backgrounds/2.jpg', name: '2.jpg', relativeDir: '', width: 1, height: 1 },
          { path: 'D:/backgrounds/nested/1.jpg', name: '1.jpg', relativeDir: 'nested', width: 1, height: 1 },
        ],
      })
      await Promise.resolve()
    })

    expect(useCompositeV2Store.getState().backgroundFolders).toEqual(['D:/backgrounds'])
    expect(useCompositeV2Store.getState().backgrounds.map((item) => item.path)).toEqual([
      'D:/backgrounds/2.jpg',
      'D:/backgrounds/10.jpg',
      'D:/backgrounds/nested/1.jpg',
    ])

    const recursiveToggle = findInputByLabel(renderer!.root, '包含子文件夹背景')
    await act(async () => {
      void recursiveToggle?.props.onChange({ target: { checked: true } })
      await Promise.resolve()
    })

    expect(scanEnteredCompositeBackgroundFolder).toHaveBeenNthCalledWith(2, 'D:/backgrounds', true)
    expect(useCompositeV2Store.getState().recursiveBackgrounds).toBe(true)

    await act(async () => {
      resolveSecondScan?.({
        success: true,
        folderPath: 'D:/backgrounds',
        files: [{ path: 'D:/backgrounds/nested/b.jpg', name: 'b.jpg', relativeDir: 'nested', width: 1, height: 1 }],
      })
      await Promise.resolve()
    })

    expect(useCompositeV2Store.getState().backgrounds[0]?.path).toBe('D:/backgrounds/nested/b.jpg')
  })

  it('keeps the entered address visible, clears backgrounds, and shows feedback when scanning fails', async () => {
    const selectDirectory = vi.fn().mockResolvedValue('D:/backgrounds')
    const scanEnteredCompositeBackgroundFolder = vi.fn().mockResolvedValue({ success: false, error: 'scan failed' })

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        isElectron: true,
        selectDirectory,
        scanEnteredCompositeBackgroundFolder,
        readImageFile: vi.fn().mockResolvedValue(null),
      },
    })

    useCompositeV2Store.setState({
      backgroundFolders: [],
      backgrounds: [],
    })

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<BatchExportTab />)
    })
    mountedRenderers.push(renderer!)

    await act(async () => {
      const btn = findButtonByLabel(renderer!.root, '浏览文件夹地址 1')
      void btn?.props.onClick()
      await Promise.resolve()
    })

    expect(findFolderAddressInputs(renderer!.root)[0]?.props.value).toBe('D:/backgrounds')
    expect(useCompositeV2Store.getState().backgroundFolders).toEqual([])
    expect(useCompositeV2Store.getState().backgrounds).toEqual([])
    expect(getNodeText(renderer!.root)).toContain('scan failed')
  })

  it('renders separate preset preview and inclusion controls without nested interactive elements', async () => {
    const presetA = {
      ...createDefaultCompositeV2Preset(1),
      id: 'preset-a',
      name: 'Preset A',
      outputRootPath: 'D:/exports/a',
    }
    const group = { ...createDefaultCompositeV2PresetGroup(1), id: 'group-a', name: 'Group A', presetIds: [presetA.id] }

    useCompositeV2Store.setState({
      presets: [presetA],
      presetGroups: [group],
      selectedPresetGroupId: group.id,
      selectedPreviewPresetId: presetA.id,
      enabledPresetIdsForRun: [presetA.id],
    })

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        isElectron: true,
        readImageFile: vi.fn().mockResolvedValue(null),
      },
    })

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<BatchExportTab />)
    })
    mountedRenderers.push(renderer!)

    await act(async () => {
      const toggleButton = renderer!.root.findAllByType('button').find((node) => {
        const text = getNodeText(node.parent?.parent as ReactTestInstance)
        return text.includes('Group A') && node.props.className?.includes('p-0.5')
      })
      toggleButton?.props.onClick({ stopPropagation: () => {} })
      await Promise.resolve()
    })

    const previewButton = renderer!.root
      .findAllByType('button')
      .find((node: ReactTestInstance) => node.props['aria-label'] === `预览预设 ${presetA.name}`)
    const includeCheckbox = renderer!.root
      .findAllByType('input')
      .find(
        (node: ReactTestInstance) =>
          node.props.type === 'checkbox' && node.props['aria-label'] === `包含预设 ${presetA.name}`,
      )

    expect(previewButton).toBeDefined()
    expect(includeCheckbox).toBeDefined()
    expect(previewButton?.findAllByType('input')).toEqual([])
  })

  it('pushes random preview history and moves shell export status into running preparation', async () => {
    const presetA = {
      ...createDefaultCompositeV2Preset(1),
      id: 'preset-a',
      name: 'Preset A',
      outputRootPath: 'D:/exports/a',
    }
    const presetB = { ...createDefaultCompositeV2Preset(2), id: 'preset-b', name: 'Preset B', outputRootPath: '' }
    const group = {
      ...createDefaultCompositeV2PresetGroup(1),
      id: 'group-a',
      name: 'Group A',
      presetIds: [presetA.id, presetB.id],
    }
    const outputRuleGroups = createDefaultCompositeV2OutputRuleGroups()
    outputRuleGroups[0]!.rules[0]!.enabled = true

    useCompositeV2Store.setState({
      presets: [presetA, presetB],
      presetGroups: [group],
      outputRuleGroups,
      selectedPresetGroupId: group.id,
      selectedPreviewPresetId: presetA.id,
      enabledPresetIdsForRun: ['preset-a', 'preset-b'],
      backgroundFolders: ['D:/backgrounds'],
      backgrounds: [
        { path: 'D:/backgrounds/a.jpg', name: 'a.jpg', relativeDir: '', width: 1280, height: 720 },
        { path: 'D:/backgrounds/b.jpg', name: 'b.jpg', relativeDir: '', width: 1280, height: 720 },
      ],
      previewHistory: ['D:/backgrounds/a.jpg'],
      previewHistoryIndex: 0,
    })

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        isElectron: true,
        readImageFile: vi.fn().mockResolvedValue(null),
      },
    })
    vi.spyOn(Math, 'random').mockReturnValue(0.99)

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<BatchExportTab />)
    })
    mountedRenderers.push(renderer!)

    await act(async () => {
      const toggleButton = renderer!.root.findAllByType('button').find((node) => {
        const text = getNodeText(node.parent?.parent as ReactTestInstance)
        return text.includes('Group A') && node.props.className?.includes('p-0.5')
      })
      toggleButton?.props.onClick({ stopPropagation: () => {} })
      await Promise.resolve()
    })

    const startButton = findButtonByText(renderer!.root, '开始导出')
    expect(startButton?.props.disabled).toBe(true)

    await act(async () => {
      await findButtonByLabel(renderer!.root, '随机预览')?.props.onClick()
    })

    expect(useCompositeV2Store.getState().previewHistory).toEqual(['D:/backgrounds/a.jpg', 'D:/backgrounds/b.jpg'])
    expect(useCompositeV2Store.getState().previewHistoryIndex).toBe(1)

    const presetBCheckbox = renderer!.root
      .findAllByType('input')
      .find(
        (node: ReactTestInstance) =>
          node.props.type === 'checkbox' && node.props['aria-label'] === `包含预设 ${presetB.name}`,
      )
    act(() => {
      presetBCheckbox?.props.onChange({ target: { checked: false } })
    })

    expect(useCompositeV2Store.getState().enabledPresetIdsForRun).toEqual(['preset-a'])

    expect(findButtonByText(renderer!.root, '开始导出')?.props.disabled).toBe(false)

    await act(async () => {
      await findButtonByText(renderer!.root, '开始导出')?.props.onClick()
      // 点击后任务入队，由后台队列泵执行：在同一 act 内冲刷宏任务，等导出落定
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(useCompositeV2Store.getState().exportStatus).toBe('completed')
    expect(useCompositeV2Store.getState().exportCompleted).toBe(2)
    expect(useCompositeV2Store.getState().exportTotal).toBe(2)
    expect(useCompositeV2Store.getState().exportFailures).toHaveLength(2)
    expect(getNodeText(renderer!.root)).toContain('导出完成')
  })

  it('warns when the filename template minus index still splits every background into its own folder', async () => {
    const preset = { ...createDefaultCompositeV2Preset(1), outputRootPath: 'D:/exports' }
    const group = createDefaultCompositeV2PresetGroup(1)
    const outputRuleGroups = createDefaultCompositeV2OutputRuleGroups()
    // 启用一个尺寸规则，让导出计划非空
    outputRuleGroups[0]!.rules[0]!.enabled = true
    useCompositeV2Store.setState({
      presets: [preset],
      presetGroups: [group],
      outputRuleGroups,
      selectedPresetGroupId: group.id,
      selectedPreviewPresetId: preset.id,
      enabledPresetIdsForRun: [preset.id],
      backgroundFolders: ['D:/backgrounds'],
      backgrounds: [
        { path: 'D:/backgrounds/a.jpg', name: 'a.jpg', relativeDir: '', width: 1280, height: 720 },
        { path: 'D:/backgrounds/b.jpg', name: 'b.jpg', relativeDir: '', width: 1280, height: 720 },
      ],
      previewHistory: ['D:/backgrounds/a.jpg'],
      previewHistoryIndex: 0,
    })

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        isElectron: true,
        readImageFile: vi.fn().mockResolvedValue(null),
      },
    })

    // 文件名模板去掉序号后仍含 {source}（每张背景都不同）→ 拆成每图一个独立文件夹
    useCompositeV2Store.getState().updatePreset(preset.id, {
      filenameTemplate: '{date}-{channel}-{size}-{preset}-{source}-{index}',
    })

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<BatchExportTab />)
    })
    mountedRenderers.push(renderer!)

    const text = getNodeText(renderer!.root)
    expect(text).toContain('会被拆成 2 个独立文件夹')
    // 警告不阻止导出
    expect(findButtonByText(renderer!.root, '开始导出')?.props.disabled).toBe(false)
  })
})
