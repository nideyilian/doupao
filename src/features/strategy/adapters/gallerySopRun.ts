export type GallerySopBatchStatus = 'idle' | 'generating' | 'paused' | 'ready' | 'submitting' | 'success' | 'error'

export type GallerySopRunStatus = {
  workspaceTabId: string | null
  phase: GallerySopBatchStatus
  message: string
  promptCount: number
  availablePrompts: number
  totalImages: number
  failed: number
}

/**
 * SOP 批次运行草稿的持久化键。
 *
 * 隔离维度 = 工作区标签页 + 素材库文件夹：同一标签页内在不同文件夹选择 SOP 生成，
 * 各自持有独立的草稿与运行状态，互不打断（folderKey 为空时退化为仅按标签页隔离，
 * 兼容旧数据）。
 */
export function getGallerySopPromptRunStorageKey(tabId: string | null, folderKey?: string) {
  const tab = tabId ?? 'default'
  const folder = folderKey ? `.${encodeURIComponent(folderKey)}` : ''
  return `doupao.gallery-sop-prompt-run.${tab}${folder}`
}
