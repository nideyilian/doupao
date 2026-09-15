import type { SopSeriesConfig } from './types'

/**
 * 系列图一致性维度库。
 *
 * 只保留**真正会改变画面**的维度：画风、构图、色彩、光线、视角决定「像不像同一系列」，
 * 主体、背景是系列里通常要换的内容。像「文案结构」「情绪氛围」这类要靠其他维度推导、
 * 对画面影响间接的维度不放进来 —— 设置项多一个，用户就多一分困惑，画面却没差别。
 *
 * 维度名同时是 fixedValues 的键，改名会让用户已填的值失配，不要随意改动。
 */
export const SOP_SERIES_DIMENSIONS = ['画风', '构图', '色彩', '光线', '视角', '主体', '背景']

/** 默认组内固定：画风、构图、色彩、光线、视角才是「同一系列」的骨架。 */
export const SOP_SERIES_DEFAULT_FIXED_DIMENSIONS = ['画风', '构图', '色彩', '光线', '视角']

/** 默认每张变化。 */
export const SOP_SERIES_DEFAULT_VARIABLE_DIMENSIONS = ['主体', '背景']

/** 组内变化维度 = 维度库减去组内固定维度。 */
export function getSopSeriesVariableDimensions(fixedDimensions: string[]) {
  return SOP_SERIES_DIMENSIONS.filter((dimension) => !fixedDimensions.includes(dimension))
}

/**
 * 由「组内固定维度 + 用户填的值」拼出本次生图用的系列配置。
 * 变化维度是维度库的补集，不需要单独存。
 */
export function buildSopSeriesConfig(input: {
  imageCount: 2 | 3
  fixedDimensions: string[]
  fixedValues?: Record<string, string>
}): SopSeriesConfig {
  const fixedValues: Record<string, string> = {}
  for (const dimension of input.fixedDimensions) {
    const value = input.fixedValues?.[dimension] ?? ''
    if (value) fixedValues[dimension] = value
  }
  return {
    imageCount: input.imageCount,
    fixedDimensions: [...input.fixedDimensions],
    variableDimensions: getSopSeriesVariableDimensions(input.fixedDimensions),
    ...(Object.keys(fixedValues).length ? { fixedValues } : {}),
  }
}

/**
 * 用户填了值的固定维度拼成「锁定固定块」原文，例如「画风：3D 皮克斯风；色彩：莫兰迪低饱和」。
 * 这段文本由客户端直接拼在最终固定块最前面，模型不得改写 —— 这是「固定项真正可控」的关键。
 */
export function buildSopSeriesLockedFixedBlock(config: SopSeriesConfig) {
  return config.fixedDimensions
    .map((dimension) => ({ dimension, value: config.fixedValues?.[dimension]?.trim() ?? '' }))
    .filter((entry) => Boolean(entry.value))
    .map((entry) => `${entry.dimension}：${entry.value}`)
    .join('；')
}

/** 没填值的固定维度：这些仍然交给模型补全视觉规则。 */
export function getSopSeriesFreeFixedDimensions(config: SopSeriesConfig) {
  return config.fixedDimensions.filter((dimension) => !config.fixedValues?.[dimension]?.trim())
}

/** 合并「用户锁定段」与「模型补全段」；锁定段永远在前，保证用户填的值逐字出现在固定块开头。 */
export function mergeSopSeriesFixedBlock(lockedBlock: string, modelBlock: string) {
  const locked = lockedBlock.trim()
  const model = modelBlock.trim()
  if (!locked) return model
  if (!model) return locked
  return `${locked}；${model}`
}
