import type { AgentRound, TaskProgressStage, TaskRecord } from '../types'
import type { LiveTaskProgress } from '../stores/runtimeStore'

export type AgentExecutionStepStatus = 'pending' | 'running' | 'done' | 'warning' | 'error' | 'stopped'
export type AgentExecutionTone = 'running' | 'success' | 'warning' | 'error'

export interface AgentExecutionStep {
  key: 'understand' | 'plan' | 'generate' | 'save'
  label: string
  detail: string
  status: AgentExecutionStepStatus
}

export interface AgentExecutionProgress {
  summary: string
  steps: AgentExecutionStep[]
  tone: AgentExecutionTone
}

export interface AgentExecutionProgressInput {
  round: AgentRound | null
  tasks: TaskRecord[]
  liveProgressByTaskId?: Record<string, LiveTaskProgress>
  hasAssistantText?: boolean
}

interface TaskProgressSummary {
  requested: number
  success: number
  failed: number
  active: number
  stage?: TaskProgressStage
  stopped: boolean
}

const STOPPED_TEXT_PATTERN = /已停止|请求中断|停止生成|任务已中止/

function isStoppedText(value: string | null | undefined) {
  return STOPPED_TEXT_PATTERN.test(value ?? '')
}

function getRequestedCount(task: TaskRecord) {
  return task.batchItemStatuses?.length || task.generationSlots?.length || task.params?.n || 1
}

function getSuccessCount(task: TaskRecord) {
  if (task.batchItemStatuses?.length) {
    return task.batchItemStatuses.filter((status) => status === 'done').length
  }
  if (task.generationSlots?.length) {
    return task.generationSlots.filter((slot) => slot.status === 'done').length
  }
  return task.outputImages?.length ?? 0
}

function getFailedCount(task: TaskRecord) {
  const requested = getRequestedCount(task)
  const success = getSuccessCount(task)
  if (task.batchItemStatuses?.length) {
    return task.batchItemStatuses.filter((status) => status === 'error').length
  }
  if (task.generationSlots?.length) {
    return task.generationSlots.filter((slot) => slot.status === 'failed').length
  }
  return task.status === 'running' ? 0 : Math.max(0, requested - success)
}

function getRunningStage(task: TaskRecord, liveProgress?: LiveTaskProgress): TaskProgressStage {
  return (
    liveProgress?.progressStage ??
    task.progressStage ??
    (task.falRequestId || task.customTaskId
      ? 'relay-received'
      : (task.outputImages?.length ?? 0) > 0
        ? 'generating'
        : 'requesting')
  )
}

function getTaskProgressSummary(
  tasks: TaskRecord[],
  liveProgressByTaskId: Record<string, LiveTaskProgress>,
): TaskProgressSummary {
  let requested = 0
  let success = 0
  let failed = 0
  let active = 0
  let stopped = false
  const runningStages = new Set<TaskProgressStage>()

  for (const task of tasks) {
    const liveProgress = liveProgressByTaskId[task.id]
    requested += getRequestedCount(task)
    success += getSuccessCount(task)
    failed += getFailedCount(task)
    if (isStoppedText(task.error) || isStoppedText(liveProgress?.progressMessage || task.progressMessage)) {
      stopped = true
    }
    if (task.status === 'running') {
      active += 1
      runningStages.add(getRunningStage(task, liveProgress))
    }
  }

  let stage: TaskProgressStage | undefined
  if (runningStages.has('saving')) stage = 'saving'
  else if (runningStages.has('generating') || runningStages.has('previewing')) stage = 'generating'
  else if (runningStages.has('relay-received')) stage = 'relay-received'
  else if (runningStages.has('requesting') || runningStages.has('queued')) stage = 'requesting'

  return { requested, success, failed, active, stage, stopped }
}

function hasWebSearchActivity(round: AgentRound | null) {
  return Boolean(round?.responseOutput?.some((item) => item.type === 'web_search_call'))
}

function hasToolActivity(round: AgentRound | null) {
  return Boolean(
    round?.responseOutput?.some(
      (item) =>
        item.type === 'web_search_call' || item.type === 'function_call' || item.type === 'image_generation_call',
    ),
  )
}

function getUnderstandStep(round: AgentRound | null): AgentExecutionStep {
  const referenceCount = round?.inputImageIds.length ?? 0
  return {
    key: 'understand',
    label: '理解需求',
    detail: referenceCount > 0 ? `已读取提示词和 ${referenceCount} 张参考图片。` : '已读取本轮提示词。',
    status: 'done',
  }
}

function getPlanStep(
  round: AgentRound | null,
  taskSummary: TaskProgressSummary,
  hasAssistantText: boolean,
): AgentExecutionStep {
  const roundFailed = round?.status === 'error'
  const stopped = roundFailed && isStoppedText(round?.error)
  const planningDone = taskSummary.requested > 0 || hasToolActivity(round) || round?.status === 'done'
  let status: AgentExecutionStepStatus = roundFailed
    ? stopped
      ? 'stopped'
      : 'error'
    : planningDone
      ? 'done'
      : 'running'
  let detail = '正在分析画面、数量和参考图关系。'

  if (taskSummary.requested > 0) {
    detail = `已确定 ${taskSummary.requested} 张图片的生成方案。`
  } else if (hasWebSearchActivity(round)) {
    detail = '已搜索参考信息，正在确定画面与生成参数。'
  } else if (hasAssistantText) {
    detail = '已整理需求，正在确定图片方案。'
  } else if (stopped) {
    detail = '规划已停止。'
  } else if (roundFailed) {
    detail = '规划失败，未能开始生成图片。'
  }

  if (round?.status === 'done' && taskSummary.requested === 0) status = 'done'
  return { key: 'plan', label: '规划图片方案', detail, status }
}

function getGenerateStep(round: AgentRound | null, taskSummary: TaskProgressSummary): AgentExecutionStep {
  const roundStopped = round?.status === 'error' && isStoppedText(round.error)
  const stopped = roundStopped || taskSummary.stopped
  let status: AgentExecutionStepStatus = 'pending'
  let detail = '等待方案确定后开始生成图片。'

  if (taskSummary.active > 0) {
    status = 'running'
    detail = `已生成 ${taskSummary.success} / ${taskSummary.requested} 张，继续等待剩余图片。`
  } else if (stopped && taskSummary.success === 0) {
    status = 'stopped'
    detail = '图片生成已停止。'
  } else if (taskSummary.failed > 0) {
    status = taskSummary.success > 0 ? 'warning' : 'error'
    detail =
      taskSummary.success > 0
        ? `已生成 ${taskSummary.success} / ${taskSummary.requested} 张，${taskSummary.failed} 张未完成。`
        : '图片生成失败，未生成图片。'
  } else if (taskSummary.requested > 0 && taskSummary.success >= taskSummary.requested) {
    status = 'done'
    detail = `已完成 ${taskSummary.success} 张图片生成。`
  } else if (round?.status === 'done') {
    status = 'done'
    detail = '本轮未生成图片。'
  } else if (round?.status === 'error') {
    status = 'error'
    detail = '图片生成未能开始。'
  }

  return { key: 'generate', label: '生成图片', detail, status }
}

function getSaveStep(round: AgentRound | null, taskSummary: TaskProgressSummary): AgentExecutionStep {
  const roundStopped = round?.status === 'error' && isStoppedText(round.error)
  const stopped = roundStopped || taskSummary.stopped
  let status: AgentExecutionStepStatus = 'pending'
  let detail = '图片生成完成后会保存到结果区。'

  if (taskSummary.active > 0) {
    status = 'pending'
  } else if (round?.status === 'done') {
    status = taskSummary.failed > 0 ? 'warning' : 'done'
    detail = taskSummary.failed
      ? `已保存 ${taskSummary.success} 张图片，${taskSummary.failed} 张未生成。`
      : taskSummary.success > 0
        ? `已保存 ${taskSummary.success} 张图片并更新本轮结果。`
        : '本轮未生成图片，已完成回复。'
  } else if (stopped) {
    status = taskSummary.success > 0 ? 'warning' : 'stopped'
    detail = taskSummary.success > 0 ? `已保留 ${taskSummary.success} 张已返回图片。` : '没有可保存的生成结果。'
  } else if (taskSummary.failed > 0 && taskSummary.success === 0) {
    status = 'error'
    detail = '没有可保存的生成结果。'
  } else if (taskSummary.failed > 0) {
    status = 'warning'
    detail = `已保留 ${taskSummary.success} 张图片，部分结果未生成。`
  } else if (taskSummary.requested > 0) {
    status = 'running'
    detail = `已保存 ${taskSummary.success} 张图片，正在更新对话记录。`
  } else if (round?.status === 'error') {
    status = 'error'
    detail = '本轮没有可保存的生成结果。'
  }

  return { key: 'save', label: '保存结果', detail, status }
}

function getSummary(
  round: AgentRound | null,
  taskSummary: TaskProgressSummary,
  hasAssistantText: boolean,
): { summary: string; tone: AgentExecutionTone } {
  const roundStopped = round?.status === 'error' && isStoppedText(round.error)
  const stopped = roundStopped || taskSummary.stopped

  if (stopped) return { summary: '已停止生成，当前结果会保留。', tone: 'warning' }
  if (round?.status === 'error') return { summary: '生成失败，已记录原因。', tone: 'error' }

  if (taskSummary.active > 0) {
    if (taskSummary.stage === 'saving') {
      return { summary: '图片已返回，正在整理并保存结果…', tone: 'running' }
    }
    if (taskSummary.stage === 'generating') {
      return {
        summary: `正在生成图片：已完成 ${taskSummary.success} / ${taskSummary.requested} 张…`,
        tone: 'running',
      }
    }
    if (taskSummary.stage === 'relay-received') {
      return { summary: '图片任务已提交，正在等待服务商返回…', tone: 'running' }
    }
    return { summary: '正在提交图片生成任务…', tone: 'running' }
  }

  if (round?.status === 'done') {
    if (taskSummary.failed > 0) {
      return {
        summary: `本轮执行完成，${taskSummary.success} / ${taskSummary.requested} 张图片生成成功。`,
        tone: 'warning',
      }
    }
    return { summary: '本轮执行完成。', tone: 'success' }
  }

  if (taskSummary.requested > 0) {
    if (taskSummary.failed > 0) {
      return taskSummary.success > 0
        ? {
            summary: `已生成 ${taskSummary.success} / ${taskSummary.requested} 张，正在整理结果…`,
            tone: 'warning',
          }
        : { summary: '图片生成失败，正在整理错误信息…', tone: 'error' }
    }
    return {
      summary: `图片已生成，正在整理 ${taskSummary.success} 张结果…`,
      tone: 'running',
    }
  }

  if (hasWebSearchActivity(round)) {
    return { summary: '正在搜索并整理参考信息，随后生成图片…', tone: 'running' }
  }
  if (hasToolActivity(round) || hasAssistantText) {
    return { summary: '正在规划图片生成方案…', tone: 'running' }
  }
  return { summary: '正在理解需求并规划图片生成方案…', tone: 'running' }
}

export function getAgentExecutionProgress({
  round,
  tasks,
  liveProgressByTaskId = {},
  hasAssistantText = false,
}: AgentExecutionProgressInput): AgentExecutionProgress | null {
  if (!round) return null
  const taskSummary = getTaskProgressSummary(tasks, liveProgressByTaskId)
  const { summary, tone } = getSummary(round, taskSummary, hasAssistantText)

  return {
    summary,
    tone,
    steps: [
      getUnderstandStep(round),
      getPlanStep(round, taskSummary, hasAssistantText),
      getGenerateStep(round, taskSummary),
      getSaveStep(round, taskSummary),
    ],
  }
}
