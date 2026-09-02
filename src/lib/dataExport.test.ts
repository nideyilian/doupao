import { describe, expect, it } from 'vitest'
import { buildElectronImageExportEntries, buildExportImageRefs, collectReferencedExportImageIds } from './dataExport'

describe('data export planning', () => {
  it('collects referenced IDs once in first-seen order', () => {
    const tasks: any[] = [
      {
        inputImageIds: ['input-a'],
        maskImageId: 'mask-a',
        outputImages: ['output-a'],
        streamPartialImageIds: ['partial-a', 'output-a'],
      },
    ]
    const conversations: any[] = [{ rounds: [{ inputImageIds: ['agent-a', 'input-a'] }] }]
    const workspaceTabs: any[] = [
      {
        inputImages: [{ id: 'workspace-input-a' }, { id: 'input-a' }],
        inputImageFolder: { imageIds: ['folder-input-a', 'workspace-input-a'] },
        maskDraft: { targetImageId: 'mask-target-a' },
        maskEditorImageId: 'mask-editor-a',
      },
    ]
    const assets: any[] = [
      {
        imageId: 'asset-a',
        origins: [
          { inputImageIds: ['asset-input-a'], maskTargetImageId: 'asset-mask-target', maskImageId: 'asset-mask' },
        ],
      },
    ]
    expect(collectReferencedExportImageIds(tasks, conversations, workspaceTabs, assets)).toEqual([
      'input-a',
      'mask-a',
      'output-a',
      'partial-a',
      'agent-a',
      'workspace-input-a',
      'folder-input-a',
      'mask-target-a',
      'mask-editor-a',
      'asset-a',
      'asset-input-a',
      'asset-mask-target',
      'asset-mask',
    ])
  })

  it('builds metadata-only image references without including file paths', async () => {
    const refs = await buildExportImageRefs(['image-a', 'missing-image'], async (id) =>
      id === 'image-a'
        ? {
            id,
            localPath: 'C:\\cache\\image-a.png',
            createdAt: 10,
            source: 'generated',
            width: 100,
            height: 80,
            mimeType: 'image/png',
            byteSize: 1234,
          }
        : undefined,
    )

    expect(refs).toEqual({
      'image-a': {
        available: true,
        createdAt: 10,
        source: 'generated',
        width: 100,
        height: 80,
        mimeType: 'image/png',
        byteSize: 1234,
      },
      'missing-image': {
        available: false,
        createdAt: undefined,
        source: undefined,
        width: undefined,
        height: undefined,
        mimeType: undefined,
        byteSize: undefined,
      },
    })
    expect(JSON.stringify(refs)).not.toContain('localPath')
  })

  it('builds entries sequentially from local metadata', async () => {
    const plan = await buildElectronImageExportEntries(['output-a'], async () => ({
      id: 'output-a',
      localPath: 'C:\\cache\\output-a.png',
      createdAt: 10,
    }))
    expect(plan).toEqual({
      entries: [
        {
          imageId: 'output-a',
          sourcePath: 'C:\\cache\\output-a.png',
          archivePath: 'images/output-a.png',
          createdAt: 10,
        },
      ],
      omittedCount: 0,
      omittedImageIds: [],
    })
  })

  it('skips records that have not migrated to a local file', async () => {
    // 非 Electron 环境无法把 dataUrl 就地保存：缺少本地文件的原图被跳过（不阻塞整批导出）
    const plan = await buildElectronImageExportEntries(['output-a'], async () => ({
      id: 'output-a',
      dataUrl: 'data:image/png;base64,YQ==',
    }))
    expect(plan.entries).toEqual([])
    expect(plan.omittedCount).toBe(1)
    expect(plan.omittedImageIds).toEqual(['output-a'])
  })

  it('skips missing image records instead of aborting the whole export', async () => {
    // 历史数据丢失后 IndexedDB 中可能没有某张被引用图片的记录；导出必须跳过它继续，
    // 否则用户永远无法导出任何备份（旧行为：整批抛错）。
    const plan = await buildElectronImageExportEntries(['missing-a', 'present-b'], async (id) =>
      id === 'present-b' ? { id: 'present-b', localPath: 'C:\\cache\\present-b.webp', createdAt: 20 } : undefined,
    )
    expect(plan.entries).toEqual([
      {
        imageId: 'present-b',
        sourcePath: 'C:\\cache\\present-b.webp',
        archivePath: 'images/present-b.webp',
        createdAt: 20,
      },
    ])
    expect(plan.omittedCount).toBe(1)
    expect(plan.omittedImageIds).toEqual(['missing-a'])
  })

  it('skips records with unsupported file formats instead of aborting the whole export', async () => {
    const plan = await buildElectronImageExportEntries(['odd-file'], async () => ({
      id: 'odd-file',
      localPath: 'C:\\cache\\odd-file.bmp',
      createdAt: 30,
    }))
    expect(plan.entries).toEqual([])
    expect(plan.omittedCount).toBe(1)
    expect(plan.omittedImageIds).toEqual(['odd-file'])
  })
})
