import { describe, expect, it } from 'vitest'
import { getGallerySopPromptRunStorageKey } from './gallerySopRun'

describe('getGallerySopPromptRunStorageKey', () => {
  it('keeps the legacy tab-only key when no folder is given', () => {
    expect(getGallerySopPromptRunStorageKey(null)).toBe('doupao.gallery-sop-prompt-run.default')
    expect(getGallerySopPromptRunStorageKey('tab-a')).toBe('doupao.gallery-sop-prompt-run.tab-a')
    expect(getGallerySopPromptRunStorageKey('tab-a', '')).toBe('doupao.gallery-sop-prompt-run.tab-a')
  })

  it('isolates runs per folder within the same workspace tab', () => {
    const folderA = getGallerySopPromptRunStorageKey('tab-a', 'folder-1')
    const folderB = getGallerySopPromptRunStorageKey('tab-a', 'folder-2')
    expect(folderA).toBe('doupao.gallery-sop-prompt-run.tab-a.folder-1')
    expect(folderB).toBe('doupao.gallery-sop-prompt-run.tab-a.folder-2')
    expect(folderA).not.toBe(folderB)
    expect(folderA).not.toBe(getGallerySopPromptRunStorageKey('tab-a'))
  })

  it('isolates runs per tab within the same folder', () => {
    expect(getGallerySopPromptRunStorageKey('tab-a', 'folder-1')).not.toBe(
      getGallerySopPromptRunStorageKey('tab-b', 'folder-1'),
    )
  })
})
