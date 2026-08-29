import { getAllLocalImagePaths } from './db'
import { isElectron, runLibraryIntegrityCheckIpc } from './localSave'

/**
 * 库完整性校验（渲染端编排，对应 docs/superpowers/specs/2026-08-20-self-contained-library-design.md §4.5）。
 * 只读：不产生任何写操作。
 * - Electron：收集 IndexedDB 全部本地图片路径作为引用集合 → 主进程执行
 *   SQLite integrity_check + cache-images 原图抽查 + 孤儿/缺失文件报告；
 * - 浏览器/PWA：无磁盘校验能力，返回不可用说明。
 */

export interface LibraryIntegrityReport {
  /** 校验是否完整执行（Electron） */
  available: boolean
  /** 不可用原因（浏览器环境） */
  unavailableReason?: string
  catalog: 'ok' | 'corrupt' | 'unavailable'
  catalogDetail?: string
  assetCount: number
  sampled: number
  mismatched: Array<{ fileName: string; expected: string; actual: string }>
  orphanFiles: string[]
  missingFiles: string[]
  checkedAt: number
}

export async function runLibraryIntegrityCheck(): Promise<LibraryIntegrityReport> {
  if (!isElectron()) {
    return {
      available: false,
      unavailableReason: '浏览器环境仅支持 IndexedDB 记录校验，磁盘完整性检查需使用桌面版',
      catalog: 'unavailable',
      assetCount: 0,
      sampled: 0,
      mismatched: [],
      orphanFiles: [],
      missingFiles: [],
      checkedAt: Date.now(),
    }
  }
  const referencedPaths = await getAllLocalImagePaths()
  const disk = await runLibraryIntegrityCheckIpc(referencedPaths)
  if (!disk) {
    return {
      available: false,
      unavailableReason: '完整性校验不可用（主进程未响应）',
      catalog: 'unavailable',
      assetCount: 0,
      sampled: 0,
      mismatched: [],
      orphanFiles: [],
      missingFiles: [],
      checkedAt: Date.now(),
    }
  }
  return { available: true, ...disk }
}
