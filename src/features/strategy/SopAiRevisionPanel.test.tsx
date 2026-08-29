/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import SopAiRevisionPanel, { loadCustomInstructions, saveCustomInstructions } from './SopAiRevisionPanel'

const agentApiMocks = vi.hoisted(() => ({
  reviseSopDocument: vi.fn(),
  reviseSopMetaInstruction: vi.fn(),
  reviseVariablePromptOptions: vi.fn(),
}))
const storeMocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  useStore: vi.fn((selector: (state: unknown) => unknown) =>
    selector({
      settings: { agentTextProtocol: 'responses' },
      showToast: storeMocks.showToast,
    }),
  ),
}))
const dialogMocks = vi.hoisted(() => ({
  openConfirmDialog: vi.fn(),
  useAppDialog: vi.fn(() => ({ openConfirmDialog: dialogMocks.openConfirmDialog })),
}))

vi.mock('../../lib/agentApi', () => agentApiMocks)
vi.mock('../../lib/apiProfiles', () => ({
  getAgentTextApiProfile: () => ({
    provider: 'openai',
    model: 'gpt-test',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'test-key',
    timeout: 60,
    apiMode: 'responses',
  }),
  validateApiProfile: () => '',
}))
vi.mock('../../store', () => storeMocks)
vi.mock('../../hooks/useAppDialog', () => dialogMocks)

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const TEMPLATE = `图片比例为16:9。根据 {{主体}} 生成画面，并采用 {{背景}}。

可变项：
{{主体}}：猫 / 狗 / 兔子
{{背景}}：纯色 / 渐变 / 街景`

afterEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
})

function textContent(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : textContent(child))).join('')
}

function findButton(root: ReactTestInstance, label: string) {
  return root.findAllByType('button').find((button) => textContent(button).includes(label))
}

function renderPanel(options: {
  value?: string
  variableMeta?: Parameters<typeof SopAiRevisionPanel>[0]['variableMeta']
  onVariableMetaChange?: (meta: NonNullable<Parameters<typeof SopAiRevisionPanel>[0]['variableMeta']>) => void
  onInsertVariableBlock?: () => void
  instructionTemplates?: Parameters<typeof SopAiRevisionPanel>[0]['instructionTemplates']
}) {
  const onApply = vi.fn()
  const renderer = create(
    <SopAiRevisionPanel
      documentId="doc-1"
      value={options.value ?? TEMPLATE}
      onApply={onApply}
      variableMeta={options.variableMeta}
      onVariableMetaChange={options.onVariableMetaChange}
      onInsertVariableBlock={options.onInsertVariableBlock}
      instructionTemplates={options.instructionTemplates}
    />,
  )
  return { renderer, onApply }
}

describe('SopAiRevisionPanel variable workspace', () => {
  it('renders a variable card per parsed variable with theme/type/count controls', () => {
    let result!: ReturnType<typeof renderPanel>
    act(() => {
      result = renderPanel({})
    })

    expect(result.renderer.root.findByProps({ 'aria-label': '可变项参数工作台' })).toBeTruthy()
    expect(result.renderer.root.findByProps({ 'aria-label': '主体 主题' }).props.value).toBe('')
    expect(result.renderer.root.findByProps({ 'aria-label': '主体 类型' }).props.value).toBe('选项池')
    expect(result.renderer.root.findByProps({ 'aria-label': '主体 数量' }).props.value).toBe(3)
    expect(result.renderer.root.findByProps({ 'aria-label': '背景 主题' })).toBeTruthy()
    expect(findButton(result.renderer.root, 'AI 衍生')).toBeTruthy()
    expect(findButton(result.renderer.root, '改写')).toBeTruthy()
    result.renderer.unmount()
  })

  it('keeps the workspace hidden for plain SOP text and shows the enable guide', () => {
    let result!: ReturnType<typeof renderPanel>
    act(() => {
      result = renderPanel({ value: '# 普通 SOP\n\n1. 执行\n2. 验收', onInsertVariableBlock: vi.fn() })
    })

    expect(result.renderer.root.findAllByProps({ 'aria-label': '可变项参数工作台' })).toHaveLength(0)
    expect(result.renderer.root.findByProps({ 'aria-label': '可变项工作台启用引导' })).toBeTruthy()
    expect(textContent(result.renderer.root)).toContain('插入可变项示例')
    result.renderer.unmount()
  })

  it('hides the enable guide when no insert callback is provided', () => {
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<SopAiRevisionPanel documentId="doc-2" value="# 普通 SOP" onApply={vi.fn()} />)
    })
    expect(renderer.root.findAllByProps({ 'aria-label': '可变项工作台启用引导' })).toHaveLength(0)
    renderer.unmount()
  })

  it('invokes the insert callback from the enable guide', () => {
    const onInsertVariableBlock = vi.fn()
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(
        <SopAiRevisionPanel
          documentId="doc-3"
          value="# 普通 SOP"
          onApply={vi.fn()}
          onInsertVariableBlock={onInsertVariableBlock}
        />,
      )
    })
    act(() => findButton(renderer.root, '插入可变项示例')!.props.onClick())
    expect(onInsertVariableBlock).toHaveBeenCalledOnce()
    renderer.unmount()
  })

  it('seeds card parameters from persisted variableMeta and notifies changes', () => {
    let result!: ReturnType<typeof renderPanel>
    const onVariableMetaChange = vi.fn()
    act(() => {
      result = renderPanel({
        variableMeta: [{ name: '主体', theme: '高端美妆', type: '文案联动', count: 20 }],
        onVariableMetaChange,
      })
    })

    expect(result.renderer.root.findByProps({ 'aria-label': '主体 主题' }).props.value).toBe('高端美妆')
    act(() =>
      result.renderer.root.findByProps({ 'aria-label': '主体 数量' }).props.onChange({ target: { value: '30' } }),
    )
    expect(onVariableMetaChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: '主体', theme: '高端美妆', count: 30 })]),
    )
    result.renderer.unmount()
  })

  it('derives options and applies the merged template plus synced meta', async () => {
    agentApiMocks.reviseVariablePromptOptions.mockResolvedValue({
      options: ['金毛犬', '布偶猫', '垂耳兔', '奶牛猫', '橘猫'],
      reasoning: '围绕宠物日常补充同类选项',
    })
    let result!: ReturnType<typeof renderPanel>
    const onVariableMetaChange = vi.fn()
    act(() => {
      result = renderPanel({ onVariableMetaChange })
    })

    await act(async () => {
      findButton(result.renderer.root, 'AI 衍生')!.props.onClick()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(agentApiMocks.reviseVariablePromptOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        content: TEMPLATE,
        variableName: '主体',
        theme: '',
        type: '选项池',
        count: 3,
        mode: 'derive',
      }),
    )
    const fullText = textContent(result.renderer.root)
    expect(fullText).toContain('衍生「主体」')
    expect(fullText).toContain('金毛犬')
    expect(fullText).toContain('布偶猫')
    expect(fullText).toContain('目标 3 个，实际可用 5 个')

    act(() => findButton(result.renderer.root, '应用选项')!.props.onClick())

    expect(result.onApply).toHaveBeenCalledWith(
      expect.stringContaining('{{主体}}：金毛犬 / 布偶猫 / 垂耳兔 / 奶牛猫 / 橘猫'),
    )
    expect(result.onApply).toHaveBeenCalledWith(expect.stringContaining('{{背景}}：纯色 / 渐变 / 街景'))
    expect(onVariableMetaChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: '主体', count: 5 })]),
    )
    result.renderer.unmount()
  })

  it('rewrites the option pool with the card parameters and keeps the merged template preview', async () => {
    agentApiMocks.reviseVariablePromptOptions.mockResolvedValue({
      options: ['高级丝绒礼盒', '鎏金浮雕款', '珍珠缎面款'],
      reasoning: '按高端美妆主题重写',
    })
    let result!: ReturnType<typeof renderPanel>
    act(() => {
      result = renderPanel({})
    })

    act(() =>
      result.renderer.root.findByProps({ 'aria-label': '主体 主题' }).props.onChange({
        target: { value: '高端美妆' },
      }),
    )
    await act(async () => {
      findButton(result.renderer.root, '改写')!.props.onClick()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(agentApiMocks.reviseVariablePromptOptions).toHaveBeenCalledWith(
      expect.objectContaining({ variableName: '主体', theme: '高端美妆', mode: 'rewrite', count: 3 }),
    )
    const fullText = textContent(result.renderer.root)
    expect(fullText).toContain('改写「主体」')
    expect(fullText).toContain('高级丝绒礼盒')
    expect(fullText).toContain('查看合并后的完整模板')

    act(() => findButton(result.renderer.root, '应用选项')!.props.onClick())
    expect(result.onApply).toHaveBeenCalledWith(
      expect.stringContaining('{{主体}}：高级丝绒礼盒 / 鎏金浮雕款 / 珍珠缎面款'),
    )
    result.renderer.unmount()
  })

  it('keeps the workspace usable when the AI option request fails', async () => {
    agentApiMocks.reviseVariablePromptOptions.mockRejectedValue(new Error('模型超时'))
    let result!: ReturnType<typeof renderPanel>
    act(() => {
      result = renderPanel({})
    })

    await act(async () => {
      findButton(result.renderer.root, 'AI 衍生')!.props.onClick()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(textContent(result.renderer.root)).toContain('模型超时')
    expect(result.onApply).not.toHaveBeenCalled()
    result.renderer.unmount()
  })
})

describe('SopAiRevisionPanel custom quick instructions', () => {
  it('restores custom instructions from localStorage and fills the composer when clicked', () => {
    window.localStorage.setItem(
      'doupao.sop-custom-quick-instructions',
      JSON.stringify([{ id: 'sop-quick-1', label: '我的指令', instruction: '按我的格式重写。' }]),
    )
    let result!: ReturnType<typeof renderPanel>
    act(() => {
      result = renderPanel({
        value: '# 普通 SOP\n\n1. 执行',
        instructionTemplates: [{ label: '内置指令', instruction: '内置模板' }],
      })
    })

    // 自定义胶囊与内置模板同排展示
    expect(findButton(result.renderer.root, '内置指令')).toBeTruthy()
    const capsule = findButton(result.renderer.root, '我的指令')
    expect(capsule).toBeTruthy()

    // 点击直接填入输入框并聚焦
    act(() => capsule!.props.onClick())
    expect(result.renderer.root.findByProps({ 'aria-label': '向 AI 描述 SOP 修改要求' }).props.value).toBe(
      '按我的格式重写。',
    )
    result.renderer.unmount()
  })

  it('persists added and removed instructions through the storage helpers', () => {
    const before = loadCustomInstructions()
    expect(before).toEqual([])

    const added = [
      ...before,
      { id: 'sop-quick-a', label: '红线检查', instruction: '逐条检查禁止项与红线。' },
      { id: 'sop-quick-b', label: '术语统一', instruction: '统一全文术语。' },
    ]
    saveCustomInstructions(added)
    expect(loadCustomInstructions()).toEqual(added)

    saveCustomInstructions(added.filter((item) => item.id !== 'sop-quick-a'))
    expect(loadCustomInstructions()).toEqual([added[1]])
  })
})
