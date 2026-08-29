import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'

/**
 * 库路径收敛模块（对应 docs/superpowers/specs/2026-08-20-self-contained-library-design.md）。
 *
 * 目标：Electron 端所有"库数据"（原图、SQLite 权威目录、缩略图、备份、库元数据）
 * 都从同一个「库根」推导，复制库根文件夹 = 复制整个素材库。
 *
 * 注意：本地设置文件（local-settings.json）属于应用配置，仍在 userData 下；
 * 这里的 readLocalSettings 只用于读取库根配置，与 ipc-handlers 的实现保持一致
 * （后续可统一收敛到一个设置模块，避免两份解析逻辑漂移）。
 */

/** 本地设置文件名（与 electron/ipc-handlers.ts 的 LOCAL_SETTINGS_FILE 保持一致）。 */
const LOCAL_SETTINGS_FILE = 'local-settings.json'

/** 库元数据文件名（库根内，随库移动）。 */
export const LIBRARY_META_FILE = 'library.json'

/** 当前库布局版本：L1 引入 db/、thumbs/、backups/ 骨架。 */
export const LIBRARY_LAYOUT_VERSION = 1

export interface LibraryMeta {
  version: number
  /** 库布局初始化/迁移完成时间戳（ms）；缺失表示尚未初始化。 */
  migratedAt?: number
  /** SQLite 权威目录迁入库根的时间戳（ms）；缺失表示尚未迁移（仍可能在旧 userData 位置）。 */
  catalogMigratedAt?: number
}

export interface LibraryPaths {
  /** 库根目录（= localSavePath 设置值，缺省 userData/local-saves）。 */
  root: string
  /** SQLite 权威目录（库根/db）。 */
  db: string
  /** 内容寻址原图目录（历史名 cache-images，保留不变）。 */
  cacheImages: string
  /** 磁盘缩略图缓存（可重建、随库移动）。 */
  thumbs: string
  /** 备份目录。 */
  backups: string
  /** 库元数据文件（库根/library.json）。 */
  metaFile: string
}

function readLocalSettings(): Record<string, unknown> {
  try {
    const content = readFileSync(path.join(app.getPath('userData'), LOCAL_SETTINGS_FILE), 'utf-8')
    return JSON.parse(content) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** 内置默认库根（未配置 localSavePath 时的回退位置；与 fs:get-default-path 一致）。 */
export function getDefaultLibraryRoot(): string {
  return path.join(app.getPath('userData'), 'local-saves')
}

/** 解析库根：localSavePath 设置优先；缺省 getDefaultLibraryRoot()。 */
export function getLibraryRoot(): string {
  const settings = readLocalSettings()
  const saved = settings.localSavePath
  return typeof saved === 'string' && saved.trim() ? path.resolve(saved) : getDefaultLibraryRoot()
}

export function getLibraryPaths(): LibraryPaths {
  const root = getLibraryRoot()
  return {
    root,
    db: path.join(root, 'db'),
    cacheImages: path.join(root, 'cache-images'),
    thumbs: path.join(root, 'thumbs'),
    backups: path.join(root, 'backups'),
    metaFile: path.join(root, LIBRARY_META_FILE),
  }
}

/**
 * 解析给定库根下的 SQLite 权威目录路径。
 * 优先级：库根 db/ 已存在 → 用之；否则回退旧位置 userData/asset-kernel.sqlite
 * （覆盖"完整性校验失败、旧库仍在使用"的场景，避免空库遮蔽旧数据）；否则返回库根 db/。
 */
export function resolveCatalogDbPathFor(root: string): string {
  const candidate = path.join(root, 'db', 'asset-kernel.sqlite')
  const legacy = path.join(app.getPath('userData'), 'asset-kernel.sqlite')
  if (existsSync(candidate)) return candidate
  if (existsSync(legacy)) return legacy
  return candidate
}

/** 解析当前库根下的 SQLite 权威目录路径（等价于 resolveCatalogDbPathFor(getLibraryRoot())）。 */
export function resolveCatalogDbPath(): string {
  return resolveCatalogDbPathFor(getLibraryRoot())
}

/** 读取库元数据；文件缺失或损坏时返回未初始化态（version 0）。 */
export function readLibraryMeta(): LibraryMeta {
  try {
    const content = readFileSync(getLibraryPaths().metaFile, 'utf-8')
    const parsed = JSON.parse(content) as Partial<LibraryMeta>
    return {
      version: typeof parsed.version === 'number' ? parsed.version : 0,
      migratedAt: parsed.migratedAt,
      catalogMigratedAt: parsed.catalogMigratedAt,
    }
  } catch {
    return { version: 0 }
  }
}

/** 写入库元数据：与现有内容合并（避免覆盖其他字段）。 */
export function writeLibraryMeta(meta: LibraryMeta): void {
  const { metaFile } = getLibraryPaths()
  mkdirSync(path.dirname(metaFile), { recursive: true })
  const merged = { ...readLibraryMeta(), ...meta }
  writeFileSync(metaFile, JSON.stringify(merged, null, 2), 'utf-8')
}

/** 幂等创建库布局目录（db/thumbs/backups），并在版本落后时写入库元数据。 */
export function ensureLibraryLayout(): LibraryMeta {
  const paths = getLibraryPaths()
  for (const dir of [paths.db, paths.thumbs, paths.backups]) mkdirSync(dir, { recursive: true })
  const existing = readLibraryMeta()
  if (existing.version < LIBRARY_LAYOUT_VERSION) {
    const meta: LibraryMeta = { version: LIBRARY_LAYOUT_VERSION, migratedAt: Date.now() }
    writeLibraryMeta(meta)
    return meta
  }
  return existing
}
