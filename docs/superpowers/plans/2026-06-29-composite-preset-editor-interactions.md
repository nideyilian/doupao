# Composite Preset Editor Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate LOGO and image behavior, add content-sized inline-editable text, and rebuild preset management around a full preview workspace with floating controls.

**Architecture:** Extend the persisted layer union with `logo` and text `padding`, keeping media rendering shared. Add focused store actions for LOGO replacement, centralize text box measurement, then make the canvas own direct editing and the floating layer inspector while the management page owns the stacked library rail.

**Tech Stack:** React 19, TypeScript, Zustand persist, Canvas 2D, Vitest, react-test-renderer, Tailwind CSS, Electron.

---

### Task 1: Separate LOGO And Image Layers

**Files:**
- Modify: `src/features/composite/lib/compositeV2Types.ts`
- Modify: `src/features/composite/storeV2.ts`
- Modify: `src/features/composite/storeV2.test.ts`
- Modify: `src/features/composite/lib/compositeRendererV2.ts`
- Modify: `src/features/composite/components/PresetLayerPanel.tsx`

- [ ] Add failing tests proving `addImageLayer` creates `image`, `replaceOrAddLogoLayer` creates `logo`, selected LOGO replacement wins, fallback replacement uses the first LOGO, and ordinary images remain unchanged.
- [ ] Run `npx vitest run src/features/composite/storeV2.test.ts` and confirm failures are caused by the missing LOGO type/action.
- [ ] Add `CompositeV2MediaLayer` shared fields, `CompositeV2ImageLayer` and `CompositeV2LogoLayer` discriminants, plus:

```ts
replaceOrAddLogoLayer: (
  presetId: string,
  asset: CompositeV2ImageAssetRef,
  selectedLayerId?: string,
) => string
```

- [ ] Render both media types through the same renderer branch and label them separately in the layer inspector.
- [ ] Re-run the focused test and expect it to pass.

### Task 2: Content-Sized Black Text Layers

**Files:**
- Create: `src/features/composite/lib/compositeTextLayout.ts`
- Create: `src/features/composite/lib/compositeTextLayout.test.ts`
- Modify: `src/features/composite/lib/compositeV2Types.ts`
- Modify: `src/features/composite/storeV2.ts`
- Modify: `src/features/composite/storeV2.test.ts`
- Modify: `src/features/composite/lib/compositeRendererV2.ts`
- Modify: `src/features/composite/components/PresetLayerPanel.tsx`

- [ ] Add failing tests for black text defaults, `padding: 5`, single-line width, multiline height, letter spacing, and padding changes.
- [ ] Run the text layout and store tests and confirm the expected failures.
- [ ] Add deterministic text measurement:

```ts
measureCompositeTextBox(layer, measureLine): { width: number; height: number }
```

Use Canvas `measureText` in production and an injected line measurer in unit tests.

- [ ] Recalculate text position width/height whenever text, font family, font size, font weight, line height, letter spacing, or padding changes.
- [ ] Add the padding field to the inspector and use measured dimensions in rendering.
- [ ] Re-run focused tests and expect them to pass.

### Task 3: LOGO Replacement And Inline Text Editing

**Files:**
- Modify: `src/features/composite/components/PresetManagementTab.tsx`
- Modify: `src/features/composite/components/PresetManagementTab.test.tsx`
- Modify: `src/features/composite/components/PresetCanvasEditor.tsx`
- Modify: `src/features/composite/components/PresetCanvasEditor.test.tsx`

- [ ] Add failing component tests proving a LOGO library click calls replacement with the selected layer and that double-clicking a text hitbox opens an in-place textarea.
- [ ] Run both component test files and confirm the controls are missing.
- [ ] Wire LOGO clicks to `replaceOrAddLogoLayer`, select the returned LOGO id, and never call `addImageLayer`.
- [ ] Add `editingTextLayerId` and starting-text state. Double-click opens the textarea; input updates text and measured box; blur or `Ctrl+Enter` commits; `Escape` restores starting text.
- [ ] Re-run focused tests and expect them to pass.

### Task 4: Rebuild The Preset Management Layout

**Files:**
- Modify: `src/features/composite/components/PresetManagementTab.tsx`
- Modify: `src/features/composite/components/PresetManagementTab.test.tsx`
- Modify: `src/features/composite/components/PresetCanvasEditor.tsx`
- Modify: `src/features/composite/components/PresetCanvasEditor.test.tsx`
- Modify: `src/features/composite/components/PresetLayerPanel.tsx`

- [ ] Add failing markup tests for a two-column workspace, stacked left rail, full-height preview, and bottom floating layer inspector inside the editor.
- [ ] Run focused tests and confirm the old three-column/bottom-page structure fails.
- [ ] Change management layout to `grid-cols-[300px_minmax(0,1fr)]`; stack group and preset sections in the left rail.
- [ ] Move `PresetLayerPanel` into `PresetCanvasEditor` as an absolute bottom overlay ending before the right LOGO library. Give it bounded height and internal scrolling.
- [ ] Remove the page-level layer panel and let the editor fill available height.
- [ ] Re-run focused tests and expect them to pass.

### Task 5: Verification And Desktop QA

**Files:**
- No production changes expected.

- [ ] Run:

```powershell
npm test
npm run build
git diff --check
```

- [ ] In the running Electron app, verify:
  - image toolbar creates an ordinary image;
  - LOGO click replaces the selected LOGO or creates one;
  - new text is black with 5px padding and content-sized bounds;
  - double-click text editing commits and cancels correctly;
  - left libraries stack vertically;
  - preview fills the remaining workspace;
  - the bottom inspector floats inside the preview without overlapping the LOGO library.
