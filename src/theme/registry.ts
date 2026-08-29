/**
 * 皮肤注册表：皮肤元数据的唯一来源（Single Source of Truth）。
 *
 * 新增皮肤 SOP（不需要改动任何其他类型 / Header / 设置页）：
 * 1. 复制 `src/theme/styles/skins/_template.css` 为 `skins/<id>.css`，填写浅色/深色 Token。
 * 2. 在 `src/theme/styles/skins.css` 中 @import 新皮肤文件。
 * 3. 在下方 SKIN_REGISTRY 增加一项（label / description / swatch / preview / order）。
 * 4. 运行 `npm test`（Token 契约测试会校验新皮肤）并在设计系统预览页检查。
 */

export interface SkinDefinition {
  /** 显示名称 */
  label: string
  /** 一句话说明 */
  description: string
  /** 主色预览色值（紧凑色板圆点） */
  swatch: string
  /** 渐变预览（设置页预设卡片） */
  preview: string
  /** 显示顺序，数值小者在前 */
  order: number
}

export const SKIN_REGISTRY = {
  default: {
    label: '默认',
    description: '原始蓝灰主题',
    swatch: 'hsl(218 42% 46%)',
    preview: 'linear-gradient(135deg, hsl(218 42% 46%), hsl(216 48% 72%))',
    order: 0,
  },
  handdrawn: {
    label: '手绘',
    description: '速写本：本地楷体 + 米黄纸张 + 墨色描边',
    swatch: 'hsl(14 82% 42%)',
    preview: 'linear-gradient(135deg, hsl(14 82% 42%), hsl(220 25% 22%))',
    order: 80,
  },
  glass: {
    label: '玻璃拟态',
    description: '轻磨砂：关键浮层半透明 + 静态彩色光晕',
    swatch: 'hsl(265 85% 56%)',
    preview: 'linear-gradient(135deg, hsl(265 85% 56%), hsl(190 70% 52%))',
    order: 90,
  },
  retro: {
    label: '复古',
    description: '怀旧：本地宋体 + 奶油纸 + 厚棕描边',
    swatch: 'hsl(18 76% 40%)',
    preview: 'linear-gradient(135deg, hsl(18 76% 40%), hsl(175 55% 32%))',
    order: 100,
  },
  eyecare: {
    label: '柔和纸感',
    description: '低饱和牛皮纸配色 + 细腻纸张纹理',
    swatch: 'hsl(158 25% 32%)',
    preview: 'linear-gradient(135deg, hsl(158 25% 32%), hsl(200 28% 38%))',
    order: 110,
  },
} as const satisfies Record<string, SkinDefinition>

/** 皮肤 ID：由注册表自动推导，新增皮肤无需手写联合类型 */
export type SkinId = keyof typeof SKIN_REGISTRY

export const DEFAULT_SKIN_ID: SkinId = 'default'

/** 按 order 排序后的全部皮肤 ID */
export const SKIN_IDS: SkinId[] = (Object.keys(SKIN_REGISTRY) as SkinId[]).sort(
  (a, b) => SKIN_REGISTRY[a].order - SKIN_REGISTRY[b].order,
)

export function isSkinId(value: unknown): value is SkinId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SKIN_REGISTRY, value)
}

/** 非法 / 已删除的皮肤 ID 一律回退到默认皮肤 */
export function normalizeSkinId(value: unknown): SkinId {
  return isSkinId(value) ? value : DEFAULT_SKIN_ID
}

export interface SkinEntry extends SkinDefinition {
  id: SkinId
}

/** 供设置页 / Header 等 UI 使用的有序皮肤列表 */
export function getOrderedSkins(): SkinEntry[] {
  return SKIN_IDS.map((id) => ({ id, ...SKIN_REGISTRY[id] }))
}
