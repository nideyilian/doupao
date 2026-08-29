import type { AssetCollection, GeneratedAsset } from '../types'
import { batchGetImages } from './db'
import { exportProjectCopies, isElectron, sanitizeFolderName, selectLocalSaveDirectory } from './localSave'
import { getAssetFileName } from './assetCommands'

/**
 * 按项目树导出原图副本（方案 A：copy 语义，与库解耦）。
 * 纯函数 buildProjectTreeCopies 把「素材 × 项目树」映射为相对目标根的复制清单：
 * - 每个项目（含多级子项目）在目标根下建立同名目录，素材原图复制进所属项目的目录；
 * - 同属多个项目 = 每个项目各一份副本；无项目素材落入「未整理」目录；
 * - 同目录内文件名冲突自动追加 -01/-02 序号；文件名/文件夹名做文件系统安全清洗。
 * 实际复制由主进程逐文件执行（不占渲染进程内存），并在目标根写 export-manifest.jsonl。
 */

export interface ProjectCopyEntry {
  sourcePath: string
  /** 相对目标根路径，/ 分隔 */
  targetPath: string
  assetId: string
}

export interface ProjectExportBuildResult {
  entries: ProjectCopyEntry[]
  /** 找不到本地原图路径而被跳过的素材数 */
  skippedNoFile: number
  totalAssets: number
  /** 参与导出的项目数（含子项目） */
  collectionCount: number
}

const UNORGANIZED_FOLDER = '未整理'

function escapeName(name: string): string {
  return sanitizeFolderName(name)
}

/** 构建项目树：parentId → 子级（置顶优先，其次 order，最后名称）。 */
function buildChildrenMap(collections: AssetCollection[]): Map<string | null, AssetCollection[]> {
  const map = new Map<string | null, AssetCollection[]>()
  for (const collection of collections) {
    const list = map.get(collection.parentId) ?? []
    list.push(collection)
    map.set(collection.parentId, list)
  }
  for (const list of map.values()) {
    list.sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
      if (a.order !== b.order) return a.order - b.order
      return a.normalizedName.localeCompare(b.normalizedName, 'zh-CN')
    })
  }
  return map
}

/** 逐级向上收集目录名（根 → 叶子）。 */
function collectFolderSegments(
  collectionId: string,
  byId: Map<string, AssetCollection>,
  childrenMap: Map<string | null, AssetCollection[]>,
  seen: Set<string> = new Set(),
): string[] | null {
  if (seen.has(collectionId)) return null // 防环
  seen.add(collectionId)
  const collection = byId.get(collectionId)
  if (!collection) return null
  const parentSegments = collection.parentId ? collectFolderSegments(collection.parentId, byId, childrenMap, seen) : []
  if (parentSegments === null) return null
  return [...parentSegments, escapeName(collection.name)]
}

/** 纯函数：按项目树生成复制清单（不含磁盘 I/O）。 */
export function buildProjectTreeCopies(
  assets: GeneratedAsset[],
  collections: AssetCollection[],
  localPathByImageId: Map<string, string>,
): ProjectExportBuildResult {
  const activeCollections = collections.filter((collection) => !collection.trashedAt)
  const byId = new Map(activeCollections.map((collection) => [collection.id, collection]))
  const childrenMap = buildChildrenMap(activeCollections)

  const entries: ProjectCopyEntry[] = []
  let skippedNoFile = 0
  let totalAssets = 0
  let collectionCount = 0

  const usedNames = new Map<string, Map<string, number>>()
  const uniqueName = (folderKey: string, base: string, extension: string): string => {
    let counter = usedNames.get(folderKey)
    if (!counter) {
      counter = new Map()
      usedNames.set(folderKey, counter)
    }
    const next = (counter.get(base) ?? 0) + 1
    counter.set(base, next)
    const suffix = next === 1 ? '' : `-${String(next).padStart(2, '0')}`
    return `${escapeName(base)}${suffix}.${extension}`
  }

  const pushCopy = (sourcePath: string, folderSegments: string[], asset: GeneratedAsset, fileName: string) => {
    const folderKey = folderSegments.join('/')
    entries.push({
      sourcePath,
      targetPath: folderSegments.length > 0 ? `${folderKey}/${fileName}` : fileName,
      assetId: asset.id,
    })
  }

  for (const asset of assets) {
    if (asset.status === 'trashed') continue
    totalAssets++
    const localPath = asset.imageId ? localPathByImageId.get(asset.imageId) : undefined
    if (!localPath) {
      skippedNoFile++
      continue
    }
    const fileNameBase = getAssetFileName(asset).replace(/\.[^.]+$/, '')
    const extension = (getAssetFileName(asset).match(/\.([^.]+)$/)?.[1] ?? 'png').toLowerCase()
    const memberCollections = asset.collectionIds
      .map((id) => byId.get(id))
      .filter((collection): collection is AssetCollection => Boolean(collection))

    if (memberCollections.length === 0) {
      pushCopy(localPath, [UNORGANIZED_FOLDER], asset, uniqueName(UNORGANIZED_FOLDER, fileNameBase, extension))
      continue
    }
    for (const collection of memberCollections) {
      const segments = collectFolderSegments(collection.id, byId, childrenMap)
      if (!segments) continue
      const folderKey = segments.join('/')
      pushCopy(localPath, segments, asset, uniqueName(folderKey, fileNameBase, extension))
    }
  }

  collectionCount = activeCollections.length
  return { entries, skippedNoFile, totalAssets, collectionCount }
}

export interface ProjectTreeExportOutcome {
  saved: boolean
  cancelled?: boolean
  targetRoot?: string
  copied: number
  failed: number
  total: number
  skippedNoFile: number
  reason?: string
}

/** 编排：收集素材/项目/原图路径 → 构建清单 → 选目标目录 → 主进程复制。 */
export async function exportProjectTreeCopiesToFolder(
  assets: GeneratedAsset[],
  collections: AssetCollection[],
): Promise<ProjectTreeExportOutcome> {
  if (!isElectron()) {
    return { saved: false, copied: 0, failed: 0, total: 0, skippedNoFile: 0, reason: '仅桌面版支持按项目树导出副本' }
  }
  const images = await batchGetImages(assets.map((asset) => asset.imageId))
  const localPathByImageId = new Map<string, string>()
  for (const [id, image] of images) {
    if (image.localPath) localPathByImageId.set(id, image.localPath)
  }
  const built = buildProjectTreeCopies(assets, collections, localPathByImageId)
  if (built.entries.length === 0) {
    return {
      saved: false,
      copied: 0,
      failed: 0,
      total: 0,
      skippedNoFile: built.skippedNoFile,
      reason: built.skippedNoFile > 0 ? `有 ${built.skippedNoFile} 个素材找不到本地原图` : '没有可导出的素材',
    }
  }
  const targetRoot = await selectLocalSaveDirectory()
  if (!targetRoot)
    return { saved: false, cancelled: true, copied: 0, failed: 0, total: 0, skippedNoFile: built.skippedNoFile }
  const result = await exportProjectCopies(targetRoot, built.entries)
  if (!result) {
    return { saved: false, copied: 0, failed: 0, total: 0, skippedNoFile: built.skippedNoFile, reason: '主进程未响应' }
  }
  return {
    saved: true,
    targetRoot,
    copied: result.copied,
    failed: result.failed.length,
    total: result.total,
    skippedNoFile: built.skippedNoFile,
  }
}
