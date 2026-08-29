import type { TaskRecord, WorkspaceTab } from '../../types'
import { getAllTasks } from '../db'
import { upsertFromTask } from '../assetLibraryRepository'
import { getTaskSourceMode } from '../generatedAssetOrigin'
import { runMigration, type MigrationJournalStore } from './registry'

export const GENERATED_ASSET_LIBRARY_MIGRATION_ID = 'generated-asset-library-v1'

export const GENERATED_ASSET_LIBRARY_BATCH_SIZE = 100

function cursorFor(task: TaskRecord): string {
  return `${task.createdAt}:${task.id}`
}

function splitCursor(cursor: string): { createdAt: number; taskId: string } {
  const separator = cursor.indexOf(':')
  const createdAt = Number(cursor.slice(0, separator))
  const taskId = separator >= 0 ? cursor.slice(separator + 1) : ''
  return { createdAt: Number.isFinite(createdAt) ? createdAt : 0, taskId }
}

export interface GeneratedAssetLibraryMigrationOptions {
  tasks?: TaskRecord[]
  workspaceTabs?: WorkspaceTab[]
  /** 收藏影子任务不追加来源，避免详情中出现伪重复来源。 */
  shadowTaskIds?: ReadonlySet<string>
  onProgress?: (processed: number, total: number) => void
}

/**
 * 历史任务 → 素材回填迁移。
 * - 按 createdAt 升序，每 100 个任务 checkpoint，崩溃后从游标续跑。
 * - upsertFromTask 幂等，二次运行不会产生重复来源。
 * - 墓碑阻止任务早于永久删除时间的素材复活。
 */
export function runGeneratedAssetLibraryMigration(
  journalStore: MigrationJournalStore,
  options: GeneratedAssetLibraryMigrationOptions = {},
): Promise<void> {
  return runMigration(GENERATED_ASSET_LIBRARY_MIGRATION_ID, journalStore, async (context) => {
    const tasks = options.tasks ?? (await getAllTasks())
    if (tasks.length === 0) return
    const ordered = [...tasks].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))

    let startIndex = 0
    if (context.cursor) {
      const { createdAt, taskId } = splitCursor(context.cursor)
      // checkpoint 写的是最后一个已成功任务，续跑需从它之后开始
      const found = ordered.findIndex(
        (task) => task.createdAt > createdAt || (task.createdAt === createdAt && task.id > taskId),
      )
      startIndex = found >= 0 ? found : ordered.length
    }

    const tabByTaskId = new Map<string, WorkspaceTab>()
    for (const tab of options.workspaceTabs ?? []) {
      for (const task of tab.tasks) tabByTaskId.set(task.id, tab)
      for (const taskId of tab._taskIds ?? []) {
        if (!tabByTaskId.has(taskId)) tabByTaskId.set(taskId, tab)
      }
    }

    let processedSinceCheckpoint = 0
    for (let index = startIndex; index < ordered.length; index++) {
      const task = ordered[index]
      if (options.shadowTaskIds?.has(task.id)) continue
      const tab = tabByTaskId.get(task.id)
      await upsertFromTask(task, {
        sourceMode: getTaskSourceMode(task),
        workspaceTabId: tab?.id,
        workspaceTabName: tab?.name,
      })
      processedSinceCheckpoint++
      if (processedSinceCheckpoint >= GENERATED_ASSET_LIBRARY_BATCH_SIZE) {
        await context.checkpoint(cursorFor(task))
        processedSinceCheckpoint = 0
      }
      options.onProgress?.(index + 1, ordered.length)
    }
  })
}
