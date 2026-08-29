import { useCallback } from 'react'
import { useStore } from '../store'

type ConfirmOptions = {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  tone?: 'danger' | 'warning'
  action: () => void
  cancelAction?: () => void
}

type InfoOptions = {
  title: string
  message: string
  confirmText?: string
  action?: () => void
}

export function useAppDialog() {
  const setConfirmDialog = useStore((state) => state.setConfirmDialog)

  const openConfirmDialog = useCallback(
    (options: ConfirmOptions) => {
      setConfirmDialog({
        ...options,
        confirmText: options.confirmText ?? '确认',
        cancelText: options.cancelText ?? '取消',
      })
    },
    [setConfirmDialog],
  )

  const openInfoDialog = useCallback(
    (options: InfoOptions) => {
      setConfirmDialog({
        ...options,
        icon: 'info',
        showCancel: false,
        confirmText: options.confirmText ?? '知道了',
      })
    },
    [setConfirmDialog],
  )

  return { openConfirmDialog, openInfoDialog }
}
