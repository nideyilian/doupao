import {
  Badge,
  Button,
  DialogPane,
  DialogWorkspace,
  EmptyState,
  IconButton,
  Inline,
  ListRow,
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
  PlusIcon as Plus,
  SaveIcon as Save,
  StarIcon as Star,
  TrashIcon as Trash2,
  CloseIcon as X,
} from '../../design-system/icons'
import { useAppDialog } from '../../hooks/useAppDialog'
import { useStore } from '../../store'
import type { SopGroup, SopLibraryItem } from './types'
import SopCoverImage from './SopCoverImage'
import SopTextEditor from './SopTextEditor'

export type SopLibraryTabProps = {
  groups: SopGroup[]
  items: SopLibraryItem[]
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
  toggleSelectItem: (itemId: string) => void
  selectAllFiltered: () => void
  clearSelection: () => void
  batchMoveSelected: (targetGroupId: string) => void
  batchDeleteSelected: () => void
  addItem: () => void
  selectedItemId: string
  setSelectedItemId: (id: string) => void
  selectItem: (item: SopLibraryItem) => void
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
  toggleSelectItem,
  selectAllFiltered,
  clearSelection,
  batchMoveSelected,
  batchDeleteSelected,
  addItem,
  selectedItemId,
  setSelectedItemId,
  selectItem,
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
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">SOP 列表</h3>
            <p className="sop-center-quiet-text mt-1 text-xs">{filteredItems.length} 个 SOP</p>
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
        {selectedIds.size > 0 && (
          <div className="sop-center-bulk-bar" role="toolbar" aria-label="批量操作">
            <span>已选 {selectedIds.size} 项</span>
            <button type="button" onClick={selectAllFiltered}>
              全选
            </button>
            <button type="button" onClick={clearSelection}>
              取消选择
            </button>
            <div className="sop-center-bulk-bar__actions">
              <select
                aria-label="移动所选 SOP 到分组"
                defaultValue=""
                onChange={(event) => {
                  const value = event.target.value
                  if (!value) return
                  batchMoveSelected(value === '__ungrouped__' ? '' : value)
                }}
                className="sop-center-bulk-select"
              >
                <option value="" disabled>
                  移动到分组…
                </option>
                <option value="__ungrouped__">未分组</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="secondary" onClick={batchDeleteSelected}>
                删除所选
              </Button>
            </div>
          </div>
        )}
        <div className="sop-center-sop-list mt-3" role="list">
          {filteredItems.map((item) => {
            const groupName = groups.find((group) => group.id === item.groupId)?.name ?? '未分组'
            return (
              <article
                key={item.id}
                className="sop-center-sop-row group"
                data-selected={selectedItemId === item.id || undefined}
                role="listitem"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(item.id)}
                  onChange={() => toggleSelectItem(item.id)}
                  aria-label={`勾选 ${item.name}`}
                  className="sop-center-sop-checkbox"
                />
                <button
                  type="button"
                  onClick={() => selectItem(item)}
                  onDoubleClick={(event) => {
                    event.stopPropagation()
                    openCoverPickerForItem(item)
                  }}
                  aria-label={`选择 ${item.name}`}
                  title="选择 SOP，双击选择封面"
                  className="sop-center-sop-cover"
                >
                  <SopCoverImage
                    imageId={selectedItemId === item.id ? itemDraft?.coverImageId : item.coverImageId}
                    alt={`${item.name} 封面`}
                    fallbackText={item.name.trim().slice(0, 1) || 'S'}
                    className="h-ds-12 w-ds-12 rounded-lg"
                  />
                </button>
                <button
                  type="button"
                  onClick={() => selectItem(item)}
                  title={item.name}
                  className="sop-center-sop-main"
                >
                  <span className="block min-w-0 w-full truncate text-sm font-semibold">{item.name}</span>
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
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-[1_1_18rem]">
                <h3 className="font-semibold">SOP 参数与正文</h3>
                <p className="sop-center-quiet-text mt-1 text-xs" aria-live="polite">
                  {itemEditorHint} Ctrl/Cmd+S 可立即保存。
                </p>
              </div>
              <Inline className="sop-center-editor-card__actions max-w-full" justify="flex-end">
                {onApply && (
                  <Button
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
                  disabled={!itemDirty || !itemDraft.name.trim() || !itemDraft.content.trim()}
                  onClick={() => saveItemDraftNow()}
                  variant={itemDirty ? 'primary' : 'secondary'}
                  leadingIcon={<Save size={15} />}
                >
                  保存修改
                </Button>
                <Button
                  disabled={!persistedItem}
                  onClick={() => {
                    if (!persistedItem) return
                    if (onManagePromptRuns) onManagePromptRuns(persistedItem)
                    else void viewGeneratedPrompts(persistedItem)
                  }}
                  variant="secondary"
                  leadingIcon={<ListChecks size={15} />}
                >
                  {onManagePromptRuns ? '提示词管理' : '生成提示词'}
                </Button>
                <Button
                  onClick={() => setCoverPickerOpen(true)}
                  variant="secondary"
                  leadingIcon={<FileImage size={15} />}
                >
                  选择封面
                </Button>
                <Button
                  disabled={!persistedItem}
                  onClick={() => setVersionDialogOpen(true)}
                  variant="secondary"
                  leadingIcon={<History size={15} />}
                >
                  版本历史
                </Button>
                {onClear && selectedSopId && (
                  <Button
                    onClick={() => {
                      onClear()
                      showToast('已取消应用当前 SOP', 'info')
                    }}
                    variant="secondary"
                  >
                    取消应用
                  </Button>
                )}
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
                containerClassName="sop-center-editor-fields__description"
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
