# Composite Persistence Hydration Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve a coherent composite preset selection across restarts and always restore the distribution start date from the fresh runtime default.

**Architecture:** Keep the existing Zustand/localStorage persistence boundary. Add one pure merge function that deep-merges distribution settings and normalizes preset selection fields, then configure Zustand persistence to use it.

**Tech Stack:** TypeScript, Zustand 5 persist middleware, Vitest

---

### Task 1: Add failing hydration regression tests

**Files:**
- Modify: `src/features/composite/storeV2.test.ts`

- [ ] **Step 1: Import the store module namespace**

Add:

```ts
import * as storeModule from './storeV2'
```

- [ ] **Step 2: Test the distribution-date JSON round trip**

Add a test that gets `mergeCompositeV2PersistedState` from the module namespace, JSON-serializes a projected persisted state whose saved date is stale, and expects the merged state to use the fresh current state's date while retaining the persisted `enabled` and `days` values.

- [ ] **Step 3: Test selection restoration and normalization**

Add one test with two preset groups that persists the second group, its preview preset, and enabled preset ID. Verify the JSON-round-tripped state restores that coherent selection. Add a second test with invalid IDs and verify hydration falls back to the first valid group, its first preview preset, and that group's preset IDs.

- [ ] **Step 4: Run tests and verify RED**

Run:

```powershell
npm test -- src/features/composite/storeV2.test.ts
```

Expected: FAIL because `mergeCompositeV2PersistedState` does not exist.

### Task 2: Implement the persistence-boundary fix

**Files:**
- Modify: `src/features/composite/storeV2.ts`

- [ ] **Step 1: Define the persisted state shape**

Add a local `CompositeV2PersistedState` type extending `CompositeV2State` with optional `selectedPresetGroupId` and `selectedPreviewPresetId`.

- [ ] **Step 2: Persist both selection IDs**

Change `getCompositeV2PersistedState` to return `CompositeV2PersistedState` and add:

```ts
selectedPresetGroupId: state.selectedPresetGroupId,
selectedPreviewPresetId: state.selectedPreviewPresetId,
```

- [ ] **Step 3: Add the pure hydration merge**

Implement `mergeCompositeV2PersistedState(persistedState, currentState)` so it:

```ts
const merged = {
  ...currentState,
  ...persisted,
  distributionConfig: {
    ...currentState.distributionConfig,
    ...(persisted.distributionConfig ?? {}),
    startDate: currentState.distributionConfig.startDate,
  },
}
```

Then resolve the selected group against `merged.presetGroups`, validate the preview preset against that group, filter enabled IDs to that group, and fall back to all group preset IDs when none remain.

- [ ] **Step 4: Configure Zustand to use the merge**

Use `CompositeV2PersistedState` as the persist middleware's projected type and add:

```ts
merge: mergeCompositeV2PersistedState,
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```powershell
npm test -- src/features/composite/storeV2.test.ts
```

Expected: all store tests pass.

### Task 3: Verify the complete change

**Files:**
- Verify: `src/features/composite/storeV2.ts`
- Verify: `src/features/composite/storeV2.test.ts`

- [ ] **Step 1: Run the full test suite**

```powershell
npm test -- --reporter=dot
```

Expected: 64 test files and all tests pass.

- [ ] **Step 2: Run the production build**

```powershell
npm run build
```

Expected: TypeScript and Vite build complete successfully.

- [ ] **Step 3: Check the final diff**

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; only the plan, store implementation, and store tests are changed after the already committed design document.

- [ ] **Step 4: Commit the verified fix**

```powershell
git add -- docs/superpowers/plans/2026-07-02-composite-persistence-hydration-fixes.md src/features/composite/storeV2.ts src/features/composite/storeV2.test.ts
git commit -m "fix: restore composite persisted workspace state"
```
