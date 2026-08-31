import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { getUniqueWordLibraryEntryKey, useStore } from '../store'
import { createVariableMention, parseVariableMention, VAR_MENTION_RE } from '../lib/promptImageMentions'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { useDialogFocusTrap } from '../design-system'
import { useDragSelect, getMarqueeBoxStyle } from '../hooks/useDragSelect'

type View = 'library' | 'batches' | 'archived' | 'trash'

export default function WordLibraryManagerModal() {
  const open = useStore((s) => s.wordLibraryManagerOpen)
  const setOpen = useStore((s) => s.setWordLibraryManagerOpen)
  const groups = useStore((s) => s.wordLibraryGroups)
  const entries = useStore((s) => s.wordLibraryEntries)
  const batches = useStore((s) => s.wordGenerationBatches)
  const prompt = useStore((s) => s.prompt)
  const workspaceTabs = useStore((s) => s.workspaceTabs)
  const createGroup = useStore((s) => s.createWordLibraryGroup)
  const renameGroup = useStore((s) => s.renameWordLibraryGroup)
  const deleteGroup = useStore((s) => s.deleteWordLibraryGroup)
  const updateEntry = useStore((s) => s.updateWordLibraryEntry)
  const createEntry = useStore((s) => s.createWordLibraryEntry)
  const moveEntry = useStore((s) => s.moveWordLibraryEntry)
  const deleteEntry = useStore((s) => s.deleteWordLibraryEntry)
  const batchDeleteEntries = useStore((s) => s.batchDeleteWordLibraryEntries)
  const batchMoveEntries = useStore((s) => s.batchMoveWordLibraryEntries)
  const batchAddTags = useStore((s) => s.batchAddTagsToWordLibraryEntries)
  const duplicateEntries = useStore((s) => s.duplicateWordLibraryEntries)
  const batchPinEntries = useStore((s) => s.batchPinWordLibraryEntries)
  const mergeGroups = useStore((s) => s.mergeWordLibraryGroups)
  const archiveGroup = useStore((s) => s.archiveWordLibraryGroup)
  const archiveBatch = useStore((s) => s.archiveWordGenerationBatch)
  const setPrompt = useStore((s) => s.setPrompt)
  const toast = useStore((s) => s.showToast)
  const confirm = useStore((s) => s.setConfirmDialog)
  const requestedEntryId = useStore((s) => s.wordLibraryEditEntryId)
  const setRequestedEntryId = useStore((s) => s.setWordLibraryEditEntryId)
  const restoreEntries = useStore((s) => s.restoreWordLibraryEntries)
  const destroyEntries = useStore((s) => s.destroyWordLibraryEntries)
  const emptyTrash = useStore((s) => s.emptyWordLibraryTrash)
  const exportLibrary = useStore((s) => s.exportWordLibrary)
  const importLibrary = useStore((s) => s.importWordLibrary)

  const [view, setView] = useState<View>('library')
  const [groupId, setGroupId] = useState('__all__')
  const [entryId, setEntryId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [groupForm, setGroupForm] = useState<{ parentId: string | null; name: string } | null>(null)
  const [mergeTargetId, setMergeTargetId] = useState('')
  const [entryName, setEntryName] = useState('')
  const [entryValues, setEntryValues] = useState('')
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([])
  const [groupNameDraft, setGroupNameDraft] = useState('')
  const [batchTargetGroupId, setBatchTargetGroupId] = useState('')
  const [batchTags, setBatchTags] = useState('')
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null)
  const entryListRef = useRef<HTMLElement>(null)
  const modalRef = useRef<HTMLElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  // 词条列表框选：与素材库共用同一套交互（实时命中预览 / 容器自动滚动 / Esc 取消 / Shift 加选）
  const { selectionBox } = useDragSelect({
    containerSelector: '[data-drag-select-surface]',
    containerRef: entryListRef,
    itemSelector: '[data-entry-id]',
    getItemId: (element) => (element instanceof HTMLElement ? (element.dataset.entryId ?? null) : null),
    onSelectionChange: (ids) => setSelectedEntryIds(ids),
    initialSelectedIds: selectedEntryIds,
  })

  useEffect(() => {
    setGroupNameDraft('')
  }, [groupId])

  const activeEntries = useMemo(() => entries.filter((entry) => entry.deletedAt == null), [entries])
  const activeGroups = useMemo(() => groups.filter((group) => !group.archivedAt), [groups])
  const trashedEntries = useMemo(
    () => entries.filter((entry) => entry.deletedAt != null).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)),
    [entries],
  )
  const roots = useMemo(
    () => activeGroups.filter((group) => !group.parentId).sort((a, b) => a.sortOrder - b.sortOrder),
    [activeGroups],
  )
  const selectedGroup = activeGroups.find((group) => group.id === groupId) ?? null
  const activeEntry = activeEntries.find((entry) => entry.id === entryId) ?? null
  // 词条编辑草稿：名称或候选值相对已保存内容发生变化即视为有未保存修改（候选值按保存时的归一化方式比较）
  const entryDirty = Boolean(
    activeEntry &&
    (entryName.trim() !== activeEntry.key ||
      [
        ...new Set(
          entryValues
            .split('\n')
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ].join('\n') !== activeEntry.entries.join('\n')),
  )
  const referenceCounts = useMemo(() => {
    const result = new Map<string, number>()
    for (const source of [prompt, ...workspaceTabs.map((tab) => tab.prompt)]) {
      for (const match of source.matchAll(VAR_MENTION_RE)) {
        const entryId = parseVariableMention(match[1]).entryId
        if (entryId) result.set(entryId, (result.get(entryId) ?? 0) + 1)
      }
    }
    return result
  }, [prompt, workspaceTabs])
  const visibleGroupIds = useMemo(
    () =>
      groupId === '__all__'
        ? null
        : new Set([groupId, ...activeGroups.filter((group) => group.parentId === groupId).map((group) => group.id)]),
    [activeGroups, groupId],
  )
  const visibleEntries = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return activeEntries.filter(
      (entry) =>
        (!visibleGroupIds || visibleGroupIds.has(entry.groupId)) &&
        (!needle ||
          entry.key.toLowerCase().includes(needle) ||
          entry.entries.some((value) => value.toLowerCase().includes(needle)) ||
          entry.tags.some((tag) => tag.toLowerCase().includes(needle))),
    )
  }, [activeEntries, query, visibleGroupIds])

  const countGroup = (id: string) => activeEntries.filter((entry) => entry.groupId === id).length
  const selectEntry = (id: string) => {
    const entry = activeEntries.find((item) => item.id === id)
    if (!entry) return
    setEntryId(id)
    setEntryName(entry.key)
    setEntryValues(entry.entries.join('\n'))
  }
  useEffect(() => {
    if (!open || !requestedEntryId) return
    const entry = activeEntries.find((item) => item.id === requestedEntryId)
    if (entry) {
      setView('library')
      setGroupId('__all__')
      selectEntry(entry.id)
    }
    setRequestedEntryId(null)
  }, [activeEntries, open, requestedEntryId, setRequestedEntryId])
  const saveGroup = () => {
    if (!groupForm?.name.trim()) return
    const name = groupForm.name.trim()
    if (activeGroups.some((group) => group.name === name && (group.parentId ?? null) === groupForm.parentId))
      return toast('同一层级下已存在同名分组', 'error')
    const group = createGroup(name, groupForm.parentId)
    setGroupId(group.id)
    setGroupForm(null)
    toast('分组已创建', 'success')
  }
  const saveEntry = () => {
    if (!activeEntry || !entryName.trim()) return
    const uniqueKey = getUniqueWordLibraryEntryKey(entries, entryName.trim(), activeEntry.id)
    updateEntry(activeEntry.id, {
      key: uniqueKey,
      label: uniqueKey,
      entries: [
        ...new Set(
          entryValues
            .split('\n')
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ],
    })
    setEntryName(uniqueKey)
    toast('词条已保存', 'success')
  }
  const newEntry = () => {
    const target = groupId === '__all__' ? roots[0]?.id : groupId
    if (!target) return toast('请先创建分组', 'info')
    const entry = createEntry(target, '新词条')
    selectEntry(entry.id)
    toast('已新建词条「新词条」', 'success')
  }
  const requestDelete = () => {
    if (!activeEntry) return
    const references = referenceCounts.get(activeEntry.id) ?? 0
    confirm({
      title: references ? `该词条被 ${references} 处提示词引用` : '删除词条？',
      message: references ? '删除后会保留未绑定变量，无法再自动抽取。' : '词条会进入回收站。',
      confirmText: '删除',
      tone: 'danger',
      action: () => {
        deleteEntry(activeEntry.id)
        setEntryId(null)
        toast('词条已移入回收站', 'success')
      },
    })
  }
  const getRangeEntryIds = (fromId: string, toId: string) => {
    const ids = visibleEntries.map((entry) => entry.id)
    const from = ids.indexOf(fromId)
    const to = ids.indexOf(toId)
    if (from < 0 || to < 0) return [toId]
    return ids.slice(Math.min(from, to), Math.max(from, to) + 1)
  }
  const selectEntryWithModifiers = (id: string, event: Pick<MouseEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>) => {
    const additive = event.ctrlKey || event.metaKey
    if (event.shiftKey && selectionAnchorId) {
      const range = getRangeEntryIds(selectionAnchorId, id)
      setSelectedEntryIds((ids) => (additive ? [...new Set([...ids, ...range])] : range))
    } else if (additive) {
      setSelectedEntryIds((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]))
      setSelectionAnchorId(id)
    } else {
      setSelectedEntryIds([id])
      setSelectionAnchorId(id)
    }
    selectEntry(id)
  }
  const clearEntrySelection = () => {
    setSelectedEntryIds([])
    setSelectionAnchorId(null)
  }
  const selectVisibleEntries = () => {
    setSelectedEntryIds(visibleEntries.map((entry) => entry.id))
    setSelectionAnchorId(visibleEntries[0]?.id ?? null)
  }
  const requestBatchDelete = () => {
    if (!selectedEntryIds.length) return
    confirm({
      title: `删除 ${selectedEntryIds.length} 个词条？`,
      message: '词条会移入回收站，可在词条库中恢复。',
      confirmText: '删除',
      tone: 'danger',
      action: () => {
        batchDeleteEntries(selectedEntryIds)
        clearEntrySelection()
        setEntryId(null)
        toast('词条已移入回收站', 'success')
      },
    })
  }
  const applyBatchMove = () => {
    if (!selectedEntryIds.length || !batchTargetGroupId) return
    batchMoveEntries(selectedEntryIds, batchTargetGroupId)
    clearEntrySelection()
    toast('词条已移动', 'success')
  }
  const applyBatchTags = () => {
    const tags = batchTags
      .split(/[,，\n]/)
      .map((tag) => tag.trim())
      .filter(Boolean)
    if (!selectedEntryIds.length || !tags.length) return
    batchAddTags(selectedEntryIds, tags)
    setBatchTags('')
    toast('标签已添加', 'success')
  }
  const applyBatchDuplicate = () => {
    if (!selectedEntryIds.length) return
    const count = duplicateEntries(selectedEntryIds)
    clearEntrySelection()
    toast(`已复制 ${count} 个词条`, 'success')
  }
  const applyBatchPin = () => {
    if (!selectedEntryIds.length) return
    batchPinEntries(selectedEntryIds)
    clearEntrySelection()
    toast('词条已置顶', 'success')
  }
  const requestDeleteGroup = () => {
    if (!selectedGroup) return
    if (activeGroups.length <= 1) return toast('至少保留一个词条组', 'info')
    const entryCount = countGroup(selectedGroup.id)
    const target =
      activeGroups.find((group) => group.id !== selectedGroup.id && group.name === '默认分组') ??
      activeGroups.find((group) => group.id !== selectedGroup.id)
    if (!target) return
    confirm({
      title: `删除分组「${selectedGroup.name}」？`,
      message: entryCount
        ? `其中 ${entryCount} 个词条会移动到「${target.name}」，子分组将转为顶级分组。`
        : '子分组将转为顶级分组。',
      confirmText: '删除分组',
      tone: 'danger',
      action: () => {
        deleteGroup(selectedGroup.id)
        setGroupId(target.id)
        setGroupNameDraft('')
        toast('分组已删除，词条已迁移', 'success')
      },
    })
  }
  const handleExport = () => {
    const data = exportLibrary()
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `word-library-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
    toast('词条库已导出', 'success')
  }
  const handleImport = async (file: File | undefined) => {
    if (!file) return
    try {
      const result = importLibrary(JSON.parse(await file.text()), 'merge')
      toast(`已导入 ${result.added} 个新词条，更新 ${result.updated} 个词条`, 'success')
    } catch {
      toast('导入失败：文件格式不正确', 'error')
    } finally {
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  const entryById = useMemo(() => new Map(activeEntries.map((entry) => [entry.id, entry])), [activeEntries])
  const activeBatches = useMemo(() => batches.filter((batch) => !batch.archivedAt), [batches])
  const handleViewTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentView: View) => {
    const views: View[] = ['library', 'batches', 'archived', 'trash']
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const currentIndex = views.indexOf(currentView)
    const nextView =
      event.key === 'Home'
        ? views[0]
        : event.key === 'End'
          ? views[views.length - 1]
          : views[(currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + views.length) % views.length]
    setView(nextView)
    window.requestAnimationFrame(() =>
      modalRef.current?.querySelector<HTMLElement>(`[data-word-library-view="${nextView}"]`)?.focus(),
    )
  }

  // Esc 关闭带未保存保护：词条编辑有改动时先确认，避免直接丢失修改
  const closeWithUnsavedProtection = () => {
    if (entryDirty) {
      confirm({
        title: '放弃未保存的修改？',
        message: '当前词条的修改尚未保存，关闭将丢失这些修改。',
        confirmText: '放弃修改',
        tone: 'warning',
        action: () => setOpen(false),
      })
      return
    }
    setOpen(false)
  }
  useCloseOnEscape(open, closeWithUnsavedProtection)
  usePreventBackgroundScroll(open, modalRef)
  useDialogFocusTrap(open, modalRef)

  // Delete/Backspace：删除选中的词条（与「删除」按钮同一确认流程；仅词条库视图生效）
  useEffect(() => {
    if (!open || view !== 'library') return
    const handleDeleteShortcut = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey) return
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      const target = event.target as HTMLElement | null
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]')) return
      if (selectedEntryIds.length === 0) return
      event.preventDefault()
      requestBatchDelete()
    }
    window.addEventListener('keydown', handleDeleteShortcut)
    return () => window.removeEventListener('keydown', handleDeleteShortcut)
  })

  if (!open) return null

  return (
    <div
      className="ds-modal-layer fixed inset-0 flex items-center justify-center p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false)
      }}
    >
      <div className="ds-modal-scrim pointer-events-none absolute inset-0" />
      <section
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="word-library-manager-title"
        className="ds-modal-surface relative z-10 flex h-[min(820px,92vh)] w-[min(1320px,96vw)] flex-col overflow-hidden rounded-ds-lg border"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-ds-border px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 id="word-library-manager-title" className="text-base font-semibold">
              词条管理
            </h2>
            <p className="text-xs text-ds-muted">
              {activeEntries.length} 个词条 · {activeGroups.length} 个分组
            </p>
          </div>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => void handleImport(event.target.files?.[0])}
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索词条、内容或标签"
            className="h-ds-control-md w-64 rounded-md border border-ds-border bg-ds-subtle/30 px-3 text-sm outline-none"
          />
          <button
            type="button"
            onClick={handleExport}
            className="h-ds-control-md rounded-md border border-ds-border px-3 text-sm hover:bg-ds-subtle"
          >
            导出
          </button>
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className="h-ds-control-md rounded-md border border-ds-border px-3 text-sm hover:bg-ds-subtle"
          >
            导入
          </button>
          <button
            type="button"
            onClick={newEntry}
            className="h-ds-control-md rounded-md bg-ds-primary px-3 text-sm font-medium text-ds-text-inverse"
          >
            新建词条
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="h-ds-control-md w-ds-control-md rounded-md text-xl hover:bg-ds-subtle"
            aria-label="关闭"
          >
            ×
          </button>
        </header>
        <nav
          role="tablist"
          aria-label="词条管理视图"
          className="flex shrink-0 gap-2 border-b border-ds-border px-5 py-2 text-xs"
        >
          {(
            [
              ['library', '词条库'],
              ['batches', `技能批次 ${batches.filter((batch) => !batch.archivedAt).length}`],
              ['archived', '已归档'],
              ['trash', `回收站 ${trashedEntries.length}`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              tabIndex={view === id ? 0 : -1}
              data-word-library-view={id}
              onKeyDown={(event) => handleViewTabKeyDown(event, id)}
              onClick={() => setView(id)}
              className={`rounded-md px-2.5 py-1.5 ${view === id ? 'bg-ds-primary/15 text-ds-primary dark:text-ds-primary' : 'hover:bg-ds-subtle'}`}
            >
              {label}
            </button>
          ))}
        </nav>
        {view === 'batches' && (
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {activeBatches.map((batch) => (
              <article key={batch.id} className="mb-2 rounded-md border border-ds-border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium">{batch.skillName}</h3>
                    <p className="mt-1 text-xs text-ds-muted">
                      {new Date(batch.createdAt).toLocaleString()} · {batch.entryIds.length} 个词条 ·{' '}
                      {batch.referenceImageIds.length} 张参考图
                    </p>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-ds-muted">
                      {batch.sourcePrompt || '无原始提示词'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      archiveBatch(batch.id)
                      toast('批次已归档', 'info')
                    }}
                    className="shrink-0 text-xs text-ds-muted hover:text-ds-text"
                  >
                    归档
                  </button>
                </div>
              </article>
            ))}
            {activeBatches.length === 0 && <Empty text="暂无技能生成批次" />}
          </div>
        )}
        {view === 'archived' && (
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <h3 className="mb-3 text-sm font-medium">已归档分组与批次</h3>
            {groups
              .filter((group) => group.archivedAt)
              .map((group) => (
                <div key={group.id} className="mb-2 flex items-center rounded-md border border-ds-border p-3 text-sm">
                  <span className="flex-1">{group.name}</span>
                  <button
                    type="button"
                    onClick={() => {
                      archiveGroup(group.id, false)
                      toast('分组已恢复', 'success')
                    }}
                    className="text-xs text-ds-primary"
                  >
                    恢复
                  </button>
                </div>
              ))}
            {batches
              .filter((batch) => batch.archivedAt)
              .map((batch) => (
                <div key={batch.id} className="mb-2 flex items-center rounded-md border border-ds-border p-3 text-sm">
                  <span className="flex-1">
                    {batch.skillName} · {new Date(batch.createdAt).toLocaleDateString()}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      archiveBatch(batch.id, false)
                      toast('批次已恢复', 'success')
                    }}
                    className="text-xs text-ds-primary"
                  >
                    恢复
                  </button>
                </div>
              ))}
            {groups.every((group) => !group.archivedAt) && batches.every((batch) => !batch.archivedAt) && (
              <Empty text="暂无已归档内容" />
            )}
          </div>
        )}
        {view === 'trash' && (
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium">回收站</h3>
                <p className="mt-1 text-xs text-ds-muted">恢复误删词条，或永久清理不再需要的内容。</p>
              </div>
              {trashedEntries.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    confirm({
                      title: '清空回收站？',
                      message: '所有回收站词条将被永久删除，无法恢复。',
                      confirmText: '永久删除',
                      tone: 'danger',
                      action: () => {
                        emptyTrash()
                        toast('回收站已清空', 'success')
                      },
                    })
                  }
                  className="text-xs text-ds-danger"
                >
                  清空回收站
                </button>
              )}
            </div>
            {trashedEntries.map((entry) => (
              <div key={entry.id} className="mb-2 flex items-center gap-3 rounded-md border border-ds-border p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{entry.key}</p>
                  <p className="mt-1 text-xs text-ds-muted">
                    {entry.entries.length} 个候选值 · 删除于 {new Date(entry.deletedAt ?? 0).toLocaleString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    restoreEntries([entry.id])
                    toast('词条已恢复', 'success')
                  }}
                  className="text-xs text-ds-primary"
                >
                  恢复
                </button>
                <button
                  type="button"
                  onClick={() =>
                    confirm({
                      title: `永久删除「${entry.key}」？`,
                      message: '永久删除后无法恢复。',
                      confirmText: '永久删除',
                      tone: 'danger',
                      action: () => {
                        destroyEntries([entry.id])
                        toast('词条已永久删除', 'success')
                      },
                    })
                  }
                  className="text-xs text-ds-danger"
                >
                  永久删除
                </button>
              </div>
            ))}
            {trashedEntries.length === 0 && <Empty text="回收站为空" />}
          </div>
        )}
        {view === 'library' && (
          <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(360px,1fr)_340px]">
            <aside className="overflow-y-auto border-r border-ds-border p-3">
              <button
                type="button"
                onClick={() => setGroupId('__all__')}
                className={`mb-2 w-full rounded-md px-3 py-2 text-left text-sm ${groupId === '__all__' ? 'bg-ds-primary/15 text-ds-primary' : 'hover:bg-ds-subtle'}`}
              >
                全部词条 <span className="float-right text-xs text-ds-muted">{activeEntries.length}</span>
              </button>
              <div className="mb-2 flex items-center justify-between px-2 text-xs text-ds-muted">
                <span>分组</span>
                <button
                  type="button"
                  onClick={() => setGroupForm({ parentId: null, name: '' })}
                  className="text-ds-primary"
                >
                  新建
                </button>
              </div>
              {groupForm && (
                <div className="mb-2 rounded-md border border-ds-border p-2">
                  <input
                    autoFocus
                    value={groupForm.name}
                    onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })}
                    placeholder="分组名称"
                    className="h-ds-control-sm w-full rounded border border-ds-border bg-ds-subtle/30 px-2 text-sm"
                  />
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={saveGroup} className="text-xs text-ds-primary">
                      创建
                    </button>
                    <button type="button" onClick={() => setGroupForm(null)} className="text-xs text-ds-muted">
                      取消
                    </button>
                  </div>
                </div>
              )}
              {roots.map((root) => (
                <div key={root.id} className="mb-1">
                  <div
                    className={`group flex rounded-md ${groupId === root.id ? 'bg-ds-primary/15 text-ds-primary' : 'hover:bg-ds-subtle'}`}
                  >
                    <button
                      type="button"
                      onClick={() => setGroupId(root.id)}
                      className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm"
                    >
                      {root.name}
                      <span className="ml-2 text-xs text-ds-muted">{countGroup(root.id)}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setGroupForm({ parentId: root.id, name: '' })}
                      className="mr-1 hidden h-ds-control-sm w-ds-control-sm group-hover:block"
                      title="新建子分组"
                    >
                      +
                    </button>
                  </div>
                  {activeGroups
                    .filter((group) => group.parentId === root.id)
                    .map((child) => (
                      <button
                        key={child.id}
                        type="button"
                        onClick={() => setGroupId(child.id)}
                        className={`ml-4 flex w-[calc(100%-1rem)] rounded-md px-3 py-1.5 text-left text-sm ${groupId === child.id ? 'bg-ds-primary/15 text-ds-primary' : 'hover:bg-ds-subtle'}`}
                      >
                        └ {child.name}
                        <span className="ml-auto text-xs text-ds-muted">{countGroup(child.id)}</span>
                      </button>
                    ))}
                </div>
              ))}
            </aside>
            <main ref={entryListRef} data-drag-select-surface className="relative select-none overflow-y-auto p-3">
              {selectedGroup && (
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-ds-border bg-ds-subtle/30 p-2 text-xs">
                  <input
                    value={groupNameDraft || selectedGroup.name}
                    onChange={(event) => setGroupNameDraft(event.target.value)}
                    className="h-ds-control-sm min-w-28 flex-1 rounded border border-ds-border bg-ds-canvas px-2"
                    aria-label="分组名称"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const name = (groupNameDraft || selectedGroup.name).trim()
                      if (!name) return
                      renameGroup(selectedGroup.id, name)
                      setGroupNameDraft('')
                      toast('分组已重命名', 'success')
                    }}
                    className="rounded border border-ds-border px-2 py-1"
                  >
                    重命名
                  </button>
                  <select
                    value={mergeTargetId}
                    onChange={(event) => setMergeTargetId(event.target.value)}
                    className="h-ds-control-sm max-w-32 rounded border border-ds-border bg-ds-canvas px-1"
                  >
                    <option value="">合并到…</option>
                    {activeGroups
                      .filter((group) => group.id !== selectedGroup.id)
                      .map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    disabled={!mergeTargetId}
                    onClick={() => {
                      mergeGroups(selectedGroup.id, mergeTargetId)
                      setGroupId(mergeTargetId)
                      setMergeTargetId('')
                      toast('分组已合并', 'success')
                    }}
                    className="rounded border border-ds-border px-2 py-1 disabled:opacity-40"
                  >
                    合并
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      archiveGroup(selectedGroup.id)
                      setGroupId('__all__')
                      toast('分组已归档', 'success')
                    }}
                    className="rounded border border-ds-border px-2 py-1"
                  >
                    归档
                  </button>
                  <button
                    type="button"
                    onClick={requestDeleteGroup}
                    className="rounded border border-ds-danger/40 px-2 py-1 text-ds-danger disabled:opacity-40"
                    disabled={activeGroups.length <= 1}
                  >
                    删除
                  </button>
                </div>
              )}
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium">{selectedGroup?.name ?? '全部词条'}</span>
                <span className="text-ds-muted">{visibleEntries.length} 条</span>
              </div>
              <div className="mb-3 rounded-md border border-ds-border bg-ds-subtle/20 p-2 text-xs">
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={
                        visibleEntries.length > 0 &&
                        visibleEntries.every((entry) => selectedEntryIds.includes(entry.id))
                      }
                      onChange={(event) => (event.target.checked ? selectVisibleEntries() : clearEntrySelection())}
                    />{' '}
                    全选当前结果
                  </label>
                  <span className="text-ds-muted">已选 {selectedEntryIds.length} 条</span>
                  {selectedEntryIds.length > 0 && (
                    <button
                      type="button"
                      onClick={clearEntrySelection}
                      className="ml-auto text-ds-muted hover:text-ds-text"
                    >
                      取消选择
                    </button>
                  )}
                </div>
                <p className="mt-1 text-ds-muted">
                  单击选择；Ctrl/⌘ 切换选择；Shift 连续多选；在列表空白区域拖拽可框选。
                </p>
                {selectedEntryIds.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select
                      value={batchTargetGroupId}
                      onChange={(event) => setBatchTargetGroupId(event.target.value)}
                      className="h-ds-control-sm rounded border border-ds-border bg-ds-canvas px-1"
                    >
                      <option value="">移动到分组…</option>
                      {activeGroups.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!batchTargetGroupId}
                      onClick={applyBatchMove}
                      className="rounded border border-ds-border px-2 py-1 disabled:opacity-40"
                    >
                      移动
                    </button>
                    <input
                      value={batchTags}
                      onChange={(event) => setBatchTags(event.target.value)}
                      placeholder="标签，逗号分隔"
                      className="h-ds-control-sm w-28 rounded border border-ds-border bg-ds-canvas px-2"
                    />
                    <button
                      type="button"
                      onClick={applyBatchTags}
                      className="rounded border border-ds-border px-2 py-1"
                    >
                      加标签
                    </button>
                    <button type="button" onClick={applyBatchPin} className="rounded border border-ds-border px-2 py-1">
                      置顶
                    </button>
                    <button
                      type="button"
                      onClick={applyBatchDuplicate}
                      className="rounded border border-ds-border px-2 py-1"
                    >
                      复制
                    </button>
                    <button
                      type="button"
                      onClick={requestBatchDelete}
                      className="rounded border border-ds-danger/40 px-2 py-1 text-ds-danger"
                    >
                      删除
                    </button>
                  </div>
                )}
              </div>
              {visibleEntries.map((entry) => (
                <div
                  key={entry.id}
                  data-entry-id={entry.id}
                  className={`mb-1.5 flex w-full items-center gap-2 rounded-md border p-3 text-left ${selectedEntryIds.includes(entry.id) ? 'border-ds-primary/60 bg-ds-primary/10' : entry.id === entryId ? 'border-ds-primary/50 bg-ds-primary/10' : 'border-ds-border hover:bg-ds-subtle/50'}`}
                >
                  <input
                    type="checkbox"
                    checked={selectedEntryIds.includes(entry.id)}
                    onClick={(event) => {
                      event.stopPropagation()
                      selectEntryWithModifiers(entry.id, event)
                    }}
                    onChange={() => undefined}
                    aria-label={`选择词条 ${entry.key}`}
                  />
                  <button
                    type="button"
                    onClick={(event) => selectEntryWithModifiers(entry.id, event)}
                    className="flex min-w-0 flex-1 items-center text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{entry.key}</span>
                      <span className="mt-1 block truncate text-xs text-ds-muted">
                        {activeGroups.find((group) => group.id === entry.groupId)?.name ?? '未分组'} ·{' '}
                        {entry.entries.length} 个候选值 · 引用 {referenceCounts.get(entry.id) ?? 0}
                      </span>
                    </span>
                    <span className="text-xs text-ds-muted">使用 {entry.usageCount}</span>
                  </button>
                </div>
              ))}
              {selectionBox && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute z-10 border border-ds-selection-border bg-ds-selection/60"
                  style={getMarqueeBoxStyle(selectionBox, entryListRef.current)}
                />
              )}
              {visibleEntries.length === 0 && <Empty text="没有匹配的词条" />}
            </main>
            <aside className="overflow-y-auto border-l border-ds-border p-4">
              {activeEntry ? (
                <>
                  <div className="mb-3 flex justify-between">
                    <span className="text-sm font-medium">词条详情</span>
                    <button type="button" onClick={requestDelete} className="text-xs text-ds-danger">
                      删除
                    </button>
                  </div>
                  <div className="mb-3 rounded-md bg-ds-subtle/50 px-2.5 py-2 text-xs text-ds-muted">
                    引用 {referenceCounts.get(activeEntry.id) ?? 0} 处 · 来源 {activeEntry.sourceSkillName ?? '手动'}
                  </div>
                  <label className="mb-3 block text-xs text-ds-muted">
                    移动到分组
                    <select
                      value={activeEntry.groupId}
                      onChange={(event) => {
                        moveEntry(activeEntry.id, event.target.value)
                        const targetGroup = activeGroups.find((group) => group.id === event.target.value)
                        toast(`词条已移动到「${targetGroup?.name ?? ''}」`, 'success')
                      }}
                      className="mt-1 h-ds-control-md w-full rounded-md border border-ds-border bg-ds-subtle/30 px-2 text-sm text-ds-text"
                    >
                      {activeGroups.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="mb-3 block text-xs text-ds-muted">
                    名称
                    <input
                      value={entryName}
                      onChange={(event) => setEntryName(event.target.value)}
                      className="mt-1 h-ds-control-md w-full rounded-md border border-ds-border bg-ds-subtle/30 px-2 text-sm text-ds-text"
                    />
                  </label>
                  <label className="block text-xs text-ds-muted">
                    候选值（每行一个）
                    <textarea
                      value={entryValues}
                      onChange={(event) => setEntryValues(event.target.value)}
                      className="mt-1 h-56 w-full resize-y rounded-md border border-ds-border bg-ds-subtle/30 p-2 text-sm leading-6 text-ds-text"
                    />
                  </label>
                  <div className="sticky bottom-0 mt-3 flex gap-2 border-t border-ds-border bg-ds-canvas py-3">
                    <button
                      type="button"
                      onClick={() => {
                        setPrompt(`${prompt}${createVariableMention(activeEntry.key, activeEntry.id)}`)
                        toast('已插入词条变量', 'success')
                      }}
                      className="h-ds-control-md rounded-md border border-ds-border px-3 text-sm"
                    >
                      插入
                    </button>
                    <button
                      type="button"
                      onClick={saveEntry}
                      className="h-ds-control-md flex-1 rounded-md bg-ds-primary px-3 text-sm text-ds-text-inverse"
                    >
                      保存
                    </button>
                  </div>
                </>
              ) : (
                <Empty text="选择词条后可编辑" />
              )}
            </aside>
          </div>
        )}
      </section>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="py-16 text-center text-sm text-ds-muted">{text}</div>
}
