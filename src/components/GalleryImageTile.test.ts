import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { buildGalleryImageItems } from './GalleryImageTile'

function task(id: string, outputImages: string[]): TaskRecord {
  return {
    id,
    prompt: `prompt-${id}`,
    params: { ...DEFAULT_PARAMS, n: outputImages.length },
    inputImageIds: [],
    outputImages,
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
  }
}

describe('buildGalleryImageItems', () => {
  it('exposes every output image while preserving task and image order', () => {
    const items = buildGalleryImageItems([task('newer', ['newer-a', 'newer-b']), task('older', ['older-a'])])

    expect(items.map((item) => [item.task.id, item.imageId, item.imageIndex])).toEqual([
      ['newer', 'newer-a', 0],
      ['newer', 'newer-b', 1],
      ['older', 'older-a', 0],
    ])
  })
})
