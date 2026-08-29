import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ScheduleItem, ScheduleRow, TaskRecord } from '../types'
import {
  ALL_FAVORITES_COLLECTION_ID,
  DEFAULT_FAVORITE_COLLECTION_ID,
  ensureImageThumbnailCached,
  getTaskFavoriteCollectionIds,
  subscribeImageThumbnail,
  useStore,
} from '../store'
import {
  formatDateKey,
  getWeekDates,
  getWeekStartDate,
  parseDateKey,
  resolveScheduleSourceCollectionId,
} from '../lib/schedule'
import { checkPathExists, selectLocalSaveDirectory } from '../lib/localSave'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { useDialogFocusTrap } from '../design-system'
import { CloseIcon, FolderOpenIcon, PlusIcon, TrashIcon } from './icons'

const DAY_LABELS = [
  '\u5468\u4e00',
  '\u5468\u4e8c',
  '\u5468\u4e09',
  '\u5468\u56db',
  '\u5468\u4e94',
  '\u5468\u516d',
  '\u5468\u65e5',
]
const DRAG_TYPE = 'application/x-schedule-favorite-task'
const SCHEDULE_DROP_CELL_SELECTOR = '[data-schedule-drop-cell="true"]'

type ScheduleDragPayload = {
  taskId?: string
  collectionId?: string | null
  scheduleItemId?: string
}

function getTaskTitle(task: TaskRecord) {
  return task.prompt.trim().split(/\r?\n/)[0]?.slice(0, 48) || '\u672a\u547d\u540d\u4efb\u52a1'
}

function addDays(dateKey: string, days: number) {
  const date = parseDateKey(dateKey)
  date.setDate(date.getDate() + days)
  return formatDateKey(date)
}

function getDropCellFromPoint(event: React.DragEvent, fallback: { date: string; rowId: string }) {
  const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null
  const cell = target?.closest<HTMLElement>(SCHEDULE_DROP_CELL_SELECTOR)
  return {
    date: cell?.dataset.scheduleDate || fallback.date,
    rowId: cell?.dataset.scheduleRow || fallback.rowId,
  }
}

function getScheduleStatusLabel(status: ScheduleItem['status']) {
  switch (status) {
    case 'queued':
      return '\u6392\u961f\u4e2d'
    case 'running':
      return '\u6267\u884c\u4e2d'
    case 'done':
      return '\u5df2\u5b8c\u6210'
    case 'error':
      return '\u5931\u8d25'
    default:
      return '\u5f85\u6267\u884c'
  }
}

export default function ScheduleModal() {
  const open = useStore((s) => s.schedule.modalOpen)
  const schedule = useStore((s) => s.schedule)
  const tasks = useStore((s) => s.tasks)
  const collections = useStore((s) => s.favoriteCollections)
  const defaultFavoriteCollectionId = useStore((s) => s.defaultFavoriteCollectionId)
  const setScheduleModalOpen = useStore((s) => s.setScheduleModalOpen)
  const setScheduleWeekStart = useStore((s) => s.setScheduleWeekStart)
  const startScheduleWeek = useStore((s) => s.startScheduleWeek)
  const stopScheduleWeek = useStore((s) => s.stopScheduleWeek)
  const copyPreviousWeekSchedule = useStore((s) => s.copyPreviousWeekSchedule)
  const addScheduleRow = useStore((s) => s.addScheduleRow)
  const updateScheduleRow = useStore((s) => s.updateScheduleRow)
  const removeScheduleRow = useStore((s) => s.removeScheduleRow)
  const addScheduleItem = useStore((s) => s.addScheduleItem)
  const updateScheduleItem = useStore((s) => s.updateScheduleItem)
  const removeScheduleItem = useStore((s) => s.removeScheduleItem)
  const runScheduleItem = useStore((s) => s.runScheduleItem)
  const updateTaskFavoriteOutputPath = useStore((s) => s.updateTaskFavoriteOutputPath)
  const updateTaskFavoriteOutputDateVariable = useStore((s) => s.updateTaskFavoriteOutputDateVariable)
  const setDetailTaskId = useStore((s) => s.setDetailTaskId)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const showToast = useStore((s) => s.showToast)
  const modalRef = useRef<HTMLDivElement>(null)
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>(ALL_FAVORITES_COLLECTION_ID)
  const [dragOverCell, setDragOverCell] = useState<string | null>(null)

  useCloseOnEscape(open, () => setScheduleModalOpen(false))
  usePreventBackgroundScroll(open, modalRef)
  useDialogFocusTrap(open, modalRef)

  const favoriteTasks = useMemo(() => tasks.filter((task) => task.isFavorite), [tasks])
  const filteredTasks = useMemo(() => {
    if (selectedCollectionId === ALL_FAVORITES_COLLECTION_ID) return favoriteTasks
    return favoriteTasks.filter((task) => getTaskFavoriteCollectionIds(task).includes(selectedCollectionId))
  }, [favoriteTasks, selectedCollectionId])
  const weekDates = useMemo(() => getWeekDates(schedule.activeWeekStart), [schedule.activeWeekStart])
  const sortedRows = useMemo(() => [...schedule.rows].sort((a, b) => a.order - b.order), [schedule.rows])
  const currentWeekStart = formatDateKey(getWeekStartDate())
  const activeWeekEnd = formatDateKey(weekDates[6])
  const todayItems = useMemo(
    () => schedule.items.filter((item) => item.date >= schedule.activeWeekStart && item.date <= activeWeekEnd),
    [activeWeekEnd, schedule.activeWeekStart, schedule.items],
  )
  const todayRunning = schedule.runningWeekStarts.includes(schedule.activeWeekStart)
  const todayStatusText = todayRunning
    ? `\u672c\u5468\u4efb\u52a1\u5df2\u542f\u52a8\uff1a${todayItems.filter((item) => item.status === 'done').length}/${todayItems.length} \u5df2\u5b8c\u6210`
    : '\u672c\u5468\u4efb\u52a1\u672a\u542f\u52a8'

  if (!open) return null

  const getCollectionName = (id: string | null | undefined) => {
    if (!id || id === ALL_FAVORITES_COLLECTION_ID) return '\u5168\u90e8\u6536\u85cf'
    return collections.find((collection) => collection.id === id)?.name ?? '\u6536\u85cf\u5939'
  }

  const getCellItems = (dateKey: string, rowId: string) =>
    schedule.items.filter((item) => item.date === dateKey && item.rowId === rowId).sort((a, b) => a.order - b.order)

  const handleDragOverCell = (event: React.DragEvent, date: string, rowId: string) => {
    event.preventDefault()
    const cell = getDropCellFromPoint(event, { date, rowId })
    event.dataTransfer.dropEffect = event.dataTransfer.effectAllowed === 'copy' ? 'copy' : 'move'
    setDragOverCell(`${cell.date}:${cell.rowId}`)
  }

  const handleDragLeaveCell = (event: React.DragEvent) => {
    const nextTarget = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null
    if (!nextTarget?.closest(SCHEDULE_DROP_CELL_SELECTOR)) setDragOverCell(null)
  }

  const handleDrop = (event: React.DragEvent, date: string, rowId: string) => {
    event.preventDefault()
    setDragOverCell(null)
    const raw = event.dataTransfer.getData(DRAG_TYPE)
    if (!raw) return
    try {
      const cell = getDropCellFromPoint(event, { date, rowId })
      const payload = JSON.parse(raw) as ScheduleDragPayload
      if (payload.scheduleItemId) {
        const movingItem = schedule.items.find((item) => item.id === payload.scheduleItemId)
        if (!movingItem) return
        if (movingItem.date === cell.date && movingItem.rowId === cell.rowId) return
        const targetItems = schedule.items.filter(
          (item) => item.id !== movingItem.id && item.date === cell.date && item.rowId === cell.rowId,
        )
        const order = targetItems.reduce((max, item) => Math.max(max, item.order), -1) + 1
        updateScheduleItem(movingItem.id, {
          date: cell.date,
          rowId: cell.rowId,
          order,
          status: 'idle',
          lastRunKey: undefined,
          lastTaskIds: undefined,
          lastError: undefined,
        })
        showToast(`已移动到 ${cell.date.slice(5)}`, 'success')
        return
      }
      if (!payload.taskId) return
      const task = favoriteTasks.find((item) => item.id === payload.taskId)
      if (!task) {
        showToast('\u6536\u85cf\u4efb\u52a1\u4e0d\u5b58\u5728', 'error')
        return
      }
      const taskCollectionIds = getTaskFavoriteCollectionIds(task)
      const collectionId = resolveScheduleSourceCollectionId({
        selectedCollectionId: payload.collectionId ?? null,
        allFavoritesCollectionId: ALL_FAVORITES_COLLECTION_ID,
        taskCollectionIds,
        defaultCollectionId: defaultFavoriteCollectionId ?? DEFAULT_FAVORITE_COLLECTION_ID,
      })
      addScheduleItem({
        taskId: task.id,
        collectionId,
        date: cell.date,
        rowId: cell.rowId,
        count: task.params.n || 1,
        time: null,
      })
      const rowName = schedule.rows.find((row) => row.id === cell.rowId)?.name ?? '未命名任务行'
      showToast(`已添加到 ${cell.date.slice(5)} 的 ${rowName}`, 'success')
    } catch {
      showToast('\u65e0\u6cd5\u8bfb\u53d6\u62d6\u62fd\u4efb\u52a1', 'error')
    }
  }

  const handlePickOutputPath = async (task: TaskRecord) => {
    try {
      const dir = await selectLocalSaveDirectory()
      if (dir) updateTaskFavoriteOutputPath(task.id, dir)
    } catch {
      showToast('选择输出文件夹失败，请重试', 'error')
    }
  }

  const handleValidateOutputPath = async (path: string) => {
    const trimmed = path.trim()
    if (!trimmed) return
    try {
      const exists = await checkPathExists(trimmed)
      if (exists === null) return
      showToast(exists ? '输出目录可用' : '输出目录不存在，保存时可能失败', exists ? 'success' : 'error')
    } catch {
      showToast('无法检查输出目录', 'error')
    }
  }

  const toggleScheduleWeek = () => {
    if (!todayRunning) {
      startScheduleWeek(schedule.activeWeekStart)
      return
    }
    setConfirmDialog({
      title: '停止本周日程',
      message: '停止后不会再触发本周未开始的日程项。已经提交到 API 的生成任务不会被取消。',
      confirmText: '停止日程',
      cancelText: '继续运行',
      tone: 'warning',
      action: () => stopScheduleWeek(schedule.activeWeekStart),
    })
  }

  const handleRemoveRow = (row: ScheduleRow) => {
    const itemCount = schedule.items.filter((item) => item.rowId === row.id).length
    setConfirmDialog({
      title: '删除任务行',
      message:
        itemCount > 0
          ? `确定删除「${row.name}」吗？这一行中的 ${itemCount} 个日程项也会一起删除。`
          : `确定删除「${row.name}」吗？`,
      confirmText: '删除',
      cancelText: '取消',
      tone: 'danger',
      action: () => {
        removeScheduleRow(row.id)
        showToast('任务行已删除', 'success')
      },
    })
  }

  const handleRunNow = async (item: ScheduleItem) => {
    const taskId = await runScheduleItem(item.id)
    showToast(taskId ? '日程任务已提交' : '日程任务未提交', taskId ? 'success' : 'error')
  }

  const openTaskDetail = (taskId: string | null | undefined) => {
    if (!taskId || !tasks.some((task) => task.id === taskId)) {
      showToast('\u6536\u85cf\u4efb\u52a1\u4e0d\u5b58\u5728', 'error')
      return
    }
    setScheduleModalOpen(false)
    setDetailTaskId(taskId, { returnToSchedule: true })
  }

  return createPortal(
    <div
      className="ds-modal-layer fixed inset-0 flex items-center justify-center p-3"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setScheduleModalOpen(false)
      }}
    >
      <div className="ds-modal-scrim pointer-events-none absolute inset-0" />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-dialog-title"
        className="ds-modal-surface relative z-10 flex h-[88vh] w-[min(1280px,96vw)] flex-col overflow-hidden rounded-ds-lg border text-ds-text"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-ds-border px-4 py-3">
          <div className="min-w-0">
            <h2 id="schedule-dialog-title" className="text-base font-semibold">
              {'\u65e5\u7a0b\u8868'}
            </h2>
            <p className="text-xs text-ds-muted">
              {schedule.activeWeekStart} - {activeWeekEnd}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden text-xs text-ds-muted md:block">{todayStatusText}</div>
            <button
              type="button"
              onClick={toggleScheduleWeek}
              className={`rounded-md border px-3 py-1.5 text-xs ${todayRunning ? 'border-ds-danger/30 text-ds-danger hover:bg-ds-danger/10' : 'border-ds-primary/30 text-ds-primary hover:bg-ds-primary/10 dark:text-ds-primary'}`}
            >
              {todayRunning ? '\u505c\u6b62\u4efb\u52a1' : '\u542f\u52a8\u4efb\u52a1'}
            </button>
            <button
              type="button"
              onClick={() => setScheduleWeekStart(addDays(schedule.activeWeekStart, -7))}
              className="rounded-md border border-ds-border px-3 py-1.5 text-xs hover:bg-ds-subtle"
            >
              {'\u4e0a\u4e00\u5468'}
            </button>
            <button
              type="button"
              onClick={() => setScheduleWeekStart(currentWeekStart)}
              className="rounded-md border border-ds-border px-3 py-1.5 text-xs hover:bg-ds-subtle"
            >
              {'本周'}
            </button>
            <button
              type="button"
              onClick={() => {
                const copiedIds = copyPreviousWeekSchedule()
                showToast(
                  copiedIds.length > 0
                    ? `\u5df2\u590d\u7528\u4e0a\u5468 ${copiedIds.length} \u4e2a\u4efb\u52a1`
                    : '\u4e0a\u5468\u6ca1\u6709\u53ef\u590d\u7528\u7684\u4efb\u52a1',
                  copiedIds.length > 0 ? 'success' : 'info',
                )
              }}
              className="rounded-md border border-ds-border px-3 py-1.5 text-xs hover:bg-ds-subtle"
            >
              {'\u590d\u7528\u4e0a\u5468'}
            </button>
            <button
              type="button"
              onClick={() => setScheduleWeekStart(addDays(schedule.activeWeekStart, 7))}
              className="rounded-md border border-ds-border px-3 py-1.5 text-xs hover:bg-ds-subtle"
            >
              {'\u4e0b\u4e00\u5468'}
            </button>
            <button
              type="button"
              onClick={() => setScheduleModalOpen(false)}
              className="rounded-md p-2 text-ds-muted hover:bg-ds-subtle hover:text-ds-text"
              aria-label="关闭日程表"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="border-b border-ds-border px-4 py-2 text-xs text-ds-muted md:hidden">{todayStatusText}</div>

        <div className="min-h-0 flex-1 overflow-auto custom-scrollbar p-3">
          <div className="min-w-[980px] overflow-hidden rounded-lg border border-ds-border">
            <div className="grid grid-cols-[128px_repeat(7,minmax(120px,1fr))] bg-ds-subtle/60 text-xs font-medium">
              <div className="border-r border-ds-border px-3 py-2">{'\u4efb\u52a1\u5217\u8868'}</div>
              {weekDates.map((date, index) => (
                <div key={formatDateKey(date)} className="border-r border-ds-border px-3 py-2 last:border-r-0">
                  <div>{DAY_LABELS[index]}</div>
                  <div className="mt-0.5 text-xs font-normal text-ds-muted">{formatDateKey(date).slice(5)}</div>
                </div>
              ))}
            </div>
            {sortedRows.map((row) => (
              <div
                key={row.id}
                className="grid min-h-[88px] grid-cols-[128px_repeat(7,minmax(120px,1fr))] border-t border-ds-border"
              >
                <ScheduleRowHeader
                  row={row}
                  canRemove={sortedRows.length > 1}
                  onRename={(name) => updateScheduleRow(row.id, name)}
                  onRemove={() => handleRemoveRow(row)}
                />
                {weekDates.map((date) => {
                  const dateKey = formatDateKey(date)
                  const cellKey = `${dateKey}:${row.id}`
                  const items = getCellItems(dateKey, row.id)
                  return (
                    <div
                      key={cellKey}
                      data-schedule-drop-cell="true"
                      data-schedule-date={dateKey}
                      data-schedule-row={row.id}
                      onDragOver={(event) => handleDragOverCell(event, dateKey, row.id)}
                      onDragLeave={handleDragLeaveCell}
                      onDrop={(event) => handleDrop(event, dateKey, row.id)}
                      className={`min-h-[88px] border-r border-ds-border p-1.5 last:border-r-0 ${dragOverCell === cellKey ? 'bg-ds-primary/10 ring-1 ring-inset ring-ds-focus/40' : 'bg-ds-canvas'}`}
                    >
                      <div className="space-y-1.5">
                        {items.map((item) => (
                          <ScheduleCellItem
                            key={item.id}
                            item={item}
                            task={tasks.find((task) => task.id === item.taskId)}
                            collectionName={getCollectionName(item.collectionId)}
                            onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = 'move'
                              event.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ scheduleItemId: item.id }))
                            }}
                            onDragEnd={() => setDragOverCell(null)}
                            onUpdate={(patch) => updateScheduleItem(item.id, patch)}
                            onRemove={() => {
                              removeScheduleItem(item.id)
                              showToast('日程项已移除', 'success')
                            }}
                            onRunNow={() => void handleRunNow(item)}
                            onOpenEdit={() => openTaskDetail(item.taskId)}
                          />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              addScheduleRow()
              showToast('已添加任务行', 'success')
            }}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-ds-border px-3 py-1.5 text-xs hover:bg-ds-subtle"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            {'\u6dfb\u52a0\u4efb\u52a1\u884c'}
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col border-t border-ds-border bg-ds-subtle/20 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">{'\u6536\u85cf\u4efb\u52a1\u5361'}</div>
            <select
              value={selectedCollectionId}
              onChange={(event) => setSelectedCollectionId(event.target.value)}
              className="h-ds-control-sm rounded-md border border-ds-border bg-ds-canvas px-2 text-xs outline-none"
            >
              <option value={ALL_FAVORITES_COLLECTION_ID}>{'\u5168\u90e8\u6536\u85cf'}</option>
              {collections.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 content-start items-start gap-2 overflow-y-auto custom-scrollbar pr-1 sm:grid-cols-2 lg:grid-cols-3">
            {filteredTasks.map((task) => {
              const sourceCollectionId = resolveScheduleSourceCollectionId({
                selectedCollectionId,
                allFavoritesCollectionId: ALL_FAVORITES_COLLECTION_ID,
                taskCollectionIds: getTaskFavoriteCollectionIds(task),
                defaultCollectionId: defaultFavoriteCollectionId ?? DEFAULT_FAVORITE_COLLECTION_ID,
              })
              return (
                <div
                  key={task.id}
                  data-schedule-favorite-card="true"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'copy'
                    event.dataTransfer.setData(
                      DRAG_TYPE,
                      JSON.stringify({ taskId: task.id, collectionId: sourceCollectionId }),
                    )
                  }}
                  onDragEnd={() => setDragOverCell(null)}
                  onDoubleClick={() => openTaskDetail(task.id)}
                  className="grid min-h-[72px] cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-2 rounded-lg border border-ds-border bg-ds-canvas p-2 text-xs shadow-sm"
                >
                  <ScheduleTaskPreview task={task} />
                  <div className="grid min-w-0 grid-rows-[auto_auto_auto] gap-1.5">
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <div className="min-w-0 truncate font-medium" title={task.prompt}>
                        {getTaskTitle(task)}
                      </div>
                      <span className="shrink-0 rounded bg-ds-warning/10 px-1.5 py-0.5 text-xs text-ds-warning dark:text-ds-warning">
                        {task.params.n} {'\u5f20'}
                      </span>
                    </div>
                    <div className="flex min-w-0 items-center justify-between gap-2 text-xs text-ds-muted">
                      <div className="min-w-0 truncate">{getCollectionName(sourceCollectionId)}</div>
                      <label
                        className="flex shrink-0 items-center gap-1.5"
                        onDoubleClick={(event) => event.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(task.favoriteOutputUseDateVariable)}
                          onChange={(event) => updateTaskFavoriteOutputDateVariable(task.id, event.target.checked)}
                          className="h-3.5 w-3.5 rounded border-ds-border"
                        />
                        <span>{'\u65e5\u671f\u53d8\u91cf'}</span>
                      </label>
                    </div>
                    <div className="flex items-center gap-1">
                      <input
                        value={task.favoriteOutputPath ?? ''}
                        onChange={(event) => updateTaskFavoriteOutputPath(task.id, event.target.value)}
                        onBlur={(event) => void handleValidateOutputPath(event.target.value)}
                        onDoubleClick={(event) => event.stopPropagation()}
                        placeholder="输出地址，留空按收藏夹"
                        className="min-w-0 flex-1 rounded-md border border-ds-border bg-ds-canvas px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ds-focus/40"
                      />
                      <button
                        type="button"
                        onClick={() => void handlePickOutputPath(task)}
                        onDoubleClick={(event) => event.stopPropagation()}
                        className="rounded-md border border-ds-border p-1.5 hover:bg-ds-subtle"
                        title="\u9009\u62e9\u6587\u4ef6\u5939"
                      >
                        <FolderOpenIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
            {filteredTasks.length === 0 && (
              <div className="col-span-full rounded-lg border border-dashed border-ds-border p-4 text-center text-xs text-ds-muted">
                {'\u6682\u65e0\u6536\u85cf\u4efb\u52a1'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function ScheduleRowHeader({
  row,
  canRemove,
  onRename,
  onRemove,
}: {
  row: ScheduleRow
  canRemove: boolean
  onRename: (name: string) => void
  onRemove: () => void
}) {
  const [draftName, setDraftName] = useState(row.name)

  useEffect(() => {
    setDraftName(row.name)
  }, [row.name])

  const commitName = () => {
    const nextName = draftName.trim()
    if (!nextName) {
      setDraftName(row.name)
      return
    }
    if (nextName !== row.name) onRename(nextName)
  }

  return (
    <div className="flex min-w-0 items-start gap-1 border-r border-ds-border bg-ds-subtle/30 px-2 py-2 text-xs font-medium">
      <input
        value={draftName}
        onChange={(event) => setDraftName(event.target.value)}
        onBlur={commitName}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraftName(row.name)
            event.currentTarget.blur()
          }
        }}
        className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 outline-none hover:border-ds-border focus:border-ds-primary/40 focus:bg-ds-canvas"
        title="任务行名称"
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        className="shrink-0 rounded p-1 text-ds-muted hover:bg-ds-danger/10 hover:text-ds-danger disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ds-muted"
        title={canRemove ? '删除任务行' : '至少保留一行'}
      >
        <TrashIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function ScheduleTaskPreview({ task }: { task: TaskRecord }) {
  const [thumbSrc, setThumbSrc] = useState('')
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null)
  const imageId = task.outputImages?.[0]

  useEffect(() => {
    setThumbSrc('')
    if (!imageId) return

    let cancelled = false
    const applyThumbnail = (thumbnail: { dataUrl: string }) => {
      if (!cancelled) setThumbSrc(thumbnail.dataUrl)
    }
    const unsubscribe = subscribeImageThumbnail(imageId, applyThumbnail)
    ensureImageThumbnailCached(imageId)
      .then((thumbnail) => {
        if (thumbnail) applyThumbnail(thumbnail)
      })
      .catch(() => {
        if (!cancelled) setThumbSrc('')
      })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [imageId])

  const previewSize = 220
  const previewLeft = hoverPoint ? Math.min(hoverPoint.x + 14, window.innerWidth - previewSize - 12) : 0
  const previewTop = hoverPoint ? Math.min(hoverPoint.y + 14, window.innerHeight - previewSize - 12) : 0

  return (
    <>
      <div
        className="h-[74px] w-[74px] shrink-0 overflow-hidden rounded-md border border-ds-border bg-ds-subtle"
        onMouseEnter={(event) => thumbSrc && setHoverPoint({ x: event.clientX, y: event.clientY })}
        onMouseMove={(event) => thumbSrc && setHoverPoint({ x: event.clientX, y: event.clientY })}
        onMouseLeave={() => setHoverPoint(null)}
      >
        {thumbSrc ? <img src={thumbSrc} alt="" className="h-full w-full object-cover" draggable={false} /> : null}
      </div>
      {thumbSrc &&
        hoverPoint &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[var(--ds-z-tooltip)] overflow-hidden rounded-lg border border-white/30 bg-ds-canvas p-1 shadow-2xl ring-1 ring-black/10"
            style={{ left: previewLeft, top: previewTop, width: previewSize, height: previewSize }}
          >
            <img src={thumbSrc} alt="" className="h-full w-full rounded-md object-contain" />
          </div>,
          document.body,
        )}
    </>
  )
}

function ScheduleCellItem({
  item,
  task,
  collectionName,
  onDragStart,
  onDragEnd,
  onUpdate,
  onRemove,
  onRunNow,
  onOpenEdit,
}: {
  item: ScheduleItem
  task?: TaskRecord
  collectionName: string
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  onUpdate: (patch: Partial<Omit<ScheduleItem, 'id'>>) => void
  onRemove: () => void
  onRunNow: () => void
  onOpenEdit: () => void
}) {
  return (
    <div
      data-schedule-cell-card="true"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDoubleClick={onOpenEdit}
      className="cursor-move rounded-md border border-ds-primary/30 bg-ds-primary/10 p-1.5 text-xs"
    >
      <div className="mb-1 flex items-start justify-between gap-1">
        <div className="min-w-0">
          <div className="truncate font-medium" title={task?.prompt}>
            {task ? getTaskTitle(task) : '\u4efb\u52a1\u4e0d\u5b58\u5728'}
          </div>
          <div className="truncate text-xs text-ds-muted">
            {collectionName} - {getScheduleStatusLabel(item.status)}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onRunNow}
            onDoubleClick={(event) => event.stopPropagation()}
            className="rounded px-1.5 py-0.5 text-xs text-ds-primary hover:bg-ds-primary/10 dark:text-ds-primary"
            title="立即运行"
          >
            运行
          </button>
          <button
            type="button"
            onClick={onRemove}
            onDoubleClick={(event) => event.stopPropagation()}
            className="rounded p-0.5 text-ds-muted hover:bg-ds-danger/10 hover:text-ds-danger"
            title="\u79fb\u9664"
          >
            <TrashIcon className="h-3 w-3" />
          </button>
        </div>
      </div>
      {item.lastError && (
        <div
          className="mb-1 max-h-8 overflow-hidden rounded bg-ds-danger/10 px-1.5 py-1 text-xs text-ds-danger dark:text-ds-danger"
          title={item.lastError}
        >
          {item.lastError}
        </div>
      )}
      <div className="grid grid-cols-2 gap-1">
        <input
          type="number"
          min={1}
          value={item.count}
          onChange={(event) => onUpdate({ count: Number(event.target.value) || 1 })}
          onDoubleClick={(event) => event.stopPropagation()}
          className="h-6 rounded border border-ds-border bg-ds-canvas px-1 text-xs outline-none"
          title="\u6570\u91cf"
        />
        <input
          type="time"
          value={item.time ?? ''}
          onChange={(event) => onUpdate({ time: event.target.value || null })}
          onDoubleClick={(event) => event.stopPropagation()}
          className="h-6 rounded border border-ds-border bg-ds-canvas px-1 text-xs outline-none"
          title="\u6267\u884c\u65f6\u95f4"
        />
      </div>
    </div>
  )
}
