# Schedule Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the weekly in-app schedule automation modal for favorite tasks, including runtime execution and output path handling.

**Architecture:** Put date math, due detection, and output path resolution in focused pure modules under `src/lib/` with tests. Store schedule rows/items in Zustand beside existing favorites and workspace tabs. UI stays in a new `ScheduleModal` component, while a small runtime scheduler component submits due items through the existing `submitTaskWithData` path.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest, Electron preload APIs, existing local save helpers.

---

### Task 1: Schedule Core Utilities

**Files:**
- Create: `src/lib/schedule.ts`
- Test: `src/lib/schedule.test.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/schedule.test.ts` with tests for:

```ts
import { describe, expect, it } from 'vitest'
import type { FavoriteCollection, ScheduleItem } from '../types'
import {
  createDefaultScheduleRows,
  formatDateKey,
  getWeekStartDate,
  isScheduledItemDue,
  resolveScheduleOutputTarget,
} from './schedule'

describe('schedule utilities', () => {
  it('calculates Monday week start and date keys', () => {
    expect(formatDateKey(getWeekStartDate(new Date(2026, 5, 18)))).toBe('2026-06-15')
    expect(formatDateKey(getWeekStartDate(new Date(2026, 5, 21)))).toBe('2026-06-15')
  })

  it('creates eight default rows', () => {
    expect(createDefaultScheduleRows()).toEqual([
      { id: 'row-1', name: '任务 1', order: 0 },
      { id: 'row-2', name: '任务 2', order: 1 },
      { id: 'row-3', name: '任务 3', order: 2 },
      { id: 'row-4', name: '任务 4', order: 3 },
      { id: 'row-5', name: '任务 5', order: 4 },
      { id: 'row-6', name: '任务 6', order: 5 },
      { id: 'row-7', name: '任务 7', order: 6 },
      { id: 'row-8', name: '任务 8', order: 7 },
    ])
  })

  it('detects due timed items once per day', () => {
    const item: ScheduleItem = {
      id: 'item-a',
      taskId: 'task-a',
      collectionId: 'collection-a',
      date: '2026-06-18',
      rowId: 'row-1',
      order: 0,
      count: 2,
      time: '09:30',
    }

    expect(isScheduledItemDue(item, new Date(2026, 5, 18, 9, 29))).toBe(false)
    expect(isScheduledItemDue(item, new Date(2026, 5, 18, 9, 30))).toBe(true)
    expect(isScheduledItemDue({ ...item, lastRunKey: '2026-06-18:item-a' }, new Date(2026, 5, 18, 10))).toBe(false)
  })

  it('resolves explicit output path before collection folder fallback', () => {
    const collections: FavoriteCollection[] = [
      { id: 'collection-a', name: '海报', createdAt: 1, updatedAt: 1 },
      { id: 'collection-b', name: '头像', createdAt: 1, updatedAt: 1 },
    ]

    expect(resolveScheduleOutputTarget({
      favoriteOutputPath: 'D:\\Exports\\Posters',
      collectionId: 'collection-a',
      taskCollectionIds: ['collection-b'],
      collections,
      defaultCollectionId: 'collection-b',
    })).toEqual({ path: 'D:\\Exports\\Posters' })

    expect(resolveScheduleOutputTarget({
      favoriteOutputPath: '',
      collectionId: 'collection-a',
      taskCollectionIds: ['collection-b'],
      collections,
      defaultCollectionId: 'collection-b',
    })).toEqual({ subFolder: '海报' })
  })
})
```

- [ ] **Step 2: Verify red**

Run: `npm test -- src/lib/schedule.test.ts`

Expected: FAIL because `src/lib/schedule.ts` and schedule types do not exist.

- [ ] **Step 3: Implement minimal types and utilities**

Add `ScheduleItem`, `ScheduleRow`, `ScheduleState`, and task output fields to `src/types.ts`. Add pure utility implementations to `src/lib/schedule.ts`.

- [ ] **Step 4: Verify green**

Run: `npm test -- src/lib/schedule.test.ts`

Expected: PASS.

---

### Task 2: Store Schedule State and Favorite Output Paths

**Files:**
- Modify: `src/store.ts`
- Test: `src/store.test.ts`

- [ ] **Step 1: Write failing store tests**

Add tests for:

```ts
it('persists default schedule rows in persisted state', () => {
  const persisted = getPersistedState(useStore.getState())
  expect(persisted.schedule.rows).toHaveLength(8)
})

it('adds a schedule item and clamps count to at least one', () => {
  useStore.setState({ schedule: { rows: createDefaultScheduleRows(), items: [], activeWeekStart: '2026-06-15', modalOpen: false } })
  const id = useStore.getState().addScheduleItem({ taskId: 'task-a', collectionId: 'collection-a', date: '2026-06-18', rowId: 'row-1', count: 0, time: null })
  expect(useStore.getState().schedule.items.find((item) => item.id === id)).toMatchObject({ count: 1, order: 0 })
})
```

- [ ] **Step 2: Verify red**

Run: `npm test -- src/store.test.ts`

Expected: FAIL because schedule store fields/actions do not exist.

- [ ] **Step 3: Implement schedule store actions**

Add `schedule`, `setScheduleModalOpen`, `setScheduleWeekStart`, `addScheduleRow`, `addScheduleItem`, `updateScheduleItem`, `removeScheduleItem`, and `updateTaskFavoriteOutputPath`. Include schedule state in persistence and merge defaults during migration.

- [ ] **Step 4: Verify green**

Run: `npm test -- src/store.test.ts`

Expected: PASS.

---

### Task 3: Scheduled Submission and Local Save Metadata

**Files:**
- Modify: `src/store.ts`
- Modify: `src/lib/localSave.ts`
- Test: `src/store.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests proving scheduled submit creates a task with `scheduledOutputPath` when the favorite has an explicit path and `scheduledOutputSubFolder` when it falls back to collection name.

- [ ] **Step 2: Verify red**

Run: `npm test -- src/store.test.ts`

Expected: FAIL because scheduled submission helper does not exist.

- [ ] **Step 3: Implement minimal scheduled submit**

Add `runScheduleItem(itemId, now?)` in store. It resolves the current favorite task, reconstructs stored input images via `getImage`, resolves output target, calls `submitTaskWithData` with count override and output metadata, and updates the schedule item status/run key.

- [ ] **Step 4: Update local save behavior**

Change `saveTaskImagesToLocalFS` and `saveTaskToLocalFS` to prefer `task.scheduledOutputPath` or `task.scheduledOutputSubFolder` before the existing workspace tab fallback.

- [ ] **Step 5: Verify green**

Run: `npm test -- src/store.test.ts`

Expected: PASS.

---

### Task 4: Schedule Modal UI

**Files:**
- Create: `src/components/ScheduleModal.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/WorkspaceTabBar.tsx`
- Modify: `src/components/icons.tsx`

- [ ] **Step 1: Add modal component**

Create a dense operational modal with week navigation, timetable, row add button, drag/drop cells, favorite collection filter, favorite cards, count/time controls, output path input, folder picker, and remove buttons.

- [ ] **Step 2: Add sidebar entry**

Add a bottom "日程表" button to `WorkspaceTabBar` that opens the modal via store action.

- [ ] **Step 3: Mount modal**

Lazy-load or directly mount `ScheduleModal` from `App.tsx`.

- [ ] **Step 4: Verify build**

Run: `npm run build`

Expected: PASS.

---

### Task 5: Runtime Scheduler

**Files:**
- Create: `src/components/ScheduleRunner.tsx`
- Modify: `src/App.tsx`
- Test: `src/lib/schedule.test.ts`

- [ ] **Step 1: Add due item selection tests**

Extend `src/lib/schedule.test.ts` with tests for timed ordering and untimed sequential progression.

- [ ] **Step 2: Verify red**

Run: `npm test -- src/lib/schedule.test.ts`

Expected: FAIL until selection helper exists.

- [ ] **Step 3: Implement runtime runner**

Add `getDueScheduleItemIds` in `src/lib/schedule.ts` and `ScheduleRunner` that checks every 30 seconds and calls `runScheduleItem` for due ids.

- [ ] **Step 4: Verify green and build**

Run: `npm test -- src/lib/schedule.test.ts && npm run build`

Expected: PASS.

---

### Task 6: Final Verification

**Files:**
- All touched implementation files.

- [ ] **Step 1: Run focused tests**

Run: `npm test -- src/lib/schedule.test.ts src/store.test.ts`

Expected: PASS.

- [ ] **Step 2: Run full build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 3: Manual smoke test**

Start dev server with `npm run dev`, open the app, verify the sidebar button opens the modal, favorite cards drag into the grid, output path input updates task state, and due detection can be triggered with near-current times.
