import { create } from 'zustand'
import type { TaskProgressStage } from '../types'

export type LiveTaskProgress = {
  progressStage?: TaskProgressStage
  progressMessage?: string
  progressUpdatedAt?: number
}

type RuntimeStore = {
  streamPreviews: Record<string, string>
  streamPreviewSlots: Record<string, Record<string, string>>
  setTaskStreamPreview(taskId: string, image?: string, requestIndex?: number): void
  agentStreamingTexts: Record<string, string>
  setAgentStreamingText(conversationId: string, messageId: string, text: string): void
  clearAgentStreamingText(conversationId: string, messageId?: string): void
  // 高频瞬态进度：生成期间每次进度 tick 只更新这里，不重建 tasks 数组、
  // 不写 IndexedDB，避免所有 s.tasks 订阅者随进度无谓重渲染。
  taskProgress: Record<string, LiveTaskProgress>
  setTaskProgress(taskId: string, progress: LiveTaskProgress): void
  clearTaskProgress(taskId: string): void
}

export const useRuntimeStore = create<RuntimeStore>()((set) => ({
  streamPreviews: {},
  streamPreviewSlots: {},
  setTaskStreamPreview: (taskId, image, requestIndex = 0) =>
    set((state) => {
      if (image) {
        const slotKey = String(requestIndex)
        const currentSlots = state.streamPreviewSlots[taskId] ?? {}
        if (state.streamPreviews[taskId] === image && currentSlots[slotKey] === image) return state
        return {
          streamPreviews: { ...state.streamPreviews, [taskId]: image },
          streamPreviewSlots: {
            ...state.streamPreviewSlots,
            [taskId]: { ...currentSlots, [slotKey]: image },
          },
        }
      }

      if (!(taskId in state.streamPreviews) && !(taskId in state.streamPreviewSlots)) return state
      const streamPreviews = { ...state.streamPreviews }
      const streamPreviewSlots = { ...state.streamPreviewSlots }
      delete streamPreviews[taskId]
      delete streamPreviewSlots[taskId]
      return { streamPreviews, streamPreviewSlots }
    }),
  agentStreamingTexts: {},
  setAgentStreamingText: (conversationId, messageId, text) =>
    set((state) => ({
      agentStreamingTexts: {
        ...state.agentStreamingTexts,
        [`${conversationId}:${messageId}`]: text,
      },
    })),
  clearAgentStreamingText: (conversationId, messageId) =>
    set((state) => {
      const keyPrefix = messageId ? `${conversationId}:${messageId}` : `${conversationId}:`
      const agentStreamingTexts = { ...state.agentStreamingTexts }
      if (messageId) {
        delete agentStreamingTexts[`${conversationId}:${messageId}`]
      } else {
        for (const key of Object.keys(agentStreamingTexts)) {
          if (key.startsWith(keyPrefix)) delete agentStreamingTexts[key]
        }
      }
      return { agentStreamingTexts }
    }),
  taskProgress: {},
  setTaskProgress: (taskId, progress) =>
    set((state) => {
      const current = state.taskProgress[taskId]
      if (
        current &&
        current.progressStage === progress.progressStage &&
        current.progressMessage === progress.progressMessage &&
        current.progressUpdatedAt === progress.progressUpdatedAt
      ) {
        return state
      }
      return {
        taskProgress: {
          ...state.taskProgress,
          [taskId]: { ...current, ...progress },
        },
      }
    }),
  clearTaskProgress: (taskId) =>
    set((state) => {
      if (!(taskId in state.taskProgress)) return state
      const taskProgress = { ...state.taskProgress }
      delete taskProgress[taskId]
      return { taskProgress }
    }),
}))
