/**
 * 网格图片 hover 全图的公共策略：
 * - 图片总数超过 HOVER_FULL_IMAGE_LIMIT 时，hover 只保留缩略图，不再加载/解码 2K/4K 原图，
 *   避免上万张图库中鼠标扫过时反复解码原图造成卡顿；
 * - decodeImageDataUrl 把原图先交给脱离 DOM 的 Image 完成解码，再替换 <img> 的 src，
 *   否则浏览器在解码大图期间会把 <img> 渲染成空白，出现「hover 时图片闪一下」。
 */

export const HOVER_FULL_IMAGE_LIMIT = 2000

export function decodeImageDataUrl(dataUrl: string): Promise<void> {
  const image = new Image()
  image.src = dataUrl
  if (typeof image.decode === 'function') {
    return image.decode().catch(() => Promise.resolve())
  }
  return new Promise<void>((resolve) => {
    image.onload = () => resolve()
    image.onerror = () => resolve()
  })
}
