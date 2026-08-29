# src/store.ts 拆分方案（11,468 行单文件 → 分片 + 独立 actions）

> 目标：把 `src/store.ts`（约 11.5K 行，全项目最大单文件）拆成可维护的模块，同时保持对外 API 完全兼容，任何阶段都能通过 `tsc + vitest + build` 验证。
> 现状：`AppState` 接口 1750–2612 行，`create<AppState>()(...)` 内联 actions 2613–约 3700 行，其余 3700+ 行为模块级编排函数（`submitTask`/`submitAgentMessage`/`purgeGeneratedAssets`/`importData`/`removeTask` 等，均通过 `useStore.getState()` 访问状态）。

---

## 目标架构

```text
src/store/
  index.ts          # 唯一对外入口：re-export useStore 与全部公共函数（兼容旧 import 路径）
  types.ts          # AppState、领域类型、slice 接口（从 store.ts 迁出）
  slices/           # zustand 分片：每个 slice 一个文件，StateCreator<AppState>
    settingsSlice.ts
    gallerySlice.ts      # 任务、参数、输入图、筛选、选择、详情/灯箱
    agentSlice.ts        # 会话、轮次、Agent 提交
    favoritesSlice.ts
    scheduleSlice.ts
    wordLibrarySlice.ts
    dialogSlice.ts       # toast、confirm、各类弹窗状态
  actions/          # 模块级编排函数（不在 store 内部，import useStore）
    submitTask.ts
    agentFlow.ts
    purgeAssets.ts
    importExport.ts
    taskManagement.ts
  lib/              # 从 store.ts 抽出的纯函数/自包含模块
    imageCache.ts
    taskProfiles.ts
    agentRounds.ts
    persistedState.ts
    favoriteCollections.ts
src/store.ts        # 过渡期兼容垫片：`export * from './store/index'`
```

---

## 分阶段实施（每阶段结束必须全绿：`npx tsc -b && npx vitest run && npm run build`）

### Stage 0 — 基线 + 垫片骨架
- 建立 `src/store/index.ts` / `types.ts` 骨架，`src/store.ts` 改为 `export * from './store/index'`，先原样 re-export 当前实现。
- 目的：打通目录结构与导入路径，为后续迁移提供安全网。此阶段零行为变化。

### Stage 1 — 抽取纯函数（无 store 访问，风险最低，先行）
这些函数当前就在 store.ts 里但不读写 store 状态，抽到 `src/store/lib/` 或 `src/lib/`：
- 图片缓存族：`getCachedImage` / `cacheImage` / `getCachedThumbnail` / `ensureImageCached` / `ensureImageThumbnailCached` / `prefetchImageThumbnails` / `subscribeImageThumbnail`（缓存状态自包含，可整体搬走）
- 任务画像：`getCodexCliPromptKey` / `getTaskApiProfile` / `markInterruptedOpenAIRunningTasks` / `showCodexCliPrompt` / `getErrorToastMessage`
- 收藏夹纯函数：`getTaskFavoriteCollectionIds` / `getFavoriteCollectionTitle` / `ALL_FAVORITES_COLLECTION_ID` 等常量
- 持久化：`migratePersistedState` / `getPersistedState`（注意与 persist partialize 的依赖）
- Agent 纯函数：`getAgentRoundPath` / `getActiveAgentRounds` / `remapAgentRoundMentionsForPathChange` / `deleteAgentRoundFromConversation` / `getAgentSiblingRounds` / `getAgentBranchLeafId`
- 词库：`getUniqueWordLibraryEntryKey`
- 迁移相关：`ensureImageStorageMigrated` / `retryGeneratedAssetLibraryMigration` 中不触 store 的部分
- 做法：搬到新文件 → `src/store.ts` 顶部 `export { ... } from './store/lib/...'` 保持兼容 → 删除旧定义。

### Stage 2 — create() 拆分为 zustand slices（核心步骤，最大工作量）
- 将 `create<AppState>()((set, get) => ({...}))` 内的 actions 按域拆成 `createSettingsSlice` / `createGallerySlice` / `createAgentSlice` / `createFavoritesSlice` / `createScheduleSlice` / `createWordLibrarySlice` / `createDialogSlice`，每个签名 `(set, get) => Partial<AppState>`（或 `StateCreator<AppState>`）。
- 组装：`create<AppState>()((...a) => ({ ...createSettingsSlice(...a), ...createGallerySlice(...a), ... }))`。
- **跨 slice 调用**：统一走 `get()`（所有 slice 共享同一 set/get），禁止 slice 之间直接 import 状态。
- 每拆一个 slice：跑一遍 vitest（`src/store.test.ts` 110 个用例是主要回归网），确保行为一致。**一次只拆一个 slice，其余保持内联**，逐步替换。
- 风险点：initialState 去重（多个 slice 不要重复定义同名初始字段）；persist `partialize` 白名单不能漏；`useStore.subscribe`/selector 的字段引用不变量。

### Stage 3 — 模块级编排函数独立成 actions
`submitTask` / `submitTaskWithData` / `submitAgentMessage` / `regenerateAgentAssistantMessage` / `purgeGeneratedAssets` / `planPurgeGeneratedAssets` / `importData` / `exportData` / `removeTask` / `retryTask` / `reuseConfig` / `editOutputs` / `clearData` / `moveTasksToWorkspaceTab` 等只通过 `useStore.getState()`/`setState()` 与状态交互，抽到 `src/store/actions/*.ts`，从 `src/store/index.ts` 导入 `useStore`。
- 这些函数不需要存在于 store 内部——抽走后 store.ts 的 create 调用体量大幅下降。
- 保持签名与导出名不变，调用方（components/features）零改动。

### Stage 4 — 收口
- `src/store.ts` 保留为纯 re-export 垫片（或删除并全局改 import —— 建议保留垫片，避免 200+ 导入点的一次性改动）。
- **解决循环依赖**：当前 `src/store.ts` 静态 import `./features/assetLibrary/store`（line 96），而素材库 store 又动态 `import('../../store')`（15 处）来打破环。拆分后主 store 不再静态 import 素材库 store（改为在 actions 里按需动态引入或注入依赖），素材库 store 对主 store 的访问改为**静态 import 窄接口**（只 import 需要的 `useStore` 类型/工具），彻底消除动态 import——这也是本次测试抖动（`pasteCollection` 中 `await import('../../store')` 在高并发下偶发返回未初始化命名空间）的架构根源。

---

## 回归护栏

1. 每个 Stage 结束：`npx tsc -b && npx vitest run && npm run build` 必须全绿。
2. `src/store.test.ts`（110 用例）+ `src/features/assetLibrary/store.test.ts`（77 用例）是核心回归网。
3. 迁移顺序遵守"先抽纯函数、再拆 slices、最后拆编排函数"，任何一步失败可单独回退。
4. 不改变任何组件/feature 的 import 路径（依赖 `src/store.ts` 垫片），直到 Stage 4 评估是否全局改路径。

## 建议的拆分顺序（按风险递增）

1. Stage 1 纯函数抽取（1–2 天，收益：文件减小 ~15%）
2. Stage 2 先拆 dialogSlice + settingsSlice（边界最清晰，无跨域耦合）
3. Stage 2 再拆 favoritesSlice + scheduleSlice + wordLibrarySlice
4. Stage 2 最后拆 gallerySlice + agentSlice（最大、耦合最深，放在测试网最稳时）
5. Stage 3 actions 化（机械但量大，约 3–4K 行）
6. Stage 4 循环依赖清理 + 收口
