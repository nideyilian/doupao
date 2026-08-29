import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOpenAIProfile } from './apiProfiles'
import { fetchAvailableModels, inferModelType } from './modelCatalog'

describe('inferModelType', () => {
  it('labels common image, multimodal, text, and unknown models', () => {
    expect(inferModelType('gpt-image-2')).toBe('image')
    expect(inferModelType('gpt-4o')).toBe('multimodal')
    expect(inferModelType('gpt-5.5')).toBe('multimodal')
    expect(inferModelType('text-embedding-3-large')).toBe('text')
    expect(inferModelType('vendor-custom-model')).toBe('unknown')
  })
})

describe('fetchAvailableModels', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches OpenAI-compatible models and annotates their inferred type', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: 'gpt-image-2' }, { id: 'gpt-5.5' }, { id: 'vendor-custom-model' }, { id: '' }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
    const profile = createDefaultOpenAIProfile({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
      apiProxy: false,
    })

    const models = await fetchAvailableModels(profile)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
        cache: 'no-store',
      }),
    )
    expect(models).toEqual([
      { id: 'gpt-image-2', type: 'image' },
      { id: 'gpt-5.5', type: 'multimodal' },
      { id: 'vendor-custom-model', type: 'unknown' },
    ])
  })
})
