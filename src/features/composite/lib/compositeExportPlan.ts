import {
  getEffectiveOutputRuleGroups,
  getEnabledOutputRules,
  type CompositeV2EnabledOutputRule,
} from './compositeOutputRulesV2'
import type {
  CompositeV2BackgroundImage,
  CompositeV2CustomVariable,
  CompositeV2DistributionConfig,
  CompositeV2ExportTask,
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

/**
 * 后台导出队列中的单个任务（不参与持久化）：
 * 点击「开始导出」即入队（任务「已发送」），UI 立即恢复可继续配置并发送下一个任务；
 * 队列泵按入队顺序在后台逐个执行。快照/任务流/分配配置均在发送时刻捕获（深拷贝），
 * 排队期间修改预设、背景或分配规则不影响已发送的任务。
 */
export type CompositeV2ExportQueueItem = {
  id: string
  snapshot: CompositeV2ExportSnapshot
  /** 该任务的输出任务流（发送时展开，运行时写入结果面板） */
  tasks: CompositeV2ExportTask[]
  /** queued=等待执行，running=正在后台执行（执行结束后从队列移除） */
  status: 'queued' | 'running'
  /** 点击「开始导出」的时间戳（历史记录用） */
  startedAt: number
  /** 发送时刻捕获的分配配置：任务按发送时的规则执行 */
  distributionConfig: CompositeV2DistributionConfig
  /** 发送时刻捕获的任务元信息（历史记录展示用，避免运行期间配置变化影响记录） */
  meta: {
    backgroundFolders: string[]
    recursive: boolean
    backgroundCount: number
    presetGroupName: string
    enabledPresetCount: number
    plannedCount: number
  }
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
