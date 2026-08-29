# Composite Assets IndexedDB Design

## Goal

Move all composite postprocess LOGO and embedded layer image binary data out of Zustand/localStorage and into IndexedDB. Zustand must retain only metadata and stable asset references. Existing Base64 data must migrate without loss, and full configuration backups must include the referenced assets.

## Scope

Included:

- project LOGO library binary storage;
- preset image and LOGO layers whose asset is currently a data URL;
- automatic migration of existing persisted Base64 data;
- preview, editor, and renderer asset loading;
- reference-aware deletion;
- Web and Electron ZIP export/import of composite state and assets.

Excluded:

- task/generated-image storage behavior;
- background image storage;
- changing the visual LOGO library workflow into a folder-watching library;
- unrelated backup format changes.

## Storage Model

Increase the application IndexedDB schema version and add a `compositeAssets` object store keyed by `id`.

```ts
type StoredCompositeAsset = {
  id: string
  blob: Blob
  createdAt: number
}
```

Asset IDs are content hashes. Identical binaries are stored once.

Persisted LOGO metadata becomes:

```ts
type CompositeV2ProjectLogo = {
  id: string
  name: string
  assetId: string
  width?: number
  height?: number
}
```

Persisted preset layers use a stable binary reference:

```ts
type CompositeV2ImageAssetRef =
  | { kind: 'path'; path: string }
  | { kind: 'internal'; path: string; originalPath?: string }
  | { kind: 'stored'; assetId: string; name?: string }
```

Legacy `dataUrl` and `project` references remain accepted only by migration and compatibility readers. Newly written state must use `stored`.

## IndexedDB API

Add focused helpers in `src/lib/db.ts`:

- `getCompositeAsset(id)`
- `batchGetCompositeAssets(ids)`
- `putCompositeAsset(asset)`
- `putCompositeAssets(assets)` using one read-write transaction
- `deleteCompositeAsset(id)`

Add a small composite-specific module responsible for:

- converting data URLs and files to Blobs;
- hashing Blob contents;
- storing one or more assets before metadata is committed;
- loading a Blob by ID;
- maintaining and revoking cached object URLs.

The general task image store is not reused because its cleanup, Electron filesystem migration, thumbnails, and backup references have different ownership rules.

## New Import and Rendering Flow

When users import LOGOs:

1. Convert selected files or Electron data URLs into Blobs.
2. Hash and store all assets in IndexedDB.
3. Only after the transaction succeeds, append `{ id, name, assetId }` metadata to Zustand.

Selecting a library LOGO writes `{ kind: 'stored', assetId, name }` into the preset layer. Preset layers therefore remain renderable after the corresponding library entry is removed.

The LOGO library, canvas editor, layer panel, preview renderer, and export renderer resolve `stored` references through one shared asynchronous asset loader. Object URLs are cached in memory and revoked when their records are deleted.

## Legacy Migration

Migration scans:

- `projectLogos[].dataUrl`;
- preset layers with `asset.kind === 'dataUrl'`;
- preset layers with `asset.kind === 'project'`.

The process is idempotent:

1. Collect and hash all legacy data URLs.
2. Store all required Blobs in a single IndexedDB transaction.
3. After that transaction succeeds, transform the latest Zustand state:
   - replace LOGO `dataUrl` with `assetId`;
   - replace layer `dataUrl` with `stored`;
   - resolve legacy `project` references through migrated LOGO metadata.
4. Commit the transformed state once, allowing Zustand persistence to remove Base64 from localStorage.

Migration runs after Zustand hydration. New imports already use IndexedDB while migration is active. The final transform applies to the latest Store state so concurrent names, ordering, and preset edits are preserved.

If hashing or IndexedDB writing fails, Zustand is not changed. Existing Base64 data remains usable and migration retries on a later startup. Partially written content-hash records are harmless and reusable.

## Deletion and Garbage Collection

Deleting a LOGO library entry removes only its metadata first. The binary is deleted only when no remaining project LOGO and no preset layer references its `assetId`.

The reference check runs against the latest Store state immediately before deletion. A failed binary deletion leaves an orphaned IndexedDB record but never breaks a live preset. No broad task-image cleanup behavior is changed.

## Backup and Restore

Extend the ZIP manifest with:

```ts
type ExportData = {
  compositeState?: CompositeV2PersistedSnapshot
  compositeAssetFiles?: Record<string, {
    path: string
    createdAt: number
  }>
}
```

When `exportConfig` is enabled:

- export the composite persisted snapshot;
- collect every referenced composite `assetId`;
- include each Blob under `composite-assets/<assetId>.<ext>`, regardless of `exportImages`.

Web export writes Blob bytes through the existing in-memory ZIP flow. Electron streaming ZIP accepts a second, inline-byte entry form for these relatively small resources while retaining source-path streaming for task images. Archive path validation allows only `images/` and `composite-assets/`.

During import:

1. Validate all composite asset manifest entries and ZIP files.
2. Restore all composite assets in one IndexedDB transaction.
3. Only after resource restore succeeds, replace the persisted composite domain state with the imported snapshot while retaining fresh transient batch/export/undo state.

Missing or invalid composite resources reject the composite portion instead of committing broken references. Existing settings, tasks, and task-image import semantics remain unchanged.

## Error Handling

- Importing a new LOGO reports storage failure and does not add metadata.
- Missing assets render as the existing empty/missing-image state and log the asset ID.
- Migration failure preserves legacy data.
- Backup export fails explicitly when a referenced asset is missing.
- Backup import does not commit composite metadata until all required assets exist.

## Testing

Add tests for:

- IndexedDB schema upgrade and composite asset CRUD;
- Blob hashing and deduplication;
- batch writes completing before Zustand metadata updates;
- migration of library, standalone data URL, and legacy project references;
- migration failure preserving legacy state;
- reference-aware deletion;
- shared loading in the library/editor/renderer;
- persisted Store snapshots containing no Base64;
- Web ZIP composite asset export/import;
- Electron streaming ZIP inline entries and archive-path validation;
- full configuration backup round trip.

Run focused tests, the full Vitest suite, and the production build.
