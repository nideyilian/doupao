import type { SopBatchSnapshot, TaskRecord } from '../../../types'

export type PromptRunImageLink = {
  imageId: string
  promptId: string
  revisedPrompt?: string
  taskId: string
  taskPrompt: string
}

export function getPromptRunImageLinks(run: SopBatchSnapshot, tasks: TaskRecord[]) {
  const promptIds = new Set(run.prompts.map((prompt) => prompt.id))
  const orderedPromptIds = run.prompts
    .filter((prompt) => !prompt.deleted && prompt.text.trim())
    .map((prompt) => prompt.id)
  const knownTaskIds = new Set(run.taskIds ?? [])

  return tasks.flatMap((task) => {
    const isLinked = task.sopBatch?.snapshotId ? task.sopBatch.snapshotId === run.id : knownTaskIds.has(task.id)
    if (!isLinked) return []

    const promptId = task.sopBatch?.promptId ?? orderedPromptIds[Math.max(0, (task.sopBatch?.promptIndex ?? 1) - 1)]
    if (!promptId || !promptIds.has(promptId)) return []

    return task.outputImages.map((imageId) => ({
      imageId,
      promptId,
      revisedPrompt: task.revisedPromptByImage?.[imageId]?.trim() || undefined,
      taskId: task.id,
      taskPrompt: task.prompt,
    }))
  })
}
