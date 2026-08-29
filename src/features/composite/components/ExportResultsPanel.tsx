import { useMemo, useRef, useState } from 'react'
import type {
  CompositeV2ExportStatus,
  CompositeV2FailureItem,
  CompositeV2HistoryRecord,
  CompositeV2SuccessItem,
} from '../lib/compositeV2Types'
import { useCompositeV2Store } from '../storeV2'
import { useStore } from '../../../store'
import { runDistribution } from '../lib/compositeDistribution'
import { useAppDialog } from '../../../hooks/useAppDialog'
import { ExportHistoryDetailModal } from './ExportHistoryDetailModal'
import { TrashIcon } from '../../../design-system/icons'

type ExportResultsPanelProps = {
  status: CompositeV2ExportStatus
  completed: number
  total: number
  history: CompositeV2HistoryRecord[]
  successes: CompositeV2SuccessItem[]
  failures: CompositeV2FailureItem[]
  distributionStatus: 'idle' | 'running' | 'completed' | 'failed' | 'canceled'
  distributionCompleted: number
  distributionTotal: number
  distributionSuccesses: import('../lib/compositeV2Types').CompositeV2DistributionSuccessItem[]
  distributionFailures: import('../lib/compositeV2Types').CompositeV2DistributionFailureItem[]
  /** 失败任务单张重试入口（由 BatchExportTab 提供） */
  onRetryTask?: (task: import('../lib/compositeV2Types').CompositeV2ExportTask) => void
}

const STATUS_LABELS: Record<CompositeV2ExportStatus, string> = {
  idle: '待开始',
  running: '导出中',
  paused: '已暂停',
  canceling: '正在取消',
  completed: '已完成',
  canceled: '已取消',
  failed: '失败',
}

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString()
}

function StatCell({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'success' | 'danger' }) {
  return (
    <div className="min-w-0 rounded-md bg-ds-surface px-2 py-1.5 dark:bg-ds-surface">
      <div className="truncate text-xs text-ds-muted dark:text-ds-muted">{label}</div>
      <div
        className={`mt-0.5 truncate text-sm font-medium ${
          tone === 'success'
            ? 'text-ds-success dark:text-ds-success'
            : tone === 'danger'
              ? 'text-ds-danger dark:text-ds-danger'
              : 'text-ds-text dark:text-ds-text-subtle'
        }`}
      >
        {value}
      </div>
    </div>
  )
}

export function ExportResultsPanel({
  status,
  completed,
  total,
  history,
  successes,
  failures,
  distributionStatus,
  distributionCompleted,
  distributionTotal,
  distributionSuccesses,
  distributionFailures,
  onRetryTask,
}: ExportResultsPanelProps) {
  const { openConfirmDialog, openInfoDialog } = useAppDialog()
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0
  const distProgress = distributionTotal > 0 ? Math.round((distributionCompleted / distributionTotal) * 100) : 0
  const historyRetention = useCompositeV2Store((state) => state.historyRetention)
  const setHistoryRetention = useCompositeV2Store((state) => state.setHistoryRetention)
  const updateHistoryRecord = useCompositeV2Store((state) => state.updateHistoryRecord)
  const removeHistoryRecord = useCompositeV2Store((state) => state.removeHistoryRecord)
  const clearHistory = useCompositeV2Store((state) => state.clearHistory)
  const distributionConfig = useCompositeV2Store((state) => state.distributionConfig)
  const presets = useCompositeV2Store((state) => state.presets)
  const exportTasks = useCompositeV2Store((state) => state.exportTasks)

  // 顶部 Tab：导出 / 分配
  const [activeTab, setActiveTab] = useState<'export' | 'distribution'>('export')
  // 导出记录筛选：全部 / 已分配 / 仅导出
  const [recordFilter, setRecordFilter] = useState<'all' | 'distributed' | 'not-distributed'>('all')
  // 按预设组分组的折叠状态
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  // 历史记录详情弹窗（溯源：导出位置 / 分配位置 / 失败原因）
  const [detailRecord, setDetailRecord] = useState<CompositeV2HistoryRecord | null>(null)
  // 重新分配任务的取消标记（仅针对历史记录重新分配这一条独立流程）
  const distributeCancelRef = useRef(false)

  const filteredHistory = useMemo(
    () =>
      history.filter((record) =>
        recordFilter === 'all'
          ? true
          : recordFilter === 'distributed'
            ? Boolean(record.distributionStatus)
            : !record.distributionStatus,
      ),
    [history, recordFilter],
  )

  // 按预设组名分组（保序，组内保持时间倒序）
  const groupedHistory = useMemo(() => {
    const map = new Map<string, CompositeV2HistoryRecord[]>()
    for (const record of filteredHistory) {
      const key = record.presetGroupName || '未命名预设组'
      const list = map.get(key)
      if (list) list.push(record)
      else map.set(key, [record])
    }
    return [...map.entries()]
  }, [filteredHistory])

  // 历史中执行过分配的任务（分配 Tab）
  const distributedHistory = useMemo(() => history.filter((record) => Boolean(record.distributionStatus)), [history])

  // 任务流按背景图分组：一次发送/加载的多张图片 = 一个任务组（组内按图片列输出）
  const groupedTasks = useMemo(() => {
    const map = new Map<string, typeof exportTasks>()
    for (const task of exportTasks) {
      const list = map.get(task.backgroundPath)
      if (list) list.push(task)
      else map.set(task.backgroundPath, [task])
    }
    return [...map.entries()]
  }, [exportTasks])

  // 任务流：批次组折叠 + 图片行折叠
  const [batchCollapsed, setBatchCollapsed] = useState(false)
  const [collapsedImages, setCollapsedImages] = useState<Set<string>>(new Set())

  function toggleBatch() {
    setBatchCollapsed((value) => !value)
  }

  function toggleImageGroup(backgroundPath: string) {
    setCollapsedImages((prev) => {
      const next = new Set(prev)
      if (next.has(backgroundPath)) next.delete(backgroundPath)
      else next.add(backgroundPath)
      return next
    })
  }

  function toggleRecordGroup(groupName: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupName)) next.delete(groupName)
      else next.add(groupName)
      return next
    })
  }

  /** 删除单条任务记录（确认后执行） */
  function handleRemoveRecord(record: CompositeV2HistoryRecord) {
    openConfirmDialog({
      title: '删除这条记录？',
      message: `将删除「${record.presetGroupName}」的任务记录（${record.successCount} 成功 / ${record.failureCount} 失败），文件本身不受影响。`,
      confirmText: '删除',
      tone: 'danger',
      action: () => {
        removeHistoryRecord(record.id)
        useStore.getState().showToast('已删除任务记录', 'success')
      },
    })
  }

  /** 清空全部任务记录（确认后执行） */
  function handleClearHistory() {
    if (history.length === 0) return
    openConfirmDialog({
      title: '清空全部任务记录？',
      message: `将删除全部 ${history.length} 条任务记录，此操作不可恢复（不影响已导出的文件）。`,
      confirmText: '全部清空',
      cancelText: '取消',
      tone: 'danger',
      action: () => {
        clearHistory()
        useStore.getState().showToast(`已清空全部 ${history.length} 条任务记录`, 'success')
      },
    })
  }

  function handleRedistribute(record: CompositeV2HistoryRecord) {
    if (!distributionConfig.enabled) {
      openInfoDialog({ title: '无法重新分配', message: '请先在分配设置中启用自动分配并配置规则。' })
      return
    }
    if (!distributionConfig.startDate || !/^(\d{4})(\d{2})(\d{2})$/.test(distributionConfig.startDate)) {
      openInfoDialog({ title: '起始日期格式错误', message: '请输入 YYYYMMDD 格式的日期，例如 20260701。' })
      return
    }
    const electronApi = typeof window !== 'undefined' ? window.electronAPI : undefined
    if (!electronApi) {
      openInfoDialog({ title: '当前环境不支持', message: '当前环境无法执行本地文件操作。' })
      return
    }
    if (record.successes.length === 0) {
      openInfoDialog({ title: '没有可分配文件', message: '该记录没有成功导出的文件，无法重新分配。' })
      return
    }
    openConfirmDialog({
      title: '重新分配导出文件？',
      message: `将按照当前分配规则处理 ${record.successes.length} 个文件。`,
      confirmText: '开始分配',
      action: () => void executeRedistribute(record, electronApi),
    })
  }

  async function executeRedistribute(
    record: CompositeV2HistoryRecord,
    electronApi: NonNullable<typeof window.electronAPI>,
  ) {
    distributeCancelRef.current = false
    setDistributingId(record.id)
    updateHistoryRecord(record.id, { distributionStatus: 'running' })
    try {
      const distSuccesses: import('../lib/compositeV2Types').CompositeV2DistributionSuccessItem[] = []
      const distFailures: import('../lib/compositeV2Types').CompositeV2DistributionFailureItem[] = []
      const result = await runDistribution(record.successes, distributionConfig, electronApi, presets, {
        onSuccess: (item) => distSuccesses.push(item),
        onFailure: (item) => distFailures.push(item),
        shouldCancel: () => distributeCancelRef.current,
      })
      const finalDistStatus = result.canceled
        ? 'canceled'
        : result.errors.length > 0 && result.success === 0
          ? 'failed'
          : 'completed'
      updateHistoryRecord(record.id, {
        distributionStatus: finalDistStatus,
        distributionSuccessCount: result.success,
        distributionFailureCount: result.failed,
        distributionErrors: result.errors,
        distributionSuccesses: distSuccesses,
        distributionFailures: distFailures,
      })
      openInfoDialog({
        title: result.canceled ? '重新分配已取消' : '重新分配完成',
        message: result.canceled
          ? `已取消，已完成 ${result.success} 个。`
          : `成功 ${result.success} 个，失败 ${result.failed} 个。${result.errors.length > 0 ? '\n错误详情已写入控制台。' : ''}`,
      })
      if (result.errors.length > 0) {
        console.error('分发错误：', result.errors)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      updateHistoryRecord(record.id, { distributionStatus: 'failed', distributionErrors: [message] })
      openInfoDialog({ title: '重新分配失败', message })
    } finally {
      setDistributingId(null)
      distributeCancelRef.current = false
    }
  }

  const [distributingId, setDistributingId] = useState<string | null>(null)

  /** 导出 Tab：单条任务记录卡片（分组列表内渲染） */
  const renderRecordCard = (item: CompositeV2HistoryRecord) => (
    <div
      key={item.id}
      className="rounded-md border border-ds-border px-3 py-2 text-xs text-ds-muted dark:border-ds-border dark:text-ds-muted"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-ds-text dark:text-ds-text-subtle">{item.presetGroupName}</span>
        <span className="text-ds-muted dark:text-ds-muted">{formatTimestamp(item.endedAt)}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex flex-wrap gap-3 text-ds-muted dark:text-ds-muted">
          <span>{item.backgroundCount} 张背景</span>
          <span>{item.successCount} 成功</span>
          <span>{item.failureCount} 失败</span>
          <span className="flex items-center gap-1">
            <span className="mx-1 h-3 w-[1px] bg-ds-subtle dark:bg-ds-subtle"></span>
            <span>分配: </span>
            {item.distributionStatus === 'running' ? (
              <span className="text-ds-primary">进行中...</span>
            ) : item.distributionStatus === 'failed' ? (
              <span className="text-ds-danger" title={item.distributionErrors?.join('\n')}>
                失败
              </span>
            ) : item.distributionStatus === 'canceled' ? (
              <span className="text-ds-muted">已取消</span>
            ) : item.distributionStatus ? (
              <span>
                {item.distributionSuccessCount ?? 0} 成功, {item.distributionFailureCount ?? 0} 失败
              </span>
            ) : (
              <span className="text-ds-muted">未分配</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setDetailRecord(item)}
            className="rounded border border-ds-border px-2 py-0.5 text-ds-muted hover:bg-ds-subtle hover:text-ds-text dark:border-ds-border dark:hover:bg-ds-surface dark:hover:text-ds-text-subtle"
          >
            详情
          </button>
          <button
            type="button"
            aria-label="删除这条记录"
            title="删除这条记录"
            onClick={() => handleRemoveRecord(item)}
            className="rounded border border-ds-danger/35 px-2 py-0.5 text-ds-danger transition hover:bg-ds-danger-subtle dark:border-ds-danger/30 dark:hover:bg-ds-danger/10"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  )

  /** 分配 Tab：历史分配记录卡片 */
  const renderDistributionCard = (item: CompositeV2HistoryRecord) => (
    <div
      key={item.id}
      className="rounded-md border border-ds-border px-3 py-2 text-xs text-ds-muted dark:border-ds-border dark:text-ds-muted"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-ds-text dark:text-ds-text-subtle">{item.presetGroupName}</span>
        <span className="text-ds-muted dark:text-ds-muted">{formatTimestamp(item.endedAt)}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="flex items-center gap-1">
          <span>分配: </span>
          {item.distributionStatus === 'running' ? (
            <span className="text-ds-primary">进行中...</span>
          ) : item.distributionStatus === 'failed' ? (
            <span className="text-ds-danger" title={item.distributionErrors?.join('\n')}>
              失败
            </span>
          ) : item.distributionStatus === 'canceled' ? (
            <span className="text-ds-muted">已取消</span>
          ) : (
            <span>
              {item.distributionSuccessCount ?? 0} 成功, {item.distributionFailureCount ?? 0} 失败
            </span>
          )}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setDetailRecord(item)}
            className="rounded border border-ds-border px-2 py-0.5 text-ds-muted hover:bg-ds-subtle hover:text-ds-text dark:border-ds-border dark:hover:bg-ds-surface dark:hover:text-ds-text-subtle"
          >
            详情
          </button>
          {distributingId === item.id && (
            <button
              type="button"
              onClick={() => {
                distributeCancelRef.current = true
              }}
              className="rounded border border-ds-danger/35 bg-ds-danger-subtle px-2 py-0.5 text-ds-danger hover:bg-ds-danger/10 disabled:opacity-50 dark:border-ds-danger/30 dark:bg-ds-danger/10 dark:text-ds-danger"
            >
              取消分配
            </button>
          )}
          <button
            type="button"
            disabled={distributingId === item.id || item.successCount === 0}
            onClick={() => handleRedistribute(item)}
            className="rounded border border-ds-primary/35 bg-ds-primary-subtle px-2 py-0.5 text-ds-primary hover:bg-ds-primary-subtle disabled:opacity-50 dark:border-ds-primary/30 dark:bg-ds-primary/10 dark:text-ds-primary dark:hover:bg-ds-primary/20"
          >
            {distributingId === item.id ? '分配中...' : '重新分配'}
          </button>
          <button
            type="button"
            aria-label="删除这条记录"
            title="删除这条记录"
            onClick={() => handleRemoveRecord(item)}
            className="rounded border border-ds-danger/35 px-2 py-0.5 text-ds-danger transition hover:bg-ds-danger-subtle dark:border-ds-danger/30 dark:hover:bg-ds-danger/10"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  )

  const tabButtonClass = (active: boolean) =>
    `flex-1 rounded px-3 py-1 text-xs font-medium transition ${
      active
        ? 'bg-ds-surface-raised text-ds-text shadow-sm dark:bg-ds-scrim dark:text-ds-text-subtle'
        : 'text-ds-muted hover:text-ds-text dark:hover:text-ds-text-subtle'
    }`

  return (
    <div className="flex h-full min-h-0 flex-col p-4">
      {/* 标题 + Tab */}
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ds-text dark:text-ds-text-subtle">任务记录</h3>
        <div className="flex w-44 shrink-0 gap-0.5 rounded-lg bg-ds-subtle p-0.5 dark:bg-ds-surface">
          <button
            type="button"
            onClick={() => setActiveTab('export')}
            aria-pressed={activeTab === 'export'}
            className={tabButtonClass(activeTab === 'export')}
          >
            导出
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('distribution')}
            aria-pressed={activeTab === 'distribution'}
            className={tabButtonClass(activeTab === 'distribution')}
          >
            分配
          </button>
        </div>
      </div>

      {activeTab === 'export' ? (
        <>
          {/* ===== 导出 Tab：参数区 ===== */}
          <div className="mt-3 grid shrink-0 grid-cols-4 gap-1.5">
            <StatCell label="导出已处理" value={`${completed} / ${total}`} />
            <StatCell label="导出成功" value={successes.length} tone="success" />
            <StatCell label="导出失败" value={failures.length} tone={failures.length > 0 ? 'danger' : undefined} />
            <StatCell label="导出进度" value={`${progress}%`} />
          </div>
          <div className="mt-2 h-1.5 shrink-0 overflow-hidden rounded-full bg-ds-surface dark:bg-ds-subtle">
            <div className="h-full rounded-full bg-ds-primary transition-[width]" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-2 flex shrink-0 items-center justify-between text-xs text-ds-muted dark:text-ds-muted">
            <span>
              {STATUS_LABELS[status]} · 共 {history.length} 条记录
            </span>
            <label className="flex items-center gap-1.5">
              保留
              <input
                type="number"
                min={1}
                value={historyRetention}
                onChange={(event) => setHistoryRetention(Number(event.target.value))}
                className="w-14 rounded border border-ds-border px-1.5 py-0.5 dark:border-ds-border dark:bg-ds-scrim"
              />
              次
            </label>
          </div>

          {/* ===== 导出 Tab：本次任务流（一次发送/加载 = 一个任务组，组内按图片列输出） ===== */}
          {exportTasks.length > 0 && (
            <div className="mt-3 shrink-0 overflow-hidden rounded-md border border-ds-border/70 dark:border-ds-border/70">
              {/* 任务组头（整个批次） */}
              <button
                type="button"
                onClick={toggleBatch}
                aria-expanded={!batchCollapsed}
                className="flex w-full items-center justify-between gap-2 bg-ds-subtle/60 px-2.5 py-1.5 text-xs transition hover:bg-ds-subtle dark:bg-ds-surface/40 dark:hover:bg-ds-surface"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className={`shrink-0 text-ds-muted transition-transform dark:text-ds-muted ${batchCollapsed ? '' : 'rotate-90'}`}
                  >
                    ▶
                  </span>
                  <span className="font-semibold text-ds-text dark:text-ds-text-subtle">本次任务</span>
                  <span className="shrink-0 text-ds-muted dark:text-ds-muted">
                    {groupedTasks.length} 张图片 · {exportTasks.length} 个输出
                  </span>
                </span>
                <span className="shrink-0 text-ds-muted dark:text-ds-muted">
                  完成 {exportTasks.filter((task) => task.status === 'done').length}/{exportTasks.length}
                  {exportTasks.some((task) => task.status === 'failed') ? ' · 有失败' : ''}
                </span>
              </button>

              {!batchCollapsed && (
                <div className="space-y-1.5 p-1.5">
                  {groupedTasks.map(([backgroundPath, tasks]) => {
                    const done = tasks.filter((task) => task.status === 'done').length
                    const failed = tasks.filter((task) => task.status === 'failed').length
                    const running = tasks.some((task) => task.status === 'running')
                    const imageCollapsed = collapsedImages.has(backgroundPath)
                    const imageName = backgroundPath.split(/[\\/]/).pop() || backgroundPath
                    return (
                      <div
                        key={backgroundPath}
                        className="overflow-hidden rounded-md border border-ds-border/60 dark:border-ds-border/60"
                      >
                        {/* 图片行（默认折叠，点击展开该图的输出明细） */}
                        <button
                          type="button"
                          onClick={() => toggleImageGroup(backgroundPath)}
                          aria-expanded={!imageCollapsed}
                          title={backgroundPath}
                          className="flex w-full items-center justify-between gap-2 px-2 py-1 text-xs transition hover:bg-ds-subtle dark:hover:bg-ds-surface"
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span
                              aria-hidden="true"
                              className={`shrink-0 text-ds-muted transition-transform dark:text-ds-muted ${imageCollapsed ? '' : 'rotate-90'}`}
                            >
                              ▶
                            </span>
                            {failed > 0 ? (
                              <span className="shrink-0 text-ds-danger dark:text-ds-danger" aria-label="有失败">
                                ✗
                              </span>
                            ) : done === tasks.length ? (
                              <span className="shrink-0 text-ds-success dark:text-ds-success" aria-label="全部完成">
                                ✓
                              </span>
                            ) : running ? (
                              <span
                                className="shrink-0 animate-pulse text-ds-primary dark:text-ds-primary"
                                aria-label="处理中"
                              >
                                …
                              </span>
                            ) : (
                              <span className="shrink-0 text-ds-muted dark:text-ds-muted" aria-label="等待中">
                                ·
                              </span>
                            )}
                            <span className="min-w-0 truncate font-medium text-ds-text dark:text-ds-text-subtle">
                              {imageName}
                            </span>
                          </span>
                          <span className="shrink-0 text-ds-muted dark:text-ds-muted">
                            {done}/{tasks.length}
                          </span>
                        </button>

                        {!imageCollapsed && (
                          <div className="space-y-1 border-t border-ds-border/40 p-1.5 dark:border-ds-border/40">
                            {tasks.map((task) => (
                              <div
                                key={task.key}
                                title={task.reason ?? task.outputPath ?? task.backgroundPath}
                                className={`flex items-center gap-1.5 rounded border px-2 py-1 text-xs ${
                                  task.status === 'done'
                                    ? 'border-ds-success/30 bg-ds-success-subtle/50 dark:border-ds-success/25 dark:bg-ds-success/5'
                                    : task.status === 'failed'
                                      ? 'border-ds-danger/35 bg-ds-danger-subtle/50 dark:border-ds-danger/30 dark:bg-ds-danger/5'
                                      : task.status === 'running'
                                        ? 'border-ds-primary/35 bg-ds-primary-subtle/50 dark:border-ds-primary/25 dark:bg-ds-primary/5'
                                        : 'border-ds-border/60 dark:border-ds-border/60'
                                }`}
                              >
                                <span className="min-w-0 flex-1 truncate">
                                  {task.presetName} / {task.size}
                                </span>
                                {task.status === 'done' && (
                                  <span className="shrink-0 text-ds-success dark:text-ds-success" aria-label="成功">
                                    ✓
                                  </span>
                                )}
                                {task.status === 'failed' && (
                                  <>
                                    <span className="shrink-0 text-ds-danger dark:text-ds-danger" aria-label="失败">
                                      ✗
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => onRetryTask?.(task)}
                                      className="shrink-0 rounded border border-ds-primary/35 bg-ds-primary-subtle px-1.5 py-0.5 text-xs text-ds-primary hover:bg-ds-primary-subtle dark:border-ds-primary/30 dark:bg-ds-primary/10 dark:text-ds-primary dark:hover:bg-ds-primary/20"
                                    >
                                      重试
                                    </button>
                                  </>
                                )}
                                {task.status === 'running' && (
                                  <span
                                    className="shrink-0 animate-pulse text-ds-primary dark:text-ds-primary"
                                    aria-label="处理中"
                                  >
                                    …
                                  </span>
                                )}
                                {task.status === 'pending' && (
                                  <span className="shrink-0 text-ds-muted dark:text-ds-muted" aria-label="等待中">
                                    ·
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ===== 导出 Tab：导出成功/失败日志 ===== */}
          {(successes.length > 0 || failures.length > 0) && (
            <div className="mt-3 min-h-0 shrink-0">
              <div className="max-h-32 space-y-1 overflow-y-auto">
                {successes.map((item) => (
                  <div
                    key={item.path}
                    className="rounded border border-ds-border px-2 py-1 text-xs dark:border-ds-border"
                  >
                    <div className="truncate text-ds-text dark:text-ds-text-subtle" title={item.path}>
                      {item.path}
                    </div>
                    {item.warning && <div className="mt-0.5 text-ds-warning">警告：{item.warning}</div>}
                  </div>
                ))}
                {failures.map((item, index) => (
                  <div
                    key={`${item.backgroundPath}-${item.presetId}-${index}`}
                    className="rounded border border-ds-danger/35 px-2 py-1 text-xs text-ds-danger dark:border-ds-danger/30 dark:text-ds-danger"
                  >
                    <div className="truncate" title={item.backgroundPath}>
                      {item.backgroundPath}
                    </div>
                    <div>
                      {item.presetName} / {item.channel} / {item.size}：{item.reason}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ===== 导出 Tab：历史记录（标题 + 清空一行，筛选独立一行，避免换行挤压） ===== */}
          <div className="mt-3 flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <h4 className="shrink-0 text-xs font-semibold text-ds-muted dark:text-ds-muted">历史记录</h4>
                <span className="shrink-0 text-xs text-ds-muted dark:text-ds-muted">（{filteredHistory.length}）</span>
              </div>
              {history.length > 0 && (
                <button
                  type="button"
                  aria-label="清空全部任务记录"
                  title="清空全部任务记录"
                  onClick={() => void handleClearHistory()}
                  className="shrink-0 rounded border border-ds-danger/35 p-1 text-ds-danger transition hover:bg-ds-danger-subtle dark:border-ds-danger/30 dark:hover:bg-ds-danger/10"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="mt-1.5 flex shrink-0 items-center gap-1">
              {(
                [
                  { key: 'all', label: '全部' },
                  { key: 'distributed', label: '已分配' },
                  { key: 'not-distributed', label: '仅导出' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setRecordFilter(tab.key)}
                  aria-pressed={recordFilter === tab.key}
                  className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                    recordFilter === tab.key
                      ? 'border-ds-primary/40 bg-ds-primary-subtle text-ds-primary dark:border-ds-primary/30 dark:bg-ds-primary/10 dark:text-ds-primary'
                      : 'border-ds-border text-ds-muted hover:bg-ds-subtle hover:text-ds-text dark:border-ds-border dark:hover:bg-ds-surface dark:hover:text-ds-text-subtle'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="mt-2 space-y-2 flex-1 overflow-y-auto min-h-0">
              {filteredHistory.length ? (
                groupedHistory.map(([groupName, records]) => {
                  const collapsed = collapsedGroups.has(groupName)
                  return (
                    <div key={groupName}>
                      <button
                        type="button"
                        onClick={() => toggleRecordGroup(groupName)}
                        aria-expanded={!collapsed}
                        className="flex w-full items-center gap-1.5 rounded-md bg-ds-subtle px-2 py-1.5 text-xs font-medium text-ds-text transition hover:bg-ds-subtle dark:bg-ds-surface dark:text-ds-text-subtle dark:hover:bg-ds-surface"
                      >
                        <span
                          aria-hidden="true"
                          className={`shrink-0 text-ds-muted transition-transform dark:text-ds-muted ${collapsed ? '' : 'rotate-90'}`}
                        >
                          ▶
                        </span>
                        <span className="min-w-0 flex-1 truncate text-left">{groupName}</span>
                        <span className="shrink-0 text-ds-muted dark:text-ds-muted">{records.length} 次</span>
                      </button>
                      {!collapsed && <div className="mt-1.5 space-y-1.5">{records.map(renderRecordCard)}</div>}
                    </div>
                  )
                })
              ) : (
                <div className="rounded-md border border-dashed border-ds-border px-3 py-4 text-xs text-ds-muted dark:border-ds-border dark:text-ds-muted">
                  {history.length === 0 ? '完成导出后会在这里保存结果与历史记录。' : '没有符合条件的任务记录。'}
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* ===== 分配 Tab：参数区 ===== */}
          <div className="mt-3 grid shrink-0 grid-cols-3 gap-1.5">
            <StatCell label="分配成功" value={distributionSuccesses.length} tone="success" />
            <StatCell
              label="分配失败"
              value={distributionFailures.length}
              tone={distributionFailures.length > 0 ? 'danger' : undefined}
            />
            <StatCell label="分配进度" value={distributionStatus === 'idle' ? '-' : `${distProgress}%`} />
          </div>
          {distributionStatus !== 'idle' && (
            <div className="mt-2 h-1.5 shrink-0 overflow-hidden rounded-full bg-ds-surface dark:bg-ds-subtle">
              <div
                className="h-full rounded-full bg-ds-success transition-[width]"
                style={{ width: `${distProgress}%` }}
              />
            </div>
          )}
          <div className="mt-2 shrink-0 text-xs text-ds-muted dark:text-ds-muted">
            {distributionStatus === 'idle'
              ? '本次任务未执行分配（未启用自动分配或没有成功文件）。'
              : `本次分配：${distributionStatus === 'completed' ? '已完成' : distributionStatus === 'failed' ? '失败' : distributionStatus === 'canceled' ? '已取消' : distributionStatus === 'running' ? '进行中' : '等待中'}`}
          </div>

          {/* ===== 分配 Tab：本次分配日志 ===== */}
          {(distributionSuccesses.length > 0 || distributionFailures.length > 0) && (
            <div className="mt-3 min-h-0 shrink-0">
              <h4 className="text-xs font-semibold text-ds-muted dark:text-ds-muted">本次分配明细</h4>
              <div className="mt-1.5 max-h-36 space-y-1 overflow-y-auto">
                {distributionSuccesses.map((item, index) => (
                  <div
                    key={`dist-succ-${index}`}
                    className="rounded border border-ds-border px-2 py-1 text-xs dark:border-ds-border"
                  >
                    <div className="truncate text-ds-muted dark:text-ds-muted" title={item.originalPath}>
                      {item.originalPath}
                    </div>
                    <div className="truncate text-ds-success dark:text-ds-success" title={item.targetPath}>
                      -&gt; {item.targetPath}
                    </div>
                  </div>
                ))}
                {distributionFailures.map((item, index) => (
                  <div
                    key={`dist-fail-${index}`}
                    className="rounded border border-ds-danger/35 px-2 py-1 text-xs text-ds-danger dark:border-ds-danger/30 dark:text-ds-danger"
                  >
                    <div className="truncate">{item.originalPath}</div>
                    <div>{item.error}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ===== 分配 Tab：历史分配记录 ===== */}
          <div className="mt-3 flex min-h-0 flex-1 flex-col">
            <h4 className="shrink-0 text-xs font-semibold text-ds-muted dark:text-ds-muted">
              历史分配（{distributedHistory.length}）
            </h4>
            <div className="mt-2 space-y-1.5 flex-1 overflow-y-auto min-h-0">
              {distributedHistory.length ? (
                distributedHistory.map(renderDistributionCard)
              ) : (
                <div className="rounded-md border border-dashed border-ds-border px-3 py-4 text-xs text-ds-muted dark:border-ds-border dark:text-ds-muted">
                  还没有执行过分配的记录。
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <ExportHistoryDetailModal
        record={detailRecord}
        open={detailRecord !== null}
        onOpenChange={(open) => {
          if (!open) setDetailRecord(null)
        }}
      />
    </div>
  )
}
