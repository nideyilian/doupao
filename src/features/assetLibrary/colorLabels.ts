// design-token-exempt: persisted-user-color-palette
import type { AssetColorLabel } from '../../types'

// ===== 基础 7 色标签映射 =====

/** 颜色标签 → 十六进制色值（素材标签色）。 */
export const COLOR_LABEL_HEX_MAP: Record<AssetColorLabel, string> = {
  red: '#ef4444',
  orange: '#f97316',
  yellow: '#eab308',
  green: '#22c55e',
  blue: '#3b82f6',
  purple: '#8b5cf6',
  gray: '#6b7280',
}

/** 颜色标签 → 中文名 */
export const COLOR_LABEL_NAMES: Record<AssetColorLabel, string> = {
  red: '红色',
  orange: '橙色',
  yellow: '黄色',
  green: '绿色',
  blue: '蓝色',
  purple: '紫色',
  gray: '灰色',
}

/** 基础 7 色标签选项（下拉菜单 / 过滤等用） */
export const COLOR_LABEL_OPTIONS: Array<{
  value: AssetColorLabel
  label: string
  hex: string
}> = (Object.keys(COLOR_LABEL_HEX_MAP) as AssetColorLabel[]).map((value) => ({
  value,
  label: COLOR_LABEL_NAMES[value],
  hex: COLOR_LABEL_HEX_MAP[value],
}))

/** 基础 7 色标签精简数组（仅 value + color） */
export const COLOR_LABELS: Array<{
  value: AssetColorLabel
  color: string
}> = (Object.keys(COLOR_LABEL_HEX_MAP) as AssetColorLabel[]).map((value) => ({
  value,
  color: COLOR_LABEL_HEX_MAP[value],
}))

/** 基础 7 色标签（含中文名，用于 AssetViewer 等） */
export const COLOR_LABELS_WITH_NAMES: Array<{
  value: AssetColorLabel
  color: string
  label: string
}> = (Object.keys(COLOR_LABEL_HEX_MAP) as AssetColorLabel[]).map((value) => ({
  value,
  color: COLOR_LABEL_HEX_MAP[value],
  label: COLOR_LABEL_NAMES[value],
}))

/** 根据标签名获取十六进制色值（容错：未知标签返回 gray）。 */
export function getColorLabelHex(label: string): string {
  if (label in COLOR_LABEL_HEX_MAP) {
    return COLOR_LABEL_HEX_MAP[label as AssetColorLabel]
  }
  return COLOR_LABEL_HEX_MAP.gray
}

// ===== 扩展调色板（Sidebar 标签树颜色选择器用）=====

/** 扩展 10 色调色板：基础 7 色 + teal + cyan + pink + warm-gray。 */
export const TAG_COLORS_EXTENDED: readonly string[] = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#78716c', // warm-gray
]
