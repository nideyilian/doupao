import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { useDialogFocusTrap } from '../design-system'
import {
  DERIVE_DIMENSIONS,
  DEFAULT_DERIVE_DIMENSION_POLICY,
  type DeriveCopyMode,
  type DeriveDimensionPolicy,
  type DeriveMode,
} from '../features/strategy/derivePolicy'

const MODE_OPTIONS: Array<{ value: DeriveMode; label: string; hint: string }> = [
  { value: 'lock', label: '锁定', hint: '原样保留，不变' },
  { value: 'tweak', label: '微调', hint: '同类变化' },
  { value: 'change', label: '大改', hint: '跨类衍生' },
]

const COPY_MODE_OPTIONS: Array<{ value: DeriveCopyMode; label: string; hint: string }> = [
  { value: 'visual-only', label: '纯视觉', hint: '排除全部文字' },
  { value: 'preserve', label: '保留原文案', hint: '文字按原样保留' },
  { value: 'derive', label: '文案也衍生', hint: '标题/卖点作为变量' },
]

function modeTone(mode: DeriveMode) {
  if (mode === 'lock') return 'border-ds-border bg-ds-surface text-ds-muted dark:bg-ds-surface'
  if (mode === 'tweak') return 'border-ds-primary/40 bg-ds-primary-subtle text-ds-primary dark:bg-ds-primary/10'
  return 'border-ds-warning/50 bg-ds-warning-subtle text-ds-warning dark:bg-ds-warning/10 dark:text-ds-warning'
}

export function DerivePolicyModal({
  policy,
  copyMode,
  onChange,
  onCopyModeChange,
  onClose,
}: {
  policy: DeriveDimensionPolicy
  copyMode: DeriveCopyMode
  onChange: (policy: DeriveDimensionPolicy) => void
  onCopyModeChange: (mode: DeriveCopyMode) => void
  onClose: () => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  useDialogFocusTrap(true, rootRef)
  useCloseOnEscape(true, onClose)
  usePreventBackgroundScroll(true, rootRef)
  const [draft, setDraft] = useState<DeriveDimensionPolicy>({ ...policy })
  const [copyDraft, setCopyDraft] = useState<DeriveCopyMode>(copyMode)

  const setMode = (dimension: (typeof DERIVE_DIMENSIONS)[number], mode: DeriveMode) => {
    setDraft((current) => ({ ...current, [dimension]: mode }))
  }

  const activeCount = DERIVE_DIMENSIONS.filter((dimension) => draft[dimension] !== 'lock').length

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="衍生设置"
      className="fixed inset-0 z-overlay flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="ds-modal-surface relative z-10 flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-ds-xl border animate-modal-in motion-reduce:animate-none">
        <div className="flex items-center justify-between border-b border-ds-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ds-text dark:text-ds-text-subtle">衍生设置</h2>
            <p className="mt-0.5 text-xs text-ds-muted">
              控制哪些维度衍生、哪些锁定 · 当前 {activeCount}/8 个维度参与变化
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-ds-muted hover:bg-ds-subtle hover:text-ds-text"
            aria-label="关闭"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar p-4">
          <div className="space-y-2.5">
            {/* 文案处理模式 */}
            <div className="rounded-ds-lg border border-ds-border/70 bg-ds-surface/50 p-2.5 dark:border-ds-border">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-sm font-medium text-ds-text dark:text-ds-text-subtle">文案处理</span>
                <span className="text-xs text-ds-muted">
                  {COPY_MODE_OPTIONS.find((option) => option.value === copyDraft)?.hint}
                </span>
              </div>
              <div className="flex gap-1.5">
                {COPY_MODE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setCopyDraft(option.value)}
                    className={`flex-1 rounded-ds-lg border px-2 py-1.5 text-xs font-medium transition-[background-color,border-color,color] duration-150 ${
                      copyDraft === option.value
                        ? option.value === 'visual-only'
                          ? 'border-ds-primary/40 bg-ds-primary-subtle text-ds-primary dark:bg-ds-primary/10'
                          : option.value === 'preserve'
                            ? 'border-ds-success/40 bg-ds-success-subtle text-ds-success dark:bg-ds-success/10'
                            : 'border-ds-warning/50 bg-ds-warning-subtle text-ds-warning dark:bg-ds-warning/10 dark:text-ds-warning'
                        : 'border-ds-border bg-transparent text-ds-muted hover:bg-ds-subtle dark:hover:bg-ds-surface'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {DERIVE_DIMENSIONS.map((dimension) => (
              <div
                key={dimension}
                className="rounded-ds-lg border border-ds-border/70 bg-ds-surface/50 p-2.5 dark:border-ds-border"
              >
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-sm font-medium text-ds-text dark:text-ds-text-subtle">{dimension}</span>
                  <span className="text-xs text-ds-muted">
                    {MODE_OPTIONS.find((option) => option.value === draft[dimension])?.hint}
                  </span>
                </div>
                <div className="flex gap-1.5">
                  {MODE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setMode(dimension, option.value)}
                      className={`flex-1 rounded-ds-lg border px-2 py-1.5 text-xs font-medium transition-[background-color,border-color,color] duration-150 ${
                        draft[dimension] === option.value
                          ? modeTone(option.value)
                          : 'border-ds-border bg-transparent text-ds-muted hover:bg-ds-subtle dark:hover:bg-ds-surface'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-ds-border px-4 py-3">
          <button
            type="button"
            onClick={() => {
              setDraft({ ...DEFAULT_DERIVE_DIMENSION_POLICY })
              setCopyDraft('visual-only')
              useStore.getState().showToast('已恢复默认衍生策略', 'info')
            }}
            className="rounded-ds-lg border border-ds-border px-3 py-1.5 text-xs text-ds-muted hover:bg-ds-subtle"
          >
            恢复默认
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-ds-lg border border-ds-border px-3 py-1.5 text-xs text-ds-muted hover:bg-ds-subtle"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(draft)
                onCopyModeChange(copyDraft)
                onClose()
              }}
              className="rounded-ds-lg bg-ds-primary px-4 py-1.5 text-xs font-medium text-ds-text-inverse hover:bg-ds-primary-hover"
            >
              应用
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
