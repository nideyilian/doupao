import { describe, expect, it } from 'vitest'
import { createDefaultCompositeV2Preset, createDefaultCompositeV2PresetGroup } from './compositeV2Defaults'
import {
  addPresetToGroup,
  duplicatePresetIntoGroup,
  filterPresetsForLibrary,
  movePresetInGroup,
} from './compositePresetLibrary'

import type { CompositeV2Preset } from './compositeV2Types'

describe('composite preset library', () => {
  it('adds a global preset reference to a group once', () => {
    const group = createDefaultCompositeV2PresetGroup(1)
    expect(addPresetToGroup(group, 'preset-default').presetIds).toEqual(['preset-default'])
    expect(addPresetToGroup(group, 'preset-2').presetIds).toEqual(['preset-default', 'preset-2'])
  })

  it('duplicates a global preset and adds the copy to the current group', () => {
    const preset = createDefaultCompositeV2Preset(1)
    const group = createDefaultCompositeV2PresetGroup(1)

    const result = duplicatePresetIntoGroup([preset], group, preset.id, 'preset-copy', 2)

    expect(result.presets).toHaveLength(2)
    expect(result.presets[1]).toMatchObject({ id: 'preset-copy', name: `${preset.name} \u526f\u672c`, updatedAt: 2 })
    expect(result.presets[1]).not.toBe(preset)
    expect(result.group.presetIds).toEqual(['preset-default', 'preset-copy'])
  })

  it('does not duplicate when the new preset id already exists', () => {
    const preset = createDefaultCompositeV2Preset(1)
    const existingPreset = { ...createDefaultCompositeV2Preset(2), id: 'preset-copy' }
    const presets = [preset, existingPreset]
    const group = { ...createDefaultCompositeV2PresetGroup(1), presetIds: ['preset-default', 'preset-copy'] }

    const globalDuplicate = duplicatePresetIntoGroup(
      presets,
      createDefaultCompositeV2PresetGroup(1),
      preset.id,
      'preset-copy',
      3,
    )
    const groupDuplicate = duplicatePresetIntoGroup([preset], group, preset.id, 'preset-copy', 3)

    expect(globalDuplicate.presets).toBe(presets)
    expect(globalDuplicate.group.presetIds).toEqual(['preset-default'])
    expect(groupDuplicate.presets).toEqual([preset])
    expect(groupDuplicate.group).toBe(group)
    expect(groupDuplicate.group.presetIds).toEqual(['preset-default', 'preset-copy'])
  })

  it('duplicates nested preset data without sharing source references', () => {
    const preset: CompositeV2Preset = {
      ...createDefaultCompositeV2Preset(1),
      id: 'preset-original',
      outputRuleGroupsOverride: [
        {
          id: 'group-1',
          name: 'group',
          distributionPaths: [],
          rules: [
            {
              id: 'rule-1',
              name: 'source rule',
              enabled: true,
              width: 100,
              height: 100,
              maxSizeKb: 99,
              format: 'jpg' as const,
              filenameTemplate: '{source}',
            },
          ],
        },
      ],
    }
    const group = createDefaultCompositeV2PresetGroup(1)

    const result = duplicatePresetIntoGroup([preset], group, preset.id, 'preset-copy', 2)

    result.presets[1].outputRuleGroupsOverride[0].rules[0].name = 'copy rule'

    expect(preset.outputRuleGroupsOverride[0].rules[0].name).toBe('source rule')
    expect(result.presets[1].outputRuleGroupsOverride).not.toBe(preset.outputRuleGroupsOverride)
    expect(result.presets[1].outputRuleGroupsOverride[0].rules).not.toBe(preset.outputRuleGroupsOverride[0].rules)
  })

  it('reorders group preset ids', () => {
    const group = { ...createDefaultCompositeV2PresetGroup(1), presetIds: ['a', 'b', 'c'] }
    expect(movePresetInGroup(group, 'c', 0).presetIds).toEqual(['c', 'a', 'b'])
  })

  it('clamps moved preset indexes to group bounds', () => {
    const group = { ...createDefaultCompositeV2PresetGroup(1), presetIds: ['a', 'b', 'c'] }

    expect(movePresetInGroup(group, 'c', -1).presetIds).toEqual(['c', 'a', 'b'])
    expect(movePresetInGroup(group, 'a', 99).presetIds).toEqual(['b', 'c', 'a'])
  })

  it('filters presets by name and group membership', () => {
    const presets = [
      { ...createDefaultCompositeV2Preset(1), id: 'a', name: '\u767e\u5ea6\u4ea7\u54c1' },
      { ...createDefaultCompositeV2Preset(2), id: 'b', name: '\u5382\u5546\u4ea7\u54c1' },
    ]
    const groups = [{ ...createDefaultCompositeV2PresetGroup(1), id: 'g1', presetIds: ['b'] }]

    expect(
      filterPresetsForLibrary(presets, groups, { query: '\u4ea7\u54c1', groupId: 'g1' }).map((preset) => preset.id),
    ).toEqual(['b'])
  })

  it('does not mutate caller preset order when filtering', () => {
    const presets = [
      { ...createDefaultCompositeV2Preset(1), id: 'a', name: 'a' },
      { ...createDefaultCompositeV2Preset(3), id: 'b', name: 'b' },
      { ...createDefaultCompositeV2Preset(2), id: 'c', name: 'c' },
    ]

    expect(filterPresetsForLibrary(presets, [], {}).map((preset) => preset.id)).toEqual(['b', 'c', 'a'])
    expect(presets.map((preset) => preset.id)).toEqual(['a', 'b', 'c'])
  })
})
