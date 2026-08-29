import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mockUserData = mkdtempSync(path.join(os.tmpdir(), 'library-paths-'))

vi.mock('electron', () => ({
  app: {
    getPath: () => mockUserData,
  },
}))

const LOCAL_SETTINGS_FILE = 'local-settings.json'
const settingsPath = () => path.join(mockUserData, LOCAL_SETTINGS_FILE)

function writeSettings(settings: Record<string, unknown>) {
  writeFileSync(settingsPath(), JSON.stringify(settings), 'utf-8')
}

describe('library paths', () => {
  beforeEach(() => {
    rmSync(mockUserData, { recursive: true, force: true })
    mkdirSync(mockUserData, { recursive: true })
  })

  afterAll(() => {
    rmSync(mockUserData, { recursive: true, force: true })
  })

  it('falls back to userData/local-saves when no setting exists', async () => {
    const { getLibraryPaths } = await import('./library-paths')
    const paths = getLibraryPaths()
    expect(paths.root).toBe(path.join(mockUserData, 'local-saves'))
    expect(paths.db).toBe(path.join(mockUserData, 'local-saves', 'db'))
    expect(paths.cacheImages).toBe(path.join(mockUserData, 'local-saves', 'cache-images'))
    expect(paths.thumbs).toBe(path.join(mockUserData, 'local-saves', 'thumbs'))
    expect(paths.backups).toBe(path.join(mockUserData, 'local-saves', 'backups'))
    expect(paths.metaFile).toBe(path.join(mockUserData, 'local-saves', 'library.json'))
  })

  it('uses the localSavePath setting as the library root', async () => {
    const customRoot = path.join(mockUserData, 'custom-root')
    writeSettings({ localSavePath: customRoot })
    const { getLibraryPaths } = await import('./library-paths')
    const paths = getLibraryPaths()
    expect(paths.root).toBe(path.resolve(customRoot))
    expect(paths.db).toBe(path.join(path.resolve(customRoot), 'db'))
  })

  it('ignores a blank localSavePath setting and falls back to the default', async () => {
    writeSettings({ localSavePath: '   ' })
    const { getLibraryPaths } = await import('./library-paths')
    expect(getLibraryPaths().root).toBe(path.join(mockUserData, 'local-saves'))
  })

  it('ensureLibraryLayout creates the skeleton and writes library.json idempotently', async () => {
    const { getLibraryPaths, ensureLibraryLayout, readLibraryMeta, LIBRARY_LAYOUT_VERSION } =
      await import('./library-paths')
    const first = ensureLibraryLayout()
    expect(first.version).toBe(LIBRARY_LAYOUT_VERSION)
    expect(typeof first.migratedAt).toBe('number')

    const paths = getLibraryPaths()
    for (const dir of [paths.db, paths.thumbs, paths.backups]) expect(existsSync(dir)).toBe(true)

    const meta = readLibraryMeta()
    expect(meta.version).toBe(LIBRARY_LAYOUT_VERSION)

    // 幂等：再次调用不改变 migratedAt
    const second = ensureLibraryLayout()
    expect(second).toEqual(first)
    const raw = JSON.parse(readFileSync(paths.metaFile, 'utf-8')) as { migratedAt: number }
    expect(raw.migratedAt).toBe(first.migratedAt)
  })

  it('readLibraryMeta tolerates missing and corrupt files', async () => {
    const { readLibraryMeta, getLibraryPaths } = await import('./library-paths')
    expect(readLibraryMeta()).toEqual({ version: 0 })
    mkdirSync(getLibraryPaths().root, { recursive: true })
    writeFileSync(getLibraryPaths().metaFile, 'not-json{', 'utf-8')
    expect(readLibraryMeta()).toEqual({ version: 0 })
  })

  it('writeLibraryMeta round-trips through readLibraryMeta', async () => {
    const { readLibraryMeta, writeLibraryMeta } = await import('./library-paths')
    writeLibraryMeta({ version: 7, migratedAt: 123 })
    expect(readLibraryMeta()).toEqual({ version: 7, migratedAt: 123 })
  })

  it('writeLibraryMeta merges with existing content instead of overwriting', async () => {
    const { ensureLibraryLayout, readLibraryMeta, writeLibraryMeta } = await import('./library-paths')
    ensureLibraryLayout()
    const before = readLibraryMeta()
    writeLibraryMeta({ ...before, catalogMigratedAt: 999 })
    const after = readLibraryMeta()
    expect(after.catalogMigratedAt).toBe(999)
    expect(after.migratedAt).toBe(before.migratedAt)
    expect(after.version).toBe(before.version)
  })

  it('resolveCatalogDbPath prefers the library db, falls back to the legacy userData file', async () => {
    const { getLibraryPaths, resolveCatalogDbPath } = await import('./library-paths')
    const expectedNew = path.join(getLibraryPaths().db, 'asset-kernel.sqlite')

    // 两个位置都不存在 → 新位置（待 L2 迁移创建）
    expect(resolveCatalogDbPath()).toBe(expectedNew)

    // 旧位置存在 → 回退旧位置（L1 兼容期不丢数据）
    const legacy = path.join(mockUserData, 'asset-kernel.sqlite')
    writeFileSync(legacy, 'legacy')
    expect(resolveCatalogDbPath()).toBe(legacy)

    // 新位置也存在 → 优先新位置
    mkdirSync(getLibraryPaths().db, { recursive: true })
    const fresh = path.join(getLibraryPaths().db, 'asset-kernel.sqlite')
    writeFileSync(fresh, 'fresh')
    expect(resolveCatalogDbPath()).toBe(fresh)
  })
})
