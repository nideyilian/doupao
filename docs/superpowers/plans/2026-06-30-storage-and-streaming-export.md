# Storage and Streaming Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound IndexedDB and renderer memory usage by migrating Electron image payloads to local files, cleaning those files with their records, fixing development-origin drift, and streaming backups in the Electron main process.

**Architecture:** Keep the browser storage adapter unchanged. In Electron, migrate a bounded batch of legacy `dataUrl` image records to the existing `cache-images` directory, retain only metadata in IndexedDB, and expose narrowly validated IPC operations for cache deletion and streamed ZIP creation. The renderer builds a small manifest and file-entry plan; the main process reads image files and writes the archive incrementally.

**Tech Stack:** TypeScript, Electron IPC, native IndexedDB, fflate streaming ZIP API, Vitest, Vite.

---

## File map

- Modify `vite.config.ts`: pin development to port 5173 with strict fallback disabled.
- Modify `src/lib/db.ts`: bounded legacy-image queries and metadata-only record updates.
- Create `src/lib/imageStorageMigration.ts`: dependency-injected, resumable migration loop.
- Create `src/lib/imageStorageMigration.test.ts`: migration red/green tests.
- Modify `src/lib/db.test.ts`: bounded cursor/query behavior tests.
- Modify `src/lib/localSave.ts`: cache deletion, reconciliation, and streamed-export bridge types.
- Modify `electron/preload.ts` and `electron/preload.cjs`: expose the new narrow IPC methods.
- Modify `electron/ipc-handlers.ts`: validate cache paths, delete/reconcile cache files, and register export IPC.
- Modify `electron/ipc-handlers.test.ts`: filesystem boundary and structured-error tests.
- Create `electron/streaming-zip.ts`: file-to-ZIP streaming implementation.
- Create `electron/streaming-zip.test.ts`: valid archive and partial-file cleanup tests.
- Create `src/lib/dataExport.ts`: referenced-image selection and Electron export-plan construction.
- Create `src/lib/dataExport.test.ts`: selection, deduplication, and missing-file tests.
- Modify `src/store.ts`: start migration, connect lifecycle cleanup, and route Electron export through the streaming path.
- Modify `src/store.test.ts`: concrete error propagation and configuration-only export regression tests.

### Task 1: Lock the development Origin

**Files:**
- Create: `vite.config.test.ts`
- Modify: `vite.config.ts`

- [ ] **Step 1: Write the failing configuration test**

```ts
import { describe, expect, it } from 'vitest'
import configFactory from './vite.config'

describe('development server origin', () => {
  it('pins port 5173 and refuses automatic fallback', () => {
    const config = configFactory({ command: 'serve', mode: 'test', isSsrBuild: false, isPreview: false })
    expect(config.server?.port).toBe(5173)
    expect(config.server?.strictPort).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx vitest run vite.config.test.ts`

Expected: FAIL because `server.port` and `server.strictPort` are undefined.

- [ ] **Step 3: Add the minimal Vite configuration**

Add to the existing `server` object without changing proxy behavior:

```ts
server: {
  host: true,
  port: 5173,
  strictPort: true,
  proxy: existingProxyValue,
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `npx vitest run vite.config.test.ts`

Expected: 1 test passes.

### Task 2: Add bounded legacy-image migration

**Files:**
- Modify: `src/lib/db.ts`
- Modify: `src/lib/db.test.ts`
- Create: `src/lib/imageStorageMigration.ts`
- Create: `src/lib/imageStorageMigration.test.ts`

- [ ] **Step 1: Write a failing bounded-query test**

Extend the fake IndexedDB test so the desired API is:

```ts
const batch = await getLegacyImageBatch(2)

expect(batch.map((image) => image.id)).toEqual(['legacy-a', 'legacy-b'])
expect(batch.every((image) => image.dataUrl && !image.localPath)).toBe(true)
expect(cursorAdvanceCount).toBeLessThanOrEqual(3)
```

The fake cursor must contain migrated, legacy, and metadata-only records. The test proves the function stops after the requested number and excludes records with `localPath` or without `dataUrl`.

- [ ] **Step 2: Run the database test and verify RED**

Run: `npx vitest run src/lib/db.test.ts`

Expected: FAIL because `getLegacyImageBatch` does not exist.

- [ ] **Step 3: Implement the bounded cursor query**

Add:

```ts
export function getLegacyImageBatch(limit: number): Promise<StoredImage[]> {
  if (limit <= 0) return Promise.resolve([])
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readonly')
    const request = tx.objectStore(STORE_IMAGES).openCursor()
    const images: StoredImage[] = []
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor || images.length >= limit) {
        resolve(images)
        return
      }
      const image = cursor.value as StoredImage
      if (image.dataUrl && !image.localPath) images.push(image)
      if (images.length >= limit) resolve(images)
      else cursor.continue()
    }
    request.onerror = () => reject(request.error)
  }))
}
```

Keep the batch small enough that legacy Base64 payloads cannot recreate the original all-record memory spike.

- [ ] **Step 4: Run the database test and verify GREEN**

Run: `npx vitest run src/lib/db.test.ts`

Expected: all database tests pass.

- [ ] **Step 5: Write failing migration-order tests**

Create tests against a dependency-injected API:

```ts
await migrateLegacyImages({
  readBatch: async () => reads.shift() ?? [],
  saveImage: async (image) => `/cache/${image.id}.png`,
  replaceImage: async (image) => writes.push(image),
  batchSize: 2,
})

expect(writes[0]).toMatchObject({
  id: 'legacy-a',
  localPath: '/cache/legacy-a.png',
  dataUrl: undefined,
})
```

Add a failure case:

```ts
await expect(migrateLegacyImages({
  readBatch: async () => [legacyImage],
  saveImage: async () => null,
  replaceImage,
  batchSize: 1,
})).rejects.toThrow('legacy-a')

expect(replaceImage).not.toHaveBeenCalled()
```

- [ ] **Step 6: Run the migration tests and verify RED**

Run: `npx vitest run src/lib/imageStorageMigration.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 7: Implement the minimal migration loop**

Expose:

```ts
export type ImageStorageMigrationDeps = {
  readBatch: (limit: number) => Promise<StoredImage[]>
  saveImage: (image: StoredImage) => Promise<string | null>
  replaceImage: (image: StoredImage) => Promise<unknown>
  batchSize?: number
  yieldToEventLoop?: () => Promise<void>
}

export async function migrateLegacyImages(deps: ImageStorageMigrationDeps): Promise<number>
```

For each record, require `dataUrl`, await `saveImage`, throw with the image ID if it returns null, then call:

```ts
await deps.replaceImage({ ...image, localPath, dataUrl: undefined })
```

Read the next batch only after all records in the current batch are committed. Default `batchSize` to 4 and yield with `setTimeout(resolve, 0)` between batches.

- [ ] **Step 8: Run migration and database tests**

Run: `npx vitest run src/lib/db.test.ts src/lib/imageStorageMigration.test.ts`

Expected: all tests pass.

### Task 3: Couple cache-file cleanup to image deletion

**Files:**
- Modify: `electron/ipc-handlers.test.ts`
- Modify: `electron/ipc-handlers.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/preload.cjs`
- Modify: `src/lib/localSave.ts`
- Modify: `src/lib/db.ts`
- Modify: `src/lib/db.test.ts`

- [ ] **Step 1: Write failing main-process cache deletion tests**

Create a configured `cache-images` directory under the test root, then assert:

```ts
expect(deleteCacheImageFiles([insideCache, outsideCache])).toEqual({
  deleted: [insideCache],
  failed: [outsideCache],
})
expect(existsSync(insideCache)).toBe(false)
expect(existsSync(outsideCache)).toBe(true)
```

Add reconciliation coverage:

```ts
expect(reconcileCacheImageFiles(['keep.png'])).toEqual({
  deleted: [orphanFile],
  failed: [],
})
```

- [ ] **Step 2: Run the IPC test and verify RED**

Run: `npx vitest run electron/ipc-handlers.test.ts`

Expected: FAIL because the cache helpers do not exist.

- [ ] **Step 3: Implement exact-directory validation and IPC**

In `electron/ipc-handlers.ts`, resolve the configured local save path and exact `cache-images` child. Reject paths outside that real directory, symlink escapes, directories, and unsupported filenames. Export pure helpers:

```ts
export function deleteCacheImageFiles(filePaths: string[]): {
  deleted: string[]
  failed: string[]
}

export function reconcileCacheImageFiles(referencedFileNames: string[]): {
  deleted: string[]
  failed: string[]
}
```

Register:

```ts
ipcMain.handle('store:delete-cache-images', (_event, { filePaths }) =>
  deleteCacheImageFiles(Array.isArray(filePaths) ? filePaths : []))

ipcMain.handle('store:reconcile-cache-images', (_event, { referencedFileNames }) =>
  reconcileCacheImageFiles(Array.isArray(referencedFileNames) ? referencedFileNames : []))
```

- [ ] **Step 4: Expose typed renderer bridges**

Add to both preload files and `ElectronAPI`:

```ts
deleteCacheImages: (filePaths: string[]) =>
  ipcRenderer.invoke('store:delete-cache-images', { filePaths }),
reconcileCacheImages: (referencedFileNames: string[]) =>
  ipcRenderer.invoke('store:reconcile-cache-images', { referencedFileNames }),
```

Add `deleteRawCacheImages()` and `reconcileRawCacheImages()` wrappers to `src/lib/localSave.ts`.

- [ ] **Step 5: Run the IPC test and verify GREEN**

Run: `npx vitest run electron/ipc-handlers.test.ts`

Expected: all IPC tests pass.

- [ ] **Step 6: Write failing database deletion-order tests**

Use a fake IndexedDB transaction and a stubbed local-save module to prove:

```ts
await deleteImage('image-a')
expect(events).toEqual(['db-complete', 'file-delete'])
```

Cover batch and clear behavior, ensuring only collected `localPath` values are sent and no original `dataUrl` collection is created.

- [ ] **Step 7: Implement post-commit cleanup**

Before deleting, read only the affected record(s) or local-path strings. Commit the IndexedDB transaction first. Then call `deleteRawCacheImages(localPaths)` best-effort:

```ts
try {
  await deleteRawCacheImages(localPaths)
} catch (error) {
  console.error('Failed to clean local image cache:', error)
}
```

Do not roll back database deletion after an unlink failure.

- [ ] **Step 8: Run database and IPC tests**

Run: `npx vitest run src/lib/db.test.ts electron/ipc-handlers.test.ts`

Expected: all tests pass.

### Task 4: Stream ZIP files in the main process

**Files:**
- Create: `electron/streaming-zip.ts`
- Create: `electron/streaming-zip.test.ts`
- Modify: `electron/ipc-handlers.ts`

- [ ] **Step 1: Write the failing successful-archive test**

Create two source files and call:

```ts
const result = await writeStreamingZip({
  destinationPath,
  manifestJson: JSON.stringify({ version: 3 }),
  entries: [
    { sourcePath: firstImage, archivePath: 'images/a.png', mtime: 1 },
    { sourcePath: secondImage, archivePath: 'images/b.jpg', mtime: 2 },
  ],
})

expect(result).toEqual({ success: true })
const archive = unzipSync(readFileSync(destinationPath))
expect(strFromU8(archive['manifest.json'])).toContain('"version":3')
expect(Buffer.from(archive['images/a.png']).toString()).toBe('first')
```

- [ ] **Step 2: Write the failing cleanup test**

Use a missing source file:

```ts
const result = await writeStreamingZip({ destinationPath, manifestJson: '{}', entries })
expect(result.success).toBe(false)
expect(result.error).toContain('missing.png')
expect(existsSync(destinationPath)).toBe(false)
expect(existsSync(`${destinationPath}.partial`)).toBe(false)
```

- [ ] **Step 3: Run the ZIP tests and verify RED**

Run: `npx vitest run electron/streaming-zip.test.ts`

Expected: FAIL because `writeStreamingZip` does not exist.

- [ ] **Step 4: Implement streaming ZIP output**

Define:

```ts
export type StreamingZipEntry = {
  sourcePath: string
  archivePath: string
  mtime?: number
}

export type StreamingZipRequest = {
  destinationPath: string
  manifestJson: string
  entries: StreamingZipEntry[]
}
```

Use `Zip`, `ZipDeflate`, and `ZipPassThrough` from fflate:

- stream `manifest.json` through `ZipDeflate`;
- stream image files chunk-by-chunk through `ZipPassThrough`;
- write ZIP output chunks directly to `createWriteStream(destination + '.partial')`;
- process one image entry at a time;
- reject traversal archive paths (`..`, absolute paths, backslashes);
- on success close and atomically rename `.partial`;
- on any error destroy the stream and remove both partial and final files created by this attempt.

- [ ] **Step 5: Run ZIP tests and verify GREEN**

Run: `npx vitest run electron/streaming-zip.test.ts`

Expected: both tests pass.

- [ ] **Step 6: Register a validated export IPC**

In `ipc-handlers.ts`, validate:

- destination via `assertAllowedPath`;
- every source via `assertAllowedRealPath`;
- source is a regular file;
- archive path starts with `images/`;
- payload contains only strings/numbers in the expected shape.

Then call `writeStreamingZip()` and return its structured result.

- [ ] **Step 7: Add IPC malformed-payload coverage**

Assert malformed plans and outside-root paths return `{ success: false, error: expect.any(String) }` without creating files.

- [ ] **Step 8: Run ZIP and IPC tests**

Run: `npx vitest run electron/streaming-zip.test.ts electron/ipc-handlers.test.ts`

Expected: all tests pass.

### Task 5: Build a bounded renderer export plan

**Files:**
- Create: `src/lib/dataExport.ts`
- Create: `src/lib/dataExport.test.ts`
- Modify: `src/lib/localSave.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/preload.cjs`

- [ ] **Step 1: Write failing referenced-ID tests**

```ts
expect(collectReferencedExportImageIds(tasks, conversations)).toEqual([
  'input-a',
  'mask-a',
  'output-a',
  'partial-a',
  'agent-input-a',
])
```

Include duplicate IDs in fixtures and prove each appears once in first-seen order. Do not include unrelated database image IDs.

- [ ] **Step 2: Run the test and verify RED**

Run: `npx vitest run src/lib/dataExport.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement ID collection**

Add a small pure function that visits task `inputImageIds`, `maskImageId`, `outputImages`, `streamPartialImageIds`, and agent round `inputImageIds`, deduplicating through a `Set`.

- [ ] **Step 4: Write failing export-plan tests**

Inject a single-record lookup:

```ts
const plan = await buildElectronImageExportEntries(ids, getImage)
expect(plan).toEqual([
  {
    imageId: 'output-a',
    sourcePath: '/cache/output-a.png',
    archivePath: 'images/output-a.png',
    createdAt: 10,
  },
])
```

Assert a record without `localPath` throws `图片 output-a 尚未迁移到本地存储`, and a missing record throws `图片 output-a 已不存在`.

- [ ] **Step 5: Implement sequential plan construction**

Call `getImage(id)` once per ID, never `getAllImages()`. Derive a safe extension from `localPath`, allow only `.png`, `.jpg`, `.jpeg`, and `.webp`, and reject anything else.

- [ ] **Step 6: Expose streaming export in the bridge**

Add:

```ts
exportZipToPath: (request: ElectronZipExportRequest) =>
  Promise<{ success: boolean; error?: string }>
```

to `localSave.ts`, `preload.ts`, and `preload.cjs`, invoking `fs:export-zip`.

- [ ] **Step 7: Run renderer helper tests**

Run: `npx vitest run src/lib/dataExport.test.ts`

Expected: all tests pass.

### Task 6: Integrate migration and streaming export

**Files:**
- Modify: `src/store.test.ts`
- Modify: `src/store.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write a failing migration integration test**

Mock `getLegacyImageBatch`, `saveRawCacheImageToLocal`, and `putImage`. Call the exported initialization hook and verify that normal tasks are set before the background migration finishes, then await the migration hook and verify the metadata-only record was written.

- [ ] **Step 2: Run the focused store test and verify RED**

Run: `npx vitest run src/store.test.ts -t "migrates legacy Electron images"`

Expected: FAIL because no migration hook exists.

- [ ] **Step 3: Start one shared migration promise**

In `store.ts`, add:

```ts
let imageStorageMigrationPromise: Promise<number> | null = null

export function ensureImageStorageMigrated(): Promise<number> {
  if (!isElectronEnv()) return Promise.resolve(0)
  imageStorageMigrationPromise ??= migrateLegacyImages({ ... })
  return imageStorageMigrationPromise
}
```

Start it without awaiting at the end of `initStore()`. Log/show a concrete failure once. Before Electron export, await it.

- [ ] **Step 4: Write a failing Electron export test**

Arrange task and image metadata, then assert:

```ts
await exportDataToPath('/desktop/backup.zip', options)
expect(exportZipToPath).toHaveBeenCalledWith(expect.objectContaining({
  destinationPath: '/desktop/backup.zip',
  entries: [expect.objectContaining({ archivePath: 'images/output-a.png' })],
}))
expect(getAllImages).not.toHaveBeenCalled()
```

Add an error case where the main process returns `{ success: false, error: '磁盘空间不足' }`; assert the same message is shown and the function returns `false`.

- [ ] **Step 5: Run export tests and verify RED**

Run: `npx vitest run src/store.test.ts -t "streaming export"`

Expected: FAIL because `exportDataToPath` still calls `getAllImages()` and buffer-based ZIP saving.

- [ ] **Step 6: Replace only the Electron path**

Extract manifest construction to avoid the three existing copies. For `exportDataToPath` in Electron:

1. await `ensureImageStorageMigrated()`;
2. collect referenced IDs only when `exportImages` is true;
3. build entries sequentially;
4. construct version-3 manifest metadata;
5. call `exportZipToPath`;
6. show/return the structured error.

Keep browser `exportData()` behavior unchanged in this task. Remove the unused Electron `generateExportZipBuffer` path only if no references remain.

- [ ] **Step 7: Reconcile cache files after initialization**

After migration succeeds, query metadata-only local paths, convert them to filenames, and call `reconcileRawCacheImages()`. Never reconcile after a failed migration.

- [ ] **Step 8: Update automatic backup error handling**

Wrap the calls in `App.tsx` so rejected migration/export errors are converted to the structured toast and do not become unhandled promise rejections.

- [ ] **Step 9: Run focused integration tests**

Run:

```powershell
npx vitest run src/lib/db.test.ts src/lib/imageStorageMigration.test.ts src/lib/dataExport.test.ts src/store.test.ts electron/streaming-zip.test.ts electron/ipc-handlers.test.ts vite.config.test.ts
```

Expected: all focused tests pass.

### Task 7: Full verification and storage safety audit

**Files:**
- Review all modified files only.

- [ ] **Step 1: Verify no all-image Electron export remains**

Run:

```powershell
rg -n "getAllImages|zipSync|saveZipBuffer" src/store.ts src/lib electron
```

Expected: `getAllImages`/`zipSync` may remain only for browser import/export compatibility; the Electron `exportDataToPath` call chain must not contain them. `saveZipBuffer` may remain for compatibility but must have no Electron backup caller.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`

Expected: exit code 0 with zero failed tests.

- [ ] **Step 3: Run the production build**

Run: `npm run build`

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 4: Inspect the final diff**

Run:

```powershell
git diff --check
git status --short
git diff --stat
```

Expected: no whitespace errors; only scoped files plus the user's pre-existing changes appear.

- [ ] **Step 5: Manual Electron smoke test**

Use a temporary local-save directory and a generated set of large sparse fixture images:

- launch through fixed port 5173;
- confirm a second launch fails instead of creating 5174;
- allow migration to complete and verify migrated records no longer contain original `dataUrl`;
- export and open the resulting ZIP;
- verify no `.partial` remains;
- delete a task and verify its unreferenced cache file is removed.

Record renderer working-set memory before and during export. It should stay approximately flat relative to archive size because image bytes never enter the renderer export plan.
