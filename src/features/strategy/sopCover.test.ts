import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../../types'
import { getSopCoverCandidates } from './sopCover'

function task(id: string, sopId: string, createdAt: number, outputImages: string[]): TaskRecord {
  return {
    id,
    prompt: id,
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    outputImages,
    status: 'done',
    error: null,
    createdAt,
    finishedAt: createdAt + 1,
    elapsed: 1,
    sopBatch: { batchId: 'batch-1', sopId, sopName: '测试 SOP', promptIndex: 1, promptCount: 1 },
  }
}

describe('getSopCoverCandidates', () => {
  it('returns unique generated images for the selected SOP with newest tasks first', () => {
    expect(
      getSopCoverCandidates('sop-1', [
        task('old', 'sop-1', 1, ['image-old', 'image-shared']),
        task('other', 'sop-2', 3, ['image-other']),
        task('new', 'sop-1', 2, ['image-new', 'image-shared']),
      ]).map((candidate) => candidate.imageId),
    ).toEqual(['image-new', 'image-shared', 'image-old'])
  })
})
