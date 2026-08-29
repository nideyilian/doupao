import type { ApiTransportMode } from '../types'

const API_TRANSPORT_MODE_STORAGE_KEY = 'gpt-image-playground.api-transport-mode'
let runtimeTransportMode: ApiTransportMode | null = null

type ApiFetchRequest = {
  id: string
  url: string
  method: string
  headers: Array<[string, string]>
  body?: ArrayBuffer
  redirect: RequestRedirect
}

type ApiFetchResponse = {
  status: number
  statusText: string
  headers: Array<[string, string]>
}

type ApiFetchEvent =
  | { id: string; type: 'chunk'; data: Uint8Array | ArrayBuffer }
  | { id: string; type: 'done' }
  | { id: string; type: 'error'; error: string }

type ElectronApiTransport = {
  apiFetch?: (request: ApiFetchRequest, onEvent: (event: ApiFetchEvent) => void) => Promise<ApiFetchResponse>
  cancelApiFetch?: (id: string) => void
}

function getElectronApiTransport(): ElectronApiTransport | null {
  if (typeof window === 'undefined') return null
  return (window.electronAPI as ElectronApiTransport | undefined) ?? null
}

export function setApiTransportMode(mode: ApiTransportMode) {
  runtimeTransportMode = mode === 'renderer' ? 'renderer' : 'auto'
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(API_TRANSPORT_MODE_STORAGE_KEY, runtimeTransportMode)
  } catch {
    // Storage can be unavailable in privacy-restricted renderer sessions.
  }
}

export function getApiTransportMode(): ApiTransportMode {
  if (runtimeTransportMode) return runtimeTransportMode
  try {
    if (typeof window !== 'undefined' && window.localStorage.getItem(API_TRANSPORT_MODE_STORAGE_KEY) === 'renderer')
      return 'renderer'
  } catch {
    // Fall through to the stable automatic mode.
  }
  return 'auto'
}

function createRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function createAbortError(signal: AbortSignal) {
  if (signal.reason instanceof Error) return signal.reason
  return new DOMException('The operation was aborted.', 'AbortError')
}

function isAbsoluteHttpUrl(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Uses the Electron main-process Node fetch transport for absolute HTTP(S) API
 * requests. Browser and relative dev-proxy requests keep using native fetch.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const transport = getElectronApiTransport()
  if (getApiTransportMode() === 'renderer' || !transport?.apiFetch) return globalThis.fetch(input, init)

  const request = new Request(input, init)
  if (!isAbsoluteHttpUrl(request.url)) return globalThis.fetch(input, init)
  if (request.signal.aborted) throw createAbortError(request.signal)

  const id = createRequestId()
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer()

  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  let streamFinished = false
  let onAbort = () => {}
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
    },
    cancel() {
      transport.cancelApiFetch?.(id)
    },
  })

  const finishStream = (error?: Error) => {
    if (streamFinished) return
    streamFinished = true
    request.signal.removeEventListener('abort', onAbort)
    if (error) controller?.error(error)
    else controller?.close()
  }

  onAbort = () => {
    transport.cancelApiFetch?.(id)
    finishStream(createAbortError(request.signal))
  }
  request.signal.addEventListener('abort', onAbort, { once: true })

  try {
    const response = await transport.apiFetch(
      {
        id,
        url: request.url,
        method: request.method,
        headers: Array.from(request.headers.entries()),
        body: body && body.byteLength > 0 ? body : undefined,
        redirect: request.redirect,
      },
      (event) => {
        if (event.id !== id || streamFinished) return
        if (event.type === 'chunk') {
          const chunk = event.data instanceof Uint8Array ? event.data : new Uint8Array(event.data)
          controller?.enqueue(chunk)
        } else if (event.type === 'done') {
          finishStream()
        } else {
          finishStream(new TypeError(event.error || 'Main-process API response stream failed'))
        }
      },
    )

    if (request.signal.aborted) throw createAbortError(request.signal)
    const responseHasNoBody = request.method === 'HEAD' || [204, 205, 304].includes(response.status)
    if (responseHasNoBody) finishStream()
    return new Response(responseHasNoBody ? null : stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  } catch (error) {
    finishStream(error instanceof Error ? error : new TypeError(String(error)))
    throw error
  }
}
