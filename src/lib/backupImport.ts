import type { ExportData } from '../types'
import { restoreWorkspaceBackupState } from './workspaceBackup'

export type BackupImportSelection = {
  importConfig?: boolean
  importTasks?: boolean
  importImages?: boolean
  importAssets?: boolean
}

const CURRENT_BACKUP_VERSION = 7

function assertArchivePath(path: string): void {
  const normalized = path.replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`备份包含不安全路径：${path}`)
  }
}

function assertFilesExist(
  entries: Array<{ path: string }>,
  files: Record<string, Uint8Array>,
  archivePaths?: ReadonlySet<string>,
): void {
  for (const entry of entries) {
    assertArchivePath(entry.path)
    // 流式导入时图片/缩略图/合成资源已被解压处理或保留在 Map 中，这里只校验存在性
    if (!files[entry.path] && !archivePaths?.has(entry.path)) {
      throw new Error(`备份缺少文件：${entry.path}`)
    }
  }
}

export function reconcileBackupWorkspaceImages(
  data: ExportData,
  availableImageIds?: ReadonlySet<string>,
): {
  data: ExportData
  omittedImageCount: number
} {
  if (!data.workspaceState) return { data, omittedImageCount: 0 }

  const available = availableImageIds ?? new Set(Object.keys(data.imageFiles ?? {}))
  const omittedImageIds = new Set<string>()
  const keepAvailable = (imageIds: string[]) =>
    imageIds.filter((imageId) => {
      if (available.has(imageId)) return true
      omittedImageIds.add(imageId)
      return false
    })
  const workspaceState = {
    ...data.workspaceState,
    tabs: data.workspaceState.tabs.map((tab) => {
      const maskTargetAvailable = !tab.maskDraft || available.has(tab.maskDraft.targetImageId)
      const maskEditorImageAvailable = !tab.maskEditorImageId || available.has(tab.maskEditorImageId)
      if (!maskTargetAvailable) omittedImageIds.add(tab.maskDraft!.targetImageId)
      if (!maskEditorImageAvailable) omittedImageIds.add(tab.maskEditorImageId!)
      return {
        ...tab,
        inputImageIds: keepAvailable(tab.inputImageIds),
        inputImageFolder: tab.inputImageFolder
          ? { ...tab.inputImageFolder, imageIds: keepAvailable(tab.inputImageFolder.imageIds) }
          : null,
        maskDraft: maskTargetAvailable ? tab.maskDraft : null,
        maskEditorImageId: maskEditorImageAvailable ? tab.maskEditorImageId : null,
      }
    }),
  }

  return {
    data: { ...data, workspaceState },
    omittedImageCount: omittedImageIds.size,
  }
}

export function validateBackupArchive(
  data: ExportData,
  files: Record<string, Uint8Array>,
  selection: BackupImportSelection,
  archivePaths?: ReadonlySet<string>,
  availableImageIds?: ReadonlySet<string>,
): void {
  if (!Number.isInteger(data.version) || data.version < 1) {
    throw new Error('备份版本无效')
  }
  if (data.version > CURRENT_BACKUP_VERSION) {
    throw new Error(`备份版本 ${data.version} 高于当前支持的版本 ${CURRENT_BACKUP_VERSION}，请升级应用后重试`)
  }

  if (selection.importImages) {
    assertFilesExist(Object.values(data.imageFiles ?? {}), files, archivePaths)
  }
  if (selection.importTasks) {
    assertFilesExist(Object.values(data.thumbnailFiles ?? {}), files, archivePaths)
  }
  if (selection.importConfig) {
    assertFilesExist(Object.values(data.compositeAssetFiles ?? {}), files, archivePaths)
  }

  if (data.version >= 5 && data.workspaceState && selection.importConfig && selection.importTasks) {
    restoreWorkspaceBackupState(
      data.workspaceState,
      data.tasks ?? [],
      availableImageIds ?? new Set(Object.keys(data.imageFiles ?? {})),
    )
  }
}
