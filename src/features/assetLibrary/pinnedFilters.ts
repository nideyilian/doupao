import type { AssetLibraryFilters, PinnedFilter } from '../../types'
import { COLOR_LABEL_NAMES } from './colorLabels'

/**
 * 顶部筛选标签栏的固定项（PinnedFilter）纯函数：标识、展示文案、筛选补丁与激活判断。
 * 与标签栏临时标签的文案口径一致（「服务商：X」「N 星及以上」「横向/纵向/方形」等）。
 */

const ORIENTATION_LABELS: Record<NonNullable<AssetLibraryFilters['orientation']>, string> = {
  landscape: '横向',
  portrait: '纵向',
  square: '方形',
}

const SOURCE_MODE_LABELS: Record<NonNullable<AssetLibraryFilters['sourceMode']>, string> = {
  gallery: '画廊',
  agent: 'Agent',
  schedule: '日程',
  sop: 'SOP',
  unknown: '未知',
}

/** 生成来源的完整描述：「画廊生成」「Agent 生成」「SOP 生成」「未知来源」。 */
export function sourceModeLabel(mode: NonNullable<AssetLibraryFilters['sourceMode']>): string {
  if (mode === 'unknown') return '未知来源'
  // 拉丁字母值（Agent / SOP）与中文之间需要空格
  const needsSpace = mode === 'agent' || mode === 'sop'
  return `${SOURCE_MODE_LABELS[mode] ?? mode}${needsSpace ? ' 生成' : '生成'}`
}

/** 稳定标识（key）：同 kind+value 视为同一项（favoriteOnly 无 value）。 */
export function pinnedFilterKey(filter: PinnedFilter): string {
  switch (filter.kind) {
    case 'favoriteOnly':
      return 'favoriteOnly'
    case 'minRating':
      return `minRating:${filter.value}`
    case 'orientation':
      return `orientation:${filter.value}`
    case 'sourceMode':
      return `sourceMode:${filter.value}`
    case 'colorLabel':
      return `colorLabel:${filter.value}`
    case 'provider':
      return `provider:${filter.value}`
    case 'model':
      return `model:${filter.value}`
  }
}

/** 快捷标签显示文案：值能自解释的用纯值（横向/红色），需要区分类别的用「类别：值」（服务商：豆包）。 */
export function pinnedFilterLabel(filter: PinnedFilter): string {
  switch (filter.kind) {
    case 'favoriteOnly':
      return '仅看收藏'
    case 'minRating':
      return `${filter.value} 星及以上`
    case 'orientation':
      return ORIENTATION_LABELS[filter.value] ?? filter.value
    case 'sourceMode':
      return sourceModeLabel(filter.value)
    case 'colorLabel':
      return COLOR_LABEL_NAMES[filter.value] ?? filter.value
    case 'provider':
      return `服务商：${filter.value}`
    case 'model':
      return `模型：${filter.value}`
  }
}

/** 该固定项对应的筛选补丁（应用到 filters 时合并进现有条件）。 */
export function pinnedFilterToPatch(filter: PinnedFilter): Partial<AssetLibraryFilters> {
  switch (filter.kind) {
    case 'favoriteOnly':
      return { favoriteOnly: true }
    case 'minRating':
      return { minRating: filter.value }
    case 'orientation':
      return { orientation: filter.value }
    case 'sourceMode':
      return { sourceMode: filter.value }
    case 'colorLabel':
      return { colorLabel: filter.value }
    case 'provider':
      return { provider: filter.value }
    case 'model':
      return { model: filter.value }
  }
}

/** 该条件在「移除」时应如何回退（与标签栏临时标签的移除口径一致）。 */
export function pinnedFilterRemovalPatch(filter: PinnedFilter): Partial<AssetLibraryFilters> {
  switch (filter.kind) {
    case 'favoriteOnly':
      return { favoriteOnly: undefined }
    case 'minRating':
      return { minRating: undefined }
    case 'orientation':
      return { orientation: undefined }
    case 'sourceMode':
      return { sourceMode: undefined }
    case 'colorLabel':
      return { colorLabel: undefined }
    case 'provider':
      return { provider: undefined }
    case 'model':
      return { model: undefined }
  }
}

/** 当前 filters 中该条件是否已生效（决定快捷胶囊的激活高亮）。 */
export function isPinnedFilterActive(filter: PinnedFilter, filters: AssetLibraryFilters): boolean {
  switch (filter.kind) {
    case 'favoriteOnly':
      return filters.favoriteOnly === true
    case 'minRating':
      return filters.minRating === filter.value
    case 'orientation':
      return filters.orientation === filter.value
    case 'sourceMode':
      return filters.sourceMode === filter.value
    case 'colorLabel':
      return filters.colorLabel === filter.value
    case 'provider':
      return filters.provider === filter.value
    case 'model':
      return filters.model === filter.value
  }
}
