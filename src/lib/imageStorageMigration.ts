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
  while (true) {
    const images = await deps.readBatch(batchSize)
    if (images.length === 0) return migrated
    let batchError: Error | null = null
    for (const image of images) {
      if (!image.dataUrl) continue
      try {
        const localPath = await deps.saveImage(image)
        if (!localPath) {
          batchError ??= new Error(`图片 ${image.id} 保存失败`)
          console.warn(`[image-migration] 图片 ${image.id} 保存失败`)
          continue
        }
        await deps.replaceImage({ ...image, localPath, dataUrl: undefined })
        migrated++
        await deps.onProgress?.(migrated)
      } catch (error) {
        batchError ??= error instanceof Error ? error : new Error(String(error))
        console.warn(`[image-migration] 图片 ${image.id} 迁移异常`, error)
      }
    }
    if (batchError) throw batchError
    await yieldToEventLoop()
  }
}
