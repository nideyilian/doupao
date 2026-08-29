# 合并可行性分析：豆泡两年半的"批量变量提示词"功能 → 当前项目（DOUPAO v0.7.61）

> 前提：仅分析，不改代码。目标功能 = 远程（liangkunnhello/doupao-liangnianban）的变量提示词体系（引擎 + 提交/执行链路 + UI + AI 生成 + 合规策略 + 反推 SOP）。
> 总体结论：**可行，且分层成本差异极大**——核心引擎近乎零成本可移植；完整 AI/反推链路成本高、冲突面大，建议分阶段实施并只移植与本地产品方向兼容的部分。

---

## 1. 结论摘要

| 层 | 内容 | 工作量 | 冲突风险 | 建议 |
|---|---|---|---|---|
| L1 引擎 | `variablePrompt.ts` + 测试 | 极小（≈1 小时） | 无（新文件、零依赖） | ✅ 必做，先行 |
| L2 执行链路 | store.ts 3 处接入（校验/尺寸/展开） | 小–中（1–2 天） | 中 | ✅ 必做 |
| L3 UI 反馈 | InputBar 徽章 + 尺寸自适应 | 中（1–2 天） | 中 | ✅ 必做 |
| L4 AI 生成 | variable-prompt-skill、galleryAgentGeneration、文本策略、skillMetaInstructions、assistantActions | 大（1–2 周） | **高** | ⚠️ 选做，需适配本地 strategy 分化 |
| L5 反推 SOP | ReverseSop 类型/runner/卡片/控制器 | 大（1 周+） | **高** | ⚠️ 选做，与素材库/画廊耦合 |
| L6 MCP 等 | mcp-server、SettingsMcpPanel、7 个新依赖 | 大 | 高 | ❌ 不建议（偏离变量提示词主题） |

---

## 2. 合并前必须认识的项目现状

1. **本地不是 git 仓库**（`D:\AAA\DOUPAO` 无 `.git`）：无共同提交基线，"合并"实际是**文件级挑选 + 手工移植**，无法用 `git merge` 三路合并。
2. **两个 fork 高度分化**：所有共享核心文件均已分叉——
   - `store.ts`：本地约 1.2 万行 vs 远程 10,186 行；本地多出素材库、迁移、批次视图等逻辑；
   - `InputBar.tsx`：本地 4,382 行 vs 远程 4,204 行，各自改过编辑器和工具栏；
   - `src/features/strategy/*`：本地 `SopManagementCenter.tsx` 102KB vs 远程 68KB、`sopGeneration.ts` 21.7KB vs 18.5KB，本地还多了 `adapters/promptLibraryTree`、`GallerySopBatchModal` 等远程没有的适配层；
   - `electron/main.ts`、`types.ts`、`App.tsx`、`package.json` 全部不同。
   → **任何"整文件覆盖"式合并都会摧毁本地功能，必须按 diff 手工移植。**

3. **本地有远程没有的重量级体系（保护红线）**：素材库（`src/features/assetLibrary/*` + `electron/asset-*` + SQLite 目录）、设计系统 v2（`src/design-system/*`）、复合工作区 v2、ModelSwitcher、随机提示词/提示词预设侧栏、`promptVariableColors.ts`（远程无此文件，本地行内变量配色更完善）。
4. **远程部分文件是本地刻意不要的**：本地素材库改造 M15 已删除"任务导航"（远程的 `GalleryTaskNavigator.tsx` 即同类）；远程的 `PostprocessV2Workspace.tsx`/`PostprocessWorkspace.tsx` 与本地 composite 工作区定位重叠——**反向搬运时不得盲目带回**。
5. **已有半套基础**：本地已经具备行内变量转换（`\u2060…\u2061` 标记、`PromptVariableEditor`、词库侧栏）和 SOP 模板中的 `{{变量}}`/`可变项` 概念（`sopGeneration.ts` 的 LLM 指令），**只缺"解析 + 展开 + 批量提交"这层执行引擎**——本地用户现在把带 `可变项` 的 SOP 模板直接当普通提示词提交，`{{}}` 会原样进图片模型。
6. **测试基线**：本地有 vitest 全套（`npm test`），移植必须带测试（引擎测试可原样搬入）。

---

## 3. 分层移植方案与冲突细节

### L1 引擎层 —— 无风险
- **搬运**：`src/lib/variablePrompt.ts` + `variablePrompt.test.ts`（纯函数，零依赖，不 import 本地任何东西）。
- **冲突**：无。与本地 `promptImageMentions.ts`/`promptVariableEditor.ts` 的 `\u2060` 行内变量体系**不冲突**（不同语法、不同函数），但需在文档中区分两个概念。
- **验收**：`npm test` 全绿；`parseVariablePrompt`/`renderVariablePromptBatch` 纯函数行为与远程一致。

### L2 执行链路 —— 小到中风险
远程改动点（全部在 `store.ts`，本地对应位置已确认存在）：
| 远程改动 | 本地对应接入点 |
|---|---|
| `submitTaskWithData` 开头：解析 + 格式错误拦截 toast | 本地 `submitTaskWithData`（约 L5622 起，开头处插入同逻辑） |
| 提交时 `variablePrompt.enabled && aspectRatio` → 尺寸改写 `calculateImageSize(inferSizeTier(...), ratio)` | 本地同函数处（`normalizeParamsForSettings` 前） |
| 执行器：`renderedVariablePrompts = renderVariablePromptBatch(task.prompt, n, task.id)` + `resolveTaskPrompt(slotIndex)` + `maxImagesPerRequest: useFolderMode || variablePrompt.enabled ? 1 : apiMaxN` | 本地执行器（约 L9026 起，`executeInBatches` 前；本地已有 `useFolderMode`/`apiMaxN`/`variableResolver` 同构代码，插入点清晰） |
- **依赖**：`calculateImageSize`/`normalizeImageSize` 本地 `src/lib/size.ts` 已有（同源）；`inferSizeTier` 需从远程 `store.ts` 拷贝或内联。
- **注意**：本地 `store.ts` 有素材库同步、批次恢复等远程没有的调用点，改动只加不改；重试/恢复路径要回归（展开是确定性的，重跑一致）。
- **验收**：带 `可变项` 模板提交 → 展开 n 条不同提示词；格式错误被拦截；尺寸自动改写；原有批量/文件夹/Agent 提交回归通过。

### L3 UI 反馈 —— 中风险
- 远程 `InputBar.tsx` 三处：`parseVariablePrompt` 的 `useMemo` 状态、输入框下方徽章（绿/琥珀）、尺寸自适应 `useEffect`（含 `getSizeTierForVariablePrompt` 小工具函数）。
- **冲突**：本地 InputBar 布局与远程不同（本地徽章行内容更多、有字数统计等），需按本地 JSX 结构**手写插入**，不能粘贴远程 JSX；样式沿用本地 tailwind/design-system 令牌。
- **验收**：输入模板即实时显示"已启用变量提示词 · 16:9 · N 变量 / M 组合"，错误模板显示琥珀色报错；桌面/移动两套工具栏都正常。

### L4 AI 生成层 —— 高风险，需要决策
远程包含 6 个互相咬合的改动：`storeSopGeneration.ts` 的 `variable-prompt-skill` 模式（schema、excludeText、自动修复）、`skillMetaInstructions.ts`、`variablePromptTextPolicy.ts`、`galleryAgentGeneration.ts`、`SopManagementCenter.tsx`（新资产类型/执行模式/徽章/开关）、`assistantActions`（variablePrompt 步骤）。
- **冲突实况**：本地 `storeSopGeneration.ts`（`adapters/` 下）与远程同名文件已分化（远程 7KB vs 本地 12KB+，本地有素材库落库、聊天模式等）；`SopManagementCenter` 本地已大改（词库树、promptLibraryTree、GallerySop 适配）；`assistantActions` 的 runner/matcher 本地也有自己版本。
- **建议**：
  1. 先移植**纯函数层**：`variablePromptTextPolicy.ts` + 测试（零 UI 依赖，直接可用，先于 UI 落地"排除文字"能力）；
  2. `variable-prompt-skill` 生成模式按本地 `storeSopGeneration` 的现有结构**适配式移植**（不覆盖本地文件，把 variable-prompt 分支加进本地现有生成函数，schema 用远程三字段）；
  3. `skillMetaInstructions.ts` 直接搬入（新文件）；
  4. `galleryAgentGeneration.ts` 可搬（新文件，仅依赖 `sopGeneration`/`storeSopGeneration` 导出，需核对本地导出名）；
  5. `assistantActions` 的 variablePrompt 步骤**逐函数移植**（matcher/runner/builtInActions 本地版本不同，不能覆盖）；
  6. `SopManagementCenter` 的 UI 改动**按本地现状重做**（新增"变量提示词"资产类型 + 执行模式徽章 + 排除文字开关），不搬远程 JSX。
- **验收**：从参考图反推变量提示词模板成功入库；生成后语法校验/自动修复生效；"排除文字"策略拦截含文案变量；SOP 中心可编辑/执行 variable-prompt 类型资产并展开生图。

### L5 反推 SOP —— 高风险，可选
- 新增：`types.ts` 的 `ReverseSop*` 类型、`reverseSopRunner.ts`、`ReverseSopTaskCard/DetailModal`、`store.ts` 控制器流程、`sopBatchRecovery` 适配。
- **冲突**：本地 `types.ts` 更大且含素材库类型；控制器任务要接入本地任务/画廊/素材库的同步链路（远程的同步点本地结构不同）；远程依赖 `GalleryTaskNavigator` 展示，而本地已删同类组件 → 需要改用本地批次/详情展示。
- **建议**：L4 稳定后再评估；或砍掉"反推 SOP 控制器"，只保留"AI 直接生成变量提示词模板资产"（即 L4），用现有 SOP 批次流程承载展开。

### L6 MCP 与其余 —— 不建议本次合并
- MCP（`src/mcp/*`、`electron/mcp-server.ts`、`SettingsMcpPanel`、`preload.cjs`、`@modelcontextprotocol/sdk`/`zod` 依赖）与变量提示词无强关联，且要改 `electron/main.ts`（本地已含素材库 IPC 栈，改动面大）——**单独立项**。
- `hanhaiPresetImport`、PWA、`imageAspectRatioGate`、`GalleryTaskNavigator` 等与变量提示词无关，一律不搬（个别按需评估）。

---

## 4. 风险评估

| 风险 | 等级 | 说明与对策 |
|---|---|---|
| 双 fork 分化导致覆盖式合并破坏本地功能 | 高 | 只做增量式手工移植；每层小步提交（本地可先 `git init` 建立基线便于回滚） |
| `store.ts`/`InputBar.tsx` 大文件手改易出错 | 中 | 改动点少而清晰（L2 共 3 处、L3 共 3 处）；每处配单测；`npm test` + 手工回归（批量、文件夹、Agent、SOP 批次） |
| 本地素材库/画廊链路与展开任务并存时的展示问题 | 中 | 展开任务仍是普通 `TaskRecord`，逐条展示与现有画廊天然兼容；重试恢复用确定性种子保持一致 |
| AI 生成质量依赖 LLM 遵守语法 | 中 | 沿用远程"解析失败自动修复重试 + 拦截提交"双保险；本地可加"部分容错"改进（远程未做） |
| 依赖与构建 | 低 | L1–L5 无需新依赖；L6 才需要（不并入） |
| 数据/存储兼容 | 低 | 变量提示词不新增持久化字段（展开发生在运行时），无需迁移；若做反推 SOP 才新增 `ReverseSop*` 字段（需 `migrations/registry` 注册，本地已有迁移体系） |
| 版本/协议 | 低 | 双方同源 MIT，无授权障碍；远程 v0.7.51 新仓库无维护承诺，代码需自持 |

---

## 5. 推荐实施计划（分 4 个阶段，每阶段可独立交付）

- **阶段 0（30 分钟）**：`git init` 本地仓库 + 提交当前基线快照（含 `node_modules` 忽略），建立回滚点；拉取远程代码到 `tmp/` 或 `repo/` 旁路参考。
- **阶段 1 · 引擎落地（0.5 天）**：搬 `variablePrompt.ts` + 测试；补中文注释与语法文档（远程缺文档，本地可补 `docs/variable-prompt-format.md`）；全量测试通过。
- **阶段 2 · 可用闭环（2–3 天）**：L2 store 三处接入 + L3 InputBar 徽章/尺寸联动；单测 + 手工回归（桌面/移动、批量、文件夹模式、Agent 模式、SOP 批次、重试）；发一个 0.7.x 版本验证。
- **阶段 3 · AI 生成（1–2 周）**：L4 按"纯函数 → 生成模式 → 技能指令 → 画廊生成 → SOP 中心 UI → assistantActions"顺序移植；每步带测试；与本地素材库联动（生成的模板资产可入素材库）。
- **阶段 4 · 反推 SOP（可选，1 周+）**：评估本地批次/详情承载方案后实施；否则关闭此项。
- **不做**：L6 MCP 等（单独立项评估）。

**工作量合计**：核心价值（阶段 1+2）≈ 3–4 人日；完整变量提示词生态（+阶段 3）≈ 2–3 人周；（+阶段 4）另加 1 周+。

---

## 6. 最终建议

1. **值得合并**：变量提示词是当前项目用户已经"用错方式使用"的能力（本地 SOP 已产出 `可变项` 模板却无展开引擎），L1+L2+L3 投入产出比极高，建议尽快落地；
2. **AI 生成层按需裁剪**：`variablePromptTextPolicy` 与 `variable-prompt-skill` 生成模式是远程亮点，建议移植；`galleryAgentGeneration`/`assistantActions` 视本地产品节奏取舍；
3. **反推 SOP 与 MCP 不建议本期做**：与本地素材库/画廊方向重叠或无关，避免一次合并摊子过大；
4. **执行纪律**：全部增量式手工移植 + 逐层测试 + 阶段发版，严禁整文件覆盖共享大文件；先 `git init` 建基线。
