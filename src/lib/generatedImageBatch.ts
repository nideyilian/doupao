import type { TaskRecord, WorkspaceTab } from '../types'
import { formatGeneratedImageDate } from './generatedImageFilename'

type BatchTask = Pick<
  TaskRecord,
  'id' | 'createdAt' | 'filenameBatch' | 'scheduledOutputPath' | 'scheduledOutputSubFolder'
>

export function normalizeGeneratedImageBatch(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

export function getNextGeneratedImageBatch(
  tasks: Pick<BatchTask, 'createdAt' | 'filenameBatch'>[],
  createdAt: number,
): number {
  const date = formatGeneratedImageDate(createdAt)
  return (
    tasks.reduce((maximum, task) => {
      if (formatGeneratedImageDate(task.createdAt) !== date) return maximum
      return Math.max(maximum, normalizeGeneratedImageBatch(task.filenameBatch) ?? 0)
    }, 0) + 1
  )
}

export function assignMissingGeneratedImageBatches(
  tasks: TaskRecord[],
  workspaceTabs: WorkspaceTab[],
): { tasks: TaskRecord[]; changedTaskIds: string[] } {
  const scopeByTaskId = new Map<string, string>()
  for (const tab of workspaceTabs) {
    for (const task of tab.tasks) {
      if (!scopeByTaskId.has(task.id)) scopeByTaskId.set(task.id, `tab:${tab.id}`)
    }
  }

  const groupKey = (task: BatchTask) => {
    const fallback = task.scheduledOutputSubFolder ?? getPathBaseName(task.scheduledOutputPath) ?? 'image'
    const scope = scopeByTaskId.get(task.id) ?? `fallback:${fallback}`
    return `${scope}\0${formatGeneratedImageDate(task.createdAt)}`
  }

  const maximumByGroup = new Map<string, number>()
  for (const task of tasks) {
    const batch = normalizeGeneratedImageBatch(task.filenameBatch)
    if (!batch) continue
    const key = groupKey(task)
    maximumByGroup.set(key, Math.max(maximumByGroup.get(key) ?? 0, batch))
  }

  const assignedByTaskId = new Map<string, number>()
  const missing = tasks
    .filter((task) => !normalizeGeneratedImageBatch(task.filenameBatch))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))

  for (const task of missing) {
    const key = groupKey(task)
    const batch = (maximumByGroup.get(key) ?? 0) + 1
    maximumByGroup.set(key, batch)
    assignedByTaskId.set(task.id, batch)
  }

  return {
    tasks: tasks.map((task) => {
      const batch = assignedByTaskId.get(task.id)
      return batch ? { ...task, filenameBatch: batch } : task
    }),
    changedTaskIds: [...assignedByTaskId.keys()],
  }
}

function getPathBaseName(value?: string): string | null {
  if (!value) return null
  const parts = value
    .trim()
    .replace(/[\\/]+$/, '')
    .split(/[\\/]+/)
    .filter(Boolean)
  return parts[parts.length - 1] || null
}
