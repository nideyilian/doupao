import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'project-export-'))

function writeFile(dir: string, name: string, content: string): string {
  mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, name)
  writeFileSync(filePath, content)
  return filePath
}

describe('project tree export (main process copy)', () => {
  beforeEach(() => {
    rmSync(tempRoot, { recursive: true, force: true })
    mkdirSync(tempRoot, { recursive: true })
  })

  afterAll(() => rmSync(tempRoot, { recursive: true, force: true }))

  it('copies files into nested folders and writes the manifest', async () => {
    const sourceDir = path.join(tempRoot, 'cache-images')
    const sourceA = writeFile(sourceDir, 'aaa.png', 'AAA')
    const sourceB = writeFile(sourceDir, 'bbb.png', 'BBBB')
    const target = path.join(tempRoot, 'out')

    const { exportProjectTreeCopies } = await import('./project-tree-export')
    const result = exportProjectTreeCopies(
      target,
      [
        { sourcePath: sourceA, targetPath: '项目A/img1.png', assetId: 'a' },
        { sourcePath: sourceB, targetPath: '项目A/子项目A1/img2.png', assetId: 'b' },
      ],
      (p) => p, // 测试注入：放行所有源路径
    )

    expect(result).toEqual({ copied: 2, failed: [], total: 2 })
    expect(readFileSync(path.join(target, '项目A', 'img1.png'), 'utf-8')).toBe('AAA')
    expect(readFileSync(path.join(target, '项目A', '子项目A1', 'img2.png'), 'utf-8')).toBe('BBBB')
    // manifest
    const manifest = readFileSync(path.join(target, 'export-manifest.jsonl'), 'utf-8').trim().split('\n')
    expect(manifest).toHaveLength(2)
    expect(JSON.parse(manifest[0]!)).toEqual({ targetPath: '项目A/img1.png', sourcePath: sourceA, assetId: 'a' })
  })

  it('rejects path traversal and invalid targets without copying', async () => {
    const sourceDir = path.join(tempRoot, 'cache-images')
    const source = writeFile(sourceDir, 'ok.png', 'OK')
    const target = path.join(tempRoot, 'out')

    const { exportProjectTreeCopies } = await import('./project-tree-export')
    const result = exportProjectTreeCopies(
      target,
      [
        { sourcePath: source, targetPath: '../escape.png' },
        { sourcePath: source, targetPath: '/absolute.png' },
        { sourcePath: source, targetPath: 'sub\\backslash.png' },
        { sourcePath: source, targetPath: '' },
      ],
      (p) => p,
    )

    expect(result.copied).toBe(0)
    expect(result.failed).toHaveLength(4)
    expect(existsSync(path.join(tempRoot, 'escape.png'))).toBe(false)
    expect(existsSync(path.join(tempRoot, 'out', 'absolute.png'))).toBe(false)
  })

  it('fails entries whose source is unreadable or disallowed', async () => {
    const target = path.join(tempRoot, 'out')
    const { exportProjectTreeCopies } = await import('./project-tree-export')
    const result = exportProjectTreeCopies(
      target,
      [
        { sourcePath: path.join(tempRoot, 'missing.png'), targetPath: 'a.png' },
        { sourcePath: path.join(tempRoot, 'outside.png'), targetPath: 'b.png' },
      ],
      (p) => {
        if (p.includes('outside')) throw new Error('outside allowed')
        return p
      },
    )
    expect(result.copied).toBe(0)
    expect(result.failed).toHaveLength(2)
  })

  it('overwrites existing files on re-export and keeps counts accurate', async () => {
    const sourceDir = path.join(tempRoot, 'cache-images')
    const source = writeFile(sourceDir, 'a.png', 'NEW')
    const target = path.join(tempRoot, 'out')

    const { exportProjectTreeCopies } = await import('./project-tree-export')
    exportProjectTreeCopies(target, [{ sourcePath: source, targetPath: 'x.png' }], (p) => p)
    writeFileSync(path.join(target, 'x.png'), 'OLD') // 手动改旧
    const again = exportProjectTreeCopies(target, [{ sourcePath: source, targetPath: 'x.png' }], (p) => p)

    expect(again.copied).toBe(1)
    expect(readFileSync(path.join(target, 'x.png'), 'utf-8')).toBe('NEW')
    expect(readdirSync(target).sort()).toEqual(['export-manifest.jsonl', 'x.png'])
  })
})
