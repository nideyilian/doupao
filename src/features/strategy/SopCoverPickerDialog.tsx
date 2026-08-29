import { CheckIcon as Check, CloseIcon as X, FileImageIcon as FileImage } from '../../design-system/icons'
import { Button, IconButton } from '../../design-system'
import { isModalBackdropEvent } from '../../lib/modalBackdrop'
import { useStore } from '../../store'
import SopCoverImage from './SopCoverImage'
import type { SopCoverCandidate } from './sopCover'

/**
 * SOP 封面选择浮层：从该 SOP 已生成的图片中挑选封面。
 * 由 SOP 管理中心内联实现拆出，行为与原来完全一致。
 */
export default function SopCoverPickerDialog({
  itemName,
  coverImageId,
  candidates,
  onSelect,
  onRemove,
  onClose,
}: {
  itemName: string
  coverImageId?: string
  candidates: SopCoverCandidate[]
  onSelect: (imageId: string) => void
  onRemove: () => void
  onClose: () => void
}) {
  const showToast = useStore((state) => state.showToast)

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-ds-scrim/0.62 p-4"
      onMouseDown={(event) => {
        if (isModalBackdropEvent(event)) onClose()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="sop-cover-picker-title"
        className="flex max-h-[min(76vh,720px)] w-full max-w-3xl flex-col overflow-hidden rounded-[var(--ds-radius-xl)] border border-ds-border bg-ds-raised shadow-ds-lg"
      >
        <header className="flex items-start justify-between gap-4 border-b border-ds-border px-5 py-4">
          <div className="min-w-0">
            <h3 id="sop-cover-picker-title" className="truncate text-base font-semibold">
              选择「{itemName}」的封面
            </h3>
            <p className="sop-center-quiet-text mt-1 text-xs">从该 SOP 已生成的图片中选择，保存修改后生效。</p>
          </div>
          <IconButton onClick={onClose} aria-label="关闭 SOP 封面选择" icon={<X size={17} />} className="shrink-0" />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {candidates.length > 0 ? (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
              {candidates.map((candidate) => {
                const selected = coverImageId === candidate.imageId
                return (
                  <button
                    key={candidate.imageId}
                    type="button"
                    onClick={() => onSelect(candidate.imageId)}
                    aria-label={`选择第 ${candidate.promptIndex} 条提示词的第 ${candidate.imageIndex} 张图片作为封面`}
                    aria-pressed={selected}
                    className="group/cover relative aspect-square overflow-hidden rounded-ds-lg border border-ds-border bg-ds-surface transition hover:border-ds-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus"
                  >
                    <SopCoverImage imageId={candidate.imageId} alt="" className="h-full w-full" />
                    <span className="absolute inset-x-1.5 bottom-1.5 rounded-md bg-black/65 px-1 py-0.5 text-xs font-medium text-white">
                      提示词 {candidate.promptIndex} · 图 {candidate.imageIndex}
                    </span>
                    {selected && (
                      <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-ds-primary text-ds-text-inverse">
                        <Check size={13} />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="flex min-h-56 flex-col items-center justify-center rounded-ds-lg border border-dashed border-ds-border px-6 text-center">
              <FileImage size={24} className="text-ds-text-subtle" />
              <p className="mt-3 text-sm font-medium">暂无可选封面</p>
              <p className="sop-center-quiet-text mt-1 text-xs">先使用该 SOP 完成一次生图，再双击封面选择生成结果。</p>
            </div>
          )}
        </div>
        {coverImageId && (
          <footer className="flex justify-end border-t border-ds-border px-5 py-3">
            <Button
              onClick={() => {
                onRemove()
                showToast('已移除当前封面', 'info')
              }}
              variant="secondary"
              size="sm"
            >
              移除当前封面
            </Button>
          </footer>
        )}
      </section>
    </div>
  )
}
