import { useEffect, useRef } from 'react'
import { useStore } from '../../store'
import { useCompositeV2Store } from './storeV2'

const EXPORT_TERMINAL = new Set(['completed', 'canceled', 'failed'])
const DISTRIBUTION_TERMINAL = new Set(['completed', 'failed', 'canceled'])

/**
 * 后台导出完成提醒（常驻挂载，与后期处理弹窗是否打开无关）：
 * 整条流程（导出 + 可选分配）落定、且后期处理弹窗处于关闭状态时，
 * 弹一条全局 toast 汇总结果——用户在素材库继续工作时也能第一时间知道后台任务结束了。
 * 弹窗打开时界面内已有结果面板与成功提示条，不再重复打扰。
 */
export function ExportStatusWatcher() {
  const exportStatus = useCompositeV2Store((state) => state.exportStatus)
  const distributionStatus = useCompositeV2Store((state) => state.distributionStatus)
  const exportSuccessCount = useCompositeV2Store((state) => state.exportSuccesses.length)
  const exportFailureCount = useCompositeV2Store((state) => state.exportFailures.length)
  const distributionSuccessCount = useCompositeV2Store((state) => state.distributionSuccesses.length)
  const distributionFailureCount = useCompositeV2Store((state) => state.distributionFailures.length)
  const postprocessDialogOpen = useStore((state) => state.postprocessDialogOpen)

  // 首帧对齐（热更新/重挂载时不误报）：挂载时已在运行 → 结算时仍提示；已处于终态 → 不再提示
  const mountedRef = useRef(false)
  const previousStatusRef = useRef(exportStatus)
  // 每个「新一轮导出」递增一次（running 进入时），同一轮只提示一次
  const runIdRef = useRef(0)
  const toastedRunIdRef = useRef<number | null>(null)

  useEffect(() => {
    const status = exportStatus

    if (!mountedRef.current) {
      mountedRef.current = true
      previousStatusRef.current = status
      if (status === 'running' || status === 'paused' || status === 'canceling') {
        runIdRef.current = 1
      } else if (EXPORT_TERMINAL.has(status)) {
        toastedRunIdRef.current = runIdRef.current
      }
      return
    }

    // 新一轮导出开始：从 idle / 终态进入 running（暂停后的继续不算新轮次）
    if (status === 'running' && previousStatusRef.current !== 'running' && previousStatusRef.current !== 'paused') {
      runIdRef.current += 1
    }
    previousStatusRef.current = status

    const settled =
      EXPORT_TERMINAL.has(status) && (distributionStatus === 'idle' || DISTRIBUTION_TERMINAL.has(distributionStatus))
    if (!settled) return
    if (toastedRunIdRef.current === runIdRef.current) return
    toastedRunIdRef.current = runIdRef.current
    // 弹窗打开时界面内已有结果展示，不弹 toast
    if (postprocessDialogOpen) return

    const successCount = exportSuccessCount
    const failureCount = exportFailureCount
    let message: string
    let type: 'info' | 'success' | 'error'

    if (status === 'canceled') {
      message = `后期处理已取消：已完成 ${successCount} 张。`
      type = 'info'
    } else if (status === 'failed') {
      message = `后期处理失败：${successCount} 成功，${failureCount} 失败。`
      type = 'error'
    } else {
      message = `后期处理完成：${successCount} 成功，${failureCount} 失败。`
      type = failureCount > 0 ? 'error' : 'success'
    }
    if (distributionStatus === 'canceled') {
      message += ` 分配已取消：${distributionSuccessCount} 成功。`
    } else if (distributionStatus === 'completed' || distributionStatus === 'failed') {
      message += ` 分配：${distributionSuccessCount} 成功，${distributionFailureCount} 失败。`
    }

    useStore.getState().showToast(message, type)
  }, [
    distributionFailureCount,
    distributionStatus,
    distributionSuccessCount,
    exportFailureCount,
    exportStatus,
    exportSuccessCount,
    postprocessDialogOpen,
  ])

  return null
}
