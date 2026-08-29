import { useEffect, useState } from 'react'
import {
  ChevronDownIcon as ChevronDown,
  ChevronRightIcon as ChevronRight,
  FileTextIcon as FileText,
  FolderIcon as Folder,
  FolderOpenIcon as FolderOpen,
  Layers3Icon as Layers3,
  PlusIcon as Plus,
  SearchIcon as Search,
} from '../../design-system/icons'
import type { StrategyCatalog as RequirementCatalog } from './contracts'
import type { StrategyAsset } from './types'

export type StrategyTreeSelection =
  | { kind: 'all' }
  | { kind: 'product'; productId: string }
  | { kind: 'type'; productId: string; materialTypeId: string }
  | { kind: 'strategy'; productId: string; materialTypeId: string; strategyId: string }

function isSelected(selection: StrategyTreeSelection, kind: StrategyTreeSelection['kind'], id?: string) {
  if (selection.kind !== kind) return false
  if (kind === 'all') return true
  if (kind === 'product') return selection.kind === 'product' && selection.productId === id
  if (kind === 'type') return selection.kind === 'type' && selection.materialTypeId === id
  return selection.kind === 'strategy' && selection.strategyId === id
}

function InlineName({
  value,
  editing,
  onBegin,
  onCommit,
}: {
  value: string
  editing: boolean
  onBegin: () => void
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  if (!editing) {
    return (
      <span
        onDoubleClick={(event) => {
          event.stopPropagation()
          onBegin()
        }}
        className="min-w-0 flex-1 truncate"
      >
        {value}
      </span>
    )
  }
  return (
    <input
      autoFocus
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onBlur={() => onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCommit(draft)
        if (event.key === 'Escape') onCommit(value)
      }}
      className="h-ds-control-sm min-w-0 flex-1 rounded-lg border border-ds-primary bg-ds-surface px-2 text-sm outline-none ring-2 ring-ds-focus dark:bg-ds-scrim dark:ring-ds-focus"
    />
  )
}

export default function StrategyTree({
  catalog,
  strategies,
  selection,
  onSelect,
  onRenameProduct,
  onRenameType,
  onRenameStrategy,
  onCreateStrategy,
  onMoveStrategy,
}: {
  catalog: RequirementCatalog
  strategies: StrategyAsset[]
  selection: StrategyTreeSelection
  onSelect: (selection: StrategyTreeSelection) => void
  onRenameProduct: (id: string, name: string) => void
  onRenameType: (id: string, name: string) => void
  onRenameStrategy: (id: string, name: string) => void
  onCreateStrategy: (productId: string, materialTypeId: string) => void
  onMoveStrategy: (strategyId: string, productId: string, materialTypeId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [expandedProducts, setExpandedProducts] = useState(() => new Set(catalog.products.map((item) => item.id)))
  const [expandedTypes, setExpandedTypes] = useState(
    () =>
      new Set(catalog.products.flatMap((product) => catalog.materialTypes.map((item) => `${product.id}:${item.id}`))),
  )
  const [editingKey, setEditingKey] = useState('')
  const [dropTarget, setDropTarget] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase()

  const toggleSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => {
    setter((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-ds-border/80 bg-ds-surface/70 backdrop-blur dark:border-ds-border dark:bg-ds-scrim/70">
      <div className="border-b border-ds-border/80 p-4 dark:border-ds-border">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ds-text dark:text-white">策略库</h2>
            <p className="mt-1 text-xs text-ds-muted">按 SKU 与素材类型管理</p>
          </div>
          <span className="rounded-md bg-ds-subtle px-2 py-1 text-xs tabular-nums text-ds-muted dark:bg-ds-subtle dark:text-ds-muted">
            {strategies.length}
          </span>
        </div>
        <label className="mt-3 flex h-ds-control-lg items-center gap-2 rounded-ds-lg border border-ds-border/80 bg-ds-surface/80 px-3 transition focus-within:border-ds-primary focus-within:bg-ds-surface focus-within:ring-2 focus-within:ring-ds-focus dark:border-ds-border dark:bg-ds-surface dark:focus-within:border-ds-primary/60 dark:focus-within:bg-ds-surface dark:focus-within:ring-ds-focus">
          <Search size={14} className="text-ds-muted" aria-hidden="true" />
          <span className="sr-only">搜索策略库</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索 SKU、类型或策略"
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-ds-muted"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2.5" role="tree" aria-label="策略库层级">
        <button
          onClick={() => onSelect({ kind: 'all' })}
          className={`mb-1 flex h-ds-control-lg w-full cursor-pointer items-center gap-2 rounded-ds-lg px-3 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus ${isSelected(selection, 'all') ? 'bg-ds-primary-subtle font-medium text-ds-primary shadow-sm ring-1 ring-ds-focus dark:bg-ds-primary/10 dark:text-ds-primary dark:ring-ds-focus/20' : 'text-ds-text hover:bg-ds-subtle dark:text-ds-text-subtle dark:hover:bg-ds-surface'}`}
          role="treeitem"
        >
          <Layers3 size={15} aria-hidden="true" />
          全部策略
        </button>
        {catalog.products
          .filter((product) => !product.archived)
          .map((product) => {
            const productStrategies = strategies.filter((item) => item.productId === product.id)
            const productMatches =
              !normalizedQuery ||
              product.name.toLocaleLowerCase().includes(normalizedQuery) ||
              productStrategies.some((item) => item.name.toLocaleLowerCase().includes(normalizedQuery))
            if (!productMatches) return null
            const productExpanded = expandedProducts.has(product.id)
            return (
              <div key={product.id} role="treeitem" aria-expanded={productExpanded}>
                <div
                  className={`group flex h-ds-control-lg items-center rounded-ds-lg pr-1 transition ${isSelected(selection, 'product', product.id) ? 'bg-ds-primary-subtle text-ds-primary shadow-sm ring-1 ring-ds-focus dark:bg-ds-primary/10 dark:text-ds-primary dark:ring-ds-focus/20' : 'text-ds-text hover:bg-ds-subtle dark:text-ds-text-subtle dark:hover:bg-ds-surface'}`}
                >
                  <button
                    onClick={() => toggleSet(setExpandedProducts, product.id)}
                    aria-label={`${productExpanded ? '折叠' : '展开'}${product.name}`}
                    className="flex h-ds-control-md w-8 cursor-pointer items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus"
                  >
                    {productExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  <button
                    onClick={() => onSelect({ kind: 'product', productId: product.id })}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-sm focus-visible:outline-none"
                  >
                    {productExpanded ? (
                      <FolderOpen size={15} className="text-ds-warning" />
                    ) : (
                      <Folder size={15} className="text-ds-warning" />
                    )}
                    <InlineName
                      value={product.name}
                      editing={editingKey === `product:${product.id}`}
                      onBegin={() => setEditingKey(`product:${product.id}`)}
                      onCommit={(name) => {
                        setEditingKey('')
                        if (name.trim()) onRenameProduct(product.id, name.trim())
                      }}
                    />
                    <span className="text-xs tabular-nums text-ds-muted">{productStrategies.length}</span>
                  </button>
                </div>
                {productExpanded && (
                  <div className="ml-4 border-l border-ds-border pl-2 dark:border-ds-border-strong" role="group">
                    {catalog.materialTypes
                      .filter((type) => !type.archived)
                      .map((materialType) => {
                        const typeStrategies = productStrategies.filter(
                          (item) => item.materialTypeId === materialType.id,
                        )
                        const typeMatches =
                          !normalizedQuery ||
                          product.name.toLocaleLowerCase().includes(normalizedQuery) ||
                          materialType.name.toLocaleLowerCase().includes(normalizedQuery) ||
                          typeStrategies.some((item) => item.name.toLocaleLowerCase().includes(normalizedQuery))
                        if (!typeMatches) return null
                        const typeExpanded = expandedTypes.has(`${product.id}:${materialType.id}`)
                        const targetKey = `${product.id}:${materialType.id}`
                        return (
                          <div key={targetKey} role="treeitem" aria-expanded={typeExpanded}>
                            <div
                              onDragOver={(event) => {
                                event.preventDefault()
                                setDropTarget(targetKey)
                              }}
                              onDragLeave={() => setDropTarget('')}
                              onDrop={(event) => {
                                event.preventDefault()
                                setDropTarget('')
                                const strategyId = event.dataTransfer.getData('application/x-strategy-id')
                                if (strategyId) onMoveStrategy(strategyId, product.id, materialType.id)
                              }}
                              className={`group flex min-h-ds-control-md items-center rounded-lg pr-1 transition ${dropTarget === targetKey ? 'bg-ds-primary-subtle ring-2 ring-ds-focus dark:bg-ds-primary/20' : isSelected(selection, 'type', materialType.id) && selection.kind === 'type' && selection.productId === product.id ? 'bg-ds-primary-subtle text-ds-primary dark:bg-ds-primary/10 dark:text-ds-primary' : 'text-ds-muted hover:bg-ds-subtle dark:text-ds-muted dark:hover:bg-ds-surface'}`}
                            >
                              <button
                                onClick={() => toggleSet(setExpandedTypes, targetKey)}
                                aria-label={`${typeExpanded ? '折叠' : '展开'}${materialType.name}`}
                                className="flex h-ds-control-sm w-7 cursor-pointer items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus"
                              >
                                {typeExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                              </button>
                              <button
                                onClick={() =>
                                  onSelect({ kind: 'type', productId: product.id, materialTypeId: materialType.id })
                                }
                                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-xs focus-visible:outline-none"
                              >
                                <Folder size={14} className="text-ds-primary" />
                                <InlineName
                                  value={materialType.name}
                                  editing={editingKey === `type:${materialType.id}`}
                                  onBegin={() => setEditingKey(`type:${materialType.id}`)}
                                  onCommit={(name) => {
                                    setEditingKey('')
                                    if (name.trim()) onRenameType(materialType.id, name.trim())
                                  }}
                                />
                                <span className="text-xs tabular-nums text-ds-muted">{typeStrategies.length}</span>
                              </button>
                              <button
                                onClick={() => onCreateStrategy(product.id, materialType.id)}
                                aria-label={`在${materialType.name}中新建策略`}
                                title="新建策略"
                                className="flex h-ds-control-sm w-ds-control-sm cursor-pointer items-center justify-center rounded opacity-0 transition hover:bg-ds-surface group-hover:opacity-100 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus dark:hover:bg-ds-subtle"
                              >
                                <Plus size={13} />
                              </button>
                            </div>
                            {typeExpanded && (
                              <div
                                className="ml-4 border-l border-ds-border pl-2 dark:border-ds-border-strong"
                                role="group"
                              >
                                {typeStrategies.map((strategy) => (
                                  <button
                                    key={strategy.id}
                                    draggable
                                    onDragStart={(event) => {
                                      event.dataTransfer.effectAllowed = 'move'
                                      event.dataTransfer.setData('application/x-strategy-id', strategy.id)
                                    }}
                                    onClick={() =>
                                      onSelect({
                                        kind: 'strategy',
                                        productId: product.id,
                                        materialTypeId: materialType.id,
                                        strategyId: strategy.id,
                                      })
                                    }
                                    className={`flex min-h-ds-control-md w-full cursor-grab items-center gap-2 rounded-lg px-2.5 text-left text-xs transition active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus ${isSelected(selection, 'strategy', strategy.id) ? 'bg-ds-primary font-medium text-ds-text-inverse shadow-sm' : 'text-ds-muted hover:bg-ds-subtle dark:text-ds-muted dark:hover:bg-ds-surface'}`}
                                    role="treeitem"
                                  >
                                    <FileText size={13} aria-hidden="true" />
                                    <InlineName
                                      value={strategy.name}
                                      editing={editingKey === `strategy:${strategy.id}`}
                                      onBegin={() => setEditingKey(`strategy:${strategy.id}`)}
                                      onCommit={(name) => {
                                        setEditingKey('')
                                        if (name.trim()) onRenameStrategy(strategy.id, name.trim())
                                      }}
                                    />
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                  </div>
                )}
              </div>
            )
          })}
      </div>
      <div className="border-t border-ds-border/80 px-4 py-2.5 text-xs leading-4 text-ds-muted dark:border-ds-border">
        双击重命名 · 拖到素材类型可移动
      </div>
    </aside>
  )
}
