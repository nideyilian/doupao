import type { AgentConversation, StoredImage, TaskRecord } from '../types'
import type { StoredWordLibraryState } from './db'
import {
  getAllAgentConversations,
  getAllImages,
  getAllTasks,
  getWordLibraryState,
  importLegacyStoreRecords,
} from './db'

/**
 * 跨运行模式（dev ⇄ 安装版）与跨版本的 IndexedDB 数据迁移。
 *
 * 为什么需要它：Chromium 按 origin 隔离 IndexedDB——打包版（file://）与 dev
 * （http://localhost:41731）的任务、词条库、Agent 对话互不可见，复制目录无法跨 origin 生效。
 * 本模块把当前 origin 的 IndexedDB 序列化为 JSON 文件（「导出数据」），
 * 在目标运行模式下读取并写入它自己的 IndexedDB（「导入数据文件」）。
 *
 * 体积控制：Electron 下图片大字段（dataUrl）不在 IndexedDB 中（只有 localPath 指向磁盘
 * cache-images 原图），因此导出的 images 记录是轻量元数据；缩略图缺失时由
 * getImageThumbnail 从磁盘 thumbs/ 自动恢复，原图经 localPath 直读。
 */

export const LEGACY_DATA_FILE_KIND = 'doupao-legacy-data'

export interface LegacyDataFilePayload {
  kind: typeof LEGACY_DATA_FILE_KIND
  appVersion: string
  exportedAt: number
  stores: {
    tasks?: TaskRecord[]
    wordLibrary?: StoredWordLibraryState[]
    agentConversations?: AgentConversation[]
    /** 轻量图片元数据：剥离 dataUrl（Electron 下本来就只有 localPath） */
    images?: StoredImage[]
  }
}

/** 序列化前剥离大字段（浏览器模式下 dataUrl 可能较大；Electron 下无该字段）。 */
function lightweightImage(image: StoredImage): StoredImage {
  const { dataUrl: _dataUrl, ...rest } = image
  return rest
}

/** 导出当前 IndexedDB 的任务 / 词条库 / Agent 对话 / 图片元数据为 JSON 载荷。 */
export async function buildLegacyDataExport(): Promise<LegacyDataFilePayload> {
  const [tasks, wordLibrary, agentConversations, images] = await Promise.all([
    getAllTasks(),
    getWordLibraryState(),
    getAllAgentConversations(),
    getAllImages(),
  ])
  const stores: LegacyDataFilePayload['stores'] = {}
  if (tasks.length > 0) stores.tasks = tasks
  if (wordLibrary) stores.wordLibrary = [wordLibrary]
  if (agentConversations.length > 0) stores.agentConversations = agentConversations
  if (images.length > 0) stores.images = images.map(lightweightImage)
  return {
    kind: LEGACY_DATA_FILE_KIND,
    appVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '',
    exportedAt: Date.now(),
    stores,
  }
}

/** 默认导出文件名：doupao-data-export-<yyyyMMdd-HHmmss>.json */
export function defaultLegacyDataExportFileName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `doupao-data-export-${stamp}.json`
}

export interface LegacyDataImportSummary {
  tasks: number
  wordLibrary: number
  agentConversations: number
  images: number
}

export class LegacyDataFileError extends Error {}

/** 校验并解析导出数据文件内容（宽容处理：kind 缺失但结构相似也接受，并报告提示）。 */
export function parseLegacyDataFile(content: string): LegacyDataFilePayload {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new LegacyDataFileError('文件不是有效的 JSON')
  }
  if (!parsed || typeof parsed !== 'object') throw new LegacyDataFileError('文件内容为空或格式错误')
  const payload = parsed as Partial<LegacyDataFilePayload>
  if (payload.kind !== LEGACY_DATA_FILE_KIND) {
    throw new LegacyDataFileError('不是豆泡导出的数据文件（缺少 doupao-legacy-data 标记）')
  }
  const stores = payload.stores
  if (!stores || typeof stores !== 'object') throw new LegacyDataFileError('数据文件缺少 stores 内容')
  if (Array.isArray(stores.tasks) && stores.tasks.some((task) => !task || typeof task.id !== 'string')) {
    throw new LegacyDataFileError('数据文件中的任务记录格式不正确')
  }
  if (Array.isArray(stores.images) && stores.images.some((image) => !image || typeof image.id !== 'string')) {
    throw new LegacyDataFileError('数据文件中的图片记录格式不正确')
  }
  return {
    kind: LEGACY_DATA_FILE_KIND,
    appVersion: typeof payload.appVersion === 'string' ? payload.appVersion : '',
    exportedAt: typeof payload.exportedAt === 'number' ? payload.exportedAt : Date.now(),
    stores,
  }
}

/** 把解析后的数据文件载荷写入当前 IndexedDB（已存在的主键跳过，不覆盖）。 */
export async function importLegacyDataPayload(
  payload: LegacyDataFilePayload,
  replaceExisting = false,
): Promise<LegacyDataImportSummary> {
  return importLegacyStoreRecords(
    {
      tasks: payload.stores.tasks,
      wordLibrary: payload.stores.wordLibrary,
      agentConversations: payload.stores.agentConversations,
      images: payload.stores.images,
    },
    replaceExisting,
  )
}

/** 导出文件内容的可读概要（UI 展示用）。 */
export function describeLegacyDataPayload(payload: LegacyDataFilePayload): string {
  const parts: string[] = []
  if (payload.stores.tasks?.length) parts.push(`任务 ${payload.stores.tasks.length} 条`)
  if (payload.stores.wordLibrary?.length) parts.push(`词条库 ${payload.stores.wordLibrary.length} 份`)
  if (payload.stores.agentConversations?.length) parts.push(`Agent 对话 ${payload.stores.agentConversations.length} 个`)
  if (payload.stores.images?.length) parts.push(`图片记录 ${payload.stores.images.length} 条`)
  return parts.length > 0 ? parts.join('、') : '（空数据）'
}
