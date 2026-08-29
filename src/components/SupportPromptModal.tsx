import { createPortal } from 'react-dom'
import { useRef } from 'react'
import { useStore } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { CloseIcon } from './icons'
import { useDialogFocusTrap } from '../design-system'

export default function SupportPromptModal() {
  const supportPromptOpen = useStore((s) => s.supportPromptOpen)
  const dismissSupportPrompt = useStore((s) => s.dismissSupportPrompt)
  const confirmDialog = useStore((s) => s.confirmDialog)
  const detailTaskId = useStore((s) => s.detailTaskId)
  const lightboxImageId = useStore((s) => s.lightboxImageId)
  const showSettings = useStore((s) => s.showSettings)
  const maskEditorImageId = useStore((s) => s.maskEditorImageId)

  const blockedByHigherPriorityModal = Boolean(
    confirmDialog || detailTaskId || lightboxImageId || showSettings || maskEditorImageId,
  )
  const visible = supportPromptOpen && !blockedByHigherPriorityModal
  const modalRef = useRef<HTMLDivElement>(null)

  useCloseOnEscape(visible, dismissSupportPrompt)
  usePreventBackgroundScroll(visible, modalRef)
  useDialogFocusTrap(visible, modalRef)

  if (!visible) return null

  return createPortal(
    <div
      data-no-drag-select
      className="ds-modal-layer fixed inset-0 flex items-center justify-center p-4"
      onClick={dismissSupportPrompt}
    >
      <div className="ds-modal-scrim absolute inset-0 animate-overlay-in motion-reduce:animate-none" />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="support-prompt-title"
        className="ds-modal-surface relative z-10 w-full max-w-sm rounded-ds-xl border p-6 pb-7 animate-modal-in motion-reduce:animate-none flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="absolute right-4 top-4">
          <button
            type="button"
            onClick={dismissSupportPrompt}
            className="rounded-full p-2 text-ds-muted transition-colors hover:bg-ds-subtle hover:text-ds-muted dark:hover:bg-ds-surface dark:hover:text-ds-text"
            aria-label="关闭"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-5 mt-4 flex justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-[1.5rem] bg-ds-primary-subtle text-ds-primary dark:bg-ds-primary/10 dark:text-ds-primary">
            <svg className="h-ds-control-lg w-ds-control-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
              />
            </svg>
          </div>
        </div>

        <h2
          id="support-prompt-title"
          className="mb-3 text-center text-xl font-bold text-ds-text dark:text-ds-text-subtle"
        >
          感谢使用 🎉
        </h2>

        <p className="mb-8 px-2 text-center text-[15px] leading-relaxed text-ds-muted dark:text-ds-muted">
          你已经成功生成了超过 <strong className="font-semibold text-ds-text dark:text-ds-text-subtle">50</strong>{' '}
          张图片！
          <br />
          如果这个工具对你有所帮助，
          <br />
          欢迎赞助作者，或反馈分享你的建议。
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <a
            href="https://www.ifdian.net/a/cooksleep"
            target="_blank"
            rel="noopener noreferrer"
            onClick={dismissSupportPrompt}
            className="flex w-full sm:w-auto flex-1 items-center justify-center gap-2 rounded-ds-xl bg-ds-primary px-5 py-3.5 text-[15px] font-semibold text-ds-text-inverse transition hover:bg-ds-primary-hover active:scale-[0.98] dark:bg-ds-primary dark:hover:bg-ds-primary-hover"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
            赞助作者
          </a>
          <a
            href="https://github.com/nideyilian/doupao/issues"
            target="_blank"
            rel="noopener noreferrer"
            onClick={dismissSupportPrompt}
            className="flex w-full sm:w-auto flex-1 items-center justify-center gap-2 rounded-ds-xl bg-ds-surface-subtle px-5 py-3.5 text-[15px] font-semibold text-ds-muted transition hover:bg-ds-subtle active:scale-[0.98] dark:bg-ds-surface-subtle dark:text-ds-muted dark:hover:bg-ds-border"
          >
            <svg className="h-[18px] w-[18px] opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
              />
            </svg>
            反馈问题
          </a>
        </div>
      </div>
    </div>,
    document.body,
  )
}
