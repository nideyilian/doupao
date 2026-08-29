# DOUPAO Asset Kernel

The asset library is a view over a shared local asset kernel. Generation, Agent, SOP, post-processing, compositing, export and external integrations use the same command and identity model.

## Identity and storage

- `Asset` is the stable logical record used by UI, commands and `doupao://assets/{id}` URIs.
- `Blob` is content-addressed by the image hash and owns the physical file metadata.
- `Version` connects one logical asset to a blob and records rendition ancestry.
- `Origin`, parent asset ids and usage events preserve generation and production history.
- Electron stores the searchable catalog in `asset-kernel.sqlite` with FTS5 and cursor pagination. Image bytes remain in the existing content-addressed file cache.
- PWA keeps the same repository and command interfaces with IndexedDB-backed fallback queries.

Machine-generated vectors and perceptual hashes live in separate rebuildable index tables with model id, model version and generation time. They never overwrite user tags or source facts.

## Local REST API

The API is disabled by default. Enable it from **Settings → Data Management → Asset Kernel API**. The panel shows the loopback URL and installation-scoped bearer token.

Security properties:

- listens only on `127.0.0.1`;
- requires `Authorization: Bearer <token>` on every route;
- rejects non-loopback browser origins;
- accepts only allowlisted non-destructive UI commands;
- limits JSON request bodies to 64 KiB;
- never exposes an unauthenticated delete endpoint.

Endpoints:

- `GET /v1/assets?query=&cursor=&limit=`
- `GET /v1/assets/{id}`
- `GET /v1/assets/{id}/content` (authenticated byte stream; metadata responses do not expose local paths)
- `GET /v1/recommendations?query=&context=&similarTo=&limit=`
- `POST /v1/commands`
- `GET /v1/events` (server-sent `asset.created`, `asset.derived`, `asset.updated` events)
- `GET /v1/openapi.json`

Example command body:

```json
{
  "action": "useAsReference",
  "assetId": "asset:..."
}
```

Allowed actions are `useAsReference`, `openInPostprocess`, `openInComposite`, `reuseGenerationConfig` and `exportAsset`.

## MCP stdio server

Launch the installed DOUPAO executable with:

```text
DOUPAO.exe --asset-mcp
```

The stdio server implements MCP protocol revision `2025-06-18` and exposes:

- resource template `doupao://assets/{id}`;
- `search_assets`;
- `get_asset`;
- `recommend_assets`;
- `run_asset_command`;
- `export_asset` (copy-only and refuses to overwrite an existing file).

Commands that affect the active workspace require the authenticated local REST API to be enabled. Read-only catalog tools and direct export continue to work against SQLite without opening the renderer.

## Rebuild and migration behavior

The first Electron startup after this migration copies existing IndexedDB asset metadata into SQLite in bounded batches. Existing public asset ids remain valid; missing blob and version identities are filled without rewriting legacy links. The machine index can be deleted and rebuilt from asset metadata and local image files.
