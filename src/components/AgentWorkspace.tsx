import {
  useEffect,
  useMemo,
  useState,
  useRef,
  useCallback,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import type { AgentConversation, AgentMessage, AgentRound, ResponsesOutputItem, TaskRecord } from '../types'
import {
  deleteAgentRoundFromConversation,
  getActiveAgentRounds,
  getAgentBranchLeafId,
  getAgentSiblingRounds,
  getCachedImage,
  ensureImageCached,
  regenerateAgentAssistantMessage,
  remapAgentRoundMentionsForPathChange,
  removeMultipleTasks,
  useStore,
} from '../store'
import { useRuntimeStore } from '../stores/runtimeStore'
import { getPromptMentionParts } from '../lib/promptImageMentions'
import { copyTextToClipboard, getClipboardFailureMessage } from '../lib/clipboard'
import {
  collectWebSearchCalls,
  getAgentRoundOutputItems,
  getWebSearchStatusForCalls,
  type AgentWebSearchStatus,
} from '../lib/agentWebSearch'
import { createMaskPreviewDataUrl } from '../lib/canvasImage'
import {
  downloadImageEntries,
  downloadImageEntriesAsZip,
  getGeneratedImageDownloadEntries,
} from '../lib/downloadImages'
import AgentImageGrid, { AgentImagePreviewStrip, type AgentImageGridItem } from './AgentImageGrid'
import ViewportTooltip from './ViewportTooltip'
import MarkdownRenderer from './MarkdownRenderer'
import {
  TrashIcon,
  DownloadIcon,
  EditIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SidebarLeftIcon,
  FavoriteIcon,
  CloseIcon,
  CopyIcon,
  RefreshIcon,
  ArrowDownIcon,
  DragHandleIcon,
  HistoryIcon,
  PlusIcon,
} from './icons'

function AgentActionButton({
  tooltip,
  className,
  disabled = false,
  onClick,
  onMouseDown,
  children,
}: {
  tooltip: string
  className: string
  disabled?: boolean
  onClick?: (e: ReactMouseEvent<HTMLButtonElement>) => void
  onMouseDown?: (e: ReactMouseEvent<HTMLButtonElement>) => void
  children: ReactNode
}) {
  const [tooltipVisible, setTooltipVisible] = useState(false)

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
      onFocus={() => setTooltipVisible(true)}
      onBlur={() => setTooltipVisible(false)}
    >
      <button
        type="button"
        className={className}
        disabled={disabled}
        aria-label={tooltip}
        onClick={(e) => {
          setTooltipVisible(false)
          onClick?.(e)
        }}
        onMouseDown={(e) => {
          setTooltipVisible(false)
          onMouseDown?.(e)
        }}
      >
        {children}
      </button>
      <ViewportTooltip visible={tooltipVisible} className="whitespace-nowrap">
        {tooltip}
      </ViewportTooltip>
    </span>
  )
}

function ChatImageThumb({
  imageId,
  imageIndex,
  maskImageId,
}: {
  imageId: string
  imageIndex: number
  maskImageId?: string | null
}) {
  const [src, setSrc] = useState<string>(() => getCachedImage(imageId) || '')
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)

  useEffect(() => {
    let cancelled = false

    if (maskImageId) {
      Promise.all([ensureImageCached(imageId), ensureImageCached(maskImageId)])
        .then(async ([baseUrl, maskUrl]) => {
          if (!baseUrl || !maskUrl) return baseUrl || ''
          return createMaskPreviewDataUrl(baseUrl, maskUrl)
        })
        .then((url) => {
          if (!cancelled && url) setSrc(url)
        })
        .catch(() => {
          if (!cancelled) setSrc(getCachedImage(imageId) || '')
        })
      return () => {
        cancelled = true
      }
    }

    const cached = getCachedImage(imageId)
    if (cached) {
      setSrc(cached)
      return () => {
        cancelled = true
      }
    }
    ensureImageCached(imageId).then((url) => {
      if (!cancelled && url) setSrc(url)
    })
    return () => {
      cancelled = true
    }
  }, [imageId, maskImageId])

  return (
    <div
      className={`relative h-ds-16 w-ds-16 shrink-0 overflow-hidden rounded-lg shadow-sm cursor-pointer transition-opacity hover:opacity-90 ${
        maskImageId ? 'border-2 border-ds-primary' : 'border border-ds-border dark:border-ds-border'
      }`}
      onClick={() => setLightboxImageId(imageId, [imageId])}
    >
      {src ? (
        <img src={src} className="h-full w-full object-cover" alt="" />
      ) : (
        <div className="h-full w-full bg-ds-surface dark:bg-ds-surface" />
      )}
      {maskImageId && (
        <span className="absolute left-1 top-1 z-10 rounded bg-ds-primary/90 px-1.5 py-0.5 text-xs font-bold leading-none tracking-wider text-ds-text-inverse backdrop-blur-sm pointer-events-none">
          MASK
        </span>
      )}
      <span className="absolute bottom-1 left-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-ds-scrim/55 text-xs font-semibold text-white backdrop-blur-sm pointer-events-none">
        {imageIndex + 1}
      </span>
    </div>
  )
}

function AgentStreamingCursor() {
  return (
    <span
      aria-label="正在生成"
      className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-ds-primary align-baseline dark:bg-ds-primary-hover"
    />
  )
}

const AGENT_STOPPED_MESSAGE = '已停止生成。'

function formatTime(value: number) {
  return new Date(value).toLocaleString()
}

function AgentWebSearchInlineStatus({ status }: { status: AgentWebSearchStatus }) {
  return (
    <span className="inline-flex text-sm font-medium text-ds-muted dark:text-ds-muted">
      <span className={status.completed ? undefined : 'agent-web-search-running-text'}>{status.text}</span>
    </span>
  )
}

function AgentWebSearchStatusLines({ statuses }: { statuses: AgentWebSearchStatus[] }) {
  if (statuses.length === 0) return null
  return (
    <div className="mb-2 space-y-1">
      {statuses.map((status, index) => (
        <div key={`${status.text}-${index}`}>
          <AgentWebSearchInlineStatus status={status} />
        </div>
      ))}
    </div>
  )
}

type AgentAssistantBlock =
  | { type: 'web-search'; status: AgentWebSearchStatus; key: string }
  | { type: 'batch-params'; status: AgentWebSearchStatus; key: string }
  | { type: 'image-grid'; items: AgentImageGridItem[]; key: string }
  | { type: 'text'; key: string; content?: string }

interface AgentRoundTaskSlot {
  taskId: string
  task: TaskRecord | null
}

function isAgentRoundInterrupted(round: AgentRound | null) {
  return round?.status === 'error' && round.error === AGENT_STOPPED_MESSAGE
}

function markToolStatusStopped(status: AgentWebSearchStatus): AgentWebSearchStatus {
  if (status.completed) return status
  return { text: status.text.replace(/^正在/, '已停止'), completed: true }
}

function getImageTaskForOutputItem(item: ResponsesOutputItem, tasksForRound: TaskRecord[]) {
  if (item.type !== 'image_generation_call') return null
  return tasksForRound.find((task) => task.agentToolCallId && task.agentToolCallId === item.id) ?? null
}

function getBatchImageTasksForOutputItem(item: ResponsesOutputItem, tasksForRound: TaskRecord[]) {
  if (item.type !== 'function_call' || item.name !== 'generate_image_batch' || !item.call_id) return []
  return tasksForRound.filter((task) => task.agentBatchCallId === item.call_id)
}

function getTextFromOutputItem(item: ResponsesOutputItem) {
  if (item.type !== 'message') return ''
  return (item.content ?? [])
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim()
}

function getAgentAssistantBlocks(
  round: AgentRound | null,
  taskSlots: AgentRoundTaskSlot[],
  allTasks: TaskRecord[],
  hasText: boolean,
): AgentAssistantBlock[] {
  const outputItems = getAgentRoundOutputItems(round, allTasks)
  const tasksForRound = taskSlots.map((slot) => slot.task).filter(Boolean) as TaskRecord[]
  const roundInterrupted = isAgentRoundInterrupted(round)
  if (outputItems.length === 0) {
    return [
      ...(hasText ? [{ type: 'text' as const, key: 'text:fallback' }] : []),
      ...(taskSlots.length > 0
        ? [
            {
              type: 'image-grid' as const,
              items: taskSlots.map((slot) => ({ task: slot.task, taskId: slot.taskId })),
              key: `image-grid:${taskSlots.map((slot) => slot.taskId).join(':')}`,
            },
          ]
        : []),
    ]
  }

  const blocks: AgentAssistantBlock[] = []
  const renderedTaskIds = new Set<string>()
  let renderedTextBlocks = 0
  let webSearchGroup: ResponsesOutputItem[] = []

  const appendImageGrid = (items: AgentImageGridItem[]) => {
    if (items.length === 0) return
    const previous = blocks[blocks.length - 1]
    if (previous?.type === 'image-grid') {
      previous.items.push(...items)
      return
    }
    blocks.push({
      type: 'image-grid',
      items,
      key: `image-grid:${items.map((item) => item.taskId).join(':')}`,
    })
  }

  const flushWebSearchGroup = () => {
    if (webSearchGroup.length === 0) return
    const status = getWebSearchStatusForCalls(collectWebSearchCalls(webSearchGroup))
    if (status)
      blocks.push({
        type: 'web-search',
        status: roundInterrupted ? markToolStatusStopped(status) : status,
        key: `web-search:${blocks.length}:${webSearchGroup.map((item) => item.id).join(':')}`,
      })
    webSearchGroup = []
  }

  for (const item of outputItems) {
    if (item.type === 'web_search_call') {
      webSearchGroup.push(item)
      continue
    }

    flushWebSearchGroup()

    const imageTask = getImageTaskForOutputItem(item, tasksForRound)
    if (imageTask && !renderedTaskIds.has(imageTask.id)) {
      renderedTaskIds.add(imageTask.id)
      appendImageGrid([{ task: imageTask, taskId: imageTask.id }])
      continue
    }

    const batchImageTasks = getBatchImageTasksForOutputItem(item, tasksForRound)
    if (batchImageTasks.length > 0) {
      const batchItems: AgentImageGridItem[] = []
      for (const task of batchImageTasks) {
        if (renderedTaskIds.has(task.id)) continue
        renderedTaskIds.add(task.id)
        batchItems.push({ task, taskId: task.id })
      }
      appendImageGrid(batchItems)
      continue
    }

    if (
      (round?.status === 'running' || roundInterrupted) &&
      item.type === 'function_call' &&
      item.name === 'generate_image_batch'
    ) {
      blocks.push({
        type: 'batch-params',
        status: roundInterrupted
          ? markToolStatusStopped({ text: '正在填写并发图像生成参数', completed: false })
          : { text: '正在填写并发图像生成参数', completed: false },
        key: `batch-params:${item.call_id ?? item.id ?? blocks.length}`,
      })
      continue
    }

    if (item.type === 'message') {
      const content = getTextFromOutputItem(item)
      if (content) {
        renderedTextBlocks += 1
        blocks.push({ type: 'text', key: `text:${item.id ?? blocks.length}`, content })
      }
    }
  }

  flushWebSearchGroup()

  if (hasText && renderedTextBlocks === 0) blocks.push({ type: 'text', key: 'text:fallback' })
  const remainingItems: AgentImageGridItem[] = []
  for (const slot of taskSlots) {
    if (slot.task) {
      if (!renderedTaskIds.has(slot.task.id)) remainingItems.push({ task: slot.task, taskId: slot.task.id })
    } else {
      remainingItems.push({ task: null, taskId: slot.taskId })
    }
  }
  appendImageGrid(remainingItems)
  return blocks
}

function getAgentAssistantCopyContent(fallbackContent: string, blocks: AgentAssistantBlock[]) {
  if (!blocks.some((block) => block.type !== 'text')) return fallbackContent

  const parts = blocks
    .filter((block): block is Extract<AgentAssistantBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.content ?? '')
    .map((content) => content.trim())
    .filter(Boolean)

  return parts.length > 0 ? parts.join('\n\n') : fallbackContent
}

function getConversationSearchText(conversation: AgentConversation) {
  return [
    conversation.title,
    ...conversation.messages.map((message) => message.content),
    ...conversation.rounds.map((round) => round.prompt),
  ]
    .join('\n')
    .toLocaleLowerCase()
}

function getRoundTasks(round: AgentRound | null, tasks: TaskRecord[]) {
  if (!round) return []
  return round.outputTaskIds.map((taskId) => tasks.find((task) => task.id === taskId) ?? null)
}

function getRoundTaskSlots(round: AgentRound | null, tasks: TaskRecord[]): AgentRoundTaskSlot[] {
  if (!round) return []
  return round.outputTaskIds.map((taskId) => ({
    taskId,
    task: tasks.find((task) => task.id === taskId) ?? null,
  }))
}

const MOBILE_HEADER_PULL_THRESHOLD = 24
const MOBILE_HEADER_PULL_MAX_OFFSET = 48
const MOBILE_HEADER_EDGE_GUARD = 24

function getPageScrollTop() {
  return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0
}

export default function AgentWorkspace() {
  const conversations = useStore((s) => s.agentConversations)
  const conversationsLoaded = useStore((s) => s.agentConversationsLoaded)
  const activeConversationId = useStore((s) => s.activeAgentConversationId)
  const createConversation = useStore((s) => s.createAgentConversation)
  const setActiveConversationId = useStore((s) => s.setActiveAgentConversationId)
  const renameConversation = useStore((s) => s.renameAgentConversation)
  const deleteConversation = useStore((s) => s.deleteAgentConversation)
  const sidebarCollapsed = useStore((s) => s.agentSidebarCollapsed)
  const setSidebarCollapsed = useStore((s) => s.setAgentSidebarCollapsed)
  const desktopSidebarCollapsed = useStore((s) => s.agentDesktopSidebarCollapsed)
  const setDesktopSidebarCollapsed = useStore((s) => s.setAgentDesktopSidebarCollapsed)
  const reorderConversations = useStore((s) => s.reorderAgentConversations)
  const agentMobileHeaderVisible = useStore((s) => s.agentMobileHeaderVisible)
  const setAgentMobileHeaderVisible = useStore((s) => s.setAgentMobileHeaderVisible)
  const appMode = useStore((s) => s.appMode)
  const tasks = useStore((s) => s.tasks)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const setPrompt = useStore((s) => s.setPrompt)
  const setInputImages = useStore((s) => s.setInputImages)
  const setMaskDraft = useStore((s) => s.setMaskDraft)
  const clearMaskDraft = useStore((s) => s.clearMaskDraft)
  const agentScrollToBottomAfterSubmit = useStore((s) => s.settings.agentScrollToBottomAfterSubmit)
  const agentEditingRoundId = useStore((s) => s.agentEditingRoundId)
  const agentEditingConversationId = useStore((s) => s.agentEditingConversationId)
  const setAgentEditingConversationId = useStore((s) => s.setAgentEditingConversationId)
  const setAgentEditingRoundId = useStore((s) => s.setAgentEditingRoundId)
  const setActiveAgentRoundId = useStore((s) => s.setActiveAgentRoundId)
  const showToast = useStore((s) => s.showToast)
  const openFavoritePicker = useStore((s) => s.openFavoritePicker)
  const agentGeneratingTitleIds = useStore((s) => s.agentGeneratingTitleIds)
  const conversation = conversations.find((item) => item.id === activeConversationId) ?? null
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null)
  const [editingConversationTitle, setEditingConversationTitle] = useState('')
  const [collapsedAssistantMessageIds, setCollapsedAssistantMessageIds] = useState<Set<string>>(() => new Set())
  const [expandedAssistantMessageIds, setExpandedAssistantMessageIds] = useState<Set<string>>(() => new Set())

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const bottomSentinelRef = useRef<HTMLDivElement>(null)
  const messageRefs = useRef(new Map<string, HTMLElement>())
  const [scrollTargetRoundId, setScrollTargetRoundId] = useState<string | null>(null)
  const [pullDownOffset, setPullDownOffset] = useState(0)
  const [mobileTopBarVisible, setMobileTopBarVisible] = useState(true)
  const [conversationSearchQuery, setConversationSearchQuery] = useState('')
  const [conversationActionsId, setConversationActionsId] = useState<string | null>(null)
  const [draggingConversationId, setDraggingConversationId] = useState<string | null>(null)
  const [dragOverConversation, setDragOverConversation] = useState<{ id: string; position: 'before' | 'after' } | null>(
    null,
  )
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(true)
  const touchStartY = useRef(-1)
  const conversationLongPressTimer = useRef<number | null>(null)
  const autoScrollStateRef = useRef<{ conversationId: string | null; lastUserMessageSignature: string | null }>({
    conversationId: null,
    lastUserMessageSignature: null,
  })
  const errorCopyPointerDownRef = useRef<{ x: number; y: number } | null>(null)

  const updateIsScrolledToBottom = useCallback(() => {
    const sentinel = bottomSentinelRef.current
    if (appMode !== 'agent' || !sentinel) {
      setIsScrolledToBottom(true)
      return
    }

    const viewportHeight = window.visualViewport?.height ?? window.innerHeight
    setIsScrolledToBottom(sentinel.getBoundingClientRect().top <= viewportHeight + 24)
  }, [appMode])

  const scrollToAgentBottom = useCallback(() => {
    const scrollingElement = document.scrollingElement ?? document.documentElement
    window.scrollTo({ top: scrollingElement.scrollHeight, behavior: 'smooth' })
  }, [])

  const handleTouchStart = (e: React.TouchEvent) => {
    const touchY = e.touches[0]?.clientY ?? -1
    if (
      appMode !== 'agent' ||
      agentMobileHeaderVisible ||
      getPageScrollTop() > 0 ||
      touchY < MOBILE_HEADER_EDGE_GUARD
    ) {
      touchStartY.current = -1
      setPullDownOffset(0)
      return
    }

    touchStartY.current = touchY
  }

  const handleHeaderTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current <= 0 || agentMobileHeaderVisible) return

    const diff = e.touches[0].clientY - touchStartY.current
    if (diff <= 0) {
      setPullDownOffset(0)
      return
    }

    if (e.cancelable) e.preventDefault()
    if (diff >= MOBILE_HEADER_PULL_THRESHOLD) {
      setAgentMobileHeaderVisible(true)
      setPullDownOffset(0)
      touchStartY.current = -1
      return
    }

    setPullDownOffset(Math.min(diff, MOBILE_HEADER_PULL_MAX_OFFSET))
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY.current > 0 && !agentMobileHeaderVisible) {
      const touchEndY = e.changedTouches[0].clientY
      if (touchEndY - touchStartY.current >= MOBILE_HEADER_PULL_THRESHOLD) setAgentMobileHeaderVisible(true)
    }
    setPullDownOffset(0)
    touchStartY.current = -1
  }

  useEffect(() => {
    if (sidebarCollapsed) {
      setAgentEditingConversationId(null)
    }
  }, [sidebarCollapsed, setAgentEditingConversationId])

  useEffect(() => {
    document.documentElement.classList.toggle('agent-sidebar-expanded', appMode === 'agent' && !desktopSidebarCollapsed)
    return () => document.documentElement.classList.remove('agent-sidebar-expanded')
  }, [appMode, desktopSidebarCollapsed])

  useEffect(() => {
    if (appMode !== 'agent') return

    document.documentElement.classList.add('agent-no-pull-refresh')
    return () => document.documentElement.classList.remove('agent-no-pull-refresh')
  }, [appMode])

  useEffect(() => {
    if (!agentMobileHeaderVisible || appMode !== 'agent') return

    const handleInteract = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('header[data-no-drag-select]')) return
      setAgentMobileHeaderVisible(false)
    }

    document.addEventListener('mousedown', handleInteract, { capture: true })
    document.addEventListener('touchstart', handleInteract, { capture: true })

    return () => {
      document.removeEventListener('mousedown', handleInteract, { capture: true })
      document.removeEventListener('touchstart', handleInteract, { capture: true })
    }
  }, [agentMobileHeaderVisible, appMode, setAgentMobileHeaderVisible])

  useEffect(() => {
    if (appMode !== 'agent') return

    setMobileTopBarVisible(true)
    let lastScrollY = window.scrollY
    let ticking = false

    const handleScroll = () => {
      if (ticking) return

      window.requestAnimationFrame(() => {
        const currentScrollY = window.scrollY
        if (currentScrollY < 20) {
          setMobileTopBarVisible(true)
        } else if (currentScrollY > lastScrollY + 10) {
          setMobileTopBarVisible(false)
        } else if (currentScrollY < lastScrollY - 10) {
          setMobileTopBarVisible(true)
        }

        updateIsScrolledToBottom()

        lastScrollY = currentScrollY
        ticking = false
      })
      ticking = true
    }

    const initialFrame = window.requestAnimationFrame(updateIsScrolledToBottom)
    const visualViewport = window.visualViewport
    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', updateIsScrolledToBottom)
    visualViewport?.addEventListener('resize', updateIsScrolledToBottom)

    return () => {
      window.cancelAnimationFrame(initialFrame)
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', updateIsScrolledToBottom)
      visualViewport?.removeEventListener('resize', updateIsScrolledToBottom)
    }
  }, [appMode, updateIsScrolledToBottom])

  const conversationInitRef = useRef(false)
  useEffect(() => {
    if (appMode !== 'agent') return
    if (!conversationsLoaded) return
    if (conversationInitRef.current) return

    if (conversations.length === 0) {
      conversationInitRef.current = true
      createConversation()
    } else if (!conversation) {
      const latest = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)[0]
      if (latest && latest.messages.length === 0) {
        conversationInitRef.current = true
        setActiveConversationId(latest.id)
      } else {
        conversationInitRef.current = true
        createConversation()
      }
    }
  }, [appMode, conversationsLoaded, conversations, conversation, createConversation, setActiveConversationId])

  const sortedConversations = useMemo(() => [...conversations].sort((a, b) => a.order - b.order), [conversations])

  const filteredConversations = useMemo(() => {
    const query = conversationSearchQuery.trim().toLocaleLowerCase()
    if (!query) return sortedConversations
    return sortedConversations.filter((item) => getConversationSearchText(item).includes(query))
  }, [conversationSearchQuery, sortedConversations])

  const activeRounds = useMemo(() => (conversation ? getActiveAgentRounds(conversation) : []), [conversation])

  const agentStreamingTexts = useRuntimeStore((s) => s.agentStreamingTexts)

  const activeMessages = useMemo(() => {
    if (!conversation) return []
    const messages: AgentMessage[] = []
    for (const round of activeRounds) {
      const userMessage = conversation.messages.find((message) => message.id === round.userMessageId)
      if (userMessage) messages.push(userMessage)
      const assistantMessage = round.assistantMessageId
        ? conversation.messages.find((message) => message.id === round.assistantMessageId)
        : conversation.messages.find((message) => message.roundId === round.id && message.role === 'assistant')
      if (assistantMessage) {
        // Merge streaming text buffer for real-time display while keeping persisted state debounced
        const streamingKey = `${conversation.id}:${assistantMessage.id}`
        const streamingText = agentStreamingTexts[streamingKey]
        if (streamingText && round.status === 'running') {
          messages.push({ ...assistantMessage, content: assistantMessage.content + streamingText })
        } else {
          messages.push(assistantMessage)
        }
      }
    }
    return messages
  }, [activeRounds, conversation, agentStreamingTexts])

  const newestImageAssistantMessageId = useMemo(() => {
    for (let index = activeMessages.length - 1; index >= 0; index -= 1) {
      const message = activeMessages[index]
      if (message.role !== 'assistant') continue
      const round = conversation?.rounds.find((item) => item.id === message.roundId)
      if (getRoundTaskSlots(round ?? null, tasks).some((slot) => (slot.task?.outputImages.length ?? 0) > 0))
        return message.id
    }
    return null
  }, [activeMessages, conversation?.rounds, tasks])

  useEffect(() => {
    const conversationId = conversation?.id ?? null
    const lastMessage = activeMessages[activeMessages.length - 1] ?? null
    const lastUserMessageSignature =
      lastMessage?.role === 'user' ? `${lastMessage.id}:${lastMessage.createdAt}:${lastMessage.content}` : null
    const previous = autoScrollStateRef.current
    const shouldScroll =
      appMode === 'agent' &&
      agentScrollToBottomAfterSubmit &&
      previous.conversationId === conversationId &&
      lastMessage?.role === 'user' &&
      lastUserMessageSignature != null &&
      previous.lastUserMessageSignature !== lastUserMessageSignature

    autoScrollStateRef.current = { conversationId, lastUserMessageSignature }
    if (!shouldScroll) return

    const frame = window.requestAnimationFrame(() => {
      scrollToAgentBottom()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeMessages, agentScrollToBottomAfterSubmit, appMode, conversation?.id, scrollToAgentBottom])

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateIsScrolledToBottom)
    return () => window.cancelAnimationFrame(frame)
  }, [activeMessages, activeRounds, updateIsScrolledToBottom])

  useEffect(() => {
    if (!scrollTargetRoundId) return
    const id = window.requestAnimationFrame(() => {
      messageRefs.current.get(scrollTargetRoundId)?.scrollIntoView({ block: 'center' })
      setScrollTargetRoundId(null)
    })
    return () => window.cancelAnimationFrame(id)
  }, [activeMessages, scrollTargetRoundId])

  const handleSwitchBranch = (round: AgentRound, direction: -1 | 1) => {
    if (!conversation) return
    const siblings = getAgentSiblingRounds(conversation, round)
    if (siblings.length <= 1) return
    const currentIndex = siblings.findIndex((item) => item.id === round.id)
    const nextRound = siblings[(currentIndex + direction + siblings.length) % siblings.length]
    const nextLeafId = getAgentBranchLeafId(conversation, nextRound.id)
    setActiveAgentRoundId(conversation.id, nextLeafId)
    setAgentEditingRoundId(null)
    setScrollTargetRoundId(nextRound.id)
  }

  const handleDeleteConversation = (id: string) => {
    const targetConversation = conversations.find((item) => item.id === id) ?? null
    const roundIds = new Set(targetConversation?.rounds.map((round) => round.id) ?? [])
    const roundTaskIds = targetConversation?.rounds.flatMap((round) => round.outputTaskIds) ?? []
    const relatedTasks = tasks.filter(
      (task) => task.agentConversationId === id || Boolean(task.agentRoundId && roundIds.has(task.agentRoundId)),
    )
    const existingTaskIds = new Set(tasks.map((task) => task.id))
    const relatedTaskIds = Array.from(new Set([...roundTaskIds, ...relatedTasks.map((task) => task.id)])).filter(
      (taskId) => existingTaskIds.has(taskId),
    )
    const relatedTaskIdSet = new Set(relatedTaskIds)
    const generatedImageCount = new Set(
      tasks.filter((task) => relatedTaskIdSet.has(task.id)).flatMap((task) => task.outputImages || []),
    ).size

    setConfirmDialog({
      title: '删除对话',
      message: '确定要删除这个 Agent 对话吗？',
      checkbox:
        generatedImageCount > 0
          ? {
              label: `同时删除对话中生成的图片（${generatedImageCount} 张）`,
              tone: 'danger',
            }
          : undefined,
      action: async (deleteGeneratedImages = false) => {
        deleteConversation(id)
        if (deleteGeneratedImages && relatedTaskIds.length > 0) await removeMultipleTasks(relatedTaskIds)
      },
    })
  }

  const startRenameConversation = (e: ReactMouseEvent | React.TouchEvent, id: string, currentTitle: string) => {
    e.stopPropagation()
    if (agentGeneratingTitleIds[id]) {
      showToast('标题生成中，暂不能修改标题', 'info')
      return
    }
    setAgentEditingConversationId(id)
    setEditingConversationTitle(currentTitle)
  }

  const confirmRenameConversation = () => {
    if (
      agentEditingConversationId &&
      editingConversationTitle.trim() &&
      !agentGeneratingTitleIds[agentEditingConversationId]
    ) {
      renameConversation(agentEditingConversationId, editingConversationTitle.trim())
    }
    setAgentEditingConversationId(null)
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      confirmRenameConversation()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setAgentEditingConversationId(null)
    }
  }

  // Effect to sync title when editing id is set from outside (e.g. Header)
  useEffect(() => {
    if (agentEditingConversationId) {
      const convo = conversations.find((c) => c.id === agentEditingConversationId)
      if (convo) {
        setEditingConversationTitle(convo.title)
      }
    }
  }, [agentEditingConversationId, conversations])

  const clearConversationLongPressTimer = () => {
    if (conversationLongPressTimer.current == null) return
    window.clearTimeout(conversationLongPressTimer.current)
    conversationLongPressTimer.current = null
  }

  const handleConversationPointerDown = (id: string, e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return
    clearConversationLongPressTimer()
    conversationLongPressTimer.current = window.setTimeout(() => {
      setConversationActionsId(id)
      conversationLongPressTimer.current = null
    }, 450)
  }

  const handleConversationSelect = (id: string) => {
    setActiveConversationId(id)
    if (!window.matchMedia('(min-width: 1024px)').matches) setSidebarCollapsed(true)
    if (conversationActionsId && conversationActionsId !== id) setConversationActionsId(null)
  }

  const handleConversationDragStart = (event: React.DragEvent<HTMLDivElement>, id: string) => {
    if (conversationSearchQuery.trim() || agentEditingConversationId === id) {
      event.preventDefault()
      return
    }
    setDraggingConversationId(id)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
  }

  const handleConversationDragOver = (event: React.DragEvent<HTMLDivElement>, id: string) => {
    if (!draggingConversationId || draggingConversationId === id || conversationSearchQuery.trim()) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    setDragOverConversation({ id, position: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after' })
  }

  const handleConversationDrop = (event: React.DragEvent<HTMLDivElement>, id: string) => {
    event.preventDefault()
    if (draggingConversationId && dragOverConversation?.id === id) {
      reorderConversations(draggingConversationId, id, dragOverConversation.position)
    }
    setDraggingConversationId(null)
    setDragOverConversation(null)
  }

  const clearConversationDrag = () => {
    setDraggingConversationId(null)
    setDragOverConversation(null)
  }

  useEffect(() => {
    if (!conversationActionsId) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('[data-agent-conversation-item]')) return
      setConversationActionsId(null)
    }

    document.addEventListener('pointerdown', handlePointerDown, { capture: true })
    return () => document.removeEventListener('pointerdown', handlePointerDown, { capture: true })
  }, [conversationActionsId])

  const handleDeleteMessage = (message: AgentMessage, round: AgentRound) => {
    const isUserMessage = message.role === 'user'
    const existingTaskIds = new Set(tasks.map((task) => task.id))
    const assistantTaskIds = isUserMessage
      ? []
      : Array.from(
          new Set([
            ...(message.outputTaskIds ?? []),
            ...round.outputTaskIds,
            ...tasks
              .filter((task) => task.agentMessageId === message.id || task.agentRoundId === round.id)
              .map((task) => task.id),
          ]),
        ).filter((taskId) => existingTaskIds.has(taskId))
    setConfirmDialog({
      title: isUserMessage ? '删除轮次' : '删除消息',
      message: isUserMessage
        ? '确定要删除这轮任务吗？这会删除这条消息和它的输出，后续消息会被保留。'
        : '确定要删除这条消息吗？这会同时删除这条回复生成的图片。',
      action: async () => {
        if (isUserMessage) {
          if (round.outputTaskIds.length > 0) await removeMultipleTasks(round.outputTaskIds)

          useStore.setState((state) => {
            const targetConversationId = conversation?.id
            let oldActivePath: AgentRound[] = []
            let newActivePath: AgentRound[] = []
            const agentConversations = state.agentConversations.map((item) => {
              if (item.id !== targetConversationId) return item
              oldActivePath = getActiveAgentRounds(item)
              const nextConversation = deleteAgentRoundFromConversation(item, round.id)
              newActivePath = getActiveAgentRounds(nextConversation)
              return nextConversation
            })
            const draft = targetConversationId ? state.agentInputDrafts[targetConversationId] : null
            const remappedDraft = draft
              ? { ...draft, prompt: remapAgentRoundMentionsForPathChange(draft.prompt, oldActivePath, newActivePath) }
              : null
            const agentInputDrafts =
              targetConversationId && remappedDraft
                ? { ...state.agentInputDrafts, [targetConversationId]: remappedDraft }
                : state.agentInputDrafts
            const shouldRemapVisibleInput =
              targetConversationId &&
              state.activeAgentConversationId === targetConversationId &&
              state.appMode === 'agent'
            return {
              agentConversations,
              agentInputDrafts,
              ...(shouldRemapVisibleInput
                ? { prompt: remapAgentRoundMentionsForPathChange(state.prompt, oldActivePath, newActivePath) }
                : {}),
              agentEditingRoundId: state.agentEditingRoundId === round.id ? null : state.agentEditingRoundId,
            }
          })
          return
        }

        if (assistantTaskIds.length > 0) await removeMultipleTasks(assistantTaskIds)

        useStore.setState((state) => ({
          agentConversations: state.agentConversations.map((item) =>
            item.id === conversation?.id
              ? {
                  ...item,
                  updatedAt: Date.now(),
                  rounds: item.rounds.map((candidate) =>
                    candidate.id === round.id && candidate.assistantMessageId === message.id
                      ? { ...candidate, assistantMessageId: undefined }
                      : candidate,
                  ),
                  messages: item.messages.filter((candidate) => candidate.id !== message.id),
                }
              : item,
          ),
          agentEditingRoundId: state.agentEditingRoundId,
        }))
      },
    })
  }

  const handleEditRoundMessage = async (round: AgentRound, content: string) => {
    setAgentEditingRoundId(round.id)
    clearMaskDraft()

    const inputImages = await Promise.all(
      round.inputImageIds.map(async (id) => ({
        id,
        dataUrl: (await ensureImageCached(id)) || '',
      })),
    )
    setInputImages(inputImages)
    const maskTargetImageId = round.maskTargetImageId ?? (round.maskImageId ? round.inputImageIds[0] : null)
    if (maskTargetImageId && round.maskImageId && inputImages.some((img) => img.id === maskTargetImageId)) {
      const maskDataUrl = await ensureImageCached(round.maskImageId)
      if (maskDataUrl) {
        setMaskDraft({
          targetImageId: maskTargetImageId,
          maskDataUrl,
          updatedAt: Date.now(),
        })
      }
    }
    setPrompt(content)
  }

  const handleCopyMessage = async (
    content: string,
    successMessage = '提示词已复制',
    failureMessage = '复制提示词失败',
  ) => {
    try {
      await copyTextToClipboard(content)
      showToast(successMessage, 'success')
    } catch (err) {
      showToast(getClipboardFailureMessage(failureMessage, err), 'error')
    }
  }

  const handleErrorCopyPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    errorCopyPointerDownRef.current = { x: e.clientX, y: e.clientY }
  }

  const handleErrorCopyClick = (e: ReactMouseEvent<HTMLDivElement>, content: string) => {
    e.stopPropagation()

    const pointerDown = errorCopyPointerDownRef.current
    errorCopyPointerDownRef.current = null
    if (pointerDown && Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y) > 4) return

    const selection = window.getSelection()
    if (selection && !selection.isCollapsed && selection.toString().trim()) {
      const target = e.currentTarget
      if (
        (selection.anchorNode && target.contains(selection.anchorNode)) ||
        (selection.focusNode && target.contains(selection.focusNode))
      )
        return
    }

    void handleCopyMessage(content, '完整报错已复制', '复制完整报错失败')
  }

  return (
    <main
      data-agent-workspace
      className="safe-area-x mx-auto flex min-h-[calc(100vh-100px)] flex-col lg:flex-row max-w-7xl lg:gap-3 px-3 lg:px-0 relative overflow-visible transition duration-300"
    >
      {/* Pull Down Indicator */}
      {pullDownOffset > 0 && !agentMobileHeaderVisible && (
        <div
          className="fixed top-0 left-0 right-0 z-toast flex justify-center items-end pointer-events-none sm:hidden"
          style={{ height: `${pullDownOffset + 10}px`, opacity: pullDownOffset / MOBILE_HEADER_PULL_MAX_OFFSET }}
        >
          <div className="bg-ds-scrim/60 backdrop-blur-sm text-white rounded-full p-1 mb-2 shadow-lg">
            <ChevronDownIcon className="w-4 h-4" />
          </div>
        </div>
      )}

      {/* Mobile Left Sidebar Overlay Backdrop */}
      {!sidebarCollapsed && (
        <div className="fixed inset-0 z-overlay bg-ds-scrim/50 lg:hidden" onClick={() => setSidebarCollapsed(true)} />
      )}

      {/* Conversation Sidebar */}
      <aside
        aria-hidden={desktopSidebarCollapsed && sidebarCollapsed}
        inert={desktopSidebarCollapsed && sidebarCollapsed}
        className={`fixed bottom-0 left-0 top-[var(--app-header-offset)] z-overlay flex w-4/5 max-w-[320px] flex-col border-r border-ds-border bg-ds-surface/95 shadow-2xl backdrop-blur transition-transform duration-300 dark:border-ds-border dark:bg-ds-scrim/95 lg:w-[280px] lg:max-w-none lg:shadow-none ${sidebarCollapsed ? '-translate-x-full' : 'translate-x-0'} ${desktopSidebarCollapsed ? 'lg:-translate-x-full' : 'lg:translate-x-0'}`}
      >
        <div className="flex h-full min-h-0 w-full flex-col pl-[max(0.75rem,env(safe-area-inset-left))]">
          <div className="shrink-0 border-b border-ds-border/80 px-3 py-3 dark:border-ds-border">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConversationSearchQuery('')}
                className="flex h-ds-control-md flex-1 items-center justify-center gap-2 rounded-lg border border-ds-border bg-ds-surface/80 text-xs font-medium text-ds-text transition-colors hover:bg-ds-subtle/70 dark:border-ds-border dark:bg-ds-surface dark:text-ds-text-subtle dark:hover:bg-ds-surface"
              >
                <HistoryIcon className="h-4 w-4" />
                历史对话
              </button>
              <button
                type="button"
                onClick={createConversation}
                className="flex h-ds-control-md flex-1 items-center justify-center gap-2 rounded-lg bg-ds-primary text-xs font-medium text-ds-text-inverse transition-colors hover:bg-ds-primary-hover"
              >
                <PlusIcon className="h-4 w-4" />
                新建对话
              </button>
            </div>
          </div>
          <div className="shrink-0 px-3 pb-2 pt-3">
            <input
              type="text"
              value={conversationSearchQuery}
              onChange={(e) => setConversationSearchQuery(e.target.value)}
              placeholder="搜索对话标题或内容..."
              className="w-full rounded-ds-lg border border-ds-border bg-ds-surface/80 px-3 py-2 text-sm text-ds-text outline-none transition-colors placeholder:text-ds-muted focus:border-ds-primary focus:bg-ds-surface dark:border-ds-border dark:bg-ds-surface dark:text-ds-text dark:focus:border-ds-primary dark:focus:bg-ds-surface"
            />
          </div>
          <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
            {filteredConversations.length === 0 && (
              <div className="px-3 py-10 text-center text-sm text-ds-muted">
                {conversationSearchQuery ? '没有找到匹配的对话' : '暂无对话'}
              </div>
            )}
            {filteredConversations.map((item) => {
              const isGeneratingTitle = Boolean(agentGeneratingTitleIds[item.id])
              const isActive = item.id === activeConversationId
              const isRunning = item.rounds.some((round) => round.status === 'running')
              const dragPosition = dragOverConversation?.id === item.id ? dragOverConversation.position : null
              return (
                <div
                  key={item.id}
                  data-agent-conversation-item
                  draggable={!conversationSearchQuery.trim() && agentEditingConversationId !== item.id}
                  onDragStart={(event) => handleConversationDragStart(event, item.id)}
                  onDragOver={(event) => handleConversationDragOver(event, item.id)}
                  onDrop={(event) => handleConversationDrop(event, item.id)}
                  onDragEnd={clearConversationDrag}
                  onDoubleClick={(event) => startRenameConversation(event, item.id, item.title)}
                  className={`group relative flex h-ds-14 items-center gap-1.5 rounded-ds-lg border px-2 transition-colors ${isActive ? 'border-ds-primary/35 bg-ds-primary/12 text-ds-primary dark:bg-ds-primary/15 dark:text-ds-primary' : 'border-transparent text-ds-text hover:bg-ds-subtle dark:text-ds-muted dark:hover:bg-ds-surface'} ${draggingConversationId === item.id ? 'opacity-45' : ''}`}
                  onPointerDown={(e) => handleConversationPointerDown(item.id, e)}
                  onPointerUp={clearConversationLongPressTimer}
                  onPointerCancel={clearConversationLongPressTimer}
                  onPointerLeave={clearConversationLongPressTimer}
                  onContextMenu={(e) => {
                    if (conversationActionsId === item.id) e.preventDefault()
                  }}
                >
                  {dragPosition === 'before' && (
                    <span className="absolute -top-0.5 left-2 right-2 h-0.5 rounded-full bg-ds-primary" />
                  )}
                  {dragPosition === 'after' && (
                    <span className="absolute -bottom-0.5 left-2 right-2 h-0.5 rounded-full bg-ds-primary" />
                  )}
                  <DragHandleIcon
                    className={`h-4 w-4 shrink-0 text-ds-muted transition-opacity ${conversationSearchQuery.trim() ? 'opacity-20' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}
                  />
                  {agentEditingConversationId === item.id ? (
                    <div className="min-w-0 flex-1 flex flex-col justify-center h-[38px]">
                      <input
                        type="text"
                        className="h-ds-control-sm flex-1 bg-ds-surface dark:bg-ds-surface border border-ds-primary/50 dark:border-ds-border rounded px-1.5 py-0 text-sm leading-7 outline-none text-ds-text dark:text-ds-text focus:border-ds-primary dark:focus:border-ds-border shadow-sm min-w-0"
                        value={editingConversationTitle}
                        onChange={(e) => setEditingConversationTitle(e.target.value)}
                        onKeyDown={handleRenameKeyDown}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                        onBlur={confirmRenameConversation}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => handleConversationSelect(item.id)}
                    >
                      <div className={`flex items-center gap-1.5 truncate text-sm ${isActive ? 'font-semibold' : ''}`}>
                        <span className="truncate">{item.title}</span>
                        {isRunning && (
                          <span
                            className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-ds-primary"
                            aria-label="正在生成"
                          />
                        )}
                      </div>
                      <div className="truncate text-xs text-ds-muted">{formatTime(item.updatedAt)}</div>
                    </button>
                  )}
                  <div
                    className={`flex shrink-0 items-center gap-1 overflow-hidden transition duration-150 ${agentEditingConversationId === item.id ? 'w-6 opacity-100' : `group-hover:w-[4.5rem] group-hover:opacity-100 group-focus-within:w-[4.5rem] group-focus-within:opacity-100 ${conversationActionsId === item.id ? 'w-[4.5rem] opacity-100' : 'w-0 opacity-0'}`}`}
                  >
                    {agentEditingConversationId === item.id ? (
                      <AgentActionButton
                        tooltip="确认"
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          confirmRenameConversation()
                        }}
                        className="p-1.5 hover:bg-ds-subtle dark:hover:bg-ds-surface rounded-md text-ds-success hover:text-ds-success transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </AgentActionButton>
                    ) : (
                      <>
                        <AgentActionButton
                          tooltip="编辑标题"
                          className="p-1.5 text-ds-muted hover:text-ds-text disabled:text-ds-text-subtle disabled:hover:text-ds-text disabled:cursor-not-allowed dark:hover:text-ds-text dark:disabled:text-ds-muted dark:disabled:hover:text-ds-muted"
                          onClick={(e) => startRenameConversation(e, item.id, item.title)}
                          disabled={isGeneratingTitle}
                        >
                          <EditIcon className="w-4 h-4" />
                        </AgentActionButton>
                        <AgentActionButton
                          tooltip="删除"
                          className="p-1.5 text-ds-muted hover:text-ds-danger"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteConversation(item.id)
                          }}
                        >
                          <TrashIcon className="w-4 h-4" />
                        </AgentActionButton>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="shrink-0 border-t border-ds-border/80 p-2 dark:border-ds-border">
            <button
              type="button"
              onClick={() => {
                setSidebarCollapsed(true)
                setDesktopSidebarCollapsed(true)
              }}
              className="flex h-ds-control-md w-full items-center justify-center gap-2 rounded-lg text-xs font-medium text-ds-muted transition-colors hover:bg-ds-subtle hover:text-ds-text dark:hover:bg-ds-surface dark:hover:text-ds-text"
            >
              <SidebarLeftIcon className="h-4 w-4" />
              收起侧栏
            </button>
          </div>
        </div>
      </aside>

      {desktopSidebarCollapsed && (
        <button
          type="button"
          onClick={() => setDesktopSidebarCollapsed(false)}
          className="fixed left-0 top-[calc(var(--app-header-offset)+1rem)] z-30 hidden h-ds-control-lg w-8 items-center justify-center rounded-r-xl border border-l-0 border-ds-border bg-ds-surface/90 text-ds-muted shadow-lg backdrop-blur transition-colors hover:text-ds-primary dark:border-ds-border dark:bg-ds-scrim/90 lg:flex"
          title="展开对话列表"
          aria-label="展开对话列表"
        >
          <SidebarLeftIcon className="h-4 w-4" />
        </button>
      )}

      {/* Center Chat Area */}
      <section className="min-w-0 flex-1 flex flex-col relative">
        {/* Mobile Header Toggles */}
        <div
          className={`sticky top-0 z-20 lg:hidden overflow-hidden transition duration-300 ease-in-out ${mobileTopBarVisible ? 'max-h-16 opacity-100 mb-2' : 'max-h-0 opacity-0 mb-0 pointer-events-none'}`}
        >
          <div
            className="flex h-ds-14 items-center justify-between border-b border-ds-border bg-ds-surface/80 px-2 backdrop-blur dark:border-ds-border dark:bg-ds-scrim/80"
            onTouchStart={handleHeaderTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              className="p-2 text-ds-muted hover:text-ds-text dark:hover:text-ds-text hover:bg-ds-subtle dark:hover:bg-ds-surface rounded-lg transition-colors"
              title="展开对话列表"
            >
              <SidebarLeftIcon className="w-5 h-5" />
            </button>
            <div className="flex-1 truncate px-2 text-center text-sm font-semibold text-ds-text dark:text-ds-muted">
              Agent
            </div>
            <span className="h-ds-control-md w-ds-control-md" aria-hidden="true" />
          </div>
        </div>

        <div
          ref={scrollContainerRef}
          className="flex-1 space-y-4 overflow-visible pb-[var(--input-bar-clearance,12rem)] px-1 lg:pt-14 lg:px-4"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {!conversation ? (
            <div className="py-20 text-center text-ds-muted">
              <p className="mb-3">还没有 Agent 对话</p>
              <button
                type="button"
                onClick={createConversation}
                className="rounded-lg bg-ds-primary px-4 py-2 text-ds-text-inverse hover:bg-ds-primary-hover transition-colors"
              >
                创建对话
              </button>
            </div>
          ) : (
            (() => {
              if (activeMessages.length === 0) {
                return (
                  <div className="py-20 text-center text-ds-muted">
                    <p className="mb-2">开始新的 Agent 对话</p>
                    <p className="text-xs">在底部输入框发送消息即可创建第一轮对话。</p>
                  </div>
                )
              }

              const renderedMessages = activeMessages.map((message) => {
                const round = conversation.rounds.find((item) => item.id === message.roundId)
                const isAssistant = message.role === 'assistant'
                const isStreamingAssistant = isAssistant && round?.status === 'running'
                const isEditing = !isAssistant && round?.id === agentEditingRoundId
                const siblingRounds = !isAssistant && round ? getAgentSiblingRounds(conversation, round) : []
                const siblingIndex = round ? siblingRounds.findIndex((item) => item.id === round.id) : -1
                const hasBranches = siblingRounds.length > 1
                const taskSlotsForRound = isAssistant ? getRoundTaskSlots(round ?? null, tasks) : []
                const tasksForRound = taskSlotsForRound.map((slot) => slot.task).filter(Boolean) as TaskRecord[]
                const favoriteTasksForRound = tasksForRound.filter((task) => (task.outputImages?.length ?? 0) > 0)
                const hasRoundFavoriteTasks = favoriteTasksForRound.length > 0
                const allRoundTasksFavorited =
                  hasRoundFavoriteTasks && favoriteTasksForRound.every((task) => task.isFavorite)
                const assistantBlocks = isAssistant
                  ? getAgentAssistantBlocks(round ?? null, taskSlotsForRound, tasks, Boolean(message.content.trim()))
                  : []
                const hasImageGrid = assistantBlocks.some((block) => block.type === 'image-grid')
                const roundImageIds = tasksForRound.flatMap((task) => task.outputImages)
                const canCollapseImageReply =
                  isAssistant && !isStreamingAssistant && hasImageGrid && roundImageIds.length > 0
                const collapsesByDefault = canCollapseImageReply && message.id !== newestImageAssistantMessageId
                const isImageReplyCollapsed =
                  canCollapseImageReply &&
                  (collapsesByDefault
                    ? !expandedAssistantMessageIds.has(message.id)
                    : collapsedAssistantMessageIds.has(message.id))
                const inputImagesForRound = (round?.inputImageIds || []).map((id) => ({ id, dataUrl: '' }))
                const parts = getPromptMentionParts(message.content, inputImagesForRound)
                return (
                  <div key={message.id} className={`flex w-full mb-6 ${isAssistant ? 'justify-start' : 'justify-end'}`}>
                    <div
                      ref={(node) => {
                        if (!isAssistant && node) messageRefs.current.set(message.roundId, node)
                        else if (!isAssistant) messageRefs.current.delete(message.roundId)
                      }}
                      className={`group flex max-w-[95%] flex-col md:max-w-[85%] ${isAssistant && hasImageGrid ? 'w-full lg:max-w-[92%]' : 'lg:max-w-[75%]'} ${isAssistant ? 'items-start' : 'items-end'}`}
                    >
                      <article
                        className={`relative flex min-w-[16rem] max-w-full flex-col rounded-ds-xl p-4 transition duration-200 ${isAssistant && hasImageGrid ? 'w-full' : ''} ${
                          isAssistant
                            ? 'bg-ds-surface/70 dark:bg-ds-surface border border-ds-border dark:border-ds-border rounded-tl-sm hover:bg-ds-surface dark:hover:bg-ds-surface'
                            : `bg-ds-surface dark:bg-ds-surface-subtle rounded-tr-sm ${isEditing ? 'ring-2 ring-ds-focus/50 dark:ring-ds-focus/50' : ''}`
                        }`}
                      >
                        <div className="mb-2 flex items-center justify-between gap-4 text-sm text-ds-muted dark:text-ds-muted">
                          <span className="font-medium">
                            <span
                              className={
                                isAssistant
                                  ? 'text-ds-primary dark:text-ds-primary font-semibold'
                                  : 'text-ds-text dark:text-ds-text-subtle font-semibold'
                              }
                            >
                              {isAssistant ? 'Agent' : '用户'}
                            </span>{' '}
                            <span className="opacity-60 font-normal ml-1">· 第 {round?.index ?? '?'} 轮</span>
                          </span>
                        </div>

                        {message.role === 'user' && round && round.inputImageIds.length > 0 && (
                          <div className="flex gap-2 mb-3 overflow-x-auto pb-1" onClick={(e) => e.stopPropagation()}>
                            {round.inputImageIds.map((imgId, imageIndex) => (
                              <ChatImageThumb
                                key={imgId}
                                imageId={imgId}
                                imageIndex={imageIndex}
                                maskImageId={
                                  imgId === (round.maskTargetImageId ?? round.inputImageIds[0])
                                    ? round.maskImageId
                                    : null
                                }
                              />
                            ))}
                          </div>
                        )}

                        {isImageReplyCollapsed ? (
                          <div>
                            <div className="rounded-ds-lg border border-ds-border/80 bg-ds-surface/80 px-3 py-2.5 dark:border-ds-border dark:bg-ds-surface/15">
                              <div className="mb-1 text-xs font-medium text-ds-muted dark:text-ds-muted">提示词</div>
                              <div className="line-clamp-2 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ds-text dark:text-ds-text-subtle">
                                {round?.prompt || '未记录提示词'}
                              </div>
                            </div>
                            <AgentImagePreviewStrip
                              items={taskSlotsForRound.map((slot) => ({ task: slot.task, taskId: slot.taskId }))}
                              imageList={roundImageIds}
                              onViewMore={() => {
                                setExpandedAssistantMessageIds((ids) => new Set(ids).add(message.id))
                                setCollapsedAssistantMessageIds((ids) => {
                                  const next = new Set(ids)
                                  next.delete(message.id)
                                  return next
                                })
                              }}
                            />
                          </div>
                        ) : round?.status === 'error' && isAssistant && message.content.startsWith('请求失败：') ? (
                          <div
                            data-selectable-text
                            className="-m-2 flex cursor-copy select-text flex-col rounded-ds-lg p-2 transition-colors hover:bg-ds-danger-subtle/60 dark:hover:bg-ds-danger/5"
                            title="点击复制完整报错"
                            onPointerDown={handleErrorCopyPointerDown}
                            onClick={(e) => handleErrorCopyClick(e, message.content)}
                          >
                            {(() => {
                              const content = message.content.replace(/^请求失败：/, '')
                              const [mainErr, ...hints] = content.split('\n提示：')
                              return (
                                <>
                                  <div className="flex items-start gap-2 text-ds-danger dark:text-ds-danger">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      viewBox="0 0 20 20"
                                      fill="currentColor"
                                      className="w-[18px] h-[18px] mt-[1.5px] flex-shrink-0"
                                    >
                                      <path
                                        fillRule="evenodd"
                                        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
                                        clipRule="evenodd"
                                      />
                                    </svg>
                                    <div className="whitespace-pre-wrap text-ds-md leading-relaxed break-words font-medium">
                                      {mainErr}
                                    </div>
                                  </div>
                                  {hints.length > 0 && (
                                    <div className="pl-[26px] mt-1.5 whitespace-pre-wrap text-ds-sm leading-relaxed text-ds-muted dark:text-ds-muted break-words opacity-90">
                                      <span className="font-medium">提示：</span>
                                      {hints.join('\n提示：')}
                                    </div>
                                  )}
                                </>
                              )
                            })()}
                          </div>
                        ) : (
                          <div
                            data-selectable-text
                            className={`text-[15px] leading-relaxed text-ds-text dark:text-ds-text-subtle ${!isAssistant ? 'select-text' : ''}`}
                          >
                            {isAssistant ? (
                              <>
                                {assistantBlocks.length > 0 ? (
                                  assistantBlocks.map((block, index) => {
                                    if (block.type === 'web-search')
                                      return <AgentWebSearchStatusLines key={block.key} statuses={[block.status]} />
                                    if (block.type === 'text')
                                      return (
                                        <div key={block.key} className={index > 0 ? 'mt-3' : undefined}>
                                          <MarkdownRenderer
                                            content={block.content ?? message.content}
                                            streaming={isStreamingAssistant}
                                          />
                                        </div>
                                      )
                                    if (block.type === 'batch-params') {
                                      return (
                                        <div key={block.key} className={index > 0 ? 'mt-3' : undefined}>
                                          <AgentWebSearchInlineStatus status={block.status} />
                                        </div>
                                      )
                                    }
                                    if (block.type === 'image-grid')
                                      return (
                                        <AgentImageGrid key={block.key} items={block.items} imageList={roundImageIds} />
                                      )
                                    return null
                                  })
                                ) : isStreamingAssistant ? (
                                  <AgentStreamingCursor />
                                ) : null}
                              </>
                            ) : parts.some((part) => part.type === 'mention') ? (
                              <div className="whitespace-pre-wrap break-words">
                                {parts.map((part, i) =>
                                  part.type === 'text' ? (
                                    <span key={i}>{part.text}</span>
                                  ) : (
                                    <span
                                      key={i}
                                      className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-ds-primary-subtle/50 text-ds-primary dark:bg-ds-primary/30 dark:text-ds-primary text-xs font-medium mx-0.5 align-baseline"
                                    >
                                      {part.text}
                                    </span>
                                  ),
                                )}
                              </div>
                            ) : (
                              <MarkdownRenderer content={parts[0]?.text ?? ''} />
                            )}
                          </div>
                        )}
                      </article>

                      {!isStreamingAssistant && (
                        <div
                          className={`mt-2 flex w-full min-w-fit items-center justify-between gap-3 px-1 transition-opacity duration-200 ${isEditing || hasBranches ? 'opacity-100' : 'opacity-100 lg:opacity-0 lg:group-hover:opacity-100'}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            {isEditing && (
                              <div className="inline-flex items-center rounded-md bg-ds-primary-subtle px-2 py-1 text-xs text-ds-primary dark:bg-ds-primary/20 dark:text-ds-primary">
                                <span className="truncate">正在编辑</span>
                                <AgentActionButton
                                  tooltip="取消编辑"
                                  className="ml-1 -mr-1 p-0.5 rounded-full hover:bg-ds-primary-subtle dark:hover:bg-ds-primary/40 transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setPrompt('')
                                    setInputImages([])
                                    clearMaskDraft()
                                    setAgentEditingRoundId(null)
                                  }}
                                >
                                  <CloseIcon className="w-3 h-3" />
                                </AgentActionButton>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 ml-auto text-ds-muted">
                            {!isAssistant && round && hasBranches && siblingIndex >= 0 && (
                              <div className="inline-flex items-center text-sm font-bold text-ds-muted dark:text-ds-muted mr-1">
                                <AgentActionButton
                                  tooltip="上一分支"
                                  className="p-1 rounded-md hover:bg-ds-subtle/50 dark:hover:bg-ds-surface hover:text-ds-text dark:hover:text-ds-text transition-colors"
                                  onClick={() => handleSwitchBranch(round, -1)}
                                >
                                  <ChevronLeftIcon className="w-4 h-4" />
                                </AgentActionButton>
                                <span className="px-1 tabular-nums tracking-widest">
                                  {siblingIndex + 1}/{siblingRounds.length}
                                </span>
                                <AgentActionButton
                                  tooltip="下一分支"
                                  className="p-1 rounded-md hover:bg-ds-subtle/50 dark:hover:bg-ds-surface hover:text-ds-text dark:hover:text-ds-text transition-colors"
                                  onClick={() => handleSwitchBranch(round, 1)}
                                >
                                  <ChevronRightIcon className="w-4 h-4" />
                                </AgentActionButton>
                              </div>
                            )}
                            {isAssistant ? (
                              <>
                                {canCollapseImageReply && (
                                  <AgentActionButton
                                    tooltip={isImageReplyCollapsed ? '展开图片回复' : '折叠图片回复'}
                                    className="p-1.5 rounded-md text-ds-muted hover:text-ds-primary hover:bg-ds-primary-subtle dark:hover:bg-ds-primary/10 transition-colors"
                                    onClick={() => {
                                      if (isImageReplyCollapsed) {
                                        setExpandedAssistantMessageIds((ids) => new Set(ids).add(message.id))
                                        setCollapsedAssistantMessageIds((ids) => {
                                          const next = new Set(ids)
                                          next.delete(message.id)
                                          return next
                                        })
                                        return
                                      }
                                      if (collapsesByDefault) {
                                        setExpandedAssistantMessageIds((ids) => {
                                          const next = new Set(ids)
                                          next.delete(message.id)
                                          return next
                                        })
                                        return
                                      }
                                      setCollapsedAssistantMessageIds((ids) => new Set(ids).add(message.id))
                                    }}
                                  >
                                    <ChevronDownIcon
                                      className={`w-4 h-4 transition-transform ${isImageReplyCollapsed ? '-rotate-90' : ''}`}
                                    />
                                  </AgentActionButton>
                                )}
                                <AgentActionButton
                                  tooltip="复制输出文本"
                                  className={`p-1.5 rounded-md transition-colors ${message.content.trim() ? 'text-ds-muted hover:text-ds-text hover:bg-ds-subtle dark:hover:text-ds-text dark:hover:bg-ds-surface' : 'text-ds-text-subtle dark:text-ds-muted opacity-50 cursor-not-allowed'}`}
                                  disabled={!message.content.trim()}
                                  onClick={() => {
                                    void handleCopyMessage(
                                      getAgentAssistantCopyContent(message.content, assistantBlocks),
                                      '输出文本已复制',
                                      '复制输出文本失败',
                                    )
                                  }}
                                >
                                  <CopyIcon className="w-4 h-4" />
                                </AgentActionButton>
                                <AgentActionButton
                                  tooltip="重新生成"
                                  className="p-1.5 rounded-md text-ds-muted hover:text-ds-primary hover:bg-ds-primary-subtle dark:hover:bg-ds-primary/10 transition-colors"
                                  onClick={() => {
                                    if (conversation && round)
                                      void regenerateAgentAssistantMessage(conversation.id, round.id)
                                  }}
                                >
                                  <RefreshIcon className="w-4 h-4" />
                                </AgentActionButton>
                                <AgentActionButton
                                  tooltip={allRoundTasksFavorited ? '编辑收藏夹' : '收藏所有图片'}
                                  className={`p-1.5 rounded-md transition-colors ${hasRoundFavoriteTasks ? (allRoundTasksFavorited ? 'text-ds-warning hover:bg-ds-warning-subtle dark:hover:bg-ds-warning/10' : 'text-ds-muted hover:text-ds-warning hover:bg-ds-warning-subtle dark:hover:bg-ds-warning/10') : 'text-ds-text-subtle dark:text-ds-muted opacity-50 cursor-not-allowed'}`}
                                  disabled={!hasRoundFavoriteTasks}
                                  onClick={() => {
                                    if (!hasRoundFavoriteTasks) return
                                    openFavoritePicker(favoriteTasksForRound.map((task) => task.id))
                                  }}
                                >
                                  <FavoriteIcon className="w-4 h-4" filled={allRoundTasksFavorited} />
                                </AgentActionButton>
                                <AgentActionButton
                                  tooltip="下载所有图片"
                                  className={`p-1.5 rounded-md transition-colors ${getRoundTasks(round ?? null, tasks).filter(Boolean).length > 0 ? 'text-ds-muted hover:text-ds-success hover:bg-ds-success-subtle dark:hover:bg-ds-success/10' : 'text-ds-text-subtle dark:text-ds-muted opacity-50 cursor-not-allowed'}`}
                                  disabled={getRoundTasks(round ?? null, tasks).filter(Boolean).length === 0}
                                  onClick={async () => {
                                    const imageIds = tasksForRound.flatMap((t) => t.outputImages || [])
                                    if (imageIds.length === 0) return
                                    try {
                                      const roundIndex = round?.index ?? 0
                                      const fileNameBase = 'agent-round-' + roundIndex
                                      const { settings, workspaceTabs } = useStore.getState()
                                      const entries = getGeneratedImageDownloadEntries(
                                        tasksForRound,
                                        workspaceTabs,
                                        settings,
                                        imageIds,
                                      )
                                      const { successCount, failCount } = settings.zipDownloadRoutes.includes(
                                        'agent-round-all',
                                      )
                                        ? await downloadImageEntriesAsZip(entries, fileNameBase)
                                        : await downloadImageEntries(entries)
                                      if (successCount === 0) {
                                        useStore.getState().showToast('下载失败', 'error')
                                      } else if (failCount > 0) {
                                        useStore
                                          .getState()
                                          .showToast(
                                            '部分下载失败：成功 ' + successCount + '，失败 ' + failCount,
                                            'error',
                                          )
                                      } else {
                                        useStore
                                          .getState()
                                          .showToast(
                                            successCount > 1 ? '下载成功：' + successCount + ' 张图片' : '下载成功',
                                            'success',
                                          )
                                      }
                                    } catch (err) {
                                      console.error(err)
                                      useStore.getState().showToast('下载失败', 'error')
                                    }
                                  }}
                                >
                                  <DownloadIcon className="w-4 h-4" />
                                </AgentActionButton>
                                <AgentActionButton
                                  tooltip="删除消息"
                                  className="p-1.5 hover:text-ds-danger hover:bg-ds-danger-subtle dark:hover:bg-ds-danger/10 rounded-md transition-colors"
                                  onClick={() => {
                                    if (round) handleDeleteMessage(message, round)
                                  }}
                                >
                                  <TrashIcon className="w-4 h-4" />
                                </AgentActionButton>
                              </>
                            ) : (
                              <>
                                <AgentActionButton
                                  tooltip="复制提示词"
                                  className="p-1.5 rounded-md hover:text-ds-text dark:hover:text-ds-text hover:bg-ds-subtle/50 dark:hover:bg-ds-surface transition-colors"
                                  onClick={() => {
                                    void handleCopyMessage(message.content)
                                  }}
                                >
                                  <CopyIcon className="w-4 h-4" />
                                </AgentActionButton>
                                <AgentActionButton
                                  tooltip="编辑"
                                  className="p-1.5 rounded-md hover:text-ds-text dark:hover:text-ds-text hover:bg-ds-subtle/50 dark:hover:bg-ds-surface transition-colors"
                                  onClick={() => {
                                    if (round) void handleEditRoundMessage(round, message.content)
                                  }}
                                >
                                  <EditIcon className="w-4 h-4" />
                                </AgentActionButton>
                                <AgentActionButton
                                  tooltip="删除"
                                  className="p-1.5 hover:text-ds-danger dark:hover:text-ds-danger hover:bg-ds-danger-subtle dark:hover:bg-ds-danger/30 rounded-md transition-colors"
                                  onClick={() => {
                                    if (round) handleDeleteMessage(message, round)
                                  }}
                                >
                                  <TrashIcon className="w-4 h-4" />
                                </AgentActionButton>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })

              const runningRounds = activeRounds.filter(
                (round) =>
                  round.status === 'running' &&
                  !conversation.messages.some(
                    (message) => message.roundId === round.id && message.role === 'assistant',
                  ),
              )

              return (
                <>
                  {renderedMessages}
                  {runningRounds.map((round) => (
                    <div key={`running-${round.id}`} className="flex w-full justify-start mb-6">
                      <article className="flex min-w-[16rem] max-w-[95%] flex-col rounded-ds-xl rounded-tl-sm border border-ds-border bg-ds-surface/70 p-4 dark:border-ds-border dark:bg-ds-surface md:max-w-[85%] lg:max-w-[75%]">
                        <div className="mb-2 text-sm text-ds-muted dark:text-ds-muted">
                          <span className="text-ds-primary dark:text-ds-primary font-semibold">Agent</span>{' '}
                          <span className="ml-1 font-normal opacity-60">· 第 {round.index} 轮</span>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-ds-muted dark:text-ds-muted">
                          <span className="inline-flex items-center gap-1.5">
                            <span>正在生成回复</span>
                            <span className="flex gap-1">
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
                            </span>
                          </span>
                        </div>
                      </article>
                    </div>
                  ))}
                </>
              )
            })()
          )}
          <div ref={bottomSentinelRef} aria-hidden="true" />
        </div>

        <button
          onClick={scrollToAgentBottom}
          className={`fixed bottom-[calc(var(--input-bar-clearance,12rem)+1.5rem)] left-1/2 -translate-x-1/2 z-30 flex h-ds-control-lg w-ds-control-lg items-center justify-center rounded-full bg-ds-surface/90 backdrop-blur shadow-[0_2px_12px_rgba(0,0,0,0.1)] border border-ds-border/50 text-ds-muted transition duration-300 hover:bg-ds-subtle hover:text-ds-text dark:border-ds-border dark:bg-ds-subtle/90 dark:text-ds-muted dark:hover:bg-ds-subtle dark:hover:text-ds-text ${
            !isScrolledToBottom && activeMessages.length > 0
              ? 'translate-y-0 opacity-100'
              : 'translate-y-4 opacity-0 pointer-events-none'
          }`}
          aria-label="滚动到底部"
        >
          <ArrowDownIcon className="h-5 w-5" />
        </button>
      </section>
    </main>
  )
}
