import type { TaskRecord } from '../types'
import { ActualValueBadge, getParamDisplay } from '../lib/paramDisplay'

function ParamTag({ label, value, mismatch = false }: { label: string; value: string; mismatch?: boolean }) {
  return (
    <span className="gallery-task-tag flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs">
      <span className="gallery-task-tag__label">{label}</span>
      {mismatch ? (
        <ActualValueBadge value={value} className="rounded-sm px-1" />
      ) : (
        <span className="gallery-task-tag__value">{value}</span>
      )}
    </span>
  )
}

export default function TaskParamSummary({ task, className = '' }: { task: TaskRecord; className?: string }) {
  const size = getParamDisplay(task, 'size')
  const quality = getParamDisplay(task, 'quality')
  const format = getParamDisplay(task, 'output_format')
  const count = getParamDisplay(task, 'n')

  return (
    <div
      data-tag-scroll-area
      aria-label="任务参数"
      className={`flex min-w-0 gap-1.5 overflow-x-auto whitespace-nowrap ${className}`}
    >
      {(task.apiProfileName || task.apiProvider) && (
        <ParamTag label="来源" value={task.apiProfileName || task.apiProvider || '未知'} />
      )}
      {task.apiModel && <ParamTag label="模型" value={task.apiModel} />}
      <ParamTag label="尺寸" value={size.displayValue} mismatch={size.isMismatch} />
      <ParamTag label="质量" value={quality.displayValue} mismatch={quality.isMismatch} />
      <ParamTag label="格式" value={format.displayValue} mismatch={format.isMismatch} />
      <ParamTag label="数量" value={count.displayValue} mismatch={count.isMismatch} />
    </div>
  )
}
