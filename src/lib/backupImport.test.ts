import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type ExportData } from '../types'
import { reconcileBackupWorkspaceImages, validateBackupArchive } from './backupImport'

function manifest(patch: Partial<ExportData> = {}): ExportData {
  return {
    version: 4,
    exportedAt: new Date(0).toISOString(),
    ...patch,
  }
}

describe('validateBackupArchive', () => {
  it('rejects unsupported future versions', () => {
    expect(() =>
      validateBackupArchive(
        manifest({ version: 8 }),
        {},
        {
          importImages: true,
          importTasks: true,
          importConfig: true,
        },
      ),
    ).toThrow('备份版本 8 高于当前支持的版本 7')
  })

  it('accepts version 7 backups', () => {
    expect(() =>
      validateBackupArchive(
        manifest({ version: 7 }),
        {},
        {
          importImages: false,
          importTasks: false,
          importConfig: false,
        },
      ),
    ).not.toThrow()
  })

  it('rejects missing files before import starts', () => {
    expect(() =>
      validateBackupArchive(
        manifest({
          imageFiles: {
            'image-a': { path: 'images/image-a.png' },
          },
        }),
        {},
        {
          importImages: true,
          importTasks: false,
          importConfig: false,
        },
      ),
    ).toThrow('images/image-a.png')
  })

  it('accepts legacy versions and ignores unselected domains', () => {
    expect(() =>
      validateBackupArchive(
        manifest({
          version: 2,
          imageFiles: {
            'image-a': { path: 'images/image-a.png' },
          },
        }),
        {},
        {
          importImages: false,
          importTasks: true,
          importConfig: false,
        },
      ),
    ).not.toThrow()
  })

  it('drops workspace draft images omitted by older version 5 exports', () => {
    const result = reconcileBackupWorkspaceImages(
      manifest({
        version: 5,
        imageFiles: {
          'available-image': { path: 'images/available-image.png' },
        },
        workspaceState: {
          groups: [],
          activeTabId: 'tab-a',
          tabs: [
            {
              id: 'tab-a',
              name: '标签 A',
              groupId: null,
              prompt: '',
              inputImageIds: ['missing-image', 'available-image'],
              inputImageFolder: { path: 'C:\\images', imageIds: ['missing-image', 'available-image'] },
              params: { ...DEFAULT_PARAMS },
              maskDraft: { targetImageId: 'missing-image', maskDataUrl: 'data:image/png;base64,YQ==', updatedAt: 1 },
              maskEditorImageId: 'missing-image',
              customOutputPath: '',
              taskIds: [],
              createdAt: 1,
              updatedAt: 1,
              order: 0,
            },
          ],
        },
      }),
    )

    expect(result.omittedImageCount).toBe(1)
    expect(result.data.workspaceState?.tabs[0]).toMatchObject({
      inputImageIds: ['available-image'],
      inputImageFolder: { imageIds: ['available-image'] },
      maskDraft: null,
      maskEditorImageId: null,
    })
    expect(() =>
      validateBackupArchive(
        result.data,
        {
          'images/available-image.png': new Uint8Array([1]),
        },
        {
          importImages: true,
          importTasks: true,
          importConfig: true,
        },
      ),
    ).not.toThrow()
  })
})
