import { useEffect, useState, type KeyboardEvent } from 'react'
import { useStore } from '../store'
import type { WordLibraryEntry, WordLibraryGroup } from '../types'
import {
  Button,
  EmptyState,
  IconButton,
  SearchField,
  SegmentedControl,
  SparklesIcon,
  StarIcon,
  cx,
} from '../design-system'
import WordLibraryDerivativePanel, { parseWordLibraryEntryLines } from './WordLibraryDerivativePanel'

export type WordLibraryQuickView = 'recent' | 'favorites' | 'all'

interface FilterWordLibraryEntriesOptions {
  entries: WordLibraryEntry[]
  query: string
  view: WordLibraryQuickView
  groupId: string
  limit?: number
}

export function filterWordLibraryEntries({
  entries,
  query,
  view,
  groupId,
  limit = 20,
}: FilterWordLibraryEntriesOptions): WordLibraryEntry[] {
  const needle = query.trim().toLowerCase()
  const filtered = entries.filter(
    (entry) =>
      entry.deletedAt == null &&
      (groupId === '__all__' || entry.groupId === groupId) &&
      (view !== 'favorites' || entry.isFavorite) &&
      (!needle ||
        entry.key.toLowerCase().includes(needle) ||
        entry.entries.some((value) => value.toLowerCase().includes(needle)) ||
        entry.tags.some((tag) => tag.toLowerCase().includes(needle))),
  )

  filtered.sort((left, right) => {
    if (view === 'recent') return right.updatedAt - left.updatedAt
    if (left.isPinned !== right.isPinned) return left.isPinned ? -1 : 1
    if (view === 'favorites') return right.updatedAt - left.updatedAt
    return left.sortOrder - right.sortOrder || right.updatedAt - left.updatedAt
  })

  return view === 'recent' ? filtered.slice(0, limit) : filtered
}

interface WordLibraryQuickPanelProps {
  entries: WordLibraryEntry[]
  groups: WordLibraryGroup[]
  query: string
  view: WordLibraryQuickView
  groupId: string
  activeEntryId: string | null
  hasPromptSelection: boolean
  onQueryChange: (query: string) => void
  onViewChange: (view: WordLibraryQuickView) => void
  onGroupChange: (groupId: string) => void
  onSelect: (entryId: string) => void
  onInvoke: (entry: WordLibraryEntry) => void
  onSaveEntries: (entryId: string, entries: string[]) => void
  onToggleFavorite: (entryId: string) => void
  onManage: (entryId?: string) => void
}

export function WordLibraryQuickPanel({
  entries,
  groups,
  query,
  view,
  groupId,
  activeEntryId,
  hasPromptSelection,
  onQueryChange,
  onViewChange,
  onGroupChange,
  onSelect,
  onInvoke,
  onSaveEntries,
  onToggleFavorite,
  onManage,
}: WordLibraryQuickPanelProps) {
  const visibleEntries = filterWordLibraryEntries({ entries, query, view, groupId })
  const activeEntry = entries.find((entry) => entry.id === activeEntryId && entry.deletedAt == null) ?? null
  const groupById = new Map(groups.map((group) => [group.id, group]))
  const [derivativeOpen, setDerivativeOpen] = useState(false)
  const [draftValues, setDraftValues] = useState('')

  useEffect(() => {
    setDerivativeOpen(false)
    setDraftValues(activeEntry?.entries.join('\n') ?? '')
  }, [activeEntry?.id])

  const draftEntries = parseWordLibraryEntryLines(draftValues)
  const savedValues = activeEntry?.entries.join('\n') ?? ''
  const draftChanged = Boolean(activeEntry && draftValues !== savedValues)

  const moveSelection = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    if (!visibleEntries.length) return
    const currentIndex = visibleEntries.findIndex((entry) => entry.id === activeEntryId)
    const direction = event.key === 'ArrowDown' ? 1 : -1
    const nextIndex = currentIndex < 0 ? 0 : Math.max(0, Math.min(visibleEntries.length - 1, currentIndex + direction))
    onSelect(visibleEntries[nextIndex].id)
  }

  /** 词条列表内按空格用于滚动列表，不应触发浏览器默认的「激活聚焦按钮」，避免误选中词条。 */
  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === ' ') {
      event.preventDefault()
      return
    }
    moveSelection(event)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-2.5 border-b border-ds-border px-4 py-3">
        <SearchField
          label="搜索词条"
          placeholder="搜索名称、内容或标签"
          value={query}
          onChange={onQueryChange}
          onClear={() => onQueryChange('')}
        />
        <SegmentedControl
          aria-label="词条快捷视图"
          value={view}
          size="sm"
          className="w-full"
          options={[
            { value: 'recent', label: '最近' },
            { value: 'favorites', label: '收藏' },
            { value: 'all', label: '全部' },
          ]}
          onValueChange={onViewChange}
        />
        <label className="block">
          <span className="ds-sr-only">筛选分组</span>
          <select
            value={groupId}
            onChange={(event) => onGroupChange(event.target.value)}
            className="h-ds-control-md w-full rounded-md border border-ds-border bg-ds-canvas px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ds-focus"
          >
            <option value="__all__">全部分组</option>
            {groups
              .filter((group) => !group.archivedAt)
              .sort((left, right) => left.sortOrder - right.sortOrder)
              .map((group) => (
                <option key={group.id} value={group.id}>
                  {group.parentId ? '　' : ''}
                  {group.name}
                </option>
              ))}
          </select>
        </label>
      </div>

      <div
        className="doupao-side-panel__scroll min-h-0 flex-1 overflow-y-auto px-3 py-2"
        role="list"
        aria-label="词条列表"
        tabIndex={0}
        onKeyDown={handleListKeyDown}
      >
        {visibleEntries.map((entry) => {
          const selected = entry.id === activeEntryId
          const groupName = groupById.get(entry.groupId)?.name ?? '未分组'
          return (
            <div
              key={entry.id}
              id={`word-library-entry-${entry.id}`}
              role="listitem"
              aria-current={selected || undefined}
              className={cx(
                'word-entry-row group flex min-h-ds-52 items-center gap-2 rounded-lg px-2 py-1.5',
                selected && 'word-entry-row--checked',
              )}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
                onClick={() => onSelect(entry.id)}
                onKeyDown={(event) => {
                  // 空格在词条库用于滚动列表，不应触发「激活按钮→选中词条」
                  if (event.key === ' ') {
                    event.preventDefault()
                    event.stopPropagation()
                  }
                }}
              >
                <span className="word-entry-initial h-ds-control-sm w-ds-control-sm text-sm">
                  {entry.key.slice(0, 1) || '词'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ds-text">{entry.key}</span>
                  <span className="mt-0.5 block truncate text-xs text-ds-muted">
                    {groupName} · {entry.entries.length} 条
                  </span>
                </span>
              </button>
              <IconButton
                aria-label={entry.isFavorite ? `取消收藏 ${entry.key}` : `收藏 ${entry.key}`}
                aria-pressed={entry.isFavorite}
                size="sm"
                className={cx('shrink-0', entry.isFavorite && 'word-entry-action--active')}
                icon={<StarIcon className="h-4 w-4" fill={entry.isFavorite ? 'currentColor' : 'none'} />}
                onClick={() => {
                  onToggleFavorite(entry.id)
                  useStore
                    .getState()
                    .showToast(entry.isFavorite ? `已取消收藏「${entry.key}」` : `已收藏「${entry.key}」`, 'success')
                }}
              />
              <Button variant="ghost" size="sm" className="shrink-0" onClick={() => onInvoke(entry)}>
                {hasPromptSelection ? '替换' : '插入'}
              </Button>
            </div>
          )
        })}
        {visibleEntries.length === 0 && (
          <EmptyState
            className="word-library-empty"
            title={view === 'favorites' && !query ? '还没有收藏词条' : '没有匹配的词条'}
            description={
              view === 'favorites' && !query ? '在“最近”或“全部”中收藏常用词条。' : '调整搜索词或分组后再试。'
            }
            action={
              view === 'favorites' && !query ? (
                <Button size="sm" variant="secondary" onClick={() => onViewChange('all')}>
                  查看全部
                </Button>
              ) : undefined
            }
          />
        )}
      </div>

      <section
        className="doupao-side-panel__footer max-h-[68%] shrink-0 overflow-y-auto px-4 py-3"
        aria-label="当前词条预览"
      >
        {activeEntry ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ds-text">{activeEntry.key}</p>
                <p className="mt-0.5 text-xs text-ds-muted">
                  {groupById.get(activeEntry.groupId)?.name ?? '未分组'} · {activeEntry.entries.length} 个候选值
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 text-xs text-ds-primary hover:underline"
                onClick={() => onManage(activeEntry.id)}
              >
                编辑
              </button>
            </div>
            {!derivativeOpen && (
              <div className="mt-2 max-h-28 space-y-1 overflow-y-auto rounded-md border border-ds-border bg-ds-subtle/30 p-2">
                {activeEntry.entries.slice(0, 3).map((value, index) => (
                  <p key={`${value}-${index}`} className="break-words text-xs leading-5 text-ds-text">
                    {value}
                  </p>
                ))}
                {activeEntry.entries.length === 0 && <p className="text-xs text-ds-muted">这个词条还没有候选值。</p>}
                {activeEntry.entries.length > 3 && (
                  <p className="text-xs text-ds-muted">还有 {activeEntry.entries.length - 3} 条</p>
                )}
              </div>
            )}
            <div className="mt-3 grid grid-cols-[auto_1fr] gap-2">
              <Button
                variant="secondary"
                leadingIcon={<SparklesIcon className="h-4 w-4" />}
                aria-expanded={derivativeOpen}
                onClick={() => setDerivativeOpen((open) => !open)}
              >
                {derivativeOpen ? '收起 AI' : 'AI 衍生'}
              </Button>
              <Button onClick={() => onInvoke(activeEntry)}>
                {hasPromptSelection ? '替换选中内容' : '插入到提示词'}
              </Button>
            </div>
            {derivativeOpen && (
              <div className="mt-4 border-t border-ds-border pt-4">
                <label className="block text-xs text-ds-muted">
                  候选值草稿（每行一个）
                  <textarea
                    value={draftValues}
                    onChange={(event) => setDraftValues(event.target.value)}
                    className="mt-1 min-h-32 w-full resize-y rounded-md border border-ds-border bg-ds-canvas p-2 text-sm leading-6 text-ds-text"
                  />
                </label>
                <WordLibraryDerivativePanel
                  key={activeEntry.id}
                  entryKey={activeEntry.key}
                  draftValues={draftValues}
                  onDraftValuesChange={setDraftValues}
                />
                <div className="sticky bottom-0 -mx-4 border-t border-ds-border bg-ds-canvas px-4 py-3">
                  <Button
                    className="w-full"
                    disabled={!draftChanged}
                    onClick={() => onSaveEntries(activeEntry.id, draftEntries)}
                  >
                    {draftChanged ? `保存 ${draftEntries.length} 个候选值` : '候选值已保存'}
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="py-3 text-center text-xs text-ds-muted">选择词条后在这里预览对应词库。</div>
        )}
      </section>
    </div>
  )
}
