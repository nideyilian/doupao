import { memo, useEffect, useState, useRef, type ReactNode, type KeyboardEvent } from 'react'
import type { TaskRecord } from '../types'
import {
  useStore,
  ensureImageCached,
  ensureImageThumbnailCached,
  subscribeImageThumbnail,
  retryTask,
  removeMultipleTasks,
} from '../store'
import { getImage } from '../lib/db'
import { useRuntimeStore } from '../stores/runtimeStore'
import { updateTaskPrompt } from '../store'
import { formatImageRatio } from '../lib/size'
import { getParamDisplay, ActualValueBadge } from '../lib/paramDisplay'
import { DEFAULT_IMAGES_MODEL, DEFAULT_FAL_MODEL } from '../lib/apiProfiles'
import { isAgentTaskPromptPending } from '../lib/taskPromptDisplay'
import { getTaskProgressDisplay, hasCompletedTaskOutputs } from '../lib/taskProgressDisplay'
import { CodeIcon } from './icons'
import ViewportTooltip from './ViewportTooltip'
import PromptVariableEditor from './PromptVariableEditor'
import { Card, IconButton } from '../design-system'

interface Props {
  task: TaskRecord
  onReuse: () => void
  onEditOutputs: () => void
  onDelete: () => void
  onClick: (e: React.MouseEvent | React.TouchEvent) => void
  isSelected?: boolean
  disableSwipe?: boolean
}

function TaskActionButton({
  tooltip,
  className,
  disabled = false,
  onClick,
  children,
}: {
  tooltip: string
  className: string
  disabled?: boolean
  onClick?: () => void
  children: ReactNode
}) {
  const [tooltipVisible, setTooltipVisible] = useState(false)

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
      onFocus={() => setTooltipVisible(true)}
      onBlur={() => setTooltipVisible(false)}
    >
      <IconButton
        type="button"
        onClick={onClick}
        className={className}
        disabled={disabled}
        aria-label={tooltip}
        icon={children}
        size="sm"
      />
      <ViewportTooltip visible={tooltipVisible} className="whitespace-nowrap">
        {tooltip}
      </ViewportTooltip>
    </span>
  )
}

function TaskCard({ task, onReuse, onEditOutputs, onDelete, onClick, isSelected, disableSwipe }: Props) {
  const [thumbSrc, setThumbSrc] = useState<string>('')
  const [thumbLost, setThumbLost] = useState(false)
  const [coverRatio, setCoverRatio] = useState<string>('')
  const [coverSize, setCoverSize] = useState<string>('')
  const [now, setNow] = useState(Date.now())
  const [isSwiping, setIsSwiping] = useState(false)
  const [swipeStartedSelected, setSwipeStartedSelected] = useState(false)
  const [swipeActionActive, setSwipeActionActive] = useState(false)
  const [swipeDirection, setSwipeDirection] = useState<-1 | 0 | 1>(0)
  const [streamPreviewLoaded, setStreamPreviewLoaded] = useState(false)
  const toggleTaskSelection = useStore((s) => s.toggleTaskSelection)
  const alwaysShowRetryButton = useStore((s) => s.settings.alwaysShowRetryButton)
  const openFavoritePicker = useStore((s) => s.openFavoritePicker)
  const streamPreviewSrc = useRuntimeStore((s) => s.streamPreviews[task.id] || '')
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const swipeResetTimerRef = useRef<number | null>(null)
  const suppressClickUntilRef = useRef(0)
  const horizontalSwipeRef = useRef(false)
  const swipeDirectionRef = useRef<-1 | 0 | 1>(0)
  const swipeActionActiveRef = useRef(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const swipeOffsetRef = useRef(0)
  const pendingSwipeOffsetRef = useRef(0)
  const swipeFrameRef = useRef<number | null>(null)
  const displayTaskStatus = task.status === 'error' && hasCompletedTaskOutputs(task) ? 'done' : task.status

  const updateSwipeDirection = (nextDirection: -1 | 0 | 1) => {
    if (swipeDirectionRef.current === nextDirection) return
    swipeDirectionRef.current = nextDirection
    setSwipeDirection(nextDirection)
  }

  const updateSwipeActionActive = (nextActive: boolean) => {
    if (swipeActionActiveRef.current === nextActive) return
    swipeActionActiveRef.current = nextActive
    setSwipeActionActive(nextActive)
  }

  const applySwipeOffset = (offset: number) => {
    swipeOffsetRef.current = offset
    if (cardRef.current) {
      cardRef.current.style.transform = offset ? `translateX(${offset}px)` : ''
    }
  }

  const cancelSwipeFrame = () => {
    if (swipeFrameRef.current != null) {
      window.cancelAnimationFrame(swipeFrameRef.current)
      swipeFrameRef.current = null
    }
  }

  const scheduleSwipeOffset = (offset: number) => {
    if (swipeFrameRef.current == null && swipeOffsetRef.current === offset) return
    pendingSwipeOffsetRef.current = offset
    if (swipeFrameRef.current != null) return
    swipeFrameRef.current = window.requestAnimationFrame(() => {
      swipeFrameRef.current = null
      applySwipeOffset(pendingSwipeOffsetRef.current)
    })
  }

  const isTagScrollTarget = (target: EventTarget | null) => {
    return target instanceof Element && Boolean(target.closest('[data-tag-scroll-area]'))
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    if (disableSwipe || isTagScrollTarget(e.target)) {
      touchStartRef.current = null
      horizontalSwipeRef.current = false
      setIsSwiping(false)
      cancelSwipeFrame()
      applySwipeOffset(0)
      updateSwipeDirection(0)
      updateSwipeActionActive(false)
      return
    }

    if (swipeResetTimerRef.current != null) {
      window.clearTimeout(swipeResetTimerRef.current)
      swipeResetTimerRef.current = null
    }
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    horizontalSwipeRef.current = false
    setSwipeStartedSelected(Boolean(isSelected))
    updateSwipeActionActive(false)
    updateSwipeDirection(0)
    cancelSwipeFrame()
    applySwipeOffset(0)
    setIsSwiping(true)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isTagScrollTarget(e.target)) return
    if (!touchStartRef.current) return
    const deltaX = e.touches[0].clientX - touchStartRef.current.x
    const deltaY = e.touches[0].clientY - touchStartRef.current.y

    // 如果主要是水平滑动
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
      horizontalSwipeRef.current = true
      e.preventDefault()
      // 限制滑动距离，例如最大 60px
      const boundedOffset = Math.max(-60, Math.min(60, deltaX))
      const nextDirection = boundedOffset > 0 ? 1 : boundedOffset < 0 ? -1 : 0
      const nextActionActive = Math.abs(deltaX) >= 40
      scheduleSwipeOffset(boundedOffset)
      updateSwipeDirection(nextDirection)
      updateSwipeActionActive(nextActionActive)
    }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (isTagScrollTarget(e.target)) {
      touchStartRef.current = null
      horizontalSwipeRef.current = false
      setIsSwiping(false)
      cancelSwipeFrame()
      updateSwipeDirection(0)
      updateSwipeActionActive(false)
      return
    }

    setIsSwiping(false)
    cancelSwipeFrame()
    updateSwipeDirection(0)

    if (!touchStartRef.current) return
    const deltaX = e.changedTouches[0].clientX - touchStartRef.current.x
    touchStartRef.current = null
    const isSwipeAction = horizontalSwipeRef.current && Math.abs(deltaX) > 40
    horizontalSwipeRef.current = false
    updateSwipeActionActive(isSwipeAction)
    swipeResetTimerRef.current = window.setTimeout(() => {
      updateSwipeActionActive(false)
      swipeResetTimerRef.current = null
    }, 220)

    // 如果是水平滑动，且垂直偏移较小，认为是滑动选择
    if (isSwipeAction) {
      suppressClickUntilRef.current = Date.now() + 350
      e.preventDefault()
      e.stopPropagation()
      toggleTaskSelection(task.id)
    }
  }

  const handleTouchCancel = () => {
    touchStartRef.current = null
    horizontalSwipeRef.current = false
    setIsSwiping(false)
    cancelSwipeFrame()
    updateSwipeDirection(0)
    updateSwipeActionActive(false)
  }

  useEffect(
    () => () => {
      if (swipeResetTimerRef.current != null) {
        window.clearTimeout(swipeResetTimerRef.current)
      }
      cancelSwipeFrame()
    },
    [],
  )

  useEffect(() => {
    if (!isSwiping) {
      applySwipeOffset(0)
    }
  }, [isSwiping])

  useEffect(() => {
    setStreamPreviewLoaded(false)
  }, [streamPreviewSrc, task.id])

  // 定时更新运行中任务的计时
  useEffect(() => {
    if (
      displayTaskStatus !== 'running' &&
      !(displayTaskStatus === 'error' && (task.falRecoverable || task.customRecoverable))
    )
      return
    const id = setInterval(() => setNow(Date.now()), 1000)
    setNow(Date.now())
    return () => clearInterval(id)
  }, [displayTaskStatus, task.customRecoverable, task.falRecoverable])

  // 加载缩略图
  useEffect(() => {
    setCoverRatio('')
    setCoverSize('')
    setThumbSrc('')

    let cancelled = false
    const imageId = task.outputImages?.[0]

    // 封面比例/分辨率徽章优先使用任务的实际参数（API 实际返回 / 按图实际参数），
    // 这是原图尺寸的权威来源；Electron 磁盘缩略图（thumbs/）解析出的是压缩后尺寸（最长边 ≤1024px），
    // 不能用来显示原图分辨率。任务无实际尺寸时回退到缩略图尺寸。
    const taskSize =
      (imageId ? task.actualParamsByImage?.[imageId]?.size : undefined) ??
      task.actualParams?.size ??
      (task.params.size !== 'auto' ? task.params.size : undefined)
    const [taskWidth, taskHeight] = taskSize ? taskSize.split('x').map(Number) : []
    if (taskWidth && taskHeight) {
      setCoverRatio(formatImageRatio(taskWidth, taskHeight))
      setCoverSize(`${taskWidth}×${taskHeight}`)
    }

    let unsubscribe: (() => void) | undefined

    const applyThumbnail = (thumbnail: { dataUrl: string; width?: number; height?: number }) => {
      if (cancelled) return
      setThumbSrc(thumbnail.dataUrl)
      if ((!taskWidth || !taskHeight) && thumbnail.width && thumbnail.height) {
        setCoverRatio(formatImageRatio(thumbnail.width, thumbnail.height))
        setCoverSize(`${thumbnail.width}×${thumbnail.height}`)
      }
    }

    const loadOriginalFallback = (imageId: string) => {
      void ensureImageCached(imageId)
        .then((dataUrl) => {
          if (cancelled) return
          if (dataUrl) {
            setThumbSrc((current) => current || dataUrl)
            return
          }
          // 全图也拿不到：确认图片记录是否已不存在（源文件丢失 = 图已删除），
          // 标记 lost 让封面显示「图片已丢失」而不是永远停留在加载占位。
          void getImage(imageId)
            .then((record) => {
              if (!cancelled && !record) setThumbLost(true)
            })
            .catch(() => {})
        })
        .catch(() => {
          if (!cancelled) {
            void getImage(imageId)
              .then((record) => {
                if (!cancelled && !record) setThumbLost(true)
              })
              .catch(() => {})
          }
        })
    }

    if (imageId) {
      unsubscribe = subscribeImageThumbnail(imageId, applyThumbnail)
      ensureImageThumbnailCached(imageId)
        .then((thumbnail) => {
          if (cancelled) return
          if (thumbnail) {
            applyThumbnail(thumbnail)
          } else {
            loadOriginalFallback(imageId)
          }
        })
        .catch(() => {
          if (!cancelled) loadOriginalFallback(imageId)
        })
    }

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [task.outputImages, task.actualParams, task.actualParamsByImage, task.params.size])

  const duration = (() => {
    let seconds: number
    if (displayTaskStatus === 'running' || task.falRecoverable || task.customRecoverable) {
      seconds = Math.floor((now - task.createdAt) / 1000)
    } else if (task.elapsed != null) {
      seconds = Math.floor(task.elapsed / 1000)
    } else {
      return '00:00'
    }
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
    const ss = String(seconds % 60).padStart(2, '0')
    return `${mm}:${ss}`
  })()
  const showSwipeAction = swipeActionActive
  const isFalReconnecting = displayTaskStatus === 'error' && task.falRecoverable
  const isCustomReconnecting = displayTaskStatus === 'error' && task.customRecoverable
  const hasPartialSuccess =
    displayTaskStatus === 'error' && (task.outputImages?.length ?? 0) > 0 && !isFalReconnecting && !isCustomReconnecting
  // 实时进度来自 runtimeStore（高频更新不重建 tasks 数组）；任务对象字段仅作兼容回退。
  const liveTaskProgress = useRuntimeStore((s) =>
    displayTaskStatus === 'running' || isFalReconnecting || isCustomReconnecting ? s.taskProgress[task.id] : undefined,
  )
  const progressDisplay = getTaskProgressDisplay(task, liveTaskProgress)
  const hasPartialFailure = progressDisplay.cardLabel === '数量不够'
  const showRunningTimer = displayTaskStatus === 'running' || isFalReconnecting || isCustomReconnecting
  const swipeBgClass = showSwipeAction
    ? swipeStartedSelected
      ? 'gallery-swipe-bg--neutral'
      : 'gallery-swipe-bg--primary'
    : 'gallery-swipe-bg--muted'

  const qualityDisplay = getParamDisplay(task, 'quality', undefined, task.isFavorite)
  const showQuality = task.params.quality !== 'auto' || qualityDisplay.isMismatch

  const sizeDisplay = getParamDisplay(task, 'size', undefined, task.isFavorite)
  const showSize = task.params.size !== 'auto' || sizeDisplay.isMismatch

  const formatDisplay = getParamDisplay(task, 'output_format', undefined, task.isFavorite)
  const showFormat = task.params.output_format !== 'png' || formatDisplay.isMismatch

  const nDisplay = getParamDisplay(task, 'n', undefined, task.isFavorite)
  const isAgentTask = task.sourceMode === 'agent' || Boolean(task.agentConversationId || task.agentRoundId)
  const showPendingPrompt = isAgentTaskPromptPending(task)
  const showN = !isAgentTask && (task.params.n > 1 || nDisplay.isMismatch)

  const defaultModelForProvider = task.apiProvider === 'fal' ? DEFAULT_FAL_MODEL : DEFAULT_IMAGES_MODEL
  const showModel = task.apiModel && task.apiModel !== defaultModelForProvider
  const isInterrupted = progressDisplay.cardLabel === '已停止'

  const [isEditingPrompt, setIsEditingPrompt] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState(task.prompt)

  const handlePromptEditSubmit = () => {
    if (editingPrompt !== task.prompt) {
      updateTaskPrompt(task.id, editingPrompt)
    }
    setIsEditingPrompt(false)
  }

  const handlePromptEditKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handlePromptEditSubmit()
    } else if (e.key === 'Escape') {
      setEditingPrompt(task.prompt)
      setIsEditingPrompt(false)
    }
  }

  return (
    <div className="gallery-card-shell relative rounded-ds-lg">
      {/* 侧滑底图 */}
      <div
        className={`absolute inset-0 rounded-ds-lg flex items-center transition-opacity duration-200 pointer-events-none ${
          isSwiping || swipeDirection !== 0 || swipeActionActive ? 'opacity-100' : 'opacity-0'
        } ${swipeBgClass} ${swipeDirection > 0 ? 'justify-start pl-6' : 'justify-end pr-6'}`}
      >
        <svg
          className={`w-ds-control-sm h-ds-control-sm transition-transform duration-150 ${showSwipeAction ? 'scale-110 text-white' : 'scale-90 text-white/60'}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          {swipeStartedSelected && showSwipeAction ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          )}
        </svg>
      </div>

      <Card
        ref={cardRef}
        className={`gallery-task-card relative overflow-hidden cursor-pointer touch-pan-y will-change-transform duration-200 ${
          isSwiping ? 'gallery-task-card--swiping' : ''
        } ${
          !isSwiping
            ? 'transition-[box-shadow,border-color,background-color,transform]'
            : 'transition-[box-shadow,border-color,background-color]'
        }`}
        onClick={(e) => {
          if (Date.now() < suppressClickUntilRef.current) {
            e.preventDefault()
            e.stopPropagation()
            return
          }
          onClick(e)
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        data-selected={isSelected || undefined}
        data-status={displayTaskStatus}
        data-sop-card={Boolean(task.sopBatch) || undefined}
      >
        {/* 选中时的角标 */}
        {isSelected && (
          <div className="gallery-selection-check absolute top-2 right-2 z-10 flex h-5 w-5 items-center justify-center">
            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
        <div className="flex h-44">
          {/* 左侧图片区域：整卡唯一可拖拽区域（拖动 = 把图片拖给 Agent/素材库）。
              卡片其余区域不 draggable，mousedown 拖拽交给框选（useDragSelect）。 */}
          <div
            className="gallery-task-media w-40 min-w-[10rem] h-full relative flex items-center justify-center overflow-hidden flex-shrink-0"
            draggable={displayTaskStatus === 'done' && task.outputImages?.length > 0}
            onDragStart={(e) => {
              if (displayTaskStatus !== 'done' || !task.outputImages?.length) return
              const imageIds = task.outputImages
              e.dataTransfer.setData('text/plain', `agent-images:${imageIds.join(',')}`)
              e.dataTransfer.effectAllowed = 'copy'
              // Optionally set drag image if we have thumbSrc
              if (thumbSrc) {
                const preview = document.createElement('div')
                preview.style.cssText =
                  'position:fixed;left:-1000px;top:-1000px;width:100px;height:100px;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.25);'
                const previewImg = document.createElement('img')
                previewImg.src = thumbSrc
                previewImg.style.cssText = 'width:100px;height:100px;object-fit:cover;display:block;'
                preview.appendChild(previewImg)
                document.body.appendChild(preview)
                e.dataTransfer.setDragImage(preview, 50, 50)
                setTimeout(() => preview.remove(), 0)
              }
            }}
          >
            {displayTaskStatus === 'running' && streamPreviewSrc && (
              <>
                <img
                  src={streamPreviewSrc}
                  className={`h-full w-full object-cover ${streamPreviewLoaded ? '' : 'hidden'}`}
                  alt=""
                  onLoad={() => setStreamPreviewLoaded(true)}
                  onError={() => setStreamPreviewLoaded(false)}
                />
                {streamPreviewLoaded && (
                  <span className="gallery-image-badge gallery-image-badge--info absolute top-1.5 right-1.5">预览</span>
                )}
              </>
            )}
            {displayTaskStatus === 'running' &&
              !streamPreviewSrc &&
              (task.outputImages?.length ?? 0) > 0 &&
              thumbSrc && (
                <>
                  <img
                    src={thumbSrc}
                    data-image-id={task.outputImages[0]}
                    data-output-image-ids={task.outputImages.join(',')}
                    className="saveable-image w-full h-full object-cover"
                    loading="lazy"
                    alt=""
                  />
                  {(task.outputImages?.length ?? 0) > 1 && (
                    <span className="absolute bottom-1 right-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                      {task.batchItemStatuses
                        ? `${task.batchItemStatuses.filter((s) => s === 'done').length}/${task.batchItemStatuses.length}`
                        : (task.outputImages?.length ?? 0)}
                    </span>
                  )}
                  {task.batchItemStatuses &&
                    task.batchItemStatuses.some((s) => s === 'error') &&
                    (task.outputImages?.length ?? 0) <= 1 && (
                      <span className="absolute bottom-1 right-1 bg-black/60 text-ds-warning text-xs px-1.5 py-0.5 rounded">
                        {task.batchItemStatuses.filter((s) => s === 'done').length}/{task.batchItemStatuses.length}
                      </span>
                    )}
                  <span className="gallery-image-badge gallery-image-badge--info absolute top-1.5 right-1.5">
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    {progressDisplay.cardLabel}
                  </span>
                </>
              )}
            {displayTaskStatus === 'running' &&
              !streamPreviewSrc &&
              !((task.outputImages?.length ?? 0) > 0 && thumbSrc) && (
                <div className="flex flex-col items-center gap-2">
                  <svg
                    className="gallery-state-icon gallery-state-icon--info w-ds-control-sm h-ds-control-sm animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="gallery-task-meta text-xs">{progressDisplay.cardLabel}</span>
                </div>
              )}
            {displayTaskStatus === 'error' && (isFalReconnecting || isCustomReconnecting) && (
              <div className="flex flex-col items-center gap-1 px-2">
                <svg
                  className="gallery-state-icon gallery-state-icon--warning w-ds-control-sm h-ds-control-sm"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                <span className="gallery-state-text gallery-state-text--warning text-xs text-center leading-tight">
                  {progressDisplay.cardLabel}
                </span>
              </div>
            )}
            {displayTaskStatus === 'error' && !isFalReconnecting && !isCustomReconnecting && !hasPartialSuccess && (
              <div className="flex flex-col items-center gap-1 px-2">
                <svg
                  className={`gallery-state-icon w-ds-control-sm h-ds-control-sm ${isInterrupted ? 'gallery-state-icon--warning' : 'gallery-state-icon--danger'}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span
                  className={`gallery-state-text text-xs text-center leading-tight ${isInterrupted ? 'gallery-state-text--warning' : 'gallery-state-text--danger'}`}
                >
                  {progressDisplay.cardLabel}
                </span>
              </div>
            )}
            {hasPartialSuccess && thumbSrc && (
              <>
                <img
                  src={thumbSrc}
                  data-image-id={task.outputImages[0]}
                  data-output-image-ids={task.outputImages.join(',')}
                  className="saveable-image w-full h-full object-cover"
                  loading="lazy"
                  alt=""
                />
                {(task.outputImages?.length ?? 0) > 1 && (
                  <span className="absolute bottom-1 right-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                    {task.batchItemStatuses
                      ? `${task.batchItemStatuses.filter((s) => s === 'done').length}/${task.batchItemStatuses.length}`
                      : (task.outputImages?.length ?? 0)}
                  </span>
                )}
                {hasPartialFailure && (
                  <span className="gallery-image-badge gallery-image-badge--warning absolute top-1.5 right-1.5">
                    {progressDisplay.cardLabel}
                  </span>
                )}
              </>
            )}
            {hasPartialSuccess && !thumbSrc && !thumbLost && (
              <svg
                className="gallery-placeholder-icon w-ds-control-sm h-ds-control-sm"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            )}
            {hasPartialSuccess && !thumbSrc && thumbLost && (
              <span className="flex flex-col items-center gap-1 px-2 text-center">
                <svg
                  className="gallery-placeholder-icon w-ds-control-sm h-ds-control-sm"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
                <span className="gallery-task-meta text-xs">图片已丢失</span>
              </span>
            )}
            {displayTaskStatus === 'done' && thumbSrc && (
              <>
                <img
                  src={thumbSrc}
                  data-image-id={task.outputImages[0]}
                  data-output-image-ids={task.outputImages.join(',')}
                  className="saveable-image w-full h-full object-cover"
                  loading="lazy"
                  alt=""
                />
                {!task.isFavorite && (task.outputImages?.length ?? 0) > 1 && (
                  <span className="absolute bottom-1 right-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                    {task.outputImages?.length ?? 0}
                  </span>
                )}
                {!task.isFavorite && hasPartialFailure && (
                  <span className="gallery-image-badge gallery-image-badge--warning absolute top-1.5 right-1.5">
                    {progressDisplay.cardLabel}
                  </span>
                )}
              </>
            )}
            {displayTaskStatus === 'done' && !thumbSrc && !thumbLost && (
              <svg
                className="gallery-placeholder-icon w-ds-control-sm h-ds-control-sm"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            )}
            {displayTaskStatus === 'done' && !thumbSrc && thumbLost && (
              <span className="flex flex-col items-center gap-1 px-2 text-center">
                <svg
                  className="gallery-placeholder-icon w-ds-control-sm h-ds-control-sm"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
                <span className="gallery-task-meta text-xs">图片已丢失</span>
              </span>
            )}
            {/* 运行中显示耗时，完成后显示封面图比例与分辨率标签 */}
            {!task.isFavorite && (
              <div className="absolute top-1.5 left-1.5 flex items-center gap-1">
                {showRunningTimer || displayTaskStatus !== 'done' || !coverRatio || !coverSize ? (
                  <span className="flex items-center gap-1 bg-black/50 text-white text-xs sm:text-xs px-1.5 py-0.5 rounded backdrop-blur-sm font-mono">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    {duration}
                  </span>
                ) : (
                  <>
                    <span className="bg-black/50 text-white text-xs sm:text-xs px-1.5 py-0.5 rounded backdrop-blur-sm font-mono">
                      {coverRatio}
                    </span>
                    <span className="bg-black/50 text-white/90 text-xs sm:text-xs px-1.5 py-0.5 rounded backdrop-blur-sm font-medium">
                      {coverSize}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* 右侧信息区域 */}
          <div className="gallery-task-body flex-1 p-3 flex flex-col min-w-0">
            {task.sopBatch && (
              <div className="gallery-sop-inline mb-2 flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-medium">SOP · {task.sopBatch.sopName}</span>
                <span className="shrink-0 tabular-nums">
                  {task.sopBatch.promptIndex}/{task.sopBatch.promptCount}
                </span>
              </div>
            )}
            <div className="flex-1 min-h-0 mb-2 overflow-hidden">
              {showPendingPrompt ? (
                <div className="leading-relaxed">
                  <p className="gallery-task-prompt text-sm">正在生成……</p>
                  <p className="gallery-task-meta mt-1 text-xs">输入内容将在响应完成时接收</p>
                </div>
              ) : task.isFavorite && isEditingPrompt ? (
                <PromptVariableEditor
                  value={editingPrompt}
                  onChange={setEditingPrompt}
                  onVariablePromptChange={(nextPrompt) => {
                    setEditingPrompt(nextPrompt)
                    updateTaskPrompt(task.id, nextPrompt)
                  }}
                  onKeyDown={handlePromptEditKeyDown}
                  onBlur={handlePromptEditSubmit}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                  selectOnFocus
                  spellCheck={false}
                  className="gallery-prompt-editor h-full min-h-[3rem] w-full overflow-y-auto p-1 text-sm leading-relaxed whitespace-pre-wrap break-words outline-none transition"
                />
              ) : (
                <div className="gallery-task-prompt text-sm leading-relaxed line-clamp-3 group/prompt relative cursor-default">
                  {task.prompt || '(无提示词)'}
                  {task.isFavorite && (
                    <div
                      className="gallery-prompt-edit-overlay absolute inset-0 opacity-0 group-hover/prompt:opacity-100 transition-opacity flex items-center justify-center rounded cursor-text"
                      onClick={(e) => {
                        e.stopPropagation()
                        setIsEditingPrompt(true)
                      }}
                    >
                      <span className="gallery-prompt-edit-pill px-2 py-1 rounded text-xs flex items-center gap-1 backdrop-blur-sm">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                          />
                        </svg>
                        点击编辑提示词
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="mt-auto flex flex-col gap-1.5">
              {/* 参数与信息：横向滚动 */}
              <div
                data-tag-scroll-area
                className="gallery-task-tags flex overflow-x-auto hide-scrollbar pt-0.5 gap-1.5 whitespace-nowrap mask-edge-r min-w-0 pr-2"
                onTouchStart={(e) => e.stopPropagation()}
                onTouchMove={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                onTouchCancel={(e) => e.stopPropagation()}
              >
                {/* API Name */}
                {!task.isFavorite && (task.apiProfileName || task.apiProvider) && (
                  <span
                    className="gallery-task-tag flex items-center gap-1 px-1.5 py-0.5 rounded text-xs flex-shrink-0"
                    title={task.apiProfileName || task.apiProvider}
                  >
                    <CodeIcon className="gallery-task-tag__icon w-3 h-3 flex-shrink-0" />
                    <span className="truncate max-w-[8rem]">{task.apiProfileName || task.apiProvider}</span>
                  </span>
                )}
                {/* Model */}
                {!task.isFavorite && showModel && (
                  <span
                    className="gallery-task-tag flex items-center gap-1 px-1.5 py-0.5 rounded text-xs flex-shrink-0"
                    title={task.apiModel}
                  >
                    <svg
                      className="gallery-task-tag__icon w-3 h-3 flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
                      />
                    </svg>
                    <span className="truncate max-w-[8rem]">{task.apiModel}</span>
                  </span>
                )}
                {/* Mask */}
                {!task.isFavorite && task.maskImageId && (
                  <span className="gallery-task-tag gallery-task-tag--primary flex items-center gap-1 px-1.5 py-0.5 rounded text-xs flex-shrink-0">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                      />
                    </svg>
                    局部重绘
                  </span>
                )}
                {/* Params: only show if not default or mismatch */}
                {showQuality && (
                  <span className="gallery-task-tag flex items-center gap-1 px-1.5 py-0.5 rounded text-xs flex-shrink-0">
                    <span className="gallery-task-tag__label">质量</span>
                    {qualityDisplay.isMismatch ? (
                      <ActualValueBadge value={qualityDisplay.displayValue} className="px-1 rounded-sm" />
                    ) : (
                      <span className="gallery-task-tag__value">{qualityDisplay.displayValue}</span>
                    )}
                  </span>
                )}
                {showSize && (
                  <span className="gallery-task-tag flex items-center gap-1 px-1.5 py-0.5 rounded text-xs flex-shrink-0">
                    <span className="gallery-task-tag__label">尺寸</span>
                    {sizeDisplay.isMismatch ? (
                      <ActualValueBadge value={sizeDisplay.displayValue} className="px-1 rounded-sm" />
                    ) : (
                      <span className="gallery-task-tag__value">{sizeDisplay.displayValue}</span>
                    )}
                  </span>
                )}
                {showFormat && (
                  <span className="gallery-task-tag flex items-center gap-1 px-1.5 py-0.5 rounded text-xs flex-shrink-0">
                    <span className="gallery-task-tag__label">格式</span>
                    {formatDisplay.isMismatch ? (
                      <ActualValueBadge value={formatDisplay.displayValue} className="px-1 rounded-sm" />
                    ) : (
                      <span className="gallery-task-tag__value">{formatDisplay.displayValue}</span>
                    )}
                  </span>
                )}
                {!task.isFavorite && showN && (
                  <span className="gallery-task-tag flex items-center gap-1 px-1.5 py-0.5 rounded text-xs flex-shrink-0">
                    <span className="gallery-task-tag__label">数量</span>
                    {hasPartialSuccess && task.batchItemStatuses ? (
                      <span className="gallery-task-tag__value">
                        {task.batchItemStatuses.filter((s) => s === 'done').length}
                        <span className="gallery-task-tag__label mx-0.5">/</span>
                        {task.batchItemStatuses.length}
                      </span>
                    ) : nDisplay.isMismatch ? (
                      <ActualValueBadge value={nDisplay.displayValue} className="px-1 rounded-sm" />
                    ) : (
                      <span className="gallery-task-tag__value">{nDisplay.displayValue}</span>
                    )}
                  </span>
                )}
              </div>
              {/* 操作按钮 */}
              <div
                data-tag-scroll-area
                className="gallery-task-actions flex items-center gap-1 flex-shrink-0 mt-0.5 ml-auto max-w-full overflow-x-auto hide-scrollbar mask-edge-r pr-2"
                onClick={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchMove={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                onTouchCancel={(e) => e.stopPropagation()}
              >
                {((displayTaskStatus === 'error' && !isFalReconnecting) || alwaysShowRetryButton) && (
                  <TaskActionButton
                    tooltip="重试任务"
                    onClick={() => retryTask(task)}
                    className="gallery-task-action gallery-task-action--primary"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                  </TaskActionButton>
                )}
                <TaskActionButton
                  tooltip={task.isFavorite ? '取消收藏' : '收藏任务'}
                  onClick={() => {
                    if (task.isFavorite) {
                      useStore.getState().setConfirmDialog({
                        title: '取消收藏',
                        message:
                          '确定要取消收藏吗？这会删除这个收藏卡片及其生成的图片，不可恢复；被其他任务/会话引用的图片会保留。',
                        action: () => {
                          removeMultipleTasks([task.id])
                        },
                      })
                    } else {
                      openFavoritePicker([task.id])
                    }
                  }}
                  className={`p-1.5 rounded-md transition ${
                    task.isFavorite
                      ? 'gallery-task-action gallery-task-action--warning'
                      : 'gallery-task-action gallery-task-action--neutral'
                  }`}
                >
                  {task.isFavorite ? (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                      />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                      />
                    </svg>
                  )}
                </TaskActionButton>
                <TaskActionButton
                  tooltip="复用配置"
                  onClick={onReuse}
                  className="gallery-task-action gallery-task-action--primary"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
                    />
                  </svg>
                </TaskActionButton>
                <TaskActionButton
                  tooltip="编辑输出"
                  onClick={onEditOutputs}
                  className="gallery-task-action gallery-task-action--success disabled:opacity-30"
                  disabled={!task.outputImages?.length}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                    />
                  </svg>
                </TaskActionButton>
                <TaskActionButton
                  tooltip="删除任务"
                  onClick={onDelete}
                  className="gallery-task-action gallery-task-action--danger"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </TaskActionButton>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

export default memo(
  TaskCard,
  (prev, next) =>
    prev.task === next.task && prev.isSelected === next.isSelected && prev.disableSwipe === next.disableSwipe,
)
