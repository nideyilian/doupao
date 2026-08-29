import type { GeneratedAsset, StoredImage } from '../types'
import { isElectron } from './localSave'

type ExportTaskRefs = {
  inputImageIds?: string[]
  maskImageId?: string | null
  outputImages?: string[]
  streamPartialImageIds?: string[]
}

type ExportConversationRefs = { rounds?: Array<{ inputImageIds?: string[] }> }

type ExportWorkspaceRefs = {
  inputImages?: Array<{ id: string }>
  inputImageFolder?: { imageIds?: string[] } | null
  maskDraft?: { targetImageId?: string } | null
  maskEditorImageId?: string | null
}

export function collectReferencedExportImageIds(
  tasks: ExportTaskRefs[],
  conversations: ExportConversationRefs[],
  workspaceTabs: ExportWorkspaceRefs[] = [],
  assets: GeneratedAsset[] = [],
): string[] {
  const ids = new Set<string>()
  const add = (values?: string[]) => values?.forEach((id) => id && ids.add(id))
  for (const task of tasks) {
    add(task.inputImageIds)
    if (task.maskImageId) ids.add(task.maskImageId)
    add(task.outputImages)
    add(task.streamPartialImageIds)
  }
  for (const conversation of conversations) {
    for (const round of conversation.rounds ?? []) add(round.inputImageIds)
  }
  for (const tab of workspaceTabs) {
    add(tab.inputImages?.map((image) => image.id))
    add(tab.inputImageFolder?.imageIds)
    if (tab.maskDraft?.targetImageId) ids.add(tab.maskDraft.targetImageId)
    if (tab.maskEditorImageId) ids.add(tab.maskEditorImageId)
  }
  for (const asset of assets) {
    ids.add(asset.imageId)
    for (const origin of asset.origins) {
      add(origin.inputImageIds)
      if (origin.maskTargetImageId) ids.add(origin.maskTargetImageId)
      if (origin.maskImageId) ids.add(origin.maskImageId)
    }
  }
  return [...ids]
}

export type ElectronImageExportEntry = {
  imageId: string
  sourcePath: string
  archivePath: string
  createdAt?: number
}

export type ElectronImageExportPlan = {
  entries: ElectronImageExportEntry[]
  /** 因记录缺失 / 无本地文件且无法保存 / 格式不受支持而被跳过的图片数。 */
  omittedCount: number
}

/**
 * 为备份导出准备图片条目。
 * 单张图片缺失（IndexedDB 无记录 / 无本地文件且 dataUrl 不可用 / 格式异常）时**跳过**而不是中断整批导出——
 * 备份必须尽量完整可用；个别丢失的图片不应让用户无法导出任何数据。
 * 跳过数量通过 omittedCount 返回，由调用方在结果提示中告知用户。
 */
export async function buildElectronImageExportEntries(
  ids: string[],
  getImage: (id: string) => Promise<StoredImage | undefined>,
): Promise<ElectronImageExportPlan> {
  const entries: ElectronImageExportEntry[] = []
  let omittedCount = 0
  // 动态导入避免循环依赖
  const { saveRawCacheImageToLocal } = await import('./localSave')
  for (const id of ids) {
    const image = await getImage(id)
    if (!image) {
      // 记录已不存在（历史数据丢失/清理）：跳过并计数，不阻塞整批导出
      omittedCount++
      continue
    }
    let localPath = image.localPath
    // 如果尚未迁移到本地文件，尝试从 dataUrl 就地保存
    if (!localPath && image.dataUrl && isElectron()) {
      localPath = (await saveRawCacheImageToLocal(id, image.dataUrl)) || undefined
    }
    if (!localPath) {
      // 既没有本地文件也没有 dataUrl，跳过该图片（继续导出其余内容）
      omittedCount++
      continue
    }
    const match = localPath.match(/\.([a-zA-Z0-9]+)$/)
    const ext = match?.[1].toLowerCase()
    if (!ext || !['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      // 个别文件格式异常不阻塞整批导出
      omittedCount++
      continue
    }
    entries.push({
      imageId: id,
      sourcePath: localPath,
      archivePath: `images/${id}.${ext}`,
      createdAt: image.createdAt,
    })
  }
  return { entries, omittedCount }
}
