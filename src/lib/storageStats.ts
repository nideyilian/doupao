import { getStorageRecordCounts } from './db'

export type StorageRecordCounts = Awaited<ReturnType<typeof getStorageRecordCounts>>

export type StorageCategoryKey = 'images' | 'thumbnails' | 'tasks-metadata' | 'asset-index'

export interface StorageCategory {
  key: StorageCategoryKey
  /** 用户可读分类名 */
  label: string
  count: number
  /** 分类说明 */
  description: string
  /** Electron 磁盘真实字节（素材原图来自 cache-images 目录统计） */
  bytes?: number
}

/** Electron 主进程磁盘统计（cache-images 原图 + 库根 backups + 库根 thumbs）。 */
export interface DiskStorageUsage {
  cacheDir: string | null
  imagesBytes: number
  imagesCount: number
  backupBytes: number
  thumbsBytes: number
  thumbsCount: number
}

export type StorageOverview = {
  usageBytes: number | null
  quotaBytes: number | null
  usagePercent: number | null
  counts: StorageRecordCounts
  /** 按用途分类的记录数（素材原图 / 缩略图 / 任务与元数据 / 素材索引） */
  categories: StorageCategory[]
  /** Electron 磁盘真实统计；浏览器环境为 null */
  disk: DiskStorageUsage | null
}

type StorageOverviewDeps = {
  estimate: () => Promise<{ usage?: number; quota?: number }>
  counts: () => Promise<StorageRecordCounts>
  diskUsage?: () => Promise<DiskStorageUsage | null>
}

async function defaultDiskUsage(): Promise<DiskStorageUsage | null> {
  try {
    const { getDiskStorageUsage } = await import('./localSave')
    return getDiskStorageUsage()
  } catch {
    return null
  }
}

const defaultDeps: StorageOverviewDeps = {
  estimate: async () => (await navigator.storage?.estimate?.()) ?? {},
  counts: getStorageRecordCounts,
  diskUsage: defaultDiskUsage,
}

export function buildStorageCategories(
  counts: StorageRecordCounts,
  disk: DiskStorageUsage | null = null,
): StorageCategory[] {
  return [
    {
      key: 'images',
      label: '素材原图与图片',
      description: '生成原图、输入图、遮罩等图片字节',
      count: disk?.imagesCount ?? counts.images,
      bytes: disk?.imagesBytes,
    },
    {
      key: 'thumbnails',
      label: '缩略图缓存',
      description: '网格浏览使用的缩略图，可重建',
      count: disk?.thumbsCount ?? counts.thumbnails,
      bytes: disk?.thumbsBytes,
    },
    {
      key: 'tasks-metadata',
      label: '任务与元数据',
      description: '生成任务、Agent 对话、合成资源',
      count: counts.tasks + counts.conversations + counts.compositeAssets,
    },
    {
      key: 'asset-index',
      label: '素材库索引',
      description: '素材记录、项目、标签、墓碑',
      count: counts.generatedAssets + counts.assetCollections + counts.assetTags + counts.assetTombstones,
    },
  ]
}

export async function getStorageOverview(deps: StorageOverviewDeps = defaultDeps): Promise<StorageOverview> {
  const { estimate, counts, diskUsage = defaultDiskUsage } = deps
  const [estimateResult, countsResult, disk] = await Promise.all([estimate(), counts(), diskUsage()])
  // Electron：已用空间 = cache-images 原图 + 备份目录 + 缩略图缓存 + Chromium 存储（IndexedDB 等）
  const diskBytes = (disk?.imagesBytes ?? 0) + (disk?.backupBytes ?? 0) + (disk?.thumbsBytes ?? 0)
  const estimateUsage = typeof estimateResult.usage === 'number' ? estimateResult.usage : null
  const usageBytes = disk != null ? diskBytes + (estimateUsage ?? 0) : estimateUsage
  const quotaBytes = typeof estimateResult.quota === 'number' ? estimateResult.quota : null
  return {
    usageBytes,
    quotaBytes,
    // Electron 下磁盘占用不受 Chromium 配额约束，占比无意义
    usagePercent:
      disk != null ? null : usageBytes != null && quotaBytes ? Math.round((usageBytes / quotaBytes) * 100) : null,
    counts: countsResult,
    categories: buildStorageCategories(countsResult, disk),
    disk,
  }
}

export function formatStorageBytes(bytes: number | null): string {
  if (bytes == null) return '未知'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`
}
