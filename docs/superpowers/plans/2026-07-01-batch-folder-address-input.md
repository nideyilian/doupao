# Batch Folder Address Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make manually entered batch background folders load correctly and replace the add-then-list UI with editable, automatically scanned address rows.

**Architecture:** Add one explicit Electron IPC boundary that validates, session-authorizes, and scans a user-entered directory without weakening the generic file allowlist. Keep address-row editing local to `BatchExportTab`, persist only trimmed non-empty unique folders, and guard asynchronous scans with a request counter so stale results cannot win.

**Tech Stack:** Electron IPC, Node.js filesystem APIs, React 19, TypeScript, Zustand, Vitest, react-test-renderer.

---

## File Structure

- `electron/ipc-handlers.ts`: validate and authorize a manually entered background directory, then return a structured scan result.
- `electron/ipc-handlers.test.ts`: prove valid external folders can be authorized and invalid/symlink inputs are rejected.
- `electron/preload.ts`: expose the typed scan method to the renderer.
- `electron/preload.cjs`: keep the production CommonJS preload API in sync.
- `src/lib/localSave.ts`: declare the renderer-side Electron API result type.
- `src/features/composite/components/BatchExportTab.tsx`: render and manage address rows, automatic scanning, browsing, removal, and stale-result protection.
- `src/features/composite/components/BatchExportTab.test.tsx`: verify the requested interaction and concurrency behavior.

### Task 1: Explicitly authorize and scan typed folders

**Files:**
- Modify: `electron/ipc-handlers.test.ts`
- Modify: `electron/ipc-handlers.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/preload.cjs`
- Modify: `src/lib/localSave.ts`

- [ ] **Step 1: Write failing Electron helper tests**

Add tests that create a directory outside `allowedRoot`, write a supported image fixture, and call the wished-for helper:

```ts
it('authorizes and scans an explicitly entered background folder', async () => {
  const mod = await import('./ipc-handlers')
  const scanEnteredCompositeBackgroundFolder = mod.scanEnteredCompositeBackgroundFolder
  const enteredRoot = mkdtempSync(path.join(os.tmpdir(), 'composite-entered-'))
  writeFixtureFile(path.join(enteredRoot, 'manual.jpg'))

  expect(scanEnteredCompositeBackgroundFolder(enteredRoot, false)).toMatchObject({
    success: true,
    folderPath: realpathSync(enteredRoot),
    files: [{ name: 'manual.jpg', relativeDir: '' }],
  })

  rmSync(enteredRoot, { recursive: true, force: true })
})

it('rejects missing, file, and symlink folder inputs', async () => {
  const mod = await import('./ipc-handlers')
  const outsideRoot = mkdtempSync(path.join(os.tmpdir(), 'composite-entered-'))
  const filePath = path.join(outsideRoot, 'not-a-folder.jpg')
  const linkPath = path.join(outsideRoot, 'linked-folder')
  writeFixtureFile(filePath)
  symlinkSync(fixtureDir, linkPath, 'junction')

  expect(mod.scanEnteredCompositeBackgroundFolder(path.join(outsideRoot, 'missing'), false).success).toBe(false)
  expect(mod.scanEnteredCompositeBackgroundFolder(filePath, false).success).toBe(false)
  expect(mod.scanEnteredCompositeBackgroundFolder(linkPath, false).success).toBe(false)

  rmSync(outsideRoot, { recursive: true, force: true })
})
```

Import `realpathSync` in the test file.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run electron/ipc-handlers.test.ts
```

Expected: FAIL because `scanEnteredCompositeBackgroundFolder` does not exist.

- [ ] **Step 3: Implement the structured scan boundary**

In `electron/ipc-handlers.ts`, add:

```ts
type CompositeBackgroundScanResult =
  | { success: true; folderPath: string; files: CompositeBackgroundFile[] }
  | { success: false; error: string }

export function scanEnteredCompositeBackgroundFolder(
  dirPath: string,
  recursive: boolean,
): CompositeBackgroundScanResult {
  try {
    const normalized = normalizeFsPath(dirPath.trim())
    if (!dirPath.trim() || !existsSync(normalized)) throw new Error('文件夹不存在。')
    const stat = lstatSync(normalized)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('地址不是可读取的文件夹。')
    const realDirectory = realpathSync(normalized)
    addAllowedRoot(realDirectory)
    return {
      success: true,
      folderPath: realDirectory,
      files: listCompositeBackgroundFiles(realDirectory, recursive),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '无法读取文件夹。',
    }
  }
}
```

Register a dedicated handler:

```ts
ipcMain.handle('composite:scan-entered-background-folder', async (_event, payload: unknown) => {
  const parsed = parseCompositeListBackgroundFilesPayload(payload)
  if (!parsed) return { success: false, error: '文件夹参数无效。' }
  return scanEnteredCompositeBackgroundFolder(parsed.dirPath, parsed.recursive)
})
```

Expose it in both preload files as `scanEnteredCompositeBackgroundFolder(dirPath, recursive)`.

Add the optional method to the Electron API type in `src/lib/localSave.ts`:

```ts
scanEnteredCompositeBackgroundFolder?: (
  dirPath: string,
  recursive: boolean,
) => Promise<
  | { success: true; folderPath: string; files: Array<{ path: string; name: string; relativeDir: string; width: number; height: number }> }
  | { success: false; error: string }
>
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npx vitest run electron/ipc-handlers.test.ts
```

Expected: all Electron IPC helper tests pass.

### Task 2: Replace add-then-list with automatic address rows

**Files:**
- Modify: `src/features/composite/components/BatchExportTab.test.tsx`
- Modify: `src/features/composite/components/BatchExportTab.tsx`

- [ ] **Step 1: Write failing component tests for the requested UI**

Add a helper that finds address inputs by a stable label prefix, then add tests covering:

```ts
it('renders one empty folder address by default and Add only appends another row', async () => {
  const scanEnteredCompositeBackgroundFolder = vi.fn()
  // mount with an empty store and Electron API
  expect(findFolderAddressInputs(renderer.root)).toHaveLength(1)
  expect(findFolderAddressInputs(renderer.root)[0]?.props.value).toBe('')

  await act(async () => {
    findButtonByText(renderer.root, '添加文件夹地址')?.props.onClick()
  })

  expect(findFolderAddressInputs(renderer.root)).toHaveLength(2)
  expect(scanEnteredCompositeBackgroundFolder).not.toHaveBeenCalled()
})

it('automatically scans and persists a completed folder address', async () => {
  const scanEnteredCompositeBackgroundFolder = vi.fn().mockResolvedValue({
    success: true,
    folderPath: 'D:/images',
    files: [{ path: 'D:/images/a.jpg', name: 'a.jpg', relativeDir: '', width: 10, height: 20 }],
  })

  await act(async () => {
    const input = findFolderAddressInputs(renderer.root)[0]!
    input.props.onChange({ target: { value: 'D:/images' } })
    input.props.onKeyDown({ key: 'Enter', preventDefault: vi.fn() })
    await Promise.resolve()
  })

  expect(scanEnteredCompositeBackgroundFolder).toHaveBeenCalledWith('D:/images', false)
  expect(useCompositeV2Store.getState().backgroundFolders).toEqual(['D:/images'])
  expect(useCompositeV2Store.getState().backgrounds[0]?.name).toBe('a.jpg')
})
```

Add focused tests for:

- browse fills and scans the targeted row;
- remove rescans only remaining non-empty rows;
- an older deferred scan resolving after a newer scan cannot replace the latest backgrounds;
- a `{ success: false, error }` result keeps the entered path visible and displays the error.

- [ ] **Step 2: Run the focused component test and verify RED**

Run:

```bash
npx vitest run src/features/composite/components/BatchExportTab.test.tsx
```

Expected: FAIL because the address-row UI and scan API are not implemented.

- [ ] **Step 3: Implement minimal row state and scan scheduling**

In `BatchExportTab.tsx`:

```ts
const [folderInputs, setFolderInputs] = useState<string[]>(
  backgroundFolders.length ? backgroundFolders : [''],
)
const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
const scanRequestRef = useRef(0)
```

Replace `folderInput`, `handleAddManualFolder`, and the separate “已添加的文件夹” display with:

```ts
function getUniqueFolders(rows: string[]) {
  const seen = new Set<string>()
  return rows.map((row) => row.trim()).filter((folder) => {
    if (!folder) return false
    const key = folder.replace(/[\\/]+$/, '').toLocaleLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function scheduleFolderScan(rows: string[]) {
  if (scanTimerRef.current) clearTimeout(scanTimerRef.current)
  scanTimerRef.current = setTimeout(() => {
    void loadBackgroundFolders(rows, recursiveBackgrounds)
  }, 500)
}

function updateFolderInput(index: number, value: string, immediate = false) {
  const nextRows = folderInputs.map((row, rowIndex) => rowIndex === index ? value : row)
  setFolderInputs(nextRows)
  if (immediate) void loadBackgroundFolders(nextRows, recursiveBackgrounds)
  else scheduleFolderScan(nextRows)
}
```

Have `loadBackgroundFolders` call `scanEnteredCompositeBackgroundFolder` for each unique folder. Increment `scanRequestRef` before awaiting and check it before every final state update. On success, persist the returned normalized `folderPath` values and naturally sort the combined files. On failure, throw the returned error so the row stays visible and the status explains the actual problem.

Render each row with:

```tsx
<input
  aria-label={`文件夹地址 ${index + 1}`}
  value={folder}
  onChange={(event) => updateFolderInput(index, event.target.value)}
  onPaste={(event) => {
    event.preventDefault()
    updateFolderInput(index, event.clipboardData.getData('text'), true)
  }}
  onBlur={() => void loadBackgroundFolders(folderInputs, recursiveBackgrounds)}
  onKeyDown={(event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    void loadBackgroundFolders(folderInputs, recursiveBackgrounds)
  }}
/>
```

The row browse button selects a directory, updates that row, and scans immediately. The remove button keeps at least one empty row and rescans the remaining rows. The Add button only appends `''`.

Clear the pending timer on unmount. Keep recursive-toggle and reload handlers calling the same `loadBackgroundFolders(folderInputs, ...)` path.

- [ ] **Step 4: Run the focused component test and verify GREEN**

Run:

```bash
npx vitest run src/features/composite/components/BatchExportTab.test.tsx
```

Expected: all batch export component tests pass.

### Task 3: Regression and production verification

**Files:**
- Verify only; no planned source changes.

- [ ] **Step 1: Run both focused suites together**

Run:

```bash
npx vitest run electron/ipc-handlers.test.ts src/features/composite/components/BatchExportTab.test.tsx
```

Expected: both suites pass with zero failures.

- [ ] **Step 2: Run the complete test suite**

Run:

```bash
npm test
```

Expected: all Vitest suites pass with zero failures.

- [ ] **Step 3: Run the production build**

Run:

```bash
npm run build
```

Expected: TypeScript and Vite complete with exit code 0.

- [ ] **Step 4: Inspect the surgical diff**

Run:

```bash
git diff --check
git diff -- electron/ipc-handlers.ts electron/ipc-handlers.test.ts electron/preload.ts electron/preload.cjs src/lib/localSave.ts src/features/composite/components/BatchExportTab.tsx src/features/composite/components/BatchExportTab.test.tsx
```

Expected: no whitespace errors; every new changed hunk traces to manual folder authorization, address rows, or their tests.
