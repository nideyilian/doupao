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

/** 已被搬离原位的条目，用于失败时精确回滚。 */
interface MovedEntry {
  source: string
  target: string
  /** true 表示整目录 rename（同卷瞬移）后记账，回滚时整目录搬回。 */
  directory?: boolean
}

/** 递归收集目录下的所有文件（库数据目录当前是扁平的，这里兼容将来出现的子目录，避免静默漏搬）。 */
function collectFilesRecursively(dir: string): string[] {
  const files: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) files.push(...collectFilesRecursively(full))
    else files.push(full)
  }
  return files
}

/**
 * 目录内容搬迁：逐文件复制/移动，**边搬边把条目记进 `moved`**（失败时按清单精确回滚）。
 * 目标已存在的同名文件保留目标、不计入清单（沿用原有的合并语义）。
 *
 * 注意收集器必须由调用方传入、而不是靠返回值：中途失败时返回值根本拿不到，
 * 而「已经搬走的那几个文件」恰恰是回滚唯一需要的信息。
 */
function moveDirContents(sourceDir: string, targetDir: string, moved: MovedEntry[]): void {
  mkdirSync(targetDir, { recursive: true })
  for (const from of collectFilesRecursively(sourceDir)) {
    const to = path.join(targetDir, path.relative(sourceDir, from))
    mkdirSync(path.dirname(to), { recursive: true })
    if (existsSync(to)) continue // 目标已有同名文件：保留目标
    try {
      moveFileOrCopy(from, to) // 内部已做 size 校验，且校验通过才删源
    } catch (error) {
      // 校验失败时目标可能留着半截文件；必须先清掉，否则新库根留下孤儿文件。
      // 源文件因校验未通过而未被删除，数据安全。
      rmSync(to, { force: true })
      throw error
    }
    moved.push({ source: from, target: to })
  }
}

/**
 * 按清单把已搬走的条目搬回原位。
 *
 * 尽力而为：单个条目失败不影响其余条目，也绝不抛出 —— 调用方要看到的是原始错误。
 * 这取代了「失败后反向再搬一次」的旧回滚：那种做法会把新库根原有的文件一并卷走。
 */
function rollbackMovedEntries(moved: MovedEntry[]): void {
  for (let index = moved.length - 1; index >= 0; index -= 1) {
    const entry = moved[index]
    if (!entry) continue
    const { source, target, directory } = entry
    try {
      if (!existsSync(target) || existsSync(source)) continue
      mkdirSync(path.dirname(source), { recursive: true })
      if (!directory) {
        try {
          renameSync(target, source)
          continue
        } catch {
          // 跨卷：复制回来后校验，通过才删目标
        }
      }
      copyFileSync(target, source)
      if (statSync(source).size !== statSync(target).size) {
        rmSync(target, { force: true })
        throw new Error(`Rollback verification failed: ${target}`)
      }
      rmSync(target, { recursive: Boolean(directory), force: true })
    } catch {
      // 回滚尽力而为：留痕即可，不打断其余条目
      console.error('[catalog-migration] 回滚条目失败：', target)
    }
  }
}

/**
 * 把库数据目录（db/thumbs/backups）从旧根搬到新根。
 * - db：目标 db 已含 asset-kernel.sqlite → 视为冲突并抛错（先于任何移动检查）；
 * - thumbs/backups：目标目录存在则按文件合并（保留目标同名文件），否则整目录移动；
 * - **任一步失败都会按清单精确回滚已搬走的条目**，不会停在「新库根一份残缺副本」的状态。
 * 调用方负责内核关闭/重开（见 ipc-handlers.changeLibraryRoot）。
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

  const moved: MovedEntry[] = []
  try {
    for (const pair of pairs) {
      if (!existsSync(pair.source)) continue
      if (existsSync(pair.target)) {
        moveDirContents(pair.source, pair.target, moved)
        continue
      }
      try {
        renameSync(pair.source, pair.target)
        // 同卷瞬移：整目录记账即可（回滚也是同卷 rename，必然成功）
        moved.push({ source: pair.source, target: pair.target, directory: true })
      } catch {
        // 跨卷：先逐文件复制并校验，全部成功后才删除源目录
        moveDirContents(pair.source, pair.target, moved)
        rmSync(pair.source, { recursive: true, force: true })
      }
    }
  } catch (error) {
    rollbackMovedEntries(moved)
    throw error
  }
}
