import { ipcMain, net, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { assertTrustedSender } from './ipc-guard'

type ApiFetchRequest = {
  id: string
  url: string
  method: string
  headers: Array<[string, string]>
  body?: ArrayBuffer | Uint8Array
  redirect?: 'follow' | 'error' | 'manual'
}

type ApiFetchEvent =
  | { id: string; type: 'chunk'; data: Uint8Array }
  | { id: string; type: 'done' }
  | { id: string; type: 'error'; error: string }

const activeRequests = new Map<string, AbortController>()
const hookedSenders = new WeakSet<WebContents>()

function requestKey(senderId: number, requestId: string) {
  return `${senderId}:${requestId}`
}

function assertString(value: unknown, field: string, maxLength: number) {
  if (typeof value !== 'string' || !value || value.length > maxLength) {
    throw new Error(`Invalid API fetch ${field}`)
  }
  return value
}

export function parseApiFetchRequest(value: unknown): ApiFetchRequest {
  if (!value || typeof value !== 'object') throw new Error('Invalid API fetch request')
  const input = value as Record<string, unknown>
  const id = assertString(input.id, 'id', 128)
  const url = assertString(input.url, 'URL', 16_384)
  const parsedUrl = new URL(url)
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('API fetch only supports HTTP(S) URLs')
  }

  const method = assertString(input.method, 'method', 16).toUpperCase()
  if (!/^[A-Z]+$/.test(method)) throw new Error('Invalid API fetch method')
  if (!Array.isArray(input.headers) || input.headers.length > 256) throw new Error('Invalid API fetch headers')
  const headers = input.headers.map((header) => {
    if (
      !Array.isArray(header) ||
      header.length !== 2 ||
      typeof header[0] !== 'string' ||
      typeof header[1] !== 'string'
    ) {
      throw new Error('Invalid API fetch header')
    }
    return [header[0], header[1]] as [string, string]
  })

  const body = input.body
  if (body !== undefined && !(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body)) {
    throw new Error('Invalid API fetch body')
  }
  const redirect = input.redirect
  if (redirect !== undefined && redirect !== 'follow' && redirect !== 'error' && redirect !== 'manual') {
    throw new Error('Invalid API fetch redirect mode')
  }
  return {
    id,
    url: parsedUrl.toString(),
    method,
    headers,
    body: body as ArrayBuffer | Uint8Array | undefined,
    redirect,
  }
}

function sendEvent(sender: WebContents, event: ApiFetchEvent) {
  if (!sender.isDestroyed()) sender.send('api:fetch:event', event)
}

function attachSenderCleanup(sender: WebContents) {
  if (hookedSenders.has(sender)) return
  hookedSenders.add(sender)
  sender.once('destroyed', () => {
    const prefix = `${sender.id}:`
    for (const [key, controller] of activeRequests) {
      if (!key.startsWith(prefix)) continue
      controller.abort()
      activeRequests.delete(key)
    }
  })
}

async function handleApiFetch(event: IpcMainInvokeEvent, rawRequest: unknown) {
  assertTrustedSender(event)
  const request = parseApiFetchRequest(rawRequest)
  const key = requestKey(event.sender.id, request.id)
  if (activeRequests.has(key)) throw new Error('Duplicate API fetch request id')

  const controller = new AbortController()
  activeRequests.set(key, controller)
  attachSenderCleanup(event.sender)

  let response: Response
  try {
    const requestBody = request.body instanceof ArrayBuffer ? new Uint8Array(request.body) : request.body
    // 使用 Chromium 网络栈（net.fetch）而非 Node/undici：undici 默认 300 秒无响应即断开，
    // 且对慢速长请求的过期 keep-alive 连接不会自动重连；net.fetch 与浏览器开发版行为一致，
    // 长请求与并发连接更稳健。
    response = await net.fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: requestBody === undefined ? undefined : Buffer.from(requestBody),
      redirect: request.redirect ?? 'follow',
      signal: controller.signal,
    })
  } catch (error) {
    activeRequests.delete(key)
    throw error
  }

  void (async () => {
    try {
      if (!response.body) {
        sendEvent(event.sender, { id: request.id, type: 'done' })
        return
      }
      const reader = response.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value.byteLength > 0) sendEvent(event.sender, { id: request.id, type: 'chunk', data: value })
      }
      sendEvent(event.sender, { id: request.id, type: 'done' })
    } catch (error) {
      sendEvent(event.sender, {
        id: request.id,
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      activeRequests.delete(key)
    }
  })()

  return {
    status: response.status,
    statusText: response.statusText,
    headers: Array.from(response.headers.entries()),
  }
}

function handleApiFetchAbort(event: IpcMainEvent, requestId: unknown) {
  assertTrustedSender(event)
  if (typeof requestId !== 'string') return
  const key = requestKey(event.sender.id, requestId)
  activeRequests.get(key)?.abort()
  activeRequests.delete(key)
}

export function registerApiTransport() {
  ipcMain.handle('api:fetch', handleApiFetch)
  ipcMain.on('api:fetch:abort', handleApiFetchAbort)
}
