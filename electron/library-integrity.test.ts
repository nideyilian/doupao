import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

const mockUserData = mkdtempSync(path.join(os.tmpdir(), 'library-integrity-'))

vi.mock('electron', () => ({
  app: {
    getPath: () => mockUserData,
  },
}))

const libRoot = () => path.join(mockUserData, 'local-saves')
const cacheDir = () => path.join(libRoot(), 'cache-images')
const dbPath = () => path.join(libRoot(), 'db', 'asset-kernel.sqlite')

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function writeSettings() {
  writeFileSync(path.join(mockUserData, 'local-settings.json'), JSON.stringify({ localSavePath: libRoot() }), 'utf-8')
}

function createCatalog(referencedPaths: string[]) {
  mkdirSync(path.dirname(dbPath()), { recursive: true })
  const db = new DatabaseSync(dbPath())
  db.exec(`
    CREATE TABLE assets (id TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE blobs (
      id TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL UNIQUE,
      mime_type TEXT,
      byte_size INTEGER,
      file_path TEXT,
      created_at INTEGER NOT NULL
    );
    INSERT INTO assets VALUES ('a1', '{}');
  `)
  const insert = db.prepare('INSERT INTO blobs VALUES (?, ?, ?, ?, ?, ?)')
  referencedPaths.forEach((filePath, index) => insert.run(`b${index}`, `h${index}`, 'image/png', 1, filePath, 1))
  db.close()
}

describe('library integrity check', () => {
  beforeEach(() => {
    rmSync(mockUserData, { recursive: true, force: true })
    mkdirSync(mockUserData, { recursive: true })
    writeSettings()
  })

  afterAll(() => {
    rmSync(mockUserData, { recursive: true, force: true })
  })

  it('reports ok catalog, mismatched, orphan and missing files without false positives', async () => {
    // 引用集合（模拟渲染端 IndexedDB 路径 + 目录 blobs）
    const goodContent = 'GOOD-IMAGE'
    const goodName = `${sha256(goodContent)}.png`
    mkdirSync(cacheDir(), { recursive: true })
    writeFileSync(path.join(cacheDir(), goodName), goodContent)

    // 内容与文件名哈希不一致 → 应报 mismatch
    const badName = `${sha256('EXPECTED-NAME')}.png`
    writeFileSync(path.join(cacheDir(), badName), 'ACTUAL-CONTENT')

    // 未被引用 → 应报 orphan
    writeFileSync(path.join(cacheDir(), 'orphan-only.png'), 'ORPHAN')

    // 被 blobs 引用但磁盘缺失 → 应报 missing
    const missingPath = path.join(cacheDir(), `${sha256('MISSING')}.png`)
    createCatalog([missingPath])

    const referencedFromRenderer = [path.join(cacheDir(), goodName)]
    const { runLibraryIntegrityCheck } = await import('./library-integrity')
    const report = runLibraryIntegrityCheck(referencedFromRenderer)

    expect(report.catalog).toBe('ok')
    expect(report.assetCount).toBe(1)
    expect(report.sampled).toBe(3)
    // 文件名与内容哈希不符的文件都会被报告（含孤儿文件本身）
    const mismatchedNames = report.mismatched.map((m) => m.fileName)
    expect(mismatchedNames).toContain(badName)
    expect(mismatchedNames).toContain('orphan-only.png')
    const badMismatch = report.mismatched.find((m) => m.fileName === badName)!
    expect(badMismatch).toEqual({
      fileName: badName,
      expected: sha256('EXPECTED-NAME'),
      actual: sha256('ACTUAL-CONTENT'),
    })
    expect(report.orphanFiles).toEqual([badName, 'orphan-only.png'])
    expect(report.missingFiles).toEqual([missingPath])
    // 正常文件不在任何异常清单里（不误报）
    expect(report.orphanFiles).not.toContain(goodName)
    expect(mismatchedNames).not.toContain(goodName)
  })

  it('reports corrupt catalog when the database fails to open', async () => {
    mkdirSync(path.dirname(dbPath()), { recursive: true })
    writeFileSync(dbPath(), 'this is definitely not a sqlite database')
    const { runLibraryIntegrityCheck } = await import('./library-integrity')
    const report = runLibraryIntegrityCheck([])
    expect(report.catalog).toBe('unavailable')
    expect(typeof report.catalogDetail).toBe('string')
  })

  it('reports unavailable when no catalog exists', async () => {
    const { runLibraryIntegrityCheck } = await import('./library-integrity')
    const report = runLibraryIntegrityCheck([])
    expect(report.catalog).toBe('unavailable')
    expect(report.assetCount).toBe(0)
  })

  it('never writes during the check (read-only)', async () => {
    const content = 'GOOD-IMAGE'
    const name = `${sha256(content)}.png`
    mkdirSync(cacheDir(), { recursive: true })
    writeFileSync(path.join(cacheDir(), name), content)
    createCatalog([path.join(cacheDir(), name)])

    const { runLibraryIntegrityCheck } = await import('./library-integrity')
    runLibraryIntegrityCheck([path.join(cacheDir(), name)])

    // 校验前后文件内容一致，且没有产生新文件
    const filesAfter = new Set(readdirSync(cacheDir()))
    expect(filesAfter).toEqual(new Set([name]))
    expect(readFileSync(path.join(cacheDir(), name), 'utf-8')).toBe(content)
    expect(existsSync(dbPath())).toBe(true)
  })
})
