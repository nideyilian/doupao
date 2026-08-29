import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Dialog, IconButton, TextArea, TextField } from '../../design-system'
import {
  CheckCircleIcon as CheckCircle,
  CopyIcon as Copy,
  HistoryIcon as History,
  LoaderCircleIcon as Loader,
  PlayIcon as Play,
  PlusIcon as Plus,
  RefreshIcon as RefreshCw,
  SaveIcon as Save,
  SendIcon as Send,
  SparklesIcon as Sparkles,
  TagsIcon as Tags,
  TrashIcon as Trash,
} from '../../design-system/icons'
import {
  reviseSopDocument,
  reviseSopMetaInstruction,
  reviseVariablePromptOptions,
  type SopRevisionConversationMessage,
  type VariableOptionRevisionMode,
} from '../../lib/agentApi'
import { getAgentTextApiProfile, validateApiProfile } from '../../lib/apiProfiles'
import { useAppDialog } from '../../hooks/useAppDialog'
import { useStore } from '../../store'
import { parseVariablePrompt } from '../../lib/variablePrompt'
import {
  DEFAULT_VARIABLE_TYPE,
  VARIABLE_TYPE_OPTIONS,
  deriveVariableMetaFromContent,
  normalizeVariableMeta,
  replaceVariableOptions,
  updateVariableMeta,
} from './variablePromptMeta'
import type { SopVariableMeta } from './types'
import {
  clearSopAiRevisionJob,
  clearSopAiRevisionThread,
  createSopAiRevisionMessage,
  getSopAiRevisionJobState,
  loadSopAiRevisionThread,
  saveSopAiRevisionThread,
  startSopAiRevisionJob,
  subscribeSopAiRevisionJob,
  type SopAiRevisionMessage,
} from './sopAiRevision'

type SopAiRevisionPanelProps = {
  documentId: string
  value: string
  onApply: (value: string) => void
  onSaveAsRevision?: (value: string) => void
  onTestRevision?: (value: string) => Promise<void>
  revisionTarget?: 'sop' | 'meta-instruction'
  /** 变量提示词资产的可变项参数（持久化增强层）；缺省时由正文推导 */
  variableMeta?: SopVariableMeta[]
  /** 应用可变项选项提案后回传最新参数（用于持久化） */
  onVariableMetaChange?: (meta: SopVariableMeta[]) => void
  /** 正文不是变量模板时，一键在正文末尾插入「可变项：」示例区块 */
  onInsertVariableBlock?: () => void
  /**
   * 快捷指令模板（来自正文编辑器）：点击直接填入输入框，发送前可编辑。
   * AI 指令与对话同处侧栏，避免在编辑区与对话区之间来回寻找入口。
   */
  instructionTemplates?: ReadonlyArray<{ label: string; instruction: string }>
}

const STARTER_REQUESTS = {
  sop: [
    '先诊断这份 SOP 最影响执行稳定性的三个问题，再给出完整修订版。',
    '在不遗漏任何约束的前提下，重组结构并减少重复。',
    '重点优化生图提示词的一致性、变化范围和验收标准。',
  ],
  'meta-instruction': [
    '先诊断这份元指令最容易导致输出漂移的三个问题，再给出完整修订版。',
    '强化输入分析、约束保留和输出格式，同时减少重复说明。',
    '检查是否存在歧义、指令冲突或缺失的失败处理要求。',
  ],
} as const

function toConversationMessages(messages: SopAiRevisionMessage[]): SopRevisionConversationMessage[] {
  return messages.map((message) => ({
    role: message.role,
    text: message.text,
    revisionContent: message.revision?.content,
  }))
}

function formatMessageTime(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(timestamp)
}

function normalizeCountInput(value: string) {
  const parsed = Math.trunc(Number(value))
  if (!Number.isFinite(parsed) || parsed < 1) return 1
  return Math.min(60, parsed)
}

/** 自定义快捷指令：用户自建的对话预填模板，持久化在 localStorage（本机生效）。 */
export type SopCustomInstruction = { id: string; label: string; instruction: string }

const CUSTOM_INSTRUCTIONS_KEY = 'doupao.sop-custom-quick-instructions'
const MAX_CUSTOM_INSTRUCTIONS = 20

export function loadCustomInstructions(): SopCustomInstruction[] {
  try {
    const raw = window.localStorage.getItem(CUSTOM_INSTRUCTIONS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is SopCustomInstruction =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as SopCustomInstruction).id === 'string' &&
        typeof (item as SopCustomInstruction).label === 'string' &&
        typeof (item as SopCustomInstruction).instruction === 'string',
    )
  } catch {
    return []
  }
}

export function saveCustomInstructions(items: SopCustomInstruction[]): void {
  try {
    window.localStorage.setItem(CUSTOM_INSTRUCTIONS_KEY, JSON.stringify(items))
  } catch {
    // 存储失败不影响当前会话内的使用
  }
}

export default function SopAiRevisionPanel({
  documentId,
  value,
  onApply,
  onSaveAsRevision,
  onTestRevision,
  revisionTarget = 'sop',
  variableMeta,
  onVariableMetaChange,
  onInsertVariableBlock,
  instructionTemplates,
}: SopAiRevisionPanelProps) {
  const endRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const settings = useStore((state) => state.settings)
  const showToast = useStore((state) => state.showToast)
  const { openConfirmDialog } = useAppDialog()
  const profile = useMemo(() => getAgentTextApiProfile(settings), [settings])
  const [messages, setMessages] = useState<SopAiRevisionMessage[]>([])
  const [input, setInput] = useState('')
  const [jobState, setJobState] = useState(() => getSopAiRevisionJobState(documentId))
  const [localError, setLocalError] = useState('')
  const [testingMessageId, setTestingMessageId] = useState('')
  const [activeOptionVariable, setActiveOptionVariable] = useState<string | null>(null)
  const [customInstructions, setCustomInstructions] = useState<SopCustomInstruction[]>(loadCustomInstructions)
  const [customDialogOpen, setCustomDialogOpen] = useState(false)
  const [customLabel, setCustomLabel] = useState('')
  const [customInstruction, setCustomInstruction] = useState('')
  const loading = jobState.status === 'running'
  const error = localError || (jobState.status === 'error' ? jobState.error : '')
  const canRetry = !localError && jobState.status === 'error'
  const isMetaInstruction = revisionTarget === 'meta-instruction'

  const isVariablePrompt = useMemo(
    () => !isMetaInstruction && parseVariablePrompt(value).detected,
    [isMetaInstruction, value],
  )
  const [localVariableMeta, setLocalVariableMeta] = useState<SopVariableMeta[]>(() =>
    isVariablePrompt ? normalizeVariableMeta(value, variableMeta ?? deriveVariableMetaFromContent(value)) : [],
  )
  const ui = isMetaInstruction
    ? {
        title: '生成元指令 AI 优化',
        ariaLabel: '生成元指令 AI 对话优化',
        emptyTitle: '从当前元指令开始一轮可回溯优化',
        emptyDescription: 'AI 每次都会返回完整生成元指令提案，确认后应用到编辑器再保存。',
        assistantLabel: 'AI 元指令提案',
        detailLabel: '查看完整元指令',
        applyLabel: '应用到元指令',
        applyToast: '元指令提案已应用到编辑器，请确认后保存',
        copyToast: '元指令提案已复制',
        clearTitle: '清空元指令 AI 对话记录？',
        clearMessage: '将删除当前生成元指令的全部对话与修订提案，元指令正文不会受到影响。',
        thinking: '正在后台生成完整元指令修订版，关闭对话框不会中断…',
        placeholder: '描述你希望如何优化元指令；Enter 发送，Shift+Enter 换行',
        inputLabel: '向 AI 描述生成元指令修改要求',
        sendLabel: '发送生成元指令修改要求',
      }
    : isVariablePrompt
      ? {
          title: '可变项 AI 工作台',
          ariaLabel: '可变项 AI 对话优化',
          emptyTitle: '从当前模板开始一轮可回溯优化',
          emptyDescription:
            '在上方调整可变项的主题、类型与数量，AI 会增量衍生或整体改写选项池；结果作为提案进入下方对话，确认后应用到正文。',
          assistantLabel: 'AI 选项提案',
          detailLabel: '查看合并后的完整模板',
          applyLabel: '应用选项',
          applyToast: '选项提案已应用到正文，可用编辑器撤销',
          copyToast: '选项提案已复制',
          clearTitle: '清空 AI 对话记录？',
          clearMessage: '将删除当前模板的全部对话与修订提案，正文不会受到影响。',
          thinking: '正在后台生成可变项选项，关闭对话框不会中断…',
          placeholder: '也可以直接描述修改要求；Enter 发送，Shift+Enter 换行',
          inputLabel: '向 AI 描述模板修改要求',
          sendLabel: '发送模板修改要求',
        }
      : {
          title: 'AI 对话优化',
          ariaLabel: 'SOP AI 对话优化',
          emptyTitle: '从当前正文开始一轮可回溯优化',
          emptyDescription: 'AI 每次都会返回完整 SOP 提案。先测试生图，确认效果后再应用到正文。',
          assistantLabel: 'AI 修订提案',
          detailLabel: '查看完整 SOP',
          applyLabel: '应用到正文',
          applyToast: 'SOP 提案已应用到正文，可用编辑器撤销',
          copyToast: 'SOP 提案已复制',
          clearTitle: '清空 AI 对话记录？',
          clearMessage: '将删除当前 SOP 的全部对话与修订提案，正文不会受到影响。',
          thinking: '正在后台生成完整修订版，关闭对话框不会中断…',
          placeholder: '描述你希望如何修改；Enter 发送，Shift+Enter 换行',
          inputLabel: '向 AI 描述 SOP 修改要求',
          sendLabel: '发送 SOP 修改要求',
        }

  useEffect(() => {
    setMessages(loadSopAiRevisionThread(documentId).messages)
    setInput('')
    setJobState(getSopAiRevisionJobState(documentId))
    setLocalError('')
    setTestingMessageId('')
    return subscribeSopAiRevisionJob(documentId, (state) => {
      setJobState(state)
      setMessages(loadSopAiRevisionThread(documentId).messages)
    })
  }, [documentId])

  // 正文变化时以正文为准重算可变项参数（面板内编辑的参数保留）。
  useEffect(() => {
    if (!isVariablePrompt) {
      setLocalVariableMeta([])
      return
    }
    setLocalVariableMeta((current) =>
      normalizeVariableMeta(
        value,
        current.length > 0 ? current : (variableMeta ?? deriveVariableMetaFromContent(value)),
      ),
    )
  }, [isVariablePrompt, value, variableMeta])

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [loading, messages])

  function commitMessages(nextMessages: SopAiRevisionMessage[]) {
    setMessages(nextMessages)
    saveSopAiRevisionThread(documentId, nextMessages)
  }

  function getProfileError() {
    const validationError = validateApiProfile(profile)
    if (validationError || profile.provider !== 'openai') {
      return validationError
        ? `请先完善 Agent 配置：${validationError}`
        : `${isMetaInstruction ? '生成元指令' : isVariablePrompt ? '可变项' : 'SOP'}对话优化需要 OpenAI 兼容的 Agent 配置`
    }
    return ''
  }

  async function requestRevision(requestMessages: SopAiRevisionMessage[]) {
    const profileError = getProfileError()
    if (profileError) {
      setLocalError(profileError)
      showToast(profileError, 'error')
      return
    }

    setLocalError('')
    const revise = isMetaInstruction ? reviseSopMetaInstruction : reviseSopDocument
    const result = await startSopAiRevisionJob(documentId, () =>
      revise({
        settings,
        profile,
        content: value,
        conversation: toConversationMessages(requestMessages),
      }),
    )
    if (result.ok) {
      showToast(
        isMetaInstruction
          ? 'AI 已生成一版完整元指令提案'
          : isVariablePrompt
            ? 'AI 已生成一版完整模板修订提案'
            : 'AI 已生成一版可测试的 SOP 提案',
        'success',
      )
    } else {
      showToast(result.error, 'error')
    }
  }

  async function sendMessage() {
    const request = input.trim()
    if (!request || loading) return
    const nextMessages = [...messages, createSopAiRevisionMessage('user', request)]
    commitMessages(nextMessages)
    setInput('')
    await requestRevision(nextMessages)
  }

  async function runOptionRevision(variableName: string, mode: VariableOptionRevisionMode) {
    if (loading) return
    const meta = localVariableMeta.find((item) => item.name === variableName)
    if (!meta) return
    const profileError = getProfileError()
    if (profileError) {
      setLocalError(profileError)
      showToast(profileError, 'error')
      return
    }

    setLocalError('')
    const themeText = meta.theme.trim() || '沿用现有方向'
    const request =
      mode === 'derive'
        ? `为可变项「${variableName}」衍生选项：主题：${themeText}；类型：${meta.type}；目标数量：${meta.count}。保留现有选项，增量补齐到 ${meta.count} 个。`
        : `按新参数改写可变项「${variableName}」的选项池：主题：${themeText}；类型：${meta.type}；目标数量：${meta.count}。`
    commitMessages([...messages, createSopAiRevisionMessage('user', request)])
    setActiveOptionVariable(variableName)
    const result = await startSopAiRevisionJob(documentId, () =>
      reviseVariablePromptOptions({
        settings,
        profile,
        content: value,
        variableName,
        theme: meta.theme,
        type: meta.type,
        count: meta.count,
        mode,
      }).then((generated) => {
        const merged = replaceVariableOptions(value, variableName, generated.options)
        return {
          reply: generated.reasoning,
          content: merged,
          changeSummary: [
            mode === 'derive'
              ? `「${variableName}」新增 ${generated.options.length} 个选项`
              : `「${variableName}」选项池已按主题「${themeText}」/类型「${meta.type}」重写`,
            `目标 ${meta.count} 个，实际可用 ${generated.options.length} 个`,
          ],
          variableName,
          options: generated.options,
          mode,
        }
      }),
    )
    setActiveOptionVariable(null)
    if (result.ok) {
      showToast(
        mode === 'derive'
          ? `已为「${variableName}」生成一版衍生选项提案`
          : `已为「${variableName}」生成一版改写选项提案`,
        'success',
      )
    } else {
      showToast(result.error, 'error')
    }
  }

  function updateCardMeta(variableName: string, patch: Partial<Pick<SopVariableMeta, 'theme' | 'type' | 'count'>>) {
    const next = updateVariableMeta(localVariableMeta, variableName, patch)
    setLocalVariableMeta(next)
    onVariableMetaChange?.(next)
  }

  function applyRevision(message: SopAiRevisionMessage) {
    if (!message.revision) return
    onApply(message.revision.content)
    if (message.revision.variableName && message.revision.options) {
      // 选项应用后把目标数量同步为实际选项数；主题/类型保留卡片上的当前值。
      const nextMeta = updateVariableMeta(localVariableMeta, message.revision.variableName, {
        count: message.revision.options.length,
      })
      setLocalVariableMeta(nextMeta)
      onVariableMetaChange?.(nextMeta)
    }
    const appliedAt = Date.now()
    const nextMessages = messages.map((item) =>
      item.id === message.id && item.revision ? { ...item, revision: { ...item.revision, appliedAt } } : item,
    )
    commitMessages(nextMessages)
    showToast(ui.applyToast, 'success')
  }

  async function copyRevision(message: SopAiRevisionMessage) {
    if (!message.revision) return
    try {
      await navigator.clipboard.writeText(message.revision.content)
      showToast(ui.copyToast, 'success')
    } catch {
      showToast('复制失败，请检查剪贴板权限', 'error')
    }
  }

  function saveAsRevision(message: SopAiRevisionMessage) {
    if (!message.revision || !onSaveAsRevision) return
    onSaveAsRevision(message.revision.content)
    showToast('SOP 提案已另存为新版', 'success')
  }

  async function testRevision(message: SopAiRevisionMessage) {
    if (!message.revision || !onTestRevision || testingMessageId) return
    setTestingMessageId(message.id)
    try {
      await onTestRevision(message.revision.content)
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : '测试生图提交失败', 'error')
    } finally {
      setTestingMessageId('')
    }
  }

  function clearHistory() {
    openConfirmDialog({
      title: ui.clearTitle,
      message: ui.clearMessage,
      confirmText: '清空记录',
      tone: 'danger',
      action: () => {
        clearSopAiRevisionJob(documentId)
        clearSopAiRevisionThread(documentId)
        setMessages([])
        setLocalError('')
        showToast('AI 对话记录已清空', 'success')
      },
    })
  }

  /** 填入输入框并聚焦：内置模板与自定义指令共用。 */
  function applyQuickInstruction(instruction: string) {
    setInput(instruction)
    composerRef.current?.focus()
  }

  function addCustomInstruction() {
    const label = customLabel.trim()
    const instruction = customInstruction.trim()
    if (!label || !instruction) {
      showToast('请填写指令名称与内容', 'error')
      return
    }
    if (customInstructions.length >= MAX_CUSTOM_INSTRUCTIONS) {
      showToast(`最多添加 ${MAX_CUSTOM_INSTRUCTIONS} 条自定义指令`, 'error')
      return
    }
    const next = [
      ...customInstructions,
      {
        id: `sop-quick-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        label,
        instruction,
      },
    ]
    setCustomInstructions(next)
    saveCustomInstructions(next)
    setCustomLabel('')
    setCustomInstruction('')
    setCustomDialogOpen(false)
    showToast(`已添加快捷指令「${label}」`, 'success')
  }

  function removeCustomInstruction(id: string) {
    const next = customInstructions.filter((item) => item.id !== id)
    setCustomInstructions(next)
    saveCustomInstructions(next)
    showToast('已删除自定义快捷指令', 'info')
  }

  return (
    <aside className="sop-ai-chat" aria-label={ui.ariaLabel}>
      <header className="sop-ai-chat__header">
        <div className="min-w-0">
          <strong>
            <Sparkles size={14} />
            {ui.title}
          </strong>
          <span title={`当前模型：${profile.model || '未配置'}`}>
            {profile.model || '未配置模型'} · 本机保留最近 30 条
          </span>
        </div>
        <button
          type="button"
          onClick={clearHistory}
          disabled={messages.length === 0 || loading}
          aria-label={`清空${isMetaInstruction ? '元指令 ' : ' '}AI 对话记录`}
          title="清空记录"
        >
          <Trash size={14} />
        </button>
      </header>

      {isVariablePrompt && (
        <section className="sop-variable-workspace" aria-label="可变项参数工作台">
          <header className="sop-variable-workspace__header">
            <strong>
              <Tags size={13} />
              可变项参数
            </strong>
            <span>正文解析 {localVariableMeta.length} 个变量 · 调整后点「AI 衍生」或「改写」</span>
          </header>
          <div className="sop-variable-workspace__list">
            {localVariableMeta.map((meta) => {
              const active = activeOptionVariable === meta.name
              return (
                <article key={meta.name} className="sop-variable-card" data-active={active || undefined}>
                  <div className="sop-variable-card__title">
                    <code>{`{{${meta.name}}}`}</code>
                    <span>{meta.count} 个选项</span>
                  </div>
                  <div className="sop-variable-card__fields">
                    <label>
                      <span>主题</span>
                      <input
                        value={meta.theme}
                        disabled={loading}
                        placeholder="如：高端美妆"
                        onChange={(event) => updateCardMeta(meta.name, { theme: event.target.value })}
                        aria-label={`${meta.name} 主题`}
                      />
                    </label>
                    <label>
                      <span>类型</span>
                      <input
                        value={meta.type}
                        disabled={loading}
                        list="sop-variable-type-options"
                        placeholder={DEFAULT_VARIABLE_TYPE}
                        onChange={(event) => updateCardMeta(meta.name, { type: event.target.value })}
                        aria-label={`${meta.name} 类型`}
                      />
                      <datalist id="sop-variable-type-options">
                        {VARIABLE_TYPE_OPTIONS.map((option) => (
                          <option key={option} value={option} />
                        ))}
                      </datalist>
                    </label>
                    <label>
                      <span>数量</span>
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={meta.count}
                        disabled={loading}
                        onChange={(event) =>
                          updateCardMeta(meta.name, { count: normalizeCountInput(event.target.value) })
                        }
                        aria-label={`${meta.name} 数量`}
                      />
                    </label>
                  </div>
                  <div className="sop-variable-card__actions">
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => void runOptionRevision(meta.name, 'rewrite')}
                    >
                      <RefreshCw size={12} />
                      改写
                    </button>
                    <button
                      type="button"
                      className="sop-variable-card__derive"
                      disabled={loading}
                      onClick={() => void runOptionRevision(meta.name, 'derive')}
                    >
                      {active ? <Loader size={12} className="animate-spin" /> : <Sparkles size={12} />}
                      {active ? '衍生中' : 'AI 衍生'}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      )}

      <div className="sop-ai-chat__messages" aria-live="polite">
        {messages.length === 0 && !loading && (
          <div className="sop-ai-chat__empty">
            <History size={20} />
            <strong>{ui.emptyTitle}</strong>
            <p>{ui.emptyDescription}</p>
            <div className="sop-ai-chat__starters">
              {STARTER_REQUESTS[revisionTarget].map((request) => (
                <button key={request} type="button" onClick={() => setInput(request)}>
                  {request}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <article key={message.id} className="sop-ai-chat__message" data-role={message.role}>
            <div className="sop-ai-chat__message-meta">
              <strong>{message.role === 'user' ? '你' : ui.assistantLabel}</strong>
              <time dateTime={new Date(message.createdAt).toISOString()}>{formatMessageTime(message.createdAt)}</time>
            </div>
            <p className="sop-ai-chat__message-text">{message.text}</p>
            {message.revision && (
              <div className="sop-ai-chat__revision">
                <ul>
                  {message.revision.changeSummary.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                {message.revision.variableName && message.revision.options && (
                  <div className="sop-ai-chat__option-list">
                    <strong>
                      {message.revision.mode === 'derive' ? '衍生' : '改写'}「{message.revision.variableName}」·{' '}
                      {message.revision.options.length} 个新选项
                    </strong>
                    <ol>
                      {message.revision.options.map((option) => (
                        <li key={option}>{option}</li>
                      ))}
                    </ol>
                  </div>
                )}
                <details>
                  <summary>
                    {ui.detailLabel} · {message.revision.content.length} 字符
                  </summary>
                  <pre>{message.revision.content}</pre>
                </details>
                <div className="sop-ai-chat__revision-actions">
                  {!isMetaInstruction && !message.revision.variableName && (
                    <button
                      type="button"
                      onClick={() => void testRevision(message)}
                      disabled={!onTestRevision || Boolean(testingMessageId)}
                    >
                      {testingMessageId === message.id ? (
                        <Loader size={13} className="animate-spin" />
                      ) : (
                        <Play size={13} />
                      )}
                      {testingMessageId === message.id ? '正在提交' : '测试生图'}
                    </button>
                  )}
                  <button type="button" onClick={() => void copyRevision(message)}>
                    <Copy size={13} />
                    复制
                  </button>
                  {onSaveAsRevision && (
                    <button type="button" onClick={() => saveAsRevision(message)}>
                      <Save size={13} />
                      另存为新版
                    </button>
                  )}
                  <button type="button" className="sop-ai-chat__apply" onClick={() => applyRevision(message)}>
                    <CheckCircle size={13} />
                    {message.revision.appliedAt ? '再次应用' : ui.applyLabel}
                  </button>
                </div>
                {message.revision.appliedAt && (
                  <span className="sop-ai-chat__applied">已应用于 {formatMessageTime(message.revision.appliedAt)}</span>
                )}
              </div>
            )}
          </article>
        ))}

        {loading && (
          <div className="sop-ai-chat__thinking">
            <Loader size={14} className="animate-spin" />
            {ui.thinking}
          </div>
        )}
        {error && (
          <div className="sop-ai-chat__error" role="alert">
            <span>{error}</span>
            {canRetry && (
              <button type="button" onClick={() => void requestRevision(messages)} disabled={loading}>
                重试
              </button>
            )}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {((instructionTemplates?.length ?? 0) > 0 ||
        customInstructions.length > 0 ||
        (!isMetaInstruction && !isVariablePrompt && onInsertVariableBlock)) && (
        <div className="sop-ai-chat__quick" aria-label="AI 快捷指令">
          {instructionTemplates?.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={loading}
              onClick={() => applyQuickInstruction(item.instruction)}
            >
              {item.label}
            </button>
          ))}
          {customInstructions.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={loading}
              title={item.instruction}
              onClick={() => applyQuickInstruction(item.instruction)}
            >
              {item.label}
            </button>
          ))}
          {!isMetaInstruction && !isVariablePrompt && onInsertVariableBlock && (
            <button
              type="button"
              aria-label="可变项工作台启用引导"
              title="在正文末尾插入「可变项：」区块，即可按主题/类型/数量衍生变量选项"
              onClick={onInsertVariableBlock}
            >
              <Tags size={12} />
              插入可变项示例
            </button>
          )}
          <button
            type="button"
            className="sop-ai-chat__quick-add"
            aria-label="添加自定义快捷指令"
            onClick={() => setCustomDialogOpen(true)}
          >
            <Plus size={12} />
            自定义
          </button>
        </div>
      )}

      <Dialog
        open={customDialogOpen}
        onOpenChange={setCustomDialogOpen}
        title="自定义快捷指令"
        description="点击胶囊会把指令填入输入框，发送前可编辑；保存在本机。"
        size="md"
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <TextField
              label="指令名称"
              value={customLabel}
              onChange={(event) => setCustomLabel(event.target.value)}
              placeholder="例如：检查生图红线"
            />
            <TextArea
              label="指令内容"
              value={customInstruction}
              onChange={(event) => setCustomInstruction(event.target.value)}
              placeholder="描述希望 AI 如何修改 SOP；发送前可再调整"
              containerClassName="sop-ai-chat__custom-draft"
              className="leading-5"
            />
            <Button
              variant="primary"
              size="sm"
              disabled={!customLabel.trim() || !customInstruction.trim()}
              onClick={addCustomInstruction}
              leadingIcon={<Plus size={14} />}
              className="self-end"
            >
              添加
            </Button>
          </div>
          {customInstructions.length > 0 && (
            <div className="border-t border-ds-border pt-3">
              <p className="mb-2 text-xs font-medium text-ds-muted">
                已保存（{customInstructions.length} / {MAX_CUSTOM_INSTRUCTIONS}）
              </p>
              <div className="sop-ai-chat__custom-list">
                {customInstructions.map((item) => (
                  <div key={item.id} className="sop-ai-chat__custom-item">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{item.label}</p>
                      <p className="sop-center-quiet-text mt-0.5 line-clamp-1 text-xs">{item.instruction}</p>
                    </div>
                    <IconButton
                      size="sm"
                      onClick={() => removeCustomInstruction(item.id)}
                      aria-label={`删除自定义指令 ${item.label}`}
                      title="删除"
                      icon={<Trash size={13} />}
                      className="sop-center-action--danger"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Dialog>

      <div className="sop-ai-chat__composer">
        <textarea
          ref={composerRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void sendMessage()
            }
          }}
          maxLength={4000}
          placeholder={ui.placeholder}
          aria-label={ui.inputLabel}
          disabled={loading}
        />
        <button
          type="button"
          onClick={() => void sendMessage()}
          disabled={!input.trim() || loading}
          aria-label={ui.sendLabel}
        >
          {loading ? <Loader size={15} className="animate-spin" /> : <Send size={15} />}
        </button>
      </div>
    </aside>
  )
}
