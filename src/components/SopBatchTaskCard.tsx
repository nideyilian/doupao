import { memo, useEffect, useState, type MouseEvent } from 'react'
import {
  BookOpenCheckIcon as BookOpenCheck,
  EyeIcon as Eye,
  ImageIcon,
  LoaderCircleIcon as LoaderCircle,
  RefreshIcon as RefreshCw,
  TrashIcon as Trash2,
} from '../design-system/icons'
import type { TaskRecord, TaskStatus } from '../types'
import { formatSopBatchElapsed, getSopBatchElapsedMs, type SopBatchSummary } from '../lib/sopBatchTaskGrouping'
import { hasCompletedTaskOutputs } from '../lib/taskProgressDisplay'
import { Card, IconButton } from '../design-system'
import TaskParamSummary from './TaskParamSummary'
import { useCoverThumbnail } from '../hooks/useCoverThumbnail'

function BatchCover({
  imageId,
  imageIds,
  isRunning,
  isFailed,
  onOpenImage,
}: {
  imageId: string
  imageIds: string[]
  isRunning: boolean
  isFailed: boolean
  onOpenImage: (imageId: string) => void
}) {
  const { src, lost } = useCoverThumbnail(imageId)

  if (imageId) {
    return (
      <button
        type="button"
        data-no-drag-select
        className="h-full w-full"
        aria-label="查看 SOP 批量任务封面图片"
        onClick={(event) => {
          event.stopPropagation()
          onOpenImage(imageId)
        }}
      >
        {src ? (
          <img
            src={src}
            data-image-id={imageId}
            data-output-image-ids={imageIds.join(',')}
            alt="SOP 批量任务生成结果"
            className="saveable-image h-full w-full object-cover"
          />
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

  if (isRunning) {
    return (
      <div className="flex flex-col items-center gap-2">
        <LoaderCircle
          size={30}
          className="gallery-state-icon gallery-state-icon--info animate-spin motion-reduce:animate-none"
        />
        <span className="gallery-task-meta text-xs">生成中</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <ImageIcon size={30} className={isFailed ? 'gallery-state-icon--danger' : 'gallery-placeholder-icon'} />
      <span className={`text-xs ${isFailed ? 'gallery-state-text--danger' : 'gallery-task-meta'}`}>
        {isFailed ? '生成失败' : '暂无图片'}
      </span>
    </div>
  )
}

function SopBatchTaskCard({
  sopName,
  tasks,
  summary,
  isSelected = false,
  onClick,
  onOpenBatch,
  onOpenImage,
  onRerun,
  onDelete,
}: {
  sopName: string
  tasks: TaskRecord[]
  summary: SopBatchSummary
  isSelected?: boolean
  onClick: (event: MouseEvent<HTMLElement>) => void
  onOpenBatch: () => void
  onOpenImage: (imageId: string) => void
  onRerun: () => void
  onDelete: () => void
}) {
  const [now, setNow] = useState(Date.now())
  const outputImageIds = tasks.flatMap((task) => task.outputImages)
  const imageTotal = tasks.reduce(
    (total, task) => total + Math.max(task.sopBatch?.imagesPerPrompt ?? task.params?.n ?? 1, task.outputImages.length),
    0,
  )
  const imageCompleted = outputImageIds.length
  const promptTarget = Math.max(summary.total, ...tasks.map((task) => task.sopBatch?.promptCount ?? 0))
  const isRunning = tasks.some(
    (task) =>
      task.status === 'running' || ((task.falRecoverable || task.customRecoverable) && !hasCompletedTaskOutputs(task)),
  )
  const failedCount = tasks.filter((task) => task.status === 'error' && !hasCompletedTaskOutputs(task)).length
  const isFailed = tasks.length > 0 && failedCount === tasks.length
  const cardStatus: TaskStatus = isRunning ? 'running' : isFailed ? 'error' : 'done'
  const status = isRunning ? '生成中' : isFailed ? '生成失败' : failedCount > 0 ? '部分完成' : '已完成'
  const representativeTask = tasks[0]
  const elapsed = formatSopBatchElapsed(getSopBatchElapsedMs(tasks, now))

  useEffect(() => {
    if (!isRunning) return
    setNow(Date.now())
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(intervalId)
  }, [isRunning])

  return (
    <div className="gallery-card-shell relative rounded-ds-lg">
      <Card
        onClick={onClick}
        data-selected={isSelected || undefined}
        data-status={cardStatus}
        className="gallery-task-card gallery-sop-card relative cursor-pointer overflow-hidden transition-[box-shadow,border-color,background-color,transform]"
      >
        {isSelected && (
          <span
            aria-hidden="true"
            className="gallery-selection-check absolute right-2 top-2 z-10 flex h-5 w-5 items-center justify-center text-xs font-bold"
          >
            ✓
          </span>
        )}
        <div className="flex h-44">
          <div className="gallery-task-media relative flex h-full w-40 min-w-[10rem] shrink-0 items-center justify-center overflow-hidden">
            <BatchCover
              imageId={outputImageIds[0] ?? ''}
              imageIds={outputImageIds}
              isRunning={isRunning}
              isFailed={isFailed}
              onOpenImage={onOpenImage}
            />
            <span className="absolute left-1.5 top-1.5 flex items-center rounded bg-black/50 px-1.5 py-0.5 font-mono text-xs text-white backdrop-blur-sm sm:text-xs">
              {elapsed}
            </span>
            {imageTotal > 0 && (
              <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">
                {imageCompleted}/{imageTotal}
              </span>
            )}
          </div>

          <div className="gallery-task-body flex min-w-0 flex-1 flex-col p-3">
            <div className="gallery-sop-inline mb-1 flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-medium">
                <BookOpenCheck size={13} className="mr-1 inline" />
                SOP · {sopName}
              </span>
              <span className="shrink-0 tabular-nums">
                {summary.total}/{promptTarget}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <h3 className="gallery-task-prompt truncate text-sm font-medium">{status}</h3>
              <p className="gallery-task-meta mt-1 line-clamp-2 text-xs leading-relaxed">
                整批 {promptTarget} 条提示词 · 图片 {imageCompleted}/{imageTotal} · 耗时 {elapsed}
                {summary.running ? ` · 生成中 ${summary.running}` : ''}
                {failedCount ? ` · 失败 ${failedCount}` : ''}
              </p>
            </div>
            {representativeTask && (
              <TaskParamSummary task={representativeTask} className="hide-scrollbar mask-edge-r pr-2" />
            )}
            <div
              data-no-drag-select
              aria-label="SOP 批量任务操作"
              className="gallery-task-actions ml-auto mt-0.5 flex max-w-full shrink-0 items-center gap-1 overflow-x-auto hide-scrollbar mask-edge-r pr-2"
              onClick={(event) => event.stopPropagation()}
            >
              <IconButton
                type="button"
                onClick={onOpenBatch}
                aria-label={`查看 SOP 批量任务 ${sopName}`}
                title="查看批次"
                className="gallery-task-action gallery-task-action--primary"
                size="sm"
                icon={<Eye size={16} />}
              />
              <IconButton
                type="button"
                onClick={onRerun}
                aria-label={`再次生成 SOP 批量任务 ${sopName}`}
                title="再次生成"
                disabled={isRunning}
                className="gallery-task-action gallery-task-action--primary"
                size="sm"
                icon={<RefreshCw size={16} />}
              />
              <IconButton
                type="button"
                onClick={onDelete}
                aria-label={`删除 SOP 批量任务 ${sopName}`}
                title="删除批次"
                className="gallery-task-action gallery-task-action--danger"
                size="sm"
                icon={<Trash2 size={16} />}
              />
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

export default memo(
  SopBatchTaskCard,
  (previous, next) =>
    previous.sopName === next.sopName &&
    previous.tasks === next.tasks &&
    previous.summary === next.summary &&
    previous.isSelected === next.isSelected,
)
