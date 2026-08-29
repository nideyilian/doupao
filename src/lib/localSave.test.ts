import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type AgentConversation, type AgentRound, type TaskRecord } from '../types'
import {
  formatAgentRoundSummaryMarkdown,
  getLocalImageSaveDirectoryForSegments,
  saveAgentRoundSummaryToLocal,
  saveImageToLocal,
} from './localSave'

describe('local image saving', () => {
  const savedImages: Array<{ filePath: string; dataUrl: string }> = []
  const ensuredDirs: string[] = []

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-20T12:00:00+08:00'))
    savedImages.length = 0
    ensuredDirs.length = 0
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {},
    })
    Object.defineProperty(globalThis.window, 'electronAPI', {
      configurable: true,
      value: {
        isElectron: true,
        getLocalSavePath: vi.fn(async () => 'D:\\LocalSaves'),
        getDefaultPath: vi.fn(async () => 'D:\\LocalSaves'),
        setLocalSavePath: vi.fn(async () => {}),
        ensureDir: vi.fn(async (dirPath: string) => {
          ensuredDirs.push(dirPath)
          return true
        }),
        pathJoin: vi.fn(async (...parts: string[]) => parts.join('\\')),
        saveImage: vi.fn(async (filePath: string, dataUrl: string) => {
          savedImages.push({ filePath, dataUrl })
          return true
        }),
        saveText: vi.fn(async () => true),
        checkExists: vi.fn(async () => false),
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(globalThis, 'window')
  })

  it('resolves date variables in explicit output paths and names images from the folder name', async () => {
    const savedPath = await saveImageToLocal(
      'task-a',
      0,
      'data:image/png;base64,a',
      'png',
      undefined,
      'D:\\Exports\\{date}\\插画',
    )

    expect(ensuredDirs).toContain('D:\\Exports\\20260620\\插画')
    expect(savedPath).toBe('D:\\Exports\\20260620\\插画\\插画-1.png')
    expect(savedImages[0].filePath).toBe('D:\\Exports\\20260620\\插画\\插画-1.png')
  })

  it('uses an exact generated filename base when provided', async () => {
    const savedPath = await saveImageToLocal(
      'task-a',
      0,
      'data:image/png;base64,a',
      'png',
      '快手',
      undefined,
      '20260620-快手-4',
    )

    expect(savedPath).toBe('D:\\LocalSaves\\images\\快手\\20260620-快手-4.png')
    expect(savedImages[0].filePath).toBe('D:\\LocalSaves\\images\\快手\\20260620-快手-4.png')
  })

  it('creates nested project-level folders segment by segment', async () => {
    const dir = await getLocalImageSaveDirectoryForSegments(['APP', '子项目', '古装'])

    expect(dir).toBe('D:\\LocalSaves\\images\\APP\\子项目\\古装')
    expect(ensuredDirs).toEqual([
      'D:\\LocalSaves\\images',
      'D:\\LocalSaves\\images\\APP',
      'D:\\LocalSaves\\images\\APP\\子项目',
      'D:\\LocalSaves\\images\\APP\\子项目\\古装',
    ])
  })

  it('sanitizes illegal characters per segment instead of flattening the whole path', async () => {
    const dir = await getLocalImageSaveDirectoryForSegments(['A/B', 'C:D', ' E '])

    expect(dir).toBe('D:\\LocalSaves\\images\\A-B\\C-D\\E')
  })

  it('skips empty segments while still creating the images root', async () => {
    const dir = await getLocalImageSaveDirectoryForSegments(['', '   '])

    expect(dir).toBe('D:\\LocalSaves\\images')
    expect(ensuredDirs).toEqual(['D:\\LocalSaves\\images'])
  })

  it('reserves distinct sequential names when images are saved concurrently', async () => {
    const existingFiles = new Set(['images-1.png', 'images-2.png'])
    const api = globalThis.window.electronAPI!
    vi.mocked(api.checkExists).mockImplementation(async (filePath: string) => {
      const name = filePath.split('\\').pop()!
      return existingFiles.has(name)
    })
    api.readDir = vi.fn(async () => [...existingFiles])
    vi.mocked(api.saveImage).mockImplementation(async (filePath: string, dataUrl: string) => {
      savedImages.push({ filePath, dataUrl })
      existingFiles.add(filePath.split('\\').pop()!)
      return true
    })

    const savedPaths = await Promise.all([
      saveImageToLocal('task-a', 0, 'data:image/png;base64,a'),
      saveImageToLocal('task-a', 1, 'data:image/png;base64,b'),
    ])

    expect(new Set(savedPaths).size).toBe(2)
    expect(savedPaths).toEqual(
      expect.arrayContaining(['D:\\LocalSaves\\images\\images-3.png', 'D:\\LocalSaves\\images\\images-4.png']),
    )
  })

  it('writes one readable summary document for an Agent round', async () => {
    const round: AgentRound = {
      id: 'round-a',
      index: 1,
      parentRoundId: null,
      userMessageId: 'user-a',
      assistantMessageId: 'assistant-a',
      prompt: '生成两张海报',
      inputImageIds: ['reference-a'],
      outputTaskIds: ['task-a'],
      status: 'done',
      error: null,
      createdAt: 1,
      finishedAt: 2,
    }
    const conversation: AgentConversation = {
      id: 'conversation-a',
      title: '海报方案',
      order: 0,
      activeRoundId: round.id,
      createdAt: 1,
      updatedAt: 2,
      rounds: [round],
      messages: [
        { id: 'user-a', role: 'user', content: '生成两张海报', roundId: round.id, createdAt: 1 },
        { id: 'assistant-a', role: 'assistant', content: '已完成', roundId: round.id, createdAt: 2 },
      ],
    }
    const task: TaskRecord = {
      id: 'task-a',
      prompt: '蓝色科技海报',
      params: { ...DEFAULT_PARAMS, size: '1024x1536', n: 1 },
      actualParams: { size: '1024x1536' },
      actualParamsByImage: { 'image-a': { size: '1024x1536' } },
      apiProvider: 'openai',
      apiProfileName: 'Images API',
      apiMode: 'images',
      apiModel: 'gpt-image-1',
      inputImageIds: ['reference-a'],
      outputImages: ['image-a'],
      rawImageUrls: ['https://example.com/image-a.png'],
      status: 'done',
      error: null,
      createdAt: 1,
      finishedAt: 2,
      elapsed: 1,
      sourceMode: 'agent',
      agentConversationId: conversation.id,
      agentRoundId: round.id,
      agentBatchCallId: 'batch-a',
      localSavedOutputImagePaths: { '0:image-a': 'D:\\LocalSaves\\images\\image-a.png' },
    }

    const markdown = formatAgentRoundSummaryMarkdown(conversation, round, [task])
    expect(markdown).toContain('# 海报方案 · 第 1 轮')
    expect(markdown).toContain('蓝色科技海报')
    expect(markdown).toContain('1024x1536')
    expect(markdown).toContain('D:\\LocalSaves\\images\\image-a.png')
    expect(markdown).not.toMatch(/api[_ -]?key|authorization/i)

    const savedPath = await saveAgentRoundSummaryToLocal(conversation, round, [task])
    expect(savedPath).toBe('D:\\LocalSaves\\agent\\conversation-a\\round-001-round-a.md')
    expect(globalThis.window.electronAPI?.saveText).toHaveBeenCalledWith(savedPath, markdown)
  })
})
