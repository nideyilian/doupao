import { useEffect } from 'react'
import { cycleColorLabel } from '../lib/assetLibraryModel'
import { useAssetLibraryStore } from '../features/assetLibrary/store'
import { COLOR_LABEL_NAMES } from '../features/assetLibrary/colorLabels'

/** 快捷键应忽略的交互元素（输入框 / 内容可编辑 / 树节点菜单等） */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"]') ||
    target.isContentEditable ||
    target.closest('[data-no-shortcuts]'),
  )
}

/** 素材焦点元素（卡片 / 列表行 / 批次缩略图）：它们自己处理 Enter/空格，避免全局重复触发 */
function isAssetFocusElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest('[data-asset-card], [data-batch-thumb], [role="row"][data-asset-id]'))
}

/** 文件夹树行焦点：Delete/Backspace/F2/Ctrl+C/X/V 由树行自己处理（Eagle 式），全局层让位 */
function isFolderTreeFocus(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest('[role="treeitem"]'))
}

export interface AssetLibraryShortcutOptions {
  /** Ctrl/Cmd+F 时聚焦搜索框 */
  onFocusSearch?: () => void
  /** Enter 打开查看器：workspace 组装当前浏览列表 */
  onOpenViewer: (assetId: string) => void
}

/**
 * Eagle 式素材库全局快捷键：
 * - 空格：按住快速预览（鼠标悬停的素材优先，无需先点选；无悬停时预览选中素材）
 * - 空格 / Enter：打开查看器（焦点在素材元素上时由元素自身处理）
 * - Esc：取消选择（查看器打开时由查看器处理）
 * - Delete / Backspace：选中素材移入回收站；无选中素材且位于文件夹中时删除当前文件夹
 *   （回收站视图不响应，避免误永久删除；文件夹树行聚焦时由树行处理）
 * - F2：重命名当前文件夹（树行聚焦时由树行处理）
 * - Ctrl/Cmd+N：在当前文件夹下新建子文件夹
 * - 1–5 / 0：对选中素材评分 / 清除评分
 * - F：收藏 / 取消收藏
 * - C：轮换颜色标签（无 → 红…灰 → 无）
 * - Ctrl/Cmd+C / X：复制 / 剪切选中素材到剪贴板
 * - Ctrl/Cmd+V：把剪贴板素材粘贴到当前文件夹（无文件夹 scope 时粘贴为未整理/加入现有项目）
 * - Ctrl/Cmd+A：全选（由 workspace 处理）；Ctrl/Cmd+D：取消全选
 * - Ctrl/Cmd+E：在文件管理器中显示选中素材
 * - Ctrl/Cmd+I：查看素材信息（打开右侧详情面板）
 * - Ctrl/Cmd+Z：撤销；Ctrl/Cmd+Shift+Z / Ctrl+Y：重做
 * - Ctrl/Cmd+F：聚焦搜索框
 */
export function useAssetLibraryShortcuts({ onFocusSearch, onOpenViewer }: AssetLibraryShortcutOptions) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      const key = event.key
      const state = useAssetLibraryStore.getState()

      // Ctrl/Cmd+F：聚焦搜索框
      if ((event.ctrlKey || event.metaKey) && key.toLocaleLowerCase() === 'f') {
        event.preventDefault()
        onFocusSearch?.()
        return
      }
      // 剪贴板与撤销重做（Eagle 式）
      if (event.ctrlKey || event.metaKey) {
        const lower = key.toLocaleLowerCase()
        // 文件夹树行焦点：Ctrl+C/X/V/F2 等由树行自己处理，避免「复制文件夹 + 复制素材」双触发
        if (isFolderTreeFocus(event.target)) return
        if (lower === 'z') {
          event.preventDefault()
          if (event.shiftKey) void state.redo()
          else void state.undo()
          return
        }
        if (lower === 'y') {
          event.preventDefault()
          void state.redo()
          return
        }
        if (lower === 'n') {
          // Eagle 式：Ctrl/Cmd+N 在当前文件夹下新建子文件夹（无文件夹 scope 时在根级新建）
          event.preventDefault()
          const parentId = typeof state.scope === 'object' && state.scope.kind === 'collection' ? state.scope.id : null
          state.setFolderEditRequest({ kind: 'create', parentId })
          return
        }
        if (lower === 'd') {
          // Eagle 式：Ctrl/Cmd+D 取消全选
          event.preventDefault()
          state.clearSelection()
          state.clearSelectedFolders()
          return
        }
        if (lower === 'e') {
          // Eagle 式：Ctrl/Cmd+E 在文件管理器中显示（优先树目录副本，回退库原图）
          const first = state.selectedAssetIds[0] ?? state.activeAssetId
          if (!first) return
          event.preventDefault()
          const asset = state.assetsById[first]
          if (!asset) return
          void (async () => {
            const [{ getImage }, { resolveImageRevealPath }, { openInExplorer }] = await Promise.all([
              import('../lib/db'),
              import('../lib/imageRevealPath'),
              import('../lib/localSave'),
            ])
            const image = await getImage(asset.imageId)
            const { useStore } = await import('../store')
            const targetPath = resolveImageRevealPath(asset.imageId, useStore.getState().tasks, image)
            if (!targetPath) return
            const result = await openInExplorer(targetPath)
            if (!result?.ok) {
              useStore
                .getState()
                .showToast(result?.error ? `打开图片位置失败：${result.error}` : '打开图片位置失败', 'error')
            }
          })()
          return
        }
        if (lower === 'i') {
          // Eagle 式：Ctrl/Cmd+I 查看素材信息（setActiveAsset 会打开右侧详情面板）
          const first = state.selectedAssetIds[0] ?? state.activeAssetId
          if (!first) return
          event.preventDefault()
          state.setActiveAsset(first)
          return
        }
        if (lower === 'c' || lower === 'x') {
          if (state.selectedAssetIds.length === 0) return
          // 页面存在文本选区时让位给原生复制/剪切（如选中详情面板提示词文字）
          if (typeof window !== 'undefined' && window.getSelection?.()?.toString()) return
          event.preventDefault()
          const count = state.selectedAssetIds.length
          if (lower === 'c') {
            state.copyAssets(state.selectedAssetIds)
            void import('../store').then(({ useStore }) =>
              useStore.getState().showToast(`已复制 ${count} 张素材到剪贴板`, 'success'),
            )
          } else {
            state.cutAssets(state.selectedAssetIds)
            void import('../store').then(({ useStore }) =>
              useStore.getState().showToast(`已剪切 ${count} 张素材，粘贴到目标位置`, 'success'),
            )
          }
          return
        }
        if (lower === 'v') {
          const entry = state.clipboard
          if (!entry || entry.type !== 'asset') return
          event.preventDefault()
          const targetId = typeof state.scope === 'object' && state.scope.kind === 'collection' ? state.scope.id : null
          void state
            .pasteAssetsIntoCollection(targetId)
            .then((count) => {
              if (count > 0) {
                void import('../store').then(({ useStore }) =>
                  useStore.getState().showToast(`已粘贴 ${count} 张素材`, 'success'),
                )
              }
            })
            .catch(() => {
              void import('../store').then(({ useStore }) => useStore.getState().showToast('粘贴失败，请重试', 'error'))
            })
          return
        }
        return
      }
      if (event.altKey) return

      // 文件夹树行焦点：Delete/Backspace/F2 由树行自己处理（删除文件夹/重命名），
      // 否则会冒泡到这里误删选中素材或与行内 F2 双重触发
      if (isFolderTreeFocus(event.target) && (key === 'Delete' || key === 'Backspace' || key === 'F2')) return

      // 查看器打开时：其余快捷键交给查看器（它有自己的 keydown 监听）
      if (state.viewerAssetId) return

      const targets = state.selectedAssetIds
      const firstTarget = targets[0] ?? state.activeAssetId

      if (key === ' ') {
        event.preventDefault()
        // 鼠标悬停的素材优先：按空格直接预览悬停素材，无需先点选。
        // 本监听在 capture 阶段执行（见下方 addEventListener 第三参），stopPropagation
        // 可阻止焦点卡片自身的 keydown 重复触发预览。
        if (state.hoveredAssetId && state.assetsById[state.hoveredAssetId]) {
          state.setQuickPreviewAsset(state.hoveredAssetId)
          event.stopPropagation()
          return
        }
        // 焦点在素材元素上时，由元素自身处理（快速预览）。
        // 预览悬浮层已打开时，鼠标实际落在悬浮层上会让悬停卡片触发 pointerleave、
        // hoveredAssetId 被清空；此时若把空格继续放给焦点卡片（含按住空格约 1 秒后的
        // key repeat），预览会被切回焦点卡片（上一张）。因此预览打开期间在此拦截。
        if (isAssetFocusElement(event.target)) {
          if (state.quickPreviewAssetId) event.stopPropagation()
          return
        }
        // key repeat 不再落到「无悬停 → 预览选中/焦点素材」分支（避免重复切换）
        if (event.repeat) return
        if (firstTarget) state.setQuickPreviewAsset(firstTarget)
        return
      }
      if (key === 'Enter') {
        if (isAssetFocusElement(event.target)) return
        if (firstTarget) onOpenViewer(firstTarget)
        return
      }
      if (key === 'Escape') {
        // 关闭弹出层（菜单/弹窗）各自处理；这里只负责取消选择
        if (state.quickPreviewAssetId) state.setQuickPreviewAsset(null)
        if (targets.length > 0) state.clearSelection()
        return
      }
      if (key === 'Delete' || key === 'Backspace') {
        event.preventDefault()
        // 回收站视图不响应 Delete（永久删除需走确认流程）
        if (state.scope === 'trash') return
        if (targets.length > 0) {
          // 有选中素材：移入回收站（Eagle 语义）
          void state
            .moveToTrash(targets)
            .then(() => {
              void import('../store').then(({ useStore }) =>
                useStore.getState().showToast(`已移入回收站（${targets.length} 张）`, 'success'),
              )
            })
            .catch(() => {
              void import('../store').then(({ useStore }) => useStore.getState().showToast('移入回收站失败', 'error'))
            })
          return
        }
        // 无选中素材且当前在文件夹中：删除当前文件夹（deleteFolders 内含确认弹窗）
        if (typeof state.scope === 'object' && state.scope.kind === 'collection') {
          void state.deleteFolders([state.scope.id])
          return
        }
        return
      }
      if (key === 'F2') {
        // Eagle 式：F2 重命名当前文件夹（树行聚焦时由树行处理，这里处理浏览态）
        if (typeof state.scope !== 'object' || state.scope.kind !== 'collection') return
        event.preventDefault()
        state.setFolderEditRequest({ kind: 'rename', collectionId: state.scope.id })
        return
      }
      if (key >= '1' && key <= '5') {
        const rating = Number(key) as 1 | 2 | 3 | 4 | 5
        if (targets.length > 0) {
          event.preventDefault()
          void state
            .patchAssets(targets, { rating })
            .then(() => {
              void import('../store').then(({ useStore }) =>
                useStore.getState().showToast(`已评分 ${rating} 星`, 'success'),
              )
            })
            .catch(() => {
              void import('../store').then(({ useStore }) => useStore.getState().showToast('评分失败', 'error'))
            })
        }
        return
      }
      if (key === '0') {
        if (targets.length > 0) {
          event.preventDefault()
          void state
            .patchAssets(targets, { rating: 0 })
            .then(() => {
              void import('../store').then(({ useStore }) => useStore.getState().showToast('已清除评分', 'success'))
            })
            .catch(() => {
              void import('../store').then(({ useStore }) => useStore.getState().showToast('清除评分失败', 'error'))
            })
        }
        return
      }
      if (key.toLocaleLowerCase() === 'f') {
        if (targets.length === 0) return
        const allFavorite = targets.every((id) => state.assetsById[id]?.favorite)
        const nextFavorite = !allFavorite
        event.preventDefault()
        void state
          .patchAssets(targets, { favorite: nextFavorite })
          .then(() => {
            void import('../store').then(({ useStore }) =>
              useStore
                .getState()
                .showToast(
                  nextFavorite ? `已收藏 ${targets.length} 张素材` : `已取消收藏 ${targets.length} 张素材`,
                  'success',
                ),
            )
          })
          .catch(() => {
            void import('../store').then(({ useStore }) => useStore.getState().showToast('收藏操作失败', 'error'))
          })
        return
      }
      if (key.toLocaleLowerCase() === 'c') {
        if (targets.length === 0) return
        const current = state.assetsById[targets[0]]?.colorLabel
        const next = cycleColorLabel(current)
        event.preventDefault()
        void state
          .patchAssets(targets, { colorLabel: next })
          .then(() => {
            void import('../store').then(({ useStore }) =>
              useStore
                .getState()
                .showToast(next ? `颜色标签：${COLOR_LABEL_NAMES[next]}` : '已清除颜色标签', 'success'),
            )
          })
          .catch(() => {
            void import('../store').then(({ useStore }) => useStore.getState().showToast('设置颜色标签失败', 'error'))
          })
      }
    }
    // capture 阶段监听：悬停预览时可在目标（焦点卡片）之前处理并按需阻止其自身 keydown，避免双触发
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onFocusSearch, onOpenViewer])

  // 空格抬起关闭快速预览（Eagle 式：按住显示、松开关闭）
  useEffect(() => {
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== ' ') return
      const state = useAssetLibraryStore.getState()
      if (state.quickPreviewAssetId) state.setQuickPreviewAsset(null)
    }
    window.addEventListener('keyup', onKeyUp)
    return () => window.removeEventListener('keyup', onKeyUp)
  }, [])
}
