# Generated Image Filenames Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply generation-date, workspace-label, optional prompt, and continuous sequence naming to every generated-image save and download path.

**Architecture:** A pure filename module receives explicit task metadata and settings. Download helpers map generated images to exact names; Electron save orchestration serializes each directory scan plus task write and reuses the target project's existing no-overwrite safeguards.

**Tech Stack:** TypeScript, React 19, Zustand, Vitest, Electron

---

### Task 1: Pure filename policy

**Files:**
- Create: `src/lib/generatedImageFilename.ts`
- Test: `src/lib/generatedImageFilename.test.ts`

- [ ] Write tests for local task date, all four setting combinations, whitespace collapsing, invalid characters, 100-character prompt truncation, empty fallback, and maximum existing sequence.
- [ ] Run `npx vitest run src/lib/generatedImageFilename.test.ts`; verify failure because the module does not exist.
- [ ] Implement:
  - `sanitizeGeneratedImageFilenamePart`
  - `formatGeneratedImageDate`
  - `buildGeneratedImageFileNamePrefix`
  - `buildGeneratedImageFileNameBase`
  - `findNextGeneratedImageSequence`
- [ ] Run the focused test and verify all cases pass.

The sanitizer replaces `[<>:"/\\|?*\x00-\x1f]+`, collapses `\s+`, and truncates only when a maximum is supplied. Sequence matching must quote the prefix and match `prefix-(\d+).extension` exactly.

### Task 2: Persisted settings and UI

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/apiProfiles.ts`
- Modify: `src/lib/apiProfiles.test.ts`
- Modify: `src/components/SettingsModal.tsx`

- [ ] Add failing tests proving defaults are date `true`, prompt `false`, and explicit values are preserved.
- [ ] Run `npx vitest run src/lib/apiProfiles.test.ts`; verify the new assertions fail.
- [ ] Add both required fields to `AppSettings`, `normalizeSettings`, and `DEFAULT_SETTINGS`.
- [ ] Add visible checkboxes labelled `文件名添加生成日期` and `文件名使用生成提示词`, with the two filename examples.
- [ ] Re-run the settings tests and TypeScript checking.

### Task 3: Exact generated-image download entries

**Files:**
- Modify: `src/lib/downloadImages.ts`
- Create: `src/lib/downloadImages.test.ts`

- [ ] Add failing tests with tasks from different tabs and a filtered third output image.
- [ ] Run `npx vitest run src/lib/downloadImages.test.ts`; verify missing exports fail.
- [ ] Add `downloadImageEntries`, which downloads each entry with its exact base without adding another sequence.
- [ ] Add `getGeneratedImageDownloadEntries`, preserving task order and original output positions while resolving label fallbacks.
- [ ] Re-run the focused tests.

The optional filter must also support stream partial image IDs. ZIP duplicate protection and ZIP archive names remain unchanged.

### Task 4: Electron automatic-save continuation

**Files:**
- Modify: `src/lib/localSave.ts`
- Modify: `src/lib/localSave.test.ts`
- Modify: `src/store.ts`
- Modify: `src/store.test.ts`

- [ ] Add a failing local-save test for an explicit filename base.
- [ ] Add a failing store test proving existing `prefix-1` and `prefix-3` files cause a multi-image task to use `prefix-4` and `prefix-5`.
- [ ] Run the focused tests and verify both fail for the missing behavior.
- [ ] Extend `saveImageToLocal` with an optional exact filename base while preserving its existing exclusive no-overwrite path.
- [ ] In the store, resolve the task, tab, directory, settings, prefix, and starting sequence once per task save operation.
- [ ] Serialize the scan plus task writes, skip already-saved image IDs, and pass consecutive exact bases to `saveImageToLocal`.
- [ ] Re-run local-save, filename, and store tests.

Directory-read failure falls back to sequence `1`; the existing save error reporting remains unchanged.

### Task 5: Route all generated-image downloads

**Files:**
- Modify: `src/components/DetailModal.tsx`
- Modify: `src/components/ImageContextMenu.tsx`
- Modify: `src/components/InputBar.tsx`
- Modify: `src/components/AgentWorkspace.tsx`

- [ ] Replace generated-task direct downloads with exact generated entries.
- [ ] Replace generated-task ZIP entries with exact generated entries while retaining existing ZIP names and route settings.
- [ ] Keep generic `downloadImageIds` and `getImageZipEntries` fallbacks for images without a generated task.
- [ ] Run focused download tests and `npx tsc -b --pretty false`.

### Task 6: Verification and commit

- [ ] Run `npx vitest run src/lib/generatedImageFilename.test.ts src/lib/downloadImages.test.ts src/lib/localSave.test.ts src/lib/apiProfiles.test.ts src/store.test.ts`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check` and inspect every changed file for feature-only scope.
- [ ] Commit the design, plan, implementation, and tests together with `feat: add configurable generated image filenames`.
