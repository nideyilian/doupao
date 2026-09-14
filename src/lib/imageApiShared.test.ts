import { afterEach, describe, expect, it, vi } from 'vitest'
import { getApiErrorMessage, retryTransientRequest } from './imageApiShared'

describe('retryTransientRequest', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries transient failures with exponential backoff', async () => {
    vi.useFakeTimers()
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error('HTTP 503'))
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValue('ok')

    const result = retryTransientRequest(handler, { maxRetries: 3 })
    await vi.runAllTimersAsync()

    await expect(result).resolves.toBe('ok')
    expect(handler).toHaveBeenCalledTimes(3)
  })

  it('does not retry a non-transient failure', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('invalid request'))

    await expect(retryTransientRequest(handler, { maxRetries: 3 })).rejects.toThrow('invalid request')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('preserves the HTTP status when the API returns a JSON error message', async () => {
    const message = await getApiErrorMessage(
      new Response(
        JSON.stringify({
          error: { message: 'upstream overloaded' },
        }),
        { status: 503 },
      ),
    )

    expect(message).toBe('HTTP 503: upstream overloaded')
  })

  it('returns a concise message for gateway request-size failures', async () => {
    const message = await getApiErrorMessage(
      new Response('<html><body><h1>413 Request Entity Too Large</h1></body></html>', { status: 413 }),
    )

    expect(message).toBe('HTTP 413：请求体过大，请减少参考图数量或图片尺寸后重试')
  })
})
