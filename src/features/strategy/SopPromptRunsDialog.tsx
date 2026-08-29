import {
  CopyIcon as Copy,
  LoaderCircleIcon as LoaderCircle,
  ListChecksIcon as ListChecks,
} from '../../design-system/icons'
import { Dialog, IconButton, ScrollArea } from '../../design-system'
import { copyTextToClipboard, getClipboardFailureMessage } from '../../lib/clipboard'
import { useStore } from '../../store'
import type { SopBatchSnapshot } from '../../types'

/**
 * 「生成提示词」快照弹窗：展示某 SOP 历史上生成过的提示词集（只读，可复制单条）。
 * 由 SOP 管理中心内联实现拆出，行为与原来完全一致；图库模式已改用提示词管理弹窗跳转。
 */
export default function SopPromptRunsDialog({
  open,
  onOpenChange,
  sopName,
  loading,
  snapshots,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sopName: string
  loading: boolean
  snapshots: SopBatchSnapshot[]
}) {
  const showToast = useStore((state) => state.showToast)

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`「${sopName}」生成的提示词`} size="lg">
      <div className="flex min-h-[12rem] flex-col">
        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-ds-muted">
            <LoaderCircle size={16} className="animate-spin" />
            加载中…
          </div>
        ) : snapshots.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center rounded-ds-lg border border-dashed border-ds-border px-6 text-center">
            <ListChecks size={24} className="text-ds-text-subtle" />
            <p className="mt-3 text-sm font-medium">暂无生成记录</p>
            <p className="sop-center-quiet-text mt-1 text-xs">该 SOP 尚未生成过提示词。</p>
          </div>
        ) : (
          <ScrollArea maxHeight="60vh" className="space-y-5 pr-2">
            {snapshots.map((snapshot) => (
              <div key={snapshot.id} className="space-y-2 border-b border-ds-border pb-4 last:border-0">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {snapshot.title || '未命名提示词集'}
                  </h4>
                  <span className="shrink-0 text-xs text-ds-muted">
                    {new Date(snapshot.createdAt).toLocaleString('zh-CN')}
                  </span>
                </div>
                <ul className="space-y-2">
                  {snapshot.prompts
                    .filter((prompt) => !prompt.deleted)
                    .map((prompt, index) => (
                      <li
                        key={prompt.id}
                        className="flex items-start gap-2 rounded-lg border border-ds-border p-2.5 text-sm"
                      >
                        <span className="shrink-0 pt-0.5 text-xs text-ds-muted">{index + 1}.</span>
                        <span className="flex-1 whitespace-pre-wrap leading-relaxed">{prompt.text}</span>
                        <IconButton
                          onClick={() => {
                            copyTextToClipboard(prompt.text)
                              .then(() => showToast('已复制该条提示词', 'success'))
                              .catch((error: unknown) =>
                                showToast(getClipboardFailureMessage('复制失败，请检查剪贴板权限', error), 'error'),
                              )
                          }}
                          aria-label="复制提示词"
                          icon={<Copy size={14} />}
                          size="sm"
                        />
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </ScrollArea>
        )}
      </div>
    </Dialog>
  )
}
