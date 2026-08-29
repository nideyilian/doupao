# Composite Postprocess Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current postprocess page with an Electron desktop image compositing and distribution workspace.

**Architecture:** Add an isolated `src/features/composite` feature with typed preset/page/layer models, pure tested helpers, a persisted Zustand store, and a Tailwind workspace UI. Electron IPC supplies local file and directory access, while the renderer owns canvas preview and export orchestration so preview and output use the same composition path.

**Tech Stack:** React 19, TypeScript, Zustand, Vite, Vitest, Electron IPC, browser Canvas APIs, existing Tailwind styling.

---

## File Structure

- Create `src/features/composite/lib/compositeTypes.ts`: shared types for categories, pages, presets, layers, output rules, export records, and filesystem asset metadata.
- Create `src/features/composite/lib/compositeDefaults.ts`: factory functions for default presets, categories, pages, and workspace state.
- Create `src/features/composite/lib/compositePresetTree.ts`: pure tree operations and export-page selection.
- Create `src/features/composite/lib/compositeDistribution.ts`: quantity/date expansion, filename templating, path planning, and export progress helpers.
- Create `src/features/composite/lib/compositeAssets.ts`: image extension checks and deterministic random/sequential asset picking.
- Create `src/features/composite/lib/compositeExportHistory.ts`: latest-run output summary.
- Create `src/features/composite/lib/compositeRenderer.ts`: canvas drawing helpers for preview/export.
- Create `src/features/composite/lib/*.test.ts`: focused tests for each pure helper.
- Create `src/features/composite/store.ts`: persisted Zustand store for composite workspace state.
- Create `src/features/composite/CompositeWorkspace.tsx`: full replacement postprocess workbench.
- Modify `src/App.tsx`: replace the postprocess lazy import with the new composite workspace.
- Modify `electron/preload.ts`: expose composite IPC helpers.
- Modify `electron/ipc-handlers.ts`: implement composite local file helpers.
- Modify `src/vite-env.d.ts`: type the composite Electron API.

## Task 1: Core Types And Defaults

**Files:**
- Create: `src/features/composite/lib/compositeTypes.ts`
- Create: `src/features/composite/lib/compositeDefaults.ts`
- Test: `src/features/composite/lib/compositeDefaults.test.ts`

- [ ] **Step 1: Write the failing defaults test**

```ts
import { describe, expect, it } from 'vitest'
import { createDefaultCompositeWorkspaceState } from './compositeDefaults'

describe('createDefaultCompositeWorkspaceState', () => {
  it('creates an enabled category with an enabled page and jpg main output', () => {
    const state = createDefaultCompositeWorkspaceState()

    expect(state.categories).toHaveLength(1)
    expect(state.categories[0].enabled).toBe(true)
    expect(state.categories[0].pages[0].enabled).toBe(true)
    expect(state.categories[0].pages[0].preset.canvas).toEqual({ width: 1280, height: 720 })
    expect(state.categories[0].pages[0].preset.output.main.format).toBe('jpg')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/composite/lib/compositeDefaults.test.ts`

Expected: FAIL because `compositeDefaults` does not exist.

- [ ] **Step 3: Implement types and defaults**

Create `compositeTypes.ts` with discriminated layer types and `compositeDefaults.ts` with factory functions using unique IDs.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/composite/lib/compositeDefaults.test.ts`

Expected: PASS.

## Task 2: Preset Tree Logic

**Files:**
- Create: `src/features/composite/lib/compositePresetTree.ts`
- Test: `src/features/composite/lib/compositePresetTree.test.ts`

- [ ] **Step 1: Write failing tests**

Test selected export pages, disabled category behavior, page duplication, and moving pages between categories.

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/features/composite/lib/compositePresetTree.test.ts`

Expected: FAIL because tree helpers do not exist.

- [ ] **Step 3: Implement minimal tree helpers**

Implement `getEnabledCompositePages`, `duplicateCompositePage`, and `moveCompositePage`.

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run src/features/composite/lib/compositePresetTree.test.ts`

Expected: PASS.

## Task 3: Distribution And Asset Planning

**Files:**
- Create: `src/features/composite/lib/compositeAssets.ts`
- Create: `src/features/composite/lib/compositeDistribution.ts`
- Create: `src/features/composite/lib/compositeExportHistory.ts`
- Test: `src/features/composite/lib/compositeAssets.test.ts`
- Test: `src/features/composite/lib/compositeDistribution.test.ts`
- Test: `src/features/composite/lib/compositeExportHistory.test.ts`

- [ ] **Step 1: Write failing tests**

Cover image extension filtering, sequential/random pick planning, date-batch expansion, filename token replacement, path joining inputs, and export-history summary.

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run src/features/composite/lib/compositeAssets.test.ts src/features/composite/lib/compositeDistribution.test.ts src/features/composite/lib/compositeExportHistory.test.ts`

Expected: FAIL because helpers do not exist.

- [ ] **Step 3: Implement minimal pure helpers**

Keep logic renderer-safe and independent from Electron APIs.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/features/composite/lib/compositeAssets.test.ts src/features/composite/lib/compositeDistribution.test.ts src/features/composite/lib/compositeExportHistory.test.ts`

Expected: PASS.

## Task 4: Composite Store And Renderer

**Files:**
- Create: `src/features/composite/store.ts`
- Create: `src/features/composite/lib/compositeRenderer.ts`

- [ ] **Step 1: Create store with isolated persistence key**

Use `doupao-composite-workspace-storage`. Store categories, active IDs, icon library path, export status, and latest history. Do not read or mutate `doupao-postprocess-storage`.

- [ ] **Step 2: Create canvas renderer helper**

Implement `renderCompositePresetToCanvas` and `renderCompositePresetToDataUrl` for background, patch image, logo, text, watermark, and color block layers.

- [ ] **Step 3: Run type check through build later**

No separate renderer unit test is required because jsdom Canvas support is limited in this project.

## Task 5: Electron Composite IPC

**Files:**
- Modify: `electron/preload.ts`
- Modify: `electron/ipc-handlers.ts`
- Modify: `src/vite-env.d.ts`

- [ ] **Step 1: Add preload methods**

Expose `selectFile`, `readImageFile`, `listImageFiles`, `pickImageFile`, and `saveCompositeImage`.

- [ ] **Step 2: Add IPC handlers**

Use the existing allowed-root model. Selecting files/folders adds them to allowed roots. Reading and writing paths goes through `assertAllowedPath`.

- [ ] **Step 3: Add renderer typings**

Extend `window.electronAPI` with the composite methods.

## Task 6: Composite Workspace UI

**Files:**
- Create: `src/features/composite/CompositeWorkspace.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Build the workspace shell**

Create left preset tree, center canvas/editor, right layer panel, lower config/output/distribution sections, and non-Electron unsupported notices.

- [ ] **Step 2: Wire core interactions**

Add category/page create, rename, duplicate, delete, enable, layer select, layer edit, add text/logo/color block, align controls, file library load, output rule edit, and batch export.

- [ ] **Step 3: Replace postprocess entry**

Change the lazy import in `src/App.tsx` from `PostprocessV2Workspace` to `CompositeWorkspace`. Do not change gallery or Agent rendering.

## Task 7: Verification

**Files:**
- Existing and new test files.

- [ ] **Step 1: Run focused composite tests**

Run: `npx vitest run src/features/composite/lib`

Expected: all composite tests pass.

- [ ] **Step 2: Run app build**

Run: `npm run build`

Expected: TypeScript and Vite build succeed.

- [ ] **Step 3: Review diff scope**

Run: `git diff --stat`

Expected: changes are limited to composite feature, Electron IPC typing, `App.tsx`, and the implementation plan.
