import { beforeEach, describe, expect, it, vi } from 'vitest'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { DEFAULT_PARAMS } from './types'
import { createDefaultScheduleRows } from './lib/schedule'
import {
  createDefaultFalProfile,
  createDefaultOpenAIProfile,
  DEFAULT_RESPONSES_MODEL,
  DEFAULT_SETTINGS,
  normalizeSettings,
} from './lib/apiProfiles'
import type {
  AgentConversation,
  AssetCollection,
  ExportData,
  GeneratedAsset,
  SopBatchSnapshot,
  StoredCompositeAsset,
  StoredImage,
  StoredImageThumbnail,
  TaskRecord,
  WorkspaceTab,
} from './types'
import { getSelectedImageMentionLabel } from './lib/promptImageMentions'
import { formatGeneratedImageDate } from './lib/generatedImageFilename'
import { useRuntimeStore } from './stores/runtimeStore'

// 供 db mock 与测试共享的素材种子/删除记录（task 删除级联测试用）
const dbMockState = vi.hoisted(() => ({
  assetsByImage: new Map<string, GeneratedAsset>(),
  purgedAssetIds: [] as string[],
  // 模拟 Electron：storeImage 同时落盘 cache-images（StoredImage.localPath）
  emitLocalPath: false,
}))

vi.mock('./lib/db', () => {
  const tasks = new Map<string, TaskRecord>()
  const images = new Map<string, StoredImage>()
  const thumbnails = new Map<string, StoredImageThumbnail>()
  const compositeAssets = new Map<string, StoredCompositeAsset>()
  const agentConversations = new Map<string, AgentConversation>()
  const sopBatchSnapshots = new Map<string, SopBatchSnapshot>()
  const migrationJournals = new Map<string, { id: string; status: string; cursor?: string }>()
  let imageSeq = 0

  return {
    CURRENT_THUMBNAIL_VERSION: 2,
    getAllTasks: async () => [...tasks.values()],
    loadTasksIncrementally: async (migrate: (task: TaskRecord) => TaskRecord) => {
      const loaded: TaskRecord[] = []
      for (const task of tasks.values()) {
        const migrated = migrate(task)
        tasks.set(task.id, migrated)
        loaded.push(migrated)
      }
      return loaded
    },
    putTask: async (task: TaskRecord) => {
      tasks.set(task.id, task)
      return task.id
    },
    deleteTask: async (id: string) => {
      tasks.delete(id)
    },
    clearTasks: async () => {
      tasks.clear()
    },
    getAllAgentConversations: async () => [...agentConversations.values()],
    putAgentConversation: async (conversation: AgentConversation) => {
      agentConversations.set(conversation.id, conversation)
      return conversation.id
    },
    deleteAgentConversation: async (id: string) => {
      agentConversations.delete(id)
    },
    clearAgentConversations: async () => {
      agentConversations.clear()
    },
    replaceAgentConversations: async (conversations: AgentConversation[]) => {
      agentConversations.clear()
      for (const conversation of conversations) agentConversations.set(conversation.id, conversation)
    },
    getSopBatchSnapshot: async (id: string) => sopBatchSnapshots.get(id),
    getAllSopBatchSnapshots: async () => [...sopBatchSnapshots.values()],
    putSopBatchSnapshot: async (snapshot: SopBatchSnapshot) => {
      sopBatchSnapshots.set(snapshot.id, snapshot)
      return snapshot.id
    },
    clearSopBatchSnapshots: async () => {
      sopBatchSnapshots.clear()
    },
    getWordLibraryState: async () => undefined,
    putWordLibraryState: async () => undefined,
    getImage: async (id: string) => images.get(id),
    getImageThumbnail: async (id: string) => thumbnails.get(id),
    getStoredFreshImageThumbnail: async (id: string) => thumbnails.get(id),
    getStoredImageThumbnail: async (id: string) => thumbnails.get(id),
    getFreshThumbnailFromDisk: async () => undefined,
    getAllImageIds: async () => [...images.keys()],
    getAllImages: async () => [...images.values()],
    getAllLocalImagePaths: async () =>
      [...images.values()].flatMap((image) => (image.localPath ? [image.localPath] : [])),
    getLegacyImageBatch: async () => [],
    putImage: async (image: StoredImage) => {
      images.set(image.id, image)
      return image.id
    },
    putImageThumbnail: async (thumbnail: StoredImageThumbnail) => {
      thumbnails.set(thumbnail.id, thumbnail)
      return thumbnail.id
    },
    deleteImage: async (id: string) => {
      images.delete(id)
      thumbnails.delete(id)
    },
    clearImages: async () => {
      images.clear()
      thumbnails.clear()
    },
    storeImage: async (dataUrl: string, source: StoredImage['source'] = 'upload') => {
      const id = `stored-image-${++imageSeq}`
      images.set(id, {
        id,
        dataUrl,
        source,
        createdAt: Date.now(),
        localPath: dbMockState.emitLocalPath ? `D:\\LocalSaves\\cache-images\\${id}.png` : undefined,
      })
      return id
    },
    batchDeleteImages: async (ids: string[]) => {
      for (const id of ids) {
        images.delete(id)
        thumbnails.delete(id)
      }
    },
    batchGetImages: async (ids: string[]) => {
      const map = new Map<string, StoredImage>()
      for (const id of ids) {
        const img = images.get(id)
        if (img) map.set(id, img)
      }
      return map
    },
    batchGetImageThumbnails: async (ids: string[]) => {
      const map = new Map<string, StoredImageThumbnail>()
      for (const id of ids) {
        const thumb = thumbnails.get(id)
        if (thumb) map.set(id, thumb)
      }
      return map
    },
    getCompositeAsset: async (id: string) => compositeAssets.get(id),
    putCompositeAssets: async (assets: StoredCompositeAsset[]) => {
      for (const asset of assets) compositeAssets.set(asset.id, asset)
    },
    batchGetCompositeAssets: async (ids: string[]) => {
      const map = new Map<string, StoredCompositeAsset>()
      for (const id of ids) {
        const asset = compositeAssets.get(id)
        if (asset) map.set(id, asset)
      }
      return map
    },
    deleteCompositeAsset: async (id: string) => {
      compositeAssets.delete(id)
    },
    batchPutTasks: async (taskList: TaskRecord[]) => {
      for (const task of taskList) tasks.set(task.id, task)
    },
    commitImportedRecords: async (records: {
      images: StoredImage[]
      thumbnails: StoredImageThumbnail[]
      tasks: TaskRecord[]
      replaceTasks?: boolean
    }) => {
      if (records.replaceTasks) tasks.clear()
      for (const image of records.images) images.set(image.id, image)
      for (const thumbnail of records.thumbnails) thumbnails.set(thumbnail.id, thumbnail)
      for (const task of records.tasks) tasks.set(task.id, task)
    },
    getMigrationJournal: async (id: string) => migrationJournals.get(id),
    putMigrationJournal: async (record: { id: string; status: string; cursor?: string }) => {
      migrationJournals.set(record.id, record)
    },
    purgeGeneratedAssetsInTransaction: async (records: { assetIds?: string[] }) => {
      if (records.assetIds) dbMockState.purgedAssetIds.push(...records.assetIds)
    },
    // Generated asset library stores (empty in-memory defaults)
    getAllGeneratedAssets: async () => [],
    getGeneratedAsset: async () => undefined,
    batchGetGeneratedAssets: async (ids: string[]) => new Map(),
    batchGetGeneratedAssetsByImageIds: async (imageIds: string[]) => {
      const result = new Map<string, GeneratedAsset>()
      for (const imageId of imageIds) {
        const asset = dbMockState.assetsByImage.get(imageId)
        if (asset) result.set(imageId, asset)
      }
      return result
    },
    putGeneratedAsset: async (asset: GeneratedAsset) => asset.id,
    putGeneratedAssets: async () => undefined,
    deleteGeneratedAsset: async () => undefined,
    clearGeneratedAssets: async () => undefined,
    getAllAssetCollections: async () => [],
    getAssetCollection: async () => undefined,
    putAssetCollection: async (collection: { id: string }) => collection.id,
    putAssetCollections: async () => undefined,
    deleteAssetCollection: async () => undefined,
    clearAssetCollections: async () => undefined,
    getAllAssetTags: async () => [],
    getAssetTag: async () => undefined,
    putAssetTag: async (tag: { id: string }) => tag.id,
    putAssetTags: async () => undefined,
    deleteAssetTag: async () => undefined,
    clearAssetTags: async () => undefined,
    getAllAssetTombstones: async () => [],
    batchGetAssetTombstones: async () => new Map(),
    getAssetTombstone: async () => undefined,
    putAssetTombstone: async () => undefined,
    putAssetTombstones: async () => undefined,
    deleteAssetTombstone: async () => undefined,
    clearAssetTombstones: async () => undefined,
    getAllAssetUsageEvents: async () => [],
    putAssetUsageEvents: async () => undefined,
    putAssetUsageEvent: async () => undefined,
    clearAssetUsageEvents: async () => undefined,
    getAllAssetBlobs: async () => [],
    getAssetBlob: async () => undefined,
    deleteAssetBlob: async () => undefined,
    clearAssetBlobs: async () => undefined,
    getAllAssetVersions: async () => [],
    getAssetVersion: async () => undefined,
    deleteAssetVersion: async () => undefined,
    deleteAssetVersionsForAsset: async () => undefined,
    clearAssetVersions: async () => undefined,
  }
})

vi.mock('./lib/api', () => ({
  callImageApi: vi.fn(async () => ({
    images: [],
    actualParams: {},
    actualParamsList: [],
    revisedPrompts: [],
  })),
}))
vi.mock('./lib/agentApi', () => ({
  callAgentConversationTitleApi: vi.fn(async () => '标题'),
  callAgentResponsesApi: vi.fn(() => new Promise(() => {})),
  callBatchImageSingle: vi.fn(async (opts: { batchItemId: string; prompt: string }) => ({
    batchItemId: opts.batchItemId,
    image: { dataUrl: 'data:image/png;base64,batch-output', revisedPrompt: opts.prompt },
    error: null,
  })),
  parseBatchImageCallArguments: vi.fn((args: string) => {
    try {
      const parsed = JSON.parse(args) as {
        requested_count?: number
        finalize_after_batch?: boolean
        shared_prompt?: string
        images?: Array<{ id?: string; prompt?: string }>
      }
      const images =
        parsed.images?.map((item, index) => ({
          id: item.id || `image_${index + 1}`,
          prompt: item.prompt || '',
        })) ?? null
      if (!images || (parsed.requested_count != null && parsed.requested_count !== images.length)) return null
      return {
        requestedCount: parsed.requested_count ?? images.length,
        finalizeAfterBatch: parsed.finalize_after_batch === true,
        sharedPrompt: parsed.shared_prompt?.trim() ?? '',
        images,
      }
    } catch {
      return null
    }
  }),
}))
vi.mock('./lib/localSave', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/localSave')>()
  return {
    ...actual,
    deleteLocalImageFiles: vi.fn(async () => 0),
  }
})

import {
  clearAgentConversations,
  clearImages,
  clearTasks,
  getAllAgentConversations,
  getAllImageIds,
  getAllTasks,
  getCompositeAsset,
  putAgentConversation,
  putCompositeAssets,
  putImage,
  putTask as putDbTask,
} from './lib/db'
import { callImageApi } from './lib/api'
import { callAgentResponsesApi, callBatchImageSingle } from './lib/agentApi'
import {
  cleanStaleAgentInputDrafts,
  clearData,
  DEFAULT_FAVORITE_COLLECTION_ID,
  MAX_RETAINED_STREAM_PARTIAL_IMAGES,
  deleteAgentRoundFromConversation,
  deleteFavoriteCollection,
  editOutputs,
  exportData,
  getActiveAgentRounds,
  getErrorToastMessage,
  getPersistedState,
  getTaskApiProfile,
  importData,
  initStore,
  markInterruptedOpenAIRunningTasks,
  migratePersistedState,
  moveTasksToWorkspaceTab,
  regenerateAgentAssistantMessage,
  remapAgentRoundMentionsForPathChange,
  removeMultipleTasks,
  removeTask,
  retryTask,
  reuseConfig,
  submitAgentMessage,
  submitTask,
  submitTaskWithData,
  updateTaskInStore,
  updateTasksFavoriteCollections,
  ensureImageThumbnailCached,
  purgeGeneratedAssets,
  useStore,
} from './store'

const imageA = { id: 'image-a', dataUrl: 'data:image/png;base64,a' }
const imageB = { id: 'image-b', dataUrl: 'data:image/png;base64,b' }

describe('word library group deletion', () => {
  it('moves entries to a remaining group and promotes child groups', () => {
    const now = Date.now()
    useStore.setState({
      wordLibraryGroups: [
        { id: 'default', name: '默认分组', sortOrder: 0, parentId: null, description: '', color: '', archivedAt: null },
        {
          id: 'source',
          name: '待删除分组',
          sortOrder: 1,
          parentId: null,
          description: '',
          color: '',
          archivedAt: null,
        },
        { id: 'child', name: '子分组', sortOrder: 2, parentId: 'source', description: '', color: '', archivedAt: null },
      ],
      wordLibraryEntries: [
        {
          id: 'entry',
          groupId: 'source',
          key: '测试词条',
          label: '测试词条',
          entries: ['候选值'],
          draw_count: 1,
          sortOrder: 0,
          isPinned: false,
          isFavorite: false,
          tags: [],
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
          usageCount: 0,
        },
      ],
    })

    useStore.getState().deleteWordLibraryGroup('source')

    const state = useStore.getState()
    expect(state.wordLibraryGroups.map((group) => group.id)).toEqual(['default', 'child'])
    expect(state.wordLibraryGroups.find((group) => group.id === 'child')?.parentId).toBeNull()
    expect(state.wordLibraryEntries.find((entry) => entry.id === 'entry')?.groupId).toBe('default')
  })

  it('keeps the final group so entries cannot become orphaned', () => {
    useStore.setState({
      wordLibraryGroups: [
        { id: 'only', name: '默认分组', sortOrder: 0, parentId: null, description: '', color: '', archivedAt: null },
      ],
    })

    useStore.getState().deleteWordLibraryGroup('only')

    expect(useStore.getState().wordLibraryGroups).toHaveLength(1)
  })
})

describe('word library entry names', () => {
  it('adds a sequence number when creating duplicate names', () => {
    useStore.setState({ wordLibraryEntries: [] })

    const first = useStore.getState().createWordLibraryEntry('default', '主体')
    const second = useStore.getState().createWordLibraryEntry('default', '主体')
    const third = useStore.getState().createWordLibraryEntry('default', '主体')

    expect(first.key).toBe('主体')
    expect(second.key).toBe('主体 (2)')
    expect(third.key).toBe('主体 (3)')
  })

  it('adds a sequence number when renaming to an existing name', () => {
    useStore.setState({ wordLibraryEntries: [] })
    useStore.getState().createWordLibraryEntry('default', '背景')
    const renamed = useStore.getState().createWordLibraryEntry('default', '待修改')

    useStore.getState().updateWordLibraryEntry(renamed.id, { key: '背景', label: '背景' })

    expect(useStore.getState().wordLibraryEntries.find((entry) => entry.id === renamed.id)).toMatchObject({
      key: '背景 (2)',
      label: '背景 (2)',
    })
  })
})

describe('error toast messages', () => {
  it('drops long error detail after the failure title', () => {
    expect(getErrorToastMessage('Agent 请求失败：接口拒绝了很长的提示词内容')).toBe('Agent 请求失败')
  })

  it('uses a generic message for long raw errors without a title', () => {
    expect(getErrorToastMessage(`invalid request ${'x'.repeat(90)}`)).toBe('操作失败，请查看详情')
  })
})

function agentConversation(overrides: Partial<AgentConversation> = {}): AgentConversation {
  return {
    id: 'conversation-a',
    title: '新对话',
    order: 0,
    activeRoundId: null,
    createdAt: 1,
    updatedAt: 1,
    rounds: [],
    messages: [],
    ...overrides,
  }
}

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-a',
    prompt: 'prompt',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    maskTargetImageId: null,
    maskImageId: null,
    outputImages: [],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
    ...overrides,
  }
}

function workspaceTab(overrides: Partial<WorkspaceTab> = {}): WorkspaceTab {
  return {
    id: 'tab-a',
    name: '标签 A',
    groupId: null,
    prompt: '',
    inputImages: [],
    inputImageFolder: null,
    params: { ...DEFAULT_PARAMS },
    maskDraft: null,
    maskEditorImageId: null,
    customOutputPath: '',
    tasks: [],
    createdAt: 1,
    updatedAt: 1,
    order: 0,
    ...overrides,
  }
}

function importFile(data: ExportData, files: Record<string, Uint8Array> = {}): File {
  const zipped = zipSync({ 'manifest.json': strToU8(JSON.stringify(data)), ...files })
  const buffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength)
  return { arrayBuffer: async () => buffer } as File
}

describe('data export', () => {
  it('includes composite metadata and assets in Web backups', async () => {
    const localStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    }
    let exportedBlob: Blob | undefined
    const NativeURL = URL
    vi.stubGlobal('localStorage', localStorage)
    vi.stubGlobal('window', { localStorage })
    vi.stubGlobal('document', {
      createElement: () => ({ href: '', download: '', click: vi.fn() }),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    })
    vi.stubGlobal(
      'URL',
      class extends NativeURL {
        static createObjectURL(blob: Blob) {
          exportedBlob = blob
          return 'blob:backup'
        }
        static revokeObjectURL() {}
      },
    )

    try {
      await clearTasks()
      const { useCompositeV2Store } = await import('./features/composite/storeV2')
      const assetId = 'exported-composite-asset'
      const exportedTaskA = task({ id: 'task-a' })
      const exportedTaskB = task({ id: 'task-b' })
      const exportedGroup = {
        id: 'group-a',
        name: '分组 A',
        order: 0,
        collapsed: false,
      }
      useCompositeV2Store.setState({
        projectLogos: [{ id: 'logo-a', name: 'Logo A', assetId }],
      })
      await putCompositeAssets([
        {
          id: assetId,
          blob: new Blob([new Uint8Array([7, 8, 9])], { type: 'image/png' }),
          createdAt: 1_760_000_000_000,
        },
      ])
      const showToast = vi.fn()
      useStore.setState({
        showToast,
        workspaceTabs: [
          workspaceTab({ id: 'tab-a', groupId: exportedGroup.id, tasks: [exportedTaskA] }),
          workspaceTab({ id: 'tab-b', order: 1, tasks: [exportedTaskB] }),
        ],
        workspaceTabGroups: [exportedGroup],
        activeWorkspaceTabId: 'tab-b',
      })
      await exportData({
        exportConfig: true,
        exportTasks: false,
        exportImages: false,
      })
      expect(exportedBlob, JSON.stringify(showToast.mock.calls)).toBeDefined()
      const archive = unzipSync(new Uint8Array(await exportedBlob!.arrayBuffer()))
      const manifest = JSON.parse(new TextDecoder().decode(archive['manifest.json'])) as ExportData
      expect(manifest.compositeState?.projectLogos).toContainEqual({
        id: 'logo-a',
        name: 'Logo A',
        assetId,
      })
      expect(manifest.compositeAssetFiles?.[assetId]?.path).toBe(`composite-assets/${assetId}.png`)
      expect([...archive[`composite-assets/${assetId}.png`]]).toEqual([7, 8, 9])
      expect(manifest.workspaceState?.tabs.map((tab) => tab.taskIds)).toEqual([[], []])

      await putDbTask(exportedTaskA)
      await putDbTask(exportedTaskB)
      await exportData({
        exportConfig: true,
        exportTasks: true,
        exportImages: false,
      })
      const fullArchive = unzipSync(new Uint8Array(await exportedBlob!.arrayBuffer()))
      const fullManifest = JSON.parse(new TextDecoder().decode(fullArchive['manifest.json'])) as ExportData
      expect(fullManifest.version).toBe(7)
      expect(fullManifest.workspaceState).toMatchObject({
        activeTabId: 'tab-b',
        groups: [exportedGroup],
        tabs: [
          { id: 'tab-a', taskIds: ['task-a'] },
          { id: 'tab-b', taskIds: ['task-b'] },
        ],
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('favorite collection deletion', () => {
  const collectionA = { id: 'collection-a', name: '收藏夹 A', createdAt: 1, updatedAt: 1 }
  const collectionB = { id: 'collection-b', name: '收藏夹 B', createdAt: 1, updatedAt: 1 }

  beforeEach(async () => {
    await clearTasks()
    await clearImages()
    useStore.setState({
      tasks: [],
      favoriteCollections: [collectionA, collectionB],
      defaultFavoriteCollectionId: collectionA.id,
      activeFavoriteCollectionId: collectionA.id,
      selectedFavoriteCollectionIds: [collectionA.id],
      selectedTaskIds: [],
      inputImages: [],
      galleryInputDraft: null,
      agentConversations: [],
      showToast: vi.fn(),
    })
  })

  it('keeps tasks that are still referenced by another collection when deleting collection tasks', async () => {
    const sharedTask = task({
      id: 'shared-task',
      isFavorite: true,
      favoriteCollectionIds: [collectionA.id, collectionB.id],
    })
    const collectionOnlyTask = task({
      id: 'collection-only-task',
      isFavorite: true,
      favoriteCollectionIds: [collectionA.id],
    })
    useStore.setState({ tasks: [sharedTask, collectionOnlyTask] })
    await putDbTask(sharedTask)
    await putDbTask(collectionOnlyTask)

    await deleteFavoriteCollection(collectionA.id, true)

    const state = useStore.getState()
    expect(state.favoriteCollections.map((collection) => collection.id)).toEqual([
      DEFAULT_FAVORITE_COLLECTION_ID,
      collectionB.id,
    ])
    expect(state.activeFavoriteCollectionId).toBeNull()
    expect(state.selectedFavoriteCollectionIds).toEqual([])
    expect(state.tasks).toHaveLength(1)
    expect(state.tasks[0]).toMatchObject({
      id: sharedTask.id,
      isFavorite: true,
      favoriteCollectionIds: [collectionB.id],
    })
    expect((await getAllTasks()).map((item) => item.id)).toEqual([sharedTask.id])
  })
})

describe('workspace tab defaults', () => {
  beforeEach(async () => {
    await clearTasks()
    await clearImages()
    useStore.setState({
      tasks: [],
      workspaceTabs: [],
      activeWorkspaceTabId: null,
      selectedWorkspaceTabIds: [],
      prompt: 'initial prompt',
      inputImages: [],
      inputImageFolder: null,
      params: { ...DEFAULT_PARAMS },
      maskDraft: null,
      maskEditorImageId: null,
      galleryInputDraft: null,
      agentConversations: [],
      agentConversationsLoaded: false,
      showToast: vi.fn(),
    })
  })

  it('creates a default workspace tab on first initialization', async () => {
    await initStore()

    const state = useStore.getState()
    expect(state.workspaceTabs).toHaveLength(1)
    expect(state.activeWorkspaceTabId).toBe(state.workspaceTabs[0].id)
    expect(state.workspaceTabs[0]).toMatchObject({
      name: '默认',
      prompt: 'initial prompt',
      tasks: [],
      order: 0,
    })
  })

  it('does not enqueue thumbnail work for the full history during startup', async () => {
    const requestIdleCallback = vi.fn()
    vi.stubGlobal('requestIdleCallback', requestIdleCallback)
    await putImage({ id: 'history-image', dataUrl: 'data:image/png;base64,a' })
    await putDbTask(task({ id: 'history-task', outputImages: ['history-image'] }))

    await initStore()

    expect(requestIdleCallback).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('keeps existing gallery tasks in the default tab when no tabs were persisted', async () => {
    const existingTask = task({ id: 'orphan-gallery-task' })
    await putDbTask(existingTask)

    await initStore()

    const state = useStore.getState()
    expect(state.tasks.map((item) => item.id)).toEqual(['orphan-gallery-task'])
    expect(state.workspaceTabs).toHaveLength(1)
    expect(state.workspaceTabs[0].tasks.map((item) => item.id)).toEqual(['orphan-gallery-task'])
  })

  it('preserves hydrated task ownership during writes before IndexedDB tasks are restored', () => {
    const newlyCreatedTask = task({ id: 'task-new' })
    useStore.setState({
      workspaceTabs: [
        { ...workspaceTab({ id: 'tab-a', tasks: [newlyCreatedTask] }), _taskIds: ['task-a'] },
        { ...workspaceTab({ id: 'tab-b', tasks: [], order: 1 }), _taskIds: ['task-b'] },
      ],
      activeWorkspaceTabId: 'tab-a',
    })

    const persisted = getPersistedState(useStore.getState())

    expect(persisted.workspaceTabs?.map((tab) => tab._taskIds)).toEqual([['task-a', 'task-new'], ['task-b']])
  })

  it('restores multiple hydrated tabs without merging their tasks into recovery history', async () => {
    const firstTask = task({ id: 'task-a' })
    const secondTask = task({ id: 'task-b' })
    await putDbTask(firstTask)
    await putDbTask(secondTask)
    useStore.setState({
      workspaceTabs: [
        { ...workspaceTab({ id: 'tab-a', tasks: [] }), _taskIds: [firstTask.id] },
        { ...workspaceTab({ id: 'tab-b', tasks: [], order: 1 }), _taskIds: [secondTask.id] },
      ],
      activeWorkspaceTabId: 'tab-a',
    })

    await initStore()

    expect(
      useStore.getState().workspaceTabs.map((tab) => ({
        id: tab.id,
        taskIds: tab.tasks.map((item) => item.id),
      })),
    ).toEqual([
      { id: 'tab-a', taskIds: ['task-a'] },
      { id: 'tab-b', taskIds: ['task-b'] },
    ])
    expect(useStore.getState().workspaceTabs.some((tab) => tab.name === '恢复的历史任务')).toBe(false)
  })

  it('detects previously merged tasks and restores them after confirmation', async () => {
    const firstTask = task({ id: 'task-a', scheduledOutputSubFolder: '小卡' })
    const secondTask = task({ id: 'task-b', scheduledOutputSubFolder: '短剧' })
    const unknownTask = task({ id: 'task-unknown' })
    const setConfirmDialog = vi.fn()
    await putDbTask(firstTask)
    await putDbTask(secondTask)
    await putDbTask(unknownTask)
    useStore.setState({
      workspaceTabs: [
        { ...workspaceTab({ id: 'tab-a', name: '小卡', tasks: [] }), _taskIds: [] },
        { ...workspaceTab({ id: 'tab-b', name: '短剧', tasks: [], order: 1 }), _taskIds: [] },
        {
          ...workspaceTab({ id: 'tab-recovery', name: '恢复的历史任务', tasks: [], order: 2 }),
          _taskIds: [firstTask.id, secondTask.id, unknownTask.id],
        },
      ],
      activeWorkspaceTabId: 'tab-recovery',
      setConfirmDialog,
    })

    await initStore()

    expect(
      useStore
        .getState()
        .workspaceTabs.find((tab) => tab.id === 'tab-recovery')
        ?.tasks.map((item) => item.id),
    ).toEqual(['task-a', 'task-b', 'task-unknown'])
    expect(setConfirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '检测到任务归属异常',
        message: expect.stringContaining('检测到 2 个任务'),
        confirmText: '恢复任务',
        cancelText: '暂不恢复',
      }),
    )

    const dialog = setConfirmDialog.mock.calls[0]?.[0]
    dialog.action()

    const state = useStore.getState()
    expect(state.workspaceTabs.find((tab) => tab.id === 'tab-a')?.tasks.map((item) => item.id)).toEqual(['task-a'])
    expect(state.workspaceTabs.find((tab) => tab.id === 'tab-b')?.tasks.map((item) => item.id)).toEqual(['task-b'])
    expect(state.workspaceTabs.find((tab) => tab.id === 'tab-recovery')?.tasks.map((item) => item.id)).toEqual([
      'task-unknown',
    ])
  })

  it('automatically creates a same-named tab for recovered tasks whose original tab is missing', async () => {
    const orphanTask = task({ id: 'task-orphan', scheduledOutputSubFolder: '历史专辑' })
    const setConfirmDialog = vi.fn()
    await putDbTask(orphanTask)
    useStore.setState({
      workspaceTabs: [
        {
          ...workspaceTab({ id: 'tab-recovery', name: '恢复的历史任务', tasks: [], order: 0 }),
          _taskIds: [orphanTask.id],
        },
      ],
      activeWorkspaceTabId: 'tab-recovery',
      setConfirmDialog,
    })

    await initStore()

    expect(setConfirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '检测到任务归属异常',
        message: expect.stringContaining('检测到 1 个任务'),
        confirmText: '恢复任务',
      }),
    )

    const dialog = setConfirmDialog.mock.calls[0]?.[0]
    dialog.action()

    const state = useStore.getState()
    const createdTab = state.workspaceTabs.find((tab) => tab.name === '历史专辑')
    expect(createdTab).toBeDefined()
    expect(createdTab?.tasks.map((item) => item.id)).toEqual(['task-orphan'])
    const recoveryTab = state.workspaceTabs.find((tab) => tab.name === '恢复的历史任务')
    expect(recoveryTab?.tasks.map((item) => item.id)).toEqual([])
  })

  it('warns without offering automatic recovery when tab names are duplicated', async () => {
    const ambiguousTask = task({ id: 'task-ambiguous', scheduledOutputSubFolder: '图标' })
    const setConfirmDialog = vi.fn()
    await putDbTask(ambiguousTask)
    useStore.setState({
      workspaceTabs: [
        { ...workspaceTab({ id: 'tab-a', name: '图标', tasks: [] }), _taskIds: [] },
        { ...workspaceTab({ id: 'tab-b', name: '图标', tasks: [], order: 1 }), _taskIds: [] },
        {
          ...workspaceTab({ id: 'tab-recovery', name: '恢复的历史任务', tasks: [], order: 2 }),
          _taskIds: [ambiguousTask.id],
        },
      ],
      setConfirmDialog,
    })

    await initStore()

    expect(
      useStore
        .getState()
        .workspaceTabs.find((tab) => tab.id === 'tab-recovery')
        ?.tasks.map((item) => item.id),
    ).toEqual(['task-ambiguous'])
    expect(setConfirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '检测到任务归属异常',
        message: expect.stringContaining('缺少唯一、可靠的原标签信息'),
        icon: 'info',
        buttons: expect.arrayContaining([
          expect.objectContaining({ label: '前往整理', tone: 'primary' }),
          expect.objectContaining({ label: '不再提醒', tone: 'secondary' }),
        ]),
      }),
    )
  })

  it('navigates to the recovery-history tab from the dialog action', async () => {
    const unknownTask = task({ id: 'task-unknown' })
    const setConfirmDialog = vi.fn()
    await putDbTask(unknownTask)
    useStore.setState({
      workspaceTabs: [
        { ...workspaceTab({ id: 'tab-a', name: '默认', tasks: [] }), _taskIds: [] },
        {
          ...workspaceTab({ id: 'tab-recovery', name: '恢复的历史任务', tasks: [], order: 1 }),
          _taskIds: [unknownTask.id],
        },
      ],
      activeWorkspaceTabId: 'tab-a',
      setConfirmDialog,
    })

    await initStore()

    const dialog = setConfirmDialog.mock.calls[0]?.[0]
    const goButton = dialog.buttons.find((button: { label: string }) => button.label === '前往整理')
    expect(goButton).toBeDefined()
    goButton.action()
    expect(useStore.getState().activeWorkspaceTabId).toBe('tab-recovery')
  })

  it('skips the reminder for dismissed anomalies but alerts for new ones', async () => {
    const dismissedTask = task({ id: 'task-dismissed' })
    const setConfirmDialog = vi.fn()
    await putDbTask(dismissedTask)
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, dismissedRecoveryTaskIds: [dismissedTask.id] },
      workspaceTabs: [
        {
          ...workspaceTab({ id: 'tab-recovery', name: '恢复的历史任务', tasks: [], order: 0 }),
          _taskIds: [dismissedTask.id],
        },
      ],
      activeWorkspaceTabId: 'tab-recovery',
      setConfirmDialog,
    })

    await initStore()
    expect(setConfirmDialog).not.toHaveBeenCalled()

    // 新的无归属任务出现时仍会提醒
    const newTask = task({ id: 'task-new' })
    await putDbTask(newTask)
    useStore.setState({
      workspaceTabs: [
        {
          ...workspaceTab({ id: 'tab-recovery', name: '恢复的历史任务', tasks: [], order: 0 }),
          _taskIds: [dismissedTask.id, newTask.id],
        },
      ],
      activeWorkspaceTabId: 'tab-recovery',
    })

    await initStore()
    expect(setConfirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '检测到任务归属异常',
        message: expect.stringContaining('检测到 1 个任务'),
      }),
    )
  })

  it('does not flag tasks submitted while the recovery tab itself was active', async () => {
    const recoveryTask = task({ id: 'task-in-recovery', scheduledOutputSubFolder: '恢复的历史任务' })
    const setConfirmDialog = vi.fn()
    await putDbTask(recoveryTask)
    useStore.setState({
      workspaceTabs: [
        { ...workspaceTab({ id: 'tab-a', name: '默认', tasks: [] }), _taskIds: [] },
        {
          ...workspaceTab({ id: 'tab-recovery', name: '恢复的历史任务', tasks: [], order: 1 }),
          _taskIds: [recoveryTask.id],
        },
      ],
      activeWorkspaceTabId: 'tab-recovery',
      setConfirmDialog,
    })

    await initStore()

    expect(setConfirmDialog).not.toHaveBeenCalled()
    // 任务保留在恢复标签页中，不打扰用户
    expect(
      useStore
        .getState()
        .workspaceTabs.find((tab) => tab.id === 'tab-recovery')
        ?.tasks.map((item) => item.id),
    ).toEqual(['task-in-recovery'])
  })

  it('never submits new gallery tasks into the recovery-history tab', async () => {
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' },
      workspaceTabs: [
        workspaceTab({ id: 'tab-a', name: '默认' }),
        workspaceTab({ id: 'tab-recovery', name: '恢复的历史任务', order: 1 }),
        workspaceTab({ id: 'tab-b', name: '默认 2', order: 2 }),
      ],
      activeWorkspaceTabId: 'tab-recovery',
    })

    await submitTask()

    const state = useStore.getState()
    const newTaskId = state.tasks[0].id
    const tabA = state.workspaceTabs.find((tab) => tab.id === 'tab-a')!
    const recovery = state.workspaceTabs.find((tab) => tab.id === 'tab-recovery')!
    const tabB = state.workspaceTabs.find((tab) => tab.id === 'tab-b')!
    expect(tabA.tasks.map((item) => item.id)).toContain(newTaskId)
    expect(recovery.tasks.map((item) => item.id)).not.toContain(newTaskId)
    expect(tabB.tasks.map((item) => item.id)).not.toContain(newTaskId)
  })

  it('backfills generated image batches and persists them during initialization', async () => {
    const older = task({
      id: 'batch-older',
      createdAt: new Date(2026, 6, 3, 8).getTime(),
    })
    const newer = task({
      id: 'batch-newer',
      createdAt: new Date(2026, 6, 3, 9).getTime(),
    })
    await putDbTask(older)
    await putDbTask(newer)
    useStore.setState({
      workspaceTabs: [
        {
          ...workspaceTab({ id: 'tab-kuaishou', name: '快手', tasks: [] }),
          _taskIds: [newer.id, older.id],
        } as WorkspaceTab,
      ],
      activeWorkspaceTabId: 'tab-kuaishou',
    })

    await initStore()

    expect(useStore.getState().workspaceTabs[0].tasks.map((item) => item.filenameBatch)).toEqual([2, 1])
    expect((await getAllTasks()).map((item) => item.filenameBatch).sort()).toEqual([1, 2])

    await removeTask(older)

    expect(useStore.getState().tasks.find((item) => item.id === newer.id)?.filenameBatch).toBe(2)
  })

  it('moves selected tasks from the current workspace tab without duplicating global tasks', () => {
    const firstTask = task({ id: 'task-first', createdAt: 2 })
    const secondTask = task({ id: 'task-second', createdAt: 1 })
    const showToast = vi.fn()
    useStore.setState({
      tasks: [firstTask, secondTask],
      workspaceTabs: [
        workspaceTab({ id: 'tab-source', name: '来源标签', tasks: [firstTask, secondTask], order: 0 }),
        workspaceTab({ id: 'tab-target', name: '目标标签', tasks: [], order: 1 }),
      ],
      activeWorkspaceTabId: 'tab-source',
      selectedTaskIds: [firstTask.id],
      showToast,
    })

    expect(moveTasksToWorkspaceTab([firstTask.id], 'tab-target', 'tab-source')).toBe(true)

    const state = useStore.getState()
    expect(state.workspaceTabs.find((tab) => tab.id === 'tab-source')?.tasks.map((item) => item.id)).toEqual([
      secondTask.id,
    ])
    expect(state.workspaceTabs.find((tab) => tab.id === 'tab-target')?.tasks.map((item) => item.id)).toEqual([
      firstTask.id,
    ])
    expect(state.tasks.map((item) => item.id)).toEqual([firstTask.id, secondTask.id])
    expect(state.selectedTaskIds).toEqual([])
    expect(showToast).toHaveBeenCalledWith('已将 1 个任务移动到「目标标签」', 'success')
  })
  it('updates only the workspace tabs containing a task in one state commit', async () => {
    const target = task({ id: 'task-target' })
    const untouched = task({ id: 'task-untouched' })
    const targetTab = workspaceTab({ id: 'tab-target', tasks: [target] })
    const untouchedTab = workspaceTab({ id: 'tab-untouched', tasks: [untouched], order: 1 })
    useStore.setState({
      tasks: [target, untouched],
      workspaceTabs: [targetTab, untouchedTab],
    })
    const listener = vi.fn()
    const unsubscribe = useStore.subscribe(listener)

    await updateTaskInStore(target.id, { progressStage: 'previewing', progressMessage: 'loading' })
    unsubscribe()

    const state = useStore.getState()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(state.tasks[0]).toMatchObject({ progressStage: 'previewing', progressMessage: 'loading' })
    expect(state.workspaceTabs[0].tasks[0]).toMatchObject({ progressStage: 'previewing', progressMessage: 'loading' })
    expect(state.workspaceTabs[1]).toBe(untouchedTab)
    expect(state.workspaceTabs[1].tasks[0]).toBe(untouched)
  })
})

describe('schedule state', () => {
  beforeEach(() => {
    useStore.setState({
      schedule: {
        rows: createDefaultScheduleRows(),
        items: [],
        activeWeekStart: '2026-06-15',
        modalOpen: false,
        runningWeekStarts: [],
      },
      tasks: [],
      workspaceTabs: [],
      favoriteCollections: [{ id: DEFAULT_FAVORITE_COLLECTION_ID, name: '默认', createdAt: 1, updatedAt: 1 }],
      defaultFavoriteCollectionId: DEFAULT_FAVORITE_COLLECTION_ID,
    })
  })

  it('persists default schedule rows in persisted state', () => {
    const persisted = getPersistedState(useStore.getState())

    expect(persisted.schedule.rows).toHaveLength(8)
    expect(persisted.schedule.items).toEqual([])
  })

  it('adds a schedule item and clamps count to at least one', () => {
    const id = useStore.getState().addScheduleItem({
      taskId: 'task-a',
      collectionId: 'collection-a',
      date: '2026-06-18',
      rowId: 'row-1',
      count: 0,
      time: null,
    })

    expect(useStore.getState().schedule.items.find((item) => item.id === id)).toMatchObject({
      taskId: 'task-a',
      collectionId: 'collection-a',
      date: '2026-06-18',
      rowId: 'row-1',
      count: 1,
      order: 0,
    })
  })

  it('renames schedule rows and removes their scheduled items', () => {
    const rowId = useStore.getState().addScheduleRow()
    const itemId = useStore.getState().addScheduleItem({
      taskId: 'task-a',
      collectionId: 'collection-a',
      date: '2026-06-18',
      rowId,
      count: 1,
      time: null,
    })

    useStore.getState().updateScheduleRow(rowId, 'Morning batch')

    expect(useStore.getState().schedule.rows.find((row) => row.id === rowId)?.name).toBe('Morning batch')
    expect(useStore.getState().schedule.items.some((item) => item.id === itemId)).toBe(true)

    useStore.getState().removeScheduleRow(rowId)

    expect(useStore.getState().schedule.rows.some((row) => row.id === rowId)).toBe(false)
    expect(useStore.getState().schedule.items.some((item) => item.id === itemId)).toBe(false)
  })

  it('returns to the schedule modal when closing a task opened from schedule', () => {
    useStore.getState().setScheduleModalOpen(false)
    useStore.getState().setDetailTaskId('task-a', { returnToSchedule: true, imageId: 'image-b' })

    expect(useStore.getState().detailImageId).toBe('image-b')

    useStore.getState().setDetailTaskId(null)

    expect(useStore.getState().detailTaskId).toBeNull()
    expect(useStore.getState().detailImageId).toBeNull()
    expect(useStore.getState().schedule.modalOpen).toBe(true)
  })

  it('starts and stops schedule runs independently by week', () => {
    useStore.getState().startScheduleWeek('2026-06-15')
    useStore.getState().startScheduleWeek('2026-06-22')

    expect(useStore.getState().schedule.runningWeekStarts).toEqual(['2026-06-15', '2026-06-22'])

    useStore.getState().stopScheduleWeek('2026-06-15')

    expect(useStore.getState().schedule.runningWeekStarts).toEqual(['2026-06-22'])
  })

  it('copies previous week schedule items into the active week', () => {
    useStore.setState({
      schedule: {
        ...useStore.getState().schedule,
        activeWeekStart: '2026-06-15',
        items: [
          {
            id: 'prev-a',
            taskId: 'task-a',
            collectionId: 'collection-a',
            date: '2026-06-08',
            rowId: 'row-1',
            order: 0,
            count: 2,
            time: '09:30',
            status: 'done',
            lastRunKey: '2026-06-08:prev-a',
            lastTaskIds: ['generated-a'],
            lastError: 'old error',
          },
          {
            id: 'current-a',
            taskId: 'task-current',
            collectionId: 'collection-current',
            date: '2026-06-15',
            rowId: 'row-1',
            order: 0,
            count: 1,
            time: null,
            status: 'idle',
          },
        ],
      },
    })

    const copiedIds = useStore.getState().copyPreviousWeekSchedule()

    expect(copiedIds).toHaveLength(1)
    const copied = useStore.getState().schedule.items.find((item) => item.id === copiedIds[0])
    expect(copied).toMatchObject({
      taskId: 'task-a',
      collectionId: 'collection-a',
      date: '2026-06-15',
      rowId: 'row-1',
      order: 1,
      count: 2,
      time: '09:30',
      status: 'idle',
    })
    expect(copied).not.toHaveProperty('lastRunKey')
    expect(copied).not.toHaveProperty('lastTaskIds')
    expect(copied).not.toHaveProperty('lastError')
  })

  it('updates favorite output path on global and tab task copies', () => {
    const favoriteTask = task({
      id: 'task-a',
      isFavorite: true,
      favoriteCollectionIds: [DEFAULT_FAVORITE_COLLECTION_ID],
    })
    useStore.setState({
      tasks: [favoriteTask],
      workspaceTabs: [workspaceTab({ tasks: [favoriteTask] })],
    })

    useStore.getState().updateTaskFavoriteOutputPath('task-a', 'D:\\Exports\\A')

    expect(useStore.getState().tasks[0].favoriteOutputPath).toBe('D:\\Exports\\A')
    expect(useStore.getState().workspaceTabs[0].tasks[0].favoriteOutputPath).toBe('D:\\Exports\\A')
  })

  it('toggles date variables for favorite output paths on global and tab task copies', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-20T12:00:00+08:00'))
    const favoriteTask = task({
      id: 'task-a',
      isFavorite: true,
      favoriteCollectionIds: [DEFAULT_FAVORITE_COLLECTION_ID],
      favoriteOutputPath: 'D:\\Exports\\20260620\\插画',
    })
    useStore.setState({
      tasks: [favoriteTask],
      workspaceTabs: [workspaceTab({ tasks: [favoriteTask] })],
    })

    useStore.getState().updateTaskFavoriteOutputDateVariable('task-a', true)

    expect(useStore.getState().tasks[0]).toMatchObject({
      favoriteOutputPath: 'D:\\Exports\\{date}\\插画',
      favoriteOutputUseDateVariable: true,
    })
    expect(useStore.getState().workspaceTabs[0].tasks[0]).toMatchObject({
      favoriteOutputPath: 'D:\\Exports\\{date}\\插画',
      favoriteOutputUseDateVariable: true,
    })

    useStore.getState().updateTaskFavoriteOutputDateVariable('task-a', false)

    expect(useStore.getState().tasks[0]).toMatchObject({
      favoriteOutputPath: 'D:\\Exports\\20260620\\插画',
      favoriteOutputUseDateVariable: false,
    })
    vi.useRealTimers()
  })

  it('syncs favorite collection changes to workspace tab task copies immediately', async () => {
    const favoriteTask = task({
      id: 'task-a',
      isFavorite: true,
      favoriteCollectionIds: ['collection-a'],
    })
    useStore.setState({
      tasks: [favoriteTask],
      workspaceTabs: [workspaceTab({ tasks: [favoriteTask] })],
    })

    await updateTasksFavoriteCollections(['task-a'], ['collection-b'])

    expect(useStore.getState().tasks[0]).toMatchObject({
      isFavorite: true,
      favoriteCollectionIds: ['collection-b'],
    })
    expect(useStore.getState().workspaceTabs[0].tasks[0]).toMatchObject({
      isFavorite: true,
      favoriteCollectionIds: ['collection-b'],
    })
  })

  it('runs a scheduled item with explicit favorite output path metadata', async () => {
    const favoriteTask = task({
      id: 'task-a',
      prompt: 'scheduled prompt',
      isFavorite: true,
      favoriteCollectionIds: [DEFAULT_FAVORITE_COLLECTION_ID],
      favoriteOutputPath: 'D:\\Exports\\A',
    })
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' },
      tasks: [favoriteTask],
      workspaceTabs: [workspaceTab({ tasks: [favoriteTask] })],
      params: { ...DEFAULT_PARAMS },
      inputImages: [],
      maskDraft: null,
    })
    const itemId = useStore.getState().addScheduleItem({
      taskId: 'task-a',
      collectionId: DEFAULT_FAVORITE_COLLECTION_ID,
      date: '2026-06-18',
      rowId: 'row-1',
      count: 3,
      time: '09:00',
    })

    await useStore.getState().runScheduleItem(itemId, new Date(2026, 5, 18, 9))

    expect(useStore.getState().tasks[0]).toMatchObject({
      prompt: 'scheduled prompt',
      scheduledOutputPath: 'D:\\Exports\\A',
      params: expect.objectContaining({ n: 3 }),
    })
    expect(useStore.getState().schedule.items.find((item) => item.id === itemId)).toMatchObject({
      status: 'running',
      lastRunKey: `2026-06-18:${itemId}`,
      lastTaskIds: [useStore.getState().tasks[0].id],
    })
  })

  it('runs a scheduled item with collection fallback subfolder metadata', async () => {
    const collection = { id: 'collection-a', name: '海报', createdAt: 1, updatedAt: 1 }
    const favoriteTask = task({
      id: 'task-a',
      prompt: 'scheduled prompt',
      isFavorite: true,
      favoriteCollectionIds: [collection.id],
      favoriteOutputPath: '',
    })
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' },
      tasks: [favoriteTask],
      workspaceTabs: [workspaceTab({ tasks: [favoriteTask] })],
      favoriteCollections: [collection],
      defaultFavoriteCollectionId: collection.id,
      params: { ...DEFAULT_PARAMS },
      inputImages: [],
      maskDraft: null,
    })
    const itemId = useStore.getState().addScheduleItem({
      taskId: 'task-a',
      collectionId: collection.id,
      date: '2026-06-18',
      rowId: 'row-1',
      count: 2,
      time: null,
    })

    await useStore.getState().runScheduleItem(itemId, new Date(2026, 5, 18, 9))

    expect(useStore.getState().tasks[0]).toMatchObject({
      scheduledOutputSubFolder: '海报',
      params: expect.objectContaining({ n: 2 }),
    })
  })

  it('appends a supplement scheduled run with only the missing count', async () => {
    const favoriteTask = task({
      id: 'task-a',
      prompt: 'scheduled prompt',
      isFavorite: true,
      favoriteCollectionIds: [DEFAULT_FAVORITE_COLLECTION_ID],
      params: { ...DEFAULT_PARAMS, n: 5 },
    })
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' },
      tasks: [favoriteTask],
      workspaceTabs: [workspaceTab({ tasks: [favoriteTask] })],
      params: { ...DEFAULT_PARAMS },
      inputImages: [],
      maskDraft: null,
    })
    const itemId = useStore.getState().addScheduleItem({
      taskId: 'task-a',
      collectionId: DEFAULT_FAVORITE_COLLECTION_ID,
      date: '2026-06-18',
      rowId: 'row-1',
      count: 5,
      time: null,
    })

    const firstTaskId = await useStore.getState().runScheduleItem(itemId, new Date(2026, 5, 18, 9))
    const supplementTaskId = await useStore.getState().runScheduleItem(itemId, new Date(2026, 5, 18, 10), 2, true)

    expect(useStore.getState().tasks.find((item) => item.id === supplementTaskId)).toMatchObject({
      params: expect.objectContaining({ n: 2 }),
    })
    expect(useStore.getState().schedule.items.find((item) => item.id === itemId)?.lastTaskIds).toEqual([
      firstTaskId,
      supplementTaskId,
    ])
  })
})

describe('mask draft lifecycle in store actions', () => {
  beforeEach(() => {
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' },
      prompt: 'prompt',
      inputImages: [],
      maskDraft: null,
      maskEditorImageId: null,
      params: { ...DEFAULT_PARAMS },
      tasks: [],
      detailTaskId: null,
      lightboxImageId: null,
      lightboxImageList: [],
      showSettings: false,
      toast: null,
      confirmDialog: null,
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  it('preserves an existing mask when quick edit-output adds outputs as references', async () => {
    const maskDraft = {
      targetImageId: imageA.id,
      maskDataUrl: 'data:image/png;base64,mask',
      updatedAt: 1,
    }
    useStore.setState({
      inputImages: [imageA],
      maskDraft,
    })

    await editOutputs(task({ outputImages: [imageA.id] }))

    expect(useStore.getState().maskDraft).toEqual(maskDraft)
  })

  it('clears an invalid mask draft when submit cannot find the mask target image', async () => {
    useStore.setState({
      inputImages: [imageA],
      maskDraft: {
        targetImageId: 'missing-image',
        maskDataUrl: 'data:image/png;base64,mask',
        updatedAt: 1,
      },
    })

    await submitTask()

    expect(useStore.getState().maskDraft).toBeNull()
  })

  it('shows a submitted toast after creating a gallery task', async () => {
    await submitTask()

    const state = useStore.getState()
    expect(state.tasks).toHaveLength(1)
    expect(state.showToast).toHaveBeenCalledWith('任务已提交', 'success')
  })

  it('captures the active project folder onto gallery tasks (images belong to the folder the task is sent from)', async () => {
    const { useAssetLibraryStore } = await import('./features/assetLibrary/store')
    const previousScope = useAssetLibraryStore.getState().scope
    try {
      useAssetLibraryStore.setState({ scope: { kind: 'collection', id: 'col-proj-a' } })
      await submitTask()
      expect(useStore.getState().tasks[0]).toMatchObject({ defaultCollectionId: 'col-proj-a' })
    } finally {
      useAssetLibraryStore.setState({ scope: previousScope })
    }
  })

  it('uses the explicit defaultCollectionId for long-running batches instead of the folder active at submit time', async () => {
    const { useAssetLibraryStore } = await import('./features/assetLibrary/store')
    const previousScope = useAssetLibraryStore.getState().scope
    try {
      useAssetLibraryStore.setState({ scope: { kind: 'collection', id: 'col-switched-after-start' } })
      await submitTaskWithData(
        {
          prompt: '固定归档文件夹',
          inputImages: [],
          inputImageFolder: null,
          params: { ...DEFAULT_PARAMS },
          maskDraft: null,
          defaultCollectionId: 'col-fixed-at-batch-start',
        },
        { silentSuccess: true },
      )
      expect(useStore.getState().tasks[0]).toMatchObject({
        defaultCollectionId: 'col-fixed-at-batch-start',
      })
    } finally {
      useAssetLibraryStore.setState({ scope: previousScope })
    }
  })

  it('leaves defaultCollectionId unset when no project folder is active', async () => {
    const { useAssetLibraryStore } = await import('./features/assetLibrary/store')
    const previousScope = useAssetLibraryStore.getState().scope
    try {
      useAssetLibraryStore.setState({ scope: 'all' })
      await submitTask()
      expect(useStore.getState().tasks[0].defaultCollectionId).toBeUndefined()
    } finally {
      useAssetLibraryStore.setState({ scope: previousScope })
    }
  })

  it('allows simultaneously referencing more than sixteen input images', async () => {
    const inputImages = Array.from({ length: 17 }, (_, index) => ({
      id: `image-${index + 1}`,
      dataUrl: `data:image/png;base64,image-${index + 1}`,
    }))
    useStore.setState({
      inputImages,
      params: { ...DEFAULT_PARAMS, reference_mode: 'all' },
    })

    await submitTask()

    expect(useStore.getState().tasks[0]).toMatchObject({
      inputImageIds: inputImages.map((image) => image.id),
      params: expect.objectContaining({ reference_mode: 'all' }),
    })
  })

  it('assigns generated image batches per workspace tab', async () => {
    const kuaishou = workspaceTab({ id: 'tab-kuaishou', name: '快手' })
    const xiaohongshu = workspaceTab({ id: 'tab-xiaohongshu', name: '小红书', order: 1 })
    useStore.setState({
      workspaceTabs: [kuaishou, xiaohongshu],
      activeWorkspaceTabId: kuaishou.id,
    })

    await submitTask()
    await submitTask()
    useStore.setState({ activeWorkspaceTabId: xiaohongshu.id })
    await submitTask()

    const [updatedKuaishou, updatedXiaohongshu] = useStore.getState().workspaceTabs
    expect(updatedKuaishou.tasks.map((item) => item.filenameBatch)).toEqual([2, 1])
    expect(updatedXiaohongshu.tasks.map((item) => item.filenameBatch)).toEqual([1])
  })

  it('assigns a retry card the next generated image batch', async () => {
    const source = task({ createdAt: Date.now(), filenameBatch: 1 })
    const kuaishou = workspaceTab({ id: 'tab-kuaishou', name: '快手', tasks: [source] })
    useStore.setState({
      tasks: [source],
      workspaceTabs: [kuaishou],
      activeWorkspaceTabId: kuaishou.id,
    })

    await retryTask(source)

    expect(useStore.getState().workspaceTabs[0].tasks[0]).toMatchObject({
      filenameBatch: 2,
    })
  })

  it('updates task progress when submitting a gallery task', async () => {
    vi.mocked(callImageApi).mockImplementationOnce(() => new Promise(() => {}))

    await submitTask()

    const taskId = useStore.getState().tasks[0].id
    expect(useStore.getState().tasks[0]).toMatchObject({
      status: 'running',
    })
    // 高频进度走 runtimeStore，不写入任务对象
    expect(useRuntimeStore.getState().taskProgress[taskId]).toMatchObject({
      progressStage: 'requesting',
    })
  })

  it('updates task progress when a partial image arrives', async () => {
    vi.mocked(callImageApi).mockImplementationOnce(async (opts) => {
      opts.onPartialImage?.({ image: 'data:image/png;base64,partial' })
      return new Promise(() => {})
    })

    await submitTask()

    const taskId = useStore.getState().tasks[0].id
    expect(useStore.getState().tasks[0]).toMatchObject({
      status: 'running',
    })
    expect(useRuntimeStore.getState().taskProgress[taskId]).toMatchObject({
      progressStage: 'previewing',
    })
  })

  it('auto-compensates when a multi-image API request returns too few results', async () => {
    // 首轮只返回 1 张（少于请求的 N），编排器应自动补齐到 N/N。
    let count = 0
    vi.mocked(callImageApi).mockImplementation(async () => ({
      images: [`data:image/png;base64,item-${count++}`],
      actualParams: { n: 1 },
      actualParamsList: [{ n: 1 }],
      revisedPrompts: [],
    }))
    useStore.setState({
      params: { ...DEFAULT_PARAMS, n: 10 },
    })

    await submitTask()

    await vi.waitFor(() => {
      expect(useStore.getState().tasks[0].status).toBe('done')
    })
    const task = useStore.getState().tasks[0]
    expect((task.outputImages ?? []).filter(Boolean)).toHaveLength(10)
    // 全部补齐，无失败槽位。
    expect(task.batchItemStatuses ?? []).toEqual(Array(10).fill('done'))
    expect(task.batchItemErrors ?? []).toHaveLength(0)
  })

  it('links task output images into the workspace folder (single physical file, no duplicate bytes)', async () => {
    dbMockState.emitLocalPath = true
    const linked: Array<{ sourcePath: string; targetPath: string }> = []
    const byteCopies: string[] = []
    const electronAPI = {
      isElectron: true,
      getLocalSavePath: vi.fn(async () => 'D:\\LocalSaves'),
      getDefaultPath: vi.fn(async () => 'D:\\LocalSaves'),
      setLocalSavePath: vi.fn(async () => {}),
      ensureDir: vi.fn(async () => true),
      pathJoin: vi.fn(async (...parts: string[]) => parts.join('\\')),
      linkFile: vi.fn(async (sourcePath: string, targetPath: string) => {
        linked.push({ sourcePath, targetPath })
        return true
      }),
      saveImage: vi.fn(async (filePath: string) => {
        byteCopies.push(filePath)
        return true
      }),
      saveJson: vi.fn(async () => true),
      saveText: vi.fn(async () => true),
      checkExists: vi.fn(async () => false),
      readDir: vi.fn(async () => []),
    }
    Object.defineProperty(globalThis, 'window', {
      value: { electronAPI },
      configurable: true,
    })
    vi.mocked(callImageApi).mockImplementation(async (opts) => ({
      images: [`data:image/png;base64,${opts.params.n}-${linked.length}`],
      actualParams: { n: opts.params.n },
      actualParamsList: [{ n: opts.params.n }],
      revisedPrompts: [],
    }))
    const activeTab = workspaceTab({ id: 'tab-copy', name: '快手' })
    useStore.setState({
      params: { ...DEFAULT_PARAMS, n: 3 },
      workspaceTabs: [activeTab],
      activeWorkspaceTabId: activeTab.id,
    })

    await submitTask()

    await vi.waitFor(() => {
      expect(useStore.getState().tasks[0].status).toBe('done')
      expect(electronAPI.saveJson).toHaveBeenCalled()
      expect(linked.length).toBe(3)
    })
    // 工作区目录只挂硬链接（同一物理文件），不写字节副本
    for (const { sourcePath, targetPath } of linked) {
      expect(sourcePath).toMatch(/^D:\\LocalSaves\\cache-images\\stored-image-\d+\.png$/)
      expect(targetPath).toMatch(/^D:\\LocalSaves\\images\\快手\\/)
    }
    expect(byteCopies).toEqual([])
    expect(Object.keys(useStore.getState().tasks[0].localSavedOutputImagePaths ?? {})).toHaveLength(3)
    dbMockState.emitLocalPath = false
  })

  it('writes named task output files into the workspace folder on completion', async () => {
    dbMockState.emitLocalPath = true
    const savedPaths: string[] = []
    const datePrefix = formatGeneratedImageDate(Date.now())
    const existingFiles = new Set([`${datePrefix}-快手-1-1.png`, `${datePrefix}-快手-1-3.png`])
    const electronAPI = {
      isElectron: true,
      getLocalSavePath: vi.fn(async () => 'D:\\LocalSaves'),
      getDefaultPath: vi.fn(async () => 'D:\\LocalSaves'),
      setLocalSavePath: vi.fn(async () => {}),
      ensureDir: vi.fn(async () => true),
      pathJoin: vi.fn(async (...parts: string[]) => parts.join('\\')),
      linkFile: vi.fn(async (_sourcePath: string, targetPath: string) => {
        savedPaths.push(targetPath)
        existingFiles.add(targetPath.split('\\').pop()!)
        return true
      }),
      saveImage: vi.fn(async () => true),
      saveJson: vi.fn(async () => true),
      saveText: vi.fn(async () => true),
      checkExists: vi.fn(async (filePath: string) => existingFiles.has(filePath.split('\\').pop()!)),
      readDir: vi.fn(async () => [...existingFiles]),
    }
    Object.defineProperty(globalThis, 'window', {
      value: { electronAPI },
      configurable: true,
    })
    vi.mocked(callImageApi).mockImplementation(async (opts) => ({
      images: [`data:image/png;base64,${opts.params.n}-${savedPaths.length}`],
      actualParams: { n: opts.params.n },
      actualParamsList: [{ n: opts.params.n }],
      revisedPrompts: [],
    }))
    const activeTab = workspaceTab({ id: 'tab-fast', name: '快手' })
    useStore.setState({
      appMode: 'gallery',
      params: { ...DEFAULT_PARAMS, n: 2 },
      workspaceTabs: [activeTab],
      activeWorkspaceTabId: activeTab.id,
      settings: {
        ...useStore.getState().settings,
        imageFilenameDatePrefix: true,
        imageFilenameUsePrompt: false,
      },
    })

    await submitTask()

    await vi.waitFor(() => {
      expect(useStore.getState().tasks[0].status).toBe('done')
      expect(electronAPI.saveJson).toHaveBeenCalled()
      expect(savedPaths.length).toBe(2)
    })
    // 命名硬链接写入工作区目录；已占用的序号（1/3 已存在）被跳过，从 4 开始续号
    expect(savedPaths).toEqual([
      `D:\\LocalSaves\\images\\快手\\${datePrefix}-快手-1-4.png`,
      `D:\\LocalSaves\\images\\快手\\${datePrefix}-快手-1-5.png`,
    ])
    dbMockState.emitLocalPath = false
  })

  it('writes batch-folder task output links into the workspace folder on completion', async () => {
    dbMockState.emitLocalPath = true
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-06-20T12:34:56+08:00').getTime())
    const savedPaths: string[] = []
    const existingFiles = new Set<string>()
    const electronAPI = {
      isElectron: true,
      getLocalSavePath: vi.fn(async () => 'D:\\LocalSaves'),
      getDefaultPath: vi.fn(async () => 'D:\\LocalSaves'),
      setLocalSavePath: vi.fn(async () => {}),
      ensureDir: vi.fn(async () => true),
      pathJoin: vi.fn(async (...parts: string[]) => parts.join('\\')),
      linkFile: vi.fn(async (_sourcePath: string, targetPath: string) => {
        savedPaths.push(targetPath)
        existingFiles.add(targetPath.split('\\').pop()!)
        return true
      }),
      saveImage: vi.fn(async () => true),
      saveJson: vi.fn(async () => true),
      saveText: vi.fn(async () => true),
      checkExists: vi.fn(async (filePath: string) => existingFiles.has(filePath.split('\\').pop()!)),
      readDir: vi.fn(async () => [...existingFiles]),
    }
    Object.defineProperty(globalThis, 'window', {
      value: { electronAPI },
      configurable: true,
    })
    vi.mocked(callImageApi).mockImplementation(async (opts) => ({
      images: [`data:image/png;base64,${opts.params.n}-${savedPaths.length}`],
      actualParams: { n: opts.params.n },
      actualParamsList: [{ n: opts.params.n }],
      revisedPrompts: [],
    }))
    const activeTab = workspaceTab({ id: 'tab-fast', name: '快手' })
    useStore.setState({
      appMode: 'gallery',
      params: { ...DEFAULT_PARAMS, n: 2 },
      workspaceTabs: [activeTab],
      activeWorkspaceTabId: activeTab.id,
      settings: {
        ...useStore.getState().settings,
        imageSaveLayout: 'batch-folder',
        imageFilenameDatePrefix: false,
        imageFilenameUsePrompt: false,
      },
    })

    await submitTask()

    await vi.waitFor(() => {
      expect(useStore.getState().tasks[0].status).toBe('done')
      expect(electronAPI.saveJson).toHaveBeenCalled()
      expect(savedPaths.length).toBe(2)
    })
    expect(useStore.getState().tasks[0].localSaveBatchFolder).toBe('20260620-123456-batch-001')
    // 命名硬链接写入 工作区目录/批次子目录
    expect(savedPaths).toEqual([
      'D:\\LocalSaves\\images\\快手\\20260620-123456-batch-001\\快手-1-1.png',
      'D:\\LocalSaves\\images\\快手\\20260620-123456-batch-001\\快手-1-2.png',
    ])
    nowSpy.mockRestore()
    dbMockState.emitLocalPath = false
  })

  it('saves task output links into the workspace tree folder (group/tab)', async () => {
    dbMockState.emitLocalPath = true
    const savedPaths: string[] = []
    const electronAPI = {
      isElectron: true,
      getLocalSavePath: vi.fn(async () => 'D:\\LocalSaves'),
      getDefaultPath: vi.fn(async () => 'D:\\LocalSaves'),
      setLocalSavePath: vi.fn(async () => {}),
      ensureDir: vi.fn(async () => true),
      pathJoin: vi.fn(async (...parts: string[]) => parts.join('\\')),
      linkFile: vi.fn(async (_sourcePath: string, targetPath: string) => {
        savedPaths.push(targetPath)
        return true
      }),
      saveImage: vi.fn(async () => true),
      saveJson: vi.fn(async () => true),
      saveText: vi.fn(async () => true),
      checkExists: vi.fn(async () => false),
      readDir: vi.fn(async () => []),
    }
    Object.defineProperty(globalThis, 'window', {
      value: { electronAPI },
      configurable: true,
    })
    vi.mocked(callImageApi).mockImplementation(async (opts) => ({
      images: [`data:image/png;base64,${opts.params.n}-${savedPaths.length}`],
      actualParams: { n: opts.params.n },
      actualParamsList: [{ n: opts.params.n }],
      revisedPrompts: [],
    }))
    const group = { id: 'group-a', name: '分组A', order: 0, collapsed: false }
    const activeTab = workspaceTab({ id: 'tab-grouped', name: '短剧', groupId: group.id })
    useStore.setState({
      appMode: 'gallery',
      params: { ...DEFAULT_PARAMS, n: 1 },
      workspaceTabs: [activeTab],
      workspaceTabGroups: [group],
      activeWorkspaceTabId: activeTab.id,
      settings: {
        ...useStore.getState().settings,
        imageFilenameDatePrefix: false,
        imageFilenameUsePrompt: false,
      },
    })

    await submitTask()

    await vi.waitFor(() => {
      expect(useStore.getState().tasks[0].status).toBe('done')
      expect(savedPaths.length).toBe(1)
    })
    // 「树状工作区 → 文件夹」：分组/标签页 两级目录
    expect(savedPaths[0]).toMatch(/^D:\\LocalSaves\\images\\分组A\\短剧\\短剧-1-1\.png$/)
    dbMockState.emitLocalPath = false
  })

  it('saves task output links into the asset folder tree (APP/快手/老歌) when the task was sent from a project folder', async () => {
    dbMockState.emitLocalPath = true
    const savedPaths: string[] = []
    const electronAPI = {
      isElectron: true,
      getLocalSavePath: vi.fn(async () => 'D:\\LocalSaves'),
      getDefaultPath: vi.fn(async () => 'D:\\LocalSaves'),
      setLocalSavePath: vi.fn(async () => {}),
      ensureDir: vi.fn(async () => true),
      pathJoin: vi.fn(async (...parts: string[]) => parts.join('\\')),
      linkFile: vi.fn(async (_sourcePath: string, targetPath: string) => {
        savedPaths.push(targetPath)
        return true
      }),
      saveImage: vi.fn(async () => true),
      saveJson: vi.fn(async () => true),
      saveText: vi.fn(async () => true),
      checkExists: vi.fn(async () => false),
      readDir: vi.fn(async () => []),
    }
    Object.defineProperty(globalThis, 'window', {
      value: { electronAPI },
      configurable: true,
    })
    vi.mocked(callImageApi).mockImplementation(async (opts) => ({
      images: [`data:image/png;base64,${opts.params.n}-${savedPaths.length}`],
      actualParams: { n: opts.params.n },
      actualParamsList: [{ n: opts.params.n }],
      revisedPrompts: [],
    }))
    const { useAssetLibraryStore } = await import('./features/assetLibrary/store')
    const previousScope = useAssetLibraryStore.getState().scope
    const previousCollections = useAssetLibraryStore.getState().collections
    // 素材库项目树：APP → 快手 → 老歌（任务从「老歌」文件夹发送）
    const appFolder: AssetCollection = {
      id: 'col-app',
      name: 'APP',
      normalizedName: 'app',
      parentId: null,
      order: 0,
      createdAt: 1,
      updatedAt: 1,
      trashedAt: null,
    }
    const kuaishouFolder: AssetCollection = {
      id: 'col-ks',
      name: '快手',
      normalizedName: '快手',
      parentId: 'col-app',
      order: 0,
      createdAt: 1,
      updatedAt: 1,
      trashedAt: null,
    }
    const laogeFolder: AssetCollection = {
      id: 'col-lg',
      name: '老歌',
      normalizedName: '老歌',
      parentId: 'col-ks',
      order: 0,
      createdAt: 1,
      updatedAt: 1,
      trashedAt: null,
    }
    useAssetLibraryStore.setState({ collections: [appFolder, kuaishouFolder, laogeFolder] })
    useAssetLibraryStore.setState({ scope: { kind: 'collection', id: 'col-lg' } })

    const activeTab = workspaceTab({ id: 'tab-plain', name: '默认' })
    useStore.setState({
      appMode: 'gallery',
      params: { ...DEFAULT_PARAMS, n: 1 },
      workspaceTabs: [activeTab],
      activeWorkspaceTabId: activeTab.id,
      settings: {
        ...useStore.getState().settings,
        imageFilenameDatePrefix: false,
        imageFilenameUsePrompt: false,
      },
    })

    try {
      await submitTask()

      await vi.waitFor(() => {
        expect(useStore.getState().tasks[0].status).toBe('done')
        expect(savedPaths.length).toBe(1)
      })
      // 优先按素材库项目文件夹树建目录（而不是工作区标签页「默认」）
      expect(savedPaths[0]).toMatch(/^D:\\LocalSaves\\images\\APP\\快手\\老歌\\老歌-1-1\.png$/)
      expect(useStore.getState().tasks[0].defaultCollectionId).toBe('col-lg')
    } finally {
      useAssetLibraryStore.setState({ scope: previousScope, collections: previousCollections })
    }
    dbMockState.emitLocalPath = false
  })

  it('falls back to a byte copy when the disk original is unavailable', async () => {
    dbMockState.emitLocalPath = false
    const byteCopies: string[] = []
    const electronAPI = {
      isElectron: true,
      getLocalSavePath: vi.fn(async () => 'D:\\LocalSaves'),
      getDefaultPath: vi.fn(async () => 'D:\\LocalSaves'),
      setLocalSavePath: vi.fn(async () => {}),
      ensureDir: vi.fn(async () => true),
      pathJoin: vi.fn(async (...parts: string[]) => parts.join('\\')),
      // 无 linkFile（非 Electron 环境或旧版主进程）：应回退为字节副本
      saveImage: vi.fn(async (filePath: string) => {
        byteCopies.push(filePath)
        return true
      }),
      saveJson: vi.fn(async () => true),
      saveText: vi.fn(async () => true),
      checkExists: vi.fn(async () => false),
      readDir: vi.fn(async () => []),
    }
    Object.defineProperty(globalThis, 'window', {
      value: { electronAPI },
      configurable: true,
    })
    vi.mocked(callImageApi).mockImplementation(async (opts) => ({
      images: [`data:image/png;base64,${opts.params.n}-${byteCopies.length}`],
      actualParams: { n: opts.params.n },
      actualParamsList: [{ n: opts.params.n }],
      revisedPrompts: [],
    }))
    const activeTab = workspaceTab({ id: 'tab-fallback', name: '默认' })
    useStore.setState({
      params: { ...DEFAULT_PARAMS, n: 2 },
      workspaceTabs: [activeTab],
      activeWorkspaceTabId: activeTab.id,
    })

    await submitTask()

    await vi.waitFor(() => {
      expect(useStore.getState().tasks[0].status).toBe('done')
      expect(byteCopies.length).toBe(2)
    })
    for (const filePath of byteCopies) {
      expect(filePath).toMatch(/^D:\\LocalSaves\\images\\默认\\/)
    }
  })

  it('keeps only recent stream partial images when a task fails', async () => {
    await clearImages()
    vi.mocked(callImageApi).mockImplementationOnce(async (opts) => {
      for (let i = 0; i < MAX_RETAINED_STREAM_PARTIAL_IMAGES + 3; i++) {
        opts.onPartialImage?.({ image: `data:image/png;base64,partial-${i}` })
      }
      throw new Error('stream failed')
    })

    await submitTask()

    await vi.waitFor(() => {
      const currentTask = useStore.getState().tasks[0]
      expect(currentTask.status).toBe('error')
      expect(currentTask.streamPartialImageIds ?? []).toHaveLength(MAX_RETAINED_STREAM_PARTIAL_IMAGES)
    })

    const partialIds = useStore.getState().tasks[0].streamPartialImageIds ?? []
    expect(partialIds).toHaveLength(MAX_RETAINED_STREAM_PARTIAL_IMAGES)
    // 旧 partial 图片通过异步引用图判定后清理
    await vi.waitFor(async () => {
      expect(await getAllImageIds()).toEqual(partialIds)
    })
  })

  it('preserves selected image mentions when replacing a mask target with an equivalent image id', () => {
    const replacement = { id: 'image-a-replacement', dataUrl: imageA.dataUrl }
    const prompt = `参考 ${getSelectedImageMentionLabel(0)} 生成`
    useStore.setState({
      prompt,
      inputImages: [imageA, imageB],
    })

    useStore.getState().setInputImages([replacement, imageB], {
      equivalentImageIds: { [imageA.id]: replacement.id },
    })

    const state = useStore.getState()
    expect(state.inputImages.map((img) => img.id)).toEqual([replacement.id, imageB.id])
    expect(state.prompt).toBe(prompt)
  })
})

describe('interrupted OpenAI running tasks', () => {
  it('marks legacy and OpenAI running tasks as interrupted', () => {
    const now = 10_000
    const legacyRunning = task({
      id: 'legacy-running',
      status: 'running',
      createdAt: 1_000,
      finishedAt: null,
      elapsed: null,
    })
    const openAIRunning = task({
      id: 'openai-running',
      apiProvider: 'openai',
      status: 'running',
      createdAt: 2_000,
      finishedAt: null,
      elapsed: null,
    })
    const falRunning = task({
      id: 'fal-running',
      apiProvider: 'fal',
      status: 'running',
      createdAt: 3_000,
      finishedAt: null,
      elapsed: null,
    })
    const customAsyncRunning = task({
      id: 'custom-running',
      apiProvider: 'custom-provider',
      customTaskId: 'task-1',
      status: 'running',
      createdAt: 4_000,
      finishedAt: null,
      elapsed: null,
    })
    const customBatchRunning = task({
      id: 'custom-batch-running',
      apiProvider: 'custom-provider',
      status: 'running',
      createdAt: 4_500,
      finishedAt: null,
      elapsed: null,
      remoteGenerationRequests: [
        {
          id: 'local-request-1',
          provider: 'custom',
          remoteRequestId: 'remote-task-1',
          slotIndexes: [0],
          requestedCount: 1,
          attempt: 0,
          status: 'running',
          createdAt: 4_500,
          updatedAt: 4_600,
        },
      ],
    })
    const doneTask = task({ id: 'done-task', apiProvider: 'openai', status: 'done' })

    const result = markInterruptedOpenAIRunningTasks(
      [legacyRunning, openAIRunning, falRunning, customAsyncRunning, customBatchRunning, doneTask],
      now,
    )

    expect(result.interruptedTasks.map((item) => item.id)).toEqual(['legacy-running', 'openai-running'])
    expect(result.tasks.find((item) => item.id === 'legacy-running')).toMatchObject({
      status: 'error',
      error: expect.stringContaining('请求中断'),
      finishedAt: now,
      elapsed: 9_000,
    })
    expect(result.tasks.find((item) => item.id === 'openai-running')).toMatchObject({
      status: 'error',
      error: expect.stringContaining('请求中断'),
      finishedAt: now,
      elapsed: 8_000,
    })
    expect(result.tasks.find((item) => item.id === 'fal-running')).toEqual(falRunning)
    expect(result.tasks.find((item) => item.id === 'custom-running')).toEqual(customAsyncRunning)
    expect(result.tasks.find((item) => item.id === 'custom-batch-running')).toEqual(customBatchRunning)
    expect(result.tasks.find((item) => item.id === 'done-task')).toEqual(doneTask)
  })
})

describe('input persistence setting', () => {
  beforeEach(() => {
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS },
      appMode: 'gallery',
      prompt: 'prompt',
      inputImages: [imageA],
      galleryInputDraft: null,
      dismissedCodexCliPrompts: [],
    })
  })

  it('persists input when restart input restore is enabled', () => {
    const persisted = getPersistedState(useStore.getState())

    expect(persisted.prompt).toBe('prompt')
    expect(persisted.inputImages).toEqual([{ id: imageA.id, dataUrl: '' }])
  })

  it('omits input when restart input restore is disabled', () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, persistInputOnRestart: false } })

    const persisted = getPersistedState(useStore.getState())

    expect(persisted).not.toHaveProperty('prompt')
    expect(persisted).not.toHaveProperty('inputImages')
  })

  it('writes empty input when persisted input is cleared', () => {
    useStore.setState({ prompt: '', inputImages: [] })

    const persisted = getPersistedState(useStore.getState())

    expect(persisted.prompt).toBe('')
    expect(persisted.inputImages).toEqual([])
  })
})

describe('agent conversation persistence', () => {
  beforeEach(async () => {
    await clearAgentConversations()
  })

  it('omits agent conversations from localStorage state', () => {
    const conversation = agentConversation({
      rounds: [
        {
          id: 'round-a',
          index: 1,
          parentRoundId: null,
          userMessageId: 'user-a',
          assistantMessageId: 'assistant-a',
          prompt: '画一张图',
          inputImageIds: [],
          outputTaskIds: ['task-a'],
          responseOutput: [
            { type: 'message', content: [{ type: 'output_text', text: '已生成图片。' }] },
            { type: 'image_generation_call', id: 'image-call-a', result: 'large-base64-a' },
            {
              type: 'image_generation_call',
              id: 'image-call-b',
              result: {
                b64_json: 'large-base64-b',
                base64: 'large-base64-c',
                image: 'large-base64-d',
                data: 'large-base64-e',
              },
            },
          ],
          status: 'done',
          error: null,
          createdAt: 1,
          finishedAt: 2,
        },
      ],
      messages: [
        { id: 'user-a', role: 'user', content: '画一张图', roundId: 'round-a', createdAt: 1 },
        {
          id: 'assistant-a',
          role: 'assistant',
          content: '已生成图片。',
          roundId: 'round-a',
          outputTaskIds: ['task-a'],
          createdAt: 2,
        },
      ],
    })
    useStore.setState({ agentConversations: [conversation] })

    const persisted = getPersistedState(useStore.getState())
    const serializedPersisted = JSON.stringify(persisted)

    expect('agentConversations' in persisted).toBe(false)
    expect(serializedPersisted).not.toContain('image_generation_call')
    expect(serializedPersisted).not.toContain('large-base64')
    expect(JSON.stringify(useStore.getState().agentConversations)).toContain('large-base64-a')
  })

  it('loads agent conversations from IndexedDB and migrates legacy localStorage conversations', async () => {
    const storedConversation = agentConversation({ id: 'stored-conversation', createdAt: 1, updatedAt: 1 })
    const legacyConversation = agentConversation({ id: 'legacy-conversation', createdAt: 2, updatedAt: 2 })
    await putAgentConversation(storedConversation)
    useStore.setState({ agentConversations: [legacyConversation], activeAgentConversationId: legacyConversation.id })

    await initStore()

    const state = useStore.getState()
    const stored = await getAllAgentConversations()
    expect(state.agentConversations.map((conversation) => conversation.id)).toEqual([
      'stored-conversation',
      'legacy-conversation',
    ])
    expect(state.activeAgentConversationId).toBe('legacy-conversation')
    expect(stored.map((conversation) => conversation.id)).toEqual(['stored-conversation', 'legacy-conversation'])
  })

  it('strips generated image payloads from legacy task raw payloads during startup migration', async () => {
    await putDbTask(
      task({
        id: 'legacy-task',
        outputImages: ['image-live'],
        rawResponsePayload: JSON.stringify({
          output: [{ type: 'image_generation_call', id: 'image-call-a', result: 'legacy-task-base64' }],
        }),
      }),
    )

    await initStore()

    const storedTasks = await getAllTasks()
    const serializedStoredTasks = JSON.stringify(storedTasks)
    expect(serializedStoredTasks).toContain('image_generation_call')
    expect(serializedStoredTasks).not.toContain('legacy-task-base64')
  })

  it('keeps agent conversations created while initStore is loading', async () => {
    const legacyConversation = agentConversation({ id: 'legacy-conversation', createdAt: 1, updatedAt: 1 })
    const earlyConversation = agentConversation({ id: 'early-conversation', createdAt: 2, updatedAt: 2 })
    useStore.setState({ agentConversations: [legacyConversation], activeAgentConversationId: legacyConversation.id })

    const initPromise = initStore()
    useStore.setState({
      agentConversations: [legacyConversation, earlyConversation],
      activeAgentConversationId: earlyConversation.id,
    })
    await initPromise

    const state = useStore.getState()
    const stored = await getAllAgentConversations()
    expect(state.agentConversations.map((conversation) => conversation.id)).toEqual([
      'legacy-conversation',
      'early-conversation',
    ])
    expect(state.activeAgentConversationId).toBe('early-conversation')
    expect(stored.map((conversation) => conversation.id)).toEqual(['legacy-conversation', 'early-conversation'])
  })

  it('restores active conversation and draft when localStorage no longer stores conversations', async () => {
    const storedConversation = agentConversation({ id: 'stored-conversation', createdAt: 1, updatedAt: 1 })
    useStore.setState({
      appMode: 'agent',
      agentConversations: [],
      activeAgentConversationId: storedConversation.id,
      agentInputDrafts: {
        [storedConversation.id]: {
          prompt: '未发送草稿',
          inputImages: [],
          inputImageFolder: null,
          maskDraft: null,
          maskEditorImageId: null,
          updatedAt: Date.now(),
        },
      },
      prompt: '',
      inputImages: [],
      maskDraft: null,
      maskEditorImageId: null,
    })
    await putAgentConversation(storedConversation)

    await initStore()

    const state = useStore.getState()
    expect(state.agentConversations.map((conversation) => conversation.id)).toEqual(['stored-conversation'])
    expect(state.activeAgentConversationId).toBe('stored-conversation')
    expect(state.agentInputDrafts['stored-conversation']?.prompt).toBe('未发送草稿')
    expect(state.prompt).toBe('未发送草稿')
  })

  it('strips generated image payloads when migrating old persisted state', () => {
    const migrated = migratePersistedState({
      settings: { ...DEFAULT_SETTINGS },
      agentConversations: [
        agentConversation({
          rounds: [
            {
              id: 'round-a',
              index: 1,
              parentRoundId: null,
              userMessageId: 'user-a',
              prompt: '画一张图',
              inputImageIds: [],
              outputTaskIds: ['task-a'],
              responseOutput: [
                { type: 'image_generation_call', id: 'image-call-a', result: 'legacy-base64-a' },
                {
                  type: 'image_generation_call',
                  id: 'image-call-b',
                  result: { b64_json: 'legacy-base64-b', base64: 'legacy-base64-c' },
                },
              ],
              status: 'done',
              error: null,
              createdAt: 1,
              finishedAt: 2,
            },
          ],
        }),
      ],
    })

    const serializedMigrated = JSON.stringify(migrated)
    expect(serializedMigrated).not.toContain('legacy-base64')
    expect(serializedMigrated).toContain('image_generation_call')
  })
})

describe('agent conversation creation', () => {
  beforeEach(() => {
    useStore.setState({
      agentConversations: [],
      activeAgentConversationId: null,
      agentSidebarCollapsed: false,
      agentEditingRoundId: null,
    })
  })

  it('refreshes the latest empty conversation instead of creating another one', () => {
    const olderEmpty = agentConversation({ id: 'older-empty', createdAt: 1_000, updatedAt: 1_000 })
    const latestEmpty = agentConversation({ id: 'latest-empty', createdAt: 2_000, updatedAt: 2_000 })
    const now = vi.spyOn(Date, 'now').mockReturnValue(3_000)
    useStore.setState({
      agentConversations: [olderEmpty, latestEmpty],
      activeAgentConversationId: olderEmpty.id,
      agentSidebarCollapsed: false,
      agentEditingRoundId: 'editing-round',
    })

    const id = useStore.getState().createAgentConversation()

    const state = useStore.getState()
    expect(id).toBe(latestEmpty.id)
    expect(state.activeAgentConversationId).toBe(latestEmpty.id)
    expect(state.agentConversations).toHaveLength(2)
    expect(state.agentConversations.find((item) => item.id === latestEmpty.id)).toMatchObject({
      createdAt: 3_000,
      updatedAt: 3_000,
    })
    expect(state.agentConversations.find((item) => item.id === olderEmpty.id)).toMatchObject({
      ...olderEmpty,
      order: 1,
    })
    expect(state.agentSidebarCollapsed).toBe(true)
    expect(state.agentEditingRoundId).toBeNull()
    now.mockRestore()
  })

  it('creates a new conversation when the latest conversation has messages', () => {
    const olderEmpty = agentConversation({ id: 'older-empty', createdAt: 1_000, updatedAt: 1_000 })
    const latestUsed = agentConversation({
      id: 'latest-used',
      activeRoundId: 'round-a',
      createdAt: 2_000,
      updatedAt: 2_000,
      rounds: [
        {
          id: 'round-a',
          index: 1,
          parentRoundId: null,
          userMessageId: 'message-a',
          prompt: 'prompt',
          inputImageIds: [],
          outputTaskIds: [],
          status: 'done',
          error: null,
          createdAt: 2_000,
          finishedAt: 2_000,
        },
      ],
      messages: [{ id: 'message-a', role: 'user', content: 'prompt', roundId: 'round-a', createdAt: 2_000 }],
    })
    const now = vi.spyOn(Date, 'now').mockReturnValue(3_000)
    useStore.setState({ agentConversations: [olderEmpty, latestUsed], activeAgentConversationId: latestUsed.id })

    const id = useStore.getState().createAgentConversation()

    const state = useStore.getState()
    expect(id).not.toBe(olderEmpty.id)
    expect(id).not.toBe(latestUsed.id)
    expect(state.agentConversations).toHaveLength(3)
    expect(state.agentConversations[0]).toMatchObject({
      id,
      order: 0,
      createdAt: 3_000,
      updatedAt: 3_000,
      messages: [],
      rounds: [],
    })
    expect(state.activeAgentConversationId).toBe(id)
    now.mockRestore()
  })

  it('reorders conversations and persists contiguous order values', () => {
    useStore.setState({
      agentConversations: [
        agentConversation({ id: 'a', order: 0 }),
        agentConversation({ id: 'b', order: 1 }),
        agentConversation({ id: 'c', order: 2 }),
      ],
    })

    useStore.getState().reorderAgentConversations('c', 'a', 'before')

    expect(useStore.getState().agentConversations.map(({ id, order }) => ({ id, order }))).toEqual([
      { id: 'c', order: 0 },
      { id: 'a', order: 1 },
      { id: 'b', order: 2 },
    ])
  })

  it('selects the adjacent conversation after deleting the active one', () => {
    useStore.setState({
      agentConversations: [
        agentConversation({ id: 'a', order: 0 }),
        agentConversation({ id: 'b', order: 1 }),
        agentConversation({ id: 'c', order: 2 }),
      ],
      activeAgentConversationId: 'b',
    })

    useStore.getState().deleteAgentConversation('b')

    expect(useStore.getState().activeAgentConversationId).toBe('c')
    expect(useStore.getState().agentConversations.map(({ id, order }) => ({ id, order }))).toEqual([
      { id: 'a', order: 0 },
      { id: 'c', order: 1 },
    ])
  })
})

describe('agent round deletion', () => {
  it('renumbers later rounds and remaps image mentions after deleting a middle round', () => {
    const conversation = agentConversation({
      activeRoundId: 'round-3',
      rounds: [
        {
          id: 'round-1',
          index: 1,
          parentRoundId: null,
          userMessageId: 'user-1',
          assistantMessageId: 'assistant-1',
          prompt: '第一轮',
          inputImageIds: [],
          outputTaskIds: ['task-1'],
          status: 'done',
          error: null,
          createdAt: 1,
          finishedAt: 2,
        },
        {
          id: 'round-2',
          index: 2,
          parentRoundId: 'round-1',
          userMessageId: 'user-2',
          assistantMessageId: 'assistant-2',
          prompt: '第二轮',
          inputImageIds: [],
          outputTaskIds: ['task-2'],
          status: 'done',
          error: null,
          createdAt: 3,
          finishedAt: 4,
        },
        {
          id: 'round-3',
          index: 3,
          parentRoundId: 'round-2',
          userMessageId: 'user-3',
          assistantMessageId: 'assistant-3',
          prompt: '第三轮',
          inputImageIds: [],
          outputTaskIds: ['task-3'],
          status: 'done',
          error: null,
          createdAt: 5,
          finishedAt: 6,
        },
      ],
      messages: [
        { id: 'user-1', role: 'user', content: '第一轮', roundId: 'round-1', createdAt: 1 },
        { id: 'assistant-1', role: 'assistant', content: '完成', roundId: 'round-1', createdAt: 2 },
        { id: 'user-2', role: 'user', content: '第二轮', roundId: 'round-2', createdAt: 3 },
        { id: 'assistant-2', role: 'assistant', content: '完成', roundId: 'round-2', createdAt: 4 },
        {
          id: 'user-3',
          role: 'user',
          content: '参考 @第1轮图1、@第2轮图1、@第3轮图1',
          roundId: 'round-3',
          createdAt: 5,
        },
        { id: 'assistant-3', role: 'assistant', content: '完成', roundId: 'round-3', createdAt: 6 },
      ],
    })

    const deleted = deleteAgentRoundFromConversation(conversation, 'round-2', 10)

    expect(
      deleted.rounds.map((round) => ({ id: round.id, index: round.index, parentRoundId: round.parentRoundId })),
    ).toEqual([
      { id: 'round-1', index: 1, parentRoundId: null },
      { id: 'round-3', index: 2, parentRoundId: 'round-1' },
    ])
    expect(deleted.messages.map((message) => message.id)).toEqual(['user-1', 'assistant-1', 'user-3', 'assistant-3'])
    expect(deleted.messages.find((message) => message.id === 'user-3')?.content).toBe(
      '参考 @第1轮图1、@已删除轮次图1、@第2轮图1',
    )
    expect(deleted.activeRoundId).toBe('round-3')
    expect(deleted.updatedAt).toBe(10)
  })

  it('can remap draft mentions using the old and new active paths after deletion', () => {
    const conversation = agentConversation({
      activeRoundId: 'round-3',
      rounds: [
        {
          id: 'round-1',
          index: 1,
          parentRoundId: null,
          userMessageId: 'user-1',
          prompt: '第一轮',
          inputImageIds: [],
          outputTaskIds: ['task-1'],
          status: 'done',
          error: null,
          createdAt: 1,
          finishedAt: 2,
        },
        {
          id: 'round-2',
          index: 2,
          parentRoundId: 'round-1',
          userMessageId: 'user-2',
          prompt: '第二轮',
          inputImageIds: [],
          outputTaskIds: ['task-2'],
          status: 'done',
          error: null,
          createdAt: 3,
          finishedAt: 4,
        },
        {
          id: 'round-3',
          index: 3,
          parentRoundId: 'round-2',
          userMessageId: 'user-3',
          prompt: '第三轮',
          inputImageIds: [],
          outputTaskIds: ['task-3'],
          status: 'done',
          error: null,
          createdAt: 5,
          finishedAt: 6,
        },
      ],
      messages: [],
    })
    const oldPath = getActiveAgentRounds(conversation)
    const deleted = deleteAgentRoundFromConversation(conversation, 'round-2', 10)
    const newPath = getActiveAgentRounds(deleted)

    expect(remapAgentRoundMentionsForPathChange('继续参考 @第1轮图1、@第2轮图1、@第3轮图1', oldPath, newPath)).toBe(
      '继续参考 @第1轮图1、@已删除轮次图1、@第2轮图1',
    )
  })
})

describe('data import', () => {
  beforeEach(async () => {
    useStore.setState({
      tasks: [],
      agentConversations: [],
      favoriteCollections: [],
      defaultFavoriteCollectionId: null,
      activeAgentConversationId: null,
      showToast: vi.fn(),
    })
    await clearAgentConversations()
  })

  it('restores composite assets before replacing the composite store snapshot', async () => {
    const { createCompositeV2StoreState, getCompositeV2PersistedState, useCompositeV2Store } =
      await import('./features/composite/storeV2')
    useCompositeV2Store.persist.setOptions({
      storage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    })
    const assetId = 'composite-asset-a'
    const assetPath = `composite-assets/${assetId}.png`
    const assetBytes = new Uint8Array([1, 2, 3, 4])
    const snapshot = {
      ...getCompositeV2PersistedState(createCompositeV2StoreState() as ReturnType<typeof useCompositeV2Store.getState>),
      projectLogos: [{ id: 'logo-a', name: 'Logo A', assetId }],
    }
    useCompositeV2Store.setState({ projectLogos: [] })

    const imported = await importData(
      importFile(
        {
          version: 3,
          exportedAt: new Date(0).toISOString(),
          compositeState: snapshot,
          compositeAssetFiles: {
            [assetId]: {
              path: assetPath,
              createdAt: 123,
              type: 'image/png',
            },
          },
        },
        { [assetPath]: assetBytes },
      ),
      { importConfig: true, importTasks: false },
    )

    const storedAsset = await getCompositeAsset(assetId)
    expect(imported).toBe(true)
    expect(useCompositeV2Store.getState().projectLogos).toEqual([{ id: 'logo-a', name: 'Logo A', assetId }])
    expect(storedAsset?.createdAt).toBe(123)
    expect(new Uint8Array(await storedAsset!.blob.arrayBuffer())).toEqual(assetBytes)
  })

  it('fully replaces tasks and restores their exact workspace tabs from v5 backups', async () => {
    await clearTasks()
    const localTask = task({ id: 'local-only-task' })
    const importedTaskA = task({ id: 'task-a' })
    const importedTaskB = task({ id: 'task-b' })
    const importedConversation = agentConversation({
      id: 'imported-conversation',
      title: '备份对话',
      activeRoundId: 'round-a',
      rounds: [
        {
          id: 'round-a',
          index: 1,
          parentRoundId: null,
          userMessageId: 'message-a',
          prompt: '备份内容',
          inputImageIds: [],
          outputTaskIds: [],
          status: 'done',
          error: null,
          createdAt: 1,
          finishedAt: 2,
        },
      ],
      messages: [{ id: 'message-a', role: 'user', content: '备份内容', roundId: 'round-a', createdAt: 1 }],
    })
    const localConversation = agentConversation({
      id: 'local-conversation',
      title: '本地对话',
    })
    const group = {
      id: 'group-a',
      name: '分组 A',
      order: 0,
      collapsed: false,
    }
    await putDbTask(localTask)
    useStore.setState({
      tasks: [localTask],
      agentConversations: [localConversation],
      activeAgentConversationId: localConversation.id,
      workspaceTabs: [workspaceTab({ id: 'local-tab', tasks: [localTask] })],
      workspaceTabGroups: [],
      activeWorkspaceTabId: 'local-tab',
      selectedWorkspaceTabIds: ['local-tab'],
    })

    const imported = await importData(
      importFile({
        version: 5,
        exportedAt: new Date(0).toISOString(),
        tasks: [importedTaskA, importedTaskB],
        agentConversations: [importedConversation],
        favoriteCollections: [],
        wordLibraryGroups: [],
        wordLibraryEntries: [],
        imageFiles: {},
        workspaceState: {
          groups: [group],
          activeTabId: 'tab-b',
          tabs: [
            {
              id: 'tab-a',
              name: '标签 A',
              groupId: group.id,
              prompt: 'A',
              inputImageIds: [],
              inputImageFolder: null,
              params: { ...DEFAULT_PARAMS },
              maskDraft: null,
              maskEditorImageId: null,
              customOutputPath: '',
              taskIds: [importedTaskA.id],
              createdAt: 1,
              updatedAt: 1,
              order: 0,
            },
            {
              id: 'tab-b',
              name: '标签 B',
              groupId: null,
              prompt: 'B',
              inputImageIds: [],
              inputImageFolder: null,
              params: { ...DEFAULT_PARAMS },
              maskDraft: null,
              maskEditorImageId: null,
              customOutputPath: '',
              taskIds: [importedTaskB.id],
              createdAt: 2,
              updatedAt: 2,
              order: 1,
            },
            {
              id: 'tab-empty',
              name: '空标签',
              groupId: null,
              prompt: '',
              inputImageIds: [],
              inputImageFolder: null,
              params: { ...DEFAULT_PARAMS },
              maskDraft: null,
              maskEditorImageId: null,
              customOutputPath: '',
              taskIds: [],
              createdAt: 3,
              updatedAt: 3,
              order: 2,
            },
          ],
        },
      }),
      { importConfig: true, importTasks: true, importImages: true },
    )

    const state = useStore.getState()
    expect(imported).toBe(true)
    expect((await getAllTasks()).map((item) => item.id)).toEqual(['task-a', 'task-b'])
    expect(
      state.workspaceTabs.map((tab) => ({
        id: tab.id,
        taskIds: tab.tasks.map((item) => item.id),
      })),
    ).toEqual([
      { id: 'tab-a', taskIds: ['task-a'] },
      { id: 'tab-b', taskIds: ['task-b'] },
      { id: 'tab-empty', taskIds: [] },
    ])
    expect(state.workspaceTabGroups).toEqual([group])
    expect(state.activeWorkspaceTabId).toBe('tab-b')
    expect(state.selectedWorkspaceTabIds).toEqual([])
    expect(state.agentConversations.map((conversation) => conversation.id)).toEqual(['imported-conversation'])
  })

  it('rejects invalid v5 workspace references before replacing local state', async () => {
    await clearTasks()
    const localTask = task({ id: 'local-task' })
    const localTab = workspaceTab({ id: 'local-tab', tasks: [localTask] })
    await putDbTask(localTask)
    useStore.setState({
      tasks: [localTask],
      workspaceTabs: [localTab],
      activeWorkspaceTabId: localTab.id,
    })

    const imported = await importData(
      importFile({
        version: 5,
        exportedAt: new Date(0).toISOString(),
        tasks: [],
        imageFiles: {},
        workspaceState: {
          groups: [],
          activeTabId: 'tab-a',
          tabs: [
            {
              id: 'tab-a',
              name: '标签 A',
              groupId: null,
              prompt: '',
              inputImageIds: [],
              inputImageFolder: null,
              params: { ...DEFAULT_PARAMS },
              maskDraft: null,
              maskEditorImageId: null,
              customOutputPath: '',
              taskIds: ['missing-task'],
              createdAt: 1,
              updatedAt: 1,
              order: 0,
            },
          ],
        },
      }),
      { importConfig: true, importTasks: true, importImages: true },
    )

    expect(imported).toBe(false)
    expect((await getAllTasks()).map((item) => item.id)).toEqual([localTask.id])
    expect(useStore.getState().workspaceTabs).toEqual([localTab])
  })

  it('keeps merge semantics for task-only v5 imports and full v4 imports', async () => {
    await clearTasks()
    const localTask = task({ id: 'local-task' })
    const localTab = workspaceTab({ id: 'local-tab', tasks: [localTask] })
    await putDbTask(localTask)
    useStore.setState({
      tasks: [localTask],
      workspaceTabs: [localTab],
      activeWorkspaceTabId: localTab.id,
    })

    const taskOnly = await importData(
      importFile({
        version: 5,
        exportedAt: new Date(0).toISOString(),
        tasks: [task({ id: 'task-only-import' })],
        imageFiles: {},
        workspaceState: {
          groups: [],
          activeTabId: null,
          tabs: [],
        },
      }),
      { importConfig: false, importTasks: true, importImages: false },
    )

    const legacy = await importData(
      importFile({
        version: 4,
        exportedAt: new Date(0).toISOString(),
        tasks: [task({ id: 'legacy-import' })],
        imageFiles: {},
      }),
      { importConfig: true, importTasks: true, importImages: false },
    )

    expect(taskOnly).toBe(true)
    expect(legacy).toBe(true)
    expect((await getAllTasks()).map((item) => item.id)).toEqual(['local-task', 'task-only-import', 'legacy-import'])
    expect(useStore.getState().workspaceTabs).toEqual([localTab])
  })

  it('restores favorite collections and default collection when importing task data', async () => {
    await clearTasks()
    const importedCollections = [
      { id: 'imported-collection-a', name: '导入收藏夹 A', createdAt: 1, updatedAt: 1 },
      { id: 'imported-collection-b', name: '导入收藏夹 B', createdAt: 2, updatedAt: 2 },
    ]
    const importedTask = task({
      id: 'imported-favorite-task',
      isFavorite: true,
      favoriteCollectionIds: [importedCollections[1].id],
    })

    const imported = await importData(
      importFile({
        version: 3,
        exportedAt: new Date(0).toISOString(),
        tasks: [importedTask],
        favoriteCollections: importedCollections,
        defaultFavoriteCollectionId: importedCollections[1].id,
        wordLibraryGroups: [],
        wordLibraryEntries: [],
        imageFiles: {},
      }),
      { importConfig: true, importTasks: true },
    )

    const state = useStore.getState()
    expect(imported).toBe(true)
    expect(state.favoriteCollections).toEqual(expect.arrayContaining(importedCollections))
    expect(state.defaultFavoriteCollectionId).toBe(importedCollections[1].id)
    expect(state.tasks.find((item) => item.id === importedTask.id)).toMatchObject({
      favoriteCollectionIds: [importedCollections[1].id],
      isFavorite: true,
    })
    expect((await getAllTasks()).find((item) => item.id === importedTask.id)).toMatchObject({
      favoriteCollectionIds: [importedCollections[1].id],
      isFavorite: true,
    })
  })

  it('skips empty agent conversations when importing task data', async () => {
    const usedConversation = agentConversation({
      id: 'used-conversation',
      activeRoundId: 'round-a',
      rounds: [
        {
          id: 'round-a',
          index: 1,
          parentRoundId: null,
          userMessageId: 'message-a',
          prompt: 'prompt',
          inputImageIds: [],
          outputTaskIds: [],
          status: 'done',
          error: null,
          createdAt: 1,
          finishedAt: 2,
        },
      ],
      messages: [{ id: 'message-a', role: 'user', content: 'prompt', roundId: 'round-a', createdAt: 1 }],
    })

    const imported = await importData(
      importFile({
        version: 3,
        exportedAt: new Date(0).toISOString(),
        tasks: [],
        agentConversations: [agentConversation({ id: 'empty-conversation' }), usedConversation],
        imageFiles: {},
      }),
      { importConfig: false, importTasks: true },
    )

    const state = useStore.getState()
    expect(imported).toBe(true)
    expect(state.agentConversations.map((conversation) => conversation.id)).toEqual(['used-conversation'])
    expect(state.activeAgentConversationId).toBe('used-conversation')
  })

  it('merges imported agent conversations without replacing local conversations', async () => {
    const localConversation = agentConversation({
      id: 'local-conversation',
      title: '本地对话',
      createdAt: 1,
      updatedAt: 1,
    })
    const importedConversation = agentConversation({
      id: 'imported-conversation',
      activeRoundId: 'round-a',
      rounds: [
        {
          id: 'round-a',
          index: 1,
          parentRoundId: null,
          userMessageId: 'message-a',
          prompt: 'imported prompt',
          inputImageIds: [],
          outputTaskIds: [],
          status: 'done',
          error: null,
          createdAt: 2,
          finishedAt: 3,
        },
      ],
      messages: [{ id: 'message-a', role: 'user', content: 'imported prompt', roundId: 'round-a', createdAt: 2 }],
    })
    useStore.setState({
      agentConversations: [localConversation],
      activeAgentConversationId: localConversation.id,
    })

    const imported = await importData(
      importFile({
        version: 3,
        exportedAt: new Date(0).toISOString(),
        tasks: [],
        agentConversations: [importedConversation],
        imageFiles: {},
      }),
      { importConfig: false, importTasks: true },
    )

    const state = useStore.getState()
    expect(imported).toBe(true)
    expect(state.agentConversations.map((conversation) => conversation.id)).toEqual([
      'local-conversation',
      'imported-conversation',
    ])
    expect(state.activeAgentConversationId).toBe('local-conversation')
  })

  it('stores imported legacy agent conversations in IndexedDB without localStorage or image payloads', async () => {
    const importedConversation = agentConversation({
      id: 'legacy-imported-conversation',
      activeRoundId: 'round-a',
      rounds: [
        {
          id: 'round-a',
          index: 1,
          parentRoundId: null,
          userMessageId: 'message-a',
          prompt: 'imported prompt',
          inputImageIds: [],
          outputTaskIds: ['task-a'],
          responseOutput: [
            { type: 'message', content: [{ type: 'output_text', text: '已生成图片。' }] },
            { type: 'image_generation_call', id: 'image-call-a', result: { base64: 'imported-legacy-base64' } },
          ],
          status: 'done',
          error: null,
          createdAt: 2,
          finishedAt: 3,
        },
      ],
      messages: [{ id: 'message-a', role: 'user', content: 'imported prompt', roundId: 'round-a', createdAt: 2 }],
    })

    const imported = await importData(
      importFile({
        version: 2,
        exportedAt: new Date(0).toISOString(),
        tasks: [],
        agentConversations: [importedConversation],
        imageFiles: {},
      }),
      { importConfig: false, importTasks: true },
    )

    const indexedConversations = await getAllAgentConversations()
    const persisted = getPersistedState(useStore.getState())
    const serializedIndexedConversations = JSON.stringify(indexedConversations)
    const serializedPersisted = JSON.stringify(persisted)

    expect(imported).toBe(true)
    expect(indexedConversations.map((conversation) => conversation.id)).toEqual(['legacy-imported-conversation'])
    expect(serializedIndexedConversations).toContain('image_generation_call')
    expect(serializedIndexedConversations).not.toContain('imported-legacy-base64')
    expect('agentConversations' in persisted).toBe(false)
    expect(serializedPersisted).not.toContain('image_generation_call')
    expect(serializedPersisted).not.toContain('imported-legacy-base64')
  })

  it('keeps imported word entries in the matching existing group by name', async () => {
    useStore.setState({
      wordLibraryGroups: [
        { id: 'default', name: 'Default', sortOrder: 0 },
        { id: 'local-group', name: 'Shared', sortOrder: 1 },
      ],
      wordLibraryEntries: [],
      showToast: vi.fn(),
    })

    const imported = await importData(
      importFile({
        version: 3,
        exportedAt: new Date(0).toISOString(),
        wordLibraryGroups: [{ id: 'imported-group', name: 'Shared', sortOrder: 0 }],
        wordLibraryEntries: [
          {
            id: 'imported-entry',
            groupId: 'imported-group',
            key: 'animal',
            label: 'animal',
            entries: ['cat'],
            draw_count: 1,
            sortOrder: 0,
            isPinned: false,
            isFavorite: false,
            tags: [],
            deletedAt: null,
            createdAt: 0,
            updatedAt: 0,
            usageCount: 0,
          },
        ],
      }),
      { importConfig: true, importTasks: false },
    )

    expect(imported).toBe(true)
    expect(useStore.getState().wordLibraryEntries).toEqual([
      expect.objectContaining({
        id: 'imported-entry',
        groupId: 'local-group',
        key: 'animal',
        entries: ['cat'],
      }),
    ])
  })

  it('normalizes malformed imported word entries before storing them', async () => {
    useStore.setState({
      wordLibraryGroups: [{ id: 'default', name: 'Default', sortOrder: 0 }],
      wordLibraryEntries: [],
      showToast: vi.fn(),
    })

    const imported = await importData(
      importFile({
        version: 3,
        exportedAt: new Date(0).toISOString(),
        wordLibraryGroups: [{ id: 'default', name: 'Default', sortOrder: 0 }],
        wordLibraryEntries: [
          {
            id: 'bad-entry',
            groupId: 'default',
            key: 'bad',
            label: 'bad',
            entries: 'cat',
            draw_count: '2',
            sortOrder: 0,
            isPinned: false,
            isFavorite: false,
            tags: [],
            deletedAt: null,
            createdAt: 0,
            updatedAt: 0,
            usageCount: 0,
          } as unknown as NonNullable<ExportData['wordLibraryEntries']>[number],
        ],
      }),
      { importConfig: true, importTasks: false },
    )

    expect(imported).toBe(true)
    expect(useStore.getState().wordLibraryEntries).toEqual([
      expect.objectContaining({
        id: 'bad-entry',
        groupId: 'default',
        key: 'bad',
        label: 'bad',
        entries: [],
        draw_count: 1,
      }),
    ])
  })

  it('omits word library data from localStorage state after IndexedDB migration', async () => {
    useStore.setState({
      wordLibraryGroups: [{ id: 'default', name: 'Default', sortOrder: 0 }],
      wordLibraryEntries: [
        {
          id: 'entry-a',
          groupId: 'default',
          key: 'large',
          label: 'large',
          entries: ['cat', 'dog'],
          draw_count: 1,
          sortOrder: 0,
          isPinned: false,
          isFavorite: false,
          tags: [],
          deletedAt: null,
          createdAt: 0,
          updatedAt: 0,
          usageCount: 0,
        },
      ],
      tasks: [],
      agentConversations: [],
    })

    await initStore()

    const persisted = getPersistedState(useStore.getState())
    expect('wordLibraryGroups' in persisted).toBe(false)
    expect('wordLibraryEntries' in persisted).toBe(false)
    expect(useStore.getState().wordLibraryEntries).toHaveLength(1)
  })
})

describe('agent draft lifecycle', () => {
  const responsesProfile = createDefaultOpenAIProfile({
    id: 'openai-responses',
    apiKey: 'openai-key',
    apiMode: 'responses',
  })
  const draftState = {
    prompt: `参考 ${getSelectedImageMentionLabel(0)} 生成`,
    inputImages: [imageA],
    maskDraft: {
      targetImageId: imageA.id,
      maskDataUrl: 'data:image/png;base64,mask',
      updatedAt: 1,
    },
    maskEditorImageId: imageA.id,
    agentEditingRoundId: 'round-a',
  }

  beforeEach(() => {
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [responsesProfile],
        activeProfileId: responsesProfile.id,
      }),
      appMode: 'agent',
      agentConversations: [agentConversation({ id: 'conversation-a' }), agentConversation({ id: 'conversation-b' })],
      activeAgentConversationId: 'conversation-a',
      galleryInputDraft: null,
      agentInputDrafts: {},
      agentSidebarCollapsed: false,
      agentAssetPanelCollapsed: false,
      ...draftState,
    })
  })

  it('clears visible input but keeps the agent draft when returning to gallery mode', () => {
    useStore.getState().setAppMode('gallery')

    const state = useStore.getState()
    expect(state.appMode).toBe('gallery')
    expect(state.prompt).toBe('')
    expect(state.inputImages).toEqual([])
    expect(state.maskDraft).toBeNull()
    expect(state.maskEditorImageId).toBeNull()
    expect(state.agentEditingRoundId).toBeNull()
    expect(state.agentInputDrafts['conversation-a']).toMatchObject({
      prompt: draftState.prompt,
      inputImages: draftState.inputImages,
      maskDraft: draftState.maskDraft,
      maskEditorImageId: imageA.id,
    })
  })

  it('restores the agent draft when switching back from gallery mode', () => {
    useStore.getState().setAppMode('gallery')
    useStore.getState().setAppMode('agent')

    const state = useStore.getState()
    expect(state.appMode).toBe('agent')
    expect(state.prompt).toBe(draftState.prompt)
    expect(state.inputImages).toEqual(draftState.inputImages)
    expect(state.maskDraft).toEqual(draftState.maskDraft)
    expect(state.maskEditorImageId).toBe(imageA.id)
    expect(state.agentEditingRoundId).toBeNull()
  })

  it('keeps the gallery draft when switching into agent mode and back', () => {
    const galleryPrompt = `画廊 ${getSelectedImageMentionLabel(0)} 草稿`
    useStore.setState({
      appMode: 'gallery',
      prompt: galleryPrompt,
      inputImages: [imageB],
      maskDraft: null,
      maskEditorImageId: null,
      galleryInputDraft: null,
      agentInputDrafts: {
        'conversation-a': {
          prompt: draftState.prompt,
          inputImages: draftState.inputImages,
          inputImageFolder: null,
          maskDraft: draftState.maskDraft,
          maskEditorImageId: imageA.id,
        },
      },
    })

    useStore.getState().setAppMode('agent')

    let state = useStore.getState()
    expect(state.appMode).toBe('agent')
    expect(state.galleryInputDraft).toMatchObject({ prompt: galleryPrompt, inputImages: [imageB] })
    expect(state.prompt).toBe(draftState.prompt)

    useStore.getState().setAppMode('gallery')

    state = useStore.getState()
    expect(state.appMode).toBe('gallery')
    expect(state.prompt).toBe(galleryPrompt)
    expect(state.inputImages).toEqual([imageB])
  })

  it('persists the gallery draft while agent mode is active', () => {
    const galleryPrompt = 'gallery draft'
    useStore.setState({
      appMode: 'agent',
      galleryInputDraft: {
        prompt: galleryPrompt,
        inputImages: [imageB],
        inputImageFolder: null,
        maskDraft: null,
        maskEditorImageId: null,
      },
    })

    const persisted = getPersistedState(useStore.getState())

    expect(persisted.prompt).toBe(galleryPrompt)
    expect(persisted.inputImages).toEqual([{ id: imageB.id, dataUrl: '' }])
  })

  it('clears stale mentions in the visible input when switching conversations', () => {
    useStore.getState().setActiveAgentConversationId('conversation-b')

    const state = useStore.getState()
    expect(state.activeAgentConversationId).toBe('conversation-b')
    expect(state.prompt).toBe('')
    expect(state.inputImages).toEqual([])
    expect(state.maskDraft).toBeNull()
    expect(state.maskEditorImageId).toBeNull()
    expect(state.agentEditingRoundId).toBeNull()
    expect(state.agentInputDrafts['conversation-a']?.prompt).toBe(draftState.prompt)
  })

  it('restores the previous conversation draft when switching back', () => {
    useStore.getState().setActiveAgentConversationId('conversation-b')
    useStore.getState().setActiveAgentConversationId('conversation-a')

    const state = useStore.getState()
    expect(state.activeAgentConversationId).toBe('conversation-a')
    expect(state.prompt).toBe(draftState.prompt)
    expect(state.inputImages).toEqual(draftState.inputImages)
    expect(state.maskDraft).toEqual(draftState.maskDraft)
    expect(state.maskEditorImageId).toBe(imageA.id)
    expect(state.agentEditingRoundId).toBeNull()
  })

  it('keeps the current draft when selecting the already active conversation', () => {
    useStore.getState().setActiveAgentConversationId('conversation-a')

    const state = useStore.getState()
    expect(state.prompt).toBe(draftState.prompt)
    expect(state.inputImages).toEqual(draftState.inputImages)
    expect(state.maskDraft).toEqual(draftState.maskDraft)
    expect(state.maskEditorImageId).toBe(imageA.id)
  })

  it('persists agent drafts separately from the gallery input draft', () => {
    const persisted = getPersistedState(useStore.getState())

    expect(persisted).not.toHaveProperty('prompt')
    expect(persisted.agentInputDrafts['conversation-a']).toMatchObject({
      prompt: draftState.prompt,
      inputImages: [{ id: imageA.id, dataUrl: '' }],
      maskDraft: draftState.maskDraft,
      maskEditorImageId: imageA.id,
    })
    expect(persisted.agentInputDrafts['conversation-a']?.updatedAt).toEqual(expect.any(Number))
  })

  it('removes stale agent drafts except the last active conversation', () => {
    const now = 10 * 24 * 60 * 60 * 1000
    const staleUpdatedAt = now - 3 * 24 * 60 * 60 * 1000 - 1
    const recentUpdatedAt = now - 3 * 24 * 60 * 60 * 1000
    const activeDraft = {
      prompt: 'active',
      inputImages: [],
      maskDraft: null,
      maskEditorImageId: null,
      inputImageFolder: null,
      updatedAt: staleUpdatedAt,
    }
    const staleDraft = {
      prompt: 'stale',
      inputImages: [],
      maskDraft: null,
      maskEditorImageId: null,
      inputImageFolder: null,
      updatedAt: staleUpdatedAt,
    }
    const recentDraft = {
      prompt: 'recent',
      inputImages: [],
      maskDraft: null,
      maskEditorImageId: null,
      inputImageFolder: null,
      updatedAt: recentUpdatedAt,
    }

    const cleaned = cleanStaleAgentInputDrafts(
      {
        'conversation-a': activeDraft,
        'conversation-b': staleDraft,
        'conversation-c': recentDraft,
      },
      'conversation-a',
      now,
    )

    expect(cleaned).toEqual({
      'conversation-a': activeDraft,
      'conversation-c': recentDraft,
    })
  })
})

describe('agent context for removed outputs', () => {
  beforeEach(() => {
    const profile = createDefaultOpenAIProfile({
      id: 'responses-profile',
      apiKey: 'test-key',
      apiMode: 'responses',
      model: DEFAULT_RESPONSES_MODEL,
    })
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiMode: 'responses',
        model: DEFAULT_RESPONSES_MODEL,
        profiles: [profile],
        activeProfileId: profile.id,
      }),
      prompt: '继续',
      inputImages: [],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
      appMode: 'agent',
      tasks: [
        task({
          id: 'task-live',
          outputImages: ['image-live'],
          sourceMode: 'agent',
          agentRoundId: 'round-a',
          agentToolCallId: 'live-call',
        }),
      ],
      agentConversations: [
        agentConversation({
          id: 'conversation-a',
          activeRoundId: 'round-a',
          rounds: [
            {
              id: 'round-a',
              index: 1,
              parentRoundId: null,
              userMessageId: 'user-a',
              assistantMessageId: 'assistant-a',
              prompt: '画两张图',
              inputImageIds: [],
              outputTaskIds: ['task-deleted', 'task-live'],
              responseOutput: [
                { type: 'message', content: [{ type: 'output_text', text: '已生成两张图。' }] },
                { type: 'image_generation_call', id: 'deleted-call', result: 'deleted-base64' },
                { type: 'image_generation_call', id: 'live-call', result: 'live-base64' },
              ],
              status: 'done',
              error: null,
              createdAt: 1,
              finishedAt: 2,
            },
          ],
          messages: [
            { id: 'user-a', role: 'user', content: '画两张图', roundId: 'round-a', createdAt: 1 },
            {
              id: 'assistant-a',
              role: 'assistant',
              content: '已生成两张图。',
              roundId: 'round-a',
              outputTaskIds: ['task-deleted', 'task-live'],
              createdAt: 2,
            },
          ],
        }),
      ],
      activeAgentConversationId: 'conversation-a',
      agentEditingRoundId: null,
      showToast: vi.fn(),
    })
    vi.mocked(callAgentResponsesApi).mockClear()
    vi.mocked(callAgentResponsesApi).mockResolvedValue({
      text: 'ok',
      images: [],
      outputItems: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
      responseId: 'response-b',
    })
  })

  it('does not send removed image_generation results back to the model', async () => {
    await putImage({ id: 'image-live', dataUrl: 'data:image/png;base64,live-base64' })
    await submitAgentMessage()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const input = vi.mocked(callAgentResponsesApi).mock.calls[0][0].input
    const serializedInput = JSON.stringify(input)
    expect(serializedInput).not.toContain('deleted-base64')
    expect(serializedInput).toContain('live-base64')
    expect(serializedInput).not.toContain('deleted-call')
    expect(serializedInput).not.toContain('live-call')
    expect(serializedInput).not.toContain('image_generation_call')
    expect(serializedInput).toContain('removed_ref')
    expect(serializedInput).toContain('round-1-image-1')
    expect(serializedInput).toContain('round-1-image-2')
    expect(serializedInput).toContain('input_image')
  })

  it('restores stripped image_generation results from task payloads when building context', async () => {
    await putImage({ id: 'image-live', dataUrl: 'data:image/png;base64,live-base64' })
    const rawResponsePayload = JSON.stringify(
      {
        output: [
          { type: 'message', content: [{ type: 'output_text', text: '已生成两张图。' }] },
          { type: 'image_generation_call', id: 'deleted-call', result: 'deleted-base64' },
          { type: 'image_generation_call', id: 'live-call', result: 'live-base64' },
        ],
      },
      null,
      2,
    )
    useStore.setState((state) => ({
      tasks: [
        task({
          id: 'task-live',
          outputImages: ['image-live'],
          rawResponsePayload,
          sourceMode: 'agent',
          agentRoundId: 'round-a',
          agentToolCallId: 'live-call',
        }),
      ],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) =>
          round.id === 'round-a'
            ? {
                ...round,
                responseOutput: [
                  { type: 'message', content: [{ type: 'output_text', text: '已生成两张图。' }] },
                  { type: 'image_generation_call', id: 'deleted-call' },
                  { type: 'image_generation_call', id: 'live-call' },
                ],
              }
            : round,
        ),
      })),
    }))

    await submitAgentMessage()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const input = vi.mocked(callAgentResponsesApi).mock.calls[0][0].input
    const serializedInput = JSON.stringify(input)
    expect(serializedInput).toContain('live-base64')
    expect(serializedInput).toContain('input_image')
    expect(serializedInput).not.toContain('deleted-base64')
    expect(serializedInput).not.toContain('live-call')
    expect(serializedInput).not.toContain('image_generation_call')
  })

  it('hydrates stripped task payload image results from stored images when building context', async () => {
    await putImage({ id: 'image-hydrate', dataUrl: 'data:image/png;base64,hydrated-live-base64' })
    const rawResponsePayload = JSON.stringify(
      {
        output: [{ type: 'image_generation_call' }],
      },
      null,
      2,
    )
    useStore.setState((state) => ({
      tasks: [
        task({
          id: 'task-live',
          outputImages: ['image-hydrate'],
          rawResponsePayload,
          sourceMode: 'agent',
          agentRoundId: 'round-a',
        }),
      ],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) =>
          round.id === 'round-a'
            ? {
                ...round,
                outputTaskIds: ['task-live'],
                responseOutput: [{ type: 'image_generation_call' }],
              }
            : round,
        ),
      })),
    }))

    await submitAgentMessage()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const input = vi.mocked(callAgentResponsesApi).mock.calls[0][0].input
    const serializedInput = JSON.stringify(input)
    expect(serializedInput).toContain('hydrated-live-base64')
  })

  it('restores stripped image results even when legacy tasks lack tool call ids', async () => {
    await putImage({ id: 'image-legacy', dataUrl: 'data:image/png;base64,legacy-live-base64' })
    const rawResponsePayload = JSON.stringify(
      {
        output: [
          { type: 'message', content: [{ type: 'output_text', text: '已生成图片。' }] },
          { type: 'image_generation_call', result: { base64: 'legacy-live-base64' } },
        ],
      },
      null,
      2,
    )
    useStore.setState((state) => ({
      tasks: [
        task({
          id: 'legacy-task-live',
          outputImages: ['image-legacy'],
          rawResponsePayload,
          sourceMode: 'agent',
          agentRoundId: 'round-a',
          agentToolCallId: undefined,
        }),
      ],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) =>
          round.id === 'round-a'
            ? {
                ...round,
                outputTaskIds: ['legacy-task-live'],
                responseOutput: [
                  { type: 'message', content: [{ type: 'output_text', text: '已生成图片。' }] },
                  { type: 'image_generation_call' },
                ],
              }
            : round,
        ),
      })),
    }))

    await submitAgentMessage()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const input = vi.mocked(callAgentResponsesApi).mock.calls[0][0].input
    const serializedInput = JSON.stringify(input)
    expect(serializedInput).toContain('legacy-live-base64')
    expect(serializedInput).toContain('input_image')
    expect(serializedInput).not.toContain('image_generation_call')
    expect(serializedInput.match(/已生成图片。/g)).toHaveLength(1)
  })

  it('restores all stripped batch image results after restart', async () => {
    await putImage({ id: 'image-batch-1', dataUrl: 'data:image/png;base64,batch-base64-1' })
    await putImage({ id: 'image-batch-2', dataUrl: 'data:image/png;base64,batch-base64-2' })
    const batchOnePayload = JSON.stringify(
      {
        output: [{ type: 'image_generation_call', id: 'batch-call-1', result: 'batch-base64-1' }],
      },
      null,
      2,
    )
    const batchTwoPayload = JSON.stringify(
      {
        output: [{ type: 'image_generation_call', id: 'batch-call-2', result: 'batch-base64-2' }],
      },
      null,
      2,
    )
    useStore.setState((state) => ({
      tasks: [
        task({
          id: 'task-batch-1',
          outputImages: ['image-batch-1'],
          rawResponsePayload: batchOnePayload,
          sourceMode: 'agent',
          agentRoundId: 'round-a',
          agentToolCallId: 'batch-call-1',
          agentBatchCallId: 'batch-fc-1',
        }),
        task({
          id: 'task-batch-2',
          outputImages: ['image-batch-2'],
          rawResponsePayload: batchTwoPayload,
          sourceMode: 'agent',
          agentRoundId: 'round-a',
          agentToolCallId: 'batch-call-2',
          agentBatchCallId: 'batch-fc-1',
        }),
      ],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) =>
          round.id === 'round-a'
            ? {
                ...round,
                outputTaskIds: ['task-batch-1', 'task-batch-2'],
                responseOutput: [
                  { type: 'function_call', name: 'generate_image_batch', call_id: 'batch-fc-1', arguments: '{}' },
                  {
                    type: 'function_call_output',
                    call_id: 'batch-fc-1',
                    output: '{"images":[{"id":"1","status":"done"},{"id":"2","status":"done"}]}',
                  },
                  { type: 'image_generation_call' },
                  { type: 'image_generation_call' },
                ],
              }
            : round,
        ),
      })),
    }))

    await submitAgentMessage()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const input = vi.mocked(callAgentResponsesApi).mock.calls[0][0].input
    const serializedInput = JSON.stringify(input)
    expect(serializedInput).toContain('batch-base64-1')
    expect(serializedInput).toContain('batch-base64-2')
    expect(serializedInput).toContain('input_image')
    expect(serializedInput).not.toContain('batch-call-1')
    expect(serializedInput).not.toContain('batch-call-2')
    expect(serializedInput).not.toContain('image_generation_call')
  })

  it('scrubs stored agent response payloads when deleting an output task', async () => {
    const rawResponsePayload = JSON.stringify(
      {
        output: [
          { type: 'message', content: [{ type: 'output_text', text: '已生成两张图。' }] },
          { type: 'image_generation_call', id: 'deleted-call', result: 'deleted-base64' },
          { type: 'image_generation_call', id: 'live-call', result: 'live-base64' },
        ],
      },
      null,
      2,
    )
    const deletedTask = task({
      id: 'task-deleted',
      outputImages: ['image-deleted'],
      rawResponsePayload,
      sourceMode: 'agent',
      agentRoundId: 'round-a',
      agentToolCallId: 'deleted-call',
    })
    const liveTask = task({
      id: 'task-live',
      outputImages: ['image-live'],
      rawResponsePayload,
      sourceMode: 'agent',
      agentRoundId: 'round-a',
      agentToolCallId: 'live-call',
    })
    useStore.setState((state) => ({
      tasks: [deletedTask, liveTask],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) =>
          round.id === 'round-a'
            ? {
                ...round,
                outputTaskIds: ['task-deleted', 'task-live'],
                responseOutput: JSON.parse(rawResponsePayload).output,
              }
            : round,
        ),
      })),
    }))

    await removeTask(deletedTask)

    const state = useStore.getState()
    const serializedConversations = JSON.stringify(state.agentConversations)
    const remainingTaskPayload = state.tasks.find((item) => item.id === 'task-live')?.rawResponsePayload ?? ''
    expect(serializedConversations).not.toContain('deleted-base64')
    expect(remainingTaskPayload).not.toContain('deleted-base64')
    expect(serializedConversations).toContain('live-base64')
    expect(remainingTaskPayload).toContain('live-base64')
  })

  it('does not corrupt batch task payloads when deleting one of the batch tasks', async () => {
    const batchDeletedPayload = JSON.stringify(
      {
        output: [{ type: 'image_generation_call', id: 'batch-deleted-call', result: 'batch-deleted-base64' }],
      },
      null,
      2,
    )
    const batchLivePayload = JSON.stringify(
      {
        output: [{ type: 'image_generation_call', id: 'batch-live-call', result: 'batch-live-base64' }],
      },
      null,
      2,
    )
    const batchDeletedTask = task({
      id: 'batch-task-deleted',
      outputImages: ['batch-img-deleted'],
      rawResponsePayload: batchDeletedPayload,
      sourceMode: 'agent',
      agentRoundId: 'round-a',
      agentToolCallId: 'batch-deleted-call',
      agentBatchCallId: 'batch-fc-1',
    })
    const batchLiveTask = task({
      id: 'batch-task-live',
      outputImages: ['batch-img-live'],
      rawResponsePayload: batchLivePayload,
      sourceMode: 'agent',
      agentRoundId: 'round-a',
      agentToolCallId: 'batch-live-call',
      agentBatchCallId: 'batch-fc-1',
    })
    useStore.setState((state) => ({
      tasks: [batchDeletedTask, batchLiveTask],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) =>
          round.id === 'round-a'
            ? {
                ...round,
                outputTaskIds: ['batch-task-deleted', 'batch-task-live'],
                responseOutput: [
                  { type: 'function_call', name: 'generate_image_batch', call_id: 'batch-fc-1', arguments: '{}' },
                  {
                    type: 'function_call_output',
                    call_id: 'batch-fc-1',
                    output: '{"images":[{"id":"1","status":"done"},{"id":"2","status":"done"}]}',
                  },
                ],
              }
            : round,
        ),
      })),
    }))

    await removeTask(batchDeletedTask)

    const state = useStore.getState()
    const liveTaskPayload = state.tasks.find((item) => item.id === 'batch-task-live')?.rawResponsePayload ?? ''
    expect(liveTaskPayload).toContain('batch-live-base64')
    expect(liveTaskPayload).not.toContain('batch-deleted-base64')
    const serializedConversations = JSON.stringify(state.agentConversations)
    expect(serializedConversations).toContain('function_call_output')
    expect(serializedConversations).not.toContain('batch-deleted-base64')
  })

  it('cascade-deletes the task together with its generated assets (task card delete)', async () => {
    dbMockState.assetsByImage.clear()
    dbMockState.purgedAssetIds.length = 0
    const cascadeAsset: GeneratedAsset = {
      id: 'asset-cascade',
      imageId: 'img-cascade',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
      trashedAt: null,
      favorite: false,
      rating: 0,
      collectionIds: [],
      tagIds: [],
      origins: [],
      primaryOriginKey: null,
      parentAssetIds: [],
      metadataVersion: 1,
    }
    dbMockState.assetsByImage.set('img-cascade', cascadeAsset)
    const cascadeTask = task({ id: 'task-cascade', outputImages: ['img-cascade'] })
    // 幸存任务也引用了同一张图且保存过本地导出文件——素材被永久删除时，
    // 指向同一原图的导出文件应一并删除（图片字节已删，硬链接/副本指向已删图片）
    const survivorTask = task({
      id: 'task-survivor',
      outputImages: ['img-cascade'],
      localSavedOutputImagePaths: { '0:img-cascade': 'D:\\LocalSaves\\images\\cascade-export.png' },
    })
    const { deleteLocalImageFiles } = await import('./lib/localSave')
    const deleteLocalImageFilesMock = vi.mocked(deleteLocalImageFiles)
    deleteLocalImageFilesMock.mockClear()
    useStore.setState({ tasks: [cascadeTask, survivorTask] })

    await removeTask(cascadeTask)

    expect(dbMockState.purgedAssetIds).toContain('asset-cascade')
    // 级联删除素材后，幸存任务里引用该原图的本地导出文件也被删除
    expect(deleteLocalImageFilesMock).toHaveBeenCalledWith(
      expect.arrayContaining(['D:\\LocalSaves\\images\\cascade-export.png']),
    )
  })

  it('keeps generated assets still referenced by another live task when deleting the task', async () => {
    dbMockState.assetsByImage.clear()
    dbMockState.purgedAssetIds.length = 0
    const sharedAsset: GeneratedAsset = {
      id: 'asset-shared',
      imageId: 'img-shared',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
      trashedAt: null,
      favorite: false,
      rating: 0,
      collectionIds: [],
      tagIds: [],
      origins: [],
      primaryOriginKey: null,
      parentAssetIds: [],
      metadataVersion: 1,
    }
    dbMockState.assetsByImage.set('img-shared', sharedAsset)
    const deleted = task({ id: 'task-deleted', outputImages: ['img-shared'] })
    const referrer = task({ id: 'task-referrer', inputImageIds: ['img-shared'] })
    useStore.setState({ tasks: [deleted, referrer] })

    await removeTask(deleted)

    // 被引用素材不删除、也不自动改动（不回收、不强解引用）：保持原样
    expect(dbMockState.purgedAssetIds).not.toContain('asset-shared')
  })

  it('deletes the local saved output files of a removed task', async () => {
    const { deleteLocalImageFiles } = await import('./lib/localSave')
    const deleteLocalImageFilesMock = vi.mocked(deleteLocalImageFiles)
    deleteLocalImageFilesMock.mockClear()
    const deleted = task({
      id: 'task-local-saved',
      outputImages: ['img-out'],
      localSavedOutputImagePaths: {
        '0:img-out': 'D:\\LocalSaves\\images\\分组\\标签页\\img-out.png',
        '1:img-out': 'D:\\LocalSaves\\images\\分组\\标签页\\img-out-2.jpg',
      },
    })
    const unrelated = task({
      id: 'task-unrelated',
      outputImages: ['img-other'],
      localSavedOutputImagePaths: { '0:img-other': 'D:\\LocalSaves\\images\\keep.png' },
    })
    useStore.setState({ tasks: [deleted, unrelated] })

    await removeTask(deleted)

    expect(deleteLocalImageFilesMock).toHaveBeenCalledTimes(1)
    expect(deleteLocalImageFilesMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        'D:\\LocalSaves\\images\\分组\\标签页\\img-out.png',
        'D:\\LocalSaves\\images\\分组\\标签页\\img-out-2.jpg',
      ]),
    )
    // 无关任务的导出文件不在删除列表
    const calledPaths = deleteLocalImageFilesMock.mock.calls[0][0] as string[]
    expect(calledPaths).not.toContain('D:\\LocalSaves\\images\\keep.png')
  })

  it('deletes local saved output files when removing multiple tasks', async () => {
    const { deleteLocalImageFiles } = await import('./lib/localSave')
    const deleteLocalImageFilesMock = vi.mocked(deleteLocalImageFiles)
    deleteLocalImageFilesMock.mockClear()
    const first = task({
      id: 'task-batch-1',
      outputImages: ['img-1'],
      localSavedOutputImagePaths: { '0:img-1': 'D:\\LocalSaves\\images\\a.png' },
    })
    const second = task({
      id: 'task-batch-2',
      outputImages: ['img-2'],
      localSavedOutputImagePaths: { '0:img-2': 'D:\\LocalSaves\\images\\b.jpg' },
    })
    const survivor = task({
      id: 'task-survivor',
      outputImages: ['img-3'],
      localSavedOutputImagePaths: { '0:img-3': 'D:\\LocalSaves\\images\\c.webp' },
    })
    useStore.setState({ tasks: [first, second, survivor] })

    await removeMultipleTasks(['task-batch-1', 'task-batch-2'])

    const calledPaths = deleteLocalImageFilesMock.mock.calls[0][0] as string[]
    expect(calledPaths).toEqual(
      expect.arrayContaining(['D:\\LocalSaves\\images\\a.png', 'D:\\LocalSaves\\images\\b.jpg']),
    )
    expect(calledPaths).not.toContain('D:\\LocalSaves\\images\\c.webp')
  })
})

describe('clear data deletes local saved output files', () => {
  beforeEach(async () => {
    await clearTasks()
    await clearImages()
    const { deleteLocalImageFiles } = await import('./lib/localSave')
    vi.mocked(deleteLocalImageFiles).mockClear()
  })

  it('clears the local export files of every task when clearing all data', async () => {
    const { deleteLocalImageFiles } = await import('./lib/localSave')
    const deleteLocalImageFilesMock = vi.mocked(deleteLocalImageFiles)
    const first = task({
      id: 'clear-task-1',
      outputImages: ['img-c1'],
      localSavedOutputImagePaths: { '0:img-c1': 'D:\\LocalSaves\\images\\c1.png' },
    })
    const second = task({
      id: 'clear-task-2',
      outputImages: ['img-c2'],
      localSavedOutputImagePaths: { '0:img-c2': 'D:\\LocalSaves\\images\\c2.jpg' },
    })
    useStore.setState({ tasks: [first, second] })
    await putDbTask(first)
    await putDbTask(second)

    await clearData({ clearConfig: false, clearTasks: true })

    expect(deleteLocalImageFilesMock).toHaveBeenCalledTimes(1)
    const calledPaths = deleteLocalImageFilesMock.mock.calls[0][0] as string[]
    expect(calledPaths).toEqual(
      expect.arrayContaining(['D:\\LocalSaves\\images\\c1.png', 'D:\\LocalSaves\\images\\c2.jpg']),
    )
  })
})

describe('agent batch reference resolution', () => {
  const responsesProfile = createDefaultOpenAIProfile({
    id: 'responses-profile',
    apiKey: 'test-key',
    apiMode: 'responses',
    model: DEFAULT_RESPONSES_MODEL,
  })

  beforeEach(async () => {
    await clearImages()
    await putImage(imageA)
    await putImage(imageB)
    vi.mocked(callAgentResponsesApi).mockClear()
    vi.mocked(callBatchImageSingle).mockClear()
    vi.mocked(callImageApi).mockReset()
    vi.mocked(callImageApi).mockResolvedValue({
      images: [],
      actualParams: {},
      actualParamsList: [],
      revisedPrompts: [],
    })
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiMode: 'responses',
        model: DEFAULT_RESPONSES_MODEL,
        profiles: [responsesProfile],
        activeProfileId: responsesProfile.id,
      }),
      prompt: '继续生成',
      inputImages: [],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
      appMode: 'agent',
      workspaceTabs: [],
      activeWorkspaceTabId: null,
      tasks: [
        task({ id: 'task-branch-a', outputImages: [imageA.id], sourceMode: 'agent', agentRoundId: 'round-2-a' }),
        task({ id: 'task-branch-b', outputImages: [imageB.id], sourceMode: 'agent', agentRoundId: 'round-2-b' }),
      ],
      agentConversations: [
        agentConversation({
          id: 'conversation-a',
          activeRoundId: 'round-2-b',
          rounds: [
            {
              id: 'round-1',
              index: 1,
              parentRoundId: null,
              userMessageId: 'user-1',
              assistantMessageId: 'assistant-1',
              prompt: '画基础图',
              inputImageIds: [],
              outputTaskIds: [],
              status: 'done',
              error: null,
              createdAt: 1,
              finishedAt: 2,
            },
            {
              id: 'round-2-a',
              index: 2,
              parentRoundId: 'round-1',
              userMessageId: 'user-2-a',
              assistantMessageId: 'assistant-2-a',
              prompt: '分支 A',
              inputImageIds: [],
              outputTaskIds: ['task-branch-a'],
              status: 'done',
              error: null,
              createdAt: 3,
              finishedAt: 4,
            },
            {
              id: 'round-2-b',
              index: 2,
              parentRoundId: 'round-1',
              userMessageId: 'user-2-b',
              assistantMessageId: 'assistant-2-b',
              prompt: '分支 B',
              inputImageIds: [],
              outputTaskIds: ['task-branch-b'],
              status: 'done',
              error: null,
              createdAt: 5,
              finishedAt: 6,
            },
          ],
          messages: [
            { id: 'user-1', role: 'user', content: '画基础图', roundId: 'round-1', createdAt: 1 },
            { id: 'assistant-1', role: 'assistant', content: '完成', roundId: 'round-1', createdAt: 2 },
            { id: 'user-2-a', role: 'user', content: '分支 A', roundId: 'round-2-a', createdAt: 3 },
            {
              id: 'assistant-2-a',
              role: 'assistant',
              content: '完成',
              roundId: 'round-2-a',
              outputTaskIds: ['task-branch-a'],
              createdAt: 4,
            },
            { id: 'user-2-b', role: 'user', content: '分支 B', roundId: 'round-2-b', createdAt: 5 },
            {
              id: 'assistant-2-b',
              role: 'assistant',
              content: '完成',
              roundId: 'round-2-b',
              outputTaskIds: ['task-branch-b'],
              createdAt: 6,
            },
          ],
        }),
      ],
      activeAgentConversationId: 'conversation-a',
      agentEditingRoundId: null,
      showToast: vi.fn(),
    })
  })

  it('resolves batch references from the active branch path only', async () => {
    vi.mocked(callAgentResponsesApi)
      .mockResolvedValueOnce({
        text: '',
        images: [],
        outputItems: [
          {
            type: 'function_call',
            name: 'generate_image_batch',
            call_id: 'batch-call',
            arguments: JSON.stringify({
              images: [
                {
                  id: 'next-image',
                  prompt: '参考 <ref id="round-2-image-1" /> 生成',
                },
              ],
            }),
          },
        ],
        responseId: 'response-1',
      })
      .mockResolvedValueOnce({
        text: '完成',
        images: [],
        outputItems: [{ type: 'message', content: [{ type: 'output_text', text: '完成' }] }],
        responseId: 'response-2',
      })

    await submitAgentMessage()

    for (let i = 0; i < 5 && vi.mocked(callBatchImageSingle).mock.calls.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(callBatchImageSingle).toHaveBeenCalled()
    const batchArgs = vi.mocked(callBatchImageSingle).mock.calls[0][0]
    expect(batchArgs.referenceImageDataUrls).toEqual([imageB.dataUrl])
    expect(batchArgs.referenceImageDataUrls).not.toContain(imageA.dataUrl)
    expect(batchArgs.referenceIds).toEqual(['round-2-image-1'])
  })

  it('assigns generated image batches to agent task cards', async () => {
    vi.mocked(callAgentResponsesApi)
      .mockResolvedValueOnce({
        text: '',
        images: [],
        outputItems: [
          {
            type: 'function_call',
            name: 'generate_image_batch',
            call_id: 'batch-call',
            arguments: JSON.stringify({
              images: [
                { id: 'image-a', prompt: '第一张' },
                { id: 'image-b', prompt: '第二张' },
              ],
            }),
          },
        ],
        responseId: 'response-1',
      })
      .mockResolvedValueOnce({
        text: '完成',
        images: [],
        outputItems: [{ type: 'message', content: [{ type: 'output_text', text: '完成' }] }],
        responseId: 'response-2',
      })

    await submitAgentMessage()

    await vi.waitFor(() => {
      expect(useStore.getState().tasks.filter((item) => item.agentBatchCallId === 'batch-call')).toHaveLength(2)
    })
    const batches = useStore
      .getState()
      .tasks.filter((item) => item.agentBatchCallId === 'batch-call')
      .map((item) => item.filenameBatch)
      .sort()
    expect(batches).toEqual([1, 2])
  })

  it('limits Agent batch concurrency, preserves model order, and keeps partial failures isolated', async () => {
    const concurrentProfile = { ...responsesProfile, maxConcurrent: 2, maxRetries: 0, streamImages: false }
    useStore.setState((state) => ({
      settings: normalizeSettings({
        ...state.settings,
        profiles: [concurrentProfile],
        activeProfileId: concurrentProfile.id,
      }),
    }))
    vi.mocked(callAgentResponsesApi)
      .mockResolvedValueOnce({
        text: '',
        images: [],
        outputItems: [
          {
            type: 'function_call',
            name: 'generate_image_batch',
            call_id: 'batch-concurrency',
            arguments: JSON.stringify({
              images: [
                { id: 'image-a', prompt: '第一张' },
                { id: 'image-b', prompt: '第二张' },
                { id: 'image-c', prompt: '第三张' },
                { id: 'image-d', prompt: '第四张' },
              ],
            }),
          },
        ],
        responseId: 'response-1',
      })
      .mockResolvedValueOnce({
        text: '批量完成',
        images: [],
        outputItems: [{ type: 'message', content: [{ type: 'output_text', text: '批量完成' }] }],
        responseId: 'response-2',
      })

    let active = 0
    let peak = 0
    const pending: Array<{ id: string; settle: () => void }> = []
    for (let index = 0; index < 4; index++) {
      vi.mocked(callBatchImageSingle).mockImplementationOnce(
        (opts) =>
          new Promise((resolve, reject) => {
            active++
            peak = Math.max(peak, active)
            pending.push({
              id: opts.batchItemId,
              settle: () => {
                active--
                if (opts.batchItemId === 'image-b') {
                  reject(new Error('第二张生成失败'))
                } else {
                  resolve({
                    batchItemId: opts.batchItemId,
                    image: { dataUrl: 'data:image/png;base64,batch-output', revisedPrompt: opts.prompt },
                    error: null,
                  })
                }
              },
            })
          }),
      )
    }

    await submitAgentMessage()
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    expect(peak).toBe(2)

    pending.shift()!.settle()
    await vi.waitFor(() => expect(vi.mocked(callBatchImageSingle).mock.calls).toHaveLength(3))
    pending.shift()!.settle()
    await vi.waitFor(() => expect(vi.mocked(callBatchImageSingle).mock.calls).toHaveLength(4))
    while (pending.length > 0) pending.shift()!.settle()

    await vi.waitFor(() => {
      const conversation = useStore.getState().agentConversations.find((item) => item.id === 'conversation-a')
      const latestRound = conversation?.rounds.find((round) => round.id === conversation.activeRoundId)
      expect(latestRound?.status).toBe('done')
    })

    const state = useStore.getState()
    const conversation = state.agentConversations.find((item) => item.id === 'conversation-a')!
    const latestRound = conversation.rounds.find((round) => round.id === conversation.activeRoundId)!
    const orderedTasks = latestRound.outputTaskIds.map((taskId) => state.tasks.find((item) => item.id === taskId)!)
    expect(orderedTasks.map((item) => item.prompt.split('\n')[0])).toEqual(['第一张', '第二张', '第三张', '第四张'])
    expect(orderedTasks.map((item) => ({ status: item.status, error: item.error }))).toEqual([
      { status: 'done', error: null },
      { status: 'error', error: '第二张生成失败' },
      { status: 'done', error: null },
      { status: 'done', error: null },
    ])
    expect(peak).toBeLessThanOrEqual(2)
  })

  it('plans and executes a terminal 100-image batch with one Agent request', async () => {
    const images = Array.from({ length: 100 }, (_, index) => ({
      id: `image-${index + 1}`,
      prompt: `主体 ${index + 1}`,
    }))
    vi.mocked(callAgentResponsesApi).mockResolvedValueOnce({
      text: '正在生成 100 张图片。',
      images: [],
      outputItems: [
        {
          type: 'function_call',
          name: 'generate_image_batch',
          call_id: 'terminal-batch-100',
          arguments: JSON.stringify({
            requested_count: 100,
            finalize_after_batch: true,
            shared_prompt: '统一商业摄影风格',
            images,
          }),
        },
      ],
      responseId: 'response-terminal',
    })

    await submitAgentMessage()

    await vi.waitFor(() => {
      const conversation = useStore.getState().agentConversations.find((item) => item.id === 'conversation-a')
      const latestRound = conversation?.rounds.find((round) => round.id === conversation.activeRoundId)
      expect(latestRound?.status).toBe('done')
    })

    expect(callAgentResponsesApi).toHaveBeenCalledTimes(1)
    expect(callBatchImageSingle).toHaveBeenCalledTimes(100)
    expect(vi.mocked(callBatchImageSingle).mock.calls[0][0].prompt).toMatch(/^统一商业摄影风格\n\n主体 1\n\n/)
    expect(vi.mocked(callBatchImageSingle).mock.calls[99][0].prompt).toContain('主体 100')

    const conversation = useStore.getState().agentConversations.find((item) => item.id === 'conversation-a')!
    const latestRound = conversation.rounds.find((round) => round.id === conversation.activeRoundId)!
    const assistantMessage = conversation.messages.find((message) => message.id === latestRound.assistantMessageId)
    expect(latestRound.outputTaskIds).toHaveLength(100)
    expect(assistantMessage?.content).toContain('批量生成完成，共 100 张图片。')
  })

  it('stores successful hybrid batch images when Agent streaming is enabled', async () => {
    const agentProfile = createDefaultOpenAIProfile({
      id: 'agent-streaming-profile',
      apiKey: 'agent-key',
      apiMode: 'responses',
      model: DEFAULT_RESPONSES_MODEL,
      streamImages: true,
    })
    const imageProfile = createDefaultOpenAIProfile({
      id: 'hybrid-image-profile',
      apiKey: 'image-key',
      apiMode: 'images',
      streamImages: true,
    })
    useStore.setState((state) => ({
      settings: normalizeSettings({
        ...state.settings,
        agentApiConfigMode: 'hybrid',
        agentUseCustomProfile: true,
        agentProfile,
        profiles: [imageProfile],
        activeProfileId: imageProfile.id,
      }),
    }))
    vi.mocked(callAgentResponsesApi).mockResolvedValueOnce({
      text: '',
      images: [],
      outputItems: [
        {
          type: 'function_call',
          name: 'generate_image_batch',
          call_id: 'hybrid-streaming-batch',
          arguments: JSON.stringify({
            requested_count: 2,
            finalize_after_batch: true,
            shared_prompt: '',
            images: [
              { id: 'image-1', prompt: '第一张' },
              { id: 'image-2', prompt: '第二张' },
            ],
          }),
        },
      ],
      responseId: 'response-hybrid-batch',
    })
    vi.mocked(callImageApi).mockResolvedValue({
      images: ['data:image/png;base64,aHlicmlkLWJhdGNo'],
      actualParams: {},
      actualParamsList: [{}],
      revisedPrompts: [],
    })

    await submitAgentMessage()

    await vi.waitFor(() => {
      const state = useStore.getState()
      const conversation = state.agentConversations.find((item) => item.id === 'conversation-a')!
      const round = conversation.rounds.find((item) => item.id === conversation.activeRoundId)!
      const tasks = round.outputTaskIds.map((id) => state.tasks.find((task) => task.id === id)!)
      expect(round.status).toBe('done')
      expect(tasks).toHaveLength(2)
      expect(tasks.every((task) => task.status === 'done')).toBe(true)
      expect(tasks.every((task) => task.error === null)).toBe(true)
      expect(tasks.every((task) => task.outputImages.length === 1)).toBe(true)
    })
  })

  it('runs multiple fallback single-image function calls concurrently', async () => {
    const concurrentProfile = { ...responsesProfile, maxConcurrent: 2, maxRetries: 0, streamImages: false }
    useStore.setState((state) => ({
      settings: normalizeSettings({
        ...state.settings,
        agentApiConfigMode: 'hybrid',
        profiles: [concurrentProfile],
        activeProfileId: concurrentProfile.id,
      }),
    }))
    vi.mocked(callAgentResponsesApi)
      .mockResolvedValueOnce({
        text: '',
        images: [],
        outputItems: Array.from({ length: 4 }, (_, index) => ({
          type: 'function_call',
          name: 'generate_image',
          call_id: `single-${index + 1}`,
          arguments: JSON.stringify({ id: `image-${index + 1}`, prompt: `prompt-${index + 1}` }),
        })),
        responseId: 'response-1',
      })
      .mockResolvedValueOnce({
        text: '瀹屾垚',
        images: [],
        outputItems: [{ type: 'message', content: [{ type: 'output_text', text: '瀹屾垚' }] }],
        responseId: 'response-2',
      })

    let active = 0
    let peak = 0
    const pending: Array<() => void> = []
    vi.mocked(callImageApi).mockImplementation(
      () =>
        new Promise((resolve) => {
          active++
          peak = Math.max(peak, active)
          pending.push(() => {
            active--
            resolve({
              images: ['data:image/png;base64,c2luZ2xlLW91dHB1dA=='],
              actualParams: {},
              actualParamsList: [{}],
              revisedPrompts: [],
            })
          })
        }),
    )

    await submitAgentMessage()
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    pending.shift()!()
    await vi.waitFor(() => expect(vi.mocked(callImageApi).mock.calls).toHaveLength(3))
    pending.shift()!()
    await vi.waitFor(() => expect(vi.mocked(callImageApi).mock.calls).toHaveLength(4))
    while (pending.length > 0) pending.shift()!()

    await vi.waitFor(() => {
      const conversation = useStore.getState().agentConversations.find((item) => item.id === 'conversation-a')
      const latestRound = conversation?.rounds.find((round) => round.id === conversation.activeRoundId)
      expect(latestRound?.status).toBe('done')
    })
    expect(peak).toBe(2)
  })

  it('resolves batch references to current round input images', async () => {
    useStore.setState({ inputImages: [imageA] })
    vi.mocked(callAgentResponsesApi)
      .mockResolvedValueOnce({
        text: '',
        images: [],
        outputItems: [
          {
            type: 'function_call',
            name: 'generate_image_batch',
            call_id: 'batch-call',
            arguments: JSON.stringify({
              images: [
                {
                  id: 'variant-image',
                  prompt: '参考 <ref id="round-3-reference-1" /> 生成变体',
                },
              ],
            }),
          },
        ],
        responseId: 'response-1',
      })
      .mockResolvedValueOnce({
        text: '完成',
        images: [],
        outputItems: [{ type: 'message', content: [{ type: 'output_text', text: '完成' }] }],
        responseId: 'response-2',
      })

    await submitAgentMessage()

    for (let i = 0; i < 5 && vi.mocked(callBatchImageSingle).mock.calls.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(callBatchImageSingle).toHaveBeenCalled()
    const batchArgs = vi.mocked(callBatchImageSingle).mock.calls[0][0]
    expect(batchArgs.referenceImageDataUrls).toEqual([imageA.dataUrl])
    expect(batchArgs.referenceIds).toEqual(['round-3-reference-1'])
  })
})

describe('agent assistant regeneration', () => {
  const responsesProfile = createDefaultOpenAIProfile({
    id: 'openai-responses',
    apiKey: 'openai-key',
    apiMode: 'responses',
  })

  beforeEach(() => {
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [responsesProfile],
        activeProfileId: responsesProfile.id,
        alwaysShowRetryButton: false,
      }),
      params: { ...DEFAULT_PARAMS, n: 4 },
      agentEditingRoundId: 'round-a',
      agentConversations: [
        agentConversation({
          id: 'conversation-a',
          activeRoundId: 'round-a',
          rounds: [
            {
              id: 'round-a',
              index: 1,
              parentRoundId: null,
              userMessageId: 'user-a',
              assistantMessageId: 'assistant-a',
              prompt: '画一只猫',
              inputImageIds: [imageA.id],
              outputTaskIds: [],
              status: 'done',
              error: null,
              createdAt: 1,
              finishedAt: 2,
            },
          ],
          messages: [
            {
              id: 'user-a',
              role: 'user',
              content: '画一只猫',
              roundId: 'round-a',
              inputImageIds: [imageA.id],
              createdAt: 1,
            },
            { id: 'assistant-a', role: 'assistant', content: '已完成。', roundId: 'round-a', createdAt: 2 },
          ],
        }),
      ],
      toast: null,
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  it('creates a sibling round from the assistant message regardless of retry setting', async () => {
    await regenerateAgentAssistantMessage('conversation-a', 'round-a')

    const conversation = useStore.getState().agentConversations[0]
    const newRound = conversation.rounds.find((round) => round.id !== 'round-a')
    expect(newRound).toMatchObject({
      index: 1,
      parentRoundId: null,
      prompt: '画一只猫',
      inputImageIds: [imageA.id],
      status: 'running',
      outputTaskIds: [],
    })
    expect(conversation.activeRoundId).toBe(newRound?.id)
    expect(conversation.messages).toContainEqual(
      expect.objectContaining({
        role: 'user',
        content: '画一只猫',
        roundId: newRound?.id,
        inputImageIds: [imageA.id],
      }),
    )
    expect(useStore.getState().agentEditingRoundId).toBeNull()
  })

  it('overwrites the same round when regenerating an error assistant message', async () => {
    useStore.setState({
      agentConversations: [
        agentConversation({
          id: 'conversation-a',
          activeRoundId: 'round-a',
          rounds: [
            {
              id: 'round-a',
              index: 1,
              parentRoundId: null,
              userMessageId: 'user-a',
              assistantMessageId: 'assistant-a',
              prompt: '画一只猫',
              inputImageIds: [imageA.id],
              outputTaskIds: ['task-a'],
              status: 'error',
              error: '失败',
              createdAt: 1,
              finishedAt: 2,
            },
          ],
          messages: [
            {
              id: 'user-a',
              role: 'user',
              content: '画一只猫',
              roundId: 'round-a',
              inputImageIds: [imageA.id],
              createdAt: 1,
            },
            {
              id: 'assistant-a',
              role: 'assistant',
              content: '请求失败：失败',
              roundId: 'round-a',
              outputTaskIds: ['task-a'],
              createdAt: 2,
            },
          ],
        }),
      ],
    })

    await regenerateAgentAssistantMessage('conversation-a', 'round-a')

    const conversation = useStore.getState().agentConversations[0]
    expect(conversation.rounds).toHaveLength(1)
    expect(conversation.activeRoundId).toBe('round-a')
    expect(conversation.rounds[0]).toMatchObject({
      id: 'round-a',
      status: 'running',
      error: null,
      outputTaskIds: [],
      finishedAt: null,
    })
    expect(conversation.messages.find((message) => message.id === 'assistant-a')).toMatchObject({
      content: '',
      outputTaskIds: [],
    })
  })
})

describe('reused task API profile', () => {
  const openaiProfile = createDefaultOpenAIProfile({ id: 'openai-profile', apiKey: 'openai-key' })
  const falProfile = createDefaultFalProfile({ id: 'fal-profile', name: 'fal 配置', apiKey: 'fal-key' })

  beforeEach(() => {
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [openaiProfile, falProfile],
        activeProfileId: openaiProfile.id,
        reuseTaskApiProfileTemporarily: true,
      }),
      prompt: '',
      inputImages: [],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
      tasks: [],
      showSettings: false,
      toast: null,
      reusedTaskApiProfileId: null,
      reusedTaskApiProfileName: null,
      reusedTaskApiProfileMissing: false,
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  it('resolves a task API profile by stored profile id', () => {
    const resolved = getTaskApiProfile(
      useStore.getState().settings,
      task({ apiProvider: 'fal', apiProfileId: falProfile.id }),
    )

    expect(resolved?.id).toBe(falProfile.id)
  })

  it('does not resolve a task API profile by stored name or model', () => {
    const resolved = getTaskApiProfile(
      useStore.getState().settings,
      task({
        apiProvider: 'fal',
        apiProfileName: falProfile.name,
        apiModel: falProfile.model,
      }),
    )

    expect(resolved).toBeNull()
  })

  it('reuses the task API profile temporarily without switching the active profile', async () => {
    await reuseConfig(
      task({
        apiProvider: 'fal',
        apiProfileId: falProfile.id,
        params: { ...DEFAULT_PARAMS, n: 8, size: 'auto', quality: 'auto' },
      }),
    )

    const state = useStore.getState()
    expect(state.settings.activeProfileId).toBe(openaiProfile.id)
    expect(state.reusedTaskApiProfileId).toBe(falProfile.id)
    expect(state.params).toMatchObject({ n: 8, size: 'auto', quality: 'auto' })
    expect(state.showToast).toHaveBeenCalledWith('已临时复用该任务的 API 配置「fal 配置」', 'success')
  })

  it('keeps selected image mentions when reusing a task with different current input images', async () => {
    await clearImages()
    await putImage(imageA)
    await putImage(imageB)
    const taskPrompt = `参考 ${getSelectedImageMentionLabel(1)} 生成`

    useStore.setState({
      prompt: `当前 ${getSelectedImageMentionLabel(1)}`,
      inputImages: [
        { id: 'current-x', dataUrl: 'data:image/png;base64,x' },
        { id: 'current-y', dataUrl: 'data:image/png;base64,y' },
      ],
    })

    await reuseConfig(
      task({
        apiProvider: 'openai',
        apiProfileId: openaiProfile.id,
        prompt: taskPrompt,
        inputImageIds: [imageA.id, imageB.id],
      }),
    )

    const state = useStore.getState()
    expect(state.inputImages.map((img) => img.id)).toEqual([imageA.id, imageB.id])
    expect(state.prompt).toBe(taskPrompt)
  })

  it('clears temporary reuse when switching current settings to the reused API profile', async () => {
    await reuseConfig(task({ apiProvider: 'fal', apiProfileId: falProfile.id }))

    useStore.getState().setSettings({ activeProfileId: falProfile.id })

    const state = useStore.getState()
    expect(state.settings.activeProfileId).toBe(falProfile.id)
    expect(state.reusedTaskApiProfileId).toBeNull()
    expect(state.reusedTaskApiProfileMissing).toBe(false)
  })

  it('normalizes reused params to the current API profile when temporary reuse is disabled', async () => {
    useStore.setState({
      settings: normalizeSettings({
        ...useStore.getState().settings,
        reuseTaskApiProfileTemporarily: false,
      }),
    })

    await reuseConfig(
      task({
        apiProvider: 'fal',
        apiProfileId: falProfile.id,
        params: { ...DEFAULT_PARAMS, n: 8, size: 'auto', quality: 'auto' },
      }),
    )

    const state = useStore.getState()
    expect(state.settings.activeProfileId).toBe(openaiProfile.id)
    expect(state.reusedTaskApiProfileId).toBeNull()
    expect(state.params).toMatchObject({ n: 8, size: 'auto', quality: 'auto' })
  })

  it('asks whether to submit with current API profile when the reused API profile is missing', async () => {
    await reuseConfig(task({ apiProvider: 'fal', apiProfileId: 'missing-profile' }))

    const state = useStore.getState()
    expect(state.tasks).toEqual([])
    expect(state.setConfirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '找不到 API 配置',
        message: '找不到复用任务所使用的 API 配置「未知配置」，要使用当前的 API 配置「默认」提交任务吗？',
        confirmText: '使用当前配置提交',
        cancelText: '放弃提交',
      }),
    )
    expect(state.showSettings).toBe(false)
  })
})

describe('folder-scoped gallery input isolation', () => {
  it('saves and restores each project folder (incl. subfolders) own generation context', async () => {
    const { useAssetLibraryStore } = await import('./features/assetLibrary/store')
    const previousScope = useAssetLibraryStore.getState().scope
    try {
      // 在文件夹 A 中填写提示词与参数
      useAssetLibraryStore.setState({ scope: { kind: 'collection', id: 'folder-a' } })
      useStore
        .getState()
        .onAssetLibraryFolderScopeChange({ kind: 'collection', id: 'folder-a' }, { kind: 'collection', id: 'folder-a' })
      useStore.getState().setPrompt('文件夹 A 的提示词')
      useStore.getState().setParams({ n: 3 })

      // 切到文件夹 B（首次进入：以当前输入初始化，此后各自独立）
      useStore
        .getState()
        .onAssetLibraryFolderScopeChange({ kind: 'collection', id: 'folder-a' }, { kind: 'collection', id: 'folder-b' })
      expect(useStore.getState().prompt).toBe('文件夹 A 的提示词')
      useStore.getState().setPrompt('文件夹 B 的提示词')
      useStore.getState().setParams({ n: 5 })

      // 切回文件夹 A：恢复 A 的草稿（提示词 + 参数）
      useStore
        .getState()
        .onAssetLibraryFolderScopeChange({ kind: 'collection', id: 'folder-b' }, { kind: 'collection', id: 'folder-a' })
      expect(useStore.getState().prompt).toBe('文件夹 A 的提示词')
      expect(useStore.getState().params.n).toBe(3)

      // 再切到文件夹 B：恢复 B 的草稿
      useStore
        .getState()
        .onAssetLibraryFolderScopeChange({ kind: 'collection', id: 'folder-a' }, { kind: 'collection', id: 'folder-b' })
      expect(useStore.getState().prompt).toBe('文件夹 B 的提示词')
      expect(useStore.getState().params.n).toBe(5)

      // 文件夹草稿进入持久化（dataUrl 不落盘）
      const persisted = getPersistedState(useStore.getState())
      expect(persisted.folderInputDrafts).toMatchObject({
        'folder-a': { prompt: '文件夹 A 的提示词', params: expect.objectContaining({ n: 3 }) },
        'folder-b': { prompt: '文件夹 B 的提示词', params: expect.objectContaining({ n: 5 }) },
      })
    } finally {
      useAssetLibraryStore.setState({ scope: previousScope })
    }
  })

  it('does not touch folder drafts while browsing non-folder scopes', async () => {
    const { useAssetLibraryStore } = await import('./features/assetLibrary/store')
    const previousScope = useAssetLibraryStore.getState().scope
    try {
      useStore.setState({ folderInputDrafts: {} })
      useAssetLibraryStore.setState({ scope: 'all' })
      useStore.getState().setPrompt('全局草稿')
      expect(useStore.getState().folderInputDrafts).toEqual({})
    } finally {
      useAssetLibraryStore.setState({ scope: previousScope })
    }
  })

  it('does not write stale-version thumbnails to the disk cache as current-version', async () => {
    const { putImageThumbnail } = await import('./lib/db')
    const writeThumbnail = vi.fn(async () => true)
    const g = globalThis as {
      window?: { electronAPI?: { isElectron: boolean; writeThumbnail?: typeof writeThumbnail } }
    }
    // 与文件内其他用例一致的注入方式（window 被 defineProperty 成只读，不能直接赋值）
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { electronAPI: { isElectron: true, writeThumbnail } },
    })
    try {
      // 旧版本（mock 当前版本为 2）的缩略图：懒迁移绝不能把它以当前版本标签写盘
      await putImageThumbnail({
        id: 'stale-thumb',
        thumbnailDataUrl: 'data:image/webp;base64,STALE_512',
        width: 512,
        height: 512,
        thumbnailVersion: 1,
      })
      await ensureImageThumbnailCached('stale-thumb')
      await new Promise((resolve) => setTimeout(resolve, 20))
    } finally {
      delete g.window
    }
    expect(writeThumbnail).not.toHaveBeenCalled()
  })
})
