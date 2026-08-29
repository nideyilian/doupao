import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'fs'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { getLibraryPaths, resolveCatalogDbPath } from './library-paths'

/**
 * 库完整性校验（对应 docs/superpowers/specs/2026-08-20-self-contained-library-design.md §4.5）。
 * 只读检查，绝不产生任何写操作：
 * 1. SQLite PRAGMA integrity_check（只读连接，WAL 下与内核共存安全）；
 * 2. cache-images 原图抽查：重算 SHA-256 与文件名（内容哈希）比对；
 * 3. 孤儿文件：cache-images 中不在引用集合（渲染端 IndexedDB 路径 + 目录 blobs）里的文件；
 * 4. 缺失文件：引用集合中磁盘上不存在的路径。
 */

export interface LibraryIntegrityDiskReport {
  /** SQLite 权威目录状态 */
  catalog: 'ok' | 'corrupt' | 'unavailable'
  /** 损坏/不可用详情（ok 时为 undefined） */
  catalogDetail?: string
  /** 目录中的素材记录数 */
  assetCount: number
  /** 原图抽查数量 */
  sampled: number
  /** 抽查中内容哈希与文件名不一致的原图 */
  mismatched: Array<{ fileName: string; expected: string; actual: string }>
  /** 未被任何引用集合覆盖的 cache-images 文件（基线名称） */
  orphanFiles: string[]
  /** 引用集合中磁盘上不存在的路径 */
  missingFiles: string[]
  checkedAt: number
}

/** 原图抽查上限（确定性取文件名排序前 N 个，避免大库全量哈希）。 */
const INTEGRITY_SAMPLE_LIMIT = 100

const IMAGE_EXT_RE = /\.(png|jpe?g|webp)$/i

function hashFileSha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

export function runLibraryIntegrityCheck(referencedPaths: string[]): LibraryIntegrityDiskReport {
  const checkedAt = Date.now()
  const dbPath = resolveCatalogDbPath()

  // ---- 1) SQLite 目录 ----
  let catalog: 'ok' | 'corrupt' | 'unavailable' = 'unavailable'
  let catalogDetail: string | undefined
  let assetCount = 0
  const referenced = new Set<string>(referencedPaths.filter((p) => typeof p === 'string'))
  if (existsSync(dbPath)) {
    try {
      const db = new DatabaseSync(dbPath, { readOnly: true })
      try {
        const rows = db.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>
        const ok = rows.length === 1 && rows[0]?.integrity_check === 'ok'
        catalog = ok ? 'ok' : 'corrupt'
        if (!ok) {
          catalogDetail = rows
            .map((row) => String(row.integrity_check))
            .slice(0, 5)
            .join('; ')
        }
        const countRow = db.prepare('SELECT COUNT(*) AS c FROM assets').get() as { c?: number } | undefined
        assetCount = Number(countRow?.c ?? 0)
        const blobRows = db.prepare('SELECT file_path FROM blobs WHERE file_path IS NOT NULL').all() as Array<{
          file_path?: unknown
        }>
        for (const row of blobRows) {
          if (typeof row.file_path === 'string' && row.file_path) referenced.add(row.file_path)
        }
      } finally {
        db.close()
      }
    } catch (err) {
      catalog = 'unavailable'
      catalogDetail = err instanceof Error ? err.message : String(err)
    }
  }

  // ---- 2) cache-images 抽查 + 孤儿/缺失 ----
  const mismatched: Array<{ fileName: string; expected: string; actual: string }> = []
  const orphanFiles: string[] = []
  const missingFiles: string[] = []
  const cacheDir = getLibraryPaths().cacheImages
  const referencedNames = new Set<string>()
  for (const filePath of referenced) referencedNames.add(path.basename(filePath).toLowerCase())

  let sampled = 0
  if (existsSync(cacheDir)) {
    const files = readdirSync(cacheDir)
      .filter((name) => IMAGE_EXT_RE.test(name))
      .sort()
    sampled = Math.min(INTEGRITY_SAMPLE_LIMIT, files.length)
    for (const fileName of files.slice(0, sampled)) {
      try {
        const expected = fileName.replace(/\.[^.]+$/, '')
        const actual = hashFileSha256(path.join(cacheDir, fileName))
        if (actual !== expected) mismatched.push({ fileName, expected, actual })
      } catch {
        // 读失败（并发删除等）跳过，不计入误报
      }
    }
    for (const fileName of files) {
      if (!referencedNames.has(fileName.toLowerCase())) orphanFiles.push(fileName)
    }
  }
  for (const filePath of referenced) {
    if (!existsSync(filePath)) missingFiles.push(filePath)
  }

  return {
    catalog,
    catalogDetail,
    assetCount,
    sampled,
    mismatched,
    orphanFiles,
    missingFiles,
    checkedAt,
  }
}
