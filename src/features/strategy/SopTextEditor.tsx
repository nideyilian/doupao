import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CloseIcon as Close,
  CodeIcon as Code,
  CollectionManageIcon as List,
  CopyIcon as Copy,
  LoaderCircleIcon as Loader,
  RotateCcwIcon as Undo,
  SearchIcon as Search,
  SparklesIcon as Sparkles,
  TypeIcon as Heading,
} from '../../design-system/icons'
import { transformSopDocument, type SopAiOperation } from '../../lib/agentApi'
import { getAgentTextApiProfile, validateApiProfile } from '../../lib/apiProfiles'
import { copyTextToClipboard, getClipboardFailureMessage } from '../../lib/clipboard'
import { useStore } from '../../store'
import { autoParagraphSopText, cleanPastedSopText, formatSopDocument } from './sopTextFormatting'
import { parseElementPool } from './elementPool'
import SopAiRevisionPanel from './SopAiRevisionPanel'
import type { SopVariableMeta } from './types'

type Selection = {
  start: number
  end: number
}

type SopTextEditorProps = {
  documentId: string
  value: string
  onChange: (value: string) => void
  onSaveAsRevision?: (value: string) => void
  onTestRevision?: (value: string) => Promise<void>
  /** 变量提示词资产的可变项参数（供 AI 对话工作台使用与持久化） */
  variableMeta?: SopVariableMeta[]
  onVariableMetaChange?: (meta: SopVariableMeta[]) => void
}

const AI_ACTION_LABELS: Record<SopAiOperation, string> = {
  audit: 'AI 检查',
  'pool-diagnose': '池子诊断',
  'pool-test-run': '试跑验证',
}

/** 元素池 SOP 的对话式指令：点击后把可编辑模板注入右侧 AI 对话输入框（可改作用域/数量/主题后发送）。 */
const POOL_INSTRUCTION_BUTTONS = [
  {
    label: '选项泛化',
    instruction:
      '对元素池执行上钻泛化。作用域：全部层（如只想泛化某层，请把「全部层」改为具体层级，例如「层级二」）。强度：中等（可改为轻微/彻底）。要求：1) 每个选项从具体实例向上一级语义类别移动，保持意思相关，为 AI 生成留出变化空间；2) 保留画风常量、文案排版常量与排他性红线不变；3) 同层泛化程度一致；多层时保持跨层语义关联（共同主题线、抽象层级对齐）；4) 泛化后仍是完整可直接使用的描述；5) 变更摘要逐条列出「泛化前 → 泛化后」对照，并标注与其它层的关联建议。输出完整修订后的元素池（未修改的层原样保留）。',
  },
  {
    label: '衍生选项',
    instruction:
      '为元素池中「第 X 层」追加 N 个新选项（请把 X 改为实际层级、N 改为数量；想全部层都扩充请写「各层」）。要求：1) 与现有选项同粒度、同风格、同抽象层级；2) 与其它层的既有主题线契合，保持层间关联；3) 不重复、不近义改写现有选项；4) 输出完整修订后的元素池（未修改的层原样保留），变更摘要列出新增项。',
  },
  {
    label: '改写选项',
    instruction:
      '按主题重写元素池中「第 X 层」的全部选项（请把 X 改为实际层级，并补充主题，例如「新年主题」；想全部层都换主题请写「全部层」并让主题贯穿各层）。要求：1) 新选项保持原层的语义槽位与粒度；2) 保留画风常量与排他性红线；3) 输出完整修订后的元素池，变更摘要说明重写逻辑。',
  },
] as const

/**
 * 就地 AI 快捷指令：与元素池指令同一范式——点击后把可编辑模板注入右侧 AI 对话输入框，
 * 用户可调整后发送，AI 结果以对话提案形式确认后再替换正文（正文编辑的唯一 AI 通道是对话）。
 */
const AI_CHAT_TEMPLATES = [
  {
    label: '将具体词泛化',
    instruction:
      '扫描正文中写死的具体描述词（如具体颜色、材质、场景、尺寸、风格），把不适合固定的改为通用类别表述；适合做成可选参数的，转为 {{变量}} 并在文末「可变项：」区块给出 4~6 个选项。数字、ID、阈值、价格、禁止项和验收标准一律原样保留。变更摘要逐条列出每处改动。',
  },
  {
    label: '结构化重排',
    instruction:
      '把正文重排为规范、易扫读的 Markdown SOP：只使用原文能支撑的章节（目标、适用范围、前置条件、输入、执行步骤、验收标准、异常处理、禁止项、输出）；执行步骤编号化，条件与约束归入对应步骤；结构上必要但缺失的字段写「待补充」，不要臆造；删除重复表述但保留全部独立要求。输出完整修订后的 SOP 与变更摘要。',
  },
  {
    label: '精简压缩',
    instruction:
      '在保留全部步骤、数字、约束、禁止项和验收标准的前提下压缩正文：删除重复说明与填充词，合并冗余段落，保持每条要求仍然可执行。若某处删除会丢失信息，保留原文并在变更摘要中说明。',
  },
  {
    label: '拆分步骤',
    instruction:
      '把正文中过长的执行段落拆分为编号步骤，每步只做一件事；前置条件、注意事项、异常处理归入对应步骤；必要的缺失步骤用「待补充」占位，不要臆造操作。',
  },
  {
    label: '补全缺失',
    instruction:
      '对照 目标 / 适用范围 / 输入 / 执行步骤 / 异常处理 / 验收标准 / 禁止项 检查这份 SOP：缺失的环节用「待补充」补齐框架，把歧义动词改明确；不要臆造业务规则、数字或系统。',
  },
  {
    label: '统一术语',
    instruction:
      '找出正文中指向同一概念的多种说法，统一为同一种表述，并在变更摘要中列出术语对照表；不改变任何规则、数字与禁止项的内容。',
  },
] as const

/** AI 结果预览条状态：audit 出检查报告，report（池子诊断/试跑）出只读报告；正文修订统一走 AI 对话。 */
type AiResultState = { kind: 'audit'; content: string } | { kind: 'report'; label: string; content: string }

function formatSelectedLines(
  value: string,
  selection: Selection,
  prefix: string,
): { value: string; selection: Selection } {
  const lineStart = value.lastIndexOf('\n', Math.max(0, selection.start - 1)) + 1
  const nextLineBreak = value.indexOf('\n', selection.end)
  const lineEnd = nextLineBreak === -1 ? value.length : nextLineBreak
  const selectedLines = value.slice(lineStart, lineEnd)
  const formatted = selectedLines
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n')

  return {
    value: `${value.slice(0, lineStart)}${formatted}${value.slice(lineEnd)}`,
    selection: {
      start: selection.start + prefix.length,
      end: selection.end + prefix.length * selectedLines.split('\n').length,
    },
  }
}

function wrapSelection(
  value: string,
  selection: Selection,
  before: string,
  after: string,
): { value: string; selection: Selection } {
  const selected = value.slice(selection.start, selection.end)
  const next = `${value.slice(0, selection.start)}${before}${selected}${after}${value.slice(selection.end)}`
  return {
    value: next,
    selection: {
      start: selection.start + before.length,
      end: selection.end + before.length,
    },
  }
}

export function findSopTextMatches(value: string, query: string): number[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return []

  const source = value.toLocaleLowerCase()
  const matches: number[] = []
  let matchIndex = source.indexOf(normalizedQuery)
  while (matchIndex !== -1) {
    matches.push(matchIndex)
    matchIndex = source.indexOf(normalizedQuery, matchIndex + normalizedQuery.length)
  }
  return matches
}

/**
 * 用隐藏镜像测量「前缀文本」在 textarea 相同排版下的像素高度（含 padding），
 * 用于精确滚动定位匹配所在位置（自动换行开/关均适用）。
 */
export function measureSopTextPrefixHeight(textarea: HTMLTextAreaElement, prefix: string, wrap: boolean): number {
  if (typeof document === 'undefined') return 0
  const mirror = document.createElement('div')
  const style = window.getComputedStyle(textarea)
  mirror.style.cssText = [
    'position:absolute',
    'visibility:hidden',
    'pointer-events:none',
    'left:0',
    'top:0',
    `font:${style.font}`,
    `font-size:${style.fontSize}`,
    `line-height:${style.lineHeight}`,
    `letter-spacing:${style.letterSpacing}`,
    `word-spacing:${style.wordSpacing}`,
    `padding:${style.padding}`,
    `border:${style.border}`,
    `box-sizing:${style.boxSizing}`,
    `white-space:${wrap ? 'pre-wrap' : 'pre'}`,
    `overflow-wrap:${style.overflowWrap}`,
    `word-break:${style.wordBreak}`,
  ].join(';')
  if (wrap) mirror.style.width = `${textarea.clientWidth}px`
  mirror.textContent = prefix
  document.body.appendChild(mirror)
  const height = mirror.getBoundingClientRect().height
  document.body.removeChild(mirror)
  return height
}

/** 滚动 textarea，使指定匹配的像素位置位于可视区约 1/3 处（可靠定位）。 */
export function scrollSopTextToMatch(textarea: HTMLTextAreaElement, prefixHeight: number): void {
  const maxScroll = Math.max(0, textarea.scrollHeight - textarea.clientHeight)
  textarea.scrollTop = Math.max(0, Math.min(maxScroll, prefixHeight - textarea.clientHeight / 3))
}

export default function SopTextEditor({
  documentId,
  value,
  onChange,
  onSaveAsRevision,
  onTestRevision,
  variableMeta,
  onVariableMetaChange,
}: SopTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const aiAbortRef = useRef<AbortController | null>(null)
  const historyRef = useRef<string[]>([value])
  const historyIndexRef = useRef(0)
  const settings = useStore((state) => state.settings)
  const showToast = useStore((state) => state.showToast)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMessage, setSearchMessage] = useState('')
  const [activeSearchMatchStart, setActiveSearchMatchStart] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const [wrap, setWrap] = useState(true)
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false })
  const [aiLoading, setAiLoading] = useState<string | null>(null)
  const [aiError, setAiError] = useState('')
  const [aiResult, setAiResult] = useState<AiResultState | null>(null)

  /** 正文是否为「层级式元素池」多变体 SOP（影响可用指令集） */
  const elementPool = useMemo(() => parseElementPool(value), [value])

  const stats = useMemo(
    () => ({
      characters: value.length,
      lines: value.length === 0 ? 1 : value.split('\n').length,
    }),
    [value],
  )
  const searchMatches = useMemo(() => findSopTextMatches(value, searchQuery), [searchQuery, value])
  const activeSearchMatchIndex = activeSearchMatchStart === null ? -1 : searchMatches.indexOf(activeSearchMatchStart)
  const searchFeedback = !searchQuery.trim()
    ? ''
    : searchMatches.length === 0
      ? '无匹配'
      : activeSearchMatchIndex === -1
        ? `${searchMatches.length} 处`
        : `${activeSearchMatchIndex + 1}/${searchMatches.length}`
  const agentProfile = useMemo(() => getAgentTextApiProfile(settings), [settings])

  useEffect(() => {
    aiAbortRef.current?.abort()
    historyRef.current = [value]
    historyIndexRef.current = 0
    setHistoryState({ canUndo: false, canRedo: false })
    setSearchMessage('')
    setActiveSearchMatchStart(null)
    setCopied(false)
    setAiLoading(null)
    setAiError('')
    setAiResult(null)
  }, [documentId])

  useEffect(() => () => aiAbortRef.current?.abort(), [])

  function syncHistoryState() {
    setHistoryState({
      canUndo: historyIndexRef.current > 0,
      canRedo: historyIndexRef.current < historyRef.current.length - 1,
    })
  }

  function commit(nextValue: string, selection?: Selection) {
    if (historyRef.current[historyIndexRef.current] !== nextValue) {
      const history = historyRef.current.slice(0, historyIndexRef.current + 1)
      history.push(nextValue)
      if (history.length > 100) history.shift()
      historyRef.current = history
      historyIndexRef.current = history.length - 1
    }
    onChange(nextValue)
    syncHistoryState()
    setCopied(false)
    if (selection) {
      requestAnimationFrame(() => {
        textareaRef.current?.focus()
        textareaRef.current?.setSelectionRange(selection.start, selection.end)
      })
    }
  }

  function getSelection(): Selection {
    return {
      start: textareaRef.current?.selectionStart ?? value.length,
      end: textareaRef.current?.selectionEnd ?? value.length,
    }
  }

  function formatLines(prefix: string) {
    const result = formatSelectedLines(value, getSelection(), prefix)
    commit(result.value, result.selection)
  }

  function insertCodeBlock() {
    const selection = getSelection()
    const result = wrapSelection(value, selection, '```\n', '\n```')
    commit(result.value, result.selection)
  }

  function moveHistory(direction: -1 | 1) {
    const nextIndex = historyIndexRef.current + direction
    const nextValue = historyRef.current[nextIndex]
    if (nextValue === undefined) return
    historyIndexRef.current = nextIndex
    onChange(nextValue)
    syncHistoryState()
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  /** 定位到第 matchIndex 处匹配：选中 + 精确滚动到可视区 + 更新提示；focusTextarea 时聚焦编辑区（选择高亮）。 */
  function locateSearchMatch(matchIndex: number, focusTextarea: boolean) {
    const query = searchQuery.trim()
    const matchStart = searchMatches[matchIndex]
    if (!query || matchStart === undefined) return
    setActiveSearchMatchStart(matchStart)
    setSearchMessage(`已定位第 ${matchIndex + 1} 处，共 ${searchMatches.length} 处`)
    const textarea = textareaRef.current
    if (!(textarea instanceof HTMLTextAreaElement)) return
    const matchEnd = matchStart + query.length
    if (focusTextarea) textarea.focus()
    textarea.setSelectionRange(matchStart, matchEnd)
    // 精确滚动：把匹配所在行带到可视区约 1/3 处（自动换行开/关都可靠）
    scrollSopTextToMatch(textarea, measureSopTextPrefixHeight(textarea, value.slice(0, matchStart), wrap))
  }

  // 输入即定位：查询变化后自动跳转到第一处匹配（不抢占搜索框焦点，可继续输入细化）
  useEffect(() => {
    const query = searchQuery.trim()
    if (!query) {
      setActiveSearchMatchStart(null)
      setSearchMessage('')
      return
    }
    if (searchMatches.length === 0) {
      setActiveSearchMatchStart(null)
      setSearchMessage(`未找到“${query}”`)
      return
    }
    locateSearchMatch(0, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery])

  function findNext() {
    const query = searchQuery.trim()
    if (!query) {
      searchInputRef.current?.focus()
      setSearchMessage('请输入查找内容')
      return
    }
    if (searchMatches.length === 0) {
      setActiveSearchMatchStart(null)
      setSearchMessage(`未找到“${query}”`)
      return
    }
    const selectionEnd = textareaRef.current?.selectionEnd
    let nextMatchIndex: number
    if (typeof selectionEnd === 'number') {
      const found = searchMatches.findIndex((match) => match >= selectionEnd)
      nextMatchIndex = found === -1 ? 0 : found
    } else {
      // 无真实选区（如测试环境）时按当前定位序号推进
      nextMatchIndex = activeSearchMatchIndex >= 0 ? (activeSearchMatchIndex + 1) % searchMatches.length : 0
    }
    locateSearchMatch(nextMatchIndex, true)
  }

  function findPrev() {
    const query = searchQuery.trim()
    if (!query) {
      searchInputRef.current?.focus()
      setSearchMessage('请输入查找内容')
      return
    }
    if (searchMatches.length === 0) {
      setActiveSearchMatchStart(null)
      setSearchMessage(`未找到“${query}”`)
      return
    }
    const selectionStart = textareaRef.current?.selectionStart
    let prevIndex: number
    if (typeof selectionStart === 'number') {
      const currentIndex = searchMatches.findIndex((match) => match >= selectionStart)
      prevIndex =
        currentIndex === -1
          ? searchMatches.length - 1
          : currentIndex === 0
            ? searchMatches.length - 1
            : currentIndex - 1
    } else {
      prevIndex = activeSearchMatchIndex > 0 ? activeSearchMatchIndex - 1 : searchMatches.length - 1
    }
    locateSearchMatch(prevIndex, true)
  }

  async function copyContent() {
    try {
      await copyTextToClipboard(value)
      setCopied(true)
    } catch (error) {
      showToast(getClipboardFailureMessage('复制失败，请检查剪贴板权限', error), 'error')
    }
  }

  function runDocumentTool(label: string, transform: (content: string) => string) {
    const nextValue = transform(value)
    if (nextValue === value) {
      setSearchMessage(`${label}：无需调整`)
      return
    }
    commit(nextValue)
    setSearchMessage(`${label}完成，可撤销`)
  }

  async function runAiAction(operation: SopAiOperation) {
    if (!value.trim()) {
      setAiError('请先输入 SOP 正文')
      return
    }
    const validationError = validateApiProfile(agentProfile)
    if (validationError || agentProfile.provider !== 'openai') {
      const message = validationError
        ? `请先完善 Agent 配置：${validationError}`
        : 'SOP AI 工具需要 OpenAI 兼容的 Agent 配置'
      setAiError(message)
      showToast(message, 'error')
      return
    }

    aiAbortRef.current?.abort()
    const controller = new AbortController()
    aiAbortRef.current = controller
    setAiLoading(operation)
    setAiError('')
    setAiResult(null)
    try {
      const content = await transformSopDocument({
        settings,
        profile: agentProfile,
        operation,
        content: value,
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      setAiResult(
        operation === 'audit'
          ? { kind: 'audit', content }
          : { kind: 'report', label: AI_ACTION_LABELS[operation], content },
      )
      showToast(`${AI_ACTION_LABELS[operation]}已生成预览`, 'success')
    } catch (error) {
      if (controller.signal.aborted) return
      const message = error instanceof Error ? error.message : `${AI_ACTION_LABELS[operation]}失败`
      setAiError(message)
      showToast(message, 'error')
    } finally {
      if (aiAbortRef.current === controller) {
        aiAbortRef.current = null
        setAiLoading(null)
      }
    }
  }

  async function copyAiResult() {
    if (!aiResult) return
    try {
      await copyTextToClipboard(aiResult.content)
      showToast(aiResult.kind === 'audit' ? '检查报告已复制' : 'AI 结果已复制', 'success')
    } catch (error) {
      showToast(getClipboardFailureMessage('复制失败，请检查剪贴板权限', error), 'error')
    }
  }

  /** 在正文末尾插入「可变项：」示例区块，让 AI 对话启用可变项工作台。 */
  function insertVariableBlock() {
    const skeleton = `${value.trimEnd()}

画面统一采用 {{变量名}} 描述的方案，并匹配 {{风格}} 风格。

可变项：
{{变量名}}：方案A / 方案B / 方案C
{{风格}}：简约 / 复古 / 科技`
    commit(skeleton)
    setSearchMessage('已插入可变项示例区块，可在 AI 对话中调整参数并衍生选项')
  }

  return (
    <section className="sop-center-text-editor" aria-label="SOP 正文编辑器">
      <div className="sop-center-text-editor__toolbar" role="toolbar" aria-label="正文格式与编辑工具">
        <div className="sop-center-editor-tool-group">
          <button
            type="button"
            onClick={() => moveHistory(-1)}
            disabled={!historyState.canUndo}
            className="sop-center-editor-tool"
            aria-label="撤销"
            title="撤销"
          >
            <Undo size={15} />
          </button>
          <button
            type="button"
            onClick={() => moveHistory(1)}
            disabled={!historyState.canRedo}
            className="sop-center-editor-tool sop-center-editor-tool--redo"
            aria-label="重做"
            title="重做"
          >
            <Undo size={15} />
          </button>
        </div>
        <div className="sop-center-editor-tool-group">
          <button
            type="button"
            onClick={() => formatLines('# ')}
            className="sop-center-editor-tool"
            aria-label="设为标题"
            title="标题"
          >
            <Heading size={15} />
          </button>
          <button
            type="button"
            onClick={() => formatLines('- ')}
            className="sop-center-editor-tool"
            aria-label="项目列表"
            title="项目列表"
          >
            <List size={15} />
          </button>
          <button
            type="button"
            onClick={() => formatLines('> ')}
            className="sop-center-editor-tool sop-center-editor-tool--text"
            aria-label="引用"
            title="引用"
          >
            “
          </button>
          <button
            type="button"
            onClick={insertCodeBlock}
            className="sop-center-editor-tool"
            aria-label="代码块"
            title="代码块"
          >
            <Code size={15} />
          </button>
        </div>
        <div className="sop-center-editor-tool-group sop-center-editor-tool-group--text">
          <span className="sop-center-editor-action-label">整理</span>
          <button
            type="button"
            onClick={() => runDocumentTool('自动分段', autoParagraphSopText)}
            className="sop-center-editor-tool sop-center-editor-tool--label"
            title="自动分段"
          >
            自动分段
          </button>
          <button
            type="button"
            onClick={() => runDocumentTool('统一格式', formatSopDocument)}
            className="sop-center-editor-tool sop-center-editor-tool--label"
            title="统一格式"
          >
            统一格式
          </button>
          <button
            type="button"
            onClick={() => runDocumentTool('清理粘贴', cleanPastedSopText)}
            className="sop-center-editor-tool sop-center-editor-tool--label"
            title="清理粘贴"
          >
            清理粘贴
          </button>
        </div>
        {elementPool.detected && (
          <div className="sop-center-editor-action-group sop-center-editor-action-group--ai" aria-label="元素池指令">
            <span className="sop-center-editor-action-label">
              <Sparkles size={13} />
              元素池
            </span>
            <button type="button" onClick={() => void runAiAction('pool-diagnose')} disabled={aiLoading !== null}>
              {aiLoading === 'pool-diagnose' && <Loader size={13} className="animate-spin" />}
              {AI_ACTION_LABELS['pool-diagnose']}
            </button>
            <button type="button" onClick={() => void runAiAction('pool-test-run')} disabled={aiLoading !== null}>
              {aiLoading === 'pool-test-run' && <Loader size={13} className="animate-spin" />}
              {AI_ACTION_LABELS['pool-test-run']}
            </button>
          </div>
        )}
        <div className="sop-center-editor-action-group sop-center-editor-action-group--ai">
          <span className="sop-center-editor-action-label">
            <Sparkles size={13} />
            Agent
          </span>
          <button type="button" onClick={() => void runAiAction('audit')} disabled={aiLoading !== null}>
            {aiLoading === 'audit' && <Loader size={13} className="animate-spin" />}
            {AI_ACTION_LABELS.audit}
          </button>
          <span className="sop-center-editor-model" title={`当前 Agent 模型：${agentProfile.model}`}>
            {agentProfile.model || '未配置模型'}
          </span>
        </div>
        <div className="sop-center-editor-search">
          <Search size={14} aria-hidden="true" />
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value)
              setSearchMessage('')
              setActiveSearchMatchStart(null)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              if (event.shiftKey) findPrev()
              else findNext()
            }}
            placeholder="查找正文"
            aria-label="查找正文"
          />
          <span
            className="sop-center-editor-search__result"
            data-empty={Boolean(searchQuery.trim()) && searchMatches.length === 0 ? true : undefined}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {searchFeedback}
          </span>
          <button type="button" onClick={findPrev} aria-label="查找上一处">
            上一个
          </button>
          <button type="button" onClick={findNext} aria-label="查找下一处">
            下一个
          </button>
        </div>
        <div className="sop-center-editor-tool-group sop-center-editor-tool-group--end">
          <button
            type="button"
            onClick={() => setWrap((current) => !current)}
            className="sop-center-editor-tool sop-center-editor-tool--label"
            data-active={wrap || undefined}
            aria-pressed={wrap}
            title="自动换行"
          >
            换行
          </button>
          <button
            type="button"
            onClick={() => void copyContent()}
            className="sop-center-editor-tool"
            aria-label="复制正文"
            title="复制正文"
          >
            <Copy size={15} />
          </button>
        </div>
      </div>

      <div className="sop-center-text-editor__workspace" data-chat-open="true">
        <div className="sop-center-text-editor__document-pane">
          {(aiError || aiResult) && (
            <aside className="sop-center-ai-result" data-kind={aiError ? 'error' : aiResult!.kind} aria-live="polite">
              <div className="sop-center-ai-result__header">
                <div className="min-w-0">
                  <strong>
                    {aiError ? 'AI 处理失败' : aiResult!.kind === 'audit' ? 'AI 检查预览' : `${aiResult!.label}预览`}
                  </strong>
                  <span>{aiError ? '原文未发生变化' : '报告不会改写正文'}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setAiError('')
                    setAiResult(null)
                  }}
                  aria-label="关闭 AI 结果"
                >
                  <Close size={14} />
                </button>
              </div>
              {aiError ? (
                <p className="sop-center-ai-result__error">{aiError}</p>
              ) : (
                <>
                  <pre>{aiResult!.content}</pre>
                  <div className="sop-center-ai-result__actions">
                    <button type="button" onClick={() => void copyAiResult()}>
                      <Copy size={13} />
                      复制结果
                    </button>
                  </div>
                </>
              )}
            </aside>
          )}

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => commit(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'f') {
                event.preventDefault()
                searchInputRef.current?.focus()
              }
            }}
            className="sop-center-text-editor__input"
            wrap={wrap ? 'soft' : 'off'}
            spellCheck="false"
            aria-label="SOP 正文"
          />

          <footer className="sop-center-text-editor__footer" aria-live="polite">
            <span>
              {stats.lines} 行 · {stats.characters} 字符
            </span>
            <span>{searchMessage || (copied ? '已复制到剪贴板' : wrap ? '自动换行已开启' : '自动换行已关闭')}</span>
          </footer>
        </div>
        <SopAiRevisionPanel
          documentId={documentId}
          value={value}
          onApply={(content) => {
            commit(content)
            setSearchMessage('AI 对话提案已应用，可撤销')
          }}
          onSaveAsRevision={onSaveAsRevision}
          onTestRevision={onTestRevision}
          variableMeta={variableMeta}
          onVariableMetaChange={onVariableMetaChange}
          onInsertVariableBlock={insertVariableBlock}
          instructionTemplates={elementPool.detected ? POOL_INSTRUCTION_BUTTONS : AI_CHAT_TEMPLATES}
        />
      </div>
    </section>
  )
}
