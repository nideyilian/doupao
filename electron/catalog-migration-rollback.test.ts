import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mockUserData = mkdtempSync(path.join(os.tmpdir(), 'catalog-rollback-'))

vi.mock('electron', () => ({
  app: {
    getPath: () => mockUserData,
  },
}))

// 模拟跨卷：所有 rename 都抛 EXDEV，迫使 moveLibraryData 走「逐文件复制 → 校验 → 删源」分支。
// copyFileSync 保持可注入，用来在第 k 个文件上制造失败。
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    renameSync: () => {
      const error = new Error('EXDEV: cross-device link not permitted') as Error & { code?: string }
      error.code = 'EXDEV'
      throw error
    },
    copyFileSync: vi.fn(actual.copyFileSync),
  }
})

import { copyFileSync } from 'fs'
import { moveLibraryData } from './catalog-migration'

const realCopyFileSync = await vi.importActual<typeof import('fs')>('fs').then((module) => module.copyFileSync)
const copyMock = vi.mocked(copyFileSync)

const oldRoot = path.join(mockUserData, 'old-root')
const newRoot = path.join(mockUserData, 'new-root')

/** 写入一份「旧库根」样本：db 两个文件 + thumbs 一个文件。 */
function seedOldRoot() {
  rmSync(mockUserData, { recursive: true, force: true })
  mkdirSync(path.join(oldRoot, 'db'), { recursive: true })
  mkdirSync(path.join(oldRoot, 'thumbs'), { recursive: true })
  writeFileSync(path.join(oldRoot, 'db', 'asset-kernel.sqlite'), 'A')
  writeFileSync(path.join(oldRoot, 'db', 'asset-kernel.sqlite-wal'), 'B')
  writeFileSync(path.join(oldRoot, 'thumbs', 't1.webp'), 'C')
  copyMock.mockReset()
  copyMock.mockImplementation((from, to) => realCopyFileSync(from, to))
}

/** 旧库根三份文件是否都还在且内容未变。 */
function oldRootIntact() {
  return (
    readFileSync(path.join(oldRoot, 'db', 'asset-kernel.sqlite'), 'utf-8') === 'A' &&
    readFileSync(path.join(oldRoot, 'db', 'asset-kernel.sqlite-wal'), 'utf-8') === 'B' &&
    readFileSync(path.join(oldRoot, 'thumbs', 't1.webp'), 'utf-8') === 'C'
  )
}

/** 新库根下是否残留任何文件（回滚后应当一个不剩）。 */
function newRootFiles(): string[] {
  if (!existsSync(newRoot)) return []
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else found.push(full)
    }
  }
  walk(newRoot)
  return found
}

describe('库数据迁移失败回滚（跨卷复制中途失败）', () => {
  beforeEach(seedOldRoot)

  afterAll(() => {
    rmSync(mockUserData, { recursive: true, force: true })
  })

  it('复制中途失败时旧库根保持完整，新库根不留孤儿文件', () => {
    let copies = 0
    copyMock.mockImplementation((from, to) => {
      copies += 1
      if (copies === 2) throw new Error('ENOSPC: no space left on device')
      realCopyFileSync(from, to)
    })

    expect(() => moveLibraryData(oldRoot, newRoot)).toThrow('ENOSPC')

    expect(oldRootIntact()).toBe(true)
    expect(newRootFiles()).toEqual([])
  })

  it('整目录搬迁成功时旧库根清空、新库根完整（跨卷正常路径不受影响）', () => {
    moveLibraryData(oldRoot, newRoot)

    expect(existsSync(path.join(newRoot, 'db', 'asset-kernel.sqlite'))).toBe(true)
    expect(existsSync(path.join(newRoot, 'db', 'asset-kernel.sqlite-wal'))).toBe(true)
    expect(existsSync(path.join(newRoot, 'thumbs', 't1.webp'))).toBe(true)
    expect(existsSync(path.join(oldRoot, 'db'))).toBe(false)
    expect(existsSync(path.join(oldRoot, 'thumbs'))).toBe(false)
  })

  it('目标已有同名文件时保留目标、且不把它卷进回滚', () => {
    // db/ 目标目录先存在（合并语义）：其中已有一份同名 wal。
    // 注意不能放 asset-kernel.sqlite —— 那会在 moveLibraryData 入口被判为冲突而直接抛错。
    mkdirSync(path.join(newRoot, 'db'), { recursive: true })
    writeFileSync(path.join(newRoot, 'db', 'asset-kernel.sqlite-wal'), 'EXISTING-WAL')

    let copies = 0
    copyMock.mockImplementation((from, to) => {
      copies += 1
      // db 阶段：sqlite 复制（copies=1），wal 因目标已有而跳过；
      // thumbs 阶段：t1.webp 复制时失败（copies=2），此时 db 的合并已完成
      if (copies === 2) throw new Error('EIO: i/o error')
      realCopyFileSync(from, to)
    })

    expect(() => moveLibraryData(oldRoot, newRoot)).toThrow('EIO')

    // 旧库根完整；目标是原有的那份继续保留，没有被回滚删除
    expect(oldRootIntact()).toBe(true)
    expect(readFileSync(path.join(newRoot, 'db', 'asset-kernel.sqlite-wal'), 'utf-8')).toBe('EXISTING-WAL')
    // 只有目标原有的那份留下，本次搬过去的 sqlite 已按清单回滚走
    expect(newRootFiles()).toEqual([path.join(newRoot, 'db', 'asset-kernel.sqlite-wal')])
  })
})
