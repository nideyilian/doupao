import { useEffect, useRef, useState } from 'react'
import type { TaskParams, TaskRecord } from '../types'
import ViewportTooltip from '../components/ViewportTooltip'

type ParamKey = keyof TaskParams

interface ParamValueProps {
  task: TaskRecord
  paramKey: ParamKey
  className?: string
  actualParams?: Partial<TaskParams>
}

interface ActualValueBadgeProps {
  value: string
  className?: string
  variant?: 'highlight' | 'normal'
}

export function ActualValueBadge({ value, className = '', variant = 'highlight' }: ActualValueBadgeProps) {
  const [tooltipVisible, setTooltipVisible] = useState(false)
  const touchTimerRef = useRef<number | null>(null)
  const colorClass =
    variant === 'normal'
      ? 'bg-ds-surface text-ds-muted dark:bg-ds-surface dark:text-ds-muted'
      : 'bg-ds-warning-subtle text-ds-warning dark:bg-ds-warning/20 dark:text-ds-warning'

  useEffect(
    () => () => {
      if (touchTimerRef.current != null) window.clearTimeout(touchTimerRef.current)
    },
    [],
  )

  const clearTouchTimer = () => {
    if (touchTimerRef.current != null) {
      window.clearTimeout(touchTimerRef.current)
      touchTimerRef.current = null
    }
  }

  return (
    <span
      className={`relative inline-flex cursor-help ${colorClass} ${className}`}
      role="button"
      tabIndex={0}
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
      onFocus={() => setTooltipVisible(true)}
      onBlur={() => setTooltipVisible(false)}
      onClick={() => setTooltipVisible(true)}
      onTouchStart={() => {
        clearTouchTimer()
        touchTimerRef.current = window.setTimeout(() => {
          setTooltipVisible(true)
          touchTimerRef.current = null
        }, 450)
      }}
      onTouchEnd={clearTouchTimer}
      onTouchCancel={clearTouchTimer}
    >
      {value}
      <ViewportTooltip visible={tooltipVisible} className="whitespace-nowrap">
        API 实际响应值
      </ViewportTooltip>
    </span>
  )
}

export function getParamDisplay(
  task: TaskRecord,
  paramKey: ParamKey,
  actualParams = task.actualParams,
  ignoreActualParams = false,
) {
  const requestedValue = task.sourceMode === 'agent' && paramKey === 'n' ? 'auto' : task.params[paramKey]
  const actualValue = ignoreActualParams ? undefined : actualParams?.[paramKey]
  const hasActualValue = actualValue !== undefined && actualValue !== null
  const displayValue = hasActualValue ? actualValue : requestedValue
  const isMismatch = hasActualValue && requestedValue !== 'auto' && String(actualValue) !== String(requestedValue)

  return {
    displayValue: String(displayValue),
    isMismatch,
    requestedValue: String(requestedValue),
    isAutoResolved: hasActualValue && requestedValue === 'auto' && String(actualValue) !== String(requestedValue),
  }
}

export function ParamValue({ task, paramKey, className = '', actualParams }: ParamValueProps) {
  const { displayValue, isMismatch } = getParamDisplay(task, paramKey, actualParams)

  if (isMismatch) {
    return <ActualValueBadge value={displayValue} className={className} />
  }

  return (
    <span className={`${className} bg-ds-surface text-ds-muted dark:bg-ds-surface dark:text-ds-muted`}>
      {displayValue}
    </span>
  )
}

export function DetailParamValue({ task, paramKey, className = '', actualParams }: ParamValueProps) {
  const { displayValue, isMismatch, requestedValue, isAutoResolved } = getParamDisplay(task, paramKey, actualParams)

  if (!isMismatch) {
    if (isAutoResolved) {
      return (
        <span className={`inline-flex items-center gap-1 ${className}`}>
          <span className="text-ds-text dark:text-ds-muted">{requestedValue}</span>
          <span className="text-ds-text-subtle dark:text-ds-muted">|</span>
          <ActualValueBadge value={displayValue} variant="normal" className="rounded px-1 py-0.5" />
        </span>
      )
    }
    return <span className={`text-ds-text dark:text-ds-muted ${className}`}>{displayValue}</span>
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span className="text-ds-text dark:text-ds-muted">{requestedValue}</span>
      <span className="text-ds-text-subtle dark:text-ds-muted">|</span>
      <ActualValueBadge value={displayValue} className="rounded px-1 py-0.5" />
    </span>
  )
}
