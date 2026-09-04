import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  workers: [] as FakeWorker[],
  fork: vi.fn(),
}))

class FakeWorker extends EventEmitter {
  messages: unknown[] = []

  postMessage(message: unknown) {
    this.messages.push(message)
    if ((message as { type?: string })?.type === 'close') queueMicrotask(() => this.emit('exit', 0))
  }

  kill() {
    this.emit('exit', 0)
  }
}

vi.mock('electron', () => ({
  utilityProcess: {
    fork: mocks.fork,
  },
}))

import { CatalogClient } from './catalog-client'

beforeEach(() => {
  vi.useFakeTimers()
  mocks.workers.length = 0
  mocks.fork.mockReset()
  mocks.fork.mockImplementation(() => {
    const worker = new FakeWorker()
    mocks.workers.push(worker)
    return worker
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CatalogClient', () => {
  it('restarts the catalog worker after an unexpected exit', async () => {
    const client = new CatalogClient('D:/library/asset-kernel.sqlite')
    const first = mocks.workers[0]!
    first.emit('message', { type: 'ready' })
    const query = client.query({
      scope: 'all',
      query: '',
      filters: {},
      sortKey: 'updatedAt',
      sortOrder: 'desc',
    })
    await Promise.resolve()

    first.emit('exit', 1)
    await vi.advanceTimersByTimeAsync(500)

    expect(mocks.fork).toHaveBeenCalledTimes(2)
    expect(mocks.workers[1]?.messages[0]).toEqual({
      type: 'init',
      dbPath: 'D:/library/asset-kernel.sqlite',
    })

    const second = mocks.workers[1]!
    second.emit('message', { type: 'ready' })
    await Promise.resolve()
    const replay = second.messages.find((message) => (message as { method?: string }).method === 'query') as {
      id: number
    }
    second.emit('message', {
      id: replay.id,
      ok: true,
      result: { assets: [], totalCount: 0, nextCursor: null, counts: {} },
    })
    await expect(query).resolves.toMatchObject({ totalCount: 0 })
    await client.close()
  })

  it('does not restart after an intentional close', async () => {
    const client = new CatalogClient('D:/library/asset-kernel.sqlite')
    const worker = mocks.workers[0]!
    worker.emit('message', { type: 'ready' })

    await client.close()
    await vi.advanceTimersByTimeAsync(1000)

    expect(mocks.fork).toHaveBeenCalledTimes(1)
  })
})
