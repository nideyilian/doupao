import {
  getEffectiveOutputRuleGroups,
  getEnabledOutputRules,
  type CompositeV2EnabledOutputRule,
} from './compositeOutputRulesV2'
import type {
  CompositeV2BackgroundImage,
  CompositeV2CustomVariable,
  CompositeV2FitMode,
  CompositeV2OutputRuleGroup,
  CompositeV2Preset,
  CompositeV2PresetGroup,
} from './compositeV2Types'

export type CompositeV2ExportSnapshotInput = {
  id: string
  date: string
  backgroundFolders: string[]
  recursive: boolean
  backgrounds: CompositeV2BackgroundImage[]
  presets: CompositeV2Preset[]
  presetGroup: CompositeV2PresetGroup
  enabledPresetIds: string[]
  outputRuleGroups: CompositeV2OutputRuleGroup[]
  smartMatchOrientation: boolean
  custom: string
  customVariables: CompositeV2CustomVariable[]
  fitMode: CompositeV2FitMode
  preserveSourceDir: boolean
  /** 导出成图是否归档进素材库（IndexedDB + cache-images）；false 时只写入输出文件夹 */
  archiveExportsToLibrary: boolean
}

export type CompositeV2ExportSnapshot = CompositeV2ExportSnapshotInput & {
  createdAt: number
}

export type CompositeV2ExportItem = {
  snapshotId: string
  background: CompositeV2BackgroundImage
  preset: CompositeV2Preset
  outputRule: CompositeV2EnabledOutputRule
  index: number
  date: string
  custom: string
}

export function createCompositeExportSnapshot(
  input: CompositeV2ExportSnapshotInput,
  now = Date.now(),
): CompositeV2ExportSnapshot {
  return structuredClone({ ...input, createdAt: now })
}

export function expandCompositeExportItems(snapshot: CompositeV2ExportSnapshot): CompositeV2ExportItem[] {
  const presetsById = new Map(snapshot.presets.map((preset) => [preset.id, preset]))
  const enabledPresetSet = new Set(snapshot.enabledPresetIds)
  const orderedPresets = snapshot.presetGroup.presetIds
    .filter((presetId) => enabledPresetSet.has(presetId))
    .map((presetId) => presetsById.get(presetId))
    .filter((preset): preset is CompositeV2Preset => Boolean(preset))

  const getOrientation = (w: number, h: number) =>
    Number(w) > Number(h) ? 'landscape' : Number(h) > Number(w) ? 'portrait' : 'square'

  return orderedPresets.flatMap((preset) => {
    const rules = getEnabledOutputRules(getEffectiveOutputRuleGroups(preset, snapshot.outputRuleGroups))
    return rules.flatMap((rule) => {
      const ruleOrientation = getOrientation(rule.width, rule.height)

      return snapshot.backgrounds
        .filter((background) => {
          if (!snapshot.smartMatchOrientation) return true
          // 智能比例匹配：横版配横版，竖版配竖版，方形配方形。
          // 尺寸未知（width/height 为 0，例如素材库送入但未读到尺寸）的素材不参与比例过滤，
          // 避免被误判为"方形"后只能匹配方形规则，导致计划意外为空。
          if (background.width <= 0 || background.height <= 0) return true
          const bgOrientation = getOrientation(background.width, background.height)
          return bgOrientation === ruleOrientation
        })
        .map((background, backgroundIndex) => {
          return {
            snapshotId: snapshot.id,
            background,
            preset,
            outputRule: rule,
            index: backgroundIndex + 1,
            date: snapshot.date,
            custom: snapshot.custom,
          }
        })
    })
  })
}
