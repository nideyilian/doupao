import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultCompositeV2Preset, createDefaultCompositeV2PresetGroup } from './compositeV2Defaults'
import * as exportRuntime from './compositeExportRuntime'
import { createCompositeExportSnapshot } from './compositeExportPlan'
import type { CompositeV2ExportItem, CompositeV2ExportSnapshot } from './compositeExportPlan'
import type { CompositeV2ExportTask } from './compositeV2Types'

const { authorizeCompositeOutputRoot, buildPresetOutputPathParts, dataUrlSizeKb, renderWithMaxKb, waitWhilePaused } =
  exportRuntime

const rendererMocks = vi.hoisted(() => ({
  renderCompositeV2ToJpegDataUrl: vi.fn(),
}))

const storeV2Mocks = vi.hoisted(() => ({
  useCompositeV2Store: { getState: vi.fn() },
}))

vi.mock('./compositeRendererV2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./compositeRendererV2')>()
  return { ...actual, renderCompositeV2ToJpegDataUrl: rendererMocks.renderCompositeV2ToJpegDataUrl }
})

vi.mock('../storeV2', () => ({
  useCompositeV2Store: storeV2Mocks.useCompositeV2Store,
}))

vi.mock('../../../lib/assetDerivation', () => ({
  archiveRenderedAsset: vi.fn(async () => null),
}))

vi.mock('../../../lib/imageFingerprint', () => ({
  computeContentHash: vi.fn(async () => 'content-hash'),
}))

function dataUrlOfKb(kb: number) {
  return `data:image/jpeg;base64,${Buffer.alloc(kb * 1024).toString('base64')}`
}

afterEach(() => {
  vi.clearAllMocks()
})

function renderInput(overrides: Partial<Parameters<typeof renderWithMaxKb>[0]> = {}) {
  return {
    backgroundDataUrl: dataUrlOfKb(10),
    preset: createDefaultCompositeV2Preset(1),
    targetSize: { width: 1280, height: 720 },
    fitMode: 'crop-fill' as const,
    ...overrides,
  }
}

function createSnapshot(ruleCount: number): CompositeV2ExportSnapshot {
  const rules = Array.from({ length: ruleCount }, (_, index) => ({
    id: `rule-${index}`,
    name: index === 0 ? '1280x720' : '1920x1080',
    channelId: 'chan',
    channelName: '渠道',
    enabled: true,
    width: index === 0 ? 1280 : 1920,
    height: index === 0 ? 720 : 1080,
    maxSizeKb: 399,
    format: 'jpg' as const,
    filenameTemplate: '',
  }))
  return createCompositeExportSnapshot({
    id: 'job',
    date: '20260703',
    backgroundFolders: ['D:/bg'],
    recursive: false,
    backgrounds: [{ path: 'D:/bg/a.jpg', name: 'a.jpg', relativeDir: '', width: 1280, height: 720 }],
    presets: [{ ...createDefaultCompositeV2Preset(1), id: 'p1', name: '预设', outputRootPath: 'D:/out' }],
    presetGroup: { ...createDefaultCompositeV2PresetGroup(1), presetIds: ['p1'] },
    enabledPresetIds: ['p1'],
    outputRuleGroups: [{ id: 'g1', name: 'G', distributionPaths: [], rules }],
    smartMatchOrientation: false,
    custom: '',
    customVariables: [],
    fitMode: 'crop-fill',
    preserveSourceDir: false,
    archiveExportsToLibrary: false,
  })
}

describe('composite export runtime helpers', () => {
  it('measures base64 data URLs in kilobytes', () => {
    const oneKb = Buffer.alloc(1024).toString('base64')
    expect(dataUrlSizeKb(`data:image/jpeg;base64,${oneKb}`)).toBe(1)
  })

  it('stops waiting when cancellation is requested', async () => {
    let checks = 0
    await waitWhilePaused(
      () => true,
      () => ++checks > 1,
      async () => undefined,
    )
    expect(checks).toBe(2)
  })

  it('derives the output folder from the filename template without the index field', () => {
    const createItem = (id: string, project: string): CompositeV2ExportItem => ({
      snapshotId: 'snapshot',
      preset: {
        ...createDefaultCompositeV2Preset(1),
        id,
        name: `Preset ${id}`,
        namingTemplate: '{legacy}',
        filenameTemplate: '{channel}-{size}-{date}-{project}-{index}',
        customVariableValues: { project },
      },
      outputRule: {
        id: 'rule',
        name: '1280x720',
        channelId: 'baidu',
        channelName: '百度',
        enabled: true,
        width: 1280,
        height: 720,
        maxSizeKb: 399,
        format: 'jpg',
        filenameTemplate: '',
      },
      background: {
        path: 'D:/source.png',
        name: 'source.png',
        relativeDir: '',
        width: 1280,
        height: 720,
      },
      date: '20260703',
      index: 1,
      custom: '',
    })

    // 文件夹名 = 文件名模板去掉序号字段；文件名保留序号
    expect(buildPresetOutputPathParts(createItem('a', '项目A'), { preserveSourceDir: false })).toEqual({
      subfolders: ['百度-1280x720-20260703-项目A'],
      filename: '百度-1280x720-20260703-项目A-1.jpg',
    })
    expect(buildPresetOutputPathParts(createItem('b', '项目B'), { preserveSourceDir: false })).toEqual({
      subfolders: ['百度-1280x720-20260703-项目B'],
      filename: '百度-1280x720-20260703-项目B-1.jpg',
    })
  })

  it('resolves built-in and custom variables in the preset output root', () => {
    const item: CompositeV2ExportItem = {
      snapshotId: 'snapshot',
      preset: {
        ...createDefaultCompositeV2Preset(1),
        name: '横版',
        outputRootPath: 'D:\\Exports\\{date}\\{project}',
        customVariableValues: { project: '项目A' },
      },
      outputRule: {
        id: 'rule',
        name: '1280x720',
        channelId: 'kuaishou',
        channelName: '快手',
        enabled: true,
        width: 1280,
        height: 720,
        maxSizeKb: 399,
        format: 'jpg',
        filenameTemplate: '',
      },
      background: {
        path: 'D:/source.png',
        name: 'source.png',
        relativeDir: '',
        width: 1280,
        height: 720,
      },
      date: '20260702',
      index: 1,
      custom: '',
    }
    const buildPresetOutputRootPath = (
      exportRuntime as typeof exportRuntime & {
        buildPresetOutputRootPath: (item: CompositeV2ExportItem) => string
      }
    ).buildPresetOutputRootPath

    expect(buildPresetOutputRootPath(item)).toBe('D:\\Exports\\20260702\\项目A')
  })

  it('authorizes each composite output root once per export run', async () => {
    const authorize = vi.fn(async () => true)
    const api = {
      authorizeCompositeOutputDirectory: authorize,
    } as unknown as NonNullable<Window['electronAPI']>
    const authorizedRoots = new Set<string>()

    await authorizeCompositeOutputRoot(api, 'D:\\Exports\\A', authorizedRoots)
    await authorizeCompositeOutputRoot(api, 'D:\\Exports\\A', authorizedRoots)
    await authorizeCompositeOutputRoot(api, 'E:\\Exports\\B', authorizedRoots)

    expect(authorize).toHaveBeenCalledTimes(2)
  })

  it('rejects roots that cannot be authorized', async () => {
    const api = {
      authorizeCompositeOutputDirectory: vi.fn(async () => false),
    } as unknown as NonNullable<Window['electronAPI']>

    await expect(authorizeCompositeOutputRoot(api, 'relative/output', new Set())).rejects.toThrow(
      '输出目录必须是绝对路径',
    )
  })

  it('renders once at high quality when the size already fits', async () => {
    rendererMocks.renderCompositeV2ToJpegDataUrl.mockResolvedValue(dataUrlOfKb(50))

    const result = await renderWithMaxKb(renderInput(), 100)

    expect(rendererMocks.renderCompositeV2ToJpegDataUrl).toHaveBeenCalledTimes(1)
    expect(rendererMocks.renderCompositeV2ToJpegDataUrl).toHaveBeenCalledWith(expect.objectContaining({ quality: 0.9 }))
    expect(result.warning).toBeUndefined()
  })

  it('binary-searches only when the high-quality render exceeds the limit', async () => {
    rendererMocks.renderCompositeV2ToJpegDataUrl.mockImplementation(async ({ quality }: { quality?: number }) =>
      (quality ?? 0) >= 0.5 ? dataUrlOfKb(200) : dataUrlOfKb(50),
    )

    const result = await renderWithMaxKb(renderInput(), 100)

    // 0.9 一次 + 0.01 一次 + 二分 8 次
    expect(rendererMocks.renderCompositeV2ToJpegDataUrl).toHaveBeenCalledTimes(10)
    expect(dataUrlSizeKb(result.dataUrl)).toBeLessThanOrEqual(100)
    expect(result.warning).toBeUndefined()
  })

  it('reports a warning when even the lowest quality exceeds the limit', async () => {
    rendererMocks.renderCompositeV2ToJpegDataUrl.mockResolvedValue(dataUrlOfKb(200))

    const result = await renderWithMaxKb(renderInput(), 100)

    expect(result.warning).toMatch(/最低质量 0\.01/)
  })

  it('reads each background once across size rules and pipelines writes', async () => {
    const readImageFile = vi.fn(async (path: string) => ({ path, name: 'a.jpg', dataUrl: dataUrlOfKb(50) }))
    const saveCompositeImage = vi.fn(async () => true)
    const pathJoin = vi.fn(async (...parts: string[]) => parts.join('/'))
    const checkExists = vi.fn(async () => false)
    const authorizeCompositeOutputDirectory = vi.fn(async () => true)
    rendererMocks.renderCompositeV2ToJpegDataUrl.mockResolvedValue(dataUrlOfKb(20))

    const api = {
      isElectron: true,
      readImageFile,
      saveCompositeImage,
      pathJoin,
      checkExists,
      authorizeCompositeOutputDirectory,
    } as unknown as Window['electronAPI']
    const originalWindow = globalThis.window
    ;(globalThis as { window?: unknown }).window = { electronAPI: api }

    const successes: unknown[] = []
    const failures: unknown[] = []
    try {
      await exportRuntime.runCompositeV2Export(createSnapshot(2), {
        onProgress: () => undefined,
        onSuccess: (item) => successes.push(item),
        onFailure: (item) => failures.push(item),
        shouldPause: () => false,
        shouldCancel: () => false,
      })
    } finally {
      ;(globalThis as { window?: unknown }).window = originalWindow
    }

    // 两个尺寸规则共用同一背景 → 只读盘一次
    expect(readImageFile).toHaveBeenCalledTimes(1)
    expect(saveCompositeImage).toHaveBeenCalledTimes(2)
    expect(successes).toHaveLength(2)
    expect(failures).toHaveLength(0)
  })

  it('retries a failed export task using current store presets and rules', async () => {
    const readImageFile = vi.fn(async (path: string) => ({ path, name: 'a.jpg', dataUrl: dataUrlOfKb(20) }))
    const saveCompositeImage = vi.fn(async () => true)
    const pathJoin = vi.fn(async (...parts: string[]) => parts.join('/'))
    const checkExists = vi.fn(async () => false)
    const authorizeCompositeOutputDirectory = vi.fn(async () => true)
    rendererMocks.renderCompositeV2ToJpegDataUrl.mockResolvedValue(dataUrlOfKb(10))

    const api = {
      isElectron: true,
      readImageFile,
      saveCompositeImage,
      pathJoin,
      checkExists,
      authorizeCompositeOutputDirectory,
    } as unknown as Window['electronAPI']
    const originalWindow = globalThis.window
    ;(globalThis as { window?: unknown }).window = { electronAPI: api }

    const preset = { ...createDefaultCompositeV2Preset(1), id: 'p1', name: '预设A', outputRootPath: 'D:/out' }
    const rule = {
      id: 'r1',
      name: '1080x1920',
      enabled: true,
      width: 1080,
      height: 1920,
      maxSizeKb: 399,
      format: 'jpg' as const,
      filenameTemplate: '',
    }
    storeV2Mocks.useCompositeV2Store.getState.mockReturnValue({
      presets: [preset],
      outputRuleGroups: [{ id: 'g1', name: '渠道', distributionPaths: [], rules: [rule] }],
      customVariables: [],
      globalFitMode: 'crop-fill',
      preserveSourceDir: false,
      archiveExportsToLibrary: false,
    })

    const task: CompositeV2ExportTask = {
      key: 'p1|渠道|1080x1920|1',
      backgroundPath: 'D:/bg/a.jpg',
      presetId: 'p1',
      presetName: '预设A',
      channel: '渠道',
      size: '1080x1920',
      index: 1,
      date: '20260703',
      custom: '',
      status: 'failed',
      reason: '背景图读取失败',
    }

    const successes: unknown[] = []
    const failures: unknown[] = []
    try {
      await exportRuntime.retryCompositeExportTask(task, {
        onSuccess: (item) => successes.push(item),
        onFailure: (item) => failures.push(item),
      })
    } finally {
      ;(globalThis as { window?: unknown }).window = originalWindow
    }

    expect(successes).toHaveLength(1)
    expect(failures).toHaveLength(0)
    expect(readImageFile).toHaveBeenCalledTimes(1)
    expect(saveCompositeImage).toHaveBeenCalledTimes(1)
    expect(saveCompositeImage).toHaveBeenCalledWith(
      'D:/out/预设A-a/预设A-a-1.jpg',
      expect.stringContaining('data:image/jpeg'),
    )
  })

  it('uses the in-memory background dataUrl without reading from disk', async () => {
    const readImageFile = vi.fn(async () => null)
    const saveCompositeImage = vi.fn(async () => true)
    const pathJoin = vi.fn(async (...parts: string[]) => parts.join('/'))
    const checkExists = vi.fn(async () => false)
    const authorizeCompositeOutputDirectory = vi.fn(async () => true)
    rendererMocks.renderCompositeV2ToJpegDataUrl.mockResolvedValue(dataUrlOfKb(10))

    const api = {
      isElectron: true,
      readImageFile,
      saveCompositeImage,
      pathJoin,
      checkExists,
      authorizeCompositeOutputDirectory,
    } as unknown as Window['electronAPI']
    const originalWindow = globalThis.window
    ;(globalThis as { window?: unknown }).window = { electronAPI: api }

    const snapshot = createSnapshot(1)
    snapshot.backgrounds = [
      {
        path: 'mem://img-1',
        name: 'img-1',
        relativeDir: '',
        width: 100,
        height: 100,
        dataUrl: dataUrlOfKb(30),
      },
    ]

    const successes: unknown[] = []
    const failures: unknown[] = []
    try {
      await exportRuntime.runCompositeV2Export(snapshot, {
        onProgress: () => undefined,
        onSuccess: (item) => successes.push(item),
        onFailure: (item) => failures.push(item),
        shouldPause: () => false,
        shouldCancel: () => false,
      })
    } finally {
      ;(globalThis as { window?: unknown }).window = originalWindow
    }

    expect(readImageFile).not.toHaveBeenCalled()
    expect(successes).toHaveLength(1)
    expect(failures).toHaveLength(0)
    expect(saveCompositeImage).toHaveBeenCalledTimes(1)
  })
})
