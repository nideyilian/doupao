# Generated Image Batch Filenames Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every generated-image task card a stable daily batch number and include it in every generated image filename.

**Architecture:** Store the assigned batch on `TaskRecord`, calculate new batches from tasks already in the same workspace tab and local date, and backfill old records once during task hydration. Keep filename formatting pure so Electron saves, browser downloads, and ZIP entries continue sharing one policy.

**Tech Stack:** TypeScript, Zustand, IndexedDB, Vitest, Electron

---

### Task 1: Pure batch allocation and backfill

**Files:**
- Create: `src/lib/generatedImageBatch.ts`
- Create: `src/lib/generatedImageBatch.test.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Write failing allocation and backfill tests**

Create tests that use local timestamps and assert:

```ts
expect(getNextGeneratedImageBatch([
  { createdAt: july3Morning, filenameBatch: 1 },
  { createdAt: july3Noon, filenameBatch: 3 },
  { createdAt: july2, filenameBatch: 9 },
], july3Evening)).toBe(4)

expect(assignMissingGeneratedImageBatches([olderTask, newerTask], [kuaishouTab]))
  .tasks.map((task) => task.filenameBatch)
  .toEqual([1, 2])
```

Add cases proving separate tabs both start at `1`, the next local date restarts at `1`, valid persisted batches remain unchanged, missing batches are assigned after the group's current maximum, and fallback-label tasks form independent groups.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest run src/lib/generatedImageBatch.test.ts
```

Expected: FAIL because `generatedImageBatch.ts` and `TaskRecord.filenameBatch` do not exist.

- [ ] **Step 3: Add the persisted task field**

Add to `TaskRecord` in `src/types.ts`:

```ts
/** Stable one-based batch within the task's local date and filename label scope. */
filenameBatch?: number
```

- [ ] **Step 4: Implement minimal pure helpers**

Create `src/lib/generatedImageBatch.ts` with:

```ts
import type { TaskRecord, WorkspaceTab } from '../types'
import { formatGeneratedImageDate } from './generatedImageFilename'

type BatchTask = Pick<TaskRecord, 'id' | 'createdAt' | 'filenameBatch' | 'scheduledOutputPath' | 'scheduledOutputSubFolder'>

export function normalizeGeneratedImageBatch(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

export function getNextGeneratedImageBatch(
  tasks: Pick<BatchTask, 'createdAt' | 'filenameBatch'>[],
  createdAt: number,
): number {
  const date = formatGeneratedImageDate(createdAt)
  return tasks.reduce((maximum, task) => {
    if (formatGeneratedImageDate(task.createdAt) !== date) return maximum
    return Math.max(maximum, normalizeGeneratedImageBatch(task.filenameBatch) ?? 0)
  }, 0) + 1
}

export function assignMissingGeneratedImageBatches(
  tasks: TaskRecord[],
  workspaceTabs: WorkspaceTab[],
): { tasks: TaskRecord[]; changedTaskIds: string[] } {
  const scopeByTaskId = new Map<string, string>()
  for (const tab of workspaceTabs) {
    for (const task of tab.tasks) {
      if (!scopeByTaskId.has(task.id)) scopeByTaskId.set(task.id, `tab:${tab.id}`)
    }
  }

  const groupKey = (task: BatchTask) => {
    const fallback = task.scheduledOutputSubFolder
      ?? getPathBaseName(task.scheduledOutputPath)
      ?? 'image'
    const scope = scopeByTaskId.get(task.id) ?? `fallback:${fallback}`
    return `${scope}\0${formatGeneratedImageDate(task.createdAt)}`
  }

  const maximumByGroup = new Map<string, number>()
  for (const task of tasks) {
    const batch = normalizeGeneratedImageBatch(task.filenameBatch)
    if (!batch) continue
    const key = groupKey(task)
    maximumByGroup.set(key, Math.max(maximumByGroup.get(key) ?? 0, batch))
  }

  const assignedByTaskId = new Map<string, number>()
  const missing = tasks
    .filter((task) => !normalizeGeneratedImageBatch(task.filenameBatch))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))

  for (const task of missing) {
    const key = groupKey(task)
    const batch = (maximumByGroup.get(key) ?? 0) + 1
    maximumByGroup.set(key, batch)
    assignedByTaskId.set(task.id, batch)
  }

  return {
    tasks: tasks.map((task) => {
      const batch = assignedByTaskId.get(task.id)
      return batch ? { ...task, filenameBatch: batch } : task
    }),
    changedTaskIds: [...assignedByTaskId.keys()],
  }
}

function getPathBaseName(value?: string): string | null {
  if (!value) return null
  const parts = value.trim().replace(/[\\/]+$/, '').split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] || null
}
```

Keep the backfill implementation immutable: unchanged tasks retain object identity and only missing/invalid batches receive a copied record.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```powershell
npx vitest run src/lib/generatedImageBatch.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/types.ts src/lib/generatedImageBatch.ts src/lib/generatedImageBatch.test.ts
git commit -m "feat: add stable generated image batches"
```

### Task 2: Put batch and prompt in the approved filename order

**Files:**
- Modify: `src/lib/generatedImageFilename.ts`
- Modify: `src/lib/generatedImageFilename.test.ts`

- [ ] **Step 1: Change filename expectations first**

Add `batch: 2` to the shared test context and update the exact expectations:

```ts
expect(buildGeneratedImageFileNameBase(context, {
  imageFilenameDatePrefix: true,
  imageFilenameUsePrompt: false,
}, 1)).toBe('20260703-快手-2-1')

expect(buildGeneratedImageFileNameBase(context, {
  imageFilenameDatePrefix: true,
  imageFilenameUsePrompt: true,
}, 2)).toBe('20260703-快手-2-红色 海报-竖版-2')
```

Update sequence-continuation fixtures to match `date-label-batch[-prompt]-image.ext`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest run src/lib/generatedImageFilename.test.ts
```

Expected: FAIL because the builder omits the batch and places the prompt before it.

- [ ] **Step 3: Implement the approved ordering**

Extend `GeneratedImageFilenameContext`:

```ts
export interface GeneratedImageFilenameContext {
  createdAt: number
  label: string
  prompt: string
  batch: number
}
```

Build prefix parts in this exact order:

```ts
if (settings.imageFilenameDatePrefix) parts.push(formatGeneratedImageDate(context.createdAt))
parts.push(sanitizeGeneratedImageFilenamePart(context.label, 100) || 'image')
parts.push(String(Math.max(1, Math.trunc(context.batch))))
if (settings.imageFilenameUsePrompt) {
  const prompt = sanitizeGeneratedImageFilenamePart(context.prompt, 100)
  if (prompt) parts.push(prompt)
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
npx vitest run src/lib/generatedImageFilename.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/generatedImageFilename.ts src/lib/generatedImageFilename.test.ts
git commit -m "feat: include task batch in generated filenames"
```

### Task 3: Assign batches when task cards are created

**Files:**
- Modify: `src/store.ts`
- Modify: `src/store.test.ts`

- [ ] **Step 1: Write failing task-creation tests**

Using fake local time, create two tasks in one workspace tab and one task in a second tab. Assert:

```ts
expect(kuaishouTasks.map((task) => task.filenameBatch)).toEqual([2, 1])
expect(xiaohongshuTasks[0].filenameBatch).toBe(1)
```

Advance fake time to the next local date and assert the next Kuaishou task receives `1`. Add a retry test proving the newly created retry card receives the next batch rather than copying the source card's batch.

- [ ] **Step 2: Run the focused store tests and verify RED**

Run:

```powershell
npx vitest run src/store.test.ts -t "generated image batch"
```

Expected: FAIL because created tasks have no `filenameBatch`.

- [ ] **Step 3: Add one store-local assignment helper**

In `src/store.ts`, add a small helper around `getNextGeneratedImageBatch`:

```ts
function getNextTaskFilenameBatch(createdAt: number, targetTabId: string | null, fallbackLabel = 'image') {
  const state = useStore.getState()
  const tab = targetTabId ? state.workspaceTabs.find((item) => item.id === targetTabId) : null
  if (tab) return getNextGeneratedImageBatch(tab.tasks, createdAt)

  const unownedTasks = state.tasks.filter((task) =>
    !state.workspaceTabs.some((item) => item.tasks.some((candidate) => candidate.id === task.id)) &&
    getTaskFilenameFallbackLabel(task) === fallbackLabel,
  )
  return getNextGeneratedImageBatch(unownedTasks, createdAt)
}

function getTaskFilenameFallbackLabel(task: TaskRecord): string {
  return task.scheduledOutputSubFolder
    ?? getDirectoryBaseName(task.scheduledOutputPath ?? '')
    ?? 'image'
}
```

For normal gallery submission, resolve the destination before constructing the task:

```ts
const state = useStore.getState()
const tabIdToUpdate = targetTabId ?? state.activeWorkspaceTabId ?? state.workspaceTabs[0]?.id ?? null
const createdAt = Date.now()
const filenameBatch = getNextTaskFilenameBatch(createdAt, tabIdToUpdate)
```

Set both `createdAt` and `filenameBatch` on the new record, and reuse `tabIdToUpdate` for insertion.

For retry, resolve `sourceTabId ?? activeWorkspaceTabId ?? workspaceTabs[0]?.id ?? null` before constructing `newTask`, then assign a fresh batch using the same two lines.

For each agent task constructor, use its existing creation timestamp and the fallback scope:

```ts
const createdAt = options.createdAt ?? Date.now()
const filenameBatch = getNextTaskFilenameBatch(createdAt, null, 'image')
```

Set those two values on the agent task record before inserting it into state. Updates, streaming completion, recovery, and additional images on an existing task do not call the helper and therefore cannot change its batch.

- [ ] **Step 4: Run the focused store tests and verify GREEN**

Run:

```powershell
npx vitest run src/store.test.ts -t "generated image batch"
```

Expected: PASS.

- [ ] **Step 5: Run all store tests**

Run:

```powershell
npx vitest run src/store.test.ts
```

Expected: PASS with no unhandled errors.

- [ ] **Step 6: Commit**

```powershell
git add src/store.ts src/store.test.ts
git commit -m "feat: assign image batches to new task cards"
```

### Task 4: Backfill and persist batches for existing task cards

**Files:**
- Modify: `src/store.ts`
- Modify: `src/store.test.ts`

- [ ] **Step 1: Write a failing hydration test**

Persist two same-day tasks without `filenameBatch`, restore both into one workspace tab, call `initStore()`, and assert:

```ts
expect(useStore.getState().workspaceTabs[0].tasks.map((task) => task.filenameBatch))
  .toEqual([2, 1])
expect((await getAllTasks()).map((task) => task.filenameBatch).sort())
  .toEqual([1, 2])
```

Delete the older task after hydration and assert the newer task remains batch `2`.

- [ ] **Step 2: Run the hydration test and verify RED**

Run:

```powershell
npx vitest run src/store.test.ts -t "backfills generated image batches"
```

Expected: FAIL because hydration does not assign or persist batches.

- [ ] **Step 3: Integrate backfill after workspace ownership is restored**

After both branches of `initStore()` reconstruct workspace tab task membership, ensure the `else` branch assigns `currentTabs = updatedTabs`, then run:

```ts
const backfill = assignMissingGeneratedImageBatches(tasks, currentTabs)
const taskById = new Map(backfill.tasks.map((task) => [task.id, task]))
const tabsWithBatches = currentTabs.map((tab) => ({
  ...tab,
  tasks: tab.tasks.map((task) => taskById.get(task.id) ?? task),
}))

useStore.setState({ tasks: backfill.tasks, workspaceTabs: tabsWithBatches })
if (backfill.changedTaskIds.length > 0) {
  const changedIds = new Set(backfill.changedTaskIds)
  await batchPutTasks(backfill.tasks.filter((task) => changedIds.has(task.id)))
}
```

Do this once after tab ownership is known. Do not change unrelated persisted-state migrations.

- [ ] **Step 4: Run hydration and full store tests**

Run:

```powershell
npx vitest run src/store.test.ts -t "backfills generated image batches"
npx vitest run src/store.test.ts
```

Expected: both commands PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/store.ts src/store.test.ts
git commit -m "feat: backfill image batches for existing tasks"
```

### Task 5: Use the stored batch for saves and downloads

**Files:**
- Modify: `src/store.ts`
- Modify: `src/store.test.ts`
- Modify: `src/lib/downloadImages.ts`
- Modify: `src/lib/downloadImages.test.ts`

- [ ] **Step 1: Write failing download expectations**

Set `filenameBatch` on download fixtures and expect:

```ts
[
  { imageId: 'a-1', fileNameBase: '20260703-快手-2-A prompt-1' },
  { imageId: 'a-2', fileNameBase: '20260703-快手-2-A prompt-2' },
]
```

Keep the filtered-image assertion on its original image position. Add a defensive legacy fixture without a batch and expect batch `1` until hydration persists its real value.

- [ ] **Step 2: Write a failing Electron save expectation**

Update the existing automatic-save test so a task with `filenameBatch: 2` expects exact names:

```ts
expect(saveImageToLocal).toHaveBeenNthCalledWith(
  1,
  task.id,
  0,
  expect.any(String),
  'png',
  '快手',
  undefined,
  '20260703-快手-2-1',
)
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```powershell
npx vitest run src/lib/downloadImages.test.ts src/store.test.ts -t "filename|generated image"
```

Expected: FAIL because filename contexts do not pass the stored batch.

- [ ] **Step 4: Pass the batch through shared filename contexts**

In `getGeneratedImageDownloadEntries` and `getTaskLocalFilenameState`, add:

```ts
batch: task.filenameBatch ?? 1
```

Do not add route-specific naming logic; all download and ZIP callers already consume the shared entries.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```powershell
npx vitest run src/lib/generatedImageFilename.test.ts src/lib/generatedImageBatch.test.ts src/lib/downloadImages.test.ts src/store.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/store.ts src/store.test.ts src/lib/downloadImages.ts src/lib/downloadImages.test.ts
git commit -m "feat: use task batches in saved image names"
```

### Task 6: Full verification

**Files:**
- Verify only

- [ ] **Step 1: Run the complete test suite**

```powershell
npm test
```

Expected: all tests PASS with no unhandled errors.

- [ ] **Step 2: Run the production build**

```powershell
npm run build
```

Expected: TypeScript and Vite build complete successfully.

- [ ] **Step 3: Check scope and whitespace**

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; only files named in this plan are changed.

- [ ] **Step 4: Review filename success criteria**

Confirm the tests contain exact assertions for:

```text
20260703-快手-1-1
20260703-快手-1-红色海报-1
20260703-快手-2-1
```

Also confirm same-card image continuation, per-tab isolation, local-date reset, deletion stability, legacy backfill, browser downloads, ZIP entries, and Electron automatic saves.
