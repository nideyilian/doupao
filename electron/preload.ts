import { contextBridge, ipcRenderer } from 'electron'

type ApiFetchEvent = { id: string; type: 'chunk' | 'done' | 'error'; data?: Uint8Array; error?: string }
type ApiFetchRequest = { id: string }
const apiFetchListeners = new Map<string, (_event: Electron.IpcRendererEvent, payload: unknown) => void>()

async function apiFetch(request: ApiFetchRequest, onEvent: (event: ApiFetchEvent) => void) {
  const previous = apiFetchListeners.get(request.id)
  if (previous) ipcRenderer.removeListener('api:fetch:event', previous)
  const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
    const event = payload as ApiFetchEvent
    if (!event || event.id !== request.id) return
    onEvent(event)
    if (event.type === 'done' || event.type === 'error') {
      ipcRenderer.removeListener('api:fetch:event', handler)
      apiFetchListeners.delete(request.id)
    }
  }
  apiFetchListeners.set(request.id, handler)
  ipcRenderer.on('api:fetch:event', handler)
  try {
    return await ipcRenderer.invoke('api:fetch', request)
  } catch (error) {
    ipcRenderer.removeListener('api:fetch:event', handler)
    apiFetchListeners.delete(request.id)
    throw error
  }
}

function cancelApiFetch(id: string) {
  ipcRenderer.send('api:fetch:abort', id)
  const handler = apiFetchListeners.get(id)
  if (handler) ipcRenderer.removeListener('api:fetch:event', handler)
  apiFetchListeners.delete(id)
}

contextBridge.exposeInMainWorld('electronAPI', {
  apiFetch,
  cancelApiFetch,
  selectDirectory: () => ipcRenderer.invoke('fs:select-directory'),
  selectFile: (filters?: { name: string; extensions: string[] }[]) => ipcRenderer.invoke('fs:select-file', { filters }),
  selectFiles: (filters?: { name: string; extensions: string[] }[]) =>
    ipcRenderer.invoke('fs:select-files', { filters }),
  saveImage: (filePath: string, dataUrl: string) => ipcRenderer.invoke('fs:save-image', { filePath, dataUrl }),
  linkFile: (sourcePath: string, targetPath: string) => ipcRenderer.invoke('fs:link-file', { sourcePath, targetPath }),
  saveCompositeImage: (filePath: string, dataUrl: string, maxSizeKb?: number) =>
    ipcRenderer.invoke('composite:save-image', { filePath, dataUrl, maxSizeKb }),
  authorizeCompositeOutputDirectory: (dirPath: string) =>
    ipcRenderer.invoke('composite:authorize-output-directory', { dirPath }),
  saveJson: (filePath: string, data: unknown) => ipcRenderer.invoke('fs:save-json', { filePath, data }),
  saveText: (filePath: string, content: string) => ipcRenderer.invoke('fs:save-text', { filePath, content }),
  ensureDir: (dirPath: string) => ipcRenderer.invoke('fs:ensure-dir', { dirPath }),
  pathJoin: (...paths: string[]) => ipcRenderer.invoke('fs:path-join', { paths }),
  checkExists: (filePath: string) => ipcRenderer.invoke('fs:check-exists', { filePath }),
  readDir: (dirPath: string) => ipcRenderer.invoke('fs:read-dir', { dirPath }),
  readDirEntries: (dirPath: string) =>
    ipcRenderer.invoke('fs:read-dir-entries', { dirPath }) as Promise<Array<{ name: string; isDirectory: boolean }>>,
  readImageFile: (filePath: string) => ipcRenderer.invoke('composite:read-image-file', { filePath }),
  listImageFiles: (dirPath: string) => ipcRenderer.invoke('composite:list-image-files', { dirPath }),
  listCompositeBackgroundFiles: (dirPath: string, recursive: boolean) =>
    ipcRenderer.invoke('composite:list-background-files', { dirPath, recursive }),
  scanEnteredCompositeBackgroundFolder: (dirPath: string, recursive: boolean) =>
    ipcRenderer.invoke('composite:scan-entered-background-folder', { dirPath, recursive }),
  pickImageFile: (input: { path: string; mode: 'random' | 'sequential'; index: number }) =>
    ipcRenderer.invoke('composite:pick-image-file', input),
  deleteCompositeFiles: (filePaths: string[]) => ipcRenderer.invoke('composite:delete-files', { filePaths }),
  deleteLocalImageFiles: (filePaths: string[]) => ipcRenderer.invoke('fs:delete-local-image-files', { filePaths }),
  distributeFile: (input: {
    sourcePath: string
    targetPath: string
    mode: 'copy' | 'move'
    appendRandomByte?: boolean
  }) => ipcRenderer.invoke('composite:distribute-file', input),
  readFileBuffer: (filePath: string) => ipcRenderer.invoke('fs:read-file-buffer', { filePath }),
  getDefaultPath: () => ipcRenderer.invoke('fs:get-default-path'),
  getStateFilePath: () => ipcRenderer.invoke('fs:get-state-file-path'),
  scanLegacySources: () => ipcRenderer.invoke('data:scan-legacy-sources'),
  importLegacySource: (payload: unknown) => ipcRenderer.invoke('data:import-legacy-source', payload),
  relaunchApp: () => ipcRenderer.invoke('app:relaunch'),
  openInExplorer: (filePath: string) => ipcRenderer.invoke('fs:open-in-explorer', { filePath }),
  getLocalSavePath: () => ipcRenderer.invoke('store:get-local-save-path'),
  setLocalSavePath: (path: string) => ipcRenderer.invoke('store:set-local-save-path', { path }),
  copyCacheToRoot: (newRoot: string) => ipcRenderer.invoke('store:copy-cache-to-root', { newRoot }),
  readJsonText: (filePath: string) => ipcRenderer.invoke('fs:read-json-text', { filePath }),
  writeJsonText: (filePath: string, content: string, backupIntervalOrSkip?: boolean | number) =>
    ipcRenderer.invoke('fs:write-json-text', {
      filePath,
      content,
      skipBackup: typeof backupIntervalOrSkip === 'boolean' ? backupIntervalOrSkip : undefined,
      backupInterval: typeof backupIntervalOrSkip === 'number' ? backupIntervalOrSkip : undefined,
    }),
  listBackups: (filePath: string) => ipcRenderer.invoke('fs:list-backups', { filePath }),
  checkBackupHasData: (backupPath: string) => ipcRenderer.invoke('fs:check-backup-has-data', { backupPath }),
  restoreFromBackup: (backupPath: string, targetPath: string) =>
    ipcRenderer.invoke('fs:restore-from-backup', { backupPath, targetPath }),
  deleteBackup: (backupPath: string) => ipcRenderer.invoke('fs:delete-backup', { backupPath }),
  saveZipBuffer: (filePath: string, buffer: ArrayBuffer) =>
    ipcRenderer.invoke('fs:save-zip-buffer', { filePath, buffer }),
  selectZipSavePath: (defaultName: string) => ipcRenderer.invoke('fs:select-zip-save-path', { defaultName }),
  exportZipToPath: (request: unknown) => ipcRenderer.invoke('fs:export-zip', request),
  deleteCacheImages: (filePaths: string[]) => ipcRenderer.invoke('store:delete-cache-images', { filePaths }),
  reconcileCacheImages: (referencedFileNames: string[]) =>
    ipcRenderer.invoke('store:reconcile-cache-images', { referencedFileNames }),
  readThumbnail: (id: string, version: number, variant?: 'grid') =>
    ipcRenderer.invoke('thumb:read', { id, version, variant }),
  writeThumbnail: (id: string, version: number, dataUrl: string, variant?: 'grid') =>
    ipcRenderer.invoke('thumb:save', { id, version, dataUrl, variant }),
  deleteThumbnails: (imageIds: string[]) => ipcRenderer.invoke('thumb:delete', { imageIds }),
  fileExists: (filePath: string) => ipcRenderer.invoke('fs:exists', { filePath }),
  getLibraryBackupsPath: () => ipcRenderer.invoke('fs:get-library-backups-path'),
  runLibraryIntegrityCheck: (referencedPaths: string[]) =>
    ipcRenderer.invoke('library:integrity-check', { referencedPaths }),
  exportProjectCopies: (targetRoot: string, entries: unknown[]) =>
    ipcRenderer.invoke('library:export-project-copies', { targetRoot, entries }),
  exportImagesToFolder: (targetDir: string, files: unknown[]) =>
    ipcRenderer.invoke('fs:export-images-to-folder', { targetDir, files }),
  getDesktopPath: () => ipcRenderer.invoke('fs:get-desktop-path'),
  onUpdateStatus: (callback: (status: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(args[0])
    ipcRenderer.on('update:status', handler)
    return () => ipcRenderer.removeListener('update:status', handler)
  },
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  getStartupMode: () => ipcRenderer.invoke('app:get-startup-mode'),
  getCloseToTray: () => ipcRenderer.invoke('app:get-close-to-tray'),
  setCloseToTray: (enabled: boolean) => ipcRenderer.invoke('app:set-close-to-tray', { enabled }),
  assetCatalogUpsert: (records: unknown[]) => ipcRenderer.invoke('asset-catalog:upsert', records),
  assetCatalogRecordUsage: (events: unknown[]) => ipcRenderer.invoke('asset-catalog:usage', events),
  assetCatalogDelete: (assetIds: string[]) => ipcRenderer.invoke('asset-catalog:delete', assetIds),
  assetCatalogClear: () => ipcRenderer.invoke('asset-catalog:clear'),
  assetCatalogQuery: (query: unknown) => ipcRenderer.invoke('asset-catalog:query', query),
  assetCatalogExportAll: () => ipcRenderer.invoke('asset-catalog:export-all'),
  assetCatalogGet: (assetId: string) => ipcRenderer.invoke('asset-catalog:get', assetId),
  assetCatalogGetByImageId: (imageId: string) => ipcRenderer.invoke('asset-catalog:get-by-image-id', imageId),
  assetCatalogGetAssetsByIds: (ids: string[]) => ipcRenderer.invoke('asset-catalog:get-assets-by-ids', ids),
  assetCatalogPutCollections: (records: unknown[]) => ipcRenderer.invoke('asset-catalog:put-collections', records),
  assetCatalogDeleteCollection: (id: string) => ipcRenderer.invoke('asset-catalog:delete-collection', id),
  assetCatalogTrashCollection: (id: string) => ipcRenderer.invoke('asset-catalog:trash-collection', id),
  assetCatalogRestoreCollection: (id: string) => ipcRenderer.invoke('asset-catalog:restore-collection', id),
  assetCatalogGetCollections: () => ipcRenderer.invoke('asset-catalog:get-collections'),
  assetCatalogPutTags: (records: unknown[]) => ipcRenderer.invoke('asset-catalog:put-tags', records),
  assetCatalogDeleteTag: (id: string) => ipcRenderer.invoke('asset-catalog:delete-tag', id),
  assetCatalogGetTags: () => ipcRenderer.invoke('asset-catalog:get-tags'),
  assetCatalogPutTombstones: (records: unknown[]) => ipcRenderer.invoke('asset-catalog:put-tombstones', records),
  assetCatalogDeleteTombstone: (imageId: string) => ipcRenderer.invoke('asset-catalog:delete-tombstone', imageId),
  assetCatalogGetTombstones: (imageIds: string[]) => ipcRenderer.invoke('asset-catalog:get-tombstones', imageIds),
  assetCatalogGetAllTombstones: () => ipcRenderer.invoke('asset-catalog:get-all-tombstones'),
  assetCatalogMetaGet: (key: string) => ipcRenderer.invoke('asset-catalog:meta-get', key),
  assetCatalogMetaSet: (key: string, value: string) => ipcRenderer.invoke('asset-catalog:meta-set', { key, value }),
  assetCatalogPurge: (assetIds: string[], now: number) => ipcRenderer.invoke('asset-catalog:purge', assetIds, now),
  assetCatalogCleanupReferenceAssets: () => ipcRenderer.invoke('asset-catalog:cleanup-reference-assets'),
  assetCatalogNearDuplicates: (threshold?: number) => ipcRenderer.invoke('asset-catalog:near-duplicates', threshold),
  assetCatalogDerivedAssets: (assetId: string) => ipcRenderer.invoke('asset-catalog:derived-assets', assetId),
  assetCatalogRecommend: (input: unknown) => ipcRenderer.invoke('asset-catalog:recommend', input),
  assetCatalogStatus: () => ipcRenderer.invoke('asset-catalog:status'),
  getAssetApiStatus: () => ipcRenderer.invoke('asset-api:status'),
  configureAssetApi: (input: { enabled: boolean; port?: number }) => ipcRenderer.invoke('asset-api:configure', input),
  onExternalAssetCommand: (callback: (payload: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('asset-kernel:external-command', handler)
    return () => ipcRenderer.removeListener('asset-kernel:external-command', handler)
  },
  completeExternalAssetCommand: (payload: unknown) => ipcRenderer.send('asset-kernel:external-command-result', payload),
  onDeepLink: (callback: (payload: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('app:deep-link', handler)
    return () => ipcRenderer.removeListener('app:deep-link', handler)
  },
  getDiskStorageUsage: () => ipcRenderer.invoke('storage:get-disk-usage'),
  writeImageToClipboard: (dataUrl: string) => ipcRenderer.invoke('clipboard:write-image', { dataUrl }),
  showNotification: (title: string, body?: string) => ipcRenderer.invoke('notification:show', { title, body }),
  selectSavePath: (defaultName: string, filters?: { name: string; extensions: string[] }[]) =>
    ipcRenderer.invoke('fs:select-save-path', { defaultName, filters }),
  readZipManifest: (filePath: string) => ipcRenderer.invoke('backup:read-zip-manifest', { filePath }),
  readZipEntry: (filePath: string, archivePath: string) =>
    ipcRenderer.invoke('backup:read-zip-entry', { filePath, archivePath }),
  isElectron: true,
})
