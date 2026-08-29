import { getImage, storeImage } from './db'
import { cacheImage } from '../store'
import { getAssetsByImageIds, putGeneratedAssets } from './assetLibraryRepository'
import type { GeneratedAsset } from '../types'

/** 把外部图片文件导入为素材（无生成来源的独立素材；相同内容自动去重）。 */
export async function importExternalImageFile(file: File): Promise<GeneratedAsset | null> {
  if (!file.type.startsWith('image/')) return null
  const dataUrl = await fileToDataUrl(file)
  const imageId = await storeImage(dataUrl, 'upload')
  cacheImage(imageId, dataUrl)

  const existing = await getAssetsByImageIds([imageId])
  const current = existing.get(imageId)
  if (current) {
    // 相同内容已归档：不重复创建（可能来自生成任务或之前的导入）
    return current
  }

  const image = await getImage(imageId)
  const now = Date.now()
  const asset: GeneratedAsset = {
    id: imageId,
    imageId,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    trashedAt: null,
    favorite: false,
    rating: 0,
    collectionIds: [],
    tagIds: [],
    origins: [],
    primaryOriginKey: null,
    parentAssetIds: [],
    width: image?.width,
    height: image?.height,
    mimeType: image?.mimeType,
    byteSize: image?.byteSize,
    metadataVersion: 1,
  }
  await putGeneratedAssets([asset])
  return asset
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
