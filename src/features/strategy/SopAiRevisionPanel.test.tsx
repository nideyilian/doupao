/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import SopAiRevisionPanel, {
  loadCustomInstructions,
  loadQuickInstructionOverrides,
  saveCustomInstructions,
  saveQuickInstructionOverrides,
} from './SopAiRevisionPanel'

const agentApiMocks = vi.hoisted(() => ({
  reviseSopDocument: vi.fn(),
  reviseSopMetaInstruction: vi.fn(),
  reviseVariablePromptOptions: vi.fn(),
  introducesVariablePromptSyntax: vi.fn(
    (source: string, revised: string) =>
      !/\{\{\s*[^{}\r\n]+\s*\}\}|^\s*可变项\s*[：:]\s*$/mu.test(source) &&
      /\{\{\s*[^{}\r\n]+\s*\}\}|^\s*可变项\s*[：:]\s*$/mu.test(revised),
  ),
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
vi.mock('../../design-system', async () => {
  const actual = await vi.importActual<typeof import('../../design-system')>('../../design-system')
  return {
    ...actual,
    Dialog: ({
      open,
      title,
      description,
      children,
    }: {
      open: boolean
      title: ReactNode
      description?: ReactNode
      children: ReactNode
    }) =>
      open ? (
        <div role="dialog">
          <h2>{title}</h2>
          {description && <p>{description}</p>}
          {children}
        </div>
      ) : null,
  }
})

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

function openQuickMenu(root: ReactTestInstance) {
  const trigger = root.findAllByType('button').find((button) => {
    return String(button.props['aria-label']).startsWith('选择快捷指令')
  })
  if (!trigger) throw new Error('快捷指令入口未渲染')
  act(() => trigger.props.onClick())
}

function renderPanel(options: {
  value?: string
  variableMeta?: Parameters<typeof SopAiRevisionPanel>[0]['variableMeta']
  onVariableMetaChange?: (meta: NonNullable<Parameters<typeof SopAiRevisionPanel>[0]['variableMeta']>) => void
  instructionTemplates?: Parameters<typeof SopAiRevisionPanel>[0]['instructionTemplates']
  quickInstructionScope?: Parameters<typeof SopAiRevisionPanel>[0]['quickInstructionScope']
}) {
  const onApply = vi.fn()
  const renderer = create(
    <SopAiRevisionPanel
      documentId="doc-1"
      value={options.value ?? TEMPLATE}
      onApply={onApply}
      variableMeta={options.variableMeta}
      onVariableMetaChange={options.onVariableMetaChange}
      instructionTemplates={options.instructionTemplates}
      quickInstructionScope={options.quickInstructionScope}
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

  it('keeps the variable workspace hidden for plain SOP text', () => {
    let result!: ReturnType<typeof renderPanel>
    act(() => {
      result = renderPanel({ value: '# 普通 SOP\n\n1. 执行\n2. 验收' })
    })

    expect(result.renderer.root.findAllByProps({ 'aria-label': '可变项参数工作台' })).toHaveLength(0)
    openQuickMenu(result.renderer.root)
    expect(result.renderer.root.findAllByProps({ 'aria-label': '可变项工作台启用引导' })).toHaveLength(0)
    expect(textContent(result.renderer.root)).not.toContain('插入可变项示例')
    result.renderer.unmount()
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

    openQuickMenu(result.renderer.root)

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
      { id: 'sop-quick-a', label: '红线检查', instruction: '逐条检查禁止项与红线。', scope: 'sop' as const },
      { id: 'sop-quick-b', label: '术语统一', instruction: '统一全文术语。', scope: 'all' as const },
    ]
    saveCustomInstructions(added)
    expect(loadCustomInstructions()).toEqual(added)

    saveCustomInstructions(added.filter((item) => item.id !== 'sop-quick-a'))
    expect(loadCustomInstructions()).toEqual([added[1]])
  })

  it('does not silently overwrite an existing draft when a quick instruction is clicked', () => {
    let result!: ReturnType<typeof renderPanel>
    act(() => {
      result = renderPanel({
        value: '# 普通 SOP\n\n1. 执行',
        instructionTemplates: [{ label: '内置指令', instruction: '内置模板' }],
      })
    })

    const chatInput = result.renderer.root.findByProps({ 'aria-label': '向 AI 描述 SOP 修改要求' })
    act(() => chatInput.props.onChange({ target: { value: '我已经写好的草稿' } }))
    openQuickMenu(result.renderer.root)
    act(() => findButton(result.renderer.root, '内置指令')!.props.onClick())

    expect(chatInput.props.value).toBe('我已经写好的草稿')
    expect(findButton(result.renderer.root, '替换草稿')).toBeTruthy()
    expect(findButton(result.renderer.root, '追加到末尾')).toBeTruthy()

    act(() => findButton(result.renderer.root, '追加到末尾')!.props.onClick())
    expect(chatInput.props.value).toBe('我已经写好的草稿\n\n内置模板')
    result.renderer.unmount()
  })

  it('blocks applying a plain SOP revision that introduces variable-prompt syntax', async () => {
    agentApiMocks.reviseSopDocument.mockResolvedValueOnce({
      reply: '已泛化具体描述。',
      content: '# 普通 SOP\n\n泛化后的描述。\n\n可变项：\n{{主体}}：猫 / 狗',
      changeSummary: ['泛化具体词'],
    })
    let result!: ReturnType<typeof renderPanel>
    act(() => {
      result = renderPanel({ value: '# 普通 SOP\n\n1. 执行' })
    })
    const chatInput = result.renderer.root.findByProps({ 'aria-label': '向 AI 描述 SOP 修改要求' })
    act(() => {
      chatInput.props.onChange({ target: { value: '将具体词泛化' } })
    })
    await act(async () => {
      result.renderer.root.findByProps({ 'aria-label': '发送 SOP 修改要求' }).props.onClick()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    act(() => findButton(result.renderer.root, '应用到正文')!.props.onClick())
    expect(result.onApply).not.toHaveBeenCalled()
    expect(storeMocks.showToast).toHaveBeenLastCalledWith(
      '当前 SOP 对话不能新增可变项，请使用独立的变量提示词功能',
      'error',
    )
    result.renderer.unmount()
  })

  it('fills parameterized instructions with selected values instead of placeholders', () => {
    let result!: ReturnType<typeof renderPanel>
    act(() => {
      result = renderPanel({
        value: '# 元素池',
        quickInstructionScope: 'element-pool',
        instructionTemplates: [
          {
            id: 'pool-test',
            label: '参数指令',
            scope: 'element-pool',
            description: '需要填写目标层和数量。',
            parameters: [
              {
                key: 'level',
                label: '目标层级',
                kind: 'select',
                options: [{ value: '层级二', label: '层级二' }],
                required: true,
              },
              { key: 'count', label: '新增数量', kind: 'number', defaultValue: '4', required: true },
            ],
            buildInstruction: ({ level, count }) => `为「${level}」追加 ${count} 个选项。`,
          },
        ],
      })
    })

    openQuickMenu(result.renderer.root)
    act(() => findButton(result.renderer.root, '参数指令')!.props.onClick())
    const parameterSelect = result.renderer.root.findByType('select')
    const parameterCount = result.renderer.root.findAllByType('input').at(-1)!
    act(() => parameterSelect.props.onChange({ target: { value: '层级二' } }))
    act(() => parameterCount.props.onChange({ target: { value: '6' } }))
    act(() => findButton(result.renderer.root, '填入输入框')!.props.onClick())

    const chatInput = result.renderer.root.findByProps({ 'aria-label': '向 AI 描述 SOP 修改要求' })
    expect(chatInput.props.value).toBe('为「层级二」追加 6 个选项。')
    expect(chatInput.props.value).not.toContain('X')
    expect(chatInput.props.value).not.toContain('N')
    result.renderer.unmount()
  })

  it('supports selecting multiple layers for a parameterized instruction', () => {
    let result!: ReturnType<typeof renderPanel>
    act(() => {
      result = renderPanel({
        value: '# 元素池',
        quickInstructionScope: 'element-pool',
        instructionTemplates: [
          {
            id: 'multi-scope-test',
            label: '多选指令',
            scope: 'element-pool',
            parameters: [
              {
                key: 'scope',
                label: '作用域',
                kind: 'multi-select',
                options: [
                  { value: '全部层', label: '全部层' },
                  { value: '层级一', label: '层级一' },
                  { value: '层级二', label: '层级二' },
                ],
                defaultValue: '全部层',
                required: true,
              },
            ],
            instructionTemplate: '作用域：[[scope]]',
          },
        ],
      })
    })

    openQuickMenu(result.renderer.root)
    act(() => findButton(result.renderer.root, '多选指令')!.props.onClick())
    let checkboxes = result.renderer.root.findAllByType('input').filter((input) => input.props.type === 'checkbox')
    expect(checkboxes[0].props.checked).toBe(true)

    act(() => checkboxes[0].props.onChange({ target: { checked: false } }))
    checkboxes = result.renderer.root.findAllByType('input').filter((input) => input.props.type === 'checkbox')
    act(() => checkboxes[1].props.onChange({ target: { checked: true } }))
    act(() => checkboxes[2].props.onChange({ target: { checked: true } }))
    act(() => findButton(result.renderer.root, '填入输入框')!.props.onClick())

    const chatInput = result.renderer.root.findByProps({ 'aria-label': '向 AI 描述 SOP 修改要求' })
    expect(chatInput.props.value).toBe('作用域：层级一、层级二')
    result.renderer.unmount()
  })

  it('supports selecting multiple layers for a parameterized instruction', () => {
    let result!: ReturnType<typeof renderPanel>
    act(() => {
      result = renderPanel({
        value: '# 元素池',
        quickInstructionScope: 'element-pool',
        instructionTemplates: [
          {
            id: 'multi-scope-test',
            label: '多选指令',
            scope: 'element-pool',
            parameters: [
              {
                key: 'scope',
                label: '作用域',
                kind: 'multi-select',
                options: [
                  { value: '全部层', label: '全部层' },
                  { value: '层级一', label: '层级一' },
                  { value: '层级二', label: '层级二' },
                ],
                defaultValue: '全部层',
                required: true,
              },
            ],
            instructionTemplate: '作用域：[[scope]]',
          },
        ],
      })
    })

    openQuickMenu(result.renderer.root)
    act(() => findButton(result.renderer.root, '多选指令')!.props.onClick())
    let checkboxes = result.renderer.root.findAllByType('input').filter((input) => input.props.type === 'checkbox')
    expect(checkboxes[0].props.checked).toBe(true)

    act(() => checkboxes[0].props.onChange({ target: { checked: false } }))
    checkboxes = result.renderer.root.findAllByType('input').filter((input) => input.props.type === 'checkbox')
    act(() => checkboxes[1].props.onChange({ target: { checked: true } }))
    act(() => checkboxes[2].props.onChange({ target: { checked: true } }))
    act(() => findButton(result.renderer.root, '填入输入框')!.props.onClick())

    const chatInput = result.renderer.root.findByProps({ 'aria-label': '向 AI 描述 SOP 修改要求' })
    expect(chatInput.props.value).toBe('作用域：层级一、层级二')
    result.renderer.unmount()
  })

  it('shows the custom entry without templates and filters custom instructions by scope', () => {
    saveCustomInstructions([
      { id: 'sop-only', label: 'SOP 指令', instruction: '只用于 SOP。', scope: 'sop' },
      { id: 'meta-only', label: '元指令指令', instruction: '只用于元指令。', scope: 'meta-instruction' },
    ])
    let result!: ReturnType<typeof renderPanel>
    act(() => {
      result = renderPanel({ value: '# 普通 SOP' })
    })

    openQuickMenu(result.renderer.root)
    expect(result.renderer.root.findByProps({ 'aria-label': '添加自定义快捷指令' })).toBeTruthy()
    expect(findButton(result.renderer.root, 'SOP 指令')).toBeTruthy()
    expect(findButton(result.renderer.root, '元指令指令')).toBeUndefined()
    result.renderer.unmount()
  })

  it('shows and persists edits to built-in quick instructions', () => {
    let result!: ReturnType<typeof renderPanel>
    act(() => {
      result = renderPanel({ value: '# 普通 SOP\n\n1. 执行' })
    })

    act(() => result.renderer.root.findByProps({ 'aria-label': '查看和编辑 SOP 指令' }).props.onClick())
    expect(result.renderer.root.findByProps({ 'aria-label': '查看和编辑内置指令 将具体词泛化' })).toBeTruthy()
    expect(textContent(result.renderer.root)).toContain('直接泛化正文或元素池中的具体描述，不创建可变项。')

    act(() => result.renderer.root.findByProps({ 'aria-label': '查看和编辑内置指令 将具体词泛化' }).props.onClick())
    const labelInput = result.renderer.root
      .findAllByType('input')
      .find((input) => input.props.value === '将具体词泛化')!
    const instructionInput = result.renderer.root
      .findAllByType('textarea')
      .find((textarea) => textarea.props.value.includes('降低大批量生图时的重复度'))!
    act(() => labelInput.props.onChange({ target: { value: '泛化具体词' } }))
    act(() =>
      instructionInput.props.onChange({
        target: { value: '直接把元素池中的具体词改写为更通用的描述，不创建变量。' },
      }),
    )
    act(() => findButton(result.renderer.root, '保存修改')!.props.onClick())

    expect(textContent(result.renderer.root)).toContain('泛化具体词')
    expect(loadQuickInstructionOverrides()['sop-generalize']).toEqual({
      label: '泛化具体词',
      instruction: '直接把元素池中的具体词改写为更通用的描述，不创建变量。',
    })
    result.renderer.unmount()
  })

  it('persists and restores built-in instruction overrides', () => {
    saveQuickInstructionOverrides({
      'sop-generalize': { label: '自定义泛化', description: '只改具体词', instruction: '直接改写具体词。' },
    })

    expect(loadQuickInstructionOverrides()).toEqual({
      'sop-generalize': { label: '自定义泛化', description: '只改具体词', instruction: '直接改写具体词。' },
    })
  })
})
