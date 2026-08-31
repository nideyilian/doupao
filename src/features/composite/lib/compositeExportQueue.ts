import { runCompositeV2Export } from './compositeExportRuntime'
import { runDistribution } from './compositeDistribution'
import { useCompositeV2Store } from '../storeV2'
import { useStore } from '../../../store'
import type { CompositeV2ExportQueueItem } from './compositeExportPlan'
import type {
  CompositeV2DistributionFailureItem,
  CompositeV2DistributionSuccessItem,
  CompositeV2FailureItem,
  CompositeV2SuccessItem,
} from './compositeV2Types'

/**
 * 后台导出队列泵：
 * 点击「开始导出」只负责把任务送入队列（任务「已发送」），UI 立即恢复，可继续配置并发送下一个任务；
 * 本泵按入队顺序在后台逐个执行，一次只跑一个任务（渲染/写盘互不争抢）。
 * 泵是模块级单例（组件卸载、弹窗关闭都不影响），与结果面板共享 store 中的「当前任务」槽位。
 * 注意：模块顶层静态导入（不循环依赖），保证入队后首个任务的激活更新与点击同帧完成。
 */

/** 弹窗打开时相邻两个任务之间的停留时长：让用户看清上一任务的完成状态与成功提示条 */
const INTER_ITEM_PAUSE_MS = 900

let pumpRunning = false

export function pumpExportQueue(): void {
  if (pumpRunning) return
  pumpRunning = true
  void (async () => {
    try {
      while (true) {
        const item = useCompositeV2Store.getState().exportQueue.find((entry) => entry.status === 'queued')
        if (!item) break
        try {
          await runQueueItem(item)
        } catch (error) {
          console.error('后台导出任务执行失败：', error)
        }
        // 弹窗打开时稍作停留（弹窗关闭时后台任务连续执行，不等待）
        if (useStore.getState().postprocessDialogOpen) {
          await new Promise((resolve) => setTimeout(resolve, INTER_ITEM_PAUSE_MS))
        }
      }
    } finally {
      pumpRunning = false
    }
  })()
}

/**
 * 执行单个队列任务：激活「当前任务」面板槽位（进度/任务流/结果），
 * 跑导出 → 可选分配 → 写入历史记录，最后从队列移除。
 */
async function runQueueItem(item: CompositeV2ExportQueueItem): Promise<void> {
  const store = () => useCompositeV2Store.getState()
  store().updateExportQueueItem(item.id, { status: 'running' })

  // —— 激活当前任务的面板状态（与旧版点击「开始导出」一致）——
  store().resetExportResults()
  store().resetDistributionResults()
  store().setDistributionStatus('idle')
  store().setExportTasks(item.tasks)
  store().setExportCancelRequested(false)
  store().setDistributionCancelRequested(false)
  store().setExportStatus('running')
  store().setExportProgress(0, item.tasks.length)
  store().setExportStatusText('正在导出...')

  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  const successes: CompositeV2SuccessItem[] = []
  const failures: CompositeV2FailureItem[] = []
  try {
    await runCompositeV2Export(item.snapshot, {
      onProgress: (completed, total) => store().setExportProgress(completed, total),
      onSuccess: (success) => {
        successes.push(success)
        store().addExportSuccess(success)
        store().updateExportTask(`${success.presetId}|${success.channel}|${success.size}|${success.index}`, {
          status: 'done',
          outputPath: success.path,
        })
      },
      onFailure: (failure) => {
        failures.push(failure)
        store().addExportFailure(failure)
        store().updateExportTask(`${failure.presetId}|${failure.channel}|${failure.size}|${failure.index ?? ''}`, {
          status: 'failed',
          reason: failure.reason,
        })
      },
      shouldPause: () => store().exportStatus === 'paused',
      shouldCancel: () => store().exportCancelRequested,
    })
    const canceled = store().exportCancelRequested
    store().setExportStatus(canceled ? 'canceled' : 'completed')

    let finalStatusText = canceled ? '导出已取消。' : `导出完成：${successes.length} 成功，${failures.length} 失败。`

    // 自动分配（按发送时刻捕获的分配配置执行）
    let distributionStatus: 'pending' | 'running' | 'completed' | 'failed' | 'canceled' | undefined
    let distributionSuccessCount = 0
    let distributionFailureCount = 0
    let distributionErrors: string[] = []
    const distributionSuccesses: CompositeV2DistributionSuccessItem[] = []
    const distributionFailures: CompositeV2DistributionFailureItem[] = []

    if (!canceled && item.distributionConfig.enabled && successes.length > 0 && api) {
      if (!item.distributionConfig.startDate || !/^(\d{4})(\d{2})(\d{2})$/.test(item.distributionConfig.startDate)) {
        finalStatusText += `\n分配跳过：起始日期格式错误（期望 YYYYMMDD）。`
        distributionStatus = 'failed'
        distributionErrors.push('起始日期格式错误，期望 YYYYMMDD')
      } else {
        store().setExportStatusText('正在执行分配...')
        distributionStatus = 'running'
        store().setDistributionStatus('running')
        const distResult = await runDistribution(successes, item.distributionConfig, api, item.snapshot.presets, {
          onProgress: (completed, total) => store().setDistributionProgress(completed, total),
          onSuccess: (distItem) => {
            distributionSuccesses.push(distItem)
            store().addDistributionSuccess(distItem)
          },
          onFailure: (distItem) => {
            distributionFailures.push(distItem)
            store().addDistributionFailure(distItem)
          },
          shouldCancel: () => store().distributionCancelRequested,
        })
        distributionSuccessCount = distResult.success
        distributionFailureCount = distResult.failed
        distributionErrors = distResult.errors
        if (distResult.canceled) {
          distributionStatus = 'canceled'
          store().setDistributionStatus('canceled')
          finalStatusText += `\n分配已取消：已完成 ${distributionSuccessCount} 个。`
        } else {
          distributionStatus = distResult.errors.length > 0 && distResult.success === 0 ? 'failed' : 'completed'
          store().setDistributionStatus(distributionStatus)
          finalStatusText += `\n分配完成：${distributionSuccessCount} 成功，${distributionFailureCount} 失败。`
        }
        if (distResult.errors.length > 0) {
          console.error('分发错误：', distResult.errors)
        }
      }
    }

    store().setExportStatusText(finalStatusText)

    store().addHistoryRecord({
      id: item.id,
      status: canceled ? 'canceled' : failures.length ? 'completed-with-failures' : 'completed',
      startedAt: item.startedAt,
      endedAt: Date.now(),
      backgroundFolders: item.meta.backgroundFolders,
      recursive: item.meta.recursive,
      backgroundCount: item.meta.backgroundCount,
      presetGroupName: item.meta.presetGroupName,
      enabledPresetCount: item.meta.enabledPresetCount,
      plannedCount: item.meta.plannedCount,
      successCount: successes.length,
      failureCount: failures.length,
      successes,
      failures,
      distributionStatus,
      distributionSuccessCount,
      distributionFailureCount,
      distributionErrors,
      distributionSuccesses,
      distributionFailures,
    })
  } catch (error) {
    store().setExportStatus('failed')
    store().setExportStatusText(error instanceof Error ? error.message : '导出运行失败。')
  } finally {
    store().removeExportQueueItem(item.id)
  }
}
