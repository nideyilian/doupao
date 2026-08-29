import { describe, expect, it } from 'vitest'
import type { GeneratedAsset, TaskParams, TaskRecord, WorkspaceTab } from '../types'
import { normalizeAsset } from './assetLibraryModel'
import {
  patchAgentConversationForDetachedImages,
  patchAssetOriginsForDetachedImages,
  patchInputDraftLike,
  patchInputImageList,
  patchOrderForDetachedImages,
  patchSopLibraryItemForDetachedImages,
  patchSopSnapshotForDetachedImages,
  patchStrategyAssetForDetachedImages,
  patchTaskForDetachedInputs,
  patchWorkspaceTabForDetachedImages,
  patchWordGenerationBatchForDetachedImages,
} from './assetDetach'

function makeTask(id: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id,
    prompt: 'p',
    params: {} as TaskParams,
    inputImageIds: ['img-a'],
    outputImages: [],
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

function makeTab(id: string, overrides: Partial<WorkspaceTab> = {}): WorkspaceTab {
  return {
    id,
    name: '标签',
    groupId: null,
    prompt: '',
    inputImages: [{ id: 'img-a', dataUrl: 'data:image/png;base64,x' }],
    inputImageFolder: null,
    params: {} as TaskParams,
    maskDraft: null,
    maskEditorImageId: null,
    customOutputPath: '',
    tasks: [],
    createdAt: 1,
    updatedAt: 1,
    order: 0,
    ...overrides,
  }
}

describe('patchTaskForDetachedInputs', () => {
  it('removes input image ids and clears mask references', () => {
    const task = makeTask('t1', {
      inputImageIds: ['img-a', 'img-b'],
      streamPartialImageIds: ['img-a', 'img-c'],
      maskTargetImageId: 'img-a',
      maskImageId: 'img-x',
    })
    const patched = patchTaskForDetachedInputs(task, new Set(['img-a']))
    expect(patched.inputImageIds).toEqual(['img-b'])
    expect(patched.streamPartialImageIds).toEqual(['img-c'])
    expect(patched.maskTargetImageId).toBeNull()
    expect(patched.maskImageId).toBe('img-x')
  })

  it('returns the same reference when nothing changed', () => {
    const task = makeTask('t1', { inputImageIds: ['img-b'] })
    expect(patchTaskForDetachedInputs(task, new Set(['img-a']))).toBe(task)
  })
})

describe('patchAssetOriginsForDetachedImages', () => {
  it('filters origin input ids and clears mask fields, bumping updatedAt', () => {
    const asset = makeAsset('b', {
      updatedAt: 10,
      origins: [
        {
          key: 't:0',
          taskId: 't',
          outputSlot: 0,
          taskCreatedAt: 1,
          taskFinishedAt: 1,
          prompt: 'p',
          sourceMode: 'gallery',
          inputImageIds: ['img-a', 'img-c'],
          maskTargetImageId: 'img-a',
          maskImageId: 'img-z',
          requestedParams: {} as TaskParams,
        },
      ],
    })
    const patched = patchAssetOriginsForDetachedImages(asset, new Set(['img-a']))
    expect(patched.origins[0].inputImageIds).toEqual(['img-c'])
    expect(patched.origins[0].maskTargetImageId).toBeNull()
    expect(patched.origins[0].maskImageId).toBe('img-z')
    expect(patched.updatedAt).toBeGreaterThan(10)
  })

  it('returns the same reference when nothing changed', () => {
    const asset = makeAsset('b', {
      origins: [
        {
          key: 't:0',
          taskId: 't',
          outputSlot: 0,
          taskCreatedAt: 1,
          taskFinishedAt: 1,
          prompt: 'p',
          sourceMode: 'gallery',
          inputImageIds: ['img-c'],
          requestedParams: {} as TaskParams,
        },
      ],
    })
    expect(patchAssetOriginsForDetachedImages(asset, new Set(['img-a']))).toBe(asset)
  })
})

describe('patchInputImageList / patchInputDraftLike / patchWorkspaceTabForDetachedImages', () => {
  it('filters input images by id', () => {
    const images = [
      { id: 'img-a', dataUrl: 'd1' },
      { id: 'img-b', dataUrl: 'd2' },
    ]
    const patched = patchInputImageList(images, new Set(['img-a']))
    expect(patched.map((image) => image.id)).toEqual(['img-b'])
  })

  it('patches draft-like inputs: images, folder ids, mask draft and editor image', () => {
    const tab = makeTab('tab-1', {
      inputImages: [
        { id: 'img-a', dataUrl: 'd1' },
        { id: 'img-b', dataUrl: 'd2' },
      ],
      inputImageFolder: { path: '/f', imageIds: ['img-a', 'img-c'] },
      maskDraft: { targetImageId: 'img-a', maskDataUrl: 'm', updatedAt: 1 },
      maskEditorImageId: 'img-a',
    })
    const patched = patchWorkspaceTabForDetachedImages(tab, new Set(['img-a']))
    expect(patched.inputImages.map((image) => image.id)).toEqual(['img-b'])
    expect(patched.inputImageFolder?.imageIds).toEqual(['img-c'])
    expect(patched.maskDraft).toBeNull()
    expect(patched.maskEditorImageId).toBeNull()
  })

  it('returns the same reference when nothing changed', () => {
    const tab = makeTab('tab-1', { inputImages: [{ id: 'img-b', dataUrl: 'd2' }] })
    expect(patchWorkspaceTabForDetachedImages(tab, new Set(['img-a']))).toBe(tab)
    expect(patchInputDraftLike(tab, new Set(['img-a']))).toBe(tab)
  })
})

describe('patchAgentConversationForDetachedImages', () => {
  it('clears round and message references', () => {
    const conversation = {
      id: 'conv-1',
      title: '会话',
      order: 0,
      createdAt: 1,
      updatedAt: 1,
      rounds: [
        {
          id: 'r1',
          index: 0,
          userMessageId: 'm1',
          prompt: 'p',
          inputImageIds: ['img-a'],
          maskImageId: 'img-a',
          outputTaskIds: [],
          status: 'done' as const,
          error: null,
          createdAt: 1,
          finishedAt: 2,
        },
      ],
      messages: [
        {
          id: 'm1',
          role: 'user' as const,
          content: 'c',
          roundId: 'r1',
          inputImageIds: ['img-a', 'img-b'],
          createdAt: 1,
        },
      ],
    }
    const patched = patchAgentConversationForDetachedImages(conversation, new Set(['img-a']))
    expect(patched.rounds[0].inputImageIds).toEqual([])
    expect(patched.rounds[0].maskImageId).toBeNull()
    expect(patched.messages[0].inputImageIds).toEqual(['img-b'])
    expect(patched.updatedAt).toBeGreaterThan(1)
  })

  it('returns the same reference when nothing changed', () => {
    const conversation = {
      id: 'conv-1',
      title: '会话',
      order: 0,
      createdAt: 1,
      updatedAt: 1,
      rounds: [],
      messages: [
        { id: 'm1', role: 'user' as const, content: 'c', roundId: 'r1', inputImageIds: ['img-b'], createdAt: 1 },
      ],
    }
    expect(patchAgentConversationForDetachedImages(conversation, new Set(['img-a']))).toBe(conversation)
  })
})

describe('patchSopSnapshotForDetachedImages', () => {
  it('filters top-level and prompt-level reference ids', () => {
    const snapshot = {
      id: 'snap-1',
      batchId: 'b1',
      workspaceTabId: null,
      createdAt: 1,
      referenceImageIds: ['img-a', 'img-c'],
      promptCount: 1,
      imagesPerPrompt: 1,
      sop: { id: 's1', name: 's', description: 'd', content: 'c' },
      brief: '',
      prompts: [{ id: 'p1', text: 't', origin: 'ai' as const, edited: false, referenceImageIds: ['img-a'] }],
      params: {} as TaskParams,
    }
    const patched = patchSopSnapshotForDetachedImages(snapshot, new Set(['img-a']))
    expect(patched.referenceImageIds).toEqual(['img-c'])
    expect(patched.prompts[0].referenceImageIds).toEqual([])
  })
})

describe('patchStrategyAssetForDetachedImages', () => {
  it('clears cover and workflow reference image ids', () => {
    const strategy = {
      id: 's1',
      name: '策略',
      productId: 'p1',
      materialTypeId: 'm1',
      description: '',
      coverImageId: 'img-a',
      generationMode: 'image-to-image' as const,
      workflow: {
        reference: { source: 'generated-image' as const, label: 'r', value: 'v', imageIds: ['img-a', 'img-b'] },
        instruction: '',
        knowledge: { resolved: false, insightIds: [] },
        sop: { resolved: false, mode: 'none' as const, content: '' },
      },
      outputs: {
        channels: { enabled: false, channelIds: [] },
        sizes: { enabled: false, ratios: [] },
        export: { enabled: false },
        allocation: { enabled: false },
      },
      quantity: 1,
      status: 'draft' as const,
      version: 1,
      createdBy: 'u',
      createdAt: 1,
      updatedAt: 1,
    }
    const patched = patchStrategyAssetForDetachedImages(strategy, new Set(['img-a']))
    expect(patched.coverImageId).toBeUndefined()
    expect(patched.workflow.reference?.imageIds).toEqual(['img-b'])
  })
})

describe('patchSopLibraryItemForDetachedImages', () => {
  it('clears the cover image id', () => {
    const item = {
      id: 'sop-1',
      coverImageId: 'img-a',
      name: 'SOP',
      description: '',
      content: 'c',
      source: 'manual' as const,
      createdBy: 'u',
      createdAt: 1,
      updatedAt: 1,
    }
    expect(patchSopLibraryItemForDetachedImages(item, new Set(['img-a'])).coverImageId).toBeUndefined()
    expect(patchSopLibraryItemForDetachedImages(item, new Set(['img-x']))).toBe(item)
  })
})

describe('patchOrderForDetachedImages', () => {
  it('filters unit reference image ids', () => {
    const order = {
      id: 'o1',
      number: 'N1',
      createdBy: 'u',
      createdByName: 'U',
      createdAt: 1,
      status: 'completed' as const,
      draft: { productIds: [], channels: [], materialTypeIds: [], quantity: 1, urgentRequested: false },
      units: [
        {
          id: 'u1',
          productId: 'p',
          channelId: 'c',
          ratio: '16:9' as const,
          materialTypeId: 'm',
          quantity: 1,
          prompt: 'p',
          status: 'done' as const,
          referenceImageIds: ['img-a', 'img-b'],
        },
      ],
      excluded: [],
      totalImages: 1,
      completedImages: 1,
      failedImages: 0,
      urgentRequested: false,
      urgentApproved: false,
    }
    const patched = patchOrderForDetachedImages(order, new Set(['img-a']))
    expect(patched.units[0].referenceImageIds).toEqual(['img-b'])
  })
})

describe('patchWordGenerationBatchForDetachedImages', () => {
  it('filters batch reference image ids', () => {
    const batch = {
      id: 'wb1',
      skillName: 's',
      sourcePrompt: 'p',
      referenceImageIds: ['img-a', 'img-b'],
      entryIds: [],
      createdAt: 1,
      archivedAt: null,
    }
    const patched = patchWordGenerationBatchForDetachedImages(batch, new Set(['img-a']))
    expect(patched.referenceImageIds).toEqual(['img-b'])
    expect(patchWordGenerationBatchForDetachedImages(batch, new Set(['img-x']))).toBe(batch)
  })
})
