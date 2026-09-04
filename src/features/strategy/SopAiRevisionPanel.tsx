import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
} from 'react'
import { Button, Checkbox, Dialog, IconButton, SelectField, TextArea, TextField } from '../../design-system'
import {
  CheckCircleIcon as CheckCircle,
  ChevronDownIcon as ChevronDown,
  CopyIcon as Copy,
  EditIcon as Edit,
  HistoryIcon as History,
  ImagePlusIcon as ImagePlus,
  LoaderCircleIcon as Loader,
  PlayIcon as Play,
  PlusIcon as Plus,
  RefreshIcon as RefreshCw,
  SaveIcon as Save,
  SearchIcon as Search,
  SendIcon as Send,
  Settings2Icon as Settings2,
  SparklesIcon as Sparkles,
  TagsIcon as Tags,
  TrashIcon as Trash,
  XIcon as X,
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
import { useCloseOnEscape } from '../../hooks/useCloseOnEscape'
import { createInputImageFromFile, ensureImageCached, useStore } from '../../store'
import { getImageThumbnail } from '../../lib/db'
import { compressSopReferenceImageIfNeeded } from '../../lib/sopReferenceImageCompression'
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
  type SopAiRevisionAttachment,
  type SopAiRevisionMessage,
} from './sopAiRevision'
import {
  getSopQuickInstructionScopeLabel,
  META_QUICK_INSTRUCTIONS,
  matchesSopQuickInstructionScope,
  SOP_QUICK_INSTRUCTIONS,
  type SopQuickInstruction,
  type SopQuickInstructionScope,
} from './sopAiQuickInstructions'

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
  /**
   * 快捷指令模板（来自正文编辑器）：点击填入输入框，发送前可编辑。
   * AI 指令与对话同处侧栏，避免在编辑区与对话区之间来回寻找入口。
   */
  instructionTemplates?: ReadonlyArray<SopQuickInstruction>
  /** 当前快捷指令场景；缺省时根据修订目标与正文自动判断。 */
  quickInstructionScope?: SopQuickInstructionScope
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

const MAX_AI_CHAT_ATTACHMENTS = 6
const MAX_AI_CHAT_ATTACHMENT_BYTES = 10 * 1024 * 1024
const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

type PendingSopAiAttachment = SopAiRevisionAttachment & { dataUrl: string }

function normalizeImageFile(file: File): File | null {
  if (file.type.startsWith('image/')) return file
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  const mimeType = IMAGE_MIME_BY_EXTENSION[extension]
  if (!mimeType) return null
  return new File([file], file.name, { type: mimeType, lastModified: file.lastModified })
}

function getImageFiles(items: DataTransferItemList | null | undefined): File[] {
  if (!items) return []
  return Array.from(items).flatMap((item) => {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) return []
    const file = item.getAsFile()
    return file ? [file] : []
  })
}

function getDraggedImageIds(dataTransfer: DataTransfer): string[] {
  const text = dataTransfer.getData('text/plain')
  if (text.startsWith('agent-images:')) return text.slice('agent-images:'.length).split(',').filter(Boolean)
  if (text.startsWith('agent-image:')) return [text.slice('agent-image:'.length)].filter(Boolean)
  if (text.startsWith('asset-image:')) return [text.slice('asset-image:'.length)].filter(Boolean)
  return []
}

function toConversationMessages(
  messages: SopAiRevisionMessage[],
): SopRevisionConversationMessage[] | Promise<SopRevisionConversationMessage[]> {
  if (!messages.some((message) => message.attachments?.length)) {
    return messages.map((message) => ({
      role: message.role,
      text: message.text,
      revisionContent: message.revision?.content,
    }))
  }
  return Promise.all(
    messages.map(async (message) => {
      const imageDataUrls = await Promise.all(
        (message.attachments ?? []).map(async (attachment) => {
          const dataUrl = await ensureImageCached(attachment.id)
          if (!dataUrl) throw new Error(`对话图片「${attachment.name}」已不存在，请重新添加`)
          return (await compressSopReferenceImageIfNeeded(dataUrl)).dataUrl
        }),
      )
      return {
        role: message.role,
        text: message.text,
        revisionContent: message.revision?.content,
        ...(imageDataUrls.length > 0 ? { imageDataUrls } : {}),
      }
    }),
  )
}

function introducesVariablePromptSyntax(source: string, revised: string) {
  const syntaxPattern = /\{\{\s*[^{}\r\n]+\s*\}\}|^\s*可变项\s*[：:]\s*$/mu
  return !syntaxPattern.test(source) && syntaxPattern.test(revised)
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
export type SopCustomInstruction = {
  id: string
  label: string
  instruction: string
  scope: SopQuickInstructionScope
}
type SopCustomInstructionInput = Omit<SopCustomInstruction, 'scope'> & { scope?: SopQuickInstructionScope }
export type SopQuickInstructionOverride = {
  label?: string
  description?: string
  instruction?: string
  instructionTemplate?: string
}

const CUSTOM_INSTRUCTIONS_KEY = 'doupao.sop-custom-quick-instructions'
const QUICK_INSTRUCTION_OVERRIDES_KEY = 'doupao.sop-quick-instruction-overrides'
const MAX_CUSTOM_INSTRUCTIONS = 20
const QUICK_SCOPE_OPTIONS = [
  { value: 'all', label: '全部场景' },
  { value: 'sop', label: '通用 SOP' },
  { value: 'element-pool', label: '元素池' },
  { value: 'variable-prompt', label: '变量提示词' },
  { value: 'meta-instruction', label: '元指令' },
] satisfies Array<{ value: SopQuickInstructionScope; label: string }>

export function loadCustomInstructions(): SopCustomInstruction[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(CUSTOM_INSTRUCTIONS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      if (
        !item ||
        typeof item !== 'object' ||
        typeof (item as SopCustomInstruction).id !== 'string' ||
        typeof (item as SopCustomInstruction).label !== 'string' ||
        typeof (item as SopCustomInstruction).instruction !== 'string'
      ) {
        return []
      }
      const rawScope = (item as Partial<SopCustomInstruction>).scope
      const scope: SopQuickInstructionScope =
        rawScope === 'all' ||
        rawScope === 'sop' ||
        rawScope === 'element-pool' ||
        rawScope === 'variable-prompt' ||
        rawScope === 'meta-instruction'
          ? rawScope
          : 'all'
      return [
        {
          id: (item as SopCustomInstruction).id,
          label: (item as SopCustomInstruction).label,
          instruction: (item as SopCustomInstruction).instruction,
          scope,
        },
      ]
    })
  } catch {
    return []
  }
}

export function saveCustomInstructions(items: SopCustomInstructionInput[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(CUSTOM_INSTRUCTIONS_KEY, JSON.stringify(items))
  } catch {
    // 存储失败不影响当前会话内的使用
  }
}

export function loadQuickInstructionOverrides(): Record<string, SopQuickInstructionOverride> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(QUICK_INSTRUCTION_OVERRIDES_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.entries(parsed).reduce<Record<string, SopQuickInstructionOverride>>((result, [id, value]) => {
      if (!value || typeof value !== 'object') return result
      const item = value as Partial<SopQuickInstructionOverride>
      const override: SopQuickInstructionOverride = {}
      if (typeof item.label === 'string') override.label = item.label
      if (typeof item.description === 'string') override.description = item.description
      if (typeof item.instruction === 'string') override.instruction = item.instruction
      if (typeof item.instructionTemplate === 'string') override.instructionTemplate = item.instructionTemplate
      if (Object.keys(override).length > 0) result[id] = override
      return result
    }, {})
  } catch {
    return {}
  }
}

export function saveQuickInstructionOverrides(overrides: Record<string, SopQuickInstructionOverride>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(QUICK_INSTRUCTION_OVERRIDES_KEY, JSON.stringify(overrides))
  } catch {
    // 存储失败不影响当前会话内的使用
  }
}

function normalizeQuickInstruction(
  item: SopQuickInstruction,
  index: number,
  activeScope: SopQuickInstructionScope,
): SopQuickInstruction {
  return {
    ...item,
    id: item.id ?? `quick-instruction-${activeScope}-${index}`,
    description: item.description ?? item.instruction ?? '点击后填入输入框，发送前可继续编辑。',
    scope: item.scope ?? activeScope,
  }
}

function applyQuickInstructionOverride(
  item: SopQuickInstruction,
  overrides: Record<string, SopQuickInstructionOverride>,
) {
  const override = item.id ? overrides[item.id] : undefined
  return {
    ...item,
    ...(override?.label !== undefined ? { label: override.label } : {}),
    ...(override?.description !== undefined ? { description: override.description } : {}),
    ...(override?.instruction !== undefined ? { instruction: override.instruction } : {}),
    ...(override?.instructionTemplate !== undefined ? { instructionTemplate: override.instructionTemplate } : {}),
  }
}

function formatInstructionTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\[\[([^[\]]+)\]\]/gu, (placeholder, key: string) => values[key] ?? placeholder)
}

function getMultiSelectValues(value: string) {
  return value
    .split('、')
    .map((item) => item.trim())
    .filter(Boolean)
}

function toggleMultiSelectValue(currentValue: string, nextValue: string, allValue = '全部层') {
  if (nextValue === allValue) return allValue
  const selectedValues = getMultiSelectValues(currentValue).filter((item) => item !== allValue)
  const nextValues = selectedValues.includes(nextValue)
    ? selectedValues.filter((item) => item !== nextValue)
    : [...selectedValues, nextValue]
  return nextValues.join('、')
}

function getQuickInstructionBody(item: SopQuickInstruction) {
  return item.parameters?.length
    ? (item.instructionTemplate ?? item.instruction ?? '该指令会在填写参数后生成。')
    : (item.instruction ?? '')
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
  instructionTemplates,
  quickInstructionScope,
}: SopAiRevisionPanelProps) {
  const endRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const settings = useStore((state) => state.settings)
  const showToast = useStore((state) => state.showToast)
  const { openConfirmDialog } = useAppDialog()
  const profile = useMemo(() => getAgentTextApiProfile(settings), [settings])
  const [messages, setMessages] = useState<SopAiRevisionMessage[]>([])
  const [input, setInput] = useState('')
  const [pendingAttachments, setPendingAttachments] = useState<PendingSopAiAttachment[]>([])
  const [attachmentPreviewUrls, setAttachmentPreviewUrls] = useState<Record<string, string>>({})
  const [attachmentDragActive, setAttachmentDragActive] = useState(false)
  const [jobState, setJobState] = useState(() => getSopAiRevisionJobState(documentId))
  const [localError, setLocalError] = useState('')
  const [testingMessageId, setTestingMessageId] = useState('')
  const [activeOptionVariable, setActiveOptionVariable] = useState<string | null>(null)
  const [customInstructions, setCustomInstructions] = useState<SopCustomInstruction[]>(loadCustomInstructions)
  const [customDialogOpen, setCustomDialogOpen] = useState(false)
  const [customEditingId, setCustomEditingId] = useState<string | null>(null)
  const [customLabel, setCustomLabel] = useState('')
  const [customInstruction, setCustomInstruction] = useState('')
  const [customScope, setCustomScope] = useState<SopQuickInstructionScope>('all')
  const [quickInstructionOverrides, setQuickInstructionOverrides] = useState(loadQuickInstructionOverrides)
  const [instructionManagerOpen, setInstructionManagerOpen] = useState(false)
  const [quickMenuOpen, setQuickMenuOpen] = useState(false)
  const [quickSearch, setQuickSearch] = useState('')
  const quickMenuRef = useRef<HTMLDivElement>(null)
  const quickSearchInputRef = useRef<HTMLInputElement>(null)
  const attachmentDragDepthRef = useRef(0)
  const [quickInstructionEditor, setQuickInstructionEditor] = useState<{
    item: SopQuickInstruction
    base: SopQuickInstruction
    label: string
    description: string
    body: string
  } | null>(null)
  const [pendingQuickInstruction, setPendingQuickInstruction] = useState<string | null>(null)
  const [parameterDialog, setParameterDialog] = useState<{
    instruction: SopQuickInstruction
    values: Record<string, string>
  } | null>(null)
  const loading = jobState.status === 'running'
  const error = localError || (jobState.status === 'error' ? jobState.error : '')
  const canRetry = !localError && jobState.status === 'error'
  const isMetaInstruction = revisionTarget === 'meta-instruction'

  useCloseOnEscape(quickMenuOpen, () => {
    setQuickMenuOpen(false)
    setQuickSearch('')
  })

  const isVariablePrompt = useMemo(
    () => !isMetaInstruction && parseVariablePrompt(value).detected,
    [isMetaInstruction, value],
  )
  const activeQuickScope =
    quickInstructionScope ?? (isMetaInstruction ? 'meta-instruction' : isVariablePrompt ? 'variable-prompt' : 'sop')
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

  const baseQuickInstructions = useMemo(() => {
    const source =
      instructionTemplates ??
      (activeQuickScope === 'meta-instruction' ? META_QUICK_INSTRUCTIONS : SOP_QUICK_INSTRUCTIONS)
    return source.map((item, index) => normalizeQuickInstruction(item, index, activeQuickScope))
  }, [activeQuickScope, instructionTemplates])
  const availableQuickInstructions = useMemo(
    () => baseQuickInstructions.map((item) => applyQuickInstructionOverride(item, quickInstructionOverrides)),
    [baseQuickInstructions, quickInstructionOverrides],
  )
  const visibleQuickInstructions = useMemo(
    () => availableQuickInstructions.filter((item) => matchesSopQuickInstructionScope(item.scope, activeQuickScope)),
    [activeQuickScope, availableQuickInstructions],
  )
  const visibleCustomInstructions = useMemo(
    () => customInstructions.filter((item) => matchesSopQuickInstructionScope(item.scope, activeQuickScope)),
    [activeQuickScope, customInstructions],
  )
  const quickGroups = useMemo(() => {
    const groups: Array<{ key: string; label: string; items: SopQuickInstruction[] }> = []
    const common = visibleQuickInstructions.filter((item) => item.scope === 'all' || item.scope === 'sop')
    const pool = visibleQuickInstructions.filter((item) => item.scope === 'element-pool')
    const meta = visibleQuickInstructions.filter((item) => item.scope === 'meta-instruction')
    const variable = visibleQuickInstructions.filter((item) => item.scope === 'variable-prompt')
    if (common.length > 0) groups.push({ key: 'common', label: '通用优化', items: common })
    if (pool.length > 0) groups.push({ key: 'pool', label: '元素池专项', items: pool })
    if (variable.length > 0) groups.push({ key: 'variable', label: '变量提示词专项', items: variable })
    if (meta.length > 0) groups.push({ key: 'meta', label: '元指令专项', items: meta })
    if (visibleCustomInstructions.length > 0) {
      groups.push({
        key: 'custom',
        label: '我的指令',
        items: visibleCustomInstructions.map((item) => ({
          id: item.id,
          label: item.label,
          description: item.instruction,
          instruction: item.instruction,
          scope: item.scope,
        })),
      })
    }
    return groups
  }, [visibleCustomInstructions, visibleQuickInstructions])
  const filteredQuickGroups = useMemo(() => {
    const query = quickSearch.trim().toLocaleLowerCase()
    if (!query) return quickGroups
    return quickGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          `${item.label} ${item.description ?? ''} ${getQuickInstructionBody(item)}`
            .toLocaleLowerCase()
            .includes(query),
        ),
      }))
      .filter((group) => group.items.length > 0)
  }, [quickGroups, quickSearch])
  const quickInstructionCount = quickGroups.reduce((total, group) => total + group.items.length, 0)

  useEffect(() => {
    setMessages(loadSopAiRevisionThread(documentId).messages)
    setInput('')
    setPendingAttachments([])
    setAttachmentPreviewUrls({})
    setAttachmentDragActive(false)
    attachmentDragDepthRef.current = 0
    setJobState(getSopAiRevisionJobState(documentId))
    setLocalError('')
    setTestingMessageId('')
    setQuickMenuOpen(false)
    setQuickSearch('')
    return subscribeSopAiRevisionJob(documentId, (state) => {
      setJobState(state)
      setMessages(loadSopAiRevisionThread(documentId).messages)
    })
  }, [documentId])

  useEffect(() => {
    if (!quickMenuOpen) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!quickMenuRef.current?.contains(event.target as Node)) {
        setQuickMenuOpen(false)
        setQuickSearch('')
      }
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    requestAnimationFrame(() => quickSearchInputRef.current?.focus())
    return () => document.removeEventListener('mousedown', closeOnOutsideClick)
  }, [quickMenuOpen])

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

  useEffect(() => {
    let active = true
    const attachments = messages.flatMap((message) => message.attachments ?? [])
    void Promise.all(
      attachments.map(async (attachment) => {
        const thumbnail = await getImageThumbnail(attachment.id).catch(() => undefined)
        return thumbnail?.thumbnailDataUrl ? ([attachment.id, thumbnail.thumbnailDataUrl] as const) : null
      }),
    ).then((entries) => {
      if (!active) return
      setAttachmentPreviewUrls((current) => ({
        ...current,
        ...Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null)),
      }))
    })
    return () => {
      active = false
    }
  }, [messages])

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
    const conversation = toConversationMessages(requestMessages)
    const result = await startSopAiRevisionJob(documentId, () => {
      if (conversation instanceof Promise) {
        return conversation.then((resolvedConversation) =>
          revise({
            settings,
            profile,
            content: value,
            conversation: resolvedConversation,
          }),
        )
      }
      return revise({
        settings,
        profile,
        content: value,
        conversation,
      })
    })
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

  async function addAttachmentFiles(files: File[]) {
    if (loading) return
    const available = MAX_AI_CHAT_ATTACHMENTS - pendingAttachments.length
    const normalizedFiles = files.map(normalizeImageFile).filter((file): file is File => file !== null)
    const selectedFiles = normalizedFiles
      .filter((file) => file.size <= MAX_AI_CHAT_ATTACHMENT_BYTES)
      .slice(0, available)
    const skippedCount = files.length - selectedFiles.length
    if (selectedFiles.length === 0) {
      if (files.length > 0) showToast('没有可添加的图片，请使用常见图片格式且单张不超过 10 MiB', 'error')
      return
    }

    const settled = await Promise.allSettled(
      selectedFiles.map(async (file) => {
        const image = await createInputImageFromFile(file)
        if (!image) throw new Error('图片格式无法读取')
        return {
          id: image.id,
          name: file.name || `图片-${image.id.slice(0, 8)}`,
          dataUrl: image.dataUrl,
        }
      }),
    )
    const loaded = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
    if (loaded.length === 0) {
      showToast('图片读取失败，请重新添加', 'error')
      return
    }
    setPendingAttachments((current) => {
      const existing = new Set(current.map((attachment) => attachment.id))
      return [...current, ...loaded.filter((attachment) => !existing.has(attachment.id))].slice(
        0,
        MAX_AI_CHAT_ATTACHMENTS,
      )
    })
    setAttachmentPreviewUrls((current) => ({
      ...current,
      ...Object.fromEntries(loaded.map((attachment) => [attachment.id, attachment.dataUrl])),
    }))
    const failedCount = settled.length - loaded.length
    const omittedCount = skippedCount + failedCount
    showToast(
      omittedCount > 0
        ? `已添加 ${loaded.length} 张图片，另有 ${omittedCount} 张因格式、大小或数量限制被跳过`
        : `已添加 ${loaded.length} 张图片`,
      omittedCount > 0 ? 'info' : 'success',
    )
  }

  async function addAttachmentImageIds(imageIds: string[]) {
    if (loading) return
    const available = MAX_AI_CHAT_ATTACHMENTS - pendingAttachments.length
    const ids = Array.from(new Set(imageIds.filter(Boolean))).slice(0, Math.max(0, available))
    if (ids.length === 0) return
    const settled = await Promise.allSettled(
      ids.map(async (id, index) => {
        const dataUrl = await ensureImageCached(id)
        if (!dataUrl) throw new Error('图片已不存在')
        return { id, name: `拖入图片 ${index + 1}`, dataUrl }
      }),
    )
    const loaded = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
    if (loaded.length === 0) {
      showToast('拖入的图片已不存在，请重新选择', 'error')
      return
    }
    setPendingAttachments((current) => {
      const existing = new Set(current.map((attachment) => attachment.id))
      return [...current, ...loaded.filter((attachment) => !existing.has(attachment.id))].slice(
        0,
        MAX_AI_CHAT_ATTACHMENTS,
      )
    })
    setAttachmentPreviewUrls((current) => ({
      ...current,
      ...Object.fromEntries(loaded.map((attachment) => [attachment.id, attachment.dataUrl])),
    }))
    if (loaded.length < ids.length) showToast('部分拖入图片已不存在', 'info')
    else showToast(`已添加 ${loaded.length} 张图片`, 'success')
  }

  function removePendingAttachment(id: string) {
    setPendingAttachments((current) => current.filter((attachment) => attachment.id !== id))
  }

  function acceptsAttachmentDrag(event: ReactDragEvent<HTMLDivElement>) {
    const types = Array.from(event.dataTransfer.types)
    return (
      types.includes('Files') ||
      types.includes('text/plain') ||
      types.includes('application/x-doupao-asset-ids') ||
      getDraggedImageIds(event.dataTransfer).length > 0
    )
  }

  function handleAttachmentDragEnter(event: ReactDragEvent<HTMLDivElement>) {
    if (!acceptsAttachmentDrag(event)) return
    event.preventDefault()
    event.stopPropagation()
    attachmentDragDepthRef.current += 1
    if (!loading && pendingAttachments.length < MAX_AI_CHAT_ATTACHMENTS) setAttachmentDragActive(true)
  }

  function handleAttachmentDragOver(event: ReactDragEvent<HTMLDivElement>) {
    if (!acceptsAttachmentDrag(event)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = loading || pendingAttachments.length >= MAX_AI_CHAT_ATTACHMENTS ? 'none' : 'copy'
  }

  function handleAttachmentDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    if (!acceptsAttachmentDrag(event)) return
    event.preventDefault()
    event.stopPropagation()
    attachmentDragDepthRef.current = Math.max(0, attachmentDragDepthRef.current - 1)
    if (attachmentDragDepthRef.current === 0) setAttachmentDragActive(false)
  }

  function handleAttachmentDrop(event: ReactDragEvent<HTMLDivElement>) {
    if (!acceptsAttachmentDrag(event)) return
    event.preventDefault()
    event.stopPropagation()
    attachmentDragDepthRef.current = 0
    setAttachmentDragActive(false)
    const files = Array.from(event.dataTransfer.files ?? [])
    if (files.length > 0) {
      void addAttachmentFiles(files)
      return
    }
    void addAttachmentImageIds(getDraggedImageIds(event.dataTransfer))
  }

  function handleAttachmentPaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    const files = getImageFiles(event.clipboardData?.items)
    if (files.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    void addAttachmentFiles(files)
  }

  async function sendMessage() {
    const attachments = pendingAttachments.map(({ id, name }) => ({ id, name }))
    const request = input.trim() || (attachments.length > 0 ? '请结合附件图片分析当前内容。' : '')
    if (!request || loading) return
    const nextMessages = [...messages, createSopAiRevisionMessage('user', request, undefined, attachments)]
    commitMessages(nextMessages)
    setInput('')
    setPendingAttachments([])
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
    if (!isMetaInstruction && introducesVariablePromptSyntax(value, message.revision.content)) {
      showToast('当前 SOP 对话不能新增可变项，请使用独立的变量提示词功能', 'error')
      return
    }
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

  function closeQuickMenu() {
    setQuickMenuOpen(false)
    setQuickSearch('')
  }

  /** 填入输入框并聚焦：内置模板与自定义指令共用；已有草稿时先让用户选择处理方式。 */
  function applyQuickInstruction(instruction: string) {
    if (!instruction.trim()) return
    if (input.trim()) {
      setPendingQuickInstruction(instruction)
      return
    }
    setInput(instruction)
    composerRef.current?.focus()
  }

  function openParameterizedInstruction(instruction: SopQuickInstruction) {
    const values = Object.fromEntries(
      (instruction.parameters ?? []).map((parameter) => [
        parameter.key,
        parameter.defaultValue ?? parameter.options?.[0]?.value ?? '',
      ]),
    )
    setParameterDialog({ instruction, values })
  }

  function selectQuickInstruction(instruction: SopQuickInstruction) {
    closeQuickMenu()
    if (instruction.parameters && instruction.parameters.length > 0) {
      openParameterizedInstruction(instruction)
      return
    }
    applyQuickInstruction(instruction.instruction ?? '')
  }

  function submitParameterizedInstruction() {
    if (!parameterDialog) return
    const missing = (parameterDialog.instruction.parameters ?? []).find(
      (parameter) => parameter.required && !parameterDialog.values[parameter.key]?.trim(),
    )
    if (missing) {
      showToast(`请填写${missing.label}`, 'error')
      return
    }
    const instruction = parameterDialog.instruction.instructionTemplate
      ? formatInstructionTemplate(parameterDialog.instruction.instructionTemplate, parameterDialog.values)
      : (parameterDialog.instruction.buildInstruction?.(parameterDialog.values) ??
        parameterDialog.instruction.instruction ??
        '')
    setParameterDialog(null)
    applyQuickInstruction(instruction)
  }

  function resolveQuickConflict(mode: 'replace' | 'append') {
    if (!pendingQuickInstruction) return
    const nextValue = mode === 'append' ? `${input.trimEnd()}\n\n${pendingQuickInstruction}` : pendingQuickInstruction
    setInput(nextValue)
    setPendingQuickInstruction(null)
    composerRef.current?.focus()
  }

  function openCustomInstructionDialog(item?: SopCustomInstruction) {
    setCustomEditingId(item?.id ?? null)
    setCustomLabel(item?.label ?? '')
    setCustomInstruction(item?.instruction ?? '')
    setCustomScope(item?.scope ?? 'all')
    setCustomDialogOpen(true)
  }

  function submitCustomInstruction() {
    const label = customLabel.trim()
    const instruction = customInstruction.trim()
    if (!label || !instruction) {
      showToast('请填写指令名称与内容', 'error')
      return
    }
    if (label.length > 40 || instruction.length > 4000) {
      showToast('指令名称最多 40 字，指令内容最多 4000 字', 'error')
      return
    }
    if (!customEditingId && customInstructions.length >= MAX_CUSTOM_INSTRUCTIONS) {
      showToast(`最多添加 ${MAX_CUSTOM_INSTRUCTIONS} 条自定义指令`, 'error')
      return
    }
    const next = customEditingId
      ? customInstructions.map((item) =>
          item.id === customEditingId ? { ...item, label, instruction, scope: customScope } : item,
        )
      : [
          ...customInstructions,
          {
            id: `sop-quick-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            label,
            instruction,
            scope: customScope,
          },
        ]
    setCustomInstructions(next)
    saveCustomInstructions(next)
    setCustomLabel('')
    setCustomInstruction('')
    setCustomScope('all')
    setCustomEditingId(null)
    setCustomDialogOpen(false)
    showToast(`${customEditingId ? '已更新' : '已添加'}快捷指令「${label}」`, 'success')
  }

  function removeCustomInstruction(id: string) {
    const next = customInstructions.filter((item) => item.id !== id)
    setCustomInstructions(next)
    saveCustomInstructions(next)
    showToast('已删除自定义快捷指令', 'info')
  }

  function openQuickInstructionEditor(item: SopQuickInstruction) {
    const base = baseQuickInstructions.find((candidate) => candidate.id === item.id) ?? item
    setQuickInstructionEditor({
      item,
      base,
      label: item.label,
      description: item.description ?? '',
      body: getQuickInstructionBody(item),
    })
  }

  function saveQuickInstructionEdit() {
    const id = quickInstructionEditor?.item.id
    if (!quickInstructionEditor || !id) return
    const label = quickInstructionEditor.label.trim()
    const description = quickInstructionEditor.description.trim()
    const body = quickInstructionEditor.body.trim()
    if (!label || !body) {
      showToast('请填写指令名称与指令内容', 'error')
      return
    }
    const { base, item } = quickInstructionEditor
    const override: SopQuickInstructionOverride = {
      ...(label !== base.label ? { label } : {}),
      ...(description !== (base.description ?? '') ? { description } : {}),
      ...(item.parameters?.length
        ? body !== (base.instructionTemplate ?? base.instruction ?? '')
          ? { instructionTemplate: body }
          : {}
        : body !== (base.instruction ?? '')
          ? { instruction: body }
          : {}),
    }
    const next = { ...quickInstructionOverrides }
    if (Object.keys(override).length === 0) delete next[id]
    else next[id] = override
    setQuickInstructionOverrides(next)
    saveQuickInstructionOverrides(next)
    setQuickInstructionEditor(null)
    showToast(`已保存内置指令「${label}」`, 'success')
  }

  function resetQuickInstruction() {
    if (!quickInstructionEditor?.item.id) return
    const next = { ...quickInstructionOverrides }
    delete next[quickInstructionEditor.item.id]
    setQuickInstructionOverrides(next)
    saveQuickInstructionOverrides(next)
    setQuickInstructionEditor({
      ...quickInstructionEditor,
      item: quickInstructionEditor.base,
      label: quickInstructionEditor.base.label,
      description: quickInstructionEditor.base.description ?? '',
      body: getQuickInstructionBody(quickInstructionEditor.base),
    })
    showToast(`已恢复内置指令「${quickInstructionEditor.base.label}」`, 'success')
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
                <button key={request} type="button" onClick={() => applyQuickInstruction(request)}>
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
            {message.attachments && message.attachments.length > 0 && (
              <div className="sop-ai-chat__message-attachments" aria-label="消息图片附件">
                {message.attachments.map((attachment, index) => {
                  const preview = attachmentPreviewUrls[attachment.id]
                  return (
                    <div key={`${message.id}-${attachment.id}`} className="sop-ai-chat__message-attachment">
                      {preview ? (
                        <img src={preview} alt={`消息图片 ${index + 1}：${attachment.name}`} />
                      ) : (
                        <ImagePlus size={16} aria-hidden="true" />
                      )}
                      <span title={attachment.name}>{attachment.name}</span>
                    </div>
                  )
                })}
              </div>
            )}
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

      <div ref={quickMenuRef} className="sop-ai-chat__quickbar" aria-label="AI 快捷指令">
        <div className="sop-ai-chat__quickbar-row">
          <button
            type="button"
            className="sop-ai-chat__quick-trigger"
            aria-label={`选择快捷指令，共 ${quickInstructionCount} 条`}
            aria-expanded={quickMenuOpen}
            aria-haspopup="dialog"
            onClick={() => setQuickMenuOpen((current) => !current)}
          >
            <Sparkles size={13} />
            <span>快捷指令</span>
            <span className="sop-ai-chat__quick-count">{quickInstructionCount}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          <span className="sop-ai-chat__quickbar-scope">{getSopQuickInstructionScopeLabel(activeQuickScope)}</span>
          <div className="sop-ai-chat__quickbar-actions">
            <IconButton
              size="sm"
              aria-label="查看和编辑 SOP 指令"
              title="管理指令"
              onClick={() => setInstructionManagerOpen(true)}
              icon={<Settings2 size={14} />}
            />
            <IconButton
              size="sm"
              aria-label="添加自定义快捷指令"
              title="自定义指令"
              onClick={() => openCustomInstructionDialog()}
              icon={<Plus size={14} />}
            />
          </div>
        </div>

        {quickMenuOpen && (
          <div className="sop-ai-chat__quick-popover" role="dialog" aria-label="选择 AI 快捷指令">
            <div className="sop-ai-chat__quick-popover-head">
              <div>
                <strong>选择快捷指令</strong>
                <span>点击后填入输入框，不会自动发送</span>
              </div>
              <span className="sop-ai-chat__quick-popover-count">{quickInstructionCount} 条</span>
            </div>
            <div className="sop-ai-chat__quick-search">
              <Search size={14} aria-hidden="true" />
              <input
                ref={quickSearchInputRef}
                value={quickSearch}
                onChange={(event) => setQuickSearch(event.target.value)}
                placeholder="搜索指令名称或说明"
                aria-label="搜索快捷指令"
              />
            </div>
            <div className="sop-ai-chat__quick-popover-body">
              {filteredQuickGroups.map((group) => (
                <section key={group.key} className="sop-ai-chat__quick-popover-group">
                  <div className="sop-ai-chat__quick-popover-group-head">
                    <strong>{group.label}</strong>
                    <span>{group.items.length}</span>
                  </div>
                  <div className="sop-ai-chat__quick-command-list">
                    {group.items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        disabled={loading}
                        title={item.description}
                        onClick={() => selectQuickInstruction(item)}
                      >
                        <span>{item.label}</span>
                        <small>{item.description}</small>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
              {filteredQuickGroups.length === 0 && <p className="sop-ai-chat__quick-empty">没有匹配的快捷指令</p>}
            </div>
          </div>
        )}
      </div>

      <Dialog
        open={instructionManagerOpen}
        onOpenChange={setInstructionManagerOpen}
        title="SOP 指令管理"
        description={`${getSopQuickInstructionScopeLabel(activeQuickScope)} · 可查看并编辑内置指令，也可管理自定义指令。`}
        size="lg"
      >
        <div className="flex max-h-[min(70vh,44rem)] flex-col gap-4 overflow-y-auto">
          <section>
            <h3 className="mb-2 text-sm font-semibold text-ds-text dark:text-ds-text-subtle">内置指令</h3>
            <div className="flex flex-col gap-2">
              {visibleQuickInstructions.map((item) => (
                <article
                  key={item.id}
                  className="rounded-ds-lg border border-ds-border bg-ds-surface/50 p-3 dark:bg-ds-surface"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm text-ds-text dark:text-ds-text-subtle">{item.label}</strong>
                        <span className="rounded-full bg-ds-primary-subtle px-2 py-0.5 text-xs text-ds-primary dark:bg-ds-primary/10 dark:text-ds-primary">
                          内置
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-ds-muted">{item.description}</p>
                    </div>
                    <IconButton
                      size="sm"
                      onClick={() => openQuickInstructionEditor(item)}
                      aria-label={`查看和编辑内置指令 ${item.label}`}
                      title="查看和编辑"
                      icon={<Edit size={13} />}
                    />
                  </div>
                  <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-ds-md bg-ds-subtle p-2 text-xs leading-5 text-ds-muted dark:bg-ds-scrim dark:text-ds-muted">
                    {getQuickInstructionBody(item)}
                  </pre>
                </article>
              ))}
            </div>
          </section>

          <section className="border-t border-ds-border pt-3">
            <h3 className="mb-2 text-sm font-semibold text-ds-text dark:text-ds-text-subtle">自定义指令</h3>
            {visibleCustomInstructions.length > 0 ? (
              <div className="sop-ai-chat__custom-list">
                {visibleCustomInstructions.map((item) => (
                  <div key={item.id} className="sop-ai-chat__custom-item">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{item.label}</p>
                      <p className="sop-center-quiet-text mt-0.5 line-clamp-1 text-xs">
                        {getSopQuickInstructionScopeLabel(item.scope)} · {item.instruction}
                      </p>
                    </div>
                    <IconButton
                      size="sm"
                      onClick={() => {
                        setInstructionManagerOpen(false)
                        openCustomInstructionDialog(item)
                      }}
                      aria-label={`编辑自定义指令 ${item.label}`}
                      title="编辑"
                      icon={<Edit size={13} />}
                    />
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
            ) : (
              <p className="text-xs text-ds-muted">暂无自定义指令</p>
            )}
          </section>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(quickInstructionEditor)}
        onOpenChange={(open) => {
          if (!open) setQuickInstructionEditor(null)
        }}
        title={quickInstructionEditor ? `编辑内置指令：${quickInstructionEditor.label}` : '编辑内置指令'}
        description={
          quickInstructionEditor?.item.parameters?.length
            ? '参数化指令支持编辑参数模板；模板占位符使用 [[参数 key]]。'
            : '修改后只在本机生效，不会改变程序内置默认值。'
        }
        size="md"
      >
        {quickInstructionEditor && (
          <div className="flex flex-col gap-4">
            <TextField
              label="指令名称"
              value={quickInstructionEditor.label}
              maxLength={40}
              onChange={(event) =>
                setQuickInstructionEditor((current) => (current ? { ...current, label: event.target.value } : current))
              }
            />
            <TextArea
              label="说明"
              value={quickInstructionEditor.description}
              maxLength={200}
              onChange={(event) =>
                setQuickInstructionEditor((current) =>
                  current ? { ...current, description: event.target.value } : current,
                )
              }
            />
            <TextArea
              label={quickInstructionEditor.item.parameters?.length ? '指令模板' : '指令内容'}
              value={quickInstructionEditor.body}
              maxLength={8000}
              containerClassName="sop-ai-chat__custom-draft"
              className="leading-5"
              onChange={(event) =>
                setQuickInstructionEditor((current) => (current ? { ...current, body: event.target.value } : current))
              }
            />
            <div className="flex justify-between gap-2">
              <Button variant="secondary" onClick={resetQuickInstruction}>
                恢复默认
              </Button>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setQuickInstructionEditor(null)}>
                  取消
                </Button>
                <Button variant="primary" onClick={saveQuickInstructionEdit}>
                  保存修改
                </Button>
              </div>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={customDialogOpen}
        onOpenChange={(open) => {
          setCustomDialogOpen(open)
          if (!open) setCustomEditingId(null)
        }}
        title={customEditingId ? '编辑自定义快捷指令' : '自定义快捷指令'}
        description="点击胶囊会把指令填入输入框，发送前可编辑；指令保存在本机，可按场景隔离。"
        size="md"
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <TextField
              label="指令名称"
              value={customLabel}
              onChange={(event) => setCustomLabel(event.target.value)}
              placeholder="例如：检查生图红线"
              maxLength={40}
              helperText={`${customLabel.length} / 40`}
            />
            <SelectField
              label="使用场景"
              value={customScope}
              onChange={(event) => setCustomScope(event.target.value as SopQuickInstructionScope)}
              options={QUICK_SCOPE_OPTIONS}
            />
            <TextArea
              label="指令内容"
              value={customInstruction}
              onChange={(event) => setCustomInstruction(event.target.value)}
              placeholder="描述希望 AI 如何修改 SOP；发送前可再调整"
              containerClassName="sop-ai-chat__custom-draft"
              className="leading-5"
              maxLength={4000}
              helperText={`${customInstruction.length} / 4000`}
            />
            <Button
              variant="primary"
              size="sm"
              disabled={!customLabel.trim() || !customInstruction.trim()}
              onClick={submitCustomInstruction}
              leadingIcon={customEditingId ? <Save size={14} /> : <Plus size={14} />}
              className="self-end"
            >
              {customEditingId ? '保存修改' : '添加'}
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
                      <p className="sop-center-quiet-text mt-0.5 line-clamp-1 text-xs">
                        {getSopQuickInstructionScopeLabel(item.scope)} · {item.instruction}
                      </p>
                    </div>
                    <IconButton
                      size="sm"
                      onClick={() => openCustomInstructionDialog(item)}
                      aria-label={`编辑自定义指令 ${item.label}`}
                      title="编辑"
                      icon={<Edit size={13} />}
                    />
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

      <Dialog
        open={Boolean(parameterDialog)}
        onOpenChange={(open) => {
          if (!open) setParameterDialog(null)
        }}
        title={parameterDialog?.instruction.label ?? '填写快捷指令参数'}
        description={parameterDialog?.instruction.description}
        size="sm"
      >
        {parameterDialog && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3">
              {parameterDialog.instruction.parameters?.map((parameter) =>
                parameter.kind === 'select' ? (
                  <SelectField
                    key={parameter.key}
                    label={parameter.label}
                    helperText={parameter.description}
                    value={parameterDialog.values[parameter.key] ?? ''}
                    options={parameter.options ? [...parameter.options] : []}
                    onChange={(event) =>
                      setParameterDialog((current) =>
                        current
                          ? {
                              ...current,
                              values: { ...current.values, [parameter.key]: event.target.value },
                            }
                          : current,
                      )
                    }
                  />
                ) : parameter.kind === 'multi-select' ? (
                  <fieldset key={parameter.key} className="flex flex-col gap-2">
                    <legend className="text-sm font-medium text-ds-text dark:text-ds-text-subtle">
                      {parameter.label}
                    </legend>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {parameter.options?.map((option) => (
                        <Checkbox
                          key={option.value}
                          checked={getMultiSelectValues(parameterDialog.values[parameter.key] ?? '').includes(
                            option.value,
                          )}
                          onChange={() =>
                            setParameterDialog((current) =>
                              current
                                ? {
                                    ...current,
                                    values: {
                                      ...current.values,
                                      [parameter.key]: toggleMultiSelectValue(
                                        current.values[parameter.key] ?? '',
                                        option.value,
                                      ),
                                    },
                                  }
                                : current,
                            )
                          }
                          label={<span className="text-sm">{option.label}</span>}
                          className="rounded-ds-md border border-ds-border px-2.5 py-2"
                        />
                      ))}
                    </div>
                    {parameter.description && <p className="text-xs text-ds-muted">{parameter.description}</p>}
                  </fieldset>
                ) : (
                  <TextField
                    key={parameter.key}
                    label={parameter.label}
                    helperText={parameter.description}
                    placeholder={parameter.placeholder}
                    type={parameter.kind}
                    value={parameterDialog.values[parameter.key] ?? ''}
                    min={parameter.min}
                    max={parameter.max}
                    required={parameter.required}
                    onChange={(event) =>
                      setParameterDialog((current) =>
                        current
                          ? {
                              ...current,
                              values: { ...current.values, [parameter.key]: event.target.value },
                            }
                          : current,
                      )
                    }
                  />
                ),
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setParameterDialog(null)}>
                取消
              </Button>
              <Button variant="primary" onClick={submitParameterizedInstruction}>
                填入输入框
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={Boolean(pendingQuickInstruction)}
        onOpenChange={(open) => {
          if (!open) setPendingQuickInstruction(null)
        }}
        title="输入框已有草稿"
        description="快捷指令不会自动覆盖你正在编辑的内容，请选择如何处理当前草稿。"
        size="sm"
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setPendingQuickInstruction(null)}>
            取消
          </Button>
          <Button variant="secondary" onClick={() => resolveQuickConflict('append')}>
            追加到末尾
          </Button>
          <Button variant="primary" onClick={() => resolveQuickConflict('replace')}>
            替换草稿
          </Button>
        </div>
      </Dialog>

      <div
        className="sop-ai-chat__composer"
        data-drag-active={attachmentDragActive || undefined}
        onDragEnter={handleAttachmentDragEnter}
        onDragOver={handleAttachmentDragOver}
        onDragLeave={handleAttachmentDragLeave}
        onDrop={handleAttachmentDrop}
      >
        {pendingAttachments.length > 0 && (
          <div className="sop-ai-chat__pending-attachments" aria-label="待发送图片">
            {pendingAttachments.map((attachment, index) => (
              <div key={attachment.id} className="sop-ai-chat__pending-attachment">
                <img src={attachment.dataUrl} alt={`待发送图片 ${index + 1}：${attachment.name}`} />
                <button
                  type="button"
                  onClick={() => removePendingAttachment(attachment.id)}
                  disabled={loading}
                  aria-label={`移除待发送图片 ${attachment.name}`}
                  title="移除图片"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="sop-ai-chat__composer-hint">
          <ImagePlus size={13} aria-hidden="true" />
          <span>{attachmentDragActive ? '松开添加图片' : '拖入图片或 Ctrl/Cmd+V 粘贴图片'}</span>
          <span className="sop-ai-chat__composer-count">
            {pendingAttachments.length}/{MAX_AI_CHAT_ATTACHMENTS}
          </span>
        </div>
        <div className="sop-ai-chat__composer-row">
          <textarea
            ref={composerRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onPaste={handleAttachmentPaste}
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
            disabled={(!input.trim() && pendingAttachments.length === 0) || loading}
            aria-label={ui.sendLabel}
          >
            {loading ? <Loader size={15} className="animate-spin" /> : <Send size={15} />}
          </button>
        </div>
      </div>
    </aside>
  )
}
