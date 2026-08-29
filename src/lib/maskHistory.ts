const MAX_HISTORY_STEPS = 40
const MAX_MASK_HISTORY_BYTES = 96 * 1024 * 1024

export function getMaskHistoryLimit(width: number, height: number): number {
  const snapshotBytes = Math.max(1, width * height * 4)
  return Math.max(1, Math.min(MAX_HISTORY_STEPS, Math.floor(MAX_MASK_HISTORY_BYTES / snapshotBytes)))
}
