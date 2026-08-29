import { ensureImageCached } from '../store'
import { zipSync } from 'fflate'
import type { TaskRecord, WorkspaceTab } from '../types'
import { buildGeneratedImageFileNameBase, type GeneratedImageFilenameSettings } from './generatedImageFilename'
import { getImage } from './db'
import {
  exportImagesToFolder,
  exportZipToPath,
  fileExistsOnDisk,
  isElectron,
  saveImage,
  selectLocalSaveDirectory,
  selectSavePath,
  selectZipSavePath,
} from './localSave'

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export interface DownloadImagesResult {
  successCount: number
  failCount: number
}

export interface DownloadImageZipEntry {
  imageId: string
  fileNameBase?: string
}

type TaskOutputZipTask = Pick<TaskRecord, 'id' | 'createdAt' | 'outputImages'>

export function formatExportFileTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('图片数据读取失败'))
    reader.readAsDataURL(blob)
  })
}

/**
 * 批量导出到文件夹（Electron 原生）：优先复制磁盘原图（不占渲染进程内存），缺失回退 dataUrl 写盘。
 * 返回 null 表示未处理（非 Electron 或主进程不可用），调用方回退浏览器锚点下载路径。
 */
async function tryFolderExport(
  entries: DownloadImageZipEntry[],
  fileNameBase?: string,
): Promise<DownloadImagesResult | null> {
  if (!isElectron()) return null
  const dir = await selectLocalSaveDirectory()
  if (!dir) return { successCount: 0, failCount: 0 } // 用户取消：视为已处理，静默返回
  const files: Array<{ fileName: string; sourcePath?: string; dataUrl?: string }> = []
  const usedNames = new Set<string>()
  let failCount = 0
  for (const entry of entries) {
    try {
      const blob = await getImageBlob(entry.imageId)
      const base = sanitizeFileNamePart(entry.fileNameBase || fileNameBase || 'image') || 'image'
      const ext = getBlobExtension(blob)
      let fileName = `${base}.${ext}`
      let duplicateIndex = 2
      while (usedNames.has(fileName)) {
        fileName = `${base}-${String(duplicateIndex).padStart(2, '0')}.${ext}`
        duplicateIndex++
      }
      usedNames.add(fileName)
      // Electron 下优先复制磁盘原图；localPath 失效（磁盘文件已不存在）或无 localPath 时回退 dataUrl 写盘，
      // 避免「素材记录有 localPath 但原图文件已被清理/迁移」导致整批导出失败
      const image = await getImage(entry.imageId)
      if (image?.localPath && (await fileExistsOnDisk(image.localPath))) {
        files.push({ fileName, sourcePath: image.localPath })
      } else {
        files.push({ fileName, dataUrl: await blobToDataUrl(blob) })
      }
    } catch (err) {
      console.error(err)
      failCount++
    }
  }
  const result = await exportImagesToFolder(dir, files)
  if (!result) return null
  return { successCount: result.saved, failCount: result.failed.length + failCount }
}

export async function downloadImageIds(imageIds: string[], fileNameBase = 'images'): Promise<DownloadImagesResult> {
  if (imageIds.length === 0) return { successCount: 0, failCount: 0 }

  // Electron：单张 → 原生保存对话框；多张 → 导出到文件夹
  if (isElectron()) {
    if (imageIds.length === 1) {
      const ok = await saveSingleImage(imageIds[0]!, fileNameBase)
      return ok ? { successCount: 1, failCount: 0 } : { successCount: 0, failCount: 1 }
    }
    const folderResult = await tryFolderExport(getImageZipEntries(imageIds, fileNameBase), fileNameBase)
    if (folderResult) return folderResult
  }

  let successCount = 0
  let failCount = 0
  const multiple = imageIds.length > 1

  for (let index = 0; index < imageIds.length; index++) {
    try {
      const blob = await getImageBlob(imageIds[index])
      const order = String(index + 1).padStart(2, '0')
      const fileName = multiple
        ? `${fileNameBase}-${order}.${getBlobExtension(blob)}`
        : `${fileNameBase}.${getBlobExtension(blob)}`
      triggerDownload(blob, fileName)
      successCount++
      if (multiple) await delay(100)
    } catch (err) {
      console.error(err)
      failCount++
    }
  }

  return { successCount, failCount }
}

/** Electron 单张导出：原生保存对话框直接写盘；失败/取消返回 false。 */
async function saveSingleImage(imageIdOrUrl: string, fileNameBase: string): Promise<boolean> {
  try {
    const blob = await getImageBlob(imageIdOrUrl)
    const fileName = `${sanitizeFileNamePart(fileNameBase) || 'image'}.${getBlobExtension(blob)}`
    const filePath = await selectSavePath(fileName, [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }])
    if (!filePath) return false
    const dataUrl = await blobToDataUrl(blob)
    return await saveImage(filePath, dataUrl)
  } catch (err) {
    console.error(err)
    return false
  }
}

export async function downloadImageEntries(entries: DownloadImageZipEntry[]): Promise<DownloadImagesResult> {
  if (entries.length === 0) return { successCount: 0, failCount: 0 }

  // Electron：单张 → 原生保存对话框；多张 → 导出到文件夹
  if (isElectron()) {
    if (entries.length === 1) {
      const entry = entries[0]!
      const ok = await saveSingleImage(entry.imageId, entry.fileNameBase || 'image')
      return ok ? { successCount: 1, failCount: 0 } : { successCount: 0, failCount: 1 }
    }
    const folderResult = await tryFolderExport(entries)
    if (folderResult) return folderResult
  }

  let successCount = 0
  let failCount = 0

  for (const entry of entries) {
    try {
      const blob = await getImageBlob(entry.imageId)
      const fileNameBase = sanitizeFileNamePart(entry.fileNameBase || 'image') || 'image'
      triggerDownload(blob, `${fileNameBase}.${getBlobExtension(blob)}`)
      successCount++
      if (entries.length > 1) await delay(100)
    } catch (err) {
      console.error(err)
      failCount++
    }
  }

  return { successCount, failCount }
}

export async function downloadImageEntriesAsZip(
  entries: DownloadImageZipEntry[],
  zipFileNameBase = 'images',
): Promise<DownloadImagesResult> {
  if (entries.length === 0) return { successCount: 0, failCount: 0 }

  // Electron：原生保存对话框 + 主进程流式写 ZIP（不经渲染端整包内存）
  if (isElectron() && window.electronAPI?.exportZipToPath) {
    const filePath = await selectZipSavePath(`${sanitizeFileNamePart(zipFileNameBase) || 'images'}.zip`)
    if (!filePath) return { successCount: 0, failCount: 0 }
    const dataEntries: Array<{ data: Uint8Array; archivePath: string }> = []
    const usedNames = new Set<string>()
    let failCount = 0
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]
      try {
        const blob = await getImageBlob(entry.imageId)
        const order = String(index + 1).padStart(2, '0')
        const base = sanitizeFileNamePart(entry.fileNameBase || `image-${order}`) || `image-${order}`
        const ext = getBlobExtension(blob)
        let fileName = `${base}.${ext}`
        let duplicateIndex = 2
        while (usedNames.has(fileName)) {
          fileName = `${base}-${String(duplicateIndex).padStart(2, '0')}.${ext}`
          duplicateIndex++
        }
        usedNames.add(fileName)
        dataEntries.push({ data: new Uint8Array(await blob.arrayBuffer()), archivePath: fileName })
      } catch (err) {
        console.error(err)
        failCount++
      }
    }
    const result = await exportZipToPath({ destinationPath: filePath, manifestJson: '{}', entries: dataEntries })
    const successCount = result.success ? dataEntries.length : 0
    return { successCount, failCount: result.success ? failCount : failCount + dataEntries.length }
  }

  let successCount = 0
  let failCount = 0
  const zipFiles: Record<string, Uint8Array | [Uint8Array, { mtime: Date }]> = {}
  const usedNames = new Set<string>()

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    try {
      const blob = await getImageBlob(entry.imageId)
      const order = String(index + 1).padStart(2, '0')
      const base = sanitizeFileNamePart(entry.fileNameBase || `image-${order}`) || `image-${order}`
      const ext = getBlobExtension(blob)
      let fileName = `${base}.${ext}`
      let duplicateIndex = 2
      while (usedNames.has(fileName)) {
        fileName = `${base}-${String(duplicateIndex).padStart(2, '0')}.${ext}`
        duplicateIndex++
      }
      usedNames.add(fileName)
      zipFiles[fileName] = [new Uint8Array(await blob.arrayBuffer()), { mtime: new Date() }]
      successCount++
    } catch (err) {
      console.error(err)
      failCount++
    }
  }

  if (successCount > 0) {
    const zipped = zipSync(zipFiles, { level: 6 })
    const buffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer
    triggerDownload(
      new Blob([buffer], { type: 'application/zip' }),
      `${sanitizeFileNamePart(zipFileNameBase) || 'images'}.zip`,
    )
  }

  return { successCount, failCount }
}

export function getTaskOutputImageZipEntries(tasks: TaskOutputZipTask[]): DownloadImageZipEntry[] {
  return [...tasks]
    .sort((a, b) => b.createdAt - a.createdAt)
    .flatMap((task) => getImageZipEntries(task.outputImages || [], `task-${task.id}`))
}

export function getGeneratedImageDownloadEntries(
  tasks: TaskRecord[],
  workspaceTabs: WorkspaceTab[],
  settings: GeneratedImageFilenameSettings,
  imageIds?: string[],
): DownloadImageZipEntry[] {
  const buildEntry = (task: TaskRecord, imageId: string, index: number): DownloadImageZipEntry => {
    const containingTab = workspaceTabs.find((tab) => tab.tasks.some((item) => item.id === task.id))
    const label =
      containingTab?.name ?? task.scheduledOutputSubFolder ?? getPathBaseName(task.scheduledOutputPath) ?? 'image'
    return {
      imageId,
      fileNameBase: buildGeneratedImageFileNameBase(
        {
          createdAt: task.createdAt,
          label,
          prompt: task.prompt,
          batch: task.filenameBatch ?? 1,
        },
        settings,
        index + 1,
      ),
    }
  }

  if (!imageIds) {
    return tasks.flatMap((task) => task.outputImages.map((imageId, index) => buildEntry(task, imageId, index)))
  }

  return imageIds.flatMap((imageId) => {
    for (const task of tasks) {
      const outputIndex = task.outputImages.indexOf(imageId)
      if (outputIndex >= 0) return [buildEntry(task, imageId, outputIndex)]
      const partialIndex = task.streamPartialImageIds?.indexOf(imageId) ?? -1
      if (partialIndex >= 0) return [buildEntry(task, imageId, partialIndex)]
    }
    return []
  })
}

export function getImageZipEntries(imageIds: string[], fileNameBase = 'image'): DownloadImageZipEntry[] {
  const multiple = imageIds.length > 1
  return imageIds.map((imageId, index) => ({
    imageId,
    fileNameBase: multiple ? `${fileNameBase}-${String(index + 1).padStart(2, '0')}` : fileNameBase,
  }))
}

function getPathBaseName(value?: string): string | null {
  if (!value) return null
  const parts = value
    .trim()
    .replace(/[\\/]+$/, '')
    .split(/[\\/]+/)
    .filter(Boolean)
  return parts[parts.length - 1] || null
}

async function getImageBlob(imageIdOrUrl: string): Promise<Blob> {
  let src = imageIdOrUrl
  if (
    !imageIdOrUrl.startsWith('data:') &&
    !imageIdOrUrl.startsWith('http://') &&
    !imageIdOrUrl.startsWith('https://')
  ) {
    src = (await ensureImageCached(imageIdOrUrl)) ?? imageIdOrUrl
  }

  const res = await fetch(src)
  if (!res.ok && !src.startsWith('data:')) throw new Error(`读取图片失败：${imageIdOrUrl}`)
  return await res.blob()
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function getBlobExtension(blob: Blob): string {
  return MIME_EXTENSIONS[blob.type.toLowerCase()] ?? blob.type.split('/')[1] ?? 'png'
}

function sanitizeFileNamePart(value: string): string {
  return (
    value
      .trim()
      // eslint-disable-next-line no-control-regex -- 文件名控制字符剥离是刻意行为
      .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-')
      .replace(/\s+/g, ' ')
      .slice(0, 220)
  )
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
