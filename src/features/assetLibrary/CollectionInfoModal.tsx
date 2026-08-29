import { memo } from 'react'
import { Dialog } from '../../design-system'
import type { CollectionFolderInfo } from './store'

export interface CollectionInfoModalProps {
  info: CollectionFolderInfo | null
  onOpenChange: (open: boolean) => void
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

function formatDate(ts: number): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-ds-muted">{label}</dt>
      <dd className="min-w-0 text-right tabular-nums text-ds-text">{value}</dd>
    </div>
  )
}

function CollectionInfoModalInner({ info, onOpenChange }: CollectionInfoModalProps) {
  return (
    <Dialog
      open={info !== null}
      onOpenChange={(next) => {
        if (!next) onOpenChange(false)
      }}
      title={info ? `文件夹信息 · ${info.name}` : '文件夹信息'}
    >
      {info && (
        <dl className="space-y-2.5" data-testid="collection-info-modal">
          <InfoRow label="素材数量" value={`${info.assetCount}（含子文件夹 ${info.recursiveAssetCount}）`} />
          <InfoRow label="占用空间" value={formatBytes(info.byteSize)} />
          <InfoRow label="子文件夹" value={`${info.childCount}`} />
          <InfoRow label="创建时间" value={formatDate(info.createdAt)} />
          <InfoRow label="最后修改" value={formatDate(info.updatedAt)} />
        </dl>
      )}
    </Dialog>
  )
}

export default memo(CollectionInfoModalInner)
