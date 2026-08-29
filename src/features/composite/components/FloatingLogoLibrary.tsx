import React, { type ReactNode, useState, useMemo } from 'react'
import { Edit2Icon as Edit2, PlusIcon as Plus, RefreshIcon, TrashIcon as Trash2 } from '../../../design-system/icons'
import { useTooltip } from '../../../hooks/useTooltip'
import ViewportTooltip from '../../../components/ViewportTooltip'
import type { CompositeFsImage } from '../lib/compositeTypes'
import { useAppDialog } from '../../../hooks/useAppDialog'

type FloatingLogoLibraryProps = {
  path: string
  assets: CompositeFsImage[]
  statusText: string
  isRefreshing?: boolean
  assetsDisabled?: boolean
  assetDisabledReason?: string
  variant?: 'floating' | 'sidebar'
  onSelectFolder: () => void
  onRefresh: () => void
  onPickAsset: (asset: CompositeFsImage) => void
  onDeleteAsset?: (asset: CompositeFsImage) => void
  onRenameAsset?: (asset: CompositeFsImage, newName: string) => void
  onReorderAssets?: (assets: CompositeFsImage[]) => void
  onImportFiles?: (files: FileList) => void
}

type IconActionButtonProps = {
  tooltip: string
  ariaLabel: string
  onClick: () => void
  children: ReactNode
}

function IconActionButton({ tooltip, ariaLabel, onClick, children }: IconActionButtonProps) {
  const tooltipState = useTooltip()

  return (
    <span className="relative inline-flex" {...tooltipState.handlers}>
      <button
        type="button"
        aria-label={ariaLabel}
        title={tooltip}
        onClick={() => {
          tooltipState.dismiss()
          onClick()
        }}
        className="inline-flex h-ds-control-sm w-ds-control-sm items-center justify-center rounded-md border border-ds-border text-ds-muted transition hover:bg-ds-primary-subtle hover:text-ds-primary dark:border-ds-border dark:text-ds-muted dark:hover:bg-ds-primary/10 dark:hover:text-ds-primary"
      >
        {children}
      </button>
      <ViewportTooltip visible={tooltipState.visible} className="whitespace-nowrap">
        {tooltip}
      </ViewportTooltip>
    </span>
  )
}

export function FloatingLogoLibrary({
  path,
  assets,
  statusText,
  isRefreshing = false,
  assetsDisabled = false,
  assetDisabledReason = '请先选择预设以插入该 LOGO',
  variant = 'floating',
  onSelectFolder,
  onRefresh,
  onPickAsset,
  onDeleteAsset,
  onRenameAsset,
  onReorderAssets,
  onImportFiles,
}: FloatingLogoLibraryProps) {
  const { openConfirmDialog } = useAppDialog()
  const [searchQuery, setSearchQuery] = useState('')
  const [draggingAssetId, setDraggingAssetId] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)
  const [editingAssetId, setEditingAssetId] = useState('')
  const [editingName, setEditingName] = useState('')

  const filteredAssets = useMemo(() => {
    if (!searchQuery.trim()) return assets
    const lowerQuery = searchQuery.toLowerCase()
    return assets.filter((asset) => asset.name.toLowerCase().includes(lowerQuery))
  }, [assets, searchQuery])
  return (
    <aside
      data-layout={variant === 'sidebar' ? 'logo-sidebar' : 'floating-logo-library'}
      className={
        variant === 'sidebar'
          ? 'flex h-full min-h-0 w-full flex-col overflow-hidden bg-ds-surface dark:bg-ds-scrim'
          : 'absolute inset-y-4 right-4 z-20 flex w-72 flex-col overflow-hidden rounded-md border border-ds-border bg-ds-surface/95 shadow-xl backdrop-blur dark:border-ds-border dark:bg-ds-scrim/90'
      }
    >
      <div className="flex items-center justify-between border-b border-ds-border px-3 py-2 dark:border-ds-border">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-ds-text dark:text-ds-text-subtle">LOGO 库</h3>
          <p className="truncate text-xs text-ds-muted dark:text-ds-muted">{statusText}</p>
        </div>
        <div className="ml-3 flex shrink-0 items-center gap-1.5">
          <IconActionButton tooltip="添加 LOGO 到项目" ariaLabel="Add logos to project" onClick={onSelectFolder}>
            <Plus className="h-4 w-4" />
          </IconActionButton>
        </div>
      </div>

      <div className="border-b border-ds-border px-3 py-2 dark:border-ds-border">
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="搜索 LOGO 名称..."
          aria-label="搜索 LOGO"
          className="w-full rounded-md border border-ds-border bg-ds-surface px-2 py-1.5 text-xs text-ds-text outline-none transition focus:border-ds-primary focus:ring-2 focus:ring-ds-focus/10 dark:border-ds-border dark:bg-ds-scrim dark:text-ds-text-subtle"
        />
      </div>

      <div
        className={`grid min-h-0 flex-1 grid-cols-3 content-start gap-2 overflow-y-auto p-3 transition-colors ${isDragOver ? 'bg-ds-primary-subtle/50 dark:bg-ds-primary/10' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragOver(true)
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragOver(false)

          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            onImportFiles?.(e.dataTransfer.files)
            return
          }

          const draggedPath = e.dataTransfer.getData('application/x-doupao-logo-asset')
          if (!draggedPath || !onReorderAssets) return

          const targetElement = (e.target as HTMLElement).closest('[data-asset-path]')
          if (!targetElement) return

          const targetPath = targetElement.getAttribute('data-asset-path')
          if (!targetPath || targetPath === draggedPath) return

          const newAssets = [...assets]
          const sourceIndex = newAssets.findIndex((a) => a.path === draggedPath)
          const targetIndex = newAssets.findIndex((a) => a.path === targetPath)

          if (sourceIndex >= 0 && targetIndex >= 0) {
            const [item] = newAssets.splice(sourceIndex, 1)
            newAssets.splice(targetIndex, 0, item!)
            onReorderAssets(newAssets)
          }
        }}
      >
        {filteredAssets.length > 0 ? (
          filteredAssets.map((asset) => (
            <div
              key={asset.path}
              data-asset-path={asset.path}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-doupao-logo-asset', asset.path)
                e.dataTransfer.effectAllowed = 'move'
                setDraggingAssetId(asset.path)
              }}
              onDragEnd={() => setDraggingAssetId('')}
              className={`group relative min-w-0 rounded-md border border-ds-border bg-ds-surface p-1.5 transition dark:border-ds-border dark:bg-ds-surface ${draggingAssetId === asset.path ? 'opacity-50' : ''} ${
                assetsDisabled
                  ? 'cursor-not-allowed opacity-60'
                  : 'hover:border-ds-primary/35 hover:bg-ds-primary-subtle dark:hover:bg-ds-primary/10 cursor-pointer'
              }`}
              title={assetsDisabled ? assetDisabledReason : asset.path}
            >
              <button
                type="button"
                disabled={assetsDisabled}
                onClick={() => {
                  if (!editingAssetId) onPickAsset(asset)
                }}
                onContextMenu={(e) => e.preventDefault()}
                aria-label={assetsDisabled ? `${asset.name} unavailable until a preset is selected` : asset.name}
                className="block w-full text-left outline-none"
              >
                {asset.dataUrl ? (
                  <img
                    src={asset.dataUrl}
                    alt={asset.name}
                    className="aspect-square w-full rounded-md object-contain"
                    draggable={false}
                    onContextMenu={(e) => e.preventDefault()}
                  />
                ) : (
                  <div
                    className="aspect-square rounded-md bg-ds-subtle dark:bg-ds-subtle"
                    onContextMenu={(e) => e.preventDefault()}
                  />
                )}
                {editingAssetId === asset.path ? (
                  <input
                    autoFocus
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => {
                      if (onRenameAsset && editingName.trim() && editingName !== asset.name) {
                        onRenameAsset(asset, editingName.trim())
                      }
                      setEditingAssetId('')
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        if (onRenameAsset && editingName.trim() && editingName !== asset.name) {
                          onRenameAsset(asset, editingName.trim())
                        }
                        setEditingAssetId('')
                      } else if (e.key === 'Escape') {
                        setEditingAssetId('')
                      }
                    }}
                    className="mt-1 w-full rounded border border-ds-primary/35 bg-ds-surface px-1 py-0.5 text-xs text-ds-text outline-none dark:bg-ds-scrim dark:text-ds-text-subtle"
                  />
                ) : (
                  <div
                    className="mt-1 truncate text-xs text-ds-muted dark:text-ds-muted"
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      setEditingAssetId(asset.path)
                      setEditingName(asset.name)
                    }}
                  >
                    {asset.name}
                  </div>
                )}
              </button>

              {onRenameAsset && (
                <button
                  type="button"
                  title="修改名称"
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditingAssetId(asset.path)
                    setEditingName(asset.name)
                  }}
                  className="absolute right-6 -top-2 hidden h-6 w-6 items-center justify-center rounded-full border border-ds-border bg-ds-surface text-ds-muted shadow-sm hover:bg-ds-subtle hover:text-ds-primary group-hover:flex dark:border-ds-border dark:bg-ds-subtle dark:text-ds-muted dark:hover:bg-ds-subtle dark:hover:text-ds-primary"
                >
                  <Edit2 className="h-3.5 w-3.5" />
                </button>
              )}

              {onDeleteAsset && (
                <button
                  type="button"
                  title="删除 LOGO"
                  onClick={(e) => {
                    e.stopPropagation()
                    openConfirmDialog({
                      title: '删除 LOGO？',
                      message: `将从素材库中删除「${asset.name}」，此操作不可撤销。`,
                      confirmText: '确认删除',
                      tone: 'danger',
                      action: () => onDeleteAsset(asset),
                    })
                  }}
                  className="absolute -right-2 -top-2 hidden h-6 w-6 items-center justify-center rounded-full border border-ds-border bg-ds-surface text-ds-danger shadow-sm hover:bg-ds-danger-subtle group-hover:flex dark:border-ds-border dark:bg-ds-subtle dark:text-ds-danger dark:hover:bg-ds-subtle"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))
        ) : (
          <div className="col-span-3 flex min-h-24 items-center justify-center rounded-md border border-dashed border-ds-border px-3 text-center text-xs text-ds-muted dark:border-ds-border dark:text-ds-muted">
            {searchQuery ? '没有找到匹配的 LOGO' : '点击右上角 + 或拖拽图片到此处添加 LOGO'}
          </div>
        )}
      </div>
    </aside>
  )
}
