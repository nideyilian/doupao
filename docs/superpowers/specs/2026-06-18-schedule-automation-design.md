# Schedule Automation Design

## Context

The app already has workspace tabs, favorite collections, task persistence, Electron folder selection, and a reusable task submission path through `submitTaskWithData`. The new feature should add a weekly schedule for favorite tasks without adding system-level background automation.

The scheduler only needs to run while the application process is alive. It should continue when the window is visible or minimized to the taskbar. It does not need to run after the application is closed.

## Goals

- Add a "Schedule" entry at the bottom of the workspace tab sidebar.
- Open a large modal from that entry.
- Show a week-based timetable with real dates for Monday through Sunday.
- Provide 8 default task rows and allow adding more rows.
- Show favorite task cards in the lower part of the modal.
- Allow dragging favorite task cards into timetable cells.
- Let each scheduled item set a generation count and an optional execution time.
- If an item has no execution time, run it after the previous untimed item in the same day and row completes.
- Add a reusable output directory field to favorite tasks.
- Use the favorite task's current parameters when a scheduled item runs.

## Non-Goals

- No execution while the app is closed.
- No OS-level scheduler, startup service, tray daemon, or persistent background worker.
- No recurrence beyond the visible weekly schedule in this feature pass.
- No broad refactor of task execution, favorite collection management, or workspace tab behavior.

## Data Model

Add these domain types in `src/types.ts`:

- `TaskRecord.favoriteOutputPath?: string`
  - A reusable output directory for favorite tasks.
  - Empty or missing means use the fallback collection folder rule.

- `TaskRecord.scheduledOutputPath?: string`
  - Captured on newly-created scheduled run tasks when an explicit favorite output path is used.
  - The local save layer uses this value for generated images from that run.

- `TaskRecord.scheduledOutputSubFolder?: string`
  - Captured on newly-created scheduled run tasks when the run falls back to a favorite collection name.
  - Existing non-scheduled runs keep using the workspace tab name fallback.

- `ScheduleItem`
  - `id: string`
  - `taskId: string`
  - `collectionId: string | null`
  - `date: string` in `YYYY-MM-DD`
  - `rowId: string`
  - `order: number`
  - `count: number`
  - `time: string | null` in `HH:mm`
  - `lastRunKey?: string`
  - `status?: 'idle' | 'queued' | 'running' | 'done' | 'error'`
  - `lastTaskIds?: string[]`
  - `lastError?: string`

- `ScheduleRow`
  - `id: string`
  - `name: string`
  - `order: number`

- `ScheduleState`
  - `rows: ScheduleRow[]`
  - `items: ScheduleItem[]`
  - `activeWeekStart: string`
  - `modalOpen: boolean`

Store this state in Zustand persistence beside the current favorite and workspace tab state. Default state creates 8 rows named "Task 1" through "Task 8" and sets `activeWeekStart` to the current Monday.

## Output Directory Rule

When a scheduled item runs, save generated images using this priority:

1. If the favorite task has `favoriteOutputPath`, save images directly under that directory.
2. Otherwise, save under the normal local save root using the source favorite collection name as the subfolder.
3. If the item was dragged from "All favorites", use the first collection assigned to that task.
4. If no collection can be resolved, use the default favorite collection name.

The source collection is captured on drop as `ScheduleItem.collectionId`, so later execution is deterministic.

## UI

### Sidebar Entry

In `WorkspaceTabBar`, add a bottom button labeled "Schedule" with a calendar-style icon. It should sit below the scrollable tab list so it remains reachable even with many tabs.

### Schedule Modal

Create `ScheduleModal` as a portal modal with these regions:

- Header:
  - Title "Schedule"
  - Current week range
  - Previous week, current week, next week controls
  - Close button

- Timetable:
  - Columns: task row label plus Monday through Sunday.
  - Day headers show weekday and date.
  - Rows default to 8 and can be added.
  - Cells accept dropped favorite cards.
  - Scheduled cards show task title/prompt summary, count, time or "sequential", and status.
  - Cards can be removed from the schedule.

- Favorite task card area:
  - Collection filter.
  - Favorite task cards from the selected collection.
  - Output directory field on each card.
  - Pasteable path input and folder picker button.

Keep the modal dense and operational rather than marketing-like. The table should prioritize scanning and repeated editing.

## Drag and Drop

Favorite cards should set a custom drag payload with:

- `taskId`
- `collectionId`

Drops into timetable cells create a `ScheduleItem` for that date and row. The item order is appended to the existing cell order. Dragging scheduled items between timetable cells is outside this first implementation pass; initial scope only requires favorite-to-cell drag.

## Execution Behavior

Add a small runtime scheduler component mounted from `App.tsx` in gallery mode, or globally if simpler.

Every 30 seconds:

1. Read schedule items for today.
2. Find timed items whose `HH:mm` is due and have not run for today's run key.
3. Submit due timed items in table order.
4. For untimed items, run the next item in a day and row only after the previous untimed item in that same group has completed.

The run key should include date and item id, such as `YYYY-MM-DD:itemId`, to prevent duplicate runs in one day.

When executing a scheduled item:

1. Resolve the current favorite task by `taskId`.
2. If missing or no longer favorite, mark item error and show a toast.
3. Build submit data from the current task:
   - `prompt`
   - current task input images, reconstructed from `inputImageIds` and IndexedDB image records
   - current task input folder when `inputImageFolderPath` is present and the image ids still exist
   - `params` with `n` overridden by `ScheduleItem.count`
   - mask draft reconstructed from `maskTargetImageId` and `maskImageId` when both image records still exist
4. Submit through `submitTaskWithData`.
5. Save resulting task ids back to the schedule item when possible.

The existing task execution and API settings remain the source of truth. The scheduler should not introduce a separate API queue.

## Local Save Changes

Extend local save helpers so task saving can accept an explicit output directory. Existing calls without an explicit directory keep current behavior.

Scheduled runs should attach enough metadata to the created task to determine the preferred output directory:

- `scheduledOutputPath` for explicit favorite output paths, or
- `scheduledOutputSubFolder` for fallback favorite collection folder names.

The save layer then uses that metadata instead of only deriving the subfolder from the containing workspace tab.

## Validation and Edge Cases

- Clamp count to at least 1.
- Prevent scheduling non-favorite or missing tasks.
- If output path selection is unavailable outside Electron, keep paste input enabled.
- If a pasted path is invalid or inaccessible, show an error when saving output and leave the task record intact.
- If the app starts after a scheduled time has passed on the same day, the item is due and should run once unless its run key is already recorded.
- If a previous untimed item errors, continue to the next untimed item after it reaches a terminal state. The failed item should keep its error state.

## Testing

Focused tests should cover:

- Week start/date calculations.
- Schedule item due detection.
- Untimed sequential progression.
- Output directory resolution.
- Store migration/default schedule rows.

Manual verification should cover:

- Opening the modal from the workspace tab sidebar.
- Dragging favorite cards into cells.
- Editing count/time/output path.
- Choosing a folder through Electron.
- Running due scheduled items while the app remains open.
- Verifying explicit output path beats collection-name fallback.
