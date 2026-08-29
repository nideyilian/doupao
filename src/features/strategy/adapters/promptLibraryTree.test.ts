import { describe, expect, it } from 'vitest'
import type { SopBatchSnapshot } from '../../../types'
import {
  duplicatePromptLibraryFolderTree,
  flattenPromptLibraryFolders,
  getFolderDescendantIds,
  getFolderPath,
  movePromptLibraryFolder,
  normalizePromptLibraryFolders,
  type PromptLibraryFolder,
} from './promptLibraryTree'

const folders: PromptLibraryFolder[] = [
  { id: 'a', name: 'A', parentId: null, order: 0, createdAt: 1, updatedAt: 1 },
  { id: 'b', name: 'B', parentId: null, order: 1, createdAt: 1, updatedAt: 1 },
  { id: 'a-1', name: 'A-1', parentId: 'a', order: 0, createdAt: 1, updatedAt: 1 },
]

describe('prompt library tree', () => {
  it('migrates flat groups and repairs missing or cyclic parents', () => {
    const run = {
      id: 'run',
      createdAt: 5,
      updatedAt: 6,
      promptGroup: { id: 'derived', name: '从快照恢复' },
    } as SopBatchSnapshot
    const normalized = normalizePromptLibraryFolders(
      [
        { id: 'a', name: 'A', parentId: 'missing' },
        { id: 'b', name: 'B', parentId: 'c' },
        { id: 'c', name: 'C', parentId: 'b' },
      ],
      [run],
    )

    expect(normalized.find((folder) => folder.id === 'a')?.parentId).toBeNull()
    expect(normalized.find((folder) => folder.id === 'derived')?.name).toBe('从快照恢复')
    expect(getFolderPath(normalized, 'b').length).toBeLessThanOrEqual(2)
  })

  it('moves folders before, after, or inside and prevents descendant cycles', () => {
    const movedInside = movePromptLibraryFolder(folders, 'b', 'a', 'inside')
    expect(movedInside.find((folder) => folder.id === 'b')?.parentId).toBe('a')

    const reordered = movePromptLibraryFolder(folders, 'b', 'a', 'before')
    expect(
      flattenPromptLibraryFolders(reordered)
        .slice(0, 2)
        .map(({ folder }) => folder.id),
    ).toEqual(['b', 'a'])

    const rejected = movePromptLibraryFolder(folders, 'a', 'a-1', 'inside')
    expect(rejected).toBe(folders)
  })

  it('duplicates a complete subtree with new ids', () => {
    let sequence = 0
    const duplicated = duplicatePromptLibraryFolderTree(folders, 'a', 'b', () => `copy-${++sequence}`, 10)

    expect(duplicated.idMap.get('a')).toBe('copy-1')
    expect(duplicated.idMap.get('a-1')).toBe('copy-2')
    expect(duplicated.folders.find((folder) => folder.id === 'copy-1')).toMatchObject({
      parentId: 'b',
      name: 'A 副本',
    })
    expect(duplicated.folders.find((folder) => folder.id === 'copy-2')?.parentId).toBe('copy-1')
    expect(getFolderDescendantIds(duplicated.folders, 'copy-1')).toEqual(new Set(['copy-2']))
  })
})
