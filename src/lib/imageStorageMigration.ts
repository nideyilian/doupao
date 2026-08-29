import type { StoredImage } from '../types'

export type ImageStorageMigrationDeps = {
  readBatch: (limit: number) => Promise<StoredImage[]>
  saveImage: (image: StoredImage) => Promise<string | null>
  replaceImage: (image: StoredImage) => Promise<unknown>
  batchSize?: number
  yieldToEventLoop?: () => Promise<void>
  onProgress?: (migrated: number) => Promise<void>
}

export async function migrateLegacyImages(deps: ImageStorageMigrationDeps): Promise<number> {
  const batchSize = deps.batchSize ?? 4
  const yieldToEventLoop = deps.yieldToEventLoop ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
  let migrated = 0
  let failed = 0
  while (true) {
    const images = await deps.readBatch(batchSize)
    if (images.length === 0) {
      if (failed > 0) console.warn(`[image-migration] ${failed} 张图片迁移失败，已跳过`)
      return migrated
    }
    for (const image of images) {
      if (!image.dataUrl) continue
      try {
        const localPath = await deps.saveImage(image)
        if (!localPath) {
          failed++
          console.warn(`[image-migration] 图片 ${image.id} 保存失败，跳过`)
          continue
        }
        await deps.replaceImage({ ...image, localPath, dataUrl: undefined })
        migrated++
        await deps.onProgress?.(migrated)
      } catch (error) {
        failed++
        console.warn(`[image-migration] 图片 ${image.id} 迁移异常，跳过`, error)
      }
    }
    await yieldToEventLoop()
  }
}
