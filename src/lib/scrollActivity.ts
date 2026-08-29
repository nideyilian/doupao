/**
 * 滚动活动检测：虚拟列表滚动时，指针会连续扫过大量卡片，触发 hover 全图加载与主线程解码，
 * 造成明显卡顿。各滚动容器在 rAF 回调里调用 markScrollActivity()，
 * 需要抑制滚动期间昂贵工作的模块用 isScrollActive() 判断。
 */

let lastScrollAt = 0

/** 标记当前处于滚动活动（由虚拟列表的滚动处理器调用）。 */
export function markScrollActivity() {
  lastScrollAt = Date.now()
}

/** 最近 withinMs 毫秒内是否有滚动活动。 */
export function isScrollActive(withinMs = 250): boolean {
  return Date.now() - lastScrollAt < withinMs
}
