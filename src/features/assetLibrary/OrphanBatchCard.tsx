import { memo, type MouseEvent } from 'react'
import type { AssetBatchGroup } from '../../lib/assetBatchGrouping'
import { Card, IconButton } from '../../design-system'
import { EyeIcon as Eye, ImageIcon } from '../../design-system/icons'
import { useCoverThumbnail } from '../../hooks/useCoverThumbnail'

function OrphanCover({ imageId, onOpen }: { imageId?: string; onOpen: () => void }) {
  const { src, lost } = useCoverThumbnail(imageId)

  return (
    <button
      type="button"
      data-no-drag-select
      className="h-full w-full"
      aria-label="查看素材"
      onClick={(event) => {
        event.stopPropagation()
        onOpen()
      }}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : lost ? (
        <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-ds-muted/10">
          <ImageIcon size={22} className="gallery-placeholder-icon" />
          <span className="text-xs text-ds-muted">图片已丢失</span>
        </span>
      ) : (
        <span className="flex h-full w-full items-center justify-center">
          <ImageIcon size={30} className="gallery-placeholder-icon" />
        </span>
      )}
    </button>
  )
}

export interface OrphanBatchCardProps {
  group: AssetBatchGroup
  isSelected?: boolean
  /** 点击整卡（选择组内全部素材）；内部操作按钮已 stopPropagation */
  onClick: (event: MouseEvent<HTMLElement>) => void
  /** 打开全屏查看器（组内素材顺序） */
  onOpen: () => void
}

/** 任务已删除的素材组卡片（旧画廊任务卡片样式）：封面 + 「任务已删除」徽标 + 提示词摘要 + 工作区 + 打开查看器。 */
function OrphanBatchCard({ group, isSelected = false, onClick, onOpen }: OrphanBatchCardProps) {
  const coverAsset = group.assets[0]
  const excerpt = group.promptExcerpt || coverAsset?.origins[0]?.prompt || '任务已删除'

  return (
    <div className="gallery-card-shell relative h-full rounded-ds-lg">
      <Card
        onClick={onClick}
        data-selected={isSelected || undefined}
        className="gallery-task-card gallery-sop-card relative h-full cursor-pointer overflow-hidden transition-[box-shadow,border-color,background-color,transform]"
      >
        {isSelected && (
          <span
            aria-hidden="true"
            className="gallery-selection-check absolute right-2 top-2 z-10 flex h-5 w-5 items-center justify-center text-xs font-bold"
          >
            ✓
          </span>
        )}
        <div className="flex h-full">
          <div className="gallery-task-media relative flex h-full w-40 min-w-[10rem] shrink-0 items-center justify-center overflow-hidden">
            <OrphanCover imageId={coverAsset?.imageId} onOpen={onOpen} />
            <span className="absolute left-1.5 top-1.5 flex items-center rounded bg-black/50 px-1.5 py-0.5 text-xs text-ds-danger backdrop-blur-sm">
              任务已删除
            </span>
            <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">
              {group.assets.length} 张
            </span>
          </div>

          <div className="gallery-task-body flex min-w-0 flex-1 flex-col p-3">
            <div className="min-h-0 flex-1 overflow-hidden">
              <h3 className="gallery-task-prompt line-clamp-3 text-sm font-medium">{excerpt}</h3>
              {group.workspaceTabName && (
                <p className="gallery-task-meta mt-1 truncate text-xs">{group.workspaceTabName}</p>
              )}
            </div>
            <div
              data-no-drag-select
              aria-label="孤儿素材操作"
              className="gallery-task-actions ml-auto mt-0.5 flex max-w-full shrink-0 items-center gap-1 overflow-x-auto hide-scrollbar mask-edge-r pr-2"
              onClick={(event) => event.stopPropagation()}
            >
              <IconButton
                type="button"
                onClick={onOpen}
                aria-label="查看素材"
                title="打开查看器"
                className="gallery-task-action gallery-task-action--primary"
                size="sm"
                icon={<Eye size={16} />}
              />
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

export default memo(
  OrphanBatchCard,
  (previous, next) => previous.group === next.group && previous.isSelected === next.isSelected,
)
