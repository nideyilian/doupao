import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type SopBatchSnapshot, type TaskRecord } from '../../../types'
import { getPromptRunImageLinks } from './promptRunImageLinks'

function task(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    id: 'task-1',
    prompt: '提交提示词',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    outputImages: [],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: null,
    ...overrides,
  } as TaskRecord
}

const run: SopBatchSnapshot = {
  id: 'run-1',
  batchId: 'batch-1',
  taskIds: ['task-1'],
  workspaceTabId: null,
  createdAt: 1,
  sop: { id: 'sop-1', name: '商品图', description: '', content: '' },
  brief: '',
  referenceImageIds: [],
  promptCount: 2,
  imagesPerPrompt: 1,
  prompts: [
    { id: 'prompt-1', text: '第一条提示词', origin: 'ai', edited: false },
    { id: 'prompt-2', text: '第二条提示词', origin: 'ai', edited: false },
  ],
  params: { ...DEFAULT_PARAMS },
}

describe('getPromptRunImageLinks', () => {
  it('groups every output image under the prompt that submitted its task', () => {
    const links = getPromptRunImageLinks(run, [
      task({
        outputImages: ['image-1', 'image-2'],
        revisedPromptByImage: { 'image-1': '图片反推提示词' },
        sopBatch: {
          batchId: 'batch-1',
          snapshotId: 'run-1',
          sopId: 'sop-1',
          sopName: '商品图',
          promptId: 'prompt-2',
          promptIndex: 2,
          promptCount: 2,
        },
      }),
    ])

    expect(links).toEqual([
      expect.objectContaining({ imageId: 'image-1', promptId: 'prompt-2', revisedPrompt: '图片反推提示词' }),
      expect.objectContaining({ imageId: 'image-2', promptId: 'prompt-2', revisedPrompt: undefined }),
    ])
  })

  it('ignores tasks from other prompt collections', () => {
    expect(
      getPromptRunImageLinks(run, [
        task({
          outputImages: ['image-1'],
          sopBatch: {
            batchId: 'batch-other',
            snapshotId: 'run-other',
            sopId: 'sop-1',
            sopName: '商品图',
            promptId: 'prompt-1',
            promptIndex: 1,
            promptCount: 1,
          },
        }),
      ]),
    ).toEqual([])
  })
})
