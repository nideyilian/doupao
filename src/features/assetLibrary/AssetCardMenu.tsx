import { Fragment, memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { GeneratedAsset } from '../../types'
import { Menu, MenuItem, MenuSeparator } from '../../design-system'
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  FolderIcon,
  FolderOpenIcon,
  StarIcon,
  TrashIcon,
  Wand2Icon,
  WrenchIcon,
} from '../../design-system/icons'
import { assetCommands, getAssetFileName } from '../../lib/assetCommands'
import { copyImageSourceToClipboard, getClipboardFailureMessage } from '../../lib/clipboard'
import { downloadImageEntries } from '../../lib/downloadImages'
import { isCollectionTrashed } from '../../lib/assetLibraryModel'
import { buildCollectionTree } from './AssetLibrarySidebar'
import type { CollectionTreeNode } from '../../lib/assetSidebarUtils'
import { useAssetLibraryStore } from './store'

export interface AssetCardMenuProps {
  x: number
  y: number
  /** 右键命中的素材（单张类操作的基准；若在选区内则以下划线整体选区为批量操作目标） */
  asset: GeneratedAsset
  /** 批量操作目标：右键命中素材在选区内时 = 全部选中素材；否则 = 仅该素材 */
  assetIds?: string[]
  /** 当前查询结果中的素材 id 列表，用于查看器前后浏览 */
  assetIdList?: string[]
  /** 请求打开永久删除确认弹窗（展示引用冲突） */
  onPurgeRequest?: (assetIds: string[]) => void
  /** 以该素材为基准查找相似图片 */
  onFindSimilar?: (assetId: string) => void
  onClose: () => void
}

type MenuView = 'main' | 'collections'

function AssetCardMenuInner({
  asset,
  assetIds = [],
  assetIdList = [],
  onClose,
  onFindSimilar,
  onPurgeRequest,
  x,
  y,
}: AssetCardMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState<MenuView>('main')

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const collections = useAssetLibraryStore((state) => state.collections)
  const assetsById = useAssetLibraryStore((state) => state.assetsById)
  const patchAssets = useAssetLibraryStore((state) => state.patchAssets)

  // 「添加到项目」按真实树状结构展示：仅未删除文件夹，按侧栏同级顺序递归渲染子级
  const collectionTree = useMemo(
    () => buildCollectionTree(collections.filter((item) => !isCollectionTrashed(item))),
    [collections],
  )

  // 批量操作目标：右键命中的素材在选区内 → 整个选区；否则仅该素材（Eagle 式）
  const targetIds = assetIds.length > 0 ? assetIds : [asset.id]
  const multi = targetIds.length > 1
  const targetAssets = targetIds.map((id) => assetsById[id]).filter((item): item is GeneratedAsset => item != null)
  const allFavorite = targetAssets.length > 0 && targetAssets.every((item) => item.favorite)

  const showToast = (message: string, tone: 'success' | 'error' | 'info') => {
    void import('../../store').then(({ useStore }) => useStore.getState().showToast(message, tone))
  }

  const openLightbox = () => {
    const list = assetIdList.length > 0 ? assetIdList : [asset.id]
    useAssetLibraryStore.getState().openViewer(asset.id, list)
    onClose()
  }

  const openDetail = () => {
    useAssetLibraryStore.getState().setActiveAsset(asset.id)
    useAssetLibraryStore.getState().setDetailOpen(true)
    onClose()
  }

  const copyImage = async () => {
    onClose()
    try {
      const { ensureImageCached } = await import('../../store')
      const dataUrl = await ensureImageCached(asset.imageId)
      await copyImageSourceToClipboard(dataUrl ?? '')
      showToast('图片已复制', 'success')
    } catch (error) {
      showToast(getClipboardFailureMessage('复制失败', error), 'error')
    }
  }

  /** 打开文件位置（Electron）：优先树目录副本，回退库原图；与 Ctrl/Cmd+E 同一链路 */
  const revealInExplorer = async () => {
    onClose()
    try {
      const [{ getImage }, { resolveImageRevealPath }, { openInExplorer }] = await Promise.all([
        import('../../lib/db'),
        import('../../lib/imageRevealPath'),
        import('../../lib/localSave'),
      ])
      const image = await getImage(asset.imageId)
      const { useStore } = await import('../../store')
      const targetPath = resolveImageRevealPath(asset.imageId, useStore.getState().tasks, image)
      if (!targetPath) return
      const result = await openInExplorer(targetPath)
      if (!result?.ok) {
        showToast(result?.error ? `打开图片位置失败：${result.error}` : '打开图片位置失败', 'error')
      }
    } catch {
      showToast('打开图片位置失败', 'error')
    }
  }

  const toggleCollection = (collectionId: string) => {
    const allHave = targetAssets.every((item) => item.collectionIds.includes(collectionId))
    const nextAssets = targetAssets.map((item) => ({
      id: item.id,
      collectionIds: allHave
        ? item.collectionIds.filter((id) => id !== collectionId)
        : Array.from(new Set([...item.collectionIds, collectionId])),
    }))
    void Promise.all(nextAssets.map((item) => patchAssets([item.id], { collectionIds: item.collectionIds })))
      .then(() => {
        const collection = collections.find((item) => item.id === collectionId)
        showToast(
          multi
            ? `已${allHave ? '移出' : '加入'}项目「${collection?.name ?? ''}」（${targetIds.length} 张）`
            : `已${allHave ? '移出' : '加入'}项目「${collection?.name ?? ''}」`,
          'success',
        )
      })
      .catch(() => showToast('操作失败，请重试', 'error'))
    onClose()
  }

  const toggleFavorite = () => {
    void patchAssets(targetIds, { favorite: !allFavorite })
      .then(() =>
        showToast(
          multi ? `已${allFavorite ? '取消' : ''}收藏 ${targetIds.length} 张` : `已${allFavorite ? '取消' : ''}收藏`,
          'success',
        ),
      )
      .catch(() => showToast('操作失败，请重试', 'error'))
    onClose()
  }

  const trashAll = () => {
    void assetCommands
      .trashAssets(targetIds)
      .then(() => showToast(multi ? `已移入回收站 ${targetIds.length} 张` : '已移入回收站', 'success'))
      .catch(() => showToast('操作失败，请重试', 'error'))
    onClose()
  }

  const restoreAll = () => {
    void useAssetLibraryStore
      .getState()
      .restoreAssets(targetIds)
      .then(() => showToast(multi ? `已恢复 ${targetIds.length} 张` : '已恢复', 'success'))
      .catch(() => showToast('操作失败，请重试', 'error'))
    onClose()
  }

  const downloadAll = () => {
    onClose()
    if (multi) {
      // Electron：批量导出到文件夹（原生，直接复制本地原图）；浏览器：逐个下载
      void downloadImageEntries(
        targetAssets.map((item) => ({
          imageId: item.imageId,
          fileNameBase: getAssetFileName(item).replace(/\.[^.]+$/, ''),
        })),
      ).then(({ successCount, failCount }) => {
        if (successCount > 0) showToast(`已导出 ${successCount} 张`, 'success')
        if (failCount > 0) showToast(`${failCount} 张素材导出失败`, 'error')
      })
      return
    }
    // 单张：原生保存对话框（Electron）或浏览器下载
    void assetCommands.exportAsset(targetIds[0]!).then((ok) => {
      if (ok) showToast('已导出', 'success')
      else showToast('素材导出失败', 'error')
    })
  }

  const batchLabel = multi ? `（${targetIds.length} 张）` : ''

  /** 递归渲染项目树（Eagle 式层级缩进），点选即加入/移出 */
  const renderCollectionNodes = (nodes: CollectionTreeNode[], depth: number): ReactNode =>
    nodes.map((node) => {
      const allHave = targetAssets.every((item) => item.collectionIds.includes(node.collection.id))
      const someHave = targetAssets.some((item) => item.collectionIds.includes(node.collection.id))
      return (
        <Fragment key={node.collection.id}>
          <MenuItem
            onClick={() => toggleCollection(node.collection.id)}
            className={allHave ? 'text-ds-primary' : undefined}
          >
            <span className="flex w-full items-center justify-between gap-2" style={{ paddingLeft: `${depth * 12}px` }}>
              <span className="truncate">{node.collection.name}</span>
              {allHave && <CheckIcon size={13} />}
              {multi && !allHave && someHave && <span className="text-ds-muted">部分</span>}
            </span>
          </MenuItem>
          {node.children.length > 0 && renderCollectionNodes(node.children, depth + 1)}
        </Fragment>
      )
    })

  return (
    <div
      ref={ref}
      data-testid="asset-card-menu"
      className="fixed z-dropdown w-56 rounded-lg border border-ds-border bg-ds-surface p-1 shadow-lg"
      style={{ left: x, top: y }}
    >
      {view === 'collections' ? (
        <Menu label={multi ? `批量加入项目（${targetIds.length} 张）` : `将素材加入项目：${asset.id}`}>
          <MenuItem
            onClick={() => {
              setView('main')
            }}
          >
            ← 返回
          </MenuItem>
          <MenuSeparator />
          {collectionTree.length === 0 && <MenuItem disabled>暂无项目，请在左侧创建</MenuItem>}
          {renderCollectionNodes(collectionTree, 0)}
        </Menu>
      ) : (
        <Menu label={`素材操作：${asset.id}`}>
          {multi && (
            <>
              <MenuItem disabled>
                <span className="font-medium text-ds-foreground">已选 {targetIds.length} 张素材</span>
              </MenuItem>
              <MenuSeparator />
            </>
          )}
          <MenuItem onClick={openLightbox} icon={<EyeIcon size={14} />}>
            查看大图
          </MenuItem>
          <MenuItem
            onClick={() => {
              onClose()
              onFindSimilar?.(asset.id)
            }}
            icon={<Wand2Icon size={14} />}
          >
            找相似图片
          </MenuItem>
          <MenuItem onClick={() => void copyImage()} icon={<CopyIcon size={14} />}>
            复制图片
          </MenuItem>
          <MenuItem onClick={toggleFavorite} icon={<StarIcon size={14} fill={allFavorite ? 'currentColor' : 'none'} />}>
            {multi
              ? allFavorite
                ? `取消收藏（${targetIds.length} 张）`
                : `收藏（${targetIds.length} 张）`
              : allFavorite
                ? '取消收藏'
                : '收藏'}
          </MenuItem>
          <MenuItem onClick={() => setView('collections')} icon={<FolderIcon size={14} />}>
            添加到项目{batchLabel}
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            onClick={() => {
              // 多选时批量送入全部选中素材（此前只发右键命中的单张，导致"选多少都只进一张"）
              void assetCommands.openInPostprocessBatch(targetIds)
              onClose()
            }}
            icon={<WrenchIcon size={14} />}
          >
            发送到后期处理{batchLabel}
          </MenuItem>
          <MenuItem
            onClick={() => {
              void assetCommands.reuseGenerationConfig(asset.id)
              onClose()
            }}
            icon={<Wand2Icon size={14} />}
          >
            复用提示词与参数
          </MenuItem>
          <MenuItem onClick={downloadAll} icon={<DownloadIcon size={14} />}>
            导出原图{batchLabel}
          </MenuItem>
          <MenuItem onClick={() => void revealInExplorer()} icon={<FolderOpenIcon size={14} />}>
            打开文件位置
          </MenuItem>
          <MenuSeparator />
          {asset.status === 'trashed' ? (
            <>
              <MenuItem onClick={restoreAll}>恢复{batchLabel}</MenuItem>
              <MenuItem
                tone="danger"
                onClick={() => {
                  onClose()
                  onPurgeRequest?.(targetIds)
                }}
              >
                永久删除{batchLabel}
              </MenuItem>
            </>
          ) : (
            <MenuItem tone="danger" onClick={trashAll} icon={<TrashIcon size={14} />}>
              移入回收站{batchLabel}
            </MenuItem>
          )}
        </Menu>
      )}
    </div>
  )
}

export default memo(AssetCardMenuInner)
