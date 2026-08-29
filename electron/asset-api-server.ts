import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createReadStream } from 'node:fs'
import type { AssetCatalogCursorPage, AssetCatalogQuery, AssetCollection, AssetTag, GeneratedAsset } from '../src/types'
import type { CatalogAssetDetails } from './asset-catalog'

export type ExternalAssetCommandAction =
  | 'useAsReference'
  | 'openInPostprocess'
  | 'openInComposite'
  | 'reuseGenerationConfig'
  | 'exportAsset'
  | 'createCollection'
  | 'importExternalFiles'

export type ExternalAssetCommand = {
  action: ExternalAssetCommandAction
  assetId?: string
  name?: string
  parentId?: string | null
  color?: string | null
  paths?: string[]
}

interface AssetApiCatalog {
  query(input: AssetCatalogQuery): Promise<AssetCatalogCursorPage>
  getAsset(assetId: string): Promise<CatalogAssetDetails | null>
  recommend(input: {
    query?: string
    context?: string
    similarToAssetId?: string
    limit?: number
  }): Promise<Array<{ asset: GeneratedAsset; score: number }>>
  getAllCollections(): Promise<AssetCollection[]>
  getAllTags(): Promise<AssetTag[]>
}

export interface AssetApiServerOptions {
  token: string
  catalog: AssetApiCatalog
  runCommand: (command: ExternalAssetCommand) => Promise<unknown>
}

const ALLOWED_COMMANDS = new Set<ExternalAssetCommandAction>([
  'useAsReference',
  'openInPostprocess',
  'openInComposite',
  'reuseGenerationConfig',
  'exportAsset',
  'createCollection',
  'importExternalFiles',
])

/** 命令有效性：素材类命令需要 assetId；创建类命令需要 name；导入需要 paths。 */
function validCommand(raw: Partial<ExternalAssetCommand>): raw is ExternalAssetCommand {
  if (!raw.action || !ALLOWED_COMMANDS.has(raw.action)) return false
  switch (raw.action) {
    case 'createCollection':
      return typeof raw.name === 'string' && raw.name.trim().length > 0
    case 'importExternalFiles':
      return Array.isArray(raw.paths) && raw.paths.length > 0
    default:
      return typeof raw.assetId === 'string' && raw.assetId.length > 0
  }
}

function json(response: ServerResponse, status: number, body: unknown) {
  const value = JSON.stringify(body)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(value),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(value)
}

function parseScope(value: string | null): AssetCatalogQuery['scope'] {
  if (value?.startsWith('collection:')) return { kind: 'collection', id: value.slice(11) }
  if (value?.startsWith('tag:')) return { kind: 'tag', id: value.slice(4) }
  return value === 'recent' || value === 'favorites' || value === 'unorganized' || value === 'trash' ? value : 'all'
}

function publicAssetDetails(details: CatalogAssetDetails) {
  return {
    asset: details.asset,
    blob: { ...details.blob, localPath: undefined },
    version: details.version,
    uri: `doupao://assets/${encodeURIComponent(details.asset.id)}`,
    contentUrl: `/v1/assets/${encodeURIComponent(details.asset.id)}/content`,
  }
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += buffer.length
    if (length > 64 * 1024) throw new Error('request body too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

export class AssetApiServer {
  private server: Server | null = null
  private readonly events = new EventEmitter()

  constructor(private readonly options: AssetApiServerOptions) {}

  start(port = 32191): Promise<{ host: '127.0.0.1'; port: number }> {
    if (this.server) {
      const address = this.server.address()
      return Promise.resolve({ host: '127.0.0.1', port: typeof address === 'object' && address ? address.port : port })
    }
    this.server = createServer((request, response) => void this.handle(request, response))
    return new Promise((resolve, reject) => {
      const server = this.server!
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject)
        const address = server.address()
        resolve({ host: '127.0.0.1', port: typeof address === 'object' && address ? address.port : port })
      })
    })
  }

  stop(): Promise<void> {
    const server = this.server
    this.server = null
    if (!server) return Promise.resolve()
    return new Promise((resolve) => server.close(() => resolve()))
  }

  publish(type: 'asset.created' | 'asset.derived' | 'asset.updated', payload: unknown) {
    this.events.emit('asset-event', { type, occurredAt: Date.now(), payload })
  }

  private authorized(request: IncomingMessage): boolean {
    const origin = request.headers.origin
    if (origin) {
      try {
        const url = new URL(origin)
        if (!(url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.protocol === 'file:')) return false
      } catch {
        return false
      }
    }
    const authorization = request.headers.authorization ?? ''
    return authorization.startsWith('Bearer ') && safeEqual(authorization.slice(7), this.options.token)
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    try {
      if (!this.authorized(request)) {
        response.setHeader('WWW-Authenticate', 'Bearer')
        json(response, 401, { error: 'unauthorized' })
        return
      }
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (request.method === 'GET' && url.pathname === '/v1/assets') {
        const limit = Number(url.searchParams.get('limit') ?? 100)
        json(
          response,
          200,
          await this.options.catalog.query({
            scope: parseScope(url.searchParams.get('scope')),
            query: url.searchParams.get('query') ?? '',
            filters: {},
            sortKey: 'updatedAt',
            sortOrder: 'desc',
            cursor: url.searchParams.get('cursor'),
            limit: Number.isFinite(limit) ? limit : 100,
          }),
        )
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/recommendations') {
        json(response, 200, {
          items: await this.options.catalog.recommend({
            query: url.searchParams.get('query') ?? undefined,
            context: url.searchParams.get('context') ?? undefined,
            similarToAssetId: url.searchParams.get('similarTo') ?? undefined,
            limit: Number(url.searchParams.get('limit') ?? 12),
          }),
        })
        return
      }
      const contentMatch = request.method === 'GET' ? url.pathname.match(/^\/v1\/assets\/([^/]+)\/content$/) : null
      if (contentMatch) {
        const details = await this.options.catalog.getAsset(decodeURIComponent(contentMatch[1]))
        if (!details?.blob.localPath) {
          json(response, 404, { error: 'asset_content_unavailable' })
          return
        }
        response.writeHead(200, {
          'Content-Type': details.blob.mimeType ?? 'application/octet-stream',
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        })
        createReadStream(details.blob.localPath)
          .on('error', () => response.destroy())
          .pipe(response)
        return
      }
      const assetMatch = request.method === 'GET' ? url.pathname.match(/^\/v1\/assets\/([^/]+)$/) : null
      if (assetMatch) {
        const details = await this.options.catalog.getAsset(decodeURIComponent(assetMatch[1]))
        json(response, details ? 200 : 404, details ? publicAssetDetails(details) : { error: 'asset_not_found' })
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/commands') {
        const raw = (await readJsonBody(request)) as Partial<ExternalAssetCommand>
        if (!validCommand(raw)) {
          json(response, 400, { error: 'invalid_command' })
          return
        }
        json(response, 200, await this.options.runCommand(raw))
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/collections') {
        json(response, 200, { collections: await this.options.catalog.getAllCollections() })
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/collections') {
        const raw = (await readJsonBody(request)) as { name?: unknown; parentId?: unknown }
        if (typeof raw.name !== 'string' || !raw.name.trim()) {
          json(response, 400, { error: 'invalid_collection' })
          return
        }
        json(
          response,
          200,
          await this.options.runCommand({
            action: 'createCollection',
            name: raw.name.trim(),
            parentId: typeof raw.parentId === 'string' && raw.parentId ? raw.parentId : null,
          }),
        )
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/tags') {
        json(response, 200, { tags: await this.options.catalog.getAllTags() })
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/imports') {
        const raw = (await readJsonBody(request)) as { paths?: unknown }
        if (!Array.isArray(raw.paths) || !raw.paths.every((p) => typeof p === 'string')) {
          json(response, 400, { error: 'invalid_import' })
          return
        }
        json(
          response,
          200,
          await this.options.runCommand({ action: 'importExternalFiles', paths: raw.paths as string[] }),
        )
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/events') {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        })
        response.write(': connected\n\n')
        const listener = (event: unknown) => response.write(`data: ${JSON.stringify(event)}\n\n`)
        this.events.on('asset-event', listener)
        request.once('close', () => this.events.off('asset-event', listener))
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/openapi.json') {
        json(response, 200, {
          openapi: '3.1.0',
          info: { title: 'DOUPAO Asset API', version: '1.0.0' },
          servers: [{ url: '/v1' }],
          paths: {
            '/assets': { get: { summary: 'Search assets' } },
            '/assets/{id}': { get: { summary: 'Get an asset and its current rendition' } },
            '/assets/{id}/tags': { put: { summary: 'Replace the tag set of an asset' } },
            '/recommendations': { get: { summary: 'Get context-aware asset recommendations' } },
            '/collections': { get: { summary: 'List collections' }, post: { summary: 'Create a collection' } },
            '/tags': { get: { summary: 'List tags' }, post: { summary: 'Create a tag' } },
            '/imports': { post: { summary: 'Import external image files by path' } },
            '/commands': { post: { summary: 'Run an allowlisted asset command' } },
            '/events': { get: { summary: 'Subscribe to asset events using SSE' } },
          },
        })
        return
      }
      json(response, 404, { error: 'not_found' })
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}
