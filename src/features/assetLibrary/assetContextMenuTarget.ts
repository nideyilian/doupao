import type { GeneratedAsset } from '../../types'

/**
 * 右键落点若在任务卡片内的某张图片上，返回该图片对应的素材。
 *
 * 任务卡片的根 div 是卡内 `img[data-image-id]` 的祖先，所以右键图片会先命中卡片自己的
 * `onContextMenu`。这一层必须同时做两件事：
 *
 * 1. **按「这张图」取目标素材**，而不是整卡的首张 —— 之前一律用 `group.assets[0]`，
 *    右键第 3 张却操作第 1 张。
 * 2. **据此拦住事件冒泡**：不拦的话 window 上的全局图片右键菜单（`ImageContextMenu`）
 *    也会打开，两个菜单叠在同一坐标、层级还不一样（全局的 z 更高），而 `AssetCardMenu`
 *    的「点外部即关闭」会把落在上层菜单上的 pointerdown 判成外部点击 —— 表现为菜单闪一下就没了。
 *
 * 返回 `undefined` 表示落点不在某张具体图片上（卡片头部/参数行/空白），此时按整卡处理。
 */
export function findCardImageAsset(target: EventTarget | null, assets: GeneratedAsset[]): GeneratedAsset | undefined {
  if (!(target instanceof Element)) return undefined
  const imageId = target.closest('img[data-image-id]')?.getAttribute('data-image-id')
  if (!imageId) return undefined
  return assets.find((asset) => asset.imageId === imageId)
}

/** 图片模式下右键解析出的操作范围：`single` 只作用于命中那一张；`multi` 作用于整个多选选区。 */
export type AssetContextMenuScope = 'single' | 'multi'

/**
 * 菜单可接受的操作范围：图片模式用 `single` / `multi`；分组视图任务卡片整卡右键用 `'full'`
 * ——整卡多图是「一次生成的一组结果」，按批量口径出菜单，但仍保留「查看大图 / 打开文件位置」
 * 这类以首张为入口的单张操作。
 */
export type AssetMenuActionScope = AssetContextMenuScope | 'full'

export interface AssetContextMenuTarget {
  /** 批量操作目标：右键命中素材在选区内 → 整个选区；否则 → 仅该素材（Eagle 式） */
  assetIds: string[]
  /** 菜单应展示哪一套操作（单选与多选的菜单项不同） */
  actionScope: AssetContextMenuScope
}

/**
 * 图片模式（`groupBy: 'none'`，网格与列表共用）下右键的「操作范围」：
 * 右键未选中的图片 → 以这张为唯一选中、菜单只操作这一张；右键已选中的图片 → 菜单操作整个选区。
 *
 * 范围必须**显式**带出来，不能只按 `assetIds.length` 推断：分组视图的任务卡片整卡批量也会让
 * `assetIds` 变长，但那张卡片仍需要「查看大图 / 打开文件位置」这类单张入口，
 * 所以那边不传 `actionScope`（保持全量菜单）。
 */
export function resolveAssetContextMenuScope(selection: string[], assetId: string): AssetContextMenuTarget {
  const multi = selection.includes(assetId) && selection.length > 1
  return {
    assetIds: multi ? selection : [assetId],
    actionScope: multi ? 'multi' : 'single',
  }
}
