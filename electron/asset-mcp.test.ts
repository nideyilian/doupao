import { describe, expect, it, vi } from 'vitest'
import { createMcpRequestHandler, splitMcpStdioLines } from './asset-mcp'

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

  it('exposes workspace state and forwards app-level edits', async () => {
    const runCommand = vi.fn(async (command: unknown) => ({ received: command }))
    const handle = createMcpRequestHandler({ catalog: catalog as never, runCommand, exportAsset: vi.fn() })

    const tools = await handle({ jsonrpc: '2.0', id: 5, method: 'tools/list' })
    const names = tools.result.tools.map((tool: { name: string }) => tool.name)
    expect(names).toContain('get_app_state')

    const state = await handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'get_app_state' } })
    expect(runCommand).toHaveBeenCalledWith({ action: 'getAppState' })
    expect(state.result.structuredContent).toEqual({ received: { action: 'getAppState' } })

    await handle({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'run_asset_command', arguments: { action: 'setPrompt', prompt: '一只猫', tabId: 't2' } },
    })
    expect(runCommand).toHaveBeenCalledWith({ action: 'setPrompt', prompt: '一只猫', tabId: 't2' })

    // params 是对象、prompt 是字符串才透传；缺失字段必须留 undefined，不能塞 null。
    await handle({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: { name: 'run_asset_command', arguments: { action: 'setParams', params: { n: 2 } } },
    })
    expect(runCommand).toHaveBeenLastCalledWith({ action: 'setParams', params: { n: 2 } })
  })
})

describe('MCP stdio 行切分', () => {
  it('一次读到多行时全部切出，不留残行', () => {
    const { lines, rest } = splitMcpStdioLines(Buffer.from('{"a":1}\n{"b":2}\n', 'utf8'))
    expect(lines).toEqual(['{"a":1}', '{"b":2}'])
    expect(rest.length).toBe(0)
  })

  it('半行留到下一次读取，拼上后才成行', () => {
    const first = splitMcpStdioLines(Buffer.from('{"a":', 'utf8'))
    expect(first.lines).toEqual([])
    expect(first.rest.toString('utf8')).toBe('{"a":')

    const second = splitMcpStdioLines(Buffer.concat([first.rest, Buffer.from('1}\n', 'utf8')]))
    expect(second.lines).toEqual(['{"a":1}'])
    expect(second.rest.length).toBe(0)
  })

  it('兼容 CRLF 与空行', () => {
    const { lines } = splitMcpStdioLines(Buffer.from('{"a":1}\r\n\r\n{"b":2}\r\n', 'utf8'))
    expect(lines).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('多字节字符被 chunk 边界切断时不会乱码', () => {
    const payload = Buffer.from('{"name":"豆泡"}\n', 'utf8')
    const cut = payload.indexOf(Buffer.from('豆', 'utf8')) + 1
    const first = splitMcpStdioLines(payload.subarray(0, cut))
    expect(first.lines).toEqual([])
    const second = splitMcpStdioLines(Buffer.concat([first.rest, payload.subarray(cut)]))
    expect(second.lines).toEqual(['{"name":"豆泡"}'])
  })
})
