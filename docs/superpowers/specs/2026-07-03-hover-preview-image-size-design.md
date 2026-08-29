# Hover Preview Image Size Design

## Goal

Show the actual pixel dimensions of an output image in the upper-right corner of the enlarged hover preview inside the task detail modal.

## Scope

- Change only the existing mouse hover preview in `DetailModal`.
- Keep the existing preview size, position, image scaling, border, shadow, and interaction behavior.
- Do not change task-card downloads; ZIP download behavior already meets the requirement.
- Do not add ratio, requested-size, or post-processing details to the preview.

## Display

- Render a compact label in the preview's upper-right corner.
- Display actual image dimensions as `宽 × 高`, for example `1536 × 1024`.
- Use a dark translucent background, white text, rounded corners, and a subtle backdrop blur consistent with the existing preview.
- Keep the label non-interactive with the rest of the preview.

## Data

`DetailModal` already records each loaded output image's `naturalWidth` and `naturalHeight` in `imageSizes`. The hover preview reads the value for its `imageId`, so the label reflects the downloaded image's actual pixels rather than requested generation parameters.

If dimensions are not available, omit the label instead of showing guessed or stale values.

## Testing

- Add a focused rendering test for the hover preview size label.
- Verify the label uses the selected image's actual stored dimensions.
- Verify no label is rendered when dimensions are unavailable.
- Run the focused test, complete test suite, and production build.
