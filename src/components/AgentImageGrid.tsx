import { useEffect, useMemo, useState } from 'react'
import type { TaskRecord } from '../types'
import { ensureImageThumbnailCached, subscribeImageThumbnail, useStore } from '../store'
import { useRuntimeStore } from '../stores/runtimeStore'
import { Grid } from '../design-system'

export type AgentImageGridItem = { task: TaskRecord; taskId: string } | { task: null; taskId: string }

export interface AgentImageGridEntry {
  key: string
  task: TaskRecord | null
  taskId: string
  imageId: string | null
  imageIndex: number
}

export function getAgentImageGridEntries(items: AgentImageGridItem[]): AgentImageGridEntry[] {
  return items.flatMap<AgentImageGridEntry>((item) => {
    if (!item.task) {
      return [{ key: `deleted:${item.taskId}`, task: null, taskId: item.taskId, imageId: null, imageIndex: 0 }]
    }
    if (item.task.outputImages.length === 0) {
      return [{ key: `task:${item.task.id}`, task: item.task, taskId: item.task.id, imageId: null, imageIndex: 0 }]
    }
    const task = item.task
    return task.outputImages.map((imageId, imageIndex) => ({
      key: `${task.id}:${imageId}`,
      task,
      taskId: task.id,
      imageId,
      imageIndex,
    }))
  })
}

function getEntryAspectRatio(task: TaskRecord | null, imageId: string | null) {
  const actualSize = imageId ? task?.actualParamsByImage?.[imageId]?.size : undefined
  const size = actualSize ?? task?.actualParams?.size ?? task?.params.size
  if (typeof size !== 'string') return 1
  const match = size.match(/^(\d+)x(\d+)$/i)
  if (!match) return 1
  const width = Number(match[1])
  const height = Number(match[2])
  return width > 0 && height > 0 ? width / height : 1
}

function AgentImageTile({ entry, imageList }: { entry: AgentImageGridEntry; imageList: string[] }) {
  const [thumbnailSrc, setThumbnailSrc] = useState('')
  const streamPreviewSrc = useRuntimeStore((state) => (entry.task ? state.streamPreviews[entry.task.id] || '' : ''))
  const setLightboxImageId = useStore((state) => state.setLightboxImageId)
  const imageId = entry.imageId
  const task = entry.task

  useEffect(() => {
    setThumbnailSrc('')
    if (!imageId) return

    let cancelled = false
    const applyThumbnail = (thumbnail: { dataUrl: string }) => {
      if (!cancelled) setThumbnailSrc(thumbnail.dataUrl)
    }
    const unsubscribe = subscribeImageThumbnail(imageId, applyThumbnail)
    ensureImageThumbnailCached(imageId)
      .then((thumbnail) => {
        if (thumbnail) applyThumbnail(thumbnail)
      })
      .catch(() => {
        if (!cancelled) setThumbnailSrc('')
      })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [imageId])

  const src = thumbnailSrc || (!imageId ? streamPreviewSrc : '')
  const isRunning = task?.status === 'running'
  const isError = task?.status === 'error'
  const isDeleted = !task
  const canOpen = Boolean(imageId && src)

  return (
    <button
      type="button"
      disabled={!canOpen}
      aria-label={canOpen ? `查看第 ${entry.imageIndex + 1} 张生成图片` : undefined}
      onClick={() => {
        if (imageId) setLightboxImageId(imageId, imageList)
      }}
      className={`group/image relative min-h-[150px] w-full overflow-hidden rounded-ds-lg border bg-ds-surface text-left transition-[border-color,box-shadow] dark:bg-black/20 ${
        canOpen
          ? 'cursor-zoom-in border-ds-border hover:border-ds-primary/70 hover:shadow-lg dark:border-ds-border dark:hover:border-ds-primary/60'
          : 'cursor-default border-dashed border-ds-border dark:border-ds-border'
      }`}
      style={{ aspectRatio: getEntryAspectRatio(task, imageId) }}
    >
      {src ? (
        <img
          src={src}
          data-image-id={imageId ?? undefined}
          className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover/image:scale-[1.03]"
          alt=""
          loading="lazy"
        />
      ) : (
        <div className="flex h-full min-h-[150px] w-full items-center justify-center px-4 text-center text-xs text-ds-muted dark:text-ds-muted">
          {isDeleted ? '图片已删除' : isError ? '生成失败' : '正在生成图片…'}
        </div>
      )}

      {isRunning && (
        <span className="absolute right-2 top-2 rounded-md bg-ds-primary/90 px-2 py-1 text-xs font-medium text-white shadow-sm backdrop-blur">
          生成中
        </span>
      )}
      {isError && src && (
        <span className="absolute right-2 top-2 rounded-md bg-ds-warning/90 px-2 py-1 text-xs font-medium text-white shadow-sm backdrop-blur">
          部分完成
        </span>
      )}
    </button>
  )
}

function AgentImagePreviewTile({ entry, imageList }: { entry: AgentImageGridEntry; imageList: string[] }) {
  const [thumbnailSrc, setThumbnailSrc] = useState('')
  const setLightboxImageId = useStore((state) => state.setLightboxImageId)
  const imageId = entry.imageId

  useEffect(() => {
    setThumbnailSrc('')
    if (!imageId) return

    let cancelled = false
    const applyThumbnail = (thumbnail: { dataUrl: string }) => {
      if (!cancelled) setThumbnailSrc(thumbnail.dataUrl)
    }
    const unsubscribe = subscribeImageThumbnail(imageId, applyThumbnail)
    ensureImageThumbnailCached(imageId)
      .then((thumbnail) => {
        if (thumbnail) applyThumbnail(thumbnail)
      })
      .catch(() => {
        if (!cancelled) setThumbnailSrc('')
      })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [imageId])

  if (!imageId) return null

  return (
    <button
      type="button"
      aria-label={`查看第 ${entry.imageIndex + 1} 张生成图片`}
      onClick={() => setLightboxImageId(imageId, imageList)}
      className="group/image h-[200px] w-[200px] flex-none overflow-hidden rounded-ds-lg border border-ds-border bg-ds-surface text-left transition-[border-color,box-shadow] hover:border-ds-primary/70 hover:shadow-lg dark:border-ds-border dark:bg-black/20 dark:hover:border-ds-primary/60"
    >
      {thumbnailSrc ? (
        <img
          src={thumbnailSrc}
          data-image-id={imageId}
          className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover/image:scale-[1.03]"
          alt=""
          loading="lazy"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-xs text-ds-muted dark:text-ds-muted">
          加载图片中…
        </span>
      )}
    </button>
  )
}

export function AgentImagePreviewStrip({
  items,
  imageList,
  onViewMore,
}: {
  items: AgentImageGridItem[]
  imageList: string[]
  onViewMore: () => void
}) {
  const entries = useMemo(() => getAgentImageGridEntries(items).filter((entry) => entry.imageId), [items])
  if (entries.length === 0) return null

  return (
    <div className="mt-3 flex w-full gap-3 overflow-x-auto pb-1" onClick={(event) => event.stopPropagation()}>
      {entries.map((entry) => (
        <AgentImagePreviewTile key={entry.key} entry={entry} imageList={imageList} />
      ))}
      <button
        type="button"
        onClick={onViewMore}
        className="flex h-[200px] w-[200px] flex-none flex-col items-center justify-center gap-2 rounded-ds-lg border border-dashed border-ds-border bg-ds-surface px-5 text-center text-sm font-medium text-ds-muted transition-colors hover:border-ds-primary hover:bg-ds-primary-subtle hover:text-ds-primary dark:border-ds-border dark:bg-ds-surface dark:text-ds-muted dark:hover:border-ds-primary dark:hover:bg-ds-primary/10 dark:hover:text-ds-primary"
      >
        <span className="text-2xl leading-none">+</span>
        <span>查看更多</span>
        <span className="text-xs font-normal text-ds-muted dark:text-ds-muted">展开完整回复</span>
      </button>
    </div>
  )
}

export default function AgentImageGrid({ items, imageList }: { items: AgentImageGridItem[]; imageList: string[] }) {
  const entries = useMemo(() => getAgentImageGridEntries(items), [items])
  if (entries.length === 0) return null

  return (
    <Grid gap={2} minColumnWidth="12rem" className="mt-3 w-full" onClick={(event) => event.stopPropagation()}>
      {entries.map((entry) => (
        <AgentImageTile key={entry.key} entry={entry} imageList={imageList} />
      ))}
    </Grid>
  )
}
