import { ipcMain, net } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  net: {
    fetch: vi.fn(),
  },
}))

import { parseApiFetchRequest, registerApiTransport } from './api-transport'

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('main-process API transport request validation', () => {
  it('accepts normalized HTTP requests with binary bodies', () => {
    const body = new TextEncoder().encode('{"ok":true}').buffer
    expect(
      parseApiFetchRequest({
        id: 'request-1',
        url: 'https://api.example.com/v1/responses',
        method: 'post',
        headers: [['authorization', 'Bearer secret']],
        body,
        redirect: 'follow',
      }),
    ).toEqual({
      id: 'request-1',
      url: 'https://api.example.com/v1/responses',
      method: 'POST',
      headers: [['authorization', 'Bearer secret']],
      body,
      redirect: 'follow',
    })
  })

  it('rejects non-HTTP protocols and malformed headers', () => {
    expect(() =>
      parseApiFetchRequest({
        id: 'request-1',
        url: 'file:///C:/secret.txt',
        method: 'GET',
        headers: [],
      }),
    ).toThrow('HTTP(S)')
    expect(() =>
      parseApiFetchRequest({
        id: 'request-1',
        url: 'https://api.example.com',
        method: 'GET',
        headers: [['authorization']],
      }),
    ).toThrow('header')
  })

  it('streams main-process fetch response chunks back to the requesting renderer', async () => {
    registerApiTransport()
    const handleMock = vi.mocked(ipcMain.handle)
    const handler = handleMock.mock.calls.find(([channel]) => channel === 'api:fetch')?.[1]
    expect(handler).toBeTypeOf('function')
    vi.mocked(net.fetch).mockResolvedValue(
      new Response('main-process-body', {
        status: 201,
        headers: { 'content-type': 'text/plain' },
      }),
    )
    const mainFrame = {
      url: 'file:///app/index.html',
    }
    const sender = {
      id: 7,
      isDestroyed: () => false,
      send: vi.fn(),
      once: vi.fn(),
      mainFrame,
    }

    const metadata = (await handler!({ sender, senderFrame: mainFrame } as never, {
      id: 'request-stream',
      url: 'https://api.example.com/v1/images',
      method: 'POST',
      headers: [['content-type', 'application/json']],
      body: new TextEncoder().encode('{}').buffer,
    })) as { status: number }

    expect(metadata.status).toBe(201)
    await vi.waitFor(() =>
      expect(sender.send).toHaveBeenCalledWith('api:fetch:event', { id: 'request-stream', type: 'done' }),
    )
    const chunkEvent = sender.send.mock.calls.find(([, event]) => event.type === 'chunk')?.[1]
    expect(new TextDecoder().decode(chunkEvent.data)).toBe('main-process-body')
  })
})
