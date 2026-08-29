import { useEffect, useMemo, useState } from 'react'
import {
  BookOpenCheckIcon as BookOpenCheck,
  CloseIcon as X,
  PlusIcon as Plus,
  Settings2Icon as Settings2,
  TrashIcon as Trash2,
} from '../../../design-system/icons'
import '../styles.css'
import { cacheImage, useStore } from '../../../store'
import { storeImage } from '../../../lib/db'
import { useRequirementPrototype } from '../../requirementPrototype/store'
import type { SopLibraryItem, StrategyAsset, StrategyPreset, StrategyPresetType } from '../types'
import { normalizeStrategyAsset, presetLabel, strategyId } from '../model'
import StrategyEditor from '../StrategyEditor'
import StrategyGrid from '../StrategyGrid'
import StrategyTree, { type StrategyTreeSelection } from '../StrategyTree'
import SopManagementCenter from '../SopManagementCenter'
import StoreStrategyImage from './StoreStrategyImage'
import { generateSopFromStore, testSopRevisionFromStore } from './storeSopGeneration'
import { isModalBackdropEvent } from '../../../lib/modalBackdrop'

function PresetManager({
  presets,
  onSave,
  onArchive,
  onClose,
}: {
  presets: StrategyPreset[]
  onSave: (preset: StrategyPreset) => void
  onArchive: (presetId: string) => void
  onClose: () => void
}) {
  const sessionUserId = useRequirementPrototype((state) => state.sessionUserId)
  const [name, setName] = useState('')
  const [type, setType] = useState<StrategyPresetType>('export')
  const [description, setDescription] = useState('')
  const [value, setValue] = useState('')

  return (
    <div
      className="fixed inset-0 z-[var(--ds-z-overlay)] flex items-center justify-center bg-ds-scrim/0.48 p-4 animate-overlay-in"
      role="dialog"
      aria-modal="true"
      aria-label="全局策略预设管理"
      onMouseDown={(event) => {
        if (isModalBackdropEvent(event)) onClose()
      }}
    >
      <div className="ds-modal-surface animate-modal-in flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-ds-xl border border-ds-border">
        <div className="flex items-center justify-between border-b border-ds-border px-5 py-4">
          <div>
            <h2 className="font-semibold">全局策略预设</h2>
            <p className="mt-1 text-xs text-ds-muted">管理员添加后，所有策略师和用户都可使用。</p>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭预设管理"
            className="flex h-ds-control-md w-ds-control-md cursor-pointer items-center justify-center rounded-lg transition hover:bg-ds-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus dark:hover:bg-ds-subtle"
          >
            <X size={17} />
          </button>
        </div>
        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[1fr_360px] lg:overflow-hidden">
          <div className="min-h-0 overflow-y-auto p-5">
            <div className="space-y-2">
              {presets
                .filter((preset) => !preset.archived)
                .map((preset) => (
                  <div
                    key={preset.id}
                    className="rounded-ds-lg border border-ds-border p-4 dark:border-ds-border-strong"
                  >
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-sm font-semibold">{preset.name}</h3>
                          <span className="rounded-md bg-ds-primary-subtle px-2 py-1 text-xs text-ds-primary dark:bg-ds-primary-subtle/40 dark:text-ds-primary">
                            {presetLabel(preset.type)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-ds-muted">{preset.description}</p>
                        <p className="mt-2 line-clamp-2 rounded-lg bg-ds-surface p-2 text-xs leading-4 text-ds-muted dark:bg-ds-scrim">
                          {preset.value}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          onArchive(preset.id)
                          useStore.getState().showToast(`已删除预设「${preset.name}」`, 'success')
                        }}
                        aria-label={`删除预设${preset.name}`}
                        title="删除预设"
                        className="flex h-ds-control-sm w-ds-control-sm cursor-pointer items-center justify-center rounded-lg text-ds-muted transition hover:bg-ds-danger-subtle hover:text-ds-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:bg-ds-danger/30"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
          <div className="border-t border-ds-border bg-ds-surface/70 p-5 dark:border-ds-border dark:bg-black/20 lg:border-l lg:border-t-0">
            <h3 className="text-sm font-semibold">新增预设</h3>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs text-ds-muted dark:text-ds-muted">预设类型</span>
                <select
                  value={type}
                  onChange={(event) => setType(event.target.value as StrategyPresetType)}
                  className="h-ds-control-lg w-full rounded-lg border border-ds-border bg-ds-surface px-3 text-sm dark:border-ds-border-strong dark:bg-ds-scrim"
                >
                  <option value="export">渠道导出</option>
                  <option value="allocation">输出分配</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-ds-muted dark:text-ds-muted">名称</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="h-ds-control-lg w-full rounded-lg border border-ds-border bg-ds-surface px-3 text-sm outline-none focus:border-ds-primary focus:ring-2 focus:ring-ds-focus dark:border-ds-border-strong dark:bg-ds-scrim dark:focus:ring-ds-focus"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-ds-muted dark:text-ds-muted">说明</span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  className="min-h-20 w-full rounded-lg border border-ds-border bg-ds-surface p-3 text-sm outline-none focus:border-ds-primary focus:ring-2 focus:ring-ds-focus dark:border-ds-border-strong dark:bg-ds-scrim dark:focus:ring-ds-focus"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-ds-muted dark:text-ds-muted">预设内容</span>
                <textarea
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  className="min-h-36 w-full rounded-lg border border-ds-border bg-ds-surface p-3 text-sm leading-6 outline-none focus:border-ds-primary focus:ring-2 focus:ring-ds-focus dark:border-ds-border-strong dark:bg-ds-scrim dark:focus:ring-ds-focus"
                />
              </label>
              <button
                disabled={!name.trim() || !value.trim()}
                onClick={() => {
                  const presetName = name.trim()
                  onSave({
                    id: strategyId('preset'),
                    name: presetName,
                    type,
                    description: description.trim(),
                    value: value.trim(),
                    global: true,
                    createdBy: sessionUserId ?? 'user-admin',
                    createdAt: Date.now(),
                  })
                  setName('')
                  setDescription('')
                  setValue('')
                  useStore.getState().showToast(`已添加全局预设「${presetName}」`, 'success')
                }}
                className="flex h-ds-control-lg w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-ds-primary text-sm font-medium text-ds-text-inverse transition hover:bg-ds-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-ds-subtle dark:disabled:bg-ds-subtle"
              >
                <Plus size={15} />
                添加全局预设
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function StrategyWorkspace() {
  const sessionUserId = useRequirementPrototype((state) => state.sessionUserId)
  const users = useRequirementPrototype((state) => state.users)
  const catalog = useRequirementPrototype((state) => state.catalog)
  const storedStrategies = useRequirementPrototype((state) => state.strategyAssets)
  const presets = useRequirementPrototype((state) => state.strategyPresets)
  const sopGroups = useRequirementPrototype((state) => state.sopGroups)
  const sopLibrary = useRequirementPrototype((state) => state.sopLibrary)
  const sopMetaInstructions = useRequirementPrototype((state) => state.sopMetaInstructions)
  const sopVersionHistory = useRequirementPrototype((state) => state.sopVersionHistory)
  const strategyVersions = useRequirementPrototype((state) => state.strategyAssetVersions)
  const knowledgeBatches = useRequirementPrototype((state) => state.knowledgeBatches)
  const knowledgeInsights = useRequirementPrototype((state) => state.knowledgeInsights)
  const orders = useRequirementPrototype((state) => state.orders)
  const saveProduct = useRequirementPrototype((state) => state.saveProduct)
  const saveMaterialType = useRequirementPrototype((state) => state.saveMaterialType)
  const saveStrategy = useRequirementPrototype((state) => state.saveStrategyAsset)
  const createStrategy = useRequirementPrototype((state) => state.createStrategyAsset)
  const duplicateStrategy = useRequirementPrototype((state) => state.duplicateStrategyAsset)
  const moveStrategy = useRequirementPrototype((state) => state.moveStrategyAsset)
  const archiveStrategy = useRequirementPrototype((state) => state.archiveStrategyAsset)
  const rollbackStrategy = useRequirementPrototype((state) => state.rollbackStrategyAsset)
  const createTest = useRequirementPrototype((state) => state.createStrategyWorkflowTest)
  const savePreset = useRequirementPrototype((state) => state.saveStrategyPreset)
  const archivePreset = useRequirementPrototype((state) => state.archiveStrategyPreset)
  const saveSopGroup = useRequirementPrototype((state) => state.saveSopGroup)
  const duplicateSopGroup = useRequirementPrototype((state) => state.duplicateSopGroup)
  const deleteSopGroup = useRequirementPrototype((state) => state.deleteSopGroup)
  const saveSopItem = useRequirementPrototype((state) => state.saveSopItem)
  const duplicateSopItem = useRequirementPrototype((state) => state.duplicateSopItem)
  const deleteSopItem = useRequirementPrototype((state) => state.deleteSopItem)
  const saveSopMetaInstruction = useRequirementPrototype((state) => state.saveSopMetaInstruction)
  const duplicateSopMetaInstruction = useRequirementPrototype((state) => state.duplicateSopMetaInstruction)
  const deleteSopMetaInstruction = useRequirementPrototype((state) => state.deleteSopMetaInstruction)
  const tasks = useStore((state) => state.tasks)
  const user = users.find((item) => item.id === sessionUserId)
  const strategies = useMemo(
    () => storedStrategies.map((strategy) => normalizeStrategyAsset(strategy)),
    [storedStrategies],
  )
  const activeStrategies = strategies.filter((item) => !item.archived)
  const firstStrategy = activeStrategies[0]
  const [selection, setSelection] = useState<StrategyTreeSelection>(() =>
    firstStrategy
      ? {
          kind: 'strategy',
          productId: firstStrategy.productId,
          materialTypeId: firstStrategy.materialTypeId,
          strategyId: firstStrategy.id,
        }
      : { kind: 'all' },
  )
  const [clipboardStrategyId, setClipboardStrategyId] = useState('')
  const [showPresetManager, setShowPresetManager] = useState(false)
  const [showSopCenter, setShowSopCenter] = useState(false)
  const [sopCenterSelectedId, setSopCenterSelectedId] = useState<string | undefined>(undefined)

  // SOP 后台生成完成后的「查看结果」跳转：重新打开 SOP 管理中心并选中该 SOP
  const sopCenterJump = useStore((state) => state.sopCenterJump)
  useEffect(() => {
    if (!sopCenterJump) return
    setSopCenterSelectedId(sopCenterJump.itemId)
    setShowSopCenter(true)
  }, [sopCenterJump])

  const selectedStrategyId = selection.kind === 'strategy' ? selection.strategyId : undefined
  const selectedStrategy = activeStrategies.find((item) => item.id === selectedStrategyId)

  /** SOP 管理中心「应用 SOP」：把所选 SOP 应用到当前策略（策略侧只引用，正文在 SOP 库管理）。 */
  const applySopToStrategy = (item: SopLibraryItem) => {
    if (!selectedStrategy) return
    saveStrategy({
      ...selectedStrategy,
      workflow: {
        ...selectedStrategy.workflow,
        sop: {
          resolved: true,
          mode: 'preset',
          presetId: item.id,
          name: item.name,
          description: item.description,
          content: item.content,
        },
      },
      status: 'draft',
    })
    setSopCenterSelectedId(item.id)
    useStore.getState().showToast(`已应用 SOP「${item.name}」到当前策略`, 'success')
  }

  /** SOP 管理中心「取消应用」：清除当前策略的 SOP 引用。 */
  const clearStrategySop = () => {
    if (!selectedStrategy) return
    saveStrategy({
      ...selectedStrategy,
      workflow: { ...selectedStrategy.workflow, sop: { resolved: false, mode: 'none', content: '' } },
      status: 'draft',
    })
    setSopCenterSelectedId(undefined)
    useStore.getState().showToast('已取消当前策略的 SOP', 'info')
  }
  const sopGenerationContext = useMemo(() => {
    if (!selectedStrategy) return undefined
    return {
      product: catalog.products.find((item) => item.id === selectedStrategy.productId)?.name,
      materialType: catalog.materialTypes.find((item) => item.id === selectedStrategy.materialTypeId)?.name,
      generationMode:
        selectedStrategy.generationMode === 'text-to-image'
          ? '文生图'
          : selectedStrategy.generationMode === 'image-to-image'
            ? '图生图'
            : undefined,
    }
  }, [catalog, selectedStrategy])
  const visibleStrategies = activeStrategies.filter((strategy) => {
    if (selection.kind === 'all') return true
    if (selection.kind === 'product') return strategy.productId === selection.productId
    if (selection.kind === 'type')
      return strategy.productId === selection.productId && strategy.materialTypeId === selection.materialTypeId
    return strategy.productId === selection.productId && strategy.materialTypeId === selection.materialTypeId
  })
  const testOrders = orders
    .filter(
      (order) =>
        order.isTest &&
        order.strategyId === selectedStrategyId &&
        (user?.role === 'admin' || order.createdBy === sessionUserId),
    )
    .sort((left, right) => right.createdAt - left.createdAt)
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const generatedImageIds = testOrders.flatMap((order) =>
    order.units.flatMap((unit) => (unit.taskId ? (taskById.get(unit.taskId)?.outputImages ?? []) : [])),
  )

  const targetHierarchy = () => {
    if (selection.kind === 'type' || selection.kind === 'strategy')
      return { productId: selection.productId, materialTypeId: selection.materialTypeId }
    if (selection.kind === 'product')
      return {
        productId: selection.productId,
        materialTypeId: catalog.materialTypes.find((item) => !item.archived)?.id ?? '',
      }
    return {
      productId: catalog.products.find((item) => !item.archived)?.id ?? '',
      materialTypeId: catalog.materialTypes.find((item) => !item.archived)?.id ?? '',
    }
  }
  const handleCreate = () => {
    const target = targetHierarchy()
    if (!target.productId || !target.materialTypeId) return
    const createdId = createStrategy(target.productId, target.materialTypeId)
    if (createdId) {
      setSelection({ kind: 'strategy', ...target, strategyId: createdId })
      useStore.getState().showToast('策略已创建', 'success')
    }
  }
  const handlePaste = () => {
    if (!clipboardStrategyId) return
    try {
      const target = targetHierarchy()
      const createdId = duplicateStrategy(clipboardStrategyId, target.productId, target.materialTypeId)
      if (createdId) {
        setSelection({ kind: 'strategy', ...target, strategyId: createdId })
        useStore.getState().showToast('已粘贴策略到目标位置', 'success')
      }
    } catch {
      useStore.getState().showToast('粘贴失败，请重试', 'error')
    }
  }

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'c' && selectedStrategyId) {
        event.preventDefault()
        setClipboardStrategyId(selectedStrategyId)
        useStore.getState().showToast('已复制策略，可粘贴到目标位置', 'success')
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'v' && clipboardStrategyId) {
        event.preventDefault()
        handlePaste()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [clipboardStrategyId, selectedStrategyId, selection])

  const importLocalImages = async (multiple = false) => {
    const api = window.electronAPI
    if (!api?.readImageFile) return []
    const paths = multiple
      ? await api.selectFiles?.([{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }])
      : [await api.selectFile?.([{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }])]
    const validPaths = (paths ?? []).filter((path): path is string => Boolean(path))
    const imageIds: string[] = []
    for (const path of validPaths) {
      const image = await api.readImageFile(path)
      if (!image) continue
      const imageId = await storeImage(image.dataUrl, 'upload')
      cacheImage(imageId, image.dataUrl)
      imageIds.push(imageId)
    }
    return imageIds
  }

  const pickKnowledgeMaterial = async (batchId: string) => {
    const batch = knowledgeBatches.find((item) => item.id === batchId)
    const api = window.electronAPI
    if (!batch || !api?.readImageFile) return []
    const files = api.listCompositeBackgroundFiles
      ? await api.listCompositeBackgroundFiles(batch.folderPath, true)
      : await api.listImageFiles(batch.folderPath)
    const imageIds: string[] = []
    for (const file of files.slice(0, 4)) {
      const image = await api.readImageFile(file.path)
      if (!image) continue
      const imageId = await storeImage(image.dataUrl, 'upload')
      cacheImage(imageId, image.dataUrl)
      imageIds.push(imageId)
    }
    return imageIds
  }

  return (
    <div className="relative h-[calc(100vh-64px)] min-h-[620px] w-full overflow-hidden bg-ds-surface text-ds-text dark:bg-ds-scrim dark:text-ds-text-subtle">
      <div className="strategy-workspace-grid grid h-full min-h-0 w-full">
        <StrategyTree
          catalog={catalog}
          strategies={activeStrategies}
          selection={selection}
          onSelect={setSelection}
          onRenameProduct={(id, name) => {
            const product = catalog.products.find((item) => item.id === id)
            if (product) {
              saveProduct({ ...product, name, version: product.version + 1 })
              useStore.getState().showToast('产品已重命名', 'success')
            }
          }}
          onRenameType={(id, name) => {
            const materialType = catalog.materialTypes.find((item) => item.id === id)
            if (materialType) {
              saveMaterialType({ ...materialType, name, version: materialType.version + 1 })
              useStore.getState().showToast('素材类型已重命名', 'success')
            }
          }}
          onRenameStrategy={(id, name) => {
            const strategy = activeStrategies.find((item) => item.id === id)
            if (strategy) {
              saveStrategy({ ...strategy, name })
              useStore.getState().showToast('策略已重命名', 'success')
            }
          }}
          onCreateStrategy={(productId, materialTypeId) => {
            const createdId = createStrategy(productId, materialTypeId)
            if (createdId) {
              setSelection({ kind: 'strategy', productId, materialTypeId, strategyId: createdId })
              useStore.getState().showToast('策略已创建', 'success')
            }
          }}
          onMoveStrategy={(strategyIdToMove, productId, materialTypeId) => {
            moveStrategy(strategyIdToMove, productId, materialTypeId)
            setSelection({ kind: 'strategy', productId, materialTypeId, strategyId: strategyIdToMove })
            useStore.getState().showToast('策略已移动', 'success')
          }}
        />
        <div className="relative min-w-0">
          <StrategyGrid
            catalog={catalog}
            strategies={visibleStrategies}
            selectedStrategyId={selectedStrategyId}
            orders={orders.filter((order) => user?.role === 'admin' || order.createdBy === sessionUserId)}
            tasks={tasks}
            ImageComponent={StoreStrategyImage}
            canPaste={Boolean(clipboardStrategyId)}
            headerActions={
              <>
                <button
                  type="button"
                  onClick={() => setShowSopCenter(true)}
                  className="flex h-ds-control-lg cursor-pointer items-center gap-2 rounded-ds-lg border border-ds-border/80 bg-ds-surface px-3 text-xs font-medium text-ds-text shadow-sm transition hover:bg-ds-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus dark:border-ds-border dark:bg-ds-surface dark:text-ds-text-subtle dark:hover:bg-ds-surface"
                >
                  <BookOpenCheck size={14} className="text-ds-primary" />
                  SOP 库
                </button>
                {user?.role === 'admin' && (
                  <button
                    type="button"
                    onClick={() => setShowPresetManager(true)}
                    className="flex h-ds-control-lg cursor-pointer items-center gap-2 rounded-ds-lg border border-ds-border/80 bg-ds-surface px-3 text-xs font-medium text-ds-text shadow-sm transition hover:bg-ds-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus dark:border-ds-border dark:bg-ds-surface dark:text-ds-text-subtle dark:hover:bg-ds-surface"
                  >
                    <Settings2 size={14} />
                    输出预设
                  </button>
                )}
              </>
            }
            onSelectStrategy={(strategyIdToSelect) => {
              const strategy = activeStrategies.find((item) => item.id === strategyIdToSelect)
              if (strategy)
                setSelection({
                  kind: 'strategy',
                  productId: strategy.productId,
                  materialTypeId: strategy.materialTypeId,
                  strategyId: strategy.id,
                })
            }}
            onCreate={handleCreate}
            onRename={(id, name) => {
              const strategy = activeStrategies.find((item) => item.id === id)
              if (strategy) saveStrategy({ ...strategy, name })
            }}
            onCopy={(id) => {
              setClipboardStrategyId(id)
              useStore.getState().showToast('已复制策略，可粘贴到目标位置', 'success')
            }}
            onPaste={handlePaste}
            onArchive={(id) => {
              archiveStrategy(id)
              if (id === selectedStrategyId) setSelection({ kind: 'all' })
              useStore.getState().showToast('策略已归档', 'success')
            }}
            onChangeCover={(id, imageId) => {
              const strategy = activeStrategies.find((item) => item.id === id)
              if (strategy) saveStrategy({ ...strategy, coverImageId: imageId })
            }}
            onPickLocalCover={async (id) => {
              try {
                const [imageId] = await importLocalImages(false)
                const strategy = activeStrategies.find((item) => item.id === id)
                if (strategy && imageId) {
                  saveStrategy({ ...strategy, coverImageId: imageId })
                  useStore.getState().showToast('封面已更新', 'success')
                }
              } catch {
                useStore.getState().showToast('图片读取失败，请重试', 'error')
              }
            }}
            onSavePromptOverride={(id, imageId, prompt) => {
              const strategy = activeStrategies.find((item) => item.id === id)
              if (strategy)
                saveStrategy({
                  ...strategy,
                  resultPromptOverrides: { ...strategy.resultPromptOverrides, [imageId]: prompt },
                })
            }}
            onReusePrompt={(id, prompt) => {
              const strategy = activeStrategies.find((item) => item.id === id)
              if (strategy) {
                saveStrategy({ ...strategy, workflow: { ...strategy.workflow, instruction: prompt }, status: 'draft' })
                setSelection({
                  kind: 'strategy',
                  productId: strategy.productId,
                  materialTypeId: strategy.materialTypeId,
                  strategyId: strategy.id,
                })
              }
            }}
          />
        </div>
        <StrategyEditor
          strategy={selectedStrategy}
          catalog={catalog}
          presets={presets}
          sopItems={sopLibrary}
          sopGroups={sopGroups}
          versions={selectedStrategyId ? (strategyVersions[selectedStrategyId] ?? []) : []}
          knowledgeBatches={knowledgeBatches}
          knowledgeInsights={knowledgeInsights}
          generatedImageIds={generatedImageIds}
          testOrders={testOrders}
          role={user?.role ?? 'strategist'}
          onSave={saveStrategy}
          onTest={(strategyIdToTest, quantity) => createTest(strategyIdToTest, quantity)}
          onPickLocalReference={() => importLocalImages(true)}
          onPickKnowledgeMaterial={pickKnowledgeMaterial}
          onRollback={(version) => selectedStrategyId && rollbackStrategy(selectedStrategyId, version)}
          onManageSopLibrary={() => setShowSopCenter(true)}
        />
      </div>
      {showPresetManager && (
        <PresetManager
          presets={presets.filter((preset) => preset.type === 'export' || preset.type === 'allocation')}
          onSave={savePreset}
          onArchive={archivePreset}
          onClose={() => setShowPresetManager(false)}
        />
      )}
      {showSopCenter && (
        <SopManagementCenter
          groups={sopGroups}
          items={sopLibrary}
          tasks={tasks}
          metaInstructions={sopMetaInstructions}
          currentUserId={sessionUserId ?? 'user-admin'}
          onSaveGroup={saveSopGroup}
          onDuplicateGroup={duplicateSopGroup}
          onDeleteGroup={deleteSopGroup}
          onSaveItem={saveSopItem}
          onDuplicateItem={duplicateSopItem}
          onDeleteItem={deleteSopItem}
          onSaveMetaInstruction={saveSopMetaInstruction}
          onDuplicateMetaInstruction={duplicateSopMetaInstruction}
          onDeleteMetaInstruction={deleteSopMetaInstruction}
          onGenerateSop={generateSopFromStore}
          onTestSopRevision={testSopRevisionFromStore}
          sopVersionHistory={sopVersionHistory}
          generationContext={sopGenerationContext}
          selectedSopId={
            selectedStrategy?.workflow.sop.mode === 'preset'
              ? selectedStrategy.workflow.sop.presetId
              : sopCenterSelectedId
          }
          onApply={applySopToStrategy}
          onClear={clearStrategySop}
          onClose={() => setShowSopCenter(false)}
        />
      )}
    </div>
  )
}
