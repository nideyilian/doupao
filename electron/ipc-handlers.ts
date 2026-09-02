import { app, BrowserWindow, clipboard, dialog, nativeImage, Notification, shell } from 'electron'
import path from 'path'
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { promises as fsPromises } from 'fs'
import { writeStreamingZip, type StreamingZipRequest } from './streaming-zip'
import { handleChecked, onChecked } from './ipc-guard'
import { openZipHandle, readZipEntryBytes, readZipManifest } from './backup-zip-reader'
import {
  ensureLibraryLayout,
  getDefaultLibraryRoot,
  getLibraryPaths,
  LIBRARY_LAYOUT_VERSION,
  resolveCatalogDbPathFor,
} from './library-paths'
import { moveLibraryData } from './catalog-migration'
import { runLibraryIntegrityCheck } from './library-integrity'
import { exportProjectTreeCopies, type ProjectCopyEntry } from './project-tree-export'
import { exportImagesToFolderFiles, type FolderImageFileEntry } from './image-folder-export'
import { importLegacySource, scanLegacySources } from './legacy-data-import'

const LOCAL_SETTINGS_FILE = 'local-settings.json'
const sessionAllowedRoots = new Set<string>()

/** 内核生命周期钩子：由 main.ts 在 AssetKernelManager 初始化后注入（close/open 成对调用）。 */
export interface LibraryKernelHooks {
  close: () => Promise<void>
  open: (libraryRoot: string) => Promise<void>
}

let libraryKernelHooks: LibraryKernelHooks | null = null

export function setLibraryKernelHooks(hooks: LibraryKernelHooks | null): void {
  libraryKernelHooks = hooks
}

/**
 * 修改库根：关闭内核 → 移动 db/thumbs/backups → 写设置 → 按新库根重开内核。
 * 任一步失败均回退文件与设置并重开旧库；冲突（目标已含数据库）不移动任何文件。
 */
export async function changeLibraryRoot(next: string): Promise<void> {
  const settings = readLocalSettings()
  const previous =
    typeof settings.localSavePath === 'string' && settings.localSavePath.trim()
      ? normalizeFsPath(settings.localSavePath)
      : null
  const normalizedNext = normalizeFsPath(next)
  const rootChanged = previous !== null && previous !== normalizedNext

  if (!rootChanged) {
    settings.localSavePath = normalizedNext
    writeLocalSettings(settings)
    return
  }

  await libraryKernelHooks?.close()
  try {
    moveLibraryData(previous!, normalizedNext)
    settings.localSavePath = normalizedNext
    writeLocalSettings(settings)
  } catch (error) {
    try {
      if (previous) moveLibraryData(normalizedNext, previous)
    } catch {
      // 回滚尽力而为；旧库文件未动的情况下无需处理
    }
    if (previous) {
      settings.localSavePath = previous
      try {
        writeLocalSettings(settings)
      } catch {
        // 设置回写失败也要重开旧库
      }
    }
    await libraryKernelHooks?.open(previous ?? normalizedNext)
    throw error
  }

  try {
    await libraryKernelHooks?.open(normalizedNext)
  } catch (error) {
    try {
      if (previous) moveLibraryData(normalizedNext, previous)
    } catch {
      // 回滚尽力而为
    }
    if (previous) {
      settings.localSavePath = previous
      try {
        writeLocalSettings(settings)
      } catch {
        // 设置回写失败也要重开旧库
      }
    }
    await libraryKernelHooks?.open(previous ?? normalizedNext)
    throw error
  }
}

export function pruneBackupFiles(pathsByNewestFirst: string[], keep: number): void {
  for (const filePath of pathsByNewestFirst.slice(Math.max(0, keep))) {
    try {
      unlinkSync(filePath)
    } catch {
      // Retention cleanup is best-effort and must not block the current save.
    }
  }
}

export function backupJsonHasData(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const root = value as Record<string, unknown>
  const state = (root.state && typeof root.state === 'object' ? root.state : root) as Record<string, unknown>
  const nonEmptyArray = (key: string) => Array.isArray(state[key]) && state[key].length > 0
  const nonEmptyRecord = (key: string) =>
    Boolean(
      state[key] &&
      typeof state[key] === 'object' &&
      !Array.isArray(state[key]) &&
      Object.keys(state[key] as Record<string, unknown>).length > 0,
    )
  return (
    nonEmptyArray('tasks') ||
    nonEmptyArray('agentConversations') ||
    nonEmptyArray('workspaceTabs') ||
    nonEmptyArray('favoriteCollections') ||
    nonEmptyArray('wordLibraryEntries') ||
    nonEmptyRecord('settings') ||
    nonEmptyRecord('agentInputDrafts')
  )
}

export function copyCacheImageDirectory(sourceDir: string, targetDir: string): Array<{ from: string; to: string }> {
  if (!existsSync(sourceDir)) return []
  mkdirSync(targetDir, { recursive: true })
  const mappings: Array<{ from: string; to: string }> = []
  const supported = new Set(['.png', '.jpg', '.jpeg', '.webp'])
  for (const name of readdirSync(sourceDir).sort()) {
    if (!supported.has(path.extname(name).toLowerCase())) continue
    const from = path.join(sourceDir, name)
    if (!statSync(from).isFile()) continue
    const to = path.join(targetDir, name)
    copyFileSync(from, to)
    if (statSync(from).size !== statSync(to).size) {
      throw new Error(`Cache file verification failed: ${name}`)
    }
    mappings.push({ from, to })
  }
  return mappings
}

function getLocalSettingsPath(): string {
  return path.join(app.getPath('userData'), LOCAL_SETTINGS_FILE)
}

function normalizeFsPath(value: string): string {
  return path.resolve(value)
}

function addAllowedRoot(value: string | null | undefined): void {
  if (!value) return
  sessionAllowedRoots.add(normalizeFsPath(value))
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsPromises.access(filePath)
    return true
  } catch {
    return false
  }
}

async function listBackupFiles(backupDir: string, baseName: string): Promise<string[]> {
  const names = await fsPromises.readdir(backupDir)
  const entries: Array<{ fullPath: string; mtimeMs: number }> = []
  for (const name of names) {
    if (!name.startsWith(`${baseName}-`)) continue
    const fullPath = path.join(backupDir, name)
    try {
      entries.push({ fullPath, mtimeMs: (await fsPromises.stat(fullPath)).mtimeMs })
    } catch {
      // A concurrently removed backup is not relevant to the current write.
    }
  }
  return entries.sort((a, b) => b.mtimeMs - a.mtimeMs).map((entry) => entry.fullPath)
}

async function pruneBackupFilesAsync(pathsByNewestFirst: string[], keep: number): Promise<void> {
  await Promise.all(
    pathsByNewestFirst.slice(Math.max(0, keep)).map(async (filePath) => {
      try {
        await fsPromises.unlink(filePath)
      } catch {
        // Retention cleanup is best-effort and must not block the current save.
      }
    }),
  )
}

export function authorizeCompositeOutputDirectory(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value)) return false
  addAllowedRoot(value)
  return true
}

function getAllowedRoots(): string[] {
  const roots = [
    app.getPath('userData'),
    app.getPath('desktop'),
    app.getPath('documents'),
    app.getPath('downloads'),
    app.getPath('pictures'),
    ...sessionAllowedRoots,
  ]
  const settings = readLocalSettings()
  if (typeof settings.localSavePath === 'string') roots.push(settings.localSavePath)
  return roots.map(normalizeFsPath)
}

function isPathInside(targetPath: string, rootPath: string): boolean {
  const target = normalizeFsPath(targetPath).toLowerCase()
  const root = normalizeFsPath(rootPath).toLowerCase()
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function assertAllowedPath(targetPath: string): string {
  const normalized = normalizeFsPath(targetPath)
  if (!getAllowedRoots().some((root) => isPathInside(normalized, root))) {
    throw new Error('Path is outside allowed application directories')
  }
  return normalized
}

function resolveRealPathSafe(targetPath: string): string {
  try {
    return realpathSync(targetPath)
  } catch {
    return normalizeFsPath(targetPath)
  }
}

function findNearestExistingPath(targetPath: string): string | null {
  let current = normalizeFsPath(targetPath)
  while (true) {
    if (existsSync(current)) return current
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

/**
 * 在资源管理器中显示文件（或打开目录），供 `fs:open-in-explorer` 使用。
 * Windows 下 `shell.showItemInFolder` 对不存在的路径会静默无动作且不抛错，
 * 导致前端点击「打开原图位置」毫无反应（无资源管理器窗口、无错误提示）。
 * 这里在目标不存在时回退到最近的已存在父目录并打开，且统一返回
 * `{ ok }` / `{ ok: false, error }` 让渲染进程能给出可见反馈。
 */
export async function revealInExplorer(safePath: string): Promise<{ ok: boolean; error?: string }> {
  if (!existsSync(safePath)) {
    const nearest = findNearestExistingPath(safePath)
    if (!nearest) return { ok: false, error: '文件不存在' }
    const openError = await shell.openPath(nearest)
    return openError ? { ok: false, error: openError } : { ok: true }
  }
  if (statSync(safePath).isDirectory()) {
    const openError = await shell.openPath(safePath)
    return openError ? { ok: false, error: openError } : { ok: true }
  }
  shell.showItemInFolder(safePath)
  return { ok: true }
}

function assertAllowedRealPath(targetPath: string): string {
  const normalized = assertAllowedPath(targetPath)
  const existingPath = findNearestExistingPath(normalized)
  if (!existingPath) return normalized
  const realPath = resolveRealPathSafe(existingPath)
  const allowedRealRoots = getAllowedRoots().map(resolveRealPathSafe)
  if (!allowedRealRoots.some((root) => isPathInside(realPath, root))) {
    throw new Error('Path resolves outside allowed application directories')
  }
  return normalized
}

export function initLocalSavePath(): void {
  try {
    const settings = readLocalSettings()
    if (!settings.localSavePath) {
      settings.localSavePath = getDefaultLibraryRoot()
      writeLocalSettings(settings)
    }
    if (typeof settings.localSavePath === 'string') addAllowedRoot(settings.localSavePath)
    // 库布局骨架（db/thumbs/backups + library.json），并把布局版本写入设置文件
    ensureLibraryLayout()
    if (typeof settings.libraryVersion !== 'number') {
      settings.libraryVersion = LIBRARY_LAYOUT_VERSION
      writeLocalSettings(settings)
    }
  } catch (err) {
    console.error('初始化本地保存路径失败:', err)
  }
}

function readLocalSettings(): Record<string, unknown> {
  try {
    const content = readFileSync(getLocalSettingsPath(), 'utf-8')
    return JSON.parse(content) as Record<string, unknown>
  } catch {
    return {}
  }
}

function writeLocalSettings(settings: Record<string, unknown>): void {
  writeFileSync(getLocalSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
}

export function readValidJsonText(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null
    const content = readFileSync(filePath, 'utf-8')
    if (!content.trim()) return null
    JSON.parse(content)
    return content
  } catch {
    return null
  }
}

function getCacheImagesDir(): string | null {
  return getLibraryPaths().cacheImages
}

export function deleteCacheImageFiles(filePaths: string[]): { deleted: string[]; failed: string[] } {
  const deleted: string[] = []
  const failed: string[] = []
  const cacheDir = getCacheImagesDir()
  if (!cacheDir) return { deleted, failed: [...filePaths] }
  for (const filePath of filePaths) {
    try {
      const normalized = normalizeFsPath(filePath)
      if (
        !isPathInside(normalized, cacheDir) ||
        path.dirname(normalized).toLowerCase() !== normalizeFsPath(cacheDir).toLowerCase()
      ) {
        throw new Error('outside cache')
      }
      if (existsSync(normalized)) {
        if (!statSync(normalized).isFile()) throw new Error('not a file')
        unlinkSync(normalized)
      }
      deleted.push(filePath)
    } catch {
      failed.push(filePath)
    }
  }
  return { deleted, failed }
}

export function reconcileCacheImageFiles(referencedFileNames: string[]): { deleted: string[]; failed: string[] } {
  const cacheDir = getCacheImagesDir()
  if (!cacheDir || !existsSync(cacheDir)) return { deleted: [], failed: [] }
  const keep = new Set(referencedFileNames)
  return deleteCacheImageFiles(
    readdirSync(cacheDir)
      .filter((name) => !keep.has(name))
      .map((name) => path.join(cacheDir, name)),
  )
}

// ===== 磁盘缩略图缓存（库根 thumbs/，可重建；文件名含版本号，旧版本自动失效） =====

/** 解析 WebP 尺寸（VP8/VP8L/VP8X）；解析失败返回 null（调用方降级为素材元数据尺寸）。 */
export function parseWebpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30) return null
  const text = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length))
  if (text(0, 4) !== 'RIFF' || text(8, 4) !== 'WEBP') return null
  const fourcc = text(12, 4)
  if (fourcc === 'VP8X') {
    // VP8X：canvas 宽高减一，24-bit LE，偏移 24/27
    const width = bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16) + 1
    const height = bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16) + 1
    return { width, height }
  }
  if (fourcc === 'VP8 ') {
    // VP8 有损：帧标签(16-18) + 起始码(19-21) + 宽高 14-bit LE（22-23 / 24-25）
    const width = (bytes[22]! | (bytes[23]! << 8)) & 0x3fff
    const height = (bytes[24]! | (bytes[25]! << 8)) & 0x3fff
    return { width, height }
  }
  if (fourcc === 'VP8L') {
    // VP8L 无损：签名(16) + 4 字节位域（17-20）：14-bit 宽高减一
    const b0 = bytes[17]!
    const b1 = bytes[18]!
    const b2 = bytes[19]!
    const b3 = bytes[20]!
    const width = 1 + (b0 | ((b1 & 0x3f) << 8))
    const height = 1 + (((b1 & 0xc0) >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10))
    return { width, height }
  }
  return null
}

type ThumbVariant = 'full' | 'grid'

/**
 * 缩略图磁盘文件路径（库根 thumbs/）。
 * variant 决定命名空间：网格小图（grid）与详情大图（full）各自独立版本线，
 * 互不清理、互不覆盖（写入 vN 只清理同 variant 的 vN-1 残留）。
 */
function thumbFilePath(id: string, version: number, variant: ThumbVariant = 'full'): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null
  if (!Number.isInteger(version) || version <= 0) return null
  const suffix = variant === 'grid' ? '.grid' : ''
  return path.join(getLibraryPaths().thumbs, `${id}.v${version}${suffix}.webp`)
}

/** 读取磁盘缩略图（库根 thumbs/）；未命中或损坏返回 null。异步 fs，不阻塞主进程事件循环。 */
export async function readThumbnailFile(
  id: string,
  version: number,
  variant: ThumbVariant = 'full',
): Promise<{ dataUrl: string; width?: number; height?: number } | null> {
  const filePath = thumbFilePath(id, version, variant)
  if (!filePath) return null
  try {
    if (!existsSync(filePath)) return null
    const bytes = await fsPromises.readFile(filePath)
    const dims = parseWebpDimensions(bytes)
    return {
      dataUrl: `data:image/webp;base64,${bytes.toString('base64')}`,
      width: dims?.width,
      height: dims?.height,
    }
  } catch {
    return null
  }
}

/** 写磁盘缩略图（webp 字节，dataURL 前缀剥离）；目录不存在自动创建，并清理同 variant 上一版本残留。异步 fs。 */
export async function writeThumbnailFile(
  id: string,
  version: number,
  dataUrl: string,
  variant: ThumbVariant = 'full',
): Promise<boolean> {
  const filePath = thumbFilePath(id, version, variant)
  if (!filePath) return false
  try {
    const { buffer } = dataUrlToBuffer(dataUrl)
    const dir = getLibraryPaths().thumbs
    if (!existsSync(dir)) await fsPromises.mkdir(dir, { recursive: true })
    await fsPromises.writeFile(filePath, buffer)
    // 缩略图是可重建缓存：版本升级后旧版本文件不再被读取，顺手清理避免残留
    // （只清理同 variant 的旧文件：grid 小图与 full 大图是两条独立版本线，互不干扰）
    if (version > 1) {
      const legacyPath = thumbFilePath(id, version - 1, variant)
      if (legacyPath && existsSync(legacyPath)) await fsPromises.unlink(legacyPath)
    }
    return true
  } catch {
    return false
  }
}

/** 磁盘真实占用统计：cache-images 原图目录 + 库根 backups 备份目录 + 库根 thumbs 缩略图缓存（顶层文件）。 */
export function getDiskStorageUsage(): {
  cacheDir: string | null
  imagesBytes: number
  imagesCount: number
  backupBytes: number
  thumbsBytes: number
  thumbsCount: number
} {
  const cacheDir = getCacheImagesDir()
  let imagesBytes = 0
  let imagesCount = 0
  if (cacheDir && existsSync(cacheDir)) {
    for (const name of readdirSync(cacheDir)) {
      try {
        const stat = statSync(path.join(cacheDir, name))
        if (stat.isFile()) {
          imagesBytes += stat.size
          imagesCount++
        }
      } catch {
        // 并发删除的文件跳过
      }
    }
  }
  let backupBytes = 0
  const backupDir = getLibraryPaths().backups
  if (existsSync(backupDir)) {
    for (const name of readdirSync(backupDir)) {
      try {
        const stat = statSync(path.join(backupDir, name))
        if (stat.isFile()) backupBytes += stat.size
      } catch {
        // 并发删除的备份跳过
      }
    }
  }
  let thumbsBytes = 0
  let thumbsCount = 0
  const thumbsDir = getLibraryPaths().thumbs
  if (existsSync(thumbsDir)) {
    for (const name of readdirSync(thumbsDir)) {
      try {
        const stat = statSync(path.join(thumbsDir, name))
        if (stat.isFile()) {
          thumbsBytes += stat.size
          thumbsCount++
        }
      } catch {
        // 并发删除的缩略图跳过
      }
    }
  }
  return { cacheDir, imagesBytes, imagesCount, backupBytes, thumbsBytes, thumbsCount }
}

/** ZIP 备份导出对话框的默认保存路径：库根 backups/（备份收编：新备份默认写入库根）。 */
export function getBackupExportDefaultPath(defaultName: string): string {
  return path.join(getLibraryPaths().backups, defaultName)
}

export function parseStreamingZipRequest(payload: unknown): StreamingZipRequest | null {
  if (!payload || typeof payload !== 'object') return null
  const value = payload as StreamingZipRequest
  if (
    typeof value.destinationPath !== 'string' ||
    typeof value.manifestJson !== 'string' ||
    !Array.isArray(value.entries)
  )
    return null
  if (
    !value.entries.every((entry) => {
      if (
        !entry ||
        typeof entry.archivePath !== 'string' ||
        (entry.mtime !== undefined && typeof entry.mtime !== 'number')
      )
        return false
      const hasSourcePath = 'sourcePath' in entry && typeof entry.sourcePath === 'string'
      const hasData = 'data' in entry && entry.data instanceof Uint8Array
      return hasSourcePath !== hasData
    })
  )
    return null
  return value
}

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mime: string } {
  const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!matches) throw new Error('Invalid data URL format')
  const mime = matches[1]
  const base64 = matches[2]
  return {
    buffer: Buffer.from(base64, 'base64'),
    mime,
  }
}

const COMPOSITE_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const COMPOSITE_DELETE_EXTENSIONS = new Set(['.jpg', '.jpeg'])

type CompositeBackgroundFile = {
  path: string
  name: string
  relativeDir: string
  width: number
  height: number
}

type CompositeDeleteFilesResult = {
  deleted: string[]
  failed: string[]
}

type CompositeBackgroundScanResult =
  { success: true; folderPath: string; files: CompositeBackgroundFile[] } | { success: false; error: string }

type CompositeListBackgroundFilesPayload = {
  dirPath: string
  recursive: boolean
}

function isCompositeImagePath(filePath: string): boolean {
  return COMPOSITE_IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

function mimeFromImagePath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  return 'image/png'
}

function normalizeRelativeDir(relativeDir: string): string {
  return relativeDir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

/**
 * 只解析文件头获取图片尺寸（PNG IHDR / JPEG SOF / WEBP 变体），
 * 替代 nativeImage 全量解码——扫描上千张背景图时不再阻塞主进程数秒。
 */
function getImageSizeSync(filePath: string): { width: number; height: number } {
  const fd = openSync(filePath, 'r')
  const read = (offset: number, length: number): Buffer => {
    const buf = Buffer.alloc(length)
    const n = readSync(fd, buf, 0, length, offset)
    if (n !== length) throw new Error('文件过短')
    return buf
  }
  try {
    const header = read(0, 12)
    if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) {
      // PNG: IHDR 位于偏移 16，宽高为大端 4 字节
      const ihdr = read(16, 8)
      return { width: ihdr.readUInt32BE(0), height: ihdr.readUInt32BE(4) }
    }
    if (header[0] === 0xff && header[1] === 0xd8) {
      // JPEG: 扫描段直到 SOF0/SOF2 等帧标记
      let offset = 2
      while (offset < 16 * 1024 * 1024) {
        const chunk = read(offset, 2)
        if (chunk[0] !== 0xff) {
          offset += 1
          continue
        }
        const marker = chunk[1]
        if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
          offset += 2
          continue
        }
        const segmentLength = read(offset + 2, 2).readUInt16BE(0)
        const isSof =
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf)
        if (isSof) {
          // 段负载：precision(1) + height(2) + width(2)
          const payload = read(offset + 4, 5)
          return { width: payload.readUInt16BE(3), height: payload.readUInt16BE(1) }
        }
        offset += 2 + segmentLength
      }
      throw new Error('JPEG 中未找到尺寸信息')
    }
    if (
      header[0] === 0x52 &&
      header[1] === 0x49 &&
      header[2] === 0x46 &&
      header[3] === 0x46 &&
      header[8] === 0x57 &&
      header[9] === 0x45 &&
      header[10] === 0x42 &&
      header[11] === 0x50
    ) {
      // WEBP (RIFF....WEBP)
      const vp8 = read(20, 4)
      if (vp8[0] === 0x56 && vp8[1] === 0x50 && vp8[2] === 0x38 && vp8[3] === 0x20) {
        // VP8 有损：帧头 14-bit 宽高
        const dim = read(26, 4)
        return { width: dim[0]! | ((dim[1]! & 0x3f) << 8), height: dim[2]! | ((dim[3]! & 0x3f) << 8) }
      }
      if (vp8[0] === 0x56 && vp8[1] === 0x50 && vp8[2] === 0x38 && vp8[3] === 0x4c) {
        // VP8L 无损：位打包的 14-bit 宽高（值 = 实际尺寸 - 1）
        const dim = read(24, 4)
        const width = 1 + (dim[0]! | ((dim[1]! & 0x3f) << 8))
        const height = 1 + (((dim[1]! & 0xc0) >> 6) | (dim[2]! << 2) | ((dim[3]! & 0x0f) << 10))
        return { width, height }
      }
      if (vp8[0] === 0x56 && vp8[1] === 0x50 && vp8[2] === 0x38 && vp8[3] === 0x58) {
        // VP8X 扩展：24-bit 宽高（值 = 实际尺寸 - 1）
        const dim = read(24, 6)
        const width = 1 + dim[0]! + (dim[1]! << 8) + (dim[2]! << 16)
        const height = 1 + dim[3]! + (dim[4]! << 8) + (dim[5]! << 16)
        return { width, height }
      }
      throw new Error('未知 WEBP 变体')
    }
    throw new Error('不支持的图片格式')
  } finally {
    closeSync(fd)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function parseCompositeListBackgroundFilesPayload(payload: unknown): CompositeListBackgroundFilesPayload | null {
  if (!isRecord(payload)) return null
  if (typeof payload.dirPath !== 'string' || typeof payload.recursive !== 'boolean') return null
  return { dirPath: payload.dirPath, recursive: payload.recursive }
}

export function parseDeleteCompositeFilesPayload(payload: unknown): string[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.filePaths)) return null
  if (!payload.filePaths.every((filePath) => typeof filePath === 'string')) return null
  return payload.filePaths
}

function isCompositeDeletePath(filePath: string): boolean {
  return COMPOSITE_DELETE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

function readImageFilePayload(filePath: string) {
  const safeFilePath = assertAllowedPath(filePath)
  if (!existsSync(safeFilePath) || !statSync(safeFilePath).isFile() || !isCompositeImagePath(safeFilePath)) return null
  const buffer = readFileSync(safeFilePath)
  return {
    path: safeFilePath,
    name: path.basename(safeFilePath),
    dataUrl: `data:${mimeFromImagePath(safeFilePath)};base64,${buffer.toString('base64')}`,
  }
}

function listCompositeImageFiles(dirPath: string) {
  const safeDirPath = assertAllowedPath(dirPath)
  if (!existsSync(safeDirPath) || !statSync(safeDirPath).isDirectory()) return []
  return readdirSync(safeDirPath)
    .map((name) => path.join(safeDirPath, name))
    .filter((filePath) => {
      try {
        return statSync(filePath).isFile() && isCompositeImagePath(filePath)
      } catch {
        return false
      }
    })
    .map((filePath) => {
      const buffer = readFileSync(filePath)
      return {
        path: filePath,
        name: path.basename(filePath),
        dataUrl: `data:${mimeFromImagePath(filePath)};base64,${buffer.toString('base64')}`,
      }
    })
}

export function listCompositeBackgroundFiles(dirPath: string, recursive: boolean): CompositeBackgroundFile[] {
  const safeDirPath = assertAllowedRealPath(dirPath)
  if (!existsSync(safeDirPath)) return []
  const dirStat = lstatSync(safeDirPath)
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) return []
  if (!recursive) {
    return readdirSync(safeDirPath).flatMap((name) => {
      const filePath = path.join(safeDirPath, name)
      try {
        const stat = lstatSync(filePath)
        if (stat.isSymbolicLink() || !stat.isFile() || !isCompositeImagePath(filePath)) return []
        assertAllowedRealPath(filePath)

        let width = 0
        let height = 0
        try {
          const dimensions = getImageSizeSync(filePath)
          width = dimensions.width || 0
          height = dimensions.height || 0
        } catch {
          // 无法解析尺寸的图片保留 0，由调用方兜底
        }

        return [
          {
            path: filePath,
            name,
            relativeDir: '',
            width,
            height,
          },
        ]
      } catch {
        return []
      }
    })
  }
  return listCompositeBackgroundFilesRecursive(safeDirPath)
}

export function scanEnteredCompositeBackgroundFolder(
  dirPath: string,
  recursive: boolean,
): CompositeBackgroundScanResult {
  try {
    const trimmedPath = dirPath.trim()
    if (!trimmedPath) throw new Error('请输入文件夹地址。')
    const normalizedPath = normalizeFsPath(trimmedPath)
    if (!existsSync(normalizedPath)) throw new Error('文件夹不存在。')
    const stat = lstatSync(normalizedPath)
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('地址不是可读取的文件夹。')
    }
    const realDirectory = realpathSync(normalizedPath)
    addAllowedRoot(realDirectory)
    return {
      success: true,
      folderPath: realDirectory,
      files: listCompositeBackgroundFiles(realDirectory, recursive),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '无法读取文件夹。',
    }
  }
}

function listCompositeBackgroundFilesRecursive(dirPath: string, rootPath = dirPath): CompositeBackgroundFile[] {
  const safeDirPath = assertAllowedRealPath(dirPath)
  if (!existsSync(safeDirPath)) return []
  const dirStat = lstatSync(safeDirPath)
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) return []
  return readdirSync(safeDirPath).flatMap((name) => {
    const filePath = path.join(safeDirPath, name)
    try {
      const stat = lstatSync(filePath)
      if (stat.isSymbolicLink()) return []
      if (stat.isDirectory()) return listCompositeBackgroundFilesRecursive(filePath, rootPath)
      if (!stat.isFile() || !isCompositeImagePath(filePath)) return []
      assertAllowedRealPath(filePath)
      const relativeDir = path.relative(rootPath, path.dirname(filePath))

      let width = 0
      let height = 0
      try {
        const dimensions = getImageSizeSync(filePath)
        width = dimensions.width || 0
        height = dimensions.height || 0
      } catch {
        // 无法解析尺寸的图片保留 0，由调用方兜底
      }

      return [
        {
          path: filePath,
          name: path.basename(filePath),
          relativeDir: relativeDir === '.' ? '' : normalizeRelativeDir(relativeDir),
          width,
          height,
        },
      ]
    } catch {
      return []
    }
  })
}

export function deleteCompositeFiles(filePaths: string[]): CompositeDeleteFilesResult {
  const deleted: string[] = []
  const failed: string[] = []
  for (const filePath of filePaths) {
    try {
      const safeFilePath = assertAllowedRealPath(filePath)
      if (!isCompositeDeletePath(safeFilePath)) throw new Error('Only jpg files can be deleted')
      if (!existsSync(safeFilePath)) {
        deleted.push(safeFilePath)
        continue
      }
      const stat = lstatSync(safeFilePath)
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Only regular files can be deleted')
      unlinkSync(safeFilePath)
      deleted.push(safeFilePath)
    } catch {
      failed.push(filePath)
    }
  }
  return { deleted, failed }
}

export function handleCompositeListBackgroundFilesPayload(payload: unknown): CompositeBackgroundFile[] {
  const parsed = parseCompositeListBackgroundFilesPayload(payload)
  if (!parsed) return []
  return listCompositeBackgroundFiles(parsed.dirPath, parsed.recursive)
}

export function handleDeleteCompositeFilesPayload(payload: unknown): CompositeDeleteFilesResult {
  const filePaths = parseDeleteCompositeFilesPayload(payload)
  if (!filePaths) return { deleted: [], failed: [] }
  return deleteCompositeFiles(filePaths)
}

/** 可安全删除的本地图片扩展名（本地导出目录里允许存在的图片格式）。 */
const LOCAL_IMAGE_DELETE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])

export interface LocalImageDeleteResult {
  deleted: string[]
  failed: string[]
}

export function parseDeleteLocalImageFilesPayload(payload: unknown): string[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.filePaths)) return null
  if (!payload.filePaths.every((filePath) => typeof filePath === 'string')) return null
  return payload.filePaths
}

/**
 * 删除本地导出的图片文件（用户保存到库根外自定义目录的输出图）。
 * 与 composite:delete-files 不同，这里不限制根目录——本地导出目录由用户显式指定
 * （outputDirectory 可在库根之外）。安全性由以下约束保证：
 * - 仅允许图片扩展名（.png/.jpg/.jpeg/.webp/.gif/.bmp），不会误删库文件/备份/JSON
 * - 仅删除常规文件，拒绝符号链接与目录（防符号链接逃逸）
 * - 拒绝路径中任一中间目录为符号链接/junction 的路径（防 junction 逃逸到未授权位置）
 * - 不存在的文件视为已删除（幂等），删除失败计入 failed 不中断其余文件
 */
export function deleteLocalImageFiles(filePaths: string[]): LocalImageDeleteResult {
  const deleted: string[] = []
  const failed: string[] = []
  for (const rawFilePath of filePaths) {
    if (typeof rawFilePath !== 'string' || !rawFilePath.trim()) continue
    try {
      const normalized = normalizeFsPath(rawFilePath)
      if (!LOCAL_IMAGE_DELETE_EXTENSIONS.has(path.extname(normalized).toLowerCase())) {
        throw new Error('Only image files can be deleted')
      }
      // 检查路径中每个中间目录：任一为符号链接/junction 即拒绝（防逃逸）
      assertNoSymlinkInPath(normalized)
      if (!existsSync(normalized)) {
        deleted.push(normalized)
        continue
      }
      const stat = lstatSync(normalized)
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Only regular files can be deleted')
      unlinkSync(normalized)
      deleted.push(normalized)
    } catch {
      failed.push(rawFilePath)
    }
  }
  return { deleted, failed }
}

/** 拒绝路径中任一中间目录为符号链接/junction 的路径；文件本身不存在时也检查已存在的最深父级。 */
function assertNoSymlinkInPath(targetPath: string): void {
  let current = normalizeFsPath(targetPath)
  const parts: string[] = []
  while (true) {
    if (existsSync(current)) break
    const parent = path.dirname(current)
    if (parent === current) break
    parts.unshift(path.basename(current))
    current = parent
  }
  // 从最深的已存在目录向上检查，再到根
  let probe = current
  while (true) {
    if (existsSync(probe)) {
      const stat = lstatSync(probe)
      if (stat.isSymbolicLink()) throw new Error('Path traverses a symbolic link')
    }
    const parent = path.dirname(probe)
    if (parent === probe) break
    probe = parent
  }
}

export async function distributeCompositeFile(payload: unknown): Promise<{ success: boolean }> {
  if (!payload || typeof payload !== 'object') return { success: false }
  const input = payload as { sourcePath: string; targetPath: string; mode: 'copy' | 'move'; appendRandomByte?: boolean }
  try {
    const sourceSafe = assertAllowedRealPath(input.sourcePath)
    if (!existsSync(sourceSafe)) return { success: false }

    // 目标目录必须已在允许根内（来源目录扫描时已授权，分发目标是其子目录）。
    // 不再自动加根：防止渲染进程借该通道把任意目录加入白名单。
    const targetSafe = assertAllowedRealPath(input.targetPath)

    mkdirSync(path.dirname(targetSafe), { recursive: true })

    if (input.mode === 'move') {
      try {
        renameSync(sourceSafe, targetSafe)
      } catch (error) {
        // 跨盘符 rename 会抛 EXDEV：回退为复制 + 删除源文件
        if ((error as NodeJS.ErrnoException)?.code === 'EXDEV') {
          copyFileSync(sourceSafe, targetSafe)
          unlinkSync(sourceSafe)
        } else {
          throw error
        }
      }
    } else {
      copyFileSync(sourceSafe, targetSafe)
    }

    if (input.appendRandomByte) {
      const buffer = Buffer.from([Math.floor(Math.random() * 256)])
      appendFileSync(targetSafe, buffer)
    }

    return { success: true }
  } catch (error) {
    console.error('distributeCompositeFile error', error)
    return { success: false }
  }
}

export function registerIpcHandlers(): void {
  handleChecked('fs:select-directory', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory'],
      title: '选择本地保存目录',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    addAllowedRoot(result.filePaths[0])
    return result.filePaths[0]
  })

  handleChecked('fs:select-file', async (event, { filters }: { filters?: Electron.FileFilter[] }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      title: '选择本地文件',
      filters: filters ?? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    addAllowedRoot(path.dirname(result.filePaths[0]))
    return result.filePaths[0]
  })

  handleChecked('fs:select-files', async (event, { filters }: { filters?: Electron.FileFilter[] }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      title: '选择本地文件',
      filters: filters ?? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    result.filePaths.forEach((p) => addAllowedRoot(path.dirname(p)))
    return result.filePaths
  })

  handleChecked('fs:save-image', async (_event, { filePath, dataUrl }: { filePath: string; dataUrl: string }) => {
    try {
      const safeFilePath = assertAllowedPath(filePath)
      const { buffer } = dataUrlToBuffer(dataUrl)
      const dir = path.dirname(safeFilePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(safeFilePath, buffer)
      return true
    } catch (err) {
      console.error('保存图片失败:', err)
      return false
    }
  })

  // 硬链接：同一物理文件、两个目录入口，不占额外磁盘空间。
  // 用于「按工作区目录提供原图」——cache-images 保持唯一原图，工作区目录只挂链接。
  handleChecked(
    'fs:link-file',
    async (_event, { sourcePath, targetPath }: { sourcePath: string; targetPath: string }) => {
      try {
        const safeSourcePath = assertAllowedPath(sourcePath)
        const safeTargetPath = assertAllowedPath(targetPath)
        if (!existsSync(safeSourcePath) || !statSync(safeSourcePath).isFile()) return false
        const dir = path.dirname(safeTargetPath)
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
        linkSync(safeSourcePath, safeTargetPath)
        return true
      } catch (err) {
        console.error('创建硬链接失败:', err)
        return false
      }
    },
  )

  handleChecked('fs:save-json', async (_event, { filePath, data }: { filePath: string; data: unknown }) => {
    try {
      const safeFilePath = assertAllowedPath(filePath)
      const dir = path.dirname(safeFilePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(safeFilePath, JSON.stringify(data, null, 2), 'utf-8')
      return true
    } catch (err) {
      console.error('保存 JSON 失败:', err)
      return false
    }
  })

  handleChecked('fs:save-text', async (_event, { filePath, content }: { filePath: string; content: string }) => {
    try {
      const safeFilePath = assertAllowedPath(filePath)
      const dir = path.dirname(safeFilePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(safeFilePath, content, 'utf-8')
      return true
    } catch (err) {
      console.error('保存文本失败:', err)
      return false
    }
  })

  handleChecked('fs:ensure-dir', async (_event, { dirPath }: { dirPath: string }) => {
    try {
      const safeDirPath = assertAllowedPath(dirPath)
      if (!existsSync(safeDirPath)) mkdirSync(safeDirPath, { recursive: true })
      return true
    } catch (err) {
      console.error('创建目录失败:', err)
      return false
    }
  })

  handleChecked('fs:remove-empty-dir', async (_event, { dirPath }: { dirPath: string }) => {
    try {
      const safeDirPath = assertAllowedPath(dirPath)
      if (existsSync(safeDirPath) && statSync(safeDirPath).isDirectory()) {
        const files = readdirSync(safeDirPath)
        if (files.length === 0) {
          rmdirSync(safeDirPath)
          return true
        }
      }
      return false
    } catch (err) {
      console.error('删除空目录失败:', err)
      return false
    }
  })

  handleChecked('fs:path-join', async (_event, { paths }: { paths: string[] }) => {
    return path.join(...paths)
  })

  handleChecked('fs:check-exists', async (_event, { filePath }: { filePath: string }) => {
    try {
      return existsSync(assertAllowedPath(filePath))
    } catch {
      return false
    }
  })

  handleChecked('fs:read-dir', async (_event, { dirPath }: { dirPath: string }) => {
    try {
      const safeDirPath = assertAllowedPath(dirPath)
      if (!existsSync(safeDirPath)) return []
      return readdirSync(safeDirPath)
    } catch {
      return []
    }
  })

  handleChecked(
    'fs:read-dir-entries',
    async (_event, { dirPath }: { dirPath: string }): Promise<Array<{ name: string; isDirectory: boolean }>> => {
      try {
        const safeDirPath = assertAllowedPath(dirPath)
        if (!existsSync(safeDirPath)) return []
        return readdirSync(safeDirPath, { withFileTypes: true }).map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
        }))
      } catch {
        return []
      }
    },
  )

  handleChecked('composite:read-image-file', async (_event, { filePath }: { filePath: string }) => {
    try {
      return readImageFilePayload(filePath)
    } catch (err) {
      console.error('读取合成图片失败:', err)
      return null
    }
  })

  handleChecked('composite:list-image-files', async (_event, { dirPath }: { dirPath: string }) => {
    try {
      return listCompositeImageFiles(dirPath)
    } catch (err) {
      console.error('列出合成图片失败:', err)
      return []
    }
  })

  handleChecked('composite:list-background-files', async (_event, payload: unknown) => {
    try {
      return handleCompositeListBackgroundFilesPayload(payload)
    } catch (err) {
      console.error('Failed to list composite background files:', err)
      return []
    }
  })

  handleChecked('composite:scan-entered-background-folder', async (_event, payload: unknown) => {
    const parsed = parseCompositeListBackgroundFilesPayload(payload)
    if (!parsed) return { success: false, error: '文件夹参数无效。' }
    return scanEnteredCompositeBackgroundFolder(parsed.dirPath, parsed.recursive)
  })

  handleChecked(
    'composite:pick-image-file',
    async (
      _event,
      { path: inputPath, mode, index }: { path: string; mode: 'random' | 'sequential'; index: number },
    ) => {
      try {
        const safePath = assertAllowedPath(inputPath)
        const stat = statSync(safePath)
        if (stat.isFile()) return readImageFilePayload(safePath)
        if (!stat.isDirectory()) return null
        const files = listCompositeImageFiles(safePath)
        if (!files.length) return null
        const picked =
          mode === 'random'
            ? files[Math.floor(Math.random() * files.length)]
            : files[((index % files.length) + files.length) % files.length]
        return readImageFilePayload(picked.path)
      } catch (err) {
        console.error('抽取合成图片失败:', err)
        return null
      }
    },
  )

  handleChecked('composite:delete-files', async (_event, payload: unknown) => {
    try {
      return handleDeleteCompositeFilesPayload(payload)
    } catch (err) {
      console.error('Failed to delete composite files:', err)
      return { deleted: [], failed: [] }
    }
  })

  handleChecked('fs:delete-local-image-files', async (_event, payload: unknown) => {
    try {
      const filePaths = parseDeleteLocalImageFilesPayload(payload)
      if (!filePaths) return { deleted: [], failed: [] }
      return deleteLocalImageFiles(filePaths)
    } catch (err) {
      console.error('Failed to delete local image files:', err)
      return { deleted: [], failed: [] }
    }
  })

  handleChecked('composite:distribute-file', async (_event, payload) => distributeCompositeFile(payload))

  handleChecked('composite:authorize-output-directory', async (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return false
    return authorizeCompositeOutputDirectory((payload as { dirPath?: unknown }).dirPath)
  })

  handleChecked('fs:read-file-buffer', async (_event, { filePath }: { filePath: string }) => {
    try {
      const safeFilePath = assertAllowedPath(filePath)
      if (!existsSync(safeFilePath)) return null
      const buffer = readFileSync(safeFilePath)
      const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
      return { data: arrayBuffer, name: path.basename(safeFilePath) }
    } catch (err) {
      console.error('读取文件失败:', err)
      return null
    }
  })

  handleChecked(
    'composite:save-image',
    async (_event, { filePath, dataUrl }: { filePath: string; dataUrl: string; maxSizeKb?: number }) => {
      try {
        const safeFilePath = assertAllowedPath(filePath)
        const { buffer } = dataUrlToBuffer(dataUrl)
        const dir = path.dirname(safeFilePath)
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
        writeFileSync(safeFilePath, buffer)
        return true
      } catch (err) {
        console.error('保存合成图片失败:', err)
        return false
      }
    },
  )

  handleChecked('fs:get-default-path', async () => {
    return getDefaultLibraryRoot()
  })

  // 主状态文件路径固定收敛在 userData 根（文件名与 src/store.ts 的持久化名称一致），
  // 不随「素材库位置」等设置变化；渲染端持久化存储用它替代对 get-default-path 的字符串裁剪，
  // 避免库根语义变化时状态文件路径漂移导致“升级后数据全部消失”。
  handleChecked('fs:get-state-file-path', async () => {
    return path.join(app.getPath('userData'), 'gpt-image-playground.json')
  })

  handleChecked('fs:get-desktop-path', async () => {
    return app.getPath('desktop')
  })

  handleChecked('fs:open-in-explorer', async (_event, { filePath }: { filePath: string }) => {
    const safePath = assertAllowedPath(filePath)
    return revealInExplorer(safePath)
  })

  handleChecked('store:get-local-save-path', async () => {
    const settings = readLocalSettings()
    return (settings.localSavePath as string) ?? null
  })

  handleChecked('store:set-local-save-path', async (_event, { path: savePath }: { path: string }) => {
    const safeSavePath = assertAllowedPath(savePath)
    addAllowedRoot(safeSavePath)
    await changeLibraryRoot(safeSavePath)
  })

  handleChecked('store:copy-cache-to-root', async (_event, { newRoot }: { newRoot: string }) => {
    const safeNewRoot = assertAllowedPath(newRoot)
    addAllowedRoot(safeNewRoot)
    const sourceDir = getCacheImagesDir()
    if (!sourceDir) return []
    return copyCacheImageDirectory(sourceDir, path.join(safeNewRoot, 'cache-images'))
  })

  handleChecked('fs:read-json-text', async (_event, { filePath }: { filePath: string }) => {
    try {
      const safeFilePath = assertAllowedPath(filePath)
      const content = readValidJsonText(safeFilePath)
      if (content) return content
      const bakPath = assertAllowedPath(safeFilePath + '.bak')
      return readValidJsonText(bakPath)
    } catch (err) {
      console.error('读取 JSON 文本失败:', err)
      try {
        const bakPath = assertAllowedPath(filePath) + '.bak'
        return readValidJsonText(bakPath)
      } catch {}
      return null
    }
  })

  handleChecked(
    'fs:write-json-text',
    async (
      _event,
      {
        filePath,
        content,
        skipBackup,
        backupInterval,
      }: { filePath: string; content: string; skipBackup?: boolean; backupInterval?: number },
    ) => {
      try {
        const safeFilePath = assertAllowedPath(filePath)
        const dir = path.dirname(safeFilePath)
        await fsPromises.mkdir(dir, { recursive: true })
        // 写入前自动备份旧文件
        const fileExists = await pathExists(safeFilePath)
        if (!skipBackup && fileExists) {
          try {
            const backupDir = path.join(dir, 'backups')
            await fsPromises.mkdir(backupDir, { recursive: true })
            const intervalMs = (backupInterval ?? 0) * 60 * 1000
            const baseName = path.basename(safeFilePath).replace(/\.[^.]+$/, '')
            let shouldBackup = true
            if (intervalMs > 0) {
              const backups = await listBackupFiles(backupDir, baseName)
              if (backups.length > 0) {
                const lastBackupTime = (await fsPromises.stat(backups[0])).mtimeMs
                shouldBackup = Date.now() - lastBackupTime >= intervalMs
              }
            }
            if (shouldBackup) {
              const ts = new Date().toISOString().replace(/[:.]/g, '-')
              const backupName = baseName + '-' + ts + '.json'
              await fsPromises.copyFile(safeFilePath, path.join(backupDir, backupName))
            }
            // 只保留最近 30 个备份
            await pruneBackupFilesAsync(await listBackupFiles(backupDir, baseName), 30)
          } catch (backupErr) {
            console.error('自动备份失败（不影响写入）:', backupErr)
          }
        }
        const bakPath = safeFilePath + '.bak'
        if (fileExists) {
          try {
            await fsPromises.copyFile(safeFilePath, bakPath)
          } catch {}
        }
        const tmpPath = safeFilePath + '.tmp'
        await fsPromises.writeFile(tmpPath, content, 'utf-8')
        try {
          await fsPromises.rename(tmpPath, safeFilePath)
        } catch {
          try {
            await fsPromises.copyFile(tmpPath, safeFilePath)
          } catch {}
          try {
            await fsPromises.unlink(tmpPath)
          } catch {}
        }
        return true
      } catch (err) {
        console.error('写入 JSON 文本失败:', err)
        return false
      }
    },
  )

  handleChecked('fs:list-backups', async (_event, { filePath }: { filePath: string }) => {
    try {
      const safeFilePath = assertAllowedPath(filePath)
      const dir = path.join(path.dirname(safeFilePath), 'backups')
      if (!existsSync(dir)) return []
      return readdirSync(dir)
        .map((name) => ({ name, fullPath: path.join(dir, name) }))
        .filter((f) => f.name.startsWith(path.basename(safeFilePath).replace(/\.[^.]+$/, '') + '-'))
        .sort((a, b) => statSync(b.fullPath).mtimeMs - statSync(a.fullPath).mtimeMs)
        .map((f) => f.fullPath)
    } catch (err) {
      console.error('列出备份失败:', err)
      return []
    }
  })

  handleChecked('fs:check-backup-has-data', async (_event, { backupPath }: { backupPath: string }) => {
    try {
      const safeBackupPath = assertAllowedPath(backupPath)
      if (!existsSync(safeBackupPath)) return false
      const content = readFileSync(safeBackupPath, 'utf-8')
      return backupJsonHasData(JSON.parse(content))
    } catch (err) {
      return false
    }
  })

  handleChecked(
    'fs:restore-from-backup',
    async (_event, { backupPath, targetPath }: { backupPath: string; targetPath: string }) => {
      try {
        const safeBackupPath = assertAllowedPath(backupPath)
        const safeTargetPath = assertAllowedPath(targetPath)
        if (!existsSync(safeBackupPath)) return false
        const content = readValidJsonText(safeBackupPath)
        if (!content) return false
        const dir = path.dirname(safeTargetPath)
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
        const tempPath = `${safeTargetPath}.restore-tmp`
        try {
          writeFileSync(tempPath, content, 'utf-8')
          try {
            renameSync(tempPath, safeTargetPath)
          } catch {
            copyFileSync(tempPath, safeTargetPath)
          }
        } finally {
          try {
            unlinkSync(tempPath)
          } catch {}
        }
        return true
      } catch (err) {
        console.error('从备份恢复失败:', err)
        return false
      }
    },
  )

  handleChecked('fs:delete-backup', async (_event, { backupPath }: { backupPath: string }) => {
    try {
      const safeBackupPath = assertAllowedPath(backupPath)
      if (!existsSync(safeBackupPath)) return false
      unlinkSync(safeBackupPath)
      return true
    } catch (err) {
      console.error('删除备份失败:', err)
      return false
    }
  })

  handleChecked(
    'fs:save-zip-buffer',
    async (_event, { filePath, buffer }: { filePath: string; buffer: ArrayBuffer }) => {
      try {
        const safeFilePath = assertAllowedPath(filePath)
        const dir = path.dirname(safeFilePath)
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
        writeFileSync(safeFilePath, Buffer.from(buffer))
        return true
      } catch (err) {
        console.error('保存 ZIP 文件失败:', err)
        return false
      }
    },
  )

  handleChecked('fs:select-zip-save-path', async (event, payload: { defaultName?: unknown }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showSaveDialog(win!, {
      title: '导出数据',
      defaultPath: getBackupExportDefaultPath(
        typeof payload?.defaultName === 'string' ? payload.defaultName : 'gpt-image-playground-backup.zip',
      ),
      filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
    })
    return result.canceled ? null : (result.filePath ?? null)
  })

  handleChecked('fs:get-library-backups-path', () => getLibraryPaths().backups)

  handleChecked('store:delete-cache-images', (_event, payload: { filePaths?: unknown }) =>
    deleteCacheImageFiles(
      Array.isArray(payload?.filePaths)
        ? payload.filePaths.filter((item): item is string => typeof item === 'string')
        : [],
    ),
  )

  handleChecked('store:reconcile-cache-images', (_event, payload: { referencedFileNames?: unknown }) =>
    reconcileCacheImageFiles(
      Array.isArray(payload?.referencedFileNames)
        ? payload.referencedFileNames.filter((item): item is string => typeof item === 'string')
        : [],
    ),
  )

  handleChecked('thumb:read', async (_event, payload: { id?: unknown; version?: unknown; variant?: unknown }) => {
    if (typeof payload?.id !== 'string' || typeof payload?.version !== 'number') return null
    return readThumbnailFile(payload.id, payload.version, payload.variant === 'grid' ? 'grid' : 'full')
  })

  handleChecked(
    'thumb:save',
    async (_event, payload: { id?: unknown; version?: unknown; dataUrl?: unknown; variant?: unknown }) => {
      if (
        typeof payload?.id !== 'string' ||
        typeof payload?.version !== 'number' ||
        typeof payload?.dataUrl !== 'string'
      ) {
        return false
      }
      return writeThumbnailFile(
        payload.id,
        payload.version,
        payload.dataUrl,
        payload.variant === 'grid' ? 'grid' : 'full',
      )
    },
  )

  /** 删除图片的全部磁盘缩略图（full + grid 所有版本）：源文件丢失的图清理用。 */
  handleChecked('thumb:delete', async (_event, payload: { imageIds?: unknown }) => {
    const ids = Array.isArray(payload?.imageIds)
      ? payload.imageIds.filter((id): id is string => typeof id === 'string')
      : []
    let deleted = 0
    for (const id of ids) {
      const thumbsDir = getLibraryPaths().thumbs
      if (!existsSync(thumbsDir)) continue
      for (const name of readdirSync(thumbsDir)) {
        if (name.startsWith(`${id}.v`) && name.endsWith('.webp')) {
          try {
            await fsPromises.unlink(path.join(thumbsDir, name))
            deleted++
          } catch {
            // 单个文件删除失败不影响其他
          }
        }
      }
    }
    return { deleted }
  })

  handleChecked('fs:exists', async (_event, payload: { filePath?: unknown }) => {
    if (typeof payload?.filePath !== 'string') return false
    try {
      return existsSync(assertAllowedPath(payload.filePath))
    } catch {
      return false
    }
  })

  handleChecked('library:integrity-check', (_event, payload: { referencedPaths?: unknown }) => {
    const referencedPaths = Array.isArray(payload?.referencedPaths)
      ? payload.referencedPaths.filter((item): item is string => typeof item === 'string')
      : []
    return runLibraryIntegrityCheck(referencedPaths)
  })

  handleChecked('library:export-project-copies', (_event, payload: { targetRoot?: unknown; entries?: unknown }) => {
    try {
      if (typeof payload?.targetRoot !== 'string' || !path.isAbsolute(payload.targetRoot)) {
        return { copied: 0, failed: [{ targetPath: '', error: '目标目录无效' }], total: 0 }
      }
      addAllowedRoot(payload.targetRoot)
      const entries: ProjectCopyEntry[] = []
      if (Array.isArray(payload?.entries)) {
        for (const raw of payload.entries) {
          if (!raw || typeof raw !== 'object') continue
          const record = raw as Record<string, unknown>
          if (typeof record.sourcePath !== 'string' || typeof record.targetPath !== 'string') continue
          entries.push({
            sourcePath: record.sourcePath,
            targetPath: record.targetPath,
            assetId: typeof record.assetId === 'string' ? record.assetId : undefined,
          })
        }
      }
      return exportProjectTreeCopies(payload.targetRoot, entries, assertAllowedRealPath)
    } catch (error) {
      return {
        copied: 0,
        failed: [{ targetPath: '', error: error instanceof Error ? error.message : String(error) }],
        total: 0,
      }
    }
  })

  handleChecked('fs:export-images-to-folder', (_event, payload: { targetDir?: unknown; files?: unknown }) => {
    try {
      if (typeof payload?.targetDir !== 'string' || !path.isAbsolute(payload.targetDir)) {
        return { saved: 0, failed: [{ fileName: '', error: '目标目录无效' }], total: 0 }
      }
      addAllowedRoot(payload.targetDir)
      const files: FolderImageFileEntry[] = []
      if (Array.isArray(payload?.files)) {
        for (const raw of payload.files) {
          if (!raw || typeof raw !== 'object') continue
          const record = raw as Record<string, unknown>
          if (typeof record.fileName !== 'string') continue
          files.push({
            fileName: record.fileName,
            sourcePath: typeof record.sourcePath === 'string' ? record.sourcePath : undefined,
            dataUrl: typeof record.dataUrl === 'string' ? record.dataUrl : undefined,
          })
        }
      }
      return exportImagesToFolderFiles(payload.targetDir, files, assertAllowedRealPath)
    } catch (error) {
      return {
        saved: 0,
        failed: [{ fileName: '', error: error instanceof Error ? error.message : String(error) }],
        total: 0,
      }
    }
  })

  handleChecked('fs:export-zip', async (_event, payload: unknown) => {
    try {
      const request = parseStreamingZipRequest(payload)
      if (!request) return { success: false, error: '导出参数无效' }
      const destinationPath = assertAllowedPath(request.destinationPath)
      const entries = request.entries.map((entry) => {
        if (typeof entry.sourcePath === 'string') {
          return { ...entry, sourcePath: assertAllowedRealPath(entry.sourcePath) }
        }
        return entry
      })
      return writeStreamingZip({ ...request, destinationPath, entries })
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  handleChecked('storage:get-disk-usage', () => getDiskStorageUsage())

  handleChecked('clipboard:write-image', (_event, payload: { dataUrl?: unknown }) => {
    try {
      if (typeof payload?.dataUrl !== 'string') return false
      const image = nativeImage.createFromDataURL(payload.dataUrl)
      if (image.isEmpty()) return false
      clipboard.writeImage(image)
      return true
    } catch (error) {
      console.error('写入剪贴板失败:', error)
      return false
    }
  })

  handleChecked('notification:show', (event, payload: { title?: unknown; body?: unknown }) => {
    if (typeof payload?.title !== 'string' || !payload.title) return false
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      const notification = new Notification({
        title: payload.title,
        body: typeof payload.body === 'string' ? payload.body : '',
      })
      notification.on('click', () => {
        if (!win || win.isDestroyed()) return
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
      })
      notification.show()
      return true
    } catch (error) {
      console.error('发送系统通知失败:', error)
      return false
    }
  })

  handleChecked('fs:select-save-path', async (event, payload: { defaultName?: unknown; filters?: unknown }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showSaveDialog(win!, {
      title: '保存文件',
      defaultPath: typeof payload?.defaultName === 'string' ? payload.defaultName : 'untitled',
      filters: Array.isArray(payload?.filters) ? (payload.filters as Electron.FileFilter[]) : undefined,
    })
    return result.canceled ? null : (result.filePath ?? null)
  })

  handleChecked('backup:read-zip-manifest', async (_event, payload: { filePath?: unknown }) => {
    try {
      if (typeof payload?.filePath !== 'string') return { success: false, error: '缺少文件路径' }
      const safePath = assertAllowedPath(payload.filePath)
      const handle = openZipHandle(safePath)
      const { manifest, manifestBytes } = readZipManifest(handle)
      const entries = [...handle.entriesByPath.values()]
      return {
        success: true,
        manifest,
        entryPaths: entries.map((entry) => entry.archivePath),
        entriesTotal: entries.length,
        totalCompressedBytes: entries.reduce((sum, entry) => sum + entry.compressedSize, 0),
        manifestBytes,
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  handleChecked('backup:read-zip-entry', async (_event, payload: { filePath?: unknown; archivePath?: unknown }) => {
    try {
      if (typeof payload?.filePath !== 'string' || typeof payload?.archivePath !== 'string') {
        return { success: false, error: '参数无效' }
      }
      const safePath = assertAllowedPath(payload.filePath)
      const handle = openZipHandle(safePath)
      const bytes = readZipEntryBytes(handle, payload.archivePath)
      return { success: true, bytes }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // ===== 旧版数据导入（设置页「数据管理」）=====

  handleChecked('data:scan-legacy-sources', () => {
    return scanLegacySources()
  })

  handleChecked(
    'data:import-legacy-source',
    (
      _event,
      payload: {
        sourceDir?: unknown
        selection?: {
          importState?: unknown
          importLocalSettings?: unknown
          importLocalSaves?: unknown
          importIndexedDb?: unknown
        }
      },
    ) => {
      if (typeof payload?.sourceDir !== 'string' || !payload.sourceDir.trim()) {
        return { success: false, error: '缺少来源目录' }
      }
      // 只允许导入「已知旧目录名」或当前 userData 同级目录，杜绝任意路径写入。
      const allowed = new Set(scanLegacySources().map((source) => source.dir))
      if (!allowed.has(payload.sourceDir)) {
        return { success: false, error: '来源目录不在旧版数据目录列表中' }
      }
      const selection = payload.selection ?? {}
      try {
        const result = importLegacySource(payload.sourceDir, app.getPath('userData'), {
          importState: selection.importState === true,
          importLocalSettings: selection.importLocalSettings === true,
          importLocalSaves: selection.importLocalSaves === true,
          importIndexedDb: selection.importIndexedDb === true,
        })
        return { success: true, result }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  )

  handleChecked('app:relaunch', () => {
    app.relaunch()
    app.exit(0)
    return { success: true }
  })
}
