# 素材库 Eagle 交互复刻 —— 差距分析

> 目标：所有素材库类型操作完全复刻 Eagle 的交互方式。
> 本文盘点现状（已对齐项）与差距（缺失/不完整项），每项给出 Eagle 行为、当前状态、实现要点、涉及文件与优先级，供排期直接使用。
> 生成日期：2026-07（基于当前代码 `src/features/assetLibrary/`、`src/hooks/useAssetLibraryShortcuts.ts`、`src/lib/assetSidebarUtils.tsx`）。

---

## 1. 结论摘要

现有素材库已经完成 Eagle 交互体系的 **约 70%**：侧栏树、网格/列表双视图、框选/多选、查看器（缩放/平移/导航/信息面板）、快捷键（评分/收藏/颜色/回收站）、批量栏、回收站、智能文件夹、查重、相似图片等主体交互都已就位且质量不错。

**实施状态（P0 全部完成，见 §3.1–§3.6 与 §4）：**
- ✅ **P0-1 标签体系**：数据层复用既有 `AssetTag`/`tagIds`（SQLite 树形 + IndexedDB），新增侧栏标签区（`AssetLibraryTagSection`，多选 AND 筛选 + 树形管理）、打标入口（右键菜单/批量栏/查看器/详情面板 `AssetTagChips`）、`filters.tagIds` 多选 AND 查询（内存 + SQLite）、智能文件夹可保存标签条件
- ✅ **P0-2 文件夹拖拽排序/嵌套**：树行拖拽负载（`COLLECTION_DRAG_TYPE`）、投放区判定（上 30% 插入前/下 30% 插入后/中间嵌套 + 插入线与高亮视觉）、`moveCollectionsToPosition`（多选拖拽、防环）、根目录追加投放
- ✅ **P0-3 素材剪贴板 + 撤销/重做**：`copyAssets/cutAssets/pasteAssetsIntoCollection`（Ctrl+C/X/V，copy=加归属、cut=移动）、统一撤销栈（`undo/redo`，Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y，覆盖素材状态、回收站、文件夹与标签操作，上限 50 条）
- ✅ **空格 = Eagle 式按住快速预览**：`AssetQuickPreview` 悬浮层（按住显示大图、松开关闭），卡片/列表行/全局空格统一为快速预览，Enter/双击仍打开全屏查看器

**剩余差距（见 §3.7 起）：** 查看器旋转/镜像/Delete、剪贴板粘贴导入（Ctrl+V 截图入库）、按图片颜色筛选、批量重命名、素材级重命名、时间线视图、目录监视、多库切换等。

**真正缺失、需要补的核心差距（按影响排序）：**

| # | 差距 | 为什么重要 |
|---|------|-----------|
| 1 | **标签体系整体缺失**（Eagle 三大组织维度：文件夹/标签/颜色标签，当前只剩文件夹+颜色标签） | Eagle 用户第一眼就会找标签 |
| 2 | **文件夹同级拖拽排序 / 拖拽嵌套**（当前只有"移动到…"菜单） | Eagle 整理文件夹的核心肌肉记忆 |
| 3 | **素材级复制/剪切/粘贴**（Ctrl+C/V/X，当前剪贴板只支持文件夹） | 高频操作，Eagle 里人人用 |
| 4 | **撤销/重做**（Ctrl+Z / Ctrl+Shift+Z） | Eagle 3.x 起有完整撤销栈，删除/移动/标签可撤回 |
| 5 | **查看器增强**：旋转/镜像、Delete 删除、Ctrl+滚轮缩放 | 查看器是素材库最常用界面 |
| 6 | **剪贴板粘贴导入**（Ctrl+V 截图/剪贴板图片直接入库） | Eagle 标志性导入方式 |

其余为增强项（按图片颜色筛选、批量重命名、素材级重命名、拖出窗口导出、时间线视图等），见 §3 与 §4 路线。

---

## 2. 现状盘点 —— 已对齐 Eagle 的部分

| Eagle 交互 | 当前实现 | 状态 |
|-----------|---------|------|
| 左侧栏系统范围（全部/最近/收藏/未整理/回收站） | `AssetLibrarySidebar.tsx` `SYSTEM_SCOPES` | ✅ |
| 文件夹树（多级、折叠、展开态持久化） | `buildCollectionTree` + 折叠 localStorage | ✅ |
| 文件夹新建/重命名（双击/F2/右键） | `CreateRow` / `CollectionTreeItem` 内联编辑 | ✅ |
| 文件夹右键菜单（新建子项/重命名/复制/剪切/粘贴/上移下移/置顶/颜色/合并/移动到/导出 ZIP/信息/复制链接/删除） | `TreeItemMenuItems` | ✅ |
| 文件夹多选（Ctrl/⌘ + Shift 范围）+ 批量移动/合并/导出 | `selectedFolderIds` + 批量目标菜单 | ✅ |
| 文件夹颜色 | `setCollectionColor` + 行内色板 | ✅ |
| 文件夹信息弹窗 | `CollectionInfoModal` | ✅ |
| 智能文件夹（保存搜索/筛选为侧栏入口） | `savedFilters` + `SaveFilterButton` | ✅ |
| 网格虚拟瀑布流 | `AssetGrid`（行主序瀑布流 + 万级虚拟化） | ✅ |
| 框选（拖拽圈选） | `useDragSelect` | ✅ |
| Ctrl/⌘ 连选、Shift 范围选（点击与方向键） | `AssetGrid` / `AssetListView` / 侧栏树 | ✅ |
| 网格三档密度（紧凑/标准/大图）+ 列表 | `LayoutPresetControl` + `gridDensity` | ✅ |
| 方向键/Home/End 键盘导航 | `handleGridKeyDown` | ✅ |
| 双击/Enter/空格打开查看器 | `openViewer` + 全局快捷键 | ✅（空格语义见 §3.6 决策点） |
| 卡片 hover 快捷栏（收藏/七色标签/加入参考图） | `AssetTile` hover 栏 + 拖拽手柄 | ✅ |
| 右键菜单作用于选区（右键选中卡片=批量） | `AssetCardMenu` | ✅ |
| 查看器：滚轮缩放 1–8× / 拖拽平移 / 双击缩放 | `AssetViewer` | ✅（旋转/镜像缺失） |
| 查看器 ←/→ 循环导航、Esc/空格关闭、计数 | `AssetViewer` | ✅ |
| 查看器内 1–5/0 评分、F 收藏、C 颜色循环 | `AssetViewer` keydown | ✅ |
| 查看器类似图片条 | `recommend` 底部条 | ✅ |
| 查看器信息面板（评分/收藏/七色标签/元数据/备注/提示词/衍生链） | 右信息面板 + `NotesEditor` / `DerivedChain` | ✅ |
| 全局快捷键 1–5/0、F、C、Delete 回收站、Esc 取消选择、Ctrl/Cmd+F 搜索、Ctrl+A 全选 | `useAssetLibraryShortcuts` | ✅ |
| 批量操作栏（收藏/评分/颜色/项目/下载 ZIP/回收站/恢复/永久删除） | `AssetBatchBar` | ✅ |
| 回收站（恢复/清空/永久删除确认 + 引用冲突预览） | trash scope + `AssetPurgeModal` | ✅ |
| 素材拖到文件夹 = 移动（源文件夹移除归属），目标有重复弹三选一（仍然添加/跳过/替换） | `applyAssetsToCollection` + `commitDrop` | ✅ |
| 拖到生成输入框 = 参考图（copy 语义） | `InputBar` 全局 dragover | ✅ |
| 系统文件拖入网格 = 导入素材 | `AssetGrid.handleDrop` | ✅ |
| 查重（感知哈希分组，一键保留一张） | `AssetDuplicateModal` | ✅ |
| 相似图片搜索 | `similarToAssetId` → `recommend` | ✅ |
| 子文件夹区块（进入文件夹顶部展示子文件夹卡片） | `SubfolderStrip` | ✅ |
| 侧栏宽度拖拽 + 持久化 | 208–400px 把手 | ✅ |
| 搜索覆盖（提示词/模型/项目名/文件名/备注） | `query.ts` haystack | ✅ |

---

## 3. 差距清单（按交互域）

优先级标注：**P0**（复刻观感的核心差异）／ **P1**（高频增强）／ **P2**（增强）／ **P3**（候选/远期）。

### 3.1 标签体系（P0）—— 最大差距

**Eagle 行为**：标签是与文件夹并列的三大组织维度之一。素材可打任意多个标签；左侧栏有「标签」区（带计数，可多选，点击即筛选 AND 语义）；右键/批量栏/查看器均可打标签；标签可重命名、合并、删除（删除后素材上标签移除）；支持标签搜索。

**当前状态**：标签体系被整体移除（`AssetLibraryWorkspace.serializeScope` 注释明确"界面已无标签入口"；`AssetLibraryScope` 的 `tag` 分支仅保留序列化兼容）。素材模型 `GeneratedAsset` 无 tags 字段（需确认是否残留兼容字段）。

**要实现的**：
1. 数据模型：`GeneratedAsset.tags: string[]`（或独立 tag 表 + 关联表），存储/迁移（Electron SQLite + 浏览器 IndexedDB 双端）。
2. 侧栏「标签」区：标签列表 + 计数 + 多选筛选（点击切换 AND 语义）+ 标签管理（重命名/合并/删除/新建）。
3. 打标签入口：右键菜单、批量栏（`AssetBatchBar`）、查看器信息面板、详情面板。
4. 筛选器：`AssetLibraryFilters` 增加 `tags: string[]`（AND），`query.ts` + SQLite 查询同步支持。
5. 智能文件夹可保存标签条件。

**涉及文件**：`src/types.ts`（AssetLibraryFilters/GeneratedAsset）、`src/features/assetLibrary/store.ts`、`query.ts`、`AssetLibrarySidebar.tsx`、`AssetCardMenu.tsx`、`AssetBatchBar.tsx`、`AssetViewer.tsx`、`AssetDetailPanel.tsx`、`electron/`（SQLite schema/迁移）、`src/lib/migrations/`。

### 3.2 文件夹拖拽排序 / 拖拽嵌套（P0）

**Eagle 行为**：文件夹树直接拖拽——拖到另一文件夹上 = 变为其子级（高亮目标行）；拖到同级行间 = 调整顺序（插入线指示）；拖拽中整棵子树跟随。这是 Eagle 整理文件夹最核心的交互，目前项目里只能通过右键「移动到…」菜单完成，且同级排序只有"上移/下移"两个按钮。

**当前状态**：`AssetLibrarySidebar` 的 drop target 只接受素材拖入（`useAssetDropTarget` 的 `canAcceptAssetDrag` 仅认素材负载）；`moveCollection` / `reorderCollection` action 已存在，缺的是拖拽 UI 层。

**要实现的**：
1. 树节点拖拽负载（`application/x-doupao-collection` = collectionId + 源父级）。
2. 行 hover 判定（上半/下半 = 排序插入线，整行 = 嵌套）。
3. 拖拽视觉：插入线 / 嵌套高亮 / 子树半透明跟随（或简化为行高亮）。
4. drop 语义：移动到目标（`moveCollection`）、排序（`reorderCollection` 泛化为"移动到 index"）。
5. 与现有素材拖入共存（按负载类型分流）。

**涉及文件**：`AssetLibrarySidebar.tsx`、`src/lib/assetSidebarUtils.tsx`、`store.ts`（`moveCollection` 增加 index 语义）。

### 3.3 素材级复制/剪切/粘贴（P0）

**Eagle 行为**：选中素材后 Ctrl/Cmd+C 复制、Ctrl/Cmd+X 剪切，然后在文件夹/根目录 Ctrl/Cmd+V 粘贴（复制 = 素材同时属于多个文件夹；剪切 = 移动）。支持跨文件夹粘贴，粘贴后可撤销。

**当前状态**：`store.clipboard` 仅支持 `type: 'collection'`（文件夹的复制/剪切/粘贴）；素材无剪贴板操作；全局快捷键只有 Ctrl/Cmd+F 与 Ctrl+A。

**要实现的**：
1. `clipboard` 扩展为可承载素材列表（`type: 'asset'`，ids + copy/cut 语义）。
2. 快捷键：选中时 Ctrl+C/X 写入剪贴板；剪贴板非空时在文件夹 scope 内 Ctrl+V 粘贴（copy=加归属，cut=移动，与素材拖入 `applyAssetsToCollection` 的语义复用）。
3. 侧栏根/文件夹行的「粘贴」菜单项支持素材剪贴板（当前 `canPaste` 只认 collection）。
4. 粘贴后 toast + 撤销（配合 §3.4）。

**涉及文件**：`src/features/assetLibrary/store.ts`、`useAssetLibraryShortcuts.ts`、`AssetLibrarySidebar.tsx`（`TreeItemMenuItems` canPaste/paste）、`AssetBatchBar.tsx`。

### 3.4 撤销/重做（P0）

**Eagle 行为**：Eagle 3.x 起 Ctrl+Z / Ctrl+Shift+Z 可撤销素材移动、删除（移入回收站）、标签/颜色/评分变更、文件夹操作等，栈式撤销。

**当前状态**：无任何 undo 栈；所有 `patchAssets` / `moveToTrash` / `moveCollection` / `deleteCollection` 等直接落库。

**要实现的**：
1. store 层命令包装：把可变操作收敛为可逆动作（`{ type, payload, inverse }`），在 `useAssetLibraryStore` 挂 undo/redo 栈（上限如 50 步）。
2. 覆盖范围（建议首批）：移入回收站/恢复、移动文件夹/移动素材归属、评分/收藏/颜色标签、删除/创建文件夹、智能文件夹增删。
3. 快捷键 Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z（注意与编辑器输入框内的原生撤销隔离——`isTypingTarget` 已具备）。
4. 批量操作（批量打分/打标）作为单条栈记录。

**涉及文件**：`src/features/assetLibrary/store.ts`（或新增 `src/lib/assetUndo.ts`）、`useAssetLibraryShortcuts.ts`。

### 3.5 查看器增强（P1）

| 子项 | Eagle 行为 | 当前状态 | 实现要点 |
|------|-----------|---------|---------|
| 旋转 | 查看器底部工具栏左右旋转 90°（快捷键 R 或 Ctrl+R） | 无 | `AssetViewer` 加 `rotation` state（0/90/180/270），CSS `transform: rotate` 叠加现有 scale/translate；R 键循环 |
| 镜像/翻转 | 水平/垂直翻转 | 无 | `flipH/flipV` state，transform 叠加 |
| 查看器内 Delete | Delete 直接把当前素材移入回收站 | 查看器 keydown 未处理 Delete | keydown 增加 Delete → `moveToTrash([viewerAssetId])` → 自动跳下一张或关闭 |
| Ctrl+滚轮缩放 | 预览窗口支持 Ctrl+滚轮缩放 | 只有滚轮直接缩放 | `onWheel` 增加 `event.ctrlKey` 分支 |
| 缩放复位 | 双击缩放已有；加 1:1 / 适应窗口 按钮 | 无按钮 | 顶部工具加「适应/100%」切换 |

**涉及文件**：`src/features/assetLibrary/AssetViewer.tsx`。

### 3.6 快捷键补全（P1）

| 快捷键 | Eagle 行为 | 当前状态 | 建议 |
|--------|-----------|---------|------|
| 空格 | **按住空格 = 快速预览**（大图 hover 显示，松开关闭） | 空格 = 打开/关闭查看器（与 Enter 同义） | ⚠️ **决策点**：改为 Eagle 式按住预览（保留双击/Enter 打开查看器），或维持现状。Eagle 用户对"空格按住预览"肌肉记忆很强 |
| R | 查看器旋转 | 无 | 随 §3.5 实现 |
| Ctrl/Cmd+Z / Shift+Z | 撤销/重做 | 无 | 随 §3.4 实现 |
| Ctrl/Cmd+C/V/X（素材） | 复制/粘贴/剪切素材 | 仅文件夹 | 随 §3.3 实现 |
| Ctrl/Cmd+V（库界面空白） | 粘贴剪贴板图片导入 | 无 | 随 §3.9 |
| F2 | 文件夹重命名 | 已有 | ✅ |
| ? | 快捷键面板 | `HelpModal` 已列快捷键表 | ✅ 随新快捷键更新 |

**涉及文件**：`src/hooks/useAssetLibraryShortcuts.ts`、`src/components/HelpModal.tsx`。

### 3.7 剪贴板粘贴导入（P1）

**Eagle 行为**：任意界面 Ctrl/Cmd+V 直接把剪贴板中的图片（截图/网页复制图）导入素材库，是 Eagle 最高频的采集方式。

**当前状态**：`src/lib/clipboard.ts` 只做"把素材图片复制到系统剪贴板"（写出），没有读入；无粘贴导入路径。

**要实现的**：
1. 库界面内 Ctrl/Cmd+V：读 `navigator.clipboard.read()`（浏览器）或 Electron 主进程 `clipboard.readImage()` 转 dataURL（Electron 无权限限制，与现有 `clipboard:write-image` IPC 对称，新增 `clipboard:read-image`）。
2. 复用 `importExternalFiles`（把剪贴板图包装为 File）入库，toast 反馈。
3. 与素材 Ctrl+V 粘贴（§3.3）按场景分流：有剪贴板图片 = 导入；剪贴板是素材负载 = 粘贴到文件夹。

**涉及文件**：`electron/ipc-handlers.ts`、`electron/preload.ts`、`src/lib/clipboard.ts`、`useAssetLibraryShortcuts.ts`。

### 3.8 搜索与筛选增强（P2）

| 子项 | Eagle 行为 | 当前状态 | 实现要点 |
|------|-----------|---------|---------|
| 按图片颜色筛选 | 按图片画面包含的颜色筛选（与颜色标签无关） | 只有「颜色标签」筛选 | 素材入库时提取主色调（已有 `imageFingerprint` 感知哈希管线可扩展），`AssetLibraryFilters` 加 `dominantColor`；SQLite 存主色 |
| 标签筛选 | 标签列表点击多选 AND 筛选 | 无标签体系 | 随 §3.1 |
| 智能文件夹嵌套 | 智能文件夹可组织成树/子级 | 扁平列表 | `savedFilters` 加 parentId + 树渲染（13.6 候选已有） |
| 文件类型筛选 | 图片/视频/字体/文档 | 全是图片，意义小 | 暂缓 |

**涉及文件**：`src/types.ts`、`query.ts`、`AssetLibraryToolbar.tsx`、`electron/`（SQLite）、`src/lib/imageFingerprint.ts`。

### 3.9 批量操作补全（P2）

| 子项 | Eagle 行为 | 当前状态 | 实现要点 |
|------|-----------|---------|---------|
| 批量重命名 | 选中多张 → 批量重命名（前缀+序号/查找替换等规则） | 无（13.6 候选已有） | 新 `AssetBatchRenameModal` + `patchAssets` filename 字段；Electron 端同步改磁盘文件名 |
| 批量复制到文件夹 | 批量复制（保留原文件夹归属） | 批量栏只有「加入项目」（toggle 归属） | `AssetBatchBar` 项目菜单拆「加入/移出/复制到」 |
| 批量打标签 | 批量加/减标签 | 无标签 | 随 §3.1 |

**涉及文件**：`AssetBatchBar.tsx`、新 `AssetBatchRenameModal.tsx`、`src/lib/assetCommands.ts`。

### 3.10 素材级重命名与信息面板补全（P2）

**Eagle 行为**：信息面板显示文件名并可重命名（改库内文件名）、显示完整元数据（尺寸/格式/大小/创建时间/修改时间/路径/URL/标签/备注/颜色/评分），支持复制文件路径、"在文件夹中显示"。

**当前状态**：信息面板有评分/收藏/七色标签/元数据/备注/提示词/衍生链/来源任务；无素材重命名、无文件名复制、无"在文件夹中显示"（详情面板有"打开文件位置"`openInExplorer`，查看器内无）。

**要实现的**：
1. 素材重命名：`patchAssets` 加 filename 字段 + 详情/查看器内联编辑；Electron 同步磁盘改名（`assetCommands` 新增）。
2. 信息面板：文件名行（复制按钮）、完整路径展示。
3. 查看器右键菜单补「在文件夹中显示」。

**涉及文件**：`AssetDetailPanel.tsx`、`AssetViewer.tsx`、`src/lib/assetCommands.ts`、`src/types.ts`。

### 3.11 时间线视图（P3）

**Eagle 行为**：按生成/整理时间流式浏览的时间轴视图。

**当前状态**：13.6 候选已列"Eagle 式时间线视图"，未实现。

**实现要点**：新 `AssetTimelineView`（按天/月分组时间轴），工具栏视图预设加一项；复用 `queryAssets` 排序 + 分组渲染。涉及 `AssetLibraryToolbar.tsx`、`AssetLibraryWorkspace.tsx`、新视图组件。

### 3.12 其他交互手感细节（P2）

| 子项 | Eagle 行为 | 当前状态 | 建议 |
|------|-----------|---------|------|
| 卡片选中描边 | 选中卡片蓝色描边 + hover 快捷栏 | 已有 ring + hover 栏 | ✅ |
| 空状态引导 | 未整理/空文件夹引导"拖入或导入" | `EmptyState` 文案 | 可加"拖文件到此处导入"提示 |
| 文件夹删除内容去向 | 删除含素材文件夹时选择：一并删除 / 移到未整理 | 直接彻底删除（toast） | ⚠️ 决策点：按 Eagle 加去向选择弹窗（需产品确认） |
| 卡片评分显示 | 星级角标 | 卡片角标有颜色标签，评分未见角标 | 可选：hover 显示评分 |
| 加载体验 | 图片渐进加载/骨架 | 缩略图优先 + hover 全图 | ✅ |

### 3.13 远期（P3，13.6 候选已有，不做迁移承诺）

- 目录监视（chokidar 常驻，文件夹新增自动入库）
- Eagle 库直接导入
- 多素材库切换（Eagle 支持多库，当前单库）
- 云同步/团队共享（不适用）

---

## 4. 分期实施路线

| 阶段 | 内容 | 预估改动面 |
|------|------|-----------|
| **P0-1 标签体系** | 数据模型/迁移/侧栏/筛选/打标入口/智能文件夹 | 大（跨双端存储 + 4 个界面入口） |
| **P0-2 文件夹拖拽排序嵌套** | 树拖拽负载 + 插入线/嵌套视觉 + drop 语义 | 中（侧栏 + utils + store） |
| **P0-3 素材剪贴板 + 撤销重做** | 素材 Ctrl+C/V/X + undo 栈（首批覆盖移动/回收站/评分/收藏/颜色/文件夹操作） | 中（store 重构为命令式） |
| **P1-1 查看器增强** | 旋转/镜像/Delete/Ctrl+滚轮/缩放复位按钮 | 小（单文件） |
| **P1-2 快捷键补全** | R、Z 撤销、素材 C/V/X、更新 HelpModal | 小 |
| **P1-3 剪贴板粘贴导入** | `clipboard:read-image` IPC + 粘贴路径 | 中（Electron + 渲染端） |
| **P2-1 筛选增强** | 按图片颜色筛选、智能文件夹嵌套 | 中 |
| **P2-2 批量补全** | 批量重命名、批量复制到文件夹 | 中 |
| **P2-3 信息面板补全** | 素材重命名、文件名/路径复制、在文件夹中显示 | 小 |
| **P3** | 时间线视图、目录监视、多库、Eagle 库导入 | 大 |

**建议顺序**：P0 三项并行度低（都动 store），建议按 标签 → 拖拽排序 → 剪贴板+撤销 顺序串行；P1 与 P0 独立可并行。

---

## 5. 附：Eagle 快捷键对照表（目标态）

| 按键 | Eagle | 现状 | 差距 |
|------|-------|------|------|
| 空格 | 按住 = 快速预览 | 切换查看器 | ⚠️ 决策点 |
| Enter / 双击 | 打开查看器 | ✅ 同 | — |
| Esc | 取消选择 / 关闭 | ✅ 同 | — |
| ← / → | 查看器导航 / 网格移动焦点 | ✅ 同 | — |
| 1–5 / 0 | 评分 / 清除 | ✅ 同 | — |
| F | 收藏 | ✅ 同 | — |
| C | 颜色标签循环 | ✅ 同 | — |
| Delete | 移入回收站 | ✅ 同（查看器内缺失） | P1 |
| Ctrl/Cmd+A | 全选 | ✅ 同 | — |
| Ctrl/Cmd+F | 搜索 | ✅ 同 | — |
| Ctrl/Cmd+C / X / V | 素材复制 / 剪切 / 粘贴 | 仅文件夹 | P0 |
| Ctrl/Cmd+Z / Shift+Z | 撤销 / 重做 | 无 | P0 |
| R | 查看器旋转 | 无 | P1 |
| Ctrl/Cmd+V（空白） | 粘贴图片导入 | 无 | P1 |
| F2 | 重命名文件夹 | ✅ 同 | — |
| Ctrl/Cmd+滚轮 | 查看器缩放 | 仅滚轮 | P1 |
