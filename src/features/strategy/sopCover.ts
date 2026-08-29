import type { TaskRecord } from '../../types'

export interface SopCoverCandidate {
  imageId: string
  taskId: string
  promptIndex: number
  imageIndex: number
  createdAt: number
}

export function getSopCoverCandidates(sopId: string, tasks: TaskRecord[]): SopCoverCandidate[] {
  if (!sopId) return []

  const seen = new Set<string>()
  return [...tasks]
    .filter((task) => task.sopBatch?.sopId === sopId && task.outputImages.length > 0)
    .sort((a, b) => b.createdAt - a.createdAt)
    .flatMap((task) =>
      task.outputImages.map((imageId, imageIndex) => ({
        imageId,
        taskId: task.id,
        promptIndex: task.sopBatch?.promptIndex ?? 1,
        imageIndex: imageIndex + 1,
        createdAt: task.createdAt,
      })),
    )
    .filter((candidate) => {
      if (seen.has(candidate.imageId)) return false
      seen.add(candidate.imageId)
      return true
    })
}
