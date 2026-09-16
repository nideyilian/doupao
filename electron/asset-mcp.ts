import { copyFile, readFile } from 'node:fs/promises'
import { constants as fsConstants, readSync } from 'node:fs'
import path from 'node:path'
import type { AssetCatalogQuery, TaskParams } from '../src/types'
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
    name: 'get_app_state',
    title: 'Read DOUPAO workspace state',
    description:
      'Read the live workspace: current app mode, active tab id, and every workspace tab with its prompt, ' +
      'generation params and task count.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'run_asset_command',
    title: 'Use a DOUPAO asset or edit the workspace',
    description:
      'Run an allowlisted command in the active DOUPAO window. Asset actions: useAsReference, ' +
      'openInPostprocess, openInComposite, reuseGenerationConfig, exportAsset. Organization: createCollection. ' +
      'Import: importExternalFiles (by local path). Workspace edits: setPrompt (writes the active tab prompt), ' +
      'setParams (merges generation params such as size / quality / n). Writes target the active tab; pass ' +
      'tabId to switch tabs first.',
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
            'setPrompt',
            'setParams',
          ],
        },
        assetId: { type: 'string' },
        name: { type: 'string' },
        parentId: { type: ['string', 'null'] },
        color: { type: ['string', 'null'] },
        paths: { type: 'array', items: { type: 'string' } },
        prompt: { type: 'string' },
        params: { type: 'object' },
        tabId: { type: 'string' },
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
        if (name === 'get_app_state')
          return result(request.id, textToolResult(await deps.runCommand({ action: 'getAppState' })))
        if (name === 'run_asset_command')
          return result(
            request.id,
            textToolResult(
              await deps.runCommand({
                action: String(args.action) as ExternalAssetCommand['action'],
                assetId: typeof args.assetId === 'string' ? args.assetId : undefined,
                name: typeof args.name === 'string' ? args.name : undefined,
                // 缺失的可选字段一律留 undefined：`createCollection` 那侧 App.tsx 用 `?? null` 兜底，
                // 语义等价，但能避免每条命令都夹带 parentId:null / color:null 的噪声。
                parentId: typeof args.parentId === 'string' ? args.parentId : undefined,
                color: typeof args.color === 'string' ? args.color : undefined,
                paths: Array.isArray(args.paths)
                  ? (args.paths.filter((p): p is string => typeof p === 'string') ?? [])
                  : undefined,
                // 应用级写入字段：不传就保持 undefined，别塞 null —— validParams 只认对象，
                // setPrompt 也只认字符串，多余的键会让命令被判非法。
                prompt: typeof args.prompt === 'string' ? args.prompt : undefined,
                params:
                  args.params && typeof args.params === 'object' ? (args.params as Partial<TaskParams>) : undefined,
                tabId: typeof args.tabId === 'string' ? args.tabId : undefined,
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

/**
 * 从已读入的缓冲区里切出所有完整行（按 \n 分隔），返回剩余未成行的尾巴。
 * 末尾的 \r 由 trim 去掉，兼容 CRLF 客户端。
 */
export function splitMcpStdioLines(pending: Buffer): { lines: string[]; rest: Buffer } {
  const lines: string[] = []
  let rest = pending
  let newline = rest.indexOf(10)
  while (newline !== -1) {
    const line = rest.subarray(0, newline).toString('utf8').trim()
    rest = rest.subarray(newline + 1)
    newline = rest.indexOf(10)
    if (line) lines.push(line)
  }
  return { lines, rest }
}

/** 读一次 stdin 原始 fd；返回字节数，0 表示 EOF，null 表示句柄已关闭（客户端强杀）。 */
function readStdinChunk(buffer: Buffer): number | null {
  try {
    return readSync(0, buffer, 0, buffer.length, null)
  } catch (error) {
    process.stderr.write(`[asset-mcp] stdin 已关闭: ${error instanceof Error ? error.message : String(error)}\n`)
    return null
  }
}

/**
 * 逐行读取 stdin、处理请求并写回 stdout，直到 stdin 结束（MCP 客户端关闭连接）。
 *
 * 刻意**不用 readline**：Windows 下 Electron 主进程的 stdin *流* 会立刻报 EOF ——
 * readline 直接触发 'close'，父进程写进来的行一行都读不到，服务因此全程静默。
 * 但同一个 fd 0 用 fs.readSync 却能正常读到数据（实测读到完整字节），说明坏的是 Node 的
 * 流层而不是句柄。所以这里直接读原始 fd。
 *
 * readSync 是阻塞的，但这对 stdio 服务没有副作用：它本来就只有「读一行 → 处理 → 写回」这一件
 * 事，且每次 await handle() 期间事件循环依然畅通（runCommand 的 fetch 就是靠这个）。
 */
async function pumpMcpStdio(handle: (request: JsonRpcRequest) => Promise<JsonRpcResponse>) {
  let pending: Buffer = Buffer.alloc(0)
  const chunk = Buffer.alloc(64 * 1024)
  for (;;) {
    const read = readStdinChunk(chunk)
    if (read === null || read === 0) return
    const { lines, rest } = splitMcpStdioLines(Buffer.concat([pending, chunk.subarray(0, read)]))
    pending = rest
    for (const line of lines) {
      try {
        const request = JSON.parse(line) as JsonRpcRequest
        if (request.id === undefined && request.method === 'notifications/initialized') continue
        process.stdout.write(`${JSON.stringify(await handle(request))}\n`)
      } catch (error) {
        process.stderr.write(`[asset-mcp] ${String(error)}\n`)
      }
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
  try {
    await pumpMcpStdio(handle)
  } finally {
    catalog.close()
  }
}
