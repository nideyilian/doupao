# Storage Resilience and Renderer Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 防止大数据导致 Electron 渲染进程崩溃，并建立完整、可验证、可迁移的数据保存与备份体系。

**Architecture:** 将工作拆成三个可独立交付的子项目：渲染稳定性、存储一致性、备份与迁移。大对象继续保存在 IndexedDB/Electron 文件系统，React 只持有当前窗口需要的摘要和图片；所有导入和迁移先进入 staging 区，验证后提交。

**Tech Stack:** React 19、TypeScript、Zustand 5、IndexedDB、Electron 33、Vitest、fflate。

---

## Success criteria

- 10,000 条任务的工作区启动后不会一次创建 10,000 个卡片 DOM。
- 连续滚动历史列表时，已挂载任务卡片保持在固定窗口内。
- 启动不再为全部历史图片主动生成缩略图。
- 图片内存缓存受字节预算约束，而不是仅受条数约束。
- IndexedDB 写操作只在事务 `complete` 后报告成功。
- Renderer OOM 后进入安全模式，不会无限重载。
- 完整备份覆盖设置、任务、图片、对话、词库、后处理配置和合成资源。
- 默认备份不包含 API Key；选择包含密钥时必须加密。
- 导入失败不会留下部分任务、图片或设置。
- 旧版本迁移支持断点续跑，源数据在验证完成前不删除。

## Subproject A: Renderer stability

### Task 1: Add renderer crash diagnostics and safe mode

**Files:**
- Create: `electron/renderer-crash-recovery.ts`
- Create: `electron/renderer-crash-recovery.test.ts`
- Modify: `electron/main.ts:148`
- Modify: `electron/preload.ts`
- Modify: `electron/preload.cjs`
- Modify: `src/App.tsx:81`

- [ ] **Step 1: Write failing crash-policy tests**

```ts
import { describe, expect, it } from 'vitest'
import { decideRendererRecovery } from './renderer-crash-recovery'

describe('decideRendererRecovery', () => {
  it('enters safe mode after two crashes in 60 seconds', () => {
    expect(decideRendererRecovery([1_000, 30_000], 40_000)).toEqual({
      reload: true,
      safeMode: true,
    })
  })

  it('uses a normal reload for an isolated crash', () => {
    expect(decideRendererRecovery([1_000], 120_000)).toEqual({
      reload: true,
      safeMode: false,
    })
  })
})
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npx vitest run electron/renderer-crash-recovery.test.ts`

Expected: FAIL because `renderer-crash-recovery.ts` does not exist.

- [ ] **Step 3: Implement the crash policy**

```ts
export function decideRendererRecovery(crashes: number[], now: number) {
  const recent = crashes.filter((time) => now - time <= 60_000)
  return { reload: true, safeMode: recent.length >= 2 }
}
```

Persist JSONL diagnostics under `app.getPath('userData')/diagnostics/renderer-crashes.jsonl` with timestamp, `details.reason`, exit code and safe-mode decision. Expose `getStartupMode()` through preload. When safe mode is active, `App.tsx` must initialize with history thumbnails and background migrations paused and show a recovery banner.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run electron/renderer-crash-recovery.test.ts electron/ipc-handlers.test.ts`

Expected: PASS.

### Task 2: Replace progressive accumulation with a bounded render window

**Files:**
- Create: `src/lib/taskGridVirtualWindow.ts`
- Create: `src/lib/taskGridVirtualWindow.test.ts`
- Modify: `src/components/TaskGrid.tsx:29`
- Delete: `src/lib/taskGridWindow.ts`

- [ ] **Step 1: Write failing window-calculation tests**

```ts
import { describe, expect, it } from 'vitest'
import { getGridWindow } from './taskGridVirtualWindow'

describe('getGridWindow', () => {
  it('keeps only visible rows plus overscan', () => {
    expect(getGridWindow({
      itemCount: 10_000,
      columns: 3,
      rowHeight: 176,
      scrollTop: 17_600,
      viewportHeight: 800,
      overscanRows: 3,
    })).toEqual({ start: 282, end: 333, totalHeight: 586_784 })
  })
})
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npx vitest run src/lib/taskGridVirtualWindow.test.ts`

Expected: FAIL because `getGridWindow` is missing.

- [ ] **Step 3: Implement a fixed-row virtual grid**

`getGridWindow` must calculate visible row indexes, add overscan, clamp to the task count and return top/bottom spacers. `TaskGrid` must render only `filteredTasks.slice(start, end)` and remove the cumulative `visibleCount`/IntersectionObserver logic.

- [ ] **Step 4: Add a component regression test**

Render 10,000 task fixtures at a fixed viewport and assert that fewer than 100 `TaskCard` instances are mounted.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run src/lib/taskGridVirtualWindow.test.ts src/components/TaskGrid.test.tsx`

Expected: PASS and mounted card count remains bounded.

### Task 3: Stop global thumbnail backfill

**Files:**
- Modify: `src/store.ts:3654`
- Modify: `src/components/TaskCard.tsx:251`
- Modify: `src/store.test.ts`

- [ ] **Step 1: Add a failing startup test**

Add a test that initializes 1,000 referenced images without thumbnails and asserts that startup does not enqueue all 1,000 IDs.

- [ ] **Step 2: Remove startup-wide scheduling**

Remove `scheduleThumbnailBackfill(referencedImageIds)` from `initStore()`. Keep `ensureImageThumbnailCached()` as the only visible-card entry point. Cancel queued visible work when its card unsubscribes before processing starts.

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/store.test.ts src/components/TaskCard.test.tsx`

Expected: PASS; only mounted cards request thumbnails.

### Task 4: Introduce byte-budgeted image caches

**Files:**
- Create: `src/lib/byteLruCache.ts`
- Create: `src/lib/byteLruCache.test.ts`
- Modify: `src/store.ts:85`
- Modify: `src/features/composite/lib/compositeAssets.ts:13`

- [ ] **Step 1: Write failing eviction tests**

```ts
const cache = new ByteLruCache<string>(10)
cache.set('a', '123456', 6)
cache.set('b', '12345', 5)
expect(cache.has('a')).toBe(false)
expect(cache.has('b')).toBe(true)
expect(cache.bytes).toBe(5)
```

- [ ] **Step 2: Implement the minimum LRU**

The cache must track bytes, refresh recency on `get`, evict oldest entries until under budget, and call an optional disposer. Configure original image data URLs to 128 MiB and thumbnails to 64 MiB. Composite Object URLs must use a disposer that calls `URL.revokeObjectURL`.

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/lib/byteLruCache.test.ts src/features/composite/lib/compositeAssets.test.ts`

Expected: PASS with deterministic eviction and URL revocation.

## Subproject B: Storage consistency and capacity

### Task 5: Make IndexedDB writes resolve on transaction commit

**Files:**
- Modify: `src/lib/db.ts:34`
- Modify: `src/lib/db.test.ts`

- [ ] **Step 1: Write a failing transaction-abort test**

Create a fake request that fires `success`, followed by a transaction `abort`. Assert that `putImage()` rejects rather than resolves.

- [ ] **Step 2: Correct `dbTransaction` semantics**

Capture `req.result` on request success, but resolve only in `tx.oncomplete`. Reject on request error, transaction error and transaction abort.

- [ ] **Step 3: Run database tests**

Run: `npx vitest run src/lib/db.test.ts`

Expected: PASS, including the abort-after-request-success case.

### Task 6: Add storage metrics and high/low-water cleanup

**Files:**
- Create: `src/lib/storageStats.ts`
- Create: `src/lib/storageCleanup.ts`
- Create: `src/lib/storageCleanup.test.ts`
- Modify: `src/types.ts:90`
- Modify: `src/lib/apiProfiles.ts`
- Modify: `src/components/SettingsModal.tsx`
- Modify: `electron/ipc-handlers.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Define settings**

```ts
type StoragePolicy = {
  warningBytes: number
  highWaterBytes: number
  lowWaterBytes: number
  orphanGraceDays: number
}
```

Defaults: warning 4 GiB, high water 5 GiB, low water 4 GiB, orphan grace 7 days. Browser estimates must also report `navigator.storage.estimate()`.

- [ ] **Step 2: Test mark-and-sweep ordering**

Fixtures must prove cleanup order is: stream partials, obsolete thumbnails, expired unreferenced files, then user-approved old non-favorite history. Referenced originals, favorites and active drafts must never be automatic candidates.

- [ ] **Step 3: Implement dry-run and commit modes**

The UI must display candidate count and estimated freed bytes before deletion. Electron filesystem reconciliation must run only after IndexedDB references are loaded successfully and must respect the grace period.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/storageCleanup.test.ts electron/ipc-handlers.test.ts`

Expected: PASS; protected records are never selected.

## Subproject C: Complete backup and migration

### Task 7: Define a versioned complete backup manifest

**Files:**
- Create: `src/lib/backupManifest.ts`
- Create: `src/lib/backupManifest.test.ts`
- Modify: `src/types.ts:560`
- Modify: `src/store.ts:7147`
- Modify: `src/storePostprocess.ts`

- [ ] **Step 1: Define manifest version 4**

```ts
type BackupManifestV4 = {
  format: 'doupao-backup'
  version: 4
  exportedAt: string
  appVersion: string
  includesSecrets: boolean
  domains: {
    settings?: { path: string; sha256: string }
    tasks?: { path: string; count: number; sha256: string }
    conversations?: { path: string; count: number; sha256: string }
    wordLibrary?: { path: string; sha256: string }
    postprocess?: { path: string; sha256: string }
    composite?: { path: string; sha256: string }
  }
  assets: Record<string, { path: string; size: number; sha256: string; type: string }>
}
```

- [ ] **Step 2: Add completeness tests**

Export a fixture containing every domain and assert that the manifest and archive contain each one. Verify that API keys are absent when `includesSecrets` is false.

- [ ] **Step 3: Include the active postprocess store**

Add explicit snapshot/restore functions to `storePostprocess.ts`; do not read raw localStorage from the exporter.

- [ ] **Step 4: Run export tests**

Run: `npx vitest run src/lib/backupManifest.test.ts src/store.test.ts electron/streaming-zip.test.ts`

Expected: PASS with matching SHA-256 values.

### Task 8: Fix automatic backup retention and recovery detection

**Files:**
- Modify: `electron/ipc-handlers.ts:722`
- Modify: `electron/ipc-handlers.test.ts`
- Modify: `src/App.tsx:81`

- [ ] **Step 1: Write failing retention tests**

Create 31 backups and assert that the oldest file no longer exists rather than existing as a zero-byte file.

- [ ] **Step 2: Replace truncation with deletion**

Use `unlinkSync` for expired snapshots. Recovery detection must validate the backup manifest/domain counts instead of looking for obsolete `state.tasks` and `state.agentConversations`.

- [ ] **Step 3: Await initialization before scheduled backup**

`App.tsx` must await a shared `initStore()` promise before checking whether data is empty or launching the weekly backup.

- [ ] **Step 4: Run tests**

Run: `npx vitest run electron/ipc-handlers.test.ts src/App.test.tsx`

Expected: PASS; no empty retention placeholders and no pre-hydration backup.

### Task 9: Stage and atomically commit imports

**Files:**
- Create: `src/lib/backupImport.ts`
- Create: `src/lib/backupImport.test.ts`
- Modify: `src/store.ts:7459`
- Modify: `electron/streaming-zip.ts`

- [ ] **Step 1: Add failing rollback tests**

Import an archive with a missing image and assert that existing tasks, images and settings remain byte-for-byte unchanged.

- [ ] **Step 2: Implement four import phases**

1. Parse and reject unsupported future versions.
2. Validate schema, archive paths, sizes, hashes and cross-references.
3. Write assets and records to temporary stores/directories.
4. Commit metadata and swap temporary files only after all validation succeeds.

Version 1–3 archives must pass through explicit adapters into `BackupManifestV4`; unknown versions must return a read-only/upgrade-required error.

- [ ] **Step 3: Stream large Electron imports**

Do not call `file.arrayBuffer()` and `unzipSync()` for Electron archives. Add main-process streaming extraction into an application-owned staging directory with size and entry-count limits.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/backupImport.test.ts src/store.test.ts electron/streaming-zip.test.ts`

Expected: PASS; every injected failure leaves production data unchanged.

### Task 10: Add migration registry and save-path migration

**Files:**
- Create: `src/lib/migrations/registry.ts`
- Create: `src/lib/migrations/registry.test.ts`
- Create: `src/lib/migrations/v3ToV4.ts`
- Create: `src/lib/storageRootMigration.ts`
- Create: `src/lib/storageRootMigration.test.ts`
- Modify: `src/lib/db.ts:7`
- Modify: `src/lib/localSave.ts:81`
- Modify: `src/components/SettingsModal.tsx:565`

- [ ] **Step 1: Define durable migration metadata**

Add a `meta` IndexedDB store with `schemaVersion`, `appVersion` and a migration journal containing migration ID, status, cursor, source backup and last error.

- [ ] **Step 2: Test resumable migration**

Interrupt migration after two records, rerun it and assert that already verified records are not duplicated and source data remains available.

- [ ] **Step 3: Migrate storage roots safely**

Represent new paths as `{ rootId, relativePath }`. Changing the save directory must copy files, verify size/hash, update metadata transactionally, retain the old root for a rollback window and only then offer cleanup.

- [ ] **Step 4: Run migration tests**

Run: `npx vitest run src/lib/migrations/registry.test.ts src/lib/storageRootMigration.test.ts src/lib/imageStorageMigration.test.ts`

Expected: PASS for interruption, retry, hash mismatch and rollback.

## Final verification

- [ ] Run all automated tests: `npm test`
- [ ] Run production build: `npm run build`
- [ ] Generate a synthetic 10,000-task/20,000-image profile and verify bounded DOM and renderer memory.
- [ ] Scroll from newest to oldest tasks and confirm mounted card count remains bounded.
- [ ] Force-kill the renderer twice and confirm safe mode appears instead of a reload loop.
- [ ] Export and restore a complete backup into a clean profile; compare domain counts and SHA-256 hashes.
- [ ] Interrupt image migration and import at multiple checkpoints; verify restart resumes or rolls back without data loss.
- [ ] Change the Electron save root and verify old images remain readable before and after restart.
