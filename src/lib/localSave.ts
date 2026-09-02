import type { AgentConversation, AgentRound, TaskRecord } from '../types'
import type { UpdateStatus } from '../hooks/useAutoUpdate'
import type {
  AssetCatalogCursorPage,
  AssetCatalogQuery,
  AssetCollection,
  AssetTag,
  AssetTombstone,
  AssetUsageEvent,
  GeneratedAsset,
} from '../types'
import { sanitizeGeneratedImageFilenamePart } from './generatedImageFilename'

type ElectronAPI = {
  apiFetch?: (
    request: {
      id: string
      url: string
      method: string
      headers: Array<[string, string]>
      body?: ArrayBuffer
      redirect: RequestRedirect
    },
    onEvent: (
      event:
        | { id: string; type: 'chunk'; data: Uint8Array | ArrayBuffer }
        | { id: string; type: 'done' }
        | { id: string; type: 'error'; error: string },
    ) => void,
  ) => Promise<{ status: number; statusText: string; headers: Array<[string, string]> }>
  cancelApiFetch?: (id: string) => void
  selectDirectory: () => Promise<string | null>
  selectFile: (filters?: { name: string; extensions: string[] }[]) => Promise<string | null>
  selectFiles: (filters?: { name: string; extensions: string[] }[]) => Promise<string[] | null>
  saveImage: (filePath: string, dataUrl: string) => Promise<boolean>
  /** 硬链接：同一物理文件、两个目录入口，不占额外磁盘空间 */
  linkFile?: (sourcePath: string, targetPath: string) => Promise<boolean>
  saveCompositeImage: (filePath: string, dataUrl: string, maxSizeKb?: number) => Promise<boolean>
  authorizeCompositeOutputDirectory?: (dirPath: string) => Promise<boolean>
  saveJson: (filePath: string, data: unknown) => Promise<boolean>
  saveText: (filePath: string, content: string) => Promise<boolean>
  ensureDir: (dirPath: string) => Promise<boolean>
  pathJoin: (...paths: string[]) => Promise<string>
  checkExists: (filePath: string) => Promise<boolean>
  readDir: (dirPath: string) => Promise<string[]>
  readDirEntries?: (dirPath: string) => Promise<Array<{ name: string; isDirectory: boolean }>>
  readImageFile: (filePath: string) => Promise<{ path: string; name: string; dataUrl: string } | null>
  listImageFiles: (dirPath: string) => Promise<{ path: string; name: string; dataUrl?: string }[]>
  listCompositeBackgroundFiles?: (
    dirPath: string,
    recursive: boolean,
  ) => Promise<Array<{ path: string; name: string; relativeDir: string; width: number; height: number }>>
  scanEnteredCompositeBackgroundFolder?: (
    dirPath: string,
    recursive: boolean,
  ) => Promise<
    | {
        success: true
        folderPath: string
        files: Array<{ path: string; name: string; relativeDir: string; width: number; height: number }>
      }
    | { success: false; error: string }
  >
  pickImageFile: (input: {
    path: string
    mode: 'random' | 'sequential'
    index: number
  }) => Promise<{ path: string; name: string; dataUrl: string } | null>
  deleteCompositeFiles?: (filePaths: string[]) => Promise<{ deleted: string[]; failed: string[] }>
  /** 删除本地导出的图片文件（可位于库根外的用户自定义目录；仅限图片扩展名+常规文件） */
  deleteLocalImageFiles?: (filePaths: string[]) => Promise<{ deleted: string[]; failed: string[] }>
  distributeFile?: (input: {
    sourcePath: string
    targetPath: string
    mode: 'copy' | 'move'
    appendRandomByte?: boolean
  }) => Promise<{ success: boolean }>
  readFileBuffer: (filePath: string) => Promise<{ data: ArrayBuffer; name: string } | null>
  getDefaultPath: () => Promise<string>
  getStateFilePath?: () => Promise<string>
  /** 在资源管理器中显示文件/打开目录；目标缺失时主进程回退到最近的已存在父目录。 */
  openInExplorer: (filePath: string) => Promise<{ ok: boolean; error?: string }>
  getLocalSavePath: () => Promise<string | null>
  setLocalSavePath: (path: string) => Promise<void>
  copyCacheToRoot?: (newRoot: string) => Promise<Array<{ from: string; to: string }>>
  readJsonText: (filePath: string) => Promise<string | null>
  writeJsonText: (filePath: string, content: string, backupIntervalOrSkip?: number | boolean) => Promise<boolean>
  listBackups: (filePath: string) => Promise<string[]>
  checkBackupHasData: (backupPath: string) => Promise<boolean>
  restoreFromBackup: (backupPath: string, targetPath: string) => Promise<boolean>
  deleteBackup: (backupPath: string) => Promise<boolean>
  saveZipBuffer: (filePath: string, buffer: ArrayBuffer) => Promise<boolean>
  selectZipSavePath?: (defaultName: string) => Promise<string | null>
  exportZipToPath?: (request: ElectronZipExportRequest) => Promise<{ success: boolean; error?: string }>
  deleteCacheImages?: (filePaths: string[]) => Promise<{ deleted: string[]; failed: string[] }>
  reconcileCacheImages?: (referencedFileNames: string[]) => Promise<{ deleted: string[]; failed: string[] }>
  getDesktopPath: () => Promise<string>
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void
  checkForUpdate: () => Promise<{ success: boolean; error?: string }>
  downloadUpdate: () => Promise<{ success: boolean; error?: string }>
  installUpdate: () => Promise<{ success: boolean }>
  getAppVersion: () => Promise<string>
  getStartupMode?: () => Promise<{ safeMode: boolean }>
  getCloseToTray?: () => Promise<boolean>
  setCloseToTray?: (enabled: boolean) => Promise<boolean>
  assetCatalogUpsert?: (records: Array<{ asset: GeneratedAsset; localPath?: string }>) => Promise<{ success: boolean }>
  assetCatalogRecordUsage?: (events: AssetUsageEvent[]) => Promise<{ success: boolean }>
  assetCatalogExportUsage?: () => Promise<AssetUsageEvent[]>
  assetCatalogGetUsageByAsset?: (assetId: string) => Promise<AssetUsageEvent[]>
  assetCatalogClearUsage?: () => Promise<{ success: boolean }>
  assetCatalogDelete?: (assetIds: string[]) => Promise<{ success: boolean }>
  assetCatalogClear?: () => Promise<{ success: boolean }>
  assetCatalogQuery?: (query: AssetCatalogQuery) => Promise<AssetCatalogCursorPage>
  /** 全量导出素材记录（含回收站），供备份/合并使用 */
  assetCatalogExportAll?: () => Promise<GeneratedAsset[]>
  assetCatalogGet?: (assetId: string) => Promise<unknown>
  /** 按原图 imageId 反查素材详情（素材 id 与 imageId 是两套键） */
  assetCatalogGetByImageId?: (imageId: string) => Promise<unknown>
  assetCatalogGetAssetsByIds?: (ids: string[]) => Promise<GeneratedAsset[]>
  assetCatalogPutCollections?: (records: AssetCollection[]) => Promise<{ success: boolean }>
  assetCatalogDeleteCollection?: (id: string) => Promise<{ success: boolean }>
  /** 软删除项目（进文件夹回收站，整棵子树） */
  assetCatalogTrashCollection?: (id: string) => Promise<{ success: boolean }>
  /** 恢复项目（清除软删除标记，整棵子树） */
  assetCatalogRestoreCollection?: (id: string) => Promise<{ success: boolean }>
  assetCatalogGetCollections?: () => Promise<AssetCollection[]>
  assetCatalogPutTags?: (records: AssetTag[]) => Promise<{ success: boolean }>
  assetCatalogDeleteTag?: (id: string) => Promise<{ success: boolean }>
  assetCatalogGetTags?: () => Promise<AssetTag[]>
  assetCatalogPutTombstones?: (records: AssetTombstone[]) => Promise<{ success: boolean }>
  assetCatalogDeleteTombstone?: (imageId: string) => Promise<{ success: boolean }>
  assetCatalogGetTombstones?: (imageIds: string[]) => Promise<AssetTombstone[]>
  assetCatalogGetAllTombstones?: () => Promise<AssetTombstone[]>
  assetCatalogMetaGet?: (key: string) => Promise<string | null>
  assetCatalogMetaSet?: (key: string, value: string) => Promise<{ success: boolean }>
  assetCatalogPurge?: (
    assetIds: string[],
    now: number,
    tasksToPatch?: Array<{ id: string; value: unknown }>,
  ) => Promise<{
    purged: string[]
    tombstones: AssetTombstone[]
  }>
  /** 清理仅以参考图身份归档的素材（不写墓碑），返回删除的素材 id */
  assetCatalogCleanupReferenceAssets?: () => Promise<string[]>
  /** 近似重复检测（感知哈希 Hamming） */
  assetCatalogNearDuplicates?: (threshold?: number) => Promise<Array<{ assets: GeneratedAsset[]; avgHamming: number }>>
  /** 衍生链（上游输入 + 下游产物） */
  assetCatalogDerivedAssets?: (assetId: string) => Promise<{
    parents: GeneratedAsset[]
    children: GeneratedAsset[]
  }>
  assetCatalogRecommend?: (input: {
    query?: string
    context?: string
    similarToAssetId?: string
    limit?: number
  }) => Promise<Array<{ asset: GeneratedAsset; score: number }>>
  assetCatalogStatus?: () => Promise<{ ready: boolean; assetCount: number; backend: 'sqlite-fts5' }>
  appDataGet?: (namespace: string, id: string) => Promise<unknown>
  appDataGetAll?: (namespace: string) => Promise<unknown[]>
  appDataGetMany?: (namespace: string, ids: string[]) => Promise<unknown[]>
  appDataPut?: (namespace: string, id: string, value: unknown) => Promise<{ success: boolean }>
  appDataPutMany?: (namespace: string, records: Array<{ id: string; value: unknown }>) => Promise<{ success: boolean }>
  appDataReplace?: (namespace: string, records: Array<{ id: string; value: unknown }>) => Promise<{ success: boolean }>
  appDataDelete?: (namespace: string, id: string) => Promise<{ success: boolean }>
  appDataDeleteMany?: (namespace: string, ids: string[]) => Promise<{ success: boolean }>
  appDataDeleteImageRecords?: (ids: string[]) => Promise<{ success: boolean }>
  appDataClearImageRecords?: () => Promise<{ success: boolean }>
  appDataClear?: (namespace: string) => Promise<{ success: boolean }>
  appDataCounts?: (namespaces: string[]) => Promise<Record<string, number>>
  appDataImportStores?: (stores: Record<string, unknown[]>) => Promise<{ success: boolean }>
  appDataCommitImportedRecords?: (records: {
    images: unknown[]
    thumbnails: unknown[]
    tasks: unknown[]
    replaceTasks?: boolean
  }) => Promise<{ success: boolean }>
  appDataUpdateImageLocalPaths?: (mappings: Array<{ from: string; to: string }>) => Promise<{ success: boolean }>
  getAssetApiStatus?: () => Promise<{
    enabled: boolean
    host: '127.0.0.1'
    port: number
    token: string
    baseUrl: string
  }>
  configureAssetApi?: (input: {
    enabled: boolean
    port?: number
  }) => Promise<{ enabled: boolean; host: '127.0.0.1'; port: number; token: string; baseUrl: string }>
  onExternalAssetCommand?: (
    callback: (payload: {
      id: string
      command: {
        action: string
        assetId?: string
        name?: string
        parentId?: string | null
        color?: string | null
        paths?: string[]
      }
    }) => void,
  ) => () => void
  /** doupao:// 深链接（打开素材 / 搜索 / 导入 / 打开项目） */
  onDeepLink?: (
    callback: (
      payload:
        | { kind: 'open'; assetId: string }
        | { kind: 'search'; query: string }
        | { kind: 'import'; path: string }
        | { kind: 'collection'; collectionId: string },
    ) => void,
  ) => () => void
  completeExternalAssetCommand?: (payload: { id: string; result?: unknown; error?: string }) => void
  /** 扫描旧版本 userData 目录（豆泡 / doupao / gpt-image-playground 等），返回可导入内容概况 */
  scanLegacySources?: () => Promise<LegacySourceInfo[]>
  /** 从旧目录导入数据到当前 userData（只复制不覆盖）；IndexedDB 仅复制匹配当前运行模式的目录 */
  importLegacySource?: (payload: {
    sourceDir: string
    selection: {
      importState: boolean
      importLocalSettings: boolean
      importLocalSaves: boolean
      importIndexedDb: boolean
    }
  }) => Promise<{ success: boolean; error?: string; result?: LegacyImportResult }>
  /** 重启应用（导入 IndexedDB 目录后需重启才能被 Chromium 识别） */
  relaunchApp?: () => Promise<{ success: boolean }>
  /** 磁盘真实占用统计（cache-images 原图 + 库根 backups + 库根 thumbs） */
  getDiskStorageUsage?: () => Promise<{
    cacheDir: string | null
    imagesBytes: number
    imagesCount: number
    backupBytes: number
    thumbsBytes: number
    thumbsCount: number
  }>
  /** 读磁盘缩略图（库根 thumbs/，webp）；未命中返回 null。variant='grid' 走网格小图命名空间 */
  readThumbnail?: (
    id: string,
    version: number,
    variant?: 'grid',
  ) => Promise<{ dataUrl: string; width?: number; height?: number } | null>
  /** 写磁盘缩略图（webp 字节）；variant='grid' 走网格小图命名空间 */
  writeThumbnail?: (id: string, version: number, dataUrl: string, variant?: 'grid') => Promise<boolean>
  /** 删除图片的全部磁盘缩略图（full + grid 所有版本），返回删除数量 */
  deleteThumbnails?: (imageIds: string[]) => Promise<{ deleted: number }>
  /** 文件存在性检查（主进程 fs.existsSync，路径限库内） */
  fileExists?: (filePath: string) => Promise<boolean>
  /** 库根备份目录（ZIP 备份默认位置） */
  getLibraryBackupsPath?: () => Promise<string | null>
  /** 库完整性校验（主进程只读：SQLite integrity_check + 原图抽查 + 孤儿/缺失报告） */
  runLibraryIntegrityCheck?: (referencedPaths: string[]) => Promise<{
    catalog: 'ok' | 'corrupt' | 'unavailable'
    catalogDetail?: string
    assetCount: number
    sampled: number
    mismatched: Array<{ fileName: string; expected: string; actual: string }>
    orphanFiles: string[]
    missingFiles: string[]
    checkedAt: number
  } | null>
  /** 按项目树复制原图副本到目标目录（主进程逐文件复制，不占渲染进程内存） */
  exportProjectCopies?: (
    targetRoot: string,
    entries: Array<{ sourcePath: string; targetPath: string; assetId?: string }>,
  ) => Promise<{ copied: number; failed: Array<{ targetPath: string; error: string }>; total: number } | null>
  /** 批量导出图片到文件夹（sourcePath 复制 / dataUrl 写盘） */
  exportImagesToFolder?: (
    targetDir: string,
    files: Array<{ fileName: string; sourcePath?: string; dataUrl?: string }>,
  ) => Promise<{ saved: number; failed: Array<{ fileName: string; error: string }>; total: number } | null>
  /** 原生剪贴板写入图片（主进程 nativeImage） */
  writeImageToClipboard?: (dataUrl: string) => Promise<boolean>
  /** 原生系统通知（主进程 Notification，点击聚焦窗口） */
  showNotification?: (title: string, body?: string) => Promise<boolean>
  /** 通用原生保存对话框 */
  selectSavePath?: (defaultName: string, filters?: { name: string; extensions: string[] }[]) => Promise<string | null>
  /** 主进程流式读取备份 manifest（不整包载入） */
  readZipManifest?: (filePath: string) => Promise<
    | {
        success: true
        manifest: unknown
        entryPaths: string[]
        entriesTotal: number
        totalCompressedBytes: number
        manifestBytes: number
      }
    | { success: false; error: string }
  >
  /** 主进程按条目读取备份内容（含 CRC 校验） */
  readZipEntry?: (
    filePath: string,
    archivePath: string,
  ) => Promise<{ success: true; bytes: Uint8Array } | { success: false; error: string }>
  isElectron: boolean
}

export type ElectronZipExportRequest = {
  destinationPath: string
  manifestJson: string
  entries: Array<
    | { sourcePath: string; archivePath: string; mtime?: number }
    | { data: Uint8Array; archivePath: string; mtime?: number }
  >
}

/** 旧版 userData 目录中的 IndexedDB 数据目录概况（与主进程 legacy-data-import.ts 对应）。 */
export interface LegacyIndexedDbEntryInfo {
  /** leveldb 目录名，如 file__0.indexeddb.leveldb */
  dirName: string
  sizeMb: number
  /** 是否为当前运行模式（打包版 file:// / dev http://localhost:41731）的数据 */
  matchesCurrentOrigin: boolean
}

/** 旧版 userData 目录概况（与主进程 legacy-data-import.ts 对应）。 */
export interface LegacySourceInfo {
  dir: string
  dirName: string
  stateFileMtime: number | null
  hasLocalSettings: boolean
  hasLocalSaves: boolean
  localSavesSizeMb: number
  indexedDbEntries: LegacyIndexedDbEntryInfo[]
  hasBackups: boolean
  sizeMb: number
}

/** 旧数据导入结果（与主进程 legacy-data-import.ts 对应）。 */
export interface LegacyImportResult {
  imported: string[]
  skipped: string[]
  notes: string[]
}

export interface LegacyImportSelection {
  importState: boolean
  importLocalSettings: boolean
  importLocalSaves: boolean
  importIndexedDb: boolean
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

function getAPI(): ElectronAPI | null {
  return typeof window !== 'undefined' ? (window.electronAPI ?? null) : null
}

export function isElectron(): boolean {
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron')) return true
  return Boolean(getAPI()?.isElectron)
}

export async function selectLocalSaveDirectory(): Promise<string | null> {
  const api = getAPI()
  if (!api) return null
  return api.selectDirectory()
}

/** 原生打开对话框（Electron）；非 Electron 环境返回 null。 */
export async function selectFile(filters?: { name: string; extensions: string[] }[]): Promise<string | null> {
  const api = getAPI()
  if (!api?.selectFile) return null
  return api.selectFile(filters)
}

/** 原生保存图片（Electron，主进程写盘）；非 Electron 环境返回 false。 */
export async function saveImage(filePath: string, dataUrl: string): Promise<boolean> {
  const api = getAPI()
  if (!api) return false
  return api.saveImage(filePath, dataUrl)
}

/** 写文本文件（Electron，主进程写盘，无 .bak 自动备份）；非 Electron 环境返回 false。 */
export async function saveText(filePath: string, content: string): Promise<boolean> {
  const api = getAPI()
  if (!api?.saveText) return false
  try {
    return await api.saveText(filePath, content)
  } catch {
    return false
  }
}

export async function getLocalSavePath(): Promise<string | null> {
  const api = getAPI()
  if (!api) return null
  const saved = await api.getLocalSavePath()
  if (saved) return saved
  const defaultPath = await api.getDefaultPath()
  if (defaultPath) {
    await api.setLocalSavePath(defaultPath)
    return defaultPath
  }
  return null
}

export async function setLocalSavePath(path: string): Promise<void> {
  const api = getAPI()
  if (!api) return
  await api.setLocalSavePath(path)
}

export async function copyRawCacheImagesToRoot(newRoot: string): Promise<Array<{ from: string; to: string }>> {
  return (await getAPI()?.copyCacheToRoot?.(newRoot)) ?? []
}

export async function getDefaultLocalSavePath(): Promise<string> {
  const api = getAPI()
  if (!api) return ''
  return api.getDefaultPath()
}

export async function openInExplorer(filePath: string): Promise<{ ok: boolean; error?: string }> {
  const api = getAPI()
  if (!api) return { ok: false, error: '当前环境不支持打开文件位置' }
  try {
    return await api.openInExplorer(filePath)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function readFileBuffer(filePath: string): Promise<{ data: ArrayBuffer; name: string } | null> {
  const api = getAPI()
  if (!api) return null
  return api.readFileBuffer(filePath)
}

export async function readDirectory(dirPath: string): Promise<string[]> {
  const api = getAPI()
  if (!api) return []
  return api.readDir(dirPath)
}

/** 读取目录条目（含文件/目录类型）；非 Electron 环境返回 []。 */
export async function readDirectoryEntries(dirPath: string): Promise<Array<{ name: string; isDirectory: boolean }>> {
  const api = getAPI()
  if (!api?.readDirEntries) return []
  return api.readDirEntries(dirPath)
}

export async function checkPathExists(filePath: string): Promise<boolean | null> {
  const api = getAPI()
  if (!api) return null
  return api.checkExists(filePath)
}

export async function joinPath(...paths: string[]): Promise<string> {
  const api = getAPI()
  if (!api) return paths.join('/')
  return api.pathJoin(...paths)
}

const EXT_MAP: Record<string, string> = {
  png: 'png',
  jpeg: 'jpg',
  jpg: 'jpg',
  webp: 'webp',
}

export function getImageExtensionFromDataUrl(dataUrl: string, fallbackExt: string = 'png'): string {
  const mime = dataUrl.match(/^data:([^;,]+)/i)?.[1]?.toLowerCase()
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/png') return 'png'
  return EXT_MAP[fallbackExt] || fallbackExt || 'png'
}

async function ensureSubDir(basePath: string, subDir: string): Promise<string> {
  const api = getAPI()
  if (!api) return ''
  const dirPath = await api.pathJoin(basePath, subDir)
  await api.ensureDir(dirPath)
  return dirPath
}

export function sanitizeFolderName(name: string): string {
  return (
    name
      .trim()
      // eslint-disable-next-line no-control-regex -- 文件名控制字符剥离是刻意行为
      .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-')
      .replace(/\s+/g, ' ')
      .slice(0, 100) || '未命名'
  )
}

function formatDateVariable(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function resolveOutputDirectoryVariables(path: string): string {
  return path.replace(/\{date\}/gi, formatDateVariable())
}

export function getDirectoryBaseName(dirPath: string): string {
  const normalized = dirPath.trim().replace(/[\\/]+$/, '')
  const parts = normalized.split(/[\\/]+/).filter(Boolean)
  return sanitizeFolderName(parts[parts.length - 1] || 'images')
}

export async function getLocalImageSaveDirectory(subFolder?: string): Promise<string | null> {
  const api = getAPI()
  const basePath = await getLocalSavePath()
  if (!api || !basePath) return null

  let imagesDir = await ensureSubDir(basePath, 'images')
  if (subFolder) {
    imagesDir = await ensureSubDir(imagesDir, sanitizeFolderName(subFolder))
  }
  return imagesDir
}

/** 按多级文件夹段创建本地图片保存目录（如项目层级 `根目录/images/项目A/子项目B`）。
 *  每一段单独 sanitize 后逐级创建，避免整体 sanitize 把路径分隔符抹成 `-`。 */
export async function getLocalImageSaveDirectoryForSegments(segments: string[]): Promise<string | null> {
  const api = getAPI()
  const basePath = await getLocalSavePath()
  if (!api || !basePath) return null

  let imagesDir = await ensureSubDir(basePath, 'images')
  for (const segment of segments) {
    const trimmed = segment?.trim() ?? ''
    if (!trimmed) continue
    imagesDir = await ensureSubDir(imagesDir, sanitizeFolderName(trimmed))
  }
  return imagesDir
}

export async function getExplicitImageSaveDirectory(outputDirectory: string): Promise<string | null> {
  const api = getAPI()
  if (!api) return null
  const trimmed = resolveOutputDirectoryVariables(outputDirectory.trim())
  if (!trimmed) return null
  const ok = await api.ensureDir(trimmed)
  return ok ? trimmed : null
}

export async function saveRawCacheImageToLocal(id: string, dataUrl: string): Promise<string | null> {
  const api = getAPI()
  const basePath = await getLocalSavePath()
  if (!api || !basePath) return null

  const cacheDir = await ensureSubDir(basePath, 'cache-images')
  const ext = getImageExtensionFromDataUrl(dataUrl)
  const filePath = await api.pathJoin(cacheDir, `${id}.${ext}`)

  const success = await api.saveImage(filePath, dataUrl)
  return success ? filePath : null
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const imageSaveQueues = new Map<string, Promise<void>>()

async function saveImageExclusively<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  const previous = imageSaveQueues.get(directory) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => current)
  imageSaveQueues.set(directory, tail)

  await previous
  try {
    return await operation()
  } finally {
    release()
    if (imageSaveQueues.get(directory) === tail) imageSaveQueues.delete(directory)
  }
}

/**
 * 解析本地图片目标路径（含避免覆盖的序号递增）。
 * 供「写字节副本」（saveImageToLocal）与「硬链接」（linkImageToLocal）共用，
 * 保证两种写入方式使用同一套命名规则。
 */
async function resolveLocalImageTargetPath(
  imagesDir: string,
  taskId: string,
  imageIndex: number,
  ext: string,
  fileNameBase?: string,
): Promise<string | null> {
  const api = getAPI()
  if (!api) return null
  const fileExt = EXT_MAP[ext] || 'png'
  const directoryBaseName = getDirectoryBaseName(imagesDir) || sanitizeFolderName(taskId)
  const exactBaseName = fileNameBase ? sanitizeGeneratedImageFilenamePart(fileNameBase, 220) || directoryBaseName : ''
  const exactSequenceMatch = exactBaseName.match(/^(.*)-(\d+)$/)
  const sequencePrefix = exactSequenceMatch?.[1] || directoryBaseName
  const requestedSequence = exactSequenceMatch ? Number.parseInt(exactSequenceMatch[2], 10) : imageIndex + 1
  let fileName = `${exactBaseName || `${directoryBaseName}-${imageIndex + 1}`}.${fileExt}`
  let filePath = await api.pathJoin(imagesDir, fileName)

  // 避免覆盖：如果文件已存在，则自动查找当前目录下的最大序号并递增
  if (await api.checkExists(filePath)) {
    let maxIndex = 0
    try {
      const files = await api.readDir(imagesDir)
      const regex = new RegExp(`^${escapeRegExp(sequencePrefix)}-(\\d+)\\.`)
      for (const file of files) {
        const match = file.match(regex)
        if (match) {
          const idx = parseInt(match[1], 10)
          if (idx > maxIndex) maxIndex = idx
        }
      }
    } catch (err) {
      console.error('Failed to read directory for sequential naming', err)
    }

    let nextIndex = Math.max(maxIndex + 1, requestedSequence + 1)
    fileName = `${sequencePrefix}-${nextIndex}.${fileExt}`
    filePath = await api.pathJoin(imagesDir, fileName)

    while (await api.checkExists(filePath)) {
      nextIndex++
      fileName = `${sequencePrefix}-${nextIndex}.${fileExt}`
      filePath = await api.pathJoin(imagesDir, fileName)
    }
  }

  return filePath
}

export async function saveImageToLocal(
  taskId: string,
  imageIndex: number,
  dataUrl: string,
  ext: string = 'png',
  subFolder?: string,
  outputDirectory?: string,
  fileNameBase?: string,
): Promise<string | null> {
  const api = getAPI()
  if (!api) return null

  const imagesDir = outputDirectory
    ? await getExplicitImageSaveDirectory(outputDirectory)
    : await getLocalImageSaveDirectory(subFolder)
  if (!imagesDir) return null

  return saveImageExclusively(imagesDir, async () => {
    const filePath = await resolveLocalImageTargetPath(imagesDir, taskId, imageIndex, ext, fileNameBase)
    if (!filePath) return null
    const success = await api.saveImage(filePath, dataUrl)
    return success ? filePath : null
  })
}

/**
 * 在工作区目录为目标原图创建**硬链接**（同一物理文件、不占额外磁盘空间）。
 * 源文件缺失或当前环境不支持时返回 null，由调用方回退为字节副本。
 */
export async function linkImageToLocal(
  sourcePath: string,
  taskId: string,
  imageIndex: number,
  ext: string = 'png',
  subFolder?: string,
  outputDirectory?: string,
  fileNameBase?: string,
): Promise<string | null> {
  const api = getAPI()
  const linkFile = api?.linkFile
  if (!api || !linkFile) return null

  const imagesDir = outputDirectory
    ? await getExplicitImageSaveDirectory(outputDirectory)
    : await getLocalImageSaveDirectory(subFolder)
  if (!imagesDir) return null

  return saveImageExclusively(imagesDir, async () => {
    const filePath = await resolveLocalImageTargetPath(imagesDir, taskId, imageIndex, ext, fileNameBase)
    if (!filePath) return null
    const ok = await linkFile(sourcePath, filePath)
    return ok ? filePath : null
  })
}

export async function saveTaskMetaToLocal(taskId: string, task: TaskRecord): Promise<string | null> {
  const api = getAPI()
  const basePath = await getLocalSavePath()
  if (!api || !basePath) return null

  const tasksDir = await ensureSubDir(basePath, 'tasks')
  const filePath = await api.pathJoin(tasksDir, `${taskId}.json`)

  const meta = {
    id: task.id,
    prompt: task.prompt,
    params: task.params,
    actualParams: task.actualParams,
    actualParamsByImage: task.actualParamsByImage,
    revisedPromptByImage: task.revisedPromptByImage,
    apiProvider: task.apiProvider,
    apiProfileName: task.apiProfileName,
    apiMode: task.apiMode,
    apiModel: task.apiModel,
    inputImageIds: task.inputImageIds,
    inputImageFolderPath: task.inputImageFolderPath,
    outputImages: task.outputImages,
    status: task.status,
    createdAt: task.createdAt,
    finishedAt: task.finishedAt,
    elapsed: task.elapsed,
    isFavorite: task.isFavorite,
    sourceMode: task.sourceMode,
    agentToolAction: task.agentToolAction,
  }

  const success = await api.saveJson(filePath, meta)
  return success ? filePath : null
}

export async function savePromptToLocal(taskId: string, prompt: string): Promise<string | null> {
  const api = getAPI()
  const basePath = await getLocalSavePath()
  if (!api || !basePath) return null

  const promptsDir = await ensureSubDir(basePath, 'prompts')
  const filePath = await api.pathJoin(promptsDir, `${taskId}.txt`)

  const success = await api.saveText(filePath, prompt)
  return success ? filePath : null
}

function formatAgentConversationMarkdown(conversation: AgentConversation): string {
  const lines: string[] = []
  lines.push(`# ${conversation.title || 'Agent 对话'}`)
  lines.push('')
  lines.push(`创建时间: ${new Date(conversation.createdAt).toLocaleString()}`)
  lines.push(`更新时间: ${new Date(conversation.updatedAt).toLocaleString()}`)
  lines.push('')

  for (const round of conversation.rounds) {
    const roundIndex = round.index + 1
    lines.push(`---`)
    lines.push(``)
    lines.push(`## 第 ${roundIndex} 轮`)
    lines.push('')

    const userMsg = conversation.messages.find((m) => m.id === round.userMessageId)
    if (userMsg) {
      lines.push(`### 用户`)
      lines.push('')
      lines.push(userMsg.content)
      lines.push('')
    }

    const assistantMsg = conversation.messages.find((m) => m.id === round.assistantMessageId)
    if (assistantMsg) {
      lines.push(`### 助手`)
      lines.push('')
      lines.push(assistantMsg.content)
      lines.push('')
    }

    if (round.error) {
      lines.push(`> 错误: ${round.error}`)
      lines.push('')
    }

    lines.push(`状态: ${round.status === 'done' ? '完成' : round.status === 'error' ? '失败' : '运行中'}`)
    if (round.finishedAt) {
      lines.push(`完成时间: ${new Date(round.finishedAt).toLocaleString()}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

function formatMarkdownJson(value: unknown) {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``
}

function getTaskOutputPath(task: TaskRecord, imageId: string, imageIndex: number) {
  return task.localSavedOutputImagePaths?.[`${imageIndex}:${imageId}`] ?? null
}

export function formatAgentRoundSummaryMarkdown(
  conversation: AgentConversation,
  round: AgentRound,
  tasks: TaskRecord[],
): string {
  const orderedTasks = round.outputTaskIds
    .map((taskId) => tasks.find((task) => task.id === taskId))
    .filter((task): task is TaskRecord => Boolean(task))
  const userMessage = conversation.messages.find((message) => message.id === round.userMessageId)
  const assistantMessage = round.assistantMessageId
    ? conversation.messages.find((message) => message.id === round.assistantMessageId)
    : undefined
  const successCount = orderedTasks.filter((task) => task.outputImages.length > 0).length
  const failedCount = orderedTasks.filter((task) => task.status === 'error').length
  const statusText = round.status === 'done' ? '完成' : round.status === 'error' ? '失败' : '运行中'
  const lines: string[] = [
    `# ${conversation.title || 'Agent 对话'} · 第 ${round.index} 轮`,
    '',
    `- 对话 ID: \`${conversation.id}\``,
    `- 轮次 ID: \`${round.id}\``,
    `- 父轮次: ${round.parentRoundId ? `\`${round.parentRoundId}\`` : '无'}`,
    `- 状态: ${statusText}`,
    `- 开始时间: ${new Date(round.createdAt).toISOString()}`,
    `- 完成时间: ${round.finishedAt ? new Date(round.finishedAt).toISOString() : '未完成'}`,
    `- 图片任务: ${orderedTasks.length}；成功: ${successCount}；失败: ${failedCount}`,
    '',
    '## 用户请求',
    '',
    userMessage?.content || round.prompt || '无',
    '',
    '## 输入资源',
    '',
    `- 参考图 ID: ${round.inputImageIds.length > 0 ? round.inputImageIds.map((id) => `\`${id}\``).join('、') : '无'}`,
    `- 蒙版目标图 ID: ${round.maskTargetImageId ? `\`${round.maskTargetImageId}\`` : '无'}`,
    `- 蒙版图 ID: ${round.maskImageId ? `\`${round.maskImageId}\`` : '无'}`,
    '',
  ]

  if (assistantMessage?.content) {
    lines.push('## Agent 回复', '', assistantMessage.content, '')
  }

  if (round.error) {
    lines.push('## 轮次错误', '', round.error, '')
  }

  lines.push('## 图片任务明细', '')
  if (orderedTasks.length === 0) {
    lines.push('本轮没有图片任务。', '')
  }

  orderedTasks.forEach((task, taskIndex) => {
    lines.push(
      `### ${taskIndex + 1}. 任务 \`${task.id}\``,
      '',
      `- 状态: ${task.status}`,
      `- 批次调用 ID: ${task.agentBatchCallId ? `\`${task.agentBatchCallId}\`` : '无'}`,
      `- 工具调用 ID: ${task.agentToolCallId ? `\`${task.agentToolCallId}\`` : '无'}`,
      `- Provider: ${task.apiProvider ?? '未知'}`,
      `- API 配置: ${task.apiProfileName ?? '未知'}`,
      `- API 模式: ${task.apiMode ?? '未知'}`,
      `- 模型: ${task.apiModel ?? '未知'}`,
      `- 创建时间: ${new Date(task.createdAt).toISOString()}`,
      `- 完成时间: ${task.finishedAt ? new Date(task.finishedAt).toISOString() : '未完成'}`,
      `- 耗时: ${task.elapsed != null ? `${task.elapsed} ms` : '未知'}`,
      '',
      '#### 提示词',
      '',
      task.prompt || '无',
      '',
      '#### 请求参数',
      '',
      formatMarkdownJson(task.params),
      '',
      '#### 实际参数',
      '',
      formatMarkdownJson(task.actualParamsByImage ?? task.actualParams ?? {}),
      '',
      '#### 输出',
      '',
    )

    if (task.outputImages.length === 0) {
      lines.push('- 无输出图片')
    } else {
      task.outputImages.forEach((imageId, imageIndex) => {
        const savedPath = getTaskOutputPath(task, imageId, imageIndex)
        const rawUrl = task.rawImageUrls?.[imageIndex]
        const revisedPrompt = task.revisedPromptByImage?.[imageId]
        lines.push(`- 图片 ${imageIndex + 1}: \`${imageId}\``)
        lines.push(`  - 本地路径: ${savedPath ?? '未保存'}`)
        if (rawUrl) lines.push(`  - 原始 URL: ${rawUrl}`)
        if (revisedPrompt) lines.push(`  - 改写提示词: ${revisedPrompt}`)
      })
    }

    if (task.batchItemStatuses?.length) lines.push('', '#### 批次状态', '', formatMarkdownJson(task.batchItemStatuses))
    if (task.batchItemErrors?.length) lines.push('', '#### 批次错误', '', formatMarkdownJson(task.batchItemErrors))
    if (task.error) lines.push('', '#### 错误', '', task.error)
    lines.push('')
  })

  return lines.join('\n')
}

export async function saveAgentConversationToLocal(
  conversationId: string,
  conversation: AgentConversation,
): Promise<string | null> {
  const api = getAPI()
  const basePath = await getLocalSavePath()
  if (!api || !basePath) return null

  const agentDir = await ensureSubDir(basePath, 'agent')
  const filePath = await api.pathJoin(agentDir, `${conversationId}.md`)

  const markdown = formatAgentConversationMarkdown(conversation)
  const success = await api.saveText(filePath, markdown)
  return success ? filePath : null
}

export async function saveAgentRoundSummaryToLocal(
  conversation: AgentConversation,
  round: AgentRound,
  tasks: TaskRecord[],
): Promise<string | null> {
  const api = getAPI()
  const basePath = await getLocalSavePath()
  if (!api || !basePath) return null

  const agentDir = await ensureSubDir(basePath, 'agent')
  const conversationDir = await ensureSubDir(agentDir, conversation.id)
  const roundNumber = String(round.index).padStart(3, '0')
  const filePath = await api.pathJoin(conversationDir, `round-${roundNumber}-${round.id}.md`)
  const markdown = formatAgentRoundSummaryMarkdown(conversation, round, tasks)
  const success = await api.saveText(filePath, markdown)
  return success ? filePath : null
}

export async function getBackupList(customPath?: string): Promise<string[]> {
  const api = getAPI()
  if (!api) return []
  const defaultPath = await api.getDefaultPath()
  const dataPath = defaultPath.replace(/[\\/]local-saves$/, '')
  return api.listBackups(dataPath + '/gpt-image-playground.json')
}

export async function getBackupPath(): Promise<string> {
  const api = getAPI()
  if (!api) return ''
  const defaultPath = await api.getDefaultPath()
  const dataPath = defaultPath.replace(/[\\/]local-saves$/, '')
  return dataPath + '/backups'
}

export async function selectBackupDirectory(): Promise<string | null> {
  const api = getAPI()
  if (!api) return null
  const result = await api.selectDirectory()
  return result || null
}

export async function createBackupInPath(targetPath: string): Promise<boolean> {
  const api = getAPI()
  if (!api) return false
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const fileName = `doupao_backup_${ts}.json`
  const filePath = targetPath.replace(/[\\/]$/, '') + '/' + fileName
  const defaultPath = await api.getDefaultPath()
  const dataPath = defaultPath.replace(/[\\/]local-saves$/, '')
  const sourcePath = dataPath + '/gpt-image-playground.json'
  try {
    const content = await api.readJsonText(sourcePath)
    if (!content) return false
    await api.ensureDir(targetPath)
    return await api.writeJsonText(filePath, content, true)
  } catch {
    return false
  }
}

export async function checkBackupHasData(backupPath: string): Promise<boolean> {
  const api = getAPI()
  if (!api) return false
  return api.checkBackupHasData(backupPath)
}

export async function restoreFromBackupFile(backupPath: string): Promise<boolean> {
  const api = getAPI()
  if (!api) return false
  const defaultPath = await api.getDefaultPath()
  const dataPath = defaultPath.replace(/[\\/]local-saves$/, '')
  return api.restoreFromBackup(backupPath, dataPath + '/gpt-image-playground.json')
}

export async function deleteBackupFile(backupPath: string): Promise<boolean> {
  const api = getAPI()
  if (!api) return false
  return api.deleteBackup(backupPath)
}

export async function saveZipToPath(filePath: string, buffer: ArrayBuffer): Promise<boolean> {
  const api = getAPI()
  if (!api) return false
  return api.saveZipBuffer(filePath, buffer)
}

export async function exportZipToPath(
  request: ElectronZipExportRequest,
): Promise<{ success: boolean; error?: string }> {
  const api = getAPI()
  return api?.exportZipToPath ? api.exportZipToPath(request) : { success: false, error: '当前环境不支持流式导出' }
}

export async function selectZipSavePath(defaultName: string): Promise<string | null> {
  return getAPI()?.selectZipSavePath?.(defaultName) ?? null
}

/** 通用原生保存对话框（Electron）；非 Electron 环境返回 null。 */
export async function selectSavePath(
  defaultName: string,
  filters?: { name: string; extensions: string[] }[],
): Promise<string | null> {
  return getAPI()?.selectSavePath?.(defaultName, filters) ?? null
}

/** 读 JSON 文本文件（Electron 主进程）；非 Electron 或读取失败返回 null。 */
export async function readJsonTextFile(filePath: string): Promise<string | null> {
  const api = getAPI()
  if (!api) return null
  try {
    return await api.readJsonText(filePath)
  } catch {
    return null
  }
}

/** 写 JSON 文本文件（Electron 主进程，跳过自动备份）；非 Electron 返回 false。 */
export async function writeJsonTextFile(filePath: string, content: string): Promise<boolean> {
  const api = getAPI()
  if (!api) return false
  try {
    return await api.writeJsonText(filePath, content, true)
  } catch {
    return false
  }
}

export async function getDiskStorageUsage(): Promise<{
  cacheDir: string | null
  imagesBytes: number
  imagesCount: number
  backupBytes: number
  thumbsBytes: number
  thumbsCount: number
} | null> {
  return getAPI()?.getDiskStorageUsage?.() ?? null
}

export async function deleteRawCacheImages(filePaths: string[]): Promise<void> {
  const api = getAPI()
  if (api?.deleteCacheImages && filePaths.length > 0) await api.deleteCacheImages(filePaths)
}

/** 删除本地导出的图片文件（可位于库根外自定义目录）；非 Electron 或无 API 时静默跳过。 */
export async function deleteLocalImageFiles(filePaths: string[]): Promise<number> {
  const api = getAPI()
  const uniquePaths = Array.from(
    new Set(filePaths.filter((filePath) => typeof filePath === 'string' && filePath.trim())),
  )
  if (!api?.deleteLocalImageFiles || uniquePaths.length === 0) return 0
  try {
    const result = await api.deleteLocalImageFiles(uniquePaths)
    return result?.deleted?.length ?? 0
  } catch {
    return 0
  }
}

export async function reconcileRawCacheImages(referencedFileNames: string[]): Promise<void> {
  const api = getAPI()
  if (api?.reconcileCacheImages) await api.reconcileCacheImages(referencedFileNames)
}

/** 读磁盘缩略图（库根 thumbs/）；非 Electron 或未命中返回 null。 */
export async function readThumbnailFromDisk(
  id: string,
  version: number,
): Promise<{ dataUrl: string; width?: number; height?: number } | null> {
  const api = getAPI()
  if (!api?.readThumbnail) return null
  try {
    return await api.readThumbnail(id, version)
  } catch {
    return null
  }
}

/** 写磁盘缩略图（webp 字节）；非 Electron 或失败返回 false。 */
export async function writeThumbnailToDisk(id: string, version: number, dataUrl: string): Promise<boolean> {
  const api = getAPI()
  if (!api?.writeThumbnail) return false
  try {
    return await api.writeThumbnail(id, version, dataUrl)
  } catch {
    return false
  }
}

/** 删除图片的全部磁盘缩略图（full + grid 所有版本）：源文件丢失的图清理用。 */
export async function deleteThumbnailsFromDisk(imageIds: string[]): Promise<number> {
  const api = getAPI()
  if (!api?.deleteThumbnails || imageIds.length === 0) return 0
  try {
    const result = await api.deleteThumbnails(imageIds)
    return result?.deleted ?? 0
  } catch {
    return 0
  }
}

/** 文件存在性检查（Electron，主进程 fs.existsSync）；非 Electron 或无 API 返回 true（不做清理判定）。 */
export async function fileExistsOnDisk(filePath: string): Promise<boolean> {
  const api = getAPI()
  if (!api?.fileExists) return true
  try {
    return await api.fileExists(filePath)
  } catch {
    return true
  }
}

/** 库根备份目录（ZIP 备份默认位置）；非 Electron 返回 null。 */
export async function getLibraryBackupsPath(): Promise<string | null> {
  const api = getAPI()
  if (!api?.getLibraryBackupsPath) return null
  try {
    return await api.getLibraryBackupsPath()
  } catch {
    return null
  }
}

/** 库完整性校验（主进程只读）；非 Electron 返回 null。 */
export async function runLibraryIntegrityCheckIpc(referencedPaths: string[]): Promise<{
  catalog: 'ok' | 'corrupt' | 'unavailable'
  catalogDetail?: string
  assetCount: number
  sampled: number
  mismatched: Array<{ fileName: string; expected: string; actual: string }>
  orphanFiles: string[]
  missingFiles: string[]
  checkedAt: number
} | null> {
  const api = getAPI()
  if (!api?.runLibraryIntegrityCheck) return null
  try {
    return await api.runLibraryIntegrityCheck(referencedPaths)
  } catch {
    return null
  }
}

/** 按项目树复制原图副本到目标目录（主进程逐文件复制）；非 Electron 返回 null。 */
export async function exportProjectCopies(
  targetRoot: string,
  entries: Array<{ sourcePath: string; targetPath: string; assetId?: string }>,
): Promise<{ copied: number; failed: Array<{ targetPath: string; error: string }>; total: number } | null> {
  const api = getAPI()
  if (!api?.exportProjectCopies) return null
  try {
    return await api.exportProjectCopies(targetRoot, entries)
  } catch {
    return null
  }
}

/** 批量导出图片到文件夹（主进程逐文件写盘）；非 Electron 返回 null。 */
export async function exportImagesToFolder(
  targetDir: string,
  files: Array<{ fileName: string; sourcePath?: string; dataUrl?: string }>,
): Promise<{ saved: number; failed: Array<{ fileName: string; error: string }>; total: number } | null> {
  const api = getAPI()
  if (!api?.exportImagesToFolder) return null
  try {
    return await api.exportImagesToFolder(targetDir, files)
  } catch {
    return null
  }
}

export async function getDesktopPath(): Promise<string | null> {
  const api = getAPI()
  if (!api) return null
  return api.getDesktopPath()
}

/** 扫描旧版本 userData 目录（豆泡 / doupao / gpt-image-playground 等）；非 Electron 返回 []。 */
export async function scanLegacyDataSources(): Promise<LegacySourceInfo[]> {
  const api = getAPI()
  if (!api?.scanLegacySources) return []
  try {
    return await api.scanLegacySources()
  } catch {
    return []
  }
}

/** 从旧目录导入数据到当前 userData（只复制不覆盖）；IndexedDB 仅导入匹配当前运行模式的目录。 */
export async function importLegacyDataSource(
  sourceDir: string,
  selection: LegacyImportSelection,
): Promise<{ success: boolean; error?: string; result?: LegacyImportResult }> {
  const api = getAPI()
  if (!api?.importLegacySource) return { success: false, error: '当前环境不支持导入旧版数据' }
  try {
    return await api.importLegacySource({ sourceDir, selection })
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** 重启应用（导入 IndexedDB 目录后需重启才能被 Chromium 识别）。 */
export async function relaunchAppAfterImport(): Promise<boolean> {
  const api = getAPI()
  if (!api?.relaunchApp) return false
  try {
    const result = await api.relaunchApp()
    return result?.success === true
  } catch {
    return false
  }
}
