import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { findTaskSavedImagePath, resolveImageRevealPath } from './imageRevealPath'

function makeTask(partial: Partial<TaskRecord>): TaskRecord {
  return {
    id: 'task-1',
    prompt: '测试',
    params: { ...DEFAULT_PARAMS, n: 1 },
    inputImageIds: [],
    outputImages: [],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
    ...partial,
  }
}

describe('findTaskSavedImagePath', () => {
  it('returns the workspace-tree saved path for an image id', () => {
    const task = makeTask({
      id: 'task-a',
      createdAt: 100,
      localSavedOutputImagePaths: {
        '0:img-1': 'D:\\AI生图2\\images\\默认 2\\20260820-默认 2-1-1.png',
      },
    })
    expect(findTaskSavedImagePath([task], 'img-1')).toEqual({
      taskId: 'task-a',
      path: 'D:\\AI生图2\\images\\默认 2\\20260820-默认 2-1-1.png',
    })
  })

  it('matches keys by the `${index}:${imageId}` suffix and ignores other images', () => {
    const task = makeTask({
      localSavedOutputImagePaths: {
        '0:img-1': 'D:\\images\\tab\\a.png',
        '1:img-2': 'D:\\images\\tab\\b.png',
      },
    })
    expect(findTaskSavedImagePath([task], 'img-2')).toEqual({ taskId: 'task-1', path: 'D:\\images\\tab\\b.png' })
    expect(findTaskSavedImagePath([task], 'img-3')).toBeNull()
  })

  it('picks the entry from the newest task when the same image appears in several tasks', () => {
    const older = makeTask({
      id: 'task-old',
      createdAt: 10,
      localSavedOutputImagePaths: { '0:img-1': 'D:\\old\\images\\a.png' },
    })
    const newer = makeTask({
      id: 'task-new',
      createdAt: 20,
      localSavedOutputImagePaths: { '3:img-1': 'D:\\new\\images\\a.png' },
    })
    expect(findTaskSavedImagePath([older, newer], 'img-1')).toEqual({
      taskId: 'task-new',
      path: 'D:\\new\\images\\a.png',
    })
  })

  it('skips empty paths and tasks without saved records', () => {
    const task = makeTask({
      localSavedOutputImagePaths: { '0:img-1': '', '1:img-2': 'D:\\images\\b.png' },
    })
    expect(findTaskSavedImagePath([task], 'img-1')).toBeNull()
    expect(findTaskSavedImagePath([makeTask({})], 'img-1')).toBeNull()
    expect(findTaskSavedImagePath([], 'img-1')).toBeNull()
  })

  it('returns null for an empty image id', () => {
    expect(findTaskSavedImagePath([makeTask({})], '')).toBeNull()
  })
})

describe('resolveImageRevealPath', () => {
  it('prefers the workspace-tree saved path over the cache original', () => {
    const task = makeTask({
      localSavedOutputImagePaths: { '0:img-1': 'D:\\AI生图2\\images\\分组\\标签页\\a.png' },
    })
    expect(resolveImageRevealPath('img-1', [task], { localPath: 'D:\\AI生图2\\cache-images\\a.png' })).toBe(
      'D:\\AI生图2\\images\\分组\\标签页\\a.png',
    )
  })

  it('falls back to the cache original when no saved record exists', () => {
    expect(resolveImageRevealPath('img-1', [], { localPath: 'D:\\AI生图2\\cache-images\\a.png' })).toBe(
      'D:\\AI生图2\\cache-images\\a.png',
    )
  })

  it('returns null when neither a saved record nor a local path exists', () => {
    expect(resolveImageRevealPath('img-1', [], null)).toBeNull()
  })
})
