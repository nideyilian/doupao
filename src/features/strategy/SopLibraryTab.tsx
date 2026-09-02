import { useEffect, useRef, useState } from 'react'
import {
  Badge,
  Button,
  DialogPane,
  DialogWorkspace,
  EmptyState,
  IconButton,
  Inline,
  ListRow,
  Menu,
  MenuItem,
  MenuSeparator,
  SearchField,
  SelectField,
  TextField,
} from '../../design-system'
import {
  CheckIcon as Check,
  CopyIcon as Copy,
  FileImageIcon as FileImage,
  HistoryIcon as History,
  ListChecksIcon as ListChecks,
  MousePointerClickIcon as MousePointerClick,
  MoreHorizontalIcon as MoreHorizontal,
  PlusIcon as Plus,
  SaveIcon as Save,
  StarIcon as Star,
  TrashIcon as Trash2,
  CloseIcon as X,
} from '../../design-system/icons'
import { useAppDialog } from '../../hooks/useAppDialog'
import { useCloseOnEscape } from '../../hooks/useCloseOnEscape'
import { useStore } from '../../store'
import type { TaskRecord } from '../../types'
import type { SopGroup, SopLibraryItem } from './types'
import SopImageStack from './SopImageStack'
import SopTextEditor from './SopTextEditor'

const SOP_DRAG_TYPE = 'application/x-doupao-sop-ids'

export type SopLibraryTabProps = {
  groups: SopGroup[]
  items: SopLibraryItem[]
  tasks: TaskRecord[]
  filteredItems: SopLibraryItem[]
  search: string
  setSearch: (value: string) => void
  selectedGroupId: string
  selectGroup: (groupId: string) => void
  editingGroupId: string | null
  editingGroupName: string
  setEditingGroupName: (value: string) => void
  renameInputRef: React.RefObject<HTMLInputElement | null>
  commitRenameGroup: () => void
  cancelRenameGroup: () => void
  openGroupContextMenu: (event: React.MouseEvent<HTMLElement>, groupId?: string) => void
  selectedIds: Set<string>
  moveItemsToGroup: (itemIds: string[], targetGroupId: string) => void
  addItem: () => void
  selectedItemId: string
  setSelectedItemId: (id: string) => void
  selectItemWithModifiers: (
    item: SopLibraryItem,
    event?: Pick<React.MouseEvent<HTMLElement>, 'ctrlKey' | 'metaKey' | 'shiftKey'>,
  ) => void
  openCoverPickerForItem: (item: SopLibraryItem) => void
  itemDraft: SopLibraryItem | null
  setItemDraft: React.Dispatch<React.SetStateAction<SopLibraryItem | null>>
  itemDirty: boolean
  itemApplied: boolean
  itemEditorHint: string
  persistedItem?: SopLibraryItem
  onApply?: (item: SopLibraryItem) => void
  onClear?: () => void
  selectedSopId?: string
  applyItem: (item: SopLibraryItem) => void
  saveItemDraftNow: () => boolean
  saveRevisionAsNewItem: (content: string) => void
  viewGeneratedPrompts: (item: SopLibraryItem) => Promise<void>
  onManagePromptRuns?: (item: SopLibraryItem) => void
  setCoverPickerOpen: (open: boolean) => void
  setVersionDialogOpen: (open: boolean) => void
  onTestSopRevision?: (item: SopLibraryItem) => Promise<void>
  onSaveItem: (item: SopLibraryItem) => void
  onDuplicateItem: (itemId: string) => string | null
  onDeleteItem: (itemId: string) => void
}

/** SOP 管理中心「SOP 库」标签页：分组侧栏 + SOP 列表 + 参数与正文编辑面板。 */
export default function SopLibraryTab({
  groups,
  items,
  tasks,
  filteredItems,
  search,
  setSearch,
  selectedGroupId,
  selectGroup,
  editingGroupId,
  editingGroupName,
  setEditingGroupName,
  renameInputRef,
  commitRenameGroup,
  cancelRenameGroup,
  openGroupContextMenu,
  selectedIds,
  moveItemsToGroup,
  addItem,
  selectedItemId,
  setSelectedItemId,
  selectItemWithModifiers,
  openCoverPickerForItem,
  itemDraft,
  setItemDraft,
  itemDirty,
  itemApplied,
  itemEditorHint,
  persistedItem,
  onApply,
  onClear,
  selectedSopId,
  applyItem,
  saveItemDraftNow,
  saveRevisionAsNewItem,
  viewGeneratedPrompts,
  onManagePromptRuns,
  setCoverPickerOpen,
  setVersionDialogOpen,
  onTestSopRevision,
  onSaveItem,
  onDuplicateItem,
  onDeleteItem,
}: SopLibraryTabProps) {
  const { openConfirmDialog } = useAppDialog()
  const showToast = useStore((state) => state.showToast)
  const [editorMenuOpen, setEditorMenuOpen] = useState(false)
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null)
  const editorMenuRef = useRef<HTMLDivElement>(null)

  useCloseOnEscape(editorMenuOpen, () => setEditorMenuOpen(false))

  useEffect(() => {
    if (!editorMenuOpen) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!editorMenuRef.current?.contains(event.target as Node)) setEditorMenuOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => document.removeEventListener('mousedown', closeOnOutsideClick)
  }, [editorMenuOpen])

  useEffect(() => {
    setEditorMenuOpen(false)
  }, [selectedItemId])

  const handleSopDragStart = (event: React.DragEvent<HTMLElement>, item: SopLibraryItem) => {
    const itemIds = selectedIds.has(item.id) && selectedIds.size > 1 ? Array.from(selectedIds) : [item.id]
    event.dataTransfer.setData(SOP_DRAG_TYPE, JSON.stringify(itemIds))
    event.dataTransfer.effectAllowed = 'move'
  }

  const handleGroupDragOver = (event: React.DragEvent<HTMLElement>, groupId: string) => {
    if (!Array.from(event.dataTransfer.types).includes(SOP_DRAG_TYPE)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setDragOverGroupId(groupId)
  }

  const handleGroupDragLeave = (event: React.DragEvent<HTMLElement>, groupId: string) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setDragOverGroupId((current) => (current === groupId ? null : current))
  }

  const handleGroupDrop = (event: React.DragEvent<HTMLElement>, groupId: string) => {
    event.preventDefault()
    event.stopPropagation()
    setDragOverGroupId(null)
    const raw = event.dataTransfer.getData(SOP_DRAG_TYPE)
    if (!raw) return
    try {
      const itemIds = JSON.parse(raw)
      if (Array.isArray(itemIds)) {
        const validIds = itemIds.filter((itemId): itemId is string => typeof itemId === 'string')
        if (validIds.length > 0) moveItemsToGroup(validIds, groupId)
      }
    } catch {
      // 忽略无效的拖拽负载
    }
  }

  return (
    <DialogWorkspace layout="triple" className="sop-center-library-grid min-h-0 flex-1">
      <DialogPane
        as="aside"
        tone="sidebar"
        className="sop-center-sidebar"
        onContextMenu={(event) => openGroupContextMenu(event)}
      >
        <div className="space-y-1">
          {[
            { id: 'all', name: '全部 SOP', count: items.length },
            { id: 'favorites', name: '收藏', count: items.filter((item) => item.favorite).length },
            { id: 'recent', name: '最近使用', count: items.filter((item) => item.lastUsedAt).length },
            { id: 'ungrouped', name: '未分组', count: items.filter((item) => !item.groupId).length },
          ].map((group) => (
            <button
              key={group.id}
              type="button"
              onClick={() => selectGroup(group.id)}
              className="sop-center-nav-item"
              data-selected={selectedGroupId === group.id || undefined}
              data-drag-over={group.id === 'ungrouped' && dragOverGroupId === '' ? true : undefined}
              onDragOver={group.id === 'ungrouped' ? (event) => handleGroupDragOver(event, '') : undefined}
              onDragLeave={group.id === 'ungrouped' ? (event) => handleGroupDragLeave(event, '') : undefined}
              onDrop={group.id === 'ungrouped' ? (event) => handleGroupDrop(event, '') : undefined}
            >
              <span>{group.name}</span>
              <span className="text-xs opacity-70">{group.count}</span>
            </button>
          ))}
          {groups.map((group) => {
            const isEditing = editingGroupId === group.id
            if (isEditing) {
              return (
                <div
                  key={group.id}
                  className="sop-center-group-row sop-center-group-row--editing flex items-center gap-1"
                  data-selected={selectedGroupId === group.id || undefined}
                >
                  <input
                    ref={renameInputRef}
                    value={editingGroupName}
                    onChange={(event) => setEditingGroupName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitRenameGroup()
                      if (event.key === 'Escape') cancelRenameGroup()
                    }}
                    onBlur={commitRenameGroup}
                    placeholder="分组名称"
                    className="ds-input h-ds-control-lg min-w-0 flex-1 px-3 text-sm"
                    aria-label="重命名分组"
                  />
                  <IconButton
                    size="sm"
                    onClick={commitRenameGroup}
                    aria-label="保存分组名称"
                    icon={<Check size={14} />}
                  />
                  <IconButton
                    size="sm"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={cancelRenameGroup}
                    aria-label="取消重命名"
                    icon={<X size={14} />}
                  />
                </div>
              )
            }
            return (
              <ListRow
                key={group.id}
                className="sop-center-group-row"
                selected={selectedGroupId === group.id}
                title={group.name}
                data-sop-drop-group={group.id}
                data-drag-over={dragOverGroupId === group.id || undefined}
                onDragOver={(event) => handleGroupDragOver(event, group.id)}
                onDragLeave={(event) => handleGroupDragLeave(event, group.id)}
                onDrop={(event) => handleGroupDrop(event, group.id)}
                interactive={{
                  onClick: () => selectGroup(group.id),
                }}
                onContextMenu={(event) => openGroupContextMenu(event, group.id)}
              />
            )
          })}
        </div>
      </DialogPane>

      <DialogPane className="sop-center-list-panel">
        <div className="sop-center-list-head">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">SOP 列表</h3>
              <span className="sop-center-list-count">{filteredItems.length}</span>
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={addItem} leadingIcon={<Plus size={15} />}>
            新建
          </Button>
        </div>
        <SearchField
          className="mt-3"
          label="搜索 SOP"
          value={search}
          onChange={setSearch}
          onClear={() => setSearch('')}
          placeholder="搜索名称、说明或正文"
        />
        <div className="sop-center-sop-list mt-3" role="list">
          {filteredItems.map((item) => {
            const groupName = groups.find((group) => group.id === item.groupId)?.name ?? '未分组'
            return (
              <article
                key={item.id}
                className="sop-center-sop-row group"
                data-selected={selectedItemId === item.id || selectedIds.has(item.id) || undefined}
                role="listitem"
                draggable
                onDragStart={(event) => handleSopDragStart(event, item)}
                onDragEnd={() => setDragOverGroupId(null)}
              >
                <SopImageStack
                  item={selectedItemId === item.id && itemDraft ? itemDraft : item}
                  tasks={tasks}
                  onClick={(event) => selectItemWithModifiers(item, event)}
                  onDoubleClick={(event) => {
                    event.stopPropagation()
                    openCoverPickerForItem(item)
                  }}
                  title="单击编辑；Ctrl/⌘ 点击切换多选；Shift 点击连续选择；拖到左侧分组移动；双击选择封面"
                />
                <button
                  type="button"
                  onClick={(event) => selectItemWithModifiers(item, event)}
                  title={item.name}
                  aria-pressed={selectedIds.has(item.id)}
                  className="sop-center-sop-main"
                >
                  <span className="block min-w-0 w-full truncate text-sm font-semibold">{item.name}</span>
                  <span className="sop-center-sop-description">{item.description.trim() || '暂无说明'}</span>
                  <span className="sop-center-sop-params" aria-label="SOP 参数">
                    <span>{groupName}</span>
                    {item.executionMode === 'variable-prompt' && <Badge tone="info">变量提示词</Badge>}
                    {selectedSopId === item.id && <Badge tone="success">使用中</Badge>}
                  </span>
                </button>
                <div className="sop-center-sop-actions" aria-label={`${item.name} 操作`}>
                  <IconButton
                    size="sm"
                    onClick={() => {
                      onSaveItem({ ...item, favorite: !item.favorite, updatedAt: Date.now() })
                      showToast(
                        item.favorite ? `已取消收藏 SOP「${item.name}」` : `已收藏 SOP「${item.name}」`,
                        'success',
                      )
                    }}
                    aria-label={`${item.favorite ? '取消收藏' : '收藏'} ${item.name}`}
                    title={item.favorite ? '取消收藏' : '收藏'}
                    icon={<Star size={14} fill={item.favorite ? 'currentColor' : 'none'} />}
                    className={`sop-center-row-action ${item.favorite ? 'sop-center-action--favorite' : ''}`}
                  />
                  {onApply && (
                    <IconButton
                      size="sm"
                      onClick={() => applyItem(item)}
                      aria-label={`应用 ${item.name}`}
                      title="应用到当前生图"
                      icon={<MousePointerClick size={14} />}
                      className={`sop-center-row-action ${selectedSopId === item.id ? 'sop-center-action--applied' : ''}`}
                    />
                  )}
                  <IconButton
                    size="sm"
                    onClick={() => {
                      const id = onDuplicateItem(item.id)
                      if (id) {
                        setSelectedItemId(id)
                        showToast(`已复制 SOP「${item.name}」`, 'success')
                      } else {
                        showToast('复制 SOP 失败，请重试', 'error')
                      }
                    }}
                    aria-label={`复制${item.name}`}
                    title="复制 SOP"
                    icon={<Copy size={14} />}
                    className="sop-center-row-action"
                  />
                  <IconButton
                    size="sm"
                    onClick={() =>
                      openConfirmDialog({
                        title: '删除 SOP？',
                        message: `将永久删除「${item.name}」。`,
                        confirmText: '确认删除',
                        tone: 'danger',
                        action: () => {
                          onDeleteItem(item.id)
                          showToast(`已删除 SOP「${item.name}」`, 'success')
                        },
                      })
                    }
                    aria-label={`删除${item.name}`}
                    title="删除 SOP"
                    icon={<Trash2 size={14} />}
                    className="sop-center-row-action sop-center-action--danger"
                  />
                </div>
              </article>
            )
          })}
          {filteredItems.length === 0 && (
            <EmptyState title="当前分组暂无 SOP" description="新建 SOP，或切换到其他分组查看。" />
          )}
        </div>
      </DialogPane>

      <DialogPane tone="canvas" className="sop-center-editor-panel flex min-h-0 flex-col">
        {itemDraft ? (
          <div className="sop-center-editor-card flex min-h-0 flex-1 flex-col gap-4">
            <div className="sop-center-editor-head">
              <div className="min-w-0">
                <span className="sop-center-editor-eyebrow">正在编辑</span>
                <div className="flex min-w-0 items-center gap-2">
                  <h3 className="truncate font-semibold">{itemDraft.name || '未命名 SOP'}</h3>
                  {itemApplied && <Badge tone="success">使用中</Badge>}
                </div>
                <p className="sop-center-quiet-text mt-1 text-xs" aria-live="polite">
                  {itemEditorHint}
                </p>
              </div>
              <Inline className="sop-center-editor-card__actions max-w-full" gap={2} justify="flex-end" wrap={false}>
                {onApply && (
                  <Button
                    size="sm"
                    disabled={!persistedItem || itemDirty || itemApplied}
                    onClick={() => persistedItem && applyItem(persistedItem)}
                    variant={itemApplied || itemDirty ? 'secondary' : 'primary'}
                    leadingIcon={<MousePointerClick size={15} />}
                    className={itemApplied ? 'text-ds-success' : undefined}
                  >
                    {itemApplied ? '已使用' : '应用 SOP'}
                  </Button>
                )}
                <Button
                  size="sm"
                  disabled={!itemDirty || !itemDraft.name.trim() || !itemDraft.content.trim()}
                  onClick={() => saveItemDraftNow()}
                  variant={itemDirty ? 'primary' : 'secondary'}
                  leadingIcon={<Save size={15} />}
                >
                  保存修改
                </Button>
                <div ref={editorMenuRef} className="relative">
                  <IconButton
                    size="sm"
                    onClick={() => setEditorMenuOpen((current) => !current)}
                    aria-label="更多 SOP 操作"
                    aria-expanded={editorMenuOpen}
                    aria-haspopup="menu"
                    title="更多操作"
                    icon={<MoreHorizontal size={16} />}
                  />
                  {editorMenuOpen && (
                    <Menu label="SOP 更多操作" className="sop-center-editor-menu">
                      <MenuItem
                        icon={<ListChecks size={15} />}
                        disabled={!persistedItem}
                        onClick={() => {
                          setEditorMenuOpen(false)
                          if (!persistedItem) return
                          if (onManagePromptRuns) onManagePromptRuns(persistedItem)
                          else void viewGeneratedPrompts(persistedItem)
                        }}
                      >
                        {onManagePromptRuns ? '提示词管理' : '生成提示词'}
                      </MenuItem>
                      <MenuItem
                        icon={<FileImage size={15} />}
                        onClick={() => {
                          setEditorMenuOpen(false)
                          setCoverPickerOpen(true)
                        }}
                      >
                        选择封面
                      </MenuItem>
                      <MenuItem
                        icon={<History size={15} />}
                        disabled={!persistedItem}
                        onClick={() => {
                          setEditorMenuOpen(false)
                          setVersionDialogOpen(true)
                        }}
                      >
                        版本历史
                      </MenuItem>
                      {onClear && selectedSopId && (
                        <>
                          <MenuSeparator />
                          <MenuItem
                            onClick={() => {
                              setEditorMenuOpen(false)
                              onClear()
                              showToast('已取消应用当前 SOP', 'info')
                            }}
                          >
                            取消应用
                          </MenuItem>
                        </>
                      )}
                    </Menu>
                  )}
                </div>
              </Inline>
            </div>
            <div className="sop-center-editor-fields">
              <TextField
                label="名称"
                value={itemDraft.name}
                onChange={(event) => setItemDraft({ ...itemDraft, name: event.target.value })}
              />
              <SelectField
                label="所属分组"
                value={itemDraft.groupId ?? ''}
                onChange={(event) => setItemDraft({ ...itemDraft, groupId: event.target.value || undefined })}
                options={[
                  { value: '', label: '未分组' },
                  ...groups.map((group) => ({ value: group.id, label: group.name })),
                ]}
              />
              <TextField
                label="说明"
                value={itemDraft.description}
                onChange={(event) => setItemDraft({ ...itemDraft, description: event.target.value })}
              />
            </div>
            <SopTextEditor
              documentId={itemDraft.id}
              value={itemDraft.content}
              onChange={(content) => setItemDraft({ ...itemDraft, content })}
              onSaveAsRevision={saveRevisionAsNewItem}
              onTestRevision={onTestSopRevision ? (content) => onTestSopRevision({ ...itemDraft, content }) : undefined}
              variableMeta={itemDraft.executionMode === 'variable-prompt' ? itemDraft.variableMeta : undefined}
              onVariableMetaChange={(meta) =>
                setItemDraft((current) => (current ? { ...current, variableMeta: meta } : current))
              }
            />
          </div>
        ) : (
          <EmptyState className="h-full" title="选择或新建一个 SOP" description="从左侧列表选择内容后即可编辑。" />
        )}
      </DialogPane>
    </DialogWorkspace>
  )
}
