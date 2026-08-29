import { describe, expect, it } from 'vitest'
import {
  createDefaultCompositeV2OutputRuleGroups,
  createDefaultCompositeV2Preset,
  createDefaultCompositeV2PresetGroup,
} from './compositeV2Defaults'
import { createCompositeExportSnapshot, expandCompositeExportItems } from './compositeExportPlan'
import type { CompositeV2BackgroundImage, CompositeV2OutputRuleGroup } from './compositeV2Types'

const backgrounds: CompositeV2BackgroundImage[] = [
  { path: 'D:/bg/a.jpg', name: 'a.jpg', relativeDir: '', width: 100, height: 100 },
  { path: 'D:/bg/b.jpg', name: 'b.jpg', relativeDir: '', width: 100, height: 100 },
]

describe('composite export plan', () => {
  it('expands items per preset and per enabled channel-size rule', () => {
    const outputRuleGroups: CompositeV2OutputRuleGroup[] = [
      {
        id: 'g1',
        name: 'Group 1',
        distributionPaths: [],
        rules: [
          {
            id: 'r1',
            name: '100x100',
            enabled: true,
            width: 100,
            height: 100,
            format: 'jpg',
            filenameTemplate: '',
            maxSizeKb: 0,
          },
        ],
      },
    ]
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'a', name: 'A' }
    const presetB = { ...createDefaultCompositeV2Preset(1), id: 'b', name: 'B' }
    const group = { ...createDefaultCompositeV2PresetGroup(1), presetIds: ['a', 'b'] }

    const snapshot = createCompositeExportSnapshot({
      id: 'job-1',
      date: '20260627',
      backgroundFolders: ['D:/bg'],
      recursive: false,
      backgrounds,
      presets: [presetA, presetB],
      presetGroup: group,
      enabledPresetIds: ['a', 'b'],
      outputRuleGroups,
      smartMatchOrientation: true,
      custom: 'x',
      customVariables: [],
      fitMode: 'crop-fill',
      preserveSourceDir: false,
      archiveExportsToLibrary: false,
    })
    const items = expandCompositeExportItems(snapshot)

    expect(items).toHaveLength(4)
    expect(
      items.filter((item) => item.preset.id === 'a' && item.outputRule.name === '100x100').map((item) => item.index),
    ).toEqual([1, 2])
    expect(
      items.filter((item) => item.preset.id === 'b' && item.outputRule.name === '100x100').map((item) => item.index),
    ).toEqual([1, 2])
  })

  it('freezes presets inside the snapshot', () => {
    const outputRuleGroups = createDefaultCompositeV2OutputRuleGroups()
    outputRuleGroups[0]!.rules[0]!.enabled = true
    const preset = { ...createDefaultCompositeV2Preset(1), id: 'a', name: 'Before' }
    const group = { ...createDefaultCompositeV2PresetGroup(1), presetIds: ['a'] }

    const snapshot = createCompositeExportSnapshot({
      id: 'job-1',
      date: '20260627',
      backgroundFolders: ['D:/bg'],
      recursive: false,
      backgrounds,
      presets: [preset],
      presetGroup: group,
      enabledPresetIds: ['a'],
      outputRuleGroups,
      smartMatchOrientation: false,
      custom: '',
      customVariables: [],
      fitMode: 'crop-fill',
      preserveSourceDir: false,
      archiveExportsToLibrary: false,
    })
    preset.name = 'After'

    expect(snapshot.presets[0]?.name).toBe('Before')
  })

  it('treats unknown-dimension backgrounds as matching every rule orientation', () => {
    const outputRuleGroups: CompositeV2OutputRuleGroup[] = [
      {
        id: 'g1',
        name: 'Group 1',
        distributionPaths: [],
        rules: [
          {
            id: 'r-portrait',
            name: '竖版 9:16',
            enabled: true,
            width: 900,
            height: 1600,
            format: 'jpg',
            filenameTemplate: '',
            maxSizeKb: 0,
          },
        ],
      },
    ]
    const preset = { ...createDefaultCompositeV2Preset(1), id: 'a', name: 'A' }
    const group = { ...createDefaultCompositeV2PresetGroup(1), presetIds: ['a'] }
    // 横版背景 + 未知尺寸背景（width/height 为 0，例如素材库送入但未读到尺寸）
    const mixedBackgrounds: CompositeV2BackgroundImage[] = [
      { path: 'D:/bg/landscape.jpg', name: 'landscape.jpg', relativeDir: '', width: 1600, height: 900 },
      { path: 'D:/bg/unknown.jpg', name: 'unknown.jpg', relativeDir: '', width: 0, height: 0 },
    ]

    const snapshot = createCompositeExportSnapshot({
      id: 'job-2',
      date: '20260627',
      backgroundFolders: ['D:/bg'],
      recursive: false,
      backgrounds: mixedBackgrounds,
      presets: [preset],
      presetGroup: group,
      enabledPresetIds: ['a'],
      outputRuleGroups,
      smartMatchOrientation: true,
      custom: '',
      customVariables: [],
      fitMode: 'crop-fill',
      preserveSourceDir: false,
      archiveExportsToLibrary: false,
    })
    const items = expandCompositeExportItems(snapshot)

    // 横版背景被竖版规则过滤掉，未知尺寸背景必须保留
    expect(items).toHaveLength(1)
    expect(items[0]?.background.name).toBe('unknown.jpg')
  })
})
