import type { SopBatchSnapshot } from '../../../types'

export const PROMPT_LIBRARY_FOLDERS_STORAGE_KEY = 'doupao.prompt-library-folders.v2'
export const LEGACY_PROMPT_GROUPS_STORAGE_KEY = 'doupao.prompt-collection-groups.v1'

export type PromptLibraryFolder = {
  id: string
  name: string
  parentId: string | null
  order: number
  createdAt: number
  updatedAt: number
}

export type FolderDropPosition = 'before' | 'inside' | 'after'

function numericOrder(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function getSortedFolderChildren(folders: PromptLibraryFolder[], parentId: string | null) {
  return folders
    .filter((folder) => folder.parentId === parentId)
    .sort(
      (left, right) =>
        left.order - right.order ||
        left.name.localeCompare(right.name, 'zh-CN', { numeric: true, sensitivity: 'base' }),
    )
}

function normalizeSiblingOrder(folders: PromptLibraryFolder[]) {
  const orderById = new Map<string, number>()
  const parentIds = new Set(folders.map((folder) => folder.parentId))
  for (const parentId of parentIds) {
    getSortedFolderChildren(folders, parentId).forEach((folder, index) => orderById.set(folder.id, index))
  }
  return folders.map((folder) => ({ ...folder, order: orderById.get(folder.id) ?? folder.order }))
}

export function normalizePromptLibraryFolders(raw: unknown, runs: SopBatchSnapshot[]) {
  const parsed = Array.isArray(raw) ? raw : []
  const folders: PromptLibraryFolder[] = []
  const ids = new Set<string>()

  parsed.forEach((item, index) => {
    if (!item || typeof item !== 'object') return
    const candidate = item as Partial<PromptLibraryFolder>
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
    if (!id || !name || ids.has(id)) return
    ids.add(id)
    folders.push({
      id,
      name,
      parentId: typeof candidate.parentId === 'string' && candidate.parentId !== id ? candidate.parentId : null,
      order: numericOrder(candidate.order, index),
      createdAt: numericOrder(candidate.createdAt, Date.now()),
      updatedAt: numericOrder(candidate.updatedAt, Date.now()),
    })
  })

  for (const run of runs) {
    const group = run.promptGroup
    if (!group?.id || !group.name.trim() || ids.has(group.id)) continue
    ids.add(group.id)
    folders.push({
      id: group.id,
      name: group.name.trim(),
      parentId: null,
      order: folders.filter((folder) => folder.parentId === null).length,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt ?? run.createdAt,
    })
  }

  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  for (const folder of folders) {
    if (folder.parentId && !byId.has(folder.parentId)) folder.parentId = null
    const visited = new Set([folder.id])
    let parentId = folder.parentId
    while (parentId) {
      if (visited.has(parentId)) {
        folder.parentId = null
        break
      }
      visited.add(parentId)
      parentId = byId.get(parentId)?.parentId ?? null
    }
  }

  return normalizeSiblingOrder(folders)
}

export function getFolderDescendantIds(folders: PromptLibraryFolder[], folderId: string) {
  const descendants = new Set<string>()
  const visit = (parentId: string) => {
    for (const child of folders) {
      if (child.parentId !== parentId || descendants.has(child.id)) continue
      descendants.add(child.id)
      visit(child.id)
    }
  }
  visit(folderId)
  return descendants
}

export function getFolderPath(folders: PromptLibraryFolder[], folderId: string | null) {
  if (!folderId) return []
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const path: PromptLibraryFolder[] = []
  const visited = new Set<string>()
  let current = byId.get(folderId)
  while (current && !visited.has(current.id)) {
    path.unshift(current)
    visited.add(current.id)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return path
}

export function flattenPromptLibraryFolders(folders: PromptLibraryFolder[]) {
  const result: Array<{ folder: PromptLibraryFolder; depth: number }> = []
  const visit = (parentId: string | null, depth: number) => {
    for (const folder of getSortedFolderChildren(folders, parentId)) {
      result.push({ folder, depth })
      visit(folder.id, depth + 1)
    }
  }
  visit(null, 0)
  return result
}

export function getUniqueFolderName(
  folders: PromptLibraryFolder[],
  parentId: string | null,
  requestedName: string,
  excludedId?: string,
) {
  const base = requestedName.trim() || '新建文件夹'
  const siblingNames = new Set(
    folders
      .filter((folder) => folder.parentId === parentId && folder.id !== excludedId)
      .map((folder) => folder.name.toLocaleLowerCase()),
  )
  if (!siblingNames.has(base.toLocaleLowerCase())) return base
  let index = 2
  while (siblingNames.has(`${base} ${index}`.toLocaleLowerCase())) index += 1
  return `${base} ${index}`
}

export function movePromptLibraryFolder(
  folders: PromptLibraryFolder[],
  sourceId: string,
  targetId: string,
  position: FolderDropPosition,
) {
  const source = folders.find((folder) => folder.id === sourceId)
  const target = folders.find((folder) => folder.id === targetId)
  if (!source || !target || source.id === target.id) return folders

  const descendants = getFolderDescendantIds(folders, source.id)
  const targetParentId = position === 'inside' ? target.id : target.parentId
  if (targetParentId === source.id || (targetParentId && descendants.has(targetParentId))) return folders

  const oldParentId = source.parentId
  const targetSiblings = getSortedFolderChildren(
    folders.filter((folder) => folder.id !== source.id),
    targetParentId,
  )
  const targetIndex =
    position === 'inside'
      ? targetSiblings.length
      : Math.max(0, targetSiblings.findIndex((folder) => folder.id === target.id) + (position === 'after' ? 1 : 0))
  targetSiblings.splice(targetIndex, 0, { ...source, parentId: targetParentId })

  const orderById = new Map(targetSiblings.map((folder, index) => [folder.id, index]))
  const oldSiblings =
    oldParentId === targetParentId
      ? []
      : getSortedFolderChildren(
          folders.filter((folder) => folder.id !== source.id),
          oldParentId,
        )
  oldSiblings.forEach((folder, index) => orderById.set(folder.id, index))

  return folders.map((folder) => {
    if (folder.id === source.id) {
      return {
        ...folder,
        parentId: targetParentId,
        order: orderById.get(folder.id) ?? folder.order,
        updatedAt: Date.now(),
      }
    }
    const order = orderById.get(folder.id)
    return order == null || order === folder.order ? folder : { ...folder, order }
  })
}

export function movePromptLibraryFolderToParent(
  folders: PromptLibraryFolder[],
  sourceId: string,
  parentId: string | null,
) {
  const source = folders.find((folder) => folder.id === sourceId)
  if (!source || source.id === parentId) return folders
  if (parentId && getFolderDescendantIds(folders, sourceId).has(parentId)) return folders
  const siblings = getSortedFolderChildren(
    folders.filter((folder) => folder.id !== sourceId),
    parentId,
  )
  const orderById = new Map(siblings.map((folder, index) => [folder.id, index]))
  const oldSiblings = getSortedFolderChildren(
    folders.filter((folder) => folder.id !== sourceId),
    source.parentId,
  )
  oldSiblings.forEach((folder, index) => orderById.set(folder.id, index))
  return folders.map((folder) => {
    if (folder.id === sourceId) {
      return { ...folder, parentId, order: siblings.length, updatedAt: Date.now() }
    }
    const order = orderById.get(folder.id)
    return order == null || order === folder.order ? folder : { ...folder, order }
  })
}

export function duplicatePromptLibraryFolderTree(
  folders: PromptLibraryFolder[],
  sourceId: string,
  targetParentId: string | null,
  makeId: () => string,
  now = Date.now(),
) {
  const source = folders.find((folder) => folder.id === sourceId)
  if (!source) return { folders, idMap: new Map<string, string>() }
  const idMap = new Map<string, string>()
  const copies: PromptLibraryFolder[] = []
  const rootName = getUniqueFolderName(folders, targetParentId, `${source.name} 副本`)

  const visit = (folder: PromptLibraryFolder, parentId: string | null, name = folder.name) => {
    const id = makeId()
    idMap.set(folder.id, id)
    copies.push({
      ...folder,
      id,
      name,
      parentId,
      order:
        parentId === targetParentId
          ? getSortedFolderChildren([...folders, ...copies], targetParentId).length
          : folder.order,
      createdAt: now,
      updatedAt: now,
    })
    for (const child of getSortedFolderChildren(folders, folder.id)) visit(child, id)
  }

  visit(source, targetParentId, rootName)
  return { folders: normalizeSiblingOrder([...folders, ...copies]), idMap }
}
