import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'fs'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { getLibraryPaths, readLibraryMeta, writeLibraryMeta, type LibraryPaths } from './library-paths'

/**
 * SQLite 权威目录迁移（对应 docs/superpowers/specs/2026-08-20-self-contained-library-design.md §4.2）。
 *
 * - migrateCatalogIntoLibrary：启动迁移（单实例锁内、DB 未打开时调用）。三分支：
 *   已就位 / 旧位置完整性通过后移动 / 全新初始化；完整性失败则保留旧文件并继续用旧路径。
 * - moveLibraryData：修改库根时把 db/、thumbs/、backups/ 从旧根搬到新根（含跨卷复制回退）。
 */

export type CatalogMigrationStatus = 'already-at-library' | 'migrated' | 'fresh' | 'integrity-failed'

export interface CatalogMigrationResult {
  status: CatalogMigrationStatus
  /** 迁移后应使用的 SQLite 权威目录路径（integrity-failed 时为旧位置）。 */
  dbPath: string
}

const LEGACY_CATALOG_FILE = 'asset-kernel.sqlite'

/** 移动单个文件：优先 rename（同卷瞬时）；EXDEV 等跨卷错误回退为复制+校验+删除。 */
function moveFileOrCopy(from: string, to: string): void {
  try {
    renameSync(from, to)
  } catch {
    copyFileSync(from, to)
    if (statSync(from).size !== statSync(to).size) {
      throw new Error(`Library file verification failed: ${from}`)
    }
    rmSync(from, { force: true })
  }
}

/** 迁移前完整性检查：正常打开（让 WAL 回放）后执行 PRAGMA integrity_check。 */
function isCatalogIntegrityOk(filePath: string): boolean {
  try {
    const db = new DatabaseSync(filePath)
    try {
      const row = db.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined
      return row?.integrity_check === 'ok'
    } finally {
      db.close()
    }
  } catch {
    return false
  }
}

/**
 * 启动迁移：确保 SQLite 权威目录位于库根 db/。
 * 必须在内核打开目录之前、单实例锁内调用（此时 DB 未被本进程占用）。
 */
export function migrateCatalogIntoLibrary(): CatalogMigrationResult {
  const { db } = getLibraryPaths()
  const candidate = path.join(db, LEGACY_CATALOG_FILE)
  const legacy = path.join(app.getPath('userData'), LEGACY_CATALOG_FILE)

  if (existsSync(candidate)) return { status: 'already-at-library', dbPath: candidate }
  if (!existsSync(legacy)) return { status: 'fresh', dbPath: candidate }

  if (!isCatalogIntegrityOk(legacy)) {
    // 完整性失败：保留旧文件、继续用旧路径（库根设置不变），不进入半迁移状态
    return { status: 'integrity-failed', dbPath: legacy }
  }

  mkdirSync(db, { recursive: true })
  for (const suffix of ['', '-wal', '-shm']) {
    const from = legacy + suffix
    if (existsSync(from)) moveFileOrCopy(from, candidate + suffix)
  }
  const current = readLibraryMeta()
  writeLibraryMeta({ ...current, catalogMigratedAt: Date.now() })
  return { status: 'migrated', dbPath: candidate }
}

function moveDirContents(sourceDir: string, targetDir: string): void {
  mkdirSync(targetDir, { recursive: true })
  for (const name of readdirSync(sourceDir)) {
    const from = path.join(sourceDir, name)
    const to = path.join(targetDir, name)
    if (!statSync(from).isFile()) continue
    if (existsSync(to)) continue // 目标已有同名文件：保留目标
    moveFileOrCopy(from, to)
  }
}

/**
 * 把库数据目录（db/thumbs/backups）从旧根搬到新根。
 * - db：目标 db 已含 asset-kernel.sqlite → 视为冲突并抛错（先于任何移动检查）；
 * - thumbs/backups：目标目录存在则按文件合并（保留目标同名文件），否则整目录移动。
 * 调用方负责内核关闭/重开与失败回滚（见 ipc-handlers.changeLibraryRoot）。
 */
export function moveLibraryData(oldRoot: string, newRoot: string): void {
  const oldPaths = path.join(oldRoot, 'db')
  const newPaths = path.join(newRoot, 'db')
  if (existsSync(path.join(newPaths, LEGACY_CATALOG_FILE))) {
    throw new Error('目标位置已存在素材库数据库（asset-kernel.sqlite）')
  }
  const pairs: Array<{ name: keyof LibraryPaths; source: string; target: string }> = [
    { name: 'db', source: oldPaths, target: newPaths },
    { name: 'thumbs', source: path.join(oldRoot, 'thumbs'), target: path.join(newRoot, 'thumbs') },
    { name: 'backups', source: path.join(oldRoot, 'backups'), target: path.join(newRoot, 'backups') },
  ]
  for (const pair of pairs) {
    if (!existsSync(pair.source)) continue
    if (existsSync(pair.target)) {
      moveDirContents(pair.source, pair.target)
    } else {
      try {
        renameSync(pair.source, pair.target)
      } catch {
        // 跨卷：复制整个目录（单层文件）后删除源目录
        moveDirContents(pair.source, pair.target)
        rmSync(pair.source, { recursive: true, force: true })
      }
    }
  }
}
