import { describe, expect, it, vi } from 'vitest'
import type { GeneratedAsset, TaskParams, TaskRecord } from '../types'
import { normalizeAsset } from './assetLibraryModel'
import { buildImageReferenceGraph } from './imageReferenceGraph'
import { executeAssetPurge, patchTaskForPurgedSlots, planAssetPurge, type AssetPurgePlan } from './assetPurge'
import type { PurgeRecords } from './db'
function makeTask(id: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id,
    prompt: 'p',
    params: {} as TaskParams,
    inputImageIds: [],
    outputImages: ['img-1', 'img-2'],
    maskTargetImageId: null,
    maskImageId: null,
    status: 'done',
    error: null,
    createdAt: 1000,
    finishedAt: 2000,
    elapsed: 1000,
    ...overrides,
  }
}

function makeAsset(id: string, overrides: Partial<GeneratedAsset> = {}): GeneratedAsset {
  return normalizeAsset({ id, imageId: id, createdAt: 1, updatedAt: 1, origins: [], ...overrides })
}

const empty = {
  tasks: [] as TaskRecord[],
  workspaceTabs: [],
  agentConversations: [],
  sopRuns: [],
  sopCoverImageIds: [],
  currentInputImageIds: [],
  galleryDraftInputImageIds: [],
  agentDraftInputImageIds: [],
}

describe('planAssetPurge', () => {
  it('allows purging an asset that is only referenced as a task output', () => {
    const tasks = [makeTask('task-1', { outputImages: ['img-a', 'img-b'] })]
    const assets = [
      makeAsset('img-a', {
        origins: [
          {
            key: 'task-1:0',
            taskId: 'task-1',
            outputSlot: 0,
            taskCreatedAt: 1000,
            taskFinishedAt: 2000,
            prompt: 'p',
            sourceMode: 'gallery',
            inputImageIds: [],
            requestedParams: {} as TaskParams,
          },
        ],
      }),
    ]
    const graph = buildImageReferenceGraph({ ...empty, tasks, assets })
    const plan = planAssetPurge({ assetIds: ['img-a'], assets, tasks, graph, now: 5000 })

    expect(plan.allowedAssetIds).toEqual(['img-a'])
    expect(plan.blocked).toEqual([])
    expect(plan.taskOutputCleanups).toEqual([{ taskId: 'task-1', outputSlots: [0] }])
    expect(plan.imageIdsToDelete).toEqual(['img-a'])
    expect(plan.tombstones[0]).toMatchObject({
      id: 'img-a',
      imageId: 'img-a',
      purgedAt: 5000,
      lastOriginOccurredAt: 2000,
    })
  })

  it('dedupes tombstones when purging assets that share an imageId (force)', () => {
    const first = makeAsset('a', { createdAt: 10, origins: [] })
    // 历史遗留：同一 imageId 的两条素材记录
    const twin = makeAsset('b', { imageId: 'a', createdAt: 10, origins: [] })
    const assets = [first, twin]
    const graph = buildImageReferenceGraph({ ...empty, assets })
    const plan = planAssetPurge({ assetIds: ['a', 'b'], assets, tasks: [], graph, now: 5000 }, { force: true })

    expect(plan.allowedAssetIds).toEqual(['a', 'b'])
    expect(plan.tombstones).toHaveLength(1)
    expect(plan.tombstones[0]).toMatchObject({ id: 'a', imageId: 'a', purgedAt: 5000 })
  })

  it('blocks purge when the image is referenced as another task input', () => {
    const task = makeTask('task-1', { outputImages: ['img-a'] })
    const consumer = makeTask('task-2', { outputImages: [], inputImageIds: ['img-a'] })
    const assets = [makeAsset('img-a')]
    const graph = buildImageReferenceGraph({ ...empty, tasks: [task, consumer], assets })
    const plan = planAssetPurge({ assetIds: ['img-a'], assets, tasks: [task, consumer], graph })

    expect(plan.allowedAssetIds).toEqual([])
    expect(plan.blocked).toHaveLength(1)
    expect(plan.blocked[0].references.some((r) => r.type === 'task-input')).toBe(true)
    expect(plan.tombstones).toEqual([])
  })

  it('does not treat its own asset-original reference as a blocker', () => {
    const assets = [makeAsset('img-a')]
    const graph = buildImageReferenceGraph({ ...empty, assets })
    const plan = planAssetPurge({ assetIds: ['img-a'], assets, tasks: [], graph })
    expect(plan.allowedAssetIds).toEqual(['img-a'])
  })

  it('collects output slots across multiple tasks', () => {
    const tasks = [
      makeTask('task-1', { outputImages: ['img-a', 'img-b'] }),
      makeTask('task-2', { outputImages: ['img-c', 'img-a'] }),
    ]
    const assets = [makeAsset('img-a')]
    const graph = buildImageReferenceGraph({ ...empty, tasks, assets })
    const plan = planAssetPurge({ assetIds: ['img-a'], assets, tasks, graph })
    expect(plan.taskOutputCleanups).toEqual([
      { taskId: 'task-1', outputSlots: [0] },
      { taskId: 'task-2', outputSlots: [1] },
    ])
  })

  it('falls back to createdAt when computing the tombstone occurrence', () => {
    const assets = [makeAsset('img-a', { createdAt: 42 })]
    const graph = buildImageReferenceGraph({ ...empty, assets })
    const plan = planAssetPurge({ assetIds: ['img-a'], assets, tasks: [], graph, now: 100 })
    expect(plan.tombstones[0].lastOriginOccurredAt).toBe(42)
  })

  it('force mode deletes referenced assets and collects detach targets', () => {
    const task = makeTask('task-1', { outputImages: ['img-a'] })
    const consumer = makeTask('task-2', { outputImages: [], inputImageIds: ['img-a'] })
    const assets = [makeAsset('img-a')]
    const graph = buildImageReferenceGraph({ ...empty, tasks: [task, consumer], assets })
    const plan = planAssetPurge({ assetIds: ['img-a'], assets, tasks: [task, consumer], graph }, { force: true })

    expect(plan.allowedAssetIds).toEqual(['img-a'])
    expect(plan.blocked).toEqual([])
    expect(plan.imageIdsToDelete).toEqual(['img-a'])
    expect(plan.tombstones).toHaveLength(1)
    expect(plan.forceDetach).toHaveLength(1)
    expect(plan.forceDetach[0]).toMatchObject({ imageId: 'img-a' })
    expect(plan.forceDetach[0].references.some((ref) => ref.type === 'task-input' && ref.ownerId === 'task-2')).toBe(
      true,
    )
  })

  it('non-force mode leaves forceDetach empty', () => {
    const task = makeTask('task-1', { outputImages: ['img-a'] })
    const consumer = makeTask('task-2', { outputImages: [], inputImageIds: ['img-a'] })
    const assets = [makeAsset('img-a')]
    const graph = buildImageReferenceGraph({ ...empty, tasks: [task, consumer], assets })
    const plan = planAssetPurge({ assetIds: ['img-a'], assets, tasks: [task, consumer], graph })
    expect(plan.forceDetach).toEqual([])
  })
})

describe('patchTaskForPurgedSlots', () => {
  it('nulls slots, filters generation slots and image-keyed maps, and appends purgedOutputSlots', () => {
    const task = makeTask('task-1', {
      outputImages: ['img-a', 'img-b', 'img-c'],
      generationSlots: [
        { index: 0, status: 'done', attempts: 1, outputImageId: 'img-a' },
        { index: 1, status: 'done', attempts: 1, outputImageId: 'img-b' },
      ],
      actualParamsByImage: { 'img-b': { seed: 1 }, 'img-c': { seed: 2 } },
      revisedPromptByImage: { 'img-b': 'x', 'img-c': 'y' },
      localSavedOutputImagePaths: { '1:img-b': '/a.png', '2:img-c': '/c.png' },
      rawImageUrls: ['https://x', 'https://y'],
    })
    const patched = patchTaskForPurgedSlots(task, [1])
    expect(patched.outputImages[0]).toBe('img-a')
    expect(patched.outputImages[1]).toBeUndefined()
    expect(patched.outputImages[2]).toBe('img-c')
    expect(patched.generationSlots).toHaveLength(1)
    expect(patched.actualParamsByImage).toEqual({ 'img-c': { seed: 2 } })
    expect(patched.revisedPromptByImage).toEqual({ 'img-c': 'y' })
    expect(patched.localSavedOutputImagePaths).toEqual({ '2:img-c': '/c.png' })
    expect(patched.purgedOutputSlots).toEqual([1])
  })

  it('merges existing purgedOutputSlots without duplicates', () => {
    const task = makeTask('task-1', { purgedOutputSlots: [0, 2] })
    const patched = patchTaskForPurgedSlots(task, [2, 3])
    expect(patched.purgedOutputSlots).toEqual([0, 2, 3])
  })
})

describe('executeAssetPurge', () => {
  it('patches tasks, commits records in one transaction, then deletes images', async () => {
    const plan: AssetPurgePlan = {
      allowedAssetIds: ['img-a'],
      blocked: [],
      taskOutputCleanups: [{ taskId: 'task-1', outputSlots: [0] }],
      imageIdsToDelete: ['img-a'],
      tombstones: [{ id: 'img-a', imageId: 'img-a', purgedAt: 1, lastOriginOccurredAt: 1 }],
      forceDetach: [],
    }
    const getTask = vi.fn(async () => makeTask('task-1'))
    const purgeRecords = vi.fn(async (_records: PurgeRecords) => {})
    const deleteImage = vi.fn(async () => {})

    await executeAssetPurge(plan, { getTask, purgeRecords, deleteImage })

    expect(getTask).toHaveBeenCalledWith('task-1')
    expect(purgeRecords).toHaveBeenCalledTimes(1)
    const records = purgeRecords.mock.calls[0]![0] as PurgeRecords
    expect(records.assetIds).toEqual(['img-a'])
    expect(records.tombstones).toHaveLength(1)
    expect(records.tasksToPatch[0].outputImages[0]).toBeUndefined()
    // 图片删除在事务提交之后
    expect(deleteImage).toHaveBeenCalledWith('img-a')
    expect(purgeRecords.mock.invocationCallOrder[0]).toBeLessThan(deleteImage.mock.invocationCallOrder[0])
  })

  it('returns early when nothing is allowed to be purged', async () => {
    const plan = {
      allowedAssetIds: [],
      blocked: [{ assetId: 'img-a', imageId: 'img-a', references: [] }],
      taskOutputCleanups: [],
      imageIdsToDelete: [],
      tombstones: [],
      forceDetach: [],
    }
    const getTask = vi.fn()
    const purgeRecords = vi.fn(async () => {})
    const deleteImage = vi.fn(async () => {})
    await executeAssetPurge(plan, { getTask, purgeRecords, deleteImage })
    expect(getTask).not.toHaveBeenCalled()
    expect(purgeRecords).not.toHaveBeenCalled()
    expect(deleteImage).not.toHaveBeenCalled()
  })

  it('prefers batch image deletion over per-image deletion', async () => {
    const plan: AssetPurgePlan = {
      allowedAssetIds: ['img-a', 'img-b'],
      blocked: [],
      taskOutputCleanups: [],
      imageIdsToDelete: ['img-a', 'img-b'],
      tombstones: [],
      forceDetach: [],
    }
    const getTask = vi.fn(async () => undefined)
    const purgeRecords = vi.fn(async (_records: PurgeRecords) => {})
    const deleteImages = vi.fn(async () => {})
    const deleteImage = vi.fn(async () => {})

    await executeAssetPurge(plan, { getTask, purgeRecords, deleteImages, deleteImage })

    expect(deleteImages).toHaveBeenCalledWith(['img-a', 'img-b'], expect.any(Function))
    expect(deleteImage).not.toHaveBeenCalled()
  })

  it('falls back to per-image deletion when no batch API is provided', async () => {
    const plan: AssetPurgePlan = {
      allowedAssetIds: ['img-a'],
      blocked: [],
      taskOutputCleanups: [],
      imageIdsToDelete: ['img-a'],
      tombstones: [],
      forceDetach: [],
    }
    const getTask = vi.fn(async () => undefined)
    const purgeRecords = vi.fn(async (_records: PurgeRecords) => {})
    const deleteImage = vi.fn(async () => {})

    await executeAssetPurge(plan, { getTask, purgeRecords, deleteImage })

    expect(deleteImage).toHaveBeenCalledWith('img-a')
  })
})
