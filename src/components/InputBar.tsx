import {
  lazy,
  Suspense,
  useRef,
  useEffect,
  useCallback,
  useState,
  useMemo,
  useLayoutEffect,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  ALL_FAVORITES_COLLECTION_ID,
  deleteFavoriteCollection,
  getTaskFavoriteCollectionIds,
  useStore,
  submitTask,
  submitAgentMessage,
  stopAgentResponse,
  addImageFromFile,
  createInputImageFromFile,
  deleteImageIfUnreferenced,
  moveTasksToWorkspaceTab,
  removeMultipleTasks,
  getCachedImage,
  ensureImageCached,
  getActiveAgentRounds,
} from '../store'
import { DEFAULT_PARAMS, type TaskParams, type TaskRecord } from '../types'
import { getActiveApiProfile, getAgentApiProfile, normalizeSettings } from '../lib/apiProfiles'
import { DEFAULT_FAL_IMAGE_SIZE, getChangedParams, normalizeParamsForSettings } from '../lib/paramCompatibility'
import { MAX_DIRECT_INPUT_IMAGES, MAX_FOLDER_IMAGES } from '../lib/inputImageLimits'
import {
  convertVariableMentionAtVisibleOffsetToText,
  createVariableMention,
  escapePromptHtmlAttribute,
  escapePromptHtmlText,
  getAtImageQuery,
  getImageMentionLabel,
  getPromptIndexFromVisibleIndex,
  getPromptMentionParts,
  getSelectedImageMentionLabel,
  getSelectedTextMentionLabel,
  imageMentionMatches,
  insertImageMentionAtVisibleRange,
  insertTextMentionAtVisibleRange,
  isCursorInSelectedImageMention,
  moveVariableMentionInPrompt,
  resolveVariableMentionEntry,
  stripImageMentionMarkers,
} from '../lib/promptImageMentions'
import { calculateImageSize, formatImageRatio, inferSizeTier, normalizeImageSize } from '../lib/size'
import { parseVariablePrompt } from '../lib/variablePrompt'
import { createMaskPreviewDataUrl } from '../lib/canvasImage'
import { dismissAllTooltips } from '../lib/tooltipDismiss'
import { getSafeBoundingClientRect } from '../lib/domRect'
import { collectAgentRoundOutputImageSlots } from '../lib/agentImageReferences'
import { useTooltip } from '../hooks/useTooltip'
import {
  downloadImageEntries,
  downloadImageEntriesAsZip,
  formatExportFileTime,
  getGeneratedImageDownloadEntries,
} from '../lib/downloadImages'
import { selectLocalSaveDirectory, readDirectory, readFileBuffer, joinPath, checkPathExists } from '../lib/localSave'
import { storeImage } from '../lib/db'
import { computeContentHash } from '../lib/imageFingerprint'
import { assetCommands } from '../lib/assetCommands'
import Select from './Select'
import SizePickerModal from './SizePickerModal'
import ViewportTooltip from './ViewportTooltip'
import ModelSwitcher from './ModelSwitcher'
import { CloseIcon, FolderOpenIcon, TagsIcon } from './icons'
import {
  CheckIcon,
  FileImageIcon,
  ImageIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
} from '../design-system/icons'
import { getGallerySopPromptRunStorageKey, type GallerySopRunStatus } from '../features/strategy/adapters/gallerySopRun'
import { getSopRunCounts, getSopTotalImageCount, MAX_SOP_IMAGES_PER_PROMPT } from '../features/strategy/sopPromptBatch'
import { generateVariablePromptTwoPhase } from '../features/strategy/adapters/storeSopGeneration'
import {
  DEFAULT_DERIVE_COPY_MODE,
  DEFAULT_DERIVE_DIMENSION_POLICY,
  DERIVE_DIMENSIONS,
  buildCopyModeInstruction,
  buildDerivePolicyInstruction,
  copyModeToExcludeText,
  type DeriveCopyMode,
  type DeriveDimensionPolicy,
} from '../features/strategy/derivePolicy'
import { DerivePolicyModal } from './DerivePolicyModal'
import { useRequirementPrototype } from '../features/requirementPrototype/store'
import { normalizePromptVariableMarkers, replaceVariableNameInPrompt } from '../lib/promptVariableEditor'
import { buildVariableColorMap } from '../lib/promptVariableColors'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { Badge, Switch, useDialogFocusTrap } from '../design-system'
import { useAssetLibraryStore } from '../features/assetLibrary/store'
import { APPLY_SOP_TO_GALLERY_EVENT } from '../lib/assetCommands'

const AgentBatchPlannerModal = lazy(() => import('./AgentBatchPlannerModal'))
const GallerySopBatchModal = lazy(() => import('../features/strategy/adapters/GallerySopBatchModal'))
const GallerySopManagementCenter = lazy(() => import('../features/strategy/adapters/GallerySopManagementCenter'))
const AssetPickerModal = lazy(() => import('../features/assetLibrary/AssetPickerModal'))

function getMentionTagTextLength(el: Element) {
  return el.textContent?.length ?? 0
}

/** 把「标签页+文件夹」作用域键拆回标签页与文件夹两部分（无文件夹时 folderKey 为空）。 */
function splitGallerySopScopeKey(scopeKey: string): { tabId: string | null; folderKey: string } {
  const separator = scopeKey.indexOf('::')
  if (separator === -1) return { tabId: scopeKey === '__default__' ? null : scopeKey, folderKey: '' }
  return { tabId: scopeKey.slice(0, separator) || null, folderKey: scopeKey.slice(separator + 2) }
}

/** 画廊输入草稿按素材库文件夹隔离的持久化键。 */
function getGalleryInputDraftKey(folderKey: string) {
  return `doupao.gallery-input-draft.${folderKey || 'default'}`
}

function readGalleryInputDraft(folderKey: string): string | null {
  try {
    const raw = window.localStorage.getItem(getGalleryInputDraftKey(folderKey))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { prompt?: unknown }
    return typeof parsed.prompt === 'string' ? parsed.prompt : null
  } catch {
    return null
  }
}

function writeGalleryInputDraft(folderKey: string, prompt: string) {
  try {
    window.localStorage.setItem(getGalleryInputDraftKey(folderKey), JSON.stringify({ prompt }))
  } catch {
    /* 忽略本地存储不可用 */
  }
}

const QUICK_ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const

function getAspectRatioFromSize(size: string): string {
  const match = normalizeImageSize(size).match(/^(\d+)x(\d+)$/i)
  return match ? formatImageRatio(Number(match[1]), Number(match[2])).replace(/^≈/, '') : ''
}

function withAspectRatioPrompt(prompt: string, ratio: string): string {
  const withoutTrailingRatio = prompt
    .replace(/(?:[，,；;。\s]*画面比例为\s*:\s*(?:\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?)?\s*)$/u, '')
    .trimEnd()
  return `${withoutTrailingRatio}${withoutTrailingRatio ? '，' : ''}画面比例为:${ratio}`
}

function getNodeVisibleTextLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0
  if (
    node instanceof HTMLElement &&
    (node.classList.contains('mention-tag') || node.classList.contains('wildcard-var'))
  ) {
    return getMentionTagTextLength(node)
  }
  return Array.from(node.childNodes).reduce((sum, child) => sum + getNodeVisibleTextLength(child), 0)
}

function getVisibleOffsetBeforeNode(root: HTMLElement, target: Node): number {
  let offset = 0
  let found = false

  const walk = (node: Node) => {
    if (found) return
    if (node === target) {
      found = true
      return
    }
    if (node.nodeType === Node.TEXT_NODE) {
      offset += node.textContent?.length ?? 0
      return
    }
    if (
      node instanceof HTMLElement &&
      (node.classList.contains('mention-tag') || node.classList.contains('wildcard-var'))
    ) {
      offset += getMentionTagTextLength(node)
      return
    }
    node.childNodes.forEach(walk)
  }

  root.childNodes.forEach(walk)
  return offset
}

function getMentionTagForBoundary(root: HTMLElement, container: Node) {
  const el = container.nodeType === Node.ELEMENT_NODE ? (container as Element) : container.parentElement
  const tag = el?.closest('.mention-tag, .wildcard-var')
  return tag && root.contains(tag) ? tag : null
}

function getBoundaryOffsetInMention(tag: Element, container: Node, offset: number) {
  try {
    const range = document.createRange()
    range.selectNodeContents(tag)
    range.setEnd(container, offset)
    return range.toString().length
  } catch {
    return getMentionTagTextLength(tag)
  }
}

function getContentEditableBoundaryOffset(
  root: HTMLElement,
  container: Node,
  offset: number,
  edge: 'start' | 'end',
  collapsed: boolean,
) {
  if (container === root) {
    let visibleOffset = 0
    for (const child of Array.from(root.childNodes).slice(0, offset)) {
      visibleOffset += getNodeVisibleTextLength(child)
    }
    return visibleOffset
  }

  if (!root.contains(container)) {
    // 处理输入框外的选区边界（如 Ctrl+A）
    const position = root.compareDocumentPosition(container)
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 0
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return root.textContent?.length ?? 0

    // 根据父容器偏移量判断在输入框前后
    if (container.contains(root)) {
      const children = Array.from(container.childNodes)
      const rootIndex = children.indexOf(root)
      return offset <= rootIndex ? 0 : (root.textContent?.length ?? 0)
    }
    return edge === 'start' ? 0 : (root.textContent?.length ?? 0)
  }

  const mentionTag = getMentionTagForBoundary(root, container)
  if (mentionTag) {
    const mentionStart = getVisibleOffsetBeforeNode(root, mentionTag)
    const mentionLength = getMentionTagTextLength(mentionTag)
    if (!collapsed) return edge === 'start' ? mentionStart : mentionStart + mentionLength
    const mentionOffset = getBoundaryOffsetInMention(mentionTag, container, offset)
    return mentionStart + (mentionOffset < mentionLength / 2 ? 0 : mentionLength)
  }

  if (container.nodeType === Node.TEXT_NODE) {
    return getVisibleOffsetBeforeNode(root, container) + offset
  }

  const element = container.nodeType === Node.ELEMENT_NODE ? (container as Element) : null
  if (element) {
    let visibleOffset = element === root ? 0 : getVisibleOffsetBeforeNode(root, element)
    for (const child of Array.from(element.childNodes).slice(0, offset)) {
      visibleOffset += getNodeVisibleTextLength(child)
    }
    return visibleOffset
  }

  return root.textContent?.length ?? 0
}

/** 获取 contentEditable 中光标的纯文本偏移量 */
function getContentEditableCursor(el: HTMLElement): number {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return el.textContent?.length ?? 0
  try {
    const range = sel.getRangeAt(0)
    if (!el.contains(range.startContainer)) return el.textContent?.length ?? 0
    return getContentEditableBoundaryOffset(el, range.startContainer, range.startOffset, 'start', range.collapsed)
  } catch {
    return el.textContent?.length ?? 0
  }
}

function getContentEditableSelection(el: HTMLElement): { start: number; end: number } {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) {
    const end = el.textContent?.length ?? 0
    return { start: end, end }
  }
  try {
    const range = sel.getRangeAt(0)
    const start = getContentEditableBoundaryOffset(
      el,
      range.startContainer,
      range.startOffset,
      'start',
      range.collapsed,
    )
    const end = range.collapsed
      ? start
      : getContentEditableBoundaryOffset(el, range.endContainer, range.endOffset, 'end', false)
    return { start, end }
  } catch {
    const end = el.textContent?.length ?? 0
    return { start: end, end }
  }
}

function getContentEditableOffsetFromPoint(el: HTMLElement, x: number, y: number): number {
  const doc = el.ownerDocument as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }

  const range = doc.caretRangeFromPoint?.(x, y)
  if (range) {
    return getContentEditableBoundaryOffset(el, range.startContainer, range.startOffset, 'start', true)
  }

  const position = doc.caretPositionFromPoint?.(x, y)
  if (position) {
    return getContentEditableBoundaryOffset(el, position.offsetNode, position.offset, 'start', true)
  }

  return stripImageMentionMarkers(getContentEditablePlainText(el)).length
}

function getContentEditablePlainText(el: HTMLElement): string {
  let text = ''
  const appendNodeText = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? ''
      return
    }
    if (node instanceof HTMLElement && node.classList.contains('mention-tag')) {
      text += node.dataset.mentionText ?? node.textContent ?? ''
      return
    }
    if (node instanceof HTMLElement && node.classList.contains('wildcard-var')) {
      text += createVariableMention(node.dataset.varName ?? node.textContent ?? '', node.dataset.entryId)
      return
    }
    node.childNodes.forEach(appendNodeText)
  }
  el.childNodes.forEach(appendNodeText)
  return text.replace(/\r\n?/g, '\n')
}

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function getMentionTagHtml(text: string) {
  return `<span contenteditable="false" class="mention-tag" data-mention-text="${escapeHtml(getSelectedTextMentionLabel(text))}">${escapeHtml(text)}</span>`
}

function syncMentionTagSelection(el: HTMLElement) {
  const tags = el.querySelectorAll<HTMLElement>('.mention-tag, .wildcard-var')
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) {
    tags.forEach((tag) => tag.classList.remove('selected'))
    return
  }

  const range = sel.getRangeAt(0)
  if (range.collapsed) {
    tags.forEach((tag) => tag.classList.remove('selected'))
    return
  }

  tags.forEach((tag) => {
    let isSelected = false
    try {
      isSelected = range.intersectsNode(tag)
    } catch {
      isSelected = false
    }
    tag.classList.toggle('selected', isSelected)
  })
}

/** 在 contentEditable 中设置光标到指定纯文本偏移量 */
function setContentEditableCursor(el: HTMLElement, offset: number) {
  const sel = window.getSelection()
  if (!sel) return
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let node: Text | null = null
  while (walker.nextNode()) {
    node = walker.currentNode as Text
    const mentionTag = node.parentElement?.closest('.mention-tag, .wildcard-var')
    if (mentionTag) {
      if (remaining <= node.length) {
        const range = document.createRange()
        if (remaining < node.length / 2) {
          range.setStartBefore(mentionTag)
        } else {
          range.setStartAfter(mentionTag)
        }
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
        return
      }
      remaining -= node.length
      continue
    }
    if (remaining <= node.length) {
      const range = document.createRange()
      range.setStart(node, remaining)
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
      return
    }
    remaining -= node.length
  }
  // 偏移超出则放至末尾
  if (node) {
    const range = document.createRange()
    range.setStart(node, node.length)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
  }
}

function setContentEditableSelection(el: HTMLElement, start: number, end: number) {
  const sel = window.getSelection()
  if (!sel) return

  type Boundary =
    | { type: 'offset'; node: Node; offset: number }
    | { type: 'before'; element: Element }
    | { type: 'after'; element: Element }

  const findBoundary = (targetOffset: number, edge: 'start' | 'end'): Boundary => {
    let remaining = targetOffset
    let lastBoundary: Boundary = { type: 'offset', node: el, offset: 0 }

    const walk = (current: Node): Boundary | null => {
      if (current.nodeType === Node.TEXT_NODE) {
        const node = current as Text
        lastBoundary = { type: 'offset', node, offset: node.length }
        if (remaining <= node.length) return { type: 'offset', node, offset: remaining }
        remaining -= node.length
        return null
      }

      if (
        current instanceof HTMLElement &&
        (current.classList.contains('mention-tag') || current.classList.contains('wildcard-var'))
      ) {
        const length = getMentionTagTextLength(current)
        if (remaining <= 0) return { type: 'before', element: current }
        if (remaining < length)
          return edge === 'start' ? { type: 'before', element: current } : { type: 'after', element: current }
        if (remaining === length) return { type: 'after', element: current }
        remaining -= length
        return null
      }

      for (const child of Array.from(current.childNodes)) {
        const boundary = walk(child)
        if (boundary) return boundary
      }
      return null
    }

    return walk(el) ?? lastBoundary
  }

  const applyBoundary = (range: Range, boundary: Boundary, target: 'start' | 'end') => {
    if (boundary.type === 'before') {
      if (target === 'start') range.setStartBefore(boundary.element)
      else range.setEndBefore(boundary.element)
      return
    }
    if (boundary.type === 'after') {
      if (target === 'start') range.setStartAfter(boundary.element)
      else range.setEndAfter(boundary.element)
      return
    }
    if (target === 'start') range.setStart(boundary.node, boundary.offset)
    else range.setEnd(boundary.node, boundary.offset)
  }

  const startBoundary = findBoundary(start, 'start')
  const endBoundary = findBoundary(end, 'end')
  const range = document.createRange()
  applyBoundary(range, startBoundary, 'start')
  applyBoundary(range, endBoundary, 'end')
  sel.removeAllRanges()
  sel.addRange(range)
}

/** 通用悬浮气泡提示 */
function ButtonTooltip({ visible, text }: { visible: boolean; text: ReactNode }) {
  if (!visible) return null

  return (
    <ViewportTooltip visible className="z-10 whitespace-nowrap">
      {text}
    </ViewportTooltip>
  )
}

function BatchActionButton({
  tooltip,
  className,
  onClick,
  expanded,
  controls,
  children,
}: {
  tooltip: string
  className: string
  onClick: () => void | Promise<void>
  expanded?: boolean
  controls?: string
  children: ReactNode
}) {
  const tooltipState = useTooltip()

  return (
    <span className="relative inline-flex" {...tooltipState.handlers}>
      <button
        type="button"
        onClick={() => {
          tooltipState.dismiss()
          void onClick()
        }}
        className={className}
        aria-label={tooltip}
        aria-expanded={expanded}
        aria-controls={controls}
        aria-haspopup={controls ? 'dialog' : undefined}
      >
        {children}
      </button>
      <ViewportTooltip visible={tooltipState.visible} className="whitespace-nowrap">
        {tooltip}
      </ViewportTooltip>
    </span>
  )
}

function getFavoriteCollectionTasksForBatch(collectionId: string, tasks: TaskRecord[]) {
  const favoriteTasks = tasks.filter((task) => task.isFavorite)
  if (collectionId === ALL_FAVORITES_COLLECTION_ID) return favoriteTasks
  return favoriteTasks.filter((task) => getTaskFavoriteCollectionIds(task).includes(collectionId))
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return isMobile
}

type AtImageOption =
  | { type: 'input'; key: string; label: string; imageId: string; dataUrl: string; imageIndex: number }
  | { type: 'agent-output'; key: string; label: string; imageId: string; insertText: string }

function agentImageMentionMatches(query: string, label: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  const normalizedLabel = label.toLowerCase()
  return normalizedLabel.includes(normalized) || normalizedLabel.replace(/^@/, '').includes(normalized)
}

function AtImageOptionThumb({ option }: { option: AtImageOption }) {
  const [src, setSrc] = useState(option.type === 'input' ? option.dataUrl : getCachedImage(option.imageId) || '')

  useEffect(() => {
    if (option.type === 'input') {
      setSrc(option.dataUrl)
      return
    }

    let cancelled = false
    setSrc(getCachedImage(option.imageId) || '')
    ensureImageCached(option.imageId).then((url) => {
      if (!cancelled && url) setSrc(url)
    })
    return () => {
      cancelled = true
    }
  }, [option])

  return (
    <span className="h-ds-control-md w-ds-control-md shrink-0 overflow-hidden rounded-lg border border-ds-border/70 bg-ds-surface dark:border-ds-border dark:bg-ds-surface">
      {src && <img src={src} className="h-full w-full object-cover" alt="" />}
    </span>
  )
}

type InputOptionItem = { label: string; value: string; action?: boolean }

/**
 * 输入区简洁化：把「质量 / 格式 / 审核规则」等参数控件收拢为单个图标的按钮，
 * 点击弹出选项浮层（带当前值头部与选中勾）。触发按钮与右侧图标按钮视觉一致。
 */
function InputIconOptionButton({
  icon,
  label,
  currentValueLabel,
  options,
  value,
  onSelect,
  disabled,
  menuClass,
}: {
  icon: ReactNode
  label: string
  currentValueLabel: string
  options: InputOptionItem[]
  value: string
  onSelect: (value: string) => void
  disabled?: boolean
  menuClass?: string
}) {
  const [open, setOpen] = useState(false)
  const baseClass =
    'inline-flex h-ds-control-md w-ds-control-md shrink-0 items-center justify-center rounded-ds-lg shadow-sm transition-[background-color,transform,box-shadow] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40'
  const idleClass =
    'bg-ds-subtle text-ds-muted hover:bg-ds-subtle hover:text-ds-text dark:bg-ds-surface dark:text-ds-muted dark:hover:bg-ds-surface dark:hover:text-ds-text'
  const activeClass = 'bg-ds-primary-subtle text-ds-primary dark:bg-ds-primary/10 dark:text-ds-primary'

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${label}：${currentValueLabel}`}
        className={`${baseClass} ${open ? activeClass : idleClass}`}
      >
        {icon}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-overlay" onClick={() => setOpen(false)} />
          <div
            role="listbox"
            aria-label={label}
            className={`absolute bottom-full right-0 z-overlay mb-2 w-44 overflow-hidden rounded-ds-xl border border-ds-border/80 bg-ds-surface p-1.5 text-left shadow-[0_16px_40px_rgba(15,23,42,0.18)] dark:border-ds-border dark:bg-ds-subtle ${menuClass ?? ''}`}
          >
            <div className="border-b border-ds-border px-2.5 py-1.5 text-xs font-medium text-ds-text dark:border-ds-border dark:text-white">
              {label}：{currentValueLabel}
            </div>
            <div className="max-h-60 overflow-y-auto py-1 custom-scrollbar">
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={value === option.value}
                  onClick={() => {
                    onSelect(option.value)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-ds-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                    option.action
                      ? 'font-medium text-ds-primary hover:bg-ds-primary-subtle dark:hover:bg-ds-primary/10'
                      : 'text-ds-text hover:bg-ds-subtle dark:text-ds-text-subtle dark:hover:bg-ds-surface'
                  }`}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  {value === option.value && <CheckIcon className="h-3.5 w-3.5 shrink-0 text-ds-primary" />}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function InputBar() {
  const prompt = useStore((s) => s.prompt)
  const appMode = useStore((s) => s.appMode)
  const setPrompt = useStore((s) => s.setPrompt)
  const inputImages = useStore((s) => s.inputImages)
  const addInputImage = useStore((s) => s.addInputImage)
  const replaceInputImage = useStore((s) => s.replaceInputImage)
  const removeInputImage = useStore((s) => s.removeInputImage)
  const clearInputImages = useStore((s) => s.clearInputImages)
  const inputImageFolder = useStore((s) => s.inputImageFolder)
  const setInputImageFolder = useStore((s) => s.setInputImageFolder)
  const params = useStore((s) => s.params)
  const setParams = useStore((s) => s.setParams)
  const customOutputPath = useStore((s) => s.customOutputPath)
  const setCustomOutputPath = useStore((s) => s.setCustomOutputPath)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const reusedTaskApiProfileId = useStore((s) => s.reusedTaskApiProfileId)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)
  const showToast = useStore((s) => s.showToast)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const selectedTaskIds = useStore((s) => s.selectedTaskIds)
  const setSelectedTaskIds = useStore((s) => s.setSelectedTaskIds)
  const clearSelection = useStore((s) => s.clearSelection)
  const selectedFavoriteCollectionIds = useStore((s) => s.selectedFavoriteCollectionIds)
  const setSelectedFavoriteCollectionIds = useStore((s) => s.setSelectedFavoriteCollectionIds)
  const clearFavoriteCollectionSelection = useStore((s) => s.clearFavoriteCollectionSelection)
  const tasks = useStore((s) => s.tasks)
  const workspaceTabs = useStore((s) => s.workspaceTabs)
  const activeWorkspaceTabId = useStore((s) => s.activeWorkspaceTabId)
  const favoriteCollections = useStore((s) => s.favoriteCollections)
  const agentConversations = useStore((s) => s.agentConversations)
  const activeAgentConversationId = useStore((s) => s.activeAgentConversationId)
  const filterStatus = useStore((s) => s.filterStatus)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const galleryViewMode = useStore((s) => s.galleryViewMode)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const openFavoritePicker = useStore((s) => s.openFavoritePicker)
  const searchQuery = useStore((s) => s.searchQuery)

  const wordLibraryEntries = useStore((s) => s.wordLibraryEntries)
  const wordLibraryGroups = useStore((s) => s.wordLibraryGroups)
  const createWordLibraryGroup = useStore((s) => s.createWordLibraryGroup)
  const createWordLibraryEntry = useStore((s) => s.createWordLibraryEntry)
  const updateWordLibraryEntry = useStore((s) => s.updateWordLibraryEntry)
  const setWordLibraryEditEntryId = useStore((s) => s.setWordLibraryEditEntryId)
  const setWordLibraryPromptSelectedVarName = useStore((s) => s.setWordLibraryPromptSelectedVarName)
  const sopItems = useRequirementPrototype((s) => s.sopLibrary)
  const [showAgentBatchPlanner, setShowAgentBatchPlanner] = useState(false)
  const [showGallerySopBatch, setShowGallerySopBatch] = useState(false)
  const [gallerySopBatchTabIds, setGallerySopBatchTabIds] = useState<string[]>([])
  const [visibleGallerySopBatchTabId, setVisibleGallerySopBatchTabId] = useState<string | null>(null)
  const [showGallerySopManagement, setShowGallerySopManagement] = useState(false)
  const [showAssetPicker, setShowAssetPicker] = useState(false)
  /**
   * 待自动启动的批次作用域（null 表示不自动启动）。
   * 刻意与 visibleGallerySopBatchTabId 解耦：静默启动后若用户立刻切换标签页，
   * 自动启动信号不应因弹窗可见性变化而丢失。
   */
  const [gallerySopAutoStartTabId, setGallerySopAutoStartTabId] = useState<string | null>(null)
  /** 正在后台静默运行、未呈现弹窗的批次作用域 */
  const silentGallerySopTabsRef = useRef<Set<string>>(new Set())
  /** 上一次上报的批次阶段，用于识别静默运行期间的失败 */
  const gallerySopPhaseRef = useRef<Record<string, string>>({})
  const [gallerySopIdsByTab, setGallerySopIdsByTab] = useState<Record<string, string>>({})
  const [savedSopPromptCount, setSavedSopPromptCount] = useState(0)
  const [gallerySopPromptCountsByTab, setGallerySopPromptCountsByTab] = useState<Record<string, number>>({})
  const [gallerySopImagesPerPromptByTab, setGallerySopImagesPerPromptByTab] = useState<Record<string, number>>({})
  const [gallerySopAutoGenerateByTab, setGallerySopAutoGenerateByTab] = useState<Record<string, boolean>>({})
  /** 输入栏直接修改批次参数时递增，作为 GallerySopBatchModal 的外部同步信号 */
  const [gallerySopCountsNonce, setGallerySopCountsNonce] = useState(0)
  /** 输入栏数量输入框的本地编辑草稿：null 表示跟随 store 值，编辑期间显示草稿，失焦回落到规范化值 */
  const [gallerySopPromptCountDraft, setGallerySopPromptCountDraft] = useState<string | null>(null)
  const [gallerySopImagesPerPromptDraft, setGallerySopImagesPerPromptDraft] = useState<string | null>(null)
  const [gallerySopSecondReferenceByTab, setGallerySopSecondReferenceByTab] = useState<Record<string, boolean>>({})
  const [gallerySopRunStatusByTab, setGallerySopRunStatusByTab] = useState<Record<string, GallerySopRunStatus>>({})
  const [taskMoveMenuOpen, setTaskMoveMenuOpen] = useState(false)
  const taskMoveMenuRef = useRef<HTMLDivElement>(null)
  const taskMoveDestinations = useMemo(
    () =>
      workspaceTabs.filter((tab) => tab.id !== activeWorkspaceTabId).sort((left, right) => left.order - right.order),
    [activeWorkspaceTabId, workspaceTabs],
  )

  useCloseOnEscape(taskMoveMenuOpen, () => setTaskMoveMenuOpen(false))

  useEffect(() => {
    if (!taskMoveMenuOpen) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!taskMoveMenuRef.current?.contains(event.target as Node)) {
        setTaskMoveMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => document.removeEventListener('mousedown', closeOnOutsideClick)
  }, [taskMoveMenuOpen])

  useEffect(() => {
    if (selectedTaskIds.length === 0) setTaskMoveMenuOpen(false)
  }, [selectedTaskIds.length])

  const VAR_COLOR_MAP = useMemo(() => buildVariableColorMap(wordLibraryEntries), [wordLibraryEntries])
  const activeWordLibraryKeys = useMemo(
    () => wordLibraryEntries.filter((e) => e.deletedAt == null).map((entry) => entry.key),
    [wordLibraryEntries],
  )
  const gallerySopScopeId = activeWorkspaceTabId ?? '__default__'
  // 素材库当前项目文件夹：同一标签页内不同文件夹的 SOP 批次运行互相独立（草稿/生成/状态互不打断）
  const gallerySopFolderKey = useAssetLibraryStore((state) =>
    typeof state.scope === 'object' && state.scope !== null && state.scope.kind === 'collection' ? state.scope.id : '',
  )
  const gallerySopScopeKey = gallerySopFolderKey ? `${gallerySopScopeId}::${gallerySopFolderKey}` : gallerySopScopeId
  /**
   * 画廊提示词输入框按素材库文件夹隔离：切换文件夹时保存当前输入、恢复目标文件夹的输入，
   * 避免不同文件夹生图读取到彼此的缓存提示词（重启后按当前文件夹的草稿恢复）。
   * 首次挂载时把当前输入视为当前文件夹的草稿，之后每次切换都走「保存旧 / 恢复新」。
   */
  const galleryPromptFolderRef = useRef<string | null>(null)
  useEffect(() => {
    if (appMode !== 'gallery') return
    const nextFolderKey = gallerySopFolderKey
    if (galleryPromptFolderRef.current === null) {
      galleryPromptFolderRef.current = nextFolderKey
      const saved = readGalleryInputDraft(nextFolderKey)
      if (saved !== null && saved !== prompt) setPrompt(saved)
      return
    }
    if (galleryPromptFolderRef.current === nextFolderKey) return
    writeGalleryInputDraft(galleryPromptFolderRef.current, prompt)
    galleryPromptFolderRef.current = nextFolderKey
    setPrompt(readGalleryInputDraft(nextFolderKey) ?? '')
  }, [appMode, gallerySopFolderKey, prompt, setPrompt])
  const gallerySopId = gallerySopIdsByTab[gallerySopScopeKey] ?? ''
  const gallerySopPromptCount = gallerySopPromptCountsByTab[gallerySopScopeKey] ?? 5
  const gallerySopImagesPerPrompt = gallerySopImagesPerPromptByTab[gallerySopScopeKey] ?? 1
  const gallerySopAutoGenerate = gallerySopAutoGenerateByTab[gallerySopScopeKey] ?? false
  const gallerySopSecondReference = gallerySopSecondReferenceByTab[gallerySopScopeKey] ?? false
  const gallerySopTotalImages = getSopTotalImageCount(gallerySopPromptCount, gallerySopImagesPerPrompt)
  const gallerySopRunStatus = gallerySopRunStatusByTab[gallerySopScopeKey]
  const setGallerySopId = useCallback(
    (id: string) => {
      if (id === gallerySopId) return
      window.localStorage.removeItem(getGallerySopPromptRunStorageKey(activeWorkspaceTabId, gallerySopFolderKey))
      setSavedSopPromptCount(0)
      setGallerySopRunStatusByTab((current) => {
        const next = { ...current }
        delete next[gallerySopScopeKey]
        return next
      })
      // 注意：切换 SOP 时不再卸载/隐藏生图弹窗，避免弹窗被锁定在旧 SOP 上，
      // 弹窗会实时跟随 gallerySopIdsByTab 显示最新 SOP。
      setGallerySopAutoStartTabId(null)
      setGallerySopIdsByTab((current) => ({ ...current, [gallerySopScopeKey]: id }))
    },
    [activeWorkspaceTabId, gallerySopFolderKey, gallerySopId, gallerySopScopeKey],
  )

  // 素材详情侧栏「复用 SOP」：应用素材来源 SOP 为当前 SOP 并切到画廊模式
  useEffect(() => {
    const handleApplySop = (event: Event) => {
      const sopId = (event as CustomEvent<{ sopId?: string }>).detail?.sopId
      if (!sopId) return
      const sopExists = useRequirementPrototype.getState().sopLibrary.some((item) => item.id === sopId)
      if (!sopExists) {
        showToast('该 SOP 已不存在，无法复用', 'error')
        return
      }
      useStore.getState().setAppMode('gallery')
      setGallerySopId(sopId)
      showToast('已应用该素材的 SOP，可点击生成按钮使用', 'success')
    }
    window.addEventListener(APPLY_SOP_TO_GALLERY_EVENT, handleApplySop)
    return () => window.removeEventListener(APPLY_SOP_TO_GALLERY_EVENT, handleApplySop)
  }, [setGallerySopId, showToast])

  // SOP 后台生成完成后的「查看结果」跳转：应用该 SOP 并重新打开 SOP 管理中心
  const sopCenterJump = useStore((state) => state.sopCenterJump)
  useEffect(() => {
    if (!sopCenterJump) return
    setGallerySopId(sopCenterJump.itemId)
    setShowGallerySopManagement(true)
  }, [setGallerySopId, sopCenterJump])

  /** 提示词管理弹窗内批次参数变化的唯一回写入口：胶囊行只读展示，弹窗是唯一编辑面。 */
  const handleGallerySopCountsChange = useCallback(
    (counts: { promptCount: number; imagesPerPrompt: number; autoGenerate: boolean; secondReference: boolean }) => {
      setGallerySopPromptCountsByTab((current) => ({ ...current, [gallerySopScopeKey]: counts.promptCount }))
      setGallerySopImagesPerPromptByTab((current) => ({ ...current, [gallerySopScopeKey]: counts.imagesPerPrompt }))
      setGallerySopAutoGenerateByTab((current) => ({ ...current, [gallerySopScopeKey]: counts.autoGenerate }))
      setGallerySopSecondReferenceByTab((current) => ({ ...current, [gallerySopScopeKey]: counts.secondReference }))
    },
    [gallerySopScopeKey],
  )

  /** 输入栏胶囊「自动生图」开关：直接切换并弹窗提示，同时通过 nonce 信号同步已挂载的提示词管理弹窗。 */
  const toggleGallerySopAutoGenerate = useCallback(() => {
    const next = !gallerySopAutoGenerate
    setGallerySopAutoGenerateByTab((current) => ({ ...current, [gallerySopScopeKey]: next }))
    setGallerySopCountsNonce((current) => current + 1)
    showToast(next ? '自动生图已开启' : '自动生图已关闭', 'success')
  }, [gallerySopAutoGenerate, gallerySopScopeKey, showToast])

  const toggleGallerySopSecondReference = useCallback(() => {
    const next = !gallerySopSecondReference
    setGallerySopSecondReferenceByTab((current) => ({ ...current, [gallerySopScopeKey]: next }))
    setGallerySopCountsNonce((current) => current + 1)
    showToast(next ? '二次参考已开启' : '二次参考已关闭', 'success')
  }, [gallerySopScopeKey, gallerySopSecondReference, showToast])

  /** 输入栏胶囊「提示词数量」直接输入：规范化后写入并同步弹窗。 */
  const handleGallerySopPromptCountInput = useCallback(
    (raw: string) => {
      setGallerySopPromptCountDraft(raw)
      const value = Number(raw)
      if (!Number.isFinite(value) || value < 1) return
      const normalized = getSopRunCounts(value, gallerySopImagesPerPrompt).promptCount
      setGallerySopPromptCountsByTab((current) => ({ ...current, [gallerySopScopeKey]: normalized }))
      setGallerySopCountsNonce((current) => current + 1)
    },
    [gallerySopImagesPerPrompt, gallerySopScopeKey],
  )

  /** 输入栏胶囊「每条图片数」直接输入：规范化后写入并同步弹窗。 */
  const handleGallerySopImagesPerPromptInput = useCallback(
    (raw: string) => {
      setGallerySopImagesPerPromptDraft(raw)
      const value = Number(raw)
      if (!Number.isFinite(value) || value < 1) return
      const normalized = getSopRunCounts(gallerySopPromptCount, value).imagesPerPrompt
      setGallerySopImagesPerPromptByTab((current) => ({ ...current, [gallerySopScopeKey]: normalized }))
      setGallerySopCountsNonce((current) => current + 1)
    },
    [gallerySopPromptCount, gallerySopScopeKey],
  )
  const activeGallerySop = useMemo(
    () => sopItems.find((item) => item.id === gallerySopId) ?? null,
    [gallerySopId, sopItems],
  )

  /**
   * silent=true 时只挂载批次组件并触发自动流程，不呈现弹窗。
   * GallerySopBatchModal 的 `if (!visible) return null` 位于全部业务逻辑之后，
   * 因此不可见时依然能完整完成「生成提示词 → 自动提交生图」。
   */
  const openGallerySopBatch = useCallback(
    (autoStart: boolean, silent = false) => {
      setGallerySopBatchTabIds((current) =>
        current.includes(gallerySopScopeKey) ? current : [...current, gallerySopScopeKey],
      )
      setGallerySopAutoStartTabId(autoStart ? gallerySopScopeKey : null)
      setVisibleGallerySopBatchTabId(gallerySopScopeKey)
      if (silent) {
        silentGallerySopTabsRef.current.add(gallerySopScopeKey)
        return
      }
      silentGallerySopTabsRef.current.delete(gallerySopScopeKey)
      setShowGallerySopBatch(true)
    },
    [gallerySopScopeKey],
  )

  /** 把某个后台批次（按标签页+文件夹作用域）切换为前台可见 */
  const revealGallerySopBatch = useCallback((scopeKey: string) => {
    silentGallerySopTabsRef.current.delete(scopeKey)
    setGallerySopBatchTabIds((current) => (current.includes(scopeKey) ? current : [...current, scopeKey]))
    setVisibleGallerySopBatchTabId(scopeKey)
    setShowGallerySopBatch(true)
  }, [])

  const handleGallerySopRunStatusChange = useCallback((scopeKey: string, nextStatus: GallerySopRunStatus) => {
    setGallerySopRunStatusByTab((current) => ({ ...current, [scopeKey]: nextStatus }))
    // 后台静默运行时弹窗不可见，成败必须通过 toast 让用户感知
    const prevPhase = gallerySopPhaseRef.current[scopeKey]
    gallerySopPhaseRef.current[scopeKey] = nextStatus.phase
    if (prevPhase === nextStatus.phase) return
    if (!silentGallerySopTabsRef.current.has(scopeKey)) return
    if (nextStatus.phase === 'error') {
      showToast(nextStatus.message || 'SOP 后台批次执行失败，点击提示词管理查看详情', 'error')
    } else if (nextStatus.phase === 'success') {
      silentGallerySopTabsRef.current.delete(scopeKey)
      showToast(`SOP 批次完成，已提交 ${nextStatus.totalImages} 张图片`, 'success')
    }
  }, [])

  const refreshSavedSopPromptCount = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(
        getGallerySopPromptRunStorageKey(activeWorkspaceTabId, gallerySopFolderKey),
      )
      if (!raw) {
        setSavedSopPromptCount(0)
        return
      }
      const parsed = JSON.parse(raw) as {
        selectedSopId?: string
        promptCount?: number
        quantity?: number
        imagesPerPrompt?: number
        autoGenerate?: boolean
        secondReference?: boolean
        availablePrompts?: number
        prompts?: Array<{ deleted?: boolean; promptText?: unknown }>
      }
      if (parsed.selectedSopId !== gallerySopId) {
        setSavedSopPromptCount(0)
        return
      }
      const count = Array.isArray(parsed.prompts)
        ? parsed.prompts.filter(
            (item) => !item.deleted && typeof item.promptText === 'string' && item.promptText.trim(),
          ).length
        : typeof parsed.availablePrompts === 'number'
          ? parsed.availablePrompts
          : 0
      setSavedSopPromptCount(count)
      const restoredCounts = getSopRunCounts(parsed.promptCount ?? parsed.quantity ?? 5, parsed.imagesPerPrompt ?? 1)
      setGallerySopPromptCountsByTab((current) =>
        Object.hasOwn(current, gallerySopScopeKey)
          ? current
          : { ...current, [gallerySopScopeKey]: restoredCounts.promptCount },
      )
      setGallerySopImagesPerPromptByTab((current) =>
        Object.hasOwn(current, gallerySopScopeKey)
          ? current
          : { ...current, [gallerySopScopeKey]: restoredCounts.imagesPerPrompt },
      )
      if (typeof parsed.autoGenerate === 'boolean') {
        setGallerySopAutoGenerateByTab((current) => ({ ...current, [gallerySopScopeKey]: parsed.autoGenerate! }))
      }
      if (typeof parsed.secondReference === 'boolean') {
        setGallerySopSecondReferenceByTab((current) => ({
          ...current,
          [gallerySopScopeKey]: parsed.secondReference!,
        }))
      }
    } catch {
      setSavedSopPromptCount(0)
    }
  }, [activeWorkspaceTabId, gallerySopFolderKey, gallerySopId, gallerySopScopeKey])

  useEffect(() => {
    if (gallerySopId && !sopItems.some((item) => item.id === gallerySopId)) {
      setGallerySopId('')
    }
  }, [gallerySopId, sopItems])

  useEffect(() => {
    refreshSavedSopPromptCount()
  }, [refreshSavedSopPromptCount, showGallerySopBatch])

  useEffect(() => {
    if (visibleGallerySopBatchTabId && visibleGallerySopBatchTabId !== gallerySopScopeKey) {
      setVisibleGallerySopBatchTabId(null)
      setShowGallerySopBatch(false)
    }
  }, [gallerySopScopeKey, visibleGallerySopBatchTabId])

  const filteredTasks = useMemo(() => {
    const sorted = [...tasks].sort((a, b) => b.createdAt - a.createdAt)
    const q = searchQuery.trim().toLowerCase()

    return sorted.filter((t) => {
      if (filterFavorite) {
        if (!t.isFavorite) return false
        if (
          activeFavoriteCollectionId &&
          activeFavoriteCollectionId !== ALL_FAVORITES_COLLECTION_ID &&
          !getTaskFavoriteCollectionIds(t).includes(activeFavoriteCollectionId)
        )
          return false
      }
      const matchStatus = filterStatus === 'all' || t.status === filterStatus
      if (!matchStatus) return false

      if (!q) return true
      const prompt = (t.prompt || '').toLowerCase()
      const paramStr = JSON.stringify(t.params).toLowerCase()
      return prompt.includes(q) || paramStr.includes(q)
    })
  }, [tasks, searchQuery, filterStatus, filterFavorite, activeFavoriteCollectionId])

  const inCollectionOverview = filterFavorite && !activeFavoriteCollectionId

  const favoriteCollectionCards = useMemo(() => {
    return [
      {
        id: ALL_FAVORITES_COLLECTION_ID,
        name: '全部',
        tasks: getFavoriteCollectionTasksForBatch(ALL_FAVORITES_COLLECTION_ID, tasks),
      },
      ...favoriteCollections.map((collection) => ({
        id: collection.id,
        name: collection.name,
        collection,
        tasks: getFavoriteCollectionTasksForBatch(collection.id, tasks),
      })),
    ]
  }, [favoriteCollections, tasks])

  const filteredFavoriteCollectionCards = useMemo(() => {
    if (!searchQuery.trim()) return favoriteCollectionCards
    const lowerQuery = searchQuery.toLowerCase()
    return favoriteCollectionCards.filter((collection) => collection.name.toLowerCase().includes(lowerQuery))
  }, [favoriteCollectionCards, searchQuery])

  const handleSelectAllVisibleTasks = useCallback(() => {
    setSelectedTaskIds(filteredTasks.map((task) => task.id))
  }, [filteredTasks, setSelectedTaskIds])

  const handleInvertVisibleTasks = useCallback(() => {
    const visibleIds = new Set(filteredTasks.map((task) => task.id))
    setSelectedTaskIds((current) => {
      const currentSet = new Set(current)
      const next = current.filter((id) => !visibleIds.has(id))
      filteredTasks.forEach((task) => {
        if (!currentSet.has(task.id)) next.push(task.id)
      })
      return next
    })
  }, [filteredTasks, setSelectedTaskIds])

  const handleSelectAllVisibleFavoriteCollections = useCallback(() => {
    setSelectedFavoriteCollectionIds(filteredFavoriteCollectionCards.map((collection) => collection.id))
  }, [filteredFavoriteCollectionCards, setSelectedFavoriteCollectionIds])

  const handleInvertVisibleFavoriteCollections = useCallback(() => {
    const visibleIds = new Set(filteredFavoriteCollectionCards.map((collection) => collection.id))
    setSelectedFavoriteCollectionIds((current) => {
      const currentSet = new Set(current)
      const next = current.filter((id) => !visibleIds.has(id))
      filteredFavoriteCollectionCards.forEach((collection) => {
        if (!currentSet.has(collection.id)) next.push(collection.id)
      })
      return next
    })
  }, [filteredFavoriteCollectionCards, setSelectedFavoriteCollectionIds])

  const handleToggleFavorite = useCallback(() => {
    openFavoritePicker(selectedTaskIds)
  }, [openFavoritePicker, selectedTaskIds])

  const handleDeleteSelected = useCallback(() => {
    setConfirmDialog({
      title: '批量删除',
      message: `确定要删除选中的 ${selectedTaskIds.length} 个任务吗？这些任务生成的图片会一并删除，不可恢复；被其他任务/会话引用的图片会保留。`,
      action: () => {
        removeMultipleTasks(selectedTaskIds)
      },
    })
  }, [selectedTaskIds, setConfirmDialog])

  const handleDownloadSelected = useCallback(async () => {
    const selectedTasks = tasks.filter((t) => selectedTaskIds.includes(t.id))
    const imageIds = selectedTasks.flatMap((t) => t.outputImages || [])
    if (imageIds.length === 0) {
      showToast('选中的任务没有图片', 'info')
      return
    }

    try {
      const timeStr = formatExportFileTime(new Date())
      const fileNameBase = `batch-${timeStr}`
      const entries = getGeneratedImageDownloadEntries(selectedTasks, workspaceTabs, settings)
      const { successCount, failCount } = settings.zipDownloadRoutes.includes('task-selection')
        ? await downloadImageEntriesAsZip(entries, fileNameBase)
        : await downloadImageEntries(entries)

      if (successCount === 0) {
        showToast('下载失败', 'error')
      } else if (failCount > 0) {
        showToast(`部分下载失败：成功 ${successCount}，失败 ${failCount}`, 'error')
      } else {
        showToast(successCount > 1 ? `下载成功：${successCount} 张图片` : '下载成功', 'success')
      }
    } catch (err) {
      console.error(err)
      showToast('下载失败', 'error')
    }
    clearSelection()
  }, [tasks, selectedTaskIds, workspaceTabs, settings, showToast, clearSelection])

  const handleDownloadSelectedFavoriteCollections = useCallback(async () => {
    const selectedIdSet = new Set(selectedFavoriteCollectionIds)
    const selectedCollections = favoriteCollectionCards.filter((collection) => selectedIdSet.has(collection.id))
    if (selectedCollections.length === 0) return

    let successCount = 0
    let failCount = 0
    let downloadedCollectionCount = 0
    const useZipDownload = settings.zipDownloadRoutes.includes('favorite-collection-selection')
    const timeStr = formatExportFileTime(new Date())

    try {
      for (const collection of selectedCollections) {
        const entries = getGeneratedImageDownloadEntries(collection.tasks, workspaceTabs, settings)
        if (entries.length === 0) continue
        const zipName =
          collection.id === ALL_FAVORITES_COLLECTION_ID
            ? `favorites-all-${timeStr}`
            : `favorites-${collection.name}-${timeStr}`
        const result = useZipDownload
          ? await downloadImageEntriesAsZip(entries, zipName)
          : await downloadImageEntries(entries)
        successCount += result.successCount
        failCount += result.failCount
        if (result.successCount > 0) downloadedCollectionCount++
        if (selectedCollections.length > 1) await delay(100)
      }

      if (successCount === 0) {
        showToast('选中的收藏夹没有图片', 'info')
      } else if (failCount > 0) {
        showToast(`部分下载失败：成功 ${successCount}，失败 ${failCount}`, 'error')
      } else {
        showToast(
          useZipDownload && downloadedCollectionCount > 1
            ? `下载成功：${downloadedCollectionCount} 个压缩包，${successCount} 张图片`
            : `下载成功：${successCount} 张图片`,
          'success',
        )
      }
    } catch (err) {
      console.error(err)
      showToast('下载失败', 'error')
    }
    clearFavoriteCollectionSelection()
  }, [
    clearFavoriteCollectionSelection,
    favoriteCollectionCards,
    selectedFavoriteCollectionIds,
    settings,
    showToast,
    workspaceTabs,
  ])

  const handleDeleteSelectedFavoriteCollections = useCallback(() => {
    const selectedIdSet = new Set(selectedFavoriteCollectionIds)
    const selectedCollections = favoriteCollections.filter((collection) => selectedIdSet.has(collection.id))
    if (selectedCollections.length === 0) {
      showToast('没有可删除的收藏夹', 'info')
      return
    }
    if (favoriteCollections.length - selectedCollections.length < 1) {
      showToast('至少保留一个收藏夹', 'error')
      return
    }

    const selectedCollectionIds = new Set(selectedCollections.map((collection) => collection.id))
    const imageCount = new Set(
      tasks
        .filter((task) => getTaskFavoriteCollectionIds(task).some((id) => selectedCollectionIds.has(id)))
        .flatMap((task) => task.outputImages || []),
    ).size
    setConfirmDialog({
      title: '批量删除收藏夹',
      message: `确定要删除选中的 ${selectedCollections.length} 个收藏夹吗？`,
      checkbox:
        imageCount > 0
          ? {
              label: `同时删除收藏夹中的图片（${imageCount} 张）`,
              tone: 'danger',
            }
          : undefined,
      action: async (deleteImages = false) => {
        for (const collection of selectedCollections) {
          await deleteFavoriteCollection(collection.id, deleteImages)
        }
        clearFavoriteCollectionSelection()
      },
    })
  }, [
    clearFavoriteCollectionSelection,
    favoriteCollections,
    selectedFavoriteCollectionIds,
    setConfirmDialog,
    showToast,
    tasks,
  ])

  // Delete/Backspace：删除选中的任务或收藏卡片（Eagle 式）。
  // 素材库选中素材 / 查看器打开时的 Delete 由素材库快捷键与查看器自身处理，这里让位。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.closest('input, textarea, select, [contenteditable="true"]') || target.isContentEditable)
      ) {
        return
      }
      if (appMode !== 'gallery') return
      const assetState = useAssetLibraryStore.getState()
      if (assetState.selectedAssetIds.length > 0 || assetState.viewerAssetId) return
      if (selectedTaskIds.length === 0 && selectedFavoriteCollectionIds.length === 0) return
      event.preventDefault()
      if (selectedTaskIds.length > 0) handleDeleteSelected()
      else handleDeleteSelectedFavoriteCollections()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    appMode,
    handleDeleteSelected,
    handleDeleteSelectedFavoriteCollections,
    selectedFavoriteCollectionIds.length,
    selectedTaskIds.length,
  ])

  const maskDraft = useStore((s) => s.maskDraft)
  const clearMaskDraft = useStore((s) => s.clearMaskDraft)
  const setMaskEditorImageId = useStore((s) => s.setMaskEditorImageId)
  const moveInputImage = useStore((s) => s.moveInputImage)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const replaceFileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const imagesRef = useRef<HTMLDivElement>(null)
  const prevHeightRef = useRef(42)

  const [isDragging, setIsDragging] = useState(false)
  const [isSingleLine, setIsSingleLine] = useState(true)
  const [submitHover, setSubmitHover] = useState(false)
  const [attachHover, setAttachHover] = useState(false)
  const [varConvertHover, setVarConvertHover] = useState(false)
  const [imageHintId, setImageHintId] = useState<string | null>(null)
  const [mobileCollapsed, setMobileCollapsed] = useState(false)
  const [showSizePicker, setShowSizePicker] = useState(false)
  const [showMobileUploadMenu, setShowMobileUploadMenu] = useState(false)
  const [outputMenuOpen, setOutputMenuOpen] = useState(false)
  const [showCustomAdRuleDialog, setShowCustomAdRuleDialog] = useState(false)
  const customAdRuleDialogRef = useRef<HTMLFormElement>(null)
  useCloseOnEscape(showCustomAdRuleDialog, () => setShowCustomAdRuleDialog(false))
  usePreventBackgroundScroll(showCustomAdRuleDialog, customAdRuleDialogRef)
  useDialogFocusTrap(showCustomAdRuleDialog, customAdRuleDialogRef)
  const [customAdRuleName, setCustomAdRuleName] = useState('')
  const [customAdRuleContent, setCustomAdRuleContent] = useState('')
  const [maskPreviewUrl, setMaskPreviewUrl] = useState('')
  const [imageDragIndex, setImageDragIndex] = useState<number | null>(null)
  const [imageDragOverIndex, setImageDragOverIndex] = useState<number | null>(null)
  const [atImageMenuIndex, setAtImageMenuIndex] = useState(0)
  const [atImageMenuDismissed, setAtImageMenuDismissed] = useState(false)
  const [touchDragPreview, setTouchDragPreview] = useState<{ src: string; x: number; y: number } | null>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const dragTouchRef = useRef({ startY: 0, moved: false })
  const suppressHandleClickUntilRef = useRef(0)
  const imageDragIndexRef = useRef<number | null>(null)
  const imageTouchDragRef = useRef({ index: null as number | null, startX: 0, startY: 0, moved: false })
  const imageDragOverIndexRef = useRef<number | null>(null)
  const imageDragPreviewRef = useRef<HTMLElement | null>(null)
  const suppressImageClickRef = useRef(false)
  const replaceImageTargetRef = useRef<{ index: number; id: string } | null>(null)
  const isUserInputRef = useRef(false)
  const draggedVariableOffsetRef = useRef<number | null>(null)
  const imageHintLockedRef = useRef(false)
  const imageHintReleaseRef = useRef<(() => void) | null>(null)
  const [cursorPos, setCursorPos] = useState(0)
  const [menuLeft, setMenuLeft] = useState(0)
  const maskConflictNoticeShownRef = useRef(false)

  // 助手技能（图片描述 / 超级衍生 / 狂野衍生）：反馈状态与偏好

  const updateInputBarClearance = useCallback(() => {
    const bar = cardRef.current?.closest<HTMLElement>('[data-input-bar]')
    if (!bar) return

    const rect = bar.getBoundingClientRect()
    const clearance = Math.max(0, window.innerHeight - rect.top)
    document.documentElement.style.setProperty('--input-bar-clearance', `${Math.ceil(clearance)}px`)
  }, [])

  useLayoutEffect(() => {
    const bar = cardRef.current?.closest<HTMLElement>('[data-input-bar]')
    if (!bar) return

    const frame = window.requestAnimationFrame(updateInputBarClearance)
    const observer = new ResizeObserver(updateInputBarClearance)
    observer.observe(bar)

    const visualViewport = window.visualViewport
    window.addEventListener('resize', updateInputBarClearance)
    visualViewport?.addEventListener('resize', updateInputBarClearance)
    visualViewport?.addEventListener('scroll', updateInputBarClearance)

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', updateInputBarClearance)
      visualViewport?.removeEventListener('resize', updateInputBarClearance)
      visualViewport?.removeEventListener('scroll', updateInputBarClearance)
      document.documentElement.style.removeProperty('--input-bar-clearance')
    }
  }, [updateInputBarClearance])
  const imageHintTimerRef = useRef<number | null>(null)
  const [postprocessMaxSizeInput, setPostprocessMaxSizeInput] = useState(
    params.postprocess_max_size_kb == null ? '' : String(params.postprocess_max_size_kb),
  )
  const [nInput, setNInput] = useState(String(params.n))
  const [nInputFocused, setNInputFocused] = useState(false)
  const dragCounter = useRef(0)
  const isMobile = useIsMobile()

  useEffect(() => {
    if (isMobile && appMode === 'gallery') setMobileCollapsed(true)
  }, [appMode, isMobile])

  const currentActiveProfile = useMemo(() => getActiveApiProfile(settings), [settings])
  const agentActiveProfile = useMemo(() => getAgentApiProfile(settings), [settings])
  const activeProfile = useMemo(() => {
    if (settings.reuseTaskApiProfileTemporarily && reusedTaskApiProfileId) {
      return settings.profiles.find((profile) => profile.id === reusedTaskApiProfileId) ?? currentActiveProfile
    }
    return appMode === 'agent' ? agentActiveProfile : currentActiveProfile
  }, [currentActiveProfile, agentActiveProfile, appMode, reusedTaskApiProfileId, settings])
  const activeAgentConversation =
    appMode === 'agent'
      ? (agentConversations.find((conversation) => conversation.id === activeAgentConversationId) ?? null)
      : null
  const activeAgentIsRunning = Boolean(activeAgentConversation?.rounds.some((round) => round.status === 'running'))
  const effectiveSettings = useMemo(
    () =>
      activeProfile.id === currentActiveProfile.id
        ? settings
        : normalizeSettings({ ...settings, activeProfileId: activeProfile.id }),
    [activeProfile.id, currentActiveProfile.id, settings],
  )
  const hasSubmitApiConfig = Boolean(activeProfile.apiKey)
  // 一键衍生阶段文案：驱动按钮显示「生成中…」进度，避免黑盒等待
  const [oneClickDerivePhase, setOneClickDerivePhase] = useState('')
  // 一键衍生必须由用户显式开启，避免挂图后拦截普通图生图。
  const [oneClickDeriveEnabled, setOneClickDeriveEnabled] = useState(false)
  useEffect(() => {
    if (inputImages.length === 0) setOneClickDeriveEnabled(false)
  }, [inputImages.length])
  // 衍生维度策略：控制一键衍生时哪些维度锁定/微调/大改
  const [derivePolicy, setDerivePolicy] = useState<DeriveDimensionPolicy>({ ...DEFAULT_DERIVE_DIMENSION_POLICY })
  // 文案处理模式：纯视觉 / 保留原文案 / 文案也衍生
  const [deriveCopyMode, setDeriveCopyMode] = useState<DeriveCopyMode>(DEFAULT_DERIVE_COPY_MODE)
  const [derivePolicyOpen, setDerivePolicyOpen] = useState(false)
  const gallerySopModeActive = appMode === 'gallery' && Boolean(activeGallerySop)
  const gallerySopIsRunning =
    gallerySopRunStatus?.phase === 'generating' ||
    gallerySopRunStatus?.phase === 'paused' ||
    gallerySopRunStatus?.phase === 'submitting'
  const gallerySopAvailablePromptCount = gallerySopRunStatus?.availablePrompts ?? savedSopPromptCount
  const gallerySopHasPromptList = gallerySopAvailablePromptCount > 0
  const canSubmit = gallerySopModeActive
    ? Boolean(activeGallerySop && !activeAgentIsRunning)
    : Boolean((prompt.trim() || inputImages.length > 0) && hasSubmitApiConfig && !activeAgentIsRunning)
  const submitButtonAriaLabel = activeAgentIsRunning
    ? '停止生成'
    : gallerySopModeActive
      ? gallerySopIsRunning
        ? '查看 SOP 提示词生成进度'
        : gallerySopAutoGenerate
          ? `生成 ${gallerySopPromptCount} 条提示词并自动生成 ${gallerySopTotalImages} 张图片`
          : `生成 ${gallerySopPromptCount} 条 SOP 提示词`
      : hasSubmitApiConfig
        ? maskDraft
          ? '遮罩编辑'
          : oneClickDeriveEnabled && inputImages.length > 0
            ? '一键衍生'
            : '生成图像'
        : '请先配置 API'
  const submitButtonText = oneClickDerivePhase
    ? oneClickDerivePhase
    : activeAgentIsRunning
      ? '停止'
      : gallerySopModeActive
        ? gallerySopIsRunning
          ? '查看提示词进度'
          : gallerySopAutoGenerate
            ? `自动生成 ${gallerySopTotalImages} 张`
            : `生成 ${gallerySopPromptCount} 条提示词`
        : maskDraft
          ? '遮罩编辑'
          : oneClickDeriveEnabled && inputImages.length > 0
            ? '一键衍生'
            : '生成图像'
  const submitTooltipText = activeAgentIsRunning
    ? '停止生成'
    : gallerySopModeActive
      ? submitButtonAriaLabel
      : '尚未完成 API 配置，请在右上角设置中进行'
  const showSubmitTooltip = submitHover && (activeAgentIsRunning || (gallerySopModeActive ? true : !hasSubmitApiConfig))
  const promptPlaceholder = gallerySopModeActive
    ? '本次生成要求（可选）：补充本批次的主题、内容和限制；留空则完全按 SOP 执行'
    : '描述你想生成的图片，可输入 @ 来指定参考图...'
  // 一键衍生防重入：AI 反推模板期间禁止重复点击发送
  const oneClickDeriveRunningRef = useRef(false)

  /** 一键衍生：挂图未选 SOP 时，自动反推变量提示词模板 → 填入输入框 → 自动发送生图 */
  const runOneClickDerive = useCallback(async () => {
    if (oneClickDeriveRunningRef.current) return
    if (inputImages.length === 0) return
    if (!hasSubmitApiConfig) {
      showToast('请先完善 API 配置', 'error')
      return
    }
    oneClickDeriveRunningRef.current = true
    setOneClickDerivePhase('正在分析参考图…')
    try {
      // 两阶段衍生：先分析参考图生成视觉档案，再基于档案生成变量模板（带质量校验）
      const generated = await generateVariablePromptTwoPhase(
        prompt.trim(),
        inputImages.map((image, index) => ({ name: `图${index + 1}`, dataUrl: image.dataUrl })),
        {
          excludeText: copyModeToExcludeText(deriveCopyMode),
          // 文案衍生不使用 APP_COPY 元指令：它写死了「精确文案必须保留」，
          // 与「文案也衍生」冲突；改用默认基础指令 + 强化文案衍生指令（见 buildCopyModeInstruction）
          dimensionPolicyInstruction: buildDerivePolicyInstruction(derivePolicy),
          copyModeInstruction: buildCopyModeInstruction(deriveCopyMode),
          onProgress: (stage, message) => {
            const stageLabel: Record<string, string> = {
              analyze: '正在逐张分析参考图…',
              summarize: '正在整理视觉档案…',
              generate: '正在基于视觉档案生成变量提示词模板…',
              validate: '正在校验模板质量…',
            }
            setOneClickDerivePhase(stageLabel[stage] ?? message ?? '正在生成模板…')
          },
        },
      )
      // 把变量提示词模板填入输入框（同步 contentEditable 与 store）
      setOneClickDerivePhase('模板已生成，正在填入输入框…')
      isUserInputRef.current = false
      const template = generated.sop.replace(/\r\n?/g, '\n')
      setPrompt(template)
      if (textareaRef.current) textareaRef.current.innerHTML = ''
      if (textareaRef.current) textareaRef.current.textContent = template
      // 自动发送：submitTask 读取 store 中的模板，并按数量 n 自动展开组合出图
      setOneClickDerivePhase('正在按数量展开并发送生图…')
      await submitTask()
      showToast('变量提示词已填入并自动发送，正在按数量展开组合出图', 'success')
    } catch (error) {
      console.error('[一键衍生] 失败：', error)
      const message = error instanceof Error ? error.message : String(error)
      showToast(message ? `自动衍生失败：${message}` : '自动衍生失败，请查看控制台或重试', 'error')
    } finally {
      oneClickDeriveRunningRef.current = false
      setOneClickDerivePhase('')
    }
  }, [deriveCopyMode, derivePolicy, hasSubmitApiConfig, inputImages, prompt, setPrompt, showToast])

  const submitCurrentMode = useCallback(() => {
    if (appMode === 'agent') {
      void submitAgentMessage()
    } else if (gallerySopModeActive) {
      if (!activeGallerySop) {
        showToast('请先选择 SOP 预设', 'error')
        return
      }
      if (gallerySopIsRunning) {
        // 运行中点击 = 查看进度，必须呈现弹窗
        revealGallerySopBatch(gallerySopScopeKey)
        return
      }
      // 仅在用户已显式开启「自动生图」时静默执行：此时提示词无需人工确认，
      // 全程可在胶囊条观察进度。未开启则保留原有弹窗行为。
      openGallerySopBatch(true, gallerySopAutoGenerate)
      if (gallerySopAutoGenerate) {
        showToast(`已在后台生成 ${gallerySopPromptCount} 条提示词并陆续出图`, 'success')
      }
    } else if (maskDraft) {
      // 遮罩编辑优先：挂图 + 有遮罩草稿时走遮罩流程，不触发一键衍生
      void submitTask().then(
        () => {
          // 任务卡留在当前视图（对应文件夹）：不跳转、不切换作用域。
          // 生成中/失败/成功的任务卡都会在「任务卡片」视图的对应文件夹内持续显示（includeTaskless 机制）。
        },
        () => {
          // 提交失败已由 submitTask 内部 toast 反馈，这里只需吞掉 rejection 避免未处理告警
        },
      )
    } else if (oneClickDeriveEnabled && inputImages.length > 0) {
      // 一键衍生：挂图未选 SOP 时，自动反推变量提示词模板 → 保存为资产 → 自动批量出图
      void runOneClickDerive()
    } else {
      void submitTask().then(
        () => {
          // 任务卡留在当前视图（对应文件夹）：不跳转、不切换作用域。
          // 生成中/失败/成功的任务卡都会在「任务卡片」视图的对应文件夹内持续显示（includeTaskless 机制）。
        },
        () => {
          // 提交失败已由 submitTask 内部 toast 反馈，这里只需吞掉 rejection 避免未处理告警
        },
      )
    }
  }, [
    activeGallerySop,
    appMode,
    gallerySopAutoGenerate,
    gallerySopIsRunning,
    gallerySopModeActive,
    gallerySopPromptCount,
    gallerySopScopeKey,
    inputImages.length,
    maskDraft,
    oneClickDeriveEnabled,
    openGallerySopBatch,
    revealGallerySopBatch,
    runOneClickDerive,
    showToast,
  ])
  const stopActiveAgentResponse = useCallback(() => {
    stopAgentResponse(activeAgentConversationId)
  }, [activeAgentConversationId])
  const syncPromptFromContentEditable = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    isUserInputRef.current = true
    const range = getContentEditableSelection(el)
    setCursorPos(range.start)
    syncMentionTagSelection(el)
    setPrompt(getContentEditablePlainText(el))
  }, [setPrompt])
  useEffect(() => {
    const normalized = normalizePromptVariableMarkers(prompt, activeWordLibraryKeys)
    if (normalized === prompt) return
    isUserInputRef.current = false
    setPrompt(normalized)
  }, [activeWordLibraryKeys, prompt, setPrompt])
  const handleConvertToVariable = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) {
      showToast('请先选中要转换为变量的文字', 'info')
      return
    }
    const range = sel.getRangeAt(0)
    if (range.collapsed) {
      showToast('请先选中要转换为变量的文字', 'info')
      return
    }
    if (!el.contains(range.commonAncestorContainer)) {
      showToast('请先选中要转换为变量的文字', 'info')
      return
    }

    // 检查选中区域是否在 mention-tag 或 wildcard-var 内
    const startTag = range.startContainer.parentElement?.closest?.('.mention-tag, .wildcard-var')
    const endTag = range.endContainer.parentElement?.closest?.('.mention-tag, .wildcard-var')
    if (startTag || endTag) {
      showToast('已标记的变量不能重复转换', 'info')
      return
    }

    const selectedText = range.toString().trim()
    if (!selectedText) {
      showToast('请先选中要转换为变量的文字', 'info')
      return
    }

    // 划词时直接创建或复用词条，并写入绑定 entryId 的变量标记。
    // 不再依赖词条侧栏的异步订阅补建，避免未挂载或时序问题导致标记被清理。
    let entryId = wordLibraryEntries.find((entry) => entry.deletedAt == null && entry.key === selectedText)?.id
    if (!entryId) {
      const groupId =
        wordLibraryGroups.find((group) => group.id === 'default' && group.archivedAt == null)?.id ??
        wordLibraryGroups.find((group) => group.archivedAt == null)?.id ??
        createWordLibraryGroup('默认分组').id
      const entry = createWordLibraryEntry(groupId, selectedText)
      updateWordLibraryEntry(entry.id, { label: selectedText, entries: [selectedText] })
      entryId = entry.id
      showToast('已创建词条', 'success')
    }

    const varText = createVariableMention(selectedText, entryId)
    range.deleteContents()
    range.insertNode(document.createTextNode(varText))
    sel.removeAllRanges()

    // 同步到 store
    const plainText = getContentEditablePlainText(el)
    useStore.getState().setPrompt(plainText)
    setWordLibraryEditEntryId(entryId)
  }, [
    createWordLibraryEntry,
    createWordLibraryGroup,
    setWordLibraryEditEntryId,
    showToast,
    updateWordLibraryEntry,
    wordLibraryEntries,
    wordLibraryGroups,
  ])
  const handlePromptVariableContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = textareaRef.current
      if (!el) return

      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('.wildcard-var')
      if (!target || !el.contains(target)) return

      e.preventDefault()
      const offset = getVisibleOffsetBeforeNode(el, target)
      const nextPrompt = convertVariableMentionAtVisibleOffsetToText(prompt, offset)
      if (nextPrompt === prompt) return

      const varName = target.dataset.varName ?? target.textContent ?? ''
      isUserInputRef.current = false
      setPrompt(nextPrompt)
      window.setTimeout(() => {
        if (!textareaRef.current) return
        textareaRef.current.focus()
        setContentEditableCursor(textareaRef.current, offset + varName.length)
      }, 0)
    },
    [prompt, setPrompt],
  )
  const handlePromptVariableDragStart = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const el = textareaRef.current
    if (!el) return

    const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('.wildcard-var')
    if (!target || !el.contains(target)) return

    draggedVariableOffsetRef.current = getVisibleOffsetBeforeNode(el, target)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', target.dataset.varName ?? target.textContent ?? '')
  }, [])
  const handlePromptVariableDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (draggedVariableOffsetRef.current == null) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])
  const handlePromptVariableDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      const sourceOffset = draggedVariableOffsetRef.current
      draggedVariableOffsetRef.current = null
      if (sourceOffset == null) return

      const el = textareaRef.current
      if (!el) return

      e.preventDefault()
      const targetOffset = getContentEditableOffsetFromPoint(el, e.clientX, e.clientY)
      const nextPrompt = moveVariableMentionInPrompt(prompt, sourceOffset, targetOffset)
      if (nextPrompt === prompt) return

      isUserInputRef.current = false
      setPrompt(nextPrompt)
      window.setTimeout(() => {
        if (!textareaRef.current) return
        textareaRef.current.focus()
        setContentEditableCursor(
          textareaRef.current,
          Math.min(targetOffset, stripImageMentionMarkers(nextPrompt).length),
        )
      }, 0)
    },
    [prompt, setPrompt],
  )
  const handlePromptVariableDragEnd = useCallback(() => {
    draggedVariableOffsetRef.current = null
  }, [])
  const activeProvider = activeProfile.provider
  const isFalProvider = activeProvider === 'fal'
  const agentAutoImageCount =
    appMode === 'agent' && activeProfile.provider === 'openai' && activeProfile.apiMode === 'responses'
  const nLimitHintText = agentAutoImageCount
    ? 'Agent 模式下数量由模型根据提示词自动决定'
    : '可生成任意数量图片（最大并发 20）'
  const isFalTextToImage = isFalProvider && inputImages.length === 0
  const nDraftValue = Number(nInput)
  const effectiveNValue = Number.isNaN(nDraftValue) ? params.n : nDraftValue
  const streamConcurrentByN =
    activeProfile.provider === 'openai' &&
    activeProfile.streamImages === true &&
    !agentAutoImageCount &&
    effectiveNValue > 1
  const displaySize =
    isFalTextToImage && params.size === 'auto'
      ? DEFAULT_FAL_IMAGE_SIZE
      : normalizeImageSize(params.size) || DEFAULT_PARAMS.size
  const currentAspectRatio = params.size === 'auto' ? 'auto' : getAspectRatioFromSize(displaySize)
  const quickSizeValue =
    currentAspectRatio === 'auto' ||
    QUICK_ASPECT_RATIOS.includes(currentAspectRatio as (typeof QUICK_ASPECT_RATIOS)[number])
      ? currentAspectRatio
      : '__more-size-options__'
  const applyAspectRatio = useCallback(
    (ratio: string, size: string) => {
      setParams({ size })
      setPrompt(withAspectRatioPrompt(prompt, ratio))
    },
    [prompt, setParams, setPrompt],
  )

  // 变量提示词：实时解析「可变项」模板，驱动状态徽章与尺寸联动
  const variablePromptState = useMemo(() => parseVariablePrompt(prompt), [prompt])

  useEffect(() => {
    if (!variablePromptState.enabled || !variablePromptState.aspectRatio) return
    const size = calculateImageSize(inferSizeTier(params.size), variablePromptState.aspectRatio)
    if (!size || normalizeImageSize(params.size) === normalizeImageSize(size)) return
    setParams({ size })
  }, [params.size, setParams, variablePromptState.aspectRatio, variablePromptState.enabled])

  const qualityOptions = isFalProvider
    ? [
        { label: 'low', value: 'low' },
        { label: 'medium', value: 'medium' },
        { label: 'high', value: 'high' },
      ]
    : [
        { label: 'auto', value: 'auto' },
        { label: 'low', value: 'low' },
        { label: 'medium', value: 'medium' },
        { label: 'high', value: 'high' },
      ]
  const atImageLimit = !inputImageFolder && inputImages.length >= MAX_DIRECT_INPUT_IMAGES
  const uploadImageTooltipText = inputImageFolder
    ? '已选择图片文件夹'
    : atImageLimit
      ? `参考图数量已达上限（${MAX_DIRECT_INPUT_IMAGES} 张），无法继续添加`
      : '选择图片文件夹'
  const sizeHint = useTooltip({ enabled: () => isFalTextToImage })
  const nLimitHint = useTooltip({ autoHideMs: 2000 })
  const maskTargetImage = maskDraft ? (inputImages.find((img) => img.id === maskDraft.targetImageId) ?? null) : null
  const referenceImages = maskTargetImage ? inputImages.filter((img) => img.id !== maskTargetImage.id) : inputImages
  const cursorPosition = cursorPos
  const visiblePrompt = stripImageMentionMarkers(prompt)
  const agentOutputImageOptions = useMemo<AtImageOption[]>(() => {
    if (!activeAgentConversation) return []
    return getActiveAgentRounds(activeAgentConversation).flatMap((round) =>
      collectAgentRoundOutputImageSlots(round, tasks).flatMap((imageId, imageIndex) => {
        if (!imageId) return []
        const label = `@第${round.index}轮图${imageIndex + 1}`
        return {
          type: 'agent-output' as const,
          key: `agent-output:${round.id}:${imageIndex}:${imageId}`,
          label,
          imageId,
          insertText: label,
        }
      }),
    )
  }, [activeAgentConversation, tasks])
  const atImageSourceCount = inputImages.length + agentOutputImageOptions.length
  const atImageQuery = isCursorInSelectedImageMention(prompt, cursorPosition)
    ? null
    : getAtImageQuery(visiblePrompt, cursorPosition, { length: atImageSourceCount })
  const atImageOptions = atImageQuery
    ? [
        ...inputImages
          .map(
            (img, index) =>
              ({
                type: 'input',
                key: `input:${img.id}:${index}`,
                label: getImageMentionLabel(index),
                imageId: img.id,
                dataUrl: img.dataUrl,
                imageIndex: index,
              }) satisfies AtImageOption,
          )
          .filter((option) => imageMentionMatches(atImageQuery.query, option.imageIndex)),
        ...agentOutputImageOptions.filter((option) => agentImageMentionMatches(atImageQuery.query, option.label)),
      ]
    : []
  const showAtImageMenu = !atImageMenuDismissed && atImageOptions.length > 0

  const selectAtImageOption = useCallback(
    (option: AtImageOption) => {
      const el = textareaRef.current
      const cursor = el ? getContentEditableCursor(el) : prompt.length
      const query = getAtImageQuery(stripImageMentionMarkers(prompt), cursor, { length: atImageSourceCount })
      setAtImageMenuDismissed(true)
      setAtImageMenuIndex(0)
      if (!query) return

      const mentionText = option.type === 'input' ? getImageMentionLabel(option.imageIndex) : option.insertText
      const nextCursor = query.start + mentionText.length
      if (el) {
        el.focus()
        setContentEditableSelection(el, query.start, cursor)
        if (document.execCommand('insertHTML', false, getMentionTagHtml(mentionText))) {
          setContentEditableCursor(el, nextCursor)
          syncPromptFromContentEditable()
          return
        }
      }

      const next =
        option.type === 'input'
          ? insertImageMentionAtVisibleRange(prompt, query.start, cursor, option.imageIndex)
          : insertTextMentionAtVisibleRange(prompt, query.start, cursor, option.insertText)
      isUserInputRef.current = false
      setPrompt(next.prompt)
      window.setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus()
          setContentEditableCursor(textareaRef.current, next.cursor)
        }
      }, 0)
    },
    [atImageSourceCount, prompt, setPrompt, syncPromptFromContentEditable],
  )

  const insertPromptTextAtSelection = useCallback(
    (text: string) => {
      const el = textareaRef.current
      // 换行文本改用 state 渲染以避免 execCommand 插入 <br>/<div> 导致高度和换行异常
      if (el && !text.includes('\n')) {
        el.focus()
        if (document.execCommand('insertText', false, text)) {
          syncPromptFromContentEditable()
          return
        }
      }

      const selection = el ? getContentEditableSelection(el) : { start: prompt.length, end: prompt.length }
      const promptStart = getPromptIndexFromVisibleIndex(prompt, selection.start)
      const promptEnd = getPromptIndexFromVisibleIndex(prompt, selection.end)
      const nextPrompt = `${prompt.slice(0, promptStart)}${text}${prompt.slice(promptEnd)}`
      const nextCursor = selection.start + text.length
      isUserInputRef.current = false
      setPrompt(nextPrompt)
      window.setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus()
          setContentEditableCursor(textareaRef.current, nextCursor)
        }
      }, 0)
    },
    [prompt, setPrompt, syncPromptFromContentEditable],
  )

  const handleClearPrompt = useCallback(() => {
    isUserInputRef.current = false
    setPrompt('')
    if (textareaRef.current) {
      textareaRef.current.innerHTML = ''
      textareaRef.current.focus()
    }
  }, [setPrompt])

  useEffect(() => {
    if (params.output_compression != null) {
      setParams({ output_compression: null })
    }
  }, [params.output_compression, setParams])

  useEffect(() => {
    setPostprocessMaxSizeInput(params.postprocess_max_size_kb == null ? '' : String(params.postprocess_max_size_kb))
  }, [params.postprocess_max_size_kb])

  useEffect(() => {
    setNInput(agentAutoImageCount ? 'auto' : String(params.n))
  }, [agentAutoImageCount, params.n])

  // 移除自动规范化参数的功能，让用户设置的参数保持不变

  useEffect(
    () => () => {
      if (imageHintTimerRef.current != null) {
        window.clearTimeout(imageHintTimerRef.current)
      }
      imageHintReleaseRef.current?.()
    },
    [],
  )

  useEffect(() => {
    let cancelled = false
    if (!maskDraft || !maskTargetImage) {
      setMaskPreviewUrl('')
      return
    }

    createMaskPreviewDataUrl(maskTargetImage.dataUrl, maskDraft.maskDataUrl)
      .then((url) => {
        if (!cancelled) setMaskPreviewUrl(url)
      })
      .catch(() => {
        if (!cancelled) setMaskPreviewUrl('')
      })

    return () => {
      cancelled = true
    }
  }, [maskDraft, maskTargetImage?.id, maskTargetImage?.dataUrl])

  const commitPostprocessMaxSize = useCallback(() => {
    if (postprocessMaxSizeInput.trim() === '') {
      setPostprocessMaxSizeInput('')
      setParams({ postprocess_max_size_kb: null })
      return
    }

    const nextValue = Number(postprocessMaxSizeInput)
    if (!Number.isFinite(nextValue) || nextValue < 1) {
      setPostprocessMaxSizeInput(params.postprocess_max_size_kb == null ? '' : String(params.postprocess_max_size_kb))
      return
    }

    setPostprocessMaxSizeInput(String(Math.round(nextValue)))
    setParams({ postprocess_max_size_kb: Math.round(nextValue) })
  }, [params.postprocess_max_size_kb, postprocessMaxSizeInput, setParams])

  const commitN = useCallback(() => {
    nLimitHint.hide()
    if (agentAutoImageCount) {
      setNInput('auto')
      return
    }
    const nextValue = Number(nInput)
    const normalizedValue = nInput.trim() === '' ? DEFAULT_PARAMS.n : Number.isNaN(nextValue) ? params.n : nextValue
    const clampedValue = Math.max(1, normalizedValue)
    setNInput(String(clampedValue))
    setParams({ n: clampedValue })
  }, [agentAutoImageCount, nInput, params.n, setParams])

  const showNLimitHint = useCallback(() => {
    nLimitHint.show()
  }, [nLimitHint])

  const hideNLimitHint = useCallback(() => {
    nLimitHint.hide()
  }, [nLimitHint])

  const showAgentNHint = useCallback(() => {
    if (agentAutoImageCount) showNLimitHint()
  }, [agentAutoImageCount, showNLimitHint])

  const clearAgentNHintTouchTimer = useCallback(() => {
    nLimitHint.clearTimer()
  }, [nLimitHint])

  const startAgentNHintTouch = useCallback(() => {
    if (!agentAutoImageCount) return
    nLimitHint.startTouch()
  }, [agentAutoImageCount, nLimitHint])

  const handleNInputChange = useCallback(
    (value: string) => {
      if (agentAutoImageCount) {
        setNInput('auto')
        return
      }
      setNInput(value)
    },
    [agentAutoImageCount],
  )

  const handleNLimitIncreaseAttempt = useCallback(
    (preventDefault: () => void) => {
      if (agentAutoImageCount) {
        preventDefault()
        showNLimitHint()
      }
    },
    [agentAutoImageCount, showNLimitHint],
  )

  const clearImageHintTimer = () => {
    if (imageHintTimerRef.current != null) {
      window.clearTimeout(imageHintTimerRef.current)
      imageHintTimerRef.current = null
    }
  }

  const showImageHint = (id: string) => setImageHintId(id)

  const hideImageHint = () => {
    if (imageHintLockedRef.current) return
    setImageHintId(null)
    clearImageHintTimer()
  }

  const hideLockedImageHint = () => {
    imageHintLockedRef.current = false
    imageHintReleaseRef.current?.()
    imageHintReleaseRef.current = null
    setImageHintId(null)
    clearImageHintTimer()
  }

  const showImageHintUntilRelease = (id: string) => {
    if (imageHintLockedRef.current) {
      setImageHintId(id)
      return
    }
    imageHintLockedRef.current = true
    setImageHintId(id)
    const release = () => {
      window.removeEventListener('mouseup', release)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('dragend', release)
      if (imageHintReleaseRef.current === release) {
        imageHintReleaseRef.current = null
        imageHintLockedRef.current = false
        setImageHintId(null)
        clearImageHintTimer()
      }
    }
    imageHintReleaseRef.current = release
    window.addEventListener('mouseup', release)
    window.addEventListener('pointerup', release)
    window.addEventListener('dragend', release)
  }

  const handleFiles = async (files: FileList | File[]) => {
    try {
      // 拖拽上传时清空文件夹模式
      useStore.getState().setInputImageFolder(null)

      const currentCount = useStore.getState().inputImages.length
      if (currentCount >= MAX_DIRECT_INPUT_IMAGES) {
        useStore.getState().showToast(`参考图数量已达上限（${MAX_DIRECT_INPUT_IMAGES} 张），无法继续添加`, 'error')
        return
      }

      const remaining = MAX_DIRECT_INPUT_IMAGES - currentCount
      const accepted = Array.from(files).filter((f) => f.type.startsWith('image/'))
      const toAdd = accepted.slice(0, remaining)
      const discarded = accepted.length - toAdd.length

      for (const file of toAdd) {
        await addImageFromFile(file)
      }

      if (discarded > 0) {
        useStore.getState().showToast(`已达上限 ${MAX_DIRECT_INPUT_IMAGES} 张，${discarded} 张图片被丢弃`, 'error')
      }
    } catch (err) {
      useStore.getState().showToast(`图片添加失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  const handleFilesRef = useRef(handleFiles)
  handleFilesRef.current = handleFiles

  const openReplaceReferenceFilePicker = useCallback((idx: number, imageId: string) => {
    replaceImageTargetRef.current = { index: idx, id: imageId }
    replaceFileInputRef.current?.click()
  }, [])

  const commitReferenceEditChoice = useCallback(
    (choice: 'replace-reference' | 'add-mask', remember?: boolean) => {
      if (remember) setSettings({ referenceImageEditAction: choice })
    },
    [setSettings],
  )

  const handleEditReferenceImage = useCallback(
    (img: (typeof inputImages)[number], idx: number, isMaskTarget: boolean) => {
      if (isMaskTarget) {
        setMaskEditorImageId(img.id)
        return
      }

      if (settings.referenceImageEditAction === 'replace-reference') {
        openReplaceReferenceFilePicker(idx, img.id)
        return
      }

      if (settings.referenceImageEditAction === 'add-mask') {
        setMaskEditorImageId(img.id)
        return
      }

      setConfirmDialog({
        title: '编辑参考图',
        message: '请选择这次要执行的操作。若不勾选下方的选项，则每次都询问；勾选后可在 **设置-习惯配置** 修改选择。',
        checkbox: { label: '以后默认执行此选择' },
        buttons: [
          {
            label: '替换参考图',
            tone: 'secondary',
            action: (remember) => {
              commitReferenceEditChoice('replace-reference', remember)
              openReplaceReferenceFilePicker(idx, img.id)
            },
          },
          {
            label: '添加遮罩',
            tone: 'primary',
            action: (remember) => {
              commitReferenceEditChoice('add-mask', remember)
              setMaskEditorImageId(img.id)
            },
          },
        ],
      })
    },
    [
      commitReferenceEditChoice,
      openReplaceReferenceFilePicker,
      setConfirmDialog,
      setMaskEditorImageId,
      settings.referenceImageEditAction,
    ],
  )

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await handleFilesRef.current(e.target.files || [])
    e.target.value = ''
  }

  const loadFolderImages = async (folderPath: string, isReload = false) => {
    try {
      const files = await readDirectory(folderPath)
      const imageFiles = files.filter((f) => /\.(jpe?g|png|gif|webp|bmp)$/i.test(f)).sort((a, b) => a.localeCompare(b))

      if (imageFiles.length === 0) {
        showToast('文件夹内没有图片文件', 'error')
        return
      }

      const toRead = imageFiles.slice(0, MAX_FOLDER_IMAGES)
      const imageIds: string[] = []

      for (const fileName of toRead) {
        const filePath = await joinPath(folderPath, fileName)
        const result = await readFileBuffer(filePath)
        if (!result) continue

        const bytes = new Uint8Array(result.data)
        let binary = ''
        for (let i = 0; i < bytes.length; i += 0x8000) {
          const chunk = bytes.subarray(i, i + 0x8000)
          binary += String.fromCharCode(...chunk)
        }
        const ext = fileName.split('.').pop()?.toLowerCase() || 'png'
        const mime =
          ext === 'jpg' || ext === 'jpeg'
            ? 'image/jpeg'
            : ext === 'webp'
              ? 'image/webp'
              : ext === 'gif'
                ? 'image/gif'
                : 'image/png'
        const dataUrl = `data:${mime};base64,${btoa(binary)}`
        const id = await computeContentHash(dataUrl)
        await storeImage(dataUrl)
        imageIds.push(id)
        // 缓存到内存，避免后续 ensureImageCached 时从 IndexedDB 读取
        const { cacheImage } = await import('../store')
        cacheImage(id, dataUrl)
      }

      if (imageIds.length === 0) {
        showToast('无法读取文件夹中的图片', 'error')
        return
      }

      setInputImageFolder({ path: folderPath, imageIds })

      if (imageFiles.length > MAX_FOLDER_IMAGES) {
        showToast(`文件夹图片过多，已读取前 ${MAX_FOLDER_IMAGES} 张`, 'info')
      } else {
        showToast(isReload ? `已重新读取 ${imageIds.length} 张图片` : `已读取 ${imageIds.length} 张图片`, 'success')
      }
    } catch (err) {
      showToast(
        `${isReload ? '重新加载' : '选择'}文件夹失败：${err instanceof Error ? err.message : String(err)}`,
        'error',
      )
    }
  }

  const handleSelectFolder = async () => {
    try {
      const folderPath = await selectLocalSaveDirectory()
      if (!folderPath) return
      await loadFolderImages(folderPath)
    } catch (err) {
      showToast(`选择文件夹失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  const handlePickOutputPath = async () => {
    try {
      const dir = await selectLocalSaveDirectory()
      if (dir) {
        setCustomOutputPath(dir)
        showToast('已切换为自定义输出', 'success')
      }
    } catch (err) {
      showToast(`选择输出目录失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  const handleReplaceFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    const target = replaceImageTargetRef.current
    replaceImageTargetRef.current = null
    if (!file || !target) return

    try {
      const image = await createInputImageFromFile(file)
      if (!image) {
        showToast('请选择有效图片', 'error')
        return
      }

      const currentImages = useStore.getState().inputImages
      const currentIdx = currentImages.findIndex((item) => item.id === target.id)
      const targetIdx = currentIdx >= 0 ? currentIdx : target.index
      const previous = currentImages[targetIdx]
      if (!previous) {
        void deleteImageIfUnreferenced(image.id)
        showToast('原参考图已不存在', 'error')
        return
      }
      if (previous.id === image.id) {
        showToast('参考图未变化', 'info')
        return
      }
      if (currentImages.some((item, itemIdx) => itemIdx !== targetIdx && item.id === image.id)) {
        showToast('这张图片已在参考图中', 'info')
        return
      }

      replaceInputImage(targetIdx, image)
      showToast('参考图已替换', 'success')
    } catch (err) {
      showToast(`参考图替换失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (showAtImageMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setAtImageMenuIndex((idx) => (idx + 1) % atImageOptions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setAtImageMenuIndex((idx) => (idx - 1 + atImageOptions.length) % atImageOptions.length)
        return
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault()
        selectAtImageOption(atImageOptions[atImageMenuIndex] ?? atImageOptions[0])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setAtImageMenuIndex(0)
        textareaRef.current?.blur()
        return
      }
    }

    // 阻止 contentEditable 默认换行
    if (e.key === 'Enter') {
      e.preventDefault()

      const isModifier = e.ctrlKey || e.metaKey

      if (settings.enterSubmit) {
        if (e.shiftKey) {
          insertPromptTextAtSelection('\n')
        } else if (!isModifier) {
          if (canSubmit) submitCurrentMode()
        }
      } else {
        if (isModifier) {
          if (canSubmit) submitCurrentMode()
        } else {
          insertPromptTextAtSelection('\n')
        }
      }
      return
    }
  }

  const handlePromptPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    if (Array.from(e.clipboardData.items).some((item) => item.type.startsWith('image/'))) return

    e.preventDefault()
    insertPromptTextAtSelection(text.replace(/\r\n?/g, '\n'))
  }

  const handlePromptCopy = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const el = textareaRef.current
    if (!el) return

    const selection = getContentEditableSelection(el)
    if (selection.start === selection.end) return

    const promptStart = getPromptIndexFromVisibleIndex(prompt, selection.start)
    const promptEnd = getPromptIndexFromVisibleIndex(prompt, selection.end)
    const text = stripImageMentionMarkers(prompt.slice(promptStart, promptEnd))
    const copyText = /^\s*@图\d+\s*$/.test(text) ? text.trim() : text

    e.preventDefault()
    e.clipboardData.setData('text/plain', copyText)
  }

  // 粘贴图片
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (document.querySelector('[data-block-global-image-input="true"]')) return
      const items = e.clipboardData?.items
      if (!items) return
      const imageFiles: File[] = []
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) imageFiles.push(file)
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault()
        handleFilesRef.current(imageFiles)
      }
    }
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [])

  // 拖拽图片 - 监听整个页面
  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      if (document.querySelector('[data-block-global-image-input="true"]')) {
        dragCounter.current = 0
        setIsDragging(false)
        return
      }
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current++
      if (e.dataTransfer?.types.includes('Files')) {
        setIsDragging(true)
      }
    }

    const handleDragOver = (e: DragEvent) => {
      if (document.querySelector('[data-block-global-image-input="true"]')) return
      e.preventDefault()
      e.stopPropagation()
      // 拖入输入框 = 作为参考图（复制语义，不移动素材）；素材拖到侧栏文件夹由树节点自行改为 move
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }

    const handleDragLeave = (e: DragEvent) => {
      if (document.querySelector('[data-block-global-image-input="true"]')) return
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current--
      if (dragCounter.current === 0) {
        setIsDragging(false)
      }
    }

    const handleDrop = (e: DragEvent) => {
      if (document.querySelector('[data-block-global-image-input="true"]')) {
        dragCounter.current = 0
        setIsDragging(false)
        return
      }
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current = 0
      setIsDragging(false)
      const files = e.dataTransfer?.files
      if (files && files.length > 0) {
        handleFilesRef.current(files)
        return
      }

      const transferredText = e.dataTransfer?.getData('text/plain')

      const imageIds = transferredText?.startsWith('agent-images:')
        ? transferredText.slice('agent-images:'.length).split(',')
        : transferredText?.startsWith('agent-image:')
          ? [transferredText.slice('agent-image:'.length)]
          : transferredText?.startsWith('asset-image:')
            ? [transferredText.slice('asset-image:'.length)]
            : []

      if (imageIds.length > 0) {
        const state = useStore.getState()
        state.setInputImageFolder(null)
        const existingIds = new Set(state.inputImages.map((image) => image.id))
        const uniqueIds = Array.from(new Set(imageIds)).filter((imageId) => !existingIds.has(imageId))
        const remaining = Math.max(0, MAX_DIRECT_INPUT_IMAGES - state.inputImages.length)
        const toAdd = uniqueIds.slice(0, remaining)
        const discarded = uniqueIds.length - toAdd.length
        Promise.all(
          toAdd.map(async (imageId) => {
            const dataUrl = await ensureImageCached(imageId)
            if (!dataUrl) {
              showToast('部分图片已不存在', 'error')
              return
            }
            addInputImage({ id: imageId, dataUrl })
          }),
        )
          .then(() => {
            if (discarded > 0) {
              showToast(`已达上限 ${MAX_DIRECT_INPUT_IMAGES} 张，${discarded} 张图片未添加`, 'error')
            } else if (toAdd.length > 0) {
              showToast(`已添加 ${toAdd.length} 张图片`, 'success')
            }
          })
          .catch((err) => showToast(`上传图片失败：${err instanceof Error ? err.message : String(err)}`, 'error'))
      }
    }

    document.addEventListener('dragenter', handleDragEnter)
    document.addEventListener('dragover', handleDragOver)
    document.addEventListener('dragleave', handleDragLeave)
    document.addEventListener('drop', handleDrop)

    return () => {
      document.removeEventListener('dragenter', handleDragEnter)
      document.removeEventListener('dragover', handleDragOver)
      document.removeEventListener('dragleave', handleDragLeave)
      document.removeEventListener('drop', handleDrop)
    }
  }, [addInputImage, showToast])

  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return

    // 计算图片区域等固定高度
    const imagesHeight = imagesRef.current?.offsetHeight ?? 0
    const fixedOverhead = imagesHeight + 140

    // 最大高度限制在页面 40% 减固定开销，不小于 80px
    const maxH = Math.max(window.innerHeight * 0.4 - fixedOverhead, 80)

    // 1. 清零高度以获取真实文本高度
    el.style.transition = 'none'
    el.style.height = '0'
    el.style.overflowY = 'hidden'
    const scrollH = el.scrollHeight

    const placeholderEl = el.parentElement?.querySelector('.prompt-placeholder')
    const placeholderH = placeholderEl ? placeholderEl.scrollHeight : 0
    const minH = Math.max(42, placeholderH)

    const desired = Math.max(scrollH, minH)
    const targetH = desired > maxH ? maxH : desired

    // 判断是否为单行
    setIsSingleLine(desired <= minH)

    // 2. 回设旧高度并重绘以准备触发动画
    el.style.height = prevHeightRef.current + 'px'
    void el.offsetHeight

    // 3. 恢复平滑过渡并设置新目标高度
    el.style.transition = 'height 150ms ease, border-color 200ms, box-shadow 200ms'
    el.style.height = targetH + 'px'
    el.style.overflowY = desired > maxH ? 'auto' : 'hidden'

    prevHeightRef.current = targetH
  }, [])

  // 同步 prompt 至 contentEditable
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    // 输入时不重复渲染以防光标跳动
    if (isUserInputRef.current) {
      isUserInputRef.current = false
      return
    }
    const currentColorMap = VAR_COLOR_MAP // capture latest value
    const parts = getPromptMentionParts(prompt, inputImages)
    const html = prompt
      ? parts
          .map((part) => {
            if (part.type === 'mention') {
              const mentionText = part.mentionText ?? getSelectedImageMentionLabel(part.imageIndex ?? 0)
              return `<span contenteditable="false" class="mention-tag" data-mention-text="${escapePromptHtmlAttribute(mentionText)}">${escapePromptHtmlText(part.text)}</span>`
            }
            if (part.type === 'variable') {
              const color = currentColorMap[part.varName] ?? ''
              if (!color) return escapePromptHtmlText(part.text)
              const style = color
                ? `style="background:${color}18;color:${color};border-color:${color};--var-bg:${color}18;--var-text:${color};--var-border:${color};--var-bg-hover:${color}28;--var-bg-selected:${color};--var-text-selected:#fff;--var-border-selected:${color}"`
                : ''
              return `<span contenteditable="false" draggable="true" class="wildcard-var" data-var-name="${escapePromptHtmlAttribute(part.varName)}"${part.entryId ? ` data-entry-id="${escapePromptHtmlAttribute(part.entryId)}"` : ''} ${style}>${escapePromptHtmlText(part.text)}</span>`
            }
            return escapePromptHtmlText(part.text)
          })
          .join('')
      : ''
    if (el.innerHTML !== html) {
      el.innerHTML = html
    }
  }, [prompt, inputImages, VAR_COLOR_MAP])

  // 补 <br> 哨兵避免 pre-wrap 吃掉行尾 \n，同时不影响纯文本读取。
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    const last = el.lastChild
    const hasSentinel = last instanceof HTMLBRElement && last.dataset.sentinelBr === 'true'
    const needSentinel = prompt.endsWith('\n')
    if (needSentinel && !hasSentinel) {
      const br = document.createElement('br')
      br.dataset.sentinelBr = 'true'
      el.appendChild(br)
    } else if (!needSentinel && hasSentinel) {
      last.remove()
    }
  }, [prompt, inputImages])

  useEffect(() => {
    adjustTextareaHeight()
  }, [prompt, inputImages, adjustTextareaHeight, isMobile, mobileCollapsed])

  // 监听 selectionchange 更新光标位置（onSelect 在 contentEditable 下不可靠）
  useEffect(() => {
    const handleSelectionChange = () => {
      const el = textareaRef.current
      if (!el) return
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return

      const domRange = sel.getRangeAt(0)
      try {
        if (!domRange.intersectsNode(el)) {
          syncMentionTagSelection(el)
          return
        }
      } catch {
        return
      }

      const range = getContentEditableSelection(el)
      setCursorPos(range.start)
      syncMentionTagSelection(el)

      const rangeRect = domRange.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      if (rangeRect.width === 0 && rangeRect.height === 0) return
      setMenuLeft(rangeRect.left - elRect.left)
    }
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  }, [])

  // 点击外部时使 input 栏失焦
  useEffect(() => {
    const handleGlobalMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return

      if (document.activeElement instanceof HTMLElement) {
        // 若当前聚焦在输入栏内
        if (document.activeElement.closest('[data-input-bar]')) {
          // 若点击在输入栏外部
          if (!target.closest('[data-input-bar]')) {
            document.activeElement.blur()
          }
        }
      }
    }

    document.addEventListener('mousedown', handleGlobalMouseDown, true)
    return () => {
      document.removeEventListener('mousedown', handleGlobalMouseDown, true)
    }
  }, [])
  useEffect(() => {
    adjustTextareaHeight()
  }, [inputImages.length, Boolean(maskDraft), maskPreviewUrl, adjustTextareaHeight])

  useEffect(() => {
    window.addEventListener('resize', adjustTextareaHeight)
    return () => window.removeEventListener('resize', adjustTextareaHeight)
  }, [adjustTextareaHeight])

  // 移动端拖动条手势
  useEffect(() => {
    const el = handleRef.current
    if (!el) return
    const onTouchStart = (e: TouchEvent) => {
      dragTouchRef.current = { startY: e.touches[0].clientY, moved: false }
    }
    const onTouchMove = (e: TouchEvent) => {
      const dy = e.touches[0].clientY - dragTouchRef.current.startY
      if (Math.abs(dy) > 10) dragTouchRef.current.moved = true
      if (dy > 30) setMobileCollapsed(true)
      if (dy < -30) setMobileCollapsed(false)
    }
    const onTouchEnd = () => {
      if (dragTouchRef.current.moved) {
        suppressHandleClickUntilRef.current = Date.now() + 500
      }
    }
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('touchend', onTouchEnd)
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  const selectClass =
    'h-ds-control-md px-3 rounded-ds-lg border border-ds-border/60 dark:border-ds-border bg-ds-surface/50 dark:bg-ds-surface hover:bg-ds-surface dark:hover:bg-ds-surface text-xs text-ds-text transition duration-200 shadow-sm'

  const getTouchDropIndex = (touch: React.Touch) => {
    const target = document
      .elementFromPoint(touch.clientX, touch.clientY)
      ?.closest<HTMLElement>('[data-input-image-index]')
    if (!target) return null
    const idx = Number(target.dataset.inputImageIndex)
    if (!Number.isInteger(idx)) return null
    const rect = getSafeBoundingClientRect(target)
    if (!rect) return null
    return touch.clientX < rect.left + rect.width / 2 ? idx : idx + 1
  }

  const normalizeImageDropIndex = (idx: number) => {
    const minIdx = maskTargetImage ? 1 : 0
    return Math.max(minIdx, Math.min(inputImages.length, idx))
  }

  const isBeforeMaskDropArea = (clientX: number) => {
    if (!maskTargetImage) return false
    const maskEl = document.querySelector<HTMLElement>('[data-input-image-index="0"]')
    if (!maskEl) return false
    const rect = getSafeBoundingClientRect(maskEl)
    if (!rect) return false
    return clientX < rect.left + rect.width / 2
  }

  const resetImageDrag = () => {
    setImageDragIndex(null)
    setImageDragOverIndex(null)
    imageDragIndexRef.current = null
    imageDragOverIndexRef.current = null
    imageTouchDragRef.current = { index: null, startX: 0, startY: 0, moved: false }
    setTouchDragPreview(null)
    imageDragPreviewRef.current?.remove()
    imageDragPreviewRef.current = null
    hideImageHint()
  }

  useEffect(() => {
    if (!touchDragPreview) return
    const previousOverflow = document.body.style.overflow
    const previousOverscroll = document.body.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousOverscroll
    }
  }, [touchDragPreview])

  const getDataTransferDragIndex = (e: React.DragEvent) => {
    const value = e.dataTransfer.getData('text/plain')
    const idx = Number(value)
    return Number.isInteger(idx) ? idx : null
  }

  const setImageDragTarget = (idx: number | null, clientX?: number) => {
    const fromIdx = imageDragIndexRef.current
    if (fromIdx !== null && maskTargetImage && (idx === 0 || (clientX != null && isBeforeMaskDropArea(clientX)))) {
      showImageHint(maskTargetImage.id)
      imageDragOverIndexRef.current = null
      setImageDragOverIndex(null)
      return
    }

    if (fromIdx !== null) hideImageHint()
    const normalizedIdx = idx == null ? null : normalizeImageDropIndex(idx)
    const isNoopTarget =
      fromIdx !== null && normalizedIdx !== null && (normalizedIdx === fromIdx || normalizedIdx === fromIdx + 1)
    const nextIdx = isNoopTarget ? null : normalizedIdx
    imageDragOverIndexRef.current = nextIdx
    setImageDragOverIndex(nextIdx)
  }

  const renderImageThumb = (img: (typeof inputImages)[number], idx: number) => {
    const isMaskTarget = maskDraft?.targetImageId === img.id
    const canEdit = !maskTargetImage || isMaskTarget
    const imageHintText = isMaskTarget ? '遮罩图必须为第一张图' : ''
    const displaySrc = isMaskTarget && maskPreviewUrl ? maskPreviewUrl : img.dataUrl
    const isImageDragging = imageDragIndex === idx
    const isLast = idx === inputImages.length - 1
    const showDropBefore = imageDragOverIndex === idx && imageDragIndex !== idx
    const showDropAfter = imageDragOverIndex === inputImages.length && isLast && imageDragIndex !== idx

    const handleDragStart = (e: React.DragEvent) => {
      if (isMaskTarget) {
        showImageHintUntilRelease(img.id)
        e.preventDefault()
        return
      }
      hideImageHint()
      imageDragIndexRef.current = idx
      setImageDragIndex(idx)
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(idx))
      const preview = document.createElement('div')
      preview.style.cssText =
        'position:fixed;left:-1000px;top:-1000px;width:52px;height:52px;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.25);'
      const previewImg = document.createElement('img')
      previewImg.src = displaySrc
      previewImg.style.cssText = 'width:52px;height:52px;object-fit:cover;display:block;'
      preview.appendChild(previewImg)
      document.body.appendChild(preview)
      imageDragPreviewRef.current = preview
      e.dataTransfer.setDragImage(preview, 26, 26)
    }

    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const fromIdx = imageDragIndexRef.current
      if (fromIdx === null || fromIdx === idx) return
      const rect = getSafeBoundingClientRect(e.currentTarget)
      if (!rect) return
      setImageDragTarget(e.clientX < rect.left + rect.width / 2 ? idx : idx + 1, e.clientX)
    }

    const handleDrop = (e: React.DragEvent) => {
      e.preventDefault()
      const fromIdx = imageDragIndexRef.current ?? getDataTransferDragIndex(e)
      const toIdx = imageDragOverIndexRef.current
      if (fromIdx !== null && toIdx !== null) {
        moveInputImage(fromIdx, toIdx)
      }
      resetImageDrag()
    }

    const handleTouchStart = (e: React.TouchEvent) => {
      if (isMaskTarget) {
        const touch = e.touches[0]
        imageTouchDragRef.current = { index: idx, startX: touch.clientX, startY: touch.clientY, moved: false }
        return
      }
      const touch = e.touches[0]
      imageDragIndexRef.current = idx
      imageTouchDragRef.current = { index: idx, startX: touch.clientX, startY: touch.clientY, moved: false }
      setTouchDragPreview(null)
    }

    const handleTouchMove = (e: React.TouchEvent) => {
      const touch = e.touches[0]
      const touchDrag = imageTouchDragRef.current
      if (touchDrag.index === null) return

      if (isMaskTarget) {
        if (Math.abs(touch.clientX - touchDrag.startX) > 6 || Math.abs(touch.clientY - touchDrag.startY) > 6) {
          e.preventDefault()
          showImageHintUntilRelease(img.id)
        }
        return
      }

      touchDrag.moved = true
      clearImageHintTimer()
      setImageHintId(null)
      suppressImageClickRef.current = true
      e.preventDefault()
      setImageDragIndex(touchDrag.index)
      setTouchDragPreview({ src: displaySrc, x: touch.clientX, y: touch.clientY })
      const dropIndex = getTouchDropIndex(touch)
      setImageDragTarget(dropIndex, touch.clientX)
    }

    const handleTouchEnd = (e: React.TouchEvent) => {
      const touchDrag = imageTouchDragRef.current
      clearImageHintTimer()
      if (touchDrag.index !== null && imageDragOverIndexRef.current !== null) {
        e.preventDefault()
        moveInputImage(touchDrag.index, imageDragOverIndexRef.current)
        window.setTimeout(() => {
          suppressImageClickRef.current = false
        }, 0)
      }
      resetImageDrag()
      hideLockedImageHint()
    }

    const handleTouchCancel = () => {
      suppressImageClickRef.current = false
      hideLockedImageHint()
      resetImageDrag()
    }

    return (
      <div
        key={img.id}
        data-input-image-index={idx}
        className={`relative group inline-block h-ds-52 w-ds-52 shrink-0 self-start transition-opacity ${isImageDragging ? 'opacity-40' : ''}`}
        style={{ touchAction: isMaskTarget ? 'auto' : 'none' }}
        draggable={!isMobile}
        onMouseLeave={hideImageHint}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragEnd={resetImageDrag}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        onContextMenu={(e) => {
          e.preventDefault()
          const el = textareaRef.current
          const cursor = el ? getContentEditableCursor(el) : prompt.length
          if (el) {
            el.focus()
            setContentEditableCursor(el, cursor)
            if (document.execCommand('insertHTML', false, getMentionTagHtml(getImageMentionLabel(idx)))) {
              syncPromptFromContentEditable()
              return
            }
          }
          const next = insertImageMentionAtVisibleRange(prompt, cursor, cursor, idx)
          isUserInputRef.current = false
          setPrompt(next.prompt)
          window.setTimeout(() => {
            if (textareaRef.current) {
              textareaRef.current.focus()
              setContentEditableCursor(textareaRef.current, next.cursor)
            }
          }, 0)
        }}
      >
        <ButtonTooltip
          visible={imageHintId === img.id && Boolean(imageHintText) && (!isMobile || isMaskTarget)}
          text={imageHintText}
        />
        {showDropBefore && (
          <div className="absolute -left-[5px] top-0 bottom-0 w-[2px] bg-ds-primary rounded-full z-sticky shadow-sm pointer-events-none" />
        )}
        {showDropAfter && (
          <div className="absolute -right-[5px] top-0 bottom-0 w-[2px] bg-ds-primary rounded-full z-sticky shadow-sm pointer-events-none" />
        )}
        <div
          className={`relative w-ds-52 h-ds-52 rounded-ds-lg overflow-hidden shadow-sm cursor-grab active:cursor-grabbing select-none ${
            isMaskTarget ? 'border-2 border-ds-primary' : 'border border-ds-border dark:border-ds-border'
          }`}
          onClick={() => {
            if (suppressImageClickRef.current) return
            if (isMaskTarget) {
              setMaskEditorImageId(img.id)
              return
            }
            if (maskTargetImage && !maskConflictNoticeShownRef.current) {
              maskConflictNoticeShownRef.current = true
              showToast('只能有一张遮罩图', 'info')
            }
            setLightboxImageId(
              img.id,
              inputImages.map((i) => i.id),
            )
          }}
        >
          {displaySrc && (
            <div className="h-full w-full overflow-hidden rounded-ds-lg">
              <img
                src={displaySrc}
                className="w-full h-full object-cover hover:opacity-90 transition-opacity pointer-events-none"
                alt=""
              />
            </div>
          )}
          {isMaskTarget && (
            <span className="absolute left-1 top-1 rounded bg-ds-primary/90 px-1.5 py-0.5 text-xs leading-none text-white font-bold tracking-wider backdrop-blur-sm z-10 pointer-events-none">
              MASK
            </span>
          )}
          <span className="absolute bottom-1 left-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/55 text-xs font-semibold text-white backdrop-blur-sm z-10 pointer-events-none">
            {idx + 1}
          </span>
          {canEdit && (
            <button
              className="absolute inset-0 w-full h-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer z-20 focus:outline-none border-none"
              onClick={(e) => {
                e.stopPropagation()
                handleEditReferenceImage(img, idx, isMaskTarget)
              }}
              title={isMaskTarget ? '编辑遮罩' : '编辑'}
            >
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                />
              </svg>
            </button>
          )}
        </div>
        {!isMaskTarget && (
          <span
            className="absolute right-0 top-0 flex h-5 w-5 translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-ds-danger text-ds-text-inverse opacity-0 shadow-md transition-opacity hover:bg-ds-danger-hover group-hover:opacity-100 z-30"
            onClick={(e) => {
              e.stopPropagation()
              removeInputImage(idx)
            }}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </span>
        )}
      </div>
    )
  }

  const renderClearAllButton = () => (
    <button
      onClick={() =>
        setConfirmDialog({
          title: maskTargetImage ? '清空全部输入图' : '清空参考图',
          message: maskTargetImage
            ? `确定要清空遮罩主图、${referenceImages.length} 张参考图和当前遮罩吗？`
            : `确定要清空全部 ${inputImages.length} 张参考图吗？`,
          action: () => clearInputImages(),
        })
      }
      className="w-ds-52 h-ds-52 rounded-ds-lg border border-dashed border-ds-border dark:border-ds-border flex flex-col items-center justify-center gap-0.5 text-ds-muted dark:text-ds-muted hover:text-ds-danger hover:border-ds-danger/35 hover:bg-ds-danger-subtle/50 dark:hover:bg-ds-danger/30 transition cursor-pointer flex-shrink-0"
      title={maskTargetImage ? '清空遮罩主图、参考图和遮罩' : '清空全部参考图'}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
        />
      </svg>
      <span className="text-xs leading-none">{maskTargetImage ? '清空全部' : '清空'}</span>
    </button>
  )

  const renderImageThumbs = () => {
    return (
      <div ref={imagesRef}>
        <div className="grid grid-cols-[repeat(auto-fill,52px)] justify-between gap-x-2 gap-y-3 mb-3">
          {inputImages.map((img, idx) => renderImageThumb(img, idx))}
          {renderClearAllButton()}
        </div>
        {touchDragPreview?.src &&
          createPortal(
            <div
              className="fixed z-[var(--ds-z-tooltip)] h-ds-52 w-ds-52 overflow-hidden rounded-ds-lg shadow-xl pointer-events-none opacity-90"
              style={{ left: touchDragPreview.x, top: touchDragPreview.y, transform: 'translate(-50%, -50%)' }}
            >
              <img src={touchDragPreview.src} className="h-full w-full object-cover" alt="" />
            </div>,
            document.body,
          )}
      </div>
    )
  }

  const renderReferenceModeControl = () => {
    const imageCount = Math.max(inputImageFolder?.imageIds.length ?? 0, inputImages.length)
    if (imageCount === 0) return null
    return (
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 items-center gap-2">
          <span
            data-testid="input-image-count"
            aria-live="polite"
            className="inline-flex h-ds-control-sm shrink-0 items-center rounded-full border border-ds-primary/30 bg-ds-primary-subtle px-2.5 text-xs font-semibold text-ds-primary dark:border-ds-primary/25 dark:bg-ds-primary/10 dark:text-ds-primary"
          >
            已选择 {imageCount} 张参考图
          </span>
          <span className="shrink-0 text-xs text-ds-muted dark:text-ds-muted">参考方式</span>
        </div>
        <div className="flex rounded-lg bg-ds-surface p-0.5 dark:bg-ds-surface">
          <button
            type="button"
            onClick={() => setParams({ reference_mode: 'cycle' })}
            aria-pressed={params.reference_mode !== 'all'}
            className={`rounded-md px-2.5 py-1 text-xs transition-colors ${params.reference_mode !== 'all' ? 'bg-ds-surface text-ds-text shadow-sm dark:bg-ds-subtle dark:text-white' : 'text-ds-muted dark:text-ds-muted'}`}
          >
            逐张参考
          </button>
          <button
            type="button"
            onClick={() => setParams({ reference_mode: 'all' })}
            aria-pressed={params.reference_mode === 'all'}
            className={`rounded-md px-2.5 py-1 text-xs transition-colors ${params.reference_mode === 'all' ? 'bg-ds-surface text-ds-text shadow-sm dark:bg-ds-subtle dark:text-white' : 'text-ds-muted dark:text-ds-muted'}`}
            title="每个生成请求同时携带全部参考图"
          >
            同时参考全部
          </button>
        </div>
      </div>
    )
  }

  const handleAdNegativeRuleChange = (value: string | number) => {
    const ruleId = String(value)
    if (ruleId !== '__create-ad-negative-rule__') {
      setParams({ adNegativeRuleId: ruleId })
      return
    }
    setCustomAdRuleName('')
    setCustomAdRuleContent('')
    setShowCustomAdRuleDialog(true)
  }

  /** 输出位置：单图标按钮 + 浮层（默认输出 / 选择自定义目录 / 当前路径展示）。 */
  const renderOutputControl = () => {
    const outputLabel = customOutputPath.trim() ? '自定义输出' : '默认输出'
    return (
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setOutputMenuOpen((value) => !value)}
          aria-label="输出位置"
          aria-haspopup="listbox"
          aria-expanded={outputMenuOpen}
          title={`输出位置：${customOutputPath.trim() ? customOutputPath.trim() : '默认输出（标签页文件夹）'}`}
          className={`inline-flex h-ds-control-md w-ds-control-md shrink-0 items-center justify-center rounded-ds-lg shadow-sm transition-[background-color,transform,box-shadow] duration-150 active:scale-[0.97] ${
            outputMenuOpen
              ? 'bg-ds-primary-subtle text-ds-primary dark:bg-ds-primary/10 dark:text-ds-primary'
              : 'bg-ds-subtle text-ds-muted hover:bg-ds-subtle hover:text-ds-text dark:bg-ds-surface dark:text-ds-muted dark:hover:bg-ds-surface dark:hover:text-ds-text'
          }`}
        >
          <FolderOpenIcon className="h-[15px] w-[15px]" />
        </button>
        {outputMenuOpen && (
          <>
            <div className="fixed inset-0 z-overlay" onClick={() => setOutputMenuOpen(false)} />
            <div
              role="listbox"
              aria-label="输出位置"
              className="absolute bottom-full right-0 z-overlay mb-2 w-56 overflow-hidden rounded-ds-xl border border-ds-border/80 bg-ds-surface p-1.5 text-left shadow-[0_16px_40px_rgba(15,23,42,0.18)] dark:border-ds-border dark:bg-ds-subtle"
            >
              <div className="border-b border-ds-border px-2.5 py-1.5 dark:border-ds-border">
                <p className="text-xs font-medium text-ds-text dark:text-white">输出位置</p>
                <p
                  className="mt-0.5 truncate text-xs text-ds-muted dark:text-ds-muted"
                  title={customOutputPath.trim() ? customOutputPath.trim() : '默认输出（标签页文件夹）'}
                >
                  {outputLabel}
                  {customOutputPath.trim() ? `：${customOutputPath.trim()}` : ''}
                </p>
              </div>
              <div className="py-1">
                <button
                  type="button"
                  role="option"
                  onClick={() => {
                    void handlePickOutputPath()
                    setOutputMenuOpen(false)
                  }}
                  className="flex w-full items-center gap-2 rounded-ds-lg px-2.5 py-1.5 text-left text-xs text-ds-text transition-colors hover:bg-ds-subtle dark:text-ds-text-subtle dark:hover:bg-ds-surface"
                >
                  <FolderOpenIcon className="h-3.5 w-3.5 shrink-0 text-ds-muted" />
                  选择自定义目录…
                </button>
                {customOutputPath.trim() && (
                  <button
                    type="button"
                    role="option"
                    onClick={() => {
                      setCustomOutputPath('')
                      setOutputMenuOpen(false)
                      showToast('已恢复默认输出', 'success')
                    }}
                    className="flex w-full items-center gap-2 rounded-ds-lg px-2.5 py-1.5 text-left text-xs text-ds-text transition-colors hover:bg-ds-subtle dark:text-ds-text-subtle dark:hover:bg-ds-surface"
                  >
                    <CheckIcon className="h-3.5 w-3.5 shrink-0 text-ds-muted" />
                    恢复默认输出
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    )
  }

  const renderParams = (cols: string) => (
    <div className={`grid ${cols} gap-2 text-xs flex-1`}>
      <label
        className="relative flex flex-col gap-0.5"
        onMouseEnter={sizeHint.show}
        onMouseLeave={sizeHint.hide}
        onTouchStart={sizeHint.startTouch}
        onTouchEnd={sizeHint.clearTimer}
        onTouchCancel={sizeHint.hide}
        onClick={sizeHint.show}
      >
        <span className="text-ds-muted dark:text-ds-muted ml-1">尺寸</span>
        <Select
          value={quickSizeValue}
          onChange={(value) => {
            if (value === '__more-size-options__') {
              dismissAllTooltips()
              setShowSizePicker(true)
              return
            }
            if (value === 'auto') {
              applyAspectRatio('', 'auto')
              return
            }
            const ratio = String(value)
            applyAspectRatio(ratio, calculateImageSize('1K', ratio) || DEFAULT_PARAMS.size)
          }}
          options={[
            { label: '16:9', value: '16:9' },
            { label: '9:16', value: '9:16' },
            { label: '1:1', value: '1:1' },
            ...(!isFalTextToImage ? [{ label: '自动', value: 'auto' }] : []),
            { label: '更多尺寸与设置', value: '__more-size-options__', variant: 'action' as const },
          ]}
          className={selectClass}
        />
        <ButtonTooltip
          visible={isFalTextToImage && sizeHint.visible}
          text={
            <>
              fal.ai 的文生图模式不支持 <code className="rounded bg-ds-surface/10 px-1 py-0.5 font-mono">auto</code>{' '}
              参数
            </>
          }
        />
      </label>
      <InputIconOptionButton
        icon={<SparklesIcon size={15} />}
        label="质量"
        currentValueLabel={
          settings.codexCli ? 'auto' : isFalProvider && params.quality === 'auto' ? 'high' : params.quality
        }
        options={qualityOptions}
        value={settings.codexCli ? 'auto' : isFalProvider && params.quality === 'auto' ? 'high' : params.quality}
        onSelect={(val) => {
          if (!settings.codexCli) setParams({ quality: val as TaskParams['quality'] })
        }}
        disabled={settings.codexCli}
      />
      <InputIconOptionButton
        icon={<FileImageIcon size={15} />}
        label="格式"
        currentValueLabel={params.output_format.toUpperCase()}
        options={[
          { label: 'PNG', value: 'png' },
          { label: 'JPEG', value: 'jpeg' },
          { label: 'WebP', value: 'webp' },
        ]}
        value={params.output_format}
        onSelect={(val) => setParams({ output_format: val as TaskParams['output_format'], output_compression: null })}
      />
      <InputIconOptionButton
        icon={<ShieldCheckIcon size={15} />}
        label="信息流审核规则"
        currentValueLabel={
          settings.adNegativeRuleProfiles.find((rule) => rule.id === params.adNegativeRuleId)?.name ?? '默认'
        }
        options={[
          ...settings.adNegativeRuleProfiles.map((rule) => ({ label: rule.name, value: rule.id })),
          { label: '新建自定义规则', value: '__create-ad-negative-rule__', action: true },
        ]}
        value={params.adNegativeRuleId}
        onSelect={handleAdNegativeRuleChange}
        menuClass="w-52"
      />
      <label
        className="relative flex flex-col gap-0.5"
        onMouseEnter={showAgentNHint}
        onMouseLeave={hideNLimitHint}
        onTouchStart={startAgentNHintTouch}
        onTouchEnd={clearAgentNHintTouchTimer}
        onTouchCancel={() => {
          clearAgentNHintTouchTimer()
          hideNLimitHint()
        }}
        onClick={showAgentNHint}
      >
        <span className="text-ds-muted dark:text-ds-muted ml-1">数量</span>
        <input
          value={nInput}
          onChange={(e) => handleNInputChange(e.target.value)}
          onFocus={() => setNInputFocused(true)}
          onBlur={() => {
            setNInputFocused(false)
            commitN()
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') {
              handleNLimitIncreaseAttempt(() => e.preventDefault())
            }
          }}
          onWheel={(e) => {
            if (e.deltaY < 0) {
              handleNLimitIncreaseAttempt(() => e.preventDefault())
            }
          }}
          disabled={agentAutoImageCount}
          type={agentAutoImageCount ? 'text' : 'number'}
          min={agentAutoImageCount ? undefined : 1}
          className={`h-ds-control-md px-3 rounded-ds-lg border border-ds-border/60 dark:border-ds-border focus:outline-none text-xs text-ds-text placeholder:text-ds-text-subtle transition duration-200 shadow-sm ${
            agentAutoImageCount
              ? 'bg-ds-surface/50 dark:bg-ds-surface opacity-50 cursor-not-allowed'
              : 'bg-ds-surface/50 dark:bg-ds-surface'
          }`}
        />
        <ButtonTooltip visible={nLimitHint.visible} text={nLimitHintText} />
        <ButtonTooltip
          visible={streamConcurrentByN && !nLimitHint.visible}
          text="数量大于 1 时会将多图生成拆分为并发单图"
        />
      </label>
      <div className="col-span-2 flex items-center gap-2">
        <span className="text-xs text-ds-muted dark:text-ds-muted">输出</span>
        {renderOutputControl()}
      </div>
    </div>
  )

  const renderParamSummary = () => {
    const sizeLabel = quickSizeValue === 'auto' ? '自动尺寸' : quickSizeValue
    const qualityLabel = settings.codexCli
      ? 'auto'
      : isFalProvider && params.quality === 'auto'
        ? 'high'
        : params.quality
    const pillClass =
      'inline-flex h-ds-control-md shrink-0 items-center whitespace-nowrap rounded-full border border-ds-border/70 bg-ds-surface/55 px-3 text-xs text-ds-muted shadow-sm outline-none transition-[background-color,transform,border-color] duration-150 hover:border-ds-primary/35 hover:bg-ds-surface active:scale-[0.97] dark:border-ds-border dark:bg-ds-surface dark:text-ds-muted dark:hover:border-ds-primary/30'
    const valueClass = 'ml-1 font-semibold text-ds-text dark:text-ds-text-subtle'

    return (
      <>
        <button type="button" onClick={() => setShowSizePicker(true)} className={pillClass}>
          <span className="text-ds-muted">尺寸</span>
          <span className={valueClass}>{sizeLabel}</span>
        </button>
        <InputIconOptionButton
          icon={<SparklesIcon size={15} />}
          label="质量"
          currentValueLabel={qualityLabel}
          options={qualityOptions}
          value={qualityLabel}
          onSelect={(val) => {
            if (!settings.codexCli) setParams({ quality: val as TaskParams['quality'] })
          }}
          disabled={settings.codexCli}
        />
        <InputIconOptionButton
          icon={<FileImageIcon size={15} />}
          label="格式"
          currentValueLabel={params.output_format.toUpperCase()}
          options={[
            { label: 'PNG', value: 'png' },
            { label: 'JPEG', value: 'jpeg' },
            { label: 'WebP', value: 'webp' },
          ]}
          value={params.output_format}
          onSelect={(val) => setParams({ output_format: val as TaskParams['output_format'], output_compression: null })}
        />
        <InputIconOptionButton
          icon={<ShieldCheckIcon size={15} />}
          label="审核规则"
          currentValueLabel={
            settings.adNegativeRuleProfiles.find((rule) => rule.id === params.adNegativeRuleId)?.name ?? '默认'
          }
          options={[
            ...settings.adNegativeRuleProfiles.map((rule) => ({ label: rule.name, value: rule.id })),
            { label: '新建自定义规则…', value: '__create-ad-negative-rule__', action: true },
          ]}
          value={params.adNegativeRuleId}
          onSelect={handleAdNegativeRuleChange}
          menuClass="w-52"
        />
        {!gallerySopModeActive && (
          <label className={`${pillClass} flex items-center gap-1`}>
            <span className="text-ds-muted">数量</span>
            <input
              value={nInput}
              onChange={(event) => handleNInputChange(event.target.value)}
              onFocus={() => setNInputFocused(true)}
              onBlur={() => {
                setNInputFocused(false)
                commitN()
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'ArrowUp') handleNLimitIncreaseAttempt(() => event.preventDefault())
              }}
              onWheel={(event) => {
                if (event.deltaY < 0) handleNLimitIncreaseAttempt(() => event.preventDefault())
              }}
              disabled={agentAutoImageCount}
              type={agentAutoImageCount ? 'text' : 'number'}
              min={agentAutoImageCount ? undefined : 1}
              className="w-12 bg-transparent font-semibold text-ds-text outline-none disabled:cursor-not-allowed dark:text-ds-text-subtle"
              aria-label="编辑数量"
            />
          </label>
        )}
        {renderOutputControl()}
      </>
    )
  }

  const renderSopContextControls = () => {
    if (appMode !== 'gallery') return null
    const hasSopSelection = Boolean(activeGallerySop)
    const sharedReferenceCount = inputImages.length || inputImageFolder?.imageIds.length || 0
    const progressLabel = gallerySopRunStatus
      ? gallerySopRunStatus.phase === 'generating'
        ? `提示词 ${gallerySopRunStatus.availablePrompts}/${gallerySopRunStatus.promptCount}`
        : gallerySopRunStatus.phase === 'paused'
          ? `已暂停 ${gallerySopRunStatus.availablePrompts}/${gallerySopRunStatus.promptCount}`
          : gallerySopRunStatus.phase === 'submitting'
            ? `正在提交 ${gallerySopRunStatus.totalImages} 张`
            : gallerySopRunStatus.phase === 'error'
              ? `部分失败 ${gallerySopRunStatus.failed}`
              : gallerySopRunStatus.phase === 'success'
                ? `已提交 ${gallerySopRunStatus.totalImages} 张`
                : `提示词 ${gallerySopRunStatus.availablePrompts}`
      : `提示词 ${savedSopPromptCount}`
    // 后台静默运行时，胶囊条是用户唯一的进度来源，必须把进度直接摊开显示
    const promptListActionLabel = gallerySopIsRunning
      ? `后台运行中 · ${progressLabel}`
      : gallerySopHasPromptList
        ? `提示词管理 · ${gallerySopAvailablePromptCount}`
        : '提示词管理'
    return (
      <>
        <button
          type="button"
          onClick={() => setShowGallerySopManagement(true)}
          aria-label={hasSopSelection ? `SOP 已启用：${activeGallerySop?.name}` : 'SOP 未启用'}
          title={hasSopSelection ? `SOP 已启用：${activeGallerySop?.name}` : 'SOP 未启用'}
          className={`flex h-ds-control-md shrink-0 items-center gap-2 rounded-full px-3 text-xs font-semibold transition-[background-color,transform] duration-150 active:scale-[0.97] ${
            hasSopSelection
              ? 'bg-ds-primary-subtle text-ds-primary hover:bg-ds-primary-subtle dark:bg-ds-primary/15 dark:text-ds-primary dark:hover:bg-ds-primary/25'
              : 'bg-ds-surface text-ds-muted hover:bg-ds-subtle dark:bg-ds-surface dark:text-ds-muted dark:hover:bg-ds-surface'
          }`}
        >
          <span className="text-ds-primary dark:text-ds-primary">SOP</span>
          <span className="max-w-40 truncate font-semibold text-ds-text dark:text-ds-text-subtle">
            {hasSopSelection ? activeGallerySop?.name : '未启用'}
          </span>
        </button>
        {hasSopSelection && (
          <>
            <button
              type="button"
              onClick={() => {
                setGallerySopId('')
                setGallerySopAutoStartTabId(null)
              }}
              disabled={gallerySopIsRunning}
              aria-label="取消当前 SOP，改为直接生图"
              title="不使用 SOP"
              className="flex h-ds-control-md w-ds-control-md shrink-0 items-center justify-center rounded-full bg-ds-surface text-ds-muted transition-[background-color,transform] duration-150 hover:bg-ds-subtle hover:text-ds-text active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus dark:bg-ds-surface dark:text-ds-muted dark:hover:bg-ds-surface dark:hover:text-ds-text"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
            <label
              className="inline-flex h-ds-control-md shrink-0 items-center gap-1 rounded-full border border-ds-border/70 bg-ds-surface/55 pl-2.5 pr-2 text-xs font-medium text-ds-muted shadow-sm dark:border-ds-border dark:bg-ds-surface dark:text-ds-muted"
              title="提示词数量 × 每条图片数（直接修改，实时生效）"
            >
              <input
                type="number"
                min={1}
                value={gallerySopPromptCountDraft ?? String(gallerySopPromptCount)}
                onChange={(event) => handleGallerySopPromptCountInput(event.target.value)}
                onBlur={() => setGallerySopPromptCountDraft(null)}
                aria-label="提示词数量"
                className="w-9 bg-transparent text-center font-semibold text-ds-text outline-none dark:text-ds-text-subtle"
              />
              <span>条</span>
              <span className="text-ds-muted">×</span>
              <input
                type="number"
                min={1}
                max={MAX_SOP_IMAGES_PER_PROMPT}
                value={gallerySopImagesPerPromptDraft ?? String(gallerySopImagesPerPrompt)}
                onChange={(event) => handleGallerySopImagesPerPromptInput(event.target.value)}
                onBlur={() => setGallerySopImagesPerPromptDraft(null)}
                aria-label="每条提示词生成图片数"
                className="w-9 bg-transparent text-center font-semibold text-ds-text outline-none dark:text-ds-text-subtle"
              />
              <span>张</span>
            </label>
            <span
              className="inline-flex h-ds-control-md shrink-0 items-center rounded-full bg-ds-primary-subtle px-3 text-xs font-medium text-ds-primary dark:bg-ds-primary/10 dark:text-ds-primary"
              title={`${gallerySopPromptCount} 条提示词 × 每条 ${gallerySopImagesPerPrompt} 张`}
            >
              预计 {gallerySopTotalImages} 张
            </span>
            <span className="inline-flex h-ds-control-md shrink-0 items-center rounded-full bg-ds-surface px-3 text-xs font-medium text-ds-muted dark:bg-ds-surface dark:text-ds-muted">
              <button
                type="button"
                onClick={() => setShowAssetPicker(true)}
                disabled={gallerySopIsRunning}
                aria-label={`选择 SOP 参考图，当前 ${sharedReferenceCount} 张`}
                title="选择或追加 SOP 参考图"
                className="flex h-full items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ImageIcon size={14} />
                参考图 · {sharedReferenceCount} 张
              </button>
            </span>
            <span
              className="inline-flex h-ds-control-md shrink-0 items-center rounded-full border border-ds-border/70 bg-ds-surface/55 pl-2.5 pr-1 shadow-sm dark:border-ds-border dark:bg-ds-surface"
              title={gallerySopAutoGenerate ? '自动生图已开启，提示词生成后自动出图' : '自动生图已关闭'}
            >
              <Switch
                checked={gallerySopAutoGenerate}
                onCheckedChange={toggleGallerySopAutoGenerate}
                disabled={gallerySopIsRunning}
                aria-label="自动生图"
                label={<span className="text-xs">自动生图</span>}
                className="gap-1.5"
              />
            </span>
            <span
              className="inline-flex h-ds-control-md shrink-0 items-center rounded-full border border-ds-border/70 bg-ds-surface/55 pl-2.5 pr-1 shadow-sm dark:border-ds-border dark:bg-ds-surface"
              title={
                gallerySopSecondReference
                  ? '已开启：提示词生成和实际生图都会使用参考图'
                  : '已关闭：参考图只用于生成提示词'
              }
            >
              <Switch
                checked={gallerySopSecondReference}
                onCheckedChange={toggleGallerySopSecondReference}
                disabled={gallerySopIsRunning}
                aria-label="二次参考"
                label={<span className="text-xs">二次参考</span>}
                className="gap-1.5"
              />
            </span>
          </>
        )}
        <button
          type="button"
          onClick={() => revealGallerySopBatch(gallerySopScopeKey)}
          aria-label={
            gallerySopIsRunning
              ? `${promptListActionLabel}，点击可查看或中止`
              : `${promptListActionLabel}，${progressLabel}`
          }
          title={
            gallerySopIsRunning
              ? `${promptListActionLabel}，点击可查看或中止`
              : `${promptListActionLabel}，${progressLabel}`
          }
          className={`flex h-ds-control-md shrink-0 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition-[background-color,transform,box-shadow] duration-150 active:scale-[0.97] ${
            gallerySopRunStatus?.phase === 'error'
              ? 'border-ds-danger/35 bg-ds-danger-subtle text-ds-danger hover:bg-ds-danger-subtle dark:border-ds-danger/30 dark:bg-ds-danger/10 dark:text-ds-danger dark:hover:bg-ds-danger/20'
              : gallerySopIsRunning
                ? 'border-ds-primary/35 bg-ds-primary-subtle text-ds-primary hover:bg-ds-primary-subtle dark:border-ds-primary/30 dark:bg-ds-primary/10 dark:text-ds-primary dark:hover:bg-ds-primary/20'
                : 'border-ds-border/70 bg-ds-surface/55 text-ds-text hover:bg-ds-surface dark:border-ds-border dark:bg-ds-surface dark:text-ds-text-subtle dark:hover:bg-ds-surface'
          }`}
        >
          {gallerySopIsRunning && (
            <span className="h-2 w-2 animate-pulse rounded-full bg-ds-primary motion-reduce:animate-none" />
          )}
          {promptListActionLabel}
        </button>
      </>
    )
  }

  const renderInputContextControls = () => (
    <div className="hidden min-w-0 flex-1 flex-wrap items-center gap-2 sm:flex">
      {renderSopContextControls()}
      {renderParamSummary()}
    </div>
  )

  const showFavoriteCollectionBatchBar = inCollectionOverview && selectedFavoriteCollectionIds.length > 0
  const showTaskBatchBar = !showFavoriteCollectionBatchBar && selectedTaskIds.length > 0
  const selectedGalleryImageCount =
    galleryViewMode === 'images'
      ? selectedTaskIds.reduce(
          (count, taskId) => count + (tasks.find((task) => task.id === taskId)?.outputImages.length ?? 0),
          0,
        )
      : 0

  return (
    <>
      {/* 全屏拖拽遮罩 */}
      {isDragging && (
        <div className="fixed inset-0 z-[var(--ds-z-toast)] bg-ds-surface/60 dark:bg-ds-scrim/60 backdrop-blur-md flex flex-col items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-4 p-8 rounded-ds-2xl">
            <div
              className={`w-20 h-20 rounded-full border-2 border-dashed flex items-center justify-center ${
                atImageLimit
                  ? 'bg-ds-danger-subtle dark:bg-ds-danger/10 border-ds-danger/35'
                  : 'bg-ds-primary-subtle dark:bg-ds-primary/10 border-ds-primary'
              }`}
            >
              {atImageLimit ? (
                <svg
                  className="w-ds-control-lg h-ds-control-lg text-ds-danger"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                  />
                </svg>
              ) : (
                <svg
                  className="w-ds-control-lg h-ds-control-lg text-ds-primary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              )}
            </div>
            <div className="text-center">
              {atImageLimit ? (
                <>
                  <p className="text-lg font-semibold text-ds-danger">已达上限 {MAX_DIRECT_INPUT_IMAGES} 张</p>
                  <p className="text-sm text-ds-muted mt-1">请先移除部分参考图后再添加</p>
                </>
              ) : (
                <>
                  <p className="text-lg font-semibold text-ds-text dark:text-ds-text-subtle">释放以上传图片</p>
                  <p className="text-sm text-ds-muted mt-1">支持 JPG、PNG、WebP 等格式</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showSizePicker && (
        <SizePickerModal
          currentSize={isFalTextToImage && params.size === 'auto' ? DEFAULT_FAL_IMAGE_SIZE : params.size}
          onSelect={(size, postprocessSize) => {
            const updates: Partial<typeof params> = {}
            if (size !== 'auto') {
              updates.size = size
              if (params.postprocess_resize_enabled && postprocessSize) {
                updates.postprocess_size = postprocessSize
              }
            } else {
              updates.size = size
              updates.postprocess_resize_enabled = false
            }
            setParams(updates)
            setPrompt(withAspectRatioPrompt(prompt, size === 'auto' ? '' : getAspectRatioFromSize(size)))
          }}
          onClose={() => setShowSizePicker(false)}
          allowAuto={!isFalTextToImage}
          postprocessSettings={{
            resizeEnabled: params.postprocess_resize_enabled,
            compressEnabled: params.postprocess_compress_enabled,
            format: params.postprocess_format,
            maxSizeInput: postprocessMaxSizeInput,
            onResizeEnabledChange: (enabled, size) =>
              setParams({
                postprocess_resize_enabled: enabled,
                ...(enabled && size && size !== 'auto' ? { postprocess_size: size } : {}),
              }),
            onCompressEnabledChange: (enabled) => setParams({ postprocess_compress_enabled: enabled }),
            onFormatChange: (format) => setParams({ postprocess_format: format }),
            onMaxSizeInputChange: setPostprocessMaxSizeInput,
            onMaxSizeBlur: commitPostprocessMaxSize,
          }}
        />
      )}

      <div data-input-bar className="fixed bottom-4 z-30 transition duration-300 sm:bottom-6">
        {showFavoriteCollectionBatchBar && (
          <div className="flex justify-center mb-3">
            <div className="bg-ds-surface/90 dark:bg-ds-subtle/90 backdrop-blur shadow-[0_8px_30px_rgb(0,0,0,0.12)] dark:shadow-lg rounded-full flex items-center p-1 border border-ds-border/50 dark:border-ds-border pointer-events-auto">
              <BatchActionButton
                onClick={clearFavoriteCollectionSelection}
                className="p-2 text-ds-muted dark:text-ds-muted hover:text-ds-text dark:hover:text-white transition-colors"
                tooltip="取消选择"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </BatchActionButton>
              <div className="w-px h-5 bg-ds-subtle dark:bg-ds-surface/20 mx-1"></div>
              <BatchActionButton
                onClick={handleSelectAllVisibleFavoriteCollections}
                className="p-2 text-ds-primary dark:text-ds-primary hover:text-ds-primary dark:hover:text-ds-primary transition-colors"
                tooltip="全选收藏夹"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  viewBox="0 0 24 24"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
              </BatchActionButton>
              <BatchActionButton
                onClick={handleInvertVisibleFavoriteCollections}
                className="p-2 text-ds-primary dark:text-ds-primary hover:text-ds-primary dark:hover:text-ds-primary transition-colors"
                tooltip="反选收藏夹"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeDasharray="4 4"
                    d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"
                  />
                  <path d="M8 12h8M13 9l3 3-3 3" />
                </svg>
              </BatchActionButton>
              <div className="w-px h-5 bg-ds-subtle dark:bg-ds-surface/20 mx-1"></div>
              <BatchActionButton
                onClick={handleDownloadSelectedFavoriteCollections}
                className="p-2 text-ds-success dark:text-ds-success hover:text-ds-success dark:hover:text-ds-success transition-colors"
                tooltip="下载选中"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
              </BatchActionButton>
              <div className="w-px h-5 bg-ds-subtle dark:bg-ds-surface/20 mx-1"></div>
              <BatchActionButton
                onClick={handleDeleteSelectedFavoriteCollections}
                className="p-2 text-ds-danger dark:text-ds-danger hover:text-ds-danger dark:hover:text-ds-danger transition-colors"
                tooltip="删除选中"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </BatchActionButton>
            </div>
          </div>
        )}
        {showTaskBatchBar && (
          <div className="flex justify-center mb-3">
            <div className="bg-ds-surface/90 dark:bg-ds-subtle/90 backdrop-blur shadow-[0_8px_30px_rgb(0,0,0,0.12)] dark:shadow-lg rounded-full flex items-center p-1 border border-ds-border/50 dark:border-ds-border pointer-events-auto">
              {galleryViewMode === 'images' && (
                <span
                  data-testid="gallery-selection-count"
                  aria-live="polite"
                  className="px-2 text-xs font-semibold tabular-nums text-ds-text dark:text-ds-text-subtle"
                >
                  已选择 {selectedGalleryImageCount} 张图片
                </span>
              )}
              <BatchActionButton
                onClick={clearSelection}
                className="p-2 text-ds-muted dark:text-ds-muted hover:text-ds-text dark:hover:text-white transition-colors"
                tooltip="取消选择"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </BatchActionButton>
              <div className="w-px h-5 bg-ds-subtle dark:bg-ds-surface/20 mx-1"></div>
              <BatchActionButton
                onClick={handleSelectAllVisibleTasks}
                className="p-2 text-ds-primary dark:text-ds-primary hover:text-ds-primary dark:hover:text-ds-primary transition-colors"
                tooltip="全选任务"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  viewBox="0 0 24 24"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
              </BatchActionButton>
              <BatchActionButton
                onClick={handleInvertVisibleTasks}
                className="p-2 text-ds-primary dark:text-ds-primary hover:text-ds-primary dark:hover:text-ds-primary transition-colors"
                tooltip="反选任务"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeDasharray="4 4"
                    d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"
                  />
                  <path d="M8 12h8M13 9l3 3-3 3" />
                </svg>
              </BatchActionButton>
              <div className="w-px h-5 bg-ds-subtle dark:bg-ds-surface/20 mx-1"></div>
              <div ref={taskMoveMenuRef} className="relative inline-flex">
                <BatchActionButton
                  onClick={() => {
                    if (taskMoveDestinations.length === 0) {
                      showToast('请先创建其他标签', 'info')
                      return
                    }
                    setTaskMoveMenuOpen((open) => !open)
                  }}
                  className="p-2 text-cyan-500 transition-colors hover:text-cyan-600 dark:text-cyan-400 dark:hover:text-cyan-300"
                  tooltip="移动到标签"
                  expanded={taskMoveMenuOpen}
                  controls="task-move-destination-picker"
                >
                  <TagsIcon className="h-5 w-5" />
                </BatchActionButton>
                {taskMoveMenuOpen && (
                  <div
                    id="task-move-destination-picker"
                    role="dialog"
                    aria-label="选择目标标签"
                    className="absolute bottom-full left-1/2 z-dropdown mb-3 w-60 -translate-x-1/2 overflow-hidden rounded-ds-lg border border-ds-border/80 bg-ds-surface p-1.5 text-left shadow-[0_16px_40px_rgba(15,23,42,0.18)] dark:border-ds-border dark:bg-ds-subtle"
                  >
                    <div className="border-b border-ds-border px-2.5 py-2 dark:border-ds-border">
                      <p className="text-xs font-medium text-ds-text dark:text-white">
                        移动 {selectedTaskIds.length} 个任务到
                      </p>
                    </div>
                    <div className="max-h-56 overflow-y-auto py-1">
                      {taskMoveDestinations.map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => {
                            const moved = moveTasksToWorkspaceTab(
                              selectedTaskIds,
                              tab.id,
                              filterFavorite ? undefined : (activeWorkspaceTabId ?? undefined),
                            )
                            if (moved) setTaskMoveMenuOpen(false)
                          }}
                          className="flex h-ds-control-lg w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 text-sm text-ds-text transition-colors hover:bg-ds-subtle hover:text-cyan-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 dark:text-ds-text-subtle dark:hover:bg-ds-surface dark:hover:text-cyan-200"
                        >
                          <TagsIcon className="h-4 w-4 shrink-0 text-cyan-500 dark:text-cyan-400" />
                          <span className="min-w-0 flex-1 truncate">{tab.name}</span>
                          <span className="shrink-0 text-xs tabular-nums text-ds-muted dark:text-ds-muted">
                            {tab.tasks.length}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="w-px h-5 bg-ds-subtle dark:bg-ds-surface/20 mx-1"></div>
              <BatchActionButton
                onClick={handleToggleFavorite}
                className="p-2 text-ds-warning dark:text-ds-warning hover:text-ds-warning dark:hover:text-ds-warning transition-colors"
                tooltip="编辑收藏夹"
              >
                {selectedTaskIds.length > 0 &&
                selectedTaskIds.every((id) => tasks.find((t) => t.id === id)?.isFavorite) ? (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                ) : (
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    viewBox="0 0 24 24"
                  >
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                )}
              </BatchActionButton>
              <div className="w-px h-5 bg-ds-subtle dark:bg-ds-surface/20 mx-1"></div>
              <BatchActionButton
                onClick={handleDownloadSelected}
                className="p-2 text-ds-success dark:text-ds-success hover:text-ds-success dark:hover:text-ds-success transition-colors"
                tooltip="下载选中"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
              </BatchActionButton>
              <div className="w-px h-5 bg-ds-subtle dark:bg-ds-surface/20 mx-1"></div>
              <BatchActionButton
                onClick={handleDeleteSelected}
                className="p-2 text-ds-danger dark:text-ds-danger hover:text-ds-danger dark:hover:text-ds-danger transition-colors"
                tooltip="删除选中"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </BatchActionButton>
            </div>
          </div>
        )}
        {appMode === 'agent' && (
          <div className="mb-3 flex justify-end">
            <button
              type="button"
              onClick={() => setShowAgentBatchPlanner(true)}
              className="flex h-ds-control-md items-center rounded-ds-lg border border-ds-primary/35 bg-ds-primary-subtle px-3 text-xs font-medium text-ds-primary transition-colors hover:bg-ds-primary-subtle dark:border-ds-primary/20 dark:bg-ds-primary/10 dark:text-ds-primary dark:hover:bg-ds-primary/20"
            >
              导入批量任务
            </button>
          </div>
        )}
        <div
          ref={cardRef}
          className="bg-ds-surface/90 dark:bg-ds-scrim/90 backdrop-blur-md border border-white/50 dark:border-ds-border shadow-[0_8px_30px_rgb(0,0,0,0.08)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)] rounded-ds-xl sm:rounded-ds-2xl p-3 sm:p-4 ring-1 ring-black/5 dark:ring-white/10"
        >
          {/* 移动端拖动条 */}
          <div
            ref={handleRef}
            className="sm:hidden flex justify-center pt-0.5 pb-2 -mt-1 cursor-pointer touch-none"
            onClick={() => {
              if (Date.now() < suppressHandleClickUntilRef.current) {
                suppressHandleClickUntilRef.current = 0
                return
              }
              setMobileCollapsed((v) => !v)
            }}
          >
            <div
              className={`w-10 h-1 rounded-full bg-ds-subtle dark:bg-ds-surface transition-transform duration-200 ${mobileCollapsed ? 'scale-x-75' : ''}`}
            />
          </div>

          {/* 文件夹模式预览 */}
          {inputImageFolder && (
            <div className="mb-2 px-1">
              <div className="flex items-center gap-2 bg-ds-primary-subtle dark:bg-ds-primary/10 border border-ds-primary/35 dark:border-ds-primary/20 rounded-ds-lg px-3 py-2">
                <svg
                  className="w-4 h-4 text-ds-primary dark:text-ds-primary shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                  />
                </svg>
                <span
                  className="text-xs text-ds-primary dark:text-ds-primary truncate flex-1 min-w-0"
                  title={inputImageFolder.path}
                >
                  {inputImageFolder.path}
                </span>
                <span className="text-xs text-ds-primary dark:text-ds-primary shrink-0">
                  {inputImageFolder.imageIds.length} 张
                </span>
                <button
                  onClick={() => loadFolderImages(inputImageFolder.path, true)}
                  className="shrink-0 p-1 rounded-lg hover:bg-ds-primary-subtle dark:hover:bg-ds-primary/20 text-ds-primary dark:text-ds-primary transition-colors"
                  title="重新加载文件夹"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                </button>
                <button
                  onClick={() => setInputImageFolder(null)}
                  className="shrink-0 p-1 rounded-lg hover:bg-ds-primary-subtle dark:hover:bg-ds-primary/20 text-ds-primary dark:text-ds-primary transition-colors"
                  title="清除文件夹"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* 输入图片行（移动端可折叠） */}
          {inputImages.length > 0 &&
            (isMobile ? (
              <>
                <div className={`collapse-section${mobileCollapsed ? ' collapsed' : ''}`}>
                  <div className="collapse-inner">{renderImageThumbs()}</div>
                </div>
                {mobileCollapsed && (
                  <div className="text-xs text-ds-muted dark:text-ds-muted mb-2 ml-1">
                    {maskDraft ? `1 张遮罩主图 · ${referenceImages.length} 张参考图` : `${inputImages.length} 张参考图`}
                  </div>
                )}
              </>
            ) : (
              renderImageThumbs()
            ))}

          {renderReferenceModeControl()}

          {/* 一键衍生设置行：默认关闭，用户显式开启后才接管挂图发送 */}
          {inputImages.length > 0 && !gallerySopModeActive && !maskDraft && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-1">
              <Switch
                checked={oneClickDeriveEnabled}
                onCheckedChange={setOneClickDeriveEnabled}
                disabled={Boolean(oneClickDerivePhase)}
                aria-label="启用一键衍生"
                title="开启后，挂图发送时先生成变量提示词，再自动出图"
                label={<span className="text-xs">启用一键衍生</span>}
                labelPosition="end"
                className="gap-1.5"
              />
              <div className="flex items-center gap-2">
                <span className="text-xs text-ds-muted">
                  衍生维度：{DERIVE_DIMENSIONS.filter((dimension) => derivePolicy[dimension] !== 'lock').length}/8
                  参与变化
                </span>
                <button
                  type="button"
                  onClick={() => setDerivePolicyOpen(true)}
                  className="inline-flex items-center gap-1 rounded-ds-lg border border-ds-border bg-ds-surface px-2.5 py-1 text-xs text-ds-muted transition-colors hover:bg-ds-subtle hover:text-ds-text"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path
                      strokeLinecap="round"
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                    />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  衍生设置
                </button>
              </div>
            </div>
          )}
          {derivePolicyOpen && (
            <DerivePolicyModal
              policy={derivePolicy}
              copyMode={deriveCopyMode}
              onChange={setDerivePolicy}
              onCopyModeChange={setDeriveCopyMode}
              onClose={() => setDerivePolicyOpen(false)}
            />
          )}

          {/* 输入框 */}
          <div className="relative grid rounded-ds-xl border border-ds-border/70 bg-ds-surface/55 shadow-sm transition-[border-color,box-shadow] duration-200 focus-within:border-ds-primary/35 focus-within:ring-2 focus-within:ring-ds-focus/70 dark:border-ds-border dark:bg-ds-surface dark:focus-within:border-ds-primary/40 dark:focus-within:ring-ds-focus/10">
            {showAtImageMenu && (
              <div
                style={{ left: `${menuLeft}px` }}
                className="absolute bottom-full z-dropdown mb-2 w-64 overflow-hidden rounded-ds-xl border border-ds-border/70 bg-ds-surface/95 p-1.5 shadow-xl ring-1 ring-black/5 backdrop-blur-xl dark:border-ds-border dark:bg-ds-scrim/95 dark:ring-white/10"
              >
                <div className="px-2 pb-1 pt-0.5 text-xs text-ds-muted dark:text-ds-muted">选择图片引用</div>
                <div className="max-h-56 overflow-y-auto custom-scrollbar">
                  {atImageOptions.map((option, optionIndex) => (
                    <button
                      key={option.key}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        selectAtImageOption(option)
                      }}
                      onMouseEnter={() => setAtImageMenuIndex(optionIndex)}
                      className={`flex w-full items-center gap-2 rounded-ds-lg px-2 py-1.5 text-left text-xs transition-colors ${
                        optionIndex === atImageMenuIndex
                          ? 'bg-ds-primary-subtle text-ds-primary dark:bg-ds-primary/10 dark:text-ds-primary'
                          : 'text-ds-text hover:bg-ds-subtle dark:text-ds-muted dark:hover:bg-ds-surface'
                      }`}
                    >
                      <AtImageOptionThumb option={option} />
                      <span className="min-w-0 flex-1 truncate font-medium">{option.label}</span>
                      {option.type === 'agent-output' && (
                        <span className="shrink-0 rounded bg-ds-surface px-1.5 py-0.5 text-xs text-ds-muted dark:bg-ds-surface dark:text-ds-muted">
                          历史
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div
              ref={textareaRef}
              contentEditable
              suppressContentEditableWarning
              onInput={(e) => {
                isUserInputRef.current = true
                const el = e.currentTarget
                const range = getContentEditableSelection(el)
                setCursorPos(range.start)
                syncMentionTagSelection(el)
                const text = getContentEditablePlainText(el)
                setPrompt(text)
                setAtImageMenuIndex(0)
                setAtImageMenuDismissed(false)
              }}
              onSelect={(e) => {
                const el = e.currentTarget
                const range = getContentEditableSelection(el)
                setCursorPos(range.start)
                syncMentionTagSelection(el)
                setAtImageMenuIndex(0)
                setAtImageMenuDismissed(false)
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePromptPaste}
              onCopy={handlePromptCopy}
              onContextMenu={handlePromptVariableContextMenu}
              onDragStart={handlePromptVariableDragStart}
              onDragOver={handlePromptVariableDragOver}
              onDrop={handlePromptVariableDrop}
              onDragEnd={handlePromptVariableDragEnd}
              onDoubleClick={(e) => {
                const target = e.target as HTMLElement
                if (target.classList.contains('wildcard-var')) {
                  const varName = target.dataset.varName ?? target.textContent ?? ''
                  const entryId = target.dataset.entryId
                  const store = useStore.getState()
                  const entry = resolveVariableMentionEntry(varName, entryId, store.wordLibraryEntries)
                  setWordLibraryPromptSelectedVarName(entry ? null : varName)
                  setWordLibraryEditEntryId(entry?.id ?? entryId ?? null)
                  store.setVarEntryEditor({
                    entryId: entry?.id,
                    varName,
                    groupId: entry?.groupId ?? 'default',
                    entries: entry?.entries ?? [],
                    onSave: (newName, newGroupId, cleanedEntries) => {
                      // 更新 prompt 中的变量名（如果改名）
                      const currentStore = useStore.getState()
                      const currentPrompt = currentStore.prompt
                      if (newName !== varName) {
                        currentStore.setPrompt(replaceVariableNameInPrompt(currentPrompt, varName, newName))
                      }
                      // 更新或创建词条库条目
                      const existingId = entry?.id
                      if (existingId) {
                        currentStore.updateWordLibraryEntry(existingId, {
                          key: newName,
                          groupId: newGroupId,
                          entries: cleanedEntries,
                          label: newName,
                        })
                      } else if (cleanedEntries.length > 0) {
                        const newEntry = currentStore.createWordLibraryEntry(newGroupId, newName)
                        currentStore.updateWordLibraryEntry(newEntry.id, {
                          entries: cleanedEntries,
                          label: newName,
                        })
                      }
                      currentStore.showToast('词条已保存', 'success')
                    },
                  })
                }
              }}
              onClick={(e) => {
                const el = textareaRef.current
                if (!el) return
                const target = e.target as HTMLElement
                if (target.classList.contains('mention-tag') || target.classList.contains('wildcard-var')) {
                  if (target.classList.contains('wildcard-var')) {
                    const varName = target.dataset.varName ?? target.textContent ?? ''
                    const entryId = target.dataset.entryId
                    const entry = resolveVariableMentionEntry(varName, entryId, useStore.getState().wordLibraryEntries)
                    setWordLibraryPromptSelectedVarName(entry ? null : varName)
                    setWordLibraryEditEntryId(entry?.id ?? entryId ?? null)
                  }
                  const sel = window.getSelection()
                  if (sel) {
                    const range = document.createRange()
                    range.selectNode(target)
                    sel.removeAllRanges()
                    sel.addRange(range)
                    syncMentionTagSelection(el)
                  }
                  return
                }

                syncMentionTagSelection(el)
              }}
              aria-label={promptPlaceholder}
              className="col-start-1 row-start-1 min-h-[92px] w-full overflow-hidden ios-rounded-scroll-fix whitespace-pre-wrap break-words rounded-ds-xl bg-transparent pl-4 pr-11 py-3.5 text-sm leading-relaxed outline-none dark:text-ds-text sm:min-h-[112px]"
            />
            {prompt.length === 0 && (
              <div
                className={`prompt-placeholder col-start-1 row-start-1 pointer-events-none pl-4 pr-11 py-3.5 text-sm leading-relaxed text-ds-muted dark:text-ds-muted${
                  isMobile && mobileCollapsed ? ' truncate' : ''
                }`}
              >
                {promptPlaceholder}
              </div>
            )}
            {prompt.length > 0 && (
              <button
                type="button"
                onClick={handleClearPrompt}
                className={`absolute right-3 text-ds-muted transition-[color,background-color,transform] duration-150 hover:text-ds-muted active:scale-95 dark:hover:text-ds-text hover:bg-ds-subtle dark:hover:bg-ds-surface rounded-full p-1 focus:outline-none z-10 flex items-center justify-center ${
                  isSingleLine ? 'top-1/2 -translate-y-1/2' : 'top-3'
                }`}
                title="清空文本"
              >
                <CloseIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-ds-muted dark:text-ds-muted">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <ModelSwitcher />
              <span>Enter 发送 · Shift+Enter 换行 · @ 引用参考图</span>
              {variablePromptState.enabled && (
                <Badge
                  tone="success"
                  title={`已识别 ${variablePromptState.variables.length} 个变量，共 ${variablePromptState.combinationCount.toLocaleString()} 种组合`}
                >
                  已启用变量提示词
                  {variablePromptState.aspectRatio ? ` · ${variablePromptState.aspectRatio}` : ''}
                </Badge>
              )}
              {variablePromptState.detected && !variablePromptState.enabled && (
                <Badge tone="warning" title={variablePromptState.errors.join('\n')}>
                  变量提示词格式有误：{variablePromptState.errors[0]}
                </Badge>
              )}
            </div>
            <span className="tabular-nums">{prompt.trim().length} 字</span>
          </div>

          {/* 参数 + 按钮 */}
          <div className="mt-3">
            {/* 桌面端布局 */}
            <div className="hidden sm:flex flex-nowrap items-center justify-between gap-3">
              {renderInputContextControls()}

              <div className="flex flex-shrink-0 gap-2">
                <div className="relative">
                  <button
                    type="button"
                    disabled={atImageLimit}
                    onClick={() => setShowAssetPicker(true)}
                    className="inline-flex h-ds-control-md w-ds-control-md items-center justify-center rounded-ds-lg transition-[background-color,transform,box-shadow] duration-150 shadow-sm bg-ds-subtle dark:bg-ds-surface hover:bg-ds-subtle dark:hover:bg-ds-surface text-ds-muted dark:text-ds-muted hover:shadow active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="从素材库选择参考图"
                    title="从素材库选择参考图"
                  >
                    <ImageIcon size={20} />
                  </button>
                </div>
                {/* 转换为变量按钮 */}
                <div
                  className="relative"
                  onMouseEnter={() => setVarConvertHover(true)}
                  onMouseLeave={() => setVarConvertHover(false)}
                >
                  <ButtonTooltip visible={varConvertHover} text="转换为变量" />
                  <button
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={handleConvertToVariable}
                    className="inline-flex h-ds-control-md w-ds-control-md items-center justify-center rounded-ds-lg transition-[background-color,transform,box-shadow] duration-150 shadow-sm bg-ds-subtle dark:bg-ds-surface hover:bg-ds-subtle dark:hover:bg-ds-surface text-ds-muted dark:text-ds-muted hover:shadow active:scale-[0.97]"
                    aria-label="转换为变量"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
                      />
                    </svg>
                  </button>
                </div>
                <div
                  className="relative"
                  onMouseEnter={() => setAttachHover(true)}
                  onMouseLeave={() => setAttachHover(false)}
                >
                  <ButtonTooltip visible={attachHover} text={uploadImageTooltipText} />
                  <button
                    onClick={() => {
                      if (inputImageFolder) {
                        setInputImageFolder(null)
                        return
                      }
                      if (!atImageLimit) {
                        void handleSelectFolder()
                      }
                    }}
                    disabled={atImageLimit && !inputImageFolder}
                    className={`inline-flex h-ds-control-md w-ds-control-md items-center justify-center rounded-ds-lg transition-[background-color,transform,box-shadow] duration-150 shadow-sm ${
                      inputImageFolder
                        ? 'bg-ds-primary-subtle dark:bg-ds-primary/20 text-ds-primary dark:text-ds-primary hover:bg-ds-primary-subtle dark:hover:bg-ds-primary/30 active:scale-[0.97]'
                        : atImageLimit
                          ? 'bg-ds-subtle dark:bg-ds-surface text-ds-text-subtle dark:text-ds-muted cursor-not-allowed'
                          : 'bg-ds-subtle dark:bg-ds-surface hover:bg-ds-subtle dark:hover:bg-ds-surface text-ds-muted dark:text-ds-muted hover:shadow active:scale-[0.97]'
                    }`}
                    aria-label={uploadImageTooltipText}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                      />
                    </svg>
                  </button>
                </div>
                <div
                  className="relative"
                  onMouseEnter={() => setSubmitHover(true)}
                  onMouseLeave={() => setSubmitHover(false)}
                >
                  <ButtonTooltip visible={showSubmitTooltip} text={submitTooltipText} />
                  <button
                    onClick={() =>
                      activeAgentIsRunning
                        ? stopActiveAgentResponse()
                        : gallerySopModeActive
                          ? submitCurrentMode()
                          : hasSubmitApiConfig
                            ? submitCurrentMode()
                            : setShowSettings(true)
                    }
                    disabled={
                      activeAgentIsRunning
                        ? false
                        : oneClickDerivePhase
                          ? true
                          : gallerySopModeActive
                            ? !canSubmit
                            : hasSubmitApiConfig
                              ? !canSubmit
                              : false
                    }
                    className={`flex h-ds-control-md min-w-[116px] items-center justify-center gap-2 px-4 rounded-ds-lg transition-[background-color,transform,box-shadow,opacity] duration-150 shadow-sm hover:shadow active:scale-[0.97] ${
                      activeAgentIsRunning
                        ? 'bg-ds-danger text-white hover:bg-[hsl(var(--ds-color-danger-hover))]'
                        : gallerySopModeActive
                          ? 'bg-ds-primary text-ds-text-inverse hover:bg-ds-primary-hover disabled:bg-ds-subtle disabled:text-ds-text-subtle dark:disabled:bg-ds-subtle disabled:opacity-100 disabled:cursor-not-allowed'
                          : !hasSubmitApiConfig
                            ? 'bg-ds-subtle text-ds-muted dark:bg-ds-subtle cursor-pointer'
                            : 'bg-ds-primary text-ds-text-inverse hover:bg-ds-primary-hover disabled:bg-ds-subtle disabled:text-ds-text-subtle dark:disabled:bg-ds-subtle disabled:opacity-100 disabled:cursor-not-allowed'
                    }`}
                    aria-label={submitButtonAriaLabel}
                  >
                    {activeAgentIsRunning ? (
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <rect x="7" y="7" width="10" height="10" rx="1.5" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M13 7l5 5m0 0l-5 5m5-5H6"
                        />
                      </svg>
                    )}
                    <span className="text-sm font-semibold">{submitButtonText}</span>
                  </button>
                </div>
              </div>
            </div>
            {/* 移动端布局 */}
            <div className="sm:hidden flex flex-col gap-2">
              {gallerySopModeActive && (
                <div className="flex min-w-0 flex-wrap items-center gap-2">{renderSopContextControls()}</div>
              )}
              <div className={`collapse-section${mobileCollapsed ? ' collapsed' : ''}`}>
                <div className="collapse-inner">
                  {renderParams('grid-cols-2')}
                  <div className="h-2" />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div
                  className="relative"
                  onMouseEnter={() => setAttachHover(true)}
                  onMouseLeave={() => setAttachHover(false)}
                >
                  <button
                    onClick={() => {
                      if (!atImageLimit) {
                        setShowMobileUploadMenu(!showMobileUploadMenu)
                      }
                    }}
                    className={`inline-flex h-ds-control-md w-ds-control-md flex-shrink-0 items-center justify-center rounded-ds-lg transition shadow-sm ${
                      atImageLimit
                        ? 'bg-ds-subtle dark:bg-ds-surface text-ds-text-subtle dark:text-ds-muted cursor-not-allowed'
                        : 'bg-ds-subtle dark:bg-ds-surface hover:bg-ds-subtle dark:hover:bg-ds-surface text-ds-muted dark:text-ds-muted'
                    }`}
                    aria-label={uploadImageTooltipText}
                  >
                    <svg
                      className={`w-5 h-5 transition-transform duration-200 ${showMobileUploadMenu ? 'rotate-90' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>

                  {/* Mobile Upload Menu */}
                  {showMobileUploadMenu && (
                    <>
                      <div className="fixed inset-0 z-overlay" onClick={() => setShowMobileUploadMenu(false)} />
                      <div className="absolute bottom-full left-0 mb-2 w-32 bg-ds-surface dark:bg-ds-subtle rounded-ds-lg shadow-lg border border-ds-border dark:border-ds-border-strong overflow-hidden z-overlay animate-in fade-in slide-in-from-bottom-2 duration-200">
                        <button
                          className="w-full px-4 py-3 text-left text-sm text-ds-text dark:text-ds-text-subtle hover:bg-ds-subtle dark:hover:bg-ds-subtle/50 flex items-center gap-2 transition-colors"
                          onClick={() => {
                            setShowMobileUploadMenu(false)
                            setShowAssetPicker(true)
                          }}
                        >
                          <ImageIcon size={16} />
                          素材库
                        </button>
                        <button
                          className="w-full px-4 py-3 text-left text-sm text-ds-text dark:text-ds-text-subtle hover:bg-ds-subtle dark:hover:bg-ds-subtle/50 flex items-center gap-2 transition-colors"
                          onClick={() => {
                            setShowMobileUploadMenu(false)
                            cameraInputRef.current?.click()
                          }}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                            />
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                            />
                          </svg>
                          拍照
                        </button>
                        <button
                          className="w-full px-4 py-3 text-left text-sm text-ds-text dark:text-ds-text-subtle hover:bg-ds-subtle dark:hover:bg-ds-subtle/50 flex items-center gap-2 transition-colors"
                          onClick={() => {
                            setShowMobileUploadMenu(false)
                            fileInputRef.current?.click()
                          }}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                            />
                          </svg>
                          上传图片
                        </button>
                      </div>
                    </>
                  )}
                </div>
                {/* 转换为变量按钮 */}
                <div
                  className="relative flex-shrink-0"
                  onMouseEnter={() => setVarConvertHover(true)}
                  onMouseLeave={() => setVarConvertHover(false)}
                >
                  <ButtonTooltip visible={varConvertHover} text="转换为变量" />
                  <button
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={handleConvertToVariable}
                    className="inline-flex h-ds-control-md w-ds-control-md items-center justify-center rounded-ds-lg transition shadow-sm bg-ds-subtle dark:bg-ds-surface hover:bg-ds-subtle dark:hover:bg-ds-surface text-ds-muted dark:text-ds-muted"
                    aria-label="转换为变量"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
                      />
                    </svg>
                  </button>
                </div>
                <div
                  className="relative flex-1"
                  onMouseEnter={() => setSubmitHover(true)}
                  onMouseLeave={() => setSubmitHover(false)}
                >
                  <ButtonTooltip visible={showSubmitTooltip} text={submitTooltipText} />
                  <button
                    onClick={() =>
                      activeAgentIsRunning
                        ? stopActiveAgentResponse()
                        : gallerySopModeActive
                          ? submitCurrentMode()
                          : hasSubmitApiConfig
                            ? submitCurrentMode()
                            : setShowSettings(true)
                    }
                    disabled={
                      activeAgentIsRunning
                        ? false
                        : gallerySopModeActive
                          ? !canSubmit
                          : hasSubmitApiConfig
                            ? !canSubmit
                            : false
                    }
                    aria-label={submitButtonAriaLabel}
                    className={`w-full flex h-ds-control-md items-center justify-center gap-2 rounded-ds-lg text-sm font-medium transition shadow-sm ${
                      activeAgentIsRunning
                        ? 'bg-ds-danger text-white hover:bg-[hsl(var(--ds-color-danger-hover))]'
                        : gallerySopModeActive
                          ? 'bg-ds-primary text-ds-text-inverse hover:bg-ds-primary-hover disabled:bg-ds-subtle disabled:text-ds-text-subtle dark:disabled:bg-ds-subtle disabled:opacity-100 disabled:cursor-not-allowed'
                          : !hasSubmitApiConfig
                            ? 'bg-ds-subtle text-ds-muted dark:bg-ds-subtle cursor-pointer'
                            : 'bg-ds-primary text-ds-text-inverse hover:bg-ds-primary-hover disabled:bg-ds-subtle disabled:text-ds-text-subtle dark:disabled:bg-ds-subtle disabled:opacity-100 disabled:cursor-not-allowed'
                    }`}
                  >
                    {activeAgentIsRunning ? (
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <rect x="7" y="7" width="10" height="10" rx="1.5" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M13 7l5 5m0 0l-5 5m5-5H6"
                        />
                      </svg>
                    )}
                    {submitButtonText}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileUpload}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileUpload}
          />
          <input
            ref={replaceFileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleReplaceFileUpload}
          />
        </div>
      </div>
      {showCustomAdRuleDialog &&
        createPortal(
          <div
            className="ds-modal-layer fixed inset-0 flex items-center justify-center p-4"
            onMouseDown={() => setShowCustomAdRuleDialog(false)}
          >
            <div className="ds-modal-scrim pointer-events-none absolute inset-0" />
            <form
              ref={customAdRuleDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="custom-ad-rule-title"
              className="ds-modal-surface relative z-10 w-full max-w-lg rounded-ds-xl border p-5"
              onMouseDown={(event) => event.stopPropagation()}
              onSubmit={(event) => {
                event.preventDefault()
                const name = customAdRuleName.trim()
                const content = customAdRuleContent.trim()
                if (!name || !content) {
                  showToast('请填写规则名称和负向约束', 'error')
                  return
                }
                const id = `custom-rule-${Date.now()}`
                setSettings({
                  adNegativeRuleProfiles: [
                    ...settings.adNegativeRuleProfiles,
                    {
                      id,
                      name,
                      content,
                      description: '自定义信息流广告负向约束',
                      source: 'custom',
                      platform: 'custom',
                      version: 1,
                      updatedAt: Date.now(),
                    },
                  ],
                })
                setParams({ adNegativeRuleId: id })
                setShowCustomAdRuleDialog(false)
                showToast(`自定义合规规则「${name}」已创建`, 'success')
              }}
            >
              <h2 id="custom-ad-rule-title" className="text-base font-semibold text-ds-text dark:text-ds-text-subtle">
                新建自定义合规规则
              </h2>
              <p className="mt-1 text-xs leading-5 text-ds-muted dark:text-ds-muted">
                规则会作为固定负向约束附加到每次生图请求。
              </p>
              <label className="mt-4 block text-xs text-ds-muted dark:text-ds-muted">
                规则名称
                <input
                  autoFocus
                  value={customAdRuleName}
                  onChange={(event) => setCustomAdRuleName(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-ds-border bg-ds-surface px-3 py-2 text-sm text-ds-text outline-none focus:border-ds-primary dark:border-ds-border dark:bg-ds-surface dark:text-ds-text-subtle"
                  placeholder="例如：品牌安全"
                />
              </label>
              <label className="mt-3 block text-xs text-ds-muted dark:text-ds-muted">
                禁止生成的元素
                <textarea
                  value={customAdRuleContent}
                  onChange={(event) => setCustomAdRuleContent(event.target.value)}
                  className="mt-1 h-32 w-full resize-none rounded-lg border border-ds-border bg-ds-surface px-3 py-2 text-sm leading-6 text-ds-text outline-none focus:border-ds-primary dark:border-ds-border dark:bg-ds-surface dark:text-ds-text-subtle"
                  placeholder="例如：不得生成二维码、联系方式、价格标签……"
                />
              </label>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCustomAdRuleDialog(false)}
                  className="rounded-lg px-3 py-2 text-sm text-ds-muted hover:bg-ds-subtle dark:text-ds-muted dark:hover:bg-ds-surface"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-ds-primary px-3 py-2 text-sm font-medium text-ds-text-inverse hover:bg-ds-primary-hover"
                >
                  保存规则
                </button>
              </div>
            </form>
          </div>,
          document.body,
        )}
      {showAgentBatchPlanner &&
        createPortal(
          <Suspense fallback={null}>
            <AgentBatchPlannerModal onClose={() => setShowAgentBatchPlanner(false)} />
          </Suspense>,
          document.body,
        )}
      <Suspense fallback={null}>
        <AssetPickerModal
          open={showAssetPicker}
          onOpenChange={setShowAssetPicker}
          selectionLimit={Math.max(1, MAX_DIRECT_INPUT_IMAGES - inputImages.length)}
          title="选择历史素材作为参考图"
          onSelect={async (assets) => {
            const target = appMode === 'agent' ? 'agent' : 'gallery'
            for (const asset of assets) {
              await assetCommands.useAsReference(asset.id, {
                target,
                workspaceTabId: activeWorkspaceTabId ?? undefined,
              })
            }
          }}
        />
      </Suspense>
      {gallerySopBatchTabIds.map((scopeKey) => {
        const { tabId, folderKey } = splitGallerySopScopeKey(scopeKey)
        return createPortal(
          <Suspense fallback={null}>
            <GallerySopBatchModal
              key={scopeKey}
              workspaceTabId={tabId}
              folderKey={folderKey}
              visible={showGallerySopBatch && visibleGallerySopBatchTabId === scopeKey}
              initialSopId={gallerySopIdsByTab[scopeKey] ?? ''}
              initialPromptCount={gallerySopPromptCountsByTab[scopeKey] ?? 5}
              initialImagesPerPrompt={gallerySopImagesPerPromptByTab[scopeKey] ?? 1}
              syncInitialGenerationCounts
              initialBrief={prompt}
              initialAutoGenerate={gallerySopAutoGenerateByTab[scopeKey] ?? false}
              countsSync={{
                promptCount: gallerySopPromptCountsByTab[scopeKey] ?? 5,
                imagesPerPrompt: gallerySopImagesPerPromptByTab[scopeKey] ?? 1,
                autoGenerate: gallerySopAutoGenerateByTab[scopeKey] ?? false,
                secondReference: gallerySopSecondReferenceByTab[scopeKey] ?? false,
                nonce: gallerySopCountsNonce,
              }}
              initialSecondReference={gallerySopSecondReferenceByTab[scopeKey] ?? false}
              autoStart={gallerySopAutoStartTabId === scopeKey}
              onAutoStartConsumed={() => setGallerySopAutoStartTabId(null)}
              onStatusChange={(nextStatus) => handleGallerySopRunStatusChange(scopeKey, nextStatus)}
              onNeedsAttention={(reason) => {
                revealGallerySopBatch(scopeKey)
                if (reason === 'existing-prompts') {
                  showToast('检测到上一批未提交的提示词，请先确认是继续提交还是清空重来', 'error')
                }
              }}
              onCountsChange={handleGallerySopCountsChange}
              onBackground={() => {
                silentGallerySopTabsRef.current.add(scopeKey)
                setVisibleGallerySopBatchTabId(null)
                setShowGallerySopBatch(false)
                setGallerySopAutoStartTabId(null)
              }}
              onClose={() => {
                silentGallerySopTabsRef.current.delete(scopeKey)
                setGallerySopBatchTabIds((current) => current.filter((id) => id !== scopeKey))
                setVisibleGallerySopBatchTabId((current) => (current === scopeKey ? null : current))
                setShowGallerySopBatch(false)
                setGallerySopAutoStartTabId(null)
                refreshSavedSopPromptCount()
              }}
            />
          </Suspense>,
          document.body,
        )
      })}
      {showGallerySopManagement &&
        createPortal(
          <Suspense fallback={null}>
            <GallerySopManagementCenter
              selectedSopId={gallerySopId}
              onApply={(item) => setGallerySopId(item.id)}
              onClear={() => {
                setGallerySopId('')
                setGallerySopAutoStartTabId(null)
              }}
              onManagePromptRuns={(item) => {
                // 历史三合一：从 SOP 库直接进入提示词管理弹窗并应用该 SOP
                setGallerySopId(item.id)
                setShowGallerySopManagement(false)
                revealGallerySopBatch(gallerySopScopeKey)
              }}
              onClose={() => setShowGallerySopManagement(false)}
            />
          </Suspense>,
          document.body,
        )}
    </>
  )
}
