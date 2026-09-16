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
