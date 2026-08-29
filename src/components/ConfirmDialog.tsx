import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { Checkbox } from './Checkbox'
import { CopyIcon } from './icons'
import { Button, useDialogFocusTrap, type ButtonVariant } from '../design-system'

function renderMessage(message: string) {
  return message.split(/(`[^`]+`|「[^」]+」|\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={index}
          className="rounded bg-ds-surface px-1 py-0.5 text-[0.85em] text-ds-text dark:bg-ds-surface dark:text-ds-text-subtle"
        >
          {part.slice(1, -1)}
        </code>
      )
    }

    if (part.startsWith('「') && part.endsWith('」')) {
      return (
        <strong key={index} className="font-semibold text-ds-text dark:text-ds-text-subtle">
          {part}
        </strong>
      )
    }

    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={index} className="font-semibold text-ds-text dark:text-ds-text-subtle">
          {part.slice(2, -2)}
        </strong>
      )
    }

    return part
  })
}

function toneToVariant(tone?: 'primary' | 'secondary' | 'danger' | 'warning'): ButtonVariant {
  if (tone === 'warning') return 'danger'
  return tone ?? 'primary'
}

export default function ConfirmDialog() {
  const confirmDialog = useStore((s) => s.confirmDialog)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const [canConfirm, setCanConfirm] = useState(true)
  const [checkboxChecked, setCheckboxChecked] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const delay = confirmDialog?.minConfirmDelayMs ?? 0
    if (!confirmDialog || delay <= 0) {
      setCanConfirm(true)
      return
    }

    setCanConfirm(false)
    const timer = window.setTimeout(() => setCanConfirm(true), delay)
    return () => window.clearTimeout(timer)
  }, [confirmDialog])

  useEffect(() => {
    setCheckboxChecked(confirmDialog?.checkbox?.defaultChecked ?? false)
  }, [confirmDialog])

  const handleClose = () => {
    if (!canConfirm) return
    setConfirmDialog(null)
  }

  const handleCancel = () => {
    if (!canConfirm) return
    const cancelAction = confirmDialog?.cancelAction
    setConfirmDialog(null)
    cancelAction?.(checkboxChecked)
  }

  useCloseOnEscape(Boolean(confirmDialog) && canConfirm, handleClose)
  usePreventBackgroundScroll(Boolean(confirmDialog))
  useDialogFocusTrap(Boolean(confirmDialog), dialogRef)

  if (!confirmDialog) return null
  const isDestructive = confirmDialog.title.includes('删除') || confirmDialog.title.includes('清空')
  const confirmTone = confirmDialog.tone ?? (isDestructive ? 'danger' : undefined)
  const confirmVariant: ButtonVariant = confirmTone === 'danger' || confirmTone === 'warning' ? 'danger' : 'primary'
  const confirmText = confirmDialog.confirmText ?? (isDestructive ? '确认删除' : '确认')
  const cancelText = confirmDialog.cancelText ?? '取消'
  const customButtons = confirmDialog.buttons?.filter((button) => button.label.trim()) ?? []

  return (
    <div
      data-no-drag-select
      className="ds-modal-layer ds-confirm-dialog-layer fixed inset-0 flex items-center justify-center p-4"
      onClick={handleClose}
    >
      <div className="ds-modal-scrim absolute inset-0 animate-overlay-in motion-reduce:animate-none" />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        className="ds-modal-surface relative z-10 w-full max-w-sm rounded-ds-xl border p-6 animate-confirm-in motion-reduce:animate-none"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="confirm-dialog-title"
          className="mb-2 flex items-center gap-2 text-base font-bold text-ds-text dark:text-ds-text-subtle"
        >
          {confirmDialog.icon === 'info' && (
            <svg
              className="h-5 w-5 shrink-0 text-ds-primary"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
          )}
          {confirmDialog.icon === 'copy' && <CopyIcon className="h-5 w-5 shrink-0 text-ds-primary" />}
          {confirmDialog.title}
        </h2>
        <p
          id="confirm-dialog-description"
          className={`text-sm text-ds-muted dark:text-ds-muted ${confirmDialog.checkbox ? 'mb-4' : 'mb-6'} leading-relaxed whitespace-pre-line ${confirmDialog.messageAlign === 'center' ? 'text-center' : ''}`}
        >
          {renderMessage(confirmDialog.message)}
        </p>
        {confirmDialog.checkbox && (
          <Checkbox
            checked={checkboxChecked}
            onChange={setCheckboxChecked}
            label={confirmDialog.checkbox.label}
            tone={confirmDialog.checkbox.tone}
            disabled={confirmDialog.checkbox.disabled}
            className="mb-6"
          />
        )}
        {customButtons.length > 0 ? (
          <div className="flex gap-2">
            {customButtons.map((button) => (
              <Button
                key={button.label}
                variant={toneToVariant(button.tone)}
                className="flex-1"
                disabled={!canConfirm}
                onClick={() => {
                  if (!canConfirm) return
                  setConfirmDialog(null)
                  button.action(checkboxChecked)
                }}
              >
                {button.label}
              </Button>
            ))}
          </div>
        ) : (
          <div className="flex gap-2">
            {confirmDialog.showCancel !== false && (
              <Button variant="secondary" className="flex-1" onClick={handleCancel}>
                {cancelText}
              </Button>
            )}
            <Button
              variant={confirmVariant}
              className="flex-1"
              disabled={!canConfirm}
              onClick={() => {
                if (!canConfirm) return
                const action = confirmDialog.action
                setConfirmDialog(null)
                action?.(checkboxChecked)
              }}
            >
              {confirmText}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
