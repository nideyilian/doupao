import { useEffect, useMemo, useState } from 'react'
import {
  BookOpenCheckIcon as BookOpenCheck,
  ChevronDownIcon as ChevronDown,
  FileImageIcon as FileImage,
  FileTextIcon as FileText,
  FolderOpenIcon as FolderOpen,
  ImageIcon,
  Layers3Icon as Layers3,
  LibraryIcon as Library,
  LoaderCircleIcon as LoaderCircle,
  PlayIcon as Play,
  SaveIcon as Save,
  SlidersHorizontalIcon as SlidersHorizontal,
  WandSparklesIcon as WandSparkles,
} from '../../design-system/icons'
import type {
  StrategyCatalog as RequirementCatalog,
  StrategyKnowledgeBatch as KnowledgeBatch,
  StrategyKnowledgeInsight as KnowledgeInsight,
  StrategyRole as RequirementRole,
  StrategyTestOrder as RequirementOrder,
} from './contracts'
import { useStore } from '../../store'
import type { StrategyAsset, StrategyPreset, StrategyReferenceConfig, SopGroup, SopLibraryItem } from './types'
import { normalizeStrategyAsset, validateStrategyForTest } from './model'
import SopPresetPickerModal from './SopPresetPickerModal'

function OptionalSection({ title, summary, children }: { title: string; summary: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-ds-xl border border-ds-border/80 bg-ds-surface dark:border-ds-border dark:bg-ds-surface">
      <summary className="flex min-h-ds-14 cursor-pointer list-none items-center gap-3 px-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ds-focus">
        <span className="flex h-ds-control-sm w-ds-control-sm shrink-0 items-center justify-center rounded-lg bg-ds-surface text-ds-muted dark:bg-ds-surface dark:text-ds-muted">
          <SlidersHorizontal size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          <span className="mt-0.5 block truncate text-xs text-ds-muted">{summary}</span>
        </span>
        <ChevronDown size={16} className="text-ds-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-ds-border/80 p-4 dark:border-ds-border">{children}</div>
    </details>
  )
}

function EnableRow({
  checked,
  disabled = false,
  title,
  description,
  onChange,
  children,
}: {
  checked: boolean
  disabled?: boolean
  title: string
  description: string
  onChange: (checked: boolean) => void
  children: React.ReactNode
}) {
  return (
    <div
      className={`rounded-ds-lg border p-3.5 transition ${checked ? 'border-ds-primary/35 bg-ds-primary-subtle/60 dark:border-ds-primary/30 dark:bg-ds-primary/10' : 'border-ds-border/80 bg-ds-surface/60 dark:border-ds-border dark:bg-ds-surface'} ${disabled ? 'opacity-60' : ''}`}
    >
      <label
        className={`flex min-h-ds-control-lg items-start gap-3 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-1 h-4 w-4 rounded border-ds-border text-ds-primary focus:ring-ds-focus"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          <span className="mt-1 block text-xs leading-5 text-ds-muted">{description}</span>
        </span>
        <span
          className={`rounded-lg px-2 py-1 text-xs ${checked ? 'bg-ds-primary-subtle text-ds-primary dark:bg-ds-primary/15 dark:text-ds-primary' : 'bg-ds-surface text-ds-muted dark:bg-ds-surface'}`}
        >
          {checked ? '已启用' : '未启用'}
        </span>
      </label>
      {checked && <div className="mt-3">{children}</div>}
    </div>
  )
}

export function snapshotSelectedFiles<T>(files: ArrayLike<T> | null) {
  return files ? Array.from(files) : []
}

export default function StrategyEditor({
  strategy,
  catalog,
  presets,
  sopItems,
  sopGroups,
  versions,
  knowledgeBatches,
  knowledgeInsights,
  generatedImageIds,
  testOrders,
  role,
  onSave,
  onTest,
  onPickLocalReference,
  onPickKnowledgeMaterial,
  onRollback,
  onManageSopLibrary,
}: {
  strategy?: StrategyAsset
  catalog: RequirementCatalog
  presets: StrategyPreset[]
  sopItems: SopLibraryItem[]
  sopGroups: SopGroup[]
  versions: StrategyAsset[]
  knowledgeBatches: KnowledgeBatch[]
  knowledgeInsights: KnowledgeInsight[]
  generatedImageIds: string[]
  testOrders: RequirementOrder[]
  role: RequirementRole
  onSave: (strategy: StrategyAsset) => void
  onTest: (strategyId: string, quantity: number) => { error?: string }
  onPickLocalReference: () => Promise<string[]>
  onPickKnowledgeMaterial: (batchId: string) => Promise<string[]>
  onRollback: (version: number) => void
  /** 打开 SOP 管理中心（SOP 库的唯一管理/编辑入口） */
  onManageSopLibrary?: () => void
}) {
  const normalizedStrategy = useMemo(() => (strategy ? normalizeStrategyAsset(strategy) : null), [strategy])
  const [draft, setDraft] = useState<StrategyAsset | null>(normalizedStrategy)
  const [testQuantity, setTestQuantity] = useState(normalizedStrategy?.quantity ?? 10)
  const [message, setMessage] = useState('')
  const [loadingReference, setLoadingReference] = useState(false)
  const [knowledgeBatchId, setKnowledgeBatchId] = useState('')
  const [showSopPicker, setShowSopPicker] = useState(false)

  useEffect(() => {
    setDraft(normalizedStrategy)
    setTestQuantity(normalizedStrategy?.quantity ?? 10)
    setMessage('')
    setShowSopPicker(false)
  }, [normalizedStrategy?.id, normalizedStrategy?.updatedAt])

  if (!strategy || !draft) {
    return (
      <aside className="flex h-full items-center justify-center border-l border-ds-border/80 bg-ds-surface/70 p-6 text-center dark:border-ds-border dark:bg-ds-scrim/70">
        <div>
          <WandSparkles size={28} className="mx-auto text-ds-muted" />
          <h2 className="mt-3 text-sm font-semibold">选择一个策略</h2>
          <p className="mt-1 text-xs leading-5 text-ds-muted">在这里选择并应用 SOP。</p>
        </div>
      </aside>
    )
  }

  const update = (next: StrategyAsset) =>
    setDraft({ ...next, status: next.status === 'published' ? 'draft' : next.status })
  const updateWorkflow = (patch: Partial<StrategyAsset['workflow']>) =>
    update({ ...draft, workflow: { ...draft.workflow, ...patch } })
  const updateOutputs = (patch: Partial<StrategyAsset['outputs']>) =>
    update({ ...draft, outputs: { ...draft.outputs, ...patch } })
  const validationErrors = validateStrategyForTest(draft)
  const sopReady = validationErrors.length === 0
  const testing = testOrders[0]?.status === 'queued' || testOrders[0]?.status === 'running'
  const activeKnowledgeBatches = knowledgeBatches.filter(
    (item) => item.status === 'completed' || item.status === 'review',
  )
  const activeKnowledgeInsights = knowledgeInsights
    .filter((item) => !knowledgeBatches.find((batch) => batch.id === item.batchId)?.error)
    .slice(0, 20)

  const chooseSop = (item: SopLibraryItem) => {
    updateWorkflow({
      sop: {
        resolved: true,
        mode: 'preset',
        presetId: item.id,
        name: item.name,
        description: item.description,
        content: item.content,
      },
    })
  }
  const clearSop = () =>
    updateWorkflow({
      sop: { resolved: false, mode: 'none', content: '' },
    })
  const setMode = (mode: NonNullable<StrategyAsset['generationMode']> | null) =>
    update({
      ...draft,
      generationMode: mode,
      workflow: { ...draft.workflow, reference: mode === 'image-to-image' ? draft.workflow.reference : undefined },
    })
  const setReference = (reference: StrategyReferenceConfig) => updateWorkflow({ reference })
  const toggleInsight = (insightId: string) => {
    const selected = draft.workflow.knowledge.insightIds.includes(insightId)
    updateWorkflow({
      knowledge: {
        resolved: true,
        insightIds: selected
          ? draft.workflow.knowledge.insightIds.filter((id) => id !== insightId)
          : [...draft.workflow.knowledge.insightIds, insightId],
      },
    })
  }
  const runTest = () => {
    if (validationErrors.length) {
      setMessage(validationErrors[0])
      return
    }
    const quantity = Math.max(1, Math.trunc(testQuantity || 10))
    const next = { ...draft, quantity }
    setDraft(next)
    onSave(next)
    const result = onTest(next.id, quantity)
    setMessage(result.error ?? '测试任务已加入当前策略')
    if (!result.error) useStore.getState().showToast('测试任务已加入当前策略', 'success')
  }

  const outputSummary =
    [
      draft.outputs.channels.enabled ? `${draft.outputs.channels.channelIds.length} 个渠道` : '',
      draft.outputs.sizes.enabled ? `${draft.outputs.sizes.ratios.length} 个尺寸` : '',
      draft.outputs.export.enabled ? '导出' : '',
      draft.outputs.allocation.enabled ? '分配' : '',
    ]
      .filter(Boolean)
      .join(' · ') || '使用系统默认输出'

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-ds-border/80 bg-ds-surface/70 dark:border-ds-border dark:bg-ds-scrim/70">
      <div className="border-b border-ds-border/80 bg-ds-surface/90 p-4 backdrop-blur dark:border-ds-border dark:bg-ds-scrim/90">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-ds-primary dark:text-ds-primary">SOP 驱动策略</p>
            <h2 className="mt-1 truncate text-base font-semibold">{draft.name}</h2>
            <p className="mt-1 text-xs text-ds-muted">
              {draft.status === 'published'
                ? `已发布 · v${draft.version}`
                : draft.status === 'review'
                  ? '待管理员审核'
                  : '本地草稿 · 修改后请保存'}
            </p>
          </div>
          <button
            onClick={() => {
              onSave(draft)
              useStore.getState().showToast('策略已保存', 'success')
            }}
            className="flex h-ds-control-lg shrink-0 cursor-pointer items-center justify-center gap-2 rounded-ds-lg border border-ds-border/80 bg-ds-surface px-3 text-xs font-medium text-ds-text shadow-sm transition hover:bg-ds-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus dark:border-ds-border dark:bg-ds-surface dark:text-ds-text-subtle dark:hover:bg-ds-surface"
          >
            <Save size={15} />
            保存
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            disabled={!sopReady}
            onClick={() => {
              const next = { ...draft, status: 'review' as const }
              setDraft(next)
              onSave(next)
              useStore.getState().showToast('已提交审核', 'success')
            }}
            className="h-ds-control-lg flex-1 cursor-pointer rounded-ds-lg border border-ds-border/80 bg-ds-surface text-xs font-medium transition hover:bg-ds-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus disabled:cursor-not-allowed disabled:opacity-40 dark:border-ds-border dark:bg-ds-surface dark:hover:bg-ds-surface"
          >
            提交审核
          </button>
          {role === 'admin' && (
            <button
              disabled={!sopReady}
              onClick={() => {
                const next = { ...draft, status: 'published' as const, version: draft.version + 1 }
                setDraft(next)
                onSave(next)
                useStore.getState().showToast(`已发布 v${next.version}`, 'success')
              }}
              className="h-ds-control-lg flex-1 cursor-pointer rounded-ds-lg bg-ds-success text-xs font-medium text-ds-text-inverse shadow-sm transition hover:bg-ds-success-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:bg-ds-subtle dark:disabled:bg-ds-subtle"
            >
              审核发布
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <section className="rounded-ds-xl border border-ds-border/80 bg-ds-surface p-4 dark:border-ds-border dark:bg-ds-surface">
          <p className="text-xs font-medium text-ds-muted">策略基本信息</p>
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ds-muted dark:text-ds-muted">策略名称</span>
              <input
                value={draft.name}
                onChange={(event) => update({ ...draft, name: event.target.value })}
                className="h-ds-control-lg w-full rounded-ds-lg border border-ds-border bg-ds-surface px-3 text-sm outline-none focus:border-ds-primary focus:ring-2 focus:ring-ds-focus dark:border-ds-border-strong dark:bg-ds-scrim dark:focus:ring-ds-focus"
              />
            </label>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg bg-ds-surface px-3 py-2 dark:bg-black/20">
                <p className="text-ds-muted">所属产品</p>
                <p className="mt-1 truncate font-medium text-ds-text dark:text-ds-text-subtle">
                  {catalog.products.find((item) => item.id === draft.productId)?.name ?? '未设置'}
                </p>
              </div>
              <div className="rounded-lg bg-ds-surface px-3 py-2 dark:bg-black/20">
                <p className="text-ds-muted">素材类型</p>
                <p className="mt-1 truncate font-medium text-ds-text dark:text-ds-text-subtle">
                  {catalog.materialTypes.find((item) => item.id === draft.materialTypeId)?.name ?? '未设置'}
                </p>
              </div>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ds-muted dark:text-ds-muted">策略说明</span>
              <textarea
                value={draft.description}
                onChange={(event) => update({ ...draft, description: event.target.value })}
                placeholder="补充适用的商品、场景或业务目标"
                className="min-h-20 w-full rounded-ds-lg border border-ds-border bg-ds-surface p-3 text-sm leading-6 outline-none focus:border-ds-primary focus:ring-2 focus:ring-ds-focus dark:border-ds-border-strong dark:bg-ds-scrim dark:focus:ring-ds-focus"
              />
            </label>
          </div>
        </section>

        <section className="mt-3 rounded-ds-xl border border-ds-border/80 bg-ds-surface p-4 shadow-sm dark:border-ds-border dark:bg-ds-surface">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-ds-muted dark:text-ds-muted">当前 SOP</p>
              {draft.workflow.sop.content.trim() ? (
                <>
                  <h4 className="mt-1 truncate text-sm font-semibold">{draft.workflow.sop.name || '未命名 SOP'}</h4>
                  {draft.workflow.sop.description && (
                    <p className="mt-0.5 truncate text-xs text-ds-muted dark:text-ds-muted">
                      {draft.workflow.sop.description}
                    </p>
                  )}
                  <p className="mt-2 line-clamp-3 whitespace-pre-wrap rounded-lg bg-ds-surface px-2.5 py-2 text-xs leading-5 text-ds-muted dark:bg-ds-scrim dark:text-ds-text-subtle">
                    {draft.workflow.sop.content}
                  </p>
                  {draft.workflow.sop.mode === 'custom' && (
                    <p className="mt-1.5 text-xs text-ds-warning">
                      该 SOP 为策略内副本，正文修改请在 SOP 库中编辑后再选择。
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-1 text-xs leading-5 text-ds-muted dark:text-ds-muted">
                  未选择 SOP，策略无法执行测试。从 SOP 库选择一份可执行的 SOP 后继续。
                </p>
              )}
            </div>
            <span
              className={`shrink-0 rounded-lg px-2 py-1 text-xs font-medium ${
                draft.workflow.sop.content.trim()
                  ? 'bg-ds-success-subtle text-ds-success dark:bg-ds-success/30 dark:text-ds-success'
                  : 'bg-ds-surface text-ds-muted dark:bg-ds-surface dark:text-ds-muted'
              }`}
            >
              {draft.workflow.sop.content.trim() ? '已就绪' : '未配置'}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSopPicker(true)}
              aria-haspopup="dialog"
              className="flex h-ds-control-md cursor-pointer items-center gap-1.5 rounded-lg bg-ds-primary px-2.5 text-xs font-medium text-ds-text-inverse transition hover:bg-ds-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus"
            >
              <BookOpenCheck size={13} />
              选择 SOP 预设
            </button>
            {onManageSopLibrary && (
              <button
                type="button"
                onClick={onManageSopLibrary}
                className="flex h-ds-control-md cursor-pointer items-center gap-1.5 rounded-lg border border-ds-border bg-ds-surface px-2.5 text-xs font-medium text-ds-muted transition hover:bg-ds-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus dark:border-ds-border dark:bg-ds-surface dark:text-ds-text-subtle dark:hover:bg-ds-surface"
              >
                <Library size={13} />
                打开 SOP 库
              </button>
            )}
            {draft.workflow.sop.content.trim() && (
              <button
                type="button"
                onClick={clearSop}
                className="flex h-ds-control-md cursor-pointer items-center rounded-lg px-2.5 text-xs font-medium text-ds-muted transition hover:bg-ds-subtle hover:text-ds-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus dark:text-ds-muted dark:hover:bg-ds-surface"
              >
                不使用 SOP
              </button>
            )}
          </div>
        </section>

        <div className="mt-3 space-y-3">
          <OptionalSection
            title="生图参数"
            summary={
              draft.generationMode
                ? `${draft.generationMode === 'image-to-image' ? '图生图' : '文生图'}${draft.workflow.reference?.imageIds.length ? ` · ${draft.workflow.reference.imageIds.length} 张参考图` : ''}`
                : '使用系统默认生成方式'
            }
          >
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setMode(null)}
                aria-pressed={!draft.generationMode}
                className={`min-h-ds-16 cursor-pointer rounded-ds-lg border px-2 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus ${!draft.generationMode ? 'border-ds-primary bg-ds-primary-subtle font-medium text-ds-primary dark:bg-ds-primary-subtle/30 dark:text-ds-primary' : 'border-ds-border hover:border-ds-primary/35 dark:border-ds-border-strong'}`}
              >
                系统默认
              </button>
              {(
                [
                  ['text-to-image', FileText, '文生图'],
                  ['image-to-image', ImageIcon, '图生图'],
                ] as const
              ).map(([mode, Icon, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setMode(mode)}
                  aria-pressed={draft.generationMode === mode}
                  className={`flex min-h-ds-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-ds-lg border text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus ${draft.generationMode === mode ? 'border-ds-primary bg-ds-primary-subtle font-medium text-ds-primary dark:bg-ds-primary-subtle/30 dark:text-ds-primary' : 'border-ds-border hover:border-ds-primary/35 dark:border-ds-border-strong'}`}
                >
                  <Icon size={17} />
                  {label}
                </button>
              ))}
            </div>
            {draft.generationMode === 'image-to-image' && (
              <div className="mt-3">
                <p className="mb-2 text-xs font-medium text-ds-muted dark:text-ds-muted">参考素材（可选）</p>
                <div className="grid grid-cols-3 gap-1.5">
                  <div
                    className={`rounded-ds-lg border p-2 ${draft.workflow.reference?.source === 'knowledge-material' ? 'border-ds-primary bg-ds-primary-subtle dark:bg-ds-primary-subtle/30' : 'border-ds-border dark:border-ds-border-strong'}`}
                  >
                    <div className="flex items-center gap-1 text-xs font-medium">
                      <Layers3 size={14} />
                      素材批次
                    </div>
                    <select
                      value={knowledgeBatchId}
                      onChange={(event) => setKnowledgeBatchId(event.target.value)}
                      className="mt-2 h-ds-control-sm w-full rounded-md border border-ds-border bg-ds-surface px-1 text-xs dark:border-ds-border-strong dark:bg-ds-scrim"
                    >
                      <option value="">选择素材集</option>
                      {activeKnowledgeBatches.map((batch) => (
                        <option key={batch.id} value={batch.id}>
                          {batch.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!knowledgeBatchId || loadingReference}
                      onClick={async () => {
                        setLoadingReference(true)
                        try {
                          const ids = await onPickKnowledgeMaterial(knowledgeBatchId)
                          if (ids.length) {
                            setReference({
                              source: 'knowledge-material',
                              label:
                                activeKnowledgeBatches.find((batch) => batch.id === knowledgeBatchId)?.name ??
                                '素材批次',
                              value: knowledgeBatchId,
                              imageIds: ids,
                            })
                            useStore.getState().showToast('已载入素材批次', 'success')
                          }
                        } catch {
                          useStore.getState().showToast('素材载入失败，请重试', 'error')
                        } finally {
                          setLoadingReference(false)
                        }
                      }}
                      className="mt-1 flex h-ds-control-sm w-full cursor-pointer items-center justify-center rounded-md bg-ds-primary text-xs text-ds-text-inverse disabled:cursor-not-allowed disabled:bg-ds-subtle"
                    >
                      {loadingReference ? (
                        <LoaderCircle size={12} className="animate-spin motion-reduce:animate-none" />
                      ) : (
                        '使用素材集'
                      )}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const ids = await onPickLocalReference()
                        if (ids.length) {
                          setReference({ source: 'local-image', label: '本地参考图片', value: ids[0], imageIds: ids })
                          useStore.getState().showToast('已载入本地参考图', 'success')
                        }
                      } catch {
                        useStore.getState().showToast('图片读取失败，请重试', 'error')
                      }
                    }}
                    className={`flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-ds-lg border text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus ${draft.workflow.reference?.source === 'local-image' ? 'border-ds-primary bg-ds-primary-subtle text-ds-primary dark:bg-ds-primary-subtle/30 dark:text-ds-primary' : 'border-ds-border hover:border-ds-primary/35 dark:border-ds-border-strong'}`}
                  >
                    <FolderOpen size={17} />
                    本地图片
                  </button>
                  <button
                    type="button"
                    disabled={!generatedImageIds.length}
                    onClick={() => {
                      const imageId = generatedImageIds[0]
                      if (imageId)
                        setReference({
                          source: 'generated-image',
                          label: '历史测试结果',
                          value: imageId,
                          imageIds: [imageId],
                        })
                    }}
                    className={`flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-ds-lg border text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus disabled:cursor-not-allowed disabled:opacity-40 ${draft.workflow.reference?.source === 'generated-image' ? 'border-ds-primary bg-ds-primary-subtle text-ds-primary dark:bg-ds-primary-subtle/30 dark:text-ds-primary' : 'border-ds-border hover:border-ds-primary/35 dark:border-ds-border-strong'}`}
                  >
                    <FileImage size={17} />
                    历史测试图
                  </button>
                </div>
                {draft.workflow.reference && (
                  <p className="mt-2 rounded-lg bg-ds-surface px-2 py-1.5 text-xs text-ds-muted dark:bg-ds-subtle dark:text-ds-muted">
                    当前：{draft.workflow.reference.label} · {draft.workflow.reference.imageIds.length} 张
                  </p>
                )}
              </div>
            )}
            <label className="mt-3 block">
              <span className="mb-1 block text-xs font-medium text-ds-muted dark:text-ds-muted">
                补充生成要求（可选）
              </span>
              <textarea
                value={draft.workflow.instruction}
                onChange={(event) => updateWorkflow({ instruction: event.target.value })}
                placeholder="仅填写本次策略需要覆盖 SOP 的特殊要求"
                className="min-h-24 w-full rounded-ds-lg border border-ds-border bg-ds-surface p-3 text-sm leading-6 outline-none focus:border-ds-primary focus:ring-2 focus:ring-ds-focus dark:border-ds-border-strong dark:bg-ds-scrim dark:focus:ring-ds-focus"
              />
            </label>
          </OptionalSection>

          <OptionalSection
            title="知识词条"
            summary={
              draft.workflow.knowledge.insightIds.length
                ? `已选择 ${draft.workflow.knowledge.insightIds.length} 条`
                : '未选择，生成时不附加知识词条'
            }
          >
            <div className="max-h-44 space-y-1 overflow-y-auto">
              {activeKnowledgeInsights.map((insight) => {
                const selected = draft.workflow.knowledge.insightIds.includes(insight.id)
                return (
                  <button
                    key={insight.id}
                    type="button"
                    onClick={() => toggleInsight(insight.id)}
                    aria-pressed={selected}
                    className={`flex min-h-ds-control-lg w-full cursor-pointer items-center gap-2 rounded-ds-lg border px-3 text-left text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus ${selected ? 'border-ds-primary bg-ds-primary-subtle text-ds-primary dark:bg-ds-primary-subtle/30 dark:text-ds-primary' : 'border-ds-border hover:border-ds-primary/35 dark:border-ds-border-strong'}`}
                  >
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${insight.category === 'stable' ? 'bg-ds-primary' : 'bg-ds-primary'}`}
                    />
                    <span className="min-w-0 flex-1 truncate">{insight.title}</span>
                    <span className="text-xs text-ds-muted">{insight.category === 'stable' ? '稳定' : '探索'}</span>
                  </button>
                )
              })}
              {!activeKnowledgeInsights.length && (
                <p className="rounded-ds-lg bg-ds-surface p-3 text-center text-xs text-ds-muted dark:bg-ds-scrim">
                  知识库暂无可用词条。
                </p>
              )}
            </div>
          </OptionalSection>

          <OptionalSection title="输出设置" summary={outputSummary}>
            <div className="space-y-2">
              <EnableRow
                checked={draft.outputs.channels.enabled}
                title="输出渠道"
                description="未启用时继承订单或系统默认渠道。"
                onChange={(enabled) =>
                  updateOutputs({
                    channels: { ...draft.outputs.channels, enabled },
                    export: enabled ? draft.outputs.export : { ...draft.outputs.export, enabled: false },
                    allocation:
                      enabled || draft.outputs.sizes.enabled
                        ? draft.outputs.allocation
                        : { ...draft.outputs.allocation, enabled: false },
                  })
                }
              >
                <div className="flex flex-wrap gap-1.5">
                  {catalog.channels
                    .filter((item) => item.published && !item.archived)
                    .map((channel) => {
                      const selected = draft.outputs.channels.channelIds.includes(channel.id)
                      return (
                        <button
                          key={channel.id}
                          type="button"
                          onClick={() =>
                            updateOutputs({
                              channels: {
                                enabled: true,
                                channelIds: selected
                                  ? draft.outputs.channels.channelIds.filter((id) => id !== channel.id)
                                  : [...draft.outputs.channels.channelIds, channel.id],
                              },
                            })
                          }
                          className={`min-h-ds-control-md cursor-pointer rounded-lg border px-3 text-xs ${selected ? 'border-ds-primary bg-ds-primary-subtle text-ds-primary dark:bg-ds-primary-subtle dark:text-ds-primary' : 'border-ds-border bg-ds-surface dark:border-ds-border-strong dark:bg-ds-scrim'}`}
                        >
                          {channel.name}
                        </button>
                      )
                    })}
                </div>
              </EnableRow>
              <EnableRow
                checked={draft.outputs.sizes.enabled}
                title="输出尺寸"
                description="未启用时继承订单或系统默认尺寸。"
                onChange={(enabled) =>
                  updateOutputs({
                    sizes: { ...draft.outputs.sizes, enabled },
                    allocation:
                      enabled || draft.outputs.channels.enabled
                        ? draft.outputs.allocation
                        : { ...draft.outputs.allocation, enabled: false },
                  })
                }
              >
                <div className="grid grid-cols-2 gap-2">
                  {(['16:9', '9:16'] as const).map((ratio) => {
                    const selected = draft.outputs.sizes.ratios.includes(ratio)
                    return (
                      <button
                        key={ratio}
                        type="button"
                        onClick={() =>
                          updateOutputs({
                            sizes: {
                              enabled: true,
                              ratios: selected
                                ? draft.outputs.sizes.ratios.filter((item) => item !== ratio)
                                : [...draft.outputs.sizes.ratios, ratio],
                            },
                          })
                        }
                        className={`min-h-ds-control-lg cursor-pointer rounded-lg border text-xs ${selected ? 'border-ds-primary bg-ds-primary-subtle font-medium text-ds-primary dark:bg-ds-primary-subtle dark:text-ds-primary' : 'border-ds-border bg-ds-surface dark:border-ds-border-strong dark:bg-ds-scrim'}`}
                      >
                        {ratio === '16:9' ? '横版 16:9' : '竖版 9:16'}
                      </button>
                    )
                  })}
                </div>
              </EnableRow>
              <EnableRow
                checked={draft.outputs.export.enabled}
                disabled={!draft.outputs.channels.enabled || !draft.outputs.channels.channelIds.length}
                title="渠道导出"
                description="仅在已配置输出渠道时生效。"
                onChange={(enabled) => updateOutputs({ export: { ...draft.outputs.export, enabled } })}
              >
                <select
                  value={draft.outputs.export.presetId ?? ''}
                  onChange={(event) =>
                    updateOutputs({ export: { enabled: true, presetId: event.target.value || undefined } })
                  }
                  className="h-ds-control-md w-full rounded-lg border border-ds-border bg-ds-surface px-2 text-xs dark:border-ds-border-strong dark:bg-ds-scrim"
                >
                  <option value="">选择导出预设</option>
                  {presets
                    .filter((preset) => preset.type === 'export' && !preset.archived)
                    .map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                </select>
              </EnableRow>
              <EnableRow
                checked={draft.outputs.allocation.enabled}
                disabled={!draft.outputs.channels.enabled && !draft.outputs.sizes.enabled}
                title="输出分配"
                description="仅在已配置渠道或尺寸时生效。"
                onChange={(enabled) => updateOutputs({ allocation: { ...draft.outputs.allocation, enabled } })}
              >
                <select
                  value={draft.outputs.allocation.presetId ?? ''}
                  onChange={(event) =>
                    updateOutputs({ allocation: { enabled: true, presetId: event.target.value || undefined } })
                  }
                  className="h-ds-control-md w-full rounded-lg border border-ds-border bg-ds-surface px-2 text-xs dark:border-ds-border-strong dark:bg-ds-scrim"
                >
                  <option value="">选择分配预设</option>
                  {presets
                    .filter((preset) => preset.type === 'allocation' && !preset.archived)
                    .map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                </select>
              </EnableRow>
            </div>
          </OptionalSection>

          {role === 'admin' && versions.length > 0 && (
            <OptionalSection title="版本历史" summary={`保留 ${versions.length} 个可回滚版本`}>
              <div className="space-y-1">
                {versions.map((version) => (
                  <div
                    key={`${version.id}:${version.version}`}
                    className="flex min-h-ds-control-md items-center gap-2 rounded-lg bg-ds-surface px-2.5 text-xs dark:bg-ds-scrim"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      v{version.version} · {version.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onRollback(version.version)
                        useStore.getState().showToast(`已回滚到 v${version.version}`, 'success')
                      }}
                      className="h-ds-control-sm cursor-pointer rounded-md px-2 text-ds-primary hover:bg-ds-primary-subtle dark:text-ds-primary dark:hover:bg-ds-primary/30"
                    >
                      回滚
                    </button>
                  </div>
                ))}
              </div>
            </OptionalSection>
          )}
        </div>
      </div>

      <div className="border-t border-ds-border/80 bg-ds-surface/95 p-4 backdrop-blur dark:border-ds-border dark:bg-ds-scrim/95">
        {(message || validationErrors.length > 0) && (
          <p
            role="status"
            className={`mb-2 rounded-lg px-2.5 py-2 text-xs ${message === '测试任务已加入当前策略' ? 'bg-ds-success-subtle text-ds-success dark:bg-ds-success/30 dark:text-ds-success' : 'bg-ds-warning-subtle text-ds-warning dark:bg-ds-warning/30 dark:text-ds-warning'}`}
          >
            {message || validationErrors[0]}
          </p>
        )}
        <div className="flex items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-xs font-medium text-ds-muted">测试生成数量</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={testQuantity}
              onChange={(event) => setTestQuantity(Number(event.target.value))}
              className="h-ds-control-lg w-full rounded-ds-lg border border-ds-border bg-ds-surface px-3 text-sm tabular-nums outline-none focus:border-ds-primary focus:ring-2 focus:ring-ds-focus dark:border-ds-border-strong dark:bg-ds-scrim dark:focus:ring-ds-focus"
            />
          </label>
          <button
            type="button"
            onClick={runTest}
            disabled={testing || validationErrors.length > 0}
            className="flex h-ds-control-lg flex-[1.5] cursor-pointer items-center justify-center gap-2 rounded-ds-lg bg-ds-primary text-sm font-medium text-ds-text-inverse transition hover:bg-ds-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-ds-subtle dark:disabled:bg-ds-subtle"
          >
            {testing ? (
              <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" />
            ) : (
              <Play size={16} />
            )}
            {testing ? '测试生成中' : `一键测试 ${Math.max(1, testQuantity || 10)} 张`}
          </button>
        </div>
      </div>
      <SopPresetPickerModal
        open={showSopPicker}
        items={sopItems}
        groups={sopGroups}
        selectedSopId={draft.workflow.sop.presetId}
        onSelect={(item) => {
          chooseSop(item)
          setShowSopPicker(false)
        }}
        onClear={() => {
          clearSop()
          setShowSopPicker(false)
        }}
        onManage={() => {
          setShowSopPicker(false)
          onManageSopLibrary?.()
        }}
        onOpenChange={setShowSopPicker}
      />
    </aside>
  )
}
