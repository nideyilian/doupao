export const MAX_DIRECT_INPUT_IMAGES = 100
export const MAX_FOLDER_IMAGES = 999

/**
 * 带参考图（编辑）请求的并发上限。
 * 实测部分中转站的 images/edits 接口处理慢（数十秒到数分钟/张）且并发时容易过载拒连，
 * 因此带图任务把并发压到该值，避免多请求同时打爆慢速接口后全部失败。
 */
export const MAX_REFERENCE_IMAGE_CONCURRENCY = 2

export function shouldCycleReferenceImages(
  referenceMode: 'cycle' | 'all' | undefined,
  inputImageCount: number,
  outputImageCount: number,
  folderInput = false,
) {
  return referenceMode !== 'all' && inputImageCount > 0 && (folderInput || outputImageCount > 1)
}
