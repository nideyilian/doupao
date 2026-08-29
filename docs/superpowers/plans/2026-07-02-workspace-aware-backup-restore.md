# Workspace-Aware Backup Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve every gallery task’s workspace-tab assignment in v5 ZIP backups and restore the backed-up workspace exactly during a full config-and-task restore.

**Architecture:** Add a compact workspace snapshot to the manifest that stores tab metadata and ID references only. A focused pure helper will serialize, validate, and hydrate that snapshot; the existing import transaction will gain a task-replacement mode so full restores cannot leave unbacked tasks to become recovery-tab orphans.

**Tech Stack:** TypeScript, Zustand, IndexedDB, fflate, Vitest.

---

### Task 1: Define and validate the workspace backup snapshot

**Files:**
- Modify: `src/types.ts`
- Create: `src/lib/workspaceBackup.ts`
- Create: `src/lib/workspaceBackup.test.ts`

- [ ] **Step 1: Write failing serialization and hydration tests**

Create fixtures with two tabs, one group, one empty tab, and one task per populated tab. Assert:

```ts
const snapshot = createWorkspaceBackupState(
  [tabA, tabB, emptyTab],
  [group],
  tabB.id,
  true,
)

expect(snapshot.tabs.map(({ id, taskIds }) => ({ id, taskIds }))).toEqual([
  { id: tabA.id, taskIds: ['task-a'] },
  { id: tabB.id, taskIds: ['task-b'] },
  { id: emptyTab.id, taskIds: [] },
])

expect(restoreWorkspaceBackupState(
  snapshot,
  [taskA, taskB],
  new Set(['input-a', 'input-b']),
)).toMatchObject({
  activeTabId: tabB.id,
  groups: [group],
  tabs: [
    { id: tabA.id, tasks: [taskA] },
    { id: tabB.id, tasks: [taskB] },
    { id: emptyTab.id, tasks: [] },
  ],
})
```

Add separate tests that reject duplicate tab IDs, a missing group, a missing task, duplicate task ownership, an invalid active tab, and a missing input image.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
npx vitest run src/lib/workspaceBackup.test.ts
```

Expected: FAIL because `workspaceBackup.ts` does not exist.

- [ ] **Step 3: Add manifest types**

Add to `src/types.ts`:

```ts
export interface WorkspaceBackupTab {
  id: string
  name: string
  groupId: string | null
  prompt: string
  inputImageIds: string[]
  inputImageFolder: InputImageFolder | null
  params: TaskParams
  maskDraft: MaskDraft | null
  maskEditorImageId: string | null
  customOutputPath: string
  taskIds: string[]
  createdAt: number
  updatedAt: number
  order: number
}

export interface WorkspaceBackupState {
  tabs: WorkspaceBackupTab[]
  groups: WorkspaceTabGroup[]
  activeTabId: string | null
}
```

Add `workspaceState?: WorkspaceBackupState` to `ExportData`.

- [ ] **Step 4: Implement the pure helper**

Create:

```ts
export function createWorkspaceBackupState(
  tabs: WorkspaceTab[],
  groups: WorkspaceTabGroup[],
  activeTabId: string | null,
  includeTaskIds: boolean,
): WorkspaceBackupState
```

It maps `inputImages` to `inputImageIds`, maps tasks to `taskIds` only when requested, clones groups, and preserves empty tabs.

Create:

```ts
export function restoreWorkspaceBackupState(
  snapshot: WorkspaceBackupState,
  tasks: TaskRecord[],
  availableImageIds: Set<string>,
): {
  tabs: WorkspaceTab[]
  groups: WorkspaceTabGroup[]
  activeTabId: string | null
}
```

Validate all IDs before returning hydrated tabs. Rebuild inputs as `{ id, dataUrl: '' }`, resolve `taskIds` through a task map, and throw a Chinese error naming the invalid reference.

- [ ] **Step 5: Run the tests and verify GREEN**

Run:

```powershell
npx vitest run src/lib/workspaceBackup.test.ts
```

Expected: PASS.

### Task 2: Export v5 manifests with workspace ownership

**Files:**
- Modify: `src/lib/backupImport.ts`
- Modify: `src/lib/backupImport.test.ts`
- Modify: `src/store.ts`
- Modify: `src/store.test.ts`

- [ ] **Step 1: Write failing v5 export tests**

In `src/store.test.ts`, prepare two workspace tabs and export a Web ZIP. Unzip `manifest.json` and assert:

```ts
expect(manifest.version).toBe(5)
expect(manifest.workspaceState).toMatchObject({
  activeTabId: 'tab-b',
  groups: [{ id: 'group-a', name: '分组 A' }],
  tabs: [
    { id: 'tab-a', taskIds: ['task-a'] },
    { id: 'tab-b', taskIds: ['task-b'] },
  ],
})
```

Add a config-only export assertion that preserves tabs but emits empty `taskIds`.

- [ ] **Step 2: Write a failing version-validation test**

In `src/lib/backupImport.test.ts`, assert that version 5 is accepted and version 6 is rejected with:

```ts
'备份版本 6 高于当前支持的版本 5'
```

- [ ] **Step 3: Run the tests and verify RED**

Run:

```powershell
npx vitest run src/store.test.ts src/lib/backupImport.test.ts
```

Expected: FAIL because exports still use v4, omit `workspaceState`, and version 5 is rejected.

- [ ] **Step 4: Emit workspace snapshots from every ZIP export path**

Import `createWorkspaceBackupState` into `src/store.ts`. Change all manifest versions from `4` to `5`. Whenever `options.exportConfig` is true, set:

```ts
manifest.workspaceState = createWorkspaceBackupState(
  state.workspaceTabs,
  state.workspaceTabGroups,
  state.activeWorkspaceTabId,
  options.exportTasks === true,
)
```

Apply this to browser export, direct ZIP construction, and Electron streaming export so weekly automatic backups and manual backups use the same format.

- [ ] **Step 5: Accept v5 imports**

Change:

```ts
const CURRENT_BACKUP_VERSION = 5
```

Keep versions 1–4 accepted.

- [ ] **Step 6: Run the focused tests and verify GREEN**

Run:

```powershell
npx vitest run src/store.test.ts src/lib/backupImport.test.ts
```

Expected: PASS.

### Task 3: Replace tasks and restore exact tab ownership

**Files:**
- Modify: `src/lib/db.ts`
- Modify: `src/lib/db.test.ts`
- Modify: `src/lib/backupImport.ts`
- Modify: `src/store.ts`
- Modify: `src/store.test.ts`

- [ ] **Step 1: Write a failing IndexedDB replacement test**

Extend the import transaction test with an existing task and call:

```ts
await commitImportedRecords({
  images: [],
  thumbnails: [],
  tasks: [{ id: 'task-from-backup' } as TaskRecord],
  replaceTasks: true,
})
```

Assert that `tasks.clear()` is called before the imported task is put.

- [ ] **Step 2: Write failing full-restore behavior tests**

In `src/store.test.ts`, start with a local-only task and local-only tab. Import a v5 backup with two tasks, two populated tabs, one empty tab, one group, and an active tab using:

```ts
{ importConfig: true, importTasks: true, importImages: true }
```

Assert:

```ts
expect((await getAllTasks()).map((task) => task.id)).toEqual(['task-a', 'task-b'])
expect(useStore.getState().workspaceTabs.map((tab) => ({
  id: tab.id,
  taskIds: tab.tasks.map((task) => task.id),
}))).toEqual([
  { id: 'tab-a', taskIds: ['task-a'] },
  { id: 'tab-b', taskIds: ['task-b'] },
  { id: 'tab-empty', taskIds: [] },
])
expect(useStore.getState().workspaceTabGroups).toEqual([groupA])
expect(useStore.getState().activeWorkspaceTabId).toBe('tab-b')
```

Add tests proving:

- invalid workspace references fail before replacing local tasks or tabs;
- config-only and task-only imports retain merge semantics;
- v4 imports retain merge semantics.

- [ ] **Step 3: Run the tests and verify RED**

Run:

```powershell
npx vitest run src/lib/db.test.ts src/store.test.ts
```

Expected: FAIL because import transactions cannot replace tasks and workspace state is ignored.

- [ ] **Step 4: Add transactional task replacement**

Extend:

```ts
export function commitImportedRecords(records: {
  images: StoredImage[]
  thumbnails: StoredImageThumbnail[]
  tasks: TaskRecord[]
  replaceTasks?: boolean
}): Promise<void>
```

Inside the existing read-write transaction, call `taskStore.clear()` before task puts when `replaceTasks` is true.

- [ ] **Step 5: Validate the workspace before writes**

In `validateBackupArchive`, when `data.version >= 5`, `workspaceState` exists, and config plus tasks are selected, call `restoreWorkspaceBackupState` with `data.tasks ?? []` and the keys of `data.imageFiles ?? {}`. Discard the hydrated return value; this pass exists to prove all references before any IndexedDB mutation.

- [ ] **Step 6: Restore in replacement mode**

In `importData`, compute:

```ts
const replaceWorkspace =
  data.version >= 5 &&
  Boolean(data.workspaceState) &&
  options.importConfig === true &&
  options.importTasks === true
```

Pass `replaceTasks: replaceWorkspace` to `commitImportedRecords`.

When replacing:

- replace Agent conversations instead of merging;
- hydrate the workspace snapshot from the normalized imported tasks;
- set `tasks`, `workspaceTabs`, `workspaceTabGroups`, and `activeWorkspaceTabId` together;
- clear `selectedWorkspaceTabIds`.

When not replacing, retain the current import branches unchanged.

- [ ] **Step 7: Update the store database mock**

Extend the `commitImportedRecords` mock in `src/store.test.ts` so `replaceTasks` clears its task map before puts. This keeps tests aligned with the real database contract.

- [ ] **Step 8: Run focused tests and verify GREEN**

Run:

```powershell
npx vitest run src/lib/workspaceBackup.test.ts src/lib/backupImport.test.ts src/lib/db.test.ts src/store.test.ts
```

Expected: PASS.

### Task 4: Verify the complete change

**Files:**
- Verify all files modified by Tasks 1–3.

- [ ] **Step 1: Run the full test suite**

Run:

```powershell
npm test
```

Expected: exit code 0 with no failed tests.

- [ ] **Step 2: Run the production build**

Run:

```powershell
npm run build
```

Expected: exit code 0.

- [ ] **Step 3: Inspect the final diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: only workspace-aware backup implementation, tests, types, and plan changes are present.
