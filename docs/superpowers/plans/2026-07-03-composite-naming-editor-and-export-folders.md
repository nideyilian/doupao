# Composite Naming Editor and Export Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the preset directory-template UI with rich naming editors, export each image into a filename-derived folder, and default the canvas preview to transparency.

**Architecture:** Keep the persisted `subfolderTemplate` field for backward compatibility, but remove it from the preset UI and export path calculation. Add focused rich-editor helpers to `PresetNamingFields.tsx`, using the existing `{name}` template representation as the controlled value so storage and export code remain simple.

**Tech Stack:** React 19, TypeScript, Vitest, react-test-renderer, Electron.

---

### Task 1: Rich naming editor behavior

**Files:**
- Modify: `src/features/composite/components/PresetNamingFields.test.ts`
- Modify: `src/features/composite/components/PresetNamingFields.tsx`

- [ ] **Step 1: Write failing helper and component tests**

Add tests that require:

```ts
expect(moveNamingVariable('{date}-{size}', 0, 13)).toBe('{size}-{date}')
expect(convertNamingVariableToText('{date}-{size}', 0, { date: '20260703' }))
  .toBe('20260703-{size}')
expect(renderer.root.findAllByProps({ contentEditable: true })).toHaveLength(2)
expect(renderer.root.findAllByProps({ 'data-testid': 'preset-subfolder-preview' })).toHaveLength(0)
```

Exercise each editor's `onInput`, `onContextMenu`, `onDragStart`, `onDrop`, and `onKeyDown` handlers with DOM hosts containing `data-variable-name` chips. Assert that `onUpdatePreset` receives only `outputRootPath` or `filenameTemplate`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest run src/features/composite/components/PresetNamingFields.test.ts
```

Expected: FAIL because the move/convert helpers and two rich editors do not exist.

- [ ] **Step 3: Implement minimal rich-editor helpers and UI**

In `PresetNamingFields.tsx`:

```ts
type TemplateField = 'outputRootPath' | 'filenameTemplate'

export function convertNamingVariableToText(
  template: string,
  tokenStart: number,
  values: Record<string, string>,
) {
  const match = /\{([^{}]+)\}/g
  match.lastIndex = tokenStart
  const token = match.exec(template)
  if (!token || token.index !== tokenStart) return template
  return `${template.slice(0, tokenStart)}${values[token[1]!] ?? token[0]}${template.slice(tokenStart + token[0].length)}`
}
```

Implement `moveNamingVariable` by removing the complete `{name}` token and reinserting it at the drop offset after compensating for the removed token length. Implement a small local `NamingTemplateEditor` component that:

- renders `renderNamingTemplateHtml(value, values)` into a `contentEditable` div;
- reads edits through `readNamingTemplate`;
- stores/restores the current plain-template selection;
- treats a chip as an atomic selection for Delete/Backspace;
- serializes the dragged chip and moves its token on drop;
- replaces a right-clicked chip with its resolved visible text;
- synchronizes controlled updates only when rendered HTML differs.

Remove the directory-template label/editor and directory preview. Render rich editors for output root and filename only, keep the directory-picker button, and initialize the active field to `filenameTemplate`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
npx vitest run src/features/composite/components/PresetNamingFields.test.ts
```

Expected: all tests in the file PASS.

- [ ] **Step 5: Commit the editor change**

```powershell
git add src/features/composite/components/PresetNamingFields.tsx src/features/composite/components/PresetNamingFields.test.ts
git commit -m "feat: add rich preset naming editors"
```

### Task 2: Filename-derived export folders

**Files:**
- Modify: `src/features/composite/lib/compositeExportRuntime.test.ts`
- Modify: `src/features/composite/lib/compositeExportRuntime.ts`

- [ ] **Step 1: Write the failing export path test**

Change the path test to require:

```ts
expect(buildPresetOutputPathParts(item, { preserveSourceDir: false })).toEqual({
  subfolders: ['百度-1280x720-20260703'],
  filename: '百度-1280x720-20260703.jpg',
})
```

Give the item a nonempty legacy `subfolderTemplate` and assert it has no effect. Include a custom variable in `filenameTemplate` and assert its concrete value appears in both names.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest run src/features/composite/lib/compositeExportRuntime.test.ts
```

Expected: FAIL because the runtime still uses `subfolderTemplate`.

- [ ] **Step 3: Implement the minimal path change**

Resolve the filename template once via `buildCompositeOutputPathParts`, then return:

```ts
return {
  subfolders: [filenameWithoutExtension],
  filename,
}
```

Do not pass `preset.subfolderTemplate` into export path construction. Keep the existing collision behavior and output-root authorization unchanged.

- [ ] **Step 4: Run export path tests and verify GREEN**

Run:

```powershell
npx vitest run src/features/composite/lib/compositeExportRuntime.test.ts src/features/composite/lib/compositePathTemplates.test.ts
```

Expected: both test files PASS.

- [ ] **Step 5: Commit the export change**

```powershell
git add src/features/composite/lib/compositeExportRuntime.ts src/features/composite/lib/compositeExportRuntime.test.ts
git commit -m "feat: derive export folders from filenames"
```

### Task 3: Transparent canvas default

**Files:**
- Modify: `src/features/composite/components/PresetCanvasEditor.test.tsx`
- Modify: `src/features/composite/components/PresetCanvasEditor.tsx`

- [ ] **Step 1: Confirm the existing regression test is RED**

The test already asserts:

```ts
expect(getCanvasHost().props['data-preview-backdrop']).toBe('transparent')
```

Run:

```powershell
npx vitest run src/features/composite/components/PresetCanvasEditor.test.tsx
```

Expected: FAIL because component state starts at `white`.

- [ ] **Step 2: Implement the one-line default change**

Change:

```ts
useState<PreviewBackdropMode>('white')
```

to:

```ts
useState<PreviewBackdropMode>('transparent')
```

- [ ] **Step 3: Run the focused test and verify GREEN**

Run:

```powershell
npx vitest run src/features/composite/components/PresetCanvasEditor.test.tsx
```

Expected: all tests in the file PASS.

- [ ] **Step 4: Commit the canvas change**

```powershell
git add src/features/composite/components/PresetCanvasEditor.tsx src/features/composite/components/PresetCanvasEditor.test.tsx
git commit -m "fix: default composite canvas to transparency"
```

### Task 4: Regression verification

**Files:**
- Modify only if a directly related assertion requires alignment.

- [ ] **Step 1: Run composite feature tests**

```powershell
npx vitest run src/features/composite
```

Expected: all composite tests PASS with zero failures.

- [ ] **Step 2: Run the complete test suite**

```powershell
npm test
```

Expected: all tests PASS with zero failures.

- [ ] **Step 3: Run the production build**

```powershell
npm run build
```

Expected: TypeScript and Vite complete with exit code 0.

- [ ] **Step 4: Check the final diff**

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors and no uncommitted product changes.

### Task 5: Publish version 0.7.14

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Set the exact version**

```powershell
npm version 0.7.14 --no-git-tag-version
```

Expected: both package files contain version `0.7.14`.

- [ ] **Step 2: Re-run release verification**

```powershell
npm test
npm run build
```

Expected: both commands exit 0 with zero test failures.

- [ ] **Step 3: Commit the version**

```powershell
git add package.json package-lock.json docs/superpowers/plans/2026-07-03-composite-naming-editor-and-export-folders.md
git commit -m "release: publish 0.7.14"
```

- [ ] **Step 4: Publish installers**

```powershell
npm run release
```

Expected: electron-builder uploads the Windows installers and reports a published `v0.7.14` GitHub release.

- [ ] **Step 5: Push committed source**

```powershell
git push origin main
```

Expected: `origin/main` advances to the `0.7.14` release commit.

- [ ] **Step 6: Verify publication**

```powershell
gh release view v0.7.14 --json tagName,isDraft,isPrerelease,url,assets
git status --short
```

Expected: the release exists, is not a draft or prerelease, contains Windows assets, and the worktree is clean.
