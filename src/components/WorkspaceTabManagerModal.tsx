import { useCallback, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { CloseIcon, PlusIcon, TrashIcon, ExportIcon } from './icons'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { useDialogFocusTrap } from '../design-system'

export default function WorkspaceTabManagerModal() {
  const open = useStore((s) => s.workspaceTabManagerOpen)
  const workspaceTabs = useStore((s) => s.workspaceTabs)
  const workspaceTabGroups = useStore((s) => s.workspaceTabGroups)
  const activeWorkspaceTabId = useStore((s) => s.activeWorkspaceTabId)
  const selectedWorkspaceTabIds = useStore((s) => s.selectedWorkspaceTabIds)

  const setWorkspaceTabManagerOpen = useStore((s) => s.setWorkspaceTabManagerOpen)
  const closeWorkspaceTab = useStore((s) => s.closeWorkspaceTab)
  const duplicateWorkspaceTab = useStore((s) => s.duplicateWorkspaceTab)
  const renameWorkspaceTab = useStore((s) => s.renameWorkspaceTab)
  const createWorkspaceTabGroup = useStore((s) => s.createWorkspaceTabGroup)
  const renameWorkspaceTabGroup = useStore((s) => s.renameWorkspaceTabGroup)
  const deleteWorkspaceTabGroup = useStore((s) => s.deleteWorkspaceTabGroup)
  const moveWorkspaceTabToGroup = useStore((s) => s.moveWorkspaceTabToGroup)
  const setActiveWorkspaceTabId = useStore((s) => s.setActiveWorkspaceTabId)
  const setSelectedWorkspaceTabIds = useStore((s) => s.setSelectedWorkspaceTabIds)
  const toggleWorkspaceTabSelection = useStore((s) => s.toggleWorkspaceTabSelection)
  const clearWorkspaceTabSelection = useStore((s) => s.clearWorkspaceTabSelection)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const setPromptInputDialog = useStore((s) => s.setPromptInputDialog)
  const showToast = useStore((s) => s.showToast)

  const [searchQuery, setSearchQuery] = useState('')
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [editingGroupName, setEditingGroupName] = useState('')
  const modalRef = useRef<HTMLDivElement>(null)

  const filteredTabs = useMemo(() => {
    if (!searchQuery.trim()) return workspaceTabs
    const q = searchQuery.trim().toLowerCase()
    return workspaceTabs.filter((t) => t.name.toLowerCase().includes(q))
  }, [workspaceTabs, searchQuery])

  const grouped = useMemo(() => {
    const groupMap = new Map<string | null, typeof workspaceTabs>()
    for (const tab of filteredTabs) {
      const key = tab.groupId ?? null
      if (!groupMap.has(key)) groupMap.set(key, [])
      groupMap.get(key)!.push(tab)
    }
    const sortedGroups = [
      { group: null as (typeof workspaceTabGroups)[0] | null, tabs: groupMap.get(null) ?? [] },
      ...workspaceTabGroups
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((g) => ({ group: g, tabs: groupMap.get(g.id) ?? [] })),
    ]
    return sortedGroups.filter((sg) => sg.tabs.length > 0)
  }, [filteredTabs, workspaceTabGroups])

  const handleClose = useCallback(() => {
    setWorkspaceTabManagerOpen(false)
    setSearchQuery('')
    setEditingTabId(null)
    setEditingGroupId(null)
  }, [setWorkspaceTabManagerOpen])

  const handleSelectAll = useCallback(() => {
    if (selectedWorkspaceTabIds.length === workspaceTabs.length) {
      clearWorkspaceTabSelection()
    } else {
      setSelectedWorkspaceTabIds(workspaceTabs.map((t) => t.id))
    }
  }, [selectedWorkspaceTabIds, workspaceTabs, clearWorkspaceTabSelection, setSelectedWorkspaceTabIds])

  const handleBatchClose = useCallback(() => {
    if (selectedWorkspaceTabIds.length === 0) return
    setConfirmDialog({
      title: '批量关闭',
      message: `确定要关闭选中的 ${selectedWorkspaceTabIds.length} 个标签页吗？`,
      confirmText: '关闭',
      cancelText: '取消',
      tone: 'danger',
      action: () => {
        for (const id of selectedWorkspaceTabIds) closeWorkspaceTab(id)
        clearWorkspaceTabSelection()
        showToast('已批量关闭', 'success')
      },
    })
  }, [selectedWorkspaceTabIds, closeWorkspaceTab, clearWorkspaceTabSelection, setConfirmDialog, showToast])

  const handleBatchRun = useCallback(() => {
    if (selectedWorkspaceTabIds.length === 0) {
      showToast('请先选择要运行的标签页', 'info')
      return
    }
    setConfirmDialog({
      title: '批量运行',
      message: `确定要运行选中的 ${selectedWorkspaceTabIds.length} 个标签页吗？`,
      confirmText: '运行',
      cancelText: '取消',
      action: async () => {
        const { submitTask } = await import('../store')
        for (const tabId of selectedWorkspaceTabIds) {
          const tab = workspaceTabs.find((t) => t.id === tabId)
          if (!tab) continue
          setActiveWorkspaceTabId(tabId)
          setTimeout(() => {
            submitTask()
          }, 0)
        }
        clearWorkspaceTabSelection()
        showToast('批量运行已启动', 'success')
      },
    })
  }, [
    selectedWorkspaceTabIds,
    workspaceTabs,
    setActiveWorkspaceTabId,
    setConfirmDialog,
    showToast,
    clearWorkspaceTabSelection,
  ])

  const handleBatchDuplicate = useCallback(() => {
    if (selectedWorkspaceTabIds.length === 0) return
    for (const id of selectedWorkspaceTabIds) duplicateWorkspaceTab(id)
    clearWorkspaceTabSelection()
    showToast('已批量复制', 'success')
  }, [selectedWorkspaceTabIds, duplicateWorkspaceTab, clearWorkspaceTabSelection, showToast])

  const handleStartRenameTab = useCallback((tabId: string, currentName: string) => {
    setEditingTabId(tabId)
    setEditingName(currentName)
  }, [])

  const handleCommitRenameTab = useCallback(() => {
    if (!editingTabId) return
    const name = editingName.trim()
    if (!name) {
      showToast('名称不能为空', 'error')
      return
    }
    renameWorkspaceTab(editingTabId, name)
    setEditingTabId(null)
    setEditingName('')
    showToast('已重命名标签页', 'success')
  }, [editingTabId, editingName, renameWorkspaceTab, showToast])

  const handleStartRenameGroup = useCallback((groupId: string, currentName: string) => {
    setEditingGroupId(groupId)
    setEditingGroupName(currentName)
  }, [])

  const handleCommitRenameGroup = useCallback(() => {
    if (!editingGroupId) return
    const name = editingGroupName.trim()
    if (!name) {
      showToast('名称不能为空', 'error')
      return
    }
    renameWorkspaceTabGroup(editingGroupId, name)
    setEditingGroupId(null)
    setEditingGroupName('')
    showToast('分组已重命名', 'success')
  }, [editingGroupId, editingGroupName, renameWorkspaceTabGroup, showToast])

  const handleCreateGroup = useCallback(() => {
    setPromptInputDialog({
      title: '新建分组',
      label: '分组名称',
      placeholder: '输入分组名称',
      confirmText: '创建',
      action: (value) => {
        const name = value.trim()
        if (!name) {
          showToast('名称不能为空', 'error')
          return
        }
        createWorkspaceTabGroup(name)
        showToast('分组已创建', 'success')
      },
    })
  }, [setPromptInputDialog, createWorkspaceTabGroup, showToast])

  const handleDeleteGroup = useCallback(
    (groupId: string, groupName: string) => {
      setConfirmDialog({
        title: '删除分组',
        message: `确定要删除分组「${groupName}」吗？其中的标签页将变为未分组。`,
        confirmText: '删除',
        cancelText: '取消',
        tone: 'warning',
        action: () => {
          deleteWorkspaceTabGroup(groupId)
          showToast('分组已删除', 'success')
        },
      })
    },
    [deleteWorkspaceTabGroup, setConfirmDialog, showToast],
  )

  useCloseOnEscape(open, handleClose)
  usePreventBackgroundScroll(open, modalRef)
  useDialogFocusTrap(open, modalRef)

  if (!open) return null

  return (
    <div className="ds-modal-layer fixed inset-0 flex items-center justify-center">
      <div
        className="ds-modal-scrim absolute inset-0 animate-overlay-in motion-reduce:animate-none"
        onClick={handleClose}
      />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-tab-manager-title"
        className="ds-modal-surface relative w-full max-w-2xl max-h-[80vh] flex flex-col rounded-ds-lg border animate-modal-in motion-reduce:animate-none mx-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-ds-border">
          <h2 id="workspace-tab-manager-title" className="text-sm font-semibold">
            标签页管理
          </h2>
          <button
            onClick={handleClose}
            aria-label="关闭标签页管理"
            className="p-1 rounded hover:bg-ds-subtle text-ds-muted transition-colors"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-ds-border/60 flex-wrap">
          <div className="relative flex-1 min-w-[120px]">
            <svg
              className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ds-muted"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索标签页"
              className="w-full h-ds-control-sm pl-7 pr-2 text-xs rounded-md border border-ds-border bg-ds-subtle/40 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <button
            onClick={handleSelectAll}
            className="px-2 h-ds-control-sm text-xs rounded-md border border-ds-border hover:bg-ds-subtle transition-colors"
          >
            {selectedWorkspaceTabIds.length === workspaceTabs.length && workspaceTabs.length > 0 ? '取消全选' : '全选'}
          </button>
          <button
            onClick={handleBatchDuplicate}
            disabled={selectedWorkspaceTabIds.length === 0}
            className="px-2 h-ds-control-sm text-xs rounded-md border border-ds-border hover:bg-ds-subtle transition-colors disabled:opacity-40"
          >
            复制
          </button>
          <button
            onClick={handleBatchClose}
            disabled={selectedWorkspaceTabIds.length === 0}
            className="px-2 h-ds-control-sm text-xs rounded-md border border-ds-border hover:bg-ds-danger-subtle hover:text-ds-danger hover:border-ds-danger/35 transition-colors disabled:opacity-40"
          >
            关闭
          </button>
          <button
            onClick={handleBatchRun}
            disabled={selectedWorkspaceTabIds.length === 0}
            className="px-2 h-ds-control-sm text-xs rounded-md bg-ds-primary text-ds-text-inverse hover:bg-ds-primary/90 transition-colors disabled:opacity-40"
          >
            批量运行
          </button>
          <button
            onClick={handleCreateGroup}
            className="px-2 h-ds-control-sm text-xs rounded-md border border-ds-border hover:bg-ds-subtle transition-colors"
          >
            + 分组
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-2">
          {grouped.map(({ group, tabs }) => (
            <div key={group?.id ?? '__ungrouped__'} className="mb-3">
              {group && (
                <div className="flex items-center gap-2 px-2 py-1 mb-1">
                  {editingGroupId === group.id ? (
                    <input
                      autoFocus
                      value={editingGroupName}
                      onChange={(e) => setEditingGroupName(e.target.value)}
                      onBlur={handleCommitRenameGroup}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCommitRenameGroup()
                        if (e.key === 'Escape') {
                          setEditingGroupId(null)
                          setEditingGroupName('')
                        }
                      }}
                      className="flex-1 h-6 px-1.5 text-xs rounded border border-primary bg-ds-canvas focus:outline-none"
                    />
                  ) : (
                    <>
                      <span
                        className="text-xs font-semibold text-ds-muted uppercase tracking-wider cursor-pointer hover:text-ds-primary"
                        onClick={() => handleStartRenameGroup(group.id, group.name)}
                      >
                        {group.name}
                      </span>
                      <button
                        onClick={() => handleDeleteGroup(group.id, group.name)}
                        className="p-0.5 rounded hover:bg-ds-danger-subtle text-ds-muted hover:text-ds-danger transition-colors"
                        title="删除分组"
                      >
                        <TrashIcon className="w-3 h-3" />
                      </button>
                    </>
                  )}
                </div>
              )}
              <div className="space-y-1">
                {tabs.map((tab) => {
                  const isActive = tab.id === activeWorkspaceTabId
                  const isSelected = selectedWorkspaceTabIds.includes(tab.id)
                  return (
                    <div
                      key={tab.id}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md border transition-colors ${
                        isActive
                          ? 'border-primary bg-ds-primary/5'
                          : isSelected
                            ? 'border-primary/40 bg-ds-primary/5'
                            : 'border-transparent hover:bg-ds-subtle'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleWorkspaceTabSelection(tab.id)}
                        className="w-3.5 h-3.5 rounded border-ds-border accent-primary"
                      />
                      <button
                        onClick={() => setActiveWorkspaceTabId(tab.id)}
                        className="flex-1 text-left text-xs truncate"
                        title={tab.name}
                      >
                        {editingTabId === tab.id ? (
                          <input
                            autoFocus
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onBlur={handleCommitRenameTab}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleCommitRenameTab()
                              if (e.key === 'Escape') {
                                setEditingTabId(null)
                                setEditingName('')
                              }
                            }}
                            className="w-full h-6 px-1.5 text-xs rounded border border-primary bg-ds-canvas focus:outline-none"
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <span className={isActive ? 'font-semibold text-ds-primary' : ''}>{tab.name}</span>
                        )}
                      </button>
                      <span className="text-xs text-ds-muted whitespace-nowrap">
                        {tab.inputImages.length > 0 && `${tab.inputImages.length} 图`}
                        {tab.inputImageFolder && `${tab.inputImageFolder.imageIds.length} 图(夹)`}
                      </span>
                      <button
                        onClick={() => {
                          duplicateWorkspaceTab(tab.id)
                          showToast('已复制标签页', 'success')
                        }}
                        className="p-0.5 rounded hover:bg-ds-primary/10 text-ds-muted hover:text-ds-primary transition-colors"
                        title="复制"
                      >
                        <PlusIcon className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleStartRenameTab(tab.id, tab.name)}
                        className="p-0.5 rounded hover:bg-ds-primary/10 text-ds-muted hover:text-ds-primary transition-colors"
                        title="重命名"
                      >
                        <ExportIcon className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => {
                          closeWorkspaceTab(tab.id)
                          showToast('已关闭标签页', 'success')
                        }}
                        className="p-0.5 rounded hover:bg-ds-danger-subtle text-ds-muted hover:text-ds-danger transition-colors"
                        title="关闭"
                      >
                        <TrashIcon className="w-3 h-3" />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
          {filteredTabs.length === 0 && (
            <div className="py-8 text-xs text-ds-muted text-center">{searchQuery ? '无匹配标签页' : '暂无标签页'}</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-ds-border/60 text-xs text-ds-muted">
          <span>共 {workspaceTabs.length} 个标签页</span>
          <span>{selectedWorkspaceTabIds.length > 0 ? `已选 ${selectedWorkspaceTabIds.length} 个` : ''}</span>
        </div>
      </div>
    </div>
  )
}
