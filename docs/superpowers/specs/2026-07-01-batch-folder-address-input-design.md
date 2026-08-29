# Batch Folder Address Input Design

## Goal

Fix batch background loading when a user enters a valid image folder path, and replace the current add-then-list interaction with editable address rows.

## Root Cause

The renderer currently sends manually entered paths directly to `composite:list-background-files`.
Electron only authorizes folders selected through the native directory dialog. A manually entered folder outside the default allowed roots fails `assertAllowedRealPath`; the IPC handler catches that failure and returns an empty array. The UI then reports that no supported images were found, which hides the authorization failure.

## Interaction Design

- Show one empty folder address row by default.
- Each row contains:
  - a full-path text input;
  - a browse button that fills that row through the native directory picker;
  - a remove button.
- The **Add folder address** button appends one empty row and does not scan by itself.
- A completed path scans automatically:
  - immediately after paste, Enter, or blur;
  - after a short debounce during ordinary typing.
- Editing, removing, or browsing a row rescans all non-empty unique rows and updates the combined background list.
- Existing persisted folders populate address rows on mount and reload automatically.
- The recursive toggle and reload button rescan the same current rows.
- Keep the existing visual language and show the full path rather than only its final folder name.

## Desktop Boundary

Add a dedicated IPC operation for a user-entered composite background folder. It validates that the path exists, resolves to a real non-symlink directory, authorizes that directory for the session, and then lists supported images.

Keep the existing allowed-root checks for files discovered beneath the authorized directory. Do not make the generic list operation silently authorize arbitrary paths.

Supported extensions remain `.png`, `.jpg`, `.jpeg`, and `.webp`.

## State and Concurrency

- Address-row state is local UI state; persisted non-empty folders remain in the composite store.
- Empty rows are never persisted or scanned.
- Duplicate normalized path strings are scanned once.
- Each scan uses a monotonically increasing request identifier. Results from an older scan must not overwrite a newer edit or recursive-toggle scan.
- If one folder fails, keep its address visible and report the error instead of translating it to “no supported images.”

## Verification

1. Electron helper test: a valid manually supplied folder can be explicitly authorized and scanned.
2. Electron helper test: missing paths, files, and symlink directory escapes are rejected.
3. Component test: one empty address input renders by default.
4. Component test: changing an address automatically scans and persists it without clicking Add.
5. Component test: Add appends an empty input and does not scan.
6. Component test: browsing fills the targeted row; removing a row rescans remaining paths.
7. Component test: stale scan results cannot overwrite the latest rows.
8. Run focused tests, the complete test suite, and the production build.

## Scope

Only batch-export background-folder entry and its Electron authorization/scanning path are changed. Output presets, rendering, export behavior, supported image types, and unrelated composite workspace code remain unchanged.
