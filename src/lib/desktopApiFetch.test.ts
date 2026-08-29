// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, setApiTransportMode } from './desktopApiFetch'

const originalElectronAPI = window.electronAPI

afterEach(() => {
  setApiTransportMode('auto')
  window.electronAPI = originalElectronAPI
  vi.restoreAllMocks()
})

describe('apiFetch', () => {
  it('uses browser fetch when renderer transport is selected explicitly', async () => {
    const apiFetchMock = vi.fn()
    window.electronAPI = {
      ...(originalElectronAPI ?? ({} as NonNullable<typeof window.electronAPI>)),
      apiFetch: apiFetchMock,
      cancelApiFetch: vi.fn(),
      isElectron: true,
    } as NonNullable<typeof window.electronAPI>
    const expected = new Response('renderer')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(expected)
    setApiTransportMode('renderer')

    await expect(apiFetch('https://api.example.com/models')).resolves.toBe(expected)
    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(apiFetchMock).not.toHaveBeenCalled()
  })

  it('falls back to browser fetch when the Electron transport is unavailable', async () => {
    window.electronAPI = undefined
    const expected = new Response('browser')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(expected)

    await expect(apiFetch('https://api.example.com/models')).resolves.toBe(expected)
    expect(fetchSpy).toHaveBeenCalledOnce()
  })

  it('reconstructs a streaming Response from main-process chunks', async () => {
    const apiFetchMock = vi.fn(async (_request, onEvent) => {
      queueMicrotask(() => {
        onEvent({ id: _request.id, type: 'chunk', data: new TextEncoder().encode('hello ') })
        onEvent({ id: _request.id, type: 'chunk', data: new TextEncoder().encode('world') })
        onEvent({ id: _request.id, type: 'done' })
      })
      return {
        status: 200,
        statusText: 'OK',
        headers: [['content-type', 'text/event-stream']] as Array<[string, string]>,
      }
    })
    window.electronAPI = {
      ...(originalElectronAPI ?? ({} as NonNullable<typeof window.electronAPI>)),
      apiFetch: apiFetchMock,
      cancelApiFetch: vi.fn(),
      isElectron: true,
    } as NonNullable<typeof window.electronAPI>

    const response = await apiFetch('https://api.example.com/responses', {
      method: 'POST',
      headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
      body: JSON.stringify({ stream: true }),
    })

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('hello world')
    expect(apiFetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.example.com/responses',
        method: 'POST',
        headers: expect.arrayContaining([['authorization', 'Bearer secret']]),
        body: expect.any(ArrayBuffer),
      }),
      expect.any(Function),
    )
  })

  it('cancels the main-process request when the AbortSignal fires', async () => {
    let emit: ((event: { id: string; type: 'done' }) => void) | undefined
    const apiFetchMock = vi.fn(async (request, onEvent) => {
      emit = onEvent
      return { status: 200, statusText: 'OK', headers: [] }
    })
    const cancelApiFetch = vi.fn()
    window.electronAPI = {
      ...(originalElectronAPI ?? ({} as NonNullable<typeof window.electronAPI>)),
      apiFetch: apiFetchMock,
      cancelApiFetch,
      isElectron: true,
    } as NonNullable<typeof window.electronAPI>
    const abortController = new AbortController()

    const response = await apiFetch('https://api.example.com/responses', { signal: abortController.signal })
    abortController.abort()

    await expect(response.text()).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancelApiFetch).toHaveBeenCalledOnce()
    expect(emit).toBeTypeOf('function')
  })
})
