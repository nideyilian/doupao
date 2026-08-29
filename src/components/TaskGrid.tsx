import { useDeferredValue, useMemo, useRef, useState, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useStore, reuseConfig, editOutputs, removeMultipleTasks, removeTask, rerunSopBatchTasks } from '../store'
import { getTaskGridVirtualWindow } from '../lib/taskGridVirtualWindow'
import { getGalleryImageAspectRatio, getGalleryImageGridMetrics } from '../lib/galleryImageGrid'
import { buildGalleryMasonryLayout, getVisibleGalleryMasonryItems } from '../lib/galleryMasonryLayout'
import { filterGalleryTasks } from '../lib/galleryTaskFilter'
import { HOVER_FULL_IMAGE_LIMIT } from '../lib/imageHover'
import { groupSopBatchTasks, type TaskGridItem } from '../lib/sopBatchTaskGrouping'
import type { TaskRecord } from '../types'
import { Grid2X2Icon, ImageIcon, ListChecksIcon, SearchXIcon as SearchX } from '../design-system/icons'
import { EmptyState, SegmentedControl } from '../design-system'
import TaskCard from './TaskCard'
import SopBatchTaskCard from './SopBatchTaskCard'
import SopBatchDetailModal from './SopBatchDetailModal'
import GalleryImageTile, { buildGalleryImageItems } from './GalleryImageTile'
import { useDragSelect, getMarqueeBoxStyle } from '../hooks/useDragSelect'

const GALLERY_COLUMNS_STORAGE_KEY = 'doupao.gallery-columns'
const MIN_GALLERY_COLUMNS = 3
const MAX_GALLERY_COLUMNS = 6
const DEFAULT_GALLERY_COLUMNS = 4
const GALLERY_IMAGE_GAP = 12
const GALLERY_TASK_CARD_GAP = 16
const TASK_CARD_ROW_HEIGHT = 192
const GALLERY_MASONRY_SCROLL_STEP = 120

function getInitialGalleryColumns() {
  const defaultValue = DEFAULT_GALLERY_COLUMNS
  if (typeof window === 'undefined') return defaultValue
  const value = Number(window.localStorage.getItem(GALLERY_COLUMNS_STORAGE_KEY))
  return Number.isFinite(value)
    ? Math.min(MAX_GALLERY_COLUMNS, Math.max(MIN_GALLERY_COLUMNS, Math.round(value)))
    : defaultValue
}

export default function TaskGrid() {
  const activeTabId = useStore((s) => s.activeWorkspaceTabId)
  const allTasks = useStore((s) => s.tasks)
  const workspaceTabs = useStore((s) => s.workspaceTabs)
  const tabTasks = useMemo(() => {
    const tab = activeTabId ? workspaceTabs.find((t) => t.id === activeTabId) : null
    return tab?.tasks ?? []
  }, [activeTabId, workspaceTabs])
  const filterFavorite = useStore((s) => s.filterFavorite)
  const tasks = filterFavorite ? allTasks : activeTabId ? tabTasks : allTasks
  const searchQuery = useStore((s) => s.searchQuery)
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const filterStatus = useStore((s) => s.filterStatus)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const setDetailTaskId = useStore((s) => s.setDetailTaskId)
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const selectedTaskIds = useStore((s) => s.selectedTaskIds)
  const selectedTaskIdSet = useMemo(() => new Set(selectedTaskIds), [selectedTaskIds])
  const setSelectedTaskIds = useStore((s) => s.setSelectedTaskIds)
  const galleryViewMode = useStore((s) => s.galleryViewMode)
  const setGalleryViewMode = useStore((s) => s.setGalleryViewMode)
  const galleryNavigateTaskId = useStore((s) => s.galleryNavigateTaskId)
  const setGalleryNavigateTaskId = useStore((s) => s.setGalleryNavigateTaskId)
  const rootRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState(() => ({
    height: typeof window === 'undefined' ? 800 : window.innerHeight,
    width: typeof window === 'undefined' ? 1_024 : window.innerWidth,
  }))
  const [scrollTop, setScrollTop] = useState(0)
  const [batchDetail, setBatchDetail] = useState<{ sopName: string; tasks: TaskRecord[] } | null>(null)
  const [galleryColumns, setGalleryColumns] = useState(getInitialGalleryColumns)
  const [gridWidth, setGridWidth] = useState(0)
  const [imageAspectRatios, setImageAspectRatios] = useState<Record<string, number>>({})
  // 缩略图就绪时按帧批量上报宽高比：一次滚动/一批缩略图只触发一次 masonry 重排，
  // 而不是每个 tile 单独 setState 导致上万张图库反复全量重排。
  const pendingAspectRatiosRef = useRef<Record<string, number>>({})
  const aspectRatioFlushScheduledRef = useRef(false)
  const [toolbarControlsTarget, setToolbarControlsTarget] = useState<HTMLElement | null>(null)
  const gridPageTopRef = useRef(0)
  const activeRowHeightRef = useRef(TASK_CARD_ROW_HEIGHT)
  const scrollRowRef = useRef(-1)
  const suppressClickUntil = useRef(0)
  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform)

  const filteredTasks = useMemo(
    () =>
      filterGalleryTasks({
        tasks,
        query: deferredSearchQuery,
        filterStatus,
        filterFavorite,
        activeFavoriteCollectionId,
      }),
    [tasks, deferredSearchQuery, filterStatus, filterFavorite, activeFavoriteCollectionId],
  )
  // 流式生图期间 tasks 高频更新（每帧/每张中间图），deferred 值让下游 10k+ 的
  // 分组/平铺/masonry 布局稳定在上一帧，在当前帧提交后再异步追上，避免掉帧。
  const deferredFilteredTasks = useDeferredValue(filteredTasks)
  const gridItems = useMemo<TaskGridItem[]>(
    () =>
      filterFavorite
        ? deferredFilteredTasks.map((task) => ({ kind: 'task' as const, id: task.id, createdAt: task.createdAt, task }))
        : groupSopBatchTasks(deferredFilteredTasks),
    [deferredFilteredTasks, filterFavorite],
  )
  const galleryImageItems = useMemo(() => buildGalleryImageItems(deferredFilteredTasks), [deferredFilteredTasks])

  useEffect(() => {
    window.localStorage.setItem(GALLERY_COLUMNS_STORAGE_KEY, String(galleryColumns))
  }, [galleryColumns])

  useEffect(() => {
    setToolbarControlsTarget(document.getElementById('gallery-layout-controls'))
  }, [])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return

    const updateGridMetrics = () => {
      gridPageTopRef.current = root.getBoundingClientRect().top + window.scrollY
      const nextWidth = root.clientWidth
      setGridWidth((current) => (current === nextWidth ? current : nextWidth))
      const nextScrollTop = Math.max(0, window.scrollY - gridPageTopRef.current)
      scrollRowRef.current = -1
      setScrollTop((current) => (Math.abs(current - nextScrollTop) < 1 ? current : nextScrollTop))
    }

    updateGridMetrics()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateGridMetrics)
      return () => window.removeEventListener('resize', updateGridMetrics)
    }
    const observer = new ResizeObserver(updateGridMetrics)
    observer.observe(root)
    window.addEventListener('resize', updateGridMetrics)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateGridMetrics)
    }
  }, [galleryViewMode, gridItems.length, galleryImageItems.length])
  const gridContentWidth = gridWidth || viewport.width
  const { columns: taskColumns } = getGalleryImageGridMetrics(gridContentWidth, galleryColumns, GALLERY_TASK_CARD_GAP)
  const virtualWindow = getTaskGridVirtualWindow({
    itemCount: gridItems.length,
    columns: taskColumns,
    rowHeight: TASK_CARD_ROW_HEIGHT,
    scrollTop,
    viewportHeight: viewport.height,
    overscanRows: 3,
  })
  const visibleItems = gridItems.slice(virtualWindow.start, virtualWindow.end)
  const { columns: imageColumns, tileSize: imageTileSize } = getGalleryImageGridMetrics(
    gridContentWidth,
    galleryColumns,
    GALLERY_IMAGE_GAP,
  )
  const galleryMasonryLayout = useMemo(
    () =>
      buildGalleryMasonryLayout({
        aspectRatios: galleryImageItems.map(
          (item) =>
            imageAspectRatios[item.imageId] ??
            getGalleryImageAspectRatio(
              item.task.actualParamsByImage?.[item.imageId]?.size ??
                item.task.actualParams?.size ??
                item.task.params.size,
            ),
        ),
        columnWidth: imageTileSize,
        columns: imageColumns,
        gap: GALLERY_IMAGE_GAP,
      }),
    [galleryImageItems, imageAspectRatios, imageColumns, imageTileSize],
  )
  const visibleMasonryItems = useMemo(
    () => getVisibleGalleryMasonryItems(galleryMasonryLayout, scrollTop, viewport.height),
    [galleryMasonryLayout, scrollTop, viewport.height],
  )
  activeRowHeightRef.current = galleryViewMode === 'images' ? GALLERY_MASONRY_SCROLL_STEP : TASK_CARD_ROW_HEIGHT

  useEffect(() => {
    let frame = 0
    const updateViewport = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        const nextHeight = window.innerHeight
        const nextWidth = window.innerWidth
        setViewport((current) =>
          current.height === nextHeight && current.width === nextWidth
            ? current
            : { height: nextHeight, width: nextWidth },
        )

        const nextScrollTop = Math.max(0, window.scrollY - gridPageTopRef.current)
        const nextRow = Math.floor(nextScrollTop / Math.max(1, activeRowHeightRef.current))
        if (nextRow === scrollRowRef.current) return
        scrollRowRef.current = nextRow
        setScrollTop((current) => (Math.abs(current - nextScrollTop) < 1 ? current : nextScrollTop))
      })
    }
    window.addEventListener('scroll', updateViewport, { passive: true })
    window.addEventListener('resize', updateViewport)
    updateViewport()
    return () => {
      window.removeEventListener('scroll', updateViewport)
      window.removeEventListener('resize', updateViewport)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => {
    if (galleryViewMode !== 'images' || !galleryNavigateTaskId) return
    const imageIndex = galleryImageItems.findIndex((item) => item.task.id === galleryNavigateTaskId)
    if (imageIndex < 0) {
      setGalleryNavigateTaskId(null)
      return
    }

    const freshGridTop = rootRef.current
      ? rootRef.current.getBoundingClientRect().top + window.scrollY
      : gridPageTopRef.current
    const headerHeight =
      document.querySelector<HTMLElement>('header[data-no-drag-select]')?.getBoundingClientRect().height ?? 0
    const targetTop = freshGridTop + galleryMasonryLayout.items[imageIndex].top - headerHeight - 12
    window.scrollTo({
      top: Math.max(0, targetTop),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
    setGalleryNavigateTaskId(null)
  }, [galleryImageItems, galleryNavigateTaskId, galleryViewMode, galleryMasonryLayout, setGalleryNavigateTaskId])

  const handleDelete = (task: (typeof tasks)[0]) => {
    setConfirmDialog({
      title: '删除任务',
      message:
        '确定要删除这个任务吗？任务的提示词、参数和它生成的图片会一并删除，不可恢复；被其他任务/会话引用的图片会保留。',
      action: () => removeTask(task),
    })
  }

  const handleDeleteBatch = (batchTasks: TaskRecord[]) => {
    setConfirmDialog({
      title: '删除 SOP 批量任务',
      message: `确定要删除这 ${batchTasks.length} 个 SOP 子任务吗？这些任务生成的图片会一并删除，不可恢复；被其他任务/会话引用的图片会保留。`,
      action: () => removeMultipleTasks(batchTasks.map((task) => task.id)),
    })
  }

  const getCardTaskIds = (card: Element) => {
    const taskIds = card.getAttribute('data-task-ids')
    if (taskIds) return taskIds.split(',').filter(Boolean)
    const taskId = card.getAttribute('data-task-id')
    return taskId ? [taskId] : []
  }

  const toggleBatchSelection = (batchTasks: TaskRecord[]) => {
    const batchTaskIds = batchTasks.map((task) => task.id)
    setSelectedTaskIds((current) => {
      const selected = new Set(current)
      const shouldSelect = !batchTaskIds.every((taskId) => selected.has(taskId))
      batchTaskIds.forEach((taskId) => (shouldSelect ? selected.add(taskId) : selected.delete(taskId)))
      return Array.from(selected)
    })
  }

  const selectImageTileTask = (taskId: string, additive: boolean) => {
    setSelectedTaskIds((current) => {
      if (!additive) return current.length === 1 && current[0] === taskId ? current : [taskId]
      return current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId]
    })
  }

  const handleImageAspectRatioChange = (imageId: string, aspectRatio: number) => {
    pendingAspectRatiosRef.current[imageId] = aspectRatio
    if (aspectRatioFlushScheduledRef.current) return
    aspectRatioFlushScheduledRef.current = true
    requestAnimationFrame(() => {
      aspectRatioFlushScheduledRef.current = false
      const pending = pendingAspectRatiosRef.current
      if (Object.keys(pending).length === 0) return
      pendingAspectRatiosRef.current = {}
      setImageAspectRatios((current) => {
        let changed = false
        const next = { ...current }
        for (const [id, ratio] of Object.entries(pending)) {
          if (Math.abs((current[id] ?? 0) - ratio) < 0.001) continue
          next[id] = ratio
          changed = true
        }
        return changed ? next : current
      })
    })
  }

  // 框选：与素材库共用同一套交互（实时命中预览 / 容器自动滚动 / Esc 取消 / Shift 加选）
  const { selectionBox } = useDragSelect({
    containerSelector: '[data-drag-select-surface]',
    containerRef: rootRef,
    itemSelector: '.task-card-wrapper',
    getItemIds: (element) => getCardTaskIds(element),
    onSelectionChange: (ids) => setSelectedTaskIds(ids),
    initialSelectedIds: selectedTaskIds,
    onSuppressClick: () => {
      suppressClickUntil.current = Date.now() + 250
    },
  })

  const galleryLayoutControls = (
    <div
      data-no-drag-select
      className="flex min-w-0 flex-wrap items-center justify-end gap-3 text-xs max-xl:justify-start"
    >
      <SegmentedControl
        aria-label="画廊显示模式"
        value={galleryViewMode}
        onValueChange={setGalleryViewMode}
        size="sm"
        className="h-ds-control-lg"
        options={[
          {
            value: 'tasks',
            label: (
              <span className="flex items-center gap-1.5">
                <ListChecksIcon size={14} />
                任务卡片
              </span>
            ),
          },
          {
            value: 'images',
            label: (
              <span className="flex items-center gap-1.5">
                <Grid2X2Icon size={14} />
                图片
              </span>
            ),
          },
        ]}
      />

      <span className="text-xs tabular-nums text-ds-muted">
        {galleryViewMode === 'tasks' ? `${gridItems.length} 个任务` : `${galleryImageItems.length} 张图片`}
      </span>

      <SegmentedControl
        aria-label="每行显示数量"
        value={String(galleryColumns)}
        onValueChange={(value) => setGalleryColumns(Number(value))}
        options={['3', '4', '5', '6']}
        size="sm"
        className="h-ds-control-lg shrink-0"
      />
    </div>
  )

  return (
    <>
      {toolbarControlsTarget && createPortal(galleryLayoutControls, toolbarControlsTarget)}
      <div className="gallery-grid-shell">
        {galleryViewMode === 'tasks' && !gridItems.length && (
          <EmptyState
            icon={searchQuery || filterFavorite ? <SearchX size={22} /> : <ImageIcon size={22} />}
            title={searchQuery || filterFavorite ? '没有找到匹配的任务' : '从第一张图片开始'}
            description={
              searchQuery || filterFavorite
                ? '尝试调整搜索词或筛选条件。'
                : '在下方输入提示词，配置尺寸与质量后生成图片。'
            }
          />
        )}

        {galleryViewMode === 'images' && !galleryImageItems.length && (
          <EmptyState
            icon={<ImageIcon size={22} />}
            title={deferredFilteredTasks.length ? '当前任务还没有输出图片' : '没有找到可平铺的图片'}
            description={
              deferredFilteredTasks.length
                ? '生成完成后，所有输出图片会自动出现在这里。'
                : '尝试调整搜索词或筛选条件，或先生成一批图片。'
            }
          />
        )}

        {galleryViewMode === 'tasks' && gridItems.length > 0 && (
          <div ref={rootRef} data-task-grid-root data-drag-select-surface className="relative min-h-[50vh]">
            <div style={{ height: virtualWindow.totalHeight + 40 }}>
              <div
                ref={gridRef}
                className="gallery-grid absolute left-0 right-0 grid gap-4"
                style={{
                  gridTemplateColumns: `repeat(${taskColumns}, minmax(0, 1fr))`,
                  top: virtualWindow.offsetTop,
                }}
              >
                {visibleItems.map((item) =>
                  item.kind === 'task' ? (
                    <div key={item.id} className="gallery-card-wrapper task-card-wrapper" data-task-id={item.task.id}>
                      <TaskCard
                        task={item.task}
                        onClick={(e) => {
                          if (Date.now() < suppressClickUntil.current) {
                            e.preventDefault()
                            return
                          }
                          suppressClickUntil.current = 0
                          const isCtrl = isMac ? e.metaKey : e.ctrlKey
                          if (isCtrl) {
                            useStore.getState().toggleTaskSelection(item.task.id)
                            return
                          }

                          setDetailTaskId(item.task.id)
                        }}
                        onReuse={() => reuseConfig(item.task)}
                        onEditOutputs={() => editOutputs(item.task)}
                        onDelete={() => handleDelete(item.task)}
                        isSelected={selectedTaskIdSet.has(item.task.id)}
                      />
                    </div>
                  ) : (
                    <div
                      key={item.id}
                      className="gallery-card-wrapper task-card-wrapper"
                      data-task-id={item.tasks[0]?.id}
                      data-task-ids={item.tasks.map((task) => task.id).join(',')}
                    >
                      <SopBatchTaskCard
                        sopName={item.sopName}
                        tasks={item.tasks}
                        summary={item.summary}
                        isSelected={item.tasks.length > 0 && item.tasks.every((task) => selectedTaskIdSet.has(task.id))}
                        onClick={(event) => {
                          if (Date.now() < suppressClickUntil.current) {
                            event.preventDefault()
                            return
                          }
                          suppressClickUntil.current = 0
                          const isCtrl = isMac ? event.metaKey : event.ctrlKey
                          if (isCtrl) {
                            toggleBatchSelection(item.tasks)
                            return
                          }
                          setBatchDetail({ sopName: item.sopName, tasks: item.tasks })
                        }}
                        onOpenBatch={() => setBatchDetail({ sopName: item.sopName, tasks: item.tasks })}
                        onOpenImage={(imageId) =>
                          setLightboxImageId(
                            imageId,
                            item.tasks.flatMap((task) => task.outputImages),
                          )
                        }
                        onRerun={() => void rerunSopBatchTasks(item.tasks)}
                        onDelete={() => handleDeleteBatch(item.tasks)}
                      />
                    </div>
                  ),
                )}
              </div>
            </div>
          </div>
        )}

        {galleryViewMode === 'images' && galleryImageItems.length > 0 && (
          <div ref={rootRef} data-task-grid-root data-drag-select-surface className="relative min-h-[50vh]">
            <div style={{ height: galleryMasonryLayout.totalHeight }}>
              <div ref={gridRef} className="absolute inset-0">
                {visibleMasonryItems.map((layoutItem) => {
                  const item = galleryImageItems[layoutItem.index]
                  return (
                    <GalleryImageTile
                      key={item.id}
                      item={item}
                      selected={selectedTaskIdSet.has(item.task.id)}
                      loadFullOnHover={galleryImageItems.length <= HOVER_FULL_IMAGE_LIMIT}
                      style={{
                        height: layoutItem.height,
                        left: layoutItem.left,
                        top: layoutItem.top,
                        width: layoutItem.width,
                      }}
                      onAspectRatioChange={(aspectRatio) => handleImageAspectRatioChange(item.imageId, aspectRatio)}
                      onSelect={(additive) => {
                        if (Date.now() < suppressClickUntil.current) return
                        suppressClickUntil.current = 0
                        selectImageTileTask(item.task.id, additive)
                      }}
                      onOpenDetail={() => setDetailTaskId(item.task.id, { imageId: item.imageId })}
                    />
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {selectionBox && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-10 rounded-sm border border-ds-selection-border bg-ds-selection/60"
            style={getMarqueeBoxStyle(selectionBox, rootRef.current)}
          />
        )}
        {galleryViewMode === 'tasks' && batchDetail && (
          <SopBatchDetailModal
            sopName={batchDetail.sopName}
            tasks={batchDetail.tasks}
            onClose={() => setBatchDetail(null)}
            onOpenImage={(imageId) =>
              setLightboxImageId(
                imageId,
                batchDetail.tasks.flatMap((task) => task.outputImages),
              )
            }
          />
        )}
      </div>
    </>
  )
}
