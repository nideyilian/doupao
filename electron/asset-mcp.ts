import { copyFile, readFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { createInterface } from 'node:readline'
import path from 'node:path'
import type { AssetCatalogQuery } from '../src/types'
import { AssetCatalog, type CatalogAssetDetails } from './asset-catalog'
import type { ExternalAssetCommand } from './asset-api-server'

type JsonRpcRequest = { jsonrpc: '2.0'; id?: string | number; method: string; params?: Record<string, unknown> }
type JsonRpcResponse = {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string }
}

interface McpCatalog {
  query(input: AssetCatalogQuery): unknown
  getAsset(assetId: string): CatalogAssetDetails | null
  recommend(input: { query?: string; context?: string; similarToAssetId?: string; limit?: number }): unknown
}

interface McpDependencies {
  catalog: McpCatalog
  runCommand: (command: ExternalAssetCommand) => Promise<unknown>
  exportAsset: (assetId: string, destinationPath: string) => Promise<unknown>
}

const tools = [
  {
    name: 'search_assets',
    title: 'Search DOUPAO assets',
    description: 'Search the local DOUPAO asset catalog using FTS5 and cursor pagination.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        cursor: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_asset',
    title: 'Get a DOUPAO asset',
    description: 'Read logical asset, current rendition and blob metadata by stable asset id.',
    inputSchema: {
      type: 'object',
      properties: { assetId: { type: 'string' } },
      required: ['assetId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'recommend_assets',
    title: 'Recommend DOUPAO assets',
    description: 'Find semantic, visual or contextually reusable local assets.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        context: { type: 'string' },
        similarToAssetId: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'run_asset_command',
    title: 'Use a DOUPAO asset',
    description:
      'Run an allowlisted command in the active DOUPAO window: asset actions (useAsReference, openInPostprocess, ' +
      'openInComposite, reuseGenerationConfig, exportAsset), organization (createCollection) ' +
      'or import external image files by local path (importExternalFiles).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'useAsReference',
            'openInPostprocess',
            'openInComposite',
            'reuseGenerationConfig',
            'exportAsset',
            'createCollection',
            'importExternalFiles',
          ],
        },
        assetId: { type: 'string' },
        name: { type: 'string' },
        parentId: { type: ['string', 'null'] },
        color: { type: ['string', 'null'] },
        paths: { type: 'array', items: { type: 'string' } },
      },
      required: ['action'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'export_asset',
    title: 'Export a DOUPAO asset',
    description: 'Copy the current rendition to a new destination without overwriting an existing file.',
    inputSchema: {
      type: 'object',
      properties: { assetId: { type: 'string' }, destinationPath: { type: 'string' } },
      required: ['assetId', 'destinationPath'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
]

function result(id: JsonRpcRequest['id'], value: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, result: value }
}

function failure(id: JsonRpcRequest['id'], code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

function textToolResult(value: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value }
}

function publicDetails(details: CatalogAssetDetails | null) {
  if (!details) return details
  return {
    ...details,
    blob: details.blob ? { ...details.blob, localPath: undefined } : undefined,
    uri: details.asset?.id ? `doupao://assets/${encodeURIComponent(details.asset.id)}` : undefined,
  }
}

export function createMcpRequestHandler(deps: McpDependencies) {
  return async (request: JsonRpcRequest): Promise<JsonRpcResponse> => {
    try {
      if (request.method === 'initialize')
        return result(request.id, {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'doupao-assets', version: '1.0.0' },
        })
      if (request.method === 'notifications/initialized') return result(request.id, {})
      if (request.method === 'ping') return result(request.id, {})
      if (request.method === 'tools/list') return result(request.id, { tools })
      if (request.method === 'resources/list') return result(request.id, { resources: [] })
      if (request.method === 'resources/templates/list')
        return result(request.id, {
          resourceTemplates: [
            {
              uriTemplate: 'doupao://assets/{id}',
              name: 'doupao_asset',
              title: 'DOUPAO Asset',
              description: 'Logical asset metadata and its current rendition.',
              mimeType: 'application/json',
            },
          ],
        })
      if (request.method === 'resources/read') {
        const uri = String(request.params?.uri ?? '')
        const parsed = new URL(uri)
        if (parsed.protocol !== 'doupao:' || parsed.hostname !== 'assets')
          return failure(request.id, -32602, 'invalid asset URI')
        const assetId = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
        const asset = deps.catalog.getAsset(assetId)
        if (!asset) return failure(request.id, -32002, 'asset not found')
        return result(request.id, {
          contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(publicDetails(asset)) }],
        })
      }
      if (request.method === 'tools/call') {
        const name = String(request.params?.name ?? '')
        const args = (request.params?.arguments ?? {}) as Record<string, unknown>
        if (name === 'search_assets')
          return result(
            request.id,
            textToolResult(
              deps.catalog.query({
                scope: 'all',
                query: String(args.query ?? ''),
                filters: {},
                sortKey: 'updatedAt',
                sortOrder: 'desc',
                cursor: typeof args.cursor === 'string' ? args.cursor : null,
                limit: Number(args.limit ?? 50),
              }),
            ),
          )
        if (name === 'get_asset')
          return result(request.id, textToolResult(publicDetails(deps.catalog.getAsset(String(args.assetId ?? '')))))
        if (name === 'recommend_assets')
          return result(
            request.id,
            textToolResult(
              deps.catalog.recommend({
                query: typeof args.query === 'string' ? args.query : undefined,
                context: typeof args.context === 'string' ? args.context : undefined,
                similarToAssetId: typeof args.similarToAssetId === 'string' ? args.similarToAssetId : undefined,
                limit: Number(args.limit ?? 12),
              }),
            ),
          )
        if (name === 'run_asset_command')
          return result(
            request.id,
            textToolResult(
              await deps.runCommand({
                action: String(args.action) as ExternalAssetCommand['action'],
                assetId: typeof args.assetId === 'string' ? args.assetId : undefined,
                name: typeof args.name === 'string' ? args.name : undefined,
                parentId: typeof args.parentId === 'string' ? args.parentId : null,
                color: typeof args.color === 'string' ? args.color : null,
                paths: Array.isArray(args.paths)
                  ? (args.paths.filter((p): p is string => typeof p === 'string') ?? [])
                  : undefined,
              }),
            ),
          )
        if (name === 'export_asset')
          return result(
            request.id,
            textToolResult(await deps.exportAsset(String(args.assetId ?? ''), String(args.destinationPath ?? ''))),
          )
        return failure(request.id, -32602, `unknown tool: ${name}`)
      }
      return failure(request.id, -32601, `method not found: ${request.method}`)
    } catch (error) {
      return failure(request.id, -32603, error instanceof Error ? error.message : String(error))
    }
  }
}

export async function runAssetMcpServer(databasePath: string, apiConfigPath: string) {
  const catalog = new AssetCatalog(databasePath)
  const runCommand = async (command: ExternalAssetCommand) => {
    const config = JSON.parse(await readFile(apiConfigPath, 'utf8')) as {
      enabled?: boolean
      port?: number
      token?: string
    }
    if (!config.enabled || !config.port || !config.token) throw new Error('DOUPAO local asset API is disabled')
    const response = await fetch(`http://127.0.0.1:${config.port}/v1/commands`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    })
    if (!response.ok) throw new Error(`asset command failed: ${response.status}`)
    return response.json()
  }
  const exportAsset = async (assetId: string, destinationPath: string) => {
    const sourcePath = catalog.getAsset(assetId)?.blob.localPath
    if (!sourcePath) throw new Error('asset content unavailable')
    const resolved = path.resolve(destinationPath)
    await copyFile(sourcePath, resolved, fsConstants.COPYFILE_EXCL)
    return { success: true, path: resolved }
  }
  const handle = createMcpRequestHandler({ catalog, runCommand, exportAsset })
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  lines.on('line', (line) => {
    void Promise.resolve()
      .then(async () => {
        const request = JSON.parse(line) as JsonRpcRequest
        if (request.id === undefined && request.method === 'notifications/initialized') return
        process.stdout.write(`${JSON.stringify(await handle(request))}\n`)
      })
      .catch((error) => process.stderr.write(`[asset-mcp] ${String(error)}\n`))
  })
  lines.once('close', () => catalog.close())
}
