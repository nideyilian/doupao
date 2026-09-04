import { fal } from '@fal-ai/client'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultFalProfile, DEFAULT_FAL_BASE_URL, DEFAULT_SETTINGS } from './apiProfiles'
import { callFalAiImageApi } from './falAiImageApi'

vi.mock('@fal-ai/client', () => ({
  fal: {
    config: vi.fn(),
    queue: {
      submit: vi.fn(),
      subscribeToStatus: vi.fn(),
      result: vi.fn(),
    },
  },
}))

const falMock = fal as unknown as {
  config: Mock
  queue: {
    submit: Mock
    subscribeToStatus: Mock
    result: Mock
  }
}

describe('callFalAiImageApi', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('uses the default fal endpoint without proxyUrl', async () => {
    falMock.queue.submit.mockResolvedValue({ request_id: 'req-1' })
    falMock.queue.result.mockResolvedValue({
      data: { images: [{ b64_json: 'aW1hZ2U=' }] },
    })

    await callFalAiImageApi(
      {
        settings: DEFAULT_SETTINGS,
        prompt: 'prompt',
        params: { ...DEFAULT_PARAMS },
        inputImageDataUrls: [],
      },
      createDefaultFalProfile({ apiKey: 'fal-key', baseUrl: DEFAULT_FAL_BASE_URL }),
    )

    expect(falMock.config).toHaveBeenCalledWith({
      credentials: 'fal-key',
      suppressLocalCredentialsWarning: true,
      fetch: expect.any(Function),
    })
  })

  it('passes custom fal API URL to the SDK proxyUrl option', async () => {
    falMock.queue.submit.mockResolvedValue({ request_id: 'req-1' })
    falMock.queue.result.mockResolvedValue({
      data: { images: [{ b64_json: 'aW1hZ2U=' }] },
    })

    await callFalAiImageApi(
      {
        settings: DEFAULT_SETTINGS,
        prompt: 'prompt',
        params: { ...DEFAULT_PARAMS },
        inputImageDataUrls: [],
      },
      createDefaultFalProfile({
        apiKey: 'fal-key',
        baseUrl: 'https://fal-proxy.example.com/api/fal/',
      }),
    )

    expect(falMock.config).toHaveBeenCalledWith({
      credentials: 'fal-key',
      suppressLocalCredentialsWarning: true,
      fetch: expect.any(Function),
      proxyUrl: 'https://fal-proxy.example.com/api/fal',
    })
  })

  it('waits for the remote request id checkpoint before polling', async () => {
    const order: string[] = []
    falMock.queue.submit.mockResolvedValue({ request_id: 'req-checkpoint' })
    falMock.queue.subscribeToStatus.mockImplementation(async () => {
      order.push('poll')
    })
    falMock.queue.result.mockResolvedValue({ data: { images: [{ b64_json: 'aW1hZ2U=' }] } })

    await callFalAiImageApi(
      {
        settings: DEFAULT_SETTINGS,
        prompt: 'prompt',
        params: { ...DEFAULT_PARAMS },
        inputImageDataUrls: [],
        onFalRequestEnqueued: async () => {
          await Promise.resolve()
          order.push('persist')
        },
      },
      createDefaultFalProfile({ apiKey: 'fal-key' }),
    )

    expect(order).toEqual(['persist', 'poll'])
  })

  it('keeps the returned image dimensions separate from the relay request size', async () => {
    falMock.queue.submit.mockResolvedValue({ request_id: 'req-size' })
    falMock.queue.result.mockResolvedValue({
      data: {
        images: [
          {
            b64_json: 'aW1hZ2U=',
            width: 1024,
            height: 1536,
          },
        ],
      },
    })

    const result = await callFalAiImageApi(
      {
        settings: DEFAULT_SETTINGS,
        prompt: 'prompt',
        params: { ...DEFAULT_PARAMS, size: '720x1280' },
        inputImageDataUrls: [],
      },
      createDefaultFalProfile({ apiKey: 'fal-key' }),
    )

    expect(falMock.queue.submit).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        input: expect.objectContaining({
          image_size: { width: 720, height: 1280 },
        }),
      }),
    )
    expect(result.actualParams?.size).toBe('1024x1536')
    expect(result.actualParamsList?.[0]?.size).toBe('1024x1536')
  })
})
