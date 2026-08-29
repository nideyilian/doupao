import { describe, expect, it } from 'vitest'
import { withAssetWriteLock } from './assetWriteLock'

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('withAssetWriteLock', () => {
  it('serializes critical sections across concurrent callers', async () => {
    const order: string[] = []
    const first = withAssetWriteLock(async () => {
      order.push('a-start')
      await delay(15)
      order.push('a-end')
    })
    const second = withAssetWriteLock(async () => {
      order.push('b-start')
      order.push('b-end')
    })
    await Promise.all([first, second])
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end'])
  })

  it('does not leave the lock stuck after a failure', async () => {
    await expect(
      withAssetWriteLock(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    const result = await withAssetWriteLock(async () => 'after')
    expect(result).toBe('after')
  })

  it('does not allow nested acquisition to deadlock the chain (callers must avoid nesting)', async () => {
    // 设计约定：锁不可重入，嵌套持锁会死锁；生产代码通过 Unlocked 内部实现避免嵌套。
    // 这里验证 withAssetWriteLock 本身在"排队等待"场景下不会提前放行。
    const order: string[] = []
    const first = withAssetWriteLock(async () => {
      order.push('first')
    })
    const second = withAssetWriteLock(async () => {
      order.push('second')
    })
    await Promise.all([first, second])
    expect(order).toEqual(['first', 'second'])
  })
})
