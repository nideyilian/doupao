/* @vitest-environment jsdom */

import { act, create, type ReactTestInstance } from 'react-test-renderer'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import SopTextEditor, { findSopTextMatches, scrollSopTextToMatch } from './SopTextEditor'

const agentApiMocks = vi.hoisted(() => ({
  transformSopDocument: vi.fn(),
  reviseSopDocument: vi.fn(),
  reviseSopMetaInstruction: vi.fn(),
  reviseVariablePromptOptions: vi.fn(),
}))
const storeMocks = vi.hoisted(() => ({
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
      showToast: storeMocks.showToast,
    }),
  ),
}))

vi.mock('../../store', () => storeMocks)
vi.mock('../../lib/agentApi', () => agentApiMocks)
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

describe('findSopTextMatches', () => {
  it('finds all case-insensitive matches and none for an empty query', () => {
    expect(findSopTextMatches('步骤一\n步骤二\n再次执行步骤一', '步骤')).toEqual([0, 4, 12])
    expect(findSopTextMatches('abc ABC AbC', 'abc')).toEqual([0, 4, 8])
    expect(findSopTextMatches('正文', '')).toEqual([])
    expect(findSopTextMatches('正文', '不存在')).toEqual([])
  })
})

describe('scrollSopTextToMatch', () => {
  it('clamps scrollTop into the scrollable range and centers the match around the top third', () => {
    const textarea = { scrollHeight: 1000, clientHeight: 300 } as unknown as HTMLTextAreaElement
    scrollSopTextToMatch(textarea, 200)
    expect(textarea.scrollTop).toBe(100)
    scrollSopTextToMatch(textarea, 900)
    expect(textarea.scrollTop).toBe(700)
    scrollSopTextToMatch(textarea, 1200)
    expect(textarea.scrollTop).toBe(700)
  })
})

describe('SopTextEditor search feedback', () => {
  it('auto-locates the first match while typing, then navigates with the previous/next buttons', () => {
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(
        <SopTextEditor documentId="sop-1" value={'步骤一\n步骤二\n再次执行步骤一'} onChange={vi.fn()} />,
      )
    })

    const searchInput = renderer.root.findByProps({ 'aria-label': '查找正文' })
    // 输入即定位到第一处
    act(() => searchInput.props.onChange({ target: { value: '步骤' } }))
    expect(textContent(renderer.root.findByProps({ role: 'status' }))).toBe('1/3')

    act(() => renderer.root.findByProps({ 'aria-label': '查找下一处' }).props.onClick())
    expect(textContent(renderer.root.findByProps({ role: 'status' }))).toBe('2/3')

    act(() => renderer.root.findByProps({ 'aria-label': '查找上一处' }).props.onClick())
    expect(textContent(renderer.root.findByProps({ role: 'status' }))).toBe('1/3')

    act(() => searchInput.props.onChange({ target: { value: '不存在' } }))
    const emptyResult = renderer.root.findByProps({ role: 'status' })
    expect(textContent(emptyResult)).toBe('无匹配')
    expect(emptyResult.props['data-empty']).toBe(true)
  })
})

describe('SopTextEditor chat and fullscreen', () => {
  it('keeps the AI chat embedded permanently without extra chrome', () => {
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<SopTextEditor documentId="sop-1" value="正文内容" onChange={vi.fn()} />)
    })

    // 打开 SOP 时 AI 对话常驻右侧，且不存在「AI 对话」开关与全屏按钮
    expect(renderer.root.findAllByProps({ 'aria-label': 'SOP AI 对话优化' })).toHaveLength(1)
    expect(findButton(renderer.root, 'AI 对话')).toBeUndefined()
    expect(findButton(renderer.root, '全屏编辑')).toBeUndefined()
    renderer.unmount()
  })

  it('replaces the current match or all matches without changing unrelated text', () => {
    const replaceCurrent = vi.fn()
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(
        <SopTextEditor documentId="sop-current" value={'步骤一\n步骤二\n步骤一'} onChange={replaceCurrent} />,
      )
    })

    const searchInput = renderer.root.findByProps({ 'aria-label': '查找正文' })
    act(() => renderer.root.findByProps({ 'aria-label': '替换操作' }).props.onClick())
    const replaceInput = renderer.root.findByProps({ 'aria-label': '替换为' })
    act(() => searchInput.props.onChange({ target: { value: '步骤' } }))
    act(() => replaceInput.props.onChange({ target: { value: '阶段' } }))
    act(() => renderer.root.findByProps({ 'aria-label': '替换当前匹配' }).props.onClick())

    expect(replaceCurrent).toHaveBeenLastCalledWith('阶段一\n步骤二\n步骤一')
    renderer.unmount()

    const replaceAll = vi.fn()
    act(() => {
      renderer = create(<SopTextEditor documentId="sop-all" value={'步骤一\n步骤二\n步骤一'} onChange={replaceAll} />)
    })
    const allSearchInput = renderer.root.findByProps({ 'aria-label': '查找正文' })
    act(() => renderer.root.findByProps({ 'aria-label': '替换操作' }).props.onClick())
    const allReplaceInput = renderer.root.findByProps({ 'aria-label': '替换为' })
    act(() => allSearchInput.props.onChange({ target: { value: '步骤' } }))
    act(() => allReplaceInput.props.onChange({ target: { value: '阶段' } }))
    act(() => renderer.root.findByProps({ 'aria-label': '替换全部匹配' }).props.onClick())

    expect(replaceAll).toHaveBeenLastCalledWith('阶段一\n阶段二\n阶段一')
    renderer.unmount()
  })

  it('keeps non-SOP formatting actions out of the primary toolbar', () => {
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<SopTextEditor documentId="sop-tools" value="# 普通 SOP" onChange={vi.fn()} />)
    })

    expect(findButton(renderer.root, '引用')).toBeUndefined()
    expect(findButton(renderer.root, '代码块')).toBeUndefined()
    expect(renderer.root.findByProps({ 'aria-label': '自动分段' })).toBeTruthy()
    expect(renderer.root.findByProps({ 'aria-label': '清理粘贴' })).toBeTruthy()
    expect(renderer.root.findByProps({ 'aria-label': '关闭自动换行' })).toBeTruthy()
    expect(renderer.root.findByProps({ 'aria-label': '复制正文' })).toBeTruthy()
    renderer.unmount()
  })
})

describe('SopTextEditor AI instructions', () => {
  it('injects an AI instruction template into the chat input instead of rewriting the document directly', async () => {
    const onChange = vi.fn()
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(
        <SopTextEditor
          documentId="sop-1"
          value={'# 普通 SOP\n\n1. 执行\n2. 验收'}
          onChange={onChange}
          onTestRevision={vi.fn()}
        />,
      )
    })

    // 指令模板注入右侧 AI 对话输入框，正文未被直接改写
    openQuickMenu(renderer.root)
    act(() => findButton(renderer.root, '将具体词泛化')!.props.onClick())
    const chatInput = renderer.root.findByProps({ 'aria-label': '向 AI 描述 SOP 修改要求' })
    expect(chatInput.props.value).toContain('具体描述词')
    expect(chatInput.props.value).toContain('降低大批量生图时的重复度')
    expect(chatInput.props.value).toContain('不得把具体词转换成变量')
    expect(chatInput.props.value).not.toContain('转为 {{变量}}')
    expect(chatInput.props.value).not.toContain('在文末「可变项：」区块给出')
    expect(agentApiMocks.reviseSopDocument).not.toHaveBeenCalled()
    expect(renderer.root.findByProps({ 'aria-label': 'SOP 正文' }).props.value).toBe('# 普通 SOP\n\n1. 执行\n2. 验收')
    expect(onChange).not.toHaveBeenCalled()
    renderer.unmount()
  })

  it('keeps the audit entry unchanged and disables it while the report runs', async () => {
    let resolveAudit!: (value: string) => void
    agentApiMocks.transformSopDocument.mockReturnValue(
      new Promise((resolve) => {
        resolveAudit = resolve
      }),
    )
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<SopTextEditor documentId="sop-1" value="# 普通 SOP" onChange={vi.fn()} />)
    })

    expect(findButton(renderer.root, 'AI 检查')).toBeTruthy()
    expect(findButton(renderer.root, 'AI 对话')).toBeUndefined()
    openQuickMenu(renderer.root)
    expect(findButton(renderer.root, '将具体词泛化')).toBeTruthy()

    await act(async () => {
      findButton(renderer.root, 'AI 检查')!.props.onClick()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    // 报告运行期间：编辑器侧 Agent 操作（AI 检查）禁用
    expect(findButton(renderer.root, 'AI 检查')!.props.disabled).toBe(true)
    // 侧栏快捷指令由对话自身状态控制，不受编辑器报告影响
    expect(findButton(renderer.root, '将具体词泛化')!.props.disabled).toBe(false)

    await act(async () => {
      resolveAudit('# 检查报告\n\n- 阻断问题：无')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    // 检查是只读报告：不提供替换正文
    expect(findButton(renderer.root, '替换正文')).toBeUndefined()
    renderer.unmount()
  })

  it.each(['将具体词泛化', '结构化重排', '精简压缩', '拆分步骤', '补全缺失', '统一术语'])(
    'offers %s as a chat template for plain documents',
    (buttonLabel) => {
      let renderer!: ReturnType<typeof create>
      act(() => {
        renderer = create(<SopTextEditor documentId="sop-1" value={'# 普通 SOP\n\n1. 执行'} onChange={vi.fn()} />)
      })

      openQuickMenu(renderer.root)
      expect(findButton(renderer.root, buttonLabel)).toBeTruthy()
      act(() => findButton(renderer.root, buttonLabel)!.props.onClick())
      expect(renderer.root.findByProps({ 'aria-label': '向 AI 描述 SOP 修改要求' }).props.value.length).toBeGreaterThan(
        0,
      )
      renderer.unmount()
    },
  )
})

describe('SopTextEditor element pool instructions', () => {
  const ELEMENT_POOL_SOP = `* **[层级一：文案变体]**：
1. 标题A
2. 标题B

* **[层级二：主体变体]**：
1. 主体A
2. 主体B`

  it('switches to the element-pool instruction group and injects chat templates', () => {
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<SopTextEditor documentId="sop-1" value={ELEMENT_POOL_SOP} onChange={vi.fn()} />)
    })

    openQuickMenu(renderer.root)
    expect(findButton(renderer.root, '将具体词泛化')).toBeTruthy()
    expect(findButton(renderer.root, '选项泛化')).toBeUndefined()
    expect(findButton(renderer.root, '衍生选项')).toBeTruthy()
    expect(findButton(renderer.root, '改写选项')).toBeTruthy()
    expect(findButton(renderer.root, '池子诊断')).toBeTruthy()
    expect(findButton(renderer.root, '试跑验证')).toBeTruthy()
    expect(findButton(renderer.root, '精简压缩')).toBeTruthy()

    // 点击「将具体词泛化」→ 先填写参数，再把生成后的指令注入右侧 AI 对话输入框
    act(() => findButton(renderer.root, '将具体词泛化')!.props.onClick())
    expect(findButton(renderer.root, '填入输入框')).toBeTruthy()
    act(() => findButton(renderer.root, '填入输入框')!.props.onClick())
    const chatInput = renderer.root.findByProps({ 'aria-label': '向 AI 描述 SOP 修改要求' })
    expect(chatInput.props.value).toContain('上钻泛化')
    expect(chatInput.props.value).toContain('全部层')
    renderer.unmount()
  })

  it('runs pool diagnosis as a read-only report through transformSopDocument', async () => {
    agentApiMocks.transformSopDocument.mockResolvedValue('# 诊断报告\n\n- 层级二存在与红线冲突的选项')
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<SopTextEditor documentId="sop-1" value={ELEMENT_POOL_SOP} onChange={vi.fn()} />)
    })

    await act(async () => {
      findButton(renderer.root, '池子诊断')!.props.onClick()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(agentApiMocks.transformSopDocument).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'pool-diagnose', content: ELEMENT_POOL_SOP }),
    )
    expect(textContent(renderer.root)).toContain('池子诊断预览')
    expect(textContent(renderer.root)).toContain('诊断报告')
    expect(textContent(renderer.root)).toContain('报告不会改写正文')
    // 报告形态不提供替换正文
    expect(findButton(renderer.root, '替换正文')).toBeUndefined()
    renderer.unmount()
  })

  it('keeps the step-SOP instruction group for plain documents', () => {
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<SopTextEditor documentId="sop-1" value="# 普通 SOP\n\n1. 执行" onChange={vi.fn()} />)
    })

    openQuickMenu(renderer.root)
    expect(findButton(renderer.root, '将具体词泛化')).toBeTruthy()
    expect(findButton(renderer.root, '选项泛化')).toBeUndefined()
    renderer.unmount()
  })
})
