import type { StoredImage } from '../types'

export type ImageStorageMigrationDeps = {
  readBatch: (limit: number) => Promise<StoredImage[]>
  saveImage: (image: StoredImage) => Promise<string | null>
  replaceImage: (image: StoredImage) => Promise<unknown>
  batchSize?: number
  yieldToEventLoop?: () => Promise<void>
  onProgress?: (migrated: number) => Promise<void>
  onFailure?: (image: StoredImage, error: Error) => void
}

export async function migrateLegacyImages(deps: ImageStorageMigrationDeps): Promise<number> {
  const batchSize = deps.batchSize ?? 4
  const yieldToEventLoop = deps.yieldToEventLoop ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
  const failedIds = new Set<string>()
  let migrated = 0
  while (true) {
    const images = (await deps.readBatch(batchSize + failedIds.size))
      .filter((image) => !failedIds.has(image.id))
      .slice(0, batchSize)
    if (images.length === 0) return migrated
    for (const image of images) {
      if (!image.dataUrl) continue
      try {
        const localPath = await deps.saveImage(image)
        if (!localPath) {
          const error = new Error(`图片 ${image.id} 保存失败`)
          failedIds.add(image.id)
          deps.onFailure?.(image, error)
          console.warn(`[image-migration] 图片 ${image.id} 保存失败`)
          continue
        }
        await deps.replaceImage({ ...image, localPath, dataUrl: undefined })
        migrated++
        await deps.onProgress?.(migrated)
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error))
        failedIds.add(image.id)
        deps.onFailure?.(image, failure)
        console.warn(`[image-migration] 图片 ${image.id} 迁移异常`, error)
      }
    }
    await yieldToEventLoop()
  }
}
