# Composite Postprocess V2 Redesign

## Goal

Reshape the current composite postprocess workspace around the actual batch product-image workflow.

The implementation should reuse useful parts of the existing `src/features/composite` module, especially output preset concepts, canvas rendering, local asset handling, and Electron filesystem boundaries. The page flow and data model may change substantially where the current model does not match the required workflow.

## Approved Approach

Use a structural redesign inside the existing composite feature module.

- Keep reusable composite rendering, output preset, asset, and export logic where it fits.
- Replace the current mixed product/category/page model with concepts that map directly to the workflow.
- Organize the postprocess module as two main tabs: batch export and preset management.
- Avoid keeping parallel old and new composite modules long-term.

## Core Workflow

The batch workflow starts by selecting a local background image folder.

The user can choose whether to read only the selected folder or recursively include child folders. All supported images are loaded into a background pool by default. There is no required image list selection step. The preview canvas randomly displays one background image from the pool while preserving the image's original ratio.

The user then selects exactly one watermark preset group. A group contains references to global watermark presets. Each preset represents one independent product-image output scheme. Selecting more presets means exporting more product variants, not stacking multiple presets together.

For each enabled preset, every background image is processed against every enabled output channel and size rule. The output count is:

```text
total = sum(backgroundCount * enabledOutputRuleCountForPreset)
```

For example, with 100 backgrounds, preset A using 3 output rules and preset B using 5 output rules, the total output count is `100 * 3 + 100 * 5 = 800`.

## Batch Export Page

The batch export page is task-oriented.

Suggested layout:

- Left: background folder and task settings.
- Center: preview canvas.
- Right: selected preset group and this-run preset selection.
- Bottom: progress, result summary, and history access.

Required behavior:

- Select a background folder.
- Toggle recursive loading.
- Load supported image formats.
- Sort non-recursive backgrounds by natural file name.
- Sort recursive backgrounds by natural folder path, then natural file name inside each folder.
- Randomly preview one background after loading.
- Provide "random next" preview.
- Support previous and next navigation through already previewed backgrounds.
- Preview one selected preset at a time.
- Use preset checkbox state only to decide whether a preset participates in this export.
- Use preset selection state only to decide which preset is shown in preview.
- Keep export order aligned with the order of presets inside the selected group.

The batch page includes one global `{custom}` value entered before export. This value is shared by all enabled presets and only applies to output path and filename templates.

## Preset Management Page

The preset management page is for long-lived assets.

Suggested layout:

- Left: watermark preset groups.
- Middle: global watermark preset library.
- Right: preset editor.

Watermark preset groups support:

- Create.
- Rename.
- Delete.
- Duplicate.
- Add existing global presets.
- Remove preset references.
- Reorder presets.
- Duplicate a preset from inside a group.

When a preset is duplicated inside a group, the app creates a new global preset and adds that new preset to the current group. The copy is independent from the original.

The global preset library supports:

- Create preset.
- Duplicate preset.
- Delete preset.
- Search by name.
- Filter by group membership.
- Sort or filter by recent edit time.

Global presets do not need enabled or disabled state. Whether a preset exports in a run is controlled only by the selected group and this-run temporary checkboxes.

## Preset Data Model

Recommended main concepts:

- `WatermarkPreset`: one product-image scheme.
- `WatermarkPresetGroup`: an ordered list of global preset IDs.
- `OutputRuleGroup`: one output channel, such as Baidu or vendor.
- `OutputSizeRule`: one size and max-KB rule under a channel.
- `ExportJobSnapshot`: frozen export configuration created when an export starts.
- `ExportHistoryRecord`: persisted export result record.

Each watermark preset stores:

- Name.
- Output root folder.
- Design base size, defaulting to `1280x720`.
- Optional sample background image for preset editing.
- Image and text layers.
- Optional output rule overrides.
- Updated timestamp for recent-edit sorting.

Image assets support both reference modes:

- Save the original absolute local path.
- Import a copy into the app's data directory and reference that internal asset.

## Preset Groups

A preset group references global presets; it does not own private preset copies by default.

The same global preset can be used in multiple groups. Editing the global preset updates all groups that reference it.

Group order matters:

- It controls display order in the batch export page.
- It controls export order.
- It controls result summary order.

Only one preset group can be selected for a single export run.

## Layer Editor

The preset editor should be canvas-first, with form controls for precise adjustments.

Layer types in the first version:

- Image layer.
- Text layer.

There is no separate image-plus-text layer type. Combined layouts are built by arranging normal image and text layers.

Layer list order is top-to-bottom visually:

- First list item is the topmost layer.
- Later list items are lower layers.

Each layer supports:

- Select.
- Show or hide.
- Lock.
- Delete.
- Duplicate.
- Reorder.
- Drag on canvas.
- Resize on canvas.
- Precise editing through form fields.

Each layer chooses its own positioning mode:

- Anchor mode: nine-position anchor with margin, offset, and scale.
- Free mode: x, y, width, and height.

The user chooses the positioning mode manually. Dragging updates parameters inside the current mode. The app does not auto-switch modes or auto-snap a dragged layer into anchor mode.

Position values are interpreted against the preset design base size. During preview and export, the app maps layer position and size to the active canvas using width and height scaling plus margin rules.

## Image Layers

Image layers support:

- Local image path or imported internal asset.
- Opacity.
- Rotation.
- Border radius or clipping.
- Shadow.

Image variable replacement is not part of the first version. Later versions may support switching image assets by channel, size, or `{custom}`.

## Text Layers

Text layers support:

- Fixed text.
- Font family.
- Font size.
- Text color.
- Font weight.
- Stroke.
- Shadow.
- Opacity.
- Alignment.
- Line height.
- Letter spacing.
- Multiline text.

Text variable replacement is not part of the first version.

## Floating Editor Sidebars

Keep the existing floating side-panel interaction pattern for the preset editor.

### Logo Library Sidebar

The floating logo library should remain available near the canvas.

Required behavior:

- Select a local logo or icon folder.
- Refresh the folder.
- Show supported assets as thumbnail cards.
- Support `png`, `jpg`, `jpeg`, and `webp`.
- Click an asset to replace the selected image layer.
- If no image layer is selected, click an asset to create a new image layer.
- Preserve the two asset-reference modes: absolute local path and imported internal asset.

### Layer Type Toolbar

The floating vertical layer-type toolbar should remain available near the canvas.

First-version active actions:

- Add text layer.
- Add image layer.

Shape buttons can keep the visual pattern only if they are clearly disabled or hidden. Shape layers are not in first-version scope.

## Output Rules

The existing global output channel and size concept should remain.

Global output rules define:

- Channel name, such as `广点通/头条`, `百度`, or `厂商`.
- Size name, usually `widthxheight`.
- Width.
- Height.
- Max KB.
- Enabled state.

Each preset uses global output rules by default.

A preset can enable a full output override. Preset-level overrides can change:

- Which channels and sizes are enabled.
- Width.
- Height.
- Max KB.
- Subfolder template.
- Filename template.

Preset-level overrides do not change the global non-proportional background fit mode. That fit mode is configured globally and shared by all channels and sizes.

First-version output format is fixed to JPG. PNG and WebP output are later extensions.

## Output Paths And Variables

Each preset has its own output root folder.

For every export run, the app creates a date folder under the preset output root. The date format is `YYYYMMDD`, such as `20260627`.

Default output path:

```text
presetOutputRoot / date / templateSubfolder / filename.jpg
```

If preserving source subfolders is enabled:

```text
presetOutputRoot / date / templateSubfolder / sourceSubfolder / filename.jpg
```

Supported template variables:

- `{date}`: current export date in `YYYYMMDD`.
- `{channel}`: output channel name.
- `{size}`: output size name.
- `{preset}`: watermark preset name.
- `{index}`: index for the current preset and output rule.
- `{source}`: source background filename without extension.
- `{sourceDir}`: source background relative folder.
- `{custom}`: one global value entered before export.

`{index}` is not zero-padded.

`{index}` resets independently for every preset and every channel-size rule. For example, preset A / Baidu / `1080x1920` indexes backgrounds from `1` to `N`, and preset A / Vendor / `320x211` also indexes from `1` to `N`.

When the target filename already exists, the app automatically appends a suffix to avoid overwriting.

## Rendering Rules

Preview rendering:

- Batch preview uses the current random background's original ratio.
- The selected preset is rendered over that background.
- Preset management preview uses the preset sample background.
- If no sample background exists, the editor can use an empty canvas or the current batch background.

Export rendering:

Each export item contains:

- Background image.
- Preset.
- Channel.
- Size rule.
- Index.
- Custom value.

Before drawing, compare the source background ratio and target output ratio.

If ratios are equal or close enough:

- Draw the preset layers on the source background at source size.
- Scale the complete result to the target output size.

If ratios are not equal:

- First fit the background to the target output size.
- Then draw preset layers on the target canvas.

Global non-proportional fit modes:

- Crop fill: scale proportionally until the target canvas is filled, then crop overflow.
- Contain with blur fill: scale proportionally until the full image is visible, then fill empty space with a blurred version of the same background.
- Stretch: resize directly to the target size without preserving ratio.

## JPG Compression

JPG compression should honor each output size rule's max KB as closely as practical.

Rules:

- Start at quality `0.9`.
- Search automatically between `0.5` and `0.9`.
- Prefer the highest quality that does not exceed max KB.
- If quality `0.5` still exceeds max KB, save the `0.5` result and mark the output item with a warning.

Warnings do not make an item fail. They appear on successful output records.

## Export Runtime Behavior

Starting an export creates an immutable snapshot of:

- Background list.
- Recursive setting.
- Selected preset group.
- This-run enabled preset IDs.
- Full preset layer data.
- Global output rules.
- Preset-level output overrides.
- Output root folders.
- Path and filename templates.
- Custom value.
- Global fit mode.

During export, the user may switch to preset management and edit presets. Those edits do not affect the running export. They apply to future exports.

Runtime controls:

- Pause.
- Resume.
- Cancel.

Cancel behavior:

- Ask whether to keep or delete files already written by this run.
- If files are kept, the record remains as canceled with existing success, warning, and failure details.
- If files are deleted, record which deletions succeeded or failed.

Item failures should not stop the entire export. Failed items are skipped, the export continues, and the final result shows a failure list.

Failure details include:

- Background file.
- Preset.
- Channel.
- Size.
- Reason.

## Export Results And History

After export, show:

- Total planned count.
- Success count.
- Failure count.
- Successful output path list.
- Warning markers on successful items.
- Summary by preset.
- Summary by channel and size.
- Failure list with reasons.

Export history is persisted locally.

History retention:

- Default: 10 records.
- User configurable.
- Older records are removed when the limit is exceeded.

Each history record includes:

- Job ID.
- Status: completed, canceled, or completed with failures.
- Start time.
- End time.
- Background folder.
- Recursive setting.
- Background count.
- Preset group name.
- Enabled preset count.
- Planned output count.
- Success count.
- Failure count.
- Successful output items and paths.
- Warning markers and reasons.
- Failed items and reasons.
- Cancel cleanup result when applicable.

## Reuse And Refactor Scope

Reuse where practical:

- Global output preset defaults from the current composite feature.
- Existing canvas rendering and image composition helpers after adapting them to the new workflow.
- Electron IPC methods for selecting folders, reading images, listing images, and writing outputs.
- Existing composite asset handling patterns.
- Existing pure logic test patterns for output presets, distribution, assets, and history.
- Existing compact UI styling and floating editor side-panel visual treatment.

Reshape or replace:

- Current product/category/page concepts that do not match the new workflow.
- Current preset group semantics where they imply stacking multiple presets instead of exporting independent product variants.
- Current export runtime if it reads live store state instead of a frozen snapshot.
- Current history if it only stores the latest summary.

## First-Version Scope

The first implementation should complete the core end-to-end workflow:

- Batch export page.
- Preset management page.
- Global preset library.
- Preset groups.
- Multi-layer image and text editor.
- Floating logo library sidebar.
- Floating layer-type toolbar.
- Background folder loading.
- Global output rules.
- Preset output overrides.
- JPG output and max-KB compression.
- Path and filename templates.
- Pause, resume, cancel.
- Persistent export history.

Out of first-version scope:

- Variable image replacement by channel, size, or custom value.
- Variable text replacement.
- PNG and WebP output.
- More complex batch quantity distribution modes.
- Exporting multiple preset groups in one run.
- Per-size fit mode overrides.
- Shape layers.

## Testing Strategy

Prioritize pure logic tests before UI wiring.

Core tests:

- Non-recursive background natural sorting.
- Recursive folder and filename natural sorting.
- Preset groups reference global presets.
- Duplicating a preset inside a group creates an independent global preset.
- This-run preset checkbox state does not mutate the group.
- Global output rules merge correctly with preset overrides.
- Export count equals `sum(backgroundCount * enabledRuleCountForPreset)`.
- Index resets per preset and per output rule.
- Path template variables resolve correctly.
- Invalid filename characters are sanitized.
- Source subfolder preservation inserts at the configured path level.
- Equal-ratio and non-equal-ratio render branches are selected correctly.
- Crop fill, contain with blur fill, and stretch modes produce the expected render plan.
- JPG quality search chooses the highest acceptable quality.
- Max-KB overflow at quality `0.5` produces a successful item with warning.
- Failed items are recorded and do not stop the export plan.
- Export snapshots are not affected by later preset edits.
- Export history respects the configured retention limit.

Build verification:

- Run focused tests for changed composite logic.
- Run relevant existing composite tests.
- Run the project build before claiming implementation completion.

## Acceptance Criteria

- The postprocess module opens to the redesigned composite workflow.
- A user can select a background folder, optionally recurse child folders, and preview a random background.
- A user can select one preset group, preview one preset at a time, and temporarily choose which group presets export.
- A user can manage global presets and groups from the preset management tab.
- Presets support multiple image and text layers with canvas-first editing.
- Floating logo library and layer-type toolbar interactions are preserved.
- Output rules use global defaults with optional preset-level overrides.
- Export produces `N * K` outputs per enabled preset.
- Output paths use date folders, templates, optional source subfolders, and collision-safe filenames.
- JPG max-KB compression works with success warnings when minimum quality still exceeds the target.
- Export can pause, resume, and cancel.
- Running exports use a snapshot and are unaffected by later preset edits.
- Export history persists locally and respects the configured retention count.
