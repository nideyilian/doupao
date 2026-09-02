import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createDesktopJsonStorage } from '../../lib/desktopJsonStorage'
import type { TaskRecord } from '../../types'
import { planRequirementOrder } from './planner'
import { DEFAULT_REQUIREMENT_SETTINGS, REQUIREMENT_USERS, seedRequirementCatalog } from './seed'
import {
  buildStrategyTestPrompt,
  createStrategyAsset,
  normalizeStrategyAsset,
  seedStrategyAssets,
  seedStrategyPresets,
  strategyId,
  validateStrategyForTest,
} from '../strategy/model'
import type {
  CatalogChannel,
  CatalogMaterialType,
  CatalogProduct,
  KnowledgeBatch,
  KnowledgeInsight,
  RequirementAuditEvent,
  RequirementCatalog,
  RequirementDraft,
  RequirementOrder,
  RequirementRoute,
  RequirementSettings,
  RequirementUnit,
  StrategyDraft,
  RequirementUser,
} from './types'
import type { StrategyAsset, StrategyPreset } from '../strategy/types'
import type { SopGroup, SopLibraryItem, SopMetaInstruction, SopVersion } from '../strategy/types'
import {
  mergeSopMetaInstructions,
  seedSopGroups,
  seedSopLibrary,
  seedSopMetaInstructions,
  sopLibraryId,
} from '../strategy/sopLibrary'

function id(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function orderNumber(orderCount: number) {
  const date = new Date()
  const day = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
  return `RO${day}-${String(orderCount + 1).padStart(4, '0')}`
}

function defaultRoute(role: RequirementUser['role']): RequirementRoute {
  if (role === 'optimizer') return 'order'
  if (role === 'strategist') return 'strategy'
  return 'admin'
}

function startOfToday() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}

interface RequirementPrototypeState {
  hydrated: boolean
  sessionUserId: string | null
  route: RequirementRoute
  selectedOrderId: string | null
  users: RequirementUser[]
  catalog: RequirementCatalog
  strategyDrafts: Record<string, StrategyDraft>
  strategyVersions: Record<string, CatalogMaterialType[]>
  strategyAssets: StrategyAsset[]
  strategyPresets: StrategyPreset[]
  sopGroups: SopGroup[]
  sopLibrary: SopLibraryItem[]
  sopMetaInstructions: SopMetaInstruction[]
  sopVersionHistory: Record<string, SopVersion[]>
  strategyAssetVersions: Record<string, StrategyAsset[]>
  settings: RequirementSettings
  orders: RequirementOrder[]
  knowledgeBatches: KnowledgeBatch[]
  knowledgeInsights: KnowledgeInsight[]
  audits: RequirementAuditEvent[]
  setHydrated: (hydrated: boolean) => void
  login: (username: string, password: string) => { ok: boolean; error?: string }
  logout: () => void
  setRoute: (route: RequirementRoute) => void
  selectOrder: (orderId: string | null) => void
  remainingQuota: (userId: string) => number
  createOrder: (draft: RequirementDraft) => { order?: RequirementOrder; error?: string }
  createStrategyTest: (materialTypeId: string) => { order?: RequirementOrder; error?: string }
  createStrategyWorkflowTest: (strategyId: string, quantity: number) => { order?: RequirementOrder; error?: string }
  attachTask: (orderId: string, unitId: string, taskId: string) => void
  failUnit: (orderId: string, unitId: string, error: string) => void
  retryUnit: (orderId: string, unitId: string) => void
  syncTasks: (tasks: TaskRecord[]) => void
  cancelOrder: (orderId: string) => void
  approveUrgent: (orderId: string, approved: boolean) => void
  saveProduct: (product: CatalogProduct) => void
  saveChannel: (channel: CatalogChannel) => void
  saveMaterialType: (materialType: CatalogMaterialType) => void
  saveStrategyDraft: (draft: Omit<StrategyDraft, 'updatedBy' | 'updatedAt'>) => void
  submitStrategyDraft: (materialTypeId: string) => void
  publishStrategyDraft: (materialTypeId: string) => void
  rollbackMaterialType: (materialTypeId: string, version: number) => void
  saveStrategyAsset: (strategy: StrategyAsset) => void
  createStrategyAsset: (productId: string, materialTypeId: string) => string | null
  duplicateStrategyAsset: (strategyId: string, productId?: string, materialTypeId?: string) => string | null
  moveStrategyAsset: (strategyId: string, productId: string, materialTypeId: string) => void
  archiveStrategyAsset: (strategyId: string, archived?: boolean) => void
  rollbackStrategyAsset: (strategyId: string, version: number) => void
  saveStrategyPreset: (preset: StrategyPreset) => void
  archiveStrategyPreset: (presetId: string) => void
  saveSopGroup: (group: SopGroup) => void
  duplicateSopGroup: (groupId: string) => string | null
  deleteSopGroup: (groupId: string) => void
  saveSopItem: (item: SopLibraryItem) => void
  duplicateSopItem: (itemId: string) => string | null
  deleteSopItem: (itemId: string) => void
  saveSopMetaInstruction: (item: SopMetaInstruction) => void
  duplicateSopMetaInstruction: (itemId: string) => string | null
  deleteSopMetaInstruction: (itemId: string) => void
  addKnowledgeBatch: (batch: Omit<KnowledgeBatch, 'id' | 'createdAt' | 'createdBy'>) => void
  updateKnowledgeBatch: (batchId: string, patch: Partial<KnowledgeBatch>) => void
  replaceKnowledgeInsights: (
    batchId: string,
    insights: Omit<KnowledgeInsight, 'id' | 'batchId' | 'createdAt'>[],
  ) => void
  updateSettings: (patch: Partial<RequirementSettings>) => void
  saveUser: (user: RequirementUser) => void
}

export const REQUIREMENT_PROTOTYPE_STORE_VERSION = 5

export function migrateRequirementPrototypeState(persistedState: unknown) {
  const state = persistedState as Partial<RequirementPrototypeState>
  return {
    ...state,
    strategyAssets: (state.strategyAssets ?? []).map((strategy) => normalizeStrategyAsset(strategy)),
    sopGroups: state.sopGroups?.length ? state.sopGroups : seedSopGroups(),
    sopLibrary: state.sopLibrary?.length ? state.sopLibrary : seedSopLibrary(),
    sopMetaInstructions: mergeSopMetaInstructions(state.sopMetaInstructions),
    sopVersionHistory: state.sopVersionHistory ?? {},
    strategyAssetVersions: Object.fromEntries(
      Object.entries(state.strategyAssetVersions ?? {}).map(([strategyId, versions]) => [
        strategyId,
        versions.map((strategy) => normalizeStrategyAsset(strategy)),
      ]),
    ),
  } as RequirementPrototypeState
}

export const useRequirementPrototype = create<RequirementPrototypeState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      sessionUserId: null,
      route: 'order',
      selectedOrderId: null,
      users: REQUIREMENT_USERS,
      catalog: seedRequirementCatalog(),
      strategyDrafts: {},
      strategyVersions: {},
      strategyAssets: seedStrategyAssets(seedRequirementCatalog()),
      strategyPresets: seedStrategyPresets(),
      sopGroups: seedSopGroups(),
      sopLibrary: seedSopLibrary(),
      sopMetaInstructions: seedSopMetaInstructions(),
      sopVersionHistory: {},
      strategyAssetVersions: {},
      settings: DEFAULT_REQUIREMENT_SETTINGS,
      orders: [],
      knowledgeBatches: [],
      knowledgeInsights: [],
      audits: [],
      setHydrated: (hydrated) => set({ hydrated }),
      login: (username, password) => {
        const user = get().users.find((item) => item.username === username.trim())
        if (!user || password !== (user.password ?? 'demo123')) return { ok: false, error: '账号或密码错误' }
        if (user.disabled) return { ok: false, error: '账号已停用' }
        const event: RequirementAuditEvent = {
          id: id('audit'),
          actorId: user.id,
          actorName: user.displayName,
          action: '登录',
          detail: '登录本地原型',
          createdAt: Date.now(),
        }
        set((state) => ({
          sessionUserId: user.id,
          route: defaultRoute(user.role),
          audits: [event, ...state.audits].slice(0, 1000),
        }))
        return { ok: true }
      },
      logout: () => set({ sessionUserId: null, selectedOrderId: null }),
      setRoute: (route) => set({ route, selectedOrderId: null }),
      selectOrder: (selectedOrderId) => set({ selectedOrderId, route: 'orders' }),
      remainingQuota: (userId) => {
        const user = get().users.find((item) => item.id === userId)
        const used = get()
          .orders.filter(
            (order) => order.createdBy === userId && order.createdAt >= startOfToday() && order.status !== 'cancelled',
          )
          .reduce((sum, order) => sum + order.totalImages, 0)
        return Math.max(0, (user?.dailyQuota ?? get().settings.defaultDailyQuota) - used)
      },
      createOrder: (draft) => {
        const state = get()
        const user = state.users.find((item) => item.id === state.sessionUserId)
        if (!user || user.role !== 'optimizer') return { error: '当前账号没有正式下单权限' }
        const preview = planRequirementOrder(draft, state.catalog, {
          maxImagesPerOrder: state.settings.maxImagesPerOrder,
          remainingDailyQuota: state.remainingQuota(user.id),
        })
        if (!preview.valid) return { error: preview.errors[0] }
        const createdAt = Date.now()
        const order: RequirementOrder = {
          id: id('order'),
          number: orderNumber(state.orders.length),
          createdBy: user.id,
          createdByName: user.displayName,
          createdAt,
          status: 'queued',
          draft,
          units: preview.units,
          excluded: preview.excluded,
          totalImages: preview.totalImages,
          completedImages: 0,
          failedImages: 0,
          urgentRequested: draft.urgentRequested,
          urgentApproved: false,
          urgentReason: draft.urgentReason,
          estimatedFinishedAt:
            createdAt +
            Math.max(20 * 60_000, (preview.totalImages * 45_000) / Math.max(1, state.settings.generationConcurrency)),
        }
        const event: RequirementAuditEvent = {
          id: id('audit'),
          actorId: user.id,
          actorName: user.displayName,
          action: '创建需求',
          detail: `${order.number}，计划 ${order.totalImages} 张`,
          createdAt,
        }
        set((current) => ({
          orders: [order, ...current.orders],
          audits: [event, ...current.audits].slice(0, 1000),
          route: 'orders',
          selectedOrderId: order.id,
        }))
        return { order }
      },
      createStrategyTest: (materialTypeId) => {
        const state = get()
        const user = state.users.find((item) => item.id === state.sessionUserId)
        if (!user || (user.role !== 'strategist' && user.role !== 'admin')) return { error: '当前账号没有策略测试权限' }
        const current = state.catalog.materialTypes.find((item) => item.id === materialTypeId)
        if (!current) return { error: '素材类型不存在' }
        const strategyDraft = state.strategyDrafts[materialTypeId]
        const materialType: CatalogMaterialType = strategyDraft
          ? {
              ...current,
              summary: strategyDraft.summary,
              strategy: strategyDraft.strategy,
              fixedRules: current.mode === 'fixed' ? strategyDraft.fixedRules : undefined,
              supportedRatios: current.mode === 'fixed' ? strategyDraft.supportedRatios : undefined,
            }
          : current
        const draft: RequirementDraft = {
          productIds: [state.catalog.products[0].id],
          channels: [
            { channelId: state.catalog.channels[0].id, ratios: [materialType.supportedRatios?.[0] ?? '16:9'] },
          ],
          materialTypeIds: [materialTypeId],
          quantity: 1,
          urgentRequested: false,
        }
        const preview = planRequirementOrder(
          draft,
          {
            ...state.catalog,
            materialTypes: state.catalog.materialTypes.map((item) =>
              item.id === materialTypeId ? materialType : item,
            ),
          },
          { maxImagesPerOrder: state.settings.maxImagesPerOrder, remainingDailyQuota: Number.MAX_SAFE_INTEGER },
        )
        if (!preview.valid) return { error: preview.errors[0] }
        const createdAt = Date.now()
        const order: RequirementOrder = {
          id: id('test'),
          number: `TEST-${orderNumber(state.orders.length)}`,
          createdBy: user.id,
          createdByName: user.displayName,
          createdAt,
          status: 'queued',
          draft,
          units: preview.units,
          excluded: preview.excluded,
          totalImages: preview.totalImages,
          completedImages: 0,
          failedImages: 0,
          urgentRequested: false,
          urgentApproved: false,
          estimatedFinishedAt: createdAt + 10 * 60_000,
          isTest: true,
        }
        set((currentState) => ({
          orders: [order, ...currentState.orders],
          route: 'orders',
          selectedOrderId: order.id,
        }))
        return { order }
      },
      createStrategyWorkflowTest: (selectedStrategyId, quantity) => {
        const state = get()
        const user = state.users.find((item) => item.id === state.sessionUserId)
        if (!user || (user.role !== 'strategist' && user.role !== 'admin')) return { error: '当前账号没有策略测试权限' }
        const strategy = state.strategyAssets.find((item) => item.id === selectedStrategyId && !item.archived)
        if (!strategy) return { error: '策略不存在或已归档' }
        if (!Number.isInteger(quantity) || quantity <= 0) return { error: '测试数量必须是正整数' }
        const materialType = state.catalog.materialTypes.find((item) => item.id === strategy.materialTypeId)
        const validationError = validateStrategyForTest(strategy, materialType)[0]
        if (validationError) return { error: validationError }
        const channelId = strategy.outputs.channels.enabled
          ? strategy.outputs.channels.channelIds[0]
          : state.catalog.channels.find((item) => item.published && !item.archived)?.id
        const ratio = strategy.outputs.sizes.enabled ? strategy.outputs.sizes.ratios[0] : '16:9'
        if (!channelId) return { error: '请先选择输出渠道' }
        const knowledgeDescriptions = strategy.workflow.knowledge.insightIds
          .map((insightId) => state.knowledgeInsights.find((insight) => insight.id === insightId)?.description)
          .filter((description): description is string => Boolean(description))
        const prompt = buildStrategyTestPrompt(strategy, state.catalog, knowledgeDescriptions)
        const referenceImageIds = [...new Set(strategy.workflow.reference?.imageIds ?? [])]
        const createdAt = Date.now()
        const draft: RequirementDraft = {
          productIds: [strategy.productId],
          channels: [{ channelId, ratios: [ratio] }],
          materialTypeIds: [strategy.materialTypeId],
          quantity,
          urgentRequested: false,
        }
        const order: RequirementOrder = {
          id: id('test'),
          number: `TEST-${orderNumber(state.orders.length)}`,
          createdBy: user.id,
          createdByName: user.displayName,
          createdAt,
          status: 'queued',
          draft,
          units: [
            {
              id: strategyId('unit'),
              productId: strategy.productId,
              channelId,
              ratio,
              materialTypeId: strategy.materialTypeId,
              quantity,
              prompt,
              status: 'queued',
              referenceImageIds,
            },
          ],
          excluded: [],
          totalImages: quantity,
          completedImages: 0,
          failedImages: 0,
          urgentRequested: false,
          urgentApproved: false,
          estimatedFinishedAt:
            createdAt + Math.max(10 * 60_000, (quantity * 45_000) / Math.max(1, state.settings.generationConcurrency)),
          isTest: true,
          strategyId: strategy.id,
        }
        set((current) => ({ orders: [order, ...current.orders] }))
        return { order }
      },
      attachTask: (orderId, unitId, taskId) =>
        set((state) => ({
          orders: state.orders.map((order) =>
            order.id !== orderId
              ? order
              : {
                  ...order,
                  status: 'running',
                  units: order.units.map((unit) =>
                    unit.id === unitId ? { ...unit, taskId, status: 'running' } : unit,
                  ),
                },
          ),
        })),
      failUnit: (orderId, unitId, error) =>
        set((state) => ({
          orders: state.orders.map((order) =>
            order.id !== orderId
              ? order
              : {
                  ...order,
                  status: order.units.some(
                    (unit) => unit.id !== unitId && (unit.status === 'done' || unit.status === 'running'),
                  )
                    ? 'partially_failed'
                    : 'failed',
                  units: order.units.map((unit) => (unit.id === unitId ? { ...unit, status: 'error', error } : unit)),
                },
          ),
        })),
      retryUnit: (orderId, unitId) =>
        set((state) => ({
          orders: state.orders.map((order) =>
            order.id !== orderId
              ? order
              : {
                  ...order,
                  status: 'queued',
                  failedImages: Math.max(
                    0,
                    order.failedImages - (order.units.find((unit) => unit.id === unitId)?.quantity ?? 0),
                  ),
                  units: order.units.map((unit) =>
                    unit.id === unitId ? { ...unit, status: 'queued', taskId: undefined, error: undefined } : unit,
                  ),
                },
          ),
        })),
      syncTasks: (tasks) =>
        set((state) => {
          const byId = new Map(tasks.map((task) => [task.id, task]))
          let changed = false
          const orders = state.orders.map((order) => {
            if (order.status === 'cancelled' || !order.units.some((unit) => unit.taskId)) return order
            const units: RequirementUnit[] = order.units.map((unit) => {
              if (!unit.taskId) return unit
              const task = byId.get(unit.taskId)
              if (!task) return unit
              const status: RequirementUnit['status'] =
                task.status === 'done' ? 'done' : task.status === 'error' ? 'error' : 'running'
              const error = task.error ?? undefined
              if (status !== unit.status || error !== unit.error) changed = true
              return { ...unit, status, error }
            })
            const completedImages = units.reduce((sum, unit) => {
              if (unit.status !== 'done') return sum
              const task = unit.taskId ? byId.get(unit.taskId) : undefined
              return sum + Math.min(unit.quantity, task?.outputImages?.length ?? unit.quantity)
            }, 0)
            const failedImages = units.reduce((sum, unit) => {
              if (unit.status !== 'error') return sum
              const task = unit.taskId ? byId.get(unit.taskId) : undefined
              const completed = Math.min(unit.quantity, task?.outputImages?.length ?? 0)
              return sum + Math.max(0, unit.quantity - completed)
            }, 0)
            const allTerminal = units.every(
              (unit) => unit.status === 'done' || unit.status === 'error' || unit.status === 'cancelled',
            )
            const status: RequirementOrder['status'] = allTerminal
              ? failedImages === 0
                ? 'completed'
                : completedImages > 0
                  ? 'partially_failed'
                  : 'failed'
              : 'running'
            if (
              completedImages !== order.completedImages ||
              failedImages !== order.failedImages ||
              status !== order.status
            )
              changed = true
            return { ...order, units, completedImages, failedImages, status }
          })
          return changed ? { orders } : state
        }),
      cancelOrder: (orderId) => {
        const user = get().users.find((item) => item.id === get().sessionUserId)
        set((state) => ({
          orders: state.orders.map((order) =>
            order.id === orderId
              ? {
                  ...order,
                  status: 'cancelled',
                  units: order.units.map((unit) => (unit.status === 'done' ? unit : { ...unit, status: 'cancelled' })),
                }
              : order,
          ),
          audits: user
            ? [
                {
                  id: id('audit'),
                  actorId: user.id,
                  actorName: user.displayName,
                  action: '取消需求',
                  detail: state.orders.find((item) => item.id === orderId)?.number ?? orderId,
                  createdAt: Date.now(),
                },
                ...state.audits,
              ]
            : state.audits,
        }))
      },
      approveUrgent: (orderId, approved) =>
        set((state) => ({
          orders: state.orders.map((order) =>
            order.id === orderId
              ? {
                  ...order,
                  urgentApproved: approved,
                  urgentRejected: !approved,
                  estimatedFinishedAt: approved
                    ? Date.now() + (order.draft.urgentTargetMinutes ?? 120) * 60_000
                    : order.estimatedFinishedAt,
                }
              : order,
          ),
        })),
      saveProduct: (product) =>
        set((state) => ({
          catalog: {
            ...state.catalog,
            products: state.catalog.products.some((item) => item.id === product.id)
              ? state.catalog.products.map((item) => (item.id === product.id ? product : item))
              : [...state.catalog.products, product],
          },
        })),
      saveChannel: (channel) =>
        set((state) => ({
          catalog: {
            ...state.catalog,
            channels: state.catalog.channels.some((item) => item.id === channel.id)
              ? state.catalog.channels.map((item) => (item.id === channel.id ? channel : item))
              : [...state.catalog.channels, channel],
          },
        })),
      saveMaterialType: (materialType) =>
        set((state) => ({
          catalog: {
            ...state.catalog,
            materialTypes: state.catalog.materialTypes.some((item) => item.id === materialType.id)
              ? state.catalog.materialTypes.map((item) => (item.id === materialType.id ? materialType : item))
              : [...state.catalog.materialTypes, materialType],
          },
        })),
      saveStrategyDraft: (draft) => {
        const user = get().users.find((item) => item.id === get().sessionUserId)
        if (!user || (user.role !== 'strategist' && user.role !== 'admin')) return
        set((state) => ({
          strategyDrafts: {
            ...state.strategyDrafts,
            [draft.materialTypeId]: {
              ...draft,
              status: 'draft',
              updatedBy: user.id,
              updatedAt: Date.now(),
            },
          },
        }))
      },
      submitStrategyDraft: (materialTypeId) =>
        set((state) => {
          const draft = state.strategyDrafts[materialTypeId]
          if (!draft) return state
          return {
            strategyDrafts: {
              ...state.strategyDrafts,
              [materialTypeId]: { ...draft, status: 'review', updatedAt: Date.now() },
            },
          }
        }),
      publishStrategyDraft: (materialTypeId) =>
        set((state) => {
          const user = state.users.find((item) => item.id === state.sessionUserId)
          const draft = state.strategyDrafts[materialTypeId]
          const current = state.catalog.materialTypes.find((item) => item.id === materialTypeId)
          if (!user || user.role !== 'admin' || !draft || draft.status !== 'review' || !current) return state
          const published: CatalogMaterialType = {
            ...current,
            summary: draft.summary,
            strategy: draft.strategy,
            fixedRules: current.mode === 'fixed' ? draft.fixedRules : undefined,
            supportedRatios: current.mode === 'fixed' ? draft.supportedRatios : undefined,
            version: current.version + 1,
            published: true,
          }
          const nextDrafts = { ...state.strategyDrafts }
          delete nextDrafts[materialTypeId]
          return {
            catalog: {
              ...state.catalog,
              materialTypes: state.catalog.materialTypes.map((item) => (item.id === materialTypeId ? published : item)),
            },
            strategyDrafts: nextDrafts,
            strategyVersions: {
              ...state.strategyVersions,
              [materialTypeId]: [current, ...(state.strategyVersions[materialTypeId] ?? [])].slice(0, 20),
            },
            audits: [
              {
                id: id('audit'),
                actorId: user.id,
                actorName: user.displayName,
                action: '发布策略',
                detail: `${published.name} v${published.version}`,
                createdAt: Date.now(),
              },
              ...state.audits,
            ],
          }
        }),
      rollbackMaterialType: (materialTypeId, version) =>
        set((state) => {
          const user = state.users.find((item) => item.id === state.sessionUserId)
          const current = state.catalog.materialTypes.find((item) => item.id === materialTypeId)
          const target = state.strategyVersions[materialTypeId]?.find((item) => item.version === version)
          if (!user || user.role !== 'admin' || !current || !target) return state
          const rolledBack = { ...target, version: current.version + 1, published: true }
          return {
            catalog: {
              ...state.catalog,
              materialTypes: state.catalog.materialTypes.map((item) =>
                item.id === materialTypeId ? rolledBack : item,
              ),
            },
            strategyVersions: {
              ...state.strategyVersions,
              [materialTypeId]: [current, ...(state.strategyVersions[materialTypeId] ?? [])].slice(0, 20),
            },
          }
        }),
      saveStrategyAsset: (strategy) =>
        set((state) => {
          const normalized = normalizeStrategyAsset(strategy)
          const current = state.strategyAssets.find((item) => item.id === normalized.id)
          const publishingNewVersion = Boolean(
            current &&
            normalized.status === 'published' &&
            (current.status !== 'published' || normalized.version > current.version),
          )
          return {
            strategyAssets: current
              ? state.strategyAssets.map((item) =>
                  item.id === normalized.id ? { ...normalized, updatedAt: Date.now() } : item,
                )
              : [...state.strategyAssets, { ...normalized, updatedAt: Date.now() }],
            strategyAssetVersions:
              publishingNewVersion && current
                ? {
                    ...state.strategyAssetVersions,
                    [normalized.id]: [current, ...(state.strategyAssetVersions[normalized.id] ?? [])].slice(0, 20),
                  }
                : state.strategyAssetVersions,
          }
        }),
      createStrategyAsset: (productId, materialTypeId) => {
        const state = get()
        const user = state.users.find((item) => item.id === state.sessionUserId)
        if (!user) return null
        const strategy = createStrategyAsset(productId, materialTypeId, user.id)
        set((current) => ({ strategyAssets: [...current.strategyAssets, strategy] }))
        return strategy.id
      },
      duplicateStrategyAsset: (selectedStrategyId, productId, materialTypeId) => {
        const state = get()
        const source = state.strategyAssets.find((item) => item.id === selectedStrategyId)
        if (!source) return null
        const copy: StrategyAsset = {
          ...source,
          id: strategyId('strategy'),
          name: `${source.name} 副本`,
          productId: productId ?? source.productId,
          materialTypeId: materialTypeId ?? source.materialTypeId,
          status: 'draft',
          version: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          workflow: {
            ...source.workflow,
            reference: source.workflow.reference
              ? {
                  ...source.workflow.reference,
                  imageIds: [...source.workflow.reference.imageIds],
                }
              : undefined,
            knowledge: {
              ...source.workflow.knowledge,
              insightIds: [...source.workflow.knowledge.insightIds],
            },
            sop: { ...source.workflow.sop },
          },
          outputs: {
            channels: { ...source.outputs.channels, channelIds: [...source.outputs.channels.channelIds] },
            sizes: { ...source.outputs.sizes, ratios: [...source.outputs.sizes.ratios] },
            export: { ...source.outputs.export },
            allocation: { ...source.outputs.allocation },
          },
          resultPromptOverrides: {},
        }
        set((current) => ({ strategyAssets: [...current.strategyAssets, copy] }))
        return copy.id
      },
      moveStrategyAsset: (selectedStrategyId, productId, materialTypeId) =>
        set((state) => ({
          strategyAssets: state.strategyAssets.map((item) =>
            item.id === selectedStrategyId ? { ...item, productId, materialTypeId, updatedAt: Date.now() } : item,
          ),
        })),
      archiveStrategyAsset: (selectedStrategyId, archived = true) =>
        set((state) => ({
          strategyAssets: state.strategyAssets.map((item) =>
            item.id === selectedStrategyId ? { ...item, archived, updatedAt: Date.now() } : item,
          ),
        })),
      rollbackStrategyAsset: (selectedStrategyId, version) =>
        set((state) => {
          const current = state.strategyAssets.find((item) => item.id === selectedStrategyId)
          const target = state.strategyAssetVersions[selectedStrategyId]?.find((item) => item.version === version)
          if (!current || !target) return state
          const rolledBack: StrategyAsset = {
            ...target,
            status: 'published',
            version: current.version + 1,
            updatedAt: Date.now(),
          }
          return {
            strategyAssets: state.strategyAssets.map((item) => (item.id === selectedStrategyId ? rolledBack : item)),
            strategyAssetVersions: {
              ...state.strategyAssetVersions,
              [selectedStrategyId]: [current, ...(state.strategyAssetVersions[selectedStrategyId] ?? [])].slice(0, 20),
            },
          }
        }),
      saveStrategyPreset: (preset) =>
        set((state) => ({
          strategyPresets: state.strategyPresets.some((item) => item.id === preset.id)
            ? state.strategyPresets.map((item) => (item.id === preset.id ? preset : item))
            : [...state.strategyPresets, preset],
        })),
      archiveStrategyPreset: (presetId) =>
        set((state) => ({
          strategyPresets: state.strategyPresets.map((item) =>
            item.id === presetId ? { ...item, archived: true } : item,
          ),
        })),
      saveSopGroup: (group) =>
        set((state) => ({
          sopGroups: state.sopGroups.some((item) => item.id === group.id)
            ? state.sopGroups.map((item) => (item.id === group.id ? group : item))
            : [...state.sopGroups, group],
        })),
      duplicateSopGroup: (groupId) => {
        const source = get().sopGroups.find((item) => item.id === groupId)
        if (!source) return null
        const createdAt = Date.now()
        const newId = sopLibraryId('group')
        set((state) => ({
          sopGroups: [
            ...state.sopGroups,
            { ...source, id: newId, name: `${source.name} 副本`, createdAt, updatedAt: createdAt },
          ],
        }))
        return newId
      },
      deleteSopGroup: (groupId) =>
        set((state) => ({
          sopGroups: state.sopGroups.filter((item) => item.id !== groupId),
          sopLibrary: state.sopLibrary.map((item) =>
            item.groupId === groupId ? { ...item, groupId: undefined, updatedAt: Date.now() } : item,
          ),
        })),
      saveSopItem: (item) =>
        set((state) => {
          const existing = state.sopLibrary.find((entry) => entry.id === item.id)
          let sopVersionHistory = state.sopVersionHistory
          if (existing && (existing.content !== item.content || existing.name !== item.name)) {
            const version: SopVersion = {
              id: id('sop-version'),
              name: existing.name,
              content: existing.content,
              createdAt: Date.now(),
              createdBy: existing.createdBy,
            }
            sopVersionHistory = {
              ...sopVersionHistory,
              [item.id]: [version, ...(sopVersionHistory[item.id] ?? [])].slice(0, 50),
            }
          }
          return {
            sopLibrary: state.sopLibrary.some((entry) => entry.id === item.id)
              ? state.sopLibrary.map((entry) => (entry.id === item.id ? item : entry))
              : [item, ...state.sopLibrary],
            sopVersionHistory,
          }
        }),
      duplicateSopItem: (itemId) => {
        const source = get().sopLibrary.find((item) => item.id === itemId)
        if (!source) return null
        const createdAt = Date.now()
        const newId = sopLibraryId('sop')
        set((state) => ({
          sopLibrary: [
            { ...source, id: newId, name: `${source.name} 副本`, source: 'manual', createdAt, updatedAt: createdAt },
            ...state.sopLibrary,
          ],
        }))
        return newId
      },
      deleteSopItem: (itemId) =>
        set((state) => {
          const sopVersionHistory = { ...state.sopVersionHistory }
          delete sopVersionHistory[itemId]
          return {
            sopLibrary: state.sopLibrary.filter((item) => item.id !== itemId),
            sopVersionHistory,
          }
        }),
      saveSopMetaInstruction: (item) =>
        set((state) => ({
          sopMetaInstructions: state.sopMetaInstructions.some((entry) => entry.id === item.id)
            ? state.sopMetaInstructions.map((entry) => (entry.id === item.id ? item : entry))
            : [item, ...state.sopMetaInstructions],
        })),
      duplicateSopMetaInstruction: (itemId) => {
        const source = get().sopMetaInstructions.find((item) => item.id === itemId)
        if (!source) return null
        const createdAt = Date.now()
        const newId = sopLibraryId('meta')
        set((state) => ({
          sopMetaInstructions: [
            { ...source, id: newId, name: `${source.name} 副本`, kind: 'custom', createdAt, updatedAt: createdAt },
            ...state.sopMetaInstructions,
          ],
        }))
        return newId
      },
      deleteSopMetaInstruction: (itemId) =>
        set((state) => ({
          sopMetaInstructions: state.sopMetaInstructions.filter((item) => item.id !== itemId),
        })),
      addKnowledgeBatch: (batch) => {
        const user = get().users.find((item) => item.id === get().sessionUserId)
        if (!user) return
        set((state) => ({
          knowledgeBatches: [
            { ...batch, id: id('knowledge'), createdAt: Date.now(), createdBy: user.id },
            ...state.knowledgeBatches,
          ],
        }))
      },
      updateKnowledgeBatch: (batchId, patch) =>
        set((state) => ({
          knowledgeBatches: state.knowledgeBatches.map((batch) =>
            batch.id === batchId ? { ...batch, ...patch } : batch,
          ),
        })),
      replaceKnowledgeInsights: (batchId, insights) =>
        set((state) => ({
          knowledgeInsights: [
            ...insights.map((insight) => ({ ...insight, id: id('insight'), batchId, createdAt: Date.now() })),
            ...state.knowledgeInsights.filter((insight) => insight.batchId !== batchId),
          ],
        })),
      updateSettings: (patch) => set((state) => ({ settings: { ...state.settings, ...patch } })),
      saveUser: (user) =>
        set((state) => ({
          users: state.users.some((item) => item.id === user.id)
            ? state.users.map((item) => (item.id === user.id ? user : item))
            : [...state.users, user],
        })),
    }),
    {
      name: 'doupao.requirement-prototype.v1',
      version: REQUIREMENT_PROTOTYPE_STORE_VERSION,
      storage: createDesktopJsonStorage('requirementPrototype', {
        read: async () => localStorage.getItem('doupao.requirement-prototype.v1'),
      }),
      migrate: migrateRequirementPrototypeState,
      onRehydrateStorage: () => (state) => state?.setHydrated(true),
      partialize: (state) => ({
        sessionUserId: state.sessionUserId,
        route: state.route,
        users: state.users,
        catalog: state.catalog,
        strategyDrafts: state.strategyDrafts,
        strategyVersions: state.strategyVersions,
        strategyAssets: state.strategyAssets,
        strategyPresets: state.strategyPresets,
        sopGroups: state.sopGroups,
        sopLibrary: state.sopLibrary,
        sopMetaInstructions: state.sopMetaInstructions,
        sopVersionHistory: state.sopVersionHistory,
        strategyAssetVersions: state.strategyAssetVersions,
        settings: state.settings,
        orders: state.orders,
        knowledgeBatches: state.knowledgeBatches,
        knowledgeInsights: state.knowledgeInsights,
        audits: state.audits,
      }),
    },
  ),
)
