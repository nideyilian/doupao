import { useEffect, useRef } from 'react'
import type { TaskRecord } from '../types'
import { useStore } from '../store'
import { formatDateKey, getDueScheduleItemIds, getScheduleCompletionAction, getWeekStartDate } from '../lib/schedule'

const SCHEDULE_TICK_MS = 30_000

export default function ScheduleRunner() {
  const runningRef = useRef(false)
  const runningWeekStarts = useStore((s) => s.schedule.runningWeekStarts)
  const runningWeekStartsKey = runningWeekStarts.join('|')

  useEffect(() => {
    let cancelled = false

    const tick = async () => {
      if (runningRef.current || cancelled) return
      runningRef.current = true
      try {
        const state = useStore.getState()
        for (const item of state.schedule.items) {
          if (item.status !== 'running' || !item.lastTaskIds?.length) continue
          const relatedTasks = item.lastTaskIds.map((taskId) => state.tasks.find((task) => task.id === taskId))
          if (relatedTasks.some((task) => !task)) continue
          const existingRelatedTasks = relatedTasks.filter((task): task is TaskRecord => Boolean(task))
          const action = getScheduleCompletionAction(item, existingRelatedTasks)
          if (action.type === 'done') {
            state.updateScheduleItem(item.id, { status: 'done', lastError: undefined })
          } else if (action.type === 'supplement') {
            await useStore.getState().runScheduleItem(item.id, new Date(), action.count, true)
          } else if (action.type === 'error') {
            state.updateScheduleItem(item.id, { status: 'error', lastError: action.error })
            useStore.getState().showToast(`定时任务执行失败：${action.error}`, 'error')
          }
        }

        const latest = useStore.getState()
        const now = new Date()
        const todayWeekStart = formatDateKey(getWeekStartDate(now))
        if (!latest.schedule.runningWeekStarts.includes(todayWeekStart)) return
        const dueIds = getDueScheduleItemIds(latest.schedule.items, latest.schedule.rows, now)
        for (const id of dueIds) {
          if (cancelled) break
          await useStore.getState().runScheduleItem(id)
        }
      } finally {
        runningRef.current = false
      }
    }

    void tick()
    const interval = window.setInterval(() => void tick(), SCHEDULE_TICK_MS)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [runningWeekStartsKey])

  return null
}
