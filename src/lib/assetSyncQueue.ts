import type { TaskRecord } from '../types'

export interface AssetSyncDeps {
  /** 读取 taskId 对应的最新任务快照；读取失败返回 undefined 由调用方决定。 */
  getTask: (taskId: string) => Promise<TaskRecord | undefined>
  /** 将任务输出同步到素材库。 */
  syncTask: (task: TaskRecord) => Promise<void>
  /** 单个任务同步失败时回调；不中断队列。 */
  onError?: (taskId: string, error: unknown) => void
}

export interface AssetSyncQueue {
  enqueue: (taskId: string) => void
  /** 等待当前已入队任务全部处理完成；用于测试与页面卸载前的尽力收尾。 */
  flush: () => Promise<void>
  readonly pendingCount: number
}

/**
 * 素材同步队列：串行执行，按 taskId 合并。
 * 同一任务在流式、多图并发和参数回填期间会多次 enqueue，只处理最新快照。
 */
export function createAssetSyncQueue(deps: AssetSyncDeps): AssetSyncQueue {
  const pendingTaskIds = new Set<string>()
  let running = false
  let drainScheduled = false
  let flushWaiters: Array<() => void> = []

  async function drain() {
    if (running) return
    running = true
    try {
      while (pendingTaskIds.size > 0) {
        const taskId = pendingTaskIds.values().next().value as string
        pendingTaskIds.delete(taskId)
        try {
          const task = await deps.getTask(taskId)
          if (task) await deps.syncTask(task)
        } catch (error) {
          deps.onError?.(taskId, error)
        }
      }
    } finally {
      running = false
      const waiters = flushWaiters
      flushWaiters = []
      for (const resolve of waiters) resolve()
    }
  }

  /** 延迟到下一个微任务再启动，保证同一宏任务内的多次 enqueue 合并为一批。 */
  function scheduleDrain() {
    if (drainScheduled) return
    drainScheduled = true
    queueMicrotask(() => {
      drainScheduled = false
      void drain()
    })
  }

  function enqueue(taskId: string) {
    pendingTaskIds.add(taskId)
    scheduleDrain()
  }

  function flush(): Promise<void> {
    if (!running && pendingTaskIds.size === 0) return Promise.resolve()
    return new Promise((resolve) => {
      flushWaiters.push(resolve)
      scheduleDrain()
    })
  }

  return {
    enqueue,
    flush,
    get pendingCount() {
      return pendingTaskIds.size
    },
  }
}
