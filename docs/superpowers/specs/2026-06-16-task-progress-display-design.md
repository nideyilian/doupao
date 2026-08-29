# Task Progress Display Design

## Goal

Show clearer task progress in the existing task card and task detail modal.

The card should replace generic "生成中..." text with short, easy status words such as "发送请求中" or "中转站接收中". The detail modal should show a fuller explanation, including generated count and concrete failure reasons when generation fails or returns fewer images than requested.

## Scope

In scope:

- Existing gallery task card progress area in `src/components/TaskCard.tsx`.
- Existing task detail modal in `src/components/DetailModal.tsx`.
- Existing task generation flow in `src/store.ts`.
- Task type updates in `src/types.ts` if needed.
- A small display helper, likely `src/lib/taskProgressDisplay.ts`, with focused tests.
- Minimal store tests only where progress fields are written by generation flow.

Out of scope:

- New pages, new navigation, or a redesigned card/detail layout.
- Full provider-specific event streaming beyond what the current code already exposes.
- Backend/API changes.
- Refactoring unrelated task, image, or agent behavior.

## Assumptions

- The app already has enough events for useful progress: task creation, API call start, fal/custom async enqueue, partial image preview, output image append, final success, partial failure, and final error.
- Some providers do not expose detailed queue status. In those cases the UI should use honest fallback copy rather than pretending to know a hidden provider phase.
- Existing error strings are the source of truth for concrete failure reasons.
- Existing `batchItemStatuses` and `batchItemErrors` are the source of truth for "生成数量不够" and per-image failure reasons.

## Recommended Approach

Use a small, centralized progress display helper plus minimal persisted task progress fields.

Add optional task fields only for stages that cannot be reliably inferred later:

- `progressStage`: a compact machine-readable stage.
- `progressMessage`: optional detail text when a specific operation has useful wording.
- `progressUpdatedAt`: optional timestamp for diagnostics and future display.

Suggested stage values:

- `queued`: task created locally and waiting for API execution.
- `requesting`: sending the generation request.
- `relay-received`: provider or async relay accepted the task, such as fal queue request id or custom task id.
- `generating`: provider is generating.
- `previewing`: partial image preview received.
- `saving`: final images are being stored locally.
- `recovering`: connection broke but queued provider task can still be recovered.
- `completed`: task completed.
- `partial-failure`: task completed with fewer images than requested.
- `failed`: task failed.
- `stopped`: task was stopped or interrupted.

The helper should expose one function, for example:

```ts
getTaskProgressDisplay(task: TaskRecord): {
  cardLabel: string
  detailTitle: string
  detailDescription: string
  tone: 'running' | 'success' | 'warning' | 'error' | 'neutral'
  reasons: string[]
}
```

## Display Rules

### Card

The card should stay compact.

- Running without provider acknowledgment: `发送请求中`.
- Async provider accepted the task: `中转站接收中`.
- Partial preview or existing output while still running: `生成中`.
- Reconnect/recovery state: `重连查询中`.
- Partial failure with some outputs: `数量不够`.
- Full failure: `生成失败`.
- User stopped/interrupted: `已停止`.

Card copy should not show long raw error text. It can keep existing count badges where they already fit.

### Detail Modal

The detail modal should show a fuller "进度情况" block near the task information area, using the same helper.

Examples:

- `发送请求中`: "正在把请求发送给 默认 / gpt-image-1。"
- `中转站接收中`: "服务商已接收任务，正在等待生成结果。"
- `生成中`: "已生成 1 / 4 张，继续等待剩余图片。"
- `数量不够`: "请求 4 张，实际生成 2 张。未生成的图片原因：第 3 张：请求超时；第 4 张：内容被拒绝。"
- `生成失败`: "任务失败：API key 无效。"
- `已停止`: "任务已停止：请求中断。"

The detail block should use existing visual language: small heading, muted text, simple colored background when needed. It should not introduce a large card inside another card.

## Data Flow

Task creation:

- Create the task as `running`.
- Set progress stage to `queued` or `requesting` before `executeTask` starts.

API execution:

- Before `callImageApi`, set `requesting`.
- In `onFalRequestEnqueued`, set `relay-received` with fal request id already stored.
- In `onCustomTaskEnqueued`, set `relay-received` with custom task id already stored.
- In `onPartialImage`, set `previewing`.
- When appending generated images during batch execution, set `generating`.
- Before final `done` update, set `saving`.

Completion:

- For complete success, final helper can infer `completed` from `status: 'done'` without needing persisted stage.
- For partial batch failure, preserve `batchItemStatuses` and `batchItemErrors`; helper returns `partial-failure`.
- For hard error, preserve `error`; helper returns `failed` or `stopped`.
- For fal/custom recoverable errors, helper returns `recovering`.

## Error And Count Reasons

Generation failure reason:

- Prefer `task.error` when present.
- For interrupted/stopped tasks, use the existing stopped/interrupted text.
- If no message is available, use `生成失败：服务商没有返回具体原因。`

Insufficient count reason:

- Compare requested count from `task.params.n` or `batchItemStatuses.length` to successful count.
- Use `batchItemErrors` for per-index reasons.
- If batch status shows errors but no error text exists, use `服务商未返回具体原因。`

## Testing

Use TDD before production code.

Primary tests:

- `src/lib/taskProgressDisplay.test.ts`
  - running task with `requesting` returns card label `发送请求中`.
  - fal/custom enqueued task returns `中转站接收中`.
  - running task with outputs or stream preview stage returns `生成中`.
  - recoverable fal/custom error returns `重连查询中`.
  - partial failure returns `数量不够` and includes requested/success count.
  - hard failure returns `生成失败` and includes `task.error`.
  - stopped/interrupted error returns `已停止`.

Store tests, if implementation writes new progress fields:

- Submitting a task initializes progress.
- fal/custom enqueue callbacks write `relay-received`.
- partial image callback writes `previewing`.

Manual verification:

- Run targeted Vitest tests.
- Run `npm run build`.
- If a dev server is needed for visual verification, open the existing app and inspect one running or mocked state.

## Risks

- Some provider phases cannot be known precisely. The helper must use truthful fallback copy.
- Existing task text in several source files appears mojibake in terminal output, so edits should preserve actual UTF-8 content and avoid broad formatting changes.
- The store file is large; implementation should add small helper functions and localized patch points rather than refactoring generation flow.
- Existing worktree has unrelated modified files; implementation must avoid reverting or reformatting them.

## Acceptance Criteria

- A running task card shows a specific short progress label instead of only generic "生成中...".
- Clicking into the task shows a more detailed "进度情况" with stage, counts, and reasons.
- Failed tasks show a concrete reason when `task.error` or batch errors exist.
- Partial generation / insufficient count shows requested count, actual success count, and available per-image failure reasons.
- Existing retry, favorite, reuse, edit, delete, image preview, and batch count behaviors remain intact.
- New helper tests pass, relevant store tests pass, and the project build succeeds.
