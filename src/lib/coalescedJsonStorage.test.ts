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
})
