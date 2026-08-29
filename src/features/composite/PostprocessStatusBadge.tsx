import { useCompositeV2Store } from './storeV2'

/**
 * 顶栏「后期处理」入口的运行状态徽标：
 * - 导出进行中：显示已完成百分比（脉冲高亮，方便后台运行时一眼看到进度）
 * - 已暂停：显示百分比（警示色，无脉冲）
 * - 取消中：显示「取消中」
 * - 其余状态（idle / completed / canceled / failed）不渲染，入口恢复原样
 */
export function PostprocessStatusBadge() {
  const exportStatus = useCompositeV2Store((state) => state.exportStatus)
  const exportCompleted = useCompositeV2Store((state) => state.exportCompleted)
  const exportTotal = useCompositeV2Store((state) => state.exportTotal)

  if (exportStatus === 'canceling') {
    return (
      <span className="rounded-full bg-ds-muted/15 px-1.5 py-0.5 text-xs font-semibold leading-none text-ds-muted dark:bg-ds-muted/25">
        取消中
      </span>
    )
  }

  if (exportStatus !== 'running' && exportStatus !== 'paused') return null

  const percent = exportTotal > 0 ? Math.min(100, Math.round((exportCompleted / exportTotal) * 100)) : 0
  const isPaused = exportStatus === 'paused'
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-xs font-semibold leading-none ${
        isPaused
          ? 'bg-ds-warning/15 text-ds-warning dark:bg-ds-warning/25'
          : 'animate-pulse bg-ds-primary/15 text-ds-primary dark:bg-ds-primary/25'
      }`}
    >
      {percent}%
    </span>
  )
}
