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

  it('fails promptly and preserves IndexedDB data when the local write fails', async () => {
    const replaceImage = vi.fn()
    await expect(
      migrateLegacyImages({
        readBatch: async () => [legacy],
        saveImage: async () => null,
        replaceImage,
      }),
    ).rejects.toThrow('legacy-a')
    expect(replaceImage).not.toHaveBeenCalled()
  })
})
