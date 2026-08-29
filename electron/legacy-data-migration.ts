import { app } from 'electron'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'fs'
import path from 'path'

/**
 * 旧版本应用数据自动迁移（跨版本数据连续性保障）。
 *
 * 背景：Electron 的 userData 目录名跟随打包后 package.json 的 productName。
 * 本项目历史上先后使用过「豆泡」「gpt-image-playground」「DOUPAO V2」等名称，
 * 用户从旧名称的版本升级到新版本时，新版本会在全新的 userData 目录下启动，
 * 词条库、标签工作区、收藏夹、任务、Agent 对话、素材库等在界面上"全部消失"。
 *
 * 机制：在主进程启动早期（窗口创建前、渲染进程 IndexedDB 打开前）执行一次性迁移——
 * 当前 userData 缺少状态文件时，从同级目录下的旧版本数据目录【复制】以下数据到当前
 * userData（只复制不移动，源目录永不改动，复制失败不影响启动）：
 *   1. gpt-image-playground.json（Zustand 持久化状态：词条库旧字段、标签工作区、收藏夹、设置等）
 *   2. local-settings.json（素材库位置 localSavePath 等应用配置）
 *   3. local-saves/（自包含素材库：原图、SQLite 权威目录、缩略图、备份、库元数据）
 *   4. asset-kernel.sqlite(+wal/shm)（旧布局的素材目录，启动后由 migrateCatalogIntoLibrary 迁入库根）
 *   5. IndexedDB/（词条库、任务、Agent 对话、缩略图等大对象）
 *   6. Local Storage/（localStorage 残留状态）
 *   7. backups/（旧版自动备份）
 *
 * 迁移成功后写入标记文件 .legacy-data-migrated.json，后续启动不再执行。
 * 另外提供 ensureStateFileReadable()：状态文件缺失/为空/损坏且 .bak 也无效时，
 * 从 userData/backups/ 恢复最近一次自动备份快照，避免单次写坏导致界面"空数据"。
 */

/** 主状态文件名（与 src/store.ts 的 fileName 保持一致）。 */
export const STATE_FILE = 'gpt-image-playground.json'
/** 本地设置文件名（与 ipc-handlers.ts / library-paths.ts 保持一致）。 */
export const LOCAL_SETTINGS_FILE = 'local-settings.json'
/** 迁移标记文件名（位于 userData 根）。 */
export const MIGRATION_MARKER_FILE = '.legacy-data-migrated.json'

/** 历史版本使用过的 userData 目录名（大小写不敏感匹配；当前目录名 DOUPAO V2 不在其中）。 */
export const LEGACY_APP_DIR_NAMES = [
  '豆泡',
  'doupao',
  'doupao v1',
  'gpt-image-playground',
  'gpt_image_playground',
  'gpt-image-playground-web',
  'doupao-liangnianban',
]

export interface LegacyDataMigrationResult {
  /** 是否从旧目录导入了数据。 */
  migrated: boolean
  /** 数据来源的旧 userData 目录；未发现时为 null。 */
  sourceDir: string | null
  /** 实际导入的项目名（如 'gpt-image-playground.json'、'local-saves'）。 */
  imported: string[]
}

function sameDir(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
}

function isReadableJsonFile(filePath: string): boolean {
  try {
    const content = readFileSync(filePath, 'utf-8')
    if (!content.trim()) return false
    return JSON.parse(content) !== null
  } catch {
    return false
  }
}

/** 目标文件缺失或内容为空/损坏（损坏时调用方会先改名保留现场再复制）。 */
function needsStateImport(target: string): boolean {
  if (!existsSync(target)) return true
  return !isReadableJsonFile(target)
}

/** 目录里是否存在名字包含指定片段（大小写不敏感）的子目录。 */
function hasSubDirContaining(parent: string, fragment: string): boolean {
  try {
    return readdirSync(parent, { withFileTypes: true }).some(
      (entry) => entry.isDirectory() && entry.name.toLowerCase().includes(fragment.toLowerCase()),
    )
  } catch {
    return false
  }
}

/**
 * 在 appData 下查找旧版本 userData 目录：目录名命中 LEGACY_APP_DIR_NAMES、
 * 不是当前 userData、且内含状态文件；多个候选时取状态文件最新者。
 */
export function findLegacyAppDataDir(appDataDir: string, currentUserData: string): string | null {
  let best: string | null = null
  let bestMtime = -1
  for (const name of LEGACY_APP_DIR_NAMES) {
    const candidate = path.join(appDataDir, name)
    try {
      if (!existsSync(candidate) || !statSync(candidate).isDirectory()) continue
    } catch {
      // 单个候选无法访问（权限/符号链接损坏等）不影响其他候选
      continue
    }
    if (sameDir(candidate, currentUserData)) continue
    const stateFile = path.join(candidate, STATE_FILE)
    if (!existsSync(stateFile)) continue
    try {
      const mtime = statSync(stateFile).mtimeMs
      if (mtime > bestMtime) {
        bestMtime = mtime
        best = candidate
      }
    } catch {
      // 单个候选读取失败不影响其他候选
    }
  }
  return best
}

/** 复制文件（目标已存在时不覆盖，避免破坏现有数据）。返回是否执行了复制。 */
function copyFileIfMissing(source: string, target: string): boolean {
  if (!existsSync(source) || existsSync(target)) return false
  mkdirSync(path.dirname(target), { recursive: true })
  try {
    cpSync(source, target)
    return true
  } catch (error) {
    console.error('[legacy-data-migration] 复制失败:', source, error)
    return false
  }
}

/** 复制目录（目标已存在时不覆盖）。返回是否执行了复制。 */
function copyDirIfMissing(source: string, target: string): boolean {
  if (!existsSync(source) || existsSync(target)) return false
  mkdirSync(path.dirname(target), { recursive: true })
  try {
    cpSync(source, target, { recursive: true })
    return true
  } catch (error) {
    console.error('[legacy-data-migration] 复制目录失败:', source, error)
    return false
  }
}

/** 当前 IndexedDB 目录是否已有真实数据库（存在 *.indexeddb.leveldb 子目录）。 */
function hasIndexedDbData(userDataDir: string): boolean {
  const indexedDbDir = path.join(userDataDir, 'IndexedDB')
  if (!existsSync(indexedDbDir)) return false
  return hasSubDirContaining(indexedDbDir, 'indexeddb.leveldb')
}

function writeMarker(userDataDir: string, result: LegacyDataMigrationResult, now: number): void {
  const marker = {
    migratedAt: new Date(now).toISOString(),
    sourceDir: result.sourceDir,
    imported: result.imported,
  }
  try {
    writeFileSync(path.join(userDataDir, MIGRATION_MARKER_FILE), JSON.stringify(marker, null, 2), 'utf-8')
  } catch (error) {
    console.error('[legacy-data-migration] 写标记文件失败:', error)
  }
}

/**
 * 一次性旧数据迁移：当前 userData 缺少可读状态文件时，从旧版本目录复制数据过来。
 * 幂等：已有标记文件、或当前状态文件可读时直接跳过；只复制不移动，源目录保持不变。
 */
export function migrateLegacyAppDataIfNeeded(
  options: { appDataDir?: string; userDataDir?: string; now?: number } = {},
): LegacyDataMigrationResult {
  const appDataDir = options.appDataDir ?? app.getPath('appData')
  const userDataDir = options.userDataDir ?? app.getPath('userData')
  const now = options.now ?? Date.now()
  const statePath = path.join(userDataDir, STATE_FILE)
  const result: LegacyDataMigrationResult = { migrated: false, sourceDir: null, imported: [] }

  if (existsSync(path.join(userDataDir, MIGRATION_MARKER_FILE))) return result
  const sourceDir = findLegacyAppDataDir(appDataDir, userDataDir)
  if (!sourceDir) return result

  mkdirSync(userDataDir, { recursive: true })
  const stateImported = needsStateImport(statePath)
  if (stateImported && existsSync(path.join(sourceDir, STATE_FILE))) {
    // 当前状态文件损坏时先改名保留现场，再复制旧数据（.bak 不动，保留原备份链）
    if (existsSync(statePath)) {
      try {
        renameSync(statePath, statePath + '.corrupt-' + now)
      } catch {
        // 改名失败不阻塞复制
      }
    }
    if (copyFileIfMissing(path.join(sourceDir, STATE_FILE), statePath)) {
      result.imported.push(STATE_FILE)
    }
    copyFileIfMissing(path.join(sourceDir, STATE_FILE + '.bak'), statePath + '.bak')
  }

  // 只有状态文件导入成功（或原本就可读）才继续处理其余项目并写标记；
  // 状态导入失败时不写标记，下次启动重试。
  if (!isReadableJsonFile(statePath)) return result

  if (copyFileIfMissing(path.join(sourceDir, LOCAL_SETTINGS_FILE), path.join(userDataDir, LOCAL_SETTINGS_FILE))) {
    result.imported.push(LOCAL_SETTINGS_FILE)
  }
  if (copyDirIfMissing(path.join(sourceDir, 'local-saves'), path.join(userDataDir, 'local-saves'))) {
    result.imported.push('local-saves')
  }
  for (const suffix of ['', '-wal', '-shm']) {
    if (
      copyFileIfMissing(
        path.join(sourceDir, 'asset-kernel.sqlite' + suffix),
        path.join(userDataDir, 'asset-kernel.sqlite' + suffix),
      )
    ) {
      if (suffix === '') result.imported.push('asset-kernel.sqlite')
    }
  }
  if (
    !hasIndexedDbData(userDataDir) &&
    copyDirIfMissing(path.join(sourceDir, 'IndexedDB'), path.join(userDataDir, 'IndexedDB'))
  ) {
    result.imported.push('IndexedDB')
  }
  if (copyDirIfMissing(path.join(sourceDir, 'Local Storage'), path.join(userDataDir, 'Local Storage'))) {
    result.imported.push('Local Storage')
  }
  if (copyDirIfMissing(path.join(sourceDir, 'backups'), path.join(userDataDir, 'backups'))) {
    result.imported.push('backups')
  }

  result.migrated = result.imported.length > 0
  result.sourceDir = sourceDir
  writeMarker(userDataDir, result, now)
  if (result.migrated) {
    console.log(`[legacy-data-migration] 已从旧版本数据目录导入：${sourceDir}\n  → ${result.imported.join('、')}`)
  }
  return result
}

/**
 * 状态文件兜底恢复：主文件与 .bak 均缺失/损坏时，从 userData/backups/
 * 最近一次 gpt-image-playground-*.json 自动备份快照恢复主文件。
 * 仅在确实无可读状态时执行，绝不覆盖可读数据。
 */
export function ensureStateFileReadable(userDataDir = app.getPath('userData')): boolean {
  const statePath = path.join(userDataDir, STATE_FILE)
  if (isReadableJsonFile(statePath)) return true
  if (existsSync(path.join(userDataDir, STATE_FILE + '.bak'))) {
    // readJsonText 已有 .bak 回退；这里不重复处理，仅确认 .bak 可读
    return isReadableJsonFile(path.join(userDataDir, STATE_FILE + '.bak'))
  }
  const backupsDir = path.join(userDataDir, 'backups')
  let newest: { file: string; mtime: number } | null = null
  try {
    for (const entry of readdirSync(backupsDir)) {
      if (!entry.startsWith('gpt-image-playground-') || !entry.endsWith('.json')) continue
      const file = path.join(backupsDir, entry)
      try {
        const mtime = statSync(file).mtimeMs
        if (!newest || mtime > newest.mtime) newest = { file, mtime }
      } catch {
        // 单个快照读取失败不影响其他
      }
    }
  } catch {
    return false
  }
  if (!newest) return false
  try {
    mkdirSync(userDataDir, { recursive: true })
    // 目标缺失/损坏时保留现场再恢复（.bak 不动）
    if (existsSync(statePath)) {
      try {
        renameSync(statePath, statePath + '.corrupt-' + Date.now())
      } catch {
        // 改名失败不阻塞恢复
      }
    }
    cpSync(newest.file, statePath)
    console.log(`[legacy-data-migration] 状态文件不可读，已从备份快照恢复：${newest.file}`)
    return true
  } catch (error) {
    console.error('[legacy-data-migration] 从备份快照恢复失败:', error)
    return false
  }
}
