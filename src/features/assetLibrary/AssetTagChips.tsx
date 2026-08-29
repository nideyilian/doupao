import { memo, useMemo, useRef, useState } from 'react'
import { PlusIcon, TagsIcon, XIcon } from '../../design-system/icons'
import { useStore } from '../../store'
import { useAssetLibraryStore } from './store'

/**
 * Eagle 式标签编辑器：当前标签 chip（可移除）+ 输入添加（自动补全已有标签，Enter 新建不存在标签）。
 * 供素材详情面板与查看器信息面板复用。
 */
function AssetTagChipsInner({ assetId }: { assetId: string }) {
  const asset = useAssetLibraryStore((state) => state.assetsById[assetId])
  const tags = useAssetLibraryStore((state) => state.tags)
  const patchAssets = useAssetLibraryStore((state) => state.patchAssets)
  const createTag = useAssetLibraryStore((state) => state.createTag)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const tagIds = asset?.tagIds ?? []
  const currentTags = useMemo(() => tags.filter((tag) => tagIds.includes(tag.id)), [tagIds, tags])
  const suggestions = useMemo(() => {
    const needle = draft.trim().toLocaleLowerCase('zh-CN')
    return tags
      .filter((tag) => !tagIds.includes(tag.id) && (!needle || tag.name.toLocaleLowerCase('zh-CN').includes(needle)))
      .slice(0, 8)
  }, [draft, tagIds, tags])

  const commitAdd = async (tagId: string) => {
    try {
      await patchAssets([assetId], { tagIds: [...tagIds, tagId] })
      setDraft('')
    } catch {
      useStore.getState().showToast('操作失败，请重试', 'error')
    }
  }

  const handleSubmit = async () => {
    const trimmed = draft.trim()
    if (!trimmed) {
      setAdding(false)
      return
    }
    try {
      const existing = tags.find((tag) => tag.normalizedName === trimmed.toLocaleLowerCase('zh-CN'))
      if (existing) {
        await commitAdd(existing.id)
        return
      }
      const created = await createTag(trimmed)
      if (created) {
        useStore.getState().showToast(`已创建标签「${created.name}」`, 'success')
        await commitAdd(created.id)
      }
    } catch {
      useStore.getState().showToast('操作失败，请重试', 'error')
    }
  }

  return (
    <div>
      <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-ds-muted">标签</h4>
      {currentTags.length === 0 && !adding && <p className="mb-1 text-xs text-ds-muted">暂无标签</p>}
      <div className="flex flex-wrap items-center gap-1">
        {currentTags.map((tag) => (
          <span
            key={tag.id}
            className="flex items-center gap-1 rounded-full border border-ds-border bg-ds-muted/10 py-0.5 pl-2 pr-1 text-xs"
          >
            {tag.color && (
              <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
            )}
            {tag.name}
            <button
              type="button"
              aria-label={`移除标签 ${tag.name}`}
              onClick={() =>
                void patchAssets([assetId], { tagIds: tagIds.filter((id) => id !== tag.id) }).catch(() =>
                  useStore.getState().showToast('操作失败，请重试', 'error'),
                )
              }
              className="grid h-4 w-4 place-items-center rounded-full text-ds-muted outline-none hover:bg-ds-muted/20 hover:text-ds-foreground focus-visible:ring-2 focus-visible:ring-ds-focus/70"
            >
              <XIcon size={10} />
            </button>
          </span>
        ))}
        {adding ? (
          <span className="relative inline-flex min-w-32 items-center">
            <TagsIcon size={12} className="pointer-events-none absolute left-2 text-ds-muted" />
            <input
              ref={inputRef}
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => {
                // 点击建议项时先提交再收起（建议项 onClick 会触发 mousedown 先于 blur）
                window.setTimeout(() => {
                  if (draft.trim()) void handleSubmit()
                  else setAdding(false)
                }, 120)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleSubmit()
                } else if (event.key === 'Escape') {
                  setDraft('')
                  setAdding(false)
                }
              }}
              placeholder="添加标签…"
              aria-label="添加标签"
              className="h-6 w-28 rounded-full border border-ds-primary bg-ds-surface pl-6 pr-2 text-xs text-ds-foreground outline-none placeholder:text-ds-muted"
            />
            {suggestions.length > 0 && (
              <span className="absolute left-0 top-7 z-30 w-40 overflow-hidden rounded-md border border-ds-border bg-ds-surface p-1 shadow-lg">
                {suggestions.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault() // 防止 blur 抢先关闭
                      void commitAdd(tag.id)
                      setAdding(false)
                    }}
                    className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-ds-foreground outline-none hover:bg-ds-muted/20"
                  >
                    {tag.color && (
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                    )}
                    <span className="truncate">{tag.name}</span>
                  </button>
                ))}
              </span>
            )}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex h-6 items-center gap-1 rounded-full border border-dashed border-ds-border px-2 text-xs text-ds-muted outline-none hover:border-ds-primary/50 hover:text-ds-primary focus-visible:ring-2 focus-visible:ring-ds-focus/70"
          >
            <PlusIcon size={11} /> 添加标签
          </button>
        )}
      </div>
    </div>
  )
}

export const AssetTagChips = memo(AssetTagChipsInner)
