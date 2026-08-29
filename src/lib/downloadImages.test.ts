import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { TaskRecord, WorkspaceTab } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { getGeneratedImageDownloadEntries, downloadImageEntries } from './downloadImages'
import * as localSave from './localSave'
import * as db from './db'

vi.mock('./localSave', () => ({
  isElectron: vi.fn(() => true),
  selectLocalSaveDirectory: vi.fn(async () => '/export-dir'),
  exportImagesToFolder: vi.fn(async () => ({ saved: 0, failed: [], total: 0 })),
  fileExistsOnDisk: vi.fn(async () => true),
  exportZipToPath: vi.fn(),
  saveImage: vi.fn(),
  selectSavePath: vi.fn(),
  selectZipSavePath: vi.fn(),
}))

vi.mock('./db', () => ({
  getImage: vi.fn(),
}))

vi.mock('../store', () => ({
  ensureImageCached: vi.fn(async () => 'data:image/png;base64,AAAA'),
}))

function task(
  overrides: Partial<TaskRecord> & Pick<TaskRecord, 'id' | 'prompt' | 'createdAt' | 'outputImages'>,
): TaskRecord {
  return {
    params: { ...DEFAULT_PARAMS, n: overrides.outputImages.length },
    inputImageIds: [],
    status: 'done',
    error: null,
    finishedAt: overrides.createdAt,
    elapsed: 1,
    ...overrides,
  }
}

function tab(id: string, name: string, tasks: TaskRecord[]): WorkspaceTab {
  return {
    id,
    name,
    groupId: null,
    prompt: '',
    inputImages: [],
    inputImageFolder: null,
    params: { ...DEFAULT_PARAMS },
    maskDraft: null,
    maskEditorImageId: null,
    customOutputPath: '',
    tasks,
    createdAt: 0,
    updatedAt: 0,
    order: 0,
  }
}

describe('generated image download entries', () => {
  const settings = {
    imageFilenameDatePrefix: true,
    imageFilenameUsePrompt: true,
  }

  it('uses each task date, tab, prompt, and task-relative sequence', () => {
    const taskA = task({
      id: 'a',
      prompt: 'A prompt',
      createdAt: new Date(2026, 6, 3, 8).getTime(),
      filenameBatch: 2,
      outputImages: ['a-1', 'a-2'],
    })
    const taskB = task({
      id: 'b',
      prompt: 'B prompt',
      createdAt: new Date(2026, 6, 2, 8).getTime(),
      filenameBatch: 1,
      outputImages: ['b-1'],
    })

    const entries = getGeneratedImageDownloadEntries(
      [taskA, taskB],
      [tab('tab-a', '快手', [taskA]), tab('tab-b', '小红书', [taskB])],
      settings,
    )

    expect(entries).toEqual([
      { imageId: 'a-1', fileNameBase: '20260703-快手-2-A prompt-1' },
      { imageId: 'a-2', fileNameBase: '20260703-快手-2-A prompt-2' },
      { imageId: 'b-1', fileNameBase: '20260702-小红书-1-B prompt-1' },
    ])
  })

  it('keeps the original image sequence when filtering one image', () => {
    const sourceTask = task({
      id: 'a',
      prompt: 'prompt',
      createdAt: new Date(2026, 6, 3, 8).getTime(),
      filenameBatch: 3,
      outputImages: ['a-1', 'a-2', 'a-3'],
    })

    expect(
      getGeneratedImageDownloadEntries([sourceTask], [tab('tab-a', '快手', [sourceTask])], settings, ['a-3']),
    ).toEqual([{ imageId: 'a-3', fileNameBase: '20260703-快手-3-prompt-3' }])
  })

  it('falls back to the scheduled output folder when no tab owns the task', () => {
    const sourceTask = task({
      id: 'a',
      prompt: '',
      createdAt: new Date(2026, 6, 3, 8).getTime(),
      outputImages: ['a-1'],
      scheduledOutputSubFolder: '定时任务',
    })

    expect(
      getGeneratedImageDownloadEntries([sourceTask], [], {
        imageFilenameDatePrefix: true,
        imageFilenameUsePrompt: false,
      }),
    ).toEqual([{ imageId: 'a-1', fileNameBase: '20260703-定时任务-1-1' }])
  })
})

describe('folder export fallback (Electron 批量导出到文件夹)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(localSave.exportImagesToFolder).mockResolvedValue({ saved: 2, failed: [], total: 2 })
    vi.mocked(localSave.selectLocalSaveDirectory).mockResolvedValue('/export-dir')
    vi.mocked(localSave.isElectron).mockReturnValue(true)
    // Node 测试环境没有 FileReader：blobToDataUrl 需要它，给一个最小实现
    class FakeFileReader {
      result = ''
      onload: (() => void) | null = null
      readAsDataURL() {
        this.result = 'data:image/png;base64,AAAA'
        this.onload?.()
      }
    }
    vi.stubGlobal('FileReader', FakeFileReader)
    // fetch(dataUrl) 返回一个最小 Blob
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x'], { type: 'image/png' }) })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('磁盘原图存在时优先复制 sourcePath（不携带 dataUrl）', async () => {
    vi.mocked(db.getImage).mockImplementation(async (id) =>
      id === 'a'
        ? ({ localPath: 'C:\\cache-images\\a.png' } as never)
        : ({ localPath: 'C:\\cache-images\\b.png' } as never),
    )
    vi.mocked(localSave.fileExistsOnDisk).mockResolvedValue(true)

    const result = await downloadImageEntries([
      { imageId: 'a', fileNameBase: 'img' },
      { imageId: 'b', fileNameBase: 'img' },
    ])

    expect(result).toEqual({ successCount: 2, failCount: 0 })
    const files = vi.mocked(localSave.exportImagesToFolder).mock.calls[0]![1]
    expect(files).toEqual([
      { fileName: 'img.png', sourcePath: 'C:\\cache-images\\a.png' },
      { fileName: 'img-02.png', sourcePath: 'C:\\cache-images\\b.png' },
    ])
  })

  it('localPath 指向的文件已不存在时回退 dataUrl 写盘，不再整批失败', async () => {
    vi.mocked(db.getImage).mockResolvedValue({ localPath: 'C:\\cache-images\\a.png' } as never)
    vi.mocked(localSave.fileExistsOnDisk).mockResolvedValue(false)

    const result = await downloadImageEntries([
      { imageId: 'a', fileNameBase: 'img' },
      { imageId: 'b', fileNameBase: 'img' },
    ])

    expect(result).toEqual({ successCount: 2, failCount: 0 })
    const files = vi.mocked(localSave.exportImagesToFolder).mock.calls[0]![1]
    expect(files).toEqual([
      { fileName: 'img.png', dataUrl: expect.stringMatching(/^data:image\/png;base64,/) },
      { fileName: 'img-02.png', dataUrl: expect.stringMatching(/^data:image\/png;base64,/) },
    ])
    expect(files[0]).not.toHaveProperty('sourcePath')
  })

  it('素材没有 localPath 时同样回退 dataUrl 写盘', async () => {
    vi.mocked(db.getImage).mockResolvedValue(undefined)

    const result = await downloadImageEntries([
      { imageId: 'a', fileNameBase: 'img' },
      { imageId: 'b', fileNameBase: 'img' },
    ])

    expect(result).toEqual({ successCount: 2, failCount: 0 })
    const files = vi.mocked(localSave.exportImagesToFolder).mock.calls[0]![1]
    expect(files.every((file) => typeof file.dataUrl === 'string' && !file.sourcePath)).toBe(true)
  })
})
