import { useCallback, useEffect, useRef, useState } from 'react'
import { onDismissTooltips } from '../lib/tooltipDismiss'

export interface TooltipOptions {
  /** 返回 false 时禁止显示（例如仅在 fal 文生图时提示）。 */
  enabled?: () => boolean
  /** 显示后自动隐藏的毫秒数。 */
  autoHideMs?: number
  /** 触摸长按触发显示前的延迟。 */
  touchDelayMs?: number
}

export interface TooltipController {
  visible: boolean
  /** 悬浮/聚焦/点击的手势处理器，可展开到触发器上。 */
  handlers: {
    onMouseEnter: () => void
    onMouseLeave: () => void
    onFocus: () => void
    onBlur: () => void
    onClick: () => void
    onTouchEnd: () => void
    onTouchCancel: () => void
  }
  /** 立即显示（受 enabled 约束），用于手动触发与点击提示。 */
  show: () => void
  /** 立即隐藏。 */
  hide: () => void
  /** 隐藏并抑制下一次点击显示（用于打开模态前手动收起）。 */
  dismiss: () => void
  /** 触摸长按后显示（受 enabled 与 touchDelayMs 约束）。 */
  startTouch: () => void
  /** 取消触摸长按定时器。 */
  clearTimer: () => void
}

/**
 * 统一工具提示控制器：同时覆盖「悬浮/聚焦解释气泡」与「手动/条件提示」两类场景，
 * 配合 `ViewportTooltip` 渲染。`useHintTooltip` 已并入此 hook。
 */
export function useTooltip(options: TooltipOptions = {}): TooltipController {
  const { autoHideMs, touchDelayMs = 450 } = options
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<number | null>(null)
  const autoHideTimerRef = useRef<number | null>(null)
  const suppressedRef = useRef(false)
  const enabledRef = useRef(options.enabled)
  enabledRef.current = options.enabled

  const isEnabled = useCallback(() => !enabledRef.current || enabledRef.current(), [])

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const clearAutoHideTimer = useCallback(() => {
    if (autoHideTimerRef.current != null) {
      window.clearTimeout(autoHideTimerRef.current)
      autoHideTimerRef.current = null
    }
  }, [])

  const show = useCallback(() => {
    if (!isEnabled()) return
    suppressedRef.current = false
    clearTimer()
    clearAutoHideTimer()
    setVisible(true)
    if (autoHideMs != null) {
      autoHideTimerRef.current = window.setTimeout(() => {
        setVisible(false)
        autoHideTimerRef.current = null
      }, autoHideMs)
    }
  }, [autoHideMs, clearAutoHideTimer, clearTimer, isEnabled])

  const hide = useCallback(() => {
    setVisible(false)
    clearTimer()
    clearAutoHideTimer()
  }, [clearAutoHideTimer, clearTimer])

  const dismiss = useCallback(() => {
    clearTimer()
    clearAutoHideTimer()
    suppressedRef.current = true
    setVisible(false)
  }, [clearAutoHideTimer, clearTimer])

  const startTouch = useCallback(() => {
    if (!isEnabled()) return
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      show()
    }, touchDelayMs)
  }, [clearTimer, isEnabled, show, touchDelayMs])

  useEffect(
    () => () => {
      clearTimer()
      clearAutoHideTimer()
    },
    [clearAutoHideTimer, clearTimer],
  )

  // 任意模态打开时自动隐藏（全局提示关闭总线）
  useEffect(() => onDismissTooltips(dismiss), [dismiss])

  const handlers = {
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
    onClick: () => {
      clearTimer()
      timerRef.current = window.setTimeout(() => {
        if (!suppressedRef.current) setVisible(true)
        timerRef.current = null
      }, 300)
    },
    onTouchEnd: clearTimer,
    onTouchCancel: clearTimer,
  }

  return { visible, handlers, show, hide, dismiss, startTouch, clearTimer }
}
