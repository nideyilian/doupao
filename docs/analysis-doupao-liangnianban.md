# 豆泡两年半（doupao-liangnianban）项目分析报告

> 分析对象：[liangkunnhello/doupao-liangnianban](https://github.com/liangkunnhello/doupao-liangnianban)（"豆泡两年半：图片生成、编辑与批量变量提示词工具"）
> 分析时间：2026-08-20 前后 · 基于 `main` 分支快照（v0.7.51）
> 分析方式：GitHub API + 浅克隆源码通读 + 与当前项目（DOUPAO v0.7.61）逐文件 diff

---

## 1. 项目概况

| 维度 | 内容 |
|---|---|
| 仓库 | `liangkunnhello/doupao-liangnianban`（TypeScript，MIT 协议） |
| 定位 | 基于 OpenAI gpt-image-2 API 的图片生成/编辑工具，主打**批量变量提示词** |
| 版本 | v0.7.51（2026-08-12 创建，2026-08-20 最后推送，0 star / 0 fork / 0 issue，新仓库） |
| 技术栈 | React 19 + TypeScript + Vite 6 + Tailwind 3 + Zustand 5 + Electron（与当前项目一致） |
| 部署 | Vercel / Cloudflare Workers / Docker / GitHub Pages（含 PWA `sw.js` + `manifest.webmanifest`） |
| 来源 | 与当前项目 DOUPAO（nideyilian/doupao，v0.7.61）**同源 fork**，共同祖先为 [cooksleep/gpt_image_playground](https://github.com/CookSleep/gpt_image_playground) |

### 1.1 与当前项目的关系（关键结论）

两个项目是**同一祖先下的两条平行演化分支**，不是上下游关系：

- 双方共享同一套 `.trae/specs/`（`add-wildcard-var-conversion`、`add-word-library-sidebar`、`add-vertical-tabs`、`add-random-prompt-*`、`remove-n-limit-add-concurrent-batching` 等 10 个 spec 目录同名存在，但内容均已各自演化、无一字节相同）。
- 双方共享同一批基础文件：`src/lib/promptImageMentions.ts`、`promptVariableEditor.ts`、`src/components/PromptVariableEditor.tsx`、`WordLibrary*`（词库全家桶）、`InputBar.tsx`、`store.ts`、`src/features/strategy/*`（SOP 体系）、`src/features/composite/*`、`src/features/assistantActions/*` 等——**但几乎所有共享文件的内容都已分化**（详见 1.3）。
- 当前项目（本地，v0.7.61）在版本号上更新，且**不是 git 仓库**（无 `.git`），合并只能做文件级搬运。

### 1.2 文件级差异统计

对两个工作树（排除 `node_modules`/`dist`/`release`/日志/临时目录）做逐文件对比：

| 类别 | 数量 | 说明 |
|---|---|---|
| 仅远程存在（本地缺失） | 55 个源码/配置文件 | 见 §2 功能清单，即远程的全部增量 |
| 仅本地存在（远程缺失） | 300+ 个 | 本地独有的素材库体系（`src/features/assetLibrary/*`、`electron/asset-*`）、设计系统 v2、ModelSwitcher、promptVariableColors、迁移脚本等 |
| 双方都有但内容不同 | 大量核心文件 | `store.ts`（远程 10,186 行 vs 本地约 1.2 万行）、`InputBar.tsx`（远程 4,204 行 vs 本地 4,382 行）、`types.ts`、`App.tsx`、整个 `strategy/*`、`electron/main.ts`、`package.json` 等 |

### 1.3 依赖差异

远程比本地多 7 个运行时依赖：`@modelcontextprotocol/sdk`（MCP 服务）、`zod`（MCP/校验）、`zundo`（时间旅行 store）、`framer-motion`、`lenis`（平滑滚动）、`image-size`（图片尺寸探测）、`core-js`。
**变量提示词核心引擎本身零依赖**（纯 TypeScript，仅用 FNV-1a 哈希与字符串处理）。

---

## 2. 远程独有功能清单（55 个仅远程文件归类）

1. **变量提示词引擎**：`src/lib/variablePrompt.ts` + `variablePrompt.test.ts` ← 本报告重点，见 §3
2. **策略层变量提示词集成**：`src/features/strategy/variablePromptTextPolicy.ts`(+test)、`galleryAgentGeneration.ts`(+test)、`galleryLibraryApplication.ts`(+test)、`skillMetaInstructions.ts`、`agentStrategyConversation.test.ts`、`adapters/reverseSopRunner.ts`、`adapters/gallerySopPromptRunRequest.ts`、`adapters/sopBatchRecovery.ts`、`adapters/storeSopGeneration.chat.test.ts`
3. **反推 SOP 功能**：`src/components/ReverseSopTaskCard.tsx`、`ReverseSopDetailModal.tsx` + `types.ts` 中 `ReverseSop*` 类型 + `store.ts` 控制器流程
4. **MCP 服务**：`electron/mcp-server.ts`(+test)、`electron/preload.cjs`、`src/mcp/*`（registry/tools/bridge/types 共 26 个文件）、`src/components/SettingsMcpPanel.tsx`
5. **画廊/展示类**：`GalleryTaskNavigator.tsx`(+test)（本地在素材库改造 M15 中已刻意删除同类实现）、`PostprocessV2Workspace.tsx`、`PostprocessWorkspace.tsx`、`ui/images-scrolling-animation.tsx`、`ui/demo.tsx`
6. **其他**：`src/lib/imageAspectRatioGate.ts`(+test)、`hanhaiPresetImport.ts`(+test)（汉海预设导入）、PWA（`public/sw.js`、`manifest.webmanifest`）、`vite.web.config.ts`、`.agents/skills/build-variable-prompt-sop/SKILL.md` + `build-app-variable-prompt-sop/SKILL.md`（变量提示词 SOP 反推技能）、`docs/` 若干实施文档、`.github/workflows/release.yml`

---

## 3. 变量提示词功能深度分析（远程核心卖点）

### 3.1 总体架构：一套"模板 → 展开"的批量生图体系

变量提示词 = **提示词正文 + 尾部"可变项"定义块**。用户（或 AI）写出模板后，应用在提交时把模板按 `n` 张图展开成 `n` 条**具体提示词**，每条对应一个变量组合，逐条独立请求图片接口。整个体系分 5 层：

```
┌─ L5 技能/助手层    .agents/skills/*.md、assistantActions 的 variablePrompt 步骤
├─ L4 AI 生成层       galleryAgentGeneration / storeSopGeneration（variable-prompt-skill 模式）/ 自动修复 / 排除文字策略
├─ L3 执行层          store.ts：提交校验 → 按槽位展开 → maxImagesPerRequest=1 → 尺寸自动调整
├─ L2 UI 层           InputBar 实时解析徽章（绿色"已启用"/琥珀色"格式有误"）+ 尺寸自适应
└─ L1 引擎层          src/lib/variablePrompt.ts（解析/校验/展开，纯函数、零依赖）
```

### 3.2 模板语法（引擎解析格式）

```
图片比例为16:9。生成{{主体}}，采用{{构图}}，背景{{背景}}。

可变项：
{{主体}}：悬浮耳机 / 佩戴中的耳机 / 桌面摆拍
{{构图}}：中心构图 / 左右分栏
{{背景}}：纯白 / 渐变灰
```

规则（由 `parseVariablePrompt` 强制校验）：
- `可变项：` 必须**单独占一行**（严格模式），否则报错；
- 每个变量**单独一行**，格式 `{{变量名}}：选项一 / 选项二`（`/` 或 `／` 分隔）；
- 变量名去重、选项去重；正文中出现但未定义的变量、定义了但正文未用的变量都会产生错误/警告；
- 组合数 = 各变量选项数之积（防溢出到 `Number.MAX_SAFE_INTEGER`）；
- 正文可声明 `图片比例为 X`（1:1/3:4/4:3/9:16/16:9），引擎会提取并驱动尺寸联动。

### 3.3 引擎实现要点（`variablePrompt.ts`，208 行，零依赖）

- **确定性种子哈希**：FNV-1a 变体（`hashString`），`renderVariablePromptBatch(prompt, count, seed)` 以任务 id 为种子——同一任务重跑结果一致；
- **多样度展开**：候选组合打分 = 相邻汉明距离×100 + 近 8 条窗口内最近距离×20 − 选项使用频次惩罚×12 − 候选序微扰，贪心挑选，确保相邻/相近组合尽量不同、选项池用均衡；
- 输出 `{ detected, enabled, body, variables, errors, warnings, combinationCount, aspectRatio }`，`enabled = 无错误且有正文使用到的变量`。

### 3.4 执行链路集成（store.ts，3 个接入点）

1. **提交校验**（`submitTaskWithData` 开头）：`parseVariablePrompt(prompt)` 检测到"可变项"但格式不合法 → toast 报错并**拦截提交**；
2. **尺寸联动**：`enabled && aspectRatio` 时把请求尺寸改写为 `calculateImageSize(inferSizeTier(params.size), aspectRatio)`（如 2K→16:9 = 2560x1440）；
3. **槽位展开**（任务执行器）：`renderedVariablePrompts = renderVariablePromptBatch(task.prompt, n, task.id)`，每个槽位 `resolveTaskPrompt(slotIndex)` 取一条展开结果；`maxImagesPerRequest = useFolderMode || variablePrompt.enabled ? 1 : apiMaxN` —— **变量提示词强制每请求 1 张**，保证每张图对应独立组合而不是同一提示词复制 n 份。

### 3.5 UI 集成（InputBar）

- 输入框下方状态行实时徽章：绿色"已启用变量提示词 · 16:9"（title 悬浮显示变量数与组合数）；琥珀色"变量提示词格式有误：<首个错误>"；
- `useEffect` 尺寸自适应：识别到宽高比且与当前尺寸档不匹配时自动 `setParams({ size })`（`getSizeTierForVariablePrompt` 保留 1K/2K/4K 档）；
- 与本地同源的"转换为变量"（`\u2060…\u2061` 行内变量标记 + 词库彩色标签）**互补不冲突**：行内变量是编辑期体验，`可变项` 块是批量展开语法。

### 3.6 AI 生成链路（L4，远程最有特色的部分）

- **技能资产类型 `variable-prompt-skill`**（SOP 中心新增资产类型）：`storeSopGeneration.ts` 以 `{ name, description, variablePrompt }` 三字段 schema 驱动 LLM，从参考图**反推变量提示词模板**；生成后 `parseVariablePrompt` 语法校验，失败自动带错误信息让 LLM 修复（最多 2 次）；
- **排除文字策略**（`variablePromptTextPolicy.ts`）："排除文字"开启时注入强制指令（变量名/选项禁止出现 文案/文字/标题/卖点/价格/Logo/OCR 等 16 类词），并自动在正文尾部追加完整排除句；违规直接抛错拒绝生成——这是为**电商图/菜品图等含文字场景**设计的合规闸门；
- **画廊 Agent 生成**（`galleryAgentGeneration.ts`）：5 档相似度（创意扩展→复刻），每档限定策略方向数，分析参考图后产出多个变量提示词模板资产，可再展开批量生图；
- **技能元指令**（`skillMetaInstructions.ts`）：把 `variablePrompt` 字段 schema、语法要求（`可变项：` 独立成块、`{{变量}}` 一一对应、至少 3 组可变项）写进 LLM 指令，保证模型输出可被引擎直接解析；
- **反推 SOP 控制器**（`reverseSopRunner.ts` + `types.ts` `ReverseSopControllerMeta`）：一个控制器任务串起"反推 SOP → 生成变量提示词模板 → 配额展开具体提示词 → 生成图片"四阶段，模板数不足时自动补齐，图片任务复用现有队列与恢复机制（`sopBatchRecovery`）；
- **助手动作**（`assistantActions`）：新增 `variablePrompt` 步骤角色（"生成变量提示词"），`matcher/runner/builtInActions` 均扩展，含广告合规过滤（`adCompliance` 会清洗 variablePrompt 中的违禁词）。

### 3.7 测试覆盖

引擎（`variablePrompt.test.ts`：语法、重复变量、未定义变量、组合展开）、文本策略、画廊生成、SOP 生成（variable-prompt 模式 + 自动修复）、SOP 中心（variable-prompt 执行模式）、词库应用、反推 SOP 相关均有单测；`InputBar` 的徽章渲染依赖大组件测试。

---

## 4. 设计评价

### 优点
1. **引擎纯净**：`variablePrompt.ts` 是零依赖纯函数模块，解析/校验/展开逻辑集中、可单测、可移植，是教科书式的"可复用内核"设计；
2. **全链路闭环**：从 AI 反推模板 → 语法强校验 → 尺寸联动 → 多样度展开 → 逐条请求，体验完整，且"格式错误直接拦截"避免了把 `{{}}` 裸奔进图片模型的脏数据；
3. **展开算法有质量意识**：汉明距离 + 使用频次惩罚的多样度策略，比随机/顺序组合更符合"批量裂变"诉求；
4. **合规闸门**：排除文字策略考虑到了图片模型会"画字"的现实问题，属于产品洞察。

### 不足 / 风险
1. **语法对 LLM 输出不友好**："可变项：必须单独占一行""每变量一行"等约束靠 prompt 指令 + 修复重试兜底，LLM 偶尔仍会产出不可解析结果（引擎只能报错，无法部分容错）；
2. **展开与任务模型耦合**：展开发生在执行器内、按槽位取用，任务记录里只存模板不存展开明细，重试/恢复时需重新展开（确定性种子保证了可复现，但排障时缺少"哪张图用了哪个组合"的持久化证据，仅靠 revisedPrompts 侧面记录）；
3. **组合爆炸无上限保护**：`combinationCount` 只做展示与溢出保护，用户仍可提交超大组合（如 5×5×5×5=625），需靠 n 限流兜底；
4. **文档缺失**：README 与 docs 均未系统介绍变量提示词语法（仅 .trae spec 与 SKILL.md 有说明），新用户上手成本高；
5. **仓库过新**：0 star、单次推送，无社区验证，部分代码（如 MCP、galleryAgentGeneration）未经广泛回归。

---

## 5. 结论

豆泡两年半与当前 DOUPAO **同源同栈、互有胜负**：远程的增量核心是"批量变量提示词"全链路（引擎 + 提交/执行集成 + AI 反推 + 合规策略 + 反推 SOP），这正是当前项目所缺的能力；而当前项目拥有远程没有的素材库、设计系统 v2 等更重的本地化资产。**两者不是"谁包含谁"，而是"各取所长"的关系**——合并的合理方向是把远程的变量提示词体系按层移植进当前项目（可行性详见《合并到当前项目的可行性分析》）。
