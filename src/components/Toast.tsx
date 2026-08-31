import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { Button, ToastMessage } from '../design-system'

const TOAST_TONE = {
  success: 'success',
  error: 'danger',
  info: 'info',
} as const

/** 输入栏未挂载时的兜底底部偏移（贴近屏幕底部） */
const FALLBACK_BOTTOM_OFFSET = 24

export default function Toast() {
  const toast = useStore((s) => s.toast)
  // 跟随输入栏高度：toast 始终悬浮在输入栏正上方，不遮挡底部参数/操作区
  const [bottomOffset, setBottomOffset] = useState(FALLBACK_BOTTOM_OFFSET)

  useEffect(() => {
    const readOffset = () => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--input-bar-clearance')
      const parsed = raw ? Number.parseFloat(raw) : NaN
      setBottomOffset(Number.isFinite(parsed) && parsed > 0 ? parsed + 8 : FALLBACK_BOTTOM_OFFSET)
    }
    readOffset()
    // InputBar 用 ResizeObserver 更新 --input-bar-clearance，这里监听 style 变化跟随
    const observer = new MutationObserver(readOffset)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
    window.addEventListener('resize', readOffset)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', readOffset)
    }
  }, [])

  if (!toast) return null

  const tone = TOAST_TONE[toast.type] ?? 'info'
  const hasAction = Boolean(toast.action)

  return (
    <div
      className={`fixed left-1/2 z-[var(--ds-z-toast)] -translate-x-1/2 toast-enter ${
        hasAction ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
      style={{ bottom: bottomOffset }}
    >
      <ToastMessage
        tone={tone}
        action={
          toast.action ? (
            <Button size="sm" onClick={toast.action.onClick}>
              {toast.action.label}
            </Button>
          ) : undefined
        }
      >
        {toast.message}
      </ToastMessage>
    </div>
  )
}
