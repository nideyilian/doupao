import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlignLeftIcon as AlignLeft,
  ClipboardPlusIcon as ClipboardPlus,
  ChevronDownIcon as ChevronDown,
  CloseIcon as Close,
  CollectionManageIcon as List,
  CopyIcon as Copy,
  LoaderCircleIcon as Loader,
  RotateCcwIcon as Undo,
  SearchIcon as Search,
  SparklesIcon as Sparkles,
  TypeIcon as Type,
  TypeIcon as Heading,
} from '../../design-system/icons'
import { transformSopDocument, type SopAiOperation } from '../../lib/agentApi'
import { getAgentTextApiProfile, validateApiProfile } from '../../lib/apiProfiles'
import { copyTextToClipboard, getClipboardFailureMessage } from '../../lib/clipboard'
import { useStore } from '../../store'
import { autoParagraphSopText, cleanPastedSopText, formatSopDocument } from './sopTextFormatting'
import { parseElementPool } from './elementPool'
import SopAiRevisionPanel from './SopAiRevisionPanel'
import { createElementPoolQuickInstructions, SOP_QUICK_INSTRUCTIONS } from './sopAiQuickInstructions'
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
  const findReplaceRef = useRef<HTMLDivElement>(null)
  const aiAbortRef = useRef<AbortController | null>(null)
  const historyRef = useRef<string[]>([value])
  const historyIndexRef = useRef(0)
  const settings = useStore((state) => state.settings)
  const showToast = useStore((state) => state.showToast)
  const [searchQuery, setSearchQuery] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [searchMessage, setSearchMessage] = useState('')
  const [activeSearchMatchStart, setActiveSearchMatchStart] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const [wrap, setWrap] = useState(true)
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false })
  const [aiLoading, setAiLoading] = useState<string | null>(null)
  const [aiError, setAiError] = useState('')
  const [aiResult, setAiResult] = useState<AiResultState | null>(null)
  const [findReplaceOpen, setFindReplaceOpen] = useState(false)

  useEffect(() => {
    if (!findReplaceOpen) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFindReplaceOpen(false)
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [findReplaceOpen])

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
    setReplaceQuery('')
    setSearchMessage('')
    setActiveSearchMatchStart(null)
    setCopied(false)
    setAiLoading(null)
    setAiError('')
    setAiResult(null)
    setFindReplaceOpen(false)
  }, [documentId])

  useEffect(() => () => aiAbortRef.current?.abort(), [])

  useEffect(() => {
    if (!findReplaceOpen) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!findReplaceRef.current?.contains(event.target as Node)) setFindReplaceOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => document.removeEventListener('mousedown', closeOnOutsideClick)
  }, [findReplaceOpen])

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

  function replaceCurrentMatch() {
    const query = searchQuery.trim()
    if (!query) {
      searchInputRef.current?.focus()
      setSearchMessage('请输入查找内容')
      return
    }
    if (searchMatches.length === 0) {
      setSearchMessage(`未找到“${query}”`)
      return
    }

    const matchIndex = activeSearchMatchIndex >= 0 ? activeSearchMatchIndex : 0
    const matchStart = searchMatches[matchIndex]
    const matchEnd = matchStart + query.length
    const nextValue = `${value.slice(0, matchStart)}${replaceQuery}${value.slice(matchEnd)}`
    commit(nextValue, {
      start: matchStart,
      end: matchStart + replaceQuery.length,
    })
    setActiveSearchMatchStart(null)
    setSearchMessage('已替换当前匹配')
  }

  function replaceAllMatches() {
    const query = searchQuery.trim()
    if (!query) {
      searchInputRef.current?.focus()
      setSearchMessage('请输入查找内容')
      return
    }
    if (searchMatches.length === 0) {
      setSearchMessage(`未找到“${query}”`)
      return
    }

    let cursor = 0
    let nextValue = ''
    for (const matchStart of searchMatches) {
      nextValue += `${value.slice(cursor, matchStart)}${replaceQuery}`
      cursor = matchStart + query.length
    }
    nextValue += value.slice(cursor)
    commit(nextValue)
    setActiveSearchMatchStart(null)
    setSearchMessage(`已替换 ${searchMatches.length} 处`)
  }

  async function copyContent() {
    try {
      await copyTextToClipboard(value)
      setCopied(true)
      showToast('SOP 正文已复制', 'success')
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
        </div>
        <div className="sop-center-editor-tool-group sop-center-editor-tool-group--text">
          <span className="sop-center-editor-action-label">整理</span>
          <button
            type="button"
            onClick={() => runDocumentTool('统一格式', formatSopDocument)}
            className="sop-center-editor-tool sop-center-editor-tool--label"
            title="统一格式"
          >
            统一格式
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
        <div ref={findReplaceRef} className="sop-center-editor-search" aria-label="查找替换">
          <div className="sop-center-editor-search__row">
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
            <button
              type="button"
              onClick={() => setFindReplaceOpen((current) => !current)}
              aria-label="替换操作"
              aria-expanded={findReplaceOpen}
              aria-haspopup="dialog"
            >
              替换
            </button>
          </div>
          {findReplaceOpen && (
            <div className="sop-center-editor-search__replace-popover" role="dialog" aria-label="查找替换操作">
              <span className="sop-center-editor-search__label">替换为</span>
              <input
                value={replaceQuery}
                onChange={(event) => setReplaceQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  if (event.shiftKey) replaceAllMatches()
                  else replaceCurrentMatch()
                }}
                placeholder="输入替换内容"
                aria-label="替换为"
              />
              <button
                type="button"
                onClick={replaceCurrentMatch}
                disabled={!searchQuery.trim() || searchMatches.length === 0}
                aria-label="替换当前匹配"
              >
                替换
              </button>
              <button
                type="button"
                onClick={replaceAllMatches}
                disabled={!searchQuery.trim() || searchMatches.length === 0}
                aria-label="替换全部匹配"
              >
                全部替换
              </button>
            </div>
          )}
        </div>
        <div className="sop-center-editor-tool-group sop-center-editor-tool-group--end" aria-label="正文工具">
          <button
            type="button"
            onClick={() => runDocumentTool('自动分段', autoParagraphSopText)}
            className="sop-center-editor-tool"
            aria-label="自动分段"
            title="自动分段"
          >
            <AlignLeft size={15} />
          </button>
          <button
            type="button"
            onClick={() => runDocumentTool('清理粘贴', cleanPastedSopText)}
            className="sop-center-editor-tool"
            aria-label="清理粘贴"
            title="清理粘贴"
          >
            <ClipboardPlus size={15} />
          </button>
          <button
            type="button"
            onClick={() => setWrap((current) => !current)}
            className="sop-center-editor-tool"
            data-active={wrap || undefined}
            aria-pressed={wrap}
            aria-label={wrap ? '关闭自动换行' : '开启自动换行'}
            title={wrap ? '关闭自动换行' : '开启自动换行'}
          >
            <Type size={15} />
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
          instructionTemplates={
            elementPool.detected
              ? [
                  ...SOP_QUICK_INSTRUCTIONS.filter((item) => item.id !== 'sop-generalize'),
                  ...createElementPoolQuickInstructions(elementPool.levels),
                ]
              : SOP_QUICK_INSTRUCTIONS
          }
          quickInstructionScope={elementPool.detected ? 'element-pool' : undefined}
        />
      </div>
    </section>
  )
}
