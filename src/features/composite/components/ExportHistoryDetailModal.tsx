import { useState } from 'react'
import { Dialog } from '../../../design-system/overlays'
import type { CompositeV2HistoryRecord, CompositeV2SuccessItem } from '../lib/compositeV2Types'

type ExportHistoryDetailModalProps = {
  record: CompositeV2HistoryRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const STATUS_META: Record<CompositeV2HistoryRecord['status'], { label: string; className: string }> = {
  completed: {
    label: '成功',
    className:
      'border-ds-success/40 bg-ds-success-subtle text-ds-success dark:border-ds-success/30 dark:bg-ds-success/10',
  },
  'completed-with-failures': {
    label: '部分失败',
    className:
      'border-ds-warning/40 bg-ds-warning-subtle text-ds-warning dark:border-ds-warning/30 dark:bg-ds-warning/10',
  },
  canceled: {
    label: '已取消',
    className: 'border-ds-border bg-ds-subtle text-ds-muted dark:border-ds-border dark:bg-ds-surface',
  },
}

const DIST_STATUS_LABEL: Record<string, string> = {
  pending: '待分配',
  running: '分配中',
  completed: '已完成',
  failed: '失败',
  canceled: '已取消',
}

function formatDuration(startedAt: number, endedAt: number) {
  const seconds = Math.max(0, Math.round((endedAt - startedAt) / 1000))
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleString()
}

/** 打开文件所在文件夹（文件定位） */
function revealPath(path: string) {
  void window.electronAPI?.openInExplorer?.(path).then((result) => {
    if (result && !result.ok) {
      void import('../../../store').then(({ useStore }) => useStore.getState().showToast('打开文件夹失败', 'error'))
    }
  })
}

/** 复制路径到剪贴板 */
async function copyPath(path: string) {
  try {
    await navigator.clipboard.writeText(path)
    const { useStore } = await import('../../../store')
    useStore.getState().showToast('路径已复制', 'success')
  } catch {
    const { useStore } = await import('../../../store')
    useStore.getState().showToast('复制失败，请手动选择', 'error')
  }
}

function PathCell({ path }: { path: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span
        className="min-w-0 flex-1 truncate font-mono text-xs leading-5 text-ds-text dark:text-ds-text-subtle"
        title={path}
      >
        {path}
      </span>
      <button
        type="button"
        aria-label="复制路径"
        title="复制路径"
        onClick={() => void copyPath(path)}
        className="shrink-0 rounded border border-ds-border px-1.5 py-0.5 text-xs text-ds-muted transition hover:bg-ds-subtle hover:text-ds-text dark:border-ds-border dark:hover:bg-ds-surface dark:hover:text-ds-text-subtle"
      >
        复制
      </button>
      <button
        type="button"
        aria-label="打开所在文件夹"
        title="打开所在文件夹"
        onClick={() => revealPath(path)}
        className="shrink-0 rounded border border-ds-primary/35 bg-ds-primary-subtle px-1.5 py-0.5 text-xs text-ds-primary transition hover:bg-ds-primary-subtle dark:border-ds-primary/30 dark:bg-ds-primary/10 dark:hover:bg-ds-primary/20"
      >
        打开
      </button>
    </div>
  )
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-ds-border px-3 py-3 text-xs text-ds-muted dark:border-ds-border">
      {text}
    </div>
  )
}

/** 按预设名分组（保序；SuccessItem / FailureItem 通用） */
function groupByPreset<T extends { presetName?: string }>(items: T[]) {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = item.presetName || '未命名预设'
    const list = map.get(key)
    if (list) list.push(item)
    else map.set(key, [item])
  }
  return [...map.entries()].map(([name, list]) => ({ name, items: list }))
}

/** 按背景图（源素材）分组导出明细：一次多选发送的每张图片 = 一组任务 */
function groupByBackground(items: CompositeV2SuccessItem[]) {
  const map = new Map<string, CompositeV2SuccessItem[]>()
  for (const item of items) {
    const key = item.backgroundPath || '未知源图'
    const list = map.get(key)
    if (list) list.push(item)
    else map.set(key, [item])
  }
  return [...map.entries()].map(([path, list]) => ({ path, items: list }))
}

/** 按目标目录分组分配明细（保序；泛型保留 originalPath 等字段） */
function groupByTargetDir<T extends { targetPath: string }>(items: T[]) {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const dir = item.targetPath.replace(/[/\\][^/\\]+$/, '') || '（未命名目录）'
    const list = map.get(dir)
    if (list) list.push(item)
    else map.set(dir, [item])
  }
  return [...map.entries()].map(([dir, list]) => ({ dir, items: list }))
}

function shortName(fullPath: string, fallback: string) {
  const parts = fullPath.split(/[/\\]/).filter(Boolean)
  return parts.length > 0 ? (parts[parts.length - 1] ?? fallback) : fallback
}

export function ExportHistoryDetailModal({ record, open, onOpenChange }: ExportHistoryDetailModalProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [activeNav, setActiveNav] = useState<string>('overview')
  if (!record) return null
  const statusMeta = STATUS_META[record.status]
  const distStatus = record.distributionStatus

  const exportGroups = groupByBackground(record.successes)
  const failureGroups = groupByPreset(record.failures)
  const distGroups = groupByTargetDir(record.distributionSuccesses ?? [])

  /** 分组卡片折叠 key */
  const collapseKey = (kind: 'export' | 'fail' | 'dist', name: string) => `${kind}:${name}`

  function toggleCollapse(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  /** 快捷跳转：展开目标分组并滚动定位到锚点 */
  function jumpTo(navKey: string, anchor: string, collapseKeyToExpand?: string) {
    setActiveNav(navKey)
    if (collapseKeyToExpand) {
      setCollapsed((prev) => {
        const next = new Set(prev)
        next.delete(collapseKeyToExpand)
        return next
      })
    }
    requestAnimationFrame(() => {
      document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const navItems: Array<{
    key: string
    label: string
    count?: number
    tone?: 'default' | 'danger'
    anchor: string
    expandKey?: string
  }> = [
    { key: 'overview', label: '概览', anchor: 'detail-overview' },
    ...exportGroups.map((group, index) => ({
      key: `export:${group.path}`,
      label: `导出·${shortName(group.path, '源图')}`,
      count: group.items.length,
      anchor: `detail-export-${index}`,
      expandKey: collapseKey('export', group.path),
    })),
    ...failureGroups.map((group, index) => ({
      key: `fail:${group.name}`,
      label: `失败·${group.name}`,
      count: group.items.length,
      tone: 'danger' as const,
      anchor: `detail-fail-${index}`,
      expandKey: collapseKey('fail', group.name),
    })),
  ]
  // 分配导航独立成段（与"导出"大类别区分）
  const distNavItems: Array<{
    key: string
    label: string
    count?: number
    tone?: 'default' | 'danger'
    anchor: string
    expandKey?: string
  }> = distGroups.map((group, index) => ({
    key: `dist:${group.dir}`,
    label: `分配·${shortName(group.dir, '目标目录')}`,
    count: group.items.length,
    anchor: `detail-dist-${index}`,
    expandKey: collapseKey('dist', group.dir),
  }))

  /** 分组卡片（组头可点击折叠 + 锚点） */
  const renderGroupCard = (props: {
    anchorId: string
    title: React.ReactNode
    count: number
    collapsedKey: string
    tone?: 'default' | 'danger' | 'success'
    children: React.ReactNode
  }) => {
    const isCollapsed = collapsed.has(props.collapsedKey)
    const toneBorder =
      props.tone === 'danger'
        ? 'border-ds-danger/30 dark:border-ds-danger/25'
        : props.tone === 'success'
          ? 'border-ds-success/30 dark:border-ds-success/25'
          : 'border-ds-border dark:border-ds-border'
    const toneHead =
      props.tone === 'danger'
        ? 'border-ds-danger/25 bg-ds-danger-subtle/40 dark:border-ds-danger/20 dark:bg-ds-danger/5'
        : props.tone === 'success'
          ? 'border-ds-success/25 bg-ds-success-subtle/50 dark:border-ds-success/20 dark:bg-ds-success/5'
          : 'border-ds-border/60 bg-ds-subtle/60 dark:border-ds-border/60 dark:bg-ds-surface/40'
    return (
      <div id={props.anchorId} className={`scroll-mt-24 overflow-hidden rounded-md border ${toneBorder}`}>
        <button
          type="button"
          onClick={() => toggleCollapse(props.collapsedKey)}
          aria-expanded={!isCollapsed}
          className={`flex w-full items-center justify-between gap-2 border-b px-2.5 py-1.5 text-xs font-medium text-ds-text transition hover:bg-ds-subtle dark:text-ds-text-subtle dark:hover:bg-ds-surface ${toneHead}`}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              aria-hidden="true"
              className={`shrink-0 text-ds-muted transition-transform dark:text-ds-muted ${isCollapsed ? '' : 'rotate-90'}`}
            >
              ▶
            </span>
            <span className="truncate">{props.title}</span>
          </span>
          <span className="shrink-0 text-ds-muted dark:text-ds-muted">{props.count} 项</span>
        </button>
        {!isCollapsed && <div className="space-y-1 p-2">{props.children}</div>}
      </div>
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`任务详情：${record.presetGroupName}`}
      description={`${formatTime(record.startedAt)} ～ ${formatTime(record.endedAt)} · 耗时 ${formatDuration(record.startedAt, record.endedAt)}`}
      size="xl"
    >
      <div className="flex min-h-0 flex-col gap-4">
        {/* 分组导航：导出区与分配区分段，点击快捷定位到具体分组 */}
        <div className="sticky top-0 z-10 -mx-4 flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-ds-border/60 bg-ds-surface-raised px-4 py-2 dark:border-ds-border/60 dark:bg-ds-scrim">
          {navItems.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => jumpTo(item.key, item.anchor, item.expandKey)}
              aria-current={activeNav === item.key}
              className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition ${
                activeNav === item.key
                  ? 'border-ds-primary/40 bg-ds-primary-subtle text-ds-primary dark:border-ds-primary/30 dark:bg-ds-primary/10 dark:text-ds-primary'
                  : item.tone === 'danger'
                    ? 'border-ds-danger/30 text-ds-danger hover:bg-ds-danger-subtle dark:border-ds-danger/25 dark:hover:bg-ds-danger/10'
                    : 'border-ds-border text-ds-muted hover:bg-ds-subtle hover:text-ds-text dark:border-ds-border dark:hover:bg-ds-surface dark:hover:text-ds-text-subtle'
              }`}
            >
              <span className="max-w-40 truncate">{item.label}</span>
              {typeof item.count === 'number' && <span className="opacity-70">({item.count})</span>}
            </button>
          ))}
          {distNavItems.length > 0 && (
            <>
              <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-ds-border dark:bg-ds-border" />
              {distNavItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => jumpTo(item.key, item.anchor, item.expandKey)}
                  aria-current={activeNav === item.key}
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition ${
                    activeNav === item.key
                      ? 'border-ds-primary/40 bg-ds-primary-subtle text-ds-primary dark:border-ds-primary/30 dark:bg-ds-primary/10 dark:text-ds-primary'
                      : 'border-ds-success/35 text-ds-muted hover:bg-ds-success-subtle hover:text-ds-success dark:border-ds-success/25 dark:hover:bg-ds-success/10 dark:hover:text-ds-success'
                  }`}
                >
                  <span className="max-w-40 truncate">{item.label}</span>
                  {typeof item.count === 'number' && <span className="opacity-70">({item.count})</span>}
                </button>
              ))}
            </>
          )}
        </div>

        {/* 概览 */}
        <div id="detail-overview" className="scroll-mt-24 flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusMeta.className}`}
          >
            {statusMeta.label}
          </span>
          {distStatus && (
            <span className="inline-flex items-center gap-1 rounded-full border border-ds-border px-2.5 py-0.5 text-xs text-ds-muted dark:border-ds-border">
              分配：{DIST_STATUS_LABEL[distStatus] ?? distStatus}
            </span>
          )}
          <span className="text-xs text-ds-muted dark:text-ds-muted">
            {record.backgroundCount} 张背景 · 计划 {record.plannedCount} 张 · 成功 {record.successCount} · 失败{' '}
            {record.failureCount}
            {record.enabledPresetCount > 0 ? ` · ${record.enabledPresetCount} 个预设` : ''}
          </span>
        </div>

        {/* 大节：导出 */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-ds-text dark:text-ds-text-subtle">导出</span>
          <span aria-hidden="true" className="h-px flex-1 bg-ds-border/70 dark:bg-ds-border/70" />
          <span className="shrink-0 text-xs text-ds-muted dark:text-ds-muted">
            {record.successCount} 成功 · {record.failureCount} 失败
          </span>
        </div>

        {/* 导出明细：按预设分组 */}
        <div className="flex min-h-0 flex-col gap-2">
          <h4 className="text-xs font-semibold text-ds-muted dark:text-ds-muted">
            导出文件（{record.successes.length}）
          </h4>
          {record.successes.length > 0 ? (
            <div className="max-h-56 space-y-2 overflow-y-auto">
              {exportGroups.map((group, index) =>
                renderGroupCard({
                  anchorId: `detail-export-${index}`,
                  title: (
                    <span className="font-medium" title={group.path}>
                      {shortName(group.path, '源图')}
                    </span>
                  ),
                  count: group.items.length,
                  collapsedKey: collapseKey('export', group.path),
                  children: group.items.map((item, itemIndex) => (
                    <div key={`${item.path}-${itemIndex}`} className="px-0.5 py-0.5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ds-muted dark:text-ds-muted">
                        <span className="font-medium text-ds-text dark:text-ds-text-subtle">{item.presetName}</span>
                        <span>{item.channel}</span>
                        <span>{item.size}</span>
                        {item.warning && (
                          <span className="text-ds-warning dark:text-ds-warning">警告：{item.warning}</span>
                        )}
                      </div>
                      <div className="mt-0.5">
                        <PathCell path={item.path} />
                      </div>
                    </div>
                  )),
                }),
              )}
            </div>
          ) : (
            <EmptyHint text="本次任务没有成功导出的文件。" />
          )}
        </div>

        {/* 失败明细：按预设分组 */}
        {record.failures.length > 0 && (
          <div className="flex min-h-0 flex-col gap-2">
            <h4 className="text-xs font-semibold text-ds-muted dark:text-ds-muted">
              失败明细（{record.failures.length}）
            </h4>
            <div className="max-h-44 space-y-2 overflow-y-auto">
              {failureGroups.map((group, index) =>
                renderGroupCard({
                  anchorId: `detail-fail-${index}`,
                  title: group.name,
                  count: group.items.length,
                  collapsedKey: collapseKey('fail', group.name),
                  tone: 'danger',
                  children: group.items.map((item, itemIndex) => (
                    <div key={`${item.backgroundPath}-${item.presetId}-${itemIndex}`} className="px-0.5 py-0.5 text-xs">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-ds-muted dark:text-ds-muted">
                        <span>{item.channel}</span>
                        <span>{item.size}</span>
                        <span className="truncate" title={item.backgroundPath}>
                          源：{item.backgroundPath}
                        </span>
                      </div>
                      <div className="mt-0.5 text-ds-danger dark:text-ds-danger">{item.reason}</div>
                    </div>
                  )),
                }),
              )}
            </div>
          </div>
        )}

        {/* 大节：分配 */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-ds-text dark:text-ds-text-subtle">分配</span>
          <span aria-hidden="true" className="h-px flex-1 bg-ds-border/70 dark:bg-ds-border/70" />
          <span className="shrink-0 text-xs text-ds-muted dark:text-ds-muted">
            成功 {record.distributionSuccesses?.length ?? 0} · 失败 {record.distributionFailures?.length ?? 0}
          </span>
        </div>

        {/* 分配明细：按目标目录分组 */}
        {(record.distributionSuccesses?.length ?? 0) > 0 || (record.distributionFailures?.length ?? 0) > 0 ? (
          <div className="flex min-h-0 flex-col gap-2">
            <h4 className="text-xs font-semibold text-ds-muted dark:text-ds-muted">
              分配明细（成功 {record.distributionSuccesses?.length ?? 0} / 失败{' '}
              {record.distributionFailures?.length ?? 0}）
            </h4>
            <div className="max-h-56 space-y-2 overflow-y-auto">
              {distGroups.map((group, index) =>
                renderGroupCard({
                  anchorId: `detail-dist-${index}`,
                  title: (
                    <span className="font-mono" title={group.dir}>
                      目标：{group.dir}
                    </span>
                  ),
                  count: group.items.length,
                  collapsedKey: collapseKey('dist', group.dir),
                  tone: 'success',
                  children: group.items.map((item, itemIndex) => (
                    <div key={`dist-succ-${index}-${itemIndex}`} className="px-0.5 py-0.5">
                      <div className="text-xs text-ds-muted dark:text-ds-muted">
                        原文件<span className="mx-1 text-ds-success dark:text-ds-success">→</span>目标
                      </div>
                      <div className="mt-0.5 space-y-0.5">
                        <PathCell path={item.originalPath} />
                        <PathCell path={item.targetPath} />
                      </div>
                    </div>
                  )),
                }),
              )}
              {(record.distributionFailures ?? []).map((item, index) => (
                <div
                  key={`dist-fail-${index}`}
                  className="rounded-md border border-ds-danger/30 px-2.5 py-1.5 text-xs dark:border-ds-danger/25"
                >
                  <div
                    className="truncate font-mono text-xs text-ds-text dark:text-ds-text-subtle"
                    title={item.originalPath}
                  >
                    {item.originalPath}
                  </div>
                  <div
                    className="mt-0.5 truncate font-mono text-xs text-ds-muted dark:text-ds-muted"
                    title={item.targetPath}
                  >
                    → {item.targetPath || '（无目标）'}
                  </div>
                  <div className="mt-0.5 text-ds-danger dark:text-ds-danger">{item.error}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          distStatus && (
            <div className="flex flex-col gap-2">
              <h4 className="text-xs font-semibold text-ds-muted dark:text-ds-muted">分配明细</h4>
              <EmptyHint
                text={record.distributionErrors?.length ? record.distributionErrors.join('\n') : '本次任务未执行分配。'}
              />
            </div>
          )
        )}
      </div>
    </Dialog>
  )
}
