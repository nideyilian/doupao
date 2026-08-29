# Composite Workspace Full-Height Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the post-processing workspace fill the viewport below the fixed application header without creating page-level vertical overflow.

**Architecture:** Give `CompositeWorkspace` an explicit height based on the existing `--app-header-offset` token and keep overflow inside the workspace. Remove the two `680px` minimum-height constraints from the preset editor path so its grid and canvas can shrink within that bounded flex layout.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Vitest, react-test-renderer

---

### Task 1: Lock the full-height layout contract with tests

**Files:**
- Modify: `src/features/composite/CompositeWorkspace.test.tsx`
- Modify: `src/features/composite/components/PresetManagementTab.test.tsx`

- [ ] **Step 1: Add a failing workspace-height assertion**

Add this test inside `describe('CompositeWorkspace', ...)`:

```tsx
it('fills the viewport below the fixed application header', () => {
  let renderer!: ReturnType<typeof create>
  act(() => {
    renderer = create(<CompositeWorkspace />)
  })

  const workspace = renderer.root.findByType('main')
  expect(workspace.props.className).toContain('h-[calc(100vh-var(--app-header-offset))]')
  expect(workspace.props.className).toContain('overflow-hidden')
})
```

- [ ] **Step 2: Add failing preset shrink assertions**

Extend the existing `uses a stacked library rail beside a full preview workspace` test:

```tsx
const workspace = renderer!.root.find(
  (node) => node.props['data-layout'] === 'preset-management-workspace',
)
expect(workspace.props.className).toContain('h-full')
expect(workspace.props.className).not.toContain('min-h-[680px]')

const fixedMinimumHeightNodes = renderer!.root.findAll(
  (node) => typeof node.props.className === 'string'
    && node.props.className.includes('min-h-[680px]'),
)
expect(fixedMinimumHeightNodes).toHaveLength(0)
```

- [ ] **Step 3: Run the focused tests and verify the new assertions fail**

Run:

```bash
npm test -- src/features/composite/CompositeWorkspace.test.tsx src/features/composite/components/PresetManagementTab.test.tsx
```

Expected: FAIL because the root workspace does not have the viewport-height and overflow classes, while the preset workspace and canvas editor still use `min-h-[680px]`.

- [ ] **Step 4: Commit the failing tests**

```bash
git add src/features/composite/CompositeWorkspace.test.tsx src/features/composite/components/PresetManagementTab.test.tsx
git commit -m "test: define full-height composite workspace layout"
```

### Task 2: Apply the minimum full-height layout change

**Files:**
- Modify: `src/features/composite/CompositeWorkspace.tsx`
- Modify: `src/features/composite/components/PresetManagementTab.tsx`
- Modify: `src/features/composite/components/PresetCanvasEditor.tsx`

- [ ] **Step 1: Bound the post-processing workspace to the viewport**

Change the `main` class in `CompositeWorkspace.tsx` to:

```tsx
<main className="flex h-[calc(100vh-var(--app-header-offset))] min-h-0 flex-col overflow-hidden bg-gray-50 p-4 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
```

- [ ] **Step 2: Let the preset grid fill and shrink inside its parent**

Change the preset workspace class in `PresetManagementTab.tsx` to:

```tsx
className="grid h-full min-h-0 min-w-[1180px] flex-1 grid-cols-[300px_minmax(0,1fr)] gap-4 overflow-hidden"
```

- [ ] **Step 3: Let the canvas editor shrink inside the preset grid**

Change the root class in `PresetCanvasEditor.tsx` to:

```tsx
<div className="relative h-full min-h-0 overflow-hidden rounded-md border border-gray-200 bg-gray-100 dark:border-white/[0.08] dark:bg-gray-950">
```

- [ ] **Step 4: Run the focused tests**

Run:

```bash
npm test -- src/features/composite/CompositeWorkspace.test.tsx src/features/composite/components/PresetManagementTab.test.tsx
```

Expected: both test files PASS.

- [ ] **Step 5: Run the production build**

Run:

```bash
npm run build
```

Expected: TypeScript and Vite build complete successfully.

- [ ] **Step 6: Verify the rendered layout**

Start the app with:

```bash
npm run dev
```

Open the local Vite URL, switch to `后期处理` → `预设管理`, and verify:

- the workspace bottom edge aligns with the viewport bottom;
- the document does not gain a vertical scrollbar from the preset editor;
- the preset rail, LOGO library, and layer controls remain visible and independently scrollable;
- switching between `批量导出` and `预设管理` still works.

- [ ] **Step 7: Commit the implementation**

```bash
git add src/features/composite/CompositeWorkspace.tsx src/features/composite/components/PresetManagementTab.tsx src/features/composite/components/PresetCanvasEditor.tsx
git commit -m "fix: fill postprocess viewport height"
```
