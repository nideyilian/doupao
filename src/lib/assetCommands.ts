import type { AssetLibrarySnapshot } from './assetLibraryRepository'
import type {
  AssetCatalogCursorPage,
  AssetCatalogQuery,
  AssetPatch,
  AssetSourceMode,
  AssetUsageEvent,
  AssetUsageTarget,
  GeneratedAsset,
  InputImage,
  StoredImage,
  TaskRecord,
} from '../types'
import { queryAssets, toByTagMap, type AssetQueryResult, type AssetQueryState } from '../features/assetLibrary/query'
import {
  getAsset,
  getAssetsByIds,
  getAssetsByImageIds,
  hydrate,
  putGeneratedAssets,
  queryAssetCatalog,
  recommendAssets as recommendAssetRecords,
} from './assetLibraryRepository'

export interface AssetReferenceContext {
  target: Extract<AssetUsageTarget, 'gallery' | 'agent' | 'sop'>
  workspaceTabId?: string
  sopId?: string
}

export interface ArchiveTaskReferenceContext {
  sourceMode: AssetSourceMode
  workspaceTabId?: string
  workspaceTabName?: string
}

export interface AssetCommandDependencies {
  loadLibrary: () => Promise<AssetLibrarySnapshot>
  getAsset: (id: string) => Promise<GeneratedAsset | undefined>
  getAssetsByIds: (ids: string[]) => Promise<Map<string, GeneratedAsset>>
  getAssetsByImageIds?: (imageIds: string[]) => Promise<Map<string, GeneratedAsset>>
  getImagesByIds: (ids: string[]) => Promise<Map<string, StoredImage>>
  saveAssets: (assets: GeneratedAsset[]) => Promise<void>
  publishAssets: (assets: GeneratedAsset[]) => void
  ensureImageDataUrl: (imageId: string) => Promise<string | null>
  addReference: (image: InputImage, target: 'gallery' | 'agent') => Promise<boolean>
  /** 打开后期处理工作区（弹窗），可一次送入多张素材；返回是否成功打开 */
  openComposite: (input: { assets: GeneratedAsset[]; images: StoredImage[] }) => Promise<boolean>
  getTask: (taskId: string) => Promise<TaskRecord | undefined>
  reuseTask: (task: TaskRecord) => Promise<boolean>
  download: (input: { asset: GeneratedAsset; dataUrl: string; fileName: string }) => Promise<boolean>
  patchAssets: (ids: string[], patch: AssetPatch) => Promise<void>
  trashAssets: (ids: string[]) => Promise<void>
  recordUsage: (event: AssetUsageEvent) => Promise<void>
  queryCatalog?: (input: AssetCatalogQuery) => Promise<AssetCatalogCursorPage>
  recommendAssets?: (input: {
    query?: string
    context?: string
    similarToAssetId?: string
    limit?: number
  }) => Promise<Array<{ asset: GeneratedAsset; score: number }>>
  showToast: (message: string, tone: 'success' | 'error' | 'info') => void
  now: () => number
  createId: () => string
  /** 把指定 SOP 应用到画廊（设置当前 SOP 并切换到画廊模式） */
  applySopToGallery?: (sopId: string) => Promise<boolean>
}

/** 素材详情侧栏「复用 SOP」派发的全局事件（InputBar 监听后设置当前 SOP）。 */
export const APPLY_SOP_TO_GALLERY_EVENT = 'doupao:apply-sop-to-gallery'

let usageSequence = 0

function targetFromSourceMode(sourceMode: AssetSourceMode): AssetUsageTarget {
  return sourceMode === 'unknown' ? 'unknown' : sourceMode
}

/** 素材用户可见文件名（生成名或 imageId + 扩展名）；供下载/导出/项目树副本共用。 */
export function getAssetFileName(asset: GeneratedAsset) {
  const origin = asset.origins.find((item) => item.key === asset.primaryOriginKey) ?? asset.origins[0]
  const base = origin?.generatedFileNameBase?.trim() || asset.imageId
  const extension = asset.mimeType === 'image/jpeg' ? 'jpg' : asset.mimeType === 'image/webp' ? 'webp' : 'png'
  return `${base}.${extension}`
}

function createDefaultDependencies(): AssetCommandDependencies {
  return {
    loadLibrary: hydrate,
    getAsset,
    getAssetsByIds,
    getAssetsByImageIds,
    getImagesByIds: async (ids) => {
      const { batchGetImages } = await import('./db')
      return batchGetImages(ids)
    },
    saveAssets: putGeneratedAssets,
    publishAssets: (assets) => {
      void import('../features/assetLibrary/store').then(({ useAssetLibraryStore }) => {
        useAssetLibraryStore.getState().applyUpsertedAssets(assets)
      })
    },
    ensureImageDataUrl: async (imageId) => {
      const { ensureImageCached } = await import('../store')
      return (await ensureImageCached(imageId)) || null
    },
    addReference: async (image, target) => {
      const { useStore } = await import('../store')
      const state = useStore.getState()
      state.setAppMode(target)
      if (target === 'gallery') state.setGalleryViewMode('tasks')
      if (state.inputImages.some((item) => item.id === image.id)) {
        state.showToast('这张图片已在参考图中', 'info')
        return false
      }
      if (state.inputImageFolder) state.setInputImageFolder(null)
      const before = state.inputImages.length
      state.addInputImage(image)
      return useStore.getState().inputImages.length > before
    },
    openComposite: async ({ assets, images }) => {
      // 素材来源两种模式：
      // 1. localPath：本地文件（导入/导出过的素材）→ path 模式，渲染时读盘
      // 2. dataUrl：IndexedDB 存储的生成图（无本地文件）→ dataUrl 模式，直接使用图片数据
      // 按 imageId 匹配（不依赖数组索引对齐，避免错位导致漏图）
      const withSource = assets
        .map((asset) => {
          const image = images.find((item) => item.id === asset.imageId)
          if (!image) return null
          const name = image.localPath?.split(/[\\/]/).pop() || asset.imageId
          const width = image.width ?? asset.width ?? 0
          const height = image.height ?? asset.height ?? 0
          if (image.localPath) {
            return { path: image.localPath, name, relativeDir: '', width, height }
          }
          if (image.dataUrl) {
            // 无本地文件：用 imageId 作唯一 path 键，dataUrl 携带图片数据
            return { path: image.id, name, relativeDir: '', width, height, dataUrl: image.dataUrl }
          }
          return null
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      if (withSource.length === 0) return false
      const [{ useCompositeV2Store }, { useStore }] = await Promise.all([
        import('../features/composite/storeV2'),
        import('../store'),
      ])
      useCompositeV2Store.getState().setBackgrounds(withSource)
      // 弹窗形式打开后期工作区，不切走素材库（素材库保持在底层可见）
      useStore.getState().setPostprocessDialogOpen(true)
      return true
    },
    getTask: async (taskId) => {
      const { useStore } = await import('../store')
      return useStore.getState().tasks.find((task) => task.id === taskId)
    },
    reuseTask: async (task) => {
      const { reuseConfig, useStore } = await import('../store')
      const state = useStore.getState()
      state.setAppMode('gallery')
      state.setGalleryViewMode('tasks')
      await reuseConfig(task)
      return true
    },
    download: async ({ dataUrl, fileName }) => {
      // Electron：原生保存对话框 + 主进程写盘（用户可控制保存位置，无多下载提示）
      const { isElectron, selectSavePath, saveImage } = await import('./localSave')
      if (isElectron() && window.electronAPI?.selectSavePath) {
        const filePath = await selectSavePath(fileName, [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }])
        if (!filePath) return true // 用户取消：不算失败
        return saveImage(filePath, dataUrl)
      }
      if (typeof document === 'undefined') return false
      const anchor = document.createElement('a')
      anchor.href = dataUrl
      anchor.download = fileName
      anchor.click()
      return true
    },
    patchAssets: async (ids, patch) => {
      const { useAssetLibraryStore } = await import('../features/assetLibrary/store')
      return useAssetLibraryStore.getState().patchAssets(ids, patch)
    },
    trashAssets: async (ids) => {
      const { useAssetLibraryStore } = await import('../features/assetLibrary/store')
      return useAssetLibraryStore.getState().moveToTrash(ids)
    },
    recordUsage: async (event) => {
      const { putAssetUsageEvent } = await import('./db')
      await putAssetUsageEvent(event)
      if (typeof window !== 'undefined') await window.electronAPI?.assetCatalogRecordUsage?.([event])
    },
    queryCatalog: queryAssetCatalog,
    recommendAssets: recommendAssetRecords,
    showToast: (message, tone) => {
      void import('../store').then(({ useStore }) => useStore.getState().showToast(message, tone))
    },
    now: () => Date.now(),
    createId: () => `usage-${Date.now().toString(36)}-${(++usageSequence).toString(36)}`,
    applySopToGallery: async (sopId) => {
      // 通过全局事件桥接到 InputBar（当前 SOP 选择是 InputBar 的本地状态）
      if (typeof window === 'undefined') return false
      window.dispatchEvent(new CustomEvent(APPLY_SOP_TO_GALLERY_EVENT, { detail: { sopId } }))
      return true
    },
  }
}

class AssetCommandService {
  constructor(private readonly deps: AssetCommandDependencies) {}

  getAsset(id: string) {
    return this.deps.getAsset(id)
  }

  async searchAssets(state: AssetQueryState): Promise<AssetQueryResult> {
    if (this.deps.queryCatalog) {
      const page = await this.deps.queryCatalog({ ...state, limit: 200 })
      return {
        assets: page.assets,
        totalCount: page.totalCount,
        counts: {
          ...page.counts,
          byCollection: new Map(Object.entries(page.counts.byCollection)),
          byTag: toByTagMap(page.counts.byTag),
        },
      }
    }
    const snapshot = await this.deps.loadLibrary()
    return queryAssets(snapshot, state)
  }

  searchAssetPage(input: AssetCatalogQuery): Promise<AssetCatalogCursorPage> {
    if (this.deps.queryCatalog) return this.deps.queryCatalog(input)
    return queryAssetCatalog(input)
  }

  /**
   * 遍历查询全部匹配素材 id（供「全选全部结果」使用）。
   * 通过游标翻页收集，直到耗尽或达到上限；浏览器回退（无 queryCatalog）时直接全量加载过滤。
   * @param maxIds 安全上限，防止超大库全选时无限翻页卡死（默认 10000，超出后截断并返回截断标记）。
   */
  async searchAllAssetIds(
    input: AssetCatalogQuery,
    maxIds = 10_000,
  ): Promise<{ ids: string[]; totalCount: number; truncated: boolean }> {
    if (!this.deps.queryCatalog) {
      const snapshot = await this.deps.loadLibrary()
      const result = queryAssets(snapshot, input)
      return { ids: result.assets.map((asset) => asset.id), totalCount: result.totalCount, truncated: false }
    }
    const ids: string[] = []
    let cursor: string | null = null
    let truncated = false
    const PAGE_SIZE = 500
    for (let round = 0; round < 64; round++) {
      const page = await this.deps.queryCatalog({ ...input, cursor, limit: PAGE_SIZE })
      for (const asset of page.assets) {
        if (ids.length >= maxIds) {
          truncated = true
          break
        }
        ids.push(asset.id)
      }
      if (truncated) break
      if (!page.nextCursor) return { ids, totalCount: page.totalCount, truncated }
      cursor = page.nextCursor
    }
    return { ids, totalCount: ids.length, truncated }
  }

  recommend(input: { query?: string; context?: string; similarToAssetId?: string; limit?: number }) {
    if (this.deps.recommendAssets) return this.deps.recommendAssets(input)
    return recommendAssetRecords(input)
  }

  async resolveReference(assetId: string, context: AssetReferenceContext): Promise<InputImage | null> {
    const asset = await this.getActiveAsset(assetId)
    if (!asset) return null
    const dataUrl = await this.deps.ensureImageDataUrl(asset.imageId)
    if (!dataUrl) {
      this.deps.showToast('素材原图已不存在', 'error')
      return null
    }
    await this.recordUsage(asset, 'selected-as-reference', context.target, {
      workspaceTabId: context.workspaceTabId,
      sopId: context.sopId,
    })
    return { id: asset.imageId, dataUrl }
  }

  async useAsReference(assetId: string, context: AssetReferenceContext = { target: 'gallery' }): Promise<boolean> {
    const asset = await this.getActiveAsset(assetId)
    if (!asset) return false
    const dataUrl = await this.deps.ensureImageDataUrl(asset.imageId)
    if (!dataUrl) {
      this.deps.showToast('素材原图已不存在', 'error')
      return false
    }
    if (context.target === 'sop') {
      this.deps.showToast('请通过素材选择器加入 SOP 参考图', 'info')
      return false
    }
    const added = await this.deps.addReference({ id: asset.imageId, dataUrl }, context.target)
    if (!added) return false
    await this.recordUsage(asset, 'selected-as-reference', context.target, {
      workspaceTabId: context.workspaceTabId,
    })
    this.deps.showToast('已加入参考图', 'success')
    return true
  }

  async openInPostprocess(assetId: string): Promise<boolean> {
    return this.openInWorkspace([assetId], 'postprocess')
  }

  async openInComposite(assetId: string): Promise<boolean> {
    return this.openInWorkspace([assetId], 'composite')
  }

  /** 批量把多张选中素材送入后期处理工作区（弹窗形式，一次 setBackgrounds 全部载入）。 */
  async openInPostprocessBatch(assetIds: string[]): Promise<boolean> {
    return this.openInWorkspace(assetIds, 'postprocess')
  }

  async reuseGenerationConfig(assetId: string): Promise<boolean> {
    const asset = await this.getActiveAsset(assetId)
    if (!asset) return false
    const origin = asset.origins.find((item) => item.key === asset.primaryOriginKey) ?? asset.origins[0]
    if (!origin?.taskId) {
      this.deps.showToast('这项素材没有可复用的生成配置', 'info')
      return false
    }
    const task = await this.deps.getTask(origin.taskId)
    if (!task || !(await this.deps.reuseTask(task))) {
      this.deps.showToast('来源任务已不存在', 'error')
      return false
    }
    await this.recordUsage(asset, 'reuse-config', 'gallery', { taskId: task.id })
    return true
  }

  /** 把该素材来源 SOP 应用为画廊当前 SOP（详情侧栏「复用 SOP」入口）。 */
  async applyAssetSop(assetId: string): Promise<boolean> {
    const asset = await this.getActiveAsset(assetId)
    if (!asset) return false
    const origin = asset.origins.find((item) => item.key === asset.primaryOriginKey) ?? asset.origins[0]
    let sopId: string | undefined
    if (origin?.taskId) {
      const task = await this.deps.getTask(origin.taskId)
      sopId = task?.sopBatch?.sopId
    }
    if (!sopId) {
      this.deps.showToast('这项素材没有关联的 SOP', 'info')
      return false
    }
    if (!this.deps.applySopToGallery || !(await this.deps.applySopToGallery(sopId))) {
      this.deps.showToast('应用 SOP 失败', 'error')
      return false
    }
    await this.recordUsage(asset, 'reuse-config', 'sop', { sopId })
    return true
  }

  async exportAsset(assetId: string): Promise<boolean> {
    const asset = await this.getActiveAsset(assetId)
    if (!asset) return false
    const dataUrl = await this.deps.ensureImageDataUrl(asset.imageId)
    if (!dataUrl || !(await this.deps.download({ asset, dataUrl, fileName: getAssetFileName(asset) }))) {
      this.deps.showToast('素材导出失败', 'error')
      return false
    }
    await this.recordUsage(asset, 'export', 'export')
    return true
  }

  patchAssets(ids: string[], patch: AssetPatch) {
    return this.deps.patchAssets(ids, patch)
  }

  trashAssets(ids: string[]) {
    return this.deps.trashAssets(ids)
  }

  async createDerivedAsset(input: {
    imageId: string
    parentAssetIds: string[]
    target: Extract<AssetUsageTarget, 'postprocess' | 'composite'>
  }): Promise<GeneratedAsset | null> {
    const [existingById, imagesById] = await Promise.all([
      this.getAssetsByImageIds([input.imageId]),
      this.deps.getImagesByIds([input.imageId]),
    ])
    const image = imagesById.get(input.imageId)
    if (!image) return null
    const existing = existingById.get(input.imageId)
    const now = this.deps.now()
    const asset: GeneratedAsset = existing
      ? {
          ...existing,
          parentAssetIds: [...new Set([...existing.parentAssetIds, ...input.parentAssetIds])],
          updatedAt: now,
        }
      : {
          id: `asset:${crypto.randomUUID()}`,
          imageId: input.imageId,
          status: 'active',
          createdAt: image.createdAt ?? now,
          updatedAt: now,
          trashedAt: null,
          favorite: false,
          rating: 0,
          collectionIds: [],
          tagIds: [],
          origins: [],
          primaryOriginKey: null,
          parentAssetIds: [...new Set(input.parentAssetIds)],
          width: image.width,
          height: image.height,
          mimeType: image.mimeType,
          byteSize: image.byteSize,
          metadataVersion: 1,
        }
    await this.deps.saveAssets([asset])
    this.deps.publishAssets([asset])
    await this.recordUsage(asset, 'derived', input.target, { parentAssetIds: input.parentAssetIds })
    return asset
  }

  async archiveTaskReferences(task: TaskRecord, context: ArchiveTaskReferenceContext): Promise<GeneratedAsset[]> {
    const imageIds = [...new Set(task.inputImageIds.filter(Boolean))]
    if (imageIds.length === 0) return []
    const [existingById, imagesById] = await Promise.all([
      this.getAssetsByImageIds(imageIds),
      this.deps.getImagesByIds(imageIds),
    ])
    const created: GeneratedAsset[] = []
    const used: GeneratedAsset[] = []
    const now = this.deps.now()

    for (const [index, imageId] of imageIds.entries()) {
      const existing = existingById.get(imageId)
      const image = imagesById.get(imageId)
      if (!existing && image) {
        const originKey = `reference:${task.id}:${index}`
        created.push({
          id: `asset:${crypto.randomUUID()}`,
          imageId,
          status: 'active',
          createdAt: image.createdAt ?? task.createdAt,
          updatedAt: now,
          trashedAt: null,
          favorite: false,
          rating: 0,
          collectionIds: [],
          tagIds: [],
          origins: [
            {
              kind: 'reference',
              key: originKey,
              taskId: task.id,
              outputSlot: -(index + 1),
              taskCreatedAt: task.createdAt,
              taskFinishedAt: task.finishedAt,
              sourceMode: context.sourceMode,
              workspaceTabId: context.workspaceTabId,
              workspaceTabName: context.workspaceTabName,
              prompt: task.prompt,
              requestedParams: task.params,
              actualParams: task.actualParams,
              apiProvider: task.apiProvider,
              apiProfileId: task.apiProfileId,
              apiProfileName: task.apiProfileName,
              apiMode: task.apiMode,
              apiModel: task.apiModel,
              inputImageIds: imageIds.filter((id) => id !== imageId),
              maskTargetImageId: task.maskTargetImageId,
              maskImageId: task.maskImageId,
            },
          ],
          primaryOriginKey: originKey,
          parentAssetIds: [],
          width: image.width,
          height: image.height,
          mimeType: image.mimeType,
          byteSize: image.byteSize,
          metadataVersion: 1,
        })
      }

      const asset = existing ?? created[created.length - 1]
      if (asset?.imageId === imageId) {
        used.push(asset)
      }
    }

    if (created.length > 0) {
      await this.deps.saveAssets(created)
      this.deps.publishAssets(created)
    }
    for (const asset of used) {
      await this.recordUsage(asset, 'generation-input', targetFromSourceMode(context.sourceMode), {
        id: `usage:generation-input:${task.id}:${asset.imageId}`,
        taskId: task.id,
        workspaceTabId: context.workspaceTabId,
      })
    }
    return created
  }

  private async openInWorkspace(assetIds: string[], target: 'postprocess' | 'composite') {
    const uniqueIds = Array.from(new Set(assetIds)).filter(Boolean)
    if (uniqueIds.length === 0) return false
    const assetsById = await this.deps.getAssetsByIds(uniqueIds)
    const assets = uniqueIds
      .map((id) => assetsById.get(id))
      .filter((asset): asset is GeneratedAsset => Boolean(asset && asset.status === 'active'))
    if (assets.length === 0) {
      this.deps.showToast('素材不存在或已在回收站', 'error')
      return false
    }
    const images = await this.deps.getImagesByIds(assets.map((asset) => asset.imageId))
    const imageList = assets
      .map((asset) => images.get(asset.imageId))
      .filter((image): image is StoredImage => Boolean(image))
    if (imageList.length === 0 || !(await this.deps.openComposite({ assets, images: imageList }))) {
      this.deps.showToast('当前素材没有可供后期工作区读取的本地原图', 'error')
      return false
    }
    for (const asset of assets) {
      await this.recordUsage(asset, target === 'postprocess' ? 'open-postprocess' : 'open-composite', target)
    }
    this.deps.showToast(`已发送 ${assets.length} 张到后期处理`, 'success')
    return true
  }

  private async getActiveAsset(assetId: string) {
    const asset = await this.deps.getAsset(assetId)
    if (!asset || asset.status !== 'active') {
      this.deps.showToast('素材不存在或已在回收站', 'error')
      return null
    }
    return asset
  }

  private getAssetsByImageIds(imageIds: string[]) {
    return this.deps.getAssetsByImageIds?.(imageIds) ?? this.deps.getAssetsByIds(imageIds)
  }

  private async recordUsage(
    asset: GeneratedAsset,
    action: AssetUsageEvent['action'],
    target: AssetUsageTarget,
    context: Partial<Pick<AssetUsageEvent, 'id' | 'taskId' | 'workspaceTabId' | 'sopId' | 'parentAssetIds'>> = {},
  ) {
    const event: AssetUsageEvent = {
      id: context.id ?? this.deps.createId(),
      assetId: asset.id,
      imageId: asset.imageId,
      action,
      target,
      occurredAt: this.deps.now(),
      ...(context.taskId ? { taskId: context.taskId } : {}),
      ...(context.workspaceTabId ? { workspaceTabId: context.workspaceTabId } : {}),
      ...(context.sopId ? { sopId: context.sopId } : {}),
      ...(context.parentAssetIds?.length ? { parentAssetIds: [...new Set(context.parentAssetIds)] } : {}),
    }
    try {
      await this.deps.recordUsage(event)
    } catch (error) {
      console.error('素材使用记录写入失败:', error)
    }
  }
}

export function createAssetCommandService(overrides: Partial<AssetCommandDependencies> = {}) {
  const dependencies = { ...createDefaultDependencies(), ...overrides }
  if (!overrides.getAssetsByImageIds && overrides.getAssetsByIds) {
    dependencies.getAssetsByImageIds = overrides.getAssetsByIds
  }
  return new AssetCommandService(dependencies)
}

export const assetCommands = createAssetCommandService()
