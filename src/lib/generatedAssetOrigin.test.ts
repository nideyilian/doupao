import { describe, expect, it } from 'vitest'
import type { AssetTombstone, GeneratedAsset, TaskParams, TaskRecord } from '../types'
import { normalizeAsset } from './assetLibraryModel'
import {
  buildGeneratedAssetOrigin,
  buildGeneratedAssetsFromTask,
  getTaskOutputSlot,
  getTaskSourceMode,
} from './generatedAssetOrigin'

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-1',
    prompt: 'a cat',
    params: {} as TaskParams,
    inputImageIds: [],
    outputImages: ['img-1'],
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

describe('getTaskSourceMode', () => {
  it('detects sop from sopBatch', () => {
    expect(getTaskSourceMode(makeTask({ sopBatch: { batchId: 'b1' } as any }))).toBe('sop')
  })

  it('detects agent from conversation id or sourceMode', () => {
    expect(getTaskSourceMode(makeTask({ agentConversationId: 'conv-1' }))).toBe('agent')
    expect(getTaskSourceMode(makeTask({ sourceMode: 'agent' as any }))).toBe('agent')
  })

  it('detects schedule from scheduled output fields', () => {
    expect(getTaskSourceMode(makeTask({ scheduledOutputPath: '/tmp' }))).toBe('schedule')
    expect(getTaskSourceMode(makeTask({ scheduledOutputSubFolder: 'x' }))).toBe('schedule')
  })

  it('falls back to gallery or unknown', () => {
    expect(getTaskSourceMode(makeTask({ sourceMode: 'gallery' as any }))).toBe('gallery')
    expect(getTaskSourceMode(makeTask())).toBe('unknown')
  })
})

describe('getTaskOutputSlot', () => {
  it('prefers the stable generation slot index', () => {
    const task = makeTask({
      generationSlots: [
        { index: 0, status: 'done', attempts: 1, outputImageId: 'img-a' },
        { index: 1, status: 'done', attempts: 1, outputImageId: 'img-b' },
      ] as any,
    })
    expect(getTaskOutputSlot(task, 'img-b', 0)).toBe(1)
    expect(getTaskOutputSlot(task, 'img-missing', 3)).toBe(3)
  })
})

describe('buildGeneratedAssetOrigin', () => {
  it('never writes secrets or raw payload', () => {
    const task = makeTask({
      apiKey: 'SECRET' as any,
      rawResponsePayload: '{ "secret": true }',
      revisedPromptByImage: { 'img-1': 'revised prompt' },
      filenameLabel: '图册',
    } as unknown as TaskRecord)
    const origin = buildGeneratedAssetOrigin(task, 'img-1', { sourceMode: 'gallery' }, 0)
    expect(origin.key).toBe('task-1:0')
    expect(origin.prompt).toBe('a cat')
    expect(origin.revisedPrompt).toBe('revised prompt')
    expect(origin.filenameLabel).toBe('图册')
    expect(JSON.stringify(origin)).not.toContain('SECRET')
    expect(JSON.stringify(origin)).not.toContain('rawResponsePayload')
  })

  it('uses workspace context and localSaveBatchFolder as fallback label', () => {
    const origin = buildGeneratedAssetOrigin(
      makeTask({ localSaveBatchFolder: '2026-08' }),
      'img-1',
      { sourceMode: 'agent', workspaceTabId: 'tab-1', workspaceTabName: '广告' },
      0,
    )
    expect(origin.sourceMode).toBe('agent')
    expect(origin.workspaceTabId).toBe('tab-1')
    expect(origin.workspaceTabName).toBe('广告')
    expect(origin.filenameLabel).toBe('2026-08')
  })

  it('decouples per-image actual params and seed into the origin snapshot', () => {
    const task = makeTask({
      actualParams: { size: '1024x1024' },
      actualParamsByImage: {
        'img-1': { size: '1536x1024', seed: 42 },
        'img-2': { seed: 7 },
      },
    } as unknown as TaskRecord)
    const originA = buildGeneratedAssetOrigin(task, 'img-1', { sourceMode: 'gallery' }, 0)
    expect(originA.actualParams).toEqual({ size: '1024x1024' })
    // 图级专属差异独立记录（任务删除后仍可追溯）
    expect(originA.imageActualParams).toEqual({ size: '1536x1024', seed: 42 })
    expect(originA.seed).toBe(42)

    const originB = buildGeneratedAssetOrigin(task, 'img-2', { sourceMode: 'gallery' }, 1)
    expect(originB.imageActualParams).toEqual({ seed: 7 })
    expect(originB.seed).toBe(7)
  })

  it('falls back to the task-level seed when the image has none', () => {
    const origin = buildGeneratedAssetOrigin(
      makeTask({ actualParams: { seed: 99 } } as unknown as TaskRecord),
      'img-1',
      { sourceMode: 'gallery' },
      0,
    )
    expect(origin.seed).toBe(99)
    expect(origin.imageActualParams).toBeUndefined()
  })

  it('preserves the decoupled fields through normalization', () => {
    const task = makeTask({ actualParamsByImage: { 'img-1': { seed: 5 } } } as unknown as TaskRecord)
    const origin = buildGeneratedAssetOrigin(task, 'img-1', { sourceMode: 'gallery' }, 0)
    const normalized = normalizeAsset({
      id: 'img-1',
      imageId: 'img-1',
      origins: [origin],
      primaryOriginKey: origin.key,
    })
    expect(normalized.origins[0]?.imageActualParams).toEqual({ seed: 5 })
    expect(normalized.origins[0]?.seed).toBe(5)
  })
})

describe('buildGeneratedAssetsFromTask', () => {
  it('builds a new asset with full defaults', () => {
    const changed = buildGeneratedAssetsFromTask(makeTask(), { sourceMode: 'gallery' }, new Map(), new Map(), 5000)
    expect(changed).toHaveLength(1)
    expect(changed[0]).toMatchObject({
      id: 'asset:img-1',
      imageId: 'img-1',
      status: 'active',
      createdAt: 2000,
      favorite: false,
      rating: 0,
      primaryOriginKey: 'task-1:0',
    })
    expect(changed[0].origins).toHaveLength(1)
  })

  it('files new assets into the task default collection (project folder)', () => {
    const changed = buildGeneratedAssetsFromTask(
      makeTask({ defaultCollectionId: 'col-1' }),
      { sourceMode: 'gallery' },
      new Map(),
      new Map(),
    )
    expect(changed[0].collectionIds).toEqual(['col-1'])
  })

  it('keeps collectionIds empty when the task has no default collection', () => {
    const changed = buildGeneratedAssetsFromTask(makeTask(), { sourceMode: 'gallery' }, new Map(), new Map())
    expect(changed[0].collectionIds).toEqual([])
  })

  it('never rewrites collectionIds of an existing asset from a later task', () => {
    const existing = normalizeAsset({
      id: 'img-1',
      imageId: 'img-1',
      collectionIds: ['old-col'],
      origins: [
        { key: 'task-0:0', taskId: 'task-0', outputSlot: 0, taskCreatedAt: 100, prompt: 'old', requestedParams: {} },
      ],
    })
    const changed = buildGeneratedAssetsFromTask(
      makeTask({ id: 'task-2', defaultCollectionId: 'new-col' }),
      { sourceMode: 'gallery' },
      new Map([['img-1', existing]]),
      new Map(),
    )
    expect(changed[0].collectionIds).toEqual(['old-col'])
  })

  it('appends a new origin for the same content from another task', () => {
    const existing = normalizeAsset({
      id: 'img-1',
      imageId: 'img-1',
      origins: [
        { key: 'task-0:0', taskId: 'task-0', outputSlot: 0, taskCreatedAt: 100, prompt: 'old', requestedParams: {} },
      ],
    })
    const changed = buildGeneratedAssetsFromTask(
      makeTask({ id: 'task-2', createdAt: 2000 }),
      { sourceMode: 'agent' },
      new Map([['img-1', existing]]),
      new Map(),
      6000,
    )
    expect(changed[0].origins).toHaveLength(2)
    expect(changed[0].origins[1].key).toBe('task-2:0')
    expect(changed[0].origins[1].sourceMode).toBe('agent')
    expect(changed[0].updatedAt).toBe(6000)
  })

  it('updates an existing origin snapshot in place', () => {
    const existing = normalizeAsset({
      id: 'img-1',
      imageId: 'img-1',
      origins: [
        {
          key: 'task-1:0',
          taskId: 'task-1',
          outputSlot: 0,
          taskCreatedAt: 1000,
          taskFinishedAt: null,
          prompt: 'a cat',
          requestedParams: {},
        },
      ],
    })
    const changed = buildGeneratedAssetsFromTask(
      makeTask({ status: 'done', finishedAt: 2000 }),
      { sourceMode: 'gallery' },
      new Map([['img-1', existing]]),
      new Map(),
      6000,
    )
    expect(changed[0].origins).toHaveLength(1)
    expect(changed[0].origins[0].taskFinishedAt).toBe(2000)
    expect(changed[0].origins[0].prompt).toBe('a cat')
  })

  it('skips slots listed in purgedOutputSlots', () => {
    const changed = buildGeneratedAssetsFromTask(
      makeTask({ outputImages: ['img-1', 'img-2'], purgedOutputSlots: [1] }),
      { sourceMode: 'gallery' },
      new Map(),
      new Map(),
    )
    expect(changed.map((a) => a.id)).toEqual(['asset:img-1'])
  })

  it('skips assets blocked by a tombstone for an old task', () => {
    const tombstone: AssetTombstone = { id: 'img-1', imageId: 'img-1', purgedAt: 5000, lastOriginOccurredAt: 4000 }
    const changed = buildGeneratedAssetsFromTask(
      makeTask({ createdAt: 1000 }),
      { sourceMode: 'gallery' },
      new Map(),
      new Map([['img-1', tombstone]]),
    )
    expect(changed).toEqual([])
  })

  it('allows a newer task to recreate a purged asset', () => {
    const tombstone: AssetTombstone = { id: 'img-1', imageId: 'img-1', purgedAt: 5000, lastOriginOccurredAt: 4000 }
    const changed = buildGeneratedAssetsFromTask(
      makeTask({ id: 'task-new', createdAt: 9000 }),
      { sourceMode: 'gallery' },
      new Map(),
      new Map([['img-1', tombstone]]),
    )
    expect(changed).toHaveLength(1)
  })

  it('keeps parents only for inputs already in the library', () => {
    const inputAsset = normalizeAsset({ id: 'input-a', imageId: 'input-a', origins: [] })
    const existing = new Map<string, GeneratedAsset>([
      ['input-a', inputAsset],
      ['img-1', normalizeAsset({ id: 'img-1', imageId: 'img-1', origins: [] })],
    ])
    const changed = buildGeneratedAssetsFromTask(
      makeTask({ inputImageIds: ['input-a', 'input-b'] }),
      { sourceMode: 'gallery' },
      existing,
      new Map(),
    )
    expect(changed[0].parentAssetIds).toEqual(['input-a'])
  })

  it('unions parent assets and origins when duplicate output ids occur', () => {
    const inputs = new Map<string, GeneratedAsset>([
      ['input-a', normalizeAsset({ id: 'input-a', imageId: 'input-a', origins: [] })],
      ['input-b', normalizeAsset({ id: 'input-b', imageId: 'input-b', origins: [] })],
    ])
    const first = buildGeneratedAssetsFromTask(
      makeTask({ inputImageIds: ['input-a'] }),
      { sourceMode: 'gallery' },
      inputs,
      new Map(),
    )[0]
    const second = buildGeneratedAssetsFromTask(
      makeTask({ id: 'task-2', inputImageIds: ['input-b'] }),
      { sourceMode: 'gallery' },
      new Map([...inputs, ['img-1', first]]),
      new Map(),
    )[0]
    expect(second.parentAssetIds).toEqual(['input-a', 'input-b'])
    expect(second.origins.map((origin) => origin.key)).toEqual(['task-1:0', 'task-2:0'])
  })

  it('copies image dimensions and media metadata into the index', () => {
    const images = new Map([
      [
        'img-1',
        {
          id: 'asset:img-1',
          dataUrl: 'data:image/png;base64,YWJj',
          width: 1024,
          height: 768,
        },
      ],
    ])
    const changed = buildGeneratedAssetsFromTask(
      makeTask(),
      { sourceMode: 'gallery' },
      new Map(),
      new Map(),
      5000,
      images,
    )
    expect(changed[0]).toMatchObject({ width: 1024, height: 768, mimeType: 'image/png', byteSize: 3 })
  })

  it('returns empty for tasks without outputs', () => {
    expect(
      buildGeneratedAssetsFromTask(makeTask({ outputImages: [] }), { sourceMode: 'gallery' }, new Map(), new Map()),
    ).toEqual([])
  })
})
