# Composite Editor Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the LOGO library, restore reliable layer rendering and anchor controls, and add per-channel size selection.

**Architecture:** Extend the persisted Composite V2 state with only the LOGO folder path and rescan assets when the editor mounts. Make the canvas renderer background-optional, then add the two missing form interactions using existing store update patterns.

**Tech Stack:** React 19, TypeScript, Zustand persist, Vitest, react-test-renderer, Canvas 2D, Electron IPC.

---

### Task 1: Persist And Reload The LOGO Library

**Files:**
- Modify: `src/features/composite/lib/compositeV2Types.ts`
- Modify: `src/features/composite/lib/compositeV2Defaults.ts`
- Modify: `src/features/composite/storeV2.ts`
- Modify: `src/features/composite/storeV2.test.ts`
- Modify: `src/features/composite/components/PresetManagementTab.tsx`
- Modify: `src/features/composite/components/PresetManagementTab.test.tsx`

- [ ] **Step 1: Write failing store and component tests**

Assert that `getCompositeV2PersistedState` includes `logoLibraryPath`, and mount `PresetManagementTab` with a saved path while expecting `listImageFiles(savedPath)` to run.

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
npx vitest run src/features/composite/storeV2.test.ts src/features/composite/components/PresetManagementTab.test.tsx
```

Expected: FAIL because the state has no persisted LOGO path and the tab does not reload it.

- [ ] **Step 3: Implement minimal persistence and reload**

Add:

```ts
logoLibraryPath: string
setLogoLibraryPath: (path: string) => void
```

Persist the path with the existing Composite V2 state. Use the store path in `PresetManagementTab`, call `loadLogos(logoLibraryPath)` once when a saved path exists, and update the store after a successful scan or path edit.

- [ ] **Step 4: Run tests and verify pass**

Run the Task 1 command and expect all selected tests to pass.

### Task 2: Render Layers Without A Sample Background

**Files:**
- Modify: `src/features/composite/lib/compositeRendererV2.ts`
- Modify: `src/features/composite/lib/compositeRendererV2.test.ts`
- Modify: `src/features/composite/components/PresetCanvasEditor.tsx`
- Modify: `src/features/composite/components/PresetCanvasEditor.test.tsx`

- [ ] **Step 1: Write failing renderer and editor tests**

Assert that a render input accepts an empty background and still draws the combined overlay. Assert that a selected preset always renders a canvas even when `sampleBackgroundPath` is empty.

- [ ] **Step 2: Run tests and verify failure**

```powershell
npx vitest run src/features/composite/lib/compositeRendererV2.test.ts src/features/composite/components/PresetCanvasEditor.test.tsx
```

Expected: FAIL because the canvas is currently gated by `backgroundDataUrl`.

- [ ] **Step 3: Implement background-optional rendering**

Change `backgroundDataUrl` to optional. Clear the target canvas, draw the fitted background only when supplied, and always draw the preset overlay. Always mount the editor canvas when a preset exists.

- [ ] **Step 4: Run tests and verify pass**

Run the Task 2 command and expect all selected tests to pass.

### Task 3: Restore Vertical Anchor Offset

**Files:**
- Modify: `src/features/composite/components/PresetLayerPanel.tsx`
- Modify: `src/features/composite/components/PresetLayerPanel.test.tsx`

- [ ] **Step 1: Write a failing interaction test**

Render an anchor-positioned layer, find `Vertical offset`, change it to `24`, and assert that `onUpdatePreset` receives `offsetY: 24`.

- [ ] **Step 2: Run the test and verify failure**

```powershell
npx vitest run src/features/composite/components/PresetLayerPanel.test.tsx
```

Expected: FAIL because no vertical offset input exists.

- [ ] **Step 3: Add the missing field**

Add the numeric field beside horizontal offset and update only `position.offsetY`.

- [ ] **Step 4: Run the test and verify pass**

Run the Task 3 command and expect the test to pass.

### Task 4: Add Per-Channel Select All

**Files:**
- Modify: `src/features/composite/storeV2.ts`
- Modify: `src/features/composite/storeV2.test.ts`
- Modify: `src/features/composite/components/BatchExportTab.tsx`
- Modify: `src/features/composite/components/BatchExportTab.test.tsx`
- Modify: `src/features/composite/components/PresetManagementTab.tsx`
- Modify: `src/features/composite/components/PresetManagementTab.test.tsx`

- [ ] **Step 1: Write failing store and UI tests**

Assert that `setOutputRuleGroupEnabled(groupId, true)` enables every rule in that group and leaves other groups unchanged. Assert that global and preset-override channel headers expose a select-all checkbox.

- [ ] **Step 2: Run tests and verify failure**

```powershell
npx vitest run src/features/composite/storeV2.test.ts src/features/composite/components/BatchExportTab.test.tsx src/features/composite/components/PresetManagementTab.test.tsx
```

Expected: FAIL because channel-level selection is absent.

- [ ] **Step 3: Implement atomic channel updates and header controls**

Add:

```ts
setOutputRuleGroupEnabled: (groupId: string, enabled: boolean) => void
```

Use it from each global channel header. For preset overrides, update every rule in the matching override group in one preset patch.

- [ ] **Step 4: Run focused tests and verify pass**

Run the Task 4 command and expect all selected tests to pass.

### Task 5: Full Verification And Desktop Check

**Files:**
- No production changes expected.

- [ ] **Step 1: Run full verification**

```powershell
npm test
npm run build
git diff --check
```

Expected: 0 failures and successful production/Electron builds.

- [ ] **Step 2: Verify the running Electron app**

Confirm the saved LOGO library reloads, a selected LOGO renders without a sample background, vertical offset is visible, and each channel select-all checkbox toggles all child sizes.
