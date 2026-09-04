import { describe, expect, it, vi } from 'vitest'
import { createCoalescedJsonStorage } from './coalescedJsonStorage'

describe('createCoalescedJsonStorage', () => {
  it('coalesces pending writes and keeps only the latest content', async () => {
    const write = vi.fn(async () => true)
    const storage = createCoalescedJsonStorage({
      read: async () => null,
      write,
    })

    const first = storage.setItem('state', 'first')
    const second = storage.setItem('state', 'second')
    await storage.flush()
    await Promise.all([first, second])

    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith('second', { skipBackup: false })
  })

  it('does not write content that is already committed', async () => {
    const write = vi.fn(async () => true)
    const storage = createCoalescedJsonStorage({
      read: async () => null,
      write,
    })

    const first = storage.setItem('state', 'same')
    await storage.flush()
    await first
    await storage.setItem('state', 'same')

    expect(write).toHaveBeenCalledTimes(1)
  })

  it('marks removals to skip backup creation', async () => {
    const write = vi.fn(async () => true)
    const storage = createCoalescedJsonStorage({
      read: async () => null,
      write,
    })

    const removed = storage.removeItem('state')
    await storage.flush()
    await removed

    expect(write).toHaveBeenCalledWith('', { skipBackup: true })
  })

  it('keeps a failed write pending and retries the latest content', async () => {
    const onWriteError = vi.fn()
    const write = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce(true)
    const storage = createCoalescedJsonStorage(
      {
        read: async () => null,
        write,
      },
      { onWriteError },
    )

    const saved = storage.setItem('state', 'latest')
    await expect(storage.flush()).rejects.toThrow('disk full')
    expect(onWriteError).toHaveBeenCalledTimes(1)

    await storage.flush()
    await saved

    expect(write).toHaveBeenCalledTimes(2)
    expect(write).toHaveBeenLastCalledWith('latest', { skipBackup: false })
  })
})
