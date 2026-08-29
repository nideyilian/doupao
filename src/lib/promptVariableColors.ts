// design-token-exempt: persisted-user-color-palette
/**
 * 6 色循环调色板 — 用于提示词中变量色标。
 * 颜色顺序刻意错开同类色，相邻变量视觉区分度最大化。
 */
export const VARIABLE_COLORS: readonly string[] = [
  '#10b981',
  '#f97316',
  '#3b82f6',
  '#a855f7',
  '#ec4899',
  '#06b6d4',
] as const

/** 按变量 key 分配颜色，循环取色。 */
export function buildVariableColorMap(
  entries: ReadonlyArray<{ key: string; deletedAt?: number | null | undefined }>,
  locale: string = 'zh-CN',
): Record<string, string> {
  const sorted = [...entries].filter((e) => e.deletedAt == null).sort((a, b) => a.key.localeCompare(b.key, locale))
  const map: Record<string, string> = {}
  sorted.forEach((entry, i) => {
    map[entry.key] = VARIABLE_COLORS[i % VARIABLE_COLORS.length]
  })
  return map
}
