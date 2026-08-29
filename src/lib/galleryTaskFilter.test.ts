import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { filterGalleryTasks } from './galleryTaskFilter'

function task(id: string, createdAt: number, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id,
    prompt: `prompt-${id}`,
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    outputImages: [],
    status: 'done',
    error: null,
    createdAt,
    finishedAt: createdAt + 1,
    elapsed: 1,
    ...overrides,
  }
}

describe('filterGalleryTasks', () => {
  it('keeps navigator order and filters identical to the gallery', () => {
    const result = filterGalleryTasks({
      tasks: [
        task('older', 1),
        task('partial-error', 3, { batchItemStatuses: ['done', 'error'] }),
        task('favorite', 2, { isFavorite: true }),
      ],
      query: '',
      filterStatus: 'error',
      filterFavorite: false,
      activeFavoriteCollectionId: null,
    })

    expect(result.map((item) => item.id)).toEqual(['partial-error'])
  })
})
