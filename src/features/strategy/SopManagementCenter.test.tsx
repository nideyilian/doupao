/* @vitest-environment jsdom */

import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import SopManagementCenter from './SopManagementCenter'
import type { GenerateSop } from './sopGeneration'
import type { SopGroup, SopLibraryItem, SopMetaInstruction, SopVersion } from './types'
import type { SopGenerationRecord } from '../../types'
import { DEFAULT_PARAMS, type TaskRecord } from '../../types'

const imageStoreMocks = vi.hoisted(() => ({
  ensureImageThumbnailCached: vi.fn().mockResolvedValue(undefined),
  subscribeImageThumbnail: vi.fn(() => () => {}),
  showToast: vi.fn(),
  useStore: vi.fn((selector: (state: unknown) => unknown) =>
    selector({
      settings: {
        agentShareApiParameters: false,
        agentProfile: {
          id: 'agent-test',
          name: 'Agent 测试',
          provider: 'openai',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'test-key',
          model: 'gpt-agent-test',
          apiMode: 'responses',
        },
      },
      showToast: imageStoreMocks.showToast,
    }),
  ),
}))
const agentApiMocks = vi.hoisted(() => ({
  transformSopDocument: vi.fn(),
  reviseSopDocument: vi.fn(),
  reviseSopMetaInstruction: vi.fn(),
}))
const dbMocks = vi.hoisted(() => ({
  getAllSopBatchSnapshots: vi.fn().mockResolvedValue([]),
  getAllSopGenerationRecords: vi.fn().mockResolvedValue([]),
  putSopGenerationRecord: vi.fn().mockResolvedValue('record-id'),
}))

vi.mock('../../store', () => imageStoreMocks)
vi.mock('../../lib/agentApi', () => agentApiMocks)
vi.mock('../../lib/db', () => dbMocks)
vi.mock('../../lib/canvasImage', () => ({
  createImageThumbnailDataUrl: vi.fn(async (dataUrl: string) => dataUrl),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  vi.useRealTimers()
  window.localStorage.clear()
  vi.clearAllMocks()
  dbMocks.getAllSopBatchSnapshots.mockResolvedValue([])
  dbMocks.getAllSopGenerationRecords.mockResolvedValue([])
  dbMocks.putSopGenerationRecord.mockResolvedValue('record-id')
})

const item: SopLibraryItem = {
  id: 'sop-1',
  name: '商品图 SOP',
  description: '生成统一风格商品图',
  content: '保持构图一致并替换主体。',
  source: 'manual',
  createdBy: 'user-1',
  createdAt: 1,
  updatedAt: 1,
}

const item2: SopLibraryItem = {
  id: 'sop-2',
  name: '详情页 SOP',
  description: '生成详情页场景',
  content: '使用明亮背景并突出卖点。',
  source: 'manual',
  createdBy: 'user-1',
  createdAt: 2,
  updatedAt: 2,
}

const imagePromptMeta: SopMetaInstruction = {
  id: 'meta-image-prompt',
  name: '图片画风多变体 SOP 编译器',
  description: '根据多张参考图生成 SOP',
  instruction: '分析全部参考图片并输出结构化 SOP。',
  kind: 'image-prompt',
  createdAt: 1,
  updatedAt: 1,
}

const generalMeta: SopMetaInstruction = {
  ...imagePromptMeta,
  id: 'meta-general',
  name: '通用 SOP 编译器',
  kind: 'general',
}

const promptReverseMeta: SopMetaInstruction = {
  ...generalMeta,
  id: 'meta-prompt-reverse',
  name: '提示词反推 SOP 编译器',
  instruction: '把提示词当作样本，反推出可复用 SOP。',
  kind: 'prompt-reverse',
}

function textContent(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : textContent(child))).join('')
}

function findButton(root: ReactTestInstance, label: string) {
  return root.findAllByType('button').find((button) => textContent(button).includes(label))
}

function openMoreSopActions(root: ReactTestInstance) {
  act(() => root.findByProps({ 'aria-label': '更多 SOP 操作' }).props.onClick())
}

function renderCenter(
  options: {
    selectedSopId?: string
    tasks?: TaskRecord[]
    groups?: SopGroup[]
    items?: SopLibraryItem[]
    metaInstructions?: SopMetaInstruction[]
    sopVersionHistory?: Record<string, SopVersion[]>
    onGenerateSop?: GenerateSop
    onTestSopRevision?: (item: SopLibraryItem) => Promise<void>
  } = {},
) {
  const onSaveItem = vi.fn()
  const onSaveMetaInstruction = vi.fn()
  const onApply = vi.fn()
  const renderer = create(
    <SopManagementCenter
      groups={options.groups ?? []}
      items={options.items ?? [item]}
      tasks={options.tasks}
      metaInstructions={options.metaInstructions ?? []}
      currentUserId="user-1"
      onSaveGroup={vi.fn()}
      onDuplicateGroup={vi.fn(() => null)}
      onDeleteGroup={vi.fn()}
      onSaveItem={onSaveItem}
      onDuplicateItem={vi.fn(() => null)}
      onDeleteItem={vi.fn()}
      onSaveMetaInstruction={onSaveMetaInstruction}
      onDuplicateMetaInstruction={vi.fn(() => null)}
      onDeleteMetaInstruction={vi.fn()}
      onGenerateSop={options.onGenerateSop ?? vi.fn()}
      onTestSopRevision={options.onTestSopRevision}
      selectedSopId={options.selectedSopId}
      onApply={onApply}
      onClear={vi.fn()}
      sopVersionHistory={options.sopVersionHistory ?? {}}
      onClose={vi.fn()}
    />,
  )
  return { renderer, onApply, onSaveItem, onSaveMetaInstruction }
}

describe('SopManagementCenter apply and save actions', () => {
  it('toggles and persists the SOP management large modal mode', () => {
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter()
    })

    const defaultDialog = result.renderer.root.find((node) =>
      String(node.props.className).includes('sop-center-dialog'),
    )
    expect(defaultDialog.props.style).toBeUndefined()

    act(() => {
      result.renderer.root.findByProps({ 'aria-label': '进入 SOP 管理中心大弹窗模式' }).props.onClick()
    })
    expect(
      result.renderer.root.find((node) => String(node.props.className).includes('sop-center-dialog')).props.style,
    ).toMatchObject({
      width: '80vw',
      height: '80vh',
      maxWidth: 'none',
    })

    act(() => result.renderer.unmount())
    act(() => {
      result = renderCenter()
    })
    expect(
      result.renderer.root.findByProps({ 'aria-label': '退出 SOP 管理中心大弹窗模式' }).props['aria-pressed'],
    ).toBe(true)
    result.renderer.unmount()
  })

  it('applies an existing SOP directly without requiring an edit save', () => {
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter()
    })

    const applyButton = findButton(result.renderer.root, '应用 SOP')
    expect(applyButton?.props.disabled).toBe(false)
    expect(findButton(result.renderer.root, '保存修改')?.props.disabled).toBe(true)

    act(() => applyButton!.props.onClick())

    expect(result.onApply).toHaveBeenCalledWith(expect.objectContaining({ id: item.id, name: item.name }))
    expect(result.onSaveItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: item.id, lastUsedAt: expect.any(Number) }),
    )
    result.renderer.unmount()
  })

  it('separates unsaved edits from applying the persisted SOP', () => {
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter()
    })

    const nameInput = result.renderer.root.findAllByType('input').find((input) => input.props.value === item.name)
    act(() => nameInput!.props.onChange({ target: { value: '新版商品图 SOP' } }))

    expect(findButton(result.renderer.root, '应用 SOP')?.props.disabled).toBe(true)
    const saveButton = findButton(result.renderer.root, '保存修改')
    expect(saveButton?.props.disabled).toBe(false)

    act(() => saveButton!.props.onClick())

    expect(result.onSaveItem).toHaveBeenCalledWith(expect.objectContaining({ id: item.id, name: '新版商品图 SOP' }))
    expect(result.onApply).not.toHaveBeenCalled()
    result.renderer.unmount()
  })

  it('automatically saves valid SOP edits after the debounce delay', () => {
    vi.useFakeTimers()
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter()
    })

    const nameInput = result.renderer.root.findAllByType('input').find((input) => input.props.value === item.name)
    act(() => nameInput!.props.onChange({ target: { value: '自动保存商品图 SOP' } }))

    expect(result.onSaveItem).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(799)
    })
    expect(result.onSaveItem).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.onSaveItem).toHaveBeenCalledOnce()
    expect(result.onSaveItem).toHaveBeenCalledWith(
      expect.objectContaining({
        id: item.id,
        name: '自动保存商品图 SOP',
        updatedAt: expect.any(Number),
      }),
    )
    expect(textContent(result.renderer.root)).toContain('修改已自动保存')
    result.renderer.unmount()
  })

  it('flushes a pending automatic save before switching SOPs', () => {
    vi.useFakeTimers()
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter({ items: [item, item2] })
    })

    const nameInput = result.renderer.root.findAllByType('input').find((input) => input.props.value === item.name)
    act(() => nameInput!.props.onChange({ target: { value: '切换前保存的 SOP' } }))
    act(() => result.renderer.root.findByProps({ title: item2.name }).props.onClick())

    expect(result.onSaveItem).toHaveBeenCalledOnce()
    expect(result.onSaveItem).toHaveBeenCalledWith(
      expect.objectContaining({
        id: item.id,
        name: '切换前保存的 SOP',
      }),
    )
    expect(result.renderer.root.findByProps({ 'aria-label': 'SOP 正文' }).props.value).toBe(item2.content)

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.onSaveItem).toHaveBeenCalledOnce()
    result.renderer.unmount()
  })

  it('shows the currently selected SOP as already applied', () => {
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter({ selectedSopId: item.id })
    })

    expect(findButton(result.renderer.root, '已使用')?.props.disabled).toBe(true)
    expect(findButton(result.renderer.root, '保存修改')?.props.disabled).toBe(true)
    result.renderer.unmount()
  })

  it('selects and shows the applied SOP in the editor when applying from the list row', () => {
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter({ items: [item, item2] })
    })

    const rowApplyButton = result.renderer.root.findByProps({ 'aria-label': `应用 ${item2.name}` })
    act(() => rowApplyButton.props.onClick())

    expect(result.onApply).toHaveBeenCalledWith(expect.objectContaining({ id: item2.id, name: item2.name }))
    expect(result.onSaveItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: item2.id, lastUsedAt: expect.any(Number) }),
    )
    expect(result.renderer.root.findAllByType('textarea').some((input) => input.props.value === item2.content)).toBe(
      true,
    )
    result.renderer.unmount()
  })

  it('uses the first five generated images as a stacked list cover and opens cover selection by double-clicking it', () => {
    const generatedTask: TaskRecord = {
      id: 'task-1',
      prompt: '生成结果',
      params: { ...DEFAULT_PARAMS },
      inputImageIds: [],
      outputImages: ['image-1', 'image-2', 'image-3', 'image-4', 'image-5', 'image-6'],
      status: 'done',
      error: null,
      createdAt: 2,
      finishedAt: 3,
      elapsed: 1,
      sopBatch: { batchId: 'batch-1', sopId: item.id, sopName: item.name, promptIndex: 1, promptCount: 1 },
    }
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter({ tasks: [generatedTask] })
    })

    const coverButton = result.renderer.root.findByProps({ 'aria-label': `选择 ${item.name}` })
    expect(
      result.renderer.root.findAll((node) => typeof node.props['data-sop-image-stack-layer'] === 'string'),
    ).toHaveLength(5)
    expect(result.renderer.root.findAll((node) => node.props['data-sop-image-stack-plus'])).toHaveLength(0)
    const stackButton = result.renderer.root.findByProps({ 'data-sop-image-stack': item.id })
    expect(stackButton.props.onPointerEnter).toBeTypeOf('function')
    expect(stackButton.props.onPointerMove).toBeTypeOf('function')
    expect(result.renderer.root.findAllByProps({ 'aria-label': 'SOP 封面' })).toHaveLength(0)
    expect(
      result.renderer.root.findAll((node) => String(node.props.className).includes('sop-center-badge')),
    ).toHaveLength(0)

    act(() => coverButton.props.onDoubleClick({ stopPropagation: vi.fn() }))
    expect(result.renderer.root.findByProps({ 'aria-labelledby': 'sop-cover-picker-title' })).toBeTruthy()
    const candidate = result.renderer.root.findByProps({ 'aria-label': '选择第 1 条提示词的第 1 张图片作为封面' })
    act(() => candidate.props.onClick())
    expect(result.renderer.root.findByProps({ 'data-sop-cover-image-id': 'image-1' })).toBeTruthy()

    const saveButton = findButton(result.renderer.root, '保存修改')
    expect(saveButton?.props.disabled).toBe(false)
    act(() => saveButton!.props.onClick())

    expect(result.onSaveItem).toHaveBeenCalledWith(
      expect.objectContaining({
        id: item.id,
        coverImageId: 'image-1',
      }),
    )
    result.renderer.unmount()
  })

  it('renders SOP rows with parameters and omits the description editor', () => {
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter()
    })

    expect(result.renderer.root.findByProps({ role: 'listitem' }).props.className).toContain('sop-center-sop-row')
    expect(textContent(result.renderer.root.findByProps({ 'aria-label': 'SOP 参数' }))).toContain('未分组')
    const parameters = textContent(result.renderer.root.findByProps({ 'aria-label': 'SOP 参数' }))
    expect(parameters).not.toContain('手动创建')
    expect(parameters).not.toContain('历史预设')
    expect(result.renderer.root.findByProps({ 'aria-label': `${item.name} 操作` })).toBeTruthy()
    expect(result.renderer.root.findByProps({ 'aria-label': 'SOP 正文编辑器' })).toBeTruthy()
    expect(
      result.renderer.root
        .findAllByType('section')
        .some((node) => String(node.props.className).includes('ds-dialog-pane--scroll')),
    ).toBe(true)
    expect(
      result.renderer.root.find((node) => String(node.props.className).includes('sop-center-editor-card')).props
        .className,
    ).toContain('flex-1')
    expect(result.renderer.root.findByProps({ 'aria-label': '正文格式与编辑工具' })).toBeTruthy()
    expect(result.renderer.root.findByProps({ 'aria-label': '自动分段' })).toBeTruthy()
    expect(result.renderer.root.findByProps({ 'aria-label': '清理粘贴' })).toBeTruthy()
    expect(result.renderer.root.findByProps({ 'aria-label': '关闭自动换行' })).toBeTruthy()
    expect(result.renderer.root.findByProps({ 'aria-label': '复制正文' })).toBeTruthy()
    expect(findButton(result.renderer.root, 'AI 检查')).toBeTruthy()
    expect(findButton(result.renderer.root, '最小化')).toBeUndefined()
    // AI 对话常驻右侧:正文编辑区 + 对话输入区两个 textarea
    expect(result.renderer.root.findAllByType('textarea')).toHaveLength(2)
    expect(result.renderer.root.findAllByType('textarea').some((input) => input.props.value === item.content)).toBe(
      true,
    )
    expect(result.renderer.root.findAllByProps({ 'aria-label': 'SOP AI 对话优化' })).toHaveLength(1)
    expect(result.renderer.root.findAll((node) => node.children.includes(item.description))).toHaveLength(1)
    expect(
      result.renderer.root.findAll((node) => String(node.props.className).includes('sop-center-sop-description')),
    ).toHaveLength(1)
    result.renderer.unmount()
  })

  it('uses shared design-system controls and workspace panes', () => {
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter()
    })

    const hostNodes = result.renderer.root.findAll((node) => typeof node.type === 'string')
    expect(hostNodes.some((node) => String(node.props.className).includes('ds-tabs'))).toBe(true)
    expect(hostNodes.some((node) => String(node.props.className).includes('ds-dialog-workspace--triple'))).toBe(true)
    expect(
      hostNodes.filter((node) => String(node.props.className).includes('ds-dialog-pane')).length,
    ).toBeGreaterThanOrEqual(3)
    expect(hostNodes.some((node) => String(node.props.className).includes('ds-search__input'))).toBe(true)
    expect(hostNodes.some((node) => String(node.props.className).includes('ds-select__control'))).toBe(true)
    expect(hostNodes.some((node) => String(node.props.className).includes('ds-input'))).toBe(true)

    result.renderer.unmount()
  })

  it('lets the meta-instruction body fill the remaining editor height without collapsing', () => {
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter({ metaInstructions: [imagePromptMeta] })
    })

    act(() => findButton(result.renderer.root, '生成元指令')!.props.onClick())

    const editor = result.renderer.root.find((node) => String(node.props.className).includes('sop-center-meta-editor'))
    const instruction = result.renderer.root
      .findAllByType('textarea')
      .find((textarea) => textarea.props.value === imagePromptMeta.instruction)
    expect(editor.props.className).toContain('flex-1')
    expect(instruction?.props.className).toContain('sop-center-meta-instruction-input')
    expect(instruction?.parent?.props.className).toContain('sop-center-meta-instruction-field')
    result.renderer.unmount()
  })

  it('provides working formatting, history, wrapping, and fullscreen editor controls', () => {
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter()
    })

    const headingButton = result.renderer.root.findByProps({ 'aria-label': '设为标题' })
    act(() => headingButton.props.onClick())
    expect(result.renderer.root.findByProps({ 'aria-label': 'SOP 正文' }).props.value).toBe(`# ${item.content}`)

    const undoButton = result.renderer.root.findByProps({ 'aria-label': '撤销' })
    expect(undoButton.props.disabled).toBe(false)
    act(() => undoButton.props.onClick())
    expect(result.renderer.root.findByProps({ 'aria-label': 'SOP 正文' }).props.value).toBe(item.content)

    const wrapButton = result.renderer.root.findByProps({ 'aria-label': '关闭自动换行' })
    act(() => wrapButton.props.onClick())
    expect(result.renderer.root.findByProps({ 'aria-label': '开启自动换行' })).toBeTruthy()

    // 无全屏模式：编辑器保持单层工具栏，空间全部留给正文
    expect(findButton(result.renderer.root, '全屏编辑')).toBeUndefined()
    result.renderer.unmount()
  })

  it('runs an AI audit that reviews the SOP without rewriting it', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })
    agentApiMocks.transformSopDocument.mockResolvedValueOnce('# 检查报告\n\n- 阻断问题：无')
    let result!: ReturnType<typeof renderCenter>
    await act(async () => {
      result = renderCenter()
    })

    await act(async () => {
      findButton(result.renderer.root, 'AI 检查')!.props.onClick()
    })

    expect(agentApiMocks.transformSopDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'audit',
        content: item.content,
        profile: expect.objectContaining({ model: 'gpt-agent-test' }),
      }),
    )
    expect(
      result.renderer.root.findAll((node) => node.children.includes('# 检查报告\n\n- 阻断问题：无')),
    ).not.toHaveLength(0)
    expect(result.renderer.root.findByProps({ 'aria-label': 'SOP 正文' }).props.value).toBe(item.content)

    act(() => findButton(result.renderer.root, '复制结果')!.props.onClick())
    result.renderer.unmount()
  })

  it('keeps a persistent SOP revision conversation with apply and test-image actions', async () => {
    const onTestSopRevision = vi.fn().mockResolvedValue(undefined)
    agentApiMocks.reviseSopDocument.mockResolvedValueOnce({
      reply: '已补充验收标准并压缩重复说明。',
      content: '# 修订 SOP\n\n1. 执行\n2. 验收',
      changeSummary: ['补充验收标准', '压缩重复说明'],
    })
    let result!: ReturnType<typeof renderCenter>
    await act(async () => {
      result = renderCenter({ onTestSopRevision })
    })

    // AI 对话默认常驻右侧,无需先点「AI 对话」按钮
    const chatInput = result.renderer.root.findByProps({ 'aria-label': '向 AI 描述 SOP 修改要求' })
    act(() => chatInput.props.onChange({ target: { value: '补充可验证的验收标准' } }))
    await act(async () => {
      result.renderer.root.findByProps({ 'aria-label': '发送 SOP 修改要求' }).props.onClick()
    })

    expect(agentApiMocks.reviseSopDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        content: item.content,
        conversation: [expect.objectContaining({ role: 'user', text: '补充可验证的验收标准' })],
      }),
    )
    expect(textContent(result.renderer.root)).toContain('已补充验收标准并压缩重复说明。')
    expect(textContent(result.renderer.root)).toContain('补充验收标准')

    await act(async () => findButton(result.renderer.root, '测试生图')!.props.onClick())
    expect(onTestSopRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        id: item.id,
        content: '# 修订 SOP\n\n1. 执行\n2. 验收',
      }),
    )

    act(() => findButton(result.renderer.root, '应用到正文')!.props.onClick())
    expect(result.renderer.root.findByProps({ 'aria-label': 'SOP 正文' }).props.value).toBe(
      '# 修订 SOP\n\n1. 执行\n2. 验收',
    )

    act(() => result.renderer.unmount())
    act(() => {
      result = renderCenter({ onTestSopRevision })
    })
    expect(textContent(result.renderer.root)).toContain('已补充验收标准并压缩重复说明。')
    result.renderer.unmount()
  })

  it('keeps an AI revision running while the embedded conversation stays open', async () => {
    let finishRevision!: (value: { reply: string; content: string; changeSummary: string[] }) => void
    agentApiMocks.reviseSopDocument.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRevision = resolve
        }),
    )
    let result!: ReturnType<typeof renderCenter>
    await act(async () => {
      result = renderCenter()
    })

    const chatInput = result.renderer.root.findByProps({ 'aria-label': '向 AI 描述 SOP 修改要求' })
    act(() => chatInput.props.onChange({ target: { value: '生成可另存的新版' } }))
    act(() => result.renderer.root.findByProps({ 'aria-label': '发送 SOP 修改要求' }).props.onClick())

    // 对话侧栏常驻：请求进行中仍然可见，无「AI 对话」开关按钮
    expect(result.renderer.root.findAllByProps({ 'aria-label': '向 AI 描述 SOP 修改要求' })).toHaveLength(1)
    expect(findButton(result.renderer.root, 'AI 对话')).toBeUndefined()

    await act(async () => {
      finishRevision({
        reply: '后台新版已生成',
        content: '# 后台新版 SOP',
        changeSummary: ['后台完成'],
      })
      await Promise.resolve()
    })

    expect(textContent(result.renderer.root)).toContain('后台新版已生成')
    expect(textContent(result.renderer.root)).toContain('后台完成')
    result.renderer.unmount()
  })

  it('places save-as-new-version after copy and stores a new SOP without replacing the current one', async () => {
    agentApiMocks.reviseSopDocument.mockResolvedValueOnce({
      reply: '新版已生成',
      content: '# 另存的新版 SOP',
      changeSummary: ['更新执行步骤'],
    })
    let result!: ReturnType<typeof renderCenter>
    await act(async () => {
      result = renderCenter()
    })

    const chatInput = result.renderer.root.findByProps({ 'aria-label': '向 AI 描述 SOP 修改要求' })
    act(() => chatInput.props.onChange({ target: { value: '生成新版' } }))
    await act(async () => {
      result.renderer.root.findByProps({ 'aria-label': '发送 SOP 修改要求' }).props.onClick()
    })

    const actions = result.renderer.root.find((node) =>
      String(node.props.className).includes('sop-ai-chat__revision-actions'),
    )
    expect(actions.findAllByType('button').map(textContent)).toEqual(['测试生图', '复制', '另存为新版', '应用到正文'])

    act(() => findButton(result.renderer.root, '另存为新版')!.props.onClick())
    expect(result.onSaveItem).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.not.stringMatching(/^sop-1$/),
        name: '商品图 SOP（新版）',
        content: '# 另存的新版 SOP',
        source: 'manual',
      }),
    )
    expect(result.renderer.root.findByProps({ 'aria-label': 'SOP 正文' }).props.value).toBe(item.content)
    result.renderer.unmount()
  })

  it('optimizes a generation meta-instruction through a persistent AI conversation', async () => {
    agentApiMocks.reviseSopMetaInstruction.mockResolvedValueOnce({
      reply: '已补充输入分析与输出约束。',
      content: '分析全部输入，保留关键约束，并输出完整可执行的结构化 SOP。',
      changeSummary: ['补充输入分析要求', '明确输出完整性'],
    })
    let result!: ReturnType<typeof renderCenter>
    await act(async () => {
      result = renderCenter({ metaInstructions: [imagePromptMeta] })
    })

    act(() => findButton(result.renderer.root, '生成元指令')!.props.onClick())
    act(() => findButton(result.renderer.root, 'AI 对话')!.props.onClick())
    const chatInput = result.renderer.root.findByProps({ 'aria-label': '向 AI 描述生成元指令修改要求' })
    act(() => chatInput.props.onChange({ target: { value: '补充输入分析和输出完整性要求' } }))
    await act(async () => {
      result.renderer.root.findByProps({ 'aria-label': '发送生成元指令修改要求' }).props.onClick()
    })

    expect(agentApiMocks.reviseSopMetaInstruction).toHaveBeenCalledWith(
      expect.objectContaining({
        content: imagePromptMeta.instruction,
        conversation: [expect.objectContaining({ role: 'user', text: '补充输入分析和输出完整性要求' })],
      }),
    )
    expect(textContent(result.renderer.root)).toContain('已补充输入分析与输出约束。')
    const actions = result.renderer.root.find((node) =>
      String(node.props.className).includes('sop-ai-chat__revision-actions'),
    )
    expect(actions.findAllByType('button').map(textContent)).toEqual(['复制', '应用到元指令'])

    act(() => findButton(result.renderer.root, '应用到元指令')!.props.onClick())
    expect(
      result.renderer.root
        .findAllByType('textarea')
        .some((textarea) => textarea.props.value === '分析全部输入，保留关键约束，并输出完整可执行的结构化 SOP。'),
    ).toBe(true)

    act(() => findButton(result.renderer.root, '保存')!.props.onClick())
    expect(result.onSaveMetaInstruction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: imagePromptMeta.id,
        instruction: '分析全部输入，保留关键约束，并输出完整可执行的结构化 SOP。',
      }),
    )
    result.renderer.unmount()
  })

  it('accepts multiple dropped reference images inside an isolated drop zone', async () => {
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter({ metaInstructions: [imagePromptMeta] })
    })
    act(() => findButton(result.renderer.root, '智能生成')!.props.onClick())

    const dropZone = result.renderer.root.findByProps({ 'data-sop-reference-dropzone': true })
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    await act(async () => {
      await dropZone.props.onDrop({
        preventDefault,
        stopPropagation,
        dataTransfer: {
          types: ['Files'],
          files: [
            new File(['a'], '参考图 A.png', { type: 'image/png' }),
            new File(['b'], '参考图 B.jpg', { type: 'image/jpeg' }),
          ],
        },
      })
    })

    expect(preventDefault).toHaveBeenCalled()
    expect(stopPropagation).toHaveBeenCalled()
    expect(result.renderer.root.findAllByType('img')).toHaveLength(2)
    expect(textContent(result.renderer.root)).toContain('已添加 2 张参考图片')
    expect(result.renderer.root.findByProps({ 'data-block-global-image-input': 'true' })).toBeTruthy()
    result.renderer.unmount()
  })

  it('keeps the smart generation workspace fixed while showing the maximum image count', async () => {
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter({ metaInstructions: [imagePromptMeta] })
    })
    act(() => findButton(result.renderer.root, '智能生成')!.props.onClick())

    const workspace = result.renderer.root.findByProps({ 'data-generation-one-screen': 'true' })
    expect(String(workspace.props.className)).toContain('sop-center-generate-grid')
    workspace
      .findAll((node) => String(node.props.className).includes('ds-dialog-pane'))
      .forEach((pane) => {
        expect(String(pane.props.className)).not.toContain('ds-dialog-pane--scroll')
      })

    const dropZone = result.renderer.root.findByProps({ 'data-sop-reference-dropzone': true })
    await act(async () => {
      await dropZone.props.onDrop({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {
          types: ['Files'],
          files: Array.from(
            { length: 20 },
            (_, index) => new File([String(index)], `参考图 ${index + 1}.png`, { type: 'image/png' }),
          ),
        },
      })
    })

    expect(result.renderer.root.findByProps({ 'data-reference-count': 20 }).findAllByType('img')).toHaveLength(20)
    expect(findButton(result.renderer.root, '开始生成并保存')).toBeTruthy()
    expect(result.renderer.root.findByProps({ 'data-sop-reference-dropzone': true }).props['data-disabled']).toBe(true)
    result.renderer.unmount()
  })

  it('shows actual generation phases and keeps the success state visible', async () => {
    const onGenerateSop: GenerateSop = vi.fn(async (_brief, _context, _images, _kind, _instruction, options) => {
      options?.onProgress?.({ stage: 'prepare', message: '正在整理 2 张参考图片' })
      options?.onProgress?.({ stage: 'request', message: 'AI 正在分析参考图片并编译 SOP' })
      options?.onProgress?.({ stage: 'parse', message: '正在校验生成结果' })
      return { name: '多图商品 SOP', description: '多图说明', sop: '# SOP 正文' }
    })
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter({ metaInstructions: [generalMeta], onGenerateSop })
    })
    act(() => findButton(result.renderer.root, '智能生成')!.props.onClick())

    const brief = result.renderer.root.findByProps({ 'aria-label': 'SOP 生成说明' })
    act(() => brief.props.onChange({ target: { value: '生成商品摄影 SOP' } }))
    await act(async () => {
      await findButton(result.renderer.root, '开始生成并保存')!.props.onClick()
    })

    expect(onGenerateSop).toHaveBeenCalledWith(
      '生成商品摄影 SOP',
      {},
      [],
      'general',
      generalMeta.instruction,
      expect.objectContaining({ onProgress: expect.any(Function) }),
    )
    expect(result.onSaveItem).toHaveBeenCalledWith(expect.objectContaining({ name: '多图商品 SOP' }))
    expect(textContent(result.renderer.root)).toContain('校验生成条件')
    expect(textContent(result.renderer.root)).toContain('调用 AI 编译 SOP')
    expect(textContent(result.renderer.root)).toContain('SOP「多图商品 SOP」生成并保存成功')
    expect(findButton(result.renderer.root, '查看生成结果')).toBeTruthy()
    expect(dbMocks.putSopGenerationRecord).toHaveBeenCalledTimes(2)
    expect(dbMocks.putSopGenerationRecord).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'success',
        brief: '生成商品摄影 SOP',
        metaInstruction: expect.objectContaining({ instruction: generalMeta.instruction }),
        result: expect.objectContaining({ name: '多图商品 SOP', content: '# SOP 正文' }),
      }),
    )

    act(() => findButton(result.renderer.root, '生成记录')!.props.onClick())
    act(() => result.renderer.root.findByProps({ 'aria-label': '查看生成记录 多图商品 SOP' }).props.onClick())
    expect(
      result.renderer.root.findAll((node) => String(node.props['aria-label']).includes('生成记录详情 多图商品 SOP')),
    ).toHaveLength(1)
    expect(result.renderer.root.findByProps({ 'aria-label': '生成记录完整生成说明' }).children).toContain(
      '生成商品摄影 SOP',
    )
    expect(result.renderer.root.findByProps({ 'aria-label': '生成记录完整元指令' }).children).toContain(
      generalMeta.instruction,
    )
    expect(result.renderer.root.findByProps({ 'aria-label': '生成记录完整 SOP 正文' }).children).toContain('# SOP 正文')
    result.renderer.unmount()
  })

  it('exposes prompt reverse generation and sends samples with the dedicated kind', async () => {
    const onGenerateSop: GenerateSop = vi.fn(async () => ({
      name: '海报提示词 SOP',
      description: '从样本反推',
      sop: '# 提示词 SOP',
    }))
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter({ metaInstructions: [promptReverseMeta], onGenerateSop })
    })
    act(() => findButton(result.renderer.root, '智能生成')!.props.onClick())

    expect(textContent(result.renderer.root)).toContain('从提示词反推 SOP')
    expect(result.renderer.root.findAllByProps({ 'data-sop-reference-dropzone': true })).toHaveLength(0)
    const promptSamples = result.renderer.root.findByProps({ 'aria-label': '用于反推 SOP 的样本提示词' })
    expect(promptSamples.props.placeholder).toContain('粘贴成品提示词')
    act(() => promptSamples.props.onChange({ target: { value: '生成 {{主题}} 的极简海报' } }))
    await act(async () => {
      await findButton(result.renderer.root, '开始反推并保存')!.props.onClick()
    })

    expect(onGenerateSop).toHaveBeenCalledWith(
      '生成 {{主题}} 的极简海报',
      {},
      [],
      'prompt-reverse',
      promptReverseMeta.instruction,
      expect.objectContaining({ onProgress: expect.any(Function) }),
    )
    expect(result.onSaveItem).toHaveBeenCalledWith(expect.objectContaining({ name: '海报提示词 SOP' }))
    result.renderer.unmount()
  })

  it('creates a new SOP as ungrouped when in the favorites view', () => {
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter({ items: [item, item2] })
    })

    act(() => findButton(result.renderer.root, '收藏')!.props.onClick())
    act(() => findButton(result.renderer.root, '新建')!.props.onClick())

    const saved = result.onSaveItem.mock.calls[0]?.[0] as SopLibraryItem | undefined
    expect(saved?.groupId).toBeUndefined()
    result.renderer.unmount()
  })

  it('flushes unsaved meta-instruction edits before switching tabs', () => {
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter({ metaInstructions: [imagePromptMeta] })
    })

    act(() => findButton(result.renderer.root, '生成元指令')!.props.onClick())
    const nameInput = result.renderer.root
      .findAllByType('input')
      .find((input) => input.props.value === imagePromptMeta.name)
    act(() => nameInput!.props.onChange({ target: { value: '改名的元指令' } }))

    expect(result.onSaveMetaInstruction).not.toHaveBeenCalled()
    act(() => findButton(result.renderer.root, 'SOP 库')!.props.onClick())

    expect(result.onSaveMetaInstruction).toHaveBeenCalledWith(
      expect.objectContaining({ id: imagePromptMeta.id, name: '改名的元指令' }),
    )
    result.renderer.unmount()
  })

  it('passes an abort signal and cancels a running generation', async () => {
    const onGenerateSop: GenerateSop = vi.fn(
      (_brief, _context, _images, _kind, _instruction, options) =>
        new Promise<never>((_resolve, reject) => {
          const signal = options?.signal
          if (signal?.aborted) {
            reject(new Error('Aborted'))
            return
          }
          signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true })
        }),
    )
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter({ metaInstructions: [generalMeta], onGenerateSop })
    })
    act(() => findButton(result.renderer.root, '智能生成')!.props.onClick())
    act(() =>
      result.renderer.root
        .findByProps({ 'aria-label': 'SOP 生成说明' })
        .props.onChange({ target: { value: '生成商品 SOP' } }),
    )

    act(() => {
      findButton(result.renderer.root, '开始生成并保存')!.props.onClick()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(findButton(result.renderer.root, '取消生成')).toBeTruthy()

    act(() => {
      findButton(result.renderer.root, '取消生成')!.props.onClick()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(textContent(result.renderer.root)).toContain('生成已取消')
    result.renderer.unmount()
  })

  it('opens the cover picker from an explicit button', () => {
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter()
    })

    openMoreSopActions(result.renderer.root)
    act(() => findButton(result.renderer.root, '选择封面')!.props.onClick())
    expect(result.renderer.root.findByProps({ 'aria-labelledby': 'sop-cover-picker-title' })).toBeTruthy()
    result.renderer.unmount()
  })

  it('selects and renames a duplicated group', () => {
    const group1: SopGroup = { id: 'group-1', name: '通用', createdAt: 1, updatedAt: 1 }

    function GroupHarness() {
      const [groups, setGroups] = useState<SopGroup[]>([group1])
      return (
        <SopManagementCenter
          groups={groups}
          items={[item]}
          metaInstructions={[]}
          currentUserId="user-1"
          onSaveGroup={vi.fn()}
          onDuplicateGroup={(groupId) => {
            const source = groups.find((entry) => entry.id === groupId)
            if (!source) return null
            const newId = 'group-copy'
            setGroups((current) => [...current, { ...source, id: newId, name: `${source.name} 副本` }])
            return newId
          }}
          onDeleteGroup={vi.fn()}
          onSaveItem={vi.fn()}
          onDuplicateItem={vi.fn(() => null)}
          onDeleteItem={vi.fn()}
          onSaveMetaInstruction={vi.fn()}
          onDuplicateMetaInstruction={vi.fn(() => null)}
          onDeleteMetaInstruction={vi.fn()}
          onGenerateSop={vi.fn()}
          onTestSopRevision={undefined}
          selectedSopId={undefined}
          onApply={vi.fn()}
          onClear={vi.fn()}
          onClose={vi.fn()}
        />
      )
    }

    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<GroupHarness />)
    })

    const groupRow = renderer.root.findAll(
      (node) => typeof node.type === 'string' && String(node.props.className).includes('sop-center-group-row'),
    )[0]
    act(() =>
      groupRow.props.onContextMenu({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        clientX: 10,
        clientY: 10,
      }),
    )

    act(() => findButton(renderer.root, '复制')!.props.onClick())

    expect(renderer.root.findByProps({ 'aria-label': '重命名分组' }).props.value).toBe('通用 副本')
    renderer.unmount()
  })

  it('searches SOPs by description as well as name and content', () => {
    const described: SopLibraryItem = {
      ...item,
      id: 'sop-desc',
      name: '商品图',
      content: '保持构图一致',
      description: '独特关键词XYZ',
    }
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter({ items: [described, item2] })
    })

    const searchInput = result.renderer.root
      .findAllByType('input')
      .find((input) => input.props.placeholder === '搜索名称、说明或正文')
    act(() => searchInput!.props.onChange({ target: { value: '独特关键词XYZ' } }))

    expect(result.renderer.root.findAllByProps({ role: 'listitem' })).toHaveLength(1)
    result.renderer.unmount()
  })

  it('searches meta-instructions by name and body', () => {
    const meta2: SopMetaInstruction = { ...imagePromptMeta, id: 'meta-2', name: '另一个元指令' }
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter({ metaInstructions: [imagePromptMeta, meta2] })
    })
    act(() => findButton(result.renderer.root, '生成元指令')!.props.onClick())

    const searchInput = result.renderer.root
      .findAllByType('input')
      .find((input) => input.props.placeholder === '搜索名称、说明或正文')
    act(() => searchInput!.props.onChange({ target: { value: '另一个' } }))

    const rows = result.renderer.root.findAll(
      (node) => typeof node.type === 'string' && String(node.props.className).includes('sop-center-meta-row'),
    )
    expect(rows).toHaveLength(1)
    result.renderer.unmount()
  })

  it('accepts dropped images without a MIME type', async () => {
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter({ metaInstructions: [imagePromptMeta] })
    })
    act(() => findButton(result.renderer.root, '智能生成')!.props.onClick())

    const dropZone = result.renderer.root.findByProps({ 'data-sop-reference-dropzone': true })
    await act(async () => {
      await dropZone.props.onDrop({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: { types: ['Files'], files: [new File(['a'], '图片.png', { type: '' })] },
      })
    })

    expect(result.renderer.root.findAllByType('img')).toHaveLength(1)
    result.renderer.unmount()
  })

  it('selects multiple SOPs with Ctrl/Cmd and prepares a drag payload', () => {
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter({ items: [item, item2] })
    })

    expect(result.renderer.root.findAllByProps({ type: 'checkbox' })).toHaveLength(0)

    act(() =>
      result.renderer.root.findByProps({ title: item.name }).props.onClick({
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
      }),
    )
    act(() =>
      result.renderer.root.findByProps({ title: item2.name }).props.onClick({
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
      }),
    )

    const rows = result.renderer.root.findAllByProps({ role: 'listitem' })
    const data = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: '',
      setData: (type: string, value: string) => data.set(type, value),
    }
    act(() => rows[0].props.onDragStart({ dataTransfer }))

    expect(data.get('application/x-doupao-sop-ids')).toBe(JSON.stringify([item.id, item2.id]))
    result.renderer.unmount()
  })

  it('shows a version history entry point for an existing SOP', () => {
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter()
    })

    openMoreSopActions(result.renderer.root)
    const versionButton = findButton(result.renderer.root, '版本历史')
    expect(versionButton).toBeTruthy()
    expect(versionButton?.props.disabled).toBe(false)
    result.renderer.unmount()
  })

  it('moves the selected SOPs when they are dropped on a group', () => {
    const group: SopGroup = {
      id: 'group-image',
      name: '图片提示词',
      createdAt: 1,
      updatedAt: 1,
    }
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter({ groups: [group], items: [item, item2] })
    })

    act(() =>
      result.renderer.root.findByProps({ title: item.name }).props.onClick({
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
      }),
    )
    act(() =>
      result.renderer.root.findByProps({ title: item2.name }).props.onClick({
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
      }),
    )

    const dropTarget = result.renderer.root.findByProps({ 'data-sop-drop-group': group.id })
    act(() =>
      dropTarget.props.onDrop({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {
          getData: () => JSON.stringify([item.id, item2.id]),
        },
      }),
    )

    expect(result.onSaveItem).toHaveBeenCalledWith(expect.objectContaining({ id: item.id, groupId: group.id }))
    expect(result.onSaveItem).toHaveBeenCalledWith(expect.objectContaining({ id: item2.id, groupId: group.id }))
    expect(result.renderer.root.findAllByProps({ 'aria-label': '批量操作' })).toHaveLength(0)
    result.renderer.unmount()
  })

  it('adds clipboard images pasted into the smart generation reference grid', async () => {
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter({ metaInstructions: [imagePromptMeta] })
    })
    act(() => findButton(result.renderer.root, '智能生成')!.props.onClick())

    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        items: [
          { type: 'image/png', getAsFile: () => new File(['a'], '截图.png', { type: 'image/png' }) },
          { type: 'image/jpeg', getAsFile: () => new File(['b'], '截图 B.jpg', { type: 'image/jpeg' }) },
        ],
      },
    })
    await act(async () => {
      document.dispatchEvent(pasteEvent)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    // 图片读取与渲染是异步的（FileReader → setState），等待渲染完成再断言。
    await vi.waitFor(() => {
      expect(result.renderer.root.findAllByType('img')).toHaveLength(2)
    })

    expect(pasteEvent.defaultPrevented).toBe(true)
    expect(textContent(result.renderer.root)).toContain('已添加 2 张参考图片')
    expect(textContent(result.renderer.root)).toContain('Ctrl+V 粘贴')
    result.renderer.unmount()
  })

  it('loads a generation record into the form for editing', async () => {
    const record: SopGenerationRecord = {
      id: 'record-1',
      status: 'success',
      createdAt: 1000,
      updatedAt: 2000,
      elapsedMs: 1000,
      metaInstruction: {
        id: generalMeta.id,
        name: generalMeta.name,
        description: generalMeta.description,
        instruction: generalMeta.instruction,
        kind: 'general',
      },
      brief: '生成详情页 SOP',
      referenceImages: [
        { id: 'img-1', name: '参考图 A.png', dataUrl: 'data:image/png;base64,YQ==' },
        { id: 'img-2', name: '参考图 B.png', dataUrl: 'data:image/png;base64,Yg==' },
      ],
      result: { id: 'sop-result', name: '详情页 SOP', description: '说明', content: '# 正文' },
    }
    dbMocks.getAllSopGenerationRecords.mockResolvedValue([record])
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter({ metaInstructions: [generalMeta] })
    })
    act(() => findButton(result.renderer.root, '智能生成')!.props.onClick())
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    act(() => findButton(result.renderer.root, '生成记录')!.props.onClick())

    act(() => result.renderer.root.findByProps({ 'aria-label': '编辑生成记录 详情页 SOP' }).props.onClick())

    expect(result.renderer.root.findByProps({ 'aria-label': 'SOP 生成说明' }).props.value).toBe('生成详情页 SOP')
    expect(result.renderer.root.findAllByType('img')).toHaveLength(2)
    expect(textContent(result.renderer.root)).toContain('生成状态')
    expect(imageStoreMocks.showToast).toHaveBeenCalledWith(expect.stringContaining('已载入生成记录'), 'success')
    result.renderer.unmount()
  })

  it('regenerates from a generation record using its saved inputs', async () => {
    const onGenerateSop: GenerateSop = vi.fn(async () => ({
      name: '重生成的 SOP',
      description: '重新生成说明',
      sop: '# 重新生成正文',
    }))
    const record: SopGenerationRecord = {
      id: 'record-2',
      status: 'success',
      createdAt: 1000,
      updatedAt: 2000,
      metaInstruction: {
        id: generalMeta.id,
        name: generalMeta.name,
        description: generalMeta.description,
        instruction: generalMeta.instruction,
        kind: 'general',
      },
      brief: '生成详情页 SOP',
      referenceImages: [
        { id: 'img-1', name: '参考图 A.png', dataUrl: 'data:image/png;base64,YQ==' },
        { id: 'img-2', name: '参考图 B.png', dataUrl: 'data:image/png;base64,Yg==' },
      ],
      result: { id: 'sop-result', name: '详情页 SOP', description: '说明', content: '# 正文' },
    }
    dbMocks.getAllSopGenerationRecords.mockResolvedValue([record])
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter({ metaInstructions: [generalMeta], onGenerateSop })
    })
    act(() => findButton(result.renderer.root, '智能生成')!.props.onClick())
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    act(() => findButton(result.renderer.root, '生成记录')!.props.onClick())

    await act(async () => {
      result.renderer.root.findByProps({ 'aria-label': '重新生成记录 详情页 SOP' }).props.onClick()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(onGenerateSop).toHaveBeenCalledWith(
      '生成详情页 SOP',
      {},
      expect.arrayContaining([
        expect.objectContaining({ id: 'img-1', dataUrl: 'data:image/png;base64,YQ==' }),
        expect.objectContaining({ id: 'img-2', dataUrl: 'data:image/png;base64,Yg==' }),
      ]),
      'general',
      generalMeta.instruction,
      expect.objectContaining({ onProgress: expect.any(Function) }),
    )
    expect(result.onSaveItem).toHaveBeenCalledWith(expect.objectContaining({ name: '重生成的 SOP' }))
    expect(dbMocks.putSopGenerationRecord).toHaveBeenCalledTimes(2)
    expect(textContent(result.renderer.root)).toContain('SOP「重生成的 SOP」生成并保存成功')
    result.renderer.unmount()
  })

  it('regenerates with the record snapshot when its meta instruction was deleted', async () => {
    const onGenerateSop: GenerateSop = vi.fn(async () => ({
      name: '快照 SOP',
      description: '',
      sop: '# 快照正文',
    }))
    const record: SopGenerationRecord = {
      id: 'record-3',
      status: 'error',
      createdAt: 1000,
      updatedAt: 2000,
      metaInstruction: {
        id: 'meta-deleted',
        name: '已删除的元指令',
        description: '',
        instruction: '快照指令正文',
        kind: 'image-prompt',
      },
      brief: '图片画风',
      referenceImages: [{ id: 'img-1', name: '风格参考.png', dataUrl: 'data:image/png;base64,YQ==' }],
      error: '历史失败原因',
    }
    dbMocks.getAllSopGenerationRecords.mockResolvedValue([record])
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter({ metaInstructions: [generalMeta], onGenerateSop })
    })
    act(() => findButton(result.renderer.root, '智能生成')!.props.onClick())
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    act(() => findButton(result.renderer.root, '生成记录')!.props.onClick())

    await act(async () => {
      result.renderer.root.findByProps({ 'aria-label': '重新生成记录 已删除的元指令' }).props.onClick()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(onGenerateSop).toHaveBeenCalledWith(
      '图片画风',
      {},
      expect.arrayContaining([expect.objectContaining({ id: 'img-1' })]),
      'image-prompt',
      '快照指令正文',
      expect.objectContaining({ onProgress: expect.any(Function) }),
    )
    expect(result.onSaveItem).toHaveBeenCalledWith(expect.objectContaining({ name: '快照 SOP' }))
    expect(textContent(result.renderer.root)).toContain('已载入生成记录使用的元指令')
    expect(textContent(result.renderer.root)).toContain('原元指令已从库中删除')
    result.renderer.unmount()
  })

  it('shows regenerate and edit actions on the generation detail overlay', async () => {
    const record: SopGenerationRecord = {
      id: 'record-4',
      status: 'error',
      createdAt: 1000,
      updatedAt: 2000,
      metaInstruction: {
        id: generalMeta.id,
        name: generalMeta.name,
        description: generalMeta.description,
        instruction: generalMeta.instruction,
        kind: 'general',
      },
      brief: '失败的一次生成',
      referenceImages: [],
      error: '网络错误',
    }
    dbMocks.getAllSopGenerationRecords.mockResolvedValue([record])
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter({ metaInstructions: [generalMeta] })
    })
    act(() => findButton(result.renderer.root, '智能生成')!.props.onClick())
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    act(() => findButton(result.renderer.root, '生成记录')!.props.onClick())
    act(() => result.renderer.root.findByProps({ 'aria-label': '查看生成记录 通用 SOP 编译器' }).props.onClick())

    expect(result.renderer.root.findByProps({ 'aria-label': '生成记录详情 通用 SOP 编译器' })).toBeTruthy()
    expect(findButton(result.renderer.root, '编辑输入')).toBeTruthy()
    expect(findButton(result.renderer.root, '重新生成')).toBeTruthy()
    expect(findButton(result.renderer.root, '返回记录')).toBeTruthy()

    await act(async () => {
      findButton(result.renderer.root, '编辑输入')!.props.onClick()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(result.renderer.root.findByProps({ 'aria-label': 'SOP 生成说明' }).props.value).toBe('失败的一次生成')
    result.renderer.unmount()
  })
})
