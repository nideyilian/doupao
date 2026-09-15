import type { TaskRecord } from '../types'

/**
 * 系列组图的「首图锚定」。
 *
 * 组内每个画面都是独立的文生图请求，仅靠提示词文字描述无法锁住画风、构图骨架与排版，
 * 因此组内第 1 张画面生成后，把它作为后续成员的参考图（图生图）提交，让图片模型
 * 直接以首图为视觉基准，只替换主体与背景。
 */
export const SOP_SERIES_ANCHOR_TIMEOUT_MS = 180_000
export const SOP_SERIES_ANCHOR_POLL_MS = 800

/**
 * 锚定提示词前缀：明确参考图只用于锁定视觉规范，避免模型整图照抄首图，
 * 也避免它忽略提示词里已经写明的本张画面内容。
 */
export const SOP_SERIES_ANCHOR_INSTRUCTION =
  '参考图仅用于锁定本系列的视觉风格、构图骨架、排版结构与色彩体系；请按下述描述替换主体与背景，保持画风与版式不变。'

export function buildSopSeriesAnchoredPrompt(prompt: string) {
  const text = prompt.trim()
  return text ? `${SOP_SERIES_ANCHOR_INSTRUCTION}\n${text}` : text
}

/** 取任务的首张产出图作为锚定参考图；尚未出图或已失败时返回 null。 */
export function getSopSeriesAnchorImageId(task: TaskRecord | undefined | null) {
  return task?.outputImages?.[0] ?? null
}

export function isTaskSettled(task: TaskRecord | undefined | null) {
  if (!task) return false
  if (task.status === 'running' || task.falRecoverable || task.customRecoverable) return false
  return true
}

/**
 * 等待指定任务产出首张图片。返回图片 id，等待超时 / 任务失败 / 被取消时返回 null
 * ——调用方据此降级为「无参考图提交」，不能因为锚定失败卡死整批任务。
 */
export function waitForSopSeriesAnchor(options: {
  taskId: string
  getTask: (taskId: string) => TaskRecord | undefined | null
  timeoutMs?: number
  pollMs?: number
  signal?: AbortSignal
}): Promise<string | null> {
  const {
    taskId,
    getTask,
    timeoutMs = SOP_SERIES_ANCHOR_TIMEOUT_MS,
    pollMs = SOP_SERIES_ANCHOR_POLL_MS,
    signal,
  } = options

  return new Promise((resolve) => {
    const startedAt = Date.now()
    let timer: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
      if (timer != null) clearTimeout(timer)
      timer = null
      signal?.removeEventListener('abort', onAbort)
    }
    const finish = (imageId: string | null) => {
      cleanup()
      resolve(imageId)
    }
    const onAbort = () => finish(null)
    const tick = () => {
      if (signal?.aborted) return finish(null)
      const task = getTask(taskId)
      const imageId = getSopSeriesAnchorImageId(task)
      if (imageId) return finish(imageId)
      if (isTaskSettled(task)) return finish(null)
      if (Date.now() - startedAt >= timeoutMs) return finish(null)
      timer = setTimeout(tick, pollMs)
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    tick()
  })
}
