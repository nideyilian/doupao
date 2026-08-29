/**
 * 兼容桥：旧的 theme 工具已迁移到 src/theme/（registry.ts + appearance.ts）。
 * 请新代码直接从 '../theme/registry' 与 '../theme/appearance' 导入。
 */

import { SKIN_IDS, normalizeSkinId, type SkinId } from '../theme/registry'

export {
  applyAppearance,
  applyThemeMode,
  normalizeThemeMode,
  THEME_TRANSITION_CLASS,
  THEME_TRANSITION_DURATION_MS,
} from '../theme/appearance'

export { normalizeSkinId, isSkinId, DEFAULT_SKIN_ID, SKIN_IDS } from '../theme/registry'
export type { SkinId } from '../theme/registry'

/** @deprecated 使用 normalizeSkinId */
export const normalizeColorScheme = normalizeSkinId

/** @deprecated 使用 SKIN_IDS（由注册表推导） */
export const COLOR_SCHEME_VALUES: SkinId[] = SKIN_IDS
