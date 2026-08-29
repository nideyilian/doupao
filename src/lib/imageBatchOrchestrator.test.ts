import { describe, expect, it } from 'vitest'
import {
  applyProviderResult,
  applyRemoteRequestSubmitted,
  applyRequestFailure,
  cancelGeneration,
  classifyGenerationError,
  classifyImageAgainstState,
  computeBackoffDelay,
  computeSeed,
  createGenerationPolicy,
  createInitialGenerationState,
  getBatchCompletion,
  getRecoverableRequests,
  markExhaustedSlots,
  planNextRequests,
  type GenerationErrorKind,
  type GenerationState,
  type PlannedRequest,
  type RemoteRequestSubmission,
} from './imageBatchOrchestrator'
import type { GenerationSlot } from '../types'

function policy(overrides: Partial<Parameters<typeof createGenerationPolicy>[1]> = {}) {
  return createGenerationPolicy(10, {
    maxConcurrent: 3,
    transientRetries: 2,
    replacementAttempts: 2,
    capabilities: { maxImagesPerRequest: 4, supportsSeed: false, supportsAsyncRecovery: true, supportsCancel: false },
    ...overrides,
  })
}

function submit(
  state: GenerationState,
  planned: PlannedRequest,
  submission: Partial<RemoteRequestSubmission> & { id: string },
): GenerationState {
  return applyRemoteRequestSubmitted(state, planned, {
    id: submission.id,
    provider: submission.provider ?? 'fal',
    endpoint: submission.endpoint,
    remoteRequestId: submission.remoteRequestId,
  })
}

function doneIds(state: GenerationState): (string | undefined)[] {
  return state.slots
    .filter((s) => s.status === 'done')
    .sort((a, b) => a.index - b.index)
    .map((s) => s.outputImageId)
}

describe('createInitialGenerationState', () => {
  it('creates one pending slot per requested image', () => {
    const state = createInitialGenerationState(10)
    expect(state.slots).toHaveLength(10)
    expect(state.slots.every((s) => s.status === 'pending' && s.attempts === 0)).toBe(true)
    expect(state.status).toBe('running')
  })
})

describe('planNextRequests', () => {
  it('splits the first round by maxImagesPerRequest', () => {
    const state = createInitialGenerationState(10)
    const requests = planNextRequests(state, policy())
    // 10 / 4 -> [0-3],[4-7],[8-9]
    expect(requests).toHaveLength(3)
    expect(requests[0].slotIndexes).toEqual([0, 1, 2, 3])
    expect(requests[1].slotIndexes).toEqual([4, 5, 6, 7])
    expect(requests[2].slotIndexes).toEqual([8, 9])
    expect(requests.every((r) => r.reason === 'initial' && r.attempt === 0)).toBe(true)
  })

  it('schedules missing slots as n=1 replacement requests', () => {
    // 单请求拿到 7 张，剩 3 个空槽位
    let state = createInitialGenerationState(10)
    const p = policy({
      capabilities: {
        maxImagesPerRequest: 10,
        supportsSeed: false,
        supportsAsyncRecovery: true,
        supportsCancel: false,
      },
    })
    const planned = planNextRequests(state, p)
    expect(planned).toHaveLength(1)
    state = submit(state, planned[0], { id: 'r0', remoteRequestId: 'fal-0' })
    const assignments = [0, 1, 2, 3, 4, 5, 6].map((i) => ({
      slotIndex: i,
      imageId: `img${i}`,
      contentHash: `h${i}`,
    }))
    state = applyProviderResult(state, 'r0', assignments)

    expect(state.slots.filter((s) => s.status === 'done')).toHaveLength(7)
    const comps = planNextRequests(state, p)
    expect(comps).toHaveLength(3)
    expect(comps.every((r) => r.count === 1 && r.reason === 'replacement')).toBe(true)
    expect(comps.map((r) => r.slotIndexes[0]).sort((a, b) => a - b)).toEqual([7, 8, 9])
  })

  it('does not re-plan slots already covered by an in-flight request', () => {
    let state = createInitialGenerationState(3)
    const p = policy({
      capabilities: { maxImagesPerRequest: 1, supportsSeed: false, supportsAsyncRecovery: true, supportsCancel: false },
    })
    const planned = planNextRequests(state, p)
    expect(planned).toHaveLength(3)
    state = submit(state, planned[0], { id: 'r0', remoteRequestId: 'fal-0' })
    const next = planNextRequests(state, p)
    expect(next.length).toBe(2) // 仅 slot 1,2 待规划
    expect(next.every((r) => !r.slotIndexes.includes(0))).toBe(true) // slot 0 已被覆盖
  })
})

describe('scenario: a request returns more than expected', () => {
  it('only accepts images for its own slots', () => {
    let state = createInitialGenerationState(3)
    const p = policy({
      capabilities: {
        maxImagesPerRequest: 3,
        supportsSeed: false,
        supportsAsyncRecovery: false,
        supportsCancel: false,
      },
    })
    const planned = planNextRequests(state, p)
    state = submit(state, planned[0], { id: 'r0' })
    // 供应商返回 5 张，但本请求只负责 3 个槽位
    const extra = [0, 1, 2, 3, 4].map((i) => ({
      slotIndex: i,
      imageId: `img${i}`,
      contentHash: `h${i}`,
    }))
    state = applyProviderResult(state, 'r0', extra)
    const done = state.slots.filter((s) => s.status === 'done')
    expect(done).toHaveLength(3)
    expect(done.map((s) => s.index).sort((a, b) => a - b)).toEqual([0, 1, 2])
    // 超出本请求负责范围的槽位（3,4）不会被 applyProviderResult 改动
    expect(state.slots).toHaveLength(3)
  })
})

describe('scenario: duplicate image returned twice', () => {
  it('only accepts the first occurrence', () => {
    const state = createInitialGenerationState(2)
    const p = policy()
    // 两个槽位都映射到同一张图（相同 contentHash）
    const kind1 = classifyImageAgainstState(state, 'same-hash', 'phash', p)
    expect(kind1).toBe('accepted')
    const next: GenerationState = {
      ...state,
      slots: state.slots.map((s, i) =>
        i === 0
          ? { ...s, status: 'done', outputImageId: 'img0', contentHash: 'same-hash', perceptualHash: 'phash' }
          : s,
      ),
    }
    const kind2 = classifyImageAgainstState(next, 'same-hash', 'phash', p)
    expect(kind2).toBe('exact-duplicate')
  })
})

describe('scenario: re-encoded but pixel-identical image', () => {
  it('treats different data URL metadata with identical bytes as duplicate', async () => {
    const { computeContentHash } = await import('./imageFingerprint')
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]) // 任意字节
    const toDataUrl = (mime: string) => {
      let bin = ''
      for (const b of bytes) bin += String.fromCharCode(b)
      return `data:${mime};base64,${btoa(bin)}`
    }
    const h1 = await computeContentHash(toDataUrl('image/png'))
    const h2 = await computeContentHash(toDataUrl('application/octet-stream'))
    expect(h1).toBe(h2) // 解码后字节一致 -> SHA-256 一致 -> 视为重复
  })
})

describe('scenario: concurrent out-of-order completion keeps slot order', () => {
  it('output images are ordered by slot index regardless of completion order', () => {
    let state = createInitialGenerationState(4)
    const p = policy({
      capabilities: {
        maxImagesPerRequest: 2,
        supportsSeed: false,
        supportsAsyncRecovery: false,
        supportsCancel: false,
      },
    })
    const planned = planNextRequests(state, p)
    expect(planned).toHaveLength(2)
    const [b0, b1] = planned
    state = submit(state, b0, { id: 'r0' })
    state = submit(state, b1, { id: 'r1' })
    // 乱序完成：先完成 b1（槽位 2,3），再完成 b0（槽位 0,1）
    state = applyProviderResult(state, 'r1', [
      { slotIndex: 2, imageId: 'img2', contentHash: 'h2' },
      { slotIndex: 3, imageId: 'img3', contentHash: 'h3' },
    ])
    state = applyProviderResult(state, 'r0', [
      { slotIndex: 0, imageId: 'img0', contentHash: 'h0' },
      { slotIndex: 1, imageId: 'img1', contentHash: 'h1' },
    ])
    expect(doneIds(state)).toEqual(['img0', 'img1', 'img2', 'img3'])
  })
})

describe('scenario: 429 retries, moderation does not', () => {
  it('classifies 429 as rate-limit and moderation message as moderation', () => {
    const kind429 = classifyGenerationError(new Error('status: 429 Too Many Requests'))
    expect(kind429).toBe('rate-limit')
    const kindMod = classifyGenerationError(new Error('图片被内容审核拒绝 (moderation)'))
    expect(kindMod).toBe('moderation')
  })

  it('keeps slot pending on rate-limit, marks slot failed on moderation', () => {
    let state = createInitialGenerationState(1)
    const p = policy({
      capabilities: {
        maxImagesPerRequest: 1,
        supportsSeed: false,
        supportsAsyncRecovery: false,
        supportsCancel: false,
      },
    })
    const planned = planNextRequests(state, p)
    state = submit(state, planned[0], { id: 'r0' })
    state = applyRequestFailure(state, 'r0', 'rate-limit')
    expect(state.slots[0].status).toBe('pending') // 可补偿
    expect(state.remoteRequests[0].status).toBe('failed')

    let state2 = createInitialGenerationState(1)
    const planned2 = planNextRequests(state2, p)
    state2 = submit(state2, planned2[0], { id: 'r1' })
    state2 = applyRequestFailure(state2, 'r1', 'moderation')
    expect(state2.slots[0].status).toBe('failed')
  })
})

describe('scenario: timeout after remote id prefers recovery over resubmit', () => {
  it('keeps the request in-flight for recovery instead of rescheduling', () => {
    let state = createInitialGenerationState(10)
    const p = policy({
      capabilities: {
        maxImagesPerRequest: 10,
        supportsSeed: false,
        supportsAsyncRecovery: true,
        supportsCancel: false,
      },
    })
    const planned = planNextRequests(state, p)
    state = submit(state, planned[0], { id: 'r0', remoteRequestId: 'fal-abc' })
    const timeoutErr = new Error('status: 408 Request Timeout')
    const kind = classifyGenerationError(timeoutErr, { hasRemoteId: true, afterSubmitTimeout: true })
    expect(kind).toBe('result-missing')
    state = applyRequestFailure(state, 'r0', kind)
    // 请求保持在途，由恢复逻辑查询原请求
    expect(state.remoteRequests[0].status).toBe('running')
    expect(state.remoteRequests[0].remoteRequestId).toBe('fal-abc')
    expect(getRecoverableRequests(state)).toHaveLength(1)
    // 槽位不会被立即重新规划
    expect(planNextRequests(state, p)).toHaveLength(0)
  })
})

describe('scenario: single slot exhausts replacement budget', () => {
  it('marks the slot failed and reports partial-failure', () => {
    const p = policy({
      replacementAttempts: 2,
      capabilities: {
        maxImagesPerRequest: 1,
        supportsSeed: false,
        supportsAsyncRecovery: false,
        supportsCancel: false,
      },
    })
    let state = createInitialGenerationState(1)
    for (let round = 0; round < 3; round++) {
      const planned = planNextRequests(state, p)
      expect(planned).toHaveLength(1)
      state = submit(state, planned[0], { id: `r${round}` })
      state = applyRequestFailure(state, `r${round}`, 'transient') // 无远端 id -> 回到 pending
    }
    // 3 次调度（首轮 + 2 补偿）后预算耗尽
    expect(state.slots[0].attempts).toBe(3)
    state = markExhaustedSlots(state, p)
    expect(state.slots[0].status).toBe('failed')
    const completion = getBatchCompletion(state, p)
    expect(completion.status).toBe('partial-failure')
    expect(completion.doneSlots).toBe(0)
    expect(completion.failedSlots).toBe(1)
  })
})

describe('scenario: real failure message is surfaced instead of fallback copy', () => {
  it('passes the raw message through on non-retryable failures', () => {
    const p = policy({
      capabilities: {
        maxImagesPerRequest: 1,
        supportsSeed: false,
        supportsAsyncRecovery: false,
        supportsCancel: false,
      },
    })
    let state = createInitialGenerationState(1)
    const planned = planNextRequests(state, p)
    state = submit(state, planned[0], { id: 'r0' })
    state = applyRequestFailure(state, 'r0', 'invalid-input', 'HTTP 400: image[] is not accepted by this endpoint')
    expect(state.slots[0].status).toBe('failed')
    expect(state.slots[0].error).toBe('HTTP 400: image[] is not accepted by this endpoint')
    expect(state.remoteRequests[0].error).toBe('invalid-input')
    expect(state.remoteRequests[0].errorMessage).toBe('HTTP 400: image[] is not accepted by this endpoint')
  })

  it('uses the last real failure message when the replacement budget is exhausted', () => {
    const p = policy({
      replacementAttempts: 1,
      capabilities: {
        maxImagesPerRequest: 1,
        supportsSeed: false,
        supportsAsyncRecovery: false,
        supportsCancel: false,
      },
    })
    let state = createInitialGenerationState(1)
    for (let round = 0; round < 2; round++) {
      const planned = planNextRequests(state, p)
      state = submit(state, planned[0], { id: `r${round}` })
      state = applyRequestFailure(state, `r${round}`, 'transient', `Failed to fetch (round ${round})`)
    }
    state = markExhaustedSlots(state, p)
    expect(state.slots[0].status).toBe('failed')
    // 最近一次失败的真实消息优先于兜底文案
    expect(state.slots[0].error).toBe('Failed to fetch (round 1)')
  })

  it('keeps the fallback copy when no raw message was recorded', () => {
    const p = policy({
      replacementAttempts: 0,
      capabilities: {
        maxImagesPerRequest: 1,
        supportsSeed: false,
        supportsAsyncRecovery: false,
        supportsCancel: false,
      },
    })
    let state = createInitialGenerationState(1)
    const planned = planNextRequests(state, p)
    state = submit(state, planned[0], { id: 'r0' })
    state = applyRequestFailure(state, 'r0', 'unknown')
    state = markExhaustedSlots(state, p)
    expect(state.slots[0].error).toBe('补偿次数已用尽，无法补齐该图片')
  })

  it('keeps a failed slot error intact when a later request covers the same slot', () => {
    const p = policy({
      replacementAttempts: 0,
      capabilities: {
        maxImagesPerRequest: 1,
        supportsSeed: false,
        supportsAsyncRecovery: false,
        supportsCancel: false,
      },
    })
    let state = createInitialGenerationState(1)
    const planned = planNextRequests(state, p)
    state = submit(state, planned[0], { id: 'r0' })
    state = applyRequestFailure(state, 'r0', 'moderation', '图片被内容审核拒绝')
    // 已 failed 的槽位不会被后续 pending 状态覆盖
    const planned2 = planNextRequests(state, p)
    expect(planned2).toHaveLength(0)
    expect(state.slots[0].status).toBe('failed')
    expect(state.slots[0].error).toBe('图片被内容审核拒绝')
  })
})

describe('scenario: user cancel stops compensation', () => {
  it('no replacement requests are planned after cancel', () => {
    const p = policy({
      capabilities: {
        maxImagesPerRequest: 10,
        supportsSeed: false,
        supportsAsyncRecovery: false,
        supportsCancel: false,
      },
    })
    let state = createInitialGenerationState(10)
    const planned = planNextRequests(state, p)
    state = submit(state, planned[0], { id: 'r0' }) // 只提交，不完成
    state = cancelGeneration(state)
    expect(state.status).toBe('cancelled')
    expect(state.remoteRequests[0].status).toBe('cancelled')
    expect(planNextRequests(state, p)).toHaveLength(0)
    expect(getBatchCompletion(state, p).status).toBe('cancelled')
  })
})

describe('scenario: legacy task without slots', () => {
  it('does not crash and reports done when done equals total', () => {
    const p = policy()
    const state = createInitialGenerationState(5)
    const completion = getBatchCompletion(state, p)
    expect(completion.status).toBe('running')
    expect(completion.pendingSlots).toBe(5)
  })
})

describe('idempotency', () => {
  it('applying the same provider result twice does not double-accept', () => {
    let state = createInitialGenerationState(2)
    const p = policy({
      capabilities: {
        maxImagesPerRequest: 2,
        supportsSeed: false,
        supportsAsyncRecovery: false,
        supportsCancel: false,
      },
    })
    const planned = planNextRequests(state, p)
    state = submit(state, planned[0], { id: 'r0' })
    const assignments = [
      { slotIndex: 0, imageId: 'img0', contentHash: 'h0' },
      { slotIndex: 1, imageId: 'img1', contentHash: 'h1' },
    ]
    state = applyProviderResult(state, 'r0', assignments)
    state = applyProviderResult(state, 'r0', assignments)
    expect(doneIds(state)).toEqual(['img0', 'img1'])
  })

  it('re-submitting the same request id is idempotent', () => {
    let state = createInitialGenerationState(2)
    const p = policy({
      capabilities: {
        maxImagesPerRequest: 2,
        supportsSeed: false,
        supportsAsyncRecovery: false,
        supportsCancel: false,
      },
    })
    const planned = planNextRequests(state, p)
    state = submit(state, planned[0], { id: 'r0', remoteRequestId: 'fal-0' })
    const before = state.remoteRequests.length
    state = submit(state, planned[0], { id: 'r0', remoteRequestId: 'fal-1' })
    expect(state.remoteRequests).toHaveLength(before) // 不重复创建
    expect(state.remoteRequests[0].remoteRequestId).toBe('fal-1')
  })
})

describe('computeSeed', () => {
  it('is stable per (taskId, slot, attempt) and differs across slots/attempts', () => {
    const a = computeSeed('task-1', 0, 0)
    expect(computeSeed('task-1', 0, 0)).toBe(a)
    expect(computeSeed('task-1', 1, 0)).not.toBe(a)
    expect(computeSeed('task-1', 0, 1)).not.toBe(a)
  })
})

describe('classifyImageAgainstState near duplicates', () => {
  it('always rejects an identical pHash and only rejects near pHashes when enabled', () => {
    const baseState = createInitialGenerationState(1)
    const doneState: GenerationState = {
      ...baseState,
      slots: baseState.slots.map((s, i) =>
        i === 0
          ? { ...s, status: 'done', outputImageId: 'x', contentHash: 'c0', perceptualHash: 'aaaaaaaaaaaaaaaa' }
          : s,
      ) as GenerationSlot[],
    }
    const rejectOff = policy({ rejectNearDuplicates: false, nearDuplicateThreshold: 4 })
    expect(classifyImageAgainstState(doneState, 'different', 'aaaaaaaaaaaaaaaa', rejectOff)).toBe('exact-duplicate')
    expect(classifyImageAgainstState(doneState, 'different', 'aaaaaaaaaaaaaaab', rejectOff)).toBe('accepted')
    const rejectOn = policy({ rejectNearDuplicates: true, nearDuplicateThreshold: 4 })
    expect(classifyImageAgainstState(doneState, 'different', 'aaaaaaaaaaaaaaab', rejectOn)).toBe('near-duplicate')
  })
})

describe('computeBackoffDelay', () => {
  it('grows exponentially and caps at 30s; Retry-After wins', () => {
    expect(computeBackoffDelay(0)).toBe(1000)
    expect(computeBackoffDelay(1)).toBe(2000)
    expect(computeBackoffDelay(20)).toBe(30_000)
    expect(computeBackoffDelay(1, 5000)).toBe(5000)
  })
})

describe('error classification matrix', () => {
  const cases: Array<[string, Partial<Parameters<typeof classifyGenerationError>[1]>, GenerationErrorKind]> = [
    ['408', {}, 'transient'],
    ['500', {}, 'transient'],
    ['503', {}, 'transient'],
    ['429', {}, 'rate-limit'],
    ['401', {}, 'authentication'],
    ['403', {}, 'authentication'],
    ['402', {}, 'insufficient-balance'],
    ['400', {}, 'invalid-input'],
    ['422', {}, 'invalid-input'],
    ['network error', {}, 'transient'],
    ['moderation blocked', {}, 'moderation'],
    ['duplicate image', {}, 'duplicate-result'],
    ['unknown boom', {}, 'unknown'],
  ]
  it.each(cases)('classifies %s', (msg, opts, expected) => {
    expect(classifyGenerationError(new Error(msg), opts)).toBe(expected)
  })
})
