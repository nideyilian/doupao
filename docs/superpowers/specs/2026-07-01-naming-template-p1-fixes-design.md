# Naming Template P1 Fixes

## Goal

Fix the three highest-priority naming-template interaction defects without
redesigning the editor:

1. prevent duplicate custom-variable names;
2. insert variable tokens at the user's last valid caret or selection;
3. clear unsubmitted custom-variable drafts when switching presets.

The existing behavior where one naming template participates in both directory
and filename generation is intentional and remains unchanged.

## Scope

Change only the naming-template editor component and focused tests. Preserve:

- the existing contenteditable editor and resolved-value chips;
- direct text editing and variable dragging;
- persisted variables that have already been added to a preset;
- current template resolution and export-path behavior;
- the existing visual language.

Do not add final-path previews, restructure separators, redesign drag-and-drop,
or change persistence in this pass.

## Duplicate-Name Validation

Custom-variable names remain normalized using the existing whitespace and brace
removal.

After normalization, adding is rejected when the name matches:

- a built-in variable: `date`, `channel`, `size`, `preset`, or `index`; or
- any existing custom variable on the active preset.

Matching is exact and case-sensitive, consistent with template-token
resolution. Rejected input remains in the fields so the user can correct it.
An inline error is shown beneath the name input, and the input exposes
`aria-invalid` and `aria-describedby`.

Successful addition clears both fields and the error. The previous behavior
that silently updated an existing custom variable is removed.

## Caret-Aware Variable Insertion

The editor records its last valid template-relative selection while the user
edits or moves the caret. The selection belongs to the current preset only.

When the user clicks a built-in or custom variable button:

- a collapsed selection inserts the token at the caret;
- a non-collapsed selection replaces the selected template range;
- if the editor has never supplied a valid selection for the current preset,
  the token is appended to the template.

Insertion adds only `{variableName}`. It does not add, remove, or infer
separators.

After insertion, the editor restores the caret immediately after the inserted
token. Existing rendering continues to show the token as a resolved-value chip.

## Preset Switching

When `preset.id` changes:

- clear the unsubmitted custom-variable name;
- clear the unsubmitted custom-variable value;
- clear any validation error;
- discard any saved caret or selection from the previous preset.

Variables already stored in either preset remain unchanged.

## Testing

Focused component tests will prove:

- built-in names cannot be added as custom variables;
- existing custom names cannot be added again;
- rejected input remains editable and exposes an accessible error;
- a token is inserted at a collapsed caret;
- a token replaces a selected range;
- insertion with no valid editor selection appends;
- insertion never adds a separator;
- insertion restores the caret after the token;
- changing `preset.id` clears unsubmitted fields and errors;
- added variables remain attached to their original preset.

Run the focused naming-field tests, the preset-management tests, the complete
test suite, and the production build.
