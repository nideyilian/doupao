# Composite Editor Fixes

## Scope

Fix four regressions in the Composite V2 workflow without changing the current layout:

1. Persist the selected LOGO library folder and reload its assets when preset management opens.
2. Render image and text layers in the preset editor even when no sample background is configured.
3. Restore the vertical offset field for anchor positioning.
4. Add a select-all checkbox to every channel in global and preset-specific output rules.

## Design

### LOGO Library

Store only `logoLibraryPath` in the persisted Composite V2 state. Keep loaded thumbnails in component memory and rescan the saved folder on mount. This avoids persisting large data URLs while preserving the selected library across restarts.

### Preset Canvas

Allow the renderer to receive an optional background. The editor always mounts and renders its canvas when a preset is selected. If no sample background is available, it clears to a neutral transparent canvas and renders the preset layers normally.

### Layer Position

Show both horizontal and vertical offsets when the selected layer uses anchor mode. Each field updates only its matching position property.

### Channel Selection

Each channel header gets a checkbox. Its checked state means every size in that channel is enabled. Toggling it updates all sizes in the channel. Apply the same interaction to global rules and preset override rules.

## Verification

- Store tests prove the LOGO path is persisted.
- Preset management tests prove the saved LOGO path is rescanned.
- Renderer/editor tests prove layers render without a sample background.
- Layer panel tests prove vertical offset is present and editable.
- Batch and preset management tests prove channel select-all toggles every child rule.
- Run the full test suite, production build, and desktop visual verification.
