import type {
  AssetColorLabel,
  AssetCollection,
  AssetLibraryScope,
  AssetPatch,
  AssetRating,
  AssetStatus,
  AssetTag,
  AssetTombstone,
  AssetUsageAction,
  AssetUsageEvent,
  AssetUsageTarget,
  GeneratedAsset,
  GeneratedAssetOrigin,
  TaskParams,
} from '../types'
import { ensureAssetIdentity } from './assetIdentity'

// ===== 基础校验与归一化 =====

const ASSET_COLOR_LABELS = new Set<AssetColorLabel>(['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'])

/** 颜色标签轮换顺序（Eagle 式快捷键 C：无 → 红 → 橙 → 黄 → 绿 → 蓝 → 紫 → 灰 → 无）。 */
export const COLOR_LABEL_CYCLE: AssetColorLabel[] = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray']

export function cycleColorLabel(current: AssetColorLabel | undefined): AssetColorLabel | undefined {
  if (!current) return COLOR_LABEL_CYCLE[0]
  const index = COLOR_LABEL_CYCLE.indexOf(current)
  if (index < 0) return COLOR_LABEL_CYCLE[0]
  const next = COLOR_LABEL_CYCLE[index + 1]
  return next ?? undefined // 灰色之后清除
}

function normalizeColorLabel(value: unknown): AssetColorLabel | undefined {
  return ASSET_COLOR_LABELS.has(value as AssetColorLabel) ? (value as AssetColorLabel) : undefined
}

/** 容错解析素材状态；旧数据 / 脏数据一律回退到 active。 */
export function normalizeAssetStatus(value: unknown): AssetStatus {
  return value === 'trashed' ? 'trashed' : 'active'
}

/** 容错解析星级评分；仅接受 0-5 的整数，否则回退到 0。 */
export function normalizeAssetRating(value: unknown): AssetRating {
  const n = Math.floor(Number(value))
  if (Number.isFinite(n) && n >= 0 && n <= 5) return n as AssetRating
  return 0
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function normalizeOriginKey(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizeNumber(value: unknown): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function normalizeOptionalNumber(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** 归一化单个生成来源；originKey 非法时用 `${taskId}:${outputSlot}` 重建。 */
export function normalizeAssetOrigin(value: unknown, index: number): GeneratedAssetOrigin {
  const raw = (value ?? {}) as Partial<GeneratedAssetOrigin>
  const taskId = normalizeString(raw.taskId)
  const outputSlot = Number.isFinite(Number(raw.outputSlot)) ? Number(raw.outputSlot) : index
  const key = normalizeOriginKey(raw.key, `${taskId}:${outputSlot}`)
  return {
    kind: raw.kind === 'reference' ? 'reference' : 'generated',
    key,
    taskId,
    outputSlot,
    taskCreatedAt: normalizeNumber(raw.taskCreatedAt) ?? 0,
    taskFinishedAt: normalizeOptionalNumber(raw.taskFinishedAt),
    sourceMode:
      raw.sourceMode === 'gallery' ||
      raw.sourceMode === 'agent' ||
      raw.sourceMode === 'schedule' ||
      raw.sourceMode === 'sop'
        ? raw.sourceMode
        : 'unknown',
    workspaceTabId: normalizeNullableString(raw.workspaceTabId) ?? undefined,
    workspaceTabName: normalizeNullableString(raw.workspaceTabName) ?? undefined,
    prompt: normalizeString(raw.prompt),
    revisedPrompt: normalizeNullableString(raw.revisedPrompt) ?? undefined,
    requestedParams: raw.requestedParams ?? ({} as TaskParams),
    actualParams: raw.actualParams,
    imageActualParams: raw.imageActualParams,
    seed: normalizeOptionalNumber(raw.seed) ?? undefined,
    apiProvider: raw.apiProvider,
    apiProfileId: normalizeNullableString(raw.apiProfileId) ?? undefined,
    apiProfileName: normalizeNullableString(raw.apiProfileName) ?? undefined,
    apiMode: raw.apiMode,
    apiModel: normalizeNullableString(raw.apiModel) ?? undefined,
    inputImageIds: normalizeStringArray(raw.inputImageIds),
    maskTargetImageId: normalizeNullableString(raw.maskTargetImageId),
    maskImageId: normalizeNullableString(raw.maskImageId),
    filenameBatch: normalizeOptionalNumber(raw.filenameBatch) ?? undefined,
    filenameLabel: normalizeNullableString(raw.filenameLabel) ?? undefined,
    generatedFileNameBase: normalizeNullableString(raw.generatedFileNameBase) ?? undefined,
  }
}

/** 归一化素材记录；缺失字段补默认值，非法值回退，确保任何来源的数据都可安全入仓。 */
export function normalizeAsset(value: unknown, now = Date.now()): GeneratedAsset {
  const raw = (value ?? {}) as Partial<GeneratedAsset>
  const id = normalizeString(raw.id)
  const createdAt = normalizeNumber(raw.createdAt) ?? now
  const origins = Array.isArray(raw.origins) ? raw.origins.map(normalizeAssetOrigin) : []
  const primaryOriginKey = normalizeNullableString(raw.primaryOriginKey)
  const primaryOrigin = primaryOriginKey ? (origins.find((o) => o.key === primaryOriginKey) ?? origins[0]) : origins[0]
  return ensureAssetIdentity({
    id,
    imageId: normalizeString(raw.imageId) || id,
    status: normalizeAssetStatus(raw.status),
    createdAt,
    updatedAt: normalizeNumber(raw.updatedAt) ?? createdAt,
    trashedAt: normalizeOptionalNumber(raw.trashedAt),
    favorite: normalizeBoolean(raw.favorite),
    rating: normalizeAssetRating(raw.rating),
    colorLabel: normalizeColorLabel(raw.colorLabel),
    collectionIds: normalizeStringArray(raw.collectionIds),
    tagIds: normalizeStringArray(raw.tagIds),
    notes: normalizeNullableString(raw.notes) ?? undefined,
    origins,
    primaryOriginKey: primaryOrigin?.key ?? null,
    parentAssetIds: normalizeStringArray(raw.parentAssetIds),
    width: normalizeNumber(raw.width),
    height: normalizeNumber(raw.height),
    mimeType: normalizeNullableString(raw.mimeType) ?? undefined,
    byteSize: normalizeNumber(raw.byteSize),
    metadataVersion: Number(raw.metadataVersion) || 1,
  })
}

/** 归一化素材集（项目）；id / name 非法时返回 null。 */
export function normalizeCollection(value: unknown): AssetCollection | null {
  const raw = (value ?? {}) as Partial<AssetCollection>
  const id = normalizeString(raw.id)
  const name = normalizeString(raw.name)
  if (!id || !name) return null
  const now = Date.now()
  return {
    id,
    name,
    normalizedName: normalizeString(raw.normalizedName) || name.toLocaleLowerCase('zh-CN'),
    parentId: normalizeNullableString(raw.parentId),
    order: Number(raw.order) || 0,
    color: normalizeNullableString(raw.color) ?? undefined,
    pinned: raw.pinned === true,
    trashedAt: normalizeOptionalNumber(raw.trashedAt) ?? null,
    createdAt: normalizeNumber(raw.createdAt) ?? now,
    updatedAt: normalizeNumber(raw.updatedAt) ?? now,
  }
}

/** 归一化标签；id / name 非法时返回 null。 */
export function normalizeTag(value: unknown): AssetTag | null {
  const raw = (value ?? {}) as Partial<AssetTag>
  const id = normalizeString(raw.id)
  const name = normalizeString(raw.name)
  if (!id || !name) return null
  const now = Date.now()
  return {
    id,
    name,
    normalizedName: normalizeString(raw.normalizedName) || name.toLocaleLowerCase('zh-CN'),
    parentId: normalizeNullableString(raw.parentId),
    order: Number(raw.order) || 0,
    color: normalizeNullableString(raw.color) ?? undefined,
    createdAt: normalizeNumber(raw.createdAt) ?? now,
    updatedAt: normalizeNumber(raw.updatedAt) ?? now,
  }
}

/** 归一化墓碑记录；id 非法时返回 null。 */
export function normalizeTombstone(value: unknown): AssetTombstone | null {
  const raw = (value ?? {}) as Partial<AssetTombstone>
  const id = normalizeString(raw.id)
  if (!id) return null
  return {
    id,
    imageId: normalizeString(raw.imageId) || id,
    purgedAt: normalizeNumber(raw.purgedAt) ?? Date.now(),
    lastOriginOccurredAt: normalizeNumber(raw.lastOriginOccurredAt) ?? Date.now(),
  }
}

// ===== 构造器 =====

export function createEmptyCollection(now = Date.now()): AssetCollection {
  const id = crypto.randomUUID()
  return {
    id,
    name: '',
    normalizedName: '',
    parentId: null,
    order: 0,
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

/** 构造空标签（新建时由调用方填充 name/parentId/order）。 */
export function createEmptyTag(now = Date.now()): AssetTag {
  const id = crypto.randomUUID()
  return {
    id,
    name: '',
    normalizedName: '',
    parentId: null,
    order: 0,
    createdAt: now,
    updatedAt: now,
  }
}

/** 标签排序：父级分组 + 同级 order + 名称（与集合排序同构，保证树渲染稳定）。 */
export function sortTags(tags: AssetTag[]): AssetTag[] {
  return tags.slice().sort((a, b) => {
    const parentDiff = (a.parentId ?? '').localeCompare(b.parentId ?? '')
    if (parentDiff !== 0) return parentDiff
    if (a.order !== b.order) return a.order - b.order
    return a.normalizedName.localeCompare(b.normalizedName, 'zh-CN')
  })
}

// ===== 补丁与应用 =====

/** 仅允许通过补丁修改收藏 / 评分 / 颜色标签 / 项目 / 标签 / 备注；时间戳统一更新。 */
export function applyAssetPatch(asset: GeneratedAsset, patch: AssetPatch, now = Date.now()): GeneratedAsset {
  return {
    ...asset,
    favorite: patch.favorite ?? asset.favorite,
    rating: patch.rating ?? asset.rating,
    colorLabel: patch.colorLabel !== undefined ? (patch.colorLabel ?? undefined) : asset.colorLabel,
    collectionIds: patch.collectionIds ?? asset.collectionIds,
    tagIds: patch.tagIds ?? asset.tagIds,
    notes: patch.notes ?? asset.notes,
    updatedAt: now,
  }
}

/** 判断素材是否已包含某来源（key 为 `${taskId}:${outputSlot}`）。 */
export function containsAssetOrigin(asset: GeneratedAsset, originKey: string): boolean {
  return asset.origins.some((o) => o.key === originKey)
}

/** 按任务 ID 前缀统计来源数；prefix 需以 `:` 结尾避免误匹配（如 `task-1:0` 与 `task-1` 冲突）。 */
export function countAssetOrigins(asset: GeneratedAsset, originKeyPrefix: string): number {
  return asset.origins.filter((o) => o.key.startsWith(originKeyPrefix)).length
}

export function isAssetTrashed(asset: GeneratedAsset): boolean {
  return asset.status === 'trashed'
}

export function isAssetFavorite(asset: GeneratedAsset): boolean {
  return asset.favorite === true
}

export function isAssetRated(asset: GeneratedAsset): boolean {
  return asset.rating > 0
}

// ===== 衍生链 =====

/**
 * 沿 parentAssetIds 向上追溯，判断 candidateAncestorId 是否为 asset 的祖先。
 * 带访问集合与深度上限防止环导致死循环。
 */
export function hasAssetAncestor(
  asset: GeneratedAsset,
  candidateAncestorId: string,
  byId: ReadonlyMap<string, GeneratedAsset>,
  maxDepth = 64,
): boolean {
  if (asset.parentAssetIds.includes(candidateAncestorId)) return true
  const visited = new Set<string>([asset.id])
  const stack = [...asset.parentAssetIds]
  while (stack.length > 0 && maxDepth-- > 0) {
    const pid = stack.pop() as string
    if (pid === candidateAncestorId) return true
    if (visited.has(pid)) continue
    visited.add(pid)
    const parent = byId.get(pid)
    if (parent) stack.push(...parent.parentAssetIds)
  }
  return false
}

/** 检测 parentAssetIds 是否形成环；返回环上一个成员 id（用于删除引用），无环返回 null。 */
export function findCycleRoot(asset: GeneratedAsset, byId: ReadonlyMap<string, GeneratedAsset>): string | null {
  for (const parentId of asset.parentAssetIds) {
    const parent = byId.get(parentId)
    if (!parent) continue
    if (hasAssetAncestor(parent, asset.id, byId)) {
      return asset.id < parentId ? asset.id : parentId
    }
  }
  return null
}

// ===== 排序 =====

/** 深度优先、同级先置顶、再按 order 再按拼音排序的集合树。 */
export function sortCollections(collections: AssetCollection[]): AssetCollection[] {
  const ids = new Set(collections.map((collection) => collection.id))
  const byParent = new Map<string, AssetCollection[]>()
  for (const c of collections) {
    const key = c.parentId && c.parentId !== c.id && ids.has(c.parentId) ? c.parentId : ''
    const arr = byParent.get(key) ?? []
    arr.push(c)
    byParent.set(key, arr)
  }
  const compareLevel = (a: AssetCollection, b: AssetCollection) =>
    (b.pinned === true ? 1 : 0) - (a.pinned === true ? 1 : 0) ||
    a.order - b.order ||
    a.normalizedName.localeCompare(b.normalizedName, 'zh-CN')
  const result: AssetCollection[] = []
  const visited = new Set<string>()
  const walk = (parentId: string, depth: number) => {
    if (depth > 64) return
    const children = (byParent.get(parentId) ?? []).slice().sort(compareLevel)
    for (const child of children) {
      if (visited.has(child.id)) continue
      visited.add(child.id)
      result.push(child)
      walk(child.id, depth + 1)
    }
  }
  walk('', 0)
  for (const collection of collections.slice().sort(compareLevel)) {
    if (visited.has(collection.id)) continue
    visited.add(collection.id)
    result.push(collection)
    walk(collection.id, 1)
  }
  return result
}

const ASSET_USAGE_ACTIONS = new Set<AssetUsageAction>([
  'selected-as-reference',
  'generation-input',
  'open-postprocess',
  'open-composite',
  'reuse-config',
  'export',
  'derived',
])
const ASSET_USAGE_TARGETS = new Set<AssetUsageTarget>([
  'gallery',
  'agent',
  'schedule',
  'sop',
  'postprocess',
  'composite',
  'export',
  'unknown',
])

export function normalizeAssetUsageEvent(value: unknown): AssetUsageEvent | null {
  const raw = (value ?? {}) as Partial<AssetUsageEvent>
  const id = normalizeString(raw.id)
  const assetId = normalizeString(raw.assetId)
  const imageId = normalizeString(raw.imageId)
  if (!id || !assetId || !imageId || !ASSET_USAGE_ACTIONS.has(raw.action as AssetUsageAction)) return null
  return {
    id,
    assetId,
    imageId,
    action: raw.action as AssetUsageAction,
    target: ASSET_USAGE_TARGETS.has(raw.target as AssetUsageTarget) ? (raw.target as AssetUsageTarget) : 'unknown',
    occurredAt: normalizeNumber(raw.occurredAt) ?? Date.now(),
    taskId: normalizeNullableString(raw.taskId) ?? undefined,
    workspaceTabId: normalizeNullableString(raw.workspaceTabId) ?? undefined,
    sopId: normalizeNullableString(raw.sopId) ?? undefined,
    parentAssetIds: normalizeStringArray(raw.parentAssetIds),
  }
}

// ===== 视图范围匹配 =====

export function assetScopeMatches(
  scope: AssetLibraryScope,
  asset: GeneratedAsset,
  now = Date.now(),
  recentWindowMs = 7 * 24 * 60 * 60 * 1000,
): boolean {
  // 回收站与普通视图严格隔离：除 trash 外的所有范围都排除已回收素材
  const isTrashed = asset.status === 'trashed'
  switch (scope) {
    case 'all':
      return !isTrashed
    case 'recent':
      return !isTrashed && now - asset.createdAt <= recentWindowMs
    case 'favorites':
      return !isTrashed && asset.favorite === true
    case 'unorganized':
      return !isTrashed && asset.collectionIds.length === 0
    case 'trash':
      return isTrashed
  }
  if (typeof scope === 'object') {
    if (isTrashed) return false
    if (scope.kind === 'collection') return asset.collectionIds.includes(scope.id)
    if (scope.kind === 'tag') return asset.tagIds.includes(scope.id)
  }
  return false
}

// ===== 复制规划（剪贴板粘贴用，纯函数）=====

export interface CollectionCopyPlan {
  /** 深拷贝出的项目（含整棵子树，新 id） */
  clones: AssetCollection[]
  /** 素材 id → 需要追加的克隆项目 id 列表（素材本身共享，不复制文件） */
  assetAdditions: Map<string, string[]>
}

/**
 * 规划「复制项目（文件夹）」：深拷贝子树（保留层级与名称，目标父级下重名时根节点加「副本」后缀），
 * 并统计需要追加到各克隆的素材归属。只返回计划，由调用方负责持久化。
 */
export function planCollectionCopy(
  sourceId: string,
  targetParentId: string | null,
  collections: AssetCollection[],
  assets: GeneratedAsset[],
): CollectionCopyPlan | null {
  const source = collections.find((collection) => collection.id === sourceId)
  if (!source) return null
  const now = Date.now()
  const childrenOf = new Map<string, AssetCollection[]>()
  for (const collection of collections) {
    if (collection.parentId) {
      const siblings = childrenOf.get(collection.parentId) ?? []
      siblings.push(collection)
      childrenOf.set(collection.parentId, siblings)
    }
  }
  const existingNames = new Set(
    collections
      .filter((collection) => collection.parentId === targetParentId)
      .map((collection) => collection.normalizedName),
  )
  let rootName = source.name
  if (existingNames.has(source.normalizedName)) {
    rootName = `${source.name} 副本`
    let counter = 2
    while (existingNames.has(rootName.toLocaleLowerCase('zh-CN'))) {
      rootName = `${source.name} 副本${counter}`
      counter++
    }
  }

  const clones: AssetCollection[] = []
  const cloneIdBySourceId = new Map<string, string>()
  const build = (srcId: string, parentCloneId: string | null, nameOverride?: string) => {
    const src = collections.find((collection) => collection.id === srcId)
    if (!src) return
    const name = nameOverride ?? src.name
    const clone: AssetCollection = {
      ...src,
      id: `collection:${crypto.randomUUID()}`,
      name,
      normalizedName: name.toLocaleLowerCase('zh-CN'),
      parentId: parentCloneId,
      createdAt: now,
      updatedAt: now,
    }
    clones.push(clone)
    cloneIdBySourceId.set(srcId, clone.id)
    for (const child of childrenOf.get(srcId) ?? []) build(child.id, clone.id)
  }
  build(sourceId, targetParentId, existingNames.has(source.normalizedName) ? rootName : undefined)

  const assetAdditions = new Map<string, string[]>()
  for (const asset of assets) {
    for (const srcCollectionId of asset.collectionIds) {
      const cloneId = cloneIdBySourceId.get(srcCollectionId)
      if (!cloneId) continue
      const additions = assetAdditions.get(asset.id) ?? []
      if (!additions.includes(cloneId)) additions.push(cloneId)
      assetAdditions.set(asset.id, additions)
    }
  }
  return { clones, assetAdditions }
}

// ===== 树工具（回收站 / 子树）=====

export function isCollectionTrashed(collection: AssetCollection): boolean {
  return collection.trashedAt != null && collection.trashedAt > 0
}

/** 收集集合树中以 rootId 为根的整棵子树（含 root 自身）的 id 列表（BFS，防环）。 */
export function collectCollectionSubtreeIds(collections: AssetCollection[], rootId: string): string[] {
  const childrenOf = new Map<string, string[]>()
  for (const collection of collections) {
    if (!collection.parentId || collection.parentId === collection.id) continue
    const siblings = childrenOf.get(collection.parentId) ?? []
    siblings.push(collection.id)
    childrenOf.set(collection.parentId, siblings)
  }
  const result: string[] = []
  const visited = new Set<string>()
  const stack = [rootId]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (visited.has(id)) continue
    visited.add(id)
    result.push(id)
    for (const childId of childrenOf.get(id) ?? []) stack.push(childId)
  }
  return result
}
