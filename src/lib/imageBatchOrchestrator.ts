// 批量生成编排器（纯函数，不依赖 DOM / Zustand / Electron）。
//
// 设计目标：只负责「数量、恢复、去重」的编排，
// 不关心具体如何调用供应商；供应商适配器负责提交 / 查询 / 取消 / 解析。
//
// 所有状态变更都返回新的 GenerationState（不可变），便于单元测试与崩溃恢复时重放。
//
// 核心流程：
//   createInitialGenerationState → planNextRequests → applyRemoteRequestSubmitted
//     → classifyImageAgainstState（去重）→ commitGeneratedImage（外部）
//     → applyProviderResult / applyRequestFailure → 回到 planNextRequests
//   直到 getBatchCompletion 离开 running。

import type { GenerationSlot, RemoteGenerationProvider, RemoteGenerationRequest } from '../types'
import { areNearDuplicates } from './imageFingerprint'

export type GenerationBatchStatus = 'running' | 'done' | 'partial-failure' | 'error' | 'cancelled'

export interface ImageProviderCapabilities {
  /** 单个请求最多可申请的图片数量 */
  maxImagesPerRequest: number
  /** 是否支持 seed（稳定且每槽位不同） */
  supportsSeed: boolean
  /** 是否支持异步结果恢复（已有远端 request id 后查询） */
  supportsAsyncRecovery: boolean
  /** 是否支持取消在途请求 */
  supportsCancel: boolean
}

export interface GenerationPolicy {
  requestedCount: number
  maxConcurrent: number
  /** 沿用服务商配置中的 maxRetries，作为原请求的指数退避重试次数 */
  transientRetries: number
  /** 单个槽位在首轮之外的补偿次数上限 */
  replacementAttempts: number
  /** 是否自动拒绝完全重复（SHA-256 / pHash 完全一致） */
  rejectExactDuplicates: boolean
  /** 是否自动拒绝近似重复（pHash 汉明距离不超过阈值） */
  rejectNearDuplicates: boolean
  /** 近似重复阈值（汉明距离）；<=0 关闭近似判定 */
  nearDuplicateThreshold: number
  capabilities: ImageProviderCapabilities
}

export type GenerationErrorKind =
  | 'transient'
  | 'rate-limit'
  | 'moderation'
  | 'invalid-input'
  | 'authentication'
  | 'insufficient-balance'
  | 'result-missing'
  | 'duplicate-result'
  | 'cancelled'
  | 'unknown'

export interface GenerationState {
  requestedCount: number
  slots: GenerationSlot[]
  remoteRequests: RemoteGenerationRequest[]
  /** 已创建的补偿请求次数（诊断用） */
  replacementCount: number
  /** 已发现的完全重复次数 */
  duplicateCount: number
  /** 已记录的近似重复次数 */
  nearDuplicateCount: number
  /** 供应商失败（非预期）次数 */
  providerFailureCount: number
  status: GenerationBatchStatus
  error?: string
}

export type PlannedRequestReason = 'initial' | 'replacement'

export interface PlannedRequest {
  slotIndexes: number[]
  count: number
  /** 该请求对应的调度轮次（首轮 0，补偿递增） */
  attempt: number
  reason: PlannedRequestReason
  /** 支持 seed 的供应商下，调用方据此生成稳定且不同的 seed */
  seed?: number
}

export interface RemoteRequestSubmission {
  id: string
  provider: RemoteGenerationProvider
  endpoint?: string
  remoteRequestId?: string
}

export interface SlotAssignment {
  slotIndex: number
  imageId: string
  contentHash: string
  perceptualHash?: string
}

export interface ImageFingerprintLike {
  contentHash?: string
  perceptualHash?: string
}

export interface BatchCompletion {
  status: GenerationBatchStatus
  doneSlots: number
  totalSlots: number
  pendingSlots: number
  failedSlots: number
  inFlightRequests: number
  /** 剩余可补偿次数（按当前最缺图槽位估算，仅诊断） */
  remainingReplacementBudget: number
}

const MAX_IMAGES_PER_REQUEST_FALLBACK = 1
const REPLACEMENT_ATTEMPTS_FALLBACK = 2

/** 构建默认策略；replacementAttempts 默认 2，近似重复默认关闭。 */
export function createGenerationPolicy(
  requestedCount: number,
  options: {
    maxConcurrent: number
    transientRetries: number
    replacementAttempts?: number
    rejectExactDuplicates?: boolean
    rejectNearDuplicates?: boolean
    nearDuplicateThreshold?: number
    capabilities?: Partial<ImageProviderCapabilities>
  },
): GenerationPolicy {
  return {
    requestedCount,
    maxConcurrent: Math.max(1, options.maxConcurrent),
    transientRetries: Math.max(0, options.transientRetries),
    replacementAttempts: Math.max(0, options.replacementAttempts ?? REPLACEMENT_ATTEMPTS_FALLBACK),
    rejectExactDuplicates: options.rejectExactDuplicates ?? true,
    rejectNearDuplicates: options.rejectNearDuplicates ?? false,
    nearDuplicateThreshold: options.nearDuplicateThreshold ?? 0,
    capabilities: {
      maxImagesPerRequest: Math.max(1, options.capabilities?.maxImagesPerRequest ?? MAX_IMAGES_PER_REQUEST_FALLBACK),
      supportsSeed: options.capabilities?.supportsSeed ?? false,
      supportsAsyncRecovery: options.capabilities?.supportsAsyncRecovery ?? false,
      supportsCancel: options.capabilities?.supportsCancel ?? false,
    },
  }
}

export function createInitialGenerationState(requestedCount: number): GenerationState {
  const n = Math.max(0, Math.floor(requestedCount))
  const slots: GenerationSlot[] = Array.from({ length: n }, (_, index) => ({
    index,
    status: 'pending',
    attempts: 0,
  }))
  return {
    requestedCount: n,
    slots,
    remoteRequests: [],
    replacementCount: 0,
    duplicateCount: 0,
    nearDuplicateCount: 0,
    providerFailureCount: 0,
    status: 'running',
  }
}

/** 兼容旧任务：没有 generationSlots 时，用 outputImages 长度构造只读状态（不写回）。 */
export function createLegacyGenerationState(outputImageCount: number): GenerationState {
  return createInitialGenerationState(outputImageCount)
}

function isRequestInFlight(status: RemoteGenerationRequest['status']): boolean {
  return status === 'created' || status === 'submitted' || status === 'running'
}

function slotCoveredByInFlight(state: GenerationState, slotIndex: number): boolean {
  if (
    state.slots[slotIndex] &&
    (state.slots[slotIndex].status === 'submitted' ||
      state.slots[slotIndex].status === 'running' ||
      state.slots[slotIndex].status === 'validating')
  ) {
    return true
  }
  return state.remoteRequests.some((req) => isRequestInFlight(req.status) && req.slotIndexes.includes(slotIndex))
}

/** 计算稳定且不同的 seed，支持同一槽位恢复复现、不同槽位不会撞 seed。 */
export function computeSeed(taskId: string, slotIndex: number, attempt: number): number {
  const input = `${taskId}:${slotIndex}:${attempt}`
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * 规划下一轮要发出的请求。
 * - 首轮（尚无任何远端请求）：按 maxImagesPerRequest 批量拆分，每个请求对应连续槽位。
 * - 补偿轮次：每个缺图 / 重复槽位单独成 n=1 请求，精确对应某个槽位，可独立恢复。
 * 已处于在途请求覆盖下的槽位不会被重复规划。
 */
export function planNextRequests(state: GenerationState, policy: GenerationPolicy): PlannedRequest[] {
  const candidateSlots = state.slots.filter(
    (slot) => slot.status === 'pending' && !slotCoveredByInFlight(state, slot.index),
  )

  if (state.remoteRequests.length === 0) {
    const perRequest = Math.max(1, policy.capabilities.maxImagesPerRequest)
    const requests: PlannedRequest[] = []
    for (let i = 0; i < candidateSlots.length; i += perRequest) {
      const group = candidateSlots.slice(i, i + perRequest)
      requests.push({
        slotIndexes: group.map((slot) => slot.index),
        count: group.length,
        attempt: 0,
        reason: 'initial',
      })
    }
    return requests
  }

  // 补偿：每个候选槽位一个 n=1 请求。
  const requests: PlannedRequest[] = []
  for (const slot of candidateSlots) {
    // 已调度次数达到上限（首轮 1 + 补偿 replacementAttempts）则跳过，由 markExhaustedSlots 标失败。
    if (slot.attempts >= 1 + policy.replacementAttempts) continue
    requests.push({
      slotIndexes: [slot.index],
      count: 1,
      attempt: slot.attempts,
      reason: 'replacement',
    })
  }
  return requests
}

/**
 * 把"已用尽补偿预算但仍未完成的 pending 槽位"标记为 failed。
 * 应在 planNextRequests 之前调用，使完成判定进入 partial-failure。
 * 失败原因优先透传该槽位最近一次请求的真实错误消息（applyRequestFailure 存入 errorMessage），
 * 没有时回退到兜底文案。
 */
export function markExhaustedSlots(state: GenerationState, policy: GenerationPolicy): GenerationState {
  let changed = false
  const slots = state.slots.map((slot) => {
    if (
      slot.status === 'pending' &&
      !slotCoveredByInFlight(state, slot.index) &&
      slot.attempts >= 1 + policy.replacementAttempts
    ) {
      changed = true
      const lastFailure = state.remoteRequests
        .filter((req) => req.slotIndexes.includes(slot.index) && req.errorMessage)
        .at(-1)
      return {
        ...slot,
        status: 'failed' as const,
        error: lastFailure?.errorMessage ?? '补偿次数已用尽，无法补齐该图片',
      }
    }
    return slot
  })
  return changed ? { ...state, slots } : state
}

/** 持久化一次远端请求的提交（已获得 request id 或刚创建）。 */
export function applyRemoteRequestSubmitted(
  state: GenerationState,
  planned: PlannedRequest,
  submission: RemoteRequestSubmission,
  now: number = Date.now(),
): GenerationState {
  const existing = state.remoteRequests.find((req) => req.id === submission.id)
  let remoteRequests: RemoteGenerationRequest[]
  let slots = state.slots
  if (existing) {
    remoteRequests = state.remoteRequests.map((req) =>
      req.id === submission.id
        ? {
            ...req,
            provider: submission.provider,
            endpoint: submission.endpoint ?? req.endpoint,
            remoteRequestId: submission.remoteRequestId ?? req.remoteRequestId,
            status: 'submitted',
            updatedAt: now,
          }
        : req,
    )
  } else {
    const request: RemoteGenerationRequest = {
      id: submission.id,
      provider: submission.provider,
      endpoint: submission.endpoint,
      remoteRequestId: submission.remoteRequestId,
      slotIndexes: [...planned.slotIndexes],
      requestedCount: planned.count,
      attempt: planned.attempt,
      status: 'submitted',
      createdAt: now,
      updatedAt: now,
    }
    remoteRequests = [...state.remoteRequests, request]
    slots = state.slots.map((slot) => {
      if (planned.slotIndexes.includes(slot.index) && slot.status === 'pending') {
        return { ...slot, status: 'submitted' as const, attempts: slot.attempts + 1 }
      }
      return slot
    })
  }
  const replacementCount =
    !existing && planned.reason === 'replacement' ? state.replacementCount + 1 : state.replacementCount
  return { ...state, remoteRequests, slots, replacementCount }
}

/**
 * 去重分类：给定一张图的指纹，判断它相对于已接受图片是否属于重复。
 * extraAccepted 用于同一批次内已经接受、但尚未写回 state 的图片（避免批内互判重复）。
 * 返回 'accepted' | 'exact-duplicate' | 'near-duplicate'。
 */
export function classifyImageAgainstState(
  state: GenerationState,
  contentHash: string,
  perceptualHash: string | undefined,
  policy: GenerationPolicy,
  extraAccepted: ImageFingerprintLike[] = [],
): 'accepted' | 'exact-duplicate' | 'near-duplicate' {
  const matches = (h: ImageFingerprintLike): 'exact-duplicate' | 'near-duplicate' | null => {
    if (policy.rejectExactDuplicates && h.contentHash && contentHash && h.contentHash === contentHash) {
      return 'exact-duplicate'
    }
    if (policy.rejectExactDuplicates && h.perceptualHash && perceptualHash && h.perceptualHash === perceptualHash) {
      return 'exact-duplicate'
    }
    if (
      policy.rejectNearDuplicates &&
      h.perceptualHash &&
      perceptualHash &&
      areNearDuplicates(h.perceptualHash, perceptualHash, policy.nearDuplicateThreshold)
    ) {
      return 'near-duplicate'
    }
    return null
  }

  for (const slot of state.slots) {
    if (slot.status !== 'done') continue
    const result = matches({ contentHash: slot.contentHash, perceptualHash: slot.perceptualHash })
    if (result) return result
  }
  for (const h of extraAccepted) {
    const result = matches(h)
    if (result) return result
  }
  return 'accepted'
}

/** 提交供应商返回的结果：只接受调用方确认通过校验、并已 commit 的图片。 */
export function applyProviderResult(
  state: GenerationState,
  requestId: string,
  assignments: SlotAssignment[],
  rejected?: { slotIndexes: number[]; kind: 'exact-duplicate' | 'near-duplicate' },
): GenerationState {
  const request = state.remoteRequests.find((req) => req.id === requestId)
  if (!request) return state // 幂等：未知请求直接忽略

  const assignmentBySlot = new Map<number, SlotAssignment>()
  for (const assignment of assignments) {
    if (request.slotIndexes.includes(assignment.slotIndex)) {
      assignmentBySlot.set(assignment.slotIndex, assignment)
    }
  }

  const rejectedSet = new Set(rejected?.slotIndexes ?? [])
  let duplicateCount = state.duplicateCount
  let nearDuplicateCount = state.nearDuplicateCount
  if (rejected?.kind === 'exact-duplicate') duplicateCount += rejected.slotIndexes.length
  if (rejected?.kind === 'near-duplicate') nearDuplicateCount += rejected.slotIndexes.length

  const slots = state.slots.map((slot) => {
    if (slot.status === 'done') return slot // 幂等：已完成的槽位不再覆盖
    if (!request.slotIndexes.includes(slot.index)) return slot
    const assignment = assignmentBySlot.get(slot.index)
    if (assignment) {
      return {
        ...slot,
        status: 'done' as const,
        outputImageId: assignment.imageId,
        contentHash: assignment.contentHash,
        perceptualHash: assignment.perceptualHash,
      }
    }
    // 未分配（供应商欠交付，或对应图片被去重拒绝）→ 回到 pending 等待补偿。
    // 已标记为 failed 的槽位保留失败状态。
    if (slot.status === 'failed') return slot
    return { ...slot, status: 'pending' as const }
  })

  const remoteRequests = state.remoteRequests.map((req) =>
    req.id === requestId ? { ...req, status: 'completed' as const, updatedAt: Date.now() } : req,
  )

  return { ...state, slots, remoteRequests, duplicateCount, nearDuplicateCount }
}

/**
 * 处理一次请求失败。错误分类决定后续动作：
 * - authentication / insufficient-balance：停止整个任务（error），对应槽位失败。
 * - moderation / invalid-input：对应槽位失败，不盲目重试。
 * - 其余（transient / rate-limit / result-missing / duplicate-result / unknown）：
 *     - 若已获得远端 request id：保留在途，交由恢复逻辑查询原请求（不重新提交）。
 *     - 否则：槽位回到 pending，等待 planNextRequests 补偿（受 replacementAttempts 预算约束）。
 * message 为供应商/网络层返回的真实错误消息；会在槽位失败或补偿用尽时透传给用户，
 * 避免「补偿次数已用尽」之类的兜底文案掩盖真实失败原因。
 */
export function applyRequestFailure(
  state: GenerationState,
  requestId: string,
  kind: GenerationErrorKind,
  message?: string,
): GenerationState {
  const request = state.remoteRequests.find((req) => req.id === requestId)
  if (!request) return state

  const stopKinds: GenerationErrorKind[] = ['authentication', 'insufficient-balance']
  const failSlotKinds: GenerationErrorKind[] = ['moderation', 'invalid-input', ...stopKinds]
  const requestErrorMessage = message?.trim() || undefined

  if (failSlotKinds.includes(kind)) {
    const slots = state.slots.map((slot) =>
      request.slotIndexes.includes(slot.index) && slot.status !== 'done'
        ? { ...slot, status: 'failed' as const, error: requestErrorMessage ?? errorKindToMessage(kind) }
        : slot,
    )
    const remoteRequests = state.remoteRequests.map((req) =>
      req.id === requestId
        ? {
            ...req,
            status: 'failed' as const,
            error: kind,
            ...(requestErrorMessage ? { errorMessage: requestErrorMessage } : {}),
            updatedAt: Date.now(),
          }
        : req,
    )
    const next: GenerationState = {
      ...state,
      slots,
      remoteRequests,
      providerFailureCount: state.providerFailureCount + 1,
    }
    if (stopKinds.includes(kind)) {
      return { ...next, status: 'error', error: requestErrorMessage ?? errorKindToMessage(kind) }
    }
    return next
  }

  // 已提交到供应商侧：保留在途，由恢复逻辑查询原请求，不重新提交。
  if (request.remoteRequestId) {
    const remoteRequests = state.remoteRequests.map((req) =>
      req.id === requestId
        ? {
            ...req,
            status: 'running' as const,
            error: kind,
            ...(requestErrorMessage ? { errorMessage: requestErrorMessage } : {}),
            updatedAt: Date.now(),
          }
        : req,
    )
    return { ...state, remoteRequests, providerFailureCount: state.providerFailureCount + 1 }
  }

  // 尚未提交：槽位回到 pending，等待下一轮补偿。
  const slots = state.slots.map((slot) =>
    request.slotIndexes.includes(slot.index) && slot.status !== 'done' && slot.status !== 'failed'
      ? { ...slot, status: 'pending' as const }
      : slot,
  )
  const remoteRequests = state.remoteRequests.map((req) =>
    req.id === requestId
      ? {
          ...req,
          status: 'failed' as const,
          error: kind,
          ...(requestErrorMessage ? { errorMessage: requestErrorMessage } : {}),
          updatedAt: Date.now(),
        }
      : req,
  )
  return { ...state, slots, remoteRequests, providerFailureCount: state.providerFailureCount + 1 }
}

/** 需要恢复（已有远端 id 且在途）的请求，用于崩溃 / 断网后重新查询结果。 */
export function getRecoverableRequests(state: GenerationState): RemoteGenerationRequest[] {
  return state.remoteRequests.filter((req) => Boolean(req.remoteRequestId) && isRequestInFlight(req.status))
}

/** 列出所有尚未结束的远端请求（供 UI / 诊断）。 */
export function getInFlightRequests(state: GenerationState): RemoteGenerationRequest[] {
  return state.remoteRequests.filter((req) => isRequestInFlight(req.status))
}

/** 完成判定：只有达到 N/N，或无可补偿槽位且所有请求结束，才离开 running。 */
export function getBatchCompletion(state: GenerationState, policy: GenerationPolicy): BatchCompletion {
  const doneSlots = state.slots.filter((slot) => slot.status === 'done').length
  const failedSlots = state.slots.filter((slot) => slot.status === 'failed').length
  const inFlightRequests = getInFlightRequests(state).length
  const pendingSlots = state.slots.filter((slot) => slot.status === 'pending').length

  let status: GenerationBatchStatus = state.status
  if (state.status === 'cancelled') {
    status = 'cancelled'
  } else if (state.status === 'error') {
    status = 'error'
  } else if (doneSlots >= state.requestedCount) {
    status = 'done'
  } else if (pendingSlots === 0 && inFlightRequests === 0) {
    status = failedSlots > 0 ? 'partial-failure' : 'done'
  } else {
    status = 'running'
  }

  const remainingReplacementBudget = Math.max(
    0,
    1 + policy.replacementAttempts - Math.max(0, ...state.slots.map((slot) => slot.attempts), 0),
  )

  return {
    status,
    doneSlots,
    totalSlots: state.requestedCount,
    pendingSlots,
    failedSlots,
    inFlightRequests,
    remainingReplacementBudget,
  }
}

/** 用户取消：将在途请求标记为 cancelled，槽位不再补偿。 */
export function cancelGeneration(state: GenerationState): GenerationState {
  const remoteRequests = state.remoteRequests.map((req) =>
    isRequestInFlight(req.status) ? { ...req, status: 'cancelled' as const, updatedAt: Date.now() } : req,
  )
  return { ...state, remoteRequests, status: 'cancelled' }
}

/** 退避延迟（毫秒）：min(30000, 1000 * 2^attempt) + 抖动；429 优先使用服务端 Retry-After。 */
export function computeBackoffDelay(attempt: number, retryAfterMs?: number, jitter = 0): number {
  if (typeof retryAfterMs === 'number' && retryAfterMs > 0) {
    return Math.min(30_000, retryAfterMs) + jitter
  }
  const base = Math.min(30_000, 1000 * Math.pow(2, attempt))
  return base + jitter
}

export interface ClassifyErrorOptions {
  /** 已获得远端 request id（如 fal requestId / 自定义 taskId） */
  hasRemoteId?: boolean
  /** 是否在提交之后发生超时（此时应优先恢复原请求而非重新提交） */
  afterSubmitTimeout?: boolean
}

/**
 * 统一错误分类，决定重试 / 恢复 / 停止策略。
 * 调用方在"已获得远端 id 且提交后超时"时应传入 hasRemoteId + afterSubmitTimeout，
 * 将其归为 result-missing（触发恢复而非重新提交）。
 */
export function classifyGenerationError(err: unknown, options: ClassifyErrorOptions = {}): GenerationErrorKind {
  if (err instanceof DOMException && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
    return options.hasRemoteId ? 'result-missing' : 'transient'
  }
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  const lower = message.toLowerCase()
  const hasStatus = (code: number) => lower.includes(`status: ${code}`) || lower.includes(`${code}`)

  // 显式状态码
  if (hasStatus(401) || hasStatus(403)) return 'authentication'
  if (hasStatus(402)) return 'insufficient-balance'
  if (hasStatus(408)) return options.hasRemoteId ? 'result-missing' : 'transient'
  if (hasStatus(429)) return 'rate-limit'
  if (hasStatus(400) || hasStatus(422)) return 'invalid-input'
  if (hasStatus(409)) return 'result-missing'
  if (hasStatus(500) || hasStatus(502) || hasStatus(503) || hasStatus(504)) return 'transient'

  // 文本线索
  if (/moderat|content\s*policy|审查|敏感|安全策略|violat/i.test(message)) return 'moderation'
  if (/duplicate|重复|already\s*exists/i.test(message)) return 'duplicate-result'
  if (
    /network|fetch|econnreset|econnrefused|timeout|timed?\s*out|aborted|断开|连接失败|failed to fetch|socket/i.test(
      lower,
    )
  ) {
    return options.hasRemoteId && options.afterSubmitTimeout ? 'result-missing' : 'transient'
  }
  if (/api\s*key|unauthorized|token|鉴权|认证失败/i.test(lower)) return 'authentication'
  if (/balance|额度|余额|quota|credit/i.test(lower)) return 'insufficient-balance'
  if (/invalid|参数|param/i.test(lower)) return 'invalid-input'

  return 'unknown'
}

function errorKindToMessage(kind: GenerationErrorKind): string {
  switch (kind) {
    case 'authentication':
      return 'API Key 认证失败，已停止当前服务商任务'
    case 'insufficient-balance':
      return '账户余额不足，已停止当前服务商任务'
    case 'moderation':
      return '图片被内容审核拒绝，未自动重试'
    case 'invalid-input':
      return '请求参数错误，未重试'
    case 'rate-limit':
      return '触发限流（429），将自动退避重试'
    case 'result-missing':
      return '已获得远端请求 ID，正在恢复原请求结果'
    default:
      return '生成失败'
  }
}

export { errorKindToMessage }
