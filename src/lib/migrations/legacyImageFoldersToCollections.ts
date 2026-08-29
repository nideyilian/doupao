import type { AssetCollection, GeneratedAsset, StoredImage } from '../../types'
import { getAssetsByImageIds, putCollections, putGeneratedAssets } from '../assetLibraryRepository'
import { getLocalSavePath, joinPath, readDirectoryEntries, readFileBuffer } from '../localSave'
import { storeImage } from '../db'
import { runMigration, type MigrationJournalStore } from './registry'

export const LEGACY_IMAGE_FOLDERS_TO_COLLECTIONS_MIGRATION_ID = 'legacy-image-folders-to-collections-v1'

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i

/**
 * 旧版本（0.7.56 及之前）的工作区标签页把生成图片保存到「保存根目录/images/<标签页名>/」。
 * 升级后标签页体系变化，这些磁盘文件夹（标签 2/3/4、短剧……）与素材库项目文件夹脱节。
 *
 * 本迁移（一次性，journal 幂等）：
 * - 扫描 images/ 下每个子文件夹 → 同名项目文件夹（collection，同父级同名时复用）；
 * - 文件夹内图片逐张导入素材库（内容去重；磁盘文件保留），归入对应项目文件夹；
 * - 已有的素材归属不动，只做并集。
 */
export interface LegacyImageFoldersToCollectionsInput {
  /** images/ 下的子文件夹名 */
  folderNames: string[]
  existingCollections: AssetCollection[]
  now?: number
}

export interface LegacyImageFoldersToCollectionsResult {
  createdCollections: AssetCollection[]
}

/** 纯转换：文件夹名 → 同名顶级项目文件夹（复用同父级同名文件夹）。 */
export function buildFolderCollections(input: LegacyImageFoldersToCollectionsInput): AssetCollection[] {
  const now = input.now ?? Date.now()
  const existingByName = new Map<string, AssetCollection>()
  for (const collection of input.existingCollections) {
    if (collection.parentId !== null) continue
    existingByName.set(collection.normalizedName, collection)
  }
  const created: AssetCollection[] = []
  const seen = new Set<string>()
  for (const folderName of input.folderNames) {
    const name = folderName.trim()
    if (!name) continue
    const normalizedName = name.toLocaleLowerCase('zh-CN')
    if (existingByName.has(normalizedName) || seen.has(normalizedName)) continue
    seen.add(normalizedName)
    const collection: AssetCollection = {
      id: `col-folder-${now}-${created.length}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      normalizedName,
      parentId: null,
      order: created.length,
      trashedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    created.push(collection)
    existingByName.set(normalizedName, collection)
  }
  return created
}

/** 把磁盘图片构建为无来源素材（归入指定项目文件夹）。 */
export function buildImportedAsset(
  imageId: string,
  image: StoredImage | undefined,
  collectionId: string,
  now = Date.now(),
): GeneratedAsset {
  return {
    id: imageId,
    imageId,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    trashedAt: null,
    favorite: false,
    rating: 0,
    collectionIds: [collectionId],
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
}

function dataUrlFromBuffer(data: ArrayBuffer, mimeType: string): string {
  // 手工构造 base64 dataUrl（渲染进程无 Buffer；FileReader 在部分环境不可用）
  const bytes = new Uint8Array(data)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return `data:${mimeType};base64,${btoa(binary)}`
}

function mimeFromName(name: string): string {
  if (/\.jpe?g$/i.test(name)) return 'image/jpeg'
  if (/\.webp$/i.test(name)) return 'image/webp'
  return 'image/png'
}

export interface LegacyImageFoldersMigrationOptions {
  onProgress?: (imported: number, total: number) => void
}

/** 旧图片文件夹 → 项目文件夹迁移入口：扫描磁盘 → 建文件夹 → 逐图导入归集。幂等，可重试。 */
export function runLegacyImageFoldersToCollectionsMigration(
  journalStore: MigrationJournalStore,
  options: LegacyImageFoldersMigrationOptions = {},
): Promise<void> {
  // 每导入 CHECKPOINT_BATCH 张写一次游标（= 已处理文件下标 +1），中断/刷新后从断点续跑，
  // 避免上万张图片时每次启动都从头重新扫描导入。
  const CHECKPOINT_BATCH = 50
  return runMigration(LEGACY_IMAGE_FOLDERS_TO_COLLECTIONS_MIGRATION_ID, journalStore, async (context) => {
    const root = await getLocalSavePath()
    if (!root) return
    const imagesRoot = await joinPath(root, 'images')

    const entries = await readDirectoryEntries(imagesRoot)
    const folderNames = entries.filter((entry) => entry.isDirectory).map((entry) => entry.name)
    if (folderNames.length === 0) return

    const snapshot = await (await import('../assetLibraryRepository')).hydrateFull()
    const existingCollections = snapshot.collections

    const createdCollections = buildFolderCollections({ folderNames, existingCollections })
    if (createdCollections.length > 0) {
      await putCollections(createdCollections)
    }

    // 文件夹名 → collection id（复用已有的同名）
    const collectionIdByFolder = new Map<string, string>()
    for (const collection of [...existingCollections, ...createdCollections]) {
      if (collection.parentId === null) collectionIdByFolder.set(collection.normalizedName, collection.id)
    }

    // 预扫描全部图片文件（先得到总数，用于导入进度展示）
    const folderFiles: Array<{ folderName: string; fileName: string }> = []
    for (const folderName of folderNames) {
      const collectionId = collectionIdByFolder.get(folderName.trim().toLocaleLowerCase('zh-CN'))
      if (!collectionId) continue
      const folderPath = await joinPath(imagesRoot, folderName)
      const files = (await readDirectoryEntries(folderPath))
        .filter((entry) => !entry.isDirectory && IMAGE_EXT.test(entry.name))
        .map((entry) => entry.name)
      for (const fileName of files) folderFiles.push({ folderName, fileName })
    }
    const totalFiles = folderFiles.length

    // 断点续跑：从游标（已处理文件下标 +1）之后继续；游标不存在/越界则从头开始
    let startIndex = 0
    if (context.cursor) {
      const parsed = Number.parseInt(context.cursor, 10)
      if (Number.isFinite(parsed) && parsed > 0) startIndex = Math.min(parsed, totalFiles)
    }

    // 逐文件夹导入图片（内容去重；已有素材只合并归属）
    const changed: GeneratedAsset[] = []
    const pendingAssets: Array<{ imageId: string; collectionId: string }> = []
    let sinceCheckpoint = 0
    for (let fileIndex = startIndex; fileIndex < folderFiles.length; fileIndex++) {
      const { folderName, fileName } = folderFiles[fileIndex]!
      const collectionId = collectionIdByFolder.get(folderName.trim().toLocaleLowerCase('zh-CN'))
      if (!collectionId) continue
      try {
        const folderPath = await joinPath(imagesRoot, folderName)
        const fileResult = await readFileBuffer(await joinPath(folderPath, fileName))
        if (fileResult?.data) {
          const dataUrl = dataUrlFromBuffer(fileResult.data, mimeFromName(fileResult.name))
          const imageId = await storeImage(dataUrl, 'upload')
          pendingAssets.push({ imageId, collectionId })
        }
      } catch (error) {
        console.warn('[legacy-image-folders] 导入图片失败（跳过）:', fileName, error)
      }
      options.onProgress?.(fileIndex + 1, totalFiles)
      sinceCheckpoint++
      if (sinceCheckpoint >= CHECKPOINT_BATCH) {
        await context.checkpoint(String(fileIndex + 1))
        sinceCheckpoint = 0
      }
    }
    // 循环结束：把游标推进到末尾（不足一批的余量也落盘），避免中断后从旧游标重复导入
    if (totalFiles > 0 && sinceCheckpoint > 0) {
      await context.checkpoint(String(totalFiles))
    }

    // 批量合并归属（避免逐张 getAssetsByImageIds 的 IPC 往返）
    const now = Date.now()
    const uniqueImageIds = Array.from(new Set(pendingAssets.map((item) => item.imageId)))
    const existingById = uniqueImageIds.length
      ? await getAssetsByImageIds(uniqueImageIds)
      : new Map<string, GeneratedAsset>()
    for (const { imageId, collectionId } of pendingAssets) {
      const existing = existingById.get(imageId)
      if (existing) {
        if (!existing.collectionIds.includes(collectionId)) {
          changed.push({ ...existing, collectionIds: [...existing.collectionIds, collectionId], updatedAt: now })
        }
        continue
      }
      const image = await (await import('../db')).getImage(imageId)
      changed.push(buildImportedAsset(imageId, image, collectionId, now))
    }
    if (changed.length > 0) await putGeneratedAssets(changed)
  })
}
