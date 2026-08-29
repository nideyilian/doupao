# Preset Naming Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Isolate naming values and templates per composite preset while migrating legacy data without losing preset-specific values.

**Architecture:** Keep variable definitions in the composite workspace state, but store resolved values and both path templates on each preset. Normalize persisted presets at the storage boundary so UI and export code only consume explicit fields; split template editing from preview rendering to prevent resolved values from looking like mutations.

**Tech Stack:** TypeScript, React 19, Zustand persist, Vitest, react-test-renderer.

---

### Task 1: Normalize preset naming data and migrate legacy state

**Files:**
- Modify: `src/features/composite/lib/compositeV2Types.ts`
- Modify: `src/features/composite/lib/compositeV2Defaults.ts`
- Modify: `src/features/composite/storeV2.ts`
- Test: `src/features/composite/storeV2.test.ts`

- [ ] **Step 1: Write failing model and migration tests**

Add tests that require explicit templates and independent variable values:

```ts
it('creates presets with explicit naming fields', () => {
  const preset = createDefaultCompositeV2Preset(1)
  expect(preset).toMatchObject({
    subfolderTemplate: '{date}-{preset}-{size}-{channel}',
    filenameTemplate: '{preset}-{source}-{index}',
    customVariableValues: {},
  })
})

it('migrates legacy per-preset variables without merging their values', () => {
  const migrated = migrateCompositeV2PersistedState({
    presets: [
      { ...legacyPresetA, namingTemplate: '{project}', customVariables: [{ id: 'a', name: 'project', value: '项目A' }] },
      { ...legacyPresetB, namingTemplate: '{project}', customVariables: [{ id: 'b', name: 'project', value: '项目B' }] },
    ],
  }, 1)
  expect(migrated.presets?.map((preset) => preset.customVariableValues)).toEqual([
    { project: '项目A' },
    { project: '项目B' },
  ])
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
npx vitest run src/features/composite/storeV2.test.ts
```

Expected: FAIL because explicit fields and exported migration helper do not exist.

- [ ] **Step 3: Add the explicit preset fields**

Update `CompositeV2Preset`:

```ts
export type CompositeV2Preset = {
  id: string
  name: string
  outputRootPath: string
  distributionPath: string
  subfolderTemplate: string
  filenameTemplate: string
  customVariableValues: Record<string, string>
  namingTemplate?: string
  baseCanvas: { width: number; height: number }
  sampleBackgroundPath: string
  layers: CompositeV2Layer[]
  useOutputOverrides: boolean
  outputRuleGroupsOverride: CompositeV2OutputRuleGroup[]
  updatedAt: number
}
```

Initialize new/default presets with explicit templates and `{}` values.

- [ ] **Step 4: Extract and apply an idempotent migration helper**

Add an exported pure helper used by Zustand `migrate`:

```ts
export function migrateCompositeV2PersistedState(
  persistedState: unknown,
  version: number,
): CompositeV2PersistedState {
  const legacy = persistedState as LegacyCompositeV2PersistedState
  const presets = (legacy.presets ?? []).map((preset) => ({
    ...preset,
    subfolderTemplate: preset.subfolderTemplate || preset.namingTemplate || DEFAULT_SUBFOLDER_TEMPLATE,
    filenameTemplate: preset.filenameTemplate || preset.namingTemplate || DEFAULT_FILENAME_TEMPLATE,
    customVariableValues: preset.customVariableValues
      ?? Object.fromEntries((preset.customVariables?.length ? preset.customVariables : legacy.customVariables ?? [])
        .map((variable) => [variable.name, variable.value])),
  }))
  return { ...legacy, presets } as CompositeV2PersistedState
}
```

Remove only the legacy per-preset `customVariables` property during normalization. Preserve `namingTemplate` as read-compatible migration input until Task 4 removes runtime use.

- [ ] **Step 5: Run the model tests and verify GREEN**

Run:

```powershell
npx vitest run src/features/composite/storeV2.test.ts
```

Expected: all store tests pass.

- [ ] **Step 6: Commit**

```powershell
git add src/features/composite/lib/compositeV2Types.ts src/features/composite/lib/compositeV2Defaults.ts src/features/composite/storeV2.ts src/features/composite/storeV2.test.ts
git commit -m "fix: isolate preset naming data"
```

### Task 2: Update preset-specific variable values safely

**Files:**
- Modify: `src/features/composite/storeV2.ts`
- Test: `src/features/composite/storeV2.test.ts`

- [ ] **Step 1: Write failing preset isolation tests**

```ts
it('updates a custom variable value for only one preset', () => {
  const store = createCompositeV2Store()
  const first = store.getState().presets[0]!
  store.getState().createPreset('第二预设')
  const second = store.getState().presets[1]!

  store.getState().setPresetCustomVariableValue(first.id, 'project', '项目A')
  store.getState().setPresetCustomVariableValue(second.id, 'project', '项目B')

  expect(store.getState().presets[0]!.customVariableValues.project).toBe('项目A')
  expect(store.getState().presets[1]!.customVariableValues.project).toBe('项目B')
})

it('removes deleted variable values from every preset', () => {
  const store = createCompositeV2Store()
  store.getState().removeCustomVariable('project')
  expect(store.getState().presets.every((preset) => !('project' in preset.customVariableValues))).toBe(true)
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
npx vitest run src/features/composite/storeV2.test.ts
```

Expected: FAIL because the preset-specific setter and cleanup action do not exist.

- [ ] **Step 3: Implement minimal actions**

Add actions:

```ts
setPresetCustomVariableValue: (presetId, name, value) => setWithHistory((state) => ({
  presets: updatePresets(state.presets, presetId, (preset, now) => ({
    ...preset,
    customVariableValues: { ...preset.customVariableValues, [name]: value },
    updatedAt: now,
  })),
}), `preset:${presetId}:naming-values`),

removeCustomVariable: (name) => setWithHistory((state) => ({
  customVariables: state.customVariables.filter((variable) => variable.name !== name),
  presets: state.presets.map((preset) => {
    const customVariableValues = { ...preset.customVariableValues }
    delete customVariableValues[name]
    return { ...preset, customVariableValues }
  }),
}), 'naming:custom-variables'),
```

When creating or duplicating presets, clone `customVariableValues` rather than sharing it.

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```powershell
npx vitest run src/features/composite/storeV2.test.ts
```

Expected: all store tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/features/composite/storeV2.ts src/features/composite/storeV2.test.ts
git commit -m "fix: scope naming values to presets"
```

### Task 3: Separate raw templates from resolved preview in the editor

**Files:**
- Modify: `src/features/composite/components/PresetNamingFields.tsx`
- Modify: `src/features/composite/components/PresetManagementTab.tsx`
- Test: `src/features/composite/components/PresetNamingFields.test.ts`
- Test: `src/features/composite/components/PresetManagementTab.test.tsx`

- [ ] **Step 1: Write failing component tests**

Cover both fields and preset switching:

```ts
it('shows raw directory and filename templates with a separate preview', () => {
  const preset = {
    ...createDefaultCompositeV2Preset(1),
    subfolderTemplate: '{project}/{size}',
    filenameTemplate: '{preset}-{index}',
    customVariableValues: { project: '项目A' },
  }
  const { renderer } = renderFields(preset)
  expect(renderer.root.findByProps({ 'aria-label': `预设目录模板 ${preset.name}` }).props.value)
    .toBe('{project}/{size}')
  expect(renderer.root.findByProps({ 'aria-label': `预设文件名模板 ${preset.name}` }).props.value)
    .toBe('{preset}-{index}')
  expect(renderer.root.findByProps({ 'data-testid': 'preset-naming-preview' }).children.join(''))
    .toContain('项目A')
})

it('switches to the selected preset values without updating the previous preset', () => {
  const presetA = {
    ...createDefaultCompositeV2Preset(1),
    subfolderTemplate: 'A/{project}',
    filenameTemplate: 'A-{index}',
    customVariableValues: { project: '项目A' },
  }
  const presetB = {
    ...createDefaultCompositeV2Preset(2),
    id: 'preset-b',
    name: 'Preset B',
    subfolderTemplate: 'B/{project}',
    filenameTemplate: 'B-{index}',
    customVariableValues: { project: '项目B' },
  }
  const onUpdatePreset = vi.fn()
  const { renderer } = renderFields(presetA, [], onUpdatePreset)

  act(() => renderer.update(createElement(PresetNamingFields, {
    preset: presetB,
    customVariables: [],
    previewValues: { date: '20260702', channel: '渠道', size: '1280x720', preset: presetB.name, index: '1' },
    onUpdatePreset,
    onAddCustomVariable: vi.fn(),
    onUpdateCustomVariableValue: vi.fn(),
    onRemoveCustomVariable: vi.fn(),
  })))

  expect(renderer.root.findByProps({ 'aria-label': `预设目录模板 ${presetB.name}` }).props.value)
    .toBe('B/{project}')
  expect(renderer.root.findByProps({ 'aria-label': `预设文件名模板 ${presetB.name}` }).props.value)
    .toBe('B-{index}')
  expect(onUpdatePreset).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run component tests and verify RED**

Run:

```powershell
npx vitest run src/features/composite/components/PresetNamingFields.test.ts src/features/composite/components/PresetManagementTab.test.tsx
```

Expected: FAIL because the two controlled fields and preview are absent.

- [ ] **Step 3: Replace the contentEditable template with explicit controlled inputs**

Change `PresetNamingFields` props to update the current preset directly:

```ts
type Props = {
  preset: CompositeV2Preset
  customVariables: CompositeV2CustomVariable[]
  previewValues: Record<string, string>
  onUpdatePreset: (patch: Partial<CompositeV2Preset>) => void
  onAddCustomVariable: (name: string, value: string) => void
  onUpdateCustomVariableValue: (name: string, value: string) => void
  onRemoveCustomVariable: (name: string) => void
}
```

Render controlled text inputs for `subfolderTemplate` and `filenameTemplate`. Resolve a read-only preview with:

```ts
const resolvedValues = {
  ...previewValues,
  ...preset.customVariableValues,
}
```

Keep variable insertion, but track selection independently for each template field. Clear selection and unsubmitted custom-variable state when `preset.id` changes.

- [ ] **Step 4: Wire preset-specific actions from `PresetManagementTab`**

Pass the selected preset ID to value updates:

```tsx
<PresetNamingFields
  preset={activePreset}
  customVariables={store.customVariables}
  previewValues={namingPreviewValues}
  onUpdatePreset={(patch) => store.updatePreset(activePreset.id, patch)}
  onAddCustomVariable={(name, value) => store.addCustomVariable(name, value, activePreset.id)}
  onUpdateCustomVariableValue={(name, value) =>
    store.setPresetCustomVariableValue(activePreset.id, name, value)}
  onRemoveCustomVariable={store.removeCustomVariable}
/>
```

- [ ] **Step 5: Run component tests and verify GREEN**

Run:

```powershell
npx vitest run src/features/composite/components/PresetNamingFields.test.ts src/features/composite/components/PresetManagementTab.test.tsx
```

Expected: all naming and preset management tests pass.

- [ ] **Step 6: Commit**

```powershell
git add src/features/composite/components/PresetNamingFields.tsx src/features/composite/components/PresetManagementTab.tsx src/features/composite/components/PresetNamingFields.test.ts src/features/composite/components/PresetManagementTab.test.tsx
git commit -m "fix: separate preset naming inputs and preview"
```

### Task 4: Make export use only the current preset naming configuration

**Files:**
- Modify: `src/features/composite/lib/compositeExportRuntime.ts`
- Modify: `src/features/composite/lib/compositePathTemplates.ts`
- Test: `src/features/composite/lib/compositePathTemplates.test.ts`
- Test: `src/features/composite/lib/compositeExportRuntime.test.ts`

- [ ] **Step 1: Write failing path and runtime tests**

```ts
it('uses independent values for presets with the same variable name', () => {
  const presetA = { ...basePreset, customVariableValues: { project: '项目A' } }
  const presetB = { ...basePreset, id: 'b', customVariableValues: { project: '项目B' } }
  expect(buildPresetOutputPathParts(presetA, vars).subfolders).toEqual(['项目A'])
  expect(buildPresetOutputPathParts(presetB, vars).subfolders).toEqual(['项目B'])
})

it('does not fall back to legacy namingTemplate during export', async () => {
  const preset = {
    ...basePreset,
    namingTemplate: '{legacy}',
    subfolderTemplate: '{preset}',
    filenameTemplate: '{source}',
    customVariableValues: {},
  }
  const parts = buildPresetOutputPathParts({
    preset,
    outputRule: { channelName: '百度', name: '1280x720' },
    background: { name: 'source.png', relativeDir: '' },
    date: '20260702',
    index: 1,
    custom: '',
  } as CompositeV2ExportItem, {
    preserveSourceDir: false,
  })
  expect(parts).toEqual({
    subfolders: [preset.name],
    filename: 'source.jpg',
  })
})
```

- [ ] **Step 2: Run export tests and verify RED**

Run:

```powershell
npx vitest run src/features/composite/lib/compositePathTemplates.test.ts src/features/composite/lib/compositeExportRuntime.test.ts
```

Expected: FAIL because runtime still uses global values and fallback chaining.

- [ ] **Step 3: Use the selected preset's explicit naming values**

Export a focused `buildPresetOutputPathParts` helper and use it from the runtime loop:

```ts
export function buildPresetOutputPathParts(
  item: CompositeV2ExportItem,
  snapshot: Pick<CompositeV2ExportSnapshot, 'preserveSourceDir'>,
) {
  return buildCompositeOutputPathParts({
    date: item.date,
    channel: item.outputRule.channelName,
    size: item.outputRule.name,
    preset: item.preset.name,
    index: item.index,
    source: item.background.name.replace(/\.[^.]+$/, ''),
    sourceDir: item.background.relativeDir,
    custom: item.custom,
    customVariables: item.preset.customVariableValues,
    namingTemplate: item.preset.subfolderTemplate,
    filenameTemplate: item.preset.filenameTemplate,
    preserveSourceDir: snapshot.preserveSourceDir,
  })
}
```

Do not read `preset.namingTemplate` in export code.

- [ ] **Step 4: Run export tests and verify GREEN**

Run:

```powershell
npx vitest run src/features/composite/lib/compositePathTemplates.test.ts src/features/composite/lib/compositeExportRuntime.test.ts
```

Expected: all export path tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/features/composite/lib/compositeExportRuntime.ts src/features/composite/lib/compositePathTemplates.ts src/features/composite/lib/compositePathTemplates.test.ts src/features/composite/lib/compositeExportRuntime.test.ts
git commit -m "fix: export with preset-scoped naming"
```

### Task 5: Verify compatibility and complete the branch

**Files:**
- Verify all modified files

- [ ] **Step 1: Run focused composite tests**

```powershell
npx vitest run src/features/composite
```

Expected: all composite tests pass.

- [ ] **Step 2: Run the complete test suite**

```powershell
npm test
```

Expected: all test files and tests pass.

- [ ] **Step 3: Run the production build**

```powershell
npm run build
```

Expected: TypeScript and Vite builds succeed; existing chunk-size warnings are acceptable.

- [ ] **Step 4: Inspect the final diff**

```powershell
git status --short
git diff --check
git log --oneline -5
```

Expected: only planned files are changed, no whitespace errors, and task commits are present.
