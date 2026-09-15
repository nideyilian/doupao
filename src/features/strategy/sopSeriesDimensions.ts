import type { SopSeriesConfig } from './types'

/**
 * 系列图一致性维度库。
 *
 * 只保留**真正会改变画面**的维度：画风、构图、色彩、光线、视角决定「像不像同一系列」，
 * 主体、背景、文案内容是系列里通常要换的内容。像「文案结构」「情绪氛围」这类要靠其他维度
 * 推导、对画面影响间接的维度不放进来 —— 设置项多一个，用户就多一分困惑，画面却没差别。
 *
 * 「文案内容」必须留着：海报上渲染出来的那行字就是像素本身，换一句文案就是换一张画面。
 * 它同时也是本仓库既有的文案处理轴（见 derivePolicy 的 preserve_copy / variable_copy）：
 * 整组统一 = 固定，每张不同 = 变化。
 *
 * 维度名同时是 fixedValues 的键，改名会让用户已填的值失配，不要随意改动。
 */
export const SOP_SERIES_DIMENSIONS = ['画风', '构图', '色彩', '光线', '视角', '主体', '背景', '文案内容']

/** 默认组内固定：画风、构图、色彩、光线、视角才是「同一系列」的骨架。 */
export const SOP_SERIES_DEFAULT_FIXED_DIMENSIONS = ['画风', '构图', '色彩', '光线', '视角']

/** 默认每张变化：主体、背景、文案内容都属于「内容」，海报系列通常每张讲不同卖点。 */
export const SOP_SERIES_DEFAULT_VARIABLE_DIMENSIONS = ['主体', '背景', '文案内容']

/**
 * 画面文字维度。它和其它维度走不同的拼装通道：其它固定维度进「非画面文字」的固定块，
 * 它必须单独成段（「画面文字（逐字绘制）：…」），否则会被明确告知不要渲染成文字。
 */
export const SOP_SERIES_COPY_DIMENSION = '文案内容'

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
 * 走「固定块」通道的固定维度：文案内容单独走画面文字通道，不进固定块。
 * 固定块会被标注为「非画面文字」，把文案塞进去等于告诉模型别把它画成字。
 */
function getSopSeriesSpecFixedDimensions(config: SopSeriesConfig) {
  return config.fixedDimensions.filter((dimension) => dimension !== SOP_SERIES_COPY_DIMENSION)
}

/** 「文案内容」是否整组固定（整组共用同一套画面文字）。 */
export function isSopSeriesCopyFixed(config: SopSeriesConfig) {
  return config.fixedDimensions.includes(SOP_SERIES_COPY_DIMENSION)
}

/**
 * 用户为「文案内容」填的具体文案。没固定、或固定了但留空，都返回空字符串
 * —— 留空表示让模型定一句并全组逐字复用（走模型输出的 fixedCopy 字段）。
 */
export function buildSopSeriesLockedCopy(config: SopSeriesConfig) {
  if (!isSopSeriesCopyFixed(config)) return ''
  return config.fixedValues?.[SOP_SERIES_COPY_DIMENSION]?.trim() ?? ''
}

/**
 * 用户填了值的固定维度拼成「锁定固定块」原文，例如「画风：3D 皮克斯风；色彩：莫兰迪低饱和」。
 * 这段文本由客户端直接拼在最终固定块最前面，模型不得改写 —— 这是「固定项真正可控」的关键。
 * 不含文案内容（它走 buildSopSeriesLockedCopy）。
 */
export function buildSopSeriesLockedFixedBlock(config: SopSeriesConfig) {
  return getSopSeriesSpecFixedDimensions(config)
    .map((dimension) => ({ dimension, value: config.fixedValues?.[dimension]?.trim() ?? '' }))
    .filter((entry) => Boolean(entry.value))
    .map((entry) => `${entry.dimension}：${entry.value}`)
    .join('；')
}

/** 没填值的固定维度（不含文案内容）：这些仍然交给模型补全视觉规则。 */
export function getSopSeriesFreeFixedDimensions(config: SopSeriesConfig) {
  return getSopSeriesSpecFixedDimensions(config).filter((dimension) => !config.fixedValues?.[dimension]?.trim())
}

/** 合并「用户锁定段」与「模型补全段」；锁定段永远在前，保证用户填的值逐字出现在固定块开头。 */
export function mergeSopSeriesFixedBlock(lockedBlock: string, modelBlock: string) {
  const locked = lockedBlock.trim()
  const model = modelBlock.trim()
  if (!locked) return model
  if (!model) return locked
  return `${locked}；${model}`
}
