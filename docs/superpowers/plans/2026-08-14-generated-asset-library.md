# DOUPAO 生成素材库实施计划

> 对应设计：`docs/superpowers/specs/2026-08-14-generated-asset-library-design.md`  
> 实施方法：测试先行；每个里程碑结束时应用都必须可构建、可启动、可读取旧数据。  
> 技术栈：React 19、TypeScript、Zustand、IndexedDB、Electron、Vitest

## 0. 实施约束

- 不物理迁移或重命名 `cache-images`。
- 不删除现有任务、图片、收藏夹或收藏影子任务。
- 不把生成素材元数据继续塞进 `TaskRecord`。
- 不在 UI 组件中直接操作 IndexedDB。
- 不把素材状态全部塞进现有超大的 `src/store.ts`；新建独立素材 store 和仓储。
- 不改变 `AppMode = 'gallery'` 的内部值，只改用户可见名称。
- 不为 V2 的 AI 标签、相似搜索和云同步预设抽象。
- 任一迁移失败都必须保留“生成批次”可用。

## 1. 里程碑与交付顺序

```text
M1 数据模型与仓储
  → M2 自动归档与历史迁移
    → M3 生命周期、回收站与引用图
      → M4 查询、导航和图片网格
        → M5 详情、整理和再创作
          → M6 备份、导入与文件系统增强
            → M7 响应式、性能、可访问性与发布收口
```

不能跳过 M3 直接发布图片管理 UI；否则删除任务仍可能清理掉素材原图。

## 2. M1：数据模型、仓储与独立状态

### Task 1.1：定义领域类型

**修改：**

- `src/types.ts`

**新增：**

- `GeneratedAsset`
- `GeneratedAssetOrigin`
- `AssetCollection`
- `AssetTag`
- `AssetTombstone`
- `AssetStatus`、`AssetRating`
- `ExportData` 对应可选字段

**测试：**

- `src/lib/assetLibraryModel.test.ts`

**步骤：**

1. 先写规范化测试：ID 数组去重、评分范围、回收站状态、来源 key 去重、稳定排序。
2. 创建 `src/lib/assetLibraryModel.ts`，实现最小纯函数：

```ts
normalizeAsset(input)
normalizeAssetCollection(input)
normalizeAssetTag(input)
mergeAssetOrigins(current, incoming)
mergeGeneratedAssets(current, incoming)
```

3. 测试同一 `imageId` 多来源合并不会覆盖用户收藏、评分、项目和标签。
4. 测试旧或损坏数据降级到安全默认值。

**验证：**

```powershell
npx vitest run src/lib/assetLibraryModel.test.ts
```

### Task 1.2：升级 IndexedDB schema

**修改：**

- `src/lib/db.ts`
- `src/lib/db.test.ts`

**新增 store：**

- `generatedAssets`
- `assetCollections`
- `assetTags`
- `assetTombstones`

将 `DB_VERSION` 从 9 升至 10，建立设计文档中的索引。

**新增仓储函数：**

```ts
getGeneratedAsset(id)
getAllGeneratedAssets()
batchGetGeneratedAssets(ids)
putGeneratedAsset(asset)
batchPutGeneratedAssets(assets)
deleteGeneratedAsset(id)
getAllAssetCollections()
putAssetCollection(collection)
deleteAssetCollection(id)
getAllAssetTags()
putAssetTag(tag)
deleteAssetTag(id)
getAssetTombstone(id)
putAssetTombstone(tombstone)
deleteAssetTombstone(id)
commitImportedAssetRecords(...)
```

**测试必须覆盖：**

- 从 v9 升级创建 store 和索引。
- 多 store 批量提交原子性。
- 批量写入不会为每条数据打开独立数据库连接。
- 删除素材记录不隐式删除 `StoredImage`。

### Task 1.3：创建素材仓储 facade

**新增：**

- `src/lib/assetLibraryRepository.ts`
- `src/lib/assetLibraryRepository.test.ts`

职责：

- 组合 db 原语。
- 构建来源快照。
- 幂等 upsert。
- 项目、标签和回收站的批量 mutation。
- 处理 tombstone。

建议接口：

```ts
export interface AssetLibraryRepository {
  hydrate(): Promise<AssetLibrarySnapshot>
  upsertFromTask(task: TaskRecord, context: AssetTaskContext): Promise<GeneratedAsset[]>
  patchAssets(ids: string[], patch: AssetPatch): Promise<GeneratedAsset[]>
  moveToTrash(ids: string[], now?: number): Promise<GeneratedAsset[]>
  restore(ids: string[], now?: number): Promise<GeneratedAsset[]>
}
```

不得让 repository 依赖 React 或 Zustand。

### Task 1.4：创建独立 Zustand 素材 store

**新增：**

- `src/features/assetLibrary/store.ts`
- `src/features/assetLibrary/store.test.ts`

**状态：**

```ts
assetsById: Record<string, GeneratedAsset>
assetOrder: string[]
collections: AssetCollection[]
tags: AssetTag[]
hydrationStatus: 'idle' | 'loading' | 'ready' | 'error'
migrationStatus
selectedAssetIds: string[]
activeAssetId: string | null
scope
query
filters
sort
sidebarOpen / detailOpen
```

**规则：**

- Store 只保留元数据和视图状态。
- 原图与缩略图继续由现有缓存读取。
- 业务 mutation 调 repository，成功后更新 store；失败显示统一错误。
- 不使用 `persist` 保存全部资产；资产来自 IndexedDB 水合。只持久化小型 UI 偏好。

**M1 完成标准：**

- 新 schema 和 repository 全部测试通过。
- 旧应用 UI 没有行为变化。
- `npm run build` 通过。

## 3. M2：自动归档、来源快照与历史迁移

### Task 2.1：建立任务 → 素材纯转换

**新增：**

- `src/lib/generatedAssetOrigin.ts`
- `src/lib/generatedAssetOrigin.test.ts`

**实现：**

```ts
getTaskSourceMode(task)
getTaskOutputSlot(task, imageId, fallbackIndex)
buildGeneratedAssetOrigin(task, imageId, context)
buildGeneratedAssetsFromTask(task, context, existingById, tombstones)
```

**注意：**

- 优先使用 `generationSlots[].outputImageId` 确定稳定槽位。
- 旧任务使用当时 `outputImages` 下标回填。
- `filenameLabel` 来自当前工作区名称或任务保存的输出子目录。
- 来源快照不得写入 API Key 和 `rawResponsePayload`。
- 输入图若已存在素材记录，形成 `parentAssetIds`。

### Task 2.2：素材同步队列

**新增：**

- `src/lib/assetSyncQueue.ts`
- `src/lib/assetSyncQueue.test.ts`

**修改：**

- `src/store.ts`

将 `store.ts` 中的 `putTask()` 包装为：

```ts
await dbPutTask(getPersistableTask(task))
enqueueAssetSync(task.id)
```

队列要求：

- 相同 `taskId` 合并。
- 串行执行，避免不同完成回调争写同一素材。
- 读取最新任务而非捕获旧闭包。
- 页面关闭前不要求阻塞，但启动 reconcile 必须补齐。
- 单个任务同步失败记录错误并允许重试，不影响任务完成。

**测试：**

- 单图生成创建一条素材。
- 多图逐批追加最终创建全部素材。
- 同一任务连续更新只落最新来源快照。
- Agent 和恢复任务也会归档。
- 相同内容只新增来源。

### Task 2.3：启动 reconcile

**新增：**

- `src/lib/assetReconciliation.ts`
- `src/lib/assetReconciliation.test.ts`

**修改：**

- `src/store.ts` 初始化流程

在任务恢复、工作区归属恢复、文件迁移之后执行：

```ts
reconcileGeneratedAssets({ tasks, workspaceTabs, repository, batchSize: 100 })
```

只读取任务元数据和图片/缩略图元数据，不读取图片字节。

### Task 2.4：可恢复历史迁移

**新增：**

- `src/lib/migrations/generatedAssetLibraryV1.ts`
- `src/lib/migrations/generatedAssetLibraryV1.test.ts`

复用 `runMigration()` 和 migration journal：

- ID：`generated-asset-library-v1`。
- 游标：最后处理的 `createdAt + taskId`。
- 批次：100 个任务。
- 每批 checkpoint。
- 二次运行不重复来源。
- 墓碑阻止旧任务复活素材。

### Task 2.5：旧收藏迁移

**新增：**

- `src/lib/migrations/legacyFavoritesToAssets.ts`
- `src/lib/migrations/legacyFavoritesToAssets.test.ts`

**测试：**

- 默认收藏夹仅映射收藏状态。
- 非默认收藏夹映射项目。
- 同名项目复用。
- 识别工作区外收藏影子任务，不生成伪来源。
- 多张图的收藏任务全部转为图片级收藏。
- 重复执行结果不变。

**M2 完成标准：**

- 新生成、Agent、SOP、多图并发和恢复路径全部自动归档。
- 历史任务可以分批回填且重启续跑。
- 图片视角暂未上线也不会影响旧 UI。

## 4. M3：统一引用图、任务删除与回收站

### Task 3.1：统一图片引用图

**新增：**

- `src/lib/imageReferenceGraph.ts`
- `src/lib/imageReferenceGraph.test.ts`

**修改：**

- `src/store.ts`
- 必要时各 feature 提供轻量引用适配器

将以下现有逻辑统一到同一引用图：

- `isImageReferencedByState`
- `deleteImageIfUnreferenced`
- `deleteUnreferencedImageIds`
- `getAllOrphanedImageIds`
- `cleanupAllOrphanedImages`
- 备份引用收集

引用类型使用明确枚举：

```ts
'asset-original'
'asset-origin-input'
'task-output'
'task-input'
'mask'
'gallery-draft'
'agent-draft'
'agent-conversation'
'sop-reference'
'sop-cover'
'strategy-reference'
'strategy-cover'
'postprocess'
'composite'
'ordering'
```

每个引用带用户可读 label 和可选 navigate target。

### Task 3.2：修改任务删除语义

**修改：**

- `src/store.ts`
- `src/components/TaskCard.tsx`
- `src/components/DetailModal.tsx`
- `src/components/SopBatchTaskCard.tsx`
- 相关测试

`removeTask` / `removeMultipleTasks`：

- 删除任务后构建引用图。
- 有效或回收站素材始终拥有原图引用。
- 只清理真正无引用的输入图、遮罩图和流式诊断图。
- Toast/确认文案说明图片素材会保留。

**回归测试：**

- 删除普通任务保留输出素材和原图。
- 删除 Agent 任务保留素材，同时清理会话中的任务指针。
- 不是素材的上传输入在无其他引用时仍可清理。
- 批量删除不会逐张重复扫描整个数据库。

### Task 3.3：软删除与恢复

**新增：**

- `src/lib/assetTrash.ts`
- `src/lib/assetTrash.test.ts`

实现批量移到回收站、撤销和恢复。数据库事务成功后再更新 UI。

### Task 3.4：永久删除计划器

**新增：**

- `src/lib/assetPurge.ts`
- `src/lib/assetPurge.test.ts`

输出显式计划：

```ts
type AssetPurgePlan = {
  allowedAssetIds: string[]
  blocked: Array<{ assetId: string; references: ImageReference[] }>
  tasksToPatch: TaskRecord[]
  imageIdsToDelete: string[]
  tombstones: AssetTombstone[]
}
```

执行顺序：

1. 重新读取最新引用图。
2. 若存在阻断项，不执行该项。
3. 单事务提交任务输出清理、素材删除、tombstone。
4. 事务完成后调用 `deleteImage()` 删除图片记录和文件。
5. 文件失败写入清理重试记录或复用启动 reconciliation。

任务 patch 必须同步清理：

- `outputImages`
- `generationSlots[].outputImageId`
- `actualParamsByImage`
- `revisedPromptByImage`
- `localSavedOutputImagePaths`
- 与被删除输出位置一一对应的 `rawImageUrls`；无法可靠建立位置映射的旧任务保留原值，但 UI 不再把它当作可用原图

任务需要新增一个轻量的 `purgedOutputSlots?: number[]` 历史标记，保存被永久删除的原始输出槽位。这样生成批次仍能显示“该位置的结果已永久删除”，同时不再把已清理的 `imageId` 视为活跃引用。迁移和普通任务不填写该字段。

### Task 3.5：回收站 UI 前置接口测试

先不做完整页面，建立 hook/action：

```ts
trashSelectedAssets()
restoreSelectedAssets()
previewPurgeSelectedAssets()
purgeSelectedAssets()
```

**M3 完成标准：**

- 任务与素材生命周期真正解耦。
- 清理、备份和永久删除共享同一引用定义。
- 永久删除不会破坏仍被使用的输入图、SOP 或策略。

## 5. M4：查询、导航与图片网格

### Task 4.1：素材查询纯函数

**新增：**

- `src/features/assetLibrary/query.ts`
- `src/features/assetLibrary/query.test.ts`

实现：

```ts
queryAssets(snapshot, queryState): AssetQueryResult
```

覆盖：

- 系统范围。
- 项目和标签。
- 搜索归一化。
- 日期、模型、服务商、方向、尺寸、评分、收藏筛选。
- 五种排序。
- 回收站与普通视图隔离。
- 数量统计与侧栏计数。

增加 10,000 和 30,000 条合成元数据性能测试，阈值用相对回归保护，避免 CI 硬件偶发失败。

### Task 4.2：改造顶级入口和视角切换

**修改：**

- `src/components/Header.tsx`
- `src/components/TaskGrid.tsx`
- `src/lib/galleryPreferences.ts`
- `src/App.tsx`
- `src/components/HelpModal.tsx`
- 用户可见“画廊”文案关联测试

调整：

- 顶栏显示“素材库”。
- 切换文案“图片 / 生成批次”。
- `TaskGrid` 只负责生成批次。
- `App.tsx` 在 `'images'` 时挂载 `AssetLibraryWorkspace`，在 `'tasks'` 时挂载现有 `SearchBar + TaskGrid`。
- 旧偏好兼容。

### Task 4.3：素材侧栏

**新增：**

- `src/features/assetLibrary/AssetLibrarySidebar.tsx`
- `src/features/assetLibrary/AssetCollectionTree.tsx`
- `src/features/assetLibrary/AssetTagList.tsx`
- 对应测试

复用：`NavList`、`SearchField`、`ListRow`、`IconButton`、`Drawer`。

功能：

- 系统范围和计数。
- 项目树创建、重命名、移动、删除。
- 标签筛选和管理入口。
- 停靠/浮动/窄屏 Drawer 行为沿用现有侧栏规范。

图片视角隐藏 `WorkspaceTabBar`；生成批次视角保持原样。

### Task 4.4：素材工具栏

**新增：**

- `src/features/assetLibrary/AssetLibraryToolbar.tsx`
- `src/features/assetLibrary/AssetFilterPopover.tsx`
- `src/features/assetLibrary/AssetSortMenu.tsx`
- 对应测试

复用 `SearchField`、`Toolbar`、`Popover`、`Menu`、`Badge`、`SegmentedControl`。

### Task 4.5：素材虚拟瀑布流

**新增：**

- `src/features/assetLibrary/AssetGrid.tsx`
- `src/features/assetLibrary/AssetTile.tsx`
- `src/features/assetLibrary/AssetGrid.test.tsx`
- `src/features/assetLibrary/AssetTile.test.tsx`

**复用：**

- `galleryMasonryLayout.ts`
- `galleryImageGrid.ts`
- 缩略图订阅接口
- 框选核心逻辑，可抽取通用 hook

**关键改动：**

- 卡片单位为 `GeneratedAsset`。
- 选择单位为 `assetId`。
- 只调用 `ensureImageThumbnailCached()`，不调用 `ensureImageCached()`。
- 完整原图只在打开详情/大图时加载。
- 焦点与虚拟化共存。

### Task 4.6：生成目标标签页入口

**修改：**

- `src/components/InputBar.tsx`
- 相关测试

图片视角左栏不再是工作区标签，因此输入栏必须始终可见：

```text
生成到：当前标签页 ▾
```

切换仅改变 `activeWorkspaceTabId`，不改变当前素材范围。

**M4 完成标准：**

- 用户能在新素材库浏览、搜索、筛选和选择图片。
- 生成批次功能无回归。
- 网格不预加载完整原图。

## 6. M5：详情、整理、右键菜单与再创作

### Task 5.1：右侧素材详情面板

**新增：**

- `src/features/assetLibrary/AssetDetailsPanel.tsx`
- `src/features/assetLibrary/AssetOriginSection.tsx`
- `src/features/assetLibrary/AssetReferenceStrip.tsx`
- `src/features/assetLibrary/AssetMultiSelectionPanel.tsx`
- 对应测试

**修改：**

- `src/components/WordLibrarySidebar.tsx` 或抽取统一的右侧停靠壳

建议把停靠、拖动、尺寸、移动端 Drawer 抽取为已有侧栏的共享容器；不要复制第三份完整侧栏实现。

单选详情复用 `Panel`、`KeyValue`、`Badge`、`Disclosure`、`Button`。来源多于一个时使用 `Tabs` 或来源列表，不堆叠多张大卡片。

### Task 5.2：素材组织操作

**新增：**

- `src/features/assetLibrary/AssetCollectionPicker.tsx`
- `src/features/assetLibrary/AssetTagPicker.tsx`
- `src/features/assetLibrary/AssetRating.tsx`
- `src/features/assetLibrary/AssetBatchBar.tsx`
- 对应测试

功能：收藏、评分、项目、标签、多选三态编辑。

旧 `FavoriteCollections` 组件只留给兼容代码，不再作为新素材视角主入口。新收藏不得复制任务。

### Task 5.3：图片级右键菜单

**修改：**

- `src/components/ImageContextMenu.tsx`

不要继续依赖全局 `IMG` 推断全部上下文。`AssetTile` 设置：

```html
data-image-id
data-asset-id
data-image-context="asset-library"
```

素材菜单：查看、复制、下载、收藏、评分、项目、标签、加入参考图、后期处理、回收站。

生成批次图片保留原菜单行为。

### Task 5.4：复用到生成器

**新增：**

- `src/features/assetLibrary/reuseAsset.ts`
- `src/features/assetLibrary/reuseAsset.test.ts`

从 `primaryOrigin` 恢复：

- prompt。
- requested params。
- 可用输入图片。
- mask 信息。
- API profile 临时复用提示。

缺失输入图返回结构化结果：

```ts
{ restoredInputIds, missingInputIds, profileMissing }
```

UI 显示具体提示，不自动提交。

### Task 5.5：来源定位与大图

**修改：**

- `src/components/Lightbox.tsx`
- `src/components/TaskGrid.tsx`
- `src/store.ts` 导航 action

支持：

- 按当前素材查询结果前后浏览。
- “查看来源任务”切换到生成批次并定位。
- 来源不存在时保留快照说明。

### Task 5.6：送入后期处理

**修改：**

- `src/features/composite/CompositeWorkspace.tsx` 或现有后期处理入口适配器
- `src/components/PostprocessV2Workspace.tsx`（若仍作为入口）

新增显式 action：

```ts
openPostprocessWithImageIds(assetIds)
```

不要通过“最近画廊图片”隐式猜测用户选择。

**M5 完成标准：**

- 素材能完成查找 → 整理 → 查看来源 → 再利用闭环。
- 旧任务收藏功能不再驱动新 UI。

## 7. M6：备份、导入、Electron 文件操作与数据管理

### Task 6.1：备份 manifest v6

**修改：**

- `src/types.ts`
- `src/store.ts`
- `src/lib/dataExport.ts`
- `src/lib/backupImport.ts`
- `src/lib/backupManifest.ts`
- 对应测试

修改所有 `version: 5` 写入点为统一常量，避免三个分支再次漂移。

新增：

- 素材、项目、标签、墓碑导出。
- 素材原图和隐藏依赖进入图片引用集合。
- v6 验证。
- v1–v5 继续兼容。

### Task 6.2：素材导入合并

**修改：**

- `src/store.ts` 的 `importData`
- `src/lib/db.ts` 的导入事务

**新增：**

- `src/lib/assetBackupMerge.ts`
- `src/lib/assetBackupMerge.test.ts`

实现设计中的项目、标签、素材和墓碑合并规则。图片文件与素材元数据必须作为一个导入计划验证完成后再提交。

### Task 6.3：备份 UI 选择

**修改：**

- `src/components/SettingsModal.tsx`

数据备份/恢复区域加入“素材库”，解释依赖图片。设置中的存储文案把 `cache-images` 表达为“素材原图”，但不修改真实路径。

### Task 6.4：在文件夹中显示

**修改：**

- `src/lib/localSave.ts`
- `src/features/assetLibrary/AssetDetailsPanel.tsx`

直接复用已有 `openInExplorer(localPath)`；按钮只在 Electron 且 `localPath` 存在时出现。路径不能来自 UI 自由输入。

### Task 6.5：存储统计和残留清理

**修改：**

- `src/lib/storageStats.ts`
- `src/lib/storageCleanup.ts`
- `src/components/SettingsModal.tsx`

统计分类改为：素材原图、缩略图、任务/元数据、备份、残留文件。清理预览必须基于统一引用图，不能把回收站素材算作孤立文件。

**M6 完成标准：**

- 删除任务但保留的素材可完整备份恢复。
- 旧备份正常导入并回填素材。
- Electron 文件操作不扩大现有路径权限。

## 8. M7：响应式、性能、可访问性与发布收口

### Task 7.1：响应式与触控

**修改：**

- `src/index.css`
- 新素材库组件

验证四个布局档位和粗指针。移动端批量选择、Drawer、详情、大图、生成输入切换不能互相遮挡。

### Task 7.2：可访问性测试

**新增/修改：**

- 素材网格、侧栏、详情、选择器测试

验证：

- 键盘选择、打开、关闭和全选。
- 焦点归还。
- 选择和回收站不只靠颜色。
- Drawer/Dialog 语义。
- 44px 粗指针目标。
- 减少动态效果。

### Task 7.3：性能基准与内存检查

**新增：**

- `src/features/assetLibrary/query.performance.test.ts`
- `src/features/assetLibrary/AssetGrid.performance.test.tsx`

人工检查：

- 10,000 条素材滚动。
- Network/Memory 中不可见卡片不读取原图。
- 打开详情只读取当前原图。
- 连续切换 100 张图对象 URL 能正确释放或由 LRU 控制。

### Task 7.4：设计系统登记

**修改：**

- `src/design-system/catalog.ts`
- `design-system/doupao/COMPONENTS.md`（只有责任边界发生变化时）

新增业务组件登记，复用共享组件，不新增只服务单页的伪通用组件。

### Task 7.5：文案与帮助

**修改：**

- `src/components/HelpModal.tsx`
- `README.md`
- `CODE_WIKI.md`

统一：

- 画廊 → 素材库（用户可见）。
- 任务视角 → 生成批次。
- 删除任务保留素材。
- 删除素材进入回收站。
- 清空回收站才释放原图。

### Task 7.6：完整验证

运行：

```powershell
npm test
npm run build
```

然后启动 Electron 和浏览器 mock API，按下列矩阵人工验证：

| 场景 | Electron | 浏览器 |
| --- | --- | --- |
| 新生成自动归档 | ✓ | ✓ |
| 旧数据迁移 | ✓ | ✓ |
| 删除任务保留素材 | ✓ | ✓ |
| 回收站恢复/永久删除 | ✓ | ✓ |
| 项目、标签、收藏、评分 | ✓ | ✓ |
| 复用为参考图 | ✓ | ✓ |
| 后期处理 | ✓ | ✓ |
| 备份/导入 | 流式 ZIP | 浏览器 ZIP |
| 文件定位 | ✓ | 不显示 |
| 10,000 条网格 | ✓ | ✓ |

最后运行设计机械检查：

```powershell
node C:\Users\tt\.codex\skills\impeccable\scripts\detect.mjs --json src/App.tsx src/index.css src/features/assetLibrary src/components/Header.tsx src/components/InputBar.tsx src/components/ImageContextMenu.tsx
```

## 9. 建议测试文件清单

```text
src/lib/assetLibraryModel.test.ts
src/lib/assetLibraryRepository.test.ts
src/lib/generatedAssetOrigin.test.ts
src/lib/assetSyncQueue.test.ts
src/lib/assetReconciliation.test.ts
src/lib/imageReferenceGraph.test.ts
src/lib/assetTrash.test.ts
src/lib/assetPurge.test.ts
src/lib/assetBackupMerge.test.ts
src/lib/migrations/generatedAssetLibraryV1.test.ts
src/lib/migrations/legacyFavoritesToAssets.test.ts
src/features/assetLibrary/store.test.ts
src/features/assetLibrary/query.test.ts
src/features/assetLibrary/query.performance.test.ts
src/features/assetLibrary/AssetGrid.test.tsx
src/features/assetLibrary/AssetTile.test.tsx
src/features/assetLibrary/AssetLibrarySidebar.test.tsx
src/features/assetLibrary/AssetLibraryToolbar.test.tsx
src/features/assetLibrary/AssetDetailsPanel.test.tsx
src/features/assetLibrary/AssetBatchBar.test.tsx
src/features/assetLibrary/reuseAsset.test.ts
```

同时扩展现有：

```text
src/lib/db.test.ts
src/lib/dataExport.test.ts
src/lib/backupImport.test.ts
src/lib/storageCleanup.test.ts
src/store.test.ts
electron/ipc-handlers.test.ts
src/components/TaskGrid.test.tsx（如存在）
src/components/Lightbox 相关测试
src/components/ImageContextMenu 相关测试
```

## 10. 文件变更总览

### 新增目录

```text
src/features/assetLibrary/
  AssetLibraryWorkspace.tsx
  AssetLibrarySidebar.tsx
  AssetCollectionTree.tsx
  AssetTagList.tsx
  AssetLibraryToolbar.tsx
  AssetFilterPopover.tsx
  AssetSortMenu.tsx
  AssetGrid.tsx
  AssetTile.tsx
  AssetDetailsPanel.tsx
  AssetOriginSection.tsx
  AssetReferenceStrip.tsx
  AssetMultiSelectionPanel.tsx
  AssetCollectionPicker.tsx
  AssetTagPicker.tsx
  AssetRating.tsx
  AssetBatchBar.tsx
  query.ts
  reuseAsset.ts
  store.ts
```

### 新增领域模块

```text
src/lib/assetLibraryModel.ts
src/lib/assetLibraryRepository.ts
src/lib/generatedAssetOrigin.ts
src/lib/assetSyncQueue.ts
src/lib/assetReconciliation.ts
src/lib/imageReferenceGraph.ts
src/lib/assetTrash.ts
src/lib/assetPurge.ts
src/lib/assetBackupMerge.ts
src/lib/migrations/generatedAssetLibraryV1.ts
src/lib/migrations/legacyFavoritesToAssets.ts
```

### 主要修改文件

```text
src/types.ts
src/lib/db.ts
src/store.ts
src/App.tsx
src/index.css
src/components/Header.tsx
src/components/SearchBar.tsx
src/components/TaskGrid.tsx
src/components/WorkspaceTabBar.tsx
src/components/WordLibrarySidebar.tsx
src/components/InputBar.tsx
src/components/ImageContextMenu.tsx
src/components/Lightbox.tsx
src/components/DetailModal.tsx
src/components/SettingsModal.tsx
src/lib/dataExport.ts
src/lib/backupImport.ts
src/lib/storageStats.ts
src/lib/storageCleanup.ts
src/design-system/catalog.ts
README.md
CODE_WIKI.md
```

## 11. 估算与切片建议

该功能不是一个安全的单 PR 小改动。建议按 7 个可独立验收的里程碑提交，每个里程碑包含实现、测试和迁移兼容：

| 里程碑 | 相对工作量 | 主要风险 |
| --- | ---: | --- |
| M1 数据模型与仓储 | 中 | IndexedDB schema、状态边界 |
| M2 自动归档与迁移 | 高 | 多生成路径、旧收藏识别 |
| M3 生命周期与回收站 | 高 | 误删、跨 feature 引用 |
| M4 查询与网格 | 高 | 虚拟化、选择语义、现有布局 |
| M5 详情与再创作 | 中高 | 复杂交互、来源缺失 |
| M6 备份与导入 | 高 | 跨版本恢复、内存与事务 |
| M7 收口 | 中 | 响应式、性能、文档回归 |

若需要更快首发，可以把“项目层级”“标签颜色”“多来源主来源手动切换”延后，但不能删减 M1–M3 的数据与生命周期基础，也不能删减备份恢复。

## 12. 最终 Definition of Done

- 设计文档中的 V1 验收标准全部通过。
- 旧用户升级无需移动文件即可看到历史素材。
- 删除任务不会丢素材。
- 永久删除不会破坏仍在使用的图片引用。
- 来源任务不存在时仍能查看关键生成快照并备份恢复。
- 新 UI 在 Electron、浏览器、桌面、移动端和键盘环境可用。
- 10,000 条素材下不加载全部原图且滚动可用。
- 所有测试和生产构建通过。
- 数据模型、备份版本、迁移 ID 和删除语义已写入维护文档。
