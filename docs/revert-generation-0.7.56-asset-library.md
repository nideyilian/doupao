# 生图链路回归 0.7.56 心智：与当前素材库「图片」视图结合的方案

> 文档状态：✅ 已实施并通过验证（2026-08-20，0.7.58 基线）
> 版本基线：当前 0.7.58（2026-08-20 构建） vs 0.7.56（2026-08-12 构建）
> 对比证据来源：`release/DOUPAO V2 Setup 0.7.56.exe` 解包后的生产 bundle（`tmp-extract-0.7.56/asar-out/dist/assets/index-B2T28Btx.js`）与当前 `src/` 源码。

## 1. 背景与目标

用户反馈：当前生图"有问题、太混乱"，希望"回归 0.7.56 的生图"，同时与当前素材库「图片」视图结合。

经两轮确认的产品口径：

| 项 | 用户选择 |
| --- | --- |
| 问题定位 | 入口太乱，找不到重点；结果不直观 |
| 「图片模式」指什么 | 素材库的「图片」视图（项目树 + 图片网格浏览） |
| 核心结构 | **生图由任务卡承载**：任务卡模式与大图（图片）模式只是同一批生成结果的两种展示形式；数据保持现状（素材照常生成、自动归档进项目文件夹、词库树镜像保留） |
| 默认视图 | 素材库默认「任务卡片」视图（生成后新任务卡置顶、带进度） |
| 视图预设 | 只留「任务卡片 + 图片」两个（移除「分组·图片砖」预设入口） |

## 2. 两版差异对比（代码级证据）

### 2.1 输入区（生成入口）——两版几乎一致

从 0.7.56 生产 bundle 与 0.7.58 当前 DOM 实测（无头 Chrome dump `http://localhost:41731`）对比：

| 控件 | 0.7.56 | 0.7.58 |
| --- | :-: | :-: |
| 模型切换（生图模型 + Agent 文本模型） | ✔ | ✔ |
| SOP 胶囊（未启用 / 已启用 + 名称） | ✔ | ✔ |
| 提示词管理胶囊（提示词 N） | ✔ | ✔ |
| 尺寸 / 质量 / 格式 / 审核规则 / 数量 | ✔ | ✔ |
| 输出（自定义目录） | ✔ | ✔ |
| 参考方式（逐张参考 / 同时参考全部） | ✔ | ✔ |
| 词库变量（`{{var}}` 转变量） | ✔ | ✔ |
| 合规负向规则（adNegativeRuleId） | ✔ | ✔ |
| 上传 / 拍照 / 文件夹模式 | ✔ | ✔ |
| 遮罩编辑 | ✔ | ✔ |
| **从素材库选择参考图** | ✘ | ✔（0.7.58 新增，因为素材库 0.7.57 才诞生） |
| **归档到「项目文件夹」胶囊** | ✘ | ✔（0.7.58 新增） |

结论：**"入口"的控件构成没有本质变化**，0.7.56 就已经是这些控件。

### 2.2 生成链路行为默认值——两版一致

- `n = 1`（DEFAULT_PARAMS.n）
- `size = 'auto'`、`quality = 'auto'`、`output_format = 'png'`
- `reference_mode = 'cycle'`（逐张参考，`paramCompatibility.ts` 归一化：非 `'all'` 一律 `'cycle'`）
- 审核规则默认「通用严格」
- 提交校验链（API 配置 → 提示词非空 → 遮罩覆盖确认 → 输入图持久化）一致
- Agent 混合模式批量"已扣费但显示失败"缺陷修复（`docs/agent-hybrid-batch-image-failure-fix.md`）已在 0.7.58 落地（`src/store.ts` 无条件提交 `batchResult.image`）

结论：**提交链路本身没有回归差异**。

### 2.3 结果层——唯一重大变化

| | 0.7.56 画廊 | 0.7.58 素材库 |
| --- | --- | --- |
| 结果载体 | 任务卡片瀑布流 / 图片平铺 | 素材（GeneratedAsset）+ 任务关联 |
| 生成后可见性 | **天然全量**：新任务卡片置顶，永远可见 | scope 体系：全部 / 最近生成 / 收藏 / 未整理 / 回收站 / 项目文件夹；另有搜索与筛选条件 |
| 新图落点 | 任务卡 → 图片平铺（无额外概念） | 素材自动同步（`assetSyncQueue`）+ **自动归档**（词库树镜像 M12 + 提交时文件夹捕获） |
| 生成中反馈 | 任务卡自带进度 | `PendingTaskStrip` 生成中占位条（已实现） |
| 默认排序 | 新任务置顶 | `sortKey: 'updatedAt'` desc（新图置顶） |

结论：**"结果直观"丢失的根源在结果层**——当用户停留在非全量视图（收藏 / 回收站 / 具体项目文件夹 / 搜索 / 筛选）时，刚生成的图不在当前视图内，需要用户自己知道去「全部 / 最近生成」找；0.7.56 不存在这个问题（画廊永远全量、新任务置顶）。

## 3. 实施清单

### 3.1 生完即见（结果直观）——已收敛为"不跳转" ✅

- 初版实现了"提交后若当前视图挡住新产出则自动切「全部」"（`revealNewestResults`）。
- **按用户最新要求（任务卡固定在对应文件夹、不需要跳转到其他地方）已移除该自动跳转**：提交后不切换作用域、不弹提示，任务卡留在当前视图/对应文件夹持续显示。`revealNewestResults` 动作、InputBar 钩子及其测试一并删除。

### 3.2 默认视图 = 任务卡片（0.7.56 方案）✅

- 生图由任务卡承载：素材库初始默认 `groupBy: 'grouped'` + `groupedViewStyle: 'cards'`（`src/features/assetLibrary/store.ts`）。
- 持久化迁移 v5 → v6：一次性把旧状态（图片 `groupBy: none`、分组·图片砖 `groupedViewStyle: tiles`）归一为「任务卡片」；此后用户手动切「图片」按正常持久化保存。
- **任务卡固定在对应文件夹、成功/失败都保留**：分组视图的 `includeTaskless` 机制把"没有素材产出"的活跃任务（生成中 / 失败 / 已停止）也补成任务卡；项目文件夹作用域按 `task.defaultCollectionId`（提交时所在文件夹）过滤，因此在该文件夹内生图的任务卡（无论成功失败）都会留在该文件夹内显示，不跳转、不丢失（`src/lib/assetBatchGrouping.ts` + `src/features/assetLibrary/AssetBatchView.tsx`）。

### 3.3 视图预设只留「任务卡片 + 图片」✅

- 工具栏 `ViewPresetControl` 从三选一（图片 / 分组 / 任务卡片）收窄为二选一（图片 / 任务卡片），对应 0.7.56 的「大图 / 任务卡片」两种显示方式（`src/features/assetLibrary/AssetLibraryToolbar.tsx`）。
- 「分组·图片砖」不再有 UI 入口；内部渲染机制保留（旧数据已由迁移归一，测试仍覆盖 tiles 分支）。
- 任务卡片视图下布局控件（紧凑/标准/大图/列表）保持隐藏（卡片不随密度变化）。
- 帮助文档同步更新（`src/components/HelpModal.tsx`）。

### 3.4 行为默认值锁定（行为符合直觉）✅

- 新增回归测试锁定 `n=1`、`size=auto`、`quality=auto`、`reference_mode=cycle`、`moderation=auto`、`output_format=png`、审核规则默认「通用严格」（`src/lib/paramCompatibility.test.ts`）。

### 3.5 保留（按用户确认）

- 文件夹自动归档：在项目文件夹视图内生图，产出自动归入该文件夹（`submitTaskWithData` 的 `defaultCollectionId` 文件夹捕获）。**输入区的「归档到『xxx』」胶囊显示已按用户要求移除**（归档行为不变，只是不再常驻提示）。
- 素材、SQLite/IndexedDB 数据、词库树镜像、回收站/引用图保护等一律不动。
- 任务完成系统通知：未实施（不在确认范围内）。

### 3.6 输入区简洁化（单图标按钮收拢参数控件）✅

目标：让提示词输入框保持简洁，把低频参数控件收拢为"单个图标的按钮组件"（点击弹出选项浮层）。

- **模型切换**：`src/components/ModelSwitcher.tsx` 触发器从"生图模型 · 文本模型"文字胶囊改为单个图标按钮（`SlidersHorizontalIcon`）；当前模型信息保留在 tooltip（title）与浮层内，浮层内容不变。
- **质量 / 格式 / 审核规则**：桌面与移动输入区均由"标签 + 下拉选择"改为单个图标按钮（`SparklesIcon` / `FileImageIcon` / `ShieldCheckIcon`），点击弹出选项浮层（头部显示当前值、选中项打勾、审核规则保留"新建自定义规则…"动作项）。复用新增的 `InputIconOptionButton` 组件（`src/components/InputBar.tsx`）。
- **输出位置**：由"输出：默认输出"胶囊 / 移动端路径文本框改为单个图标按钮（`FolderOpenIcon`），浮层内展示当前路径并提供"选择自定义目录… / 恢复默认输出"。
- **尺寸与数量**保留可见（尺寸胶囊 → 尺寸弹窗；数量胶囊内联输入），SOP 与提示词管理胶囊保留。
- **「归档到『xxx』」胶囊移除**：`activeGalleryFolderName` 选择器与显示一并删除；自动归档行为不变。
- **控件高度统一**：输入区所有控件（SOP / 提示词管理 / 尺寸 / 数量胶囊、模型切换与质量/格式/审核规则/输出图标按钮、右侧素材库/转变量/上传图标按钮、导入批量任务、「生成图像」主按钮、移动端折叠参数与按钮）统一为设计系统标准控制高度 `h-ds-control-md`（36px），消除 40px 图标按钮 / 主按钮与 32px 胶囊混排的高度不一致。

### 3.7 修复：任务卡封面分辨率徽章显示缩略图尺寸（Electron 专属）✅

- **症状**：任务卡片封面左上角的比例/分辨率徽章在桌面端显示的是**压缩后的缩略图尺寸**（如 2048×2048 的原图显示 "1024×1024"），浏览器端正常。
- **根因**：`ensureImageThumbnailCached`（`src/store.ts`）在 Electron 下**磁盘优先**读取库根 `thumbs/` 缩略图；磁盘缓存只存压缩后的 WebP（最长边 ≤1024px），`parseWebpDimensions` 解析出的是**缩略图自身尺寸**，被当作原图尺寸透传。IndexedDB 缩略图记录保存的是 `naturalWidth/naturalHeight`（原图尺寸），所以只有桌面端异常。
- **修复（双层）**：
  1. `src/store.ts` `ensureImageThumbnailCached`：磁盘缩略图来源时从图片记录（`getImage` 的原图 width/height）补齐原图尺寸，恢复"缩略图 width/height = 原图尺寸"的契约，保护所有缩略图尺寸消费者（任务卡徽章、导出元数据兜底等）。
  2. `src/components/TaskCard.tsx`：封面比例/分辨率徽章**优先取任务实际参数**（`actualParamsByImage[].size` → `actualParams.size` → `params.size`），比缩略图尺寸更权威，且不依赖缩略图加载。
- **回归测试**：`src/components/TaskCard.test.tsx` 新增用例——任务实际尺寸 2048×2048、缩略图 1024×1024 时，徽章显示 "2048×2048" 而非 "1024×1024"。

### 3.8 修复：暗色模式下详情弹窗顶部参数/按钮变"色块"（token 误用）✅

- **症状**：暗色模式下，任务详情弹窗顶部图片面板的比例/分辨率徽章、「下载全部」「打开原图位置」、图片序号等变成深色块，文字看不清（背景和文字都是暗色）。
- **根因**：`--ds-color-text-inverse` 是给**彩色表面**（主色/危险色按钮）设计的反色文字——暗色模式下这些表面变浅、文字变深（`0 0% 12%` 近黑）才有对比度。但这些位置把它用在**深色遮罩**上：`bg-ds-scrim/60`（scrim 恒为深色，默认皮肤 `220 12% 8%`）配 `text-ds-text-inverse`（暗色模式下近黑）→ 暗字压暗底。浅色模式恰好都正常，暗色模式才暴露。
- **修复**：所有 `bg-ds-scrim*` / `bg-black*` 上的文字改为**固定白字** `text-white`（scrim 在所有皮肤、两种模式下都是深色，白字恒有对比度），涉及 `DetailModal`（9 处：比例/分辨率/序号/耗时徽章、下载全部、打开原图位置、悬停下载）、`AgentWorkspace`（2 处）、`SopManagementCenter`（2 处）、`AssetViewer`（黑色 toast 分支）；`bg-ds-primary/danger/warning` 彩色表面上的 `text-ds-text-inverse` 保留（符合设计契约）。
- **验证**：headless Chrome 渲染暗色主题对比图（修复前几乎不可见 vs 修复后清晰），全量测试 2102 通过、`tsc`/`build` 通过。

### 3.9 移除顶部"生成中占位条"（PendingTaskStrip）✅

- 按用户要求，素材库最顶部不再显示运行中任务（尚未出图）的占位任务卡。
- 删除 `src/features/assetLibrary/PendingTaskStrip.tsx` 及其测试，`AssetLibraryWorkspace` 不再渲染；`design-system/catalog.ts` 对应条目移除。
- 效果：生成中在素材库不出现占位卡，首张图产出后任务卡/素材正常出现（任务详情仍可从任务卡或「最近生成」打开）。

### 3.10 删除任务 = 连同生成的图片一起删除 ✅

- 按用户要求，删除任务卡时把**整个任务（提示词、参数）连同它生成的图片一起永久删除**，不再保留图片在素材库。
- 实现（`src/store.ts`）：
  - `removeTask` / `removeMultipleTasks` 删除任务记录后，调用新增的 `purgeTaskOutputAssets()`：按任务输出图片查素材（`batchGetGeneratedAssetsByImageIds`），走统一永久删除计划（`planAssetPurge` + `purgeGeneratedAssets`，复用现有引用冲突保护与墓碑机制）。
  - **引用安全**：被其他任务输入 / Agent 会话等拥有型引用的图片保留不删（toast 提示"X 张被其他任务引用，已保留"）；项目文件夹归属不阻断删除。
  - toast 文案更新为"已删除 N 个任务及 X 张生成图片"。
- 确认弹窗文案同步更新（任务卡视图、详情弹窗、批量删除、SOP 批次、取消收藏、旧画廊）：提示"任务的提示词、参数和它生成的图片会一并删除，不可恢复"。
- 回归测试（`src/store.test.ts`）：① 删除任务级联删除其素材；② 被其他存活任务引用的素材保留不删。

### 明确不做（按用户"不改界面"的选择）

- 不改 Header 模式切换、素材库工具栏、输入区布局。
- 不移动「从素材库选图」「转换为变量」等按钮位置。
- 不重构 SOP / 词库 / Agent 批量功能。

## 4. 验收清单

1. ✅ 默认视图为「任务卡片」：打开素材库即见任务卡（生成后新任务卡置顶带进度），可切「图片」大图模式。
2. ✅ 视图预设只有「任务卡片 / 图片」两个，无「分组」入口；旧持久化数据迁移归一为任务卡片。
3. ✅ 在「收藏」视图下生成 → 自动切到「全部」，新任务卡立即可见，有 toast。
4. ✅ 在「全部 / 最近生成 / 未整理」视图下生成 → 视图不变，新结果置顶出现。
5. ✅ 在项目文件夹视图下生成（保留归档）→ 新图归入该文件夹且当前视图可见，不切视图。
6. ✅ 普通生图默认参数与 0.7.56 一致（n=1、auto、cycle），回归测试锁定。
7. ✅ Agent / SOP / 日程 / 标签页批量运行不触发视图切换。
8. ✅ `npm test` 全量通过、`npx tsc -b` 通过、`npm run build` 通过。

## 5. 相关代码位置

- 提交入口：`src/components/InputBar.tsx`（`submitCurrentMode` → `submitTask`；P0 生完即见钩子在此）
- 「生完即见」动作：`src/features/assetLibrary/store.ts`（`revealNewestResults`）
- 默认视图与迁移：`src/features/assetLibrary/store.ts`（初始 `groupBy: 'grouped'`；persist v6 迁移归一为任务卡片）
- 视图预设收窄：`src/features/assetLibrary/AssetLibraryToolbar.tsx`（`ViewPresetControl` 图片 / 任务卡片二选一）
- 提交逻辑：`src/store.ts`（`submitTaskWithData`，含文件夹捕获 `defaultCollectionId`）
- 素材库状态：`src/features/assetLibrary/store.ts`（`scope` / `query` / `filters` / `setScope`）
- 视图判定：`src/features/assetLibrary/query.ts`（`queryAssets`）、`src/lib/assetLibraryModel.ts`（`assetScopeMatches`）
- 生成中占位：`src/features/assetLibrary/PendingTaskStrip.tsx`
- 素材同步：`src/lib/assetSyncQueue.ts`
- 参数归一化：`src/lib/paramCompatibility.ts`、`src/types.ts`（DEFAULT_PARAMS）
- 回归测试：`src/features/assetLibrary/store.test.ts`（revealNewestResults）、`src/lib/paramCompatibility.test.ts`（0.7.56 默认值锁定）
