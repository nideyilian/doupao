import {
  expandCompositeExportItems,
  type CompositeV2ExportItem,
  type CompositeV2ExportSnapshot,
} from './compositeExportPlan'
import {
  buildCompositeOutputPathParts,
  resolveCompositeTemplate,
  stripTemplateIndex,
  withCollisionSuffix,
} from './compositePathTemplates'
import { renderCompositeV2ToJpegDataUrl } from './compositeRendererV2'
import { getEffectiveOutputRuleGroups, getEnabledOutputRules } from './compositeOutputRulesV2'
import type { CompositeV2ExportTask, CompositeV2FailureItem, CompositeV2SuccessItem } from './compositeV2Types'
import { archiveRenderedAsset } from '../../../lib/assetDerivation'
import { computeContentHash } from '../../../lib/imageFingerprint'

export type CompositeV2ExportRuntimeCallbacks = {
  onProgress: (completed: number, total: number) => void
  onSuccess: (item: CompositeV2SuccessItem) => void
  onFailure: (item: CompositeV2FailureItem) => void
  shouldPause: () => boolean
  shouldCancel: () => boolean
}

export function dataUrlSizeKb(dataUrl: string) {
  const base64 = dataUrl.split(',')[1] ?? ''
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.ceil(((base64.length * 3) / 4 - padding) / 1024)
}

export async function waitWhilePaused(
  shouldPause: () => boolean,
  shouldCancel: () => boolean,
  sleep: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 150)),
) {
  while (shouldPause() && !shouldCancel()) await sleep()
}

/**
 * 渲染到目标体积以内。
 *
 * 性能要点（P0-1）：先按高质量 0.9 渲染一次，达标直接返回——大多数输出只需一次编码；
 * 只有超标时才用最低质量 0.01 试探上限，再进行最多 8 次二分逼近。
 */
export async function renderWithMaxKb(
  input: Omit<Parameters<typeof renderCompositeV2ToJpegDataUrl>[0], 'quality'>,
  maxSizeKb: number,
  callbacks?: { shouldPause: () => boolean; shouldCancel: () => boolean },
) {
  if (callbacks?.shouldPause && callbacks?.shouldCancel) {
    await waitWhilePaused(callbacks.shouldPause, callbacks.shouldCancel)
  }
  if (callbacks?.shouldCancel()) throw new Error('渲染被取消')

  const highDataUrl = await renderCompositeV2ToJpegDataUrl({ ...input, quality: 0.9 })
  if (callbacks?.shouldCancel()) throw new Error('渲染被取消')
  if (dataUrlSizeKb(highDataUrl) <= maxSizeKb) {
    return { dataUrl: highDataUrl }
  }

  // 最低质量仍超限 → 无法压缩到目标体积
  const lowDataUrl = await renderCompositeV2ToJpegDataUrl({ ...input, quality: 0.01 })
  if (callbacks?.shouldCancel()) throw new Error('渲染被取消')
  if (dataUrlSizeKb(lowDataUrl) > maxSizeKb) {
    return { dataUrl: lowDataUrl, warning: `最低质量 0.01 仍超过 ${maxSizeKb}KB` }
  }

  let low = 0.01
  let high = 0.9
  let bestDataUrl = lowDataUrl
  for (let iteration = 0; iteration < 8; iteration += 1) {
    if (callbacks?.shouldPause && callbacks?.shouldCancel) {
      await waitWhilePaused(callbacks.shouldPause, callbacks.shouldCancel)
    }
    if (callbacks?.shouldCancel()) throw new Error('渲染被取消')

    const quality = (low + high) / 2
    const dataUrl = await renderCompositeV2ToJpegDataUrl({ ...input, quality })
    if (dataUrlSizeKb(dataUrl) <= maxSizeKb) {
      bestDataUrl = dataUrl
      low = quality
    } else {
      high = quality
    }
  }
  return { dataUrl: bestDataUrl }
}

async function resolveCollision(
  api: NonNullable<Window['electronAPI']>,
  directoryParts: string[],
  filename: string,
  usedPaths: Set<string>,
) {
  let candidate = await api.pathJoin(...directoryParts, filename)
  let suffix = 1
  // usedPaths 缓存本次导出内已分配的路径，避免同目录同名文件重复探测磁盘
  while (usedPaths.has(candidate) || (await api.checkExists(candidate))) {
    candidate = await api.pathJoin(...directoryParts, withCollisionSuffix(filename, suffix))
    suffix += 1
  }
  usedPaths.add(candidate)
  return candidate
}

/**
 * 构建输出路径。
 *
 * 文件夹命名完全跟随文件名模板（filenameTemplate），只是去掉 {index} 序号字段——
 * 这样同一预设/尺寸的一组图片聚合到同一文件夹，文件用含序号的 filenameTemplate 区分。
 * 预设的文件名模板为空时回退到输出规则的模板，再为空则平铺到输出根目录。
 */
export function buildPresetOutputPathParts(
  item: CompositeV2ExportItem,
  snapshot: Pick<CompositeV2ExportSnapshot, 'preserveSourceDir'>,
) {
  const filenameTemplate = item.preset.filenameTemplate || item.outputRule.filenameTemplate || ''
  const output = buildCompositeOutputPathParts({
    ...buildPresetTemplateVariables(item),
    namingTemplate: stripTemplateIndex(filenameTemplate),
    filenameTemplate,
    preserveSourceDir: snapshot.preserveSourceDir,
  })
  return {
    subfolders: output.subfolders,
    filename: output.filename,
  }
}

function buildPresetTemplateVariables(item: CompositeV2ExportItem) {
  return {
    date: item.date,
    channel: item.outputRule.channelName,
    size: item.outputRule.name,
    preset: item.preset.name,
    index: item.index,
    source: item.background.name.replace(/\.[^.]+$/, ''),
    sourceDir: item.background.relativeDir,
    custom: item.custom,
    customVariables: item.preset.customVariableValues,
  }
}

export function buildPresetOutputRootPath(item: CompositeV2ExportItem) {
  return resolveCompositeTemplate(item.preset.outputRootPath, buildPresetTemplateVariables(item))
}

export async function authorizeCompositeOutputRoot(
  api: NonNullable<Window['electronAPI']>,
  outputRoot: string,
  authorizedRoots: Set<string>,
) {
  if (authorizedRoots.has(outputRoot)) return
  const authorized = await api.authorizeCompositeOutputDirectory?.(outputRoot)
  if (!authorized) throw new Error('输出目录必须是绝对路径')
  authorizedRoots.add(outputRoot)
}

function setExportingActive(active: boolean) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (active) root.setAttribute('data-exporting', 'true')
  else root.removeAttribute('data-exporting')
}

/** 单次导出运行上下文：跨条目共享的授权/碰撞/背景缓存 */
export type CompositeV2ExportContext = {
  authorizedRoots: Set<string>
  usedPaths: Set<string>
  backgroundDataUrls: Map<string, string>
  backgroundHashes: Map<string, string>
  pendingReads: Map<string, Promise<string | null>>
}

export function createCompositeV2ExportContext(): CompositeV2ExportContext {
  return {
    authorizedRoots: new Set(),
    usedPaths: new Set(),
    backgroundDataUrls: new Map(),
    backgroundHashes: new Map(),
    pendingReads: new Map(),
  }
}

/** 背景图按路径去重 + 并发读合并：同一背景跨多个尺寸规则只读盘/解码一次。
 *  素材库送入的无本地文件素材（background.dataUrl）直接使用内存数据，不走 IPC 读盘。 */
function readBackground(
  ctx: CompositeV2ExportContext,
  api: NonNullable<Window['electronAPI']>,
  path: string,
  dataUrl?: string,
): Promise<string | null> {
  if (dataUrl) {
    ctx.backgroundDataUrls.set(path, dataUrl)
    return Promise.resolve(dataUrl)
  }
  const cached = ctx.backgroundDataUrls.get(path)
  if (cached) return Promise.resolve(cached)
  let pending = ctx.pendingReads.get(path)
  if (!pending) {
    pending = api.readImageFile(path).then(async (file) => {
      const fileDataUrl = file?.dataUrl ?? null
      if (fileDataUrl) {
        ctx.backgroundDataUrls.set(path, fileDataUrl)
        try {
          ctx.backgroundHashes.set(path, await computeContentHash(fileDataUrl))
        } catch {
          // 指纹计算失败不阻塞导出，归档时兜底重算
        }
      }
      return fileDataUrl
    })
    ctx.pendingReads.set(path, pending)
  }
  return pending
}

/**
 * 执行单个导出项（渲染 → 碰撞解析 → 写盘 → 归档）。
 * 主循环与失败重试共用；成功/失败通过 callbacks 上报，函数本身不抛错。
 */
export async function exportSingleItem(
  item: CompositeV2ExportItem,
  snapshot: CompositeV2ExportSnapshot,
  api: NonNullable<Window['electronAPI']>,
  ctx: CompositeV2ExportContext,
  callbacks: Pick<CompositeV2ExportRuntimeCallbacks, 'onSuccess' | 'onFailure' | 'shouldPause' | 'shouldCancel'>,
): Promise<void> {
  try {
    const backgroundDataUrl = await readBackground(ctx, api, item.background.path, item.background.dataUrl)
    if (!backgroundDataUrl) throw new Error('背景图读取失败')
    const rendered = await renderWithMaxKb(
      {
        backgroundDataUrl,
        preset: item.preset,
        targetSize: { width: item.outputRule.width, height: item.outputRule.height },
        fitMode: snapshot.fitMode,
      },
      item.outputRule.maxSizeKb,
      {
        shouldPause: callbacks.shouldPause,
        shouldCancel: callbacks.shouldCancel,
      },
    )
    const pathParts = buildPresetOutputPathParts(item, snapshot)
    const outputRoot = buildPresetOutputRootPath(item)
    await authorizeCompositeOutputRoot(api, outputRoot, ctx.authorizedRoots)
    const directoryParts = [outputRoot, ...pathParts.subfolders]
    const outputPath = await resolveCollision(api, directoryParts, pathParts.filename, ctx.usedPaths)

    const saved = await api.saveCompositeImage(outputPath, rendered.dataUrl)
    if (!saved) throw new Error('图片写入失败')
    // 默认不归档：成图只写入预设的输出文件夹，不进入素材库（IndexedDB + cache-images）。
    // 需要把导出成图纳入素材库管理（可搜索、可复用）时再开启「归档到素材库」。
    if (snapshot.archiveExportsToLibrary) {
      const parentHash = ctx.backgroundHashes.get(item.background.path) ?? (await computeContentHash(backgroundDataUrl))
      await archiveRenderedAsset(rendered.dataUrl, 'composite', [parentHash]).catch((error) =>
        console.warn('合成素材归档失败', error),
      )
    }
    callbacks.onSuccess({
      path: outputPath,
      backgroundPath: item.background.path,
      presetId: item.preset.id,
      presetName: item.preset.name,
      channel: item.outputRule.channelName,
      size: item.outputRule.name,
      index: item.index,
      warning: rendered.warning,
    })
  } catch (error) {
    callbacks.onFailure({
      backgroundPath: item.background.path,
      presetId: item.preset.id,
      presetName: item.preset.name,
      channel: item.outputRule.channelName,
      size: item.outputRule.name,
      index: item.index,
      reason: error instanceof Error ? error.message : '未知错误',
    })
  }
}

/**
 * 单张失败任务重试：从 store 重建预设/输出规则与导出项，走与主导出相同的渲染管线。
 * 新建上下文（碰撞探测重新开始），保证重试写盘不覆盖已存在的文件。
 */
export async function retryCompositeExportTask(
  task: CompositeV2ExportTask,
  callbacks: Pick<CompositeV2ExportRuntimeCallbacks, 'onSuccess' | 'onFailure'>,
): Promise<void> {
  const api = window.electronAPI
  if (!api) throw new Error('当前环境不支持本地导出')
  const { useCompositeV2Store } = await import('../storeV2')
  const state = useCompositeV2Store.getState()
  const preset = state.presets.find((p) => p.id === task.presetId)
  if (!preset) throw new Error(`预设不存在: ${task.presetName}`)
  const rule = getEnabledOutputRules(getEffectiveOutputRuleGroups(preset, state.outputRuleGroups)).find(
    (r) => r.channelName === task.channel && r.name === task.size,
  )
  if (!rule) throw new Error(`输出规则不存在: ${task.channel} / ${task.size}`)

  const item: CompositeV2ExportItem = {
    snapshotId: `retry-${Date.now()}`,
    background: {
      path: task.backgroundPath,
      name: task.backgroundPath.split(/[\\/]/).pop() || task.backgroundPath,
      relativeDir: '',
      width: 0,
      height: 0,
    },
    preset,
    outputRule: rule,
    index: task.index,
    date: task.date,
    custom: task.custom,
  }
  const snapshot: CompositeV2ExportSnapshot = {
    id: item.snapshotId,
    date: task.date,
    createdAt: Date.now(),
    backgroundFolders: [],
    recursive: false,
    backgrounds: [item.background],
    presets: [preset],
    presetGroup: { id: 'retry', name: 'retry', presetIds: [preset.id], updatedAt: 0 },
    enabledPresetIds: [preset.id],
    outputRuleGroups: state.outputRuleGroups,
    smartMatchOrientation: false,
    custom: task.custom,
    customVariables: state.customVariables,
    fitMode: state.globalFitMode,
    preserveSourceDir: state.preserveSourceDir,
    archiveExportsToLibrary: state.archiveExportsToLibrary ?? false,
  }
  await exportSingleItem(item, snapshot, api, createCompositeV2ExportContext(), {
    ...callbacks,
    // 单张重试独立于主导出循环：不参与主任务的暂停/取消
    shouldPause: () => false,
    shouldCancel: () => false,
  })
}

/** 写盘 + 归档管道窗口：渲染完一张立即发起写盘，不等待其完成再渲染下一张 */
const PENDING_WRITE_WINDOW = 8

export async function runCompositeV2Export(
  snapshot: CompositeV2ExportSnapshot,
  callbacks: CompositeV2ExportRuntimeCallbacks,
) {
  const api = window.electronAPI
  if (!api) throw new Error('当前环境不支持本地导出')
  const items = expandCompositeExportItems(snapshot)
  const ctx = createCompositeV2ExportContext()
  callbacks.onProgress(0, items.length)
  let completed = 0

  const pendingWrites: Promise<void>[] = []

  setExportingActive(true)
  try {
    for (const item of items) {
      await waitWhilePaused(callbacks.shouldPause, callbacks.shouldCancel)
      if (callbacks.shouldCancel()) break

      // P1-2：写盘与归档不阻塞主渲染循环；超过窗口时等待最旧的完成，防止无界堆积
      const writePromise = exportSingleItem(item, snapshot, api, ctx, callbacks)
      pendingWrites.push(writePromise)
      if (pendingWrites.length >= PENDING_WRITE_WINDOW) {
        const oldest = pendingWrites.shift()
        if (oldest) await Promise.allSettled([oldest])
      }
      completed += 1
      callbacks.onProgress(completed, items.length)
    }
  } finally {
    // 等管道中所有写盘/归档落定（取消时已发出的写盘仍会完成并计入成功列表）
    await Promise.allSettled(pendingWrites)
    setExportingActive(false)
  }
}
