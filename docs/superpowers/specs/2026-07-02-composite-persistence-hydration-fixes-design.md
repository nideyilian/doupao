# Composite Persistence Hydration Fixes

## Goal

Fix two confirmed restart-time persistence defects in the composite postprocess V2 workspace:

1. Distribution `startDate` must reset to the current local default when persisted state is hydrated.
2. The selected preset group, selected preview preset, and enabled preset IDs must remain mutually consistent after hydration.

Logo image storage migration is explicitly out of scope.

## Design

Keep Zustand persistence in `storeV2.ts` and make the smallest changes around its persistence boundary.

- Persist `selectedPresetGroupId` and `selectedPreviewPresetId` alongside the existing enabled preset IDs.
- Add a pure hydration merge helper and use it as Zustand's `merge` option.
- Deep-merge `distributionConfig`, preserving the freshly created default `startDate` instead of accepting a missing or stale persisted date.
- Validate hydrated group and preset selections against the hydrated preset library:
  - fall back to the first available preset group when the selected group is missing;
  - fall back to the first preset in that group when the preview preset is missing;
  - retain only enabled preset IDs that belong to the selected group, falling back to all presets in that group when none remain.

All other persisted and transient fields keep their current behavior.

## Testing

Add focused store tests that pass persisted state through JSON serialization before merging:

- hydration restores today's default distribution date while retaining other distribution settings;
- hydration restores a non-default selected group and its preview/enabled preset selections;
- invalid persisted selections fall back to a coherent valid group state.

Run the focused store tests, then the full test suite and TypeScript build.
