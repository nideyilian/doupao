# Layer Properties A2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved compact horizontal layer-properties UI and support outlines on text, image, and LOGO layers.

**Architecture:** Keep the existing `PresetLayerPanel` public API and layer update flow. Add a backward-compatible shared stroke shape to layer data, initialize it for new media layers, and reuse one scaled stroke calculation in the canvas renderer. Recompose the panel into four visual groups without changing unrelated workspace behavior.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Zustand, Canvas 2D, Vitest.

---

### Task 1: Lock the desired panel structure with component tests

**Files:**
- Modify: `src/features/composite/components/PresetLayerPanel.test.tsx`

- [ ] Add assertions for the selected-layer header and `内容`, `位置与尺寸`, `外观`, `效果` groups.
- [ ] Render a LOGO layer and assert `描边`, `描边颜色`, and `描边宽度` are present.
- [ ] Render a text layer and assert its content controls remain present.
- [ ] Run `npm test -- src/features/composite/components/PresetLayerPanel.test.tsx` and confirm the new assertions fail because A2 markup is absent.

### Task 2: Define shared stroke behavior with failing tests

**Files:**
- Modify: `src/features/composite/storeV2.test.ts`
- Modify: `src/features/composite/lib/compositeRendererV2.test.ts`
- Modify: `src/features/composite/lib/compositeV2Types.ts`
- Modify: `src/features/composite/storeV2.ts`
- Modify: `src/features/composite/lib/compositeRendererV2.ts`

- [ ] Assert newly created image and LOGO layers contain a disabled default stroke.
- [ ] Assert a shared stroke-width helper scales width from the preset canvas to the target canvas.
- [ ] Run the focused store and renderer tests and confirm the assertions fail for missing media stroke support.
- [ ] Add `CompositeV2Stroke`, expose a backward-compatible optional stroke on the layer base, and initialize new media layers.
- [ ] Draw media strokes after the image using a rounded path when radius is present.
- [ ] Run the focused tests and confirm they pass.

### Task 3: Implement the approved A2 panel

**Files:**
- Modify: `src/features/composite/components/PresetLayerPanel.tsx`

- [ ] Add the selected-layer header with type badge, visible toggle, and lock toggle.
- [ ] Replace the seven-column rows with four horizontally arranged groups separated by subtle dividers.
- [ ] Pair position and size fields and shorten labels to X/Y and W/H while retaining full accessible titles.
- [ ] Put type-specific text or asset controls in the content group.
- [ ] Put shared outline controls in the effects group and disable color/width when outline is off.
- [ ] Keep shadow controls adjacent and disabled when shadow is off.
- [ ] Run the component test and confirm it passes.

### Task 4: Regression verification

**Files:**
- Verify: `src/features/composite/**`

- [ ] Run `npm test -- src/features/composite/components/PresetLayerPanel.test.tsx src/features/composite/lib/compositeRendererV2.test.ts src/features/composite/storeV2.test.ts`.
- [ ] Run `npm run build`.
- [ ] Inspect `git diff --check` and the scoped diff for accidental unrelated edits.

### Task 5: Visual QA against the selected mock

**Files:**
- Modify: `design-qa.md`

- [ ] Start the local app and open the preset layer panel with a selected LOGO layer.
- [ ] Capture the implementation at the same wide desktop state as the reference.
- [ ] Compare reference and implementation for hierarchy, group order, spacing, control density, borders, and responsive wrapping.
- [ ] Fix all P0–P2 discrepancies and repeat the comparison.
- [ ] Record `final result: passed` only after the blocking comparison succeeds.
