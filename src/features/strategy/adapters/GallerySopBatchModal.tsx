import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react'
import {
  BookmarkIcon as Bookmark,
  BookOpenCheckIcon as BookOpenCheck,
  CheckCircleIcon as CheckCircle2,
  CheckIcon as Check,
  ChevronDownIcon as ChevronDown,
  ChevronRightIcon as ChevronRight,
  CloseIcon as X,
  CopyIcon as Copy,
  ImageIcon,
  LoaderCircleIcon as LoaderCircle,
  MoreHorizontalIcon as MoreHorizontal,
  PauseIcon as Pause,
  PlayIcon as Play,
  PlusIcon as Plus,
  RefreshIcon as RefreshCw,
  SearchIcon as Search,
  SendIcon as Send,
  SparklesIcon as Sparkles,
  TrashIcon as Trash2,
  XCircleIcon as XCircle,
} from '../../../design-system/icons'
import {
  ensureImageCached,
  ensureImageThumbnailCached,
  submitTaskWithData,
  subscribeImageThumbnail,
  useStore,
} from '../../../store'
import type { InputImage, SopBatchSnapshot, TaskRecord } from '../../../types'
import {
  deleteSopBatchSnapshot,
  getAllSopBatchSnapshots,
  getSopBatchSnapshot,
  putSopBatchSnapshot,
} from '../../../lib/db'
import { useRequirementPrototype } from '../../requirementPrototype/store'
import { useAssetLibraryStore } from '../../assetLibrary/store'
import {
  allocateSopPromptCounts,
  getSopRunCounts,
  getSopTotalImageCount,
  MAX_SOP_IMAGES_PER_PROMPT,
  normalizeSopPromptCandidates,
  selectSopPromptSources,
  SOP_HIGH_VOLUME_WARNING_THRESHOLD,
} from '../sopPromptBatch'
import {
  generatePromptsFromSopStore,
  generateVariablePromptsFromSopStore,
  getSopPromptGenerationModelFromStore,
} from './storeSopGeneration'
import { useCloseOnEscape } from '../../../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../../../hooks/usePreventBackgroundScroll'
import { Switch, useDialogFocusTrap } from '../../../design-system'
import { isModalBackdropEvent } from '../../../lib/modalBackdrop'
import { LARGE_MODAL_SIZE_STYLE, useLargeModalMode } from '../../../hooks/useLargeModalMode'
import LargeModalToggle from '../../../components/LargeModalToggle'
import { getPromptRunImageLinks, type PromptRunImageLink } from './promptRunImageLinks'
import { sortPromptRunsNewestFirst } from './promptRunPresentation'
import { useDragSelect, getMarqueeBoxStyle } from '../../../hooks/useDragSelect'

type BatchStatus = 'idle' | 'generating' | 'paused' | 'ready' | 'submitting' | 'success' | 'error'
type SourceStatus = 'pending' | 'running' | 'completed' | 'partial' | 'failed'
const PROMPT_MANAGEMENT_MODAL_MODE_STORAGE_KEY = 'doupao.prompt-management-modal-mode'

type SopPromptSource = {
  id: string
  label: string
  kind: 'image' | 'text'
  imageId?: string
  dataUrl?: string
}

type SourceRun = {
  source: SopPromptSource
  requestedCount: number
  status: SourceStatus
  attempts: number
  error?: string
}

type PromptDraft = {
  id: string
  sourceId: string
  referenceImageIds?: string[]
  promptText: string
  origin: 'ai' | 'manual'
  edited?: boolean
  deleted?: boolean
}

type PersistedSopPromptRun = {
  version?: 2 | 3 | 4
  activeRunId?: string
  selectedSopId: string
  promptCount: number
  imagesPerPrompt: number
  availablePrompts?: number
  quantity?: number
  brief: string
  autoGenerate?: boolean
  secondReference?: boolean
  sources?: SourceRun[]
  prompts?: PromptDraft[]
}

function sourceKey(index: number, imageId: string) {
  return `source-${index + 1}-${imageId}`
}

function promptItemId(sourceId: string) {
  return `sop-prompt-${sourceId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function promptRunId() {
  return `sop-run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function getRunUpdatedAt(run: SopBatchSnapshot) {
  return run.updatedAt ?? run.createdAt
}

function getRunStatusLabel(run: SopBatchSnapshot) {
  const status = run.status ?? (run.batchId ? 'submitted' : 'ready')
  if (status === 'generating') return '生成中'
  if (status === 'submitted') return '已生图'
  if (status === 'failed') return '有失败'
  return '可复用'
}

function getPromptRunTitle(run: SopBatchSnapshot) {
  return run.title?.trim() || run.brief.trim() || `${run.sop.name || '独立'}提示词`
}

export function getGallerySopPromptRunStorageKey(tabId: string | null, folderKey?: string) {
  const tab = tabId ?? 'default'
  const folder = folderKey ? `.${encodeURIComponent(folderKey)}` : ''
  return `doupao.gallery-sop-prompt-run.${tab}${folder}`
}

/** 静默自动启动被阻断的原因 */
export type SopAutoStartBlockReason = 'existing-prompts'

export type GallerySopRunStatus = {
  workspaceTabId: string | null
  phase: BatchStatus
  message: string
  promptCount: number
  availablePrompts: number
  totalImages: number
  failed: number
}

function SourceThumb({ source, fit = 'cover' }: { source: SopPromptSource; fit?: 'cover' | 'contain' }) {
  const [dataUrl, setDataUrl] = useState(source.dataUrl ?? '')

  useEffect(() => {
    let active = true
    if (source.kind === 'text' || !source.imageId) {
      setDataUrl('')
      return
    }
    if (source.dataUrl) {
      setDataUrl(source.dataUrl)
      return
    }
    void ensureImageCached(source.imageId).then((value) => {
      if (active) setDataUrl(value ?? '')
    })
    return () => {
      active = false
    }
  }, [source.dataUrl, source.imageId])

  if (source.kind === 'text') {
    return (
      <div className="flex h-full w-full items-center justify-center bg-ds-selection text-ds-primary">
        <BookOpenCheck size={18} />
      </div>
    )
  }

  return dataUrl ? (
    <img
      src={dataUrl}
      alt={source.label}
      className={`h-full w-full ${fit === 'contain' ? 'object-contain' : 'object-cover'}`}
    />
  ) : (
    <div className="flex h-full w-full items-center justify-center bg-ds-subtle text-ds-muted">
      <ImageIcon size={18} />
    </div>
  )
}

function OutputImageThumb({ imageId, label }: { imageId: string; label: string }) {
  const [thumbnailSrc, setThumbnailSrc] = useState('')

  useEffect(() => {
    let cancelled = false
    const applyThumbnail = (thumbnail: { dataUrl: string }) => {
      if (!cancelled) setThumbnailSrc(thumbnail.dataUrl)
    }
    const unsubscribe = subscribeImageThumbnail(imageId, applyThumbnail)
    void ensureImageThumbnailCached(imageId)
      .then((thumbnail) => {
        if (thumbnail) applyThumbnail(thumbnail)
      })
      .catch(() => {
        if (!cancelled) setThumbnailSrc('')
      })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [imageId])

  return thumbnailSrc ? (
    <img src={thumbnailSrc} alt={label} className="h-full w-full object-cover" />
  ) : (
    <div className="flex h-full w-full items-center justify-center bg-ds-subtle text-ds-muted">
      <ImageIcon size={16} />
    </div>
  )
}

/** 按图片真实比例计算显示尺寸：宽 96–200px、高上限 220px，保证比例不变且整图可见。 */
function fitImageSize(
  naturalWidth: number,
  naturalHeight: number,
  maxWidth = 200,
  maxHeight = 220,
  minWidth = 96,
): { width: number; height: number } {
  const ratio = naturalWidth / naturalHeight
  let width = Math.round(maxHeight * ratio)
  let height = maxHeight
  if (width > maxWidth) {
    width = maxWidth
    height = Math.round(maxWidth / ratio)
  }
  if (width < minWidth) {
    width = minWidth
    height = Math.round(minWidth / ratio)
    if (height > maxHeight) {
      height = maxHeight
      width = Math.round(maxHeight * ratio)
    }
  }
  return { width, height }
}

/** 主生成图：按真实图片比例渲染（object-contain 完整显示不裁剪），点击查看大图。 */
function PromptOutputImage({ imageId, index, onClick }: { imageId: string; index: number; onClick: () => void }) {
  const [thumbnailSrc, setThumbnailSrc] = useState('')
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    const applyThumbnail = (thumbnail: { dataUrl: string }) => {
      if (!cancelled) setThumbnailSrc(thumbnail.dataUrl)
    }
    const unsubscribe = subscribeImageThumbnail(imageId, applyThumbnail)
    void ensureImageThumbnailCached(imageId)
      .then((thumbnail) => {
        if (thumbnail) applyThumbnail(thumbnail)
      })
      .catch(() => {
        if (!cancelled) setThumbnailSrc('')
      })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [imageId])

  const boxStyle = size ? { width: size.width, height: size.height } : { width: 112, height: 140 }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`查看第 ${index + 1} 条提示词的生成图片 1`}
      className="relative shrink-0 overflow-hidden rounded-lg border border-ds-border bg-ds-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ds-primary"
      style={boxStyle}
    >
      {thumbnailSrc ? (
        <img
          src={thumbnailSrc}
          alt={`提示词 ${index + 1} 的生成图片 1`}
          onLoad={(event) => {
            const img = event.currentTarget
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              setSize(fitImageSize(img.naturalWidth, img.naturalHeight))
            }
          }}
          className="h-full w-full object-contain"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-ds-muted">
          <ImageIcon size={18} />
        </div>
      )}
    </button>
  )
}

/** 自适应高度文本域：内容多高就多高（完整显示提示词不截断），仍可手动拉伸。 */
function AutoResizeTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const syncHeight = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }
  useEffect(syncHeight, [props.value])
  return (
    <textarea
      ref={ref}
      {...props}
      rows={1}
      onInput={(event) => {
        props.onInput?.(event)
        const el = event.currentTarget
        el.style.height = 'auto'
        el.style.height = `${el.scrollHeight}px`
      }}
    />
  )
}

export default function GallerySopBatchModal({
  onClose,
  initialSopId = '',
  initialQuantity,
  initialPromptCount = initialQuantity ?? 5,
  initialImagesPerPrompt = 1,
  syncInitialGenerationCounts = false,
  initialBrief = '',
  initialAutoGenerate = false,
  initialSecondReference = false,
  autoStart = false,
  workspaceTabId,
  folderKey,
  visible = true,
  onBackground,
  onAutoStartConsumed,
  onStatusChange,
  onNeedsAttention,
  onCountsChange,
}: {
  onClose: () => void
  initialSopId?: string
  initialQuantity?: number
  initialPromptCount?: number
  initialImagesPerPrompt?: number
  syncInitialGenerationCounts?: boolean
  initialBrief?: string
  initialAutoGenerate?: boolean
  initialSecondReference?: boolean
  autoStart?: boolean
  workspaceTabId?: string | null
  /** 素材库项目文件夹 id（空表示非文件夹作用域）：同一标签页内不同文件夹各自独立运行草稿 */
  folderKey?: string
  visible?: boolean
  onBackground?: () => void
  onAutoStartConsumed?: () => void
  onStatusChange?: (status: GallerySopRunStatus) => void
  /**
   * 静默（后台）自动启动被阻断时回调，宿主需据此把弹窗显式呈现给用户，
   * 避免用户按下发送后「什么都没发生」。
   */
  onNeedsAttention?: (reason: SopAutoStartBlockReason) => void
  /**
   * 批次参数变化回调：提示词数量 / 每条图片数 / 自动生图 / 二次参考 任一变化时上报，
   * 宿主（输入栏胶囊）据此保持单一数据源，避免两处控件各自持有一份状态。
   */
  onCountsChange?: (counts: {
    promptCount: number
    imagesPerPrompt: number
    autoGenerate: boolean
    secondReference: boolean
  }) => void
}) {
  const { largeView, toggleLargeView } = useLargeModalMode(PROMPT_MANAGEMENT_MODAL_MODE_STORAGE_KEY)
  const items = useRequirementPrototype((state) => state.sopLibrary)
  const params = useStore((state) => state.params)
  const adNegativeRuleProfiles = useStore((state) => state.settings.adNegativeRuleProfiles)
  const inputImages = useStore((state) => state.inputImages)
  const inputImageFolder = useStore((state) => state.inputImageFolder)
  const customOutputPath = useStore((state) => state.customOutputPath)
  const tasks = useStore((state) => state.tasks)
  const activeWorkspaceTabId = useStore((state) => state.activeWorkspaceTabId)
  const workspaceTabs = useStore((state) => state.workspaceTabs)
  const showToast = useStore((state) => state.showToast)
  const setConfirmDialog = useStore((state) => state.setConfirmDialog)
  const setInputImages = useStore((state) => state.setInputImages)
  const setInputImageFolder = useStore((state) => state.setInputImageFolder)
  const setParams = useStore((state) => state.setParams)
  // 直接读取父级实时传入的当前 SOP：父级在每次切换 SOP 时都会传入最新的
  // initialSopId（来自 gallerySopIdsByTab[tabId]），因此弹窗内"当前 SOP"会
  // 立即同步刷新，不会停留在 mount 时锁定的旧 SOP（避免点击应用时回退到上一个 SOP）。
  const selectedSopId = initialSopId
  const [promptCount, setPromptCount] = useState(initialPromptCount)
  const [imagesPerPrompt, setImagesPerPrompt] = useState(initialImagesPerPrompt)
  const [brief, setBrief] = useState(initialBrief)
  const [autoGenerate, setAutoGenerate] = useState(initialAutoGenerate)
  const [secondReference, setSecondReference] = useState(initialSecondReference)
  const [sources, setSources] = useState<SourceRun[]>([])
  const [prompts, setPrompts] = useState<PromptDraft[]>([])
  const [status, setStatus] = useState<BatchStatus>('idle')
  const [statusMessage, setStatusMessage] = useState('提示词列表为空，可新建或从 SOP 生成')
  const [error, setError] = useState('')
  const [activeRunId, setActiveRunId] = useState(promptRunId)
  const [recentRuns, setRecentRuns] = useState<SopBatchSnapshot[]>([])
  const [runTitle, setRunTitle] = useState('')
  const [librarySearch, setLibrarySearch] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [restoreComplete, setRestoreComplete] = useState(false)
  const [previewSource, setPreviewSource] = useState<SopPromptSource | null>(null)
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(() => new Set())
  const [libraryContextMenu, setLibraryContextMenu] = useState<{ x: number; y: number; run: SopBatchSnapshot } | null>(
    null,
  )
  const listRef = useRef<HTMLDivElement | null>(null)
  const lastClickedRunIdRef = useRef<string | null>(null)
  const autoStartRef = useRef(false)
  const autoGenerateRef = useRef(initialAutoGenerate)
  const secondReferenceRef = useRef(initialSecondReference)
  const activeRunIdRef = useRef(activeRunId)
  const activeRunSubmittedRef = useRef(false)
  const activePromptGenerationModelRef = useRef('')
  const pendingSnapshotRef = useRef<SopBatchSnapshot | null>(null)
  const snapshotTimerRef = useRef<number | null>(null)
  const generationAbortRef = useRef<AbortController | null>(null)
  const generationPausedRef = useRef(false)
  const pauseWaitersRef = useRef<Array<() => void>>([])
  const componentActiveRef = useRef(true)
  const modalRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  /**
   * 本批次启动时捕获的素材库项目文件夹：SOP 批量是长任务，中途用户可能切换文件夹，
   * 若每次提交都实时捕获会把产出错投到新文件夹；这里固定批次启动时的归属。
   */
  const batchDefaultCollectionIdRef = useRef<string | undefined>(undefined)

  const captureBatchDefaultCollectionId = () => {
    const scope = useAssetLibraryStore.getState().scope
    batchDefaultCollectionIdRef.current =
      typeof scope === 'object' && scope !== null && scope.kind === 'collection' ? scope.id : undefined
  }

  const selectedSop = items.find((item) => item.id === selectedSopId)
  const promptGenerationActive = status === 'generating' || status === 'paused'
  const running = promptGenerationActive || status === 'submitting'
  const targetWorkspaceTabId = workspaceTabId ?? activeWorkspaceTabId
  const activeTab = workspaceTabs.find((tab) => tab.id === targetWorkspaceTabId)
  const promptRunStorageKey = getGallerySopPromptRunStorageKey(targetWorkspaceTabId, folderKey)
  const allSources = useMemo<SopPromptSource[]>(() => {
    const direct = inputImages.map((image, index) => ({
      id: sourceKey(index, image.id),
      label: `图${index + 1}`,
      kind: 'image' as const,
      imageId: image.id,
      dataUrl: image.dataUrl,
    }))
    if (direct.length > 0) return direct
    const folderImages = (inputImageFolder?.imageIds ?? []).map((imageId, index) => ({
      id: sourceKey(index, imageId),
      label: `图${index + 1}`,
      kind: 'image' as const,
      imageId,
    }))
    return folderImages.length
      ? folderImages
      : [{ id: 'text-to-image', label: '文生图（无参考图）', kind: 'text' as const }]
  }, [inputImageFolder?.imageIds, inputImages])
  const normalizedCounts = getSopRunCounts(promptCount, imagesPerPrompt)
  const targetCount = normalizedCounts.promptCount
  const targetImagesPerPrompt = normalizedCounts.imagesPerPrompt
  const normalizedInitialCounts = getSopRunCounts(initialPromptCount, initialImagesPerPrompt)
  const initialGenerationCountsPending =
    syncInitialGenerationCounts &&
    restoreComplete &&
    (targetCount !== normalizedInitialCounts.promptCount ||
      targetImagesPerPrompt !== normalizedInitialCounts.imagesPerPrompt)
  const totalImageCount = getSopTotalImageCount(targetCount, targetImagesPerPrompt)
  const selectedSources = useMemo(
    () => selectSopPromptSources(allSources, targetCount, brief),
    [allSources, brief, targetCount],
  )
  const visiblePrompts = prompts.filter((item) => !item.deleted && item.promptText.trim())
  const missingCount = Math.max(0, targetCount - visiblePrompts.length)
  const activeRun = recentRuns.find((run) => run.id === activeRunId)
  const activePromptImageLinks = useMemo<PromptRunImageLink[]>(
    () => (activeRun ? getPromptRunImageLinks(activeRun, tasks) : []),
    [activeRun, tasks],
  )
  const activePromptImageLinksByPromptId = useMemo(() => {
    const linksByPromptId = new Map<string, PromptRunImageLink[]>()
    activePromptImageLinks.forEach((link) => {
      const current = linksByPromptId.get(link.promptId) ?? []
      current.push(link)
      linksByPromptId.set(link.promptId, current)
    })
    return linksByPromptId
  }, [activePromptImageLinks])
  const runImageSummaryById = useMemo(() => {
    const runIds = new Set(recentRuns.map((run) => run.id))
    const taskRunIds = new Map(recentRuns.flatMap((run) => (run.taskIds ?? []).map((taskId) => [taskId, run.id])))
    const summaries = new Map<string, { count: number }>()
    tasks.forEach((task) => {
      const runId = task.sopBatch?.snapshotId ?? taskRunIds.get(task.id)
      if (!runId || !runIds.has(runId) || !task.outputImages.length) return
      const summary = summaries.get(runId) ?? { count: 0 }
      summary.count += task.outputImages.length
      summaries.set(runId, summary)
    })
    return summaries
  }, [recentRuns, tasks])
  const filteredRuns = useMemo(() => {
    const keyword = librarySearch.trim().toLocaleLowerCase()
    const runs = recentRuns.filter((run) => {
      if (favoritesOnly && !run.pinned) return false
      if (!keyword) return true
      return [getPromptRunTitle(run), run.sop.name, run.brief, ...run.prompts.map((prompt) => prompt.text)].some(
        (value) => value.toLocaleLowerCase().includes(keyword),
      )
    })
    return sortPromptRunsNewestFirst(runs)
  }, [favoritesOnly, librarySearch, recentRuns])
  const getPromptReferenceSources = (item: PromptDraft) => {
    const source = allSources.find((candidate) => candidate.id === item.sourceId)
    const imageIds = item.referenceImageIds ?? (source?.kind === 'image' && source.imageId ? [source.imageId] : [])
    return imageIds.map(
      (imageId, index) =>
        allSources.find((candidate) => candidate.imageId === imageId) ?? {
          id: `reference-${imageId}`,
          label: `参考图 ${index + 1}`,
          kind: 'image' as const,
          imageId,
        },
    )
  }
  const promptBelongsToSource = (item: PromptDraft, source: SopPromptSource) =>
    item.sourceId === source.id ||
    Boolean(source.imageId && item.referenceImageIds?.[0] === source.imageId) ||
    (source.kind === 'text' && !item.referenceImageIds?.length)

  const setCurrentRunId = (id: string, submitted = false) => {
    activeRunIdRef.current = id
    activeRunSubmittedRef.current = submitted
    setActiveRunId(id)
  }

  const releasePauseWaiters = () => {
    const waiters = pauseWaitersRef.current.splice(0)
    for (const resolve of waiters) resolve()
  }

  const waitWhileGenerationPaused = async () => {
    if (!generationPausedRef.current) return
    await new Promise<void>((resolve) => {
      pauseWaitersRef.current.push(resolve)
    })
  }

  const pausePromptGeneration = () => {
    if (status !== 'generating' || !generationAbortRef.current) return
    generationPausedRef.current = true
    setStatus('paused')
    setStatusMessage('提示词生成已暂停，将在当前请求完成后停止发送下一批')
  }

  const resumePromptGeneration = () => {
    if (status !== 'paused' || !generationAbortRef.current) return
    generationPausedRef.current = false
    releasePauseWaiters()
    setStatus('generating')
    setStatusMessage(`继续生成提示词，当前可用 ${visiblePrompts.length}/${targetCount} 条`)
  }

  const cancelPromptGeneration = () => {
    const controller = generationAbortRef.current
    if (!controller) return
    generationPausedRef.current = false
    releasePauseWaiters()
    controller.abort(new DOMException('提示词生成已取消', 'AbortError'))
    setStatusMessage('正在取消提示词生成')
  }

  const resetCompletedRun = () => {
    const nextRunId = promptRunId()
    setCurrentRunId(nextRunId)
    activePromptGenerationModelRef.current = ''
    batchDefaultCollectionIdRef.current = undefined
    setRunTitle('')
    setSources([])
    setPrompts([])
    setStatus('idle')
    setError('')
    setStatusMessage('提示词列表为空，可新建或从 SOP 生成')
    writeRunPointer(
      nextRunId,
      [],
      autoGenerateRef.current,
      brief,
      targetCount,
      targetImagesPerPrompt,
      secondReferenceRef.current,
    )
  }

  const updateRecentRun = (snapshot: SopBatchSnapshot) => {
    setRecentRuns((current) =>
      sortPromptRunsNewestFirst([snapshot, ...current.filter((item) => item.id !== snapshot.id)]),
    )
  }

  const writeRunPointer = (
    runId: string,
    nextPrompts: PromptDraft[],
    nextAutoGenerate = autoGenerate,
    nextBrief = brief,
    nextPromptCount = targetCount,
    nextImagesPerPrompt = targetImagesPerPrompt,
    nextSecondReference = secondReferenceRef.current,
  ) => {
    window.localStorage.setItem(
      promptRunStorageKey,
      JSON.stringify({
        version: 4,
        activeRunId: runId,
        selectedSopId,
        promptCount: nextPromptCount,
        imagesPerPrompt: nextImagesPerPrompt,
        availablePrompts: nextPrompts.filter((item) => !item.deleted && item.promptText.trim()).length,
        brief: nextBrief,
        autoGenerate: nextAutoGenerate,
        secondReference: nextSecondReference,
      } satisfies PersistedSopPromptRun),
    )
  }

  const buildPromptRunSnapshot = (
    runId: string,
    nextPrompts: PromptDraft[],
    nextSources: SourceRun[],
    runStatus: NonNullable<SopBatchSnapshot['status']>,
    patch: Partial<SopBatchSnapshot> = {},
  ): SopBatchSnapshot | null => {
    const previous = recentRuns.find((item) => item.id === runId)
    const snapshotSop = previous?.sop ?? selectedSop
    if (!snapshotSop) return null
    const referenceImageIds = selectedSources
      .filter((source) => source.kind === 'image' && source.imageId)
      .map((source) => source.imageId!)
    const now = Date.now()
    const promptGenerationModel =
      patch.promptGenerationModel?.trim() ||
      activePromptGenerationModelRef.current.trim() ||
      previous?.promptGenerationModel?.trim() ||
      undefined
    return {
      id: runId,
      batchId: patch.batchId ?? previous?.batchId ?? '',
      workspaceTabId: targetWorkspaceTabId,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      status: runStatus,
      pinned: patch.pinned ?? previous?.pinned ?? false,
      batchIds: patch.batchIds ?? previous?.batchIds ?? [],
      taskIds: patch.taskIds ?? previous?.taskIds ?? [],
      title: runTitle.trim() || previous?.title,
      promptGroup: patch.promptGroup ?? previous?.promptGroup,
      promptOrder: patch.promptOrder ?? previous?.promptOrder ?? 0,
      promptGenerationModel,
      sop: {
        id: snapshotSop.id,
        name: snapshotSop.name,
        description: snapshotSop.description,
        content: snapshotSop.content,
      },
      brief: brief.trim(),
      referenceImageIds: patch.referenceImageIds ?? referenceImageIds,
      promptCount: nextPrompts.filter((item) => !item.deleted && item.promptText.trim()).length,
      imagesPerPrompt: targetImagesPerPrompt,
      prompts: nextPrompts.map((item) => ({
        id: item.id,
        text: item.promptText,
        origin: item.origin,
        edited: Boolean(item.edited),
        sourceId: item.sourceId,
        referenceImageIds: item.referenceImageIds,
        deleted: Boolean(item.deleted),
      })),
      params: { ...params, n: targetImagesPerPrompt, reference_mode: 'cycle' },
      ...patch,
    }
  }

  const flushPromptRunSnapshot = async (snapshot?: SopBatchSnapshot | null) => {
    const next = snapshot ?? pendingSnapshotRef.current
    if (!next) return
    if (snapshotTimerRef.current != null) window.clearTimeout(snapshotTimerRef.current)
    snapshotTimerRef.current = null
    pendingSnapshotRef.current = null
    await putSopBatchSnapshot(next)
    updateRecentRun(next)
  }

  const queuePromptRunSnapshot = (snapshot: SopBatchSnapshot) => {
    pendingSnapshotRef.current = snapshot
    if (snapshotTimerRef.current != null) window.clearTimeout(snapshotTimerRef.current)
    snapshotTimerRef.current = window.setTimeout(() => {
      const pending = pendingSnapshotRef.current
      if (pending) void flushPromptRunSnapshot(pending)
    }, 350)
  }

  const persistPromptRun = (
    nextPrompts: PromptDraft[],
    nextSources = sources,
    nextAutoGenerate = autoGenerate,
    runStatus: NonNullable<SopBatchSnapshot['status']> = 'ready',
    preserveSubmittedRun = false,
  ) => {
    let runId = activeRunIdRef.current
    if (activeRunSubmittedRef.current && runStatus !== 'submitted' && !preserveSubmittedRun) {
      runId = promptRunId()
      setCurrentRunId(runId)
    }
    writeRunPointer(runId, nextPrompts, nextAutoGenerate)
    const snapshot = buildPromptRunSnapshot(runId, nextPrompts, nextSources, runStatus)
    if (snapshot) queuePromptRunSnapshot(snapshot)
  }

  const applyPromptRun = async (run: SopBatchSnapshot, message: string, restoreGenerationContext = false) => {
    try {
      if (run.id !== activeRunIdRef.current) await flushPromptRunSnapshot()
      const sourceByImageId = new Map(
        run.referenceImageIds.map((imageId, index) => [
          imageId,
          {
            id: `restored-${imageId}`,
            label: `图${index + 1}`,
            kind: 'image' as const,
            imageId,
          },
        ]),
      )
      const textSource: SopPromptSource = { id: 'text-to-image', label: '文生图（无参考图）', kind: 'text' }
      const restoredPrompts: PromptDraft[] = run.prompts.map((item, index) => {
        const imageId =
          item.referenceImageIds?.length === 1
            ? item.referenceImageIds[0]
            : run.referenceImageIds.length > 0
              ? run.referenceImageIds[index % run.referenceImageIds.length]
              : undefined
        const source = imageId ? sourceByImageId.get(imageId) : textSource
        return {
          id: item.id,
          sourceId: source?.id ?? textSource.id,
          referenceImageIds: imageId ? [imageId] : [],
          promptText: item.text,
          origin: item.origin,
          edited: item.edited,
          deleted: item.deleted,
        }
      })
      const restoredSourceMap = new Map<string, SourceRun>()
      for (const item of restoredPrompts) {
        const imageId = item.referenceImageIds?.[0]
        const source = imageId ? sourceByImageId.get(imageId) : textSource
        if (!source) continue
        const existing = restoredSourceMap.get(source.id)
        restoredSourceMap.set(source.id, {
          source,
          requestedCount: (existing?.requestedCount ?? 0) + 1,
          status: 'completed',
          attempts: 0,
        })
      }
      const restoredSources = [...restoredSourceMap.values()]
      const restoredImages = restoreGenerationContext
        ? (
            await Promise.all(
              run.referenceImageIds.map(async (imageId): Promise<InputImage | null> => {
                const dataUrl = await ensureImageCached(imageId)
                return dataUrl ? { id: imageId, dataUrl } : null
              }),
            )
          ).filter((image): image is InputImage => Boolean(image))
        : []

      setCurrentRunId(run.id, run.status === 'submitted' || Boolean(run.batchId))
      activePromptGenerationModelRef.current = run.promptGenerationModel ?? ''
      setRunTitle(getPromptRunTitle(run))
      setPromptCount(
        run.promptCount ||
          restoredPrompts.filter((item) => !item.deleted && item.promptText.trim()).length ||
          initialPromptCount,
      )
      setImagesPerPrompt(run.imagesPerPrompt || initialImagesPerPrompt)
      setBrief(run.brief)
      setSources(restoredSources)
      setPrompts(restoredPrompts)
      if (restoreGenerationContext) {
        setParams(run.params)
        setInputImageFolder(null)
        setInputImages(restoredImages)
      }
      setStatus('ready')
      setError('')
      setStatusMessage(message)
      writeRunPointer(run.id, restoredPrompts, autoGenerateRef.current, run.brief, run.promptCount, run.imagesPerPrompt)
      if (restoreGenerationContext && restoredImages.length !== run.referenceImageIds.length) {
        showToast(
          `已加载提示词，但有 ${run.referenceImageIds.length - restoredImages.length} 张历史参考图不可用`,
          'info',
        )
      }
    } catch {
      showToast('打开提示词集失败', 'error')
    }
  }

  useEffect(() => {
    let active = true
    setRestoreComplete(false)
    autoStartRef.current = false

    void (async () => {
      const allRuns = await getAllSopBatchSnapshots()
      if (!active) return
      const sortedRuns = sortPromptRunsNewestFirst(allRuns)
      setRecentRuns(sortedRuns)

      let persisted: Partial<PersistedSopPromptRun> | null = null
      try {
        const raw = window.localStorage.getItem(promptRunStorageKey)
        persisted = raw ? (JSON.parse(raw) as Partial<PersistedSopPromptRun>) : null
      } catch {
        window.localStorage.removeItem(promptRunStorageKey)
      }

      if (persisted?.selectedSopId === selectedSopId && persisted.activeRunId) {
        const storedRun = await getSopBatchSnapshot(persisted.activeRunId)
        if (active && storedRun?.sop.id === selectedSopId) {
          if (typeof persisted.autoGenerate === 'boolean') {
            autoGenerateRef.current = persisted.autoGenerate
            setAutoGenerate(persisted.autoGenerate)
          }
          if (typeof persisted.secondReference === 'boolean') {
            secondReferenceRef.current = persisted.secondReference
            setSecondReference(persisted.secondReference)
          }
          await applyPromptRun(
            storedRun,
            `已恢复上次 SOP 提示词列表，当前可用 ${storedRun.prompts.filter((item) => !item.deleted && item.text.trim()).length} 条`,
            visible,
          )
          if (active) setRestoreComplete(true)
          return
        }
      }

      if (!selectedSopId && sortedRuns[0]) {
        const latestRun = sortedRuns[0]
        await applyPromptRun(
          latestRun,
          `已打开最近的提示词集，当前可用 ${latestRun.prompts.filter((item) => !item.deleted && item.text.trim()).length} 条`,
        )
        if (active) setRestoreComplete(true)
        return
      }

      const legacyPrompts =
        persisted?.selectedSopId === selectedSopId && Array.isArray(persisted.prompts) ? persisted.prompts : []
      if (legacyPrompts.length > 0) {
        const legacySources = Array.isArray(persisted?.sources) ? persisted.sources : []
        const migratedRunId = promptRunId()
        setCurrentRunId(migratedRunId)
        setRunTitle('')
        setPromptCount(persisted?.promptCount ?? persisted?.quantity ?? initialPromptCount)
        setImagesPerPrompt(persisted?.imagesPerPrompt ?? initialImagesPerPrompt)
        setBrief(typeof persisted?.brief === 'string' ? persisted.brief : initialBrief)
        if (typeof persisted?.autoGenerate === 'boolean') {
          autoGenerateRef.current = persisted.autoGenerate
          setAutoGenerate(persisted.autoGenerate)
        }
        if (typeof persisted?.secondReference === 'boolean') {
          secondReferenceRef.current = persisted.secondReference
          setSecondReference(persisted.secondReference)
        }
        setSources(legacySources)
        setPrompts(legacyPrompts)
        setStatus('ready')
        setStatusMessage(
          `已迁移上次保存的 SOP 提示词列表，当前可用 ${legacyPrompts.filter((item) => !item.deleted && item.promptText.trim()).length} 条`,
        )
        const migrated = buildPromptRunSnapshot(migratedRunId, legacyPrompts, legacySources, 'ready')
        if (migrated) await flushPromptRunSnapshot(migrated)
        writeRunPointer(
          migratedRunId,
          legacyPrompts,
          persisted?.autoGenerate ?? autoGenerateRef.current,
          persisted?.brief ?? initialBrief,
          persisted?.promptCount ?? persisted?.quantity ?? initialPromptCount,
          persisted?.imagesPerPrompt ?? initialImagesPerPrompt,
        )
      } else {
        const newRunId = promptRunId()
        setCurrentRunId(newRunId)
        setRunTitle('')
        setPromptCount(initialPromptCount)
        setImagesPerPrompt(initialImagesPerPrompt)
        setBrief(initialBrief)
        setSources([])
        setPrompts([])
        setStatus('idle')
        setStatusMessage('提示词列表为空，可新建或从 SOP 生成')
        writeRunPointer(newRunId, [], autoGenerateRef.current, initialBrief, initialPromptCount, initialImagesPerPrompt)
      }
      if (active) setRestoreComplete(true)
    })().catch((cause) => {
      if (!active) return
      setRestoreComplete(true)
      setError(cause instanceof Error ? cause.message : '恢复 SOP 提示词运行记录失败')
    })

    return () => {
      active = false
      generationPausedRef.current = false
      const waiters = pauseWaitersRef.current.splice(0)
      for (const resolve of waiters) resolve()
      generationAbortRef.current?.abort(new DOMException('SOP 已切换或工作台已关闭', 'AbortError'))
      generationAbortRef.current = null
    }
  }, [promptRunStorageKey, initialSopId])

  useEffect(() => {
    if (!syncInitialGenerationCounts || !restoreComplete) return
    setPromptCount(normalizedInitialCounts.promptCount)
    setImagesPerPrompt(normalizedInitialCounts.imagesPerPrompt)
  }, [autoStart, initialImagesPerPrompt, initialPromptCount, restoreComplete, syncInitialGenerationCounts])

  // 批次参数单一数据源：弹窗内任何调整（含恢复历史运行）都上报宿主同步，输入栏胶囊只作状态展示。
  useEffect(() => {
    onCountsChange?.({ promptCount, imagesPerPrompt, autoGenerate, secondReference })
  }, [autoGenerate, imagesPerPrompt, onCountsChange, promptCount, secondReference])

  useEffect(
    () => () => {
      componentActiveRef.current = false
      if (snapshotTimerRef.current != null) window.clearTimeout(snapshotTimerRef.current)
      const pending = pendingSnapshotRef.current
      if (pending) void putSopBatchSnapshot(pending)
    },
    [],
  )

  const toggleAutoGenerate = (nextAutoGenerate: boolean) => {
    autoGenerateRef.current = nextAutoGenerate
    setAutoGenerate(nextAutoGenerate)
    if (prompts.length > 0) persistPromptRun(prompts, sources, nextAutoGenerate)
    else writeRunPointer(activeRunIdRef.current, prompts, nextAutoGenerate)
  }

  const toggleSecondReference = (nextSecondReference: boolean) => {
    secondReferenceRef.current = nextSecondReference
    setSecondReference(nextSecondReference)
    writeRunPointer(
      activeRunIdRef.current,
      prompts,
      autoGenerateRef.current,
      brief,
      targetCount,
      targetImagesPerPrompt,
      nextSecondReference,
    )
  }

  const closeSafely = () => {
    if (running) {
      onBackground?.()
      showToast(
        status === 'paused'
          ? 'SOP 提示词生成已暂停，可随时返回继续'
          : 'SOP 提示词正在后台生成，可随时从当前标签页的列表继续查看',
        'success',
      )
      return
    }
    onClose()
  }

  const toggleRunPinned = async (run: SopBatchSnapshot) => {
    try {
      if (run.id === activeRunIdRef.current) await flushPromptRunSnapshot()
      const latest = (await getSopBatchSnapshot(run.id)) ?? run
      const updated = { ...latest, pinned: !latest.pinned, updatedAt: Date.now() }
      await putSopBatchSnapshot(updated)
      updateRecentRun(updated)
      showToast(updated.pinned ? '已收藏为可复用提示词集' : '已取消收藏提示词集', 'success')
    } catch {
      showToast('收藏状态保存失败，请重试', 'error')
    }
  }

  const toggleActiveRunPinned = async () => {
    await flushPromptRunSnapshot()
    let run = await getSopBatchSnapshot(activeRunIdRef.current)
    if (!run) {
      const created = buildPromptRunSnapshot(activeRunIdRef.current, prompts, sources, 'ready')
      if (!created) return
      run = created
    }
    await toggleRunPinned(run)
  }

  const duplicatePromptRun = async (run: SopBatchSnapshot, openAfterCopy = false) => {
    if (run.id === activeRunIdRef.current) await flushPromptRunSnapshot()
    try {
      const latest = (await getSopBatchSnapshot(run.id)) ?? run
      const now = Date.now()
      const duplicated: SopBatchSnapshot = {
        ...latest,
        id: promptRunId(),
        title: `${getPromptRunTitle(latest)} 副本`,
        promptGroup: undefined,
        batchId: '',
        batchIds: [],
        taskIds: [],
        createdAt: now,
        updatedAt: now,
        status: 'ready',
        pinned: false,
        prompts: latest.prompts.map((prompt) => ({ ...prompt, id: promptItemId(prompt.sourceId ?? 'text-to-image') })),
      }
      await putSopBatchSnapshot(duplicated)
      updateRecentRun(duplicated)
      if (openAfterCopy) {
        await applyPromptRun(duplicated, '已创建提示词集副本')
      }
      showToast(`已创建提示词集副本「${getPromptRunTitle(duplicated)}」`, 'success')
      return duplicated
    } catch {
      showToast('创建副本失败，请重试', 'error')
    }
  }

  const openLibraryContextMenu = (event: ReactMouseEvent, run: SopBatchSnapshot) => {
    event.preventDefault()
    event.stopPropagation()
    setLibraryContextMenu({ x: event.clientX, y: event.clientY, run })
  }

  const performDeleteRun = async (run: SopBatchSnapshot) => {
    try {
      if (run.taskIds?.length || run.batchId) {
        showToast('该运行记录已关联生图任务，不能直接删除', 'info')
        return
      }
      if (run.id === activeRunIdRef.current) await flushPromptRunSnapshot()
      await deleteSopBatchSnapshot(run.id)
      const remainingRuns = recentRuns.filter((item) => item.id !== run.id)
      setRecentRuns(remainingRuns)
      if (run.id === activeRunIdRef.current) {
        if (remainingRuns[0]) {
          await applyPromptRun(remainingRuns[0], `已打开提示词集「${getPromptRunTitle(remainingRuns[0])}」`)
        } else {
          const newRunId = promptRunId()
          setCurrentRunId(newRunId)
          setRunTitle('')
          setSources([])
          setPrompts([])
          setStatus('idle')
          setStatusMessage('提示词集为空，可新建或从 SOP 生成')
          writeRunPointer(newRunId, [])
        }
      }
      showToast('提示词集已删除', 'success')
    } catch {
      showToast('删除提示词集失败，请重试', 'error')
    }
  }

  const deleteRun = (run: SopBatchSnapshot) => {
    if (run.taskIds?.length || run.batchId) {
      showToast('该运行记录已关联生图任务，不能直接删除', 'info')
      return
    }
    setConfirmDialog({
      title: '删除提示词集？',
      message: `将永久删除「${getPromptRunTitle(run)}」，此操作不可撤销。`,
      confirmText: '确认删除',
      tone: 'danger',
      action: () => void performDeleteRun(run),
    })
  }

  const clearRunSelection = () => setSelectedRunIds(new Set())

  const toggleRunSelection = (runId: string, mode: 'replace' | 'add' | 'toggle' = 'toggle') => {
    setSelectedRunIds((current) => {
      const next = new Set(mode === 'replace' ? [] : current)
      if (mode === 'add') {
        next.add(runId)
      } else if (mode === 'replace') {
        next.add(runId)
      } else if (next.has(runId)) {
        next.delete(runId)
      } else {
        next.add(runId)
      }
      return next
    })
  }

  const selectAllFilteredRuns = () => setSelectedRunIds(new Set(filteredRuns.map((run) => run.id)))

  const invertRunSelection = () =>
    setSelectedRunIds(new Set(filteredRuns.map((run) => run.id).filter((id) => !selectedRunIds.has(id))))

  // 树形列表框选：与素材库共用同一套交互（实时命中预览 / 容器自动滚动 / Esc 取消 / Shift 加选）
  const { selectionBox } = useDragSelect({
    containerSelector: '[data-drag-select-surface]',
    containerRef: listRef,
    itemSelector: '[data-run-id]',
    getItemId: (element) => (element instanceof HTMLElement ? (element.dataset.runId ?? null) : null),
    onSelectionChange: (ids) => setSelectedRunIds(new Set(ids)),
    initialSelectedIds: Array.from(selectedRunIds),
  })

  const getSelectedRuns = () => recentRuns.filter((run) => selectedRunIds.has(run.id))

  const batchDeleteRuns = () => {
    const targets = getSelectedRuns()
    const removable = targets.filter((run) => !run.taskIds?.length && !run.batchId)
    const locked = targets.length - removable.length
    if (removable.length === 0) {
      showToast(locked > 0 ? '所选提示词集均已关联生图任务，不能删除' : '请先选择提示词集', 'info')
      return
    }
    setConfirmDialog({
      title: `批量删除 ${removable.length} 个提示词集？`,
      message:
        locked > 0
          ? `将永久删除 ${removable.length} 个提示词集（另有 ${locked} 个已关联生图任务被跳过），此操作不可撤销。`
          : `将永久删除 ${removable.length} 个提示词集，此操作不可撤销。`,
      confirmText: '确认删除',
      tone: 'danger',
      action: async () => {
        let ok = 0
        let failed = 0
        await flushPromptRunSnapshot()
        for (const run of removable) {
          try {
            if (run.id === activeRunIdRef.current) await flushPromptRunSnapshot()
            await deleteSopBatchSnapshot(run.id)
            ok += 1
          } catch {
            failed += 1
          }
        }
        const remainingRuns = recentRuns.filter((item) => !removable.some((run) => run.id === item.id))
        setRecentRuns(remainingRuns)
        clearRunSelection()
        if (ok > 0 && failed === 0) showToast(`已删除 ${ok} 个提示词集`, 'success')
        else if (ok > 0) showToast(`成功 ${ok} 个，失败 ${failed} 个`, 'info')
        else showToast('批量删除失败', 'error')
      },
    })
  }

  const updateActiveRunMetadata = (next: { title?: string; brief?: string }) => {
    const nextTitle = next.title ?? runTitle
    const nextBrief = next.brief ?? brief
    setRunTitle(nextTitle)
    setBrief(nextBrief)
    if (!activeRun) return
    const snapshot = buildPromptRunSnapshot(activeRun.id, prompts, sources, activeRun.status ?? 'ready', {
      title: nextTitle.trim() || undefined,
      brief: nextBrief.trim(),
    })
    if (snapshot) queuePromptRunSnapshot(snapshot)
  }

  const createPromptCollection = async () => {
    try {
      await flushPromptRunSnapshot()
      batchDefaultCollectionIdRef.current = undefined
      const now = Date.now()
      const runId = promptRunId()
      const sourceId = 'text-to-image'
      const snapshot: SopBatchSnapshot = {
        id: runId,
        title: '未命名提示词集',
        promptGroup: undefined,
        promptOrder: 0,
        batchId: '',
        workspaceTabId: targetWorkspaceTabId,
        createdAt: now,
        updatedAt: now,
        status: 'ready',
        pinned: false,
        batchIds: [],
        taskIds: [],
        sop: selectedSop
          ? {
              id: selectedSop.id,
              name: selectedSop.name,
              description: selectedSop.description,
              content: selectedSop.content,
            }
          : {
              id: 'prompt-library',
              name: '独立提示词集',
              description: '',
              content: '',
            },
        brief: '',
        referenceImageIds: [],
        promptCount: 0,
        imagesPerPrompt: targetImagesPerPrompt,
        prompts: [
          {
            id: promptItemId(sourceId),
            text: '',
            origin: 'manual',
            edited: false,
            sourceId,
            referenceImageIds: [],
            deleted: false,
          },
        ],
        params: { ...params, n: targetImagesPerPrompt, reference_mode: 'cycle' },
      }
      await putSopBatchSnapshot(snapshot)
      updateRecentRun(snapshot)
      await applyPromptRun(snapshot, '已新建提示词集，修改内容会自动保存')
      showToast('已新建提示词集', 'success')
    } catch {
      showToast('新建提示词集失败，请重试', 'error')
    }
  }

  const copyActivePrompts = async () => {
    const text = visiblePrompts
      .map((item) => item.promptText.trim())
      .filter(Boolean)
      .join('\n\n')
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      showToast(`已复制 ${visiblePrompts.length} 条提示词`, 'success')
    } catch {
      showToast('复制失败，请检查系统剪贴板权限', 'error')
    }
  }

  const copyPrompt = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showToast('已复制提示词', 'success')
    } catch {
      showToast('复制失败，请检查系统剪贴板权限', 'error')
    }
  }

  const updatePrompts = (updater: (current: PromptDraft[]) => PromptDraft[]) => {
    setPrompts((current) => {
      const next = updater(current)
      persistPromptRun(next)
      return next
    })
  }

  const loadPromptInputImages = async (items: PromptDraft[]) => {
    const imageIds = [
      ...new Set(
        items.flatMap((item) => {
          const source = allSources.find((candidate) => candidate.id === item.sourceId)
          return (item.referenceImageIds ?? (source?.kind === 'image' && source.imageId ? [source.imageId] : [])).slice(
            0,
            1,
          )
        }),
      ),
    ]
    const loaded = await Promise.all(
      imageIds.map(async (imageId): Promise<InputImage | null> => {
        const source = allSources.find((candidate) => candidate.imageId === imageId)
        const dataUrl = source?.dataUrl ?? (await ensureImageCached(imageId))
        return dataUrl ? { id: imageId, dataUrl } : null
      }),
    )
    if (loaded.some((image) => !image)) throw new Error('部分参考图已不存在，请移除后重试')
    return loaded.filter((image): image is InputImage => Boolean(image))
  }

  const loadSourceInputImage = async (source: SopPromptSource): Promise<InputImage | null> => {
    if (source.kind !== 'image' || !source.imageId) return null
    const dataUrl = source.dataUrl ?? (await ensureImageCached(source.imageId))
    if (!dataUrl) throw new Error(`参考图「${source.label}」已不存在，请移除后重试`)
    return { id: source.imageId, dataUrl }
  }

  const submitPromptList = async (itemsToSubmit = visiblePrompts) => {
    if (!selectedSop) return
    // 批次未启动过（例如手动建提示词后直接提交）时在此捕获；已由批次启动捕获的保持固定，不跟随中途切换
    if (batchDefaultCollectionIdRef.current === undefined) captureBatchDefaultCollectionId()
    const usablePrompts = itemsToSubmit.filter((item) => !item.deleted && item.promptText.trim())
    if (!usablePrompts.length) {
      setStatus('error')
      setStatusMessage('无法开始生图')
      setError('请先生成或手动新增至少一条提示词')
      return
    }
    const requestedImageCount = usablePrompts.length * targetImagesPerPrompt
    setStatus('submitting')
    setError('')
    setStatusMessage(`正在提交 ${usablePrompts.length} 条提示词，预计生成 ${requestedImageCount} 张图片`)
    const batchId = `sop-batch-${Date.now().toString(36)}`
    const snapshotId = activeRunIdRef.current
    let promptInputImages: InputImage[]
    let submittingSnapshot: SopBatchSnapshot | null = null
    try {
      promptInputImages = secondReferenceRef.current ? await loadPromptInputImages(usablePrompts) : []
      await flushPromptRunSnapshot()
      const existingSnapshot = await getSopBatchSnapshot(snapshotId)
      submittingSnapshot = buildPromptRunSnapshot(snapshotId, itemsToSubmit, sources, 'ready', {
        batchId,
        batchIds: [
          ...new Set([
            ...(existingSnapshot?.batchIds ?? (existingSnapshot?.batchId ? [existingSnapshot.batchId] : [])),
            batchId,
          ]),
        ],
        taskIds: existingSnapshot?.taskIds ?? [],
        pinned: existingSnapshot?.pinned ?? false,
      })
      await flushPromptRunSnapshot(submittingSnapshot)
    } catch (cause) {
      setStatus('error')
      setStatusMessage('批次提交前检查失败')
      setError(cause instanceof Error ? cause.message : '参考图或批次快照保存失败')
      return
    }
    const promptInputImageById = new Map(promptInputImages.map((image) => [image.id, image]))
    const results = await Promise.allSettled(
      usablePrompts.map(async (item, index) => {
        const source = allSources.find((candidate) => candidate.id === item.sourceId)
        const itemReferenceImageIds = (
          item.referenceImageIds ?? (source?.kind === 'image' && source.imageId ? [source.imageId] : [])
        ).slice(0, 1)
        const itemInputImages = secondReferenceRef.current
          ? itemReferenceImageIds.flatMap((imageId) => {
              const image = promptInputImageById.get(imageId)
              return image ? [image] : []
            })
          : []
        return submitTaskWithData(
          {
            prompt: item.promptText.trim(),
            inputImages: itemInputImages,
            inputImageFolder: null,
            params: { ...params, n: targetImagesPerPrompt, reference_mode: 'cycle' },
            maskDraft: null,
            targetTabId: targetWorkspaceTabId,
            scheduledOutputPath: customOutputPath.trim() || undefined,
            scheduledOutputSubFolder: activeTab?.name,
            defaultCollectionId: batchDefaultCollectionIdRef.current,
            sopBatch: {
              batchId,
              snapshotId,
              sopId: selectedSop.id,
              sopName: selectedSop.name,
              promptId: item.id,
              promptIndex: index + 1,
              promptCount: usablePrompts.length,
              imagesPerPrompt: targetImagesPerPrompt,
            },
          },
          { silentSuccess: true },
        )
      }),
    )
    const submittedTaskIds = results.flatMap((result) =>
      result.status === 'fulfilled' && typeof result.value === 'string' && result.value ? [result.value] : [],
    )
    const successCount = results.filter((result) => result.status === 'fulfilled' && Boolean(result.value)).length
    const failCount = results.length - successCount
    if (submittingSnapshot) {
      const completedSnapshot: SopBatchSnapshot = {
        ...submittingSnapshot,
        status: successCount > 0 ? 'submitted' : 'failed',
        updatedAt: Date.now(),
        taskIds: [...new Set([...(submittingSnapshot.taskIds ?? []), ...submittedTaskIds])],
      }
      await flushPromptRunSnapshot(completedSnapshot)
      if (successCount > 0) setCurrentRunId(snapshotId, true)
    }
    if (successCount === 0) {
      setStatus('error')
      setStatusMessage('没有任务成功提交')
      setError('请检查图片 API 配置或输出参数后重试。')
      showToast('SOP 生图任务提交失败', 'error')
      return
    }
    setStatus(failCount > 0 ? 'error' : 'success')
    setStatusMessage(
      failCount > 0
        ? `部分提交完成：成功 ${successCount} 个，失败 ${failCount} 个`
        : `已并发提交 ${successCount} 个 SOP 生图任务`,
    )
    setError(failCount > 0 ? '失败项未创建任务卡，请检查 API 配置后重新提交。' : '')
    showToast(
      failCount > 0 ? `SOP 批量任务部分提交失败：${failCount} 个` : `已提交 ${successCount} 个 SOP 生图任务`,
      failCount > 0 ? 'error' : 'success',
    )
    if (failCount === 0) resetCompletedRun()
  }

  const generateForSources = async (retrySourceId?: string, freshRun = false, generateImagesForNewPrompts = false) => {
    if (!selectedSop) {
      setStatus('error')
      setStatusMessage('无法生成提示词')
      setError('请先选择一个 SOP')
      return
    }
    captureBatchDefaultCollectionId()
    activePromptGenerationModelRef.current = getSopPromptGenerationModelFromStore()
    const currentSources = freshRun ? [] : sources
    const currentPrompts = freshRun ? [] : prompts
    const preserveCurrentPrompts = !freshRun && Boolean(retrySourceId || generateImagesForNewPrompts)
    generationAbortRef.current?.abort(new DOMException('已开始新的提示词生成', 'AbortError'))
    const generationController = new AbortController()
    generationAbortRef.current = generationController
    generationPausedRef.current = false
    releasePauseWaiters()
    const allocations = allocateSopPromptCounts(targetCount, selectedSources.length)
    const retrySource = retrySourceId
      ? currentSources.find((entry) => entry.source.id === retrySourceId)?.source
      : undefined
    const isRetryTarget = (source: SopPromptSource) =>
      !retrySourceId ||
      source.id === retrySourceId ||
      Boolean(source.imageId && retrySource?.imageId === source.imageId)
    const currentCounts = selectedSources.map(
      (source) =>
        currentPrompts.filter((item) => !item.deleted && item.promptText.trim() && promptBelongsToSource(item, source))
          .length,
    )
    let supplementBudget = missingCount
    const requestedCounts = allocations.map((allocatedCount, index) => {
      if (!generateImagesForNewPrompts) return allocatedCount
      const source = selectedSources[index]
      const currentCount = currentCounts[index] ?? 0
      if (!source || !isRetryTarget(source)) return currentCount
      const additionalCount = Math.min(Math.max(0, allocatedCount - currentCount), supplementBudget)
      supplementBudget -= additionalCount
      return currentCount + additionalCount
    })
    const plannedSources: SourceRun[] = selectedSources
      .map((source, index) => {
        const previous = currentSources.find(
          (entry) =>
            entry.source.id === source.id || Boolean(source.imageId && entry.source.imageId === source.imageId),
        )
        const requestedCount = requestedCounts[index] ?? 0
        const currentCount = currentCounts[index] ?? 0
        const shouldGenerate = isRetryTarget(source) && currentCount < requestedCount
        return {
          source,
          requestedCount,
          status: shouldGenerate
            ? 'running'
            : currentCount >= requestedCount
              ? 'completed'
              : (previous?.status ?? 'pending'),
          attempts: (previous?.attempts ?? 0) + (shouldGenerate ? 1 : 0),
          error: shouldGenerate ? undefined : previous?.error,
        }
      })
      .filter((source) => source.requestedCount > 0)
    const supplementPromptCount = plannedSources
      .filter((entry) => isRetryTarget(entry.source))
      .reduce(
        (total, entry) =>
          total +
          Math.max(
            0,
            entry.requestedCount -
              currentPrompts.filter(
                (item) => !item.deleted && item.promptText.trim() && promptBelongsToSource(item, entry.source),
              ).length,
          ),
        0,
      )
    setSources(plannedSources)
    setStatus('generating')
    setStatusMessage(
      generateImagesForNewPrompts
        ? `正在补充 ${supplementPromptCount} 条提示词并生成 ${supplementPromptCount * targetImagesPerPrompt} 张图片`
        : retrySourceId
          ? '正在重试当前参考图的提示词缺口'
          : selectedSources[0]?.kind === 'text'
            ? `正在生成 ${targetCount} 条文生图提示词`
            : `正在逐张参考 ${selectedSources.length} 张图片生成 ${targetCount} 条提示词`,
    )
    setError('')
    persistPromptRun(
      preserveCurrentPrompts ? currentPrompts : [],
      plannedSources,
      autoGenerate,
      'generating',
      preserveCurrentPrompts,
    )
    const existingPrompts = currentPrompts
      .filter((item) => !item.deleted && item.promptText.trim())
      .map((item) => item.promptText.trim())
    const nextPrompts = preserveCurrentPrompts ? [...currentPrompts] : []
    const nextSources = [...plannedSources]
    const progressiveDispatch = generateImagesForNewPrompts || (autoGenerateRef.current && !retrySourceId)
    const progressiveBatchId = progressiveDispatch ? `sop-batch-${Date.now().toString(36)}` : ''
    const progressiveSnapshotId = activeRunIdRef.current
    const previousProgressiveSnapshot = recentRuns.find((item) => item.id === progressiveSnapshotId)
    const previousProgressiveBatchIds =
      previousProgressiveSnapshot?.batchIds ??
      (previousProgressiveSnapshot?.batchId ? [previousProgressiveSnapshot.batchId] : [])
    const previousProgressiveTaskIds = previousProgressiveSnapshot?.taskIds ?? []
    const progressiveTaskIds: string[] = []
    let progressiveSuccessCount = 0
    let progressiveFailureCount = 0
    let progressivePersistenceError = ''
    let generationCancelled = false

    const saveProgressiveSnapshot = async (runStatus: NonNullable<SopBatchSnapshot['status']>) => {
      if (!progressiveDispatch) return
      const snapshot = buildPromptRunSnapshot(progressiveSnapshotId, nextPrompts, nextSources, runStatus, {
        batchId: progressiveBatchId,
        batchIds: [...new Set([...previousProgressiveBatchIds, progressiveBatchId])],
        taskIds: [...new Set([...previousProgressiveTaskIds, ...progressiveTaskIds])],
      })
      if (!snapshot) return
      try {
        await flushPromptRunSnapshot(snapshot)
      } catch (cause) {
        progressivePersistenceError = cause instanceof Error ? cause.message : '运行记录保存失败'
      }
    }

    for (const sourceRun of plannedSources.filter((entry) => isRetryTarget(entry.source))) {
      const sourceIndex = nextSources.findIndex((entry) => entry.source.id === sourceRun.source.id)
      const existingForSource = nextPrompts.filter(
        (item) => !item.deleted && item.promptText.trim() && promptBelongsToSource(item, sourceRun.source),
      )
      const deficit = Math.max(0, sourceRun.requestedCount - existingForSource.length)
      if (deficit === 0) {
        nextSources[sourceIndex] = { ...nextSources[sourceIndex], status: 'completed', error: undefined }
        continue
      }
      try {
        const sourceImage = await loadSourceInputImage(sourceRun.source)
        const referenceImageIds = sourceImage ? [sourceImage.id] : []
        const generationInputImages =
          progressiveDispatch && secondReferenceRef.current && sourceImage ? [sourceImage] : []
        const sourcePosition = plannedSources.findIndex((entry) => entry.source.id === sourceRun.source.id) + 1
        const generatedBeforeRequest = nextPrompts.filter(
          (item) => !item.deleted && item.promptText.trim() && promptBelongsToSource(item, sourceRun.source),
        ).length
        const isVariablePromptSop = selectedSop.executionMode === 'variable-prompt'
        const generationOptions: NonNullable<Parameters<typeof generatePromptsFromSopStore>[3]> = {
          context: {
            sourceLabel: sourceImage ? sourceRun.source.label : undefined,
            sourceIndex: sourceImage ? sourcePosition : undefined,
            sourceCount: sourceImage ? plannedSources.length : undefined,
            totalPromptCount: targetCount,
          },
          referenceImages: sourceImage ? [{ name: sourceRun.source.label, dataUrl: sourceImage.dataUrl }] : undefined,
          exact: false,
          existingPrompts: [...existingPrompts, ...nextPrompts.map((item) => item.promptText.trim()).filter(Boolean)],
          // 变量提示词模式是本地展开，一次生成全部再逐条提交；AI 逐条模式才用 maxBatchSize=1 渐进生成
          maxBatchSize: !isVariablePromptSop && progressiveDispatch ? 1 : undefined,
          beforeBatch: waitWhileGenerationPaused,
          signal: generationController.signal,
          onBatch: async (batchPrompts) => {
            for (const prompt of batchPrompts) {
              if (!componentActiveRef.current || generationController.signal.aborted) {
                throw generationController.signal.reason instanceof Error
                  ? generationController.signal.reason
                  : new DOMException('提示词生成已取消', 'AbortError')
              }
              const item: PromptDraft = {
                id: promptItemId(sourceRun.source.id),
                sourceId: sourceRun.source.id,
                referenceImageIds,
                promptText: prompt,
                origin: 'ai',
              }
              nextPrompts.push(item)
              setPrompts([...nextPrompts])
              const promptIndex = nextPrompts.filter((entry) => !entry.deleted && entry.promptText.trim()).length
              if (progressiveDispatch) {
                setStatusMessage(`已生成提示词 ${promptIndex}/${targetCount}，正在发送第 ${promptIndex} 条生图任务`)
                await saveProgressiveSnapshot('generating')
                let dispatched = false
                try {
                  const taskId = await submitTaskWithData(
                    {
                      prompt: item.promptText.trim(),
                      inputImages: generationInputImages,
                      inputImageFolder: null,
                      params: { ...params, n: targetImagesPerPrompt, reference_mode: 'cycle' },
                      maskDraft: null,
                      targetTabId: targetWorkspaceTabId,
                      scheduledOutputPath: customOutputPath.trim() || undefined,
                      scheduledOutputSubFolder: activeTab?.name,
                      defaultCollectionId: batchDefaultCollectionIdRef.current,
                      sopBatch: {
                        batchId: progressiveBatchId,
                        snapshotId: progressiveSnapshotId,
                        sopId: selectedSop.id,
                        sopName: selectedSop.name,
                        promptId: item.id,
                        promptIndex,
                        promptCount: targetCount,
                        imagesPerPrompt: targetImagesPerPrompt,
                      },
                    },
                    { silentSuccess: true },
                  )
                  if (typeof taskId === 'string' && taskId) {
                    progressiveTaskIds.push(taskId)
                    progressiveSuccessCount += 1
                    dispatched = true
                  } else {
                    progressiveFailureCount += 1
                  }
                } catch {
                  progressiveFailureCount += 1
                }
                if (!componentActiveRef.current || generationController.signal.aborted) {
                  throw generationController.signal.reason instanceof Error
                    ? generationController.signal.reason
                    : new DOMException('提示词生成已取消', 'AbortError')
                }
                await saveProgressiveSnapshot('generating')
                setStatusMessage(
                  generationPausedRef.current
                    ? `提示词生成已暂停，第 ${promptIndex} 条${dispatched ? '已发送' : '发送失败'}`
                    : dispatched
                      ? `第 ${promptIndex} 条已发送，继续生成下一条提示词`
                      : `第 ${promptIndex} 条发送失败，继续生成下一条提示词`,
                )
              } else {
                persistPromptRun([...nextPrompts], nextSources, autoGenerate, 'generating')
                setStatusMessage(
                  generationPausedRef.current
                    ? `提示词生成已暂停，当前可用 ${promptIndex}/${targetCount} 条`
                    : `正在生成提示词 ${promptIndex}/${targetCount}`,
                )
              }
            }
          },
          onProgress: (completed, total) => {
            if (!progressiveDispatch) {
              const completedCount = Math.min(
                nextPrompts.filter((item) => !item.deleted && item.promptText.trim()).length,
                targetCount,
              )
              const totalCount = Math.min(completedCount + Math.max(0, total - completed), targetCount)
              setStatusMessage(
                generationPausedRef.current
                  ? `提示词生成已暂停，当前可用 ${completedCount}/${totalCount} 条`
                  : `正在参考 ${sourceRun.source.label} 生成提示词 ${completedCount}/${totalCount}`,
              )
            }
          },
        }
        const generated = isVariablePromptSop
          ? await generateVariablePromptsFromSopStore(selectedSop, deficit, brief, generationOptions)
          : await generatePromptsFromSopStore(selectedSop, deficit, brief, generationOptions)
        if (generationController.signal.aborted) {
          throw generationController.signal.reason instanceof Error
            ? generationController.signal.reason
            : new DOMException('提示词生成已取消', 'AbortError')
        }
        const candidates = normalizeSopPromptCandidates(generated, deficit, [
          ...existingPrompts,
          ...nextPrompts.map((item) => item.promptText),
        ])
        nextPrompts.push(
          ...candidates.map((prompt) => ({
            id: promptItemId(sourceRun.source.id),
            sourceId: sourceRun.source.id,
            referenceImageIds,
            promptText: prompt,
            origin: 'ai' as const,
          })),
        )
        const generatedCount =
          nextPrompts.filter(
            (item) => !item.deleted && item.promptText.trim() && promptBelongsToSource(item, sourceRun.source),
          ).length - generatedBeforeRequest
        nextSources[sourceIndex] = {
          ...nextSources[sourceIndex],
          status: generatedCount >= deficit ? 'completed' : 'partial',
          error: generatedCount >= deficit ? undefined : `缺少 ${deficit - generatedCount} 条`,
        }
      } catch (cause) {
        if (generationController.signal.aborted || isAbortError(cause)) {
          generationCancelled = true
          const generatedCount =
            nextPrompts.filter(
              (item) => !item.deleted && item.promptText.trim() && promptBelongsToSource(item, sourceRun.source),
            ).length - existingForSource.length
          nextSources[sourceIndex] = {
            ...nextSources[sourceIndex],
            status: generatedCount > 0 ? 'partial' : 'pending',
            error: undefined,
          }
          break
        } else {
          nextSources[sourceIndex] = {
            ...nextSources[sourceIndex],
            status: 'failed',
            error: cause instanceof Error ? cause.message : '提示词生成失败',
          }
        }
      }
    }

    if (!componentActiveRef.current) return
    if (generationCancelled) {
      for (let index = 0; index < nextSources.length; index += 1) {
        if (nextSources[index].status === 'running') {
          nextSources[index] = { ...nextSources[index], status: 'pending', error: undefined }
        }
      }
    }
    setPrompts(nextPrompts)
    setSources(nextSources)
    const available = nextPrompts.filter((item) => !item.deleted && item.promptText.trim()).length
    const failed = nextSources.filter((item) => item.status === 'failed').length
    const missing = Math.max(0, targetCount - available)
    if (generationAbortRef.current === generationController) generationAbortRef.current = null
    generationPausedRef.current = false
    releasePauseWaiters()
    if (generationCancelled) {
      if (progressiveDispatch && progressiveSuccessCount > 0) {
        await saveProgressiveSnapshot('submitted')
        setCurrentRunId(progressiveSnapshotId, true)
        showToast(`已取消后续提示词生成，已发送 ${progressiveSuccessCount} 个生图任务`, 'info')
        resetCompletedRun()
      } else {
        persistPromptRun(nextPrompts, nextSources, autoGenerate, 'ready', preserveCurrentPrompts)
        await flushPromptRunSnapshot()
        setStatus(available > 0 ? 'ready' : 'idle')
        setStatusMessage(available > 0 ? `已取消提示词生成，保留当前 ${available} 条提示词` : '提示词生成已取消')
        setError('')
        showToast('已取消提示词生成', 'info')
      }
      return
    }
    if (progressiveDispatch) {
      const finalSnapshotStatus = progressiveSuccessCount > 0 ? 'submitted' : 'failed'
      await saveProgressiveSnapshot(finalSnapshotStatus)
      if (progressiveSuccessCount > 0) setCurrentRunId(progressiveSnapshotId, true)
      const hasProblems = Boolean(failed || missing || progressiveFailureCount || progressivePersistenceError)
      setStatus(hasProblems ? 'error' : 'success')
      setStatusMessage(
        hasProblems
          ? `逐条生成完成：已发送 ${progressiveSuccessCount} 条，发送失败 ${progressiveFailureCount} 条，提示词缺口 ${missing} 条`
          : `已逐条生成并发送 ${progressiveSuccessCount} 个 SOP 生图任务`,
      )
      setError(
        [
          failed ? '提示词生成中断，可重试缺口。' : '',
          progressiveFailureCount ? '部分提示词未创建生图任务。' : '',
          progressivePersistenceError ? `运行记录保存失败：${progressivePersistenceError}` : '',
        ]
          .filter(Boolean)
          .join(' '),
      )
      showToast(
        hasProblems
          ? `SOP 逐条生图部分完成：已发送 ${progressiveSuccessCount} 条`
          : `已逐条发送 ${progressiveSuccessCount} 个 SOP 生图任务`,
        hasProblems ? 'error' : 'success',
      )
      if (!hasProblems) resetCompletedRun()
    } else {
      persistPromptRun(nextPrompts, nextSources, autoGenerate, failed && available === 0 ? 'failed' : 'ready')
      await flushPromptRunSnapshot()
      setStatus(failed || missing ? 'error' : 'ready')
      setStatusMessage(
        missing
          ? `提示词列表部分完成：当前可用 ${available} 条，缺口 ${missing} 条`
          : `提示词列表已生成：当前可用 ${available} 条`,
      )
      setError(failed || missing ? '请选择“补充缺口”保留已有提示词，或“重新生成全部”创建一份新的完整列表。' : '')
    }
  }

  const generatePromptList = async (replaceConfirmed = false) => {
    if (running || !selectedSop) return
    const replacingCurrent = visiblePrompts.length > 0
    if (replacingCurrent && !replaceConfirmed) {
      setConfirmDialog({
        title: '生成新的提示词列表？',
        message: '当前提示词列表会保留在提示词库中，并创建一份新的列表。',
        confirmText: '继续生成',
        action: () => void generatePromptList(true),
      })
      return
    }
    if (replacingCurrent) {
      await flushPromptRunSnapshot()
      const nextRunId = promptRunId()
      setCurrentRunId(nextRunId)
      setSources([])
      setPrompts([])
      writeRunPointer(
        nextRunId,
        [],
        autoGenerateRef.current,
        brief,
        targetCount,
        targetImagesPerPrompt,
        secondReferenceRef.current,
      )
    }
    void generateForSources(undefined, replacingCurrent)
  }

  const supplementMissingPromptsAndGenerateImages = () => {
    if (running || !selectedSop || missingCount === 0) return
    void generateForSources(undefined, false, true)
  }

  const addManualPrompt = (sourceId: string) => {
    const source = allSources.find((candidate) => candidate.id === sourceId)
    const referenceImageIds = source?.kind === 'image' && source.imageId ? [source.imageId] : []
    updatePrompts((current) => [
      ...current,
      { id: promptItemId(sourceId), sourceId, referenceImageIds, promptText: '', origin: 'manual' },
    ])
    showToast('已新增提示词，可编辑内容', 'info')
  }

  const regeneratePrompt = async (item: PromptDraft, overwriteConfirmed = false) => {
    if (!selectedSop || running) return
    if ((item.edited || item.origin === 'manual') && !overwriteConfirmed) {
      setConfirmDialog({
        title: '覆盖当前提示词？',
        message: '重新生成会替换当前提示词内容，原内容无法恢复。',
        confirmText: '重新生成',
        tone: 'warning',
        action: () => void regeneratePrompt(item, true),
      })
      return
    }
    const generationController = new AbortController()
    generationAbortRef.current = generationController
    generationPausedRef.current = false
    setStatus('generating')
    setStatusMessage('正在重新生成这一条提示词')
    setError('')
    try {
      const source = allSources.find(
        (candidate) =>
          candidate.id === item.sourceId ||
          Boolean(candidate.imageId && candidate.imageId === item.referenceImageIds?.[0]),
      )
      const sourceImage = source
        ? await loadSourceInputImage(source)
        : item.referenceImageIds?.[0]
          ? await ensureImageCached(item.referenceImageIds[0]).then((dataUrl) =>
              dataUrl ? { id: item.referenceImageIds![0], dataUrl } : null,
            )
          : null
      const referenceImageIds = sourceImage ? [sourceImage.id] : []
      const existingPrompts = prompts
        .filter((entry) => entry.id !== item.id && !entry.deleted && entry.promptText.trim())
        .map((entry) => entry.promptText.trim())
      const generated = await generatePromptsFromSopStore(selectedSop, 1, brief, {
        context: {
          sourceLabel: sourceImage ? (source?.label ?? '参考图') : undefined,
          sourceIndex:
            sourceImage && source
              ? selectedSources.findIndex((candidate) => candidate.id === source.id) + 1
              : undefined,
          sourceCount: sourceImage ? selectedSources.length : undefined,
          totalPromptCount: targetCount,
        },
        referenceImages: sourceImage ? [{ name: source?.label ?? '参考图', dataUrl: sourceImage.dataUrl }] : undefined,
        exact: true,
        existingPrompts,
        beforeBatch: waitWhileGenerationPaused,
        signal: generationController.signal,
      })
      if (generationController.signal.aborted) return
      activePromptGenerationModelRef.current = getSopPromptGenerationModelFromStore()
      updatePrompts((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? { ...entry, referenceImageIds, promptText: generated[0] ?? entry.promptText, origin: 'ai', edited: false }
            : entry,
        ),
      )
      setStatus('ready')
      setStatusMessage(`已重新生成第 ${visiblePrompts.findIndex((entry) => entry.id === item.id) + 1} 条提示词`)
    } catch (cause) {
      setStatus('ready')
      if (generationController.signal.aborted || isAbortError(cause)) {
        setStatusMessage('已取消重新生成，保留原提示词')
        setError('')
      } else {
        setStatusMessage('单条提示词重新生成失败')
        setError(cause instanceof Error ? cause.message : '提示词重新生成失败')
      }
    } finally {
      if (generationAbortRef.current === generationController) generationAbortRef.current = null
      generationPausedRef.current = false
      releasePauseWaiters()
    }
  }

  useEffect(() => {
    onStatusChange?.({
      workspaceTabId: targetWorkspaceTabId,
      phase: status,
      message: statusMessage,
      promptCount: targetCount,
      availablePrompts: visiblePrompts.length,
      totalImages: totalImageCount,
      failed: sources.some((source) => source.status === 'failed') || status === 'error' ? 1 : 0,
    })
  }, [
    onStatusChange,
    sources,
    status,
    statusMessage,
    targetCount,
    targetWorkspaceTabId,
    totalImageCount,
    visiblePrompts.length,
  ])

  useEffect(() => {
    if (
      !restoreComplete ||
      !autoStart ||
      autoStartRef.current ||
      running ||
      !selectedSop ||
      initialGenerationCountsPending
    )
      return
    // 上一轮残留的提示词会阻断自动生成。此处必须显式通知宿主，
    // 否则静默运行时用户按下发送后会毫无反馈。
    if (visiblePrompts.length > 0) {
      autoStartRef.current = true
      onAutoStartConsumed?.()
      onNeedsAttention?.('existing-prompts')
      return
    }
    autoStartRef.current = true
    onAutoStartConsumed?.()
    void generateForSources()
  }, [
    autoStart,
    initialGenerationCountsPending,
    onAutoStartConsumed,
    onNeedsAttention,
    restoreComplete,
    running,
    selectedSop,
    visiblePrompts.length,
  ])

  useEffect(() => {
    if (!autoStart) autoStartRef.current = false
  }, [autoStart])

  useEffect(() => {
    if (!visible || !libraryContextMenu) return
    const closeContextMenu = () => setLibraryContextMenu(null)
    window.addEventListener('resize', closeContextMenu)
    window.addEventListener('blur', closeContextMenu)
    document.addEventListener('mousedown', closeContextMenu)
    return () => {
      window.removeEventListener('resize', closeContextMenu)
      window.removeEventListener('blur', closeContextMenu)
      document.removeEventListener('mousedown', closeContextMenu)
    }
  }, [libraryContextMenu, visible])

  useEffect(() => {
    if (!visible) return
    const handleLibraryShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.key !== 'Delete' || !selectedRunIds.size) return
      // Delete：删除选中的提示词集（多选时批量删除）
      event.preventDefault()
      if (selectedRunIds.size === 1) {
        const run = recentRuns.find((item) => item.id === [...selectedRunIds][0])
        if (run) deleteRun(run)
      } else {
        batchDeleteRuns()
      }
    }
    window.addEventListener('keydown', handleLibraryShortcut)
    return () => window.removeEventListener('keydown', handleLibraryShortcut)
  })

  useCloseOnEscape(visible && !previewSource, closeSafely)
  useCloseOnEscape(visible && Boolean(previewSource), () => setPreviewSource(null))
  usePreventBackgroundScroll(visible, modalRef)
  useDialogFocusTrap(visible && !previewSource, modalRef)
  useDialogFocusTrap(visible && Boolean(previewSource), previewRef)

  const renderPromptRunItem = (run: SopBatchSnapshot): ReactNode => {
    const available = run.prompts.filter((item) => !item.deleted && item.text.trim()).length
    const selected = run.id === activeRunId
    const imageCount = runImageSummaryById.get(run.id)?.count ?? 0
    const checked = selectedRunIds.has(run.id)
    const modelLabel = run.promptGenerationModel?.trim() || '模型未知'
    const runDate = new Date(getRunUpdatedAt(run)).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
    return (
      <div
        role="listitem"
        aria-selected={selected}
        aria-label={`提示词集 ${getPromptRunTitle(run)}`}
        key={run.id}
        data-run-id={run.id}
        onContextMenu={(event) => openLibraryContextMenu(event, run)}
        className={`group/run relative grid min-h-ds-control-lg grid-cols-[1.25rem_minmax(0,1fr)_1.75rem] items-center gap-1.5 rounded-lg pr-1 transition-colors ${checked || selected ? 'bg-ds-selection text-ds-selection-text' : 'text-ds-text hover:bg-ds-surface'}`}
      >
        <label
          data-no-marquee
          className="flex shrink-0 cursor-pointer items-center justify-center"
          onClick={(event) => event.stopPropagation()}
          aria-label={checked ? `取消选择 ${getPromptRunTitle(run)}` : `选择 ${getPromptRunTitle(run)}`}
        >
          <input
            type="checkbox"
            checked={checked}
            disabled={running}
            onClick={(event) => {
              if (event.shiftKey && lastClickedRunIdRef.current) {
                const ids = filteredRuns.map((item) => item.id)
                const from = ids.indexOf(lastClickedRunIdRef.current)
                const to = ids.indexOf(run.id)
                if (from !== -1 && to !== -1) {
                  const [start, end] = from < to ? [from, to] : [to, from]
                  event.preventDefault()
                  setSelectedRunIds((current) => {
                    const next = new Set(current)
                    ids.slice(start, end + 1).forEach((id) => next.add(id))
                    return next
                  })
                  return
                }
              }
              lastClickedRunIdRef.current = run.id
            }}
            onChange={(event) => {
              event.stopPropagation()
              toggleRunSelection(run.id)
            }}
            className="h-3.5 w-3.5 cursor-pointer rounded border-ds-border text-ds-primary accent-[hsl(var(--ds-color-primary))] focus-visible:ring-2 focus-visible:ring-ds-primary"
          />
        </label>
        <button
          type="button"
          onClick={(event) => {
            if (event.shiftKey || event.metaKey || event.ctrlKey) {
              lastClickedRunIdRef.current = run.id
              toggleRunSelection(run.id)
              return
            }
            void applyPromptRun(run, `已打开提示词集「${getPromptRunTitle(run)}」`)
          }}
          disabled={running || selected}
          aria-label={`查看提示词集 ${getPromptRunTitle(run)}`}
          className="flex min-w-0 items-center gap-2 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary disabled:cursor-default"
        >
          <BookOpenCheck size={14} className={`shrink-0 ${selected ? 'text-ds-primary' : 'text-ds-muted'}`} />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{getPromptRunTitle(run)}</span>
              <span
                title={`生成提示词的文本模型：${modelLabel}`}
                className="max-w-24 shrink-0 truncate rounded bg-ds-subtle px-1.5 py-0.5 text-xs font-medium text-ds-muted"
              >
                {modelLabel}
              </span>
            </span>
            <span className="mt-0.5 block truncate text-xs text-ds-muted">
              {available} 条 · {imageCount} 图 · {getRunStatusLabel(run)} · {runDate}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => void toggleRunPinned(run)}
          disabled={running}
          aria-label={run.pinned ? `取消收藏 ${getPromptRunTitle(run)}` : `收藏 ${getPromptRunTitle(run)}`}
          aria-pressed={Boolean(run.pinned)}
          className={`flex h-ds-control-sm w-ds-control-sm items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary disabled:opacity-40 ${run.pinned ? 'text-ds-warning' : 'text-ds-muted opacity-50 hover:bg-ds-subtle hover:text-ds-text group-hover/run:opacity-100'}`}
        >
          <Bookmark size={13} fill={run.pinned ? 'currentColor' : 'none'} />
        </button>
      </div>
    )
  }

  // 时间线列表：全部提示词集按生成/更新时间倒序平铺（最新在最上面），无层级结构
  const renderPromptTimeline = (runs: SopBatchSnapshot[]): ReactNode => runs.map((run) => renderPromptRunItem(run))

  if (!visible) return null

  const statusMetaClass =
    status === 'success'
      ? 'text-ds-success'
      : status === 'error'
        ? 'text-ds-danger'
        : status === 'paused'
          ? 'text-ds-warning'
          : running
            ? 'text-ds-primary'
            : 'text-ds-muted'
  const showRunToolbar = Boolean(selectedSop || running || error)
  const promptListReady = visiblePrompts.length > 0 && missingCount === 0

  return (
    <div
      className="ds-modal-layer fixed inset-0 flex items-center justify-center p-4 animate-overlay-in motion-reduce:animate-none"
      onMouseDown={(event) => {
        if (isModalBackdropEvent(event)) closeSafely()
      }}
    >
      <div className="ds-modal-scrim pointer-events-none absolute inset-0" />
      <div
        ref={modalRef}
        style={largeView ? LARGE_MODAL_SIZE_STYLE : { height: 'min(86vh, 820px)', maxWidth: '1024px' }}
        className="ds-modal-surface relative z-10 flex w-full flex-col overflow-hidden rounded-ds-xl border transition-[width,height,max-width] duration-200 ease-out animate-modal-in motion-reduce:animate-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gallery-sop-title"
      >
        <header className="flex items-center justify-between border-b border-ds-border px-5 py-4 sm:px-6">
          <div>
            <h2 id="gallery-sop-title" className="flex items-center gap-2 text-lg font-semibold">
              <BookOpenCheck size={20} className="text-ds-primary" />
              提示词管理
            </h2>
            <p className="mt-1 text-xs text-ds-muted">
              {selectedSop
                ? `当前 SOP：${selectedSop.name} · ${targetCount} 条提示词 · 预计 ${totalImageCount} 张图片`
                : '整理、编辑和复用已保存的提示词集。'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <LargeModalToggle largeView={largeView} dialogName="提示词管理" onToggle={toggleLargeView} />
            <button
              type="button"
              onClick={closeSafely}
              aria-label={
                status === 'paused'
                  ? '转入后台保持 SOP 提示词暂停'
                  : running
                    ? '转入后台继续生成 SOP 提示词'
                    : '关闭 SOP 提示词列表'
              }
              title={
                status === 'paused'
                  ? '关闭后保持暂停，可稍后继续'
                  : running
                    ? '关闭后将在后台继续生成'
                    : '关闭 SOP 提示词列表'
              }
              className="flex h-ds-control-lg w-ds-control-lg items-center justify-center rounded-ds-lg text-ds-muted transition-colors hover:bg-ds-subtle hover:text-ds-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col bg-ds-canvas p-4 sm:p-5">
          {showRunToolbar && (
            <div
              aria-live="polite"
              className={`mb-3 rounded-ds-lg border px-3 py-2.5 ${status === 'error' ? 'border-ds-danger/30 bg-ds-danger/10' : status === 'paused' ? 'border-ds-warning/30 bg-ds-warning/10' : running ? 'border-ds-primary/30 bg-ds-primary/10' : 'border-ds-border bg-ds-surface'}`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex min-w-[15rem] flex-1 items-center gap-2.5">
                  {status === 'paused' ? (
                    <Pause size={16} className="shrink-0 text-ds-warning" />
                  ) : running ? (
                    <LoaderCircle size={16} className="shrink-0 animate-spin text-ds-primary" />
                  ) : status === 'success' ? (
                    <CheckCircle2 size={16} className="shrink-0 text-ds-success" />
                  ) : status === 'error' ? (
                    <XCircle size={16} className="shrink-0 text-ds-danger" />
                  ) : (
                    <ImageIcon size={16} className="shrink-0 text-ds-muted" />
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium leading-5">{statusMessage}</p>
                    <p className={`text-xs leading-4 ${statusMetaClass}`}>
                      {selectedSop
                        ? `${visiblePrompts.length}/${targetCount} 条就绪 · 预计 ${totalImageCount} 张图片${missingCount ? ` · 还缺 ${missingCount} 条` : ''}`
                        : `已保存 ${recentRuns.length} 个提示词集`}
                    </p>
                  </div>
                </div>

                {selectedSop && (
                  <details className="group relative shrink-0">
                    <summary
                      aria-label="打开批次设置"
                      className="flex h-ds-control-sm cursor-pointer list-none items-center gap-1.5 rounded-lg border border-ds-border bg-ds-surface px-2.5 text-xs text-ds-muted transition-colors hover:bg-ds-subtle hover:text-ds-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary [&::-webkit-details-marker]:hidden"
                    >
                      <span>批次</span>
                      <span className="font-semibold text-ds-text">
                        {targetCount} × {targetImagesPerPrompt}
                      </span>
                      <ChevronDown size={12} className="transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="absolute right-0 top-full z-30 mt-2 w-72 rounded-ds-lg border border-ds-border bg-ds-surface p-3 shadow-ds-md">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-xs font-semibold">批次设置</span>
                        <span className="text-xs text-ds-muted">预计 {totalImageCount} 张</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="rounded-lg border border-ds-border p-2.5">
                          <span className="block text-xs text-ds-muted">提示词数量</span>
                          <input
                            type="number"
                            min={1}
                            value={targetCount}
                            onChange={(event) => event.target.value && setPromptCount(Number(event.target.value))}
                            disabled={running}
                            aria-label="SOP 提示词数量"
                            className="mt-1 w-full bg-transparent text-base font-semibold outline-none disabled:opacity-50"
                          />
                        </label>
                        <label className="rounded-lg border border-ds-border p-2.5">
                          <span className="block text-xs text-ds-muted">每条图片数</span>
                          <input
                            type="number"
                            min={1}
                            max={MAX_SOP_IMAGES_PER_PROMPT}
                            value={targetImagesPerPrompt}
                            onChange={(event) => event.target.value && setImagesPerPrompt(Number(event.target.value))}
                            disabled={running}
                            aria-label="每条提示词生成图片数"
                            className="mt-1 w-full bg-transparent text-base font-semibold outline-none disabled:opacity-50"
                          />
                        </label>
                      </div>
                      <label className="mt-2 flex h-ds-control-md items-center justify-between rounded-lg border border-ds-border px-2.5">
                        <span className="text-xs text-ds-muted">信息流审核规则</span>
                        <select
                          value={params.adNegativeRuleId}
                          onChange={(event) => setParams({ adNegativeRuleId: event.target.value })}
                          disabled={running}
                          aria-label="选择信息流审核规则"
                          className="max-w-36 cursor-pointer bg-transparent text-xs font-semibold outline-none disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {adNegativeRuleProfiles.map((rule) => (
                            <option key={rule.id} value={rule.id}>
                              {rule.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Switch
                        checked={autoGenerate}
                        onCheckedChange={toggleAutoGenerate}
                        disabled={running}
                        aria-label="每生成一条提示词立即发送生图"
                        label={<span className="text-xs">生成提示词后自动生图</span>}
                        className="mt-2 flex h-ds-control-md w-full justify-between rounded-lg px-2"
                      />
                      <Switch
                        checked={secondReference}
                        onCheckedChange={toggleSecondReference}
                        disabled={running}
                        aria-label="实际生图时再次使用输入区参考图"
                        title="开启后，参考图先用于生成提示词，并在实际生图时再次传入"
                        label={<span className="text-xs">生图时再次使用参考图</span>}
                        className="flex h-ds-control-md w-full justify-between rounded-lg px-2"
                      />
                    </div>
                  </details>
                )}

                <div className="flex shrink-0 items-center gap-2">
                  {promptGenerationActive && (
                    <>
                      <button
                        type="button"
                        onClick={status === 'paused' ? resumePromptGeneration : pausePromptGeneration}
                        aria-label={status === 'paused' ? '继续提示词生成' : '暂停提示词生成'}
                        className="flex h-ds-control-sm items-center gap-1.5 whitespace-nowrap rounded-lg border border-ds-warning/30 bg-ds-surface px-2.5 text-xs font-medium text-ds-warning transition-colors hover:bg-ds-warning/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-warning"
                      >
                        {status === 'paused' ? <Play size={13} /> : <Pause size={13} />}
                        {status === 'paused' ? '继续' : '暂停'}
                      </button>
                      <button
                        type="button"
                        onClick={cancelPromptGeneration}
                        aria-label="取消提示词生成"
                        className="flex h-ds-control-sm items-center gap-1.5 whitespace-nowrap rounded-lg border border-ds-danger/30 bg-ds-surface px-2.5 text-xs font-medium text-ds-danger transition-colors hover:bg-ds-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-danger"
                      >
                        <XCircle size={13} />
                        取消
                      </button>
                    </>
                  )}
                  {!promptGenerationActive && selectedSop && visiblePrompts.length > 0 && !promptListReady && (
                    <>
                      <button
                        type="button"
                        onClick={() => void generatePromptList(true)}
                        disabled={running}
                        aria-label={`重新生成全部 ${targetCount} 条 SOP 提示词`}
                        className="flex h-ds-control-sm items-center gap-1.5 whitespace-nowrap rounded-lg border border-ds-border bg-ds-surface px-2.5 text-xs font-medium text-ds-text transition-colors hover:border-ds-primary/30 hover:bg-ds-subtle hover:text-ds-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <RefreshCw size={13} />
                        重新生成全部
                      </button>
                      <button
                        type="button"
                        onClick={supplementMissingPromptsAndGenerateImages}
                        disabled={running}
                        aria-label={`补充缺口 ${missingCount} 条提示词并生成 ${missingCount * targetImagesPerPrompt} 张图片`}
                        className="flex h-ds-control-sm items-center gap-1.5 whitespace-nowrap rounded-lg bg-ds-primary px-3 text-xs font-medium text-ds-text-inverse transition-colors hover:bg-ds-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Sparkles size={13} />
                        补充缺口 {missingCount} 条
                      </button>
                    </>
                  )}
                  {!promptGenerationActive && selectedSop && promptListReady && (
                    <>
                      <button
                        type="button"
                        onClick={() => void generatePromptList(true)}
                        disabled={running}
                        aria-label={`再次生成 ${targetCount} 条 SOP 提示词`}
                        title="按当前 SOP 与参考图重新生成全部提示词，旧列表保留在提示词集中"
                        className="flex h-ds-control-sm items-center gap-1.5 whitespace-nowrap rounded-lg border border-ds-border bg-ds-surface px-2.5 text-xs font-medium text-ds-text transition-colors hover:border-ds-primary/30 hover:bg-ds-subtle hover:text-ds-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <RefreshCw size={13} />
                        再次生成提示词
                      </button>
                      <button
                        type="button"
                        aria-label={
                          activeRunSubmittedRef.current
                            ? '当前 SOP 生图任务已发送'
                            : `生成 ${visiblePrompts.length * targetImagesPerPrompt} 张图片`
                        }
                        onClick={() => void submitPromptList()}
                        disabled={running || activeRunSubmittedRef.current}
                        className="flex h-ds-control-sm items-center gap-1.5 whitespace-nowrap rounded-lg bg-ds-primary px-3 text-xs font-medium text-ds-text-inverse transition-colors hover:bg-ds-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary disabled:cursor-not-allowed disabled:bg-ds-subtle disabled:text-ds-muted"
                      >
                        <Send size={13} />
                        {activeRunSubmittedRef.current
                          ? '已发送'
                          : `生成 ${visiblePrompts.length * targetImagesPerPrompt} 张`}
                      </button>
                    </>
                  )}
                </div>
              </div>
              {error && (
                <p role="alert" className="mt-2 text-xs leading-5 text-ds-danger">
                  {error}
                </p>
              )}
              {selectedSop && totalImageCount >= SOP_HIGH_VOLUME_WARNING_THRESHOLD && (
                <p className="mt-2 text-xs leading-5 text-ds-warning">
                  本次预计生成 {totalImageCount} 张图片，可能产生较高费用，请确认数量后再提交。
                </p>
              )}
            </div>
          )}

          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-ds-lg border border-ds-border bg-ds-surface md:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col border-b border-ds-border bg-ds-subtle md:border-b-0 md:border-r">
              <div className="border-b border-ds-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">提示词集</h3>
                    <p className="mt-0.5 text-xs text-ds-muted">按生成时间倒序排列，最新的在最上面</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void createPromptCollection()}
                    disabled={running}
                    aria-label="新建提示词集"
                    className="flex h-ds-control-sm items-center gap-1.5 rounded-lg bg-ds-primary px-2.5 text-xs font-medium text-ds-text-inverse transition-colors hover:bg-ds-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Plus size={13} />
                    新建
                  </button>
                </div>
                <label className="mt-3 flex h-ds-control-md items-center gap-2 rounded-lg border border-ds-border bg-ds-surface px-2.5 focus-within:border-ds-primary focus-within:ring-2 focus-within:ring-ds-primary/20">
                  <Search size={14} className="shrink-0 text-ds-muted" />
                  <input
                    value={librarySearch}
                    onChange={(event) => setLibrarySearch(event.target.value)}
                    aria-label="搜索提示词集"
                    placeholder="搜索提示词名称或内容"
                    className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-ds-muted"
                  />
                </label>
                <div className="mt-2 flex items-center gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setFavoritesOnly((current) => !current)}
                    aria-pressed={favoritesOnly}
                    className={`flex h-ds-control-sm items-center gap-1.5 rounded-lg px-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary ${favoritesOnly ? 'bg-ds-warning/10 text-ds-warning' : 'text-ds-muted hover:bg-ds-surface hover:text-ds-text'}`}
                  >
                    <Bookmark size={12} fill={favoritesOnly ? 'currentColor' : 'none'} />
                    收藏
                  </button>
                  <span className="ml-auto shrink-0 text-ds-muted">{filteredRuns.length} 项</span>
                </div>
              </div>
              {selectedRunIds.size > 0 && (
                <div className="border-b border-ds-border bg-ds-selection px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 shrink-0 rounded-md bg-ds-surface px-1.5 py-0.5 text-xs font-semibold text-ds-selection-text">
                      已选 {selectedRunIds.size} 项
                    </span>
                    <button
                      type="button"
                      onClick={selectAllFilteredRuns}
                      disabled={running}
                      className="flex h-ds-control-sm items-center rounded-lg px-2 text-xs text-ds-muted transition-colors hover:bg-ds-surface hover:text-ds-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary disabled:opacity-40"
                    >
                      全选
                    </button>
                    <button
                      type="button"
                      onClick={invertRunSelection}
                      disabled={running}
                      className="flex h-ds-control-sm items-center rounded-lg px-2 text-xs text-ds-muted transition-colors hover:bg-ds-surface hover:text-ds-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary disabled:opacity-40"
                    >
                      反选
                    </button>
                    <span className="mx-0.5 h-4 w-px bg-ds-border" />
                    <button
                      type="button"
                      onClick={batchDeleteRuns}
                      disabled={running}
                      className="flex h-ds-control-sm items-center gap-1 rounded-lg bg-ds-surface px-2 text-xs text-ds-danger transition-colors hover:bg-ds-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-danger disabled:opacity-40"
                    >
                      <Trash2 size={12} />
                      删除
                    </button>
                    <button
                      type="button"
                      onClick={clearRunSelection}
                      className="ml-auto flex h-ds-control-sm items-center gap-1 rounded-lg px-2 text-xs text-ds-muted transition-colors hover:bg-ds-surface hover:text-ds-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary"
                    >
                      <X size={12} />
                      取消选择
                    </button>
                  </div>
                </div>
              )}
              <div
                ref={listRef}
                role="list"
                aria-label="提示词集时间线"
                data-drag-select-surface
                className="relative min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2"
              >
                {renderPromptTimeline(filteredRuns)}
                {filteredRuns.length === 0 && (
                  <div className="flex min-h-40 flex-col items-center justify-center px-4 text-center text-ds-muted">
                    <BookOpenCheck size={22} />
                    <p className="mt-2 text-xs font-medium">
                      {recentRuns.length ? '没有匹配的提示词集' : '还没有提示词集'}
                    </p>
                    <p className="mt-1 text-xs leading-5">
                      {recentRuns.length ? '尝试其他关键词或关闭收藏筛选。' : '新建一个，或从 SOP 生成后自动保存。'}
                    </p>
                  </div>
                )}
                {selectionBox && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute z-10 border border-ds-selection-border bg-ds-selection/60"
                    style={getMarqueeBoxStyle(selectionBox, listRef.current)}
                  />
                )}
              </div>
            </aside>

            <section className="flex min-h-0 min-w-0 flex-col">
              {activeRun || sources.length > 0 ? (
                <>
                  <div className="border-b border-ds-border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-[16rem] flex-1">
                        <input
                          value={runTitle}
                          onChange={(event) => updateActiveRunMetadata({ title: event.target.value })}
                          disabled={running}
                          aria-label="提示词集名称"
                          placeholder="未命名提示词集"
                          className="w-full border-0 bg-transparent p-0 text-base font-semibold outline-none placeholder:text-ds-muted focus:ring-0 disabled:opacity-60"
                        />
                        <p className="mt-1 text-xs text-ds-muted">
                          {activeRun?.sop.name ?? selectedSop?.name ?? '独立提示词集'} · {visiblePrompts.length}{' '}
                          条提示词 · {activeRun ? getRunStatusLabel(activeRun) : '编辑中'}
                          {activeRun?.promptGenerationModel ? ` · 文本模型 ${activeRun.promptGenerationModel}` : ''}
                          {activeRun ? ` · ${new Date(getRunUpdatedAt(activeRun)).toLocaleString()}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        {status === 'paused' ? (
                          <span className="mr-1 flex items-center gap-1.5 rounded-lg bg-ds-warning/10 px-2 py-1.5 text-xs text-ds-warning">
                            <Pause size={13} />
                            已暂停
                          </span>
                        ) : (
                          running && (
                            <span className="mr-1 flex items-center gap-1.5 rounded-lg bg-ds-primary/10 px-2 py-1.5 text-xs text-ds-primary">
                              <LoaderCircle size={13} className="animate-spin" />
                              处理中
                            </span>
                          )
                        )}
                        <button
                          type="button"
                          onClick={() => void toggleActiveRunPinned()}
                          disabled={running || !activeRun}
                          aria-label={activeRun?.pinned ? '取消收藏当前提示词集' : '收藏当前提示词集'}
                          aria-pressed={Boolean(activeRun?.pinned)}
                          title={activeRun?.pinned ? '取消收藏' : '收藏'}
                          className={`flex h-ds-control-md w-ds-control-md items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary disabled:opacity-40 ${activeRun?.pinned ? 'bg-ds-warning/10 text-ds-warning' : 'text-ds-muted hover:bg-ds-subtle hover:text-ds-text'}`}
                        >
                          <Bookmark size={15} fill={activeRun?.pinned ? 'currentColor' : 'none'} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void copyActivePrompts()}
                          disabled={running || visiblePrompts.length === 0}
                          aria-label="复制全部提示词"
                          title="复制全部"
                          className="flex h-ds-control-md w-ds-control-md items-center justify-center rounded-lg text-ds-muted transition-colors hover:bg-ds-subtle hover:text-ds-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <Copy size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={(event) => activeRun && openLibraryContextMenu(event, activeRun)}
                          disabled={running || !activeRun}
                          aria-label="更多提示词集操作"
                          title="更多操作"
                          className="flex h-ds-control-md w-ds-control-md items-center justify-center rounded-lg text-ds-muted transition-colors hover:bg-ds-subtle hover:text-ds-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <MoreHorizontal size={15} />
                        </button>
                      </div>
                    </div>
                    <details className="group mt-3 rounded-lg bg-ds-subtle">
                      <summary
                        aria-label="展开提示词集信息"
                        className="flex h-ds-control-md cursor-pointer list-none items-center gap-2 px-3 text-xs text-ds-muted outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ds-primary [&::-webkit-details-marker]:hidden"
                      >
                        <span className="font-medium text-ds-text">提示词集信息</span>
                        <span className="min-w-0 flex-1 truncate text-xs">
                          {activeRun?.promptGroup?.name ?? '根目录'}
                          {brief.trim() ? ' · 已填写说明' : ''}
                        </span>
                        <ChevronDown size={13} className="transition-transform group-open:rotate-180" />
                      </summary>
                      <div className="grid gap-3 border-t border-ds-border p-3 sm:grid-cols-[minmax(12rem,0.45fr)_minmax(0,1fr)]">
                        <label className="block text-xs font-medium text-ds-muted">
                          <span className="mb-1 block">说明</span>
                          <textarea
                            value={brief}
                            onChange={(event) => updateActiveRunMetadata({ brief: event.target.value })}
                            disabled={running}
                            rows={2}
                            aria-label="提示词集说明"
                            placeholder="记录用途、风格或限制"
                            className="min-h-ds-control-md w-full resize-y rounded-lg border border-ds-border bg-ds-surface px-3 py-2 text-xs leading-5 outline-none focus:border-ds-primary focus:ring-2 focus:ring-ds-primary/20 disabled:opacity-60"
                          />
                        </label>
                      </div>
                    </details>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    {sources.map((sourceRun) => {
                      const sourcePrompts = prompts.filter(
                        (item) => !item.deleted && promptBelongsToSource(item, sourceRun.source),
                      )
                      const sourceAvailable = sourcePrompts.filter((item) => item.promptText.trim()).length
                      const sourceMissing = Math.max(0, sourceRun.requestedCount - sourceAvailable)
                      const sourceSupplementCount = Math.min(sourceMissing, missingCount)
                      const canRetrySource = Boolean(
                        selectedSop && sourceSupplementCount > 0 && sourceRun.status !== 'running',
                      )
                      return (
                        <article
                          key={sourceRun.source.id}
                          className="mb-4 overflow-hidden rounded-ds-lg border border-ds-border"
                        >
                          <div className="flex flex-wrap items-center gap-3 border-b border-ds-border bg-ds-subtle px-3 py-2.5">
                            <div className="h-ds-control-lg w-ds-control-lg shrink-0 overflow-hidden rounded-lg">
                              <SourceThumb source={sourceRun.source} />
                            </div>
                            <div className="min-w-[12rem] flex-1">
                              <h4 className="truncate text-sm font-semibold">{sourceRun.source.label}</h4>
                              <p className="mt-0.5 text-xs text-ds-muted">
                                目标 {sourceRun.requestedCount} 条 · 已有 {sourceAvailable} 条
                                {sourceMissing > 0 ? ` · 待补 ${sourceMissing} 条` : ''}
                              </p>
                              {sourceRun.error && (
                                <p className="mt-1 text-xs leading-5 text-ds-danger">{sourceRun.error}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {sourceRun.status === 'running' && (
                                <span className="flex items-center gap-1.5 text-xs text-ds-primary">
                                  <LoaderCircle size={13} className="animate-spin" />
                                  生成中
                                </span>
                              )}
                              {canRetrySource && (
                                <button
                                  type="button"
                                  onClick={() => void generateForSources(sourceRun.source.id, false, true)}
                                  disabled={running}
                                  aria-label={`为「${sourceRun.source.label}」补充 ${sourceSupplementCount} 条提示词并生成 ${sourceSupplementCount * targetImagesPerPrompt} 张图片`}
                                  className="flex h-ds-control-sm items-center gap-1.5 rounded-lg border border-ds-primary/30 bg-ds-surface px-2.5 text-xs font-medium text-ds-primary transition-colors hover:bg-ds-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  <Sparkles size={13} />
                                  补齐 {sourceSupplementCount} 条并生成 {sourceSupplementCount * targetImagesPerPrompt}{' '}
                                  张
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => addManualPrompt(sourceRun.source.id)}
                                disabled={running}
                                className="flex h-ds-control-sm items-center gap-1.5 rounded-lg border border-ds-border bg-ds-surface px-2.5 text-xs font-medium text-ds-text transition-colors hover:bg-ds-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <Plus size={13} />
                                新增提示词
                              </button>
                            </div>
                          </div>
                          <div className="space-y-3 p-3">
                            {sourcePrompts.map((item, index) => {
                              const referenceSources = getPromptReferenceSources(item)
                              const outputLinks = activePromptImageLinksByPromptId.get(item.id) ?? []
                              const primaryOutput = outputLinks[0]
                              const extraOutputs = outputLinks.slice(1)
                              return (
                                <div
                                  id={`prompt-output-${item.id}`}
                                  key={item.id}
                                  data-slot="item"
                                  className="group/prompt-item grid scroll-mt-4 grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-ds-lg border border-ds-border bg-ds-surface p-3 transition-colors hover:border-ds-primary/30"
                                >
                                  <section
                                    data-slot="item-media"
                                    aria-label={`第 ${index + 1} 条提示词的生成结果`}
                                    className="flex min-w-0 flex-col"
                                  >
                                    <div className="relative">
                                      {primaryOutput ? (
                                        <PromptOutputImage
                                          imageId={primaryOutput.imageId}
                                          index={index}
                                          onClick={() =>
                                            setPreviewSource({
                                              id: `output-${primaryOutput.imageId}`,
                                              label: '图片 1',
                                              kind: 'image',
                                              imageId: primaryOutput.imageId,
                                            })
                                          }
                                        />
                                      ) : (
                                        <div className="flex h-[140px] w-28 flex-col items-center justify-center gap-1.5 rounded-lg border border-ds-border bg-ds-subtle text-xs text-ds-muted">
                                          <ImageIcon size={18} />
                                          <span>等待生成</span>
                                        </div>
                                      )}
                                      <span className="absolute left-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-md border border-ds-border bg-ds-surface px-1 text-xs font-semibold text-ds-text">
                                        {index + 1}
                                      </span>
                                      <span className="absolute bottom-1.5 right-1.5 rounded-md border border-ds-border bg-ds-surface px-1.5 py-0.5 text-xs tabular-nums text-ds-muted">
                                        {outputLinks.length} 张
                                      </span>
                                    </div>
                                    {extraOutputs.length > 0 && (
                                      <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-1">
                                        {extraOutputs.map((outputLink, extraIndex) => (
                                          <button
                                            key={outputLink.imageId}
                                            type="button"
                                            onClick={() =>
                                              setPreviewSource({
                                                id: `output-${outputLink.imageId}`,
                                                label: `图片 ${extraIndex + 2}`,
                                                kind: 'image',
                                                imageId: outputLink.imageId,
                                              })
                                            }
                                            aria-label={`查看第 ${index + 1} 条提示词的生成图片 ${extraIndex + 2}`}
                                            className="h-ds-control-sm w-ds-control-sm shrink-0 overflow-hidden rounded-md border border-ds-border bg-ds-subtle transition-colors hover:border-ds-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary"
                                          >
                                            <OutputImageThumb
                                              imageId={outputLink.imageId}
                                              label={`提示词 ${index + 1} 的生成图片 ${extraIndex + 2}`}
                                            />
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </section>
                                  <div data-slot="item-content" className="min-h-0 min-w-0">
                                    <div
                                      data-slot="input-group"
                                      role="group"
                                      aria-label={`第 ${index + 1} 条提示词编辑器`}
                                      className="flex h-full flex-col overflow-hidden rounded-lg border border-ds-border bg-ds-subtle transition-colors focus-within:border-ds-primary focus-within:bg-ds-surface focus-within:ring-2 focus-within:ring-ds-primary/20"
                                    >
                                      <div
                                        data-slot="input-group-header"
                                        className="flex min-h-ds-control-md shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-ds-border px-3 py-2"
                                      >
                                        <span className="text-xs font-semibold text-ds-text">提示词</span>
                                        <span
                                          className={`flex items-center gap-1 text-xs ${item.origin === 'ai' ? 'text-ds-primary' : 'text-ds-info'}`}
                                        >
                                          {item.origin === 'ai' && <Sparkles size={11} />}
                                          {item.origin === 'ai' ? '智能生成' : '手动添加'}
                                        </span>
                                        <span className="ml-auto flex items-center gap-1 text-xs text-ds-muted">
                                          <CheckCircle2 size={11} />
                                          自动保存
                                        </span>
                                      </div>
                                      <AutoResizeTextarea
                                        value={item.promptText}
                                        onChange={(event) =>
                                          updatePrompts((current) =>
                                            current.map((entry) =>
                                              entry.id === item.id
                                                ? { ...entry, promptText: event.target.value, edited: true }
                                                : entry,
                                            ),
                                          )
                                        }
                                        disabled={running}
                                        aria-label={`第 ${index + 1} 条提示词`}
                                        className="min-h-20 w-full flex-1 resize-y border-0 bg-transparent px-3 py-2.5 text-sm leading-6 text-ds-text outline-none disabled:opacity-60"
                                      />
                                      <div
                                        data-slot="input-group-addon"
                                        aria-label={`第 ${index + 1} 条提示词的功能与状态`}
                                        className="flex min-h-ds-control-lg shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-ds-border px-2 py-1.5"
                                      >
                                        <span className="flex items-center gap-1 text-xs text-ds-muted">
                                          <CheckCircle2 size={11} />
                                          {item.edited ? '已编辑' : '原始内容'}
                                        </span>
                                        {referenceSources.length > 0 && (
                                          <>
                                            <span aria-hidden="true" className="h-3 w-px bg-ds-border" />
                                            <div className="flex min-w-0 items-center gap-1.5">
                                              <span className="shrink-0 text-xs text-ds-muted">
                                                参考 {referenceSources.length}
                                              </span>
                                              <div className="flex min-w-0 gap-1 overflow-x-auto">
                                                {referenceSources.map((referenceSource, referenceIndex) => (
                                                  <button
                                                    key={referenceSource.imageId ?? referenceSource.id}
                                                    type="button"
                                                    onClick={() => setPreviewSource(referenceSource)}
                                                    aria-label={`查看第 ${index + 1} 条提示词的参考图 ${referenceIndex + 1} 大图`}
                                                    title={`${referenceSource.label} · 点击查看大图`}
                                                    className="h-6 w-6 shrink-0 overflow-hidden rounded-md border border-ds-border bg-ds-surface transition-colors hover:border-ds-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary"
                                                  >
                                                    <SourceThumb source={referenceSource} />
                                                  </button>
                                                ))}
                                              </div>
                                            </div>
                                          </>
                                        )}
                                        <div
                                          data-slot="button-group"
                                          role="group"
                                          aria-label={`第 ${index + 1} 条提示词操作`}
                                          className="ml-auto flex overflow-hidden rounded-md border border-ds-border bg-ds-surface [&>button+button]:border-l [&>button+button]:border-ds-border"
                                        >
                                          <button
                                            type="button"
                                            onClick={() => void copyPrompt(item.promptText)}
                                            disabled={!item.promptText.trim()}
                                            aria-label={`复制第 ${index + 1} 条提示词`}
                                            title="复制提示词"
                                            className="flex h-ds-control-sm items-center justify-center gap-1.5 px-2.5 text-xs font-medium text-ds-muted transition-colors hover:bg-ds-primary/10 hover:text-ds-primary focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ds-primary disabled:cursor-not-allowed disabled:opacity-30"
                                          >
                                            <Copy size={12} />
                                            复制
                                          </button>
                                          {selectedSop && (
                                            <button
                                              type="button"
                                              onClick={() => void regeneratePrompt(item)}
                                              disabled={running}
                                              aria-label={`重新生成第 ${index + 1} 条提示词`}
                                              title="重新生成"
                                              className="flex h-ds-control-sm w-ds-control-sm items-center justify-center text-ds-muted transition-colors hover:bg-ds-primary/10 hover:text-ds-primary focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ds-primary disabled:cursor-not-allowed disabled:opacity-40"
                                            >
                                              <RefreshCw size={13} />
                                            </button>
                                          )}
                                          <button
                                            type="button"
                                            onClick={() => {
                                              updatePrompts((current) =>
                                                current.map((entry) =>
                                                  entry.id === item.id ? { ...entry, deleted: true } : entry,
                                                ),
                                              )
                                              showToast('已删除该条提示词', 'success')
                                            }}
                                            disabled={running}
                                            aria-label={`删除第 ${index + 1} 条提示词`}
                                            title="删除提示词"
                                            className="flex h-ds-control-sm w-ds-control-sm items-center justify-center text-ds-muted transition-colors hover:bg-ds-danger/10 hover:text-ds-danger focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ds-danger disabled:cursor-not-allowed disabled:opacity-40"
                                          >
                                            <Trash2 size={13} />
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                            {!sourcePrompts.length && (
                              <p className="rounded-lg border border-dashed border-ds-border p-4 text-center text-xs text-ds-muted">
                                当前没有提示词，可点击“新增提示词”手动添加。
                              </p>
                            )}
                          </div>
                        </article>
                      )
                    })}
                    {!sources.length && (
                      <div className="flex min-h-64 flex-col items-center justify-center rounded-ds-lg border border-dashed border-ds-border px-6 text-center text-ds-muted">
                        <BookOpenCheck size={26} />
                        <p className="mt-3 text-sm font-medium">这个提示词集还没有内容</p>
                        <p className="mt-1 max-w-md text-xs leading-5">
                          可以从 SOP 生成，也可以新建独立提示词集后手动整理。
                        </p>
                        <div className="mt-4 flex items-center gap-2">
                          {selectedSop ? (
                            <button
                              type="button"
                              onClick={() => void generatePromptList()}
                              disabled={running}
                              aria-label={`生成 ${targetCount} 条 SOP 提示词`}
                              className="flex h-ds-control-md items-center gap-2 rounded-lg bg-ds-primary px-4 text-xs font-medium text-ds-text-inverse transition-colors hover:bg-ds-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-ds-subtle disabled:text-ds-muted"
                            >
                              <Sparkles size={14} />
                              从当前 SOP 生成
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void createPromptCollection()}
                              disabled={running}
                              className="flex h-ds-control-md items-center gap-2 rounded-lg bg-ds-primary px-4 text-xs font-medium text-ds-text-inverse transition-colors hover:bg-ds-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary disabled:opacity-40"
                            >
                              <Plus size={14} />
                              新建提示词集
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex min-h-64 flex-1 flex-col items-center justify-center px-6 text-center text-ds-muted">
                  <BookOpenCheck size={28} />
                  <p className="mt-3 text-sm font-medium">
                    {filteredRuns.length ? '从左侧选择一个提示词集' : '还没有提示词集，建立你的第一个'}
                  </p>
                  <p className="mt-1 max-w-md text-xs leading-5">
                    {filteredRuns.length
                      ? '右侧会显示完整提示词、说明与可复用操作。'
                      : '新建提示词集会保存到列表顶部，或从 SOP 生成后自动保存。'}
                  </p>
                  {selectedSop ? (
                    <button
                      type="button"
                      onClick={() => void generatePromptList()}
                      disabled={running}
                      aria-label={`生成 ${targetCount} 条 SOP 提示词`}
                      className="mt-4 flex h-ds-control-md items-center gap-2 rounded-lg bg-ds-primary px-4 text-xs font-medium text-ds-text-inverse transition-colors hover:bg-ds-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary disabled:opacity-40"
                    >
                      <Sparkles size={14} />
                      从当前 SOP 生成
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void createPromptCollection()}
                      disabled={running}
                      className="mt-4 flex h-ds-control-md items-center gap-2 rounded-lg bg-ds-primary px-4 text-xs font-medium text-ds-text-inverse transition-colors hover:bg-ds-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary disabled:opacity-40"
                    >
                      <Plus size={14} />
                      新建提示词集
                    </button>
                  )}
                </div>
              )}
            </section>
          </div>
          {libraryContextMenu &&
            (() => {
              const contextRun = recentRuns.find((run) => run.id === libraryContextMenu.run.id)
              const menuItemClass =
                'flex h-ds-control-sm w-full items-center justify-between gap-4 rounded-md px-2.5 text-left text-xs text-ds-text transition-colors hover:bg-ds-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary disabled:cursor-not-allowed disabled:opacity-35'
              return (
                <div
                  role="menu"
                  aria-label="提示词库操作"
                  onMouseDown={(event) => event.stopPropagation()}
                  className="fixed z-[calc(var(--ds-z-modal)+20)] w-52 rounded-ds-lg border border-ds-border bg-ds-surface p-1.5 shadow-ds-md"
                  style={{
                    left: Math.max(8, Math.min(libraryContextMenu.x, window.innerWidth - 220)),
                    top: Math.max(8, Math.min(libraryContextMenu.y, window.innerHeight - 330)),
                  }}
                >
                  {contextRun && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setLibraryContextMenu(null)
                        void applyPromptRun(contextRun, `已打开提示词集「${getPromptRunTitle(contextRun)}」`)
                      }}
                      className={menuItemClass}
                    >
                      <span>打开提示词集</span>
                      <BookOpenCheck size={13} />
                    </button>
                  )}
                  {contextRun && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setLibraryContextMenu(null)
                        void duplicatePromptRun(contextRun)
                      }}
                      className={menuItemClass}
                    >
                      <span>创建副本</span>
                      <Copy size={13} />
                    </button>
                  )}
                  <div className="my-1 border-t border-ds-border" />
                  {contextRun && (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={Boolean(contextRun.taskIds?.length || contextRun.batchId)}
                      onClick={() => {
                        setLibraryContextMenu(null)
                        deleteRun(contextRun)
                      }}
                      className={`${menuItemClass} text-ds-danger hover:bg-ds-danger/10`}
                    >
                      <span>删除提示词集</span>
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              )
            })()}
        </div>
        {previewSource && (
          <div
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 p-4"
            onMouseDown={(event) => {
              if (isModalBackdropEvent(event)) setPreviewSource(null)
            }}
          >
            <div
              ref={previewRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="gallery-sop-reference-preview-title"
              className="flex h-[min(82vh,860px)] w-[min(92vw,1200px)] max-w-full flex-col overflow-hidden rounded-ds-xl bg-ds-scrim shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-white">
                <div className="min-w-0">
                  <h3 id="gallery-sop-reference-preview-title" className="truncate text-sm font-semibold">
                    {previewSource.label}
                  </h3>
                  <p className="mt-0.5 text-xs text-ds-muted">提示词对应参考图 · 原图适应窗口显示</p>
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewSource(null)}
                  aria-label="关闭参考图大图预览"
                  className="flex h-ds-control-lg w-ds-control-lg shrink-0 items-center justify-center rounded-ds-lg text-ds-text-subtle transition hover:bg-ds-surface/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="min-h-0 flex-1 p-4">
                <SourceThumb source={previewSource} fit="contain" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
