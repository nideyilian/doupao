import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { IconButton, Menu, MenuItem, MenuSeparator, NavList, Tooltip } from '../../design-system'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BookmarkIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CheckIcon,
  ClipboardPlusIcon,
  Clock3Icon,
  CopyIcon,
  EditIcon,
  ExportIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  Grid2X2Icon,
  ImportIcon,
  Layers3Icon,
  LinkIcon,
  MoreHorizontalIcon,
  PaletteIcon,
  PlusIcon,
  ScissorsIcon,
  SearchIcon,
  StarIcon,
  TrashIcon,
  XIcon,
} from '../../design-system/icons'
import { cn } from '../../lib/shadcn'
import { useStore } from '../../store'
import type { AssetCollection, GeneratedAsset } from '../../types'
import type { AssetSidebarCounts } from './query'
import { useAssetLibraryStore } from './store'
import {
  canAcceptAssetDrag,
  computeBatchMoveDestinations,
  computeMoveDestinations,
  computeRecursiveCollectionCounts,
  filterCollectionTree,
  parseAssetImagePayloadList,
  parseAssetSourceCollectionId,
  type CollectionTreeNode,
  type MoveDestination,
} from '../../lib/assetSidebarUtils'
import { isCollectionTrashed } from '../../lib/assetLibraryModel'
import CollectionInfoModal from './CollectionInfoModal'
import { TAG_COLORS_EXTENDED } from './colorLabels'

type SystemScopeValue = 'all' | 'recent' | 'favorites' | 'unorganized' | 'trash'

const SYSTEM_SCOPES: Array<{ value: SystemScopeValue; label: string; icon: ReactNode }> = [
  { value: 'all', label: '全部素材', icon: <Layers3Icon size={15} /> },
  { value: 'recent', label: '最近生成', icon: <Clock3Icon size={15} /> },
  { value: 'favorites', label: '收藏', icon: <StarIcon size={15} /> },
  { value: 'unorganized', label: '未整理', icon: <Grid2X2Icon size={15} /> },
  { value: 'trash', label: '回收站', icon: <TrashIcon size={15} /> },
]

const SIDEBAR_WIDTH_STORAGE_KEY = 'doupao.asset-library-panel-width'
const SIDEBAR_WIDTH_MIN = 208
const SIDEBAR_WIDTH_MAX = 400
const COLLAPSED_COLLECTIONS_STORAGE_KEY = 'doupao.asset-library-collapsed-collections'

function clampSidebarWidth(value: number): number {
  return Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, Math.round(value)))
}

function loadStoredSidebarWidth(): number | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
    const value = Number(raw)
    return Number.isFinite(value) ? clampSidebarWidth(value) : null
  } catch {
    return null
  }
}

function loadCollapsedIds(storageKey: string): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(storageKey)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [])
  } catch {
    return new Set()
  }
}

export function buildCollectionTree(collections: AssetCollection[]): CollectionTreeNode[] {
  const compare = (a: AssetCollection, b: AssetCollection) =>
    a.order - b.order || a.normalizedName.localeCompare(b.normalizedName, 'zh-CN')
  const nodes = new Map<string, CollectionTreeNode>(
    collections.map((collection) => [collection.id, { collection, children: [] }]),
  )
  const roots: CollectionTreeNode[] = []

  const hasValidParentChain = (collection: AssetCollection) => {
    if (!collection.parentId || !nodes.has(collection.parentId)) return false
    const visited = new Set([collection.id])
    let parentId: string | null = collection.parentId
    while (parentId) {
      if (visited.has(parentId)) return false
      visited.add(parentId)
      parentId = nodes.get(parentId)?.collection.parentId ?? null
    }
    return true
  }

  for (const collection of collections.slice().sort(compare)) {
    const node = nodes.get(collection.id)!
    const parent = collection.parentId ? nodes.get(collection.parentId) : undefined
    if (parent && hasValidParentChain(collection)) parent.children.push(node)
    else roots.push(node)
  }
  for (const node of nodes.values()) node.children.sort((a, b) => compare(a.collection, b.collection))
  return roots
}

// ===== 树虚拟滚动 =====
// 侧栏树支持千级节点：把递归树展平为固定行高（36px）的行列表，只渲染滚动视口内的可见行（含上下 overscan）；
// 小树或测试环境（无真实布局）时退化为全量渲染，行为与旧实现一致。

const TREE_ROW_HEIGHT = 36
const TREE_INDENT = 16
const VIRTUALIZE_THRESHOLD = 80
const VIRTUAL_OVERSCAN_ROWS = 10

export interface CollectionTreeRow {
  kind: 'node' | 'create'
  node?: CollectionTreeNode
  depth?: number
  parentId?: string | null
  label?: string
  /** 树状引导线（Eagle 式）：各级祖先列（不含自身列）的竖线是否贯通本行，第 i 项对应第 i+1 级 */
  guideAncestorLines?: boolean[]
  /** 自身列竖线是否向下延伸（本行之后是否有同级的后续行） */
  guideOwnFollowing?: boolean
}

/** 展平可见项目树（尊重折叠状态；forceExpanded 用于筛选模式全展开；新建行插入正确位置）。 */
export function flattenCollectionRows(
  nodes: CollectionTreeNode[],
  collapsedIds: ReadonlySet<string>,
  creatingParentId: string | null | undefined,
  forceExpanded = false,
): CollectionTreeRow[] {
  const rows: CollectionTreeRow[] = []
  if (!forceExpanded && creatingParentId === null)
    rows.push({ kind: 'create', parentId: null, label: '项目名称', depth: 1 })
  const walk = (children: CollectionTreeNode[], depth: number, ancestorLines: boolean[]) => {
    children.forEach((node, index) => {
      const hasFollowing = index < children.length - 1
      rows.push({ kind: 'node', node, depth, guideAncestorLines: ancestorLines, guideOwnFollowing: hasFollowing })
      const expanded = forceExpanded || !collapsedIds.has(node.collection.id)
      if (!forceExpanded && node.collection.id === creatingParentId) {
        // 新建行是当前节点的子级，深度 +1，渲染时按深度缩进体现层级
        rows.push({
          kind: 'create',
          parentId: node.collection.id,
          label: '子项目名称',
          depth: depth + 1,
          guideAncestorLines: [...ancestorLines, hasFollowing],
          guideOwnFollowing: false,
        })
      }
      if (expanded && node.children.length > 0) walk(node.children, depth + 1, [...ancestorLines, hasFollowing])
    })
  }
  walk(nodes, 1, [])
  return rows
}

/** Eagle 式树状引导线：祖先列竖向贯通线 + 自身列肘线，仅在 depth ≥ 2 的行上绘制。 */
function TreeGuideLines({
  ancestorLines,
  depth,
  ownFollowing,
}: {
  ancestorLines: boolean[]
  depth: number
  ownFollowing: boolean
}) {
  if (depth < 2) return null
  const ownX = (depth - 2) * TREE_INDENT + TREE_INDENT / 2
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 z-0">
      {ancestorLines.map((active, index) =>
        active ? (
          <span
            key={index}
            className="absolute bottom-0 top-0 w-px bg-ds-border"
            style={{ left: index * TREE_INDENT + TREE_INDENT / 2 }}
          />
        ) : null,
      )}
      <span className="absolute top-0 w-px bg-ds-border" style={{ left: ownX, height: '50%' }} />
      {ownFollowing && <span className="absolute bottom-0 w-px bg-ds-border" style={{ left: ownX, height: '50%' }} />}
      <span className="absolute h-px bg-ds-border" style={{ left: ownX, top: '50%', width: TREE_INDENT / 2 }} />
    </span>
  )
}

/** 滚动使指定行进入可视区；非虚拟化时直接用元素 scrollIntoView，虚拟化时按行高换算内容坐标。 */
function scrollTreeRowIntoView(
  scroll: HTMLElement | null,
  container: HTMLElement | null,
  rowIndex: number,
  virtualized: boolean,
) {
  if (!container) return
  if (!virtualized) {
    const el = container.querySelector(`[data-row-index="${rowIndex}"]`)
    el?.scrollIntoView?.({ block: 'nearest' })
    return
  }
  if (!scroll || typeof scroll.scrollTop !== 'number' || typeof scroll.clientHeight !== 'number') return
  if (typeof scroll.getBoundingClientRect !== 'function' || typeof container.getBoundingClientRect !== 'function')
    return
  const navRect = scroll.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  const rowTop = containerRect.top - navRect.top + scroll.scrollTop + rowIndex * TREE_ROW_HEIGHT
  if (rowTop < scroll.scrollTop) scroll.scrollTop = rowTop
  else if (rowTop + TREE_ROW_HEIGHT > scroll.scrollTop + scroll.clientHeight) {
    scroll.scrollTop = rowTop + TREE_ROW_HEIGHT - scroll.clientHeight
  }
}

interface VirtualRange {
  start: number
  end: number
  virtualized: boolean
}

/**
 * 计算树容器的可见行窗口。容器位于 <nav> 滚动内容中（上方有系统范围/分组头等固定内容），
 * 因此用容器相对 nav 内容的偏移换算可见行区间；无真实布局（测试环境）或行数很少时全量渲染。
 */
function useVirtualRange(
  scrollRef: RefObject<HTMLElement | null>,
  containerRef: RefObject<HTMLDivElement | null>,
  rowCount: number,
  layoutVersion: unknown,
): VirtualRange {
  const [range, setRange] = useState<VirtualRange>(() => ({ start: 0, end: rowCount, virtualized: false }))

  useEffect(() => {
    const scroll = scrollRef.current
    const container = containerRef.current
    // 测试环境/无真实 DOM：退化为全量渲染
    if (
      !scroll ||
      !container ||
      typeof scroll.clientHeight !== 'number' ||
      typeof scroll.addEventListener !== 'function'
    ) {
      setRange((prev) =>
        prev.start === 0 && prev.end === rowCount && !prev.virtualized
          ? prev
          : { start: 0, end: rowCount, virtualized: false },
      )
      return
    }
    let frame: number | null = null
    const update = () => {
      if (rowCount <= VIRTUALIZE_THRESHOLD || scroll.clientHeight <= 0) {
        setRange((prev) =>
          prev.start === 0 && prev.end === rowCount && !prev.virtualized
            ? prev
            : { start: 0, end: rowCount, virtualized: false },
        )
        return
      }
      const scrollTop = scroll.scrollTop
      const navRect = scroll.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()
      const containerTop = containerRect.top - navRect.top + scrollTop
      const start = Math.max(0, Math.floor((scrollTop - containerTop) / TREE_ROW_HEIGHT) - VIRTUAL_OVERSCAN_ROWS)
      const end = Math.min(
        rowCount,
        Math.ceil((scrollTop + scroll.clientHeight - containerTop) / TREE_ROW_HEIGHT) + VIRTUAL_OVERSCAN_ROWS,
      )
      setRange((prev) =>
        prev.start === start && prev.end === end && prev.virtualized ? prev : { start, end, virtualized: true },
      )
    }
    update()
    const onScroll = () => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        update()
      })
    }
    scroll.addEventListener('scroll', onScroll, { passive: true })
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(() => update())
      observer.observe(scroll)
      observer.observe(container)
    }
    return () => {
      scroll.removeEventListener('scroll', onScroll)
      observer?.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [scrollRef, containerRef, rowCount, layoutVersion])

  return range
}

/** 高亮文本中匹配片段（筛选时高亮命中词）。 */
function highlightText(text: string, needle: string): ReactNode {
  const needleTrimmed = needle.trim()
  const lower = needleTrimmed.toLowerCase()
  if (!lower) return text
  const index = text.toLowerCase().indexOf(lower)
  if (index < 0) return text
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-sm bg-ds-warning/40 px-px text-inherit">
        {text.slice(index, index + needleTrimmed.length)}
      </mark>
      {text.slice(index + needleTrimmed.length)}
    </>
  )
}

interface SectionHeaderProps {
  count: number
  expanded: boolean
  label: string
  onCreate?: () => void
  onToggle: () => void
}

/** 分组标题：轻量小字 + 计数徽章 + 折叠箭头 + 可选新建按钮（Eagle 风格分组头）。 */
function SectionHeader({ count, expanded, label, onCreate, onToggle }: SectionHeaderProps) {
  return (
    <div className="mt-3 flex h-ds-control-sm items-center gap-0.5 px-1">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-1 text-left text-xs font-semibold tracking-wider text-ds-muted outline-none hover:text-ds-foreground focus-visible:ring-2 focus-visible:ring-ds-focus/70"
      >
        {expanded ? (
          <ChevronDownIcon size={13} className="shrink-0" />
        ) : (
          <ChevronRightIcon size={13} className="shrink-0" />
        )}
        <span className="truncate">{label}</span>
        <span className="ml-0.5 shrink-0 rounded-full bg-ds-muted/15 px-1.5 py-px text-xs font-normal tabular-nums text-ds-muted/80">
          {count}
        </span>
      </button>
      {onCreate && (
        <Tooltip content={`新建${label}`}>
          <IconButton
            size="sm"
            className="!h-6 !w-6 !min-h-6"
            aria-label={`新建${label}`}
            icon={<PlusIcon size={13} />}
            onClick={onCreate}
          />
        </Tooltip>
      )}
    </div>
  )
}

interface CreateRowProps {
  label: string
  onCancel: () => void
  onCreate: (name: string) => Promise<unknown | null>
}

function CreateRow({ label, onCancel, onCreate }: CreateRowProps) {
  const [name, setName] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      onCancel()
      return
    }
    const saved = await onCreate(trimmed)
    if (saved) onCancel()
  }

  return (
    <form onSubmit={submit} className="flex h-ds-control-sm items-center gap-1 px-1">
      <FolderIcon size={14} className="shrink-0 text-ds-muted" />
      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel()
        }}
        placeholder={label}
        aria-label={label}
        className="min-w-0 flex-1 rounded border border-ds-primary bg-ds-surface px-2 py-1 text-xs text-ds-foreground outline-none placeholder:text-ds-muted"
      />
      <button
        type="submit"
        aria-label={`保存${label}`}
        className="grid h-6 w-6 shrink-0 place-items-center rounded text-ds-primary outline-none hover:bg-ds-primary/15 focus-visible:ring-2 focus-visible:ring-ds-focus/70"
      >
        <CheckIcon size={13} />
      </button>
      <button
        type="button"
        aria-label={`取消${label}`}
        onClick={onCancel}
        className="grid h-6 w-6 shrink-0 place-items-center rounded text-ds-muted outline-none hover:bg-ds-muted/20 hover:text-ds-foreground focus-visible:ring-2 focus-visible:ring-ds-focus/70"
      >
        <XIcon size={13} />
      </button>
    </form>
  )
}

interface RowActionsProps {
  label: string
  onCreateChild?: () => void
  onDelete: () => void
  onRename: () => void
  /** 粘贴到当前节点 */
  onPaste: () => void
  /** 打开文件夹信息弹窗 */
  onShowInfo?: () => void
  /** 导入图片到当前文件夹 */
  onImport?: () => void
  /** 传入项目 id 时显示“移动到…”，用于调整项目层级 */
  collectionId?: string
  /** 当前文件夹颜色（设置颜色视图高亮） */
  currentColor?: string
  onSetColor?: (color: string | null) => void
}

export type TreeItemMenuView = 'main' | 'move' | 'merge' | 'color'

interface TreeItemMenuItemsProps {
  view: TreeItemMenuView
  setView: (view: TreeItemMenuView) => void
  onClose: () => void
  label: string
  onCreateChild?: () => void
  onDelete: () => void
  onRename: () => void
  /** 粘贴到当前节点（已由父级处理好展开/滚动） */
  onPaste: () => void
  /** 打开文件夹信息弹窗 */
  onShowInfo?: () => void
  /** 导入图片到当前文件夹 */
  onImport?: () => void
  /** 被操作的树节点 id（项目） */
  moveTargetId: string | null
  /** 当前文件夹颜色（用于设置颜色视图高亮） */
  currentColor?: string
  onSetColor?: (color: string | null) => void
  destinations: MoveDestination[]
}

/** 树节点菜单内容（hover 更多按钮与右键菜单共用）：重命名 / 新建子项 / 复制 / 剪切 / 粘贴 / 移动到… / 设置颜色 / 删除。 */
function TreeItemMenuItems({
  view,
  setView,
  onClose,
  label,
  onCreateChild,
  onDelete,
  onPaste,
  onRename,
  onShowInfo,
  onImport,
  moveTargetId,
  currentColor,
  onSetColor,
  destinations,
}: TreeItemMenuItemsProps) {
  const clipboard = useAssetLibraryStore((state) => state.clipboard)
  // 项目与素材剪贴板均可粘贴（粘贴动作由 pasteIntoCollection 分流）
  const canPaste = clipboard !== null
  // 合并目标：排除根级入口（合并必须有一个目标文件夹）
  const mergeDestinations = destinations.filter((destination) => destination.id !== null)
  if (view === 'move') {
    return (
      <>
        <MenuItem
          onClick={(event) => {
            event.stopPropagation()
            setView('main')
          }}
        >
          ← 返回
        </MenuItem>
        <MenuSeparator />
        {destinations.map((destination) => (
          <MenuItem
            key={destination.id ?? '__root__'}
            onClick={(event) => {
              event.stopPropagation()
              onClose()
              if (!moveTargetId) return
              const { moveCollection } = useAssetLibraryStore.getState()
              void moveCollection(moveTargetId, destination.id)
                .then(() => {
                  // moveCollection 对「回收站/子项目」等拒绝场景已内部弹 error 且不 reject，
                  // 这里通过移动后的实际父级判断是否成功，避免误报成功。
                  const after = useAssetLibraryStore.getState().collections.find((item) => item.id === moveTargetId)
                  if (after?.parentId === destination.id) {
                    useStore
                      .getState()
                      .showToast(
                        `已移动「${label}」${destination.label ? `到「${destination.label}」` : '到根目录'}`,
                        'success',
                      )
                  }
                })
                .catch(() => useStore.getState().showToast('移动失败', 'error'))
            }}
          >
            <span className="block truncate" style={{ paddingLeft: `${destination.depth * 0.75}rem` }}>
              {destination.label}
            </span>
          </MenuItem>
        ))}
      </>
    )
  }
  if (view === 'color') {
    return (
      <>
        <MenuItem
          onClick={(event) => {
            event.stopPropagation()
            setView('main')
          }}
        >
          ← 返回
        </MenuItem>
        <MenuSeparator />
        <div className="flex flex-wrap gap-1 px-2 py-1.5">
          {TAG_COLORS_EXTENDED.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`设置文件夹颜色 ${color}`}
              onClick={(event) => {
                event.stopPropagation()
                onClose()
                onSetColor?.(color)
              }}
              className={`h-5 w-5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ds-focus/70 ${currentColor === color ? 'ring-2 ring-ds-focus ring-offset-1' : ''}`}
              style={{ backgroundColor: color }}
            />
          ))}
          {currentColor && (
            <button
              type="button"
              aria-label="清除文件夹颜色"
              onClick={(event) => {
                event.stopPropagation()
                onClose()
                onSetColor?.(null)
              }}
              className="h-5 w-5 rounded-full border border-ds-border text-xs leading-none text-ds-muted outline-none hover:bg-ds-muted/20 focus-visible:ring-2 focus-visible:ring-ds-focus/70"
            >
              ✕
            </button>
          )}
        </div>
      </>
    )
  }
  if (view === 'merge') {
    return (
      <>
        <MenuItem
          onClick={(event) => {
            event.stopPropagation()
            setView('main')
          }}
        >
          ← 返回
        </MenuItem>
        <MenuSeparator />
        {mergeDestinations.map((destination) => (
          <MenuItem
            key={destination.id}
            onClick={(event) => {
              event.stopPropagation()
              onClose()
              if (!moveTargetId || !destination.id) return
              void useAssetLibraryStore.getState().mergeCollection(moveTargetId, destination.id)
            }}
          >
            <span className="block truncate" style={{ paddingLeft: `${destination.depth * 0.75}rem` }}>
              {destination.label}
            </span>
          </MenuItem>
        ))}
      </>
    )
  }
  return (
    <>
      {onCreateChild && (
        <MenuItem
          icon={<PlusIcon size={13} />}
          onClick={(event) => {
            event.stopPropagation()
            onClose()
            onCreateChild()
          }}
        >
          新建子项
        </MenuItem>
      )}
      <MenuItem
        icon={<EditIcon size={13} />}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
          onRename()
        }}
      >
        重命名
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        icon={<CopyIcon size={13} />}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
          if (!moveTargetId) return
          void useAssetLibraryStore.getState().copyCollection(moveTargetId)
        }}
      >
        复制
      </MenuItem>
      <MenuItem
        icon={<ScissorsIcon size={13} />}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
          if (!moveTargetId) return
          void useAssetLibraryStore.getState().cutCollection(moveTargetId)
        }}
      >
        剪切
      </MenuItem>
      <MenuItem
        icon={<ClipboardPlusIcon size={13} />}
        disabled={!canPaste}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
          onPaste()
        }}
      >
        粘贴到此处
      </MenuItem>
      <MenuItem
        icon={<FolderPlusIcon size={13} />}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
          if (moveTargetId) void useAssetLibraryStore.getState().duplicateCollection(moveTargetId)
        }}
      >
        就地复制
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        icon={<ArrowUpIcon size={13} />}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
          if (moveTargetId) void useAssetLibraryStore.getState().reorderCollection(moveTargetId, 'up')
        }}
      >
        上移
      </MenuItem>
      <MenuItem
        icon={<ArrowDownIcon size={13} />}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
          if (moveTargetId) void useAssetLibraryStore.getState().reorderCollection(moveTargetId, 'down')
        }}
      >
        下移
      </MenuItem>
      <MenuItem
        icon={<BookmarkIcon size={13} />}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
          if (moveTargetId) void useAssetLibraryStore.getState().togglePinCollection(moveTargetId)
        }}
      >
        置顶 / 取消置顶
      </MenuItem>
      <MenuItem
        icon={<PaletteIcon size={13} />}
        onClick={(event) => {
          event.stopPropagation()
          setView('color')
        }}
      >
        设置颜色
      </MenuItem>
      <MenuItem
        icon={<Layers3Icon size={13} />}
        onClick={(event) => {
          event.stopPropagation()
          setView('merge')
        }}
      >
        合并到…
      </MenuItem>
      <MenuItem
        icon={<ImportIcon size={13} />}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
          onImport?.()
        }}
      >
        导入图片到此文件夹…
      </MenuItem>
      <MenuItem
        icon={<ExportIcon size={13} />}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
          if (moveTargetId) void useAssetLibraryStore.getState().exportCollectionToZip(moveTargetId)
        }}
      >
        导出为 ZIP…
      </MenuItem>
      <MenuItem
        icon={<FileTextIcon size={13} />}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
          onShowInfo?.()
        }}
      >
        文件夹信息
      </MenuItem>
      <MenuItem
        icon={<LinkIcon size={13} />}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
          if (!moveTargetId) return
          const ref = `[${label}](doupao://collection?id=${encodeURIComponent(moveTargetId)})`
          void navigator.clipboard?.writeText(ref).then(
            () => void useStore.getState().showToast('已复制为链接', 'success'),
            () => void useStore.getState().showToast('复制链接失败', 'error'),
          )
        }}
      >
        复制为链接
      </MenuItem>
      <MenuItem
        onClick={(event) => {
          event.stopPropagation()
          setView('move')
        }}
      >
        移动到…
      </MenuItem>
      <MenuItem
        tone="danger"
        icon={<TrashIcon size={13} />}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
          onDelete()
        }}
      >
        删除
      </MenuItem>
    </>
  )
}

function RowActions({
  label,
  onCreateChild,
  onDelete,
  onPaste,
  onRename,
  onShowInfo,
  onImport,
  collectionId,
  currentColor,
  onSetColor,
}: RowActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [view, setView] = useState<TreeItemMenuView>('main')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const collections = useAssetLibraryStore((state) => state.collections)

  const destinations = useMemo(() => {
    // 懒计算：仅菜单打开时才构建目标列表，避免每个节点挂载即 O(n) 导致 O(n²)。
    if (!menuOpen) return []
    return collectionId ? computeMoveDestinations(collections, collectionId) : []
  }, [menuOpen, collectionId, collections])

  const close = () => {
    setMenuOpen(false)
    setView('main')
    if (menuOpen) triggerRef.current?.focus()
  }

  return (
    <span
      className="pointer-events-none absolute right-1 top-1/2 z-10 flex -translate-y-1/2 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close()
      }}
    >
      {onCreateChild && (
        <Tooltip content="新建子项">
          <IconButton
            size="sm"
            className="!h-6 !w-6 !min-h-6"
            aria-label={`在${label}中新建子项`}
            icon={<PlusIcon size={12} />}
            onClick={(event) => {
              event.stopPropagation()
              onCreateChild()
            }}
          />
        </Tooltip>
      )}
      <span className="relative flex">
        <Tooltip content="更多操作">
          <IconButton
            ref={triggerRef}
            size="sm"
            className="!h-6 !w-6 !min-h-6"
            aria-label={`${label}更多操作`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            icon={<MoreHorizontalIcon size={13} />}
            onClick={(event) => {
              event.stopPropagation()
              setView('main')
              setMenuOpen((open) => !open)
            }}
          />
        </Tooltip>
        {menuOpen && (
          <Menu
            label={`${label}操作`}
            className="!absolute right-0 top-7 z-30 w-44 p-1"
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              event.stopPropagation()
              close()
            }}
          >
            <TreeItemMenuItems
              view={view}
              setView={setView}
              onClose={close}
              label={label}
              onCreateChild={onCreateChild}
              onDelete={onDelete}
              onPaste={onPaste}
              onRename={onRename}
              onShowInfo={onShowInfo}
              onImport={onImport}
              moveTargetId={collectionId ?? null}
              currentColor={currentColor}
              onSetColor={onSetColor}
              destinations={destinations}
            />
          </Menu>
        )}
      </span>
    </span>
  )
}

interface TreeItemDropHandlers {
  dragOver: boolean
  onDragOver: (event: DragEvent) => void
  onDragLeave: () => void
  onDrop: (event: DragEvent) => void
}

function useAssetDropTarget(
  onDropAssets: (assetIds: string[], sourceCollectionId: string | null) => void,
): Omit<TreeItemDropHandlers, 'dragOver'> & { dragOver: boolean } {
  const [dragOver, setDragOver] = useState(false)
  return {
    dragOver,
    onDragOver: (event) => {
      if (!canAcceptAssetDrag(event.dataTransfer)) return
      event.preventDefault()
      event.stopPropagation()
      // 拖到文件夹 = 移动（剪切）；拖到输入框作参考图仍由该目标自行设回 copy
      event.dataTransfer.dropEffect = 'move'
      setDragOver(true)
    },
    onDragLeave: () => setDragOver(false),
    onDrop: (event) => {
      setDragOver(false)
      const assetIds = parseAssetImagePayloadList(event.dataTransfer)
      if (assetIds.length === 0) return
      event.preventDefault()
      event.stopPropagation()
      onDropAssets(assetIds, parseAssetSourceCollectionId(event.dataTransfer))
    },
  }
}

// ===== 文件夹拖拽（Eagle 式同级排序/嵌套）=====

/** 文件夹拖拽负载类型：JSON 数组（多选拖拽时为全部选中文件夹 id） */
export const COLLECTION_DRAG_TYPE = 'application/x-doupao-collection-ids'

/** 从拖拽负载解析文件夹 id 列表；非文件夹拖拽返回 null。 */
function parseCollectionDragIds(dataTransfer: DataTransfer | null): string[] | null {
  if (!dataTransfer) return null
  const raw = dataTransfer.getData(COLLECTION_DRAG_TYPE)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : null
  } catch {
    return null
  }
}

/**
 * dragover 阶段判定是否为文件夹拖拽。
 * Chromium 安全限制：dragover 期间 getData() 返回空字符串，只能读 types；
 * 因此在 dragover 用类型粗判（与素材拖拽的 canAcceptAssetDrag 同一模式），
 * drop 阶段再用 parseCollectionDragIds 严格解析负载。
 */
function canAcceptFolderDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false
  return Array.from(dataTransfer.types).includes(COLLECTION_DRAG_TYPE)
}

/** 按鼠标在行内的纵向位置判定投放区：上 30% 插入前、下 30% 插入后、中间嵌套。 */
function getFolderDropZone(event: DragEvent<HTMLDivElement>): 'before' | 'after' | 'into' {
  const rect = event.currentTarget.getBoundingClientRect()
  if (rect.height > 0 && Number.isFinite(event.clientY)) {
    const ratio = (event.clientY - rect.top) / rect.height
    if (ratio < 0.3) return 'before'
    if (ratio > 0.7) return 'after'
  }
  return 'into'
}

/**
 * 素材拖入项目节点后的归类动作：从文件夹视图拖出 = 移动（移除源文件夹归属）；否则 = 添加。
 * 若目标文件夹已存在相同内容（imageId 相同，含同一素材已在目标文件夹），弹确认框让用户选择：
 * 仍然添加 / 跳过重复 / 替换（移除目标文件夹内同 imageId 旧素材的该文件夹归属，再放入新素材）。
 */ async function applyAssetsToCollection(
  assetIds: string[],
  collectionId: string,
  name: string,
  sourceCollectionId: string | null = null,
) {
  const store = useAssetLibraryStore.getState()
  const targets = resolveDropTargetAssets(store, assetIds)
  if (targets.length === 0) return

  const duplicateIds = findDuplicateAssetIds(store, targets, collectionId)
  if (duplicateIds.size > 0) {
    const duplicateCount = duplicateIds.size
    useStore.getState().setConfirmDialog({
      icon: 'info',
      title: '目标项目中有相同素材',
      message: `拖入的素材中有 ${duplicateCount} 张与项目「${name}」中已有的素材内容相同。如何处理？`,
      buttons: [
        {
          label: '仍然添加',
          tone: 'secondary',
          action: () => void commitDrop(store, targets, collectionId, name, sourceCollectionId, new Set()),
        },
        {
          label: '跳过重复',
          tone: 'secondary',
          action: () =>
            void commitDrop(
              store,
              targets.filter((asset) => !duplicateIds.has(asset.id)),
              collectionId,
              name,
              sourceCollectionId,
              new Set(),
            ),
        },
        {
          label: '替换',
          tone: 'primary',
          action: () => void commitDrop(store, targets, collectionId, name, sourceCollectionId, duplicateIds),
        },
      ],
    })
    return
  }
  await commitDrop(store, targets, collectionId, name, sourceCollectionId, new Set())
}

/** 找出与目标文件夹已有素材「内容相同」（imageId 相同，含同一素材已在目标文件夹）的拖入素材。 */
function findDuplicateAssetIds(
  store: { assetsById: Record<string, GeneratedAsset>; assetOrder: string[] },
  targets: GeneratedAsset[],
  collectionId: string,
): Set<string> {
  const existingImageIds = new Set<string>()
  for (const id of store.assetOrder) {
    const asset = store.assetsById[id]
    if (!asset || asset.status === 'trashed' || !asset.collectionIds.includes(collectionId)) continue
    existingImageIds.add(asset.imageId)
  }
  const duplicateIds = new Set<string>()
  for (const asset of targets) {
    if (existingImageIds.has(asset.imageId)) duplicateIds.add(asset.id)
  }
  return duplicateIds
}

/**
 * 执行拖入：replaceIds 中的素材先「替换」目标文件夹内同 imageId 的旧素材
 * （仅移除旧素材在该文件夹的归属，不删除素材本身），再按移动/添加语义归入新素材。
 *
 * Eagle 式批量：先在内存收集全部变更（替换 + 移动），再一次性原子写入
 * （快照 + 分批 + 单次 store 更新 + 可撤销），网格不逐张闪烁。
 */
async function commitDrop(
  store: ReturnType<typeof useAssetLibraryStore.getState>,
  targets: GeneratedAsset[],
  collectionId: string,
  name: string,
  sourceCollectionId: string | null,
  replaceIds: Set<string>,
) {
  const multi = targets.length > 1
  const moved = sourceCollectionId !== null
  const replacing = replaceIds.size > 0
  const updates: Array<{ id: string; collectionIds: string[] }> = []
  try {
    if (replacing) {
      const replacedImageIds = new Set(
        targets.filter((asset) => replaceIds.has(asset.id)).map((asset) => asset.imageId),
      )
      for (const id of store.assetOrder) {
        const existing = store.assetsById[id]
        if (!existing || existing.status === 'trashed' || replaceIds.has(existing.id)) continue
        if (!existing.collectionIds.includes(collectionId)) continue
        if (!replacedImageIds.has(existing.imageId)) continue
        updates.push({ id: existing.id, collectionIds: existing.collectionIds.filter((c) => c !== collectionId) })
      }
    }
    for (const asset of targets) {
      const next = new Set(asset.collectionIds)
      if (moved) next.delete(sourceCollectionId!) // 移动：从源文件夹移除归属
      next.add(collectionId)
      updates.push({ id: asset.id, collectionIds: [...next] })
    }
    if (updates.length === 0) {
      useStore.getState().showToast(multi ? `这些素材已在项目「${name}」中` : `已加入项目「${name}」`, 'success')
      return
    }
    const changed = await store.applyBatchCollectionChanges(updates, `移动 ${updates.length} 张至项目「${name}」`)
    const message = replacing
      ? `已替换项目「${name}」中的重复素材`
      : changed > 0
        ? moved
          ? `已移动至项目「${name}」${multi ? `（${changed} 张）` : ''}`
          : `已加入项目「${name}」${multi ? `（${changed} 张）` : ''}`
        : multi
          ? `这些素材已在项目「${name}」中`
          : `已加入项目「${name}」`
    useStore.getState().showToast(message, 'success')
  } catch {
    useStore.getState().showToast(moved ? '移动失败' : '加入项目失败', 'error')
  }
}

/**
 * 把拖拽负载解析出的 id 归一化为素材记录：
 * 多选负载携带 asset id（assetsById 键）；单张回退负载携带 imageId（导入素材 id === imageId，生成素材为 asset:<imageId>）。
 */
function resolveDropTargetAssets(
  store: { assetsById: Record<string, GeneratedAsset> },
  ids: string[],
): GeneratedAsset[] {
  const resolved: GeneratedAsset[] = []
  for (const id of ids) {
    const asset = store.assetsById[id] ?? store.assetsById[`asset:${id}`]
    if (asset && !resolved.some((item) => item.id === asset.id)) resolved.push(asset)
  }
  return resolved
}

interface CollectionTreeItemProps {
  activeId: string | null
  collapsedIds: ReadonlySet<string>
  counts: ReadonlyMap<string, number>
  depth: number
  node: CollectionTreeNode
  onCreateChild: (parentId: string) => void
  onDelete: (id: string) => void
  /** 粘贴到当前项目 */
  onPaste: () => void
  onRename: (id: string, name: string) => Promise<void>
  onSelect: (id: string) => void
  onToggle: (id: string) => void
  rowIndex: number
  totalRows: number
  parentRowIndex: number | null
  onFocusRow: (index: number) => void
  /** 筛选高亮词 */
  highlight?: string
  /** 多选状态 */
  selected?: boolean
  onToggleSelect?: (id: string) => void
  /** Shift 范围多选：从锚点连续选择到该文件夹 */
  onShiftSelect?: (id: string) => void
  /** 打开文件夹信息弹窗 */
  onShowInfo?: () => void
  /** 导入图片到当前文件夹 */
  onImport?: () => void
  /** 全局 F2 触发的重命名请求（请求 id 与本行一致时进入编辑态并消费请求） */
  renameRequestId?: string
  /** 文件夹拖拽：本行是否正在被拖动 */
  folderDragging?: boolean
  /** 文件夹拖拽投放区（插入线/嵌套高亮） */
  folderDropZone?: 'before' | 'after' | 'into' | null
  onFolderDragStart: (collectionId: string, event: DragEvent<HTMLDivElement>) => void
  onFolderDragEnd: () => void
  onFolderDragOver: (collectionId: string, zone: 'before' | 'after' | 'into') => void
  onFolderDrop: (collectionId: string, zone: 'before' | 'after' | 'into') => void
  /** 虚拟滚动时的绝对定位样式；非虚拟化时为缩进样式 */
  style?: CSSProperties
  /** 树状引导线：祖先列贯通掩码 + 自身列是否向下延伸 */
  guideAncestorLines?: boolean[]
  guideOwnFollowing?: boolean
}

function CollectionTreeItem({
  activeId,
  collapsedIds,
  counts,
  depth,
  node,
  onCreateChild,
  onDelete,
  onPaste,
  onRename,
  onSelect,
  onToggle,
  rowIndex,
  totalRows,
  parentRowIndex,
  onFocusRow,
  highlight,
  selected = false,
  onToggleSelect,
  onShiftSelect,
  onShowInfo,
  onImport,
  renameRequestId,
  folderDragging = false,
  folderDropZone = null,
  onFolderDragStart,
  onFolderDragEnd,
  onFolderDragOver,
  onFolderDrop,
  style,
  guideAncestorLines = [],
  guideOwnFollowing = false,
}: CollectionTreeItemProps) {
  const { collection, children } = node
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(collection.name)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const active = activeId === collection.id
  const expanded = !collapsedIds.has(collection.id)
  const hasChildren = children.length > 0
  const collections = useAssetLibraryStore((state) => state.collections)
  const clipboard = useAssetLibraryStore((state) => state.clipboard)
  const isCutSource = clipboard?.kind === 'cut' && clipboard.type === 'collection' && clipboard.id === collection.id
  const isSelected = selected === true

  // 全局 F2 重命名请求：命中本行时进入编辑态并消费请求
  useEffect(() => {
    if (renameRequestId !== collection.id) return
    setDraft(collection.name)
    setEditing(true)
    useAssetLibraryStore.getState().setFolderEditRequest(null)
  }, [renameRequestId, collection.id, collection.name])
  const destinations = useMemo(
    () => (contextMenu ? computeMoveDestinations(collections, collection.id) : []),
    [contextMenu, collections, collection.id],
  )
  const dropTarget = useAssetDropTarget(
    (assetIds, sourceCollectionId) =>
      void applyAssetsToCollection(assetIds, collection.id, collection.name, sourceCollectionId),
  )

  // ===== 文件夹拖拽（Eagle 式同级排序/嵌套）=====
  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    // 按钮/输入框上的按下不应触发整行拖拽
    if ((event.target as HTMLElement).closest('button, input')) {
      event.preventDefault()
      return
    }
    onFolderDragStart(collection.id, event)
  }

  const handleRowDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (canAcceptFolderDrag(event.dataTransfer)) {
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'move'
      onFolderDragOver(collection.id, getFolderDropZone(event))
      return
    }
    dropTarget.onDragOver(event)
  }

  const handleRowDrop = (event: DragEvent<HTMLDivElement>) => {
    if (parseCollectionDragIds(event.dataTransfer)) {
      event.preventDefault()
      event.stopPropagation()
      onFolderDrop(collection.id, getFolderDropZone(event))
      return
    }
    dropTarget.onDrop(event)
  }

  useEffect(() => {
    if (!contextMenu) return
    const onMouseDown = (event: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) setContextMenu(null)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [contextMenu])

  const finishRename = () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== collection.name) void onRename(collection.id, trimmed)
    setEditing(false)
  }

  return (
    <div
      role="treeitem"
      data-row-index={rowIndex}
      aria-level={depth}
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={active}
      tabIndex={0}
      style={style}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('button, input')) return
        if (event.shiftKey) {
          event.preventDefault()
          event.stopPropagation()
          onShiftSelect?.(collection.id)
          return
        }
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault()
          event.stopPropagation()
          onToggleSelect?.(collection.id)
          return
        }
        onSelect(collection.id)
      }}
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest('button, input')) return
        setDraft(collection.name)
        setEditing(true)
      }}
      onContextMenu={(event) => {
        if ((event.target as HTMLElement).closest('button, input')) return
        event.preventDefault()
        setContextMenu({ x: event.clientX, y: event.clientY })
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(collection.id)
        } else if (event.key === 'F2') {
          event.preventDefault()
          setDraft(collection.name)
          setEditing(true)
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
          // Eagle 式：Delete 删除文件夹（多选时删除整个选中集；deleteFolders 内含确认弹窗）
          event.preventDefault()
          event.stopPropagation()
          const folderStore = useAssetLibraryStore.getState()
          const ids = folderStore.selectedFolderIds.includes(collection.id)
            ? folderStore.selectedFolderIds
            : [collection.id]
          void folderStore.deleteFolders(ids)
        } else if (event.key === 'ArrowRight') {
          event.preventDefault()
          if (hasChildren && !expanded) onToggle(collection.id)
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault()
          if (hasChildren && expanded) onToggle(collection.id)
          else if (parentRowIndex !== null) onFocusRow(parentRowIndex)
        } else if (event.key === 'ArrowDown') {
          event.preventDefault()
          if (rowIndex + 1 < totalRows) onFocusRow(rowIndex + 1)
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          if (rowIndex > 0) onFocusRow(rowIndex - 1)
        } else if (event.key === 'Home') {
          event.preventDefault()
          onFocusRow(0)
        } else if (event.key === 'End') {
          event.preventDefault()
          onFocusRow(totalRows - 1)
        } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
          event.preventDefault()
          useAssetLibraryStore.getState().copyCollection(collection.id)
        } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x') {
          event.preventDefault()
          useAssetLibraryStore.getState().cutCollection(collection.id)
        } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
          event.preventDefault()
          onPaste()
        }
      }}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={onFolderDragEnd}
      className="relative min-w-0 outline-none focus-visible:[&>div:first-child]:ring-2 focus-visible:[&>div:first-child]:ring-ds-focus/70"
    >
      <div
        {...dropTarget}
        onDragOver={handleRowDragOver}
        onDrop={handleRowDrop}
        className={cn(
          'group relative flex h-ds-control-md w-full min-w-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs outline-none transition-colors',
          active
            ? 'bg-[hsl(var(--ds-color-selection-surface))] font-medium text-ds-selection-text shadow-[inset_2px_0_0_hsl(var(--ds-color-selection-border))]'
            : 'text-ds-foreground hover:bg-ds-muted/20',
          dropTarget.dragOver && 'bg-ds-primary/15 ring-1 ring-inset ring-ds-focus/50',
          folderDragging && 'opacity-50',
          folderDropZone === 'into' && 'bg-ds-primary/15 ring-1 ring-inset ring-ds-focus/50',
          isCutSource && 'opacity-50',
          isSelected && 'ring-1 ring-inset ring-ds-primary/70',
        )}
      >
        {/* 文件夹拖拽插入线（同级排序指示） */}
        {folderDropZone === 'before' && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -top-px left-1 right-1 z-10 h-0.5 rounded-full bg-ds-focus"
          />
        )}
        {folderDropZone === 'after' && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-px left-1 right-1 z-10 h-0.5 rounded-full bg-ds-focus"
          />
        )}
        {/* 多选复选框（Eagle 式）：hover 显示，选中常驻；点击切换选择，不触发导航 */}
        <button
          type="button"
          tabIndex={-1}
          aria-label={isSelected ? `取消选择 ${collection.name}` : `选择 ${collection.name}`}
          title={
            isSelected
              ? `已选中 ${collection.name}（再次点击取消）`
              : `选择 ${collection.name}（可 Ctrl/⌘ 或 Shift 多选）`
          }
          onClick={(event) => {
            event.stopPropagation()
            onToggleSelect?.(collection.id)
          }}
          className={cn(
            'grid h-4 w-4 shrink-0 place-items-center rounded-sm border outline-none transition-opacity',
            isSelected
              ? 'border-ds-primary bg-ds-primary text-ds-text-inverse opacity-100'
              : 'border-ds-border text-ds-muted opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-60',
          )}
        >
          <CheckIcon size={10} className={isSelected ? '' : 'opacity-40'} />
        </button>
        {hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`${expanded ? '收起' : '展开'}${collection.name}`}
            onClick={(event) => {
              event.stopPropagation()
              onToggle(collection.id)
            }}
            className="grid h-5 w-5 shrink-0 place-items-center rounded text-ds-muted hover:bg-ds-muted/20 hover:text-ds-foreground"
          >
            {expanded ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0" aria-hidden="true" />
        )}
        {collection.color && (
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: collection.color }}
          />
        )}
        {expanded && hasChildren ? (
          <FolderOpenIcon size={14} className="shrink-0 text-ds-primary" />
        ) : (
          <FolderIcon size={14} className="shrink-0 text-ds-muted" />
        )}
        {editing ? (
          <input
            autoFocus
            value={draft}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={finishRename}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') finishRename()
              if (event.key === 'Escape') {
                setDraft(collection.name)
                setEditing(false)
              }
            }}
            aria-label={`重命名${collection.name}`}
            className="min-w-0 flex-1 rounded border border-ds-primary bg-ds-surface px-1.5 py-0.5 text-xs text-ds-foreground outline-none"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{highlightText(collection.name, highlight ?? '')}</span>
        )}
        {!editing && (
          <>
            <span className="shrink-0 tabular-nums text-ds-muted transition-opacity group-hover:opacity-0 group-focus-within:opacity-0 [@media(hover:none)]:opacity-0">
              {counts.get(collection.id) ?? 0}
            </span>
            <RowActions
              label={collection.name}
              collectionId={collection.id}
              onCreateChild={() => onCreateChild(collection.id)}
              onRename={() => {
                setDraft(collection.name)
                setEditing(true)
              }}
              onDelete={() => onDelete(collection.id)}
              onPaste={onPaste}
              onShowInfo={onShowInfo}
              onImport={onImport}
              onSetColor={(color) => void useAssetLibraryStore.getState().setCollectionColor(collection.id, color)}
            />
          </>
        )}
      </div>
      <TreeGuideLines ancestorLines={guideAncestorLines} depth={depth} ownFollowing={guideOwnFollowing} />
      {contextMenu && (
        <div ref={contextMenuRef} className="fixed z-dropdown" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <Menu
            label={`${collection.name}操作`}
            className="w-44 p-1"
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              event.stopPropagation()
              setContextMenu(null)
            }}
          >
            <TreeItemMenuItems
              view="main"
              setView={() => {}}
              onClose={() => setContextMenu(null)}
              label={collection.name}
              onCreateChild={() => onCreateChild(collection.id)}
              onDelete={() => onDelete(collection.id)}
              onPaste={onPaste}
              onRename={() => {
                setDraft(collection.name)
                setEditing(true)
                setContextMenu(null)
              }}
              onShowInfo={onShowInfo}
              onImport={onImport}
              moveTargetId={collection.id}
              onSetColor={(color) => void useAssetLibraryStore.getState().setCollectionColor(collection.id, color)}
              destinations={destinations}
            />
          </Menu>
        </div>
      )}
    </div>
  )
}

export interface AssetLibrarySidebarProps {
  counts: AssetSidebarCounts
  scope: string
  onSelectSystemScope: (value: SystemScopeValue) => void
  onSelectCollection: (id: string) => void
  /** 桌面端可拖拽调整宽度；窄屏 Drawer 内不启用 */
  resizable?: boolean
}

function AssetLibrarySidebar({
  counts,
  onSelectCollection,
  onSelectSystemScope,
  scope,
  resizable = false,
}: AssetLibrarySidebarProps) {
  const collections = useAssetLibraryStore((state) => state.collections)
  const tags = useAssetLibraryStore((state) => state.tags)
  const savedFilters = useAssetLibraryStore((state) => state.savedFilters)
  const createCollection = useAssetLibraryStore((state) => state.createCollection)
  const renameCollection = useAssetLibraryStore((state) => state.renameCollection)
  const deleteCollection = useAssetLibraryStore((state) => state.deleteCollection)
  const folderEditRequest = useAssetLibraryStore((state) => state.folderEditRequest)
  const setFolderEditRequest = useAssetLibraryStore((state) => state.setFolderEditRequest)

  // 全局 Ctrl+N 新建请求：在目标父级下显示「新建」行（rename 请求由行内消费）
  useEffect(() => {
    if (!folderEditRequest || folderEditRequest.kind !== 'create') return
    setCreatingParentId(folderEditRequest.parentId)
    setFolderEditRequest(null)
  }, [folderEditRequest, setFolderEditRequest])
  const [collapsedCollectionIds, setCollapsedCollectionIds] = useState<Set<string>>(() =>
    loadCollapsedIds(COLLAPSED_COLLECTIONS_STORAGE_KEY),
  )
  const [projectsExpanded, setProjectsExpanded] = useState(true)
  const [smartFiltersExpanded, setSmartFiltersExpanded] = useState(true)
  const [creatingParentId, setCreatingParentId] = useState<string | null | undefined>(undefined)
  const [filterQuery, setFilterQuery] = useState('')
  const [panelWidth, setPanelWidth] = useState<number | null>(() => loadStoredSidebarWidth())
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const navRef = useRef<HTMLElement>(null)
  const collectionTreeRef = useRef<HTMLDivElement>(null)
  const [pendingCollectionFocus, setPendingCollectionFocus] = useState<number | null>(null)

  // 文件夹删除为彻底删除（不经回收站），主树只显示未删除的文件夹
  const activeCollections = useMemo(() => collections.filter((item) => !isCollectionTrashed(item)), [collections])

  const tree = useMemo(() => buildCollectionTree(activeCollections), [activeCollections])
  const activeCollectionId = scope.startsWith('collection:') ? scope.slice('collection:'.length) : null
  const filterNeedle = filterQuery.trim().toLowerCase()
  // 「包含子文件夹」开启时，项目节点计数 = 直接素材 + 全部后代素材（母文件夹可看到底下文件夹）
  const includeSubcollections = useAssetLibraryStore((state) => state.includeSubcollections)
  const displayCollectionCounts = useMemo(
    () =>
      includeSubcollections
        ? computeRecursiveCollectionCounts(activeCollections, counts.byCollection)
        : counts.byCollection,
    [activeCollections, counts.byCollection, includeSubcollections],
  )

  // 文件夹多选 + 信息弹窗
  const selectedFolderIds = useAssetLibraryStore((state) => state.selectedFolderIds)
  // Shift 范围多选锚点：最后一次点击/切换的文件夹
  const folderRangeAnchorRef = useRef<string | null>(null)
  const [infoCollectionId, setInfoCollectionId] = useState<string | null>(null)
  const collectionInfo = useMemo(
    () => (infoCollectionId ? useAssetLibraryStore.getState().getCollectionInfo(infoCollectionId) : null),
    [infoCollectionId],
  )
  const [batchMoveOpen, setBatchMoveOpen] = useState(false)
  const batchDestinations = useMemo(
    () => (selectedFolderIds.length > 0 ? computeBatchMoveDestinations(collections, selectedFolderIds) : []),
    [collections, selectedFolderIds],
  )

  // ===== 文件夹拖拽（Eagle 式同级排序/嵌套）=====
  /** 拖拽中的文件夹 id 列表（ref 读取不触发渲染；多选拖拽 = 全部选中文件夹） */
  const folderDragIdsRef = useRef<string[] | null>(null)
  /** 每行投放区（before/after 插入线、into 嵌套高亮）；__root__ = 根目录追加 */
  const [folderDropZones, setFolderDropZones] = useState<Record<string, 'before' | 'after' | 'into'>>({})

  const handleFolderDragStart = (collectionId: string, event: DragEvent<HTMLDivElement>) => {
    const selected = useAssetLibraryStore.getState().selectedFolderIds
    const ids = selected.includes(collectionId) && selected.length > 1 ? selected : [collectionId]
    try {
      event.dataTransfer.setData(COLLECTION_DRAG_TYPE, JSON.stringify(ids))
      event.dataTransfer.effectAllowed = 'move'
    } catch {
      // 某些环境对自定义 MIME 类型写入受限；拖拽仍可用（drop 端按 folderDragIdsRef 兜底）
    }
    folderDragIdsRef.current = ids
    setFolderDropZones({})
  }

  const handleFolderDragEnd = () => {
    folderDragIdsRef.current = null
    setFolderDropZones({})
  }

  const handleFolderDragOver = (collectionId: string, zone: 'before' | 'after' | 'into') => {
    setFolderDropZones((current) => (current[collectionId] === zone ? current : { ...current, [collectionId]: zone }))
  }

  const handleFolderDrop = (collectionId: string, zone: 'before' | 'after' | 'into') => {
    const ids = folderDragIdsRef.current ?? []
    folderDragIdsRef.current = null
    setFolderDropZones({})
    if (ids.length === 0) return
    void useAssetLibraryStore
      .getState()
      .moveCollectionsToPosition(
        ids,
        zone === 'into' ? { kind: 'into', parentId: collectionId } : { kind: zone, siblingId: collectionId },
      )
  }

  /** 根目录投放（树的空白区）：追加到根 */
  const handleRootDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!canAcceptFolderDrag(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setFolderDropZones((current) => (current.__root__ === 'into' ? current : { ...current, __root__: 'into' }))
  }

  const handleRootDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!parseCollectionDragIds(event.dataTransfer)) return
    event.preventDefault()
    const ids = folderDragIdsRef.current ?? []
    folderDragIdsRef.current = null
    setFolderDropZones({})
    if (ids.length === 0) return
    void useAssetLibraryStore.getState().moveCollectionsToPosition(ids, { kind: 'append', parentId: null })
  }

  /** 选择文件并导入到指定文件夹（Electron 原生对话框 / 浏览器 input 回退）。 */
  const pickAndImportFiles = async (collectionId: string) => {
    let files: File[] = []
    if (typeof window !== 'undefined' && window.electronAPI?.selectFiles) {
      const paths = await window.electronAPI.selectFiles([{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }])
      if (!paths || paths.length === 0) return
      const { readFileBuffer } = window.electronAPI
      for (const filePath of paths) {
        try {
          const payload = readFileBuffer ? await readFileBuffer(filePath) : null
          if (!payload) continue
          const name = filePath.split(/[\\/]/).pop() ?? `import-${Date.now()}.png`
          const ext = (name.split('.').pop() ?? 'png').toLowerCase()
          const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
          files.push(new File([new Blob([payload.data], { type: mime })], name, { type: mime }))
        } catch (error) {
          console.warn('读取图片失败:', filePath, error)
        }
      }
    } else if (typeof document !== 'undefined') {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.multiple = true
      const picked = await new Promise<FileList | null>((resolve) => {
        input.onchange = () => resolve(input.files)
        input.click()
      })
      if (picked) files = Array.from(picked)
    }
    if (files.length === 0) return
    const imported = await useAssetLibraryStore.getState().importFilesIntoCollection(collectionId, files)
    if (imported === 0) useStore.getState().showToast('没有可导入的图片', 'error')
  }

  // 折叠状态持久化（localStorage，纯 UI 偏好）
  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_COLLECTIONS_STORAGE_KEY, JSON.stringify([...collapsedCollectionIds]))
    } catch {
      /* ignore */
    }
  }, [collapsedCollectionIds])

  // 宽度拖拽结果持久化 + 应用到 CSS 变量
  useEffect(() => {
    if (panelWidth == null) return
    document.documentElement.style.setProperty('--asset-library-panel-width', `${panelWidth}px`)
  }, [panelWidth])
  useEffect(() => {
    if (panelWidth == null) return
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(panelWidth))
    } catch {
      /* ignore */
    }
  }, [panelWidth])

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    if (!resizable) return
    event.preventDefault()
    const startWidth =
      panelWidth ??
      (typeof window !== 'undefined'
        ? clampSidebarWidth(
            Number.parseFloat(
              window.getComputedStyle(document.documentElement).getPropertyValue('--asset-library-panel-width'),
            ) || 224,
          )
        : 224)
    resizeRef.current = { startX: event.clientX, startWidth }
    document.body.classList.add('select-none')
    document.body.style.cursor = 'col-resize'
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const drag = resizeRef.current
      if (!drag) return
      setPanelWidth(clampSidebarWidth(drag.startWidth + (moveEvent.clientX - drag.startX)))
    }
    const onUp = () => {
      resizeRef.current = null
      document.body.classList.remove('select-none')
      document.body.style.cursor = ''
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const systemCounts: Record<SystemScopeValue, number> = {
    all: counts.all,
    recent: counts.recent,
    favorites: counts.favorites,
    unorganized: counts.unorganized,
    trash: counts.trash,
  }

  const toggleCollection = (id: string) => {
    setCollapsedCollectionIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const startChildCreate = (parentId: string) => {
    setProjectsExpanded(true)
    setCollapsedCollectionIds((current) => {
      const next = new Set(current)
      next.delete(parentId)
      return next
    })
    setCreatingParentId(parentId)
  }

  // ===== 复制/剪切/粘贴（剪贴板：项目树 + 素材）=====
  const clipboard = useAssetLibraryStore((state) => state.clipboard)
  const canPaste = clipboard !== null

  /** 粘贴到指定项目：素材剪贴板走素材粘贴；项目剪贴板自动展开目标分组并让目标节点可见。 */
  const pasteIntoCollection = (targetId: string | null) => {
    const entry = useAssetLibraryStore.getState().clipboard
    if (entry?.type === 'asset') {
      void useAssetLibraryStore
        .getState()
        .pasteAssetsIntoCollection(targetId)
        .then((count) => {
          if (count > 0) useStore.getState().showToast(`已粘贴 ${count} 张素材`, 'success')
        })
        .catch(() => useStore.getState().showToast('粘贴失败，请重试', 'error'))
      return
    }
    setProjectsExpanded(true)
    if (targetId !== null) {
      setCollapsedCollectionIds((current) => {
        const next = new Set(current)
        next.delete(targetId)
        return next
      })
    }
    void useAssetLibraryStore.getState().pasteCollection(targetId)
  }

  // 树容器右键菜单（根级粘贴 / 新建 / 全部展开折叠）
  const [collectionRootMenu, setCollectionRootMenu] = useState<{ x: number; y: number } | null>(null)
  const collectionRootMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!collectionRootMenu) return
    const onMouseDown = (event: MouseEvent) => {
      if (collectionRootMenuRef.current && !collectionRootMenuRef.current.contains(event.target as Node)) {
        setCollectionRootMenu(null)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [collectionRootMenu])

  // 筛选侧栏条目（本地过滤，纯 UI；命中父节点时保留整棵子树）
  const filtering = filterNeedle.length > 0
  const visibleSystemScopes = filtering
    ? SYSTEM_SCOPES.filter((item) => item.label.toLowerCase().includes(filterNeedle))
    : SYSTEM_SCOPES
  const visibleSavedFilters = filtering
    ? savedFilters.filter((filter) => filter.name.toLowerCase().includes(filterNeedle))
    : savedFilters
  const visibleTree = useMemo(
    () =>
      filtering
        ? filterCollectionTree(tree, (node) => node.collection.name.toLowerCase().includes(filterNeedle))
        : tree,
    [filtering, filterNeedle, tree],
  )
  // ===== 树虚拟滚动：展平可见行 + 视口窗口 =====
  const collectionRows = useMemo(
    () =>
      flattenCollectionRows(
        filtering ? visibleTree : tree,
        collapsedCollectionIds,
        filtering ? undefined : creatingParentId,
        filtering,
      ),
    [tree, visibleTree, collapsedCollectionIds, creatingParentId, filtering],
  )
  // Shift 范围多选：从锚点（最后一次点击/切换的文件夹）连续选择到目标文件夹（按当前可见行顺序）
  const handleFolderShiftSelect = useCallback(
    (id: string) => {
      const store = useAssetLibraryStore.getState()
      const ordered = collectionRows
        .filter((row) => row.kind === 'node')
        .map((row) => (row as { node: CollectionTreeNode }).node.collection.id)
      const anchor = folderRangeAnchorRef.current
      const from = anchor ? ordered.indexOf(anchor) : -1
      const to = ordered.indexOf(id)
      const next = new Set(store.selectedFolderIds)
      if (from === -1 || to === -1) {
        next.add(id)
      } else {
        for (const rangeId of ordered.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(rangeId)
      }
      store.setSelectedFolders([...next])
      folderRangeAnchorRef.current = id
    },
    [collectionRows],
  )
  const tagMatches = filtering ? tags.some((tag) => tag.name.toLocaleLowerCase('zh-CN').includes(filterNeedle)) : true
  const hasMatches =
    visibleSystemScopes.length > 0 || visibleSavedFilters.length > 0 || visibleTree.length > 0 || tagMatches
  const collectionRowIndexById = useMemo(() => {
    const map = new Map<string, number>()
    for (let index = 0; index < collectionRows.length; index++) {
      const row = collectionRows[index]
      if (row.kind === 'node' && row.node) map.set(row.node.collection.id, index)
    }
    return map
  }, [collectionRows])

  const layoutVersion =
    `${filtering ? 1 : 0}|${projectsExpanded ? 1 : 0}|${smartFiltersExpanded ? 1 : 0}` + `|${collectionRows.length}`
  const collectionRange = useVirtualRange(navRef, collectionTreeRef, collectionRows.length, layoutVersion)

  const focusCollectionRow = useCallback(
    (index: number) => {
      if (collectionRows.length === 0) return
      const clamped = Math.max(0, Math.min(collectionRows.length - 1, index))
      scrollTreeRowIntoView(navRef.current, collectionTreeRef.current, clamped, collectionRange.virtualized)
      setPendingCollectionFocus(clamped)
    },
    [collectionRows.length, collectionRange.virtualized],
  )

  // 行离屏时由滚动窗口补充渲染，滚动完成后聚焦目标行
  useEffect(() => {
    if (pendingCollectionFocus === null) return
    const el = collectionTreeRef.current?.querySelector(`[data-row-index="${pendingCollectionFocus}"]`)
    if (el instanceof HTMLElement) {
      el.focus()
      setPendingCollectionFocus(null)
    }
  }, [pendingCollectionFocus, collectionRange])

  // 新建行插入后自动滚动到可见位置
  useEffect(() => {
    if (creatingParentId === undefined) return
    const index = collectionRows.findIndex((row) => row.kind === 'create')
    if (index >= 0) scrollTreeRowIntoView(navRef.current, collectionTreeRef.current, index, collectionRange.virtualized)
  }, [creatingParentId, collectionRows, collectionRange.virtualized])

  const renderCollectionRow = (row: CollectionTreeRow, index: number, virtualized: boolean) => {
    if (row.kind === 'create') {
      const depth = row.depth ?? 1
      return (
        <div
          key={`create:${row.parentId ?? 'root'}`}
          data-row-index={index}
          className={virtualized ? 'absolute inset-x-0 flex items-center' : 'relative'}
          style={
            virtualized
              ? { top: index * TREE_ROW_HEIGHT, height: TREE_ROW_HEIGHT, paddingLeft: (depth - 1) * TREE_INDENT }
              : { paddingLeft: (depth - 1) * TREE_INDENT }
          }
        >
          <TreeGuideLines
            ancestorLines={row.guideAncestorLines ?? []}
            depth={depth}
            ownFollowing={row.guideOwnFollowing ?? false}
          />
          <CreateRow
            label={row.label ?? '项目名称'}
            onCancel={() => setCreatingParentId(undefined)}
            onCreate={(name) => createCollection(name, row.parentId ?? null)}
          />
        </div>
      )
    }
    const node = row.node!
    const depth = row.depth ?? 1
    const parentRowIndex = node.collection.parentId
      ? (collectionRowIndexById.get(node.collection.parentId) ?? null)
      : null
    return (
      <CollectionTreeItem
        key={node.collection.id}
        activeId={activeCollectionId}
        collapsedIds={collapsedCollectionIds}
        counts={displayCollectionCounts}
        depth={depth}
        node={node}
        onCreateChild={startChildCreate}
        onDelete={(id) => void deleteCollection(id)}
        onPaste={() => pasteIntoCollection(node.collection.id)}
        onRename={renameCollection}
        onSelect={(id) => {
          folderRangeAnchorRef.current = id
          onSelectCollection(id)
        }}
        onToggle={toggleCollection}
        highlight={filtering ? filterNeedle : undefined}
        selected={selectedFolderIds.includes(node.collection.id)}
        onToggleSelect={(id) => {
          folderRangeAnchorRef.current = id
          useAssetLibraryStore.getState().toggleSelectFolder(id)
        }}
        onShiftSelect={handleFolderShiftSelect}
        onShowInfo={() => setInfoCollectionId(node.collection.id)}
        onImport={() => void pickAndImportFiles(node.collection.id)}
        renameRequestId={folderEditRequest?.kind === 'rename' ? folderEditRequest.collectionId : undefined}
        folderDragging={folderDragIdsRef.current?.includes(node.collection.id) ?? false}
        folderDropZone={folderDropZones[node.collection.id] ?? null}
        onFolderDragStart={handleFolderDragStart}
        onFolderDragEnd={handleFolderDragEnd}
        onFolderDragOver={handleFolderDragOver}
        onFolderDrop={handleFolderDrop}
        rowIndex={index}
        totalRows={collectionRows.length}
        parentRowIndex={parentRowIndex}
        onFocusRow={focusCollectionRow}
        guideAncestorLines={row.guideAncestorLines}
        guideOwnFollowing={row.guideOwnFollowing}
        style={
          virtualized
            ? {
                position: 'absolute',
                top: index * TREE_ROW_HEIGHT,
                left: 0,
                right: 0,
                height: TREE_ROW_HEIGHT,
                paddingLeft: (depth - 1) * TREE_INDENT,
              }
            : { paddingLeft: (depth - 1) * TREE_INDENT }
        }
      />
    )
  }

  return (
    <aside
      data-testid="asset-library-sidebar"
      className="relative flex w-[var(--asset-library-panel-width)] min-w-[var(--asset-library-panel-width)] max-w-[var(--asset-library-panel-width)] shrink-0 flex-col overflow-hidden border-r border-ds-border bg-ds-surface/50"
    >
      {/* 侧栏头部 */}
      <div className="flex h-ds-control-lg shrink-0 items-center gap-2 border-b border-ds-border/70 px-3">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-ds-primary/15 text-ds-primary">
          <Layers3Icon size={14} />
        </span>
        <h2 className="min-w-0 truncate text-xs font-semibold text-ds-foreground">素材库</h2>
      </div>

      {/* 条目筛选 */}
      <div className="shrink-0 border-b border-ds-border/50 px-2.5 pb-2 pt-2">
        <div className="relative">
          <SearchIcon
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ds-muted"
          />
          <input
            value={filterQuery}
            onChange={(event) => setFilterQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setFilterQuery('')
            }}
            placeholder="筛选项目、文件夹…"
            aria-label="筛选侧栏条目"
            className="h-ds-control-sm w-full rounded-md border border-ds-border bg-ds-surface pl-7 pr-7 text-xs text-ds-foreground outline-none placeholder:text-ds-muted focus:border-ds-primary"
          />
          {filterQuery && (
            <button
              type="button"
              aria-label="清除筛选"
              onClick={() => setFilterQuery('')}
              className="absolute right-1 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-ds-muted outline-none hover:bg-ds-muted/20 hover:text-ds-foreground focus-visible:ring-2 focus-visible:ring-ds-focus/70"
            >
              <XIcon size={12} />
            </button>
          )}
        </div>
      </div>

      <nav ref={navRef} className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-2.5">
        {visibleSystemScopes.length > 0 ? (
          <NavList
            label="素材库导航"
            value={scope as SystemScopeValue}
            onValueChange={(value) => onSelectSystemScope(value as SystemScopeValue)}
            className="[&_.ds-nav-list__item]:text-xs"
            items={visibleSystemScopes.map((item) => ({
              value: item.value,
              label: item.label,
              icon: item.icon,
              badge: <span className="tabular-nums">{systemCounts[item.value]}</span>,
            }))}
          />
        ) : (
          filtering && <p className="px-1.5 py-2 text-xs text-ds-muted">无匹配的系统范围</p>
        )}

        {visibleSavedFilters.length > 0 && (
          <div className="mt-3">
            <SectionHeader
              count={savedFilters.length}
              expanded={smartFiltersExpanded}
              label="智能文件夹"
              onToggle={() => setSmartFiltersExpanded((value) => !value)}
            />
            {smartFiltersExpanded && (
              <div className="mt-0.5">
                {visibleSavedFilters.map((filter) => (
                  <div
                    key={filter.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`应用智能文件夹 ${filter.name}`}
                    onClick={() => useAssetLibraryStore.getState().applySavedFilter(filter.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        useAssetLibraryStore.getState().applySavedFilter(filter.id)
                      }
                    }}
                    className="group flex h-ds-control-sm w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-xs text-ds-foreground outline-none hover:bg-ds-muted/20 focus-visible:ring-2 focus-visible:ring-ds-focus/70"
                  >
                    <SearchIcon size={13} className="shrink-0 text-ds-muted" />
                    <span className="min-w-0 flex-1 truncate">{filter.name}</span>
                    <button
                      type="button"
                      aria-label={`删除智能文件夹 ${filter.name}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        useAssetLibraryStore.getState().removeSavedFilter(filter.id)
                        useStore.getState().showToast(`已删除智能文件夹「${filter.name}」`, 'success')
                      }}
                      className="hidden h-6 w-6 shrink-0 place-items-center rounded text-ds-muted outline-none hover:bg-ds-muted/20 group-hover:grid focus-visible:ring-2 focus-visible:ring-ds-focus/70"
                    >
                      <XIcon size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <SectionHeader
          count={activeCollections.length}
          expanded={projectsExpanded}
          label="项目"
          onToggle={() => setProjectsExpanded((value) => !value)}
          onCreate={() => {
            setProjectsExpanded(true)
            setCreatingParentId(null)
          }}
        />
        {(projectsExpanded || filtering) && (
          <div
            ref={collectionTreeRef}
            role="tree"
            aria-label="项目树"
            className="relative mt-0.5 min-w-0"
            style={collectionRange.virtualized ? { height: collectionRows.length * TREE_ROW_HEIGHT } : undefined}
            onContextMenu={(event) => {
              if ((event.target as HTMLElement).closest('[role="treeitem"], button, input')) return
              event.preventDefault()
              setCollectionRootMenu({ x: event.clientX, y: event.clientY })
            }}
            onDragOver={handleRootDragOver}
            onDrop={handleRootDrop}
          >
            {folderDropZones.__root__ === 'into' && (
              <div className="pointer-events-none absolute inset-x-1 top-0 z-10 flex items-center justify-center rounded-md border border-dashed border-ds-focus/70 bg-ds-primary/10 py-1 text-xs text-ds-primary">
                移动到根目录
              </div>
            )}
            {collectionRows.length === 0 ? (
              filtering ? (
                <p className="px-1.5 py-2 text-xs text-ds-muted">无匹配的项目</p>
              ) : tree.length === 0 && creatingParentId === undefined ? (
                <button
                  type="button"
                  onClick={() => setCreatingParentId(null)}
                  className="mt-1 flex w-full items-center gap-1.5 rounded-md border border-dashed border-ds-border/70 px-2.5 py-2 text-left text-xs text-ds-muted outline-none hover:border-ds-primary/50 hover:text-ds-primary focus-visible:ring-2 focus-visible:ring-ds-focus/70"
                >
                  <PlusIcon size={12} />
                  新建第一个项目
                </button>
              ) : null
            ) : collectionRange.virtualized ? (
              collectionRows
                .slice(collectionRange.start, collectionRange.end)
                .map((row, index) => renderCollectionRow(row, collectionRange.start + index, true))
            ) : (
              collectionRows.map((row, index) => renderCollectionRow(row, index, false))
            )}
          </div>
        )}
        {collectionRootMenu && (
          <div
            ref={collectionRootMenuRef}
            className="fixed z-dropdown"
            style={{ left: collectionRootMenu.x, top: collectionRootMenu.y }}
          >
            <Menu
              label="项目树操作"
              className="w-48 p-1"
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return
                event.preventDefault()
                event.stopPropagation()
                setCollectionRootMenu(null)
              }}
            >
              <MenuItem
                icon={<PlusIcon size={13} />}
                onClick={() => {
                  setCollectionRootMenu(null)
                  setProjectsExpanded(true)
                  setCreatingParentId(null)
                }}
              >
                新建项目
              </MenuItem>
              <MenuItem
                icon={<ClipboardPlusIcon size={13} />}
                disabled={!canPaste}
                onClick={() => {
                  setCollectionRootMenu(null)
                  pasteIntoCollection(null)
                }}
              >
                粘贴到项目根目录
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                onClick={() => {
                  setCollectionRootMenu(null)
                  setCollapsedCollectionIds(new Set())
                }}
              >
                全部展开
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setCollectionRootMenu(null)
                  setCollapsedCollectionIds(new Set(collections.map((item) => item.id)))
                }}
              >
                全部折叠
              </MenuItem>
            </Menu>
          </div>
        )}

        {filtering && !hasMatches && <p className="px-1.5 py-2 text-center text-xs text-ds-muted">没有匹配的条目</p>}
      </nav>

      {/* 多选批量操作条（固定在侧栏底部，始终可见） */}
      {selectedFolderIds.length > 0 && (
        <div className="flex shrink-0 items-center gap-1 border-t border-ds-primary/30 bg-ds-primary/10 px-2.5 py-2 text-xs">
          <span className="tabular-nums text-ds-foreground">已选 {selectedFolderIds.length} 个文件夹</span>
          <button
            type="button"
            className="ml-auto rounded px-1.5 py-0.5 text-ds-muted outline-none hover:bg-ds-muted/20 hover:text-ds-foreground"
            onClick={() => useAssetLibraryStore.getState().clearSelectedFolders()}
          >
            取消
          </button>
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-ds-foreground outline-none hover:bg-ds-muted/20"
            onClick={() => useAssetLibraryStore.getState().mergeSelectedFolders()}
          >
            合并
          </button>
          <span className="relative">
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-ds-foreground outline-none hover:bg-ds-muted/20"
              onClick={() => setBatchMoveOpen((open) => !open)}
            >
              移动到…
            </button>
            {batchMoveOpen && (
              <Menu
                label="批量移动到"
                className="!absolute bottom-full right-0 z-30 mb-1 w-44 p-1"
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return
                  event.preventDefault()
                  setBatchMoveOpen(false)
                }}
              >
                {batchDestinations.map((destination) => (
                  <MenuItem
                    key={destination.id ?? '__root__'}
                    onClick={(event) => {
                      event.stopPropagation()
                      setBatchMoveOpen(false)
                      void useAssetLibraryStore.getState().moveSelectedFolders(destination.id)
                    }}
                  >
                    <span className="block truncate" style={{ paddingLeft: `${destination.depth * 0.75}rem` }}>
                      {destination.label}
                    </span>
                  </MenuItem>
                ))}
              </Menu>
            )}
          </span>
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-ds-foreground outline-none hover:bg-ds-muted/20"
            onClick={() => useAssetLibraryStore.getState().exportSelectedFolders()}
          >
            导出
          </button>
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-ds-danger outline-none hover:bg-ds-danger/15"
            onClick={() => useAssetLibraryStore.getState().deleteSelectedFolders()}
          >
            删除
          </button>
        </div>
      )}

      {/* 宽度拖拽把手（仅桌面端） */}
      {resizable && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整侧栏宽度"
          onPointerDown={startResize}
          className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize touch-none hover:bg-ds-primary/30 active:bg-ds-primary/40"
        />
      )}

      <CollectionInfoModal
        info={collectionInfo}
        onOpenChange={(open) => {
          if (!open) setInfoCollectionId(null)
        }}
      />
    </aside>
  )
}

export default memo(AssetLibrarySidebar)
