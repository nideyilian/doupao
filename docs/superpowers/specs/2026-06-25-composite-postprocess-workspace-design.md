# Composite Postprocess Workspace Design

## Goal

Replace the current postprocess page with a complete Electron-only image compositing and distribution workspace.

The new workspace should implement the full "图片合成与分配" capability described in `C:/Users/tt/Downloads/composite-module-migration-guide.md` and visually adapt the provided prototype at `C:/Users/tt/Desktop/图片合成与分配.html` to the current DOUPAO application shell.

This change must not alter the gallery module or Agent module.

## Assumptions

- The target project is the current repository at `D:\AAA\GPT-IMAGE`.
- Full functionality is required only in the Electron desktop app.
- Browser-only usage may show a clear unsupported state for filesystem-dependent actions.
- The current top navigation and app shell stay intact.
- The postprocess route directly loads the new composite workspace.
- The old watermark-rule postprocess model is not part of the replacement feature.
- Existing unrelated worktree changes are out of scope.

## Non-Goals

- Do not redesign the gallery or Agent modules.
- Do not add a second postprocess sub-tab for the old tool.
- Do not migrate the old watermark template/rule/group state model into the new feature.
- Do not introduce a full backend service if Electron IPC can cover the local filesystem boundary.
- Do not make the web build feature-complete for local Windows paths.

## Product Layout

The postprocess page becomes a dense desktop workbench:

- Left: composite preset tree with first-level categories and second-level pages.
- Center: canvas editor with a preview surface, selected-layer handles, and quick toolbar actions.
- Right: layer list, selected-layer properties, and local icon library.
- Lower region: canvas/source configuration, output rules, batch distribution controls, progress, and recent export records.

The prototype's information architecture should be preserved, but visual styling should follow the current DOUPAO app:

- Tailwind utility styling, matching existing rounded panels, borders, shadows, and light/dark theme behavior.
- Existing header and app-mode navigation remain unchanged.
- Tool controls use compact buttons, segmented controls, checkboxes, inputs, sliders, and icon buttons consistent with current components.
- Avoid copying the prototype's Trae token palette wholesale.

## Feature Scope

### Preset Tree

- First-level categories support add, rename, save, delete, collapse, enable, and disable.
- Second-level pages support add, duplicate, delete, rename, enable, and disable.
- Pages can move between categories.
- Disabled categories exclude all child pages from export, even if child pages are enabled.

### Canvas Configuration

- Configure main canvas width and height.
- Provide common presets: `1280x720`, `1080x1920`, and `800x800`.
- Configure asset pick mode: random or sequential.
- Background path supports file or folder.
- Patch image paths support multiple lines; each line can be a file or folder.
- Folder assets are re-picked during export according to the pick mode.

### Layer Editing

Supported layer types:

- Background image.
- Patch image overlays, including multiple patch layers, mirror, position, and size.
- Main text layer.
- Extra text layers.
- Logo image layer.
- Watermark text layer.
- Color block layer with color, opacity, and radius.

Layer interactions:

- Select, reorder, lock, delete, drag, and resize layers.
- Quick align to horizontal center, vertical center, and four corners.
- Double-click text editing where practical.

### Local File Library

- Select or enter an icon library folder.
- List local `png`, `jpg`, `jpeg`, and `webp` files.
- Show thumbnail previews.
- Click an icon to apply it to the Logo layer.
- Preserve PNG transparency in preview.

### Output Rules

- Main-size output follows canvas width and height.
- Custom-size output supports multiple enabled rules.
- Each output rule supports width, height, output path, naming template, and max KB.
- Output format is JPG.
- Naming templates support at least `{date}`, `{page}`, and `{index}`.
- Exports write files under the configured distribution path using the naming template.

### Distribution Execution

- Support fixed quantity and custom quantity modes.
- Batch count range is `1` to `9999`.
- Date batches can split quantities across consecutive dates.
- Start distribution creates a background export run.
- Progress shows completed count and total count.
- Starting a new run clears the previous export record summary.

### Export Records

- Show the latest run's output paths and output counts.
- Show one summary row per output path.

## Architecture

Add a new feature module:

```text
src/features/composite/
  CompositeWorkspace.tsx
  components/
    CompositePresetTree.tsx
    CompositeConfigPanel.tsx
    CompositeCanvasEditor.tsx
    CompositeLayerPanel.tsx
    CompositeToolbar.tsx
    CompositeIconLibrary.tsx
    CompositeOutputRules.tsx
    CompositeDistributionBar.tsx
    CompositeExportHistory.tsx
  hooks/
    useCompositeCanvas.ts
    useCompositeExport.ts
    useCompositePersistence.ts
  lib/
    compositeTypes.ts
    compositeDefaults.ts
    compositePresetTree.ts
    compositeDistribution.ts
    compositeExportHistory.ts
    compositeAssets.ts
    compositeRenderer.ts
```

Use a composite-specific Zustand store or feature hook. Keep it independent from `src/store.ts` except for safe shared concerns such as toast notifications. Do not reuse `src/storePostprocess.ts` because the old watermark-rule model does not match the full composite workspace.

Replace the `postprocess` lazy import in `src/App.tsx` with `CompositeWorkspace`. Keep gallery and Agent imports, state, and rendering untouched.

## Electron Boundary

Add composite-specific IPC methods in the Electron layer for desktop-only local filesystem work:

- Select file or folder.
- Read an image file as data URL and dimensions.
- List supported image files in a directory.
- Build a preview-safe image URL or data URL for thumbnails.
- Pick an asset from file or folder using random or sequential mode.
- Save JPG output to a target path.
- Join and normalize Windows paths.

Batch orchestration should live mostly in the renderer so canvas preview and output remain consistent. Electron handles filesystem access and final write operations. If compression to max KB cannot be handled cleanly in the renderer, add a focused Electron-side image compression helper rather than introducing a broad local HTTP service.

In non-Electron environments, filesystem actions should be disabled with a concise message.

## Data Persistence

Persist composite configuration under a new storage key, separate from existing postprocess storage:

```text
doupao-composite-workspace-storage
```

Persist:

- Preset categories and pages.
- Active category/page IDs.
- Canvas and layer configuration.
- Output rules.
- Icon library path.
- Recent export history for the latest run.

Do not migrate or mutate `doupao-postprocess-storage`.

## Testing Strategy

Use test-first implementation for pure logic and behavioral changes.

Primary test coverage:

- Preset tree category/page enablement and movement.
- Page duplication preserves nested preset data.
- Disabled category excludes enabled child pages from export.
- Random and sequential asset picking plans.
- Distribution quantity and date-batch expansion.
- Naming template replacement and filename sanitization.
- Output history summarization by path.
- Export progress count never completes early.

Build verification:

- Run focused tests for new composite libs.
- Run existing tests touched by shared types or Electron typings.
- Run `npm run build` before claiming completion.

Manual desktop acceptance:

- Create category and pages, duplicate a page, disable a category, and verify export selection.
- Configure background folder and patch folder; export three random JPGs.
- Switch to sequential mode and verify source assets advance predictably.
- Add custom output size and verify both main and custom outputs write to disk.
- Load PNG Logo from local icon library and verify transparent preview.
- Drag and resize layers on canvas.
- Confirm recent export records show only the latest run summary.

## Risks

- Canvas and export consistency can drift if preview and final output use different renderers.
- Large batch runs can create memory pressure if too many data URLs are retained.
- Windows path normalization must be careful around drive letters and UNC paths.
- Electron IPC typings must stay narrow to avoid weakening the existing security boundary.
- The prototype is visually dense; adapting it to DOUPAO requires preserving utility without overcrowding smaller screens.

## Success Criteria

- The "后期处理" navigation opens the new composite workspace.
- Gallery and Agent behavior remain unchanged.
- Electron desktop can complete the full composite and distribution flow.
- Core logic is covered by focused tests.
- The app builds successfully.
- The UI follows the current DOUPAO shell rather than the prototype's standalone theme.
