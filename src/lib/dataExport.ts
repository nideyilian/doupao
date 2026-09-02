import type { ExportData, GeneratedAsset, StoredImage } from '../types'
import { isElectron } from './localSave'

type ExportTaskRefs = {
  inputImageIds?: string[]
  maskImageId?: string | null
  outputImages?: string[]
  streamPartialImageIds?: string[]
}

type ExportConversationRefs = {
  rounds?: Array<{ inputImageIds?: string[]; maskTargetImageId?: string | null; maskImageId?: string | null }>
  messages?: Array<{ inputImageIds?: string[]; maskTargetImageId?: string | null; maskImageId?: string | null }>
}

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
    for (const round of conversation.rounds ?? []) {
      add(round.inputImageIds)
      if (round.maskTargetImageId) ids.add(round.maskTargetImageId)
      if (round.maskImageId) ids.add(round.maskImageId)
    }
    for (const message of conversation.messages ?? []) {
      add(message.inputImageIds)
      if (message.maskTargetImageId) ids.add(message.maskTargetImageId)
      if (message.maskImageId) ids.add(message.maskImageId)
    }
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
  /** 因记录缺失 / 无本地文件且无法保存 / 格式不受支持而无法导出的图片。 */
  omittedCount: number
  omittedImageIds: string[]
}

/**
 * 为备份导出准备图片条目。
 * 单张图片缺失时记录 imageId，由调用方决定是否中止整个原图备份。
 */
export async function buildElectronImageExportEntries(
  ids: string[],
  getImage: (id: string) => Promise<StoredImage | undefined>,
): Promise<ElectronImageExportPlan> {
  const entries: ElectronImageExportEntry[] = []
  let omittedCount = 0
  const omittedImageIds: string[] = []
  // 动态导入避免循环依赖
  const { saveRawCacheImageToLocal } = await import('./localSave')
  for (const id of ids) {
    const image = await getImage(id)
    if (!image) {
      omittedCount++
      omittedImageIds.push(id)
      continue
    }
    let localPath = image.localPath
    // 如果尚未迁移到本地文件，尝试从 dataUrl 就地保存
    if (!localPath && image.dataUrl && isElectron()) {
      localPath = (await saveRawCacheImageToLocal(id, image.dataUrl)) || undefined
    }
    if (!localPath) {
      omittedCount++
      omittedImageIds.push(id)
      continue
    }
    const match = localPath.match(/\.([a-zA-Z0-9]+)$/)
    const ext = match?.[1].toLowerCase()
    if (!ext || !['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      omittedCount++
      omittedImageIds.push(id)
      continue
    }
    entries.push({
      imageId: id,
      sourcePath: localPath,
      archivePath: `images/${id}.${ext}`,
      createdAt: image.createdAt,
    })
  }
  return { entries, omittedCount, omittedImageIds }
}

export async function buildExportImageRefs(
  ids: string[],
  getImage: (id: string) => Promise<StoredImage | undefined>,
): Promise<NonNullable<ExportData['imageRefs']>> {
  const refs: NonNullable<ExportData['imageRefs']> = {}
  for (const id of ids) {
    const image = await getImage(id)
    refs[id] = {
      available: Boolean(image),
      createdAt: image?.createdAt,
      source: image?.source,
      width: image?.width,
      height: image?.height,
      mimeType: image?.mimeType,
      byteSize: image?.byteSize,
    }
  }
  return refs
}
