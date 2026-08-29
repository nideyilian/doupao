import { describe, expect, it } from 'vitest'
import { getStorageOverview } from './storageStats'

describe('getStorageOverview', () => {
  it('combines quota usage and record counts without loading records', async () => {
    await expect(
      getStorageOverview({
        estimate: async () => ({ usage: 80, quota: 100 }),
        counts: async () => ({
          tasks: 10,
          images: 20,
          thumbnails: 18,
          conversations: 2,
          compositeAssets: 3,
          generatedAssets: 4,
          assetCollections: 1,
          assetTags: 2,
          assetTombstones: 0,
        }),
      }),
    ).resolves.toEqual({
      usageBytes: 80,
      quotaBytes: 100,
      usagePercent: 80,
      counts: {
        tasks: 10,
        images: 20,
        thumbnails: 18,
        conversations: 2,
        compositeAssets: 3,
        generatedAssets: 4,
        assetCollections: 1,
        assetTags: 2,
        assetTombstones: 0,
      },
      categories: [
        { key: 'images', label: '素材原图与图片', description: '生成原图、输入图、遮罩等图片字节', count: 20 },
        { key: 'thumbnails', label: '缩略图缓存', description: '网格浏览使用的缩略图，可重建', count: 18 },
        { key: 'tasks-metadata', label: '任务与元数据', description: '生成任务、Agent 对话、合成资源', count: 15 },
        { key: 'asset-index', label: '素材库索引', description: '素材记录、项目、标签、墓碑', count: 7 },
      ],
      disk: null,
    })
  })

  it('handles unavailable quota information', async () => {
    const result = await getStorageOverview({
      estimate: async () => ({}),
      counts: async () => ({
        tasks: 0,
        images: 0,
        thumbnails: 0,
        conversations: 0,
        compositeAssets: 0,
        generatedAssets: 0,
        assetCollections: 0,
        assetTags: 0,
        assetTombstones: 0,
      }),
    })
    expect(result.usagePercent).toBeNull()
    expect(result.disk).toBeNull()
  })

  it('uses real disk usage in Electron and disables quota percent', async () => {
    const result = await getStorageOverview({
      estimate: async () => ({ usage: 10, quota: 100 }),
      counts: async () => ({
        tasks: 1,
        images: 2,
        thumbnails: 3,
        conversations: 0,
        compositeAssets: 0,
        generatedAssets: 0,
        assetCollections: 0,
        assetTags: 0,
        assetTombstones: 0,
      }),
      diskUsage: async () => ({
        cacheDir: '/data/cache-images',
        imagesBytes: 5000,
        imagesCount: 2,
        backupBytes: 2000,
        thumbsBytes: 300,
        thumbsCount: 4,
      }),
    })
    expect(result.usageBytes).toBe(10 + 5000 + 2000 + 300)
    expect(result.usagePercent).toBeNull()
    const images = result.categories.find((category) => category.key === 'images')!
    expect(images.count).toBe(2)
    expect(images.bytes).toBe(5000)
    const thumbs = result.categories.find((category) => category.key === 'thumbnails')!
    expect(thumbs.count).toBe(4)
    expect(thumbs.bytes).toBe(300)
    expect(result.disk?.backupBytes).toBe(2000)
    expect(result.disk?.thumbsBytes).toBe(300)
  })
})
