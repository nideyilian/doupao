import { describe, expect, it } from 'vitest'
import type {
  AgentConversation,
  GeneratedAsset,
  SopBatchSnapshot,
  TaskParams,
  TaskRecord,
  WorkspaceTab,
} from '../types'
import { normalizeAsset } from './assetLibraryModel'
import {
  buildImageReferenceGraph,
  getBlockingReferences,
  getImageReferences,
  getTaskOutputReferences,
  isImageReferenced,
} from './imageReferenceGraph'

function makeTask(id: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id,
    prompt: 'p',
    params: {} as TaskParams,
    inputImageIds: [],
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
    name: 'tab',
    groupId: null,
    prompt: '',
    inputImages: [],
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

const empty = {
  tasks: [],
  assets: [],
  workspaceTabs: [],
  agentConversations: [] as AgentConversation[],
  sopRuns: [] as SopBatchSnapshot[],
  sopCoverImageIds: [],
  currentInputImageIds: [],
  galleryDraftInputImageIds: [],
  agentDraftInputImageIds: [],
}

describe('buildImageReferenceGraph', () => {
  it('keeps asset originals and their hidden input dependencies as blocking references', () => {
    const asset = makeAsset('img-out', {
      origins: [
        {
          key: 'task-1:0',
          taskId: 'task-1',
          outputSlot: 0,
          taskCreatedAt: 1000,
          taskFinishedAt: 2000,
          prompt: 'p',
          sourceMode: 'gallery',
          inputImageIds: ['img-input-a', 'img-input-b'],
          requestedParams: {} as TaskParams,
        },
      ],
    })
    const graph = buildImageReferenceGraph({ ...empty, assets: [asset] })

    const refs = getImageReferences(graph, 'img-out')
    expect(refs.some((r) => r.type === 'asset-original' && r.blocking)).toBe(true)
    expect(getBlockingReferences(graph, 'img-input-a').some((r) => r.type === 'asset-origin-input')).toBe(true)
    expect(isImageReferenced(graph, 'img-input-b')).toBe(true)
  })

  it('marks task outputs as non-blocking references with slot info', () => {
    const task = makeTask('task-1', { outputImages: ['img-a', 'img-b'] })
    const graph = buildImageReferenceGraph({ ...empty, tasks: [task] })

    const refs = getImageReferences(graph, 'img-a')
    expect(refs[0]).toMatchObject({
      type: 'task-output',
      blocking: false,
      ownerId: 'task-1',
      outputSlot: 0,
      navigateTarget: 'task-1',
    })
    expect(getTaskOutputReferences(graph, 'img-a')).toEqual([{ taskId: 'task-1', outputSlot: 0, imageId: 'img-a' }])
  })

  it('marks task inputs, masks and stream partials as blocking', () => {
    const task = makeTask('task-1', {
      inputImageIds: ['in-1'],
      maskTargetImageId: 'mask-target',
      maskImageId: 'mask-img',
      streamPartialImageIds: ['partial-1'],
    })
    const graph = buildImageReferenceGraph({ ...empty, tasks: [task] })
    expect(isImageReferenced(graph, 'in-1')).toBe(true)
    expect(getBlockingReferences(graph, 'mask-img').length).toBeGreaterThan(0)
    expect(getBlockingReferences(graph, 'partial-1').length).toBeGreaterThan(0)
  })

  it('collects workspace, gallery draft and folder inputs', () => {
    const tab = makeTab('tab-1', {
      inputImages: [{ id: 'tab-in', dataUrl: 'x' }],
      inputImageFolder: { path: '/p', imageIds: ['folder-in'] },
      maskDraft: { targetImageId: 'mask-target', maskImageId: 'm' } as any,
    })
    const graph = buildImageReferenceGraph({
      ...empty,
      workspaceTabs: [tab],
      currentInputImageIds: ['current-in'],
      galleryDraftInputImageIds: ['draft-in'],
      agentDraftInputImageIds: ['agent-draft-in'],
    })
    expect(isImageReferenced(graph, 'tab-in')).toBe(true)
    expect(isImageReferenced(graph, 'folder-in')).toBe(true)
    expect(getBlockingReferences(graph, 'mask-target').length).toBeGreaterThan(0)
    expect(isImageReferenced(graph, 'current-in')).toBe(true)
    expect(isImageReferenced(graph, 'draft-in')).toBe(true)
    expect(isImageReferenced(graph, 'agent-draft-in')).toBe(true)
  })

  it('collects agent conversation and sop references', () => {
    const conversation: AgentConversation = {
      id: 'conv-1',
      title: 'c',
      rounds: [{ id: 'round-1', inputImageIds: ['conv-in'], maskImageId: 'conv-mask', createdAt: 1 } as any],
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      order: 0,
    }
    const run: SopBatchSnapshot = {
      id: 'run-1',
      batchId: 'b1',
      promptCount: 1,
      imagesPerPrompt: 1,
      referenceImageIds: ['sop-ref'],
      createdAt: 1,
      workspaceTabId: 'tab-1',
      sop: { id: 'sop-1', name: 'n', description: '', content: '' },
      brief: 'brief',
      prompts: [],
      params: {} as TaskParams,
    }
    const graph = buildImageReferenceGraph({
      ...empty,
      agentConversations: [conversation],
      sopRuns: [run],
      sopCoverImageIds: ['cover-1'],
    })
    expect(getBlockingReferences(graph, 'conv-in').some((r) => r.type === 'agent-conversation')).toBe(true)
    expect(getBlockingReferences(graph, 'conv-mask').length).toBeGreaterThan(0)
    expect(getBlockingReferences(graph, 'sop-ref').some((r) => r.type === 'sop-reference')).toBe(true)
    expect(getBlockingReferences(graph, 'cover-1').some((r) => r.type === 'sop-cover')).toBe(true)
  })

  it('returns empty references for unknown image ids', () => {
    const graph = buildImageReferenceGraph(empty)
    expect(getImageReferences(graph, 'nope')).toEqual([])
    expect(isImageReferenced(graph, 'nope')).toBe(false)
    expect(getTaskOutputReferences(graph, 'nope')).toEqual([])
  })
})
