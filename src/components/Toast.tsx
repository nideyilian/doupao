import { useStore } from '../store'
import { Button, ToastMessage } from '../design-system'

const TOAST_TONE = {
  success: 'success',
  error: 'danger',
  info: 'info',
} as const

export default function Toast() {
  const toast = useStore((s) => s.toast)

  if (!toast) return null

  const tone = TOAST_TONE[toast.type] ?? 'info'
  const hasAction = Boolean(toast.action)

  return (
    <div
      className={
        hasAction
          ? 'fixed bottom-6 right-6 z-[var(--ds-z-toast)] pointer-events-auto toast-enter'
          : 'fixed bottom-24 left-1/2 z-[var(--ds-z-toast)] -translate-x-1/2 pointer-events-none toast-enter'
      }
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
