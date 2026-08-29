import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { AssetRating, GeneratedAsset, StoredImage } from '../../types'
import { ensureImageCached, ensureImageThumbnailCached, subscribeImageThumbnail, useStore } from '../../store'
import { getImage } from '../../lib/db'
import { isElectron, openInExplorer } from '../../lib/localSave'
import { findTaskSavedImagePath, resolveImageRevealPath } from '../../lib/imageRevealPath'
import { IconButton, Tooltip } from '../../design-system'
import {
  BookOpenCheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  ImageIcon,
  ImagePlusIcon,
  StarIcon,
  TrashIcon,
  Wand2Icon,
  WrenchIcon,
  XIcon,
} from '../../design-system/icons'
import { assetCommands } from '../../lib/assetCommands'
import { useAssetLibraryStore } from './store'
import { useRequirementPrototype } from '../requirementPrototype/store'
import AssetParamBreakdown from './AssetParamBreakdown'

function formatBytes(value?: number) {
  if (!value) return '—'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function RatingStars({ assetId, value }: { assetId: string; value: number }) {
  return (
    <div role="radiogroup" aria-label="评分" className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((rating) => (
        <button
          key={rating}
          type="button"
          role="radio"
          aria-checked={value === rating}
          aria-label={`${rating} 星`}
          className="flex min-h-ds-control-lg min-w-11 items-center justify-center text-ds-muted hover:text-ds-warning"
          onClick={() =>
            void assetCommands
              .patchAssets([assetId], { rating: (value === rating ? 0 : rating) as AssetRating })
              .catch(() => useStore.getState().showToast('操作失败，请重试', 'error'))
          }
        >
          <StarIcon
            size={16}
            fill={rating <= value ? 'currentColor' : 'none'}
            className={rating <= value ? 'text-ds-warning' : ''}
          />
        </button>
      ))}
    </div>
  )
}

/** 素材注释编辑（防抖保存到 notes 字段，参与全文检索）。 */
export function NotesEditor({ assetId, value }: { assetId: string; value: string }) {
  const [draft, setDraft] = useState(value)
  const [saved, setSaved] = useState(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setDraft(value)
    setSaved(true)
  }, [value])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  const commit = (next: string) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const trimmed = next.trim()
    if (trimmed === value) {
      setSaved(true)
      return
    }
    setSaved(false)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void assetCommands
        .patchAssets([assetId], { notes: trimmed || undefined })
        .then(() => setSaved(true))
        .catch(() => {
          setSaved(true)
          useStore.getState().showToast('注释保存失败', 'error')
        })
    }, 600)
  }

  return (
    <section className="mt-4">
      <h3 className="mb-1 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-ds-muted">
        <span>注释</span>
        {!saved && <span className="normal-case text-ds-muted/70">保存中…</span>}
      </h3>
      <textarea
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          commit(event.target.value)
        }}
        rows={3}
        placeholder="记录这张素材的用途、备注…（可被搜索）"
        aria-label="素材注释"
        className="w-full resize-y rounded-md border border-ds-border bg-ds-surface px-2 py-1.5 text-xs leading-5 text-ds-foreground outline-none placeholder:text-ds-muted focus:border-ds-primary"
      />
    </section>
  )
}

export interface AssetDetailPanelProps {
  embedded?: boolean
  /** 连续浏览：上一张 / 下一张（按当前查询结果） */
  onPrev?: () => void
  onNext?: () => void
  /** 请求打开永久删除确认弹窗（展示引用冲突） */
  onPurgeRequest?: (assetIds: string[]) => void
}

function AssetDetailPanelInner({ embedded = false, onNext, onPrev, onPurgeRequest }: AssetDetailPanelProps) {
  const asset = useAssetLibraryStore((state) =>
    state.activeAssetId ? state.assetsById[state.activeAssetId] : undefined,
  )
  const setDetailOpen = useAssetLibraryStore((state) => state.setDetailOpen)
  const collections = useAssetLibraryStore((state) => state.collections)
  const tasks = useStore((state) => state.tasks)
  const [fullImageSrc, setFullImageSrc] = useState('')
  const [storedImage, setStoredImage] = useState<StoredImage | undefined>()

  useEffect(() => {
    if (!asset) return
    let cancelled = false
    setFullImageSrc('')
    Promise.all([ensureImageCached(asset.imageId), getImage(asset.imageId)])
      .then(([dataUrl, image]) => {
        if (cancelled) return
        if (dataUrl) setFullImageSrc(dataUrl)
        setStoredImage(image)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [asset?.imageId])

  const primaryOrigin = useMemo(() => {
    if (!asset) return undefined
    return asset.origins.find((origin) => origin.key === asset.primaryOriginKey) ?? asset.origins[0]
  }, [asset])
  const sourceTask = useMemo(
    () => tasks.find((task) => task.id === primaryOrigin?.taskId),
    [primaryOrigin?.taskId, tasks],
  )
  // 来源 SOP：任务级 sopBatch 记录（sopId/sopName）；SOP 可能已从库中删除
  const sopItems = useRequirementPrototype((state) => state.sopLibrary)
  const sourceSop = useMemo(() => {
    const sopId = sourceTask?.sopBatch?.sopId
    if (!sopId) return undefined
    return sopItems.find((item) => item.id === sopId)
  }, [sourceTask?.sopBatch?.sopId, sopItems])
  // 该素材是否有「树状工作区」目录中的落盘副本（images/分组/标签页/...，硬链接）
  const hasSavedTreePath = useMemo(
    () => (asset ? Boolean(findTaskSavedImagePath(tasks, asset.imageId)) : false),
    [asset, tasks],
  )

  if (!asset) return null

  const toggleCollection = (collectionId: string) => {
    const next = asset.collectionIds.includes(collectionId)
      ? asset.collectionIds.filter((id) => id !== collectionId)
      : [...asset.collectionIds, collectionId]
    void assetCommands
      .patchAssets([asset.id], { collectionIds: next })
      .catch(() => useStore.getState().showToast('操作失败，请重试', 'error'))
  }

  const handleOpenFileLocation = async () => {
    if (!asset) return
    // 优先打开树状工作区目录中的落盘副本（images/分组/标签页/...，硬链接），
    // 让用户直接看到按工作区树组织的文件夹结构；旧库素材无落盘记录时回退到库原图（cache-images）。
    const targetPath = resolveImageRevealPath(asset.imageId, tasks, storedImage)
    if (!targetPath) {
      useStore.getState().showToast('未找到本地原图', 'error')
      return
    }
    const result = await openInExplorer(targetPath)
    if (!result?.ok) {
      useStore.getState().showToast(result?.error ? `打开图片位置失败：${result.error}` : '打开图片位置失败', 'error')
    }
  }

  return (
    <aside
      data-testid="asset-detail-panel"
      data-embedded={embedded || undefined}
      className={
        embedded
          ? 'flex min-h-0 min-w-0 flex-1 flex-col bg-transparent'
          : 'flex w-80 max-w-full shrink-0 flex-col border-l border-ds-border bg-ds-surface/50'
      }
    >
      {!embedded && (
        <div className="flex items-center justify-between border-b border-ds-border px-4 py-2">
          <span className="flex items-center gap-1">
            <IconButton
              className="min-h-ds-control-lg min-w-11"
              size="sm"
              aria-label="上一张素材"
              icon={<ChevronLeftIcon size={15} />}
              onClick={onPrev}
            />
            <IconButton
              className="min-h-ds-control-lg min-w-11"
              size="sm"
              aria-label="下一张素材"
              icon={<ChevronRightIcon size={15} />}
              onClick={onNext}
            />
            <span className="ml-1 text-sm font-medium">素材详情</span>
          </span>
          <IconButton
            className="min-h-ds-control-lg min-w-11"
            size="sm"
            aria-label="关闭详情"
            icon={<XIcon size={15} />}
            onClick={() => setDetailOpen(false)}
          />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {fullImageSrc ? (
          <img
            src={fullImageSrc}
            alt={primaryOrigin?.prompt ?? ''}
            className="w-full rounded-lg border border-ds-border"
          />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center rounded-lg border border-ds-border text-xs text-ds-muted">
            加载中…
          </div>
        )}

        {(onPrev || onNext) && embedded && (
          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onPrev}
              className="flex min-h-ds-control-lg items-center gap-1 rounded-md border border-ds-border px-3 text-xs disabled:opacity-50"
              disabled={!onPrev}
            >
              <ChevronLeftIcon size={14} /> 上一张
            </button>
            <button
              type="button"
              onClick={onNext}
              className="flex min-h-ds-control-lg items-center gap-1 rounded-md border border-ds-border px-3 text-xs disabled:opacity-50"
              disabled={!onNext}
            >
              下一张 <ChevronRightIcon size={14} />
            </button>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between">
          <RatingStars assetId={asset.id} value={asset.rating} />
          <Tooltip content={asset.favorite ? '取消收藏' : '收藏'}>
            <IconButton
              className="min-h-ds-control-lg min-w-11"
              size="sm"
              aria-label={asset.favorite ? '取消收藏' : '收藏'}
              icon={
                <StarIcon
                  size={15}
                  fill={asset.favorite ? 'currentColor' : 'none'}
                  className={asset.favorite ? 'text-ds-warning' : ''}
                />
              }
              onClick={() =>
                void assetCommands
                  .patchAssets([asset.id], { favorite: !asset.favorite })
                  .catch(() => useStore.getState().showToast('操作失败，请重试', 'error'))
              }
            />
          </Tooltip>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={!sourceTask}
            className="min-h-ds-control-lg rounded-md border border-ds-border px-2 text-xs disabled:opacity-50"
            onClick={() => void assetCommands.reuseGenerationConfig(asset.id)}
          >
            复用提示词与参数
          </button>
          <button
            type="button"
            disabled={!sourceTask}
            className="min-h-ds-control-lg rounded-md border border-ds-border px-2 text-xs disabled:opacity-50"
            onClick={() => {
              if (!sourceTask) return
              // 统一图片模式：切到「分组」视图并定位该任务所在分组
              const assetStore = useAssetLibraryStore.getState()
              assetStore.setGroupBy('grouped')
              assetStore.setBatchFocusTaskId(sourceTask.id)
              setDetailOpen(false)
            }}
          >
            查看来源任务
          </button>
          <button
            type="button"
            disabled={!sourceSop}
            title={sourceSop ? `复用 SOP「${sourceSop.name}」作为当前生图 SOP` : '该素材未关联 SOP'}
            className="flex min-h-ds-control-lg items-center justify-center gap-1 rounded-md border border-ds-border px-2 text-xs disabled:opacity-50"
            onClick={() => {
              if (!sourceSop) return
              void assetCommands.applyAssetSop(asset.id).then((ok) => {
                if (ok) {
                  useStore.getState().showToast(`已应用 SOP「${sourceSop.name}」`, 'success')
                  setDetailOpen(false)
                }
              })
            }}
          >
            <BookOpenCheckIcon size={14} /> 复用 SOP
          </button>
          <button
            type="button"
            className="flex min-h-ds-control-lg items-center justify-center gap-1 rounded-md border border-ds-border px-2 text-xs"
            onClick={() => {
              useAssetLibraryStore.getState().setSimilarToAsset(asset.id)
              setDetailOpen(false)
            }}
          >
            <Wand2Icon size={14} /> 找相似
          </button>
          <button
            type="button"
            className="flex min-h-ds-control-lg items-center justify-center gap-1 rounded-md border border-ds-border px-2 text-xs"
            onClick={() => {
              useAssetLibraryStore.getState().openViewer(asset.id, [asset.id])
            }}
          >
            <EyeIcon size={14} /> 查看大图
          </button>
          <button
            type="button"
            className="flex min-h-ds-control-lg items-center justify-center gap-1 rounded-md border border-ds-border px-2 text-xs"
            onClick={() => void assetCommands.useAsReference(asset.id)}
          >
            <ImagePlusIcon size={14} /> 加入参考图
          </button>
          <button
            type="button"
            className="flex min-h-ds-control-lg items-center justify-center gap-1 rounded-md border border-ds-border px-2 text-xs"
            onClick={() => void assetCommands.openInPostprocess(asset.id)}
          >
            <WrenchIcon size={14} /> 发送到后期
          </button>
          <button
            type="button"
            disabled={!isElectron() || (!storedImage?.localPath && !hasSavedTreePath)}
            className="min-h-ds-control-lg rounded-md border border-ds-border px-2 text-xs disabled:opacity-50"
            onClick={() => void handleOpenFileLocation()}
          >
            打开文件位置
          </button>
        </div>

        <NotesEditor assetId={asset.id} value={asset.notes ?? ''} />

        {primaryOrigin && (
          <section className="mt-4">
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-ds-muted">提示词</h3>
            <p className="whitespace-pre-wrap break-words text-sm leading-5">{primaryOrigin.prompt || '—'}</p>
            {primaryOrigin.revisedPrompt && (
              <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-ds-muted">
                修订：{primaryOrigin.revisedPrompt}
              </p>
            )}
          </section>
        )}

        {(sourceSop || sourceTask?.sopBatch) && (
          <section className="mt-4">
            <h3 className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ds-muted">
              <BookOpenCheckIcon size={13} /> SOP
            </h3>
            {sourceSop ? (
              <button
                type="button"
                onClick={() =>
                  void assetCommands.applyAssetSop(asset.id).then((ok) => {
                    if (!ok) return
                    if (sourceSop) useStore.getState().showToast(`已应用 SOP「${sourceSop.name}」`, 'success')
                    setDetailOpen(false)
                  })
                }
                title="点击应用该 SOP 为当前生图 SOP"
                className="flex min-h-ds-control-lg w-full items-center justify-between gap-2 rounded-md border border-ds-border px-2.5 text-xs transition-colors hover:border-ds-primary/40 hover:bg-ds-subtle"
              >
                <span className="truncate">{sourceSop.name}</span>
                <span className="shrink-0 text-ds-muted">点击复用 →</span>
              </button>
            ) : (
              <p className="text-xs text-ds-muted">{sourceTask?.sopBatch?.sopName || '未知 SOP'}（已从库中删除）</p>
            )}
          </section>
        )}

        <section className="mt-4">
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-ds-muted">文件信息</h3>
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-ds-muted">尺寸</dt>
            <dd>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : '—'}</dd>
            <dt className="text-ds-muted">格式</dt>
            <dd>{asset.mimeType ?? '—'}</dd>
            <dt className="text-ds-muted">大小</dt>
            <dd>{formatBytes(asset.byteSize)}</dd>
            <dt className="text-ds-muted">生成时间</dt>
            <dd>{new Date(asset.createdAt).toLocaleString()}</dd>
            <dt className="text-ds-muted">输入图片</dt>
            <dd>{primaryOrigin?.inputImageIds.length ?? 0} 张</dd>
          </dl>
        </section>

        <section className="mt-4">
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-ds-muted">来源</h3>
          {asset.origins.length === 0 ? (
            <p className="text-xs text-ds-muted">无来源快照</p>
          ) : (
            <>
              {/* 参数解耦展示：任务级共享参数 + 本图专属参数（主来源） */}
              {primaryOrigin && <AssetParamBreakdown origin={primaryOrigin} className="mb-2" />}
              <ul className="space-y-1">
                {asset.origins.map((origin) => (
                  <li key={origin.key} className="rounded-md border border-ds-border px-2 py-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{origin.key}</span>
                      <span className="shrink-0 text-ds-muted">{origin.apiModel ?? origin.sourceMode}</span>
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-ds-muted">{origin.prompt}</div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="mt-4">
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-ds-muted">项目</h3>
          <div className="flex flex-wrap gap-1">
            {collections.map((collection) => (
              <button
                key={collection.id}
                type="button"
                onClick={() => toggleCollection(collection.id)}
                className={`min-h-ds-control-lg rounded-full border px-3 text-xs ${asset.collectionIds.includes(collection.id) ? 'border-ds-primary bg-ds-primary/10 text-ds-primary' : 'border-ds-border text-ds-muted hover:border-ds-muted'}`}
              >
                {collection.name}
              </button>
            ))}
            {collections.length === 0 && <span className="text-xs text-ds-muted">暂无项目</span>}
          </div>
        </section>

        <DerivedChain asset={asset} onNavigate={(id) => useAssetLibraryStore.getState().setActiveAsset(id)} />
      </div>

      <div className="flex items-center gap-1 border-t border-ds-border p-2">
        {asset.status === 'trashed' ? (
          <>
            <button
              type="button"
              onClick={() => {
                void useAssetLibraryStore
                  .getState()
                  .restoreAssets([asset.id])
                  .then(() => useStore.getState().showToast('已恢复', 'success'))
                  .catch(() => useStore.getState().showToast('恢复失败', 'error'))
              }}
              className="min-h-ds-control-lg flex-1 rounded-md border border-ds-border px-2 text-xs"
            >
              恢复
            </button>
            <button
              type="button"
              onClick={() => onPurgeRequest?.([asset.id])}
              className="min-h-ds-control-lg flex-1 rounded-md border border-ds-danger/35 px-2 text-xs text-ds-danger"
            >
              永久删除
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() =>
              void assetCommands
                .trashAssets([asset.id])
                .then(() => useStore.getState().showToast('已移入回收站', 'success'))
                .catch(() => useStore.getState().showToast('操作失败，请重试', 'error'))
            }
            className="flex min-h-ds-control-lg flex-1 items-center justify-center gap-1 rounded-md border border-ds-border px-2 text-xs"
          >
            <TrashIcon size={13} /> 移入回收站
          </button>
        )}
      </div>
    </aside>
  )
}

/** 衍生链：上游输入（parentAssetIds）与下游产物（以本素材为输入的素材）。 */
export function DerivedChain({ asset, onNavigate }: { asset: GeneratedAsset; onNavigate: (assetId: string) => void }) {
  const [parents, setParents] = useState<GeneratedAsset[]>([])
  const [children, setChildren] = useState<GeneratedAsset[]>([])

  useEffect(() => {
    let active = true
    setParents([])
    setChildren([])
    if (window.electronAPI?.assetCatalogDerivedAssets) {
      void window.electronAPI
        .assetCatalogDerivedAssets(asset.id)
        .then((result) => {
          if (!active) return
          setParents(result.parents)
          setChildren(result.children)
        })
        .catch(() => {})
      return () => {
        active = false
      }
    }
    // 浏览器回退：从已水合的素材集合中扫描
    const state = useAssetLibraryStore.getState()
    const all = Object.values(state.assetsById)
    setParents(
      asset.parentAssetIds.map((id) => state.assetsById[id]).filter((item): item is GeneratedAsset => Boolean(item)),
    )
    setChildren(all.filter((candidate) => candidate.id !== asset.id && candidate.parentAssetIds.includes(asset.id)))
    return () => {
      active = false
    }
  }, [asset.id, asset.parentAssetIds])

  if (parents.length === 0 && children.length === 0) return null
  return (
    <section className="mt-4">
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-ds-muted">衍生关系</h3>
      {parents.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-xs text-ds-muted">上游输入（{parents.length}）</p>
          <ChainThumbnails assets={parents} onNavigate={onNavigate} />
        </div>
      )}
      {children.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-ds-muted">下游产物（{children.length}）</p>
          <ChainThumbnails assets={children} onNavigate={onNavigate} />
        </div>
      )}
    </section>
  )
}

function ChainThumbnails({ assets, onNavigate }: { assets: GeneratedAsset[]; onNavigate: (assetId: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {assets.slice(0, 12).map((item) => (
        <ChainThumbnail key={item.id} asset={item} onNavigate={onNavigate} />
      ))}
      {assets.length > 12 && <span className="self-center text-xs text-ds-muted">+{assets.length - 12}</span>}
    </div>
  )
}

function ChainThumbnail({ asset, onNavigate }: { asset: GeneratedAsset; onNavigate: (assetId: string) => void }) {
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
    <button
      type="button"
      onClick={() => onNavigate(asset.id)}
      title={asset.origins[0]?.prompt || asset.id}
      className="h-ds-12 w-ds-12 shrink-0 overflow-hidden rounded-md border border-ds-border outline-none hover:border-ds-primary focus-visible:ring-2 focus-visible:ring-ds-focus/70"
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-ds-muted/20 text-ds-muted">
          <ImageIcon size={13} />
        </span>
      )}
    </button>
  )
}

export default memo(AssetDetailPanelInner)
