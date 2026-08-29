import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'folder-export-'))

const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('image folder export (main process)', () => {
  beforeEach(() => {
    rmSync(tempRoot, { recursive: true, force: true })
    mkdirSync(tempRoot, { recursive: true })
  })

  afterAll(() => rmSync(tempRoot, { recursive: true, force: true }))

  it('copies disk originals via sourcePath without touching renderer memory', async () => {
    const sourceDir = path.join(tempRoot, 'cache-images')
    mkdirSync(sourceDir, { recursive: true })
    const source = path.join(sourceDir, 'a.png')
    writeFileSync(source, 'ORIGINAL')
    const target = path.join(tempRoot, 'out')

    const { exportImagesToFolderFiles } = await import('./image-folder-export')
    const result = exportImagesToFolderFiles(target, [{ fileName: '图-1.png', sourcePath: source }], (p) => p)

    expect(result).toEqual({ saved: 1, failed: [], total: 1 })
    expect(readFileSync(path.join(target, '图-1.png'), 'utf-8')).toBe('ORIGINAL')
  })

  it('writes dataUrl entries as decoded bytes', async () => {
    const target = path.join(tempRoot, 'out')
    const { exportImagesToFolderFiles } = await import('./image-folder-export')
    const result = exportImagesToFolderFiles(
      target,
      [{ fileName: 'b.png', dataUrl: `data:image/png;base64,${PNG_1X1_BASE64}` }],
      (p) => p,
    )
    expect(result.saved).toBe(1)
    const written = readFileSync(path.join(target, 'b.png'))
    expect(written.toString('base64')).toBe(PNG_1X1_BASE64)
  })

  it('rejects unsafe file names (path separators / .. / empty)', async () => {
    const target = path.join(tempRoot, 'out')
    const { exportImagesToFolderFiles } = await import('./image-folder-export')
    const result = exportImagesToFolderFiles(
      target,
      [
        { fileName: '../escape.png', dataUrl: `data:image/png;base64,${PNG_1X1_BASE64}` },
        { fileName: 'a/b.png', dataUrl: `data:image/png;base64,${PNG_1X1_BASE64}` },
        { fileName: 'a\\b.png', dataUrl: `data:image/png;base64,${PNG_1X1_BASE64}` },
        { fileName: '   ', dataUrl: `data:image/png;base64,${PNG_1X1_BASE64}` },
      ],
      (p) => p,
    )
    expect(result.saved).toBe(0)
    expect(result.failed).toHaveLength(4)
    expect(existsSync(path.join(tempRoot, 'escape.png'))).toBe(false)
    expect(existsSync(path.join(target, 'a-b.png'))).toBe(false)
  })

  it('requires exactly one of sourcePath or dataUrl', async () => {
    const target = path.join(tempRoot, 'out')
    const { exportImagesToFolderFiles } = await import('./image-folder-export')
    const result = exportImagesToFolderFiles(
      target,
      [
        { fileName: 'both.png', sourcePath: path.join(tempRoot, 'x.png'), dataUrl: 'data:image/png;base64,xx' },
        { fileName: 'none.png' },
      ],
      (p) => p,
    )
    expect(result.saved).toBe(0)
    expect(result.failed).toHaveLength(2)
  })

  it('reports missing or disallowed sources without aborting the batch', async () => {
    const target = path.join(tempRoot, 'out')
    const { exportImagesToFolderFiles } = await import('./image-folder-export')
    const result = exportImagesToFolderFiles(
      target,
      [
        { fileName: 'missing.png', sourcePath: path.join(tempRoot, 'missing.png') },
        { fileName: 'outside.png', sourcePath: path.join(tempRoot, 'outside.png') },
        { fileName: 'ok.png', dataUrl: `data:image/png;base64,${PNG_1X1_BASE64}` },
      ],
      (p) => {
        if (p.includes('outside')) throw new Error('outside allowed')
        return p
      },
    )
    expect(result.saved).toBe(1)
    expect(result.failed.map((f) => f.fileName).sort()).toEqual(['missing.png', 'outside.png'])
    expect(existsSync(path.join(target, 'ok.png'))).toBe(true)
  })
})
