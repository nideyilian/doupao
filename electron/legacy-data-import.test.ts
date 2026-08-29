import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  currentIndexedDbDirPrefix,
  importLegacySource,
  scanLegacySources,
  type LegacyImportSelection,
} from './legacy-data-import'
import { LOCAL_SETTINGS_FILE, STATE_FILE } from './legacy-data-migration'

const mockAppData = mkdtempSync(path.join(os.tmpdir(), 'legacy-import-appdata-'))

function makeLegacyUserData(name: string): string {
  const dir = path.join(mockAppData, name)
  mkdirSync(path.join(dir, 'local-saves', 'cache-images'), { recursive: true })
  mkdirSync(path.join(dir, 'IndexedDB', 'file__0.indexeddb.leveldb'), { recursive: true })
  mkdirSync(path.join(dir, 'IndexedDB', 'file__0.indexeddb.blob'), { recursive: true })
  mkdirSync(path.join(dir, 'IndexedDB', 'http_localhost_41731.indexeddb.leveldb'), { recursive: true })
  writeFileSync(path.join(dir, STATE_FILE), JSON.stringify({ state: { workspaceTabs: [] } }), 'utf-8')
  writeFileSync(path.join(dir, LOCAL_SETTINGS_FILE), JSON.stringify({ localSavePath: 'D:\\AI生图2' }), 'utf-8')
  writeFileSync(path.join(dir, 'local-saves', 'cache-images', 'a.png'), 'image-bytes')
  writeFileSync(path.join(dir, 'IndexedDB', 'file__0.indexeddb.leveldb', 'CURRENT'), 'leveldb-bytes')
  writeFileSync(path.join(dir, 'IndexedDB', 'http_localhost_41731.indexeddb.leveldb', 'DEV'), 'dev-bytes')
  return dir
}

let legacyDir: string
let currentUserData: string

beforeEach(() => {
  legacyDir = makeLegacyUserData('gpt-image-playground')
  currentUserData = mkdtempSync(path.join(os.tmpdir(), 'legacy-import-current-'))
})

afterEach(() => {
  rmSync(mockAppData, { recursive: true, force: true })
  rmSync(currentUserData, { recursive: true, force: true })
})

describe('currentIndexedDbDirPrefix', () => {
  it('uses the dev server origin prefix when running on the dev server', () => {
    expect(currentIndexedDbDirPrefix('http://127.0.0.1:41731')).toBe('http_localhost_41731')
  })

  it('uses the file origin prefix in packaged/preview mode', () => {
    expect(currentIndexedDbDirPrefix(undefined)).toBe('file__0')
    expect(currentIndexedDbDirPrefix('')).toBe('file__0')
  })
})

describe('scanLegacySources', () => {
  it('lists legacy userData dirs with content overview', () => {
    const sources = scanLegacySources(mockAppData, currentUserData, 'file__0')
    expect(sources).toHaveLength(1)
    const source = sources[0]
    expect(source.dirName).toBe('gpt-image-playground')
    expect(source.stateFileMtime).not.toBeNull()
    expect(source.hasLocalSettings).toBe(true)
    expect(source.hasLocalSaves).toBe(true)
    expect(source.localSavesSizeMb).toBeGreaterThanOrEqual(0)
    const dirNames = source.indexedDbEntries.map((entry) => entry.dirName)
    expect(dirNames).toContain('file__0.indexeddb.leveldb')
    expect(dirNames).toContain('http_localhost_41731.indexeddb.leveldb')
    expect(
      source.indexedDbEntries.find((entry) => entry.dirName === 'file__0.indexeddb.leveldb')?.matchesCurrentOrigin,
    ).toBe(true)
    expect(
      source.indexedDbEntries.find((entry) => entry.dirName === 'http_localhost_41731.indexeddb.leveldb')
        ?.matchesCurrentOrigin,
    ).toBe(false)
  })

  it('excludes the current userData dir', () => {
    const sources = scanLegacySources(mockAppData, legacyDir, 'file__0')
    expect(sources).toHaveLength(0)
  })
})

const FULL_SELECTION: LegacyImportSelection = {
  importState: true,
  importLocalSettings: true,
  importLocalSaves: true,
  importIndexedDb: true,
}

describe('importLegacySource', () => {
  it('copies state, settings, local-saves and only origin-matching IndexedDB dirs', () => {
    const result = importLegacySource(legacyDir, currentUserData, FULL_SELECTION, 'file__0')

    expect(result.imported).toContain('标签工作区与设置（状态文件）')
    expect(result.imported).toContain('本地设置(local-settings.json)')
    expect(result.imported).toContain('素材库(local-saves)')
    expect(result.imported.some((item) => item.includes('file__0.indexeddb.leveldb'))).toBe(true)
    // 其他 origin 的 IndexedDB 不复制
    expect(existsSync(path.join(currentUserData, 'IndexedDB', 'http_localhost_41731.indexeddb.leveldb'))).toBe(false)
    expect(existsSync(path.join(currentUserData, 'IndexedDB', 'file__0.indexeddb.leveldb'))).toBe(true)
    // blob 大对象目录随 leveldb 一起复制
    expect(existsSync(path.join(currentUserData, 'IndexedDB', 'file__0.indexeddb.blob'))).toBe(true)
    // 源目录保持不动（只复制不移动）
    expect(existsSync(path.join(legacyDir, 'local-saves', 'cache-images', 'a.png'))).toBe(true)
  })

  it('never overwrites existing targets and reports them as skipped', () => {
    // 预置目标数据（模拟当前版本已有数据）
    mkdirSync(path.join(currentUserData, 'local-saves'), { recursive: true })
    mkdirSync(path.join(currentUserData, 'IndexedDB', 'file__0.indexeddb.leveldb'), { recursive: true })
    writeFileSync(path.join(currentUserData, STATE_FILE), JSON.stringify({ state: { fresh: true } }), 'utf-8')
    writeFileSync(path.join(currentUserData, LOCAL_SETTINGS_FILE), JSON.stringify({ localSavePath: 'X' }), 'utf-8')

    const result = importLegacySource(legacyDir, currentUserData, FULL_SELECTION, 'file__0')

    expect(result.imported).toHaveLength(0)
    expect(result.skipped.some((item) => item.includes('状态文件'))).toBe(true)
    expect(result.skipped.some((item) => item.includes('素材库'))).toBe(true)
    expect(result.skipped.some((item) => item.includes('任务与词条库'))).toBe(true)
    // 现有数据未被覆盖
    expect(JSON.parse(readFileSync(path.join(currentUserData, STATE_FILE), 'utf-8'))).toEqual({
      state: { fresh: true },
    })
  })

  it('does nothing when only origin-mismatched IndexedDB exists and notes it', () => {
    const result = importLegacySource(
      legacyDir,
      currentUserData,
      { ...FULL_SELECTION, importIndexedDb: true },
      'http_localhost_41731',
    )
    expect(result.imported.some((item) => item.includes('file__0'))).toBe(false)
    expect(result.imported.some((item) => item.includes('http_localhost_41731'))).toBe(true)
    expect(existsSync(path.join(currentUserData, 'IndexedDB', 'http_localhost_41731.indexeddb.leveldb'))).toBe(true)
  })

  it('honors a partial selection', () => {
    const result = importLegacySource(
      legacyDir,
      currentUserData,
      { importState: true, importLocalSettings: false, importLocalSaves: false, importIndexedDb: false },
      'file__0',
    )
    expect(result.imported).toEqual(['标签工作区与设置（状态文件）'])
    expect(existsSync(path.join(currentUserData, 'local-saves'))).toBe(false)
  })

  it('returns an empty result for a missing source dir', () => {
    const result = importLegacySource(path.join(mockAppData, 'missing'), currentUserData, FULL_SELECTION, 'file__0')
    expect(result.imported).toHaveLength(0)
    expect(result.skipped).toHaveLength(0)
  })
})
