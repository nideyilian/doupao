import { describe, expect, it, vi } from 'vitest'
import { createMcpRequestHandler } from './asset-mcp'

describe('asset MCP server', () => {
  const catalog = {
    query: vi.fn(() => ({
      assets: [],
      totalCount: 0,
      nextCursor: null,
      counts: { all: 0, recent: 0, favorites: 0, unorganized: 0, trash: 0, byCollection: {}, byTag: {} },
    })),
    getAsset: vi.fn((id: string) => (id === 'a' ? { asset: { id: 'a' }, blob: {}, version: {} } : null)),
    recommend: vi.fn(() => []),
  }

  it('advertises resources and safe asset tools', async () => {
    const handle = createMcpRequestHandler({ catalog: catalog as never, runCommand: vi.fn(), exportAsset: vi.fn() })
    const initialized = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    expect(initialized.result.capabilities).toEqual(expect.objectContaining({ tools: {}, resources: {} }))
    const tools = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    expect(tools.result.tools.map((tool: { name: string }) => tool.name)).toContain('search_assets')
    const templates = await handle({ jsonrpc: '2.0', id: 3, method: 'resources/templates/list' })
    expect(templates.result.resourceTemplates[0].uriTemplate).toBe('doupao://assets/{id}')
  })

  it('reads stable asset resources', async () => {
    const handle = createMcpRequestHandler({ catalog: catalog as never, runCommand: vi.fn(), exportAsset: vi.fn() })
    const response = await handle({
      jsonrpc: '2.0',
      id: 4,
      method: 'resources/read',
      params: { uri: 'doupao://assets/a' },
    })
    expect(response.result.contents[0].uri).toBe('doupao://assets/a')
    expect(response.result.contents[0].text).toContain('"id":"a"')
  })
})
