import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type SopBatchSnapshot } from '../../../types'
import { groupPromptRunsBySop, sortPromptRunsNewestFirst } from './promptRunPresentation'

function run(id: string, sopId: string, createdAt: number): SopBatchSnapshot {
  return {
    id,
    batchId: '',
    workspaceTabId: null,
    createdAt,
    sop: { id: sopId, name: `${sopId} 名称`, description: '', content: '' },
    brief: '',
    referenceImageIds: [],
    promptCount: 1,
    imagesPerPrompt: 1,
    prompts: [{ id: `${id}-prompt`, text: id, origin: 'ai', edited: false }],
    params: { ...DEFAULT_PARAMS, n: 1 },
  }
}

describe('prompt run presentation', () => {
  it('sorts by creation time descending even when an older run was updated later', () => {
    const older = { ...run('older', 'sop-a', 10), updatedAt: 100 }
    const newer = { ...run('newer', 'sop-b', 20), updatedAt: 20 }

    expect(sortPromptRunsNewestFirst([older, newer]).map((item) => item.id)).toEqual(['newer', 'older'])
  })

  it('groups multiple runs from the same SOP while preserving newest-first entry order', () => {
    const entries = groupPromptRunsBySop([
      run('a-old', 'sop-a', 10),
      run('single', 'sop-b', 30),
      run('a-new', 'sop-a', 20),
    ])

    expect(entries.map((entry) => (entry.type === 'run' ? entry.run.id : entry.sopId))).toEqual(['single', 'sop-a'])
    expect(entries[1]).toMatchObject({
      type: 'sop-group',
      sopId: 'sop-a',
      runs: [{ id: 'a-new' }, { id: 'a-old' }],
    })
  })

  it('keeps manually created prompt collections as individual entries', () => {
    const entries = groupPromptRunsBySop([
      run('manual-new', 'prompt-library', 20),
      run('manual-old', 'prompt-library', 10),
    ])

    expect(entries).toMatchObject([
      { type: 'run', run: { id: 'manual-new' } },
      { type: 'run', run: { id: 'manual-old' } },
    ])
  })
})
