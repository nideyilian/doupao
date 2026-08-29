# Storage and Streaming Export Design

## Goal

Prevent image history from exhausting IndexedDB or renderer memory, stop development runs from creating a new database when the Vite port changes, and make Electron backups scale with disk size rather than renderer heap size.

## Scope

This change covers the active Electron origin and future data written by the application:

- pin the development server to one port so it cannot create another localhost origin;
- migrate image payloads in the active IndexedDB to local files incrementally;
- delete local image files when their final database reference is removed;
- export Electron backups as a streamed ZIP in the main process;
- return actionable migration and export errors.

It does not automatically delete databases belonging to inactive origins such as `file__0`, `http_localhost_5173`, or `http_localhost_5174`. Those stores cannot be safely merged without opening them under their original origin, so automatic deletion could destroy history that exists nowhere else.

## Architecture

### Stable storage identity

Development uses a fixed Vite port with `strictPort: true`. If the port is occupied, startup fails visibly instead of silently switching origins.

This release deliberately keeps the existing Electron `userData` path. The active localhost history currently lives there, and switching to a fresh development profile before migrating it would make that history appear lost and would temporarily duplicate more than a gigabyte of data. Development-profile isolation is deferred until the active-origin migration has shipped and been verified. Packaged builds continue to use their existing profile and `file://` origin.

### Canonical image storage

For Electron, original image bytes live in `<localSavePath>/cache-images`. IndexedDB retains the image ID, local path, timestamps, dimensions, source, tasks, conversations, and thumbnails.

Migration reads a small bounded batch of legacy image records from the active IndexedDB. For each record:

1. write the image to the canonical cache directory;
2. verify that the write succeeded;
3. update that one IndexedDB record with `localPath`;
4. remove its persisted `dataUrl`;
5. continue from a durable cursor.

Migration runs in the background after normal initialization so application startup is not blocked. Export waits for the same migration promise, avoiding duplicate migrations. A failed item remains untouched in IndexedDB and produces a specific error; it is never deleted merely because migration was attempted.

Browser builds keep using IndexedDB because they have no general-purpose local filesystem.

### File lifecycle and garbage collection

Deleting one image, deleting a batch, or clearing all images first records the associated local paths, commits the IndexedDB deletion, and then asks the Electron main process to remove only files under the configured `cache-images` directory.

Filesystem cleanup is best-effort after the database commit. A failed unlink is logged and can be retried by startup reconciliation; it does not resurrect a deleted database record.

Startup reconciliation compares local cache filenames with current image metadata and removes unreferenced cache files. It never scans or deletes outside the exact canonical cache directory.

### Streaming ZIP export

The renderer builds only a small export manifest and a list of referenced image IDs. It does not call `getAllImages()`, convert all images through Base64, or call `zipSync()`.

After migration, each referenced image resolves to a local file. The renderer sends an export plan to a new Electron IPC handler:

- destination path;
- manifest JSON;
- archive path, source path, and modification time for each image.

The main process validates every path, writes to `<destination>.partial`, and uses fflate's streaming ZIP API with pass-through entries for already-compressed images. On success it closes the archive and atomically renames the partial file. On failure it closes streams, removes the partial file, and returns a structured error message.

Thumbnails are not included in new backups. They are derived data and the existing import/startup backfill regenerates them from originals. The manifest format remains version 3 and `thumbnailFiles` remains optional, preserving compatibility with existing imports.

Browser export retains the current in-memory path for now, with an explicit size warning when the selected payload is too large. The reported failure concerns Electron, where the scalable path is available.

## Data selection

Exports include only images referenced by exported tasks and agent conversations, rather than every record in the image store. IDs are deduplicated before lookup. Missing image records or missing local files fail the export with the affected image ID instead of silently producing an incomplete backup.

Configuration-only exports do not touch image storage.

## Error handling

- Development port collision: fail startup and state that port 5173 is occupied.
- Migration write failure: preserve the legacy IndexedDB payload and report the image ID.
- Missing source file during export: abort, remove `.partial`, and report the image ID/path.
- Destination write failure: abort, remove `.partial`, and return the filesystem error.
- Cache cleanup failure: log it and retry during reconciliation.

IPC handlers return `{ success: true }` or `{ success: false, error }`; the renderer no longer reduces all failures to a bare boolean.

## Testing

Tests will cover:

- development configuration pins the port and refuses fallback;
- legacy-image batching stays bounded and skips records already migrated;
- migration clears `dataUrl` only after a successful file write;
- deletion requests local-file cleanup only after the database transaction completes;
- referenced-image collection excludes orphan records and deduplicates IDs;
- streamed ZIP creation produces a readable archive, preserves manifest/image paths, and removes `.partial` on failure;
- export propagates a concrete error rather than only displaying “导出失败”.

The full Vitest suite and TypeScript/Vite build must pass. A manual Electron verification will use a synthetic multi-gigabyte directory to confirm that renderer memory remains bounded during export.

## Success criteria

- Vite never creates a 5174 IndexedDB because 5173 was occupied.
- An occupied port cannot silently create another localhost IndexedDB origin.
- Migrating legacy images never loads the complete image store into memory.
- New Electron image records contain `localPath` and no original `dataUrl`.
- Deleting data releases both IndexedDB records and canonical cache files.
- Electron ZIP export no longer uses `getAllImages()`, `dataUrlToBytes()`, or `zipSync()` for original images.
- Failed exports leave no final or `.partial` archive and show the underlying error.
