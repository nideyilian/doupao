/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { act, create } from 'react-test-renderer'
import { DEFAULT_PARAMS, type SopBatchSnapshot, type TaskRecord } from '../../../types'
import GallerySopBatchModal, { getGallerySopPromptRunStorageKey } from './GallerySopBatchModal'

const generateMocks = vi.hoisted(() => ({
  generatePromptsFromSopStore: vi.fn(),
  getSopPromptGenerationModelFromStore: vi.fn(() => 'gpt-test'),
}))
const storeMocks = vi.hoisted(() => ({
  ensureImageCached: vi.fn(),
  ensureImageThumbnailCached: vi.fn(),
  submitTaskWithData: vi.fn(),
  subscribeImageThumbnail: vi.fn(() => () => {}),
}))
const dbMocks = vi.hoisted(() => ({
  deleteSopBatchSnapshot: vi.fn(),
  getAllSopBatchSnapshots: vi.fn(),
  getSopBatchSnapshot: vi.fn(),
  putSopBatchSnapshot: vi.fn(),
}))
const requirementState = vi.hoisted(() => ({
  sopLibrary: [
    {
      id: 'sop-1',
      name: '商品图 SOP',
      description: '',
      content: '生成商品图。',
      source: 'manual',
      createdBy: 'user-1',
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'sop-2',
      name: '海报 SOP',
      description: '',
      content: '生成海报。',
      source: 'manual',
      createdBy: 'user-1',
      createdAt: 2,
      updatedAt: 2,
    },
  ],
}))
const storeState = vi.hoisted(() => ({
  params: {
    model: 'gpt-image-1',
    size: '1024x1024',
    quality: 'auto',
    output_format: 'png',
    n: 1,
    adNegativeRuleId: 'general-strict',
  },
  settings: {
    adNegativeRuleProfiles: [
      { id: 'general-strict', name: '通用严格' },
      { id: 'ocean-engine', name: '今日头条' },
      { id: 'tencent-ads', name: '广点通' },
    ],
  },
  inputImages: [] as Array<{ id: string; dataUrl: string }>,
  inputImageFolder: null,
  customOutputPath: '',
  tasks: [] as TaskRecord[],
  activeWorkspaceTabId: 'tab-a',
  workspaceTabs: [{ id: 'tab-a', name: '标签 A' }],
  showToast: vi.fn(),
  setConfirmDialog: vi.fn(),
  setInputImages: vi.fn(),
  setInputImageFolder: vi.fn(),
  setParams: vi.fn(),
}))

vi.mock('../../../store', () => ({
  ensureImageCached: storeMocks.ensureImageCached,
  ensureImageThumbnailCached: storeMocks.ensureImageThumbnailCached,
  submitTaskWithData: storeMocks.submitTaskWithData,
  subscribeImageThumbnail: storeMocks.subscribeImageThumbnail,
  useStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
}))
vi.mock('../../../lib/db', () => ({
  deleteSopBatchSnapshot: dbMocks.deleteSopBatchSnapshot,
  getAllSopBatchSnapshots: dbMocks.getAllSopBatchSnapshots,
  getSopBatchSnapshot: dbMocks.getSopBatchSnapshot,
  putSopBatchSnapshot: dbMocks.putSopBatchSnapshot,
}))
vi.mock('../../requirementPrototype/store', () => ({
  useRequirementPrototype: (selector: (state: typeof requirementState) => unknown) => selector(requirementState),
}))
vi.mock('./storeSopGeneration', () => generateMocks)

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mountedRenderers: Array<ReturnType<typeof create>> = []

function createPromptRun(id: string, title: string, promptGroup?: SopBatchSnapshot['promptGroup']): SopBatchSnapshot {
  return {
    id,
    title,
    promptGroup,
    batchId: '',
    workspaceTabId: 'tab-a',
    createdAt: 10,
    updatedAt: 20,
    status: 'ready',
    sop: { id: 'sop-1', name: '商品图 SOP', description: '', content: '生成商品图。' },
    brief: '',
    referenceImageIds: [],
    promptCount: 1,
    imagesPerPrompt: 1,
    prompts: [{ id: `${id}-prompt`, text: `${title}内容`, origin: 'ai', edited: false, sourceId: 'text-to-image' }],
    params: { ...DEFAULT_PARAMS },
  }
}

function selectPrompt(renderer: ReturnType<typeof create>, index: number) {
  act(() => {
    renderer.root.findByProps({ 'aria-label': `选择第 ${index} 条提示词` }).props.onClick()
  })
}

beforeEach(() => {
  dbMocks.getAllSopBatchSnapshots.mockResolvedValue([])
  dbMocks.getSopBatchSnapshot.mockResolvedValue(undefined)
  dbMocks.putSopBatchSnapshot.mockResolvedValue('run-1')
  dbMocks.deleteSopBatchSnapshot.mockResolvedValue(undefined)
  storeMocks.ensureImageThumbnailCached.mockResolvedValue(undefined)
})

afterEach(() => {
  while (mountedRenderers.length) mountedRenderers.pop()?.unmount()
  window.localStorage.clear()
  storeState.inputImages = []
  storeState.tasks = []
  vi.clearAllMocks()
})

describe('GallerySopBatchModal background generation', () => {
  it('lets the user choose the information-flow review rule from batch settings', async () => {
    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(
        <GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" initialPromptCount={1} onClose={vi.fn()} />,
      )
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    const reviewRuleSelect = renderer!.root.findByProps({ 'aria-label': '选择信息流审核规则' })
    act(() => reviewRuleSelect.props.onChange({ target: { value: 'ocean-engine' } }))

    expect(storeState.setParams).toHaveBeenCalledWith({ adNegativeRuleId: 'ocean-engine' })
  })

  it('starts generating before consuming the one-shot auto-start request', async () => {
    generateMocks.generatePromptsFromSopStore.mockResolvedValue(['自动生成的提示词'])

    function AutoStartHost() {
      const [autoStart, setAutoStart] = useState(true)
      return (
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          initialPromptCount={1}
          autoStart={autoStart}
          onAutoStartConsumed={() => setAutoStart(false)}
          onClose={vi.fn()}
        />
      )
    }

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<AutoStartHost />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenCalledOnce()
    expect(renderer!.root.findByProps({ 'aria-label': '第 1 条提示词' }).props.value).toBe('自动生成的提示词')
  })

  it('uses the latest input requirement when a mounted modal starts another run', async () => {
    generateMocks.generatePromptsFromSopStore.mockResolvedValue(['新任务提示词'])
    let updateBrief!: (value: string) => void
    let startNextRun!: () => void

    function ReusableSopHost() {
      const [brief, setBrief] = useState('上一任务要求')
      const [autoStart, setAutoStart] = useState(false)
      updateBrief = setBrief
      startNextRun = () => setAutoStart(true)
      return (
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          initialPromptCount={1}
          initialBrief={brief}
          autoStart={autoStart}
          onAutoStartConsumed={() => setAutoStart(false)}
          onClose={vi.fn()}
        />
      )
    }

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<ReusableSopHost />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    await act(async () => {
      updateBrief('新任务要求')
      startNextRun()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sop-1' }),
      1,
      '新任务要求',
      expect.anything(),
    )
  })

  it('uses the latest generation count when the same SOP starts again', async () => {
    generateMocks.generatePromptsFromSopStore.mockImplementation(async (_sop, quantity, _brief, options) => {
      const prompts = Array.from({ length: quantity }, (_, index) => `提示词-${index + 1}`)
      await options.onBatch?.(prompts, quantity, quantity)
      return prompts
    })
    storeMocks.submitTaskWithData.mockResolvedValue('task-1')
    let startNextRun!: () => void

    function ReusableSopHost() {
      const [promptCount, setPromptCount] = useState(1)
      const [autoStart, setAutoStart] = useState(true)
      startNextRun = () => {
        setPromptCount(3)
        setAutoStart(true)
      }
      return (
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          initialPromptCount={promptCount}
          initialAutoGenerate
          syncInitialGenerationCounts
          autoStart={autoStart}
          onAutoStartConsumed={() => setAutoStart(false)}
          onClose={vi.fn()}
        />
      )
    }

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<ReusableSopHost />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    await act(async () => {
      startNextRun()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(generateMocks.generatePromptsFromSopStore.mock.calls.map((call) => call[1])).toEqual([1, 3])
  })

  it('continues generating and persists the result after being moved to the background', async () => {
    let resolveGeneration!: (value: string[]) => void
    generateMocks.generatePromptsFromSopStore.mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          resolveGeneration = resolve
        }),
    )
    const onBackground = vi.fn()
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          autoStart
          onClose={vi.fn()}
          onBackground={onBackground}
        />,
      )
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenCalledOnce()
    const closeButton = renderer!.root
      .findAllByType('button')
      .find((button) => button.props['aria-label'] === '转入后台继续生成 SOP 提示词')
    act(() => closeButton!.props.onClick())
    expect(onBackground).toHaveBeenCalledOnce()

    await act(async () => {
      resolveGeneration(['后台生成的提示词'])
      await Promise.resolve()
    })

    const persisted = JSON.parse(window.localStorage.getItem(getGallerySopPromptRunStorageKey('tab-a')) ?? '{}')
    expect(persisted).toMatchObject({ version: 4, selectedSopId: 'sop-1', availablePrompts: 1 })
    expect(persisted.activeRunId).toMatch(/^sop-run-/)
    expect(dbMocks.putSopBatchSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        id: persisted.activeRunId,
        status: 'ready',
        prompts: [expect.objectContaining({ text: '后台生成的提示词', origin: 'ai' })],
      }),
    )
  })

  it('pauses before the next prompt batch and continues on demand', async () => {
    let releaseCurrentBatch!: () => void
    let secondBatchStarted = false
    generateMocks.generatePromptsFromSopStore.mockImplementation(async (_sop, _quantity, _brief, options) => {
      await options.beforeBatch?.()
      await options.onBatch?.(['第一批提示词'], 1, 2)
      await new Promise<void>((resolve) => {
        releaseCurrentBatch = resolve
      })
      await options.beforeBatch?.()
      secondBatchStarted = true
      await options.onBatch?.(['第二批提示词'], 2, 2)
      return ['第一批提示词', '第二批提示词']
    })
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          initialPromptCount={2}
          autoStart
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '暂停提示词生成' }).props.onClick()
      releaseCurrentBatch()
      await Promise.resolve()
    })

    expect(secondBatchStarted).toBe(false)
    expect(renderer!.root.findByProps({ 'aria-label': '继续提示词生成' })).toBeTruthy()
    expect(renderer!.root.findByProps({ 'aria-label': '第 1 条提示词' }).props.value).toBe('第一批提示词')

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '继续提示词生成' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(secondBatchStarted).toBe(true)
    selectPrompt(renderer!, 2)
    expect(renderer!.root.findByProps({ 'aria-label': '第 2 条提示词' }).props.value).toBe('第二批提示词')
  })

  it('cancels the active prompt request and returns to an idle state', async () => {
    let requestSignal!: AbortSignal
    generateMocks.generatePromptsFromSopStore.mockImplementation((_sop, _quantity, _brief, options) => {
      requestSignal = options.signal
      return new Promise<string[]>((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
      })
    })
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" autoStart onClose={vi.fn()} />,
      )
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '取消提示词生成' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(requestSignal.aborted).toBe(true)
    expect(renderer!.root.findAllByProps({ 'aria-label': '取消提示词生成' })).toHaveLength(0)
    expect(
      renderer!.root.findAllByType('p').some((node) => String(node.children.join('')).includes('提示词生成已取消')),
    ).toBe(true)
    expect(JSON.parse(window.localStorage.getItem(getGallerySopPromptRunStorageKey('tab-a')) ?? '{}')).toMatchObject({
      selectedSopId: 'sop-1',
      availablePrompts: 0,
    })
  })

  it('aborts the previous SOP request when a keyed workbench switches SOPs', async () => {
    let previousSignal!: AbortSignal
    generateMocks.generatePromptsFromSopStore.mockImplementation((_sop, _quantity, _brief, options) => {
      previousSignal = options.signal
      return new Promise<string[]>((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
      })
    })
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal key="sop-1" workspaceTabId="tab-a" initialSopId="sop-1" autoStart onClose={vi.fn()} />,
      )
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    await act(async () => {
      renderer!.update(
        <GallerySopBatchModal key="sop-2" workspaceTabId="tab-a" initialSopId="sop-2" onClose={vi.fn()} />,
      )
      await Promise.resolve()
    })

    expect(previousSignal.aborted).toBe(true)
    expect(
      renderer!.root.findAllByType('p').some((node) => String(node.children.join('')).includes('当前 SOP：海报 SOP')),
    ).toBe(true)
    expect(renderer!.root.findAllByProps({ 'aria-label': '第 1 条提示词' })).toHaveLength(0)
  })

  it('persists the automatic image-generation switch per workspace tab', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" onClose={vi.fn()} />)
    })
    mountedRenderers.push(renderer!)

    const toggle = renderer!.root
      .findAllByType('input')
      .find((input) => input.props['aria-label'] === '每生成一条提示词立即发送生图')
    expect(toggle!.props.checked).toBe(false)
    act(() => toggle!.props.onChange({ target: { checked: true } }))

    expect(
      renderer!.root
        .findAllByType('input')
        .find((input) => input.props['aria-label'] === '每生成一条提示词立即发送生图')!.props.checked,
    ).toBe(true)
    const persisted = JSON.parse(window.localStorage.getItem(getGallerySopPromptRunStorageKey('tab-a')) ?? '{}')
    expect(persisted.autoGenerate).toBe(true)
  })

  it('offers an explicit prompt-generation entry inside the SOP workspace', async () => {
    generateMocks.generatePromptsFromSopStore.mockResolvedValue(['从工作台生成的提示词'])
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" initialPromptCount={1} onClose={vi.fn()} />,
      )
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    const generateButton = renderer!.root
      .findAllByType('button')
      .find((button) => button.props['aria-label'] === '生成 1 条 SOP 提示词')
    expect(generateButton).toBeDefined()

    await act(async () => {
      generateButton!.props.onClick()
      await Promise.resolve()
    })

    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenCalledOnce()
    expect(renderer!.root.findByProps({ 'aria-label': '第 1 条提示词' }).props.value).toBe('从工作台生成的提示词')
  })

  it('offers a source-level action that supplements its prompt shortfall and generates only those images', async () => {
    generateMocks.generatePromptsFromSopStore
      .mockImplementationOnce(async (_sop, _quantity, _brief, options) => {
        await options.onBatch?.(['已有提示词'], 1, 3)
        return ['已有提示词']
      })
      .mockImplementationOnce(async (_sop, _quantity, _brief, options) => {
        const supplemented = ['补充提示词 1', '补充提示词 2']
        await options.onBatch?.(supplemented, 2, 2)
        return supplemented
      })
    storeMocks.submitTaskWithData.mockResolvedValueOnce('task-supplement-1').mockResolvedValueOnce('task-supplement-2')
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" initialPromptCount={3} onClose={vi.fn()} />,
      )
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '生成 3 条 SOP 提示词' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(storeMocks.submitTaskWithData).not.toHaveBeenCalled()
    const supplementButton = renderer!.root.findByProps({
      'aria-label': '为「文生图（无参考图）」补充 2 条提示词并生成 2 张图片',
    })
    await act(async () => {
      supplementButton.props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(generateMocks.generatePromptsFromSopStore.mock.calls.map((call) => call[1])).toEqual([3, 2])
    expect(storeMocks.submitTaskWithData).toHaveBeenCalledTimes(2)
    expect(storeMocks.submitTaskWithData.mock.calls.map((call) => call[0].prompt)).toEqual([
      '补充提示词 1',
      '补充提示词 2',
    ])
  })

  it('restores the active SOP run from IndexedDB without mixing another SOP', async () => {
    const storedRun: SopBatchSnapshot = {
      id: 'sop-run-saved',
      batchId: '',
      workspaceTabId: 'tab-a',
      createdAt: 10,
      updatedAt: 20,
      status: 'ready',
      pinned: true,
      sop: { id: 'sop-1', name: '商品图 SOP', description: '', content: '生成商品图。' },
      brief: '历史要求',
      referenceImageIds: [],
      promptCount: 80,
      imagesPerPrompt: 1,
      prompts: [{ id: 'prompt-1', text: '历史提示词', origin: 'ai', edited: false, sourceId: 'text-to-image' }],
      params: { ...DEFAULT_PARAMS },
    }
    window.localStorage.setItem(
      getGallerySopPromptRunStorageKey('tab-a'),
      JSON.stringify({
        version: 3,
        activeRunId: storedRun.id,
        selectedSopId: 'sop-1',
        promptCount: 80,
        imagesPerPrompt: 1,
        availablePrompts: 1,
        brief: storedRun.brief,
      }),
    )
    dbMocks.getAllSopBatchSnapshots.mockResolvedValue([storedRun])
    dbMocks.getSopBatchSnapshot.mockResolvedValue(storedRun)

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" onClose={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(renderer!.root.findByProps({ 'aria-label': '第 1 条提示词' }).props.value).toBe('历史提示词')
    expect(
      renderer!.root
        .findAllByType('button')
        .some((button) => button.props['aria-label'] === '补充缺口 79 条提示词并生成 79 张图片'),
    ).toBe(true)
    expect(storeState.setParams).toHaveBeenCalledWith(storedRun.params)
    expect(generateMocks.generatePromptsFromSopStore).not.toHaveBeenCalled()
  })

  it('supplements only missing prompts and generates images only for the supplemented prompts', async () => {
    const storedRun: SopBatchSnapshot = {
      id: 'sop-run-partial',
      batchId: 'batch-existing',
      batchIds: ['batch-existing'],
      taskIds: ['task-existing'],
      workspaceTabId: 'tab-a',
      createdAt: 10,
      updatedAt: 20,
      status: 'submitted',
      sop: { id: 'sop-1', name: '商品图 SOP', description: '', content: '生成商品图。' },
      brief: '',
      referenceImageIds: [],
      promptCount: 3,
      imagesPerPrompt: 2,
      prompts: [{ id: 'prompt-existing', text: '已有提示词', origin: 'ai', edited: false, sourceId: 'text-to-image' }],
      params: { ...DEFAULT_PARAMS, n: 2 },
    }
    window.localStorage.setItem(
      getGallerySopPromptRunStorageKey('tab-a'),
      JSON.stringify({
        version: 4,
        activeRunId: storedRun.id,
        selectedSopId: 'sop-1',
        promptCount: 3,
        imagesPerPrompt: 2,
        availablePrompts: 1,
      }),
    )
    dbMocks.getAllSopBatchSnapshots.mockResolvedValue([storedRun])
    dbMocks.getSopBatchSnapshot.mockResolvedValue(storedRun)
    generateMocks.generatePromptsFromSopStore.mockImplementation(async (_sop, _quantity, _brief, options) => {
      const supplemented = ['补充提示词 1', '补充提示词 2']
      await options.onBatch?.(supplemented, 2, 2)
      return supplemented
    })
    storeMocks.submitTaskWithData.mockResolvedValueOnce('task-supplement-1').mockResolvedValueOnce('task-supplement-2')

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" onClose={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    const supplementButton = renderer!.root.findByProps({
      'aria-label': '补充缺口 2 条提示词并生成 4 张图片',
    })
    await act(async () => {
      supplementButton.props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sop-1' }),
      2,
      '',
      expect.objectContaining({
        existingPrompts: expect.arrayContaining(['已有提示词']),
        maxBatchSize: 1,
      }),
    )
    expect(storeMocks.submitTaskWithData).toHaveBeenCalledTimes(2)
    expect(storeMocks.submitTaskWithData.mock.calls.map((call) => call[0].prompt)).toEqual([
      '补充提示词 1',
      '补充提示词 2',
    ])
    expect(storeMocks.submitTaskWithData.mock.calls.map((call) => call[0].params.n)).toEqual([2, 2])
    expect(storeMocks.submitTaskWithData.mock.calls.map((call) => call[0].sopBatch.promptIndex)).toEqual([2, 3])
    expect(storeMocks.submitTaskWithData.mock.calls.every((call) => call[0].sopBatch.promptCount === 3)).toBe(true)

    const submittedSnapshots = dbMocks.putSopBatchSnapshot.mock.calls
      .map(([snapshot]) => snapshot as SopBatchSnapshot)
      .filter((snapshot) => snapshot.id === storedRun.id && snapshot.status === 'submitted')
    expect(submittedSnapshots.at(-1)).toMatchObject({
      prompts: [
        expect.objectContaining({ id: 'prompt-existing', text: '已有提示词' }),
        expect.objectContaining({ text: '补充提示词 1' }),
        expect.objectContaining({ text: '补充提示词 2' }),
      ],
      taskIds: ['task-existing', 'task-supplement-1', 'task-supplement-2'],
    })
    expect(submittedSnapshots.at(-1)?.batchIds).toEqual(expect.arrayContaining(['batch-existing']))
  })

  it('shows explicit supplement and regenerate-all actions after partial prompt generation', async () => {
    generateMocks.generatePromptsFromSopStore
      .mockResolvedValueOnce(['保留的提示词'])
      .mockResolvedValueOnce(['新提示词 1', '新提示词 2', '新提示词 3'])

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(
        <GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" initialPromptCount={3} onClose={vi.fn()} />,
      )
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '生成 3 条 SOP 提示词' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(
      renderer!.root.findByProps({
        'aria-label': '补充缺口 2 条提示词并生成 2 张图片',
      }),
    ).toBeTruthy()
    const regenerateAllButton = renderer!.root.findByProps({
      'aria-label': '重新生成全部 3 条 SOP 提示词',
    })
    expect(
      renderer!.root
        .findAllByProps({ role: 'alert' })
        .some((node) => String(node.children.join('')).includes('补充缺口')),
    ).toBe(true)

    await act(async () => {
      regenerateAllButton.props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(generateMocks.generatePromptsFromSopStore.mock.calls.map((call) => call[1])).toEqual([3, 3])
    expect(renderer!.root.findByProps({ 'aria-label': '第 1 条提示词' }).props.value).toBe('新提示词 1')
    selectPrompt(renderer!, 2)
    expect(renderer!.root.findByProps({ 'aria-label': '第 2 条提示词' }).props.value).toBe('新提示词 2')
    selectPrompt(renderer!, 3)
    expect(renderer!.root.findByProps({ 'aria-label': '第 3 条提示词' }).props.value).toBe('新提示词 3')
    expect(storeState.setConfirmDialog).not.toHaveBeenCalled()
  })

  it('asks the host for attention instead of silently skipping auto-start when prompts remain', async () => {
    const storedRun: SopBatchSnapshot = {
      id: 'sop-run-leftover',
      batchId: '',
      workspaceTabId: 'tab-a',
      createdAt: 10,
      updatedAt: 20,
      status: 'ready',
      pinned: true,
      sop: { id: 'sop-1', name: '商品图 SOP', description: '', content: '生成商品图。' },
      brief: '上一批要求',
      referenceImageIds: [],
      promptCount: 2,
      imagesPerPrompt: 1,
      prompts: [{ id: 'prompt-1', text: '上一批残留提示词', origin: 'ai', edited: false, sourceId: 'text-to-image' }],
      params: { ...DEFAULT_PARAMS },
    }
    window.localStorage.setItem(
      getGallerySopPromptRunStorageKey('tab-a'),
      JSON.stringify({
        version: 3,
        activeRunId: storedRun.id,
        selectedSopId: 'sop-1',
        promptCount: 2,
        imagesPerPrompt: 1,
        availablePrompts: 1,
        brief: storedRun.brief,
      }),
    )
    dbMocks.getAllSopBatchSnapshots.mockResolvedValue([storedRun])
    dbMocks.getSopBatchSnapshot.mockResolvedValue(storedRun)
    const onNeedsAttention = vi.fn()
    const onAutoStartConsumed = vi.fn()

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          autoStart
          onAutoStartConsumed={onAutoStartConsumed}
          onNeedsAttention={onNeedsAttention}
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    // 静默运行时若在此处无声 return，用户按下发送将毫无反馈
    expect(generateMocks.generatePromptsFromSopStore).not.toHaveBeenCalled()
    expect(onNeedsAttention).toHaveBeenCalledWith('existing-prompts')
    expect(onAutoStartConsumed).toHaveBeenCalledOnce()
  })

  it('does not restore reference images into the input bar in silent mode', async () => {
    const storedRun: SopBatchSnapshot = {
      id: 'sop-run-silent-restore',
      batchId: '',
      workspaceTabId: 'tab-a',
      createdAt: 10,
      updatedAt: 20,
      status: 'ready',
      pinned: true,
      sop: { id: 'sop-1', name: '商品图 SOP', description: '', content: '生成商品图。' },
      brief: '上一批要求',
      referenceImageIds: ['ref-image-1'],
      promptCount: 1,
      imagesPerPrompt: 1,
      prompts: [
        { id: 'prompt-1', text: '参考图提示词', origin: 'ai', edited: false, sourceId: 'source-1-ref-image-1' },
      ],
      params: { ...DEFAULT_PARAMS },
    }
    window.localStorage.setItem(
      getGallerySopPromptRunStorageKey('tab-a'),
      JSON.stringify({
        version: 4,
        activeRunId: storedRun.id,
        selectedSopId: 'sop-1',
        promptCount: 1,
        imagesPerPrompt: 1,
        availablePrompts: 1,
        brief: storedRun.brief,
      }),
    )
    dbMocks.getAllSopBatchSnapshots.mockResolvedValue([storedRun])
    dbMocks.getSopBatchSnapshot.mockResolvedValue(storedRun)

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          autoStart
          visible={false}
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    // 静默模式下只恢复提示词列表，不把历史参考图写回输入框
    expect(storeState.setInputImages).not.toHaveBeenCalled()
    expect(storeState.setInputImageFolder).not.toHaveBeenCalled()
  })

  it('shows saved prompt collections in one directory without starting a new generation', async () => {
    const storedRun: SopBatchSnapshot = {
      id: 'sop-run-history',
      batchId: 'sop-batch-history',
      workspaceTabId: 'tab-a',
      createdAt: 10,
      updatedAt: 20,
      status: 'submitted',
      sop: { id: 'sop-1', name: '商品图 SOP', description: '', content: '生成商品图。' },
      brief: '历史要求',
      referenceImageIds: [],
      promptCount: 1,
      imagesPerPrompt: 1,
      prompts: [{ id: 'prompt-history', text: '可查看的历史提示词', origin: 'ai', edited: false }],
      params: { ...DEFAULT_PARAMS },
    }
    dbMocks.getAllSopBatchSnapshots.mockResolvedValue([storedRun])

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" onClose={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(renderer!.root.findAllByType('h3').some((node) => node.children.join('') === '提示词集')).toBe(true)
    expect(renderer!.root.findByProps({ 'aria-label': '提示词集时间线' })).toBeTruthy()
    expect(renderer!.root.findByProps({ 'aria-label': '查看提示词集 历史要求' })).toBeTruthy()
    expect(renderer!.root.findAllByProps({ 'aria-label': '查看全部提示词集' })).toHaveLength(0)
    expect(renderer!.root.findAllByProps({ 'aria-label': '查看未归档提示词集' })).toHaveLength(0)
    expect(generateMocks.generatePromptsFromSopStore).not.toHaveBeenCalled()
  })

  it('lists runs newest first without SOP grouping and labels their text model', async () => {
    const older = {
      ...createPromptRun('run-older', '旧版提示词'),
      createdAt: 10,
      updatedAt: 100,
      promptGenerationModel: 'gpt-old',
    }
    const newer = {
      ...createPromptRun('run-newer', '新版提示词'),
      createdAt: 20,
      updatedAt: 20,
      promptGenerationModel: 'gpt-new',
    }
    dbMocks.getAllSopBatchSnapshots.mockResolvedValue([older, newer])

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" onClose={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    // 时间线平铺：无 SOP 分组，最新（newer）在最上面
    const runButtons = renderer!.root.findAll(
      (node) => typeof node.props['aria-label'] === 'string' && node.props['aria-label'].startsWith('查看提示词集 '),
    )
    expect(runButtons.map((node) => node.props['aria-label'])).toEqual([
      '查看提示词集 新版提示词',
      '查看提示词集 旧版提示词',
    ])
    expect(renderer!.root.findByProps({ title: '生成提示词的文本模型：gpt-new' }).children).toEqual(['gpt-new'])
    expect(renderer!.root.findAllByProps({ 'aria-label': 'SOP 分组 商品图 SOP，2 个提示词集' })).toHaveLength(0)
    expect(renderer!.root.findAllByProps({ 'aria-label': '选择 新版提示词' })).toHaveLength(0)
    expect(renderer!.root.findAllByProps({ 'aria-label': '选择 旧版提示词' })).toHaveLength(0)
    expect(renderer!.root.findByProps({ 'aria-label': '新建提示词集' }).props.className).toContain(
      'sop-prompt-run-create',
    )
  })

  it('opens previous prompts without an active SOP and keeps generation settings unchanged', async () => {
    const storedRun: SopBatchSnapshot = {
      id: 'sop-run-library',
      title: '夏日海报提示词',
      batchId: '',
      workspaceTabId: 'tab-a',
      createdAt: 10,
      updatedAt: 30,
      status: 'ready',
      sop: { id: 'sop-1', name: '商品图 SOP', description: '', content: '生成商品图。' },
      brief: '清爽、高对比',
      referenceImageIds: [],
      promptCount: 1,
      imagesPerPrompt: 2,
      prompts: [
        {
          id: 'prompt-library',
          text: '无需 SOP 也能查看的历史提示词',
          origin: 'ai',
          edited: false,
          sourceId: 'text-to-image',
        },
      ],
      params: { ...DEFAULT_PARAMS, n: 2 },
    }
    dbMocks.getAllSopBatchSnapshots.mockResolvedValue([storedRun])

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" onClose={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(renderer!.root.findByProps({ 'aria-label': '查看提示词集 夏日海报提示词' })).toBeTruthy()
    const promptEditor = renderer!.root.findByProps({ 'aria-label': '第 1 条提示词' })
    expect(promptEditor.props.value).toBe('无需 SOP 也能查看的历史提示词')
    expect(promptEditor.props.className).toContain('sop-prompt-detail-editor-input')
    expect(renderer!.root.findByProps({ 'aria-label': '提示词集名称' }).props.value).toBe('夏日海报提示词')
    expect(renderer!.root.findByProps({ 'aria-label': '提示词集名称' }).props.title).toBe('夏日海报提示词')
    expect(renderer!.root.findAllByProps({ 'aria-label': '重新生成第 1 条提示词' })).toHaveLength(0)
    expect(renderer!.root.findAllByProps({ 'aria-label': '每生成一条提示词立即发送生图' })).toHaveLength(0)
    expect(renderer!.root.findAllByProps({ 'aria-label': '生成 0 张图片' })).toHaveLength(0)
    expect(renderer!.root.findAllByType('button').some((button) => button.children.includes('添加提示词'))).toBe(true)
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('completed')
    expect(storeState.setParams).not.toHaveBeenCalled()
    expect(generateMocks.generatePromptsFromSopStore).not.toHaveBeenCalled()
  })

  it('shows generated thumbnails left of one editable prompt and groups its actions', async () => {
    const storedRun: SopBatchSnapshot = {
      id: 'run-with-images',
      title: '有图片的提示词集',
      batchId: 'batch-with-images',
      taskIds: ['task-with-images'],
      workspaceTabId: 'tab-a',
      createdAt: 10,
      status: 'submitted',
      sop: { id: 'sop-1', name: '商品图 SOP', description: '', content: '' },
      brief: '',
      referenceImageIds: [],
      promptCount: 1,
      imagesPerPrompt: 1,
      prompts: [
        { id: 'prompt-with-images', text: '原始提交提示词', origin: 'ai', edited: false, sourceId: 'text-to-image' },
      ],
      params: { ...DEFAULT_PARAMS },
    }
    storeState.tasks = [
      {
        id: 'task-with-images',
        prompt: '原始提交提示词',
        params: { ...DEFAULT_PARAMS },
        inputImageIds: [],
        outputImages: ['output-image-1'],
        revisedPromptByImage: { 'output-image-1': '图片反推后的提示词' },
        sopBatch: {
          batchId: 'batch-with-images',
          snapshotId: 'run-with-images',
          sopId: 'sop-1',
          sopName: '商品图 SOP',
          promptId: 'prompt-with-images',
          promptIndex: 1,
          promptCount: 1,
        },
        status: 'done',
        error: null,
        createdAt: 10,
        finishedAt: null,
        elapsed: null,
      } as TaskRecord,
    ]
    dbMocks.getAllSopBatchSnapshots.mockResolvedValue([storedRun])

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" onClose={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    const promptRow = renderer!.root.findByProps({ id: 'prompt-output-prompt-with-images' })
    const mediaBlock = renderer!.root.findByProps({ 'data-slot': 'item-media' })
    const promptBlock = renderer!.root.findByProps({ 'data-slot': 'input-group' })
    expect(promptRow.props.className).toContain('grid-cols-[auto_minmax(0,1fr)]')
    expect(promptRow.props.className).toContain('items-start')
    expect(promptRow.props['data-slot']).toBe('item')
    expect(mediaBlock.props.className).toContain('flex-col')
    expect(renderer!.root.findByProps({ 'data-slot': 'item-content' })).toBeTruthy()
    expect(promptBlock.props.className).toContain('h-full')
    expect(promptBlock.props.className).toContain('flex-col')
    expect(promptBlock.findByProps({ 'data-slot': 'input-group-header' })).toBeTruthy()
    expect(renderer!.root.findAllByProps({ 'data-slot': 'item-header' })).toHaveLength(0)
    expect(renderer!.root.findByProps({ 'data-slot': 'button-group' })).toBeTruthy()
    expect(renderer!.root.findByProps({ 'aria-label': '第 1 条提示词的生成结果' })).toBeTruthy()
    expect(renderer!.root.findByProps({ 'aria-label': '查看第 1 条提示词的生成图片 1' }).props.style.width).toBe('100%')
    expect(renderer!.root.findByProps({ 'aria-label': '第 1 条提示词的功能与状态' })).toBeTruthy()
    expect(renderer!.root.findByProps({ 'aria-label': '第 1 条提示词操作' })).toBeTruthy()
    expect(renderer!.root.findByProps({ 'aria-label': '复制第 1 条提示词' })).toBeTruthy()
    expect(renderer!.root.findAllByProps({ children: '图片反推 / 改写提示词' })).toHaveLength(0)
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('图片反推后的提示词')
    expect(renderer!.root.findAllByProps({ 'aria-label': '定位第 1 条提示词' })).toHaveLength(0)
  })

  it('keeps the selected prompt in the detail pane without a redundant result view', async () => {
    const storedRun = createPromptRun('run-view-switch', '视图切换提示词集')
    storedRun.promptCount = 2
    storedRun.prompts = [
      { id: 'prompt-view-1', text: '第一条提示词', origin: 'ai', edited: false, sourceId: 'text-to-image' },
      { id: 'prompt-view-2', text: '第二条提示词', origin: 'manual', edited: true, sourceId: 'text-to-image' },
    ]
    dbMocks.getAllSopBatchSnapshots.mockResolvedValue([storedRun])

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" onClose={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(renderer!.root.findAllByProps({ role: 'tab' })).toHaveLength(0)
    selectPrompt(renderer!, 2)
    expect(renderer!.root.findByProps({ 'aria-label': '第 2 条提示词' }).props.value).toBe('第二条提示词')
  })

  it('keeps collection creation separate from the single prompt add action', async () => {
    const storedRun = createPromptRun('run-actions', '操作提示词集')
    dbMocks.getAllSopBatchSnapshots.mockResolvedValue([storedRun])

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" onClose={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(renderer!.root.findAllByProps({ 'aria-label': '新建提示词集' })).toHaveLength(1)
    expect(renderer!.root.findAllByProps({ 'aria-label': '新增提示词' })).toHaveLength(1)

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '新增提示词' }).props.onClick()
      await Promise.resolve()
    })

    expect(renderer!.root.findAllByProps({ 'data-slot': 'item' })).toHaveLength(2)
    expect(renderer!.root.findByProps({ 'aria-label': '第 2 条提示词' })).toBeTruthy()
  })

  it('creates and persists an independent prompt collection without an SOP', async () => {
    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" onClose={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    const dialog = renderer!.root.findByProps({ role: 'dialog', 'aria-labelledby': 'gallery-sop-title' })
    expect(dialog.props.style).toMatchObject({
      height: 'min(88vh, 900px)',
      maxWidth: 'min(98vw, 1560px)',
    })

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '新建提示词集' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(dbMocks.putSopBatchSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '未命名提示词集',
        sop: expect.objectContaining({ id: 'prompt-library', name: '独立提示词集' }),
        status: 'ready',
      }),
    )
    expect(renderer!.root.findByProps({ 'aria-label': '提示词集名称' }).props.value).toBe('未命名提示词集')
    expect(renderer!.root.findByProps({ 'aria-label': '第 1 条提示词' })).toBeTruthy()
  })

  it('toggles and persists the prompt management large modal mode', async () => {
    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" onClose={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    act(() => {
      renderer!.root.findByProps({ 'aria-label': '进入 提示词管理大弹窗模式' }).props.onClick()
    })
    expect(
      renderer!.root.findByProps({ role: 'dialog', 'aria-labelledby': 'gallery-sop-title' }).props.style,
    ).toMatchObject({
      width: '80vw',
      height: '80vh',
      maxWidth: 'none',
    })

    act(() => renderer!.unmount())
    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" onClose={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)
    expect(renderer!.root.findByProps({ 'aria-label': '退出 提示词管理大弹窗模式' }).props['aria-pressed']).toBe(true)
  })

  it('keeps the current prompt set in history when generating a new version', async () => {
    const storedRun: SopBatchSnapshot = {
      id: 'sop-run-current',
      batchId: '',
      workspaceTabId: 'tab-a',
      createdAt: 10,
      updatedAt: 20,
      status: 'ready',
      sop: { id: 'sop-1', name: '商品图 SOP', description: '', content: '生成商品图。' },
      brief: '当前要求',
      referenceImageIds: [],
      promptCount: 1,
      imagesPerPrompt: 1,
      prompts: [{ id: 'prompt-current', text: '原提示词', origin: 'ai', edited: false, sourceId: 'text-to-image' }],
      params: { ...DEFAULT_PARAMS },
    }
    window.localStorage.setItem(
      getGallerySopPromptRunStorageKey('tab-a'),
      JSON.stringify({
        version: 4,
        activeRunId: storedRun.id,
        selectedSopId: 'sop-1',
        promptCount: 1,
        imagesPerPrompt: 1,
        availablePrompts: 1,
      }),
    )
    dbMocks.getAllSopBatchSnapshots.mockResolvedValue([storedRun])
    dbMocks.getSopBatchSnapshot.mockResolvedValue(storedRun)
    generateMocks.generatePromptsFromSopStore.mockResolvedValue(['新提示词'])

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" onClose={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    const regenerateButton = renderer!.root.findByProps({ 'aria-label': '再次生成 1 条 SOP 提示词' })
    await act(async () => {
      regenerateButton.props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    // 「再次生成提示词」是明确的重新生成意图，无需二次确认
    expect(storeState.setConfirmDialog).not.toHaveBeenCalled()
    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenCalledOnce()
    expect(renderer!.root.findByProps({ 'aria-label': '第 1 条提示词' }).props.value).toBe('新提示词')
    const pointer = JSON.parse(window.localStorage.getItem(getGallerySopPromptRunStorageKey('tab-a')) ?? '{}')
    expect(pointer.activeRunId).not.toBe(storedRun.id)
  })

  it('does not restore prompts or parameters saved by a different SOP', async () => {
    const previousRun: SopBatchSnapshot = {
      id: 'sop-run-previous',
      batchId: '',
      workspaceTabId: 'tab-a',
      createdAt: 10,
      status: 'ready',
      sop: { id: 'sop-1', name: '商品图 SOP', description: '', content: '生成商品图。' },
      brief: '旧 SOP 要求',
      referenceImageIds: [],
      promptCount: 80,
      imagesPerPrompt: 4,
      prompts: [{ id: 'prompt-old', text: '旧 SOP 提示词', origin: 'ai', edited: false }],
      params: { ...DEFAULT_PARAMS, n: 4 },
    }
    window.localStorage.setItem(
      getGallerySopPromptRunStorageKey('tab-a'),
      JSON.stringify({
        version: 4,
        activeRunId: previousRun.id,
        selectedSopId: 'sop-1',
        promptCount: 80,
        imagesPerPrompt: 4,
        availablePrompts: 1,
      }),
    )
    dbMocks.getAllSopBatchSnapshots.mockResolvedValue([previousRun])
    dbMocks.getSopBatchSnapshot.mockResolvedValue(previousRun)
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-2" onClose={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(renderer!.root.findAllByProps({ 'aria-label': '第 1 条提示词' })).toHaveLength(0)
    expect(renderer!.root.findByProps({ 'aria-label': '生成 5 条 SOP 提示词' })).toBeTruthy()
    expect(storeState.setParams).not.toHaveBeenCalled()
  })

  it('generates and dispatches prompts sequentially, then resets for the next run', async () => {
    const events: string[] = []
    storeState.inputImages = [{ id: 'image-1', dataUrl: 'data:image/png;base64,one' }]
    generateMocks.generatePromptsFromSopStore.mockImplementation(async (_sop, _quantity, _brief, options) => {
      events.push('generate-1')
      await options.onBatch?.(['第一条提示词'], 1, 2)
      events.push('generate-2')
      await options.onBatch?.(['第二条提示词'], 2, 2)
      return ['第一条提示词', '第二条提示词']
    })
    storeMocks.submitTaskWithData.mockImplementation(async ({ prompt }) => {
      events.push(`dispatch-${prompt}`)
      return prompt === '第一条提示词' ? 'task-1' : 'task-2'
    })
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          initialPromptCount={2}
          initialAutoGenerate
          initialSecondReference
          autoStart
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenCalledOnce()
    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sop-1' }),
      2,
      '',
      expect.objectContaining({ maxBatchSize: 1, onBatch: expect.any(Function) }),
    )
    expect(events).toEqual(['generate-1', 'dispatch-第一条提示词', 'generate-2', 'dispatch-第二条提示词'])
    expect(storeMocks.submitTaskWithData).toHaveBeenCalledTimes(2)
    expect(storeMocks.submitTaskWithData.mock.calls[0][0].sopBatch).toMatchObject({ promptIndex: 1, promptCount: 2 })
    expect(storeMocks.submitTaskWithData.mock.calls[1][0].sopBatch).toMatchObject({ promptIndex: 2, promptCount: 2 })
    expect(storeMocks.submitTaskWithData.mock.calls[0][0].sopBatch.batchId).toBe(
      storeMocks.submitTaskWithData.mock.calls[1][0].sopBatch.batchId,
    )
    expect(renderer!.root.findAllByProps({ 'aria-label': '第 1 条提示词' })).toHaveLength(0)
    expect(renderer!.root.findByProps({ 'aria-label': '生成 2 条 SOP 提示词' }).props.disabled).toBe(false)
    expect(
      renderer!.root.findAllByType('p').some((node) => String(node.children.join('')).includes('当前 SOP：商品图 SOP')),
    ).toBe(true)
    expect(storeState.inputImages).toEqual([{ id: 'image-1', dataUrl: 'data:image/png;base64,one' }])
    expect(JSON.parse(window.localStorage.getItem(getGallerySopPromptRunStorageKey('tab-a')) ?? '{}')).toMatchObject({
      selectedSopId: 'sop-1',
      availablePrompts: 0,
    })
  })

  it('continues the progressive run when one image task fails to dispatch', async () => {
    generateMocks.generatePromptsFromSopStore.mockImplementation(async (_sop, _quantity, _brief, options) => {
      await options.onBatch?.(['会失败的提示词'], 1, 2)
      await options.onBatch?.(['会成功的提示词'], 2, 2)
      return ['会失败的提示词', '会成功的提示词']
    })
    storeMocks.submitTaskWithData.mockRejectedValueOnce(new Error('图片接口暂时不可用')).mockResolvedValueOnce('task-2')
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          initialPromptCount={2}
          initialAutoGenerate
          autoStart
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(storeMocks.submitTaskWithData).toHaveBeenCalledTimes(2)
    expect(renderer!.root.findByProps({ 'aria-label': '第 1 条提示词' }).props.value).toBe('会失败的提示词')
    selectPrompt(renderer!, 2)
    expect(renderer!.root.findByProps({ 'aria-label': '第 2 条提示词' }).props.value).toBe('会成功的提示词')
    expect(
      renderer!.root
        .findAllByProps({ role: 'alert' })
        .some((node) => String(node.children.join('')).includes('部分提示词未创建生图任务')),
    ).toBe(true)
  })

  it('generates and submits each prompt with only its corresponding reference image', async () => {
    storeState.inputImages = [
      { id: 'image-1', dataUrl: 'data:image/png;base64,one' },
      { id: 'image-2', dataUrl: 'data:image/png;base64,two' },
    ]
    generateMocks.generatePromptsFromSopStore.mockImplementation(async (_sop, _quantity, _brief, options) => [
      `${options.context.sourceLabel}提示词`,
    ])
    storeMocks.submitTaskWithData.mockResolvedValueOnce('task-1').mockResolvedValueOnce('task-2')
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          initialPromptCount={2}
          initialImagesPerPrompt={2}
          initialBrief="夏日清爽，不要人物"
          initialSecondReference
          autoStart
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'sop-1' }),
      1,
      '夏日清爽，不要人物',
      expect.objectContaining({
        referenceImages: [{ name: '图1', dataUrl: 'data:image/png;base64,one' }],
      }),
    )
    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'sop-1' }),
      1,
      '夏日清爽，不要人物',
      expect.objectContaining({
        referenceImages: [{ name: '图2', dataUrl: 'data:image/png;base64,two' }],
      }),
    )
    const firstReferenceButton = renderer!.root.findByProps({ title: '图1 · 点击查看大图' })
    expect(renderer!.root.findAllByProps({ title: '图2 · 点击查看大图' })).toHaveLength(0)
    expect(renderer!.root.findAllByProps({ 'aria-label': '查看第 1 条提示词的参考图 1 大图' })).toHaveLength(1)
    expect(renderer!.root.findAllByProps({ 'aria-label': '查看第 1 条提示词的参考图 2 大图' })).toHaveLength(0)

    act(() => firstReferenceButton.props.onClick())
    expect(renderer!.root.findByProps({ 'aria-labelledby': 'gallery-sop-reference-preview-title' })).toBeTruthy()
    expect(renderer!.root.findAllByProps({ alt: '图1' })).toHaveLength(3)

    act(() => renderer!.root.findByProps({ 'aria-label': '关闭参考图大图预览' }).props.onClick())
    expect(renderer!.root.findAllByProps({ 'aria-label': '关闭参考图大图预览' })).toHaveLength(0)

    selectPrompt(renderer!, 2)
    expect(renderer!.root.findByProps({ title: '图2 · 点击查看大图' })).toBeTruthy()
    expect(renderer!.root.findByProps({ 'aria-label': '查看第 2 条提示词的参考图 1 大图' })).toBeTruthy()

    const startButton = renderer!.root
      .findAllByType('button')
      .find((button) => button.props['aria-label'] === '生成 4 张图片')
    await act(async () => {
      startButton!.props.onClick()
      await Promise.resolve()
    })

    expect(storeMocks.submitTaskWithData).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        inputImages: [{ id: 'image-1', dataUrl: 'data:image/png;base64,one' }],
        params: expect.objectContaining({ n: 2, reference_mode: 'cycle' }),
      }),
      { silentSuccess: true },
    )
    expect(storeMocks.submitTaskWithData).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        inputImages: [{ id: 'image-2', dataUrl: 'data:image/png;base64,two' }],
        params: expect.objectContaining({ n: 2, reference_mode: 'cycle' }),
      }),
      { silentSuccess: true },
    )
    expect(dbMocks.putSopBatchSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        brief: '夏日清爽，不要人物',
        referenceImageIds: ['image-1', 'image-2'],
        promptCount: 2,
        imagesPerPrompt: 2,
        prompts: [
          expect.objectContaining({ referenceImageIds: ['image-1'] }),
          expect.objectContaining({ referenceImageIds: ['image-2'] }),
        ],
        params: expect.objectContaining({ n: 2, reference_mode: 'cycle' }),
      }),
    )
  })

  it('supports more than sixteen references without combining them', async () => {
    storeState.inputImages = Array.from({ length: 17 }, (_, index) => ({
      id: `image-${index + 1}`,
      dataUrl: `data:image/png;base64,image-${index + 1}`,
    }))
    generateMocks.generatePromptsFromSopStore.mockImplementation(async (_sop, _quantity, _brief, options) => [
      `${options.context.sourceLabel}提示词`,
    ])
    storeMocks.submitTaskWithData.mockResolvedValue('task-1')
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          initialPromptCount={17}
          initialSecondReference
          autoStart
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenCalledTimes(17)
    expect(
      generateMocks.generatePromptsFromSopStore.mock.calls.every((call) => call[3].referenceImages?.length === 1),
    ).toBe(true)

    const startButton = renderer!.root
      .findAllByType('button')
      .find((button) => button.props['aria-label'] === '生成 17 张图片')
    await act(async () => {
      startButton!.props.onClick()
      await Promise.resolve()
    })

    expect(storeMocks.submitTaskWithData).toHaveBeenCalledTimes(17)
    expect(storeMocks.submitTaskWithData.mock.calls.every((call) => call[0].inputImages.length === 1)).toBe(true)
  })

  it('fixes the batch-start project folder on every submitted task instead of following folder switches', async () => {
    const { useAssetLibraryStore } = await import('../../assetLibrary/store')
    const previousScope = useAssetLibraryStore.getState().scope
    try {
      useAssetLibraryStore.setState({ scope: { kind: 'collection', id: 'col-start-folder' } })
      storeState.inputImages = [{ id: 'image-1', dataUrl: 'data:image/png;base64,one' }]
      generateMocks.generatePromptsFromSopStore.mockResolvedValue(['固定文件夹提示词'])
      storeMocks.submitTaskWithData.mockResolvedValue('task-1')
      let renderer: ReturnType<typeof create>

      await act(async () => {
        renderer = create(
          <GallerySopBatchModal
            workspaceTabId="tab-a"
            initialSopId="sop-1"
            initialPromptCount={1}
            autoStart
            onClose={vi.fn()}
          />,
        )
        await Promise.resolve()
        await Promise.resolve()
      })
      mountedRenderers.push(renderer!)

      // 批次启动后用户切到别的文件夹（模拟生成过程中切换）
      useAssetLibraryStore.setState({ scope: { kind: 'collection', id: 'col-switched-mid-batch' } })

      const startButton = renderer!.root
        .findAllByType('button')
        .find((button) => button.props['aria-label'] === '生成 1 张图片')
      await act(async () => {
        startButton!.props.onClick()
        await Promise.resolve()
      })

      // 提交的任务应固定使用批次启动时的文件夹
      expect(storeMocks.submitTaskWithData).toHaveBeenCalledWith(
        expect.objectContaining({ defaultCollectionId: 'col-start-folder' }),
        { silentSuccess: true },
      )
    } finally {
      useAssetLibraryStore.setState({ scope: previousScope })
    }
  })

  it('uses references for prompt generation only when second reference is off', async () => {
    storeState.inputImages = [{ id: 'image-1', dataUrl: 'data:image/png;base64,one' }]
    generateMocks.generatePromptsFromSopStore.mockResolvedValue(['仅提示词阶段参考'])
    storeMocks.submitTaskWithData.mockResolvedValue('task-1')
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          initialPromptCount={1}
          autoStart
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sop-1' }),
      1,
      '',
      expect.objectContaining({
        referenceImages: [{ name: '图1', dataUrl: 'data:image/png;base64,one' }],
      }),
    )

    const startButton = renderer!.root
      .findAllByType('button')
      .find((button) => button.props['aria-label'] === '生成 1 张图片')
    await act(async () => {
      startButton!.props.onClick()
      await Promise.resolve()
    })

    expect(storeMocks.submitTaskWithData).toHaveBeenCalledWith(expect.objectContaining({ inputImages: [] }), {
      silentSuccess: true,
    })
  })

  it('submits a high-volume SOP batch without a confirmation popup', async () => {
    generateMocks.generatePromptsFromSopStore.mockResolvedValue(['高数量提示词'])
    storeMocks.submitTaskWithData.mockResolvedValue('task-1')
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          initialPromptCount={1}
          initialImagesPerPrompt={20}
          autoStart
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    const startButton = renderer!.root
      .findAllByType('button')
      .find((button) => button.props['aria-label'] === '生成 20 张图片')
    await act(async () => {
      startButton!.props.onClick()
      await Promise.resolve()
    })

    expect(storeState.setConfirmDialog).not.toHaveBeenCalled()
    expect(storeMocks.submitTaskWithData).toHaveBeenCalledOnce()
  })
})

describe('GallerySopBatchModal folder isolation', () => {
  it('keeps separate prompt runs per folder within the same workspace tab', async () => {
    generateMocks.generatePromptsFromSopStore.mockResolvedValue(['文件夹A的提示词'])
    let rendererA: ReturnType<typeof create>
    await act(async () => {
      rendererA = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          folderKey="folder-a"
          initialSopId="sop-1"
          initialPromptCount={1}
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
    })
    mountedRenderers.push(rendererA!)

    const keyA = getGallerySopPromptRunStorageKey('tab-a', 'folder-a')
    const keyB = getGallerySopPromptRunStorageKey('tab-a', 'folder-b')

    await act(async () => {
      rendererA!.root.findByProps({ 'aria-label': '生成 1 条 SOP 提示词' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    // 草稿写入 folder-a 的独立 key;folder-b 没有该数据
    expect(JSON.parse(window.localStorage.getItem(keyA) ?? '{}')).toMatchObject({
      selectedSopId: 'sop-1',
      availablePrompts: 1,
    })
    expect(window.localStorage.getItem(keyB)).toBeNull()

    // 同标签页另一个文件夹:独立实例与草稿,不继承 folder-a 的提示词
    let rendererB: ReturnType<typeof create>
    await act(async () => {
      rendererB = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          folderKey="folder-b"
          initialSopId="sop-2"
          initialPromptCount={1}
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
    })
    mountedRenderers.push(rendererB!)
    expect(rendererB!.root.findAllByProps({ 'aria-label': '第 1 条提示词' })).toHaveLength(0)
    // folder-a 的草稿保持完好
    expect(JSON.parse(window.localStorage.getItem(keyA) ?? '{}')).toMatchObject({
      selectedSopId: 'sop-1',
      availablePrompts: 1,
    })
  })
})
