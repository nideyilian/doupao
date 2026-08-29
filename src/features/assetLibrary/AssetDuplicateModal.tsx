import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Button, Dialog, Slider } from '../../design-system'
import { CheckIcon, CopyIcon, TrashIcon } from '../../design-system/icons'
import { ensureImageThumbnailCached, subscribeImageThumbnail, useStore } from '../../store'
import type { GeneratedAsset } from '../../types'
import { useAssetLibraryStore } from './store'

interface DuplicateGroup {
  assets: GeneratedAsset[]
  avgHamming: number
}

const DEFAULT_THRESHOLD = 8
const MIN_THRESHOLD = 0
const MAX_THRESHOLD = 8

/** 把差异位阈值转成普通人能理解的相似档位（0 = 仅完全相同，8 = 略有相似也算重复）。 */
function similarityLabel(bits: number): string {
  if (bits <= 1) return '仅完全相同'
  if (bits <= 3) return '几乎相同'
  if (bits <= 5) return '大致相同'
  if (bits <= 7) return '明显相似'
  return '略有相似'
}

function GroupThumbnail({ asset }: { asset: GeneratedAsset }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let active = true
    const apply = (thumbnail: { dataUrl: string }) => {
      if (active) setSrc(thumbnail.dataUrl)
    }
    const unsubscribe = subscribeImageThumbnail(asset.imageId, apply)
    void ensureImageThumbnailCached(asset.imageId).then((thumbnail) => {
      if (thumbnail) apply(thumbnail)
    })
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [asset.imageId])
  return (
    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-ds-border">
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-ds-muted/20 text-ds-muted">
          <CopyIcon size={14} />
        </div>
      )}
    </div>
  )
}

const MemoizedGroupThumbnail = memo(GroupThumbnail)

export interface AssetDuplicateModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function AssetDuplicateModalInner({ onOpenChange, open }: AssetDuplicateModalProps) {
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [keepByGroup, setKeepByGroup] = useState<Record<string, string>>({})
  // 当前正在执行的处理操作：'single' = 单组移入回收站，'all' = 一键全部处理
  const [busyAction, setBusyAction] = useState<'single' | 'all' | null>(null)
  // 重复阈值：感知哈希 Hamming 差异 ≤ N bit（越小越严格；0 = 仅完全一致，8 = 最宽松）
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD)
  // 请求序号：丢弃过期响应（快速连滑时旧结果不得覆盖新结果）
  const requestSeqRef = useRef(0)
  // 防抖定时器：滑动只更新显示，停止 300ms 后才真正查重，避免拖动过程高频 IPC 卡顿
  const debounceRef = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    },
    [],
  )

  const runDetection = useCallback((bits: number) => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null
      const seq = ++requestSeqRef.current
      setLoading(true)
      setError(null)
      void window.electronAPI
        ?.assetCatalogNearDuplicates?.(bits)
        .then((items) => {
          if (seq !== requestSeqRef.current) return
          setGroups(items)
          const next: Record<string, string> = {}
          for (const group of items) next[group.assets[0]!.id] = group.assets[0]!.id
          setKeepByGroup(next)
        })
        .catch((err: unknown) => {
          if (seq !== requestSeqRef.current) return
          setError(err instanceof Error ? err.message : '查重失败')
        })
        .finally(() => {
          if (seq === requestSeqRef.current) setLoading(false)
        })
    }, 300)
  }, [])

  useEffect(() => {
    if (!open) return
    let active = true
    setGroups(null)
    setError(null)
    setLoading(true)
    setThreshold(DEFAULT_THRESHOLD)
    void window.electronAPI
      ?.assetCatalogNearDuplicates?.(DEFAULT_THRESHOLD)
      .then((items) => {
        if (!active) return
        setGroups(items)
        const next: Record<string, string> = {}
        for (const group of items) next[group.assets[0]!.id] = group.assets[0]!.id
        setKeepByGroup(next)
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : '查重失败')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [open])

  const trashOthers = async (group: DuplicateGroup, keepId: string) => {
    const others = group.assets.filter((asset) => asset.id !== keepId).map((asset) => asset.id)
    if (others.length === 0 || busyAction) return
    setBusyAction('single')
    try {
      await useAssetLibraryStore.getState().moveToTrash(others)
      setGroups((current) => current?.filter((item) => item !== group) ?? null)
      useStore.getState().showToast(`已将 ${others.length} 张重复素材移入回收站`, 'success')
    } catch {
      useStore.getState().showToast('移入回收站失败，请重试', 'error')
    } finally {
      setBusyAction(null)
    }
  }

  /** 一键批量：每组保留当前选中的一张，其余全部移入回收站。 */
  const trashAllOthers = async () => {
    if (!groups || groups.length === 0 || busyAction) return
    const toTrash: string[] = []
    for (const group of groups) {
      const keepId = keepByGroup[group.assets[0]!.id] ?? group.assets[0]!.id
      for (const asset of group.assets) {
        if (asset.id !== keepId) toTrash.push(asset.id)
      }
    }
    if (toTrash.length === 0) return
    setBusyAction('all')
    try {
      await useAssetLibraryStore.getState().moveToTrash(toTrash)
      setGroups(null)
      useStore.getState().showToast(`已将 ${toTrash.length} 张重复素材移入回收站`, 'success')
    } catch {
      useStore.getState().showToast('移入回收站失败，请重试', 'error')
    } finally {
      setBusyAction(null)
    }
  }

  const trashableCount = groups?.reduce((total, group) => total + Math.max(0, group.assets.length - 1), 0) ?? 0

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="重复素材检测"
      description={`按相似程度分组（当前：${similarityLabel(threshold)}）；每组保留一张，其余可一键移入回收站。`}
      size="lg"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          {/* 重复判定滑动条：向左更严格（仅完全相同才算重复），向右更宽松（略有相似也算） */}
          <Slider
            id="asset-duplicate-threshold"
            label="重复判定"
            valueDisplay={similarityLabel(threshold)}
            min={MIN_THRESHOLD}
            max={MAX_THRESHOLD}
            step={1}
            value={threshold}
            disabled={loading}
            aria-label="重复判定严格度"
            onChange={(next) => {
              setThreshold(next)
              void runDetection(next)
            }}
          />
          <div className="flex items-center gap-2">
            {groups !== null && groups.length > 0 && (
              <Button
                size="sm"
                variant="danger"
                leadingIcon={<TrashIcon size={12} />}
                loading={busyAction === 'all'}
                disabled={trashableCount === 0 || busyAction !== null}
                onClick={() => void trashAllOthers()}
              >
                全部处理（{trashableCount}）
              </Button>
            )}
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3" data-testid="asset-duplicates-modal">
        {/* 首次加载才显示提示；调节阈值重新查重时保留现有列表，避免界面跳动 */}
        {loading && groups === null && <p className="text-sm text-ds-muted">正在比对感知哈希…</p>}
        {error && <p className="text-sm text-ds-danger">{error}</p>}
        {groups !== null && !loading && groups.length === 0 && (
          <p className="text-sm text-ds-muted">未发现近似重复的素材。</p>
        )}
        {groups?.map((group, index) => {
          const keepId = keepByGroup[group.assets[0]!.id] ?? group.assets[0]!.id
          return (
            <div
              key={group.assets[0]!.id}
              className="rounded-lg border border-ds-border p-2"
              data-testid={`duplicate-group-${index}`}
            >
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-ds-muted">
                <span>
                  第 {index + 1} 组 · {group.assets.length} 张 · {similarityLabel(Math.round(group.avgHamming))}
                </span>
                <Button
                  size="sm"
                  variant="danger"
                  leadingIcon={<TrashIcon size={12} />}
                  loading={busyAction === 'single'}
                  disabled={group.assets.length <= 1 || busyAction !== null}
                  onClick={() => void trashOthers(group, keepId)}
                >
                  移入回收站
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {group.assets.map((asset) => {
                  const isKeep = asset.id === keepId
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      aria-pressed={isKeep}
                      aria-label={`保留 ${asset.origins[0]?.prompt || asset.id}`}
                      onClick={() => setKeepByGroup((current) => ({ ...current, [group.assets[0]!.id]: asset.id }))}
                      className={`relative rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ds-focus/70 ${
                        isKeep ? 'ring-2 ring-ds-focus ring-offset-1' : 'opacity-80 hover:opacity-100'
                      }`}
                    >
                      <MemoizedGroupThumbnail asset={asset} />
                      {isKeep && (
                        <span className="absolute right-1 top-1 rounded-full bg-ds-primary p-0.5 text-ds-text-inverse">
                          <CheckIcon size={10} />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </Dialog>
  )
}

export default memo(AssetDuplicateModalInner)
