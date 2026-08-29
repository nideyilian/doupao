import { useMemo, useState, type DragEvent } from 'react'
import {
  BookOpenCheckIcon as BookOpenCheck,
  ChevronDownIcon as ChevronDown,
  CopyIcon as Copy,
  GripVerticalIcon as GripVertical,
  PencilIcon as Pencil,
  SaveIcon as Save,
} from '../../design-system/icons'
import { Dialog } from '../../design-system'
import { useStore } from '../../store'
import type { SopGroup, SopLibraryItem } from './types'
import SopCoverImage from './SopCoverImage'

const UNGROUPED_GROUP_ID = 'ungrouped'

export default function SopPresetPickerModal({
  open,
  items,
  groups,
  selectedSopId,
  onSelect,
  onClear,
  onManage,
  onSaveItem,
  onDuplicateItem,
  onOpenChange,
}: {
  open: boolean
  items: SopLibraryItem[]
  groups: SopGroup[]
  selectedSopId?: string
  onSelect: (item: SopLibraryItem) => void
  onClear?: () => void
  onManage?: () => void
  onSaveItem?: (item: SopLibraryItem) => void
  onDuplicateItem?: (itemId: string) => string | null
  onOpenChange: (open: boolean) => void
}) {
  const [search, setSearch] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([])
  const [expandedSopId, setExpandedSopId] = useState('')
  const [editingSopId, setEditingSopId] = useState('')
  const [editDraft, setEditDraft] = useState<SopLibraryItem | null>(null)
  const [movingSopId, setMovingSopId] = useState('')
  const [draggedSopId, setDraggedSopId] = useState('')
  const [dropGroupId, setDropGroupId] = useState('')
  const [feedback, setFeedback] = useState('')

  const visibleGroups = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    const matches = (item: SopLibraryItem) =>
      !query || `${item.name} ${item.description} ${item.content}`.toLocaleLowerCase().includes(query)
    const showEmptyGroups = !query || Boolean(draggedSopId)
    const grouped = groups
      .map((group) => ({
        id: group.id,
        name: group.name,
        items: items.filter((item) => item.groupId === group.id && matches(item)),
      }))
      .filter((group) => showEmptyGroups || group.items.length)
    const ungrouped = items.filter((item) => !item.groupId && matches(item))
    return showEmptyGroups || ungrouped.length
      ? [...grouped, { id: UNGROUPED_GROUP_ID, name: '未分组', items: ungrouped }]
      : grouped
  }, [draggedSopId, groups, items, search])
  const hasVisibleItems = visibleGroups.some((group) => group.items.length > 0)

  const getGroupName = (groupId: string) =>
    groupId === UNGROUPED_GROUP_ID ? '未分组' : (groups.find((group) => group.id === groupId)?.name ?? '未分组')

  const moveItem = (itemId: string, targetGroupId: string) => {
    const item = items.find((candidate) => candidate.id === itemId)
    if (!item || !onSaveItem) return
    const nextGroupId = targetGroupId === UNGROUPED_GROUP_ID ? undefined : targetGroupId
    if (item.groupId === nextGroupId) {
      setMovingSopId('')
      return
    }
    onSaveItem({ ...item, groupId: nextGroupId, updatedAt: Date.now() })
    setFeedback(`已移动到「${getGroupName(targetGroupId)}」`)
    setMovingSopId('')
    setDraggedSopId('')
    setDropGroupId('')
  }

  const handleDragStart = (event: DragEvent<HTMLElement>, item: SopLibraryItem) => {
    if (!onSaveItem) return
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', item.id)
    setDraggedSopId(item.id)
  }

  const handleDrop = (event: DragEvent<HTMLElement>, targetGroupId: string) => {
    event.preventDefault()
    const itemId = event.dataTransfer.getData('text/plain') || draggedSopId
    if (itemId) moveItem(itemId, targetGroupId)
  }

  const startEditing = (item: SopLibraryItem) => {
    setEditingSopId(item.id)
    setEditDraft(item)
    setExpandedSopId(item.id)
    setMovingSopId('')
  }

  const saveEditing = () => {
    if (!editDraft || !onSaveItem || !editDraft.name.trim() || !editDraft.content.trim()) return
    onSaveItem({
      ...editDraft,
      name: editDraft.name.trim(),
      description: editDraft.description.trim(),
      content: editDraft.content.trim(),
      updatedAt: Date.now(),
    })
    setFeedback('已保存')
    setEditingSopId('')
    setEditDraft(null)
  }

  const duplicateItem = (item: SopLibraryItem) => {
    const copiedId = onDuplicateItem?.(item.id)
    if (!copiedId) {
      useStore.getState().showToast('复制失败，请重试', 'error')
      return
    }
    setExpandedSopId(copiedId)
    setFeedback('已复制')
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="选择 SOP 预设"
      description="选择后应用 SOP 内容。"
      size="xl"
      className="h-[min(82vh,760px)]"
      closeLabel="关闭 SOP 预设弹窗"
    >
      {onManage && (
        <div className="flex items-center justify-end -mt-1 mb-2">
          <button
            type="button"
            onClick={onManage}
            aria-label="打开 SOP 库"
            className="flex h-ds-control-lg items-center gap-2 rounded-ds-lg px-3 text-sm font-medium text-ds-primary transition hover:bg-ds-primary-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus dark:text-ds-primary dark:hover:bg-ds-primary/10"
          >
            <BookOpenCheck size={16} />
            SOP 库
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3 border-b border-ds-border/80 pb-4 sm:flex-row sm:items-center sm:justify-between dark:border-ds-border">
        <p className="text-sm font-medium text-ds-text dark:text-ds-text-subtle">共 {items.length} 个 SOP 预设</p>
        <label className="w-full sm:max-w-sm">
          <span className="sr-only">搜索 SOP 预设</span>
          <input
            data-autofocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索 SOP 名称或说明"
            className="h-ds-control-lg w-full rounded-ds-lg border border-ds-border bg-ds-surface px-3 text-sm outline-none transition focus:border-ds-primary focus:ring-2 focus:ring-ds-focus dark:border-ds-border-strong dark:bg-ds-scrim dark:focus:ring-ds-focus"
          />
        </label>
      </div>

      <div className="mt-4 space-y-3">
        {feedback && (
          <p
            role="status"
            className="rounded-lg border border-ds-primary/35 bg-ds-primary-subtle px-3 py-1.5 text-xs text-ds-primary dark:border-ds-primary/20 dark:bg-ds-primary/10 dark:text-ds-primary"
          >
            {feedback}
          </p>
        )}
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            aria-pressed={!selectedSopId}
            className={`flex min-h-ds-control-lg w-full items-center rounded-ds-lg border px-3 text-left text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus ${!selectedSopId ? 'border-ds-primary bg-ds-primary-subtle text-ds-primary dark:border-ds-primary/50 dark:bg-ds-primary/10 dark:text-ds-primary' : 'border-ds-border/80 text-ds-muted hover:bg-ds-subtle dark:border-ds-border dark:text-ds-muted dark:hover:bg-ds-surface'}`}
          >
            不使用 SOP
          </button>
        )}

        {visibleGroups.map((group) => {
          const collapsed = collapsedGroups.includes(group.id)
          const isDropTarget = dropGroupId === group.id
          return (
            <section
              key={group.id}
              data-sop-drop-group={group.id}
              onDragEnter={(event) => {
                if (draggedSopId) {
                  event.preventDefault()
                  setDropGroupId(group.id)
                }
              }}
              onDragOver={(event) => {
                if (draggedSopId) {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  setDropGroupId(group.id)
                }
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node))
                  setDropGroupId((current) => (current === group.id ? '' : current))
              }}
              onDrop={(event) => handleDrop(event, group.id)}
              className={`overflow-hidden rounded-ds-lg border transition ${isDropTarget ? 'border-ds-primary bg-ds-primary-subtle/70 ring-2 ring-ds-focus/50 dark:border-ds-primary dark:bg-ds-primary/10 dark:ring-ds-focus/20' : 'border-ds-border/80 dark:border-ds-border'}`}
            >
              <button
                type="button"
                onClick={() =>
                  setCollapsedGroups((current) =>
                    collapsed ? current.filter((id) => id !== group.id) : [...current, group.id],
                  )
                }
                aria-expanded={!collapsed}
                className="flex min-h-ds-control-lg w-full items-center gap-2 bg-ds-surface px-3 text-left text-sm font-semibold transition hover:bg-ds-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ds-focus dark:bg-ds-surface dark:hover:bg-ds-surface"
              >
                <ChevronDown
                  size={15}
                  className={`shrink-0 text-ds-muted transition-transform ${collapsed ? '-rotate-90' : ''}`}
                />
                <span className="min-w-0 flex-1 truncate">{group.name}</span>
                <span className="text-xs font-medium text-ds-muted">{group.items.length}</span>
              </button>

              {!collapsed && (
                <div className="space-y-1.5 p-2">
                  {group.items.map((item) => {
                    const selected = selectedSopId === item.id
                    const expanded = expandedSopId === item.id
                    const editing = editingSopId === item.id
                    const moving = movingSopId === item.id
                    return (
                      <article
                        key={item.id}
                        draggable={Boolean(onSaveItem)}
                        onDragStart={(event) => handleDragStart(event, item)}
                        onDragEnd={() => {
                          setDraggedSopId('')
                          setDropGroupId('')
                        }}
                        aria-grabbed={draggedSopId === item.id}
                        className={`rounded-lg border transition ${draggedSopId === item.id ? 'opacity-50' : ''} ${selected ? 'border-ds-primary bg-ds-primary-subtle/60 dark:border-ds-primary/50 dark:bg-ds-primary/10' : 'border-ds-border/80 bg-ds-surface dark:border-ds-border dark:bg-ds-surface'}`}
                      >
                        <div className="flex min-w-0 items-center gap-2.5 px-2.5 py-2">
                          {onSaveItem && (
                            <span
                              aria-hidden="true"
                              className="shrink-0 cursor-grab text-ds-text-subtle active:cursor-grabbing dark:text-ds-muted"
                            >
                              <GripVertical size={14} />
                            </span>
                          )}
                          <SopCoverImage
                            imageId={item.coverImageId}
                            alt={`${item.name} 封面`}
                            fallbackText={item.name.trim().slice(0, 1) || 'S'}
                            className="h-ds-control-lg w-12 rounded-lg"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">{item.name}</p>
                            <p className="truncate text-xs leading-4 text-ds-muted">
                              {item.description || item.content || '未填写说明'}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setExpandedSopId(expanded ? '' : item.id)}
                              aria-expanded={expanded}
                              className="h-ds-control-sm rounded-md px-2 text-xs font-medium text-ds-muted transition hover:bg-ds-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus dark:text-ds-muted dark:hover:bg-ds-surface"
                            >
                              {expanded ? '收起' : '预览'}
                            </button>
                            {onSaveItem && (
                              <button
                                type="button"
                                onClick={() => startEditing(item)}
                                aria-label={`编辑 ${item.name}`}
                                title="编辑"
                                className="flex h-ds-control-sm w-ds-control-sm items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-subtle hover:text-ds-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus dark:text-ds-muted dark:hover:bg-ds-surface dark:hover:text-ds-primary"
                              >
                                <Pencil size={14} />
                              </button>
                            )}
                            {onDuplicateItem && (
                              <button
                                type="button"
                                onClick={() => duplicateItem(item)}
                                aria-label={`复制 ${item.name}`}
                                title="复制"
                                className="flex h-ds-control-sm w-ds-control-sm items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-subtle hover:text-ds-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus dark:text-ds-muted dark:hover:bg-ds-surface dark:hover:text-ds-primary"
                              >
                                <Copy size={14} />
                              </button>
                            )}
                            {onSaveItem && (
                              <button
                                type="button"
                                onClick={() => {
                                  setMovingSopId(moving ? '' : item.id)
                                  setEditingSopId('')
                                }}
                                aria-expanded={moving}
                                className="h-ds-control-sm rounded-md px-2 text-xs font-medium text-ds-muted transition hover:bg-ds-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus dark:text-ds-muted dark:hover:bg-ds-surface"
                              >
                                移动
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onSelect(item)}
                              className={`h-ds-control-sm rounded-md px-2 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus ${selected ? 'bg-ds-primary-subtle text-ds-primary hover:bg-ds-primary-subtle dark:bg-ds-primary/15 dark:text-ds-primary dark:hover:bg-ds-primary/25' : 'bg-ds-primary text-ds-text-inverse hover:bg-ds-primary-hover'}`}
                            >
                              {selected ? '已选' : '选择'}
                            </button>
                          </div>
                        </div>

                        {moving && (
                          <div className="border-t border-ds-border/80 px-2.5 py-2 dark:border-ds-border">
                            <select
                              aria-label={`移动 ${item.name} 到分组`}
                              value={item.groupId ?? UNGROUPED_GROUP_ID}
                              onChange={(event) => moveItem(item.id, event.target.value)}
                              className="h-ds-control-sm min-w-36 rounded-md border border-ds-border bg-ds-surface px-2 text-xs outline-none transition focus:border-ds-primary focus:ring-2 focus:ring-ds-focus dark:border-ds-border-strong dark:bg-ds-scrim dark:focus:ring-ds-focus"
                            >
                              <option value={UNGROUPED_GROUP_ID}>未分组</option>
                              {groups.map((targetGroup) => (
                                <option key={targetGroup.id} value={targetGroup.id}>
                                  {targetGroup.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        {editing && editDraft && (
                          <form
                            onSubmit={(event) => {
                              event.preventDefault()
                              saveEditing()
                            }}
                            className="space-y-2 border-t border-ds-border/80 p-2.5 dark:border-ds-border"
                          >
                            <div className="grid gap-2 sm:grid-cols-2">
                              <label className="text-xs font-medium text-ds-muted dark:text-ds-muted">
                                名称
                                <input
                                  value={editDraft.name}
                                  onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value })}
                                  className="mt-1 h-ds-control-sm w-full rounded-md border border-ds-border bg-ds-surface px-2 text-xs outline-none transition focus:border-ds-primary focus:ring-2 focus:ring-ds-focus dark:border-ds-border-strong dark:bg-ds-scrim dark:focus:ring-ds-focus"
                                />
                              </label>
                              <label className="text-xs font-medium text-ds-muted dark:text-ds-muted">
                                分组
                                <select
                                  value={editDraft.groupId ?? UNGROUPED_GROUP_ID}
                                  onChange={(event) =>
                                    setEditDraft({
                                      ...editDraft,
                                      groupId:
                                        event.target.value === UNGROUPED_GROUP_ID ? undefined : event.target.value,
                                    })
                                  }
                                  className="mt-1 h-ds-control-sm w-full rounded-md border border-ds-border bg-ds-surface px-2 text-xs outline-none transition focus:border-ds-primary focus:ring-2 focus:ring-ds-focus dark:border-ds-border-strong dark:bg-ds-scrim dark:focus:ring-ds-focus"
                                >
                                  <option value={UNGROUPED_GROUP_ID}>未分组</option>
                                  {groups.map((targetGroup) => (
                                    <option key={targetGroup.id} value={targetGroup.id}>
                                      {targetGroup.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
                            <label className="block text-xs font-medium text-ds-muted dark:text-ds-muted">
                              说明
                              <textarea
                                value={editDraft.description}
                                onChange={(event) => setEditDraft({ ...editDraft, description: event.target.value })}
                                className="mt-1 min-h-ds-16 w-full rounded-md border border-ds-border bg-ds-surface px-2 py-1.5 text-xs leading-5 outline-none transition focus:border-ds-primary focus:ring-2 focus:ring-ds-focus dark:border-ds-border-strong dark:bg-ds-scrim dark:focus:ring-ds-focus"
                              />
                            </label>
                            <label className="block text-xs font-medium text-ds-muted dark:text-ds-muted">
                              SOP 正文
                              <textarea
                                value={editDraft.content}
                                onChange={(event) => setEditDraft({ ...editDraft, content: event.target.value })}
                                className="mt-1 min-h-32 w-full rounded-md border border-ds-border bg-ds-surface px-2 py-1.5 font-mono text-xs leading-5 outline-none transition focus:border-ds-primary focus:ring-2 focus:ring-ds-focus dark:border-ds-border-strong dark:bg-ds-scrim dark:focus:ring-ds-focus"
                              />
                            </label>
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingSopId('')
                                  setEditDraft(null)
                                }}
                                className="h-ds-control-sm rounded-md px-2.5 text-xs font-medium text-ds-muted transition hover:bg-ds-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus dark:text-ds-muted dark:hover:bg-ds-surface"
                              >
                                取消
                              </button>
                              <button
                                type="submit"
                                disabled={!editDraft.name.trim() || !editDraft.content.trim()}
                                className="flex h-ds-control-sm items-center gap-1.5 rounded-md bg-ds-primary px-2.5 text-xs font-medium text-ds-text-inverse transition hover:bg-ds-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <Save size={14} />
                                保存
                              </button>
                            </div>
                          </form>
                        )}

                        {expanded && !editing && (
                          <div className="border-t border-ds-border/80 px-2.5 py-2 text-xs leading-5 text-ds-muted dark:border-ds-border dark:text-ds-muted">
                            {item.content || '该预设未填写 SOP 内容。'}
                          </div>
                        )}
                      </article>
                    )
                  })}
                  {draggedSopId && group.items.length === 0 && (
                    <div className="rounded-md border border-dashed border-ds-primary/35 px-3 py-3 text-center text-xs text-ds-primary dark:border-ds-primary/40 dark:text-ds-primary">
                      释放即可移至"{group.name}"
                    </div>
                  )}
                </div>
              )}
            </section>
          )
        })}
        {!hasVisibleItems && (
          <p className="rounded-ds-lg border border-dashed border-ds-border p-6 text-center text-sm text-ds-muted dark:border-ds-border">
            {search ? '没有匹配的 SOP 预设' : '暂无可用 SOP 预设'}
          </p>
        )}
      </div>
    </Dialog>
  )
}
