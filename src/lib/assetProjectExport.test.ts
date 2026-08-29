import { describe, expect, it } from 'vitest'
import { buildProjectTreeCopies } from './assetProjectExport'
import type { AssetCollection, GeneratedAsset } from '../types'

function makeAsset(id: string, collectionIds: string[], imageId = `hash-${id}`): GeneratedAsset {
  return {
    id,
    imageId,
    blobId: `blob:${imageId}`,
    currentVersionId: `version:${id}`,
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    trashedAt: null,
    favorite: false,
    rating: 0,
    collectionIds,
    tagIds: [],
    origins: [
      {
        kind: 'generated',
        key: `task:${id}`,
        taskId: `task-${id}`,
        outputSlot: 0,
        taskCreatedAt: 1,
        taskFinishedAt: 1,
        sourceMode: 'gallery',
        prompt: 'p',
        requestedParams: {} as never,
        inputImageIds: [],
        maskTargetImageId: null,
        maskImageId: null,
        generatedFileNameBase: `图-${id}`,
      },
    ],
    primaryOriginKey: `task:${id}`,
    parentAssetIds: [],
    width: 10,
    height: 10,
    mimeType: 'image/png',
    metadataVersion: 2,
  }
}

function makeCollection(id: string, name: string, parentId: string | null, order = 0): AssetCollection {
  return {
    id,
    name,
    normalizedName: name.toLocaleLowerCase('zh-CN'),
    parentId,
    order,
    createdAt: 1,
    updatedAt: 1,
  }
}

const locals = (ids: string[]) => new Map(ids.map((id) => [`hash-${id}`, `D:\\cache\\${id}.png`]))

describe('buildProjectTreeCopies', () => {
  it('mirrors the nested project tree into relative target paths', () => {
    const root = makeCollection('root', '项目A', null)
    const child = makeCollection('child', '子项目A1', 'root')
    const assets = [makeAsset('a1', ['child'])]
    const result = buildProjectTreeCopies(assets, [root, child], locals(['a1']))

    expect(result.entries).toEqual([
      { sourcePath: 'D:\\cache\\a1.png', targetPath: '项目A/子项目A1/图-a1.png', assetId: 'a1' },
    ])
    expect(result.skippedNoFile).toBe(0)
    expect(result.totalAssets).toBe(1)
    expect(result.collectionCount).toBe(2)
  })

  it('emits one copy per member collection and routes unorganized assets to 未整理', () => {
    const root = makeCollection('root', '项目B', null)
    const multi = makeAsset('m1', ['root', 'other'])
    const unorganized = makeAsset('u1', [])
    const result = buildProjectTreeCopies(
      [multi, unorganized],
      [root, makeCollection('other', '项目C', null)],
      locals(['m1', 'u1']),
    )

    const paths = result.entries.map((entry) => entry.targetPath)
    expect(paths).toContain('项目B/图-m1.png')
    expect(paths).toContain('项目C/图-m1.png')
    expect(paths).toContain('未整理/图-u1.png')
    expect(paths).toHaveLength(3)
  })

  it('resolves same-folder filename collisions with numeric suffixes', () => {
    const root = makeCollection('root', '项目A', null)
    // 两个素材同名生成名（图-1）且同属一个项目
    const a = makeAsset('a1', ['root'])
    const b = makeAsset('b2', ['root'])
    a.origins[0]!.generatedFileNameBase = '同名'
    b.origins[0]!.generatedFileNameBase = '同名'
    const result = buildProjectTreeCopies([a, b], [root], locals(['a1', 'b2']))

    const names = result.entries.map((entry) => entry.targetPath.split('/').pop())
    expect(names).toContain('同名.png')
    expect(names).toContain('同名-02.png')
    expect(new Set(names).size).toBe(2)
  })

  it('sanitizes unsafe folder and file names', () => {
    const root = makeCollection('root', '项目 A/B:带*非法符', null)
    const asset = makeAsset('a1', ['root'])
    asset.origins[0]!.generatedFileNameBase = '图?号<1>'
    const result = buildProjectTreeCopies([asset], [root], locals(['a1']))

    expect(result.entries[0]!.targetPath).toContain('项目 A-B-带-非法符')
    expect(result.entries[0]!.targetPath.split('/').pop()).toBe('图-号-1-.png')
  })

  it('skips assets without a local file and excludes trashed assets/collections', () => {
    const root = makeCollection('root', '项目A', null)
    const missing = makeAsset('m1', ['root'])
    const trashedAsset = makeAsset('t1', ['root'])
    trashedAsset.status = 'trashed'
    const trashedCollection = makeCollection('gone', '已删', null, 1)
    trashedCollection.trashedAt = 9

    const result = buildProjectTreeCopies([missing, trashedAsset], [root, trashedCollection], new Map())

    expect(result.entries).toHaveLength(0)
    expect(result.skippedNoFile).toBe(1)
    expect(result.totalAssets).toBe(1) // 回收站素材不计入
    expect(result.collectionCount).toBe(1)
  })
})
