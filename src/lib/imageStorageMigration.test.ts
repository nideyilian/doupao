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

  it('preserves IndexedDB data when the local write fails', async () => {
    const replaceImage = vi.fn()
    let calls = 0
    // readBatch 只返回一批数据：保存失败应跳过该图并正常结束（不再重复读取形成死循环）
    const migrated = await migrateLegacyImages({
      readBatch: async () => (calls++ === 0 ? [legacy] : []),
      saveImage: async () => null,
      replaceImage,
    })
    expect(migrated).toBe(0)
    expect(replaceImage).not.toHaveBeenCalled()
  })
})
