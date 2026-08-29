# Composite Assets IndexedDB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store composite LOGO and embedded preset image binaries in IndexedDB, persist only stable references in Zustand, migrate legacy Base64 safely, and include composite state and assets in full backups.

**Architecture:** Add an isolated `compositeAssets` IndexedDB object store and a feature-local asset service for hashing, Blob conversion, loading, caching, migration, and reference collection. Zustand keeps metadata and `stored` asset references; migration writes every Blob first and strips Base64 only after success. Backup export/import treats the composite snapshot and its referenced assets as one configuration unit.

**Tech Stack:** TypeScript, IndexedDB, Zustand 5 persist middleware, React 19, Vitest, fflate, Electron IPC

---

## File Map

- `src/types.ts`: shared IndexedDB record and ZIP manifest fields.
- `src/lib/db.ts`: `compositeAssets` schema and transaction helpers.
- `src/lib/db.test.ts`: IndexedDB CRUD and batch transaction tests.
- `src/features/composite/lib/compositeAssets.ts`: Blob hashing, asset storage/loading, object URL cache, reference collection.
- `src/features/composite/lib/compositeAssets.test.ts`: pure asset service and reference tests.
- `src/features/composite/lib/compositeAssetMigration.ts`: legacy Base64 collection and all-or-nothing Store transformation.
- `src/features/composite/lib/compositeAssetMigration.test.ts`: migration success/failure/idempotency tests.
- `src/features/composite/lib/compositeV2Types.ts`: metadata and `stored` reference types plus backup snapshot type.
- `src/features/composite/storeV2.ts`: migration trigger, metadata actions, imported snapshot replacement.
- `src/features/composite/storeV2.test.ts`: no-Base64 persistence and imported snapshot tests.
- `src/features/composite/components/PresetManagementTab.tsx`: IndexedDB-first imports, async LOGO previews, reference-safe deletion.
- `src/features/composite/components/PresetManagementTab.test.tsx`: import, preview, and deletion tests.
- `src/features/composite/components/PresetCanvasEditor.tsx`, `src/features/composite/components/PresetLayerPanel.tsx`: shared stored-asset resolution.
- `src/features/composite/lib/compositeRendererV2.ts`: shared stored-asset resolution during export.
- `electron/streaming-zip.ts`, `electron/streaming-zip.test.ts`: inline composite asset ZIP entries.
- `electron/ipc-handlers.ts`, `electron/ipc-handlers.test.ts`: validate inline streaming entries.
- `src/store.ts`, `src/store.test.ts`: composite backup export/import.

### Task 1: Add the composite asset IndexedDB store

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/db.ts`
- Modify: `src/lib/db.test.ts`

- [ ] **Step 1: Write failing CRUD and atomic batch tests**

Add tests that exercise the real exported APIs through the existing IndexedDB request stubs:

```ts
it('stores and reads composite assets by id', async () => {
  const blob = new Blob(['logo'], { type: 'image/png' })
  await putCompositeAsset({ id: 'asset-a', blob, createdAt: 1 })
  expect(await getCompositeAsset('asset-a')).toMatchObject({ id: 'asset-a', createdAt: 1 })
})

it('writes a composite asset batch in one transaction', async () => {
  await putCompositeAssets([
    { id: 'asset-a', blob: new Blob(['a']), createdAt: 1 },
    { id: 'asset-b', blob: new Blob(['b']), createdAt: 2 },
  ])
  expect(transactionCalls).toContainEqual(['compositeAssets', 'readwrite'])
})
```

- [ ] **Step 2: Run the database tests and verify RED**

Run:

```powershell
npm test -- src/lib/db.test.ts
```

Expected: FAIL because the composite asset APIs do not exist.

- [ ] **Step 3: Add the record type and schema**

Add to `src/types.ts`:

```ts
export interface StoredCompositeAsset {
  id: string
  blob: Blob
  createdAt: number
}
```

In `src/lib/db.ts`, increase `DB_VERSION` to `5`, add `STORE_COMPOSITE_ASSETS = 'compositeAssets'`, and create the object store with `{ keyPath: 'id' }` during upgrade.

- [ ] **Step 4: Implement the focused DB helpers**

Implement:

```ts
export function getCompositeAsset(id: string): Promise<StoredCompositeAsset | undefined>
export function batchGetCompositeAssets(ids: string[]): Promise<Map<string, StoredCompositeAsset>>
export function putCompositeAsset(asset: StoredCompositeAsset): Promise<IDBValidKey>
export function putCompositeAssets(assets: StoredCompositeAsset[]): Promise<void>
export function deleteCompositeAsset(id: string): Promise<undefined>
```

`putCompositeAssets` must use one `compositeAssets` read-write transaction, call `store.put` for every record, resolve on `tx.oncomplete`, and reject on `tx.onerror` or `tx.onabort`.

- [ ] **Step 5: Run tests and verify GREEN**

```powershell
npm test -- src/lib/db.test.ts
```

- [ ] **Step 6: Commit**

```powershell
git add -- src/types.ts src/lib/db.ts src/lib/db.test.ts
git commit -m "feat: add composite asset IndexedDB store"
```

### Task 2: Build the composite asset service

**Files:**
- Create: `src/features/composite/lib/compositeAssets.ts`
- Create: `src/features/composite/lib/compositeAssets.test.ts`
- Modify: `src/features/composite/lib/compositeV2Types.ts`

- [ ] **Step 1: Write failing hashing, storage, loading, and reference tests**

Cover:

```ts
it('deduplicates equal blobs by content hash', async () => {
  const putMany = vi.fn().mockResolvedValue(undefined)
  const ids = await storeCompositeBlobs(
    [new Blob(['same']), new Blob(['same'])],
    { putMany },
  )
  expect(ids[0]).toBe(ids[1])
  expect(putMany.mock.calls[0][0]).toHaveLength(1)
})

it('collects every library and preset stored reference', () => {
  expect(collectCompositeAssetIds({
    projectLogos: [{ id: 'logo', name: 'Logo', assetId: 'asset-a' }],
    presets: [{ layers: [{ asset: { kind: 'stored', assetId: 'asset-b' } }] }],
  })).toEqual(['asset-a', 'asset-b'])
})
```

- [ ] **Step 2: Verify RED**

```powershell
npm test -- src/features/composite/lib/compositeAssets.test.ts
```

- [ ] **Step 3: Update the domain types**

Change `CompositeV2ProjectLogo` to use `assetId`. Add the new reference variant:

```ts
| { kind: 'stored'; assetId: string; name?: string }
```

Keep legacy shapes in explicitly named migration-only types:

```ts
export type LegacyCompositeProjectLogo = Omit<CompositeV2ProjectLogo, 'assetId'> & { dataUrl: string }
export type LegacyCompositeAssetRef =
  | { kind: 'dataUrl'; dataUrl: string; name?: string }
  | { kind: 'project'; id: string }
```

- [ ] **Step 4: Implement the service**

Implement:

```ts
export async function hashCompositeBlob(blob: Blob): Promise<string>
export async function dataUrlToCompositeBlob(dataUrl: string): Promise<Blob>
export async function storeCompositeBlobs(blobs: Blob[], deps = defaultDeps): Promise<string[]>
export async function getCompositeAssetObjectUrl(assetId: string): Promise<string | null>
export function revokeCompositeAssetObjectUrl(assetId: string): void
export function collectCompositeAssetIds(state: Pick<CompositeV2State, 'projectLogos' | 'presets'>): string[]
export function isCompositeAssetReferenced(state: Pick<CompositeV2State, 'projectLogos' | 'presets'>, assetId: string): boolean
```

Hash `await blob.arrayBuffer()` with SHA-256 and use the existing deterministic fallback style when `crypto.subtle` is unavailable. Return one asset ID per input Blob while deduplicating the records passed to `putCompositeAssets`. Cache object URLs by `assetId`; revoke and remove them on deletion.

- [ ] **Step 5: Verify GREEN and commit**

```powershell
npm test -- src/features/composite/lib/compositeAssets.test.ts
git add -- src/features/composite/lib/compositeAssets.ts src/features/composite/lib/compositeAssets.test.ts src/features/composite/lib/compositeV2Types.ts
git commit -m "feat: add composite asset service"
```

### Task 3: Migrate legacy Base64 state safely

**Files:**
- Create: `src/features/composite/lib/compositeAssetMigration.ts`
- Create: `src/features/composite/lib/compositeAssetMigration.test.ts`
- Modify: `src/features/composite/storeV2.ts`
- Modify: `src/features/composite/storeV2.test.ts`

- [ ] **Step 1: Write failing migration tests**

Test library data URLs, standalone layer data URLs, legacy project references, duplicate content, and write failure:

```ts
it('does not change Zustand state when the asset transaction fails', async () => {
  const legacy = createLegacyState()
  const setState = vi.fn()
  await expect(migrateLegacyCompositeAssets({
    getState: () => legacy,
    setState,
    storeAssets: async () => { throw new Error('quota') },
  })).rejects.toThrow('quota')
  expect(setState).not.toHaveBeenCalled()
  expect(legacy.projectLogos[0].dataUrl).toContain('base64')
})
```

The success test must assert that `JSON.stringify(getCompositeV2PersistedState(state))` contains neither `base64,` nor `"dataUrl"`.

- [ ] **Step 2: Verify RED**

```powershell
npm test -- src/features/composite/lib/compositeAssetMigration.test.ts src/features/composite/storeV2.test.ts
```

- [ ] **Step 3: Implement migration collection and transformation**

Implement:

```ts
export function hasLegacyCompositeAssets(state: unknown): boolean
export async function migrateLegacyCompositeAssets(deps: {
  getState: () => CompositeV2StoreState
  setState: (patch: Partial<CompositeV2StoreState>) => void
  storeAssets?: typeof storeCompositeBlobs
}): Promise<number>
```

Collect every legacy data URL, convert/hash/store the unique Blobs first, then transform the latest state once. Resolve legacy project references through the migrated LOGO ID-to-asset-ID map. Preserve path/internal/stored references unchanged.

- [ ] **Step 4: Trigger migration after hydration**

Add `onRehydrateStorage` to the Zustand persist options. Queue migration in a microtask so `useCompositeV2Store` is initialized:

```ts
onRehydrateStorage: () => (_state, error) => {
  if (error) return
  queueMicrotask(() => {
    void migrateLegacyCompositeAssets({
      getState: useCompositeV2Store.getState,
      setState: (patch) => useCompositeV2Store.setState(patch),
    }).catch((migrationError) => console.error('后期处理资源迁移失败:', migrationError))
  })
},
```

- [ ] **Step 5: Ensure persisted state rejects new Base64**

Update Store actions and types so `addProjectLogos` accepts only metadata with `assetId`. Keep legacy values readable during the migration window, but never create new ones.

- [ ] **Step 6: Verify GREEN and commit**

```powershell
npm test -- src/features/composite/lib/compositeAssetMigration.test.ts src/features/composite/storeV2.test.ts
git add -- src/features/composite/lib/compositeAssetMigration.ts src/features/composite/lib/compositeAssetMigration.test.ts src/features/composite/storeV2.ts src/features/composite/storeV2.test.ts
git commit -m "feat: migrate composite Base64 assets"
```

### Task 4: Switch the LOGO library and renderers to stored references

**Files:**
- Modify: `src/features/composite/components/PresetManagementTab.tsx`
- Modify: `src/features/composite/components/PresetManagementTab.test.tsx`
- Modify: `src/features/composite/components/PresetCanvasEditor.tsx`
- Modify: `src/features/composite/components/PresetLayerPanel.tsx`
- Modify: `src/features/composite/lib/compositeRendererV2.ts`
- Modify: relevant component/renderer tests

- [ ] **Step 1: Write failing UI and renderer tests**

Test that importing awaits IndexedDB before metadata appears, library previews load by `assetId`, selected LOGOs create `stored` layer references, and export rendering loads the stored Blob URL.

```ts
expect(useCompositeV2Store.getState().projectLogos[0]).toEqual({
  id: expect.any(String),
  name: 'logo.png',
  assetId: 'asset-logo',
})
expect(useCompositeV2Store.getState().presets[0]?.layers[0]?.asset).toEqual({
  kind: 'stored',
  assetId: 'asset-logo',
  name: 'logo.png',
})
```

- [ ] **Step 2: Verify RED**

```powershell
npm test -- src/features/composite/components/PresetManagementTab.test.tsx src/features/composite/components/PresetCanvasEditor.test.tsx src/features/composite/lib/compositeRendererV2.test.ts
```

- [ ] **Step 3: Make imports IndexedDB-first**

For both Electron paths and browser `FileList` imports:

1. create Blobs;
2. call `storeCompositeBlobs`;
3. construct metadata using returned asset IDs;
4. call `store.addProjectLogos` only after storage succeeds;
5. catch failure and show an error without adding metadata.

- [ ] **Step 4: Load previews asynchronously**

Maintain a component-local `Record<assetId, objectUrl>` populated by `getCompositeAssetObjectUrl`. Pass resolved URLs to `FloatingLogoLibrary`. Do not persist these URLs.

- [ ] **Step 5: Use stored references everywhere**

Selecting a LOGO calls:

```ts
store.replaceOrAddLogoLayer(
  activePreset.id,
  { kind: 'stored', assetId: asset.assetId, name: asset.name },
  selectedLayerId,
)
```

Update editor, layer panel, preview, and renderer resolution to call the shared loader for `stored`. Keep path/internal and migration-window legacy fallbacks.

- [ ] **Step 6: Verify GREEN and commit**

```powershell
npm test -- src/features/composite/components/PresetManagementTab.test.tsx src/features/composite/components/PresetCanvasEditor.test.tsx src/features/composite/lib/compositeRendererV2.test.ts
git add -- src/features/composite/components/PresetManagementTab.tsx src/features/composite/components/PresetManagementTab.test.tsx src/features/composite/components/PresetCanvasEditor.tsx src/features/composite/components/PresetLayerPanel.tsx src/features/composite/lib/compositeRendererV2.ts
git commit -m "feat: load composite assets from IndexedDB"
```

### Task 5: Add reference-aware deletion

**Files:**
- Modify: `src/features/composite/components/PresetManagementTab.tsx`
- Modify: `src/features/composite/components/PresetManagementTab.test.tsx`
- Modify: `src/features/composite/lib/compositeAssets.ts`
- Modify: `src/features/composite/lib/compositeAssets.test.ts`

- [ ] **Step 1: Write failing deletion tests**

Cover:

- deleting library metadata does not alter a preset layer;
- the Blob remains when another library item or layer references it;
- the Blob is deleted and its object URL revoked when no references remain.

- [ ] **Step 2: Verify RED**

```powershell
npm test -- src/features/composite/lib/compositeAssets.test.ts src/features/composite/components/PresetManagementTab.test.tsx
```

- [ ] **Step 3: Implement guarded deletion**

After removing metadata, read the latest Store state. Only call `deleteCompositeAsset(assetId)` and `revokeCompositeAssetObjectUrl(assetId)` when `isCompositeAssetReferenced(latest, assetId)` is false. Catch deletion errors so a harmless orphan does not restore deleted metadata or break the preset.

- [ ] **Step 4: Verify GREEN and commit**

```powershell
npm test -- src/features/composite/lib/compositeAssets.test.ts src/features/composite/components/PresetManagementTab.test.tsx
git add -- src/features/composite/lib/compositeAssets.ts src/features/composite/lib/compositeAssets.test.ts src/features/composite/components/PresetManagementTab.tsx src/features/composite/components/PresetManagementTab.test.tsx
git commit -m "feat: protect referenced composite assets"
```

### Task 6: Extend ZIP manifests and Electron streaming entries

**Files:**
- Modify: `src/types.ts`
- Modify: `electron/streaming-zip.ts`
- Modify: `electron/streaming-zip.test.ts`
- Modify: `electron/ipc-handlers.ts`
- Modify: `electron/ipc-handlers.test.ts`

- [ ] **Step 1: Write failing manifest and inline-entry tests**

Add a streaming ZIP test:

```ts
await writeStreamingZip({
  destinationPath,
  manifestJson: '{}',
  entries: [{
    archivePath: 'composite-assets/asset-a.png',
    data: new Uint8Array([1, 2, 3]),
    mtime: 1,
  }],
})
```

Assert the archive contains the inline bytes. Add validation tests rejecting entries with both/neither `sourcePath` and `data`, and rejecting paths outside `images/` or `composite-assets/`.

- [ ] **Step 2: Verify RED**

```powershell
npm test -- electron/streaming-zip.test.ts electron/ipc-handlers.test.ts
```

- [ ] **Step 3: Extend the manifest**

Add `compositeState` and `compositeAssetFiles` to `ExportData`. Use a type-only import for the composite backup snapshot.

- [ ] **Step 4: Extend streaming entries**

Change entries to a discriminated union:

```ts
export type StreamingZipEntry = {
  archivePath: string
  mtime?: number
} & (
  | { sourcePath: string; data?: never }
  | { sourcePath?: never; data: Uint8Array }
)
```

Stream `sourcePath` entries as before. Push `data` entries directly through `ZipPassThrough`. Update IPC validation and path authorization without applying filesystem checks to inline entries.

- [ ] **Step 5: Verify GREEN and commit**

```powershell
npm test -- electron/streaming-zip.test.ts electron/ipc-handlers.test.ts
git add -- src/types.ts electron/streaming-zip.ts electron/streaming-zip.test.ts electron/ipc-handlers.ts electron/ipc-handlers.test.ts
git commit -m "feat: stream composite assets in backups"
```

### Task 7: Export and import composite configuration with assets

**Files:**
- Modify: `src/features/composite/storeV2.ts`
- Modify: `src/features/composite/storeV2.test.ts`
- Modify: `src/store.ts`
- Modify: `src/store.test.ts`

- [ ] **Step 1: Write failing backup round-trip tests**

Test Web and Electron export:

```ts
expect(manifest.compositeState?.projectLogos[0]?.assetId).toBe('asset-a')
expect(manifest.compositeAssetFiles?.['asset-a'].path).toMatch(/^composite-assets\//)
```

Test import ordering by making asset restore reject and asserting `useCompositeV2Store.setState` was not called. Test a successful round trip restores the Blob before replacing the composite persisted domain state.

- [ ] **Step 2: Verify RED**

```powershell
npm test -- src/store.test.ts src/features/composite/storeV2.test.ts
```

- [ ] **Step 3: Add snapshot replacement**

Export `CompositeV2PersistedState` and add:

```ts
export function replaceCompositeV2PersistedState(snapshot: CompositeV2PersistedState): void {
  const current = useCompositeV2Store.getState()
  const merged = mergeCompositeV2PersistedState(snapshot, current)
  useCompositeV2Store.setState(getCompositeV2PersistedState(merged))
}
```

This replaces persisted composite domain fields while leaving fresh transient batch/export/undo state in place.

- [ ] **Step 4: Export composite state and referenced assets**

When `exportConfig` is enabled, dynamically import the composite Store/service, obtain the persisted snapshot, collect referenced IDs, fetch every Blob, derive an extension from MIME, and add `compositeState` plus `compositeAssetFiles`.

For Web export add Blob bytes to `zipFiles`. For Electron pass inline `Uint8Array` entries to `exportZipToPath`. A missing referenced Blob throws and fails export explicitly.

- [ ] **Step 5: Import resources before state**

When `importConfig` and `data.compositeState` are present:

1. validate every referenced asset has a manifest entry and ZIP bytes;
2. build all `StoredCompositeAsset` records;
3. call `putCompositeAssets`;
4. call `replaceCompositeV2PersistedState`.

Do not replace the composite state if validation or the IndexedDB transaction fails.

- [ ] **Step 6: Verify GREEN and commit**

```powershell
npm test -- src/store.test.ts src/features/composite/storeV2.test.ts
git add -- src/features/composite/storeV2.ts src/features/composite/storeV2.test.ts src/store.ts src/store.test.ts
git commit -m "feat: back up composite assets"
```

### Task 8: Full verification

**Files:**
- Verify all files changed above.

- [ ] **Step 1: Confirm no new persisted Base64 paths**

```powershell
rg -n "projectLogos.*dataUrl|kind: 'dataUrl'" src/features/composite
```

Expected: only migration compatibility code and migration fixtures.

- [ ] **Step 2: Run focused composite, database, and backup tests**

```powershell
npm test -- src/lib/db.test.ts src/features/composite/storeV2.test.ts src/features/composite/lib/compositeAssets.test.ts src/features/composite/lib/compositeAssetMigration.test.ts src/features/composite/components/PresetManagementTab.test.tsx src/features/composite/components/PresetCanvasEditor.test.tsx src/features/composite/lib/compositeRendererV2.test.ts electron/streaming-zip.test.ts electron/ipc-handlers.test.ts src/store.test.ts
```

- [ ] **Step 3: Run the complete suite**

```powershell
npm test -- --reporter=dot
```

Expected: all test files pass.

- [ ] **Step 4: Build production bundles**

```powershell
npm run build
```

Expected: TypeScript, Web, Electron main, and preload builds succeed.

- [ ] **Step 5: Review the final diff**

```powershell
git diff --check
git status --short
git log --oneline --decorate -10
```

Expected: no whitespace errors and only planned files/commits.
