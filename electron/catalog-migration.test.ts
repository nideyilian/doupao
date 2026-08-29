import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

const mockUserData = mkdtempSync(path.join(os.tmpdir(), 'catalog-migration-'))

vi.mock('electron', () => ({
  app: {
    getPath: () => mockUserData,
  },
}))

function writeSettings(settings: Record<string, unknown>) {
  writeFileSync(path.join(mockUserData, 'local-settings.json'), JSON.stringify(settings), 'utf-8')
}

function createValidSqlite(filePath: string) {
  const db = new DatabaseSync(filePath)
  db.exec('CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1);')
  db.close()
}

const defaultLibDb = () => path.join(mockUserData, 'local-saves', 'db', 'asset-kernel.sqlite')

describe('catalog migration', () => {
  beforeEach(() => {
    rmSync(mockUserData, { recursive: true, force: true })
    mkdirSync(mockUserData, { recursive: true })
  })

  afterAll(() => {
    rmSync(mockUserData, { recursive: true, force: true })
  })

  it('returns fresh when neither location has a catalog', async () => {
    const { migrateCatalogIntoLibrary } = await import('./catalog-migration')
    const result = migrateCatalogIntoLibrary()
    expect(result.status).toBe('fresh')
    expect(result.dbPath).toBe(defaultLibDb())
  })

  it('keeps using the library db when already present', async () => {
    mkdirSync(path.dirname(defaultLibDb()), { recursive: true })
    createValidSqlite(defaultLibDb())
    const { migrateCatalogIntoLibrary } = await import('./catalog-migration')
    const result = migrateCatalogIntoLibrary()
    expect(result.status).toBe('already-at-library')
    expect(result.dbPath).toBe(defaultLibDb())
    expect(existsSync(defaultLibDb())).toBe(true)
  })

  it('moves a valid legacy catalog into the library and writes the marker', async () => {
    const legacy = path.join(mockUserData, 'asset-kernel.sqlite')
    createValidSqlite(legacy)
    const { migrateCatalogIntoLibrary } = await import('./catalog-migration')
    const result = migrateCatalogIntoLibrary()

    expect(result.status).toBe('migrated')
    expect(result.dbPath).toBe(defaultLibDb())
    expect(existsSync(defaultLibDb())).toBe(true)
    expect(existsSync(legacy)).toBe(false)

    const meta = JSON.parse(readFileSync(path.join(mockUserData, 'local-saves', 'library.json'), 'utf-8')) as {
      catalogMigratedAt?: number
    }
    expect(typeof meta.catalogMigratedAt).toBe('number')

    // 数据完整可读
    const db = new DatabaseSync(defaultLibDb())
    const row = db.prepare('SELECT count(*) AS c FROM t').get() as { c: number }
    db.close()
    expect(row.c).toBe(1)
  })

  it('retains the legacy catalog and keeps using it when integrity fails', async () => {
    const legacy = path.join(mockUserData, 'asset-kernel.sqlite')
    writeFileSync(legacy, 'this is not a sqlite database')
    const { migrateCatalogIntoLibrary } = await import('./catalog-migration')
    const result = migrateCatalogIntoLibrary()

    expect(result.status).toBe('integrity-failed')
    expect(result.dbPath).toBe(legacy)
    expect(existsSync(legacy)).toBe(true)
    expect(existsSync(defaultLibDb())).toBe(false)
  })

  it('moves db/thumbs/backups (including wal/shm) to the new root', async () => {
    const oldRoot = path.join(mockUserData, 'old-root')
    const newRoot = path.join(mockUserData, 'new-root')
    mkdirSync(path.join(oldRoot, 'db'), { recursive: true })
    mkdirSync(path.join(oldRoot, 'thumbs'), { recursive: true })
    mkdirSync(path.join(oldRoot, 'backups'), { recursive: true })
    createValidSqlite(path.join(oldRoot, 'db', 'asset-kernel.sqlite'))
    writeFileSync(path.join(oldRoot, 'db', 'asset-kernel.sqlite-wal'), 'wal')
    writeFileSync(path.join(oldRoot, 'db', 'asset-kernel.sqlite-shm'), 'shm')
    writeFileSync(path.join(oldRoot, 'thumbs', 'a.webp'), 'thumb')
    writeFileSync(path.join(oldRoot, 'backups', 'b.zip'), 'backup')

    const { moveLibraryData } = await import('./catalog-migration')
    moveLibraryData(oldRoot, newRoot)

    expect(existsSync(path.join(newRoot, 'db', 'asset-kernel.sqlite'))).toBe(true)
    expect(existsSync(path.join(newRoot, 'db', 'asset-kernel.sqlite-wal'))).toBe(true)
    expect(existsSync(path.join(newRoot, 'db', 'asset-kernel.sqlite-shm'))).toBe(true)
    expect(existsSync(path.join(newRoot, 'thumbs', 'a.webp'))).toBe(true)
    expect(existsSync(path.join(newRoot, 'backups', 'b.zip'))).toBe(true)
    // 旧目录整体搬走
    expect(existsSync(path.join(oldRoot, 'db'))).toBe(false)
    expect(existsSync(path.join(oldRoot, 'thumbs'))).toBe(false)
    expect(existsSync(path.join(oldRoot, 'backups'))).toBe(false)
  })

  it('refuses when the target db already has a catalog and moves nothing', async () => {
    const oldRoot = path.join(mockUserData, 'old-root')
    const newRoot = path.join(mockUserData, 'new-root')
    mkdirSync(path.join(oldRoot, 'db'), { recursive: true })
    mkdirSync(path.join(newRoot, 'db'), { recursive: true })
    createValidSqlite(path.join(oldRoot, 'db', 'asset-kernel.sqlite'))
    createValidSqlite(path.join(newRoot, 'db', 'asset-kernel.sqlite'))
    mkdirSync(path.join(oldRoot, 'thumbs'), { recursive: true })
    writeFileSync(path.join(oldRoot, 'thumbs', 'a.webp'), 'thumb')

    const { moveLibraryData } = await import('./catalog-migration')
    expect(() => moveLibraryData(oldRoot, newRoot)).toThrow('已存在素材库数据库')
    expect(existsSync(path.join(oldRoot, 'db', 'asset-kernel.sqlite'))).toBe(true)
    expect(existsSync(path.join(oldRoot, 'thumbs', 'a.webp'))).toBe(true)
  })

  it('merges into an existing empty target db dir', async () => {
    const oldRoot = path.join(mockUserData, 'old-root')
    const newRoot = path.join(mockUserData, 'new-root')
    mkdirSync(path.join(oldRoot, 'db'), { recursive: true })
    mkdirSync(path.join(newRoot, 'db'), { recursive: true })
    createValidSqlite(path.join(oldRoot, 'db', 'asset-kernel.sqlite'))

    const { moveLibraryData } = await import('./catalog-migration')
    moveLibraryData(oldRoot, newRoot)
    expect(existsSync(path.join(newRoot, 'db', 'asset-kernel.sqlite'))).toBe(true)
    expect(existsSync(path.join(oldRoot, 'db', 'asset-kernel.sqlite'))).toBe(false)
  })
})
