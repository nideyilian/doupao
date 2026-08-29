# Composite Preset Editor Interaction Design

## Goal

Improve preset editing without changing the existing visual language:

- Separate LOGO layers from ordinary image layers.
- Make LOGO library clicks replace the intended LOGO layer.
- Make text layers content-sized, black by default, padded, and directly editable on the preview.
- Stack preset groups and global watermark presets vertically.
- Let the preview fill the remaining workspace.
- Move layer information into a fixed bottom overlay inside the preview.

## Layer Model

### LOGO And Image Layers

`logo` and `image` are separate persisted layer types with the same shared media properties:

- asset
- position
- opacity
- rotation
- shadow
- corner radius
- clipping

The image toolbar creates an `image` layer. The LOGO library creates or replaces only a `logo` layer.

When a LOGO asset is clicked:

1. Replace the selected layer when it is a `logo`.
2. Otherwise replace the first `logo` layer in visual top-to-bottom order.
3. If no `logo` layer exists, create one and select it.

Ordinary image layers are never changed by the LOGO library.

Existing persisted image layers remain `image` layers. No automatic migration guesses whether an older image was intended to be a LOGO.

## Text Layers

New text layers use:

- text: `New Text`
- color: `#000000`
- padding: `5`

Text layer width and height follow the current content, font size, font family, font weight, line height, letter spacing, and padding. The box recalculates whenever one of those values changes. Multiline text uses the longest line for width and the number of lines for height.

The padding field is editable in pixels and is persisted with the text layer.

## Direct Text Editing

Double-clicking a text layer on the preview:

- selects the layer;
- opens an in-place multiline editor over the rendered text;
- updates text and box dimensions while typing;
- commits on blur or `Ctrl+Enter`;
- cancels and restores the starting text on `Escape`.

Dragging remains the single-pointer interaction. Entering edit mode clears any active drag operation.

## Preset Management Layout

The page becomes a two-column workspace:

- Left column: preset groups on top, global watermark presets below.
- Right column: preview editor filling all remaining width and height.

Inside the preview:

- layer creation toolbar remains floating on the left;
- LOGO library remains floating on the right;
- layer information becomes a fixed horizontal overlay along the bottom, ending before the LOGO library.

The layer overlay keeps the existing ordering, visibility, locking, movement, deletion, positioning, and style controls. It scrolls internally instead of increasing page height.

## Rendering

The renderer treats `logo` and `image` identically for pixels while preserving their semantic type for editor behavior. Text measurement is shared by preview hitboxes and output rendering so the editable box matches the exported result.

## Tests

- Store tests cover separate layer types, LOGO replacement priority, black text defaults, and default padding.
- Text measurement tests cover single-line, multiline, font changes, letter spacing, and padding.
- Canvas editor tests cover LOGO replacement selection and direct text edit lifecycle.
- Layout tests cover the stacked left rail and bottom floating layer panel.
- Existing export, render, persistence, and batch tests must remain green.
- Desktop QA verifies replacement, text editing, layout, and output preview behavior.
