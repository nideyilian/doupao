import { getAgentImageApiProfile } from './apiProfiles'
import { storeImage } from './db'
import { submitTaskWithData } from '../store'
import type { AppSettings, InputImage, TaskParams } from '../types'
import type { PlannedBatchUnit } from './agentBatchPlanner'

export async function loadBatchReferenceImages(folderPath: string | undefined): Promise<InputImage[]> {
  if (!folderPath) return []
  const api = window.electronAPI
  if (!api?.listImageFiles) throw new Error('当前环境不支持读取参考图文件夹')
  const files = await api.listImageFiles(folderPath)
  if (files.length === 0) throw new Error(`参考图文件夹为空或不存在：${folderPath}`)
  const images: InputImage[] = []
  for (const file of files) {
    if (!file.dataUrl) continue
    const id = await storeImage(file.dataUrl, 'upload')
    images.push({ id, dataUrl: file.dataUrl })
  }
  if (images.length === 0) throw new Error(`参考图文件夹没有可读取图片：${folderPath}`)
  return images
}

export async function submitPlannedBatchUnit(unit: PlannedBatchUnit, settings: AppSettings, params: TaskParams) {
  const imageProfile = getAgentImageApiProfile(settings)
  const inputImages = await loadBatchReferenceImages(unit.referenceFolder)
  return submitTaskWithData({
    prompt: unit.prompt,
    inputImages,
    inputImageFolder: unit.referenceFolder
      ? { path: unit.referenceFolder, imageIds: inputImages.map((image) => image.id) }
      : null,
    params: { ...params, n: unit.plannedCount, reference_mode: 'cycle' },
    maskDraft: null,
    scheduledOutputPath: unit.outputFolder,
    scheduledOutputSubFolder: unit.direction,
    apiProfileId: imageProfile.id,
  })
}
