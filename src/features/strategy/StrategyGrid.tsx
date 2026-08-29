import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import {
  ArchiveIcon as Archive,
  ArrowLeftIcon as ArrowLeft,
  CheckIcon as Check,
  CloseIcon as X,
  CopyIcon as Copy,
  Edit3Icon as Edit3,
  ExpandIcon as Expand,
  ImagePlusIcon as ImagePlus,
  ImagesIcon as Images,
  LoaderCircleIcon as LoaderCircle,
  MoreHorizontalIcon as MoreHorizontal,
  PencilIcon as Pencil,
  PlayIcon as Play,
  PlusIcon as Plus,
  SearchIcon as Search,
  SparklesIcon as Sparkles,
} from '../../design-system/icons'
import type {
  StrategyCatalog as RequirementCatalog,
  StrategyTask as TaskRecord,
  StrategyTestOrder as RequirementOrder,
} from './contracts'
import type { StrategyAsset } from './types'
import { isModalBackdropEvent } from '../../lib/modalBackdrop'
import { useStore } from '../../store'

export interface StrategyImageProps {
  imageId?: string
  alt: string
  className?: string
}

type ResultDetail = {
  strategyId: string
  imageId: string
  prompt: string
}

function modeLabel(strategy: StrategyAsset) {
  if (!strategy.generationMode) return '未配置'
  const mode = strategy.generationMode === 'image-to-image' ? '图生图' : '文生图'
  return strategy.workflow?.sop?.resolved && strategy.workflow.sop.mode !== 'none' ? `${mode} · SOP` : mode
}

function statusLabel(strategy: StrategyAsset) {
  if (strategy.status === 'published') return '已发布'
  if (strategy.status === 'review') return '待审核'
  return '草稿'
}

export default function StrategyGrid({
  catalog,
  strategies,
  selectedStrategyId,
  orders,
  tasks,
  ImageComponent,
  canPaste,
  headerActions,
  onSelectStrategy,
  onCreate,
  onRename,
  onCopy,
  onPaste,
  onArchive,
  onChangeCover,
  onPickLocalCover,
  onSavePromptOverride,
  onReusePrompt,
}: {
  catalog: RequirementCatalog
  strategies: StrategyAsset[]
  selectedStrategyId?: string
  orders: RequirementOrder[]
  tasks: TaskRecord[]
  ImageComponent: ComponentType<StrategyImageProps>
  canPaste: boolean
  headerActions?: ReactNode
  onSelectStrategy: (strategyId: string) => void
  onCreate: () => void
  onRename: (strategyId: string, name: string) => void
  onCopy: (strategyId: string) => void
  onPaste: () => void
  onArchive: (strategyId: string) => void
  onChangeCover: (strategyId: string, imageId: string) => void
  onPickLocalCover: (strategyId: string) => Promise<void>
  onSavePromptOverride: (strategyId: string, imageId: string, prompt: string) => void
  onReusePrompt: (strategyId: string, prompt: string) => void
}) {
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState('')
  const [editingName, setEditingName] = useState('')
  const [coverPickerId, setCoverPickerId] = useState('')
  const [actionMenuId, setActionMenuId] = useState('')
  const [resultsModalStrategyId, setResultsModalStrategyId] = useState('')
  const [resultDetail, setResultDetail] = useState<ResultDetail | null>(null)
  const [detailPrompt, setDetailPrompt] = useState('')
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const strategyById = useMemo(() => new Map(strategies.map((strategy) => [strategy.id, strategy])), [strategies])
  const filtered = strategies.filter(
    (strategy) =>
      !query.trim() ||
      strategy.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) ||
      strategy.description.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  )
  const tests = orders
    .filter((order) => order.isTest && order.strategyId && strategyById.has(order.strategyId))
    .sort((left, right) => right.createdAt - left.createdAt)

  const outputEntries = (strategyId: string) =>
    tests
      .filter((order) => order.strategyId === strategyId)
      .flatMap((order) =>
        order.units.flatMap((unit) => {
          const task = unit.taskId ? taskById.get(unit.taskId) : undefined
          return (task?.outputImages ?? []).map((imageId) => ({
            imageId,
            prompt: strategyById.get(strategyId)?.resultPromptOverrides?.[imageId] ?? task?.prompt ?? unit.prompt,
            order,
          }))
        }),
      )

  const resultsModalStrategy = strategyById.get(resultsModalStrategyId)
  const resultsModalTests = tests.filter((order) => order.strategyId === resultsModalStrategyId)
  const resultsModalEntries = outputEntries(resultsModalStrategyId)
  useEffect(() => {
    if (!actionMenuId) return
    const closeMenu = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActionMenuId('')
    }
    window.addEventListener('keydown', closeMenu)
    return () => window.removeEventListener('keydown', closeMenu)
  }, [actionMenuId])

  if (resultDetail) {
    const strategy = strategyById.get(resultDetail.strategyId)
    if (!strategy) return null
    return (
      <section className="strategy-drill-in flex h-full min-h-0 flex-col bg-ds-surface dark:bg-ds-scrim">
        <div className="flex h-ds-14 items-center gap-3 border-b border-ds-border px-4 dark:border-ds-border-strong">
          <button
            onClick={() => setResultDetail(null)}
            className="flex h-ds-control-md cursor-pointer items-center gap-2 rounded-lg px-3 text-sm text-ds-muted transition hover:bg-ds-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus dark:text-ds-muted dark:hover:bg-ds-subtle"
          >
            <ArrowLeft size={16} />
            返回测试结果
          </button>
          <div className="h-5 w-px bg-ds-subtle dark:bg-ds-subtle" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{strategy.name}</h2>
            <p className="text-xs text-ds-muted">图片详情与提示词</p>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 gap-0 overflow-hidden xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,.75fr)]">
          <div className="flex min-h-0 items-center justify-center overflow-auto bg-ds-scrim p-6">
            <ImageComponent
              imageId={resultDetail.imageId}
              alt={`${strategy.name}测试结果`}
              className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
            />
          </div>
          <div className="min-h-0 overflow-y-auto border-l border-ds-border p-5 dark:border-ds-border-strong">
            <h3 className="text-sm font-semibold">生图提示词</h3>
            <p className="mt-1 text-xs text-ds-muted">可以单独编辑当前图片提示词，或复用为策略主提示词。</p>
            <textarea
              value={detailPrompt}
              onChange={(event) => setDetailPrompt(event.target.value)}
              className="mt-4 min-h-72 w-full rounded-ds-lg border border-ds-border bg-ds-surface p-3 text-sm leading-6 outline-none transition focus:border-ds-primary focus:ring-2 focus:ring-ds-focus dark:border-ds-border-strong dark:bg-ds-scrim dark:focus:ring-ds-focus"
            />
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <button
                onClick={() => {
                  onSavePromptOverride(strategy.id, resultDetail.imageId, detailPrompt)
                  useStore.getState().showToast('提示词已保存', 'success')
                }}
                className="flex h-ds-control-lg cursor-pointer items-center justify-center gap-2 rounded-lg border border-ds-border text-sm transition hover:bg-ds-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus dark:border-ds-border-strong dark:hover:bg-ds-subtle"
              >
                <Check size={15} />
                保存编辑
              </button>
              <button
                onClick={() => {
                  onReusePrompt(strategy.id, detailPrompt)
                  useStore.getState().showToast('已复用为策略补充要求', 'success')
                }}
                className="flex h-ds-control-lg cursor-pointer items-center justify-center gap-2 rounded-lg border border-ds-primary/35 text-sm text-ds-primary transition hover:bg-ds-primary-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus dark:border-ds-primary dark:text-ds-primary dark:hover:bg-ds-primary/30"
              >
                <Play size={15} />
                复用到策略
              </button>
              <button
                onClick={() => {
                  onChangeCover(strategy.id, resultDetail.imageId)
                  useStore.getState().showToast('已设为封面', 'success')
                }}
                className="flex h-ds-control-lg cursor-pointer items-center justify-center gap-2 rounded-lg bg-ds-primary text-sm text-ds-text-inverse transition hover:bg-ds-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus focus-visible:ring-offset-2"
              >
                <ImagePlus size={15} />
                设为封面
              </button>
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-ds-surface/90 dark:bg-ds-scrim/90">
      <div className="flex min-h-ds-16 flex-wrap items-center gap-2 border-b border-ds-border/80 bg-ds-surface/80 px-4 py-3 backdrop-blur dark:border-ds-border dark:bg-ds-scrim/80">
        <label className="flex h-ds-control-lg min-w-48 flex-1 items-center gap-2 rounded-ds-lg border border-ds-border/80 bg-ds-surface/80 px-3 transition focus-within:border-ds-primary focus-within:bg-ds-surface focus-within:ring-2 focus-within:ring-ds-focus dark:border-ds-border dark:bg-ds-surface dark:focus-within:border-ds-primary/60 dark:focus-within:bg-ds-surface dark:focus-within:ring-ds-focus">
          <Search size={14} className="text-ds-muted" />
          <span className="sr-only">搜索当前策略</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索当前策略"
            className="min-w-0 flex-1 bg-transparent text-xs outline-none"
          />
        </label>
        {headerActions}
        <button
          onClick={onPaste}
          disabled={!canPaste}
          className="flex h-ds-control-lg cursor-pointer items-center gap-2 rounded-ds-lg border border-ds-border/80 bg-ds-surface px-3 text-xs font-medium text-ds-text shadow-sm transition hover:bg-ds-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus disabled:cursor-not-allowed disabled:opacity-40 dark:border-ds-border dark:bg-ds-surface dark:text-ds-text-subtle dark:hover:bg-ds-surface"
        >
          <Copy size={14} />
          粘贴
        </button>
        <button
          onClick={onCreate}
          className="flex h-ds-control-lg cursor-pointer items-center gap-2 rounded-ds-lg bg-ds-primary px-3.5 text-xs font-medium text-ds-text-inverse shadow-sm transition hover:bg-ds-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
        >
          <Plus size={14} />
          新建策略
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-ds-surface/50 p-4 dark:bg-ds-scrim/40">
        <div className="mb-3">
          <div>
            <h2 className="text-sm font-semibold text-ds-text dark:text-white">策略卡片</h2>
            <p className="mt-0.5 text-xs text-ds-muted">{filtered.length} 个策略 · 双击名称重命名 · 双击封面替换</p>
          </div>
        </div>
        {filtered.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center rounded-ds-lg border border-dashed border-ds-border text-center dark:border-ds-border-strong">
            <Sparkles size={24} className="text-ds-muted" />
            <p className="mt-3 text-sm font-medium">当前层级还没有策略</p>
            <button onClick={onCreate} className="mt-3 cursor-pointer text-sm text-ds-primary hover:underline">
              创建第一个策略
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {filtered.map((strategy) => {
              const product = catalog.products.find((item) => item.id === strategy.productId)
              const materialType = catalog.materialTypes.find((item) => item.id === strategy.materialTypeId)
              const selected = strategy.id === selectedStrategyId
              const strategyOutputs = outputEntries(strategy.id)
              return (
                <article
                  key={strategy.id}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('application/x-strategy-id', strategy.id)
                  }}
                  onClick={() => {
                    setActionMenuId('')
                    onSelectStrategy(strategy.id)
                  }}
                  className={`group relative cursor-pointer overflow-hidden rounded-ds-xl border bg-ds-surface shadow-sm transition duration-200 focus-within:ring-2 focus-within:ring-ds-focus hover:-translate-y-0.5 hover:shadow-lg motion-reduce:transform-none dark:bg-ds-scrim ${selected ? 'border-ds-primary ring-2 ring-ds-focus dark:ring-ds-focus' : 'border-ds-border/80 dark:border-ds-border'}`}
                >
                  <button
                    onDoubleClick={(event) => {
                      event.stopPropagation()
                      setCoverPickerId(strategy.id)
                    }}
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`替换${strategy.name}封面`}
                    title="双击替换封面"
                    className="relative block aspect-[16/9] w-full cursor-pointer overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ds-focus"
                  >
                    <ImageComponent
                      imageId={strategy.coverImageId}
                      alt={`${strategy.name}封面`}
                      className="h-full w-full transition duration-300 group-hover:scale-[1.02] motion-reduce:transform-none"
                    />
                    <span className="absolute inset-x-0 bottom-0 flex translate-y-full items-center justify-center gap-1 bg-ds-scrim/70 py-2 text-xs text-white transition group-hover:translate-y-0 motion-reduce:transition-none">
                      <ImagePlus size={13} />
                      双击替换封面
                    </span>
                  </button>
                  <div className="p-3">
                    <div className="flex items-start gap-2">
                      {editingId === strategy.id ? (
                        <input
                          autoFocus
                          value={editingName}
                          onChange={(event) => setEditingName(event.target.value)}
                          onClick={(event) => event.stopPropagation()}
                          onBlur={() => {
                            if (editingName.trim()) {
                              onRename(strategy.id, editingName.trim())
                              useStore.getState().showToast('策略已重命名', 'success')
                            }
                            setEditingId('')
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              if (editingName.trim()) {
                                onRename(strategy.id, editingName.trim())
                                useStore.getState().showToast('策略已重命名', 'success')
                              }
                              setEditingId('')
                            }
                            if (event.key === 'Escape') setEditingId('')
                          }}
                          className="h-ds-control-sm min-w-0 flex-1 rounded border border-ds-primary px-2 text-sm outline-none ring-2 ring-ds-focus dark:bg-ds-scrim dark:ring-ds-focus"
                        />
                      ) : (
                        <h3
                          onDoubleClick={(event) => {
                            event.stopPropagation()
                            setEditingId(strategy.id)
                            setEditingName(strategy.name)
                          }}
                          className="min-w-0 flex-1 line-clamp-2 text-sm font-semibold leading-5"
                        >
                          {strategy.name}
                        </h3>
                      )}
                      <button
                        onClick={(event) => {
                          event.stopPropagation()
                          onSelectStrategy(strategy.id)
                        }}
                        aria-label={`编辑${strategy.name}`}
                        title="编辑策略"
                        className="flex h-ds-control-sm w-ds-control-sm shrink-0 cursor-pointer items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-subtle hover:text-ds-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus dark:hover:bg-ds-subtle"
                      >
                        <Edit3 size={14} />
                      </button>
                    </div>
                    <p className="mt-1 line-clamp-2 min-h-ds-control-sm text-xs leading-4 text-ds-muted">
                      {strategy.description}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <span className="rounded-md bg-ds-surface px-2 py-1 text-xs text-ds-muted dark:bg-ds-subtle dark:text-ds-muted">
                        {product?.name}
                      </span>
                      <span className="rounded-md bg-ds-primary-subtle px-2 py-1 text-xs text-ds-primary dark:bg-ds-primary-subtle/40 dark:text-ds-primary">
                        {materialType?.name}
                      </span>
                      <span className="rounded-md bg-ds-primary-subtle px-2 py-1 text-xs text-ds-primary dark:bg-ds-primary/40 dark:text-ds-primary">
                        {modeLabel(strategy)}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-ds-border pt-2 dark:border-ds-border-strong">
                      <span className="text-xs text-ds-muted">
                        {statusLabel(strategy)} · v{strategy.version}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(event) => {
                            event.stopPropagation()
                            setResultsModalStrategyId(strategy.id)
                          }}
                          aria-label={`查看${strategy.name}的${strategyOutputs.length}张测试图片`}
                          title={`测试图片（${strategyOutputs.length}）`}
                          className="flex h-ds-control-sm w-ds-control-sm cursor-pointer items-center justify-center rounded text-ds-muted hover:bg-ds-primary-subtle hover:text-ds-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus dark:hover:bg-ds-primary/30 dark:hover:text-ds-primary"
                        >
                          <Images size={13} />
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation()
                            onCopy(strategy.id)
                          }}
                          aria-label={`复制${strategy.name}`}
                          title="复制"
                          className="flex h-ds-control-sm w-ds-control-sm cursor-pointer items-center justify-center rounded text-ds-muted hover:bg-ds-subtle hover:text-ds-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus dark:hover:bg-ds-subtle dark:hover:text-ds-text"
                        >
                          <Copy size={13} />
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation()
                            onArchive(strategy.id)
                          }}
                          aria-label={`归档${strategy.name}`}
                          title="归档"
                          className="flex h-ds-control-sm w-ds-control-sm cursor-pointer items-center justify-center rounded text-ds-muted hover:bg-ds-danger-subtle hover:text-ds-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:bg-ds-danger/30"
                        >
                          <Archive size={13} />
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation()
                            setActionMenuId((current) => (current === strategy.id ? '' : strategy.id))
                          }}
                          aria-expanded={actionMenuId === strategy.id}
                          aria-label={`${strategy.name}更多操作`}
                          title="更多操作"
                          className="flex h-ds-control-sm w-ds-control-sm cursor-pointer items-center justify-center rounded text-ds-muted hover:bg-ds-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus dark:hover:bg-ds-subtle"
                        >
                          <MoreHorizontal size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                  {actionMenuId === strategy.id && (
                    <div
                      onClick={(event) => event.stopPropagation()}
                      className="absolute bottom-11 right-3 z-20 w-44 overflow-hidden rounded-ds-lg border border-ds-border bg-ds-surface py-1 text-xs shadow-xl dark:border-ds-border-strong dark:bg-ds-scrim"
                    >
                      <button
                        onClick={() => {
                          setActionMenuId('')
                          onSelectStrategy(strategy.id)
                        }}
                        className="flex h-ds-control-md w-full cursor-pointer items-center gap-2 px-3 text-left hover:bg-ds-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ds-focus dark:hover:bg-ds-subtle"
                      >
                        <Edit3 size={14} />
                        编辑策略
                      </button>
                      <button
                        onClick={() => {
                          setActionMenuId('')
                          setEditingId(strategy.id)
                          setEditingName(strategy.name)
                        }}
                        className="flex h-ds-control-md w-full cursor-pointer items-center gap-2 px-3 text-left hover:bg-ds-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ds-focus dark:hover:bg-ds-subtle"
                      >
                        <Pencil size={14} />
                        重命名
                      </button>
                      <button
                        onClick={() => {
                          setActionMenuId('')
                          setResultsModalStrategyId(strategy.id)
                        }}
                        className="flex h-ds-control-md w-full cursor-pointer items-center gap-2 px-3 text-left hover:bg-ds-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ds-focus dark:hover:bg-ds-subtle"
                      >
                        <Images size={14} />
                        测试图片
                      </button>
                      <button
                        onClick={() => {
                          setActionMenuId('')
                          setCoverPickerId(strategy.id)
                        }}
                        className="flex h-ds-control-md w-full cursor-pointer items-center gap-2 px-3 text-left hover:bg-ds-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ds-focus dark:hover:bg-ds-subtle"
                      >
                        <ImagePlus size={14} />
                        替换封面
                      </button>
                      <button
                        onClick={() => {
                          setActionMenuId('')
                          onCopy(strategy.id)
                        }}
                        className="flex h-ds-control-md w-full cursor-pointer items-center gap-2 px-3 text-left hover:bg-ds-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ds-focus dark:hover:bg-ds-subtle"
                      >
                        <Copy size={14} />
                        复制到剪贴板
                      </button>
                      <button
                        onClick={() => {
                          setActionMenuId('')
                          onArchive(strategy.id)
                        }}
                        className="flex h-ds-control-md w-full cursor-pointer items-center gap-2 px-3 text-left text-ds-danger hover:bg-ds-danger-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500 dark:hover:bg-ds-danger/30"
                      >
                        <Archive size={14} />
                        归档策略
                      </button>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </div>

      {resultsModalStrategy && (
        <div
          className="fixed inset-0 z-[var(--ds-z-overlay)] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-overlay-in"
          role="dialog"
          aria-modal="true"
          aria-labelledby="strategy-test-results-title"
          onMouseDown={(event) => {
            if (isModalBackdropEvent(event)) setResultsModalStrategyId('')
          }}
        >
          <div className="animate-modal-in flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-ds-xl border border-ds-border/80 bg-ds-surface shadow-2xl dark:border-ds-border dark:bg-ds-scrim">
            <div className="flex items-center justify-between border-b border-ds-border px-5 py-4 dark:border-ds-border-strong">
              <div className="min-w-0">
                <h3 id="strategy-test-results-title" className="truncate font-semibold">
                  {resultsModalStrategy.name} · 测试图片
                </h3>
                <p className="mt-1 text-xs text-ds-muted">
                  共 {resultsModalEntries.length} 张，点击图片查看提示词、复用或设为封面。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setResultsModalStrategyId('')}
                aria-label="关闭测试结果"
                className="flex h-ds-control-lg w-ds-control-lg shrink-0 cursor-pointer items-center justify-center rounded-ds-lg text-ds-muted transition hover:bg-ds-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus dark:text-ds-muted dark:hover:bg-ds-surface"
              >
                <X size={18} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {resultsModalTests.some((order) => order.status === 'running' || order.status === 'queued') && (
                <div
                  aria-live="polite"
                  className="mb-4 flex min-h-ds-12 items-center gap-3 rounded-ds-lg border border-ds-primary/35 bg-ds-primary-subtle px-4 text-xs text-ds-primary dark:border-ds-primary dark:bg-ds-primary-subtle/30 dark:text-ds-primary"
                >
                  <LoaderCircle size={17} className="animate-spin motion-reduce:animate-none" />
                  测试图片正在{resultsModalTests.some((order) => order.status === 'running') ? '生成' : '排队'}
                  ，完成后会自动显示在此弹窗中。
                </div>
              )}
              {resultsModalEntries.length > 0 && (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
                  {resultsModalEntries.map((entry, index) => (
                    <button
                      key={`${entry.order.id}:${entry.imageId}`}
                      type="button"
                      onClick={() => {
                        setResultDetail({
                          strategyId: resultsModalStrategy.id,
                          imageId: entry.imageId,
                          prompt: entry.prompt,
                        })
                        setDetailPrompt(entry.prompt)
                      }}
                      className="group overflow-hidden rounded-ds-lg border border-ds-border bg-ds-surface text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-ds-primary hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus motion-reduce:transform-none dark:border-ds-border-strong dark:bg-ds-scrim"
                    >
                      <div className="relative aspect-square overflow-hidden bg-ds-surface dark:bg-ds-subtle">
                        <ImageComponent
                          imageId={entry.imageId}
                          alt={`${resultsModalStrategy.name}测试图 ${index + 1}`}
                          className="h-full w-full transition duration-300 group-hover:scale-[1.03] motion-reduce:transform-none"
                        />
                        <span className="absolute right-2 top-2 flex h-ds-control-sm w-ds-control-sm items-center justify-center rounded-lg bg-ds-scrim/65 text-white opacity-0 transition group-hover:opacity-100">
                          <Expand size={14} />
                        </span>
                      </div>
                      <div className="p-3">
                        <p className="line-clamp-2 text-xs leading-4 text-ds-muted">{entry.prompt}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {resultsModalEntries.length === 0 &&
                !resultsModalTests.some((order) => order.status === 'running' || order.status === 'queued') && (
                  <div className="flex min-h-64 flex-col items-center justify-center rounded-ds-lg border border-dashed border-ds-border text-center dark:border-ds-border-strong">
                    <Images size={28} className="text-ds-muted" />
                    <p className="mt-3 text-sm font-medium">该策略还没有生成图片</p>
                    <p className="mt-1 text-xs text-ds-muted">请在右侧策略编辑区点击“测试生成”。</p>
                  </div>
                )}
            </div>
          </div>
        </div>
      )}

      {coverPickerId && (
        <div
          className="fixed inset-0 z-[var(--ds-z-overlay)] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-overlay-in"
          role="dialog"
          aria-modal="true"
          aria-label="替换策略封面"
          onMouseDown={(event) => {
            if (isModalBackdropEvent(event)) setCoverPickerId('')
          }}
        >
          <div className="animate-modal-in max-h-[82vh] w-full max-w-3xl overflow-hidden rounded-ds-xl border border-ds-border/80 bg-ds-surface shadow-2xl dark:border-ds-border dark:bg-ds-scrim">
            <div className="flex items-center justify-between border-b border-ds-border p-4 dark:border-ds-border-strong">
              <div>
                <h3 className="font-semibold">替换策略封面</h3>
                <p className="mt-1 text-xs text-ds-muted">选择该策略之前生成的图片，或从本地导入。</p>
              </div>
              <button
                onClick={() => setCoverPickerId('')}
                className="h-ds-control-md cursor-pointer rounded-lg px-3 text-sm hover:bg-ds-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus dark:hover:bg-ds-subtle"
              >
                关闭
              </button>
            </div>
            <div className="max-h-[55vh] overflow-y-auto p-4">
              <button
                onClick={() => void onPickLocalCover(coverPickerId).then(() => setCoverPickerId(''))}
                className="mb-4 flex h-ds-control-lg cursor-pointer items-center gap-2 rounded-lg border border-dashed border-ds-primary/35 px-4 text-sm text-ds-primary hover:bg-ds-primary-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus dark:border-ds-primary dark:text-ds-primary dark:hover:bg-ds-primary/30"
              >
                <ImagePlus size={16} />
                选择本地图片
              </button>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                {outputEntries(coverPickerId).map((entry) => (
                  <button
                    key={entry.imageId}
                    onClick={() => {
                      onChangeCover(coverPickerId, entry.imageId)
                      setCoverPickerId('')
                      useStore.getState().showToast('封面已更新', 'success')
                    }}
                    className="aspect-square cursor-pointer overflow-hidden rounded-lg border border-ds-border transition hover:border-ds-primary hover:ring-2 hover:ring-ds-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus dark:border-ds-border-strong dark:hover:ring-ds-focus"
                  >
                    <ImageComponent imageId={entry.imageId} alt="可选封面" className="h-full w-full" />
                  </button>
                ))}
              </div>
              {outputEntries(coverPickerId).length === 0 && (
                <p className="py-8 text-center text-sm text-ds-muted">该策略还没有历史生成图片。</p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
