import { HistoryIcon as History } from '../../design-system/icons'
import { Button, Dialog, ScrollArea } from '../../design-system'
import type { SopVersion } from './types'

/**
 * SOP 版本历史弹窗：查看历史版本正文并一键恢复。
 * 由 SOP 管理中心内联实现拆出，行为与原来完全一致。
 */
export default function SopVersionHistoryDialog({
  open,
  onOpenChange,
  sopName,
  versions,
  onRestore,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sopName: string
  versions: SopVersion[]
  onRestore: (version: SopVersion) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`「${sopName}」的版本历史`} size="lg">
      <div className="flex min-h-[12rem] flex-col">
        {versions.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center rounded-ds-lg border border-dashed border-ds-border px-6 text-center">
            <History size={24} className="text-ds-text-subtle" />
            <p className="mt-3 text-sm font-medium">暂无历史版本</p>
            <p className="sop-center-quiet-text mt-1 text-xs">修改并保存 SOP 后，历史版本会出现在这里。</p>
          </div>
        ) : (
          <ScrollArea maxHeight="60vh" className="space-y-3 pr-2">
            {versions.map((version) => (
              <div key={version.id} className="space-y-2 rounded-lg border border-ds-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-semibold">{version.name || '未命名 SOP'}</h4>
                    <span className="text-xs text-ds-muted">{new Date(version.createdAt).toLocaleString('zh-CN')}</span>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => onRestore(version)}>
                    恢复此版本
                  </Button>
                </div>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-ds-subtle p-2.5 text-xs leading-5 text-ds-text">
                  {version.content}
                </pre>
              </div>
            ))}
          </ScrollArea>
        )}
      </div>
    </Dialog>
  )
}
