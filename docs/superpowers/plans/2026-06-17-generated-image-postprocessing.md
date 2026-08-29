# Generated Image Postprocessing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional local resize and optional local recompression for final generated images before storage, local save, and task/Agent use.

**Architecture:** Add explicit postprocessing fields to `TaskParams`, a pure option-normalization helper, a thin Canvas helper, and one narrow generated-output storage helper in `src/store.ts`. Replace only final generated-image storage call sites with that helper; leave uploads, masks, imports, thumbnails, and stream partial previews alone.

**Tech Stack:** React 19, TypeScript, Zustand, browser Canvas APIs, IndexedDB helpers in `src/lib/db.ts`, Vitest.

---

## File Structure

- Modify `src/types.ts`: add postprocessing fields to `TaskParams` and defaults to `DEFAULT_PARAMS`.
- Create `src/lib/imagePostprocess.ts`: pure option planning plus browser Canvas postprocessing helpers.
- Create `src/lib/imagePostprocess.test.ts`: unit tests for pure planning/normalization behavior.
- Modify `src/store.ts`: add `processAndStoreGeneratedImage`, replace final generated-output `storeImage(..., 'generated')` call sites, and merge final actual params.
- Modify `src/lib/localSave.ts`: add extension inference from data URL MIME for Electron auto-save.
- Modify `src/components/InputBar.tsx`: add compact task-level controls for local resize and local compression.
- Optionally modify `src/store.test.ts` only if implementation needs direct helper coverage that cannot live in `imagePostprocess.test.ts`.

## Task 1: Add TaskParams Fields

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add the TaskParams fields and defaults**

Update `src/types.ts`:

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

export const DEFAULT_PARAMS: TaskParams = {
  size: 'auto',
  quality: 'auto',
  output_format: 'png',
  output_compression: null,
  moderation: 'auto',
  n: 1,
  postprocess_resize_enabled: false,
  postprocess_size: 'auto',
  postprocess_compress_enabled: false,
  postprocess_format: 'webp',
  postprocess_quality: 90,
}
```

- [ ] **Step 2: Verify TypeScript accepts the extended params**

Run:

```bash
npx tsc -b --pretty false
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add image postprocess task params"
```

## Task 2: Add Pure Postprocess Planning

**Files:**
- Create: `src/lib/imagePostprocess.ts`
- Modify: `src/lib/imagePostprocess.test.ts`

- [ ] **Step 1: Expand failing tests**

Replace `src/lib/imagePostprocess.test.ts` with:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type TaskParams } from '../types'
import { getImagePostprocessPlan } from './imagePostprocess'

function params(overrides: Partial<TaskParams> = {}): TaskParams {
  return { ...DEFAULT_PARAMS, ...overrides }
}

describe('image postprocess plan', () => {
  it('keeps postprocessing disabled by default', () => {
    const plan = getImagePostprocessPlan(DEFAULT_PARAMS)

    expect(plan.enabled).toBe(false)
    expect(plan.resize).toBeNull()
    expect(plan.encode.mime).toBeNull()
  })

  it('normalizes resize dimensions when resize is enabled', () => {
    const plan = getImagePostprocessPlan(params({
      postprocess_resize_enabled: true,
      postprocess_size: '1025x1025',
    }))

    expect(plan.enabled).toBe(true)
    expect(plan.resize).toEqual({ width: 1024, height: 1024 })
  })

  it('rejects auto resize targets when resize is enabled', () => {
    expect(() => getImagePostprocessPlan(params({
      postprocess_resize_enabled: true,
      postprocess_size: 'auto',
    }))).toThrow('postprocess size')
  })

  it('uses selected compression format and quality for JPEG/WebP', () => {
    expect(getImagePostprocessPlan(params({
      postprocess_compress_enabled: true,
      postprocess_format: 'jpeg',
      postprocess_quality: 80,
    })).encode).toEqual({ format: 'jpeg', mime: 'image/jpeg', quality: 0.8 })

    expect(getImagePostprocessPlan(params({
      postprocess_compress_enabled: true,
      postprocess_format: 'webp',
      postprocess_quality: 55,
    })).encode).toEqual({ format: 'webp', mime: 'image/webp', quality: 0.55 })
  })

  it('ignores quality for PNG compression', () => {
    expect(getImagePostprocessPlan(params({
      postprocess_compress_enabled: true,
      postprocess_format: 'png',
      postprocess_quality: 10,
    })).encode).toEqual({ format: 'png', mime: 'image/png', quality: undefined })
  })

  it('resizes before encoding when both switches are enabled', () => {
    const plan = getImagePostprocessPlan(params({
      postprocess_resize_enabled: true,
      postprocess_size: '1536x1024',
      postprocess_compress_enabled: true,
      postprocess_format: 'webp',
      postprocess_quality: 90,
    }))

    expect(plan.enabled).toBe(true)
    expect(plan.resize).toEqual({ width: 1536, height: 1024 })
    expect(plan.encode).toEqual({ format: 'webp', mime: 'image/webp', quality: 0.9 })
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npx vitest run src/lib/imagePostprocess.test.ts
```

Expected: FAIL because `getImagePostprocessPlan` is not implemented.

- [ ] **Step 3: Implement pure planning**

Create `src/lib/imagePostprocess.ts`:

```ts
import type { TaskParams } from '../types'
import { MIME_MAP } from './imageApiShared'
import { normalizeImageSize } from './size'

export interface PostprocessResizePlan {
  width: number
  height: number
}

export interface PostprocessEncodePlan {
  format: TaskParams['output_format'] | null
  mime: string | null
  quality?: number
}

export interface ImagePostprocessPlan {
  enabled: boolean
  resize: PostprocessResizePlan | null
  encode: PostprocessEncodePlan
}

export function getImagePostprocessPlan(params: TaskParams): ImagePostprocessPlan {
  const resize = params.postprocess_resize_enabled ? getResizePlan(params.postprocess_size) : null
  const encode = params.postprocess_compress_enabled
    ? getEncodePlan(params.postprocess_format, params.postprocess_quality)
    : { format: null, mime: null }

  return {
    enabled: Boolean(resize || encode.mime),
    resize,
    encode,
  }
}

function getResizePlan(size: string): PostprocessResizePlan {
  const normalized = normalizeImageSize(size)
  if (!normalized || normalized === 'auto') {
    throw new Error('Local postprocess size is invalid')
  }

  const parsed = parseNormalizedSize(normalized)
  if (!parsed) {
    throw new Error('Local postprocess size is invalid')
  }

  return parsed
}

function parseNormalizedSize(size: string): PostprocessResizePlan | null {
  const match = size.match(/^(\d+)x(\d+)$/)
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return { width, height }
}

function getEncodePlan(
  format: TaskParams['output_format'],
  quality: number | null,
): PostprocessEncodePlan {
  const mime = MIME_MAP[format]
  if (!mime) throw new Error('Local postprocess format is invalid')

  return {
    format,
    mime,
    quality: format === 'png' ? undefined : normalizeCanvasQuality(quality),
  }
}

function normalizeCanvasQuality(value: number | null): number {
  if (value == null || !Number.isFinite(value)) return 0.9
  return Math.min(1, Math.max(0, value / 100))
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npx vitest run src/lib/imagePostprocess.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/imagePostprocess.ts src/lib/imagePostprocess.test.ts
git commit -m "feat: add image postprocess planning"
```

## Task 3: Add Browser Canvas Processing

**Files:**
- Modify: `src/lib/imagePostprocess.ts`
- Modify: `src/lib/imagePostprocess.test.ts`

- [ ] **Step 1: Add tests for final params merging**

Update the import in `src/lib/imagePostprocess.test.ts` to include `mergePostprocessedActualParams`:

```ts
import { getImagePostprocessPlan, mergePostprocessedActualParams } from './imagePostprocess'
```

Then append this block at the end of `src/lib/imagePostprocess.test.ts`:

```ts
describe('mergePostprocessedActualParams', () => {
  it('overrides size and output format with final stored values', () => {
    expect(mergePostprocessedActualParams(
      { size: '2048x2048', output_format: 'png', quality: 'high' },
      { size: '1024x1024', output_format: 'webp' },
    )).toEqual({
      size: '1024x1024',
      output_format: 'webp',
      quality: 'high',
    })
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npx vitest run src/lib/imagePostprocess.test.ts
```

Expected: FAIL because `mergePostprocessedActualParams` does not exist.

- [ ] **Step 3: Add Canvas processing helpers**

Extend `src/lib/imagePostprocess.ts`:

```ts
import { canvasToBlob, loadImage } from './canvasImage'

export interface ProcessImageResult {
  dataUrl: string
  actualParams: Partial<TaskParams>
}

export async function postprocessGeneratedImage(
  dataUrl: string,
  params: TaskParams,
): Promise<ProcessImageResult> {
  const plan = getImagePostprocessPlan(params)
  if (!plan.enabled) {
    return { dataUrl, actualParams: {} }
  }

  const image = await loadImage(dataUrl)
  const width = plan.resize?.width ?? image.naturalWidth
  const height = plan.resize?.height ?? image.naturalHeight
  if (width <= 0 || height <= 0) throw new Error('Local image postprocessing failed: invalid image dimensions')

  const sourceMime = getDataUrlMime(dataUrl) || 'image/png'
  const mime = plan.encode.mime ?? sourceMime
  const format = plan.encode.format ?? getOutputFormatFromMime(mime)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Local image postprocessing failed: Canvas is not supported')

  if (mime === 'image/jpeg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
  }
  ctx.drawImage(image, 0, 0, width, height)

  const blob = await canvasToBlob(canvas, mime, plan.encode.quality)
  if (blob.type && blob.type !== mime) {
    throw new Error(`Local image postprocessing failed: ${mime} output is not supported`)
  }

  return {
    dataUrl: await blobToDataUrl(blob, mime),
    actualParams: {
      size: `${width}x${height}`,
      output_format: format,
    },
  }
}

export function mergePostprocessedActualParams(
  original: Partial<TaskParams> | undefined,
  postprocessed: Partial<TaskParams> | undefined,
): Partial<TaskParams> | undefined {
  const merged = { ...(original ?? {}), ...(postprocessed ?? {}) }
  return Object.keys(merged).length ? merged : undefined
}

function getDataUrlMime(dataUrl: string): string | null {
  const match = dataUrl.match(/^data:([^;,]+)/i)
  return match?.[1]?.toLowerCase() ?? null
}

function getOutputFormatFromMime(mime: string): TaskParams['output_format'] {
  if (mime === 'image/jpeg') return 'jpeg'
  if (mime === 'image/webp') return 'webp'
  return 'png'
}

async function blobToDataUrl(blob: Blob, fallbackMime: string): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    const chunk = bytes.subarray(i, i + 0x8000)
    binary += String.fromCharCode(...chunk)
  }
  return `data:${blob.type || fallbackMime};base64,${btoa(binary)}`
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npx vitest run src/lib/imagePostprocess.test.ts
```

Expected: PASS. These tests do not execute real Canvas APIs.

- [ ] **Step 5: Commit**

```bash
git add src/lib/imagePostprocess.ts src/lib/imagePostprocess.test.ts
git commit -m "feat: add generated image postprocessing helper"
```

## Task 4: Use Helper For Final Generated Images

**Files:**
- Modify: `src/store.ts`

- [ ] **Step 1: Add a failing guard test by static search**

Before replacing call sites, run:

```bash
rg -n "storeImage\\((dataUrl|image\\.dataUrl), 'generated'\\)" src/store.ts
```

Expected before implementation: matches final generated paths at `completeRecoveredFalTask`, `completeAgentImageTask`, Agent non-stream output creation, `storeBatchResult`, single final storage, and `completeRecoveredCustomTask`, plus the stream partial path. The stream partial path must remain unchanged.

- [ ] **Step 2: Import postprocessing helper**

In `src/store.ts`, add:

```ts
import { mergePostprocessedActualParams, postprocessGeneratedImage } from './lib/imagePostprocess'
```

- [ ] **Step 3: Add local storage helper**

Near `mapActualParamsByImage`, add:

```ts
async function processAndStoreGeneratedImage(
  dataUrl: string,
  params: TaskParams,
  originalActualParams?: Partial<TaskParams>,
): Promise<{ id: string; dataUrl: string; actualParams?: Partial<TaskParams> }> {
  const processed = await postprocessGeneratedImage(dataUrl, params)
  const finalActualParams = mergePostprocessedActualParams(originalActualParams, processed.actualParams)
  const imgId = await storeImage(processed.dataUrl, 'generated')
  cacheImage(imgId, processed.dataUrl)
  return { id: imgId, dataUrl: processed.dataUrl, actualParams: finalActualParams }
}
```

- [ ] **Step 4: Replace fal recovery final image storage**

In `completeRecoveredFalTask`, replace:

```ts
const actualParamsList = await resolveImageSizeParamsList(result.images, result.actualParamsList)
const outputIds: string[] = []
for (const dataUrl of result.images) {
  const imgId = await storeImage(dataUrl, 'generated')
  cacheImage(imgId, dataUrl)
  outputIds.push(imgId)
}
```

with:

```ts
const originalActualParamsList = await resolveImageSizeParamsList(result.images, result.actualParamsList)
const outputIds: string[] = []
const actualParamsList: Array<Partial<TaskParams> | undefined> = []
for (let i = 0; i < result.images.length; i++) {
  const stored = await processAndStoreGeneratedImage(result.images[i], task.params, originalActualParamsList[i])
  outputIds.push(stored.id)
  actualParamsList.push(stored.actualParams)
}
```

- [ ] **Step 5: Replace custom recovery final image storage**

In `completeRecoveredCustomTask`, replace the same loop with:

```ts
const originalActualParamsList = await readImageSizeParamsList(result.images)
const outputIds: string[] = []
const actualParamsList: Array<Partial<TaskParams> | undefined> = []
for (let i = 0; i < result.images.length; i++) {
  const stored = await processAndStoreGeneratedImage(result.images[i], task.params, originalActualParamsList[i])
  outputIds.push(stored.id)
  actualParamsList.push(stored.actualParams)
}
```

- [ ] **Step 6: Replace batch item final image storage**

In `storeBatchResult`, replace the `Promise.all(itemImages.map(...storeImage...))` block with:

```ts
const newOutputIds: string[] = []
const processedActualParamsList: Array<Partial<TaskParams> | undefined> = []
for (let i = 0; i < itemImages.length; i++) {
  const stored = await processAndStoreGeneratedImage(itemImages[i], task.params, itemActualParamsList[i])
  newOutputIds.push(stored.id)
  processedActualParamsList.push(stored.actualParams)
}
allActualParamsList.splice(imageBaseIndex, processedActualParamsList.length, ...processedActualParamsList)
```

Keep `allImages` as provider-returned images unless later code needs processed images. The ids and `allActualParamsList` are the source of task metadata.

- [ ] **Step 7: Replace single final gallery storage**

In the `if (n === 1)` block after `callImageApi`, replace the storage loop with:

```ts
const processedActualParamsList: Array<Partial<TaskParams> | undefined> = []
for (let i = 0; i < result.images.length; i++) {
  const stored = await processAndStoreGeneratedImage(result.images[i], task.params, result.actualParamsList?.[i] ?? result.actualParams)
  outputIds.push(stored.id)
  processedActualParamsList.push(stored.actualParams)
}
if (processedActualParamsList.length) {
  result = {
    ...result,
    actualParamsList: processedActualParamsList,
    actualParams: firstActualParams(processedActualParamsList),
  }
}
```

- [ ] **Step 8: Replace Agent streamed image task completion**

In `completeAgentImageTask`, replace:

```ts
const imgId = await storeImage(image.dataUrl, 'generated')
cacheImage(imgId, image.dataUrl)
const actualParams: Partial<TaskParams> = {
  ...(Object.keys(image.actualParams ?? {}).length ? image.actualParams : {}),
  n: 1,
}
```

with:

```ts
const stored = await processAndStoreGeneratedImage(image.dataUrl, params, image.actualParams)
const imgId = stored.id
const actualParams: Partial<TaskParams> = {
  ...(Object.keys(stored.actualParams ?? {}).length ? stored.actualParams : {}),
  n: 1,
}
```

- [ ] **Step 9: Replace Agent non-stream output task creation**

In the loop near `storeImage(image.dataUrl, 'generated')`, replace with the same `processAndStoreGeneratedImage(image.dataUrl, params, image.actualParams)` pattern and map `actualParamsByImage` to the returned id.

- [ ] **Step 10: Verify stream partial storage remains untouched**

Run:

```bash
rg -n "storeImage\\((dataUrl|image\\.dataUrl), 'generated'\\)" src/store.ts
```

Expected after implementation: only the stream partial path in `persistTaskStreamPartialImage` should remain, or no matches if helper text changed the pattern. Confirm `persistTaskStreamPartialImage` still stores partial previews without postprocessing.

- [ ] **Step 11: Run typecheck**

Run:

```bash
npx tsc -b --pretty false
```

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/store.ts
git commit -m "feat: postprocess final generated images before storage"
```

## Task 5: Fix Electron Local Save Extension

**Files:**
- Modify: `src/lib/localSave.ts`
- Modify: `src/store.ts`

- [ ] **Step 1: Add local save format helper**

In `src/lib/localSave.ts`, add:

```ts
export function getImageExtensionFromDataUrl(dataUrl: string, fallbackExt: string = 'png'): string {
  const mime = dataUrl.match(/^data:([^;,]+)/i)?.[1]?.toLowerCase()
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/png') return 'png'
  return EXT_MAP[fallbackExt] || fallbackExt || 'png'
}
```

- [ ] **Step 2: Use data URL extension in local save**

In `src/store.ts`, update the import from `./lib/localSave` to include `getImageExtensionFromDataUrl`.

In `saveTaskImagesToLocalFS` and `saveTaskToLocalFS`, change:

```ts
await saveImageToLocal(taskId, imageIndexOffset + i, dataUrl, task.params.output_format, subFolder)
```

and:

```ts
const saved = await saveImageToLocal(taskId, i, dataUrl, task.params.output_format, subFolder)
```

to:

```ts
await saveImageToLocal(taskId, imageIndexOffset + i, dataUrl, getImageExtensionFromDataUrl(dataUrl, task.params.output_format), subFolder)
```

and:

```ts
const saved = await saveImageToLocal(taskId, i, dataUrl, getImageExtensionFromDataUrl(dataUrl, task.params.output_format), subFolder)
```

- [ ] **Step 3: Run typecheck**

Run:

```bash
npx tsc -b --pretty false
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/localSave.ts src/store.ts
git commit -m "fix: save generated images with final mime extension"
```

## Task 6: Add InputBar Controls

**Files:**
- Modify: `src/components/InputBar.tsx`

- [ ] **Step 1: Add local input state**

Near existing `outputCompressionInput` state, add:

```ts
const [postprocessQualityInput, setPostprocessQualityInput] = useState(
  params.postprocess_quality == null ? '' : String(params.postprocess_quality),
)
```

Add a sync effect near the existing compression input sync:

```ts
useEffect(() => {
  setPostprocessQualityInput(params.postprocess_quality == null ? '' : String(params.postprocess_quality))
}, [params.postprocess_quality])
```

- [ ] **Step 2: Add commit handler**

Near `commitOutputCompression`, add:

```ts
const commitPostprocessQuality = useCallback(() => {
  if (postprocessQualityInput.trim() === '') {
    setParams({ postprocess_quality: null })
    return
  }

  const nextValue = Number(postprocessQualityInput)
  if (!Number.isFinite(nextValue) || nextValue < 0 || nextValue > 100) {
    setPostprocessQualityInput(params.postprocess_quality == null ? '' : String(params.postprocess_quality))
    return
  }

  setParams({ postprocess_quality: nextValue })
  setPostprocessQualityInput(String(nextValue))
}, [params.postprocess_quality, postprocessQualityInput, setParams])
```

- [ ] **Step 3: Add UI controls after API compression**

After the existing API compression control, add a compact block:

```tsx
<label className="flex flex-col gap-0.5">
  <span className="text-gray-400 dark:text-gray-500 ml-1">后处理尺寸</span>
  <button
    type="button"
    onClick={() => setParams({ postprocess_resize_enabled: !params.postprocess_resize_enabled })}
    className={params.postprocess_resize_enabled ? selectClass : 'px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] text-xs transition-all duration-200 shadow-sm'}
  >
    {params.postprocess_resize_enabled ? '开启' : '关闭'}
  </button>
</label>
{params.postprocess_resize_enabled && (
  <label className="flex flex-col gap-0.5">
    <span className="text-gray-400 dark:text-gray-500 ml-1">保存尺寸</span>
    <button
      type="button"
      onClick={() => setPostprocessSizePickerOpen(true)}
      className="px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] text-xs transition-all duration-200 shadow-sm"
    >
      {normalizeImageSize(params.postprocess_size) || '选择'}
    </button>
  </label>
)}
```

Use existing styling patterns rather than introducing a new card. If there is already a local `sizePickerOpen` state, add a separate `postprocessSizePickerOpen` state and render a second `SizePickerModal` with `allowAuto={false}`.

- [ ] **Step 4: Add local compression controls**

Add:

```tsx
<label className="flex flex-col gap-0.5">
  <span className="text-gray-400 dark:text-gray-500 ml-1">本地压缩</span>
  <button
    type="button"
    onClick={() => setParams({ postprocess_compress_enabled: !params.postprocess_compress_enabled })}
    className={params.postprocess_compress_enabled ? selectClass : 'px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] text-xs transition-all duration-200 shadow-sm'}
  >
    {params.postprocess_compress_enabled ? '开启' : '关闭'}
  </button>
</label>
{params.postprocess_compress_enabled && (
  <>
    <label className="flex flex-col gap-0.5">
      <span className="text-gray-400 dark:text-gray-500 ml-1">本地格式</span>
      <Select
        value={params.postprocess_format}
        onChange={(val) => setParams({ postprocess_format: val as any })}
        options={[
          { label: 'PNG', value: 'png' },
          { label: 'JPEG', value: 'jpeg' },
          { label: 'WebP', value: 'webp' },
        ]}
        className={selectClass}
      />
    </label>
    <label className="flex flex-col gap-0.5">
      <span className="text-gray-400 dark:text-gray-500 ml-1">本地质量</span>
      <input
        value={postprocessQualityInput}
        onChange={(e) => setPostprocessQualityInput(e.target.value)}
        onBlur={commitPostprocessQuality}
        disabled={params.postprocess_format === 'png'}
        type="number"
        min={0}
        max={100}
        placeholder="0-100"
        className="px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] focus:outline-none text-xs transition-all duration-200 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
      />
    </label>
  </>
)}
```

Keep labels short if the existing source uses mojibake in terminal output; preserve file encoding and avoid broad reformatting.

- [ ] **Step 5: Render postprocess size picker**

Near the existing `SizePickerModal` render, add:

```tsx
{postprocessSizePickerOpen && (
  <SizePickerModal
    currentSize={params.postprocess_size}
    allowAuto={false}
    onSelect={(size) => setParams({ postprocess_size: size })}
    onClose={() => setPostprocessSizePickerOpen(false)}
  />
)}
```

- [ ] **Step 6: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/InputBar.tsx
git commit -m "feat: add generated image postprocess controls"
```

## Task 7: Final Verification

**Files:**
- Verify only unless fixes are needed.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npx vitest run src/lib/imagePostprocess.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Static call-site audit**

Run:

```bash
rg -n "streamPartialImageIds|processAndStoreGeneratedImage|storeImage\\((dataUrl|image\\.dataUrl), 'generated'\\)" src/store.ts
```

Expected:

- Final generated-output paths call `processAndStoreGeneratedImage`.
- `persistTaskStreamPartialImage` still stores partial images directly.
- Upload, mask, import, and thumbnail paths do not call the postprocess helper.

- [ ] **Step 5: Manual app smoke test**

Run:

```bash
npm run dev
```

Open the Vite URL in the in-app browser. Use a mock/local provider if available:

- Generate with both new switches off; confirm normal behavior.
- Generate with resize only; confirm saved/stored dimensions match the selected postprocess size.
- Generate with compression only; confirm dimensions are unchanged and MIME/extension changes.
- Generate with both enabled; confirm both dimensions and MIME/extension change.

- [ ] **Step 6: Final commit if verification required fixes**

If verification required small fixes:

```bash
git add <changed-files>
git commit -m "fix: complete image postprocessing verification"
```

If no fixes were needed, do not create an empty commit.
