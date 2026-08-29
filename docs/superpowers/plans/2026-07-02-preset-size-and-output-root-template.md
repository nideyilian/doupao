# Preset Size and Output Root Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace free-form preset canvas dimensions with three fixed choices and make output root paths support the same built-in and custom variables as naming templates.

**Architecture:** Keep the preset schema unchanged. Extend the existing naming editor so `outputRootPath` is a third caret-aware variable target, and expose one shared template resolver for both naming path parts and the unsanitized absolute output root.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest, Electron.

---

### Task 1: Fixed preset canvas size selector

**Files:**
- Modify: `src/features/composite/components/PresetManagementTab.test.tsx`
- Modify: `src/features/composite/components/PresetManagementTab.tsx`

- [ ] **Step 1: Write the failing component test**

Add a test that renders `PresetManagementTab`, locates `select[aria-label="基准尺寸"]`, verifies these exact options:

```ts
[
  { value: '1280x720', label: '1280×720' },
  { value: '1080x1920', label: '1080×1920' },
  { value: '800x800', label: '800×800' },
]
```

Then call `onChange({ target: { value: '1080x1920' } })` and assert:

```ts
expect(useCompositeV2Store.getState().presets[0]!.baseCanvas).toEqual({
  width: 1080,
  height: 1920,
})
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npx vitest run src/features/composite/components/PresetManagementTab.test.tsx
```

Expected: FAIL because no `select` has the `基准尺寸` accessible label.

- [ ] **Step 3: Add the fixed selector**

Define the three options next to the component constants:

```ts
const PRESET_BASE_SIZES = [
  { value: '1280x720', label: '1280×720', width: 1280, height: 720 },
  { value: '1080x1920', label: '1080×1920', width: 1080, height: 1920 },
  { value: '800x800', label: '800×800', width: 800, height: 800 },
] as const
```

Replace the two number inputs with one `select`. Its value is `${width}x${height}`. On change, find the matching option and call:

```ts
store.updatePreset(activePreset.id, {
  baseCanvas: { width: selected.width, height: selected.height },
})
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
npx vitest run src/features/composite/components/PresetManagementTab.test.tsx
```

Expected: PASS.

### Task 2: Output root as a caret-aware variable insertion target

**Files:**
- Modify: `src/features/composite/components/PresetNamingFields.test.ts`
- Modify: `src/features/composite/components/PresetNamingFields.tsx`
- Modify: `src/features/composite/components/PresetManagementTab.tsx`

- [ ] **Step 1: Write the failing insertion unit test**

Generalize the existing insertion test table so it includes:

```ts
expect(insertNamingVariable(
  'D:\\Exports\\daily',
  'date',
  { start: 11, end: 18 },
)).toEqual({
  template: 'D:\\Exports\\{date}',
  caret: 17,
})
```

This preserves the existing helper contract while covering an absolute Windows path.

- [ ] **Step 2: Write the failing component test**

In `PresetManagementTab.test.tsx`, focus the output-root input, set its selection to the end of `D:\Exports\`, click `插入变量 {date}`, and assert:

```ts
expect(useCompositeV2Store.getState().presets[0]!.outputRootPath)
  .toBe('D:\\Exports\\{date}')
```

- [ ] **Step 3: Run the tests and verify RED**

Run:

```powershell
npx vitest run src/features/composite/components/PresetNamingFields.test.ts src/features/composite/components/PresetManagementTab.test.tsx
```

Expected: the helper test passes, while the component test fails because `outputRootPath` is not an insertion target.

- [ ] **Step 4: Move the output root field into `PresetNamingFields`**

Extend the field union:

```ts
type TemplateField = 'outputRootPath' | 'subfolderTemplate' | 'filenameTemplate'
```

Add an `HTMLInputElement` ref and selection state for `outputRootPath`. Render the existing output-root input and directory chooser above the two naming textareas. Its focus/select handlers call the same `rememberSelection`, and the shared variable buttons insert into whichever of the three fields is active.

Add this prop:

```ts
onSelectOutputDirectory: () => Promise<void>
```

`PresetManagementTab` passes its existing directory-picker behavior through that callback and removes the former standalone output-root markup.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run:

```powershell
npx vitest run src/features/composite/components/PresetNamingFields.test.ts src/features/composite/components/PresetManagementTab.test.tsx
```

Expected: PASS.

### Task 3: Resolve variables in output root paths

**Files:**
- Modify: `src/features/composite/lib/compositePathTemplates.test.ts`
- Modify: `src/features/composite/lib/compositePathTemplates.ts`
- Modify: `src/features/composite/lib/compositeExportRuntime.test.ts`
- Modify: `src/features/composite/lib/compositeExportRuntime.ts`

- [ ] **Step 1: Write failing resolver tests**

Add tests for a new exported function:

```ts
expect(resolveCompositeTemplate(
  'D:\\Exports\\{date}\\{project}\\{unknown}',
  {
    date: '20260702',
    channel: '快手',
    size: '1280x720',
    preset: '横版',
    index: 1,
    source: 'image',
    sourceDir: 'source',
    custom: '自定义',
    customVariables: { project: '项目A' },
  },
)).toBe('D:\\Exports\\20260702\\项目A\\{unknown}')
```

The assertion proves that drive syntax and separators remain untouched and unknown variables remain literal.

- [ ] **Step 2: Run the path test and verify RED**

Run:

```powershell
npx vitest run src/features/composite/lib/compositePathTemplates.test.ts
```

Expected: FAIL because `resolveCompositeTemplate` is not exported.

- [ ] **Step 3: Export the shared resolver**

Rename the private `replaceTemplate` to:

```ts
export function resolveCompositeTemplate(
  template: string,
  vars: TemplateVars & { customVariables?: Record<string, string> },
): string
```

Keep its current ordered built-in and custom-variable replacement behavior. Update `buildCompositeOutputPathParts` to use it.

- [ ] **Step 4: Run the path test and verify GREEN**

Run:

```powershell
npx vitest run src/features/composite/lib/compositePathTemplates.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write the failing runtime test**

Extend the runtime export fixture with:

```ts
outputRootPath: 'D:\\Exports\\{date}\\{project}',
customVariableValues: { project: '项目A' },
```

Assert that the first `pathJoin` call starts with:

```ts
'D:\\Exports\\20260702\\项目A'
```

- [ ] **Step 6: Run the runtime test and verify RED**

Run:

```powershell
npx vitest run src/features/composite/lib/compositeExportRuntime.test.ts
```

Expected: FAIL because the runtime still passes the unresolved root.

- [ ] **Step 7: Resolve the root before joining**

Create one shared runtime variable object for the export item, use it both in `buildPresetOutputPathParts` and:

```ts
const outputRootPath = resolveCompositeTemplate(
  item.preset.outputRootPath,
  templateVariables,
)
const directoryParts = [outputRootPath, ...pathParts.subfolders]
```

Do not sanitize or split `outputRootPath`.

- [ ] **Step 8: Run the runtime test and verify GREEN**

Run:

```powershell
npx vitest run src/features/composite/lib/compositeExportRuntime.test.ts
```

Expected: PASS.

### Task 4: Verify all pending work and prepare version 0.7.11

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Include all currently modified and untracked workspace files in the release commit.

- [ ] **Step 1: Run focused feature tests**

Run:

```powershell
npx vitest run src/features/composite/components/PresetNamingFields.test.ts src/features/composite/components/PresetManagementTab.test.tsx src/features/composite/lib/compositePathTemplates.test.ts src/features/composite/lib/compositeExportRuntime.test.ts src/lib/localSave.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the full test suite**

Run:

```powershell
npm test
```

Expected: exit code 0 with no failed tests.

- [ ] **Step 3: Set the exact release version**

Run:

```powershell
npm version 0.7.11 --no-git-tag-version
```

Expected: both package manifests report `0.7.11`.

- [ ] **Step 4: Run the production build**

Run:

```powershell
npm run build
```

Expected: exit code 0.

- [ ] **Step 5: Inspect and commit every pending file**

Run:

```powershell
git status --short
git diff --check
git add -A
git diff --cached --check
git commit -m "release: publish 0.7.11"
```

Expected: one commit containing the feature, version manifests, existing local-save changes, and pending plan documents.

- [ ] **Step 6: Push the release commit**

Run:

```powershell
git push origin main
```

Expected: `origin/main` advances to the release commit.

- [ ] **Step 7: Publish GitHub release artifacts**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release-version.ps1 -Bump none
```

Expected: tests and build pass again, Electron artifacts upload successfully, and GitHub release `v0.7.11` is created or updated.

- [ ] **Step 8: Verify remote release state**

Run:

```powershell
gh release view v0.7.11 --repo nideyilian/doupao
```

Expected: release `v0.7.11` exists and lists uploaded Windows artifacts.
