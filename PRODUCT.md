# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

DOUPAO 面向需要高频生成、筛选、复用和交付 AI 图片的创作者与内容生产人员。用户会在浏览器或 Electron 桌面端中完成图片生成、参考图编辑、Agent 多轮生成、结果筛选、后处理和批量导出。

## Product Purpose

DOUPAO 将图片生成、生成过程追溯、素材整理与后续加工放在同一个本地优先工作流中。成功意味着用户能够快速找到生成结果，理解它的来源和参数，并将其继续用于生成、后处理、合成或导出，而不需要在多个工具和目录之间人工搬运。

## Positioning

与通用图片收藏工具不同，DOUPAO 管理的不只是图片文件，也保留图片与生成任务、提示词、模型、实际参数、参考图和后续衍生结果之间的关系。素材库是生成工作流的一部分，而不是独立于生成过程之外的文件浏览器。

## Operating Context

- 用户通过画廊模式、Agent 模式、批量任务和日程任务生成图片。
- 图片、任务、缩略图、工作区和相关元数据保存在本地；Electron 桌面端将原图文件托管在应用配置的本地存储目录。
- 用户会对结果进行搜索、筛选、收藏、分组、批量处理、再次生成、后处理、合成和导出。
- 用户可能积累大量高分辨率图片，因此列表浏览不能解码全部原图，备份与导出也不能依赖一次性把所有原图装入渲染进程内存。

## Capabilities and Constraints

- 产品同时支持浏览器/PWA 和 Electron。Electron 是完整本地文件托管体验；浏览器版本继续使用 IndexedDB 保存图片内容。
- 首版素材库只管理 DOUPAO 生成的图片，不收录用户导入的图片、视频或音频。
- 原图只保存一份。任务、素材库、收藏和项目通过稳定图片 ID 引用同一个原图，不因收藏或归类而复制文件。
- 现有画廊升级为素材库，不增加一个与画廊并列且内容重复的页面。素材库内部提供“图片”和“生成批次”两个视角。
- 删除生成任务默认不删除已经进入素材库的图片；素材进入回收站后仍保留原图，清空回收站时才允许释放没有其他引用的原图。
- 素材必须能够追溯提示词、模型、生成参数、来源任务和可识别的衍生关系，即使来源任务之后被删除，也应保留必要的生成快照。
- 现有图片内容哈希、缩略图缓存、本地文件迁移、安全路径校验、备份和流式导出机制必须继续工作。

## Brand Commitments

- 产品名称为“豆泡 / DOUPAO”。
- 保留现有蓝色工具型视觉语言、明暗主题、配色皮肤和项目设计系统，不为素材库另造一套品牌视觉。
- 产品语气清晰、克制、专业但不冰冷；高频操作优先即时反馈和稳定性。

## Evidence on Hand

- 现有产品说明与功能证据位于 `README.md` 和 `CODE_WIKI.md`。
- 现有设计基线位于 `design-system/doupao/MASTER.md`、`design-system/doupao/COMPONENTS.md` 和 `src/design-system/`。
- 现有任务画廊、图片瀑布流、任务详情、收藏夹、工作区标签页和图片缓存实现位于 `src/components/TaskGrid.tsx`、`src/components/GalleryImageTile.tsx`、`src/components/DetailModal.tsx`、`src/components/FavoriteCollections.tsx`、`src/components/WorkspaceTabBar.tsx`、`src/lib/db.ts` 和 `src/store.ts`。
- Electron 原图托管、迁移、清理和流式备份设计位于 `docs/superpowers/specs/2026-06-30-storage-and-streaming-export-design.md`。
- 当前没有需要在素材库界面中展示的客户案例、商业指标或外部内容，不得虚构。

## Product Principles

1. 生成即归档：成功生成的图片自动成为可管理素材，不要求用户额外保存或收藏。
2. 一份原图，多处引用：分类和工作流关系只增加元数据，不制造重复文件。
3. 素材与任务解耦：图片可以脱离任务长期保存，但生成过程仍可追溯。
4. 管理服务于再创作：查找、整理和查看详情的最终目的，是让图片更容易复用、衍生、加工和交付。
5. 本地数据可恢复：迁移、删除、备份和导入必须有明确边界，不能静默丢失图片或生成信息。

## Accessibility & Inclusion

新素材库沿用项目 WCAG 2.2 AA 基线：所有图片网格操作必须有键盘替代方案，选择状态不能只靠颜色表达，侧栏和详情面板在窄屏下以可聚焦 Drawer 呈现，并尊重减少动态效果设置。

## Implementation Status

完整产品与技术设计见 `docs/superpowers/specs/2026-08-14-generated-asset-library-design.md`，逐任务实施计划见 `docs/superpowers/plans/2026-08-14-generated-asset-library.md`。以下为当前已落地内容：

- **数据模型与仓储（M1）**：`GeneratedAsset` / `AssetCollection` / `AssetTag` / `AssetTombstone` 领域类型；IndexedDB schema 升级至 v10（新增 `generatedAssets`、`assetCollections`、`assetTags`、`assetTombstones`）；`assetLibraryModel.ts` 归一化与工具；`assetLibraryRepository.ts` 幂等 upsert、补丁、回收站与墓碑仓储；独立素材 Zustand store（`src/features/assetLibrary/store.ts`）。
- **自动归档与历史迁移（M2）**：任务写库后经 `assetSyncQueue.ts` 串行同步；启动时 `assetReconciliation.ts` 补齐；`generatedAssetLibraryV1` 可恢复迁移（每 100 任务检查点续跑）；`legacyFavoritesToAssets` 旧收藏迁移（默认收藏映射收藏状态、非默认收藏映射项目、识别收藏影子任务）。
- **引用图与回收站（M3）**：`imageReferenceGraph.ts` 统一图片引用图；任务删除改用引用图判定，不再误删素材原图；`assetPurge.ts` 永久删除计划器（引用冲突阻断、任务输出补丁、墓碑写入单事务）；`purgeGeneratedAssets` 入口与回收站 store 接口。
- **查询与网格（M4）**：`queryAssets` 纯函数（系统/项目/标签范围、搜索归一化、筛选、五种排序、侧栏计数，含 1 万/3 万性能测试）；`AssetLibraryWorkspace` 三栏布局（`AssetLibrarySidebar`、`AssetLibraryToolbar`、`AssetGrid`）；`App.tsx` 在“图片”视角挂载素材库，`WorkspaceTabBar` 隐藏。
- **详情与整理（M5）**：`AssetDetailPanel`（大图、评分、收藏、来源快照、项目）；`AssetCardMenu` 右键菜单（收藏、评分、加入参考图、下载、回收站、永久删除）。
- **备份 v6（M6）**：导出/导入新增素材库数据（素材、项目、标签、墓碑），任务被删除后素材与生成快照仍可完整恢复。
- **响应式与可访问性（M7）**：窄屏侧栏与详情以 Drawer 呈现；网格/菜单均提供键盘操作与 ARIA 语义。
- **交互收口（M8）**：素材网格支持框选、Ctrl/⌘ 连选与 Ctrl+A 全选；底部批量栏支持批量收藏、评分、项目、下载与回收站；双击素材进入全屏大图并按当前查询结果前后切换；右键菜单补全查看大图/详情、复制图片、项目管理；永久删除前弹出引用冲突预览（阻断项展示原因并保留）；回收站支持清空；项目树支持移动层级；筛选弹层补全日期、尺寸、服务商与模型控件；存储概览按素材原图/缩略图/任务元数据/素材索引分类；帮助、README 与 Code Wiki 收口素材库文案。
- **Eagle 化视图（M9）**：全屏查看器（缩放/拖拽/键盘导航/类似图片条/信息面板 + 评分、收藏、七色标签、备注、衍生链）；网格/列表双视角（`AssetListView` 虚拟列表，工具栏 `ViewModeControl` 持久化切换）；卡片悬停快捷栏（收藏、颜色标签、参考图）与拖拽到生成输入框；颜色标签贯穿卡片角标、筛选、批量栏、详情与查看器；智能文件夹（保存/应用/删除搜索筛选快照）；拖入生成输入框的参考图流经 `asset-image:` 前缀（E4 工作流）。时间线视图与拖到项目归档列入后续候选（13.6）。
- **单一画廊模式（M10）**：取消「图片 / 生成批次」双模式——画廊永远为素材库，`galleryViewMode` 仅保留为兼容字段（无 UI 入口、不再驱动路由）；「图片」与「生成批次」为同一模式下的两种展现方式（`viewStyle` 持久化，工具栏 `GalleryStyleSwitch` 切换）；新增 `AssetBatchView` 批次视图：按「SOP 批次 → 任务 → 已删除任务」三级聚合当前查询结果（纯函数 `assetBatchGrouping.ts`），批次头展示时间、任务/素材数、状态、工作区、**词库树文件夹（promptGroup）只读展示、数据原样保留**；批次操作（批次详情、复用配置、编辑输出、重跑、删除任务）与任务导航联动（`setBatchFocusTaskId` 定位高亮）；旧画廊（TaskGrid/SearchBar/收藏夹视图）不再挂载路由，其数据全部保留，任务管理能力并入批次视图。
- **侧栏优化（M11）**：侧栏头部标题 + 条目筛选框（纯函数 `assetSidebarUtils.ts` 过滤树）；分组标题统一（轻量小字 + 计数徽章）；树节点激活态与系统导航统一（selection 变量 + 左侧强调条）；右键菜单（新建子项/重命名/移动到…/设置颜色/删除，与 hover 菜单共用 `TreeItemMenuItems`）；**拖放归档**（素材拖到项目节点即归类，`asset-image:` 负载解析 + 合并去重 + toast）；右缘拖拽调宽（208–400px 持久化）；折叠状态记忆；空状态虚线按钮。
- **词库树文件夹 → 项目文件夹整合（M12）**：词库树文件夹与「项目」树整合为一个组织体系——新增 `assetAutoArchive.ts`：批次快照 `promptGroup` 经词库树 `getFolderPath` 得到名称路径，在项目树 `ensureFolderChain` 逐级查找/创建同名文件夹（复用、幂等、只追加），批次产出素材（taskIds/batchIds 展开 + 已删任务 origins 反查）自动归档到最深层文件夹；触发 = 素材库水合后启动补齐（toast 反馈）+ 批次任务同步即时归档；「包含子文件夹」递归查询（`filters.collectionIds` 支持 SQLite `IN` 与内存查询，store 持久化默认开，工具栏 Eagle 式 toggle），母文件夹内容/侧栏递归计数包含全部后代。
- **圈选修复 + 批次密度（M13）**：图片卡片本体移除 `draggable`（卡片上按下即可框选），拖出参考图/归档改由卡片右上角 hover 拖拽手柄（`data-drag-handle`），批次视图缩略图（`data-batch-thumb`，button→div）接入 `useDragSelect` 同样支持框选；**三档密度（紧凑/标准/大图）作用于图片模式网格**，批次视图后续改为固定任务卡片形式、不随密度变化（见 M19）。
- **参数解耦（M14）**：参数按共享/专属解耦——**共享（任务/批次级）**：模型与供应商配置（apiProvider/Profile/Mode/Model）、请求参数（尺寸/质量/格式/压缩/参考模式/数量/后处理/审核/合规）、提示词与输入图；**专属（每图）**：seed（每槽位不同）、图级实际生效差异（actualParamsByImage，如并发多图中单图尺寸/seed）、API 改写提示词、文件名（批次/标签/基础名）；修复耦合缺陷：素材来源快照原先只存任务级 actualParams（图级专属在任务删除后丢失）→ 新增 `imageActualParams`/`seed` 字段随快照持久化（`buildGeneratedAssetOrigin` 写入 + 归一化透传，只加字段不破坏存量）；新增 `AssetParamBreakdown` 组件在素材详情/全屏查看器分组展示「任务级共享参数 + 本图专属参数」（实际差异以徽章标注，不依赖任务存活）。
- **移除任务导航（M15）**：「任务导航」Tab 不再独立存在——`GalleryTaskNavigator.tsx` 与其测试删除（旧双模式画廊残留：搜索/筛选依赖已下线的 SearchBar 而失效，激活高亮依赖已下线的 TaskGrid 而失效，跳转动作与素材详情「查看来源任务」重复）；词条库侧栏只留「词条 / 详情」两个 Tab；任务状态速览（完成/生成中/失败）以 `buildAssetBatchOverview` 顶部速览条并入批次视图；失效的 `galleryActiveTaskId` 状态与 TaskGrid 相关引用一并清理。
- **Eagle 式快捷键（M16）**：全局 `useAssetLibraryShortcuts`——空格/Enter 打开全屏查看器（再按空格/Esc 退出）、Esc 取消选择、Delete 移入回收站、数字键 1–5/0 评分、F 收藏、C 轮换颜色标签（`cycleColorLabel` 纯函数）、Ctrl/Cmd+F 聚焦搜索；网格卡片/列表行/批次缩略图 Enter/空格统一改为打开查看器（多选走 Ctrl/⌘ 点击或框选）；查看器内 Esc/空格 关闭、←/→ 切换、1–5/F/C 评分/收藏/颜色；HelpModal 补全快捷键表。
- **批次视图任务卡样式（M17）**：素材库「生成批次」展现方式改回**旧画廊任务卡片样式**——SOP 批次聚合为一张 `SopBatchTaskCard`、普通任务沿用原 `TaskCard`（提示词/参数/重试/复用/编辑输出/删除）、任务已删除的素材归入「任务已删除」快照卡（`OrphanBatchCard`，点击打开查看器）；整卡作为框选视觉单元（`useDragSelect` 新增 `getItemIds` 多 id 支持，命中卡片 = 选中组内全部素材，Ctrl/⌘ 点击整卡切换组选择）；批次详情、复用配置、编辑输出、重跑、删除任务、状态速览与「查看来源任务」定位高亮全部保留。
- **移除标签体系（M18）**：标签功能与自动打标签整体下线——侧栏「标签」树（`buildTagTree`/`flattenTagRows`/`TagListItem`）、详情面板标签区与建议标签（`SuggestedTags`）、全屏查看器标签行、卡片右键「添加标签」、批量栏「标签」按钮、标签筛选/搜索/计数、`createTag`/`setAssetTags` IPC 命令与本地 HTTP API 写标签端点、`migrateTagsToCollections` 旧标签迁移、`autoTag.ts` 视觉模型自动打标、Electron `suggest-tags` 全部移除；「未整理」只按项目判定（不再把旧标签计入整理状态）。**数据保留为兼容字段**：`AssetTag` 类型、`tagIds`、IndexedDB/SQLite 标签表与备份 v6/v7 的 `assetTags` 继续读写（备份可无损恢复），仅不再有界面入口。
- **分组模式两种展现形式（M19）**：分组模式（`groupBy: grouped`，按批次/任务/已删除任务聚合）提供**两种展现形式**，工具栏「任务卡片 / 图片」切换（类比图片模式的密度选择，持久化）：
  - **任务卡片（cards）**：SOP 批次组用 `SopBatchTaskCard`（封面 + SOP 名 + 进度 + 参数 + 查看批次/再次生成/删除）、任务组沿用原 `TaskCard`（缩略图 + 提示词 + 参数标签 + 重试/收藏/复用/编辑输出/删除）、任务已删除组用 `OrphanBatchCard`（封面 + 提示词摘要 + 打开查看器）；卡片网格只随视口宽度自适应列数。**交互沿用发布版**：单击任务卡打开任务详情弹窗（`DetailModal`，展示该任务全部生成图片）、单击 SOP 批次卡打开批次详情弹窗（`SopBatchDetailModal`，展示全部提示词与生成图片）、单击孤儿卡打开全屏查看器；选择走 Ctrl/⌘ 点击或框选（整卡 = 组内全部素材）。
  - **图片砖·列表行（tiles）**：组头（标题 + 状态徽章 + 复用/编辑输出/再次生成/删除 + 参数摘要）+ 组内图片砖网格（按 `viewMode` 切换图片砖 / 列表行），砖列数固定按「标准」密度布局。
    两种形式都不随「紧凑 / 标准 / 大图」密度变化（密度控件在分组模式下隐藏）；整卡/整组作为框选视觉单元（`useDragSelect` 的 getItemIds / getItemId）。

- **自包含素材库（M20）**：素材数据收敛为「库根」自包含文件夹（设计 `docs/superpowers/specs/2026-08-20-self-contained-library-design.md`，计划 `docs/superpowers/plans/2026-08-20-self-contained-library.md`）——`electron/library-paths.ts` 统一解析库根下 `db/`（SQLite 权威目录）、`cache-images/`（内容寻址原图）、`thumbs/`（磁盘缩略图缓存）、`backups/`（ZIP 默认位置）与 `library.json`；启动自动迁移旧位置数据库（`catalog-migration.ts`：`PRAGMA integrity_check` 通过才移动含 WAL，失败保留旧路径；`library.json` 记录 `catalogMigratedAt`）；修改库根 = 整库搬家（`changeLibraryRoot`：关内核 → 移动 → 重开，冲突/失败回退）；缩略图三级读取（磁盘 → IndexedDB → 生成，懒迁移双写，WebP 尺寸头解析）；ZIP 导出默认落库根 `backups/` + 设置页「打开备份目录」；数据管理区新增「导出元数据清单（JSONL）」与「运行库完整性校验」（只读：SQLite 完整性 + 原图 SHA-256 抽查 + 孤儿/缺失报告）；「复制库根文件夹 = 完整备份」心智写入设置页与 README。

实施约束：首版只管理生成图片；原图单份、内容哈希作素材 ID；V1 不迁移/重命名现有 cache-images；素材管理界面在 M3 引用规则落地后才开放（App 层“图片”视角已启用，回收站与永久删除依赖引用图保护）。
