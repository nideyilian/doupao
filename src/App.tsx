import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { hydrateDesktopApiSecrets, initStore, exportDataToPath, removeDeletedLocalImage } from './store'
import { useStore } from './store'
import { buildSettingsFromUrlParams, clearUrlSettingParams, hasUrlSettingParams } from './lib/urlSettings'
import { mergeImportedSettings } from './lib/apiProfiles'
import { getCustomProviderConfigUrl, loadCustomProviderSettingsFromUrl } from './lib/customProviderConfigUrl'
import {
  isElectron as isElectronEnv,
  getDesktopPath,
  getBackupList,
  restoreFromBackupFile,
  checkBackupHasData,
} from './lib/localSave'
import { applyAppearance, writeAppearanceSnapshot } from './theme/appearance'
import Header from './components/Header'
import InputBar from './components/InputBar'
import ConfirmDialog from './components/ConfirmDialog'
import PromptInputDialog from './components/PromptInputDialog'
import Toast from './components/Toast'
import ImageContextMenu from './components/ImageContextMenu'
import WordLibraryManagerModal from './components/WordLibraryManagerModal'
import WordLibrarySidebar from './components/WordLibrarySidebar'
import ErrorBoundary from './components/ErrorBoundary'
import VarEntryEditor from './components/VarEntryEditor'
import WorkspaceTabBar from './components/WorkspaceTabBar'
import AppPageRail from './components/AppPageRail'
import RequirementQueueRunner from './features/requirementPrototype/QueueRunner'
import { Dialog } from './design-system'
import { ExportStatusWatcher } from './features/composite/ExportStatusWatcher'
const AgentWorkspace = React.lazy(() => import('./components/AgentWorkspace'))
const CompositeWorkspace = React.lazy(() => import('./features/composite/CompositeWorkspace'))
// 策略（strategy）与下单（ordering）模块已屏蔽：不再懒加载对应工作区，历史 appMode 值兜底渲染素材库
const DetailModal = React.lazy(() => import('./components/DetailModal'))
const Lightbox = React.lazy(() => import('./components/Lightbox'))
const SettingsModal = React.lazy(() => import('./components/SettingsModal'))
const MaskEditorModal = React.lazy(() => import('./components/MaskEditorModal'))

const FavoriteCollectionPickerModal = React.lazy(() =>
  import('./components/FavoriteCollections').then((m) => ({ default: m.FavoriteCollectionPickerModal })),
)
const ManageCollectionsModal = React.lazy(() =>
  import('./components/FavoriteCollections').then((m) => ({ default: m.ManageCollectionsModal })),
)
const RandomPromptModal = React.lazy(() => import('./components/RandomPromptModal'))
const ScheduleModal = React.lazy(() => import('./components/ScheduleModal'))
const ScheduleRunner = React.lazy(() => import('./components/ScheduleRunner'))
const AgentBatchQueueRunner = React.lazy(() => import('./components/AgentBatchQueueRunner'))
const WorkspaceTabManagerModal = React.lazy(() => import('./components/WorkspaceTabManagerModal'))
const UpdateReleaseNotesModal = React.lazy(() => import('./components/UpdateReleaseNotesModal'))
const AssetLibraryWorkspace = React.lazy(() => import('./features/assetLibrary/AssetLibraryWorkspace'))
import { useGlobalClickSuppression } from './lib/clickSuppression'
import { assetCommands } from './lib/assetCommands'

let customProviderConfigUrlImportStarted = false
let storeInitializationPromise: Promise<void> | null = null

function waitForStoreHydration(): Promise<void> {
  if (useStore.persist.hasHydrated()) return Promise.resolve()

  return new Promise((resolve) => {
    const unsubscribe = useStore.persist.onFinishHydration(() => {
      unsubscribe()
      resolve()
    })

    // Avoid missing hydration if it completed between the first check and subscription.
    if (useStore.persist.hasHydrated()) {
      unsubscribe()
      resolve()
    }
  })
}

export default function App() {
  const appMode = useStore((s) => s.appMode)
  const postprocessDialogOpen = useStore((s) => s.postprocessDialogOpen)
  const setPostprocessDialogOpen = useStore((s) => s.setPostprocessDialogOpen)
  const themeMode = useStore((s) => s.settings.themeMode)
  const skinId = useStore((s) => s.settings.skinId)
  const themeAppliedRef = useRef(false)
  const [startupSafeMode, setStartupSafeMode] = useState(false)
  useGlobalClickSuppression()

  useLayoutEffect(() => {
    const openGallery = () => {
      if (useStore.getState().appMode !== 'gallery') {
        useStore.getState().setAppMode('gallery')
      }
    }

    openGallery()
    return useStore.persist.onFinishHydration(openGallery)
  }, [])

  useEffect(() => {
    let lastShownAt = 0
    const handlePersistError = () => {
      const now = Date.now()
      if (now - lastShownAt < 5000) return
      lastShownAt = now
      useStore.getState().showToast('本地状态保存失败，程序正在自动重试', 'error')
    }
    window.addEventListener('doupao:persist-error', handlePersistError)
    return () => window.removeEventListener('doupao:persist-error', handlePersistError)
  }, [])

  useEffect(() => {
    // Zustand 正式设置为准：应用外观并重写首屏快照
    applyAppearance({ skinId, themeMode }, document.documentElement, { transition: themeAppliedRef.current })
    writeAppearanceSnapshot({ skinId, themeMode })
    themeAppliedRef.current = true
  }, [themeMode, skinId])

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onDeepLink) return
    return api.onDeepLink((payload) => {
      const run = async () => {
        if (payload.kind === 'open') {
          const { useAssetLibraryStore } = await import('./features/assetLibrary/store')
          const { getAsset } = await import('./lib/assetLibraryRepository')
          const { useStore } = await import('./store')
          useStore.getState().setAppMode('gallery')
          const asset = await getAsset(payload.assetId)
          if (asset) {
            useAssetLibraryStore.getState().applyUpsertedAssets([asset])
            useAssetLibraryStore.getState().setActiveAsset(asset.id)
            useAssetLibraryStore.getState().setDetailOpen(true)
          }
          return
        }
        if (payload.kind === 'search') {
          const { useAssetLibraryStore } = await import('./features/assetLibrary/store')
          const { useStore } = await import('./store')
          useStore.getState().setAppMode('gallery')
          useAssetLibraryStore.getState().setScope('all')
          useAssetLibraryStore.getState().setQuery(payload.query)
          return
        }
        if (payload.kind === 'collection') {
          const { useAssetLibraryStore } = await import('./features/assetLibrary/store')
          const { useStore } = await import('./store')
          useStore.getState().setAppMode('gallery')
          useAssetLibraryStore.getState().setScope({ kind: 'collection', id: payload.collectionId })
          useAssetLibraryStore.getState().setQuery('')
          useAssetLibraryStore.getState().setSidebarOpen(true)
          return
        }
        if (payload.kind === 'import') {
          const { useAssetLibraryStore } = await import('./features/assetLibrary/store')
          const { useStore } = await import('./store')
          useStore.getState().setAppMode('gallery')
          await useAssetLibraryStore.getState().importExternalPaths([payload.path])
        }
      }
      void run().catch((error) => console.error('[deep-link] 处理失败', error))
    })
  }, [])

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onLibraryImageFileRemoved) return
    let queue = Promise.resolve()
    return api.onLibraryImageFileRemoved((file) => {
      queue = queue
        .catch(() => {})
        .then(async () => {
          const removed = await removeDeletedLocalImage(file)
          if (removed > 0) {
            useStore.getState().showToast(`本地文件已删除，已同步移除 ${removed} 张图片`, 'info')
          }
        })
        .catch((error) => console.warn('[library-image-sync] 同步删除失败', error))
    })
  }, [])

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onExternalAssetCommand || !api.completeExternalAssetCommand) return
    return api.onExternalAssetCommand(({ id, command }) => {
      const run = async () => {
        const assetId = command.assetId ?? ''
        switch (command.action) {
          case 'useAsReference':
            return assetCommands.useAsReference(assetId)
          case 'openInPostprocess':
            return assetCommands.openInPostprocess(assetId)
          case 'openInComposite':
            return assetCommands.openInComposite(assetId)
          case 'reuseGenerationConfig':
            return assetCommands.reuseGenerationConfig(assetId)
          case 'exportAsset':
            return assetCommands.exportAsset(assetId)
          case 'createCollection': {
            const { useAssetLibraryStore } = await import('./features/assetLibrary/store')
            const saved = await useAssetLibraryStore
              .getState()
              .createCollection(command.name ?? '', command.parentId ?? null)
            return saved ? { collectionId: saved.id } : { error: 'collection_exists' }
          }
          case 'importExternalFiles': {
            const { useAssetLibraryStore } = await import('./features/assetLibrary/store')
            const count = await useAssetLibraryStore.getState().importExternalPaths(command.paths ?? [])
            return { imported: count }
          }
          default:
            throw new Error('unsupported external asset command')
        }
      }
      void run().then(
        (result) => api.completeExternalAssetCommand?.({ id, result: { success: Boolean(result) } }),
        (error) =>
          api.completeExternalAssetCommand?.({ id, error: error instanceof Error ? error.message : String(error) }),
      )
    })
  }, [])

  useEffect(() => {
    const startupSettingsPromise = waitForStoreHydration().then(async () => {
      await hydrateDesktopApiSecrets()
      const searchParams = new URLSearchParams(window.location.search)
      const nextSettings = buildSettingsFromUrlParams(useStore.getState().settings, searchParams)

      useStore.getState().setSettings(nextSettings)

      if (hasUrlSettingParams(searchParams)) {
        clearUrlSettingParams(searchParams)

        const nextSearch = searchParams.toString()
        const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
        window.history.replaceState(null, '', nextUrl)
      }

      const customProviderConfigUrl = getCustomProviderConfigUrl()
      if (customProviderConfigUrl && !customProviderConfigUrlImportStarted) {
        customProviderConfigUrlImportStarted = true
        void loadCustomProviderSettingsFromUrl(customProviderConfigUrl)
          .then((importedSettings) => {
            if (!importedSettings) return
            const state = useStore.getState()
            state.setSettings(mergeImportedSettings(state.settings, importedSettings))
          })
          .catch((error) => {
            console.warn('Failed to import custom provider config URL:', error)
          })
      }
    })

    // Guard against double invocation in StrictMode or hot reload
    if (!(window as unknown as Record<string, unknown>).__storeInitialized) {
      ;(window as unknown as Record<string, unknown>).__storeInitialized = true
      const startupModePromise = window.electronAPI?.getStartupMode?.() ?? Promise.resolve({ safeMode: false })
      storeInitializationPromise = Promise.all([startupModePromise, startupSettingsPromise])
        .then(([{ safeMode }]) => {
          setStartupSafeMode(safeMode)
          return initStore({ safeMode })
        })
        .catch((error) => {
          console.error('Store initialization failed:', error)
          useStore
            .getState()
            .showToast(`启动数据加载失败：${error instanceof Error ? error.message : String(error)}`, 'error')
          throw error
        })
    }

    // 首次使用备份提醒
    void (storeInitializationPromise ?? Promise.resolve())
      .then(() => {
        const state = useStore.getState()
        const MAX_BACKUP_REMINDERS = 3
        if (
          isElectronEnv() &&
          !state.firstBackupReminderShown &&
          state.backupReminderCount < MAX_BACKUP_REMINDERS &&
          state.tasks.length === 0 &&
          state.agentConversations.length === 0
        ) {
          getBackupList().then(async (backups) => {
            let hasUsableBackup = false
            let usableBackupPath = ''
            for (const bp of backups) {
              if (await checkBackupHasData(bp)) {
                hasUsableBackup = true
                usableBackupPath = bp
                break
              }
            }
            if (hasUsableBackup) {
              const fileName = usableBackupPath.split(/[\\/]/).pop() || usableBackupPath
              const match = fileName.match(/-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-\d+\.json$/)
              const displayDate = match
                ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}`
                : fileName
              useStore.getState().setConfirmDialog({
                title: '检测到备份',
                message: `应用数据为空，检测到可用的自动备份（${displayDate}）。是否从该备份恢复？`,
                confirmText: '恢复',
                cancelText: '忽略',
                action: async () => {
                  const success = await restoreFromBackupFile(usableBackupPath)
                  if (success) {
                    useStore.getState().setFirstBackupReminderShown(true)
                    useStore.getState().showToast('备份已恢复，请刷新页面以生效', 'success')
                  } else {
                    useStore.getState().showToast('恢复备份失败', 'error')
                    const nextCount = useStore.getState().backupReminderCount + 1
                    useStore.getState().setBackupReminderCount(nextCount)
                    if (nextCount >= MAX_BACKUP_REMINDERS) {
                      useStore.getState().setFirstBackupReminderShown(true)
                    }
                  }
                },
              })
            } else {
              const nextCount = useStore.getState().backupReminderCount + 1
              useStore.getState().setBackupReminderCount(nextCount)
              if (nextCount >= MAX_BACKUP_REMINDERS) {
                useStore.getState().setFirstBackupReminderShown(true)
              }
              useStore.getState().setConfirmDialog({
                title: '建议备份',
                message: '首次使用建议立即备份数据，以便在需要时恢复。是否现在备份到桌面？',
                confirmText: '备份到桌面',
                cancelText: '稍后再说',
                action: async () => {
                  const desktop = await getDesktopPath()
                  if (!desktop) {
                    useStore.getState().showToast('无法获取桌面路径', 'error')
                    return
                  }
                  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
                  const bkFileName = `doupao_backup_${ts}.zip`
                  const filePath = desktop.replace(/\\/g, '/') + '/' + bkFileName
                  useStore.getState().showToast('正在生成备份...', 'info')
                  const success = await exportDataToPath(
                    filePath,
                    { exportConfig: true, exportTasks: true, exportImages: false, exportAssets: true },
                    { showErrorToast: false },
                  )
                  if (success.success) {
                    useStore
                      .getState()
                      .showToast(
                        success.omittedCount > 0
                          ? `备份已保存到桌面：${bkFileName}（跳过 ${success.omittedCount} 张缺失图片）`
                          : `备份已保存到桌面：${bkFileName}`,
                        'success',
                      )
                  } else {
                    useStore.getState().showToast('备份保存失败', 'error')
                  }
                },
              })
            }
          })
        }

        // 每周自动备份
        if (isElectronEnv()) {
          const lastBackup = state.lastAutoBackupAt
          const oneWeek = 7 * 24 * 60 * 60 * 1000
          if (Date.now() - lastBackup >= oneWeek) {
            getDesktopPath().then((desktop) => {
              if (!desktop) return
              const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
              const fileName = `doupao_backup_${ts}.zip`
              const filePath = desktop.replace(/\\/g, '/') + '/' + fileName
              exportDataToPath(
                filePath,
                { exportConfig: true, exportTasks: true, exportImages: false, exportAssets: true },
                { showErrorToast: false },
              )
                .then((result) => {
                  if (result.success) {
                    useStore.getState().setLastAutoBackupAt(Date.now())
                    useStore
                      .getState()
                      .showToast(
                        result.omittedCount > 0
                          ? `每周自动备份已保存到桌面（跳过 ${result.omittedCount} 张缺失图片）`
                          : '每周自动备份已保存到桌面',
                        'success',
                      )
                  }
                })
                .catch((error) => {
                  console.warn('每周自动备份失败:', error)
                })
            })
          }
        }
      })
      .catch(() => {
        // Initialization already reported the error; never create an incomplete backup.
      })
  }, [])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img')) {
        e.preventDefault()
      }
    }

    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  const legacyWorkspace = (
    <ErrorBoundary>
      {appMode !== 'gallery' && <WorkspaceTabBar />}
      <AppPageRail enabled={appMode === 'gallery' || appMode === 'agent'} />
      <div className="app-shell-with-docked-panels">
        <Header />
        {startupSafeMode && (
          <div className="safe-area-x mx-auto max-w-7xl px-4 pt-3">
            <div className="rounded-ds-lg border border-ds-warning/35 bg-ds-warning-subtle px-4 py-3 text-sm text-ds-warning dark:border-ds-warning/40 dark:bg-ds-warning/10 dark:text-ds-warning">
              已进入安全模式：后台图片迁移和历史缩略图回填已暂停。请先备份或清理数据后重新启动。
            </div>
          </div>
        )}
        {appMode === 'agent' ? (
          <React.Suspense fallback={null}>
            <AgentWorkspace />
          </React.Suspense>
        ) : (
          // 单一画廊模式：素材库（收藏夹概览 / 收藏夹素材 / 图片与批次分组都在素材库界面内完成）；
          // 后期处理已弹窗化（见下方 Dialog），不再占用 appMode；已屏蔽的 strategy / ordering 模式同样兜底到这里
          <React.Suspense fallback={null}>
            <AssetLibraryWorkspace />
          </React.Suspense>
        )}
        {(appMode === 'gallery' || appMode === 'agent') && <InputBar />}
        <React.Suspense fallback={null}>
          <DetailModal />
          <Lightbox />
          <SettingsModal />
          <ConfirmDialog />
          <PromptInputDialog />

          <FavoriteCollectionPickerModal />
          <ManageCollectionsModal />
          <Toast />
          <MaskEditorModal />
          <ImageContextMenu />
          {(appMode === 'gallery' || appMode === 'agent') && <WordLibrarySidebar />}
          {(appMode === 'gallery' || appMode === 'agent') && <WordLibraryManagerModal />}
          <VarEntryEditor />
          <RandomPromptModal />
          <ScheduleModal />
          <ScheduleRunner />
          <AgentBatchQueueRunner />
          <WorkspaceTabManagerModal />
          <UpdateReleaseNotesModal />
        </React.Suspense>
        {/* 后期处理工作区：近全屏弹窗形式，不切走素材库；素材库保持在底层可见 */}
        <React.Suspense fallback={null}>
          <Dialog
            open={postprocessDialogOpen}
            onOpenChange={setPostprocessDialogOpen}
            title="后期处理"
            description="批量合成原图与预设，处理完成后关闭回到素材库。"
            className="ds-dialog--postprocess"
            closeOnBackdrop={false}
          >
            <CompositeWorkspace embedded />
          </Dialog>
          {/* 后台导出完成提醒：常驻挂载，弹窗关闭时也能收到完成 toast */}
          <ExportStatusWatcher />
        </React.Suspense>
      </div>
    </ErrorBoundary>
  )

  return (
    <ErrorBoundary>
      <RequirementQueueRunner />
      {legacyWorkspace}
    </ErrorBoundary>
  )
}
