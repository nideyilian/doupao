import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssetApiServer } from './asset-api-server'

const servers: AssetApiServer[] = []

function makeCatalog() {
  return {
    query: vi.fn(() => ({
      assets: [],
      totalCount: 0,
      nextCursor: null,
      counts: { all: 0, recent: 0, favorites: 0, unorganized: 0, trash: 0, byCollection: {}, byTag: {} },
    })),
    getAsset: vi.fn(() => null),
    recommend: vi.fn(() => []),
    getAllCollections: vi.fn(() => []),
    getAllTags: vi.fn(() => []),
  }
}

afterEach(async () => {
  while (servers.length) await servers.pop()?.stop()
})

describe('local asset REST API', () => {
  it('is loopback-only and rejects missing authentication', async () => {
    const server = new AssetApiServer({
      token: 'test-token',
      catalog: makeCatalog(),
      runCommand: vi.fn(),
    })
    servers.push(server)
    const status = await server.start(0)
    expect(status.host).toBe('127.0.0.1')
    const response = await fetch(`http://127.0.0.1:${status.port}/v1/assets`)
    expect(response.status).toBe(401)
  })

  it('exposes authenticated search and scoped commands', async () => {
    const runCommand = vi.fn(async () => ({ success: true }))
    const server = new AssetApiServer({
      token: 'test-token',
      catalog: makeCatalog(),
      runCommand,
    })
    servers.push(server)
    const { port } = await server.start(0)
    const headers = { Authorization: 'Bearer test-token' }
    expect((await fetch(`http://127.0.0.1:${port}/v1/assets?query=cat`, { headers })).status).toBe(200)
    const command = await fetch(`http://127.0.0.1:${port}/v1/commands`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'useAsReference', assetId: 'a' }),
    })
    expect(command.status).toBe(200)
    expect(runCommand).toHaveBeenCalledWith({ action: 'useAsReference', assetId: 'a' })
  })

  it('lists collections and tags, creates collections, and imports files by path', async () => {
    const runCommand = vi.fn(async (command: unknown) => ({ received: command }))
    const catalog = makeCatalog()
    const server = new AssetApiServer({
      token: 'test-token',
      catalog,
      runCommand,
    })
    servers.push(server)
    const { port } = await server.start(0)
    const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' }

    expect((await fetch(`http://127.0.0.1:${port}/v1/collections`, { headers })).status).toBe(200)
    expect((await fetch(`http://127.0.0.1:${port}/v1/tags`, { headers })).status).toBe(200)
    expect(catalog.getAllCollections).toHaveBeenCalled()
    expect(catalog.getAllTags).toHaveBeenCalled()

    const created = await fetch(`http://127.0.0.1:${port}/v1/collections`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: '广告图', parentId: 'c1' }),
    })
    expect(created.status).toBe(200)
    expect(runCommand).toHaveBeenCalledWith({ action: 'createCollection', name: '广告图', parentId: 'c1' })

    const invalid = await fetch(`http://127.0.0.1:${port}/v1/collections`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: '   ' }),
    })
    expect(invalid.status).toBe(400)

    await fetch(`http://127.0.0.1:${port}/v1/imports`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ paths: ['D:/a.png'] }),
    })
    expect(runCommand).toHaveBeenCalledWith({ action: 'importExternalFiles', paths: ['D:/a.png'] })
  })

  it('accepts app-level workspace commands without an assetId', async () => {
    const runCommand = vi.fn(async (command: unknown) => ({ received: command }))
    const server = new AssetApiServer({ token: 'test-token', catalog: makeCatalog(), runCommand })
    servers.push(server)
    const { port } = await server.start(0)
    const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' }
    const post = (body: unknown) =>
      fetch(`http://127.0.0.1:${port}/v1/commands`, { method: 'POST', headers, body: JSON.stringify(body) })

    // getAppState 不针对素材，必须绕过 `default` 分支的 assetId 强制校验。
    expect((await post({ action: 'getAppState' })).status).toBe(200)
    expect(runCommand).toHaveBeenCalledWith({ action: 'getAppState' })

    expect((await post({ action: 'setPrompt', prompt: '一只戴帽子的猫', tabId: 't1' })).status).toBe(200)
    expect(runCommand).toHaveBeenCalledWith({ action: 'setPrompt', prompt: '一只戴帽子的猫', tabId: 't1' })

    expect((await post({ action: 'setParams', params: { size: '1024x1024', n: 2 } })).status).toBe(200)
    expect(runCommand).toHaveBeenCalledWith({ action: 'setParams', params: { size: '1024x1024', n: 2 } })
  })

  it('rejects malformed app-level workspace commands', async () => {
    const runCommand = vi.fn(async () => ({ success: true }))
    const server = new AssetApiServer({ token: 'test-token', catalog: makeCatalog(), runCommand })
    servers.push(server)
    const { port } = await server.start(0)
    const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' }
    const post = (body: unknown) =>
      fetch(`http://127.0.0.1:${port}/v1/commands`, { method: 'POST', headers, body: JSON.stringify(body) })

    expect((await post({ action: 'setPrompt' })).status).toBe(400)
    expect((await post({ action: 'setPrompt', prompt: 42 })).status).toBe(400)
    expect((await post({ action: 'setParams' })).status).toBe(400)
    expect((await post({ action: 'setParams', params: [] })).status).toBe(400)
    // 未知参数键会被塞进持久化状态，必须挡掉。
    expect((await post({ action: 'setParams', params: { notAParam: 1 } })).status).toBe(400)
    expect((await post({ action: 'deleteEverything' })).status).toBe(400)
    expect(runCommand).not.toHaveBeenCalled()
  })
})
