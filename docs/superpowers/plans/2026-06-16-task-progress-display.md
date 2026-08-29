# Task Progress Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add clear task progress labels to task cards and detailed progress/reason text to the task detail modal.

**Architecture:** Add minimal optional progress fields to `TaskRecord`, then centralize display logic in `src/lib/taskProgressDisplay.ts`. Generation flow writes truthful phase updates at existing callback points, and React components render helper output without duplicating status rules.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest, Vite.

---

## File Structure

- Modify `src/types.ts`: add `TaskProgressStage` and optional progress fields on `TaskRecord`.
- Create `src/lib/taskProgressDisplay.ts`: pure mapping from `TaskRecord` to card/detail display text.
- Create `src/lib/taskProgressDisplay.test.ts`: focused unit tests for status wording and reason construction.
- Modify `src/store.ts`: add a local `updateTaskProgress` helper and call it at existing generation lifecycle points.
- Modify `src/store.test.ts`: add focused tests for submit initialization and progress callback updates where practical.
- Modify `src/components/TaskCard.tsx`: replace hardcoded running/failure labels with helper output.
- Modify `src/components/DetailModal.tsx`: add a compact "进度情况" block and reuse helper output in existing overlays.

## Task 1: Progress Display Helper

**Files:**
- Create: `src/lib/taskProgressDisplay.test.ts`
- Create: `src/lib/taskProgressDisplay.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Write failing helper tests**

Add tests covering:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { getTaskProgressDisplay } from './taskProgressDisplay'

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-a',
    prompt: 'prompt',
    params: { ...DEFAULT_PARAMS, n: 4 },
    inputImageIds: [],
    outputImages: [],
    status: 'running',
    error: null,
    createdAt: 1,
    finishedAt: null,
    elapsed: null,
    ...overrides,
  }
}

describe('getTaskProgressDisplay', () => {
  it('shows request progress for a running task before provider acknowledgment', () => {
    const display = getTaskProgressDisplay(task({ progressStage: 'requesting', apiProfileName: '默认', apiModel: 'gpt-image-1' }))
    expect(display.cardLabel).toBe('发送请求中')
    expect(display.detailDescription).toContain('默认 / gpt-image-1')
  })

  it('shows relay progress after an async provider accepts the task', () => {
    const display = getTaskProgressDisplay(task({ progressStage: 'relay-received', falRequestId: 'fal-1' }))
    expect(display.cardLabel).toBe('中转站接收中')
    expect(display.detailDescription).toContain('服务商已接收任务')
  })

  it('shows generating progress with current output count', () => {
    const display = getTaskProgressDisplay(task({ progressStage: 'previewing', outputImages: ['img-1'] }))
    expect(display.cardLabel).toBe('生成中')
    expect(display.detailDescription).toContain('已生成 1 / 4 张')
  })

  it('shows reconnect progress for recoverable provider errors', () => {
    const display = getTaskProgressDisplay(task({ status: 'error', error: '连接断开', falRecoverable: true }))
    expect(display.cardLabel).toBe('重连查询中')
    expect(display.detailDescription).toContain('之后会继续查询任务结果')
  })

  it('shows insufficient count and per-image reasons for partial failures', () => {
    const display = getTaskProgressDisplay(task({
      status: 'done',
      outputImages: ['img-1', 'img-2'],
      batchItemStatuses: ['done', 'done', 'error', 'error'],
      batchItemErrors: [
        { index: 2, error: '请求超时' },
        { index: 3, error: '内容被拒绝' },
      ],
      finishedAt: 2,
    }))
    expect(display.cardLabel).toBe('数量不够')
    expect(display.detailDescription).toContain('请求 4 张，实际生成 2 张')
    expect(display.reasons).toEqual(['第 3 张：请求超时', '第 4 张：内容被拒绝'])
  })

  it('shows concrete hard failure reason', () => {
    const display = getTaskProgressDisplay(task({ status: 'error', error: 'API key 无效' }))
    expect(display.cardLabel).toBe('生成失败')
    expect(display.detailDescription).toContain('API key 无效')
  })

  it('shows stopped label for interrupted tasks', () => {
    const display = getTaskProgressDisplay(task({ status: 'error', error: '请求中断' }))
    expect(display.cardLabel).toBe('已停止')
    expect(display.detailDescription).toContain('请求中断')
  })
})
```

- [ ] **Step 2: Run helper tests to verify RED**

Run: `npm test -- src/lib/taskProgressDisplay.test.ts`

Expected: fail because `src/lib/taskProgressDisplay.ts` does not exist.

- [ ] **Step 3: Add types and minimal helper implementation**

Add `TaskProgressStage` to `src/types.ts` and optional `progressStage`, `progressMessage`, `progressUpdatedAt` to `TaskRecord`.

Implement `src/lib/taskProgressDisplay.ts` with:

- `cardLabel`, `detailTitle`, `detailDescription`, `tone`, `reasons`.
- partial failure reason extraction from `batchItemStatuses` and `batchItemErrors`.
- stopped detection for `已停止生成。`, `请求中断`, and `任务已中止`.
- fallback detail strings when provider gives no reason.

- [ ] **Step 4: Run helper tests to verify GREEN**

Run: `npm test -- src/lib/taskProgressDisplay.test.ts`

Expected: all helper tests pass.

## Task 2: Store Progress Writes

**Files:**
- Modify: `src/store.test.ts`
- Modify: `src/store.ts`

- [ ] **Step 1: Add failing store tests**

Add tests near existing `mask draft lifecycle in store actions` because it already covers `submitTask`.

Test submit initialization:

```ts
it('initializes task progress when submitting a gallery task', async () => {
  await submitTask()

  expect(useStore.getState().tasks[0]).toMatchObject({
    status: 'running',
    progressStage: 'queued',
  })
})
```

Test partial image callback by mocking `callImageApi` to call `onPartialImage` and return an image:

```ts
it('updates task progress when a partial image arrives', async () => {
  vi.mocked(callImageApi).mockImplementationOnce(async (opts) => {
    opts.onPartialImage?.({ image: 'data:image/png;base64,partial' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    return {
      images: ['data:image/png;base64,final'],
      actualParams: {},
      actualParamsList: [{}],
      revisedPrompts: [undefined],
    }
  })

  await submitTask()
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(useStore.getState().tasks[0].progressStage).toBe('previewing')
})
```

- [ ] **Step 2: Run store tests to verify RED**

Run: `npm test -- src/store.test.ts --runInBand`

Expected: new progress assertions fail.

- [ ] **Step 3: Implement progress writes**

In `src/store.ts`:

- Add `updateTaskProgress(taskId, progressStage, progressMessage?)`.
- Set new task `progressStage: 'queued'`.
- At `executeTask` start, call `updateTaskProgress(taskId, 'requesting')`.
- In `onFalRequestEnqueued` and `onCustomTaskEnqueued`, set `relay-received`.
- In `onPartialImage`, set `previewing`.
- In batch `storeBatchResult`, after appending outputs, set `generating`.
- Before final task update, set `saving`.
- In recoverable error branches, set `recovering`.
- In hard error branches, set `failed`.
- In partial success error branch, set `partial-failure`.

- [ ] **Step 4: Run store tests to verify GREEN**

Run: `npm test -- src/store.test.ts --runInBand`

Expected: store tests pass.

## Task 3: UI Integration

**Files:**
- Modify: `src/components/TaskCard.tsx`
- Modify: `src/components/DetailModal.tsx`

- [ ] **Step 1: Import helper and compute display**

In both components:

```ts
import { getTaskProgressDisplay } from '../lib/taskProgressDisplay'
```

Compute `const progressDisplay = getTaskProgressDisplay(task)` after derived status values are available.

- [ ] **Step 2: Replace card labels**

In `TaskCard.tsx`:

- Replace running text `生成中...` and running badge text `生成中` with `progressDisplay.cardLabel`.
- Replace reconnect/failure/partial labels with `progressDisplay.cardLabel` where appropriate.
- Keep existing spinner and count badges.
- Do not render long reasons in the card.

- [ ] **Step 3: Add detail progress block**

In `DetailModal.tsx`, add a compact block before the time section:

```tsx
<div className="mb-4 rounded-lg bg-gray-50 px-3 py-2 text-xs dark:bg-white/[0.03]">
  <div className="mb-1 text-gray-400 dark:text-gray-500">进度情况</div>
  <div className="font-medium text-gray-700 dark:text-gray-200">{progressDisplay.detailTitle}</div>
  <div className="mt-1 whitespace-pre-line leading-5 text-gray-500 dark:text-gray-400">
    {progressDisplay.detailDescription}
  </div>
  {progressDisplay.reasons.length > 0 && (
    <ul className="mt-2 space-y-1 text-gray-500 dark:text-gray-400">
      {progressDisplay.reasons.map((reason, index) => (
        <li key={index}>{reason}</li>
      ))}
    </ul>
  )}
</div>
```

Render the block for running, error, recoverable, and partial-failure states.

- [ ] **Step 4: Run TypeScript build**

Run: `npm run build`

Expected: build succeeds.

## Task 4: Final Verification

**Files:**
- No new code files unless verification exposes issues.

- [ ] **Step 1: Run focused tests**

Run: `npm test -- src/lib/taskProgressDisplay.test.ts src/store.test.ts`

Expected: focused tests pass.

- [ ] **Step 2: Run build**

Run: `npm run build`

Expected: TypeScript and Vite build pass.

- [ ] **Step 3: Inspect diff**

Run: `git diff -- src/types.ts src/lib/taskProgressDisplay.ts src/lib/taskProgressDisplay.test.ts src/store.ts src/store.test.ts src/components/TaskCard.tsx src/components/DetailModal.tsx`

Expected: diff only contains task progress display changes.
