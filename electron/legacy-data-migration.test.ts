import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STATE_FILE,
  MIGRATION_MARKER_FILE,
  LOCAL_SETTINGS_FILE,
  ensureStateFileReadable,
  findLegacyAppDataDir,
  migrateLegacyAppDataIfNeeded,
} from './legacy-data-migration'

const mockAppData = mkdtempSync(path.join(os.tmpdir(), 'legacy-appdata-'))

vi.mock('electron', () => ({
  app: {
    getPath: () => mockAppData,
  },
}))

function makeLegacyUserData(name: string, now: number): string {
  const dir = path.join(mockAppData, name)
  mkdirSync(path.join(dir, 'local-saves', 'db'), { recursive: true })
  mkdirSync(path.join(dir, 'IndexedDB', 'file__0.indexeddb.leveldb'), { recursive: true })
  writeFileSync(
    path.join(dir, STATE_FILE),
    JSON.stringify({ state: { workspaceTabs: [], favoriteCollections: [] }, now }),
    'utf-8',
  )
  writeFileSync(
    path.join(dir, LOCAL_SETTINGS_FILE),
    JSON.stringify({ localSavePath: path.join(dir, 'local-saves') }),
    'utf-8',
  )
  writeFileSync(path.join(dir, 'local-saves', 'db', 'asset-kernel.sqlite'), 'sqlite-bytes', 'utf-8')
  return dir
}

function makeCurrentUserData(): string {
  const dir = mkdtempSync(path.join(mockAppData, 'current-'))
  return dir
}

describe('findLegacyAppDataDir', () => {
  beforeEach(() => {
    rmSync(mockAppData, { recursive: true, force: true })
    mkdirSync(mockAppData, { recursive: true })
  })

  afterAll(() => {
    rmSync(mockAppData, { recursive: true, force: true })
  })

  it('returns null when no legacy dir exists', () => {
    const current = makeCurrentUserData()
    expect(findLegacyAppDataDir(mockAppData, current)).toBeNull()
  })

  it('finds a legacy dir containing the state file', () => {
    const legacy = makeLegacyUserData('豆泡', 1_000)
    const current = makeCurrentUserData()
    expect(findLegacyAppDataDir(mockAppData, current)).toBe(legacy)
  })

  it('matches legacy dir names case-insensitively', () => {
    const legacy = makeLegacyUserData('DOUPAO', 1_000)
    const current = makeCurrentUserData()
    const found = findLegacyAppDataDir(mockAppData, current)
    // 大小写不敏感文件系统上 'doupao' 与 'DOUPAO' 指向同一目录，比较解析后的小写路径
    expect(found ? path.resolve(found).toLowerCase() : null).toBe(path.resolve(legacy).toLowerCase())
  })

  it('ignores dirs without a state file', () => {
    const dir = path.join(mockAppData, 'gpt-image-playground')
    mkdirSync(dir, { recursive: true })
    const current = makeCurrentUserData()
    expect(findLegacyAppDataDir(mockAppData, current)).toBeNull()
  })

  it('picks the dir with the newest state file', () => {
    const older = makeLegacyUserData('豆泡', 1_000)
    const newer = makeLegacyUserData('gpt-image-playground', 2_000)
    const current = makeCurrentUserData()
    expect(findLegacyAppDataDir(mockAppData, current)).toBe(newer)
    void older
  })

  it('excludes the current userData dir even when its name matches a legacy name', () => {
    const devUserData = path.join(mockAppData, 'gpt-image-playground')
    mkdirSync(devUserData, { recursive: true })
    writeFileSync(path.join(devUserData, STATE_FILE), '{}', 'utf-8')
    expect(findLegacyAppDataDir(mockAppData, devUserData)).toBeNull()
  })
})

describe('migrateLegacyAppDataIfNeeded', () => {
  beforeEach(() => {
    rmSync(mockAppData, { recursive: true, force: true })
    mkdirSync(mockAppData, { recursive: true })
  })

  afterAll(() => {
    rmSync(mockAppData, { recursive: true, force: true })
  })

  it('imports state, settings, library and IndexedDB into a fresh userData', () => {
    const legacy = makeLegacyUserData('豆泡', 1_000)
    const current = makeCurrentUserData()
    const result = migrateLegacyAppDataIfNeeded({ appDataDir: mockAppData, userDataDir: current, now: 9_000 })

    expect(result.migrated).toBe(true)
    expect(result.sourceDir).toBe(legacy)
    expect(result.imported).toEqual(
      expect.arrayContaining([STATE_FILE, LOCAL_SETTINGS_FILE, 'local-saves', 'IndexedDB']),
    )
    expect(existsSync(path.join(current, STATE_FILE))).toBe(true)
    expect(existsSync(path.join(current, 'local-saves', 'db', 'asset-kernel.sqlite'))).toBe(true)
    expect(existsSync(path.join(current, 'IndexedDB', 'file__0.indexeddb.leveldb'))).toBe(true)
    expect(existsSync(path.join(current, MIGRATION_MARKER_FILE))).toBe(true)
    // 源目录原封不动
    expect(existsSync(path.join(legacy, STATE_FILE))).toBe(true)
    const marker = JSON.parse(readFileSync(path.join(current, MIGRATION_MARKER_FILE), 'utf-8'))
    expect(marker.sourceDir).toBe(legacy)
    expect(marker.imported).toContain(STATE_FILE)
  })

  it('is a no-op when the marker already exists', () => {
    const legacy = makeLegacyUserData('豆泡', 1_000)
    const current = makeCurrentUserData()
    writeFileSync(path.join(current, MIGRATION_MARKER_FILE), '{}', 'utf-8')
    const result = migrateLegacyAppDataIfNeeded({ appDataDir: mockAppData, userDataDir: current, now: 9_000 })
    expect(result.migrated).toBe(false)
    expect(existsSync(path.join(current, STATE_FILE))).toBe(false)
    void legacy
  })

  it('does nothing when no legacy dir exists and writes no marker', () => {
    const current = makeCurrentUserData()
    const result = migrateLegacyAppDataIfNeeded({ appDataDir: mockAppData, userDataDir: current, now: 9_000 })
    expect(result.migrated).toBe(false)
    expect(result.sourceDir).toBeNull()
    expect(existsSync(path.join(current, MIGRATION_MARKER_FILE))).toBe(false)
  })

  it('replaces an empty current state file with the legacy state, keeping the original renamed', () => {
    makeLegacyUserData('豆泡', 1_000)
    const current = makeCurrentUserData()
    writeFileSync(path.join(current, STATE_FILE), '   ', 'utf-8')
    const result = migrateLegacyAppDataIfNeeded({ appDataDir: mockAppData, userDataDir: current, now: 9_000 })
    expect(result.migrated).toBe(true)
    expect(result.imported).toContain(STATE_FILE)
    const renames = readdirSync(current).filter((name) => name.startsWith(STATE_FILE + '.corrupt-'))
    expect(renames).toHaveLength(1)
    expect(readFileSync(path.join(current, STATE_FILE), 'utf-8')).toContain('workspaceTabs')
  })

  it('replaces a corrupt current state file, keeping the original renamed', () => {
    makeLegacyUserData('豆泡', 1_000)
    const current = makeCurrentUserData()
    writeFileSync(path.join(current, STATE_FILE), '{not-json', 'utf-8')
    const result = migrateLegacyAppDataIfNeeded({ appDataDir: mockAppData, userDataDir: current, now: 9_000 })
    expect(result.migrated).toBe(true)
    const renames = readdirSync(current).filter((name) => name.startsWith(STATE_FILE + '.corrupt-'))
    expect(renames).toHaveLength(1)
    expect(JSON.parse(readFileSync(path.join(current, STATE_FILE), 'utf-8'))).not.toBeNull()
  })

  it('does not touch a readable current state file', () => {
    makeLegacyUserData('豆泡', 1_000)
    const current = makeCurrentUserData()
    const original = JSON.stringify({ state: { fresh: true } })
    writeFileSync(path.join(current, STATE_FILE), original, 'utf-8')
    const result = migrateLegacyAppDataIfNeeded({ appDataDir: mockAppData, userDataDir: current, now: 9_000 })
    expect(result.imported).not.toContain(STATE_FILE)
    expect(readFileSync(path.join(current, STATE_FILE), 'utf-8')).toBe(original)
    // 缺失的目录仍会补全
    expect(existsSync(path.join(current, 'local-saves', 'db', 'asset-kernel.sqlite'))).toBe(true)
  })

  it('writes no marker when the state import fails', () => {
    const legacy = makeLegacyUserData('豆泡', 1_000)
    // 源状态文件是目录 → 文件复制必然失败 → 不写标记，下次启动重试
    rmSync(path.join(legacy, STATE_FILE))
    mkdirSync(path.join(legacy, STATE_FILE), { recursive: true })
    const current = makeCurrentUserData()
    const result = migrateLegacyAppDataIfNeeded({ appDataDir: mockAppData, userDataDir: current, now: 9_000 })
    expect(result.migrated).toBe(false)
    expect(existsSync(path.join(current, MIGRATION_MARKER_FILE))).toBe(false)
  })
})

describe('ensureStateFileReadable', () => {
  beforeEach(() => {
    rmSync(mockAppData, { recursive: true, force: true })
    mkdirSync(mockAppData, { recursive: true })
  })

  afterAll(() => {
    rmSync(mockAppData, { recursive: true, force: true })
  })

  it('returns true when the state file is readable and changes nothing', () => {
    const current = makeCurrentUserData()
    const original = JSON.stringify({ state: { ok: true } })
    writeFileSync(path.join(current, STATE_FILE), original, 'utf-8')
    expect(ensureStateFileReadable(current)).toBe(true)
    expect(readFileSync(path.join(current, STATE_FILE), 'utf-8')).toBe(original)
  })

  it('restores the readable .bak file into the state path', () => {
    const current = makeCurrentUserData()
    const backup = JSON.stringify({ state: { ok: true } })
    writeFileSync(path.join(current, STATE_FILE + '.bak'), backup, 'utf-8')
    expect(ensureStateFileReadable(current)).toBe(true)
    expect(readFileSync(path.join(current, STATE_FILE), 'utf-8')).toBe(backup)
  })

  it('prefers the readable .bak file when the main state file is corrupt', () => {
    const current = makeCurrentUserData()
    writeFileSync(path.join(current, STATE_FILE), '{broken', 'utf-8')
    const backup = JSON.stringify({ state: { recovered: true } })
    writeFileSync(path.join(current, STATE_FILE + '.bak'), backup, 'utf-8')

    expect(ensureStateFileReadable(current)).toBe(true)
    expect(readFileSync(path.join(current, STATE_FILE), 'utf-8')).toBe(backup)
    expect(readdirSync(current).some((name) => name.startsWith(STATE_FILE + '.corrupt-'))).toBe(true)
  })

  it('restores the newest backup snapshot when state and .bak are missing', () => {
    const current = makeCurrentUserData()
    const backupsDir = path.join(current, 'backups')
    mkdirSync(backupsDir, { recursive: true })
    writeFileSync(
      path.join(backupsDir, 'gpt-image-playground-old.json'),
      JSON.stringify({ state: { old: true } }),
      'utf-8',
    )
    writeFileSync(
      path.join(backupsDir, 'gpt-image-playground-new.json'),
      JSON.stringify({ state: { new: true } }),
      'utf-8',
    )
    expect(ensureStateFileReadable(current)).toBe(true)
    expect(JSON.parse(readFileSync(path.join(current, STATE_FILE), 'utf-8'))).toEqual({ state: { new: true } })
  })

  it('restores a snapshot when the state file is corrupt, keeping the original renamed', () => {
    const current = makeCurrentUserData()
    writeFileSync(path.join(current, STATE_FILE), '{broken', 'utf-8')
    const backupsDir = path.join(current, 'backups')
    mkdirSync(backupsDir, { recursive: true })
    writeFileSync(
      path.join(backupsDir, 'gpt-image-playground-1.json'),
      JSON.stringify({ state: { ok: true } }),
      'utf-8',
    )
    expect(ensureStateFileReadable(current)).toBe(true)
    expect(JSON.parse(readFileSync(path.join(current, STATE_FILE), 'utf-8'))).toEqual({ state: { ok: true } })
    const renames = readdirSync(current).filter((name) => name.startsWith(STATE_FILE + '.corrupt-'))
    expect(renames).toHaveLength(1)
  })

  it('returns false when nothing is available', () => {
    const current = makeCurrentUserData()
    expect(ensureStateFileReadable(current)).toBe(false)
  })
})
