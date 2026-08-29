# Generated Image Postprocessing Design

## Goal

Add optional local postprocessing for newly generated final images.

After an image API returns final generated images, the app should be able to resize those images to a separate postprocess size, recompress them to a selected local output format and quality, or do both before the images are stored, saved locally, referenced by tasks, and shown in gallery or Agent flows.

The default behavior must stay unchanged.

## Scope

In scope:

- Per-task postprocessing controls in the existing `InputBar` parameter area.
- New `TaskParams` fields for local postprocessing options.
- A focused image postprocessing helper that uses browser Canvas APIs.
- A narrow generated-output storage helper used only for final generated images.
- Final generated images from gallery generation, `n > 1` batch generation, stream final results, fal/custom recovery, Agent image outputs, and Agent batch image tools.
- Metadata updates so task details reflect the final stored image dimensions and local output format.
- Unit tests for pure postprocessing option logic and targeted store/helper behavior where practical.

Out of scope:

- Processing historical generated images.
- Processing uploaded input images, URL-imported input images, mask images, backup-imported images, or stream partial preview images.
- Changing API request parameters beyond existing user-selected generation parameters.
- Server-side image processing.
- A new settings page or global default policy for this first version.
- Large UI redesigns or unrelated refactors.

## Assumptions

- Users want two independent local features:
  - Resize final generated images to a separate postprocess size.
  - Recompress final generated images without resizing.
- Users may enable either feature alone or both together.
- When both features are enabled, resize runs first and recompression runs after resize.
- The existing generation `size`, `output_format`, and `output_compression` remain API request parameters.
- The new postprocessing options describe local processing after the API response.
- If local postprocessing is enabled and fails, the app should not silently store the unprocessed original as if the requested option succeeded.

## Recommended Approach

Add explicit local postprocessing fields to `TaskParams`.

Suggested shape:

```ts
export interface TaskParams {
  size: string
  quality: 'auto' | 'low' | 'medium' | 'high'
  output_format: 'png' | 'jpeg' | 'webp'
  output_compression: number | null
  moderation: 'auto' | 'low'
  n: number
  postprocess_resize_enabled: boolean
  postprocess_size: string
  postprocess_compress_enabled: boolean
  postprocess_format: 'png' | 'jpeg' | 'webp'
  postprocess_quality: number | null
}
```

Default values:

```ts
postprocess_resize_enabled: false
postprocess_size: 'auto'
postprocess_compress_enabled: false
postprocess_format: 'webp'
postprocess_quality: 90
```

The defaults keep old behavior unchanged because both feature switches are off.

## UI Design

Place the controls in `src/components/InputBar.tsx`, near the existing size, output format, compression, and count controls.

The first version should stay compact:

- A toggle for local resize.
- A postprocess size picker or button that reuses `SizePickerModal` with `allowAuto={false}` when local resize is enabled.
- A toggle for local compression.
- A local format select for `png`, `jpeg`, and `webp` when compression is enabled.
- A local quality numeric input or compact slider for JPEG/WebP when compression is enabled.

The labels should make the distinction clear:

- Existing output format/compression controls affect the API request.
- New controls affect the returned image before local storage.

Do not put these controls inside `SizePickerModal`; that modal should remain focused on choosing an image size. Do not make `SettingsModal` the only entry point for this first version; this is task-level behavior.

## Processing Rules

Postprocessing should be skipped when both local switches are off.

When local resize is enabled:

- Use the already selected `postprocess_size` as the local target size.
- If `postprocess_size` is invalid or `auto`, fail with a user-readable error. The UI may reuse the existing size picker to produce a valid size, but the postprocessing helper should not silently apply generation-model constraints again.
- Draw the image into a canvas with the normalized target dimensions.
- For this version, scale directly to the exact target dimensions so the final stored image matches the selected postprocess size. Do not add crop, padding, or fit-mode controls until a later design asks for them.

When local compression is enabled:

- Encode the canvas or original image to the selected local MIME.
- Use quality only for JPEG/WebP.
- Ignore quality for PNG.

When both are enabled:

- Load the API-returned image once.
- Draw the resize result to canvas.
- Encode the resized canvas with the selected local compression options.

When only compression is enabled:

- Preserve the original pixel dimensions.
- Re-encode to the selected local format and quality.

When only resize is enabled:

- Resize to `postprocess_size`.
- Preserve the original MIME when possible. If the original MIME is unsupported or missing, fall back to PNG.

## Transparency And Format Rules

Transparent images need explicit behavior.

For this version:

- PNG output preserves transparency.
- WebP output attempts to preserve transparency.
- JPEG output cannot preserve transparency; transparent pixels should be composited over white before encoding.
- The helper should check the resulting `Blob.type`. If the browser cannot produce the requested MIME, fail with a clear error instead of storing an unexpected format.

## Data Flow

Do not wrap `storeImage` globally.

Add a narrow helper, for example:

```ts
async function processAndStoreGeneratedImage(
  dataUrl: string,
  params: TaskParams,
): Promise<{
  id: string
  dataUrl: string
  actualParams: Partial<TaskParams>
  outputFormat: TaskParams['output_format']
}>
```

Responsibilities:

- Apply local postprocessing when enabled.
- Store the final data URL via `storeImage(finalDataUrl, 'generated')`.
- Cache the final data URL.
- Return the final image id, final data URL, final size, and final local format.

Use this helper only for images that become `TaskRecord.outputImages`.

Final generated image paths that must use the helper:

- fal recovery final images in `completeRecoveredFalTask`.
- custom recovery final images in `completeRecoveredCustomTask`.
- gallery/file/batch success images in `storeBatchResult`.
- gallery single final images after `callImageApi`.
- Agent streamed image tool completion.
- Agent non-streamed image outputs that create tasks.
- Agent `generate_image_batch` child tasks through the shared Agent completion helper.

Paths that must not use the helper:

- Stream partial previews stored in `streamPartialImageIds`.
- Uploaded input images.
- URL-imported input images.
- Mask images.
- Existing output images moved back into inputs.
- Backup import images.
- Thumbnail generation.

## Metadata Semantics

`rawImageUrls` should keep the provider's original URLs.

`revisedPromptByImage` should map to final stored image ids. The helper must not change image order or image count.

`actualParamsByImage.size` should reflect the final stored image dimensions when local resize or compression is enabled. This keeps task details aligned with what the user can download or reuse.

`actualParamsByImage.output_format` should reflect the final local stored format when local compression changes the MIME.

The task-level `actualParams` should use the first final image's actual params, consistent with existing behavior.

Electron local auto-save must use the final image MIME or final local output format, not blindly use the API request `output_format`. Browser download and backup export already infer extensions from Blob/data URL MIME and should remain compatible.

## Error Handling

If postprocessing is disabled, the helper should behave like current storage.

If postprocessing is enabled and a final image cannot be loaded, resized, or encoded:

- The affected task or batch item should fail.
- The user should see a concise error explaining that local image postprocessing failed.
- The app should not silently store the original image as a successful postprocessed result.

For batch generation, a postprocessing failure should be treated like a per-item generation failure where the current flow supports per-item failures.

## Testing

Use TDD before production code.

Add a pure helper module for option normalization so it can be tested without browser Canvas support.

Primary tests:

- Default params disable postprocessing and preserve current behavior.
- Resize enabled with a valid size normalizes the target dimensions.
- Resize enabled with `auto` or invalid size returns a validation error.
- Compression enabled maps `png`, `jpeg`, and `webp` to expected MIME values.
- Quality normalizes to the Canvas `0..1` range for JPEG/WebP.
- PNG ignores quality.
- JPEG uses a white background when alpha flattening is required.
- Both switches enabled produce a plan that resizes first and encodes second.
- The final params list maps processed image ids to processed dimensions without changing order.

Canvas encoding should be kept behind a thin browser helper. Unit tests can mock the browser helper rather than requiring real Canvas support in Vitest's default environment.

Manual verification:

- Run targeted Vitest tests.
- Run `npm run build`.
- Generate one image with defaults and confirm behavior is unchanged.
- Generate one image with resize only and confirm stored/downloaded dimensions match the postprocess size.
- Generate one image with compression only and confirm dimensions stay unchanged while MIME/extension changes.
- Generate one image with both enabled and confirm dimensions and MIME both change.
- Check one Agent-generated image path if a mock or local API path is available.

## Risks

- Large 4K multi-image batches may create memory pressure because the browser holds the original data URL, decoded image, canvas pixels, Blob, and final data URL.
- Canvas work runs on the main thread and may briefly block the UI.
- JPEG cannot preserve transparency.
- Browser WebP support and quality handling vary by implementation.
- Existing terminal output shows mojibake for some Chinese strings, so implementation should avoid broad text rewrites.
- `src/store.ts` is large; changes should be localized around final image storage points.
- The existing API output fields and new local output fields can be confused if UI labels are not precise.

## Acceptance Criteria

- With both local postprocessing switches off, existing generation, storage, local save, export, and download behavior remains unchanged.
- Resize can be enabled without compression, and final stored generated images match the selected postprocess dimensions.
- Compression can be enabled without resize, and final stored generated images keep their original dimensions while using the selected local output format/quality.
- Resize and compression can be enabled together, and final stored generated images match both selected dimensions and selected local format/quality.
- Final generated images from gallery, batch, stream final, fal/custom recovery, Agent single image, and Agent batch image paths use the same generated-output helper.
- Stream partial images, uploads, masks, imports, and thumbnails are not postprocessed.
- Task metadata reflects final stored image size and final local format.
- Electron local auto-save file extension matches the final image MIME.
- Postprocessing failures are visible and do not silently save unprocessed originals as successful results.
- New focused tests pass, relevant existing tests pass, and the project builds.
