import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  buildLegacyDataExport,
  defaultLegacyDataExportFileName,
  describeLegacyDataPayload,
  LEGACY_DATA_FILE_KIND,
  LegacyDataFileError,
  parseLegacyDataFile,
} from './legacyDataTransfer'
import type { StoredImage } from '../types'

const dbMock = vi.hoisted(() => ({
  getAllTasks: vi.fn(),
  getWordLibraryState: vi.fn(),
  getAllAgentConversations: vi.fn(),
  getAllImages: vi.fn(),
  importLegacyStoreRecords: vi.fn(),
}))

vi.mock('./db', () => dbMock)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('defaultLegacyDataExportFileName', () => {
  it('produces a timestamped file name', () => {
    const name = defaultLegacyDataExportFileName(new Date(2026, 7, 26, 9, 5, 7))
    expect(name).toBe('doupao-data-export-20260826-090507.json')
  })
})

describe('parseLegacyDataFile', () => {
  it('accepts a valid export payload', () => {
    const payload = parseLegacyDataFile(
      JSON.stringify({
        kind: LEGACY_DATA_FILE_KIND,
        appVersion: '0.8.6',
        exportedAt: 123,
        stores: { tasks: [{ id: 't1' }], images: [{ id: 'i1' }] },
      }),
    )
    expect(payload.stores.tasks).toHaveLength(1)
    expect(payload.appVersion).toBe('0.8.6')
  })

  it('rejects invalid JSON', () => {
    expect(() => parseLegacyDataFile('{not-json')).toThrow(LegacyDataFileError)
  })

  it('rejects files without the doupao marker', () => {
    expect(() => parseLegacyDataFile('{"stores":{}}')).toThrow(/不是豆泡导出的数据文件/)
  })

  it('rejects malformed task records', () => {
    expect(() =>
      parseLegacyDataFile(JSON.stringify({ kind: LEGACY_DATA_FILE_KIND, stores: { tasks: [{ noId: true }] } })),
    ).toThrow(/任务记录格式不正确/)
  })

  it('accepts a payload without stores content as empty', () => {
    const payload = parseLegacyDataFile(JSON.stringify({ kind: LEGACY_DATA_FILE_KIND, stores: {} }))
    expect(payload.stores.tasks).toBeUndefined()
  })
})

describe('describeLegacyDataPayload', () => {
  it('summarizes store counts', () => {
    const summary = describeLegacyDataPayload({
      kind: LEGACY_DATA_FILE_KIND,
      appVersion: '0.8.6',
      exportedAt: 0,
      stores: {
        tasks: [{ id: 'a' } as never, { id: 'b' } as never],
        wordLibrary: [{ id: 'word-library' } as never],
        agentConversations: [{ id: 'c' } as never],
        images: [{ id: 'd' } as never],
      },
    })
    expect(summary).toContain('任务 2 条')
    expect(summary).toContain('词条库 1 份')
    expect(summary).toContain('Agent 对话 1 个')
    expect(summary).toContain('图片记录 1 条')
  })

  it('reports empty data', () => {
    expect(
      describeLegacyDataPayload({ kind: LEGACY_DATA_FILE_KIND, appVersion: '', exportedAt: 0, stores: {} }),
    ).toContain('空数据')
  })
})

describe('buildLegacyDataExport', () => {
  it('assembles stores and strips heavy image fields', async () => {
    const imageWithDataUrl: StoredImage = {
      id: 'i1',
      dataUrl: 'data:image/png;base64,AAAA',
      localPath: 'D:\\lib\\cache-images\\i1.png',
      createdAt: 1,
      source: 'generated',
    }
    dbMock.getAllTasks.mockResolvedValue([{ id: 't1', prompt: 'x' }])
    dbMock.getWordLibraryState.mockResolvedValue({ id: 'word-library', groups: [], entries: [], updatedAt: 1 })
    dbMock.getAllAgentConversations.mockResolvedValue([{ id: 'c1' }])
    dbMock.getAllImages.mockResolvedValue([imageWithDataUrl])

    const payload = await buildLegacyDataExport()

    expect(payload.kind).toBe(LEGACY_DATA_FILE_KIND)
    expect(payload.stores.tasks).toEqual([{ id: 't1', prompt: 'x' }])
    expect(payload.stores.wordLibrary).toHaveLength(1)
    expect(payload.stores.agentConversations).toHaveLength(1)
    expect(payload.stores.images).toHaveLength(1)
    expect(payload.stores.images![0].dataUrl).toBeUndefined()
    expect(payload.stores.images![0].localPath).toBe(imageWithDataUrl.localPath)
  })

  it('omits empty stores', async () => {
    dbMock.getAllTasks.mockResolvedValue([])
    dbMock.getWordLibraryState.mockResolvedValue(undefined)
    dbMock.getAllAgentConversations.mockResolvedValue([])
    dbMock.getAllImages.mockResolvedValue([])

    const payload = await buildLegacyDataExport()
    expect(payload.stores.tasks).toBeUndefined()
    expect(payload.stores.wordLibrary).toBeUndefined()
    expect(payload.stores.agentConversations).toBeUndefined()
    expect(payload.stores.images).toBeUndefined()
  })
})
