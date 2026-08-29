import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetCollection, GeneratedAsset } from '../../types'
import { normalizeAsset, normalizeCollection } from '../assetLibraryModel'
import type { MigrationJournal } from './registry'

const mock = vi.hoisted(() => ({
  getLocalSavePath: vi.fn(),
  joinPath: vi.fn(),
  readDirectoryEntries: vi.fn(),
  readFileBuffer: vi.fn(),
  hydrateFull: vi.fn(),
  putCollections: vi.fn(),
  putGeneratedAssets: vi.fn(),
  getAssetsByImageIds: vi.fn(),
  getImage: vi.fn(),
  storeImage: vi.fn(),
}))

vi.mock('../localSave', () => ({
  getLocalSavePath: mock.getLocalSavePath,
  joinPath: mock.joinPath,
  readDirectoryEntries: mock.readDirectoryEntries,
  readFileBuffer: mock.readFileBuffer,
}))
vi.mock('../assetLibraryRepository', () => ({
  getAssetsByImageIds: mock.getAssetsByImageIds,
  putCollections: mock.putCollections,
  putGeneratedAssets: mock.putGeneratedAssets,
  hydrateFull: mock.hydrateFull,
}))
vi.mock('../db', () => ({
  storeImage: mock.storeImage,
  getImage: mock.getImage,
}))

import {
  buildFolderCollections,
  buildImportedAsset,
  runLegacyImageFoldersToCollectionsMigration,
  LEGACY_IMAGE_FOLDERS_TO_COLLECTIONS_MIGRATION_ID,
} from './legacyImageFoldersToCollections'

function collection(id: string, name: string): AssetCollection {
  return normalizeCollection({ id, name, parentId: null, order: 0, createdAt: 1, updatedAt: 1 })!
}

const now = 1_000_000

describe('buildFolderCollections', () => {
  it('creates a top-level folder per legacy tab folder', () => {
    const created = buildFolderCollections({
      folderNames: ['标签 3', '短剧', '图标'],
      existingCollections: [],
      now,
    })
    expect(created.map((c) => c.name).sort()).toEqual(['图标', '标签 3', '短剧'])
    expect(created.every((c) => c.parentId === null)).toBe(true)
  })

  it('reuses an existing same-name folder instead of duplicating', () => {
    const existing = collection('col-1', '短剧')
    const created = buildFolderCollections({
      folderNames: ['短剧'],
      existingCollections: [existing],
      now,
    })
    expect(created).toHaveLength(0)
  })

  it('skips empty names and duplicate folder names', () => {
    const created = buildFolderCollections({
      folderNames: ['', '  ', '短剧', '短剧'],
      existingCollections: [],
      now,
    })
    expect(created.map((c) => c.name)).toEqual(['短剧'])
  })
})

describe('buildImportedAsset', () => {
  it('creates a sourceless asset bound to the folder collection', () => {
    const asset = buildImportedAsset('hash123', undefined, 'col-1', now)
    expect(asset).toMatchObject({
      id: 'hash123',
      imageId: 'hash123',
      status: 'active',
      collectionIds: ['col-1'],
      origins: [],
    })
    expect(asset.createdAt).toBe(now)
  })
})

describe('runLegacyImageFoldersToCollectionsMigration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock.getLocalSavePath.mockResolvedValue('D:\\LocalSaves')
    mock.joinPath.mockImplementation(async (...parts: string[]) => parts.join('\\'))
    mock.hydrateFull.mockResolvedValue({ assets: [], collections: [], tags: [], tombstones: [] })
    mock.getAssetsByImageIds.mockResolvedValue(new Map<string, GeneratedAsset>())
    mock.getImage.mockResolvedValue(undefined)
  })

  it('creates folders and imports images bound to them', async () => {
    mock.readDirectoryEntries.mockImplementation(async (dir: string) => {
      if (dir === 'D:\\LocalSaves\\images') {
        return [
          { name: '短剧', isDirectory: true },
          { name: 'readme.txt', isDirectory: false },
        ]
      }
      return [
        { name: '20260703-短剧-1.jpg', isDirectory: false },
        { name: 'notes.txt', isDirectory: false },
      ]
    })
    mock.readFileBuffer.mockResolvedValue({ data: new ArrayBuffer(8), name: '20260703-短剧-1.jpg' })
    mock.storeImage.mockResolvedValue('hash-of-image')

    const journal = new Map<string, MigrationJournal>()
    const store = {
      get: async (id: string) => journal.get(id),
      put: async (record: MigrationJournal) => {
        journal.set(record.id, record)
      },
    }

    await runLegacyImageFoldersToCollectionsMigration(store)

    // 建了「短剧」文件夹
    expect(mock.putCollections).toHaveBeenCalledTimes(1)
    const created = mock.putCollections.mock.calls[0][0] as AssetCollection[]
    expect(created.map((c) => c.name)).toEqual(['短剧'])
    // 导入了 1 张图并归入
    expect(mock.storeImage).toHaveBeenCalledTimes(1)
    expect(mock.putGeneratedAssets).toHaveBeenCalledTimes(1)
    const assets = mock.putGeneratedAssets.mock.calls[0][0] as GeneratedAsset[]
    expect(assets[0].imageId).toBe('hash-of-image')
    expect(assets[0].collectionIds[0]).toBe(created[0].id)
    expect(journal.get(LEGACY_IMAGE_FOLDERS_TO_COLLECTIONS_MIGRATION_ID)?.status).toBe('completed')
  })

  it('does nothing when there are no sub folders', async () => {
    mock.readDirectoryEntries.mockResolvedValue([])
    const store = { get: async () => undefined, put: async () => {} }
    await runLegacyImageFoldersToCollectionsMigration(store)
    expect(mock.putCollections).not.toHaveBeenCalled()
    expect(mock.putGeneratedAssets).not.toHaveBeenCalled()
  })

  it('merges into an existing asset without duplicating it', async () => {
    mock.readDirectoryEntries.mockImplementation(async (dir: string) =>
      dir === 'D:\\LocalSaves\\images'
        ? [{ name: '短剧', isDirectory: true }]
        : [{ name: 'a.png', isDirectory: false }],
    )
    mock.readFileBuffer.mockResolvedValue({ data: new ArrayBuffer(8), name: 'a.png' })
    mock.storeImage.mockResolvedValue('existing-hash')
    const existingAsset = normalizeAsset({
      id: 'existing-hash',
      imageId: 'existing-hash',
      status: 'active',
      collectionIds: ['other-col'],
      origins: [],
      createdAt: 1,
      updatedAt: 1,
    })
    mock.getAssetsByImageIds.mockResolvedValue(new Map([['existing-hash', existingAsset]]))
    mock.hydrateFull.mockResolvedValue({
      assets: [existingAsset],
      collections: [],
      tags: [],
      tombstones: [],
    })

    const store = { get: async () => undefined, put: async () => {} }
    await runLegacyImageFoldersToCollectionsMigration(store)

    const assets = mock.putGeneratedAssets.mock.calls[0][0] as GeneratedAsset[]
    expect(assets).toHaveLength(1)
    expect(assets[0].id).toBe('existing-hash')
    expect(assets[0].collectionIds).toEqual(['other-col', expect.any(String)])
  })

  it('resumes from the checkpoint cursor instead of re-importing earlier files', async () => {
    const folderFiles = ['f1.png', 'f2.png', 'f3.png', 'f4.png']
    mock.readDirectoryEntries.mockImplementation(async (dir: string) =>
      dir === 'D:\\LocalSaves\\images'
        ? [{ name: '短剧', isDirectory: true }]
        : folderFiles.map((name) => ({ name, isDirectory: false })),
    )
    mock.readFileBuffer.mockResolvedValue({ data: new ArrayBuffer(8), name: 'x.png' })
    mock.storeImage.mockImplementation(async () => `hash-${mock.readFileBuffer.mock.calls.length}`)

    const journal = new Map<string, MigrationJournal>()
    const store = {
      get: async (id: string) => journal.get(id),
      put: async (record: MigrationJournal) => {
        journal.set(record.id, record)
      },
    }

    // 第一次运行：预置游标 = 2（前两张已导入），只应导入第 3、4 张
    journal.set(LEGACY_IMAGE_FOLDERS_TO_COLLECTIONS_MIGRATION_ID, {
      id: LEGACY_IMAGE_FOLDERS_TO_COLLECTIONS_MIGRATION_ID,
      status: 'running',
      cursor: '2',
      updatedAt: 1,
    })

    await runLegacyImageFoldersToCollectionsMigration(store)

    // 只导入了游标之后的 2 张
    expect(mock.storeImage).toHaveBeenCalledTimes(2)
    // 游标推进到文件末尾（4），且迁移标记完成
    expect(journal.get(LEGACY_IMAGE_FOLDERS_TO_COLLECTIONS_MIGRATION_ID)?.cursor).toBe('4')
    expect(journal.get(LEGACY_IMAGE_FOLDERS_TO_COLLECTIONS_MIGRATION_ID)?.status).toBe('completed')
  })
})
