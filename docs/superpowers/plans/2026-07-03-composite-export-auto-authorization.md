# Composite Export Auto-Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically authorize every absolute composite-export root so manually entered paths keep working after application restart.

**Architecture:** Add one composite-specific IPC endpoint that validates and registers an absolute directory in the existing session allowlist. Expose it through both preload builds and call it once per distinct resolved root before collision checks or image writes.

**Tech Stack:** TypeScript, Electron IPC, React renderer runtime, Vitest

---

### Task 1: Main-process authorization helper

**Files:**
- Modify: `electron/ipc-handlers.ts`
- Modify: `electron/ipc-handlers.test.ts`

- [ ] **Step 1: Write the failing IPC helper test**

Add:

```ts
it('authorizes arbitrary absolute composite output directories', async () => {
  const mod = await import('./ipc-handlers')
  const authorize = (mod as {
    authorizeCompositeOutputDirectory?: (value: unknown) => boolean
  }).authorizeCompositeOutputDirectory

  expect(authorize).toBeTypeOf('function')
  expect(authorize!(path.join(os.tmpdir(), 'manual-composite-output'))).toBe(true)
  expect(authorize!('relative/output')).toBe(false)
  expect(authorize!('')).toBe(false)
  expect(authorize!(null)).toBe(false)
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest run electron/ipc-handlers.test.ts -t "authorizes arbitrary absolute composite output directories"
```

Expected: FAIL because `authorizeCompositeOutputDirectory` is undefined.

- [ ] **Step 3: Implement the helper**

Add near the existing allowlist helpers:

```ts
export function authorizeCompositeOutputDirectory(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value)) return false
  addAllowedRoot(value)
  return true
}
```

Register the IPC endpoint:

```ts
ipcMain.handle(
  'composite:authorize-output-directory',
  async (_event, { dirPath }: { dirPath?: unknown }) =>
    authorizeCompositeOutputDirectory(dirPath),
)
```

- [ ] **Step 4: Run IPC tests and verify GREEN**

Run:

```powershell
npx vitest run electron/ipc-handlers.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add electron/ipc-handlers.ts electron/ipc-handlers.test.ts
git commit -m "feat: authorize absolute composite output roots"
```

### Task 2: Preload API contract

**Files:**
- Modify: `electron/preload.ts`
- Modify: `electron/preload.cjs`
- Modify: `src/lib/localSave.ts`

- [ ] **Step 1: Add the typed renderer contract**

Add to the `ElectronAPI` type:

```ts
authorizeCompositeOutputDirectory?: (dirPath: string) => Promise<boolean>
```

- [ ] **Step 2: Expose the endpoint through both preload files**

Add beside `saveCompositeImage` in `electron/preload.ts`:

```ts
authorizeCompositeOutputDirectory: (dirPath: string) =>
  ipcRenderer.invoke('composite:authorize-output-directory', { dirPath }),
```

Add beside `saveCompositeImage` in `electron/preload.cjs`:

```js
authorizeCompositeOutputDirectory: (dirPath) =>
  ipcRenderer.invoke('composite:authorize-output-directory', { dirPath }),
```

- [ ] **Step 3: Run TypeScript checking**

Run:

```powershell
npx tsc -b --pretty false
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add electron/preload.ts electron/preload.cjs src/lib/localSave.ts
git commit -m "feat: expose composite output authorization"
```

### Task 3: Authorize resolved roots during export

**Files:**
- Modify: `src/features/composite/lib/compositeExportRuntime.ts`
- Modify: `src/features/composite/lib/compositeExportRuntime.test.ts`

- [ ] **Step 1: Write failing runtime helper tests**

Add tests with a mocked API:

```ts
it('authorizes each composite output root once per export run', async () => {
  const authorize = vi.fn(async () => true)
  const api = { authorizeCompositeOutputDirectory: authorize } as unknown as NonNullable<Window['electronAPI']>
  const authorizedRoots = new Set<string>()

  await authorizeCompositeOutputRoot(api, 'D:\\Exports\\A', authorizedRoots)
  await authorizeCompositeOutputRoot(api, 'D:\\Exports\\A', authorizedRoots)
  await authorizeCompositeOutputRoot(api, 'E:\\Exports\\B', authorizedRoots)

  expect(authorize).toHaveBeenCalledTimes(2)
})

it('rejects roots that cannot be authorized', async () => {
  const api = {
    authorizeCompositeOutputDirectory: vi.fn(async () => false),
  } as unknown as NonNullable<Window['electronAPI']>

  await expect(authorizeCompositeOutputRoot(api, 'relative/output', new Set()))
    .rejects.toThrow('输出目录必须是绝对路径')
})
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npx vitest run src/features/composite/lib/compositeExportRuntime.test.ts
```

Expected: FAIL because `authorizeCompositeOutputRoot` does not exist.

- [ ] **Step 3: Implement the runtime helper**

Export:

```ts
export async function authorizeCompositeOutputRoot(
  api: NonNullable<Window['electronAPI']>,
  outputRoot: string,
  authorizedRoots: Set<string>,
) {
  if (authorizedRoots.has(outputRoot)) return
  const authorized = await api.authorizeCompositeOutputDirectory?.(outputRoot)
  if (!authorized) throw new Error('输出目录必须是绝对路径')
  authorizedRoots.add(outputRoot)
}
```

In `runCompositeV2Export`, create one cache before the item loop:

```ts
const authorizedRoots = new Set<string>()
```

Before `resolveCollision`, authorize the resolved root:

```ts
const outputRoot = buildPresetOutputRootPath(item)
await authorizeCompositeOutputRoot(api, outputRoot, authorizedRoots)
const directoryParts = [outputRoot, ...pathParts.subfolders]
```

- [ ] **Step 4: Run runtime and IPC tests**

Run:

```powershell
npx vitest run src/features/composite/lib/compositeExportRuntime.test.ts electron/ipc-handlers.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/features/composite/lib/compositeExportRuntime.ts src/features/composite/lib/compositeExportRuntime.test.ts
git commit -m "fix: auto authorize composite export roots"
```

### Task 4: Full verification

**Files:**
- Verify only

- [ ] **Step 1: Run all tests**

```powershell
npm test
```

Expected: all tests PASS.

- [ ] **Step 2: Build the installed application assets**

```powershell
npm run build
```

Expected: TypeScript, renderer, Electron main process, and preload builds complete successfully.

- [ ] **Step 3: Check the final scope**

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors and no uncommitted files.

- [ ] **Step 4: Confirm success criteria**

Verify tests cover:

```text
arbitrary absolute path -> authorized
relative/empty/malformed path -> rejected
same root in one run -> one IPC call
different roots -> separate IPC calls
authorization occurs before collision detection and writing
```

