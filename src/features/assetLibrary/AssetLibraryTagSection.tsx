import { memo, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { IconButton, Menu, MenuItem, MenuSeparator, Tooltip } from '../../design-system'
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EditIcon,
  Layers3Icon,
  MoreHorizontalIcon,
  PaletteIcon,
  PlusIcon,
  TagsIcon,
  TrashIcon,
  XIcon,
} from '../../design-system/icons'
import { cn } from '../../lib/shadcn'
import { useStore } from '../../store'
import type { AssetTag } from '../../types'
import { useAssetLibraryStore } from './store'
import type { AssetSidebarCounts } from './query'
import { TAG_COLORS_EXTENDED } from './colorLabels'

const TAGS_EXPANDED_STORAGE_KEY = 'doupao.asset-library-tags-expanded'

interface TagTreeNode {
  tag: AssetTag
  children: TagTreeNode[]
}

function compareTags(a: AssetTag, b: AssetTag): number {
  if (a.order !== b.order) return a.order - b.order
  return a.normalizedName.localeCompare(b.normalizedName, 'zh-CN')
}

/** 构建标签树（parentId → children，同级按 order + 名称排序）。 */
export function buildTagTree(tags: AssetTag[]): TagTreeNode[] {
  const nodes = new Map<string, TagTreeNode>(tags.map((tag) => [tag.id, { tag, children: [] }]))
  const roots: TagTreeNode[] = []
  for (const tag of tags.slice().sort(compareTags)) {
    const node = nodes.get(tag.id)!
    const parent = tag.parentId ? nodes.get(tag.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  for (const node of nodes.values()) node.children.sort((a, b) => compareTags(a.tag, b.tag))
  return roots
}

/** 筛选标签树：命中自身或任一后代时保留整棵子树（与项目树筛选语义一致）。 */
function filterTagTree(nodes: TagTreeNode[], matches: (tag: AssetTag) => boolean): TagTreeNode[] {
  const result: TagTreeNode[] = []
  for (const node of nodes) {
    const children = filterTagTree(node.children, matches)
    if (matches(node.tag) || children.length > 0) result.push({ tag: node.tag, children })
  }
  return result
}

interface TagTreeRow {
  kind: 'node' | 'create'
  node?: TagTreeNode
  depth?: number
  parentId?: string | null
  label?: string
}

/** 展平可见标签树（新建行插入正确位置）。 */
export function flattenTagRows(nodes: TagTreeNode[], creatingParentId: string | null | undefined): TagTreeRow[] {
  const rows: TagTreeRow[] = []
  if (creatingParentId === null) rows.push({ kind: 'create', parentId: null, label: '标签名称', depth: 0 })
  const walk = (children: TagTreeNode[], depth: number) => {
    for (const node of children) {
      rows.push({ kind: 'node', node, depth })
      if (node.tag.id === creatingParentId) {
        rows.push({ kind: 'create', parentId: node.tag.id, label: '子标签名称', depth: depth + 1 })
      }
      if (node.children.length > 0) walk(node.children, depth + 1)
    }
  }
  walk(nodes, 0)
  return rows
}

/** 计算标签树深度（合并目标列表缩进用）。 */
function tagDepth(tags: AssetTag[], tagId: string): number {
  let depth = 0
  let current = tags.find((tag) => tag.id === tagId)
  const visited = new Set<string>()
  while (current?.parentId && !visited.has(current.parentId)) {
    visited.add(current.parentId)
    depth++
    const parentId = current.parentId
    current = tags.find((tag) => tag.id === parentId)
  }
  return depth
}

function TagCreateRow({
  label,
  onCancel,
  onCreate,
}: {
  label: string
  onCancel: () => void
  onCreate: (name: string) => Promise<unknown>
}) {
  const [name, setName] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      onCancel()
      return
    }
    void onCreate(trimmed).then((saved) => {
      if (saved) onCancel()
    })
  }
  return (
    <form onSubmit={submit} className="flex h-ds-control-sm items-center gap-1 px-1">
      <TagsIcon size={14} className="shrink-0 text-ds-muted" />
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

type TagMenuView = 'main' | 'merge' | 'color'

interface TagMenuContentProps {
  view: TagMenuView
  setView: (view: TagMenuView) => void
  onClose: () => void
  tag: AssetTag
  tags: AssetTag[]
  onCreateChild: () => void
  onRename: () => void
  onDelete: () => void
  onMerge: (targetId: string) => void
  onSetColor: (color: string | null) => void
}

/** 标签菜单内容（hover 更多与右键菜单共用）：新建子标签 / 重命名 / 设置颜色 / 合并到… / 删除。 */
function TagMenuContent({
  view,
  setView,
  onClose,
  tag,
  tags,
  onCreateChild,
  onRename,
  onDelete,
  onMerge,
  onSetColor,
}: TagMenuContentProps) {
  const mergeDestinations = useMemo(() => tags.filter((item) => item.id !== tag.id), [tag.id, tags])
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
        {mergeDestinations.length === 0 && <MenuItem disabled>没有其他标签</MenuItem>}
        {mergeDestinations.map((destination) => (
          <MenuItem
            key={destination.id}
            onClick={(event) => {
              event.stopPropagation()
              onClose()
              onMerge(destination.id)
            }}
          >
            <span className="block truncate" style={{ paddingLeft: `${tagDepth(tags, destination.id) * 0.75}rem` }}>
              {destination.name}
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
              aria-label={`设置标签颜色 ${color}`}
              onClick={(event) => {
                event.stopPropagation()
                onClose()
                onSetColor(color)
              }}
              className={`h-5 w-5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ds-focus/70 ${tag.color === color ? 'ring-2 ring-ds-focus ring-offset-1' : ''}`}
              style={{ backgroundColor: color }}
            />
          ))}
          {tag.color && (
            <button
              type="button"
              aria-label="清除标签颜色"
              onClick={(event) => {
                event.stopPropagation()
                onClose()
                onSetColor(null)
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
  return (
    <>
      <MenuItem
        icon={<PlusIcon size={13} />}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
          onCreateChild()
        }}
      >
        新建子标签
      </MenuItem>
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
      <MenuSeparator />
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

interface TagRowProps {
  tag: AssetTag
  depth: number
  selected: boolean
  count: number
  /** 行内重命名编辑态（父级控制，供菜单「重命名」触发） */
  editing: boolean
  onEditingChange: (editing: boolean) => void
  onToggle: (tagId: string) => void
  onCreateChild: (tagId: string) => void
  onDelete: (tag: AssetTag) => void
  onMerge: (sourceId: string, targetId: string) => void
  onSetColor: (tagId: string, color: string | null) => void
}

function TagRow({
  tag,
  depth,
  selected,
  count,
  editing,
  onEditingChange,
  onToggle,
  onCreateChild,
  onDelete,
  onMerge,
  onSetColor,
}: TagRowProps) {
  const [draft, setDraft] = useState(tag.name)
  const [menuOpen, setMenuOpen] = useState(false)
  const [view, setView] = useState<TagMenuView>('main')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const tags = useAssetLibraryStore((state) => state.tags)
  const renameTag = useAssetLibraryStore((state) => state.renameTag)

  const close = () => {
    setMenuOpen(false)
    setView('main')
    if (menuOpen) triggerRef.current?.focus()
  }

  const startRename = () => {
    setDraft(tag.name)
    onEditingChange(true)
  }

  const finishRename = () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== tag.name) {
      void renameTag(tag.id, trimmed)
        .then(() => useStore.getState().showToast(`已重命名标签「${trimmed}」`, 'success'))
        .catch(() => useStore.getState().showToast('重命名标签失败', 'error'))
    }
    onEditingChange(false)
  }

  return (
    <div className="group relative flex h-ds-control-md w-full min-w-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs outline-none transition-colors hover:bg-ds-muted/20">
      {/* 多选复选框（Eagle 式）：选中常驻，未选中 hover 显示 */}
      <button
        type="button"
        tabIndex={-1}
        aria-label={selected ? `取消筛选标签 ${tag.name}` : `筛选标签 ${tag.name}`}
        title={selected ? `已选中 ${tag.name}（再次点击取消）` : `选择标签 ${tag.name}（可多选，AND 筛选）`}
        onClick={(event) => {
          event.stopPropagation()
          onToggle(tag.id)
        }}
        className={cn(
          'grid h-4 w-4 shrink-0 place-items-center rounded-sm border outline-none transition-opacity',
          selected
            ? 'border-ds-primary bg-ds-primary text-ds-text-inverse opacity-100'
            : 'border-ds-border text-ds-muted opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-60',
        )}
      >
        <CheckIcon size={10} className={selected ? '' : 'opacity-40'} />
      </button>
      {tag.color && (
        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
      )}
      <TagsIcon size={13} className="shrink-0 text-ds-muted" />
      <span
        role="button"
        tabIndex={0}
        aria-label={selected ? `取消筛选标签 ${tag.name}` : `筛选标签 ${tag.name}`}
        aria-pressed={selected}
        onClick={() => onToggle(tag.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onToggle(tag.id)
          } else if (event.key === 'F2') {
            event.preventDefault()
            startRename()
          }
        }}
        className="flex min-w-0 flex-1 items-center gap-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ds-focus/70"
        style={{ paddingLeft: Math.max(0, depth - 1) * 16 }}
      >
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
                setDraft(tag.name)
                onEditingChange(false)
              }
            }}
            aria-label={`重命名标签 ${tag.name}`}
            className="min-w-0 flex-1 rounded border border-ds-primary bg-ds-surface px-1.5 py-0.5 text-xs text-ds-foreground outline-none"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{tag.name}</span>
        )}
      </span>
      {!editing && (
        <>
          <span className="shrink-0 tabular-nums text-ds-muted transition-opacity group-hover:opacity-0 group-focus-within:opacity-0 [@media(hover:none)]:opacity-0">
            {count}
          </span>
          <span className="pointer-events-none absolute right-1 top-1/2 z-10 flex -translate-y-1/2 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
            <span className="relative flex">
              <Tooltip content="标签操作">
                <IconButton
                  ref={triggerRef}
                  size="sm"
                  className="!h-6 !w-6 !min-h-6"
                  aria-label={`${tag.name}更多操作`}
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
                  label={`${tag.name}操作`}
                  className="!absolute right-0 top-7 z-30 w-44 p-1"
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') return
                    event.preventDefault()
                    event.stopPropagation()
                    close()
                  }}
                >
                  <TagMenuContent
                    view={view}
                    setView={setView}
                    onClose={close}
                    tag={tag}
                    tags={tags}
                    onCreateChild={() => onCreateChild(tag.id)}
                    onRename={startRename}
                    onDelete={() => onDelete(tag)}
                    onMerge={(targetId) => onMerge(tag.id, targetId)}
                    onSetColor={(color) => onSetColor(tag.id, color)}
                  />
                </Menu>
              )}
            </span>
          </span>
        </>
      )}
    </div>
  )
}

export interface AssetLibraryTagSectionProps {
  counts: AssetSidebarCounts
  /** 侧栏条目筛选模式（过滤树/隐藏空态） */
  filtering: boolean
  filterNeedle: string
}

/**
 * 侧栏「标签」区（Eagle 式）：树形标签 + 多选 AND 筛选 + hover/右键管理菜单
 * （新建子标签 / 重命名 / 设置颜色 / 合并到… / 删除）。
 */
function AssetLibraryTagSectionInner({ counts, filtering, filterNeedle }: AssetLibraryTagSectionProps) {
  const tags = useAssetLibraryStore((state) => state.tags)
  const selectedTagIds = useAssetLibraryStore((state) => state.filters.tagIds) ?? []
  const toggleTagFilter = useAssetLibraryStore((state) => state.toggleTagFilter)
  const createTag = useAssetLibraryStore((state) => state.createTag)
  const deleteTag = useAssetLibraryStore((state) => state.deleteTag)
  const mergeTags = useAssetLibraryStore((state) => state.mergeTags)
  const setTagColor = useAssetLibraryStore((state) => state.setTagColor)
  const [expanded, setExpanded] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    try {
      return window.localStorage.getItem(TAGS_EXPANDED_STORAGE_KEY) !== '0'
    } catch {
      return true
    }
  })
  const [creatingParentId, setCreatingParentId] = useState<string | null | undefined>(undefined)
  const [editingTagId, setEditingTagId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tag: AssetTag } | null>(null)
  const [contextView, setContextView] = useState<TagMenuView>('main')
  const contextMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      window.localStorage.setItem(TAGS_EXPANDED_STORAGE_KEY, expanded ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [expanded])

  useEffect(() => {
    if (!contextMenu) return
    const onMouseDown = (event: globalThis.MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) setContextMenu(null)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [contextMenu])

  const tree = useMemo(() => buildTagTree(tags), [tags])
  const visibleTree = useMemo(
    () => (filtering ? filterTagTree(tree, (tag) => tag.name.toLocaleLowerCase('zh-CN').includes(filterNeedle)) : tree),
    [filtering, filterNeedle, tree],
  )
  const rows = useMemo(
    () => flattenTagRows(filtering ? visibleTree : tree, filtering ? undefined : creatingParentId),
    [creatingParentId, filtering, tree, visibleTree],
  )

  if (tags.length === 0 && !filtering) return null

  const handleDelete = (tag: AssetTag) => {
    useStore.getState().setConfirmDialog({
      icon: 'info',
      title: `删除标签「${tag.name}」？`,
      message: '标签将从所有素材上移除（素材本身不会删除）。',
      buttons: [
        { label: '取消', tone: 'secondary', action: () => {} },
        {
          label: '删除标签',
          tone: 'danger',
          action: () => {
            void deleteTag(tag.id)
              .then(() => useStore.getState().showToast(`已删除标签「${tag.name}」`, 'success'))
              .catch(() => useStore.getState().showToast('删除标签失败', 'error'))
          },
        },
      ],
    })
  }

  const startCreateChild = (parentId: string) => {
    setExpanded(true)
    setCreatingParentId(parentId)
  }

  return (
    <div className="mt-3">
      <div className="flex h-ds-control-sm items-center gap-0.5 px-1">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-1 text-left text-xs font-semibold tracking-wider text-ds-muted outline-none hover:text-ds-foreground focus-visible:ring-2 focus-visible:ring-ds-focus/70"
        >
          {expanded ? (
            <ChevronDownIcon size={13} className="shrink-0" />
          ) : (
            <ChevronRightIcon size={13} className="shrink-0" />
          )}
          <span className="truncate">标签</span>
          <span className="ml-0.5 shrink-0 rounded-full bg-ds-muted/15 px-1.5 py-px text-xs font-normal tabular-nums text-ds-muted/80">
            {tags.length}
          </span>
        </button>
        {!filtering && (
          <Tooltip content="新建标签">
            <IconButton
              size="sm"
              className="!h-6 !w-6 !min-h-6"
              aria-label="新建标签"
              icon={<PlusIcon size={13} />}
              onClick={() => {
                setExpanded(true)
                setCreatingParentId(null)
              }}
            />
          </Tooltip>
        )}
      </div>
      {expanded && (
        <div className="mt-0.5 min-w-0">
          {rows.map((row, index) => {
            if (row.kind === 'create') {
              return (
                <TagCreateRow
                  key={`create-${row.parentId ?? 'root'}-${index}`}
                  label={row.label ?? '标签名称'}
                  onCancel={() => setCreatingParentId(undefined)}
                  onCreate={(name) =>
                    createTag(name, row.parentId ?? null)
                      .then((tag) => {
                        if (tag) useStore.getState().showToast(`已创建标签「${tag.name}」`, 'success')
                        return tag
                      })
                      .catch(() => {
                        useStore.getState().showToast('创建标签失败', 'error')
                      })
                  }
                />
              )
            }
            const node = row.node!
            const { tag } = node
            const selected = selectedTagIds.includes(tag.id)
            return (
              <div
                key={tag.id}
                data-tag-id={tag.id}
                className={cn('min-w-0 rounded-md', selected && 'bg-ds-primary/10')}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setContextView('main')
                  setContextMenu({ x: event.clientX, y: event.clientY, tag })
                }}
              >
                <TagRow
                  tag={tag}
                  depth={row.depth ?? 0}
                  selected={selected}
                  count={counts.byTag.get(tag.id) ?? 0}
                  editing={editingTagId === tag.id}
                  onEditingChange={(editing) => setEditingTagId(editing ? tag.id : null)}
                  onToggle={(tagId) => toggleTagFilter(tagId)}
                  onCreateChild={(tagId) => startCreateChild(tagId)}
                  onDelete={(target) => handleDelete(target)}
                  onMerge={(sourceId, targetId) =>
                    void mergeTags(sourceId, targetId).catch(() =>
                      useStore.getState().showToast('合并标签失败', 'error'),
                    )
                  }
                  onSetColor={(tagId, color) =>
                    void setTagColor(tagId, color)
                      .then(() => useStore.getState().showToast(color ? '已设置标签颜色' : '已清除标签颜色', 'success'))
                      .catch(() => useStore.getState().showToast('设置标签颜色失败', 'error'))
                  }
                />
              </div>
            )
          })}
          {rows.length === 0 && filtering && <p className="px-1.5 py-2 text-xs text-ds-muted">无匹配的标签</p>}
        </div>
      )}
      {contextMenu && (
        <div ref={contextMenuRef} className="fixed z-dropdown" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <Menu
            label={`${contextMenu.tag.name}操作`}
            className="w-44 p-1"
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              event.stopPropagation()
              setContextMenu(null)
            }}
          >
            <TagMenuContent
              view={contextView}
              setView={setContextView}
              onClose={() => setContextMenu(null)}
              tag={contextMenu.tag}
              tags={tags}
              onCreateChild={() => {
                setContextMenu(null)
                startCreateChild(contextMenu.tag.id)
              }}
              onRename={() => {
                setContextMenu(null)
                setEditingTagId(contextMenu.tag.id)
              }}
              onDelete={() => {
                setContextMenu(null)
                handleDelete(contextMenu.tag)
              }}
              onMerge={(targetId) => {
                void mergeTags(contextMenu.tag.id, targetId).catch(() =>
                  useStore.getState().showToast('合并标签失败', 'error'),
                )
              }}
              onSetColor={(color) => {
                void setTagColor(contextMenu.tag.id, color)
                  .then(() => useStore.getState().showToast(color ? '已设置标签颜色' : '已清除标签颜色', 'success'))
                  .catch(() => useStore.getState().showToast('设置标签颜色失败', 'error'))
              }}
            />
          </Menu>
        </div>
      )}
    </div>
  )
}

export default memo(AssetLibraryTagSectionInner)
