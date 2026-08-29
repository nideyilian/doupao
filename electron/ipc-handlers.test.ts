import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const allowedRoot = mkdtempSync(path.join(os.tmpdir(), 'composite-ipc-'))

vi.mock('electron', () => ({
  app: {
    getPath: () => allowedRoot,
  },
  BrowserWindow: {
    fromWebContents: () => null,
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn(),
  },
  shell: {
    openPath: vi.fn(),
    showItemInFolder: vi.fn(),
  },
}))

const fixtureDir = path.join(allowedRoot, 'fixtures')

function writeFixtureFile(filePath: string) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, 'fixture')
}

function sortBackgrounds(items: Array<{ path: string; name: string; relativeDir: string }>) {
  return [...items].sort((a, b) => a.path.localeCompare(b.path))
}

describe('ipc composite background filesystem helpers', () => {
  beforeEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true })
    mkdirSync(fixtureDir, { recursive: true })
  })

  afterAll(() => {
    rmSync(allowedRoot, { recursive: true, force: true })
  })

  it('lists only top-level supported background files when not recursive', async () => {
    const mod = await import('./ipc-handlers')
    const listCompositeBackgroundFiles = (
      mod as {
        listCompositeBackgroundFiles?: (
          dirPath: string,
          recursive: boolean,
        ) => Array<{ path: string; name: string; relativeDir: string }>
      }
    ).listCompositeBackgroundFiles

    writeFixtureFile(path.join(fixtureDir, '2.jpg'))
    writeFixtureFile(path.join(fixtureDir, '1.PNG'))
    writeFixtureFile(path.join(fixtureDir, 'nested', '3.webp'))
    writeFixtureFile(path.join(fixtureDir, 'skip.txt'))

    expect(listCompositeBackgroundFiles).toBeTypeOf('function')
    expect(sortBackgrounds(listCompositeBackgroundFiles!(fixtureDir, false))).toEqual([
      { path: path.join(fixtureDir, '1.PNG'), name: '1.PNG', relativeDir: '', width: 0, height: 0 },
      { path: path.join(fixtureDir, '2.jpg'), name: '2.jpg', relativeDir: '', width: 0, height: 0 },
    ])
  })

  it('deletes backup files beyond the retention limit', async () => {
    const mod = await import('./ipc-handlers')
    const pruneBackupFiles = (
      mod as {
        pruneBackupFiles?: (paths: string[], keep: number) => void
      }
    ).pruneBackupFiles
    const backupPaths = Array.from({ length: 31 }, (_, index) => path.join(fixtureDir, `backup-${index}.json`))
    backupPaths.forEach(writeFixtureFile)

    expect(pruneBackupFiles).toBeTypeOf('function')
    pruneBackupFiles!(backupPaths, 30)

    expect(existsSync(backupPaths[29])).toBe(true)
    expect(existsSync(backupPaths[30])).toBe(false)
  })

  it('recognizes current metadata-only state backups as usable', async () => {
    const mod = await import('./ipc-handlers')
    const backupJsonHasData = (
      mod as {
        backupJsonHasData?: (value: unknown) => boolean
      }
    ).backupJsonHasData

    expect(backupJsonHasData).toBeTypeOf('function')
    expect(
      backupJsonHasData!({
        state: {
          settings: { backupInterval: 600 },
          workspaceTabs: [{ id: 'tab-a' }],
        },
      }),
    ).toBe(true)
    expect(backupJsonHasData!({ state: {} })).toBe(false)
  })

  it('copies cache files to a new storage root without deleting the source', async () => {
    const mod = await import('./ipc-handlers')
    const copyCacheImageDirectory = (
      mod as {
        copyCacheImageDirectory?: (sourceDir: string, targetDir: string) => Array<{ from: string; to: string }>
      }
    ).copyCacheImageDirectory
    const sourceDir = path.join(fixtureDir, 'old-cache')
    const targetDir = path.join(fixtureDir, 'new-cache')
    writeFixtureFile(path.join(sourceDir, 'image-a.png'))
    writeFixtureFile(path.join(sourceDir, 'image-b.webp'))

    expect(copyCacheImageDirectory).toBeTypeOf('function')
    const mappings = copyCacheImageDirectory!(sourceDir, targetDir)

    expect(mappings).toEqual([
      { from: path.join(sourceDir, 'image-a.png'), to: path.join(targetDir, 'image-a.png') },
      { from: path.join(sourceDir, 'image-b.webp'), to: path.join(targetDir, 'image-b.webp') },
    ])
    expect(existsSync(path.join(sourceDir, 'image-a.png'))).toBe(true)
    expect(existsSync(path.join(targetDir, 'image-a.png'))).toBe(true)
  })

  it('lists supported background files recursively with relative directories', async () => {
    const mod = await import('./ipc-handlers')
    const listCompositeBackgroundFiles = (
      mod as {
        listCompositeBackgroundFiles?: (
          dirPath: string,
          recursive: boolean,
        ) => Array<{ path: string; name: string; relativeDir: string }>
      }
    ).listCompositeBackgroundFiles

    writeFixtureFile(path.join(fixtureDir, 'root.jpeg'))
    writeFixtureFile(path.join(fixtureDir, 'A', '2.png'))
    writeFixtureFile(path.join(fixtureDir, 'A', 'sub', '10.WEBP'))
    writeFixtureFile(path.join(fixtureDir, 'B', 'skip.gif'))

    expect(listCompositeBackgroundFiles).toBeTypeOf('function')
    expect(sortBackgrounds(listCompositeBackgroundFiles!(fixtureDir, true))).toEqual([
      { path: path.join(fixtureDir, 'A', '2.png'), name: '2.png', relativeDir: 'A', width: 0, height: 0 },
      {
        path: path.join(fixtureDir, 'A', 'sub', '10.WEBP'),
        name: '10.WEBP',
        relativeDir: 'A/sub',
        width: 0,
        height: 0,
      },
      { path: path.join(fixtureDir, 'root.jpeg'), name: 'root.jpeg', relativeDir: '', width: 0, height: 0 },
    ])
  })

  it('authorizes and scans an explicitly entered background folder', async () => {
    const mod = await import('./ipc-handlers')
    const scanEnteredCompositeBackgroundFolder = (
      mod as {
        scanEnteredCompositeBackgroundFolder?: (
          dirPath: string,
          recursive: boolean,
        ) => {
          success: boolean
          folderPath?: string
          files?: Array<{ path: string; name: string; relativeDir: string; width: number; height: number }>
        }
      }
    ).scanEnteredCompositeBackgroundFolder
    const enteredRoot = mkdtempSync(path.join(os.tmpdir(), 'composite-entered-'))
    writeFixtureFile(path.join(enteredRoot, 'manual.jpg'))

    expect(scanEnteredCompositeBackgroundFolder).toBeTypeOf('function')
    expect(scanEnteredCompositeBackgroundFolder!(enteredRoot, false)).toEqual({
      success: true,
      folderPath: realpathSync(enteredRoot),
      files: [
        {
          path: path.join(realpathSync(enteredRoot), 'manual.jpg'),
          name: 'manual.jpg',
          relativeDir: '',
          width: 0,
          height: 0,
        },
      ],
    })

    rmSync(enteredRoot, { recursive: true, force: true })
  })

  it('rejects missing, file, and symlink folder inputs', async () => {
    const mod = await import('./ipc-handlers')
    const scanEnteredCompositeBackgroundFolder = (
      mod as {
        scanEnteredCompositeBackgroundFolder?: (
          dirPath: string,
          recursive: boolean,
        ) => { success: boolean; error?: string }
      }
    ).scanEnteredCompositeBackgroundFolder
    const outsideRoot = mkdtempSync(path.join(os.tmpdir(), 'composite-entered-'))
    const filePath = path.join(outsideRoot, 'not-a-folder.jpg')
    const linkPath = path.join(outsideRoot, 'linked-folder')
    writeFixtureFile(filePath)
    symlinkSync(fixtureDir, linkPath, 'junction')

    expect(scanEnteredCompositeBackgroundFolder).toBeTypeOf('function')
    expect(scanEnteredCompositeBackgroundFolder!(path.join(outsideRoot, 'missing'), false).success).toBe(false)
    expect(scanEnteredCompositeBackgroundFolder!(filePath, false).success).toBe(false)
    expect(scanEnteredCompositeBackgroundFolder!(linkPath, false).success).toBe(false)

    rmSync(linkPath, { recursive: true, force: true })
    rmSync(outsideRoot, { recursive: true, force: true })
  })

  it('skips recursive symlink or junction directories instead of traversing them', async () => {
    const mod = await import('./ipc-handlers')
    const listCompositeBackgroundFiles = (
      mod as {
        listCompositeBackgroundFiles?: (
          dirPath: string,
          recursive: boolean,
        ) => Array<{ path: string; name: string; relativeDir: string }>
      }
    ).listCompositeBackgroundFiles
    const outsideRoot = mkdtempSync(path.join(os.tmpdir(), 'composite-ipc-outside-'))
    const escapedFile = path.join(outsideRoot, 'escaped.png')
    const junctionPath = path.join(fixtureDir, 'linked-outside')

    writeFixtureFile(path.join(fixtureDir, 'safe.jpg'))
    writeFixtureFile(escapedFile)
    symlinkSync(outsideRoot, junctionPath, 'junction')

    expect(listCompositeBackgroundFiles).toBeTypeOf('function')
    expect(sortBackgrounds(listCompositeBackgroundFiles!(fixtureDir, true))).toEqual([
      { path: path.join(fixtureDir, 'safe.jpg'), name: 'safe.jpg', relativeDir: '', width: 0, height: 0 },
    ])

    rmSync(junctionPath, { recursive: true, force: true })
    rmSync(outsideRoot, { recursive: true, force: true })
  })

  it('deletes allowed files, treats missing files as deleted, and rejects disallowed paths', async () => {
    const mod = await import('./ipc-handlers')
    const deleteCompositeFiles = (
      mod as {
        deleteCompositeFiles?: (filePaths: string[]) => { deleted: string[]; failed: string[] }
      }
    ).deleteCompositeFiles
    const insideFile = path.join(fixtureDir, 'inside.jpg')
    const missingFile = path.join(fixtureDir, 'missing.jpg')
    const outsideRoot = mkdtempSync(path.join(os.tmpdir(), 'composite-ipc-outside-'))
    const outsideFile = path.join(outsideRoot, 'outside.jpg')

    writeFixtureFile(insideFile)
    writeFixtureFile(outsideFile)

    expect(deleteCompositeFiles).toBeTypeOf('function')
    expect(deleteCompositeFiles!([insideFile, missingFile, outsideFile])).toEqual({
      deleted: [insideFile, missingFile],
      failed: [outsideFile],
    })
    expect(existsSync(insideFile)).toBe(false)
    expect(existsSync(outsideFile)).toBe(true)

    rmSync(outsideRoot, { recursive: true, force: true })
  })

  it('deletes only jpg files and rejects directory, wrong extension, and junction escapes', async () => {
    const mod = await import('./ipc-handlers')
    const deleteCompositeFiles = (
      mod as {
        deleteCompositeFiles?: (filePaths: string[]) => { deleted: string[]; failed: string[] }
      }
    ).deleteCompositeFiles
    const insideJpg = path.join(fixtureDir, 'inside.jpg')
    const insidePng = path.join(fixtureDir, 'inside.png')
    const nestedDir = path.join(fixtureDir, 'folder.jpg')
    const outsideRoot = mkdtempSync(path.join(os.tmpdir(), 'composite-ipc-outside-'))
    const junctionPath = path.join(fixtureDir, 'outside-link')
    const escapedJpg = path.join(junctionPath, 'escaped.jpg')

    writeFixtureFile(insideJpg)
    writeFixtureFile(insidePng)
    mkdirSync(nestedDir, { recursive: true })
    writeFixtureFile(path.join(outsideRoot, 'escaped.jpg'))
    symlinkSync(outsideRoot, junctionPath, 'junction')

    expect(deleteCompositeFiles).toBeTypeOf('function')
    expect(deleteCompositeFiles!([insideJpg, insidePng, nestedDir, escapedJpg])).toEqual({
      deleted: [insideJpg],
      failed: [insidePng, nestedDir, escapedJpg],
    })
    expect(existsSync(insideJpg)).toBe(false)
    expect(existsSync(insidePng)).toBe(true)
    expect(existsSync(path.join(outsideRoot, 'escaped.jpg'))).toBe(true)

    rmSync(junctionPath, { recursive: true, force: true })
    rmSync(outsideRoot, { recursive: true, force: true })
  })

  it('returns structured results for malformed IPC payload helpers', async () => {
    const mod = await import('./ipc-handlers')
    const handleCompositeListBackgroundFilesPayload = (
      mod as {
        handleCompositeListBackgroundFilesPayload?: (
          payload: unknown,
        ) => Array<{ path: string; name: string; relativeDir: string }>
      }
    ).handleCompositeListBackgroundFilesPayload
    const handleDeleteCompositeFilesPayload = (
      mod as {
        handleDeleteCompositeFilesPayload?: (payload: unknown) => { deleted: string[]; failed: string[] }
      }
    ).handleDeleteCompositeFilesPayload

    expect(handleCompositeListBackgroundFilesPayload).toBeTypeOf('function')
    expect(handleDeleteCompositeFilesPayload).toBeTypeOf('function')
    expect(handleCompositeListBackgroundFilesPayload!({ dirPath: fixtureDir, recursive: 'yes' })).toEqual([])
    expect(handleCompositeListBackgroundFilesPayload!(null)).toEqual([])
    expect(handleDeleteCompositeFilesPayload!({ filePaths: ['ok.jpg', 1] })).toEqual({ deleted: [], failed: [] })
    expect(handleDeleteCompositeFilesPayload!(null)).toEqual({ deleted: [], failed: [] })
  })

  it('authorizes arbitrary absolute composite output directories', async () => {
    const mod = await import('./ipc-handlers')
    const authorize = (
      mod as {
        authorizeCompositeOutputDirectory?: (value: unknown) => boolean
      }
    ).authorizeCompositeOutputDirectory

    expect(authorize).toBeTypeOf('function')
    expect(authorize!(path.join(os.tmpdir(), 'manual-composite-output'))).toBe(true)
    expect(authorize!('relative/output')).toBe(false)
    expect(authorize!('')).toBe(false)
    expect(authorize!(null)).toBe(false)
  })

  it('requires exactly one source for each streaming ZIP entry', async () => {
    const { parseStreamingZipRequest } = await import('./ipc-handlers')
    const base = {
      destinationPath: path.join(allowedRoot, 'backup.zip'),
      manifestJson: '{}',
    }

    expect(
      parseStreamingZipRequest({
        ...base,
        entries: [{ archivePath: 'composite-assets/a.png', data: new Uint8Array([1]) }],
      }),
    ).not.toBeNull()
    expect(
      parseStreamingZipRequest({
        ...base,
        entries: [{ archivePath: 'composite-assets/a.png' }],
      }),
    ).toBeNull()
    expect(
      parseStreamingZipRequest({
        ...base,
        entries: [
          {
            archivePath: 'composite-assets/a.png',
            sourcePath: path.join(allowedRoot, 'a.png'),
            data: new Uint8Array([1]),
          },
        ],
      }),
    ).toBeNull()
  })

  it('deletes cache images only inside the configured cache directory', async () => {
    writeFileSync(
      path.join(allowedRoot, 'local-settings.json'),
      JSON.stringify({
        localSavePath: path.join(allowedRoot, 'local-saves'),
      }),
    )
    const inside = path.join(allowedRoot, 'local-saves', 'cache-images', 'inside.png')
    const outside = path.join(fixtureDir, 'outside.png')
    writeFixtureFile(inside)
    writeFixtureFile(outside)
    const { deleteCacheImageFiles } = await import('./ipc-handlers')

    expect(deleteCacheImageFiles([inside, outside])).toEqual({
      deleted: [inside],
      failed: [outside],
    })
    expect(existsSync(inside)).toBe(false)
    expect(existsSync(outside)).toBe(true)
  })

  it('initializes the library layout and upgrades settings with libraryVersion', async () => {
    writeFileSync(
      path.join(allowedRoot, 'local-settings.json'),
      JSON.stringify({ localSavePath: path.join(allowedRoot, 'local-saves') }),
    )
    const { initLocalSavePath } = await import('./ipc-handlers')
    initLocalSavePath()

    const settings = JSON.parse(readFileSync(path.join(allowedRoot, 'local-settings.json'), 'utf-8')) as {
      libraryVersion?: unknown
    }
    expect(settings.libraryVersion).toBe(1)

    const libRoot = path.join(allowedRoot, 'local-saves')
    for (const dir of ['db', 'thumbs', 'backups']) expect(existsSync(path.join(libRoot, dir))).toBe(true)
    const meta = JSON.parse(readFileSync(path.join(libRoot, 'library.json'), 'utf-8')) as { version: number }
    expect(meta.version).toBe(1)

    // 幂等：再次调用不改变 libraryVersion
    initLocalSavePath()
    const again = JSON.parse(readFileSync(path.join(allowedRoot, 'local-settings.json'), 'utf-8')) as {
      libraryVersion?: unknown
    }
    expect(again.libraryVersion).toBe(1)
  })

  it('changeLibraryRoot moves the library and reopens the kernel at the new root', async () => {
    const oldRoot = path.join(allowedRoot, 'lib-old')
    const newRoot = path.join(allowedRoot, 'lib-new')
    mkdirSync(path.join(oldRoot, 'db'), { recursive: true })
    writeFileSync(path.join(oldRoot, 'db', 'asset-kernel.sqlite'), 'db')
    writeFileSync(path.join(allowedRoot, 'local-settings.json'), JSON.stringify({ localSavePath: oldRoot }))

    const close = vi.fn(async () => {})
    const open = vi.fn(async () => {})
    const { setLibraryKernelHooks, changeLibraryRoot } = await import('./ipc-handlers')
    setLibraryKernelHooks({ close, open })
    try {
      await changeLibraryRoot(newRoot)
    } finally {
      setLibraryKernelHooks(null)
    }

    expect(close).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(newRoot)
    expect(existsSync(path.join(newRoot, 'db', 'asset-kernel.sqlite'))).toBe(true)
    expect(existsSync(path.join(oldRoot, 'db', 'asset-kernel.sqlite'))).toBe(false)
    const settings = JSON.parse(readFileSync(path.join(allowedRoot, 'local-settings.json'), 'utf-8')) as {
      localSavePath?: string
    }
    expect(settings.localSavePath).toBe(newRoot)
  })

  it('changeLibraryRoot rolls back and reopens the old library on conflict', async () => {
    const oldRoot = path.join(allowedRoot, 'lib-old')
    const newRoot = path.join(allowedRoot, 'lib-new')
    mkdirSync(path.join(oldRoot, 'db'), { recursive: true })
    mkdirSync(path.join(newRoot, 'db'), { recursive: true })
    writeFileSync(path.join(oldRoot, 'db', 'asset-kernel.sqlite'), 'db')
    writeFileSync(path.join(newRoot, 'db', 'asset-kernel.sqlite'), 'db-target')
    writeFileSync(path.join(allowedRoot, 'local-settings.json'), JSON.stringify({ localSavePath: oldRoot }))

    const close = vi.fn(async () => {})
    const open = vi.fn(async () => {})
    const { setLibraryKernelHooks, changeLibraryRoot } = await import('./ipc-handlers')
    setLibraryKernelHooks({ close, open })
    try {
      await expect(changeLibraryRoot(newRoot)).rejects.toThrow('已存在素材库数据库')
    } finally {
      setLibraryKernelHooks(null)
    }

    expect(close).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(oldRoot)
    const settings = JSON.parse(readFileSync(path.join(allowedRoot, 'local-settings.json'), 'utf-8')) as {
      localSavePath?: string
    }
    expect(settings.localSavePath).toBe(oldRoot)
    expect(existsSync(path.join(oldRoot, 'db', 'asset-kernel.sqlite'))).toBe(true)
    expect(existsSync(path.join(newRoot, 'db', 'asset-kernel.sqlite'))).toBe(true)
  })

  it('changeLibraryRoot with the same root only rewrites settings without touching the kernel', async () => {
    const root = path.join(allowedRoot, 'lib-same')
    writeFileSync(path.join(allowedRoot, 'local-settings.json'), JSON.stringify({ localSavePath: root }))

    const close = vi.fn(async () => {})
    const open = vi.fn(async () => {})
    const { setLibraryKernelHooks, changeLibraryRoot } = await import('./ipc-handlers')
    setLibraryKernelHooks({ close, open })
    try {
      await changeLibraryRoot(root)
    } finally {
      setLibraryKernelHooks(null)
    }

    expect(close).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it('parses WebP dimensions for VP8, VP8L and VP8X', async () => {
    const { parseWebpDimensions } = await import('./ipc-handlers')

    // VP8 有损：帧标签(16-18) + 起始码 9d 01 2a(19-21) + 宽高 14-bit LE(22-25)
    const vp8 = Buffer.alloc(32)
    vp8.write('RIFF', 0, 'latin1')
    vp8.write('WEBP', 8, 'latin1')
    vp8.write('VP8 ', 12, 'latin1')
    vp8.writeUInt16LE(640, 22)
    vp8.writeUInt16LE(480, 24)
    expect(parseWebpDimensions(vp8)).toEqual({ width: 640, height: 480 })

    // VP8L 无损：签名(16) + 4 字节位域(17-20)，宽高减一 14-bit
    const vp8l = Buffer.alloc(32)
    vp8l.write('RIFF', 0, 'latin1')
    vp8l.write('WEBP', 8, 'latin1')
    vp8l.write('VP8L', 12, 'latin1')
    vp8l[16] = 0x2f
    const widthMinusOne = 100 // 宽 101
    const heightMinusOne = 76 // 高 77
    vp8l[17] = widthMinusOne & 0xff
    vp8l[18] = ((widthMinusOne >> 8) & 0x3f) | ((heightMinusOne & 0x3) << 6)
    vp8l[19] = (heightMinusOne >> 2) & 0xff
    vp8l[20] = (heightMinusOne >> 10) & 0x0f
    expect(parseWebpDimensions(vp8l)).toEqual({ width: 101, height: 77 })

    // VP8X：canvas 宽高减一 24-bit LE（24-26 / 27-29）
    const vp8x = Buffer.alloc(32)
    vp8x.write('RIFF', 0, 'latin1')
    vp8x.write('WEBP', 8, 'latin1')
    vp8x.write('VP8X', 12, 'latin1')
    vp8x.writeUIntLE(799, 24, 3)
    vp8x.writeUIntLE(599, 27, 3)
    expect(parseWebpDimensions(vp8x)).toEqual({ width: 800, height: 600 })

    // 非 WebP / 截断 → null
    expect(parseWebpDimensions(Buffer.from('not an image'))).toBeNull()
    expect(parseWebpDimensions(Buffer.alloc(12))).toBeNull()
  })

  it('round-trips thumbnails through the library thumbs directory', async () => {
    writeFileSync(
      path.join(allowedRoot, 'local-settings.json'),
      JSON.stringify({ localSavePath: path.join(allowedRoot, 'local-saves') }),
    )
    const { readThumbnailFile, writeThumbnailFile } = await import('./ipc-handlers')

    const vp8l = Buffer.alloc(32)
    vp8l.write('RIFF', 0, 'latin1')
    vp8l.write('WEBP', 8, 'latin1')
    vp8l.write('VP8L', 12, 'latin1')
    vp8l[16] = 0x2f
    vp8l[17] = 99 // 宽减一 = 99 → 宽 100
    vp8l[18] = 0
    vp8l[19] = 18 // 高减一 = 18<<2 = 72 → 高 73
    vp8l[20] = 0
    const dataUrl = `data:image/webp;base64,${vp8l.toString('base64')}`

    expect(await writeThumbnailFile('sha256-abc', 3, dataUrl)).toBe(true)
    expect(existsSync(path.join(allowedRoot, 'local-saves', 'thumbs', 'sha256-abc.v3.webp'))).toBe(true)

    const read = await readThumbnailFile('sha256-abc', 3)
    expect(read?.dataUrl).toBe(dataUrl)
    expect(read?.width).toBe(100)
    expect(read?.height).toBe(73)

    // 版本不匹配 → 未命中
    expect(await readThumbnailFile('sha256-abc', 4)).toBeNull()
    // 非法 id → 未命中/拒绝
    expect(await writeThumbnailFile('../../evil', 3, dataUrl)).toBe(false)
    expect(await readThumbnailFile('../../evil', 3)).toBeNull()
  })

  it('keeps grid small thumbnails in a separate namespace from full thumbnails', async () => {
    writeFileSync(
      path.join(allowedRoot, 'local-settings.json'),
      JSON.stringify({ localSavePath: path.join(allowedRoot, 'local-saves') }),
    )
    const { readThumbnailFile, writeThumbnailFile } = await import('./ipc-handlers')
    const dataUrl = `data:image/webp;base64,${Buffer.from('grid-thumb').toString('base64')}`

    // 同 id 同版本，full 与 grid 互不覆盖、互不清理
    expect(await writeThumbnailFile('ns-check', 1, dataUrl, 'full')).toBe(true)
    expect(await writeThumbnailFile('ns-check', 1, dataUrl, 'grid')).toBe(true)
    expect(await readThumbnailFile('ns-check', 1, 'full')).not.toBeNull()
    expect(await readThumbnailFile('ns-check', 1, 'grid')).not.toBeNull()
    expect(existsSync(path.join(allowedRoot, 'local-saves', 'thumbs', 'ns-check.v1.webp'))).toBe(true)
    expect(existsSync(path.join(allowedRoot, 'local-saves', 'thumbs', 'ns-check.v1.grid.webp'))).toBe(true)

    // grid 的版本升级只清理 grid 旧版本，不动 full 文件
    expect(await writeThumbnailFile('ns-check', 2, dataUrl, 'grid')).toBe(true)
    expect(await readThumbnailFile('ns-check', 2, 'grid')).not.toBeNull()
    expect(await readThumbnailFile('ns-check', 1, 'grid')).toBeNull()
    expect(await readThumbnailFile('ns-check', 1, 'full')).not.toBeNull()
    expect(existsSync(path.join(allowedRoot, 'local-saves', 'thumbs', 'ns-check.v1.grid.webp'))).toBe(false)
    expect(existsSync(path.join(allowedRoot, 'local-saves', 'thumbs', 'ns-check.v1.webp'))).toBe(true)
  })

  it('cleans up the previous thumbnail version when writing a new one', async () => {
    writeFileSync(
      path.join(allowedRoot, 'local-settings.json'),
      JSON.stringify({ localSavePath: path.join(allowedRoot, 'local-saves') }),
    )
    rmSync(path.join(allowedRoot, 'local-saves', 'thumbs'), { recursive: true, force: true })
    const { writeThumbnailFile, readThumbnailFile } = await import('./ipc-handlers')
    const dataUrl = `data:image/webp;base64,${Buffer.from('thumb-v3').toString('base64')}`

    expect(await writeThumbnailFile('upgrade-thumb', 3, dataUrl)).toBe(true)
    expect(await readThumbnailFile('upgrade-thumb', 3)).not.toBeNull()

    // 版本升级后写入 v4：v3 残留自动清理
    expect(await writeThumbnailFile('upgrade-thumb', 4, dataUrl)).toBe(true)
    expect(await readThumbnailFile('upgrade-thumb', 4)).not.toBeNull()
    expect(await readThumbnailFile('upgrade-thumb', 3)).toBeNull()
    expect(existsSync(path.join(allowedRoot, 'local-saves', 'thumbs', 'upgrade-thumb.v3.webp'))).toBe(false)
    expect(existsSync(path.join(allowedRoot, 'local-saves', 'thumbs', 'upgrade-thumb.v4.webp'))).toBe(true)
  })

  it('counts thumbs directory files in disk storage usage', async () => {
    writeFileSync(
      path.join(allowedRoot, 'local-settings.json'),
      JSON.stringify({ localSavePath: path.join(allowedRoot, 'local-saves') }),
    )
    // 隔离：清掉其他用例可能写入的残留
    rmSync(path.join(allowedRoot, 'local-saves', 'thumbs'), { recursive: true, force: true })
    rmSync(path.join(allowedRoot, 'local-saves', 'backups'), { recursive: true, force: true })
    const thumbsDir = path.join(allowedRoot, 'local-saves', 'thumbs')
    mkdirSync(thumbsDir, { recursive: true })
    writeFileSync(path.join(thumbsDir, 'a.v3.webp'), 'aaa')
    writeFileSync(path.join(thumbsDir, 'b.v3.webp'), 'bbbb')
    mkdirSync(path.join(allowedRoot, 'local-saves', 'backups'), { recursive: true })
    writeFileSync(path.join(allowedRoot, 'local-saves', 'backups', 'x.zip'), 'xx')

    const { getDiskStorageUsage } = await import('./ipc-handlers')
    const usage = getDiskStorageUsage()
    expect(usage.thumbsCount).toBe(2)
    expect(usage.thumbsBytes).toBe(7)
    expect(usage.backupBytes).toBe(2)
  })

  it('defaults ZIP backup export to the library backups directory', async () => {
    writeFileSync(
      path.join(allowedRoot, 'local-settings.json'),
      JSON.stringify({ localSavePath: path.join(allowedRoot, 'local-saves') }),
    )
    const { getBackupExportDefaultPath } = await import('./ipc-handlers')
    expect(getBackupExportDefaultPath('doupao_backup.zip')).toBe(
      path.join(allowedRoot, 'local-saves', 'backups', 'doupao_backup.zip'),
    )
  })

  it('reveals an existing file in Explorer via showItemInFolder', async () => {
    const { revealInExplorer } = await import('./ipc-handlers')
    const shellMock = (await import('electron')).shell as unknown as {
      openPath: ReturnType<typeof vi.fn>
      showItemInFolder: ReturnType<typeof vi.fn>
    }
    shellMock.openPath.mockClear()
    shellMock.showItemInFolder.mockClear()
    const target = path.join(fixtureDir, 'existing.png')
    writeFixtureFile(target)

    await expect(revealInExplorer(target)).resolves.toEqual({ ok: true })
    expect(shellMock.showItemInFolder).toHaveBeenCalledWith(target)
    expect(shellMock.openPath).not.toHaveBeenCalled()
  })

  it('opens an existing directory via openPath', async () => {
    const { revealInExplorer } = await import('./ipc-handlers')
    const shellMock = (await import('electron')).shell as unknown as {
      openPath: ReturnType<typeof vi.fn>
      showItemInFolder: ReturnType<typeof vi.fn>
    }
    shellMock.openPath.mockClear()
    shellMock.showItemInFolder.mockClear()
    const dir = path.join(fixtureDir, 'existing-dir')
    mkdirSync(dir, { recursive: true })

    shellMock.openPath.mockResolvedValueOnce('')
    await expect(revealInExplorer(dir)).resolves.toEqual({ ok: true })
    expect(shellMock.openPath).toHaveBeenCalledWith(dir)
    expect(shellMock.showItemInFolder).not.toHaveBeenCalled()
  })

  it('falls back to the nearest existing parent when the target file is missing', async () => {
    const { revealInExplorer } = await import('./ipc-handlers')
    const shellMock = (await import('electron')).shell as unknown as {
      openPath: ReturnType<typeof vi.fn>
      showItemInFolder: ReturnType<typeof vi.fn>
    }
    shellMock.openPath.mockClear()
    shellMock.showItemInFolder.mockClear()
    const dir = path.join(fixtureDir, 'parent-dir')
    mkdirSync(dir, { recursive: true })
    const missing = path.join(dir, 'nested', 'missing.png')

    shellMock.openPath.mockResolvedValueOnce('')
    // 目标缺失时不应调用 showItemInFolder（Windows 下会静默无动作），而是打开最近的已存在父目录
    await expect(revealInExplorer(missing)).resolves.toEqual({ ok: true })
    expect(shellMock.openPath).toHaveBeenCalledWith(dir)
    expect(shellMock.showItemInFolder).not.toHaveBeenCalled()
  })

  it('reports failure when opening the path fails', async () => {
    const { revealInExplorer } = await import('./ipc-handlers')
    const shellMock = (await import('electron')).shell as unknown as {
      openPath: ReturnType<typeof vi.fn>
      showItemInFolder: ReturnType<typeof vi.fn>
    }
    shellMock.openPath.mockClear()
    shellMock.showItemInFolder.mockClear()
    const dir = path.join(fixtureDir, 'err-dir')
    mkdirSync(dir, { recursive: true })
    shellMock.openPath.mockResolvedValueOnce('Failed to open path')
    await expect(revealInExplorer(dir)).resolves.toEqual({ ok: false, error: 'Failed to open path' })
  })
})

describe('ipc deleteLocalImageFiles', () => {
  beforeEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true })
    mkdirSync(fixtureDir, { recursive: true })
  })

  it('deletes image files outside the allowed root (local export dirs can live anywhere)', async () => {
    const { deleteLocalImageFiles } = await import('./ipc-handlers')
    const outsideRoot = mkdtempSync(path.join(os.tmpdir(), 'local-image-outside-'))
    const file = path.join(outsideRoot, '导出图.png')
    writeFixtureFile(file)

    expect(deleteLocalImageFiles!([file])).toEqual({ deleted: [path.normalize(file)], failed: [] })
    expect(existsSync(file)).toBe(false)

    rmSync(outsideRoot, { recursive: true, force: true })
  })

  it('treats missing files as deleted and ignores empty strings', async () => {
    const { deleteLocalImageFiles } = await import('./ipc-handlers')
    const missing = path.join(fixtureDir, 'missing.webp')
    expect(deleteLocalImageFiles!([missing, ''])).toEqual({
      deleted: [path.normalize(missing)],
      failed: [],
    })
  })

  it('rejects non-image extensions, directories, and symbolic links', async () => {
    const { deleteLocalImageFiles } = await import('./ipc-handlers')
    const jsonFile = path.join(fixtureDir, 'meta.json')
    const pngFile = path.join(fixtureDir, 'keep.png')
    const nestedDir = path.join(fixtureDir, 'folder.png')
    const outsideRoot = mkdtempSync(path.join(os.tmpdir(), 'local-image-outside-'))
    const junctionPath = path.join(fixtureDir, 'escape-link')
    const escapedFile = path.join(junctionPath, 'escaped.jpg')

    writeFixtureFile(jsonFile)
    writeFixtureFile(pngFile)
    mkdirSync(nestedDir, { recursive: true })
    writeFixtureFile(path.join(outsideRoot, 'escaped.jpg'))
    symlinkSync(outsideRoot, junctionPath, 'junction')

    expect(deleteLocalImageFiles!([jsonFile, nestedDir, escapedFile])).toEqual({
      deleted: [],
      failed: [jsonFile, nestedDir, escapedFile],
    })
    expect(existsSync(jsonFile)).toBe(true)
    expect(existsSync(pngFile)).toBe(true)
    expect(existsSync(path.join(outsideRoot, 'escaped.jpg'))).toBe(true)

    rmSync(junctionPath, { recursive: true, force: true })
    rmSync(outsideRoot, { recursive: true, force: true })
  })

  it('parses and rejects malformed payloads defensively', async () => {
    const { parseDeleteLocalImageFilesPayload } = await import('./ipc-handlers')
    expect(parseDeleteLocalImageFilesPayload!({ filePaths: ['a.png', 'b.jpg'] })).toEqual(['a.png', 'b.jpg'])
    expect(parseDeleteLocalImageFilesPayload!({ filePaths: ['ok.png', 1] })).toBeNull()
    expect(parseDeleteLocalImageFilesPayload!(null)).toBeNull()
  })
})
