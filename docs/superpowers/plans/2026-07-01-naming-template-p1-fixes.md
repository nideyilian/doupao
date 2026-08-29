# Naming Template P1 Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent duplicate custom-variable names, insert variables at the last valid template selection, and clear unsubmitted custom-variable drafts when presets change.

**Architecture:** Keep all behavior inside the existing `PresetNamingFields` boundary. Add one pure insertion helper for deterministic tests, retain template-relative selection in refs, and keep validation/draft state local to the active preset.

**Tech Stack:** React 19, TypeScript, Vitest, jsdom

---

### Task 1: Define and test template-relative insertion

**Files:**
- Modify: `src/features/composite/components/PresetNamingFields.test.ts`
- Modify: `src/features/composite/components/PresetNamingFields.tsx`

- [ ] **Step 1: Add failing pure-helper tests**

Import `insertNamingVariable` and add:

```ts
describe('insertNamingVariable', () => {
  it('inserts at a collapsed template selection without adding separators', () => {
    expect(insertNamingVariable('前-{size}-后', 'date', { start: 2, end: 2 })).toEqual({
      template: '前-{date}{size}-后',
      caret: 8,
    })
  })

  it('replaces a selected template range', () => {
    expect(insertNamingVariable('前-旧内容-后', 'size', { start: 2, end: 5 })).toEqual({
      template: '前-{size}-后',
      caret: 8,
    })
  })

  it('appends when there is no valid editor selection', () => {
    expect(insertNamingVariable('{date}', 'index', null)).toEqual({
      template: '{date}{index}',
      caret: 13,
    })
  })
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest run src/features/composite/components/PresetNamingFields.test.ts
```

Expected: FAIL because `insertNamingVariable` is not exported.

- [ ] **Step 3: Implement the minimal pure helper**

Add:

```ts
export type NamingTemplateSelection = {
  start: number
  end: number
}

export function insertNamingVariable(
  template: string,
  name: string,
  selection: NamingTemplateSelection | null,
) {
  const token = `{${name}}`
  if (!selection) {
    return { template: `${template}${token}`, caret: template.length + token.length }
  }

  const start = Math.max(0, Math.min(selection.start, selection.end, template.length))
  const end = Math.max(start, Math.min(Math.max(selection.start, selection.end), template.length))
  return {
    template: `${template.slice(0, start)}${token}${template.slice(end)}`,
    caret: start + token.length,
  }
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
npx vitest run src/features/composite/components/PresetNamingFields.test.ts
```

Expected: all focused tests pass.

### Task 2: Preserve and consume the editor selection

**Files:**
- Modify: `src/features/composite/components/PresetNamingFields.tsx`
- Modify: `src/features/composite/components/PresetNamingFields.test.ts`

- [ ] **Step 1: Add a failing component test for pointer focus preservation**

Render `PresetNamingFields`, find the date variable button, and assert:

```ts
const preset = createDefaultCompositeV2Preset(1)
let renderer: ReturnType<typeof create>

act(() => {
  renderer = create(createElement(PresetNamingFields, {
    preset,
    previewValues: {
      date: '20260701',
      channel: '渠道',
      size: '1280x720',
      preset: preset.name,
      index: '1',
    },
    onUpdate: () => {},
  }))
})

const dateButton = renderer!.root.findByProps({ 'aria-label': '插入变量 {date}' })
const preventDefault = vi.fn()
dateButton.props.onMouseDown({ preventDefault })
expect(preventDefault).toHaveBeenCalledOnce()
```

Add `vi` to the existing Vitest import.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest run src/features/composite/components/PresetNamingFields.test.ts
```

Expected: FAIL because buttons expose no `onMouseDown` selection-preservation
behavior.

- [ ] **Step 3: Store template-relative selections**

Add a preset-scoped ref:

```ts
const savedSelectionRef = useRef<({
  presetId: string
} & NamingTemplateSelection) | null>(null)
```

Add:

```ts
function rememberSelection(editor: HTMLDivElement) {
  const selection = captureSelectionOffsets(editor)
  if (selection) {
    savedSelectionRef.current = { presetId: preset.id, ...selection }
  }
  return selection
}
```

Use it from `syncTemplateFromEditor`, `onMouseUp`, `onKeyUp`, and `onBlur`.
Keep the existing template-offset conversion and selection-restoration helpers.

- [ ] **Step 4: Insert at the saved selection**

Replace unconditional append with:

```ts
function insertVariable(name: string) {
  const saved = savedSelectionRef.current
  const selection = saved?.presetId === preset.id
    ? { start: saved.start, end: saved.end }
    : null
  const inserted = insertNamingVariable(namingTemplate, name, selection)

  pendingSelectionRef.current = { start: inserted.caret, end: inserted.caret }
  savedSelectionRef.current = {
    presetId: preset.id,
    start: inserted.caret,
    end: inserted.caret,
  }
  onUpdate({ namingTemplate: inserted.template })
}
```

On built-in and custom variable buttons add:

```tsx
onMouseDown={(event) => event.preventDefault()}
```

This keeps the browser selection alive during pointer activation while still
allowing keyboard button activation to use the saved selection.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```powershell
npx vitest run src/features/composite/components/PresetNamingFields.test.ts
```

Expected: all focused tests pass.

### Task 3: Reject duplicate names and clear preset-scoped drafts

**Files:**
- Modify: `src/features/composite/components/PresetNamingFields.tsx`
- Modify: `src/features/composite/components/PresetNamingFields.test.ts`

- [ ] **Step 1: Add failing duplicate-name tests**

Add this helper to the test file:

```ts
function renderFields(
  preset = createDefaultCompositeV2Preset(1),
  onUpdate = vi.fn(),
) {
  let renderer: ReturnType<typeof create>
  act(() => {
    renderer = create(createElement(PresetNamingFields, {
      preset,
      previewValues: {
        date: '20260701',
        channel: '渠道',
        size: '1280x720',
        preset: preset.name,
        index: '1',
      },
      onUpdate,
    }))
  })
  return { renderer: renderer!, onUpdate }
}
```

Add the built-in collision test:

```ts
it('rejects a custom variable that uses a built-in name', () => {
  const { renderer, onUpdate } = renderFields()
  const nameInput = renderer.root.findByProps({ 'aria-label': '自定义变量名' })

  act(() => nameInput.props.onChange({ target: { value: 'date' } }))
  act(() => renderer.root.findByProps({ 'aria-label': '添加自定义变量' }).props.onClick())

  expect(onUpdate).not.toHaveBeenCalled()
  expect(renderer.root.findByProps({ 'aria-label': '自定义变量名' }).props.value).toBe('date')
  expect(renderer.root.findByProps({ 'aria-label': '自定义变量名' }).props['aria-invalid']).toBe(true)
  expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toBe('变量名已被使用')
})
```

Add the existing-custom collision test:

```ts
it('rejects an existing custom variable name instead of updating it', () => {
  const preset = {
    ...createDefaultCompositeV2Preset(1),
    customVariables: [{ id: 'custom-project', name: 'project', value: '项目A' }],
  }
  const { renderer, onUpdate } = renderFields(preset)

  act(() => renderer.root.findByProps({ 'aria-label': '自定义变量名' }).props.onChange({
    target: { value: 'project' },
  }))
  act(() => renderer.root.findByProps({ 'aria-label': '添加自定义变量' }).props.onClick())

  expect(onUpdate).not.toHaveBeenCalled()
  expect(preset.customVariables).toEqual([
    { id: 'custom-project', name: 'project', value: '项目A' },
  ])
})
```

- [ ] **Step 2: Add a failing preset-switch test**

```ts
it('clears unsubmitted custom-variable state when the preset changes', () => {
  const presetA = createDefaultCompositeV2Preset(1)
  const presetB = { ...createDefaultCompositeV2Preset(2), id: 'preset-b', name: 'Preset B' }
  const { renderer, onUpdate } = renderFields(presetA)

  act(() => renderer.root.findByProps({ 'aria-label': '自定义变量名' }).props.onChange({
    target: { value: 'date' },
  }))
  act(() => renderer.root.findByProps({ 'aria-label': '自定义变量值' }).props.onChange({
    target: { value: '草稿值' },
  }))
  act(() => renderer.root.findByProps({ 'aria-label': '添加自定义变量' }).props.onClick())

  act(() => {
    renderer.update(createElement(PresetNamingFields, {
      preset: presetB,
      previewValues: {
        date: '20260701',
        channel: '渠道',
        size: '1280x720',
        preset: presetB.name,
        index: '1',
      },
      onUpdate,
    }))
  })

  expect(renderer.root.findByProps({ 'aria-label': '自定义变量名' }).props.value).toBe('')
  expect(renderer.root.findByProps({ 'aria-label': '自定义变量值' }).props.value).toBe('')
  expect(renderer.root.findByProps({ 'aria-label': '自定义变量名' }).props['aria-invalid']).toBeUndefined()
  expect(presetA.customVariables).toEqual([])
  expect(presetB.customVariables).toEqual([])
})
```

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```powershell
npx vitest run src/features/composite/components/PresetNamingFields.test.ts
```

Expected: FAIL because duplicate names still update or add variables and local
draft state survives a `preset.id` change.

- [ ] **Step 4: Implement duplicate validation**

Add:

```ts
const BUILT_IN_VARIABLE_NAMES = new Set(BUILT_IN_VARIABLES.map((variable) => variable.name))
```

Add local error state:

```ts
const [customNameError, setCustomNameError] = useState('')
const customNameErrorId = `preset-custom-variable-name-error-${preset.id}`
```

In `addCustomVariable`, after normalization:

```ts
if (
  BUILT_IN_VARIABLE_NAMES.has(name)
  || customVariables.some((variable) => variable.name === name)
) {
  setCustomNameError('变量名已被使用')
  return
}

onUpdate({
  customVariables: [
    ...customVariables,
    { id: `custom-${Date.now()}-${name}`, name, value: customValue },
  ],
})
setCustomName('')
setCustomValue('')
setCustomNameError('')
```

Clear the current error when the user edits the name. Wrap the name input and
render:

```tsx
<input
  aria-invalid={customNameError ? true : undefined}
  aria-describedby={customNameError ? customNameErrorId : undefined}
  ...
/>
{customNameError && (
  <p id={customNameErrorId} role="alert" className="mt-1 text-[10px] text-red-600 dark:text-red-300">
    {customNameError}
  </p>
)}
```

- [ ] **Step 5: Reset transient state on preset changes**

Add:

```ts
useEffect(() => {
  setCustomName('')
  setCustomValue('')
  setCustomNameError('')
  savedSelectionRef.current = null
  pendingSelectionRef.current = null
}, [preset.id])
```

- [ ] **Step 6: Run the focused test and verify GREEN**

Run:

```powershell
npx vitest run src/features/composite/components/PresetNamingFields.test.ts
```

Expected: all focused tests pass.

### Task 4: Regression and build verification

**Files:**
- Verify: `src/features/composite/components/PresetNamingFields.tsx`
- Verify: `src/features/composite/components/PresetNamingFields.test.ts`
- Verify: `src/features/composite/components/PresetManagementTab.test.tsx`

- [ ] **Step 1: Run naming and preset-management tests**

Run:

```powershell
npx vitest run src/features/composite/components/PresetNamingFields.test.ts src/features/composite/components/PresetManagementTab.test.tsx
```

Expected: both test files pass.

- [ ] **Step 2: Run the complete test suite**

Run:

```powershell
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Run the production build**

Run:

```powershell
npm run build
```

Expected: TypeScript and Vite builds exit with code 0.

- [ ] **Step 4: Inspect the scoped diff**

Run:

```powershell
git diff --check -- src/features/composite/components/PresetNamingFields.tsx src/features/composite/components/PresetNamingFields.test.ts
git diff -- src/features/composite/components/PresetNamingFields.tsx src/features/composite/components/PresetNamingFields.test.ts
```

Expected: changes trace only to the three confirmed P1 fixes. Do not stage or
commit the implementation because both target files already exist as untracked
user work in this workspace; leave them intact for user review.
