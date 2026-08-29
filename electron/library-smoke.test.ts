import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { GeneratedAsset } from '../src/types'
import { AssetCatalog } from './asset-catalog'

/**
 * 库根收敛端到端冒烟（文件级 E2E，跑真实模块）。
 * 覆盖「升级迁移 → 缩略图 → 改库根 → 完整性校验 → 备份默认位置」全链路。
 * 运行：npx vitest run electron/library-smoke.test.ts
 */

const userData = mkdtempSync(path.join(os.tmpdir(), 'library-smoke-'))

vi.mock('electron', () => ({
  app: {
    getPath: () => userData,
  },
  BrowserWindow: {
    fromWebContents: () => null,
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn(),
  },
  shell: {
    openPath: vi.fn(),
    showItemInFolder: vi.fn(),
  },
}))

const CACHE_CONTENT = 'smoke-image-bytes'
const CACHE_HASH = sha256(CACHE_CONTENT)
const CACHE_FILE = () => path.join(userData, 'local-saves', 'cache-images', `${CACHE_HASH}.png`)

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/** 构造最小的 VP8L webp 字节（宽高编码进位域）。 */
function makeVp8l(width: number, height: number): Buffer {
  const buf = Buffer.alloc(32)
  buf.write('RIFF', 0, 'latin1')
  buf.write('WEBP', 8, 'latin1')
  buf.write('VP8L', 12, 'latin1')
  buf[16] = 0x2f
  const w = width - 1
  const h = height - 1
  buf[17] = w & 0xff
  buf[18] = ((w >> 8) & 0x3f) | ((h & 0x3) << 6)
  buf[19] = (h >> 2) & 0xff
  buf[20] = (h >> 10) & 0x0f
  return buf
}

function makeAsset(id: string): GeneratedAsset {
  return {
    id,
    imageId: `hash-${id}`,
    blobId: `blob:hash-${id}`,
    currentVersionId: `version:${id}`,
    status: 'active',
    createdAt: 1000,
    updatedAt: 1000,
    trashedAt: null,
    favorite: false,
    rating: 0,
    collectionIds: [],
    tagIds: [],
    origins: [
      {
        kind: 'generated',
        key: `task:${id}`,
        taskId: `task-${id}`,
        outputSlot: 0,
        taskCreatedAt: 1000,
        taskFinishedAt: 1000,
        sourceMode: 'gallery',
        prompt: 'smoke',
        requestedParams: {} as never,
        inputImageIds: [],
        maskTargetImageId: null,
        maskImageId: null,
      },
    ],
    primaryOriginKey: `task:${id}`,
    parentAssetIds: [],
    metadataVersion: 2,
  }
}

/** 模拟旧版安装：userData/asset-kernel.sqlite + local-saves/cache-images 原图，设置文件不存在（等价旧版未配置库根）。 */
function buildLegacyInstall() {
  rmSync(userData, { recursive: true, force: true })
  mkdirSync(userData, { recursive: true })
  mkdirSync(path.dirname(CACHE_FILE()), { recursive: true })
  writeFileSync(CACHE_FILE(), CACHE_CONTENT)
  const catalog = new AssetCatalog(path.join(userData, 'asset-kernel.sqlite'))
  catalog.upsertAssets([{ asset: makeAsset('asset-smoke'), localPath: CACHE_FILE() }])
  catalog.close()
}

/** 升级引导：initLocalSavePath（建骨架）→ migrateCatalogIntoLibrary（迁库）。 */
async function bootstrapUpgrade() {
  const { initLocalSavePath } = await import('./ipc-handlers')
  initLocalSavePath()
  const { migrateCatalogIntoLibrary } = await import('./catalog-migration')
  return migrateCatalogIntoLibrary()
}

describe('library smoke (file-level E2E over real modules)', () => {
  beforeEach(buildLegacyInstall)
  afterAll(() => rmSync(userData, { recursive: true, force: true }))

  it('upgrade migrates the legacy catalog into the library root with data intact', async () => {
    const result = await bootstrapUpgrade()
    const { getLibraryPaths, resolveCatalogDbPath, readLibraryMeta } = await import('./library-paths')

    expect(result.status).toBe('migrated')
    expect(result.dbPath).toBe(path.join(getLibraryPaths().db, 'asset-kernel.sqlite'))
    expect(existsSync(result.dbPath)).toBe(true)
    expect(existsSync(path.join(userData, 'asset-kernel.sqlite'))).toBe(false) // 旧位置已搬走
    expect(resolveCatalogDbPath()).toBe(result.dbPath)
    expect(typeof readLibraryMeta().catalogMigratedAt).toBe('number')

    // 迁移后目录数据完好可读
    const catalog = new AssetCatalog(result.dbPath)
    const details = catalog.getAsset('asset-smoke')
    catalog.close()
    expect(details?.asset.id).toBe('asset-smoke')
    expect(details?.blob.localPath).toBe(CACHE_FILE())
  })

  it('thumbnail disk cache round-trips inside the library root', async () => {
    await bootstrapUpgrade()
    const { writeThumbnailFile, readThumbnailFile } = await import('./ipc-handlers')
    const { getLibraryPaths } = await import('./library-paths')

    const dataUrl = `data:image/webp;base64,${makeVp8l(100, 73).toString('base64')}`
    expect(await writeThumbnailFile('smoke-thumb', 3, dataUrl)).toBe(true)
    expect(existsSync(path.join(getLibraryPaths().thumbs, 'smoke-thumb.v3.webp'))).toBe(true)

    const read = await readThumbnailFile('smoke-thumb', 3)
    expect(read?.dataUrl).toBe(dataUrl)
    expect(read?.width).toBe(100)
    expect(read?.height).toBe(73)
    expect(await readThumbnailFile('smoke-thumb', 4)).toBeNull() // 版本不匹配视为未命中
  })

  it('changing the library root moves db/thumbs/backups and keeps the catalog readable', async () => {
    await bootstrapUpgrade()
    const { changeLibraryRoot, setLibraryKernelHooks, writeThumbnailFile } = await import('./ipc-handlers')
    const { getLibraryPaths } = await import('./library-paths')
    const oldDb = path.join(getLibraryPaths().db, 'asset-kernel.sqlite')
    await writeThumbnailFile('smoke-thumb', 3, `data:image/webp;base64,${makeVp8l(10, 10).toString('base64')}`)

    const newRoot = path.join(userData, 'moved-library')
    const close = vi.fn(async () => {})
    const open = vi.fn(async () => {})
    setLibraryKernelHooks({ close, open })
    try {
      await changeLibraryRoot(newRoot)
    } finally {
      setLibraryKernelHooks(null)
    }

    expect(close).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(newRoot)
    const newDb = path.join(newRoot, 'db', 'asset-kernel.sqlite')
    expect(existsSync(newDb)).toBe(true)
    expect(existsSync(oldDb)).toBe(false) // 旧库根 db 已搬走
    expect(existsSync(path.join(newRoot, 'thumbs', 'smoke-thumb.v3.webp'))).toBe(true)

    const { resolveCatalogDbPathFor } = await import('./library-paths')
    expect(resolveCatalogDbPathFor(newRoot)).toBe(newDb)
    const catalog = new AssetCatalog(newDb)
    const details = catalog.getAsset('asset-smoke')
    catalog.close()
    expect(details?.asset.id).toBe('asset-smoke')
  })

  it('integrity check reports a clean migrated library without false positives', async () => {
    await bootstrapUpgrade()
    const { runLibraryIntegrityCheck } = await import('./library-integrity')

    const report = runLibraryIntegrityCheck([CACHE_FILE()])
    expect(report.catalog).toBe('ok')
    expect(report.assetCount).toBe(1)
    expect(report.mismatched).toEqual([])
    expect(report.orphanFiles).toEqual([])
    expect(report.missingFiles).toEqual([])
  })

  it('ZIP backup export defaults to the library backups directory', async () => {
    await bootstrapUpgrade()
    const { getBackupExportDefaultPath } = await import('./ipc-handlers')
    const { getLibraryPaths } = await import('./library-paths')
    expect(getBackupExportDefaultPath('doupao_backup.zip')).toBe(
      path.join(getLibraryPaths().backups, 'doupao_backup.zip'),
    )
  })
})
