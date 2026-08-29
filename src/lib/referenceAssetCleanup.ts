import { deleteGeneratedAsset } from './db'
import { isElectron } from './localSave'
import { useAssetLibraryStore } from '../features/assetLibrary/store'

/**
 * 清理"仅以参考图身份归档"的素材（archiveTaskReferences 停用前的历史产物）。
 *
 * 判定：素材的 origins 全部为 `kind: 'reference'`——这些不是生成结果，只是被用过一次的输入图。
 * 删除不写墓碑（参考图并非被永久删除的生成结果，未来真正生成同内容可正常重新归档）。
 * parentAssetIds 中的残留引用由衍生链渲染时自动过滤（AssetDetailPanel.DerivedChain 按 id 查无则跳过）。
 *
 * 幂等：第二次运行找不到参考图素材即返回 0。启动水合后调用一次。
 */

function isReferenceOnlyAsset(asset: { origins?: Array<{ kind?: string }> }): boolean {
  return Boolean(
    Array.isArray(asset.origins) &&
    asset.origins.length > 0 &&
    asset.origins.every((origin) => origin.kind === 'reference'),
  )
}

/**
 * 清理已归档参考图素材；返回清理数量。
 * Electron：主进程 SQLite 权威删除 + IndexedDB 记录同步删除 + store 状态移除；
 * 浏览器：IndexedDB + store 状态移除。
 */
export async function cleanupReferenceOnlyAssets(): Promise<number> {
  const state = useAssetLibraryStore.getState()
  const all = Object.values(state.assetsById)
  const referenceOnly = all.filter(isReferenceOnlyAsset)
  if (referenceOnly.length === 0) return 0

  const removedIds = referenceOnly.map((asset) => asset.id)

  // Electron：SQLite 权威目录删除（不写墓碑）
  if (isElectron()) {
    try {
      await window.electronAPI?.assetCatalogCleanupReferenceAssets?.()
    } catch (error) {
      console.warn('[reference-asset-cleanup] SQLite 清理失败（可忽略，IDB 侧继续）', error)
    }
  }

  // IndexedDB 记录 + store 状态移除
  for (const id of removedIds) {
    await deleteGeneratedAsset(id).catch(() => {})
    useAssetLibraryStore.getState().removeAssetLocal(id)
  }

  console.info(`[reference-asset-cleanup] 已清理 ${removedIds.length} 个参考图素材`)
  return removedIds.length
}
