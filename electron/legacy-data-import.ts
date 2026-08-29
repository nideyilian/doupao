import { app } from 'electron'
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import path from 'path'
import { LEGACY_APP_DIR_NAMES, LOCAL_SETTINGS_FILE, STATE_FILE } from './legacy-data-migration'

/**
 * 旧版数据手动导入（设置页「数据管理」入口）。
 *
 * 与启动自动迁移（legacy-data-migration.ts）的关系：
 * - 自动迁移只在「当前 userData 无状态文件」时触发一次，属于全新安装的兜底；
 * - 手动导入随时可触发：从旧 userData 目录（豆泡 / doupao / gpt-image-playground 等）
 *   复制 状态文件（标签工作区/收藏夹/设置）、local-settings.json、素材库 local-saves/，
 *   以及 IndexedDB 中**匹配当前运行模式**的数据目录。
 *
 * IndexedDB 的 origin 绑定说明：
 * Chromium 按 origin 存放 IndexedDB（目录名前缀区分）：
 * - 打包版 / electron .（file:// 加载）→ file__0.indexeddb.leveldb（+ 同名 .blob 大对象目录）
 * - dev（http://localhost:41731）→ http_localhost_41731.indexeddb.leveldb
 * 直接复制目录只在同 origin 时有效，因此导入时按当前运行模式筛选目录；
 * 跨模式（dev ⇄ 安装版）的数据迁移走渲染进程的「导出数据 / 导入数据文件」
 * （JSON 载荷写入目标模式自己的 IndexedDB，见 src/lib/legacyDataTransfer.ts）。
 */

/** 当前运行模式对应的 IndexedDB 目录名前缀（dev 端口固定 41731，见 vite.config.ts strictPort）。 */
export function currentIndexedDbDirPrefix(devServerUrl = process.env.VITE_DEV_SERVER_URL): string {
  return devServerUrl ? 'http_localhost_41731' : 'file__0'
}

export interface LegacyIndexedDbEntry {
  /** leveldb 目录名，如 file__0.indexeddb.leveldb */
  dirName: string
  /** 该目录估算大小（MB，含同名 .blob 目录） */
  sizeMb: number
  /** 是否为当前运行模式的数据目录（导入时只会复制它） */
  matchesCurrentOrigin: boolean
}

export interface LegacySourceInfo {
  /** 旧 userData 目录绝对路径 */
  dir: string
  /** 目录名（如 gpt-image-playground） */
  dirName: string
  /** 状态文件最后修改时间（ms）；不存在为 null */
  stateFileMtime: number | null
  hasLocalSettings: boolean
  hasLocalSaves: boolean
  /** local-saves 估算大小（MB） */
  localSavesSizeMb: number
  /** IndexedDB 下的全部 leveldb 数据目录（含 origin 匹配标记） */
  indexedDbEntries: LegacyIndexedDbEntry[]
  hasBackups: boolean
  /** 全目录估算大小（MB） */
  sizeMb: number
}

function dirSizeMb(dir: string): number {
  try {
    if (!existsSync(dir)) return 0
    let bytes = 0
    const stack = [dir]
    while (stack.length > 0) {
      const current = stack.pop()!
      let entries: string[]
      try {
        entries = readdirSync(current)
      } catch {
        continue
      }
      for (const name of entries) {
        const full = path.join(current, name)
        try {
          const stat = statSync(full)
          if (stat.isDirectory()) stack.push(full)
          else bytes += stat.size
        } catch {
          // 单个条目不可读不影响统计
        }
      }
    }
    return Math.round(bytes / 1024 / 1024)
  } catch {
    return 0
  }
}

function listIndexedDbEntries(indexedDbDir: string, currentPrefix: string): LegacyIndexedDbEntry[] {
  if (!existsSync(indexedDbDir)) return []
  let entries: string[] = []
  try {
    entries = readdirSync(indexedDbDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.endsWith('.indexeddb.leveldb'))
      .map((entry) => entry.name)
  } catch {
    return []
  }
  return entries.map((dirName) => {
    const blobDir = dirName.replace(/\.indexeddb\.leveldb$/, '.indexeddb.blob')
    const sizeMb = dirSizeMb(path.join(indexedDbDir, dirName)) + dirSizeMb(path.join(indexedDbDir, blobDir))
    return {
      dirName,
      sizeMb,
      matchesCurrentOrigin: dirName.startsWith(currentPrefix),
    }
  })
}

/**
 * 扫描 appData 下的旧版本 userData 目录（目录名命中历史名称列表且与当前目录不同）。
 * 不要求状态文件存在——即便只有 local-saves / IndexedDB 也值得展示（部分用户手动删过状态文件）。
 */
export function scanLegacySources(
  appDataDir = app.getPath('appData'),
  currentUserData = app.getPath('userData'),
  currentPrefix = currentIndexedDbDirPrefix(),
): LegacySourceInfo[] {
  const current = path.resolve(currentUserData).toLowerCase()
  const results: LegacySourceInfo[] = []
  for (const name of LEGACY_APP_DIR_NAMES) {
    const dir = path.join(appDataDir, name)
    try {
      if (!existsSync(dir) || !statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    if (path.resolve(dir).toLowerCase() === current) continue
    const statePath = path.join(dir, STATE_FILE)
    let stateFileMtime: number | null = null
    try {
      if (existsSync(statePath)) stateFileMtime = statSync(statePath).mtimeMs
    } catch {
      // 状态文件不可读时仍展示该来源（其余数据可能完好）
    }
    const localSavesDir = path.join(dir, 'local-saves')
    results.push({
      dir,
      dirName: name,
      stateFileMtime,
      hasLocalSettings: existsSync(path.join(dir, LOCAL_SETTINGS_FILE)),
      hasLocalSaves: existsSync(localSavesDir),
      localSavesSizeMb: dirSizeMb(localSavesDir),
      indexedDbEntries: listIndexedDbEntries(path.join(dir, 'IndexedDB'), currentPrefix),
      hasBackups: existsSync(path.join(dir, 'backups')),
      sizeMb: dirSizeMb(dir),
    })
  }
  return results
}

export interface LegacyImportSelection {
  /** 状态文件 gpt-image-playground.json（+ .bak）：标签工作区、收藏夹、设置等 */
  importState: boolean
  /** local-settings.json（素材库位置等配置） */
  importLocalSettings: boolean
  /** 素材库目录 local-saves/（原图、SQLite、缩略图、备份） */
  importLocalSaves: boolean
  /** IndexedDB 中匹配当前运行模式的目录（任务、词条库、Agent 对话、图片记录） */
  importIndexedDb: boolean
}

export interface LegacyImportResult {
  imported: string[]
  skipped: string[]
  notes: string[]
}

/** 目标缺失才复制单个文件（不覆盖已有数据，杜绝导入冲掉新数据）。 */
function copyFileIfMissing(source: string, target: string, imported: string[], skipped: string[], label: string): void {
  if (!existsSync(source)) return
  if (existsSync(target)) {
    skipped.push(`${label}（目标已存在，跳过）`)
    return
  }
  try {
    mkdirSync(path.dirname(target), { recursive: true })
    cpSync(source, target)
    imported.push(label)
  } catch (error) {
    skipped.push(`${label}（复制失败: ${error instanceof Error ? error.message : String(error)}）`)
  }
}

/**
 * 从旧目录导入数据到当前 userData（只复制不移动，不覆盖任何已存在目标）。
 * - 状态文件 / local-settings：目标缺失才复制；
 * - local-saves：目标目录不存在才整体复制（已存在说明素材库已就位，避免合并冲突）；
 * - IndexedDB：仅复制匹配当前运行模式前缀的 leveldb + 同名 blob 目录，目标同名目录已存在则跳过。
 */
export function importLegacySource(
  sourceDir: string,
  userDataDir = app.getPath('userData'),
  selection: LegacyImportSelection,
  currentPrefix = currentIndexedDbDirPrefix(),
): LegacyImportResult {
  const imported: string[] = []
  const skipped: string[] = []
  const notes: string[] = []
  const result: LegacyImportResult = { imported, skipped, notes }
  if (!existsSync(sourceDir)) return result

  if (selection.importState) {
    copyFileIfMissing(
      path.join(sourceDir, STATE_FILE),
      path.join(userDataDir, STATE_FILE),
      imported,
      skipped,
      '标签工作区与设置（状态文件）',
    )
    copyFileIfMissing(
      path.join(sourceDir, STATE_FILE + '.bak'),
      path.join(userDataDir, STATE_FILE + '.bak'),
      imported,
      skipped,
      '状态文件备份(.bak)',
    )
  }

  if (selection.importLocalSettings) {
    copyFileIfMissing(
      path.join(sourceDir, LOCAL_SETTINGS_FILE),
      path.join(userDataDir, LOCAL_SETTINGS_FILE),
      imported,
      skipped,
      '本地设置(local-settings.json)',
    )
  }

  if (selection.importLocalSaves) {
    const source = path.join(sourceDir, 'local-saves')
    const target = path.join(userDataDir, 'local-saves')
    if (existsSync(source)) {
      if (existsSync(target)) {
        skipped.push('素材库(local-saves)（目标已存在，跳过；请勿重复导入）')
      } else {
        try {
          mkdirSync(userDataDir, { recursive: true })
          cpSync(source, target, { recursive: true })
          imported.push('素材库(local-saves)')
        } catch (error) {
          skipped.push(`素材库(local-saves)（复制失败: ${error instanceof Error ? error.message : String(error)}）`)
        }
      }
    }
  }

  if (selection.importIndexedDb) {
    const sourceIndexedDb = path.join(sourceDir, 'IndexedDB')
    const targetIndexedDb = path.join(userDataDir, 'IndexedDB')
    if (existsSync(sourceIndexedDb)) {
      let matched = 0
      for (const entry of listIndexedDbEntries(sourceIndexedDb, currentPrefix)) {
        if (!entry.matchesCurrentOrigin) continue
        matched++
        const sourceDirEntry = path.join(sourceIndexedDb, entry.dirName)
        const targetDirEntry = path.join(targetIndexedDb, entry.dirName)
        if (existsSync(targetDirEntry)) {
          skipped.push(`任务与词条库(${entry.dirName})（目标已存在，跳过）`)
          continue
        }
        try {
          mkdirSync(targetIndexedDb, { recursive: true })
          cpSync(sourceDirEntry, targetDirEntry, { recursive: true })
          imported.push(`任务与词条库(${entry.dirName})`)
          // 大对象 blob 目录（图片 dataUrl 等大值）同名复制
          const blobName = entry.dirName.replace(/\.indexeddb\.leveldb$/, '.indexeddb.blob')
          const sourceBlob = path.join(sourceIndexedDb, blobName)
          const targetBlob = path.join(targetIndexedDb, blobName)
          if (existsSync(sourceBlob) && !existsSync(targetBlob)) {
            cpSync(sourceBlob, targetBlob, { recursive: true })
          }
        } catch (error) {
          skipped.push(
            `任务与词条库(${entry.dirName})（复制失败: ${error instanceof Error ? error.message : String(error)}）`,
          )
        }
      }
      if (matched === 0) {
        notes.push(
          '未发现与当前运行模式匹配的任务/词条库数据（dev 与安装版互不可见，需用「导出数据/导入数据文件」迁移）',
        )
      }
    }
  }

  return result
}
