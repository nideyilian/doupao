import { describe, expect, it, vi } from 'vitest'
import { migrateLegacyImages } from './imageStorageMigration'

const legacy = { id: 'legacy-a', dataUrl: 'data:image/png;base64,YQ==' }

describe('migrateLegacyImages', () => {
  it('clears dataUrl only after the local file is saved', async () => {
    const writes: any[] = []
    let calls = 0
    await migrateLegacyImages({
      readBatch: async () => (calls++ === 0 ? [legacy] : []),
      saveImage: async () => '/cache/legacy-a.png',
      replaceImage: async (image) => {
        writes.push(image)
      },
      yieldToEventLoop: async () => {},
    })
    expect(writes).toEqual([{ ...legacy, localPath: '/cache/legacy-a.png', dataUrl: undefined }])
  })

  it('skips a failed image, preserves its data, and continues migrating later images', async () => {
    const replaceImage = vi.fn()
    const later = { id: 'legacy-b', dataUrl: 'data:image/png;base64,Yg==' }
    const remaining = new Map([
      [legacy.id, legacy],
      [later.id, later],
    ])
    const failures: string[] = []
    const migrated = await migrateLegacyImages({
      readBatch: async (limit) => [...remaining.values()].slice(0, limit),
      saveImage: async (image) => (image.id === legacy.id ? null : `/cache/${image.id}.png`),
      replaceImage: async (image) => {
        remaining.delete(image.id)
        replaceImage(image)
      },
      onFailure: (image) => failures.push(image.id),
      yieldToEventLoop: async () => {},
    })

    expect(migrated).toBe(1)
    expect(failures).toEqual(['legacy-a'])
    expect(remaining.get('legacy-a')).toEqual(legacy)
    expect(replaceImage).toHaveBeenCalledWith({
      ...later,
      localPath: '/cache/legacy-b.png',
      dataUrl: undefined,
    })
  })
})
