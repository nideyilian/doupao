import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  createCompositeV2Store,
  createCompositeV2StoreState,
  getCompositeV2PersistedState,
  migrateCompositeV2PersistedState,
  mergeCompositeV2PersistedState,
} from './storeV2'
import { createDefaultCompositeV2Preset, createDefaultCompositeV2PresetGroup } from './lib/compositeV2Defaults'
import type { CompositeV2ImageLayer, CompositeV2TextLayer } from './lib/compositeV2Types'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('composite v2 store state factory', () => {
  it('creates presets with explicit naming fields', () => {
    const preset = createDefaultCompositeV2Preset(1)

    expect(preset).toMatchObject({
      filenameTemplate: '{preset}-{source}-{index}',
      customVariableValues: {},
    })
  })

  it('migrates legacy per-preset variables without merging their values', () => {
    const presetA = createDefaultCompositeV2Preset(1)
    const presetB = { ...createDefaultCompositeV2Preset(2), id: 'preset-b', name: 'Preset B' }
    const migrated = migrateCompositeV2PersistedState(
      {
        presets: [
          {
            ...presetA,
            namingTemplate: '{project}',
            filenameTemplate: undefined,
            customVariableValues: undefined,
            customVariables: [{ id: 'project-a', name: 'project', value: '项目A' }],
          },
          {
            ...presetB,
            namingTemplate: '{project}',
            filenameTemplate: undefined,
            customVariableValues: undefined,
            customVariables: [{ id: 'project-b', name: 'project', value: '项目B' }],
          },
        ],
        customVariables: [],
      },
      1,
    )

    expect(migrated.presets.map((preset) => preset.customVariableValues)).toEqual([
      { project: '项目A' },
      { project: '项目B' },
    ])
    expect(migrated.presets[0]).toMatchObject({
      filenameTemplate: '{project}',
    })
  })

  it('copies v2 global variable values into presets without explicit values', () => {
    const preset = createDefaultCompositeV2Preset(1)
    const migrated = migrateCompositeV2PersistedState(
      {
        presets: [{ ...preset, customVariableValues: undefined }],
        customVariables: [{ id: 'project', name: 'project', value: '全局项目' }],
      },
      2,
    )

    expect(migrated.presets[0]?.customVariableValues).toEqual({ project: '全局项目' })
  })

  it('preserves an explicit empty preset value map during normalization', () => {
    const preset = createDefaultCompositeV2Preset(1)
    const migrated = migrateCompositeV2PersistedState(
      {
        presets: [preset],
        customVariables: [{ id: 'project', name: 'project', value: '全局项目' }],
      },
      3,
    )

    expect(migrated.presets[0]?.customVariableValues).toEqual({})
  })

  it('normalizes legacy naming fields while merging restored state', () => {
    const current = createCompositeV2Store().getState()
    const legacyPreset = {
      ...createDefaultCompositeV2Preset(1),
      namingTemplate: '{project}',
      filenameTemplate: undefined,
      customVariableValues: undefined,
    }
    const restored = mergeCompositeV2PersistedState(
      {
        ...getCompositeV2PersistedState(current),
        presets: [legacyPreset],
        customVariables: [{ id: 'project', name: 'project', value: '恢复项目' }],
      },
      current,
    )

    expect(restored.presets[0]).toMatchObject({
      filenameTemplate: '{project}',
      customVariableValues: { project: '恢复项目' },
    })
  })

  it('creates batch state separate from persisted preset state', () => {
    const state = createCompositeV2StoreState()

    expect((state as unknown as Record<string, unknown>).logoLibraryPath).toBe('')
    expect(state.customVariables).toEqual([])
    expect(state.backgroundFolders).toEqual([])
    expect(state.recursiveBackgrounds).toBe(false)
    expect(state.backgrounds).toEqual([])
    expect(state.previewHistory).toEqual([])
    expect(state.previewHistoryIndex).toBe(-1)
    expect(state.customValue).toBe('')
    expect(state.presets.length).toBeGreaterThan(0)
    expect(state.historyRetention).toBe(10)
    expect(state.exportStatus).toBe('idle')
  })

  it('returns only persisted domain state for storage', () => {
    const store = createCompositeV2Store()
    store.setState({
      backgroundFolders: ['D:/bg'],
      recursiveBackgrounds: true,
      backgrounds: [{ path: 'D:/bg/a.jpg', name: 'a.jpg', relativeDir: '', width: 100, height: 100 }],
      previewHistory: ['D:/bg/a.jpg'],
      previewHistoryIndex: 0,
      customValue: 'run-1',
      preserveSourceDir: true,
      exportStatus: 'running',
      exportCompleted: 2,
      exportTotal: 10,
      logoOrder: [],
      projectLogos: [],
    })
    store.setState({ logoLibraryPath: 'D:/logos' } as never)

    const persisted = getCompositeV2PersistedState(store.getState())

    expect(persisted).toEqual({
      logoLibraryPath: 'D:/logos',
      logoOrder: [],
      projectLogos: [],
      customVariables: [],
      presets: store.getState().presets,
      presetGroups: store.getState().presetGroups,
      outputRuleGroups: store.getState().outputRuleGroups,
      distributionConfig: {
        ...store.getState().distributionConfig,
        startDate: undefined,
      },
      globalFitMode: store.getState().globalFitMode,
      historyRetention: store.getState().historyRetention,
      history: store.getState().history,
      backgroundFolders: ['D:/bg'],
      recursiveBackgrounds: true,
      selectedPresetGroupId: store.getState().selectedPresetGroupId,
      selectedPreviewPresetId: store.getState().selectedPreviewPresetId,
      enabledPresetIdsForRun: store.getState().enabledPresetIdsForRun,
      smartMatchOrientation: false,
      archiveExportsToLibrary: false,
    })
    expect(persisted).not.toHaveProperty('previewHistory')
    expect(persisted).not.toHaveProperty('exportStatus')
  })

  it('hydrates distribution settings with the fresh runtime start date', () => {
    const source = createCompositeV2Store()
    source.setState({
      distributionConfig: {
        ...source.getState().distributionConfig,
        enabled: true,
        days: 7,
        startDate: '20200101',
      },
    })
    const persisted = JSON.parse(JSON.stringify(getCompositeV2PersistedState(source.getState())))
    const current = createCompositeV2Store().getState()
    current.distributionConfig.startDate = '20260702'

    const hydrated = mergeCompositeV2PersistedState(persisted, current)

    expect(hydrated.distributionConfig).toMatchObject({
      enabled: true,
      days: 7,
      startDate: '20260702',
    })
  })

  it('hydrates a coherent non-default preset group selection', () => {
    const source = createCompositeV2Store()
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'preset-a', name: 'Preset A' }
    const presetB = { ...createDefaultCompositeV2Preset(2), id: 'preset-b', name: 'Preset B' }
    const groupA = { ...createDefaultCompositeV2PresetGroup(1), id: 'group-a', presetIds: ['preset-a'] }
    const groupB = { ...createDefaultCompositeV2PresetGroup(2), id: 'group-b', presetIds: ['preset-b'] }
    source.setState({
      presets: [presetA, presetB],
      presetGroups: [groupA, groupB],
      selectedPresetGroupId: groupB.id,
      selectedPreviewPresetId: presetB.id,
      enabledPresetIdsForRun: [presetB.id],
    })
    const persisted = JSON.parse(JSON.stringify(getCompositeV2PersistedState(source.getState())))

    const hydrated = mergeCompositeV2PersistedState(persisted, createCompositeV2Store().getState())

    expect(hydrated).toMatchObject({
      selectedPresetGroupId: 'group-b',
      selectedPreviewPresetId: 'preset-b',
      enabledPresetIdsForRun: ['preset-b'],
    })
  })

  it('falls back to a coherent preset selection when persisted IDs are invalid', () => {
    const currentStore = createCompositeV2Store()
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'preset-a', name: 'Preset A' }
    const presetB = { ...createDefaultCompositeV2Preset(2), id: 'preset-b', name: 'Preset B' }
    const groupA = { ...createDefaultCompositeV2PresetGroup(1), id: 'group-a', presetIds: ['preset-a'] }
    const groupB = { ...createDefaultCompositeV2PresetGroup(2), id: 'group-b', presetIds: ['preset-b'] }
    currentStore.setState({ presets: [presetA, presetB], presetGroups: [groupA, groupB] })
    const persisted = {
      ...getCompositeV2PersistedState(currentStore.getState()),
      selectedPresetGroupId: 'missing-group',
      selectedPreviewPresetId: 'missing-preset',
      enabledPresetIdsForRun: ['missing-preset'],
    }

    const hydrated = mergeCompositeV2PersistedState(JSON.parse(JSON.stringify(persisted)), currentStore.getState())

    expect(hydrated).toMatchObject({
      selectedPresetGroupId: 'group-a',
      selectedPreviewPresetId: 'preset-a',
      enabledPresetIdsForRun: ['preset-a'],
    })
  })

  it('resets enabled presets but preserves preview preset when switching groups', () => {
    const store = createCompositeV2Store()
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'preset-a', name: 'Preset A' }
    const presetB = { ...createDefaultCompositeV2Preset(2), id: 'preset-b', name: 'Preset B' }
    const presetC = { ...createDefaultCompositeV2Preset(3), id: 'preset-c', name: 'Preset C' }
    const groupA = { ...createDefaultCompositeV2PresetGroup(1), id: 'group-a', presetIds: ['preset-a', 'preset-b'] }
    const groupB = { ...createDefaultCompositeV2PresetGroup(2), id: 'group-b', presetIds: ['preset-c', 'preset-b'] }

    store.setState({
      presets: [presetA, presetB, presetC],
      presetGroups: [groupA, groupB],
      selectedPresetGroupId: groupA.id,
      selectedPreviewPresetId: presetB.id,
      enabledPresetIdsForRun: [presetB.id],
    })

    store.getState().setSelectedPresetGroup(groupB.id)

    expect(store.getState().selectedPresetGroupId).toBe(groupB.id)
    expect(store.getState().enabledPresetIdsForRun).toEqual(groupB.presetIds)
    expect(store.getState().selectedPreviewPresetId).toBe('preset-b')
  })

  it('chooses a deterministic random preview when backgrounds refresh', () => {
    const store = createCompositeV2Store({ pickRandomIndex: () => 1 })
    const backgrounds = [
      { path: 'D:/bg/a.jpg', name: 'a.jpg', relativeDir: '', width: 100, height: 100 },
      { path: 'D:/bg/b.jpg', name: 'b.jpg', relativeDir: '', width: 100, height: 100 },
      { path: 'D:/bg/c.jpg', name: 'c.jpg', relativeDir: '', width: 100, height: 100 },
    ]

    store.getState().setBackgrounds(backgrounds)

    expect(store.getState().backgrounds).toEqual(backgrounds)
    expect(store.getState().previewHistory).toEqual(['D:/bg/b.jpg'])
    expect(store.getState().previewHistoryIndex).toBe(0)
  })

  it('updates batch controls through minimal setters', () => {
    const store = createCompositeV2Store()

    store.getState().setBackgroundFolders(['D:/bg'])
    store.getState().setRecursiveBackgrounds(true)
    store.getState().setSelectedPreviewPresetId('preset-default')
    store.getState().setEnabledPresetIdsForRun(['preset-default'])
    store.getState().setCustomValue('custom-1')
    store.getState().setPreserveSourceDir(true)
    store.getState().setExportProgress(3, 7)
    store.getState().setExportStatus('paused')

    expect(store.getState()).toMatchObject({
      backgroundFolders: ['D:/bg'],
      recursiveBackgrounds: true,
      selectedPreviewPresetId: 'preset-default',
      enabledPresetIdsForRun: ['preset-default'],
      customValue: 'custom-1',
      preserveSourceDir: true,
      exportCompleted: 3,
      exportTotal: 7,
      exportStatus: 'paused',
    })
  })

  it('stores global custom variables independently from presets', () => {
    const store = createCompositeV2Store()

    store.getState().setCustomVariables([{ id: 'custom-project', name: 'project', value: '项目A' }])

    expect(store.getState().customVariables).toEqual([{ id: 'custom-project', name: 'project', value: '项目A' }])
    expect(store.getState().presets.every((preset) => !('customVariables' in preset))).toBe(true)
  })

  it('updates a custom variable value for only one preset', () => {
    const store = createCompositeV2Store()
    const first = store.getState().presets[0]!
    store.getState().createPreset('第二预设')
    const second = store.getState().presets[1]!

    store.getState().setPresetCustomVariableValue(first.id, 'project', '项目A')
    store.getState().setPresetCustomVariableValue(second.id, 'project', '项目B')

    expect(store.getState().presets[0]!.customVariableValues.project).toBe('项目A')
    expect(store.getState().presets[1]!.customVariableValues.project).toBe('项目B')
  })

  it('adds a variable definition and initializes only the selected preset value', () => {
    const store = createCompositeV2Store()
    const first = store.getState().presets[0]!
    store.getState().createPreset('第二预设')

    store.getState().addCustomVariable('project', '项目A', first.id)

    expect(store.getState().customVariables).toEqual([expect.objectContaining({ name: 'project', value: '项目A' })])
    expect(store.getState().presets[0]!.customVariableValues).toEqual({ project: '项目A' })
    expect(store.getState().presets[1]!.customVariableValues).toEqual({})
  })

  it('removes deleted variable values from every preset', () => {
    const store = createCompositeV2Store()
    const first = store.getState().presets[0]!
    store.getState().createPreset('第二预设')
    const second = store.getState().presets[1]!
    store.getState().setCustomVariables([{ id: 'project', name: 'project', value: '默认项目' }])
    store.getState().setPresetCustomVariableValue(first.id, 'project', '项目A')
    store.getState().setPresetCustomVariableValue(second.id, 'project', '项目B')

    store.getState().removeCustomVariable('project')

    expect(store.getState().customVariables).toEqual([])
    expect(store.getState().presets.every((preset) => !('project' in preset.customVariableValues))).toBe(true)
  })

  it('collects export results and retains history', () => {
    const store = createCompositeV2Store()
    store.getState().resetExportResults()
    store.getState().addExportSuccess({
      path: 'D:/out/a.jpg',
      presetId: 'preset-default',
      presetName: 'Default',
      channel: 'Baidu',
      size: '1280x720',
      index: 1,
      warning: 'oversize',
    })
    store.getState().addExportFailure({
      backgroundPath: 'D:/bg/b.jpg',
      presetId: 'preset-default',
      presetName: 'Default',
      channel: 'Baidu',
      size: '1280x720',
      reason: 'read failed',
    })
    store.getState().addHistoryRecord({
      id: 'run-1',
      status: 'completed-with-failures',
      startedAt: 1,
      endedAt: 2,
      backgroundFolders: ['D:/bg'],
      recursive: false,
      backgroundCount: 2,
      presetGroupName: 'Default',
      enabledPresetCount: 1,
      plannedCount: 2,
      successCount: 1,
      failureCount: 1,
      successes: [],
      failures: [],
    })

    expect(store.getState().exportSuccesses).toHaveLength(1)
    expect(store.getState().exportFailures).toHaveLength(1)
    expect(store.getState().history[0]?.id).toBe('run-1')
    store.getState().setHistoryRetention(0)
    expect(store.getState().historyRetention).toBe(1)
  })

  it('truncates forward preview history when a new random background is pushed after going back', () => {
    const store = createCompositeV2Store()

    store.setState({
      previewHistory: ['D:/bg/a.jpg', 'D:/bg/b.jpg', 'D:/bg/c.jpg'],
      previewHistoryIndex: 2,
    })

    store.getState().previousPreviewBackground()
    store.getState().pushPreviewBackground('D:/bg/d.jpg')

    expect(store.getState().previewHistory).toEqual(['D:/bg/a.jpg', 'D:/bg/b.jpg', 'D:/bg/d.jpg'])
    expect(store.getState().previewHistoryIndex).toBe(2)
  })

  it('keeps previous and next preview navigation inside the visited range', () => {
    const store = createCompositeV2Store()

    store.setState({
      previewHistory: ['D:/bg/a.jpg', 'D:/bg/b.jpg'],
      previewHistoryIndex: 0,
    })

    store.getState().previousPreviewBackground()
    expect(store.getState().previewHistoryIndex).toBe(0)

    store.getState().nextPreviewBackground()
    expect(store.getState().previewHistoryIndex).toBe(1)

    store.getState().nextPreviewBackground()
    expect(store.getState().previewHistoryIndex).toBe(1)
  })

  it('updates a preset immutably and refreshes updatedAt', () => {
    const store = createCompositeV2Store()
    const preset = { ...createDefaultCompositeV2Preset(10), id: 'preset-a', name: 'Preset A' }
    const group = { ...createDefaultCompositeV2PresetGroup(10), presetIds: [preset.id] }
    vi.spyOn(Date, 'now').mockReturnValue(99)

    store.setState({ presets: [preset], presetGroups: [group] })
    const previousPreset = store.getState().presets[0]

    store.getState().updatePreset(preset.id, { name: 'Preset A Updated', sampleBackgroundPath: 'D:/sample.jpg' })

    expect(store.getState().presets[0]).toMatchObject({
      id: preset.id,
      name: 'Preset A Updated',
      sampleBackgroundPath: 'D:/sample.jpg',
      updatedAt: 99,
    })
    expect(store.getState().presets[0]).not.toBe(previousPreset)
  })

  it('adds a text layer to the target preset and stamps updatedAt', () => {
    const store = createCompositeV2Store()
    const preset = { ...createDefaultCompositeV2Preset(10), id: 'preset-a', name: 'Preset A' }
    vi.spyOn(Date, 'now').mockReturnValue(123)

    store.setState({ presets: [preset] })
    store.getState().addTextLayer(preset.id)

    const layer = store.getState().presets[0]?.layers[0] as CompositeV2TextLayer | undefined
    expect(layer).toMatchObject({
      type: 'text',
      name: 'Text Layer',
      text: 'New Text',
      color: '#000000',
      padding: 5,
      shadow: { enabled: false, color: '#000000', x: 0, y: 4, blur: 12, opacity: 0.25 },
      stroke: { enabled: false, color: '#111827', width: 0 },
    })
    expect(layer!.position.width).toBeGreaterThan(0)
    expect(layer!.position.height).toBeGreaterThan(0)
    expect(layer!.position.mode).toBe('free')
    if (layer!.position.mode !== 'free') throw new Error('Expected text layer position to use free mode')
    expect(Math.abs(layer!.position.x + layer!.position.width / 2 - preset.baseCanvas.width / 2)).toBeLessThanOrEqual(1)
    expect(Math.abs(layer!.position.y + layer!.position.height / 2 - preset.baseCanvas.height / 2)).toBeLessThanOrEqual(
      1,
    )
    expect(store.getState().presets[0]?.updatedAt).toBe(123)
  })

  it('adds an image layer with the provided asset and stamps updatedAt', () => {
    const store = createCompositeV2Store()
    const preset = { ...createDefaultCompositeV2Preset(10), id: 'preset-a', name: 'Preset A' }
    vi.spyOn(Date, 'now').mockReturnValue(456)

    store.setState({ presets: [preset] })
    store.getState().addImageLayer(preset.id, { kind: 'path', path: 'D:/logos/logo.png' })

    const layer = store.getState().presets[0]?.layers[0] as CompositeV2ImageLayer | undefined
    expect(layer).toMatchObject({
      type: 'image',
      name: 'Image Layer',
      asset: { kind: 'path', path: 'D:/logos/logo.png' },
      position: {
        mode: 'free',
        x: Math.round((preset.baseCanvas.width - 240) / 2),
        y: Math.round((preset.baseCanvas.height - 120) / 2),
        width: 240,
        height: 120,
      },
      shadow: { enabled: false, color: '#000000', x: 0, y: 4, blur: 12, opacity: 0.25 },
      stroke: { enabled: false, color: '#111827', width: 0 },
    })
    expect(store.getState().presets[0]?.updatedAt).toBe(456)
  })

  it('creates a LOGO layer without changing an ordinary image layer', () => {
    const store = createCompositeV2Store()
    const preset = { ...createDefaultCompositeV2Preset(10), id: 'preset-a', name: 'Preset A' }
    store.setState({ presets: [preset] })
    store.getState().addImageLayer(preset.id, { kind: 'path', path: 'D:/images/photo.png' })

    const logoId = store.getState().replaceOrAddLogoLayer(preset.id, { kind: 'path', path: 'D:/logos/logo-a.png' })
    const layers = store.getState().presets[0]!.layers

    expect(layers).toHaveLength(2)
    expect(layers[0]).toMatchObject({
      type: 'image',
      asset: { kind: 'path', path: 'D:/images/photo.png' },
    })
    expect(layers[1]).toMatchObject({
      id: logoId,
      type: 'logo',
      name: 'LOGO Layer',
      asset: { kind: 'path', path: 'D:/logos/logo-a.png' },
      stroke: { enabled: false, color: '#111827', width: 0 },
    })
  })

  it('replaces the selected LOGO first and otherwise the first LOGO', () => {
    const store = createCompositeV2Store()
    const preset = { ...createDefaultCompositeV2Preset(10), id: 'preset-a', name: 'Preset A' }
    store.setState({ presets: [preset] })
    const firstLogoId = store.getState().replaceOrAddLogoLayer(preset.id, { kind: 'path', path: 'D:/logos/first.png' })
    const secondLogoId = store
      .getState()
      .replaceOrAddLogoLayer(preset.id, { kind: 'path', path: 'D:/logos/second.png' }, 'missing-layer')

    expect(secondLogoId).toBe(firstLogoId)
    expect(store.getState().presets[0]!.layers[0]).toMatchObject({
      id: firstLogoId,
      asset: { kind: 'path', path: 'D:/logos/second.png' },
    })

    const firstLogo = store.getState().presets[0]!.layers[0]!
    expect(firstLogo.type).toBe('logo')
    if (firstLogo.type !== 'logo') throw new Error('Expected a LOGO layer')
    store.getState().presets[0]!.layers.push({
      ...firstLogo,
      id: 'logo-selected',
      asset: { kind: 'path', path: 'D:/logos/selected-old.png' },
    })
    const selectedId = store
      .getState()
      .replaceOrAddLogoLayer(preset.id, { kind: 'path', path: 'D:/logos/selected-new.png' }, 'logo-selected')

    expect(selectedId).toBe('logo-selected')
    expect(store.getState().presets[0]!.layers[1]).toMatchObject({
      id: 'logo-selected',
      asset: { kind: 'path', path: 'D:/logos/selected-new.png' },
    })
  })

  it('creates, renames, duplicates and removes preset groups', () => {
    const store = createCompositeV2Store()
    store.getState().createPresetGroup('Campaign')
    const created = store.getState().presetGroups.find((group) => group.name === 'Campaign')
    expect(created).toBeTruthy()
    store.getState().renamePresetGroup(created!.id, 'Campaign 2')
    store.getState().duplicatePresetGroup(created!.id)
    expect(store.getState().presetGroups.some((group) => group.name === 'Campaign 2 copy')).toBe(true)
    store.getState().deletePresetGroup(created!.id)
    expect(store.getState().presetGroups.some((group) => group.id === created!.id)).toBe(false)
  })

  it('moves a preset group to a new position', () => {
    const store = createCompositeV2Store()
    store.getState().createPresetGroup('Second')
    store.getState().createPresetGroup('Third')
    const [first, second, third] = store.getState().presetGroups

    store.getState().movePresetGroup(third!.id, 0)

    expect(store.getState().presetGroups.map((group) => group.id)).toEqual([third!.id, first!.id, second!.id])
  })

  it('updates global fit mode and an output size rule', () => {
    const store = createCompositeV2Store()
    const ruleId = store.getState().outputRuleGroups[0]!.rules[0]!.id
    store.getState().setGlobalFitMode('contain-blur')
    store.getState().updateOutputRule(ruleId, { enabled: true, maxSizeKb: 123 })
    expect(store.getState().globalFitMode).toBe('contain-blur')
    expect(store.getState().outputRuleGroups[0]!.rules[0]).toMatchObject({ enabled: true, maxSizeKb: 123 })
  })

  it('enables every size rule in one channel without changing other channels', () => {
    const store = createCompositeV2Store()
    const targetGroup = store.getState().outputRuleGroups[1]!
    const untouchedGroup = store.getState().outputRuleGroups[0]!

    store.getState().setOutputRuleGroupEnabled(targetGroup.id, true)

    expect(store.getState().outputRuleGroups[1]!.rules.every((rule) => rule.enabled)).toBe(true)
    expect(store.getState().outputRuleGroups[0]).toEqual(untouchedGroup)
  })
})
