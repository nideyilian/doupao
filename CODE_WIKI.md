# GPT Image Playground Code Wiki

> 基于仓库源码生成的结构化项目说明。当前分析版本：`package.json` 中的 `0.6.18`。  
> 目标读者：准备维护、二次开发、排查问题或接入新图像服务商的开发者。

## 目录

1. [项目定位](#1-项目定位)
2. [整体架构](#2-整体架构)
3. [目录结构](#3-目录结构)
4. [主要模块职责](#4-主要模块职责)
5. [关键类型](#5-关键类型)
6. [关键函数与业务流程](#6-关键函数与业务流程)
7. [依赖关系](#7-依赖关系)
8. [数据存储与持久化](#8-数据存储与持久化)
9. [项目运行方式](#9-项目运行方式)
10. [测试与质量保障](#10-测试与质量保障)
11. [优缺点评述](#11-优缺点评述)
12. [维护建议](#12-维护建议)

---

## 1. 项目定位

GPT Image Playground（豆泡）是一个面向 AI 图像生成与编辑的 React + TypeScript 应用，同时支持浏览器/PWA 运行和 Electron 桌面端运行。项目核心能力包括：

- 文本生图、参考图生图、遮罩编辑。
- OpenAI 兼容接口（Images API / Responses API）、fal.ai 以及声明式自定义 HTTP 图像服务商。
- 画廊式任务管理、收藏夹、工作区标签页、批量下载。
- Agent 多轮对话生图，支持图片引用、批量图像工具、继续生成和可选 Web Search。
- 本地后处理（缩放、重压缩）、水印工作台、批量导出与分发。
- 日程自动化：按周编排收藏任务，定时或顺序触发执行。
- 浏览器 IndexedDB 本地存储，Electron 下补充本地文件保存、备份、自动更新。

项目实际是一个“前端重状态应用”：业务状态、任务生命周期、缓存、导入导出、Agent 流程、日程编排大多集中在 `src/store.ts`，底层服务商调用和数据存储被拆到 `src/lib/`。

---

## 2. 整体架构

### 2.1 分层视图

```text
用户界面
  App.tsx
  components/*
  hooks/*

全局状态与业务编排
  store.ts

业务能力库
  lib/api.ts
  lib/openaiCompatibleImageApi.ts
  lib/falAiImageApi.ts
  lib/agentApi.ts
  lib/apiProfiles.ts
  lib/db.ts
  lib/localSave.ts
  lib/schedule.ts
  lib/imagePostprocess.ts
  lib/watermarkWorkbench.ts
  lib/taskProgressDisplay.ts
  lib/generationStats.ts
  lib/prompt*.ts
  lib/mask*.ts
  lib/size.ts

运行平台
  Browser / PWA
  Electron main + preload + IPC

外部服务
  OpenAI-compatible Images API
  OpenAI-compatible Responses API
  fal.ai
  custom HTTP image providers
```

### 2.2 典型数据流

```text
用户输入 prompt / 参数 / 参考图
  -> InputBar / AgentWorkspace / ScheduleModal
  -> store action: submitTask / submitAgentMessage / runScheduleItem
  -> lib/api.ts 或 lib/agentApi.ts
  -> openaiCompatibleImageApi / falAiImageApi / custom provider
  -> API 返回图片、实际参数、修订提示词或队列任务 ID
  -> store 写入 TaskRecord / AgentConversation
  -> lib/db.ts 写 IndexedDB
  -> Electron 环境下 localSave.ts -> preload -> IPC -> 文件系统
  -> TaskGrid / DetailModal / Lightbox 等组件刷新展示
```

### 2.3 双运行时

- **浏览器端**：Vite 构建静态前端，IndexedDB 存储任务、图片、缩略图、Agent 对话和词库，生产环境注册 PWA service worker。
- **Electron 端**：`electron/main.ts` 创建窗口、配置自动更新；`electron/preload.ts` 通过 `contextBridge` 暴露有限 IPC；`electron/ipc-handlers.ts` 负责本地文件读写、备份和目录选择。

---

## 3. 目录结构

```text
.
|-- electron/
|   |-- main.ts              # Electron 主进程：窗口、自动更新、主 IPC 注册
|   |-- preload.ts           # 安全暴露 window.electronAPI
|   |-- preload.cjs          # 构建/运行使用的 CJS preload 产物
|   `-- ipc-handlers.ts      # 文件系统、本地保存、备份 IPC（含路径白名单）
|-- public/
|   |-- manifest.webmanifest # PWA manifest
|   |-- sw.js                # service worker
|   `-- app-icon.png
|-- scripts/
|   |-- mock-image-api.mjs   # 本地 mock 图像 API
|   |-- release-version.cmd  # 发布脚本（Windows CMD）
|   `-- release-version.ps1  # 发布脚本（PowerShell）
|-- src/
|   |-- main.tsx             # React 入口，注册/注销 service worker
|   |-- App.tsx              # 根组件，初始化设置和 store，挂载主要区域和弹窗
|   |-- store.ts             # Zustand store，核心业务逻辑（约 6.8k 行）
|   |-- types.ts             # 全局类型定义
|   |-- index.css            # Tailwind 和全局样式
|   |-- components/          # UI 组件
|   |-- hooks/               # 自定义 React Hooks
|   `-- lib/                 # API、存储、图片处理、参数处理等工具模块
|-- docs/                    # 辅助文档（含 superpowers 计划与规格）
|-- images/                  # 本地保存/示例生成图片
|-- prompts/                 # 本地保存的提示词
|-- tasks/                   # 本地保存的任务 JSON
|-- package.json
|-- vite.config.ts
|-- tsconfig.json
|-- tailwind.config.js
|-- postcss.config.js
|-- dev-proxy.config.example.json
|-- index.html
`-- start.bat
```

---

## 4. 主要模块职责

### 4.1 入口与应用壳

| 文件             | 职责                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.tsx`   | 安装移动端 viewport 修正与 chunk 加载恢复；生产环境注册 `sw.js`；开发环境注销旧 service worker；挂载 React 根组件。                                                             |
| `src/App.tsx`    | 应用初始化、URL 参数导入、远程自定义服务商配置导入、store 初始化、主题应用、防 StrictMode 重复初始化、Electron 首次备份提醒和每周备份；按 `appMode` 切换画廊/Agent/后处理视图。 |
| `vite.config.ts` | 配置 React、Electron 主进程和 preload 构建；注入 `__APP_VERSION__` 和 `__DEV_PROXY_CONFIG__`；开发期按 `dev-proxy.config.json` 启用 `/api-proxy/` 代理。                        |

### 4.2 状态中心

`src/store.ts` 是项目中最大的文件（约 6.8k 行），也是业务核心。它使用 Zustand + persist 管理：

- 应用设置、API profiles、自定义服务商。
- 工作区标签页与分组、输入草稿、参数、遮罩草稿。
- 画廊任务 `TaskRecord` 的创建、执行、重试、删除、收藏、清理。
- 图片内存 LRU 缓存和缩略图回填。
- IndexedDB 读写和迁移。
- fal.ai / 自定义异步任务恢复。
- Agent 对话、分支、轮次、工具调用和停止控制。
- 日程自动化（rows/items/运行周/执行）。
- 本地后处理参数与实际参数合并。
- ZIP 导入导出、Electron 本地保存。
- UI 弹窗、Toast、上下文菜单、收藏夹、词库等状态。

重要导出包括：

| 导出                                                     | 说明                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------ |
| `useStore`                                               | 全局 Zustand store。                                                     |
| `initStore()`                                            | 启动时从 IndexedDB 加载任务和 Agent 对话，恢复可恢复任务，执行状态迁移。 |
| `submitTask()` / `submitTaskWithData()`                  | 画廊/日程模式提交图像任务。                                              |
| `submitAgentMessage()`                                   | Agent 模式提交多轮对话请求。                                             |
| `retryTask()` / `reuseConfig()` / `editOutputs()`        | 任务重试、复用配置、输出图编辑。                                         |
| `removeTask()` / `removeMultipleTasks()` / `clearData()` | 删除和清理数据。                                                         |
| `exportData()` / `exportDataToPath()` / `importData()`   | ZIP 备份导出与导入。                                                     |
| `runScheduleItem()`                                      | 执行单个日程项。                                                         |
| `ensureImageCached()` / `ensureImageThumbnailCached()`   | 图片和缩略图缓存读取。                                                   |
| `markInterruptedOpenAIRunningTasks()`                    | 启动时把遗留的 OpenAI running 任务标记为中断错误。                       |

### 4.3 API 与服务商适配

| 文件                                  | 职责                                                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `src/lib/api.ts`                      | 统一分发入口 `callImageApi`：按 active profile 分派到 fal.ai 或 OpenAI 兼容适配器。                                     |
| `src/lib/openaiCompatibleImageApi.ts` | OpenAI 兼容 Images/Responses API 调用；自定义 HTTP provider submit/edit/poll 映射；流式部分图处理；自定义异步任务恢复。 |
| `src/lib/falAiImageApi.ts`            | fal.ai 队列提交、结果读取、错误解析和恢复查询。                                                                         |
| `src/lib/imageApiShared.ts`           | API 公共类型、图片 URL 转 data URL、错误解析、实际参数提取、并发与重试工具。                                            |
| `src/lib/apiProfiles.ts`              | API profile 默认值、规范化、校验、provider 切换、导入合并、自定义服务商 manifest 兼容。                                 |
| `src/lib/devProxy.ts`                 | 同源 `/api-proxy/` 代理配置规范化与请求 URL 构造。                                                                      |

核心分发逻辑：

```ts
export async function callImageApi(opts: CallApiOptions): Promise<CallApiResult> {
  const profile = getActiveApiProfile(opts.settings)
  if (profile.provider === 'fal') return callFalAiImageApi(opts, profile)
  return callOpenAICompatibleImageApi(opts, profile, getCustomProviderDefinition(opts.settings, profile.provider))
}
```

### 4.4 Agent 模式

| 文件                                | 职责                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/components/AgentWorkspace.tsx` | Agent 对话界面、轮次编辑、工具结果展示、引用图片和输出资源面板。                            |
| `src/lib/agentApi.ts`               | 构造 Responses API 消息和工具；解析流式输出；实现 `generate_image_batch` 等自定义工具调用。 |
| `src/lib/agentImageReferences.ts`   | Agent 轮次图片引用 ID、`<ref>` 标签、引用解析和替换。                                       |
| `src/lib/agentWebSearch.ts`         | 从 Responses 输出中收集 Web Search 调用状态。                                               |
| `src/store.ts`                      | Agent 对话树、分支、重发、重新生成、停止、任务同步到画廊。                                  |

Agent 的关键设计是“对话轮次 + 画廊任务”双写：模型生成出的图片会作为 `TaskRecord` 进入画廊，同时也挂到对应 `AgentRound.outputTaskIds` 上。这样 Agent 输出既能保留对话上下文，也能复用画廊的预览、下载、收藏和本地保存能力。

### 4.5 数据存储

| 文件                       | 职责                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/lib/db.ts`            | 原生 IndexedDB 封装；object stores 包括 `tasks`、`images`、`thumbnails`、`agentConversations`、`wordLibrary`。 |
| `src/lib/localSave.ts`     | 渲染进程侧 Electron 文件能力封装，调用 `window.electronAPI`。                                                  |
| `electron/ipc-handlers.ts` | 主进程实际文件读写、备份、ZIP 保存、目录选择，含 `sessionAllowedRoots` 路径白名单。                            |

图片存储使用 SHA-256 data URL hash 作为 ID，减少重复图片占用。缩略图单独存储，并带 `thumbnailVersion`，用于后续缩略图策略升级。

### 4.6 图片、遮罩与尺寸

| 文件                          | 职责                                                                       |
| ----------------------------- | -------------------------------------------------------------------------- |
| `src/lib/canvasImage.ts`      | 加载图片、读取尺寸、data URL 转 Blob、遮罩预览合成、遮罩与目标图尺寸校验。 |
| `src/lib/mask.ts`             | 遮罩目标校验、遮罩 alpha 覆盖率分类、空/全遮罩防护。                       |
| `src/lib/maskPreprocess.ts`   | 遮罩编辑目标图预处理，限制工作区尺寸并规整到 16 的倍数。                   |
| `src/lib/size.ts`             | 预设尺寸、比例解析、尺寸规范化、1K/2K/4K 目标尺寸计算。                    |
| `src/lib/imagePostprocess.ts` | 生成后本地缩放、格式转换、按目标大小重压缩，合并实际参数。                 |

### 4.7 提示词与词库

| 文件                                    | 职责                                                           |
| --------------------------------------- | -------------------------------------------------------------- |
| `src/lib/promptGenerator.ts`            | 词库变量渲染、随机抽取、可复现随机种子、词条规范化。           |
| `src/lib/promptImageMentions.ts`        | 输入框中的 `@图n`、词库变量等引用插入、识别、重排和 API 替换。 |
| `src/components/WordLibrarySidebar.tsx` | 词库分组、词条编辑、变量预览和随机提示词辅助。                 |
| `src/components/RandomPromptModal.tsx`  | 基于词库的随机提示词生成。                                     |
| `src/components/VarEntryEditor.tsx`     | 词库词条批量编辑弹窗。                                         |

### 4.8 日程自动化

| 文件                                | 职责                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/lib/schedule.ts`               | 日期键、周起止、日程项到期检测、补齐策略、输出路径解析等纯函数。                         |
| `src/components/ScheduleModal.tsx`  | 周日历 UI：拖拽收藏任务到单元格、设置数量/时间、复制上周、启停运行周。                   |
| `src/components/ScheduleRunner.tsx` | 定时检查当前运行周的到期日程项，调用 `runScheduleItem` 提交生成。                        |
| `src/store.ts`                      | `ScheduleState` 管理、`runScheduleItem` 通过 `submitTaskWithData` 复用收藏任务配置执行。 |

### 4.9 后处理与水印

| 文件                                      | 职责                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| `src/components/PostprocessWorkspace.tsx` | 水印工作台 UI：图片上传、水印图层编辑、预设管理、批量导出与多路径分发。 |
| `src/lib/watermarkWorkbench.ts`           | 水印图层数据结构、预设、导出任务构造、Canvas 合成逻辑。                 |
| `src/lib/imagePostprocess.ts`             | 生成图后处理：缩放、重压缩、格式转换。                                  |

### 4.10 任务进度与统计

| 文件                             | 职责                                                                |
| -------------------------------- | ------------------------------------------------------------------- |
| `src/lib/taskProgressDisplay.ts` | 将 `TaskRecord` 映射为卡片标签、详情标题/描述/原因/色调。           |
| `src/lib/generationStats.ts`     | 按今天/7天/30天统计生成总数、成功、失败、耗时，并按工作区标签汇总。 |
| `src/components/Header.tsx`      | 顶部栏展示 `GenerationStatsBar`，支持点击切换统计范围。             |

### 4.11 UI 组件

组件按功能划分较清晰，但部分组件体量很大：

| 组件                       | 行数约 | 职责                                                                 |
| -------------------------- | -----: | -------------------------------------------------------------------- |
| `InputBar.tsx`             |  2900+ | 主输入区：prompt、参考图、文件夹批量、参数、后处理、遮罩入口、提交。 |
| `SettingsModal.tsx`        |  3100+ | 多页设置：通用、Agent、API 配置、数据、备份、关于。                  |
| `FavoriteCollections.tsx`  |  1500+ | 收藏夹视图、选择器、管理弹窗、输出路径设置。                         |
| `AgentWorkspace.tsx`       |  1400+ | Agent 模式主工作区。                                                 |
| `DetailModal.tsx`          |  1200+ | 任务详情、实际参数、进度、错误、重试与输出操作。                     |
| `MaskEditorModal.tsx`      |  1100+ | Canvas 遮罩编辑器。                                                  |
| `PostprocessWorkspace.tsx` |   900+ | 水印/后处理工作台。                                                  |
| `ScheduleModal.tsx`        |   800+ | 周日程编排弹窗。                                                     |
| `TaskCard.tsx`             |   850+ | 任务卡片、状态、缩略图、收藏和选择。                                 |
| `TaskGrid.tsx`             |   400+ | 任务瀑布流/网格、筛选、多选和拖选。                                  |
| `Lightbox.tsx`             |   700+ | 大图预览、切换、下载。                                               |
| `WorkspaceTabBar.tsx`      |   700+ | 多工作区标签与分组。                                                 |
| `WordLibrarySidebar.tsx`   |   600+ | 词库侧边栏。                                                         |

### 4.12 Hooks

| Hook                            | 职责                                           |
| ------------------------------- | ---------------------------------------------- |
| `useAutoUpdate`                 | 封装 Electron 自动更新状态、检查、下载、安装。 |
| `useVersionCheck`               | Web 环境版本检查（GitHub Releases）。          |
| `useDragSelect`                 | 任务网格拖拽框选。                             |
| `useTooltip` / `useHintTooltip` | 悬浮提示和引导提示。                           |
| `useCloseOnEscape`              | ESC 关闭弹窗。                                 |
| `usePreventBackgroundScroll`    | 弹窗打开时阻止背景滚动。                       |

### 4.13 Electron 层

| 文件                       | 职责                                                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `electron/main.ts`         | 创建 `BrowserWindow`；设置 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: false`、`webSecurity: false`；注册自动更新事件；生产环境 5 秒后自动检查更新。 |
| `electron/preload.ts`      | 暴露 `window.electronAPI`，包括文件保存、目录选择、备份、自动更新和版本读取。                                                                                          |
| `electron/ipc-handlers.ts` | 注册 `fs:*`、`store:*`、`update:*`、`app:get-version` IPC handler；执行主进程文件系统操作；通过 `assertAllowedPath` 限制可写路径。                                     |

preload 暴露的主要能力：

- 文件系统：`saveImage`、`saveJson`、`saveText`、`ensureDir`、`pathJoin`、`checkExists`、`readDir`、`readFileBuffer`、`openInExplorer`。
- 本地路径：`getLocalSavePath`、`setLocalSavePath`、`getDefaultPath`、`getDesktopPath`。
- 备份：`readJsonText`、`writeJsonText`、`listBackups`、`checkBackupHasData`、`restoreFromBackup`、`deleteBackup`、`saveZipBuffer`。
- 更新：`onUpdateStatus`、`checkForUpdate`、`downloadUpdate`、`installUpdate`、`getAppVersion`。

---

## 5. 关键类型

关键类型集中在 `src/types.ts`。

### 5.1 配置类型

| 类型                       | 说明                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `ApiMode`                  | `'images' \| 'responses'`，区分经典 Images API 和 Responses API。                                              |
| `AppMode`                  | `'gallery' \| 'agent' \| 'postprocess'`，区分画廊、Agent、后处理模式。                                         |
| `ThemeMode`                | `'light' \| 'dark'`，手动主题模式。                                                                            |
| `ApiProfile`               | 单个 API 配置，包括 provider、baseUrl、apiKey、model、timeout、apiMode、代理、流式、并发和重试参数。           |
| `AppSettings`              | 应用全局设置，包括旧版单配置字段、多 profile、自定义 providers、偏好设置、Agent 设置、备份设置、词库派生规则。 |
| `CustomProviderDefinition` | 声明式自定义 HTTP 图像服务商 manifest。                                                                        |
| `ZipDownloadRoute`         | ZIP 下载入口来源枚举。                                                                                         |

### 5.2 任务类型

| 类型                                 | 说明                                                                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `TaskParams`                         | 图像参数：`size`、`quality`、`output_format`、`output_compression`、`moderation`、`n`，以及后处理字段（`postprocess_*`）。       |
| `TaskRecord`                         | 画廊任务记录，包含请求参数、实际参数、输入图、遮罩、输出图、状态、错误、耗时、收藏、Agent 关联、日程输出路径等。                 |
| `TaskProgressStage`                  | 任务生命周期阶段：`queued`、`requesting`、`relay-received`、`previewing`、`generating`、`saving`、`recovering`、`completed` 等。 |
| `BatchItemStatus` / `BatchItemError` | 并发多图时逐张状态与错误。                                                                                                       |
| `InputImage`                         | UI 层输入图，保存 IndexedDB 图片 ID 和预览 data URL。                                                                            |
| `InputImageFolder`                   | 文件夹批量输入，保存路径与图片 ID 列表。                                                                                         |
| `MaskDraft`                          | 遮罩编辑草稿，记录目标图和遮罩 data URL。                                                                                        |
| `FavoriteCollection`                 | 收藏夹。                                                                                                                         |

### 5.3 Agent 类型

| 类型                   | 说明                                                                 |
| ---------------------- | -------------------------------------------------------------------- |
| `AgentConversation`    | 一段 Agent 对话，包含轮次、消息、当前活动轮次。                      |
| `AgentRound`           | 一轮用户输入到助手输出的生成流程，可形成分支树。                     |
| `AgentMessage`         | 用户或助手消息，可关联输入图和输出任务。                             |
| `ResponsesOutputItem`  | Responses API 输出项，兼容文本、函数调用、函数输出、图像结果和注释。 |
| `ResponsesApiResponse` | Responses API 原始响应结构。                                         |

### 5.4 日程类型

| 类型                       | 说明                                                                   |
| -------------------------- | ---------------------------------------------------------------------- |
| `ScheduleItem`             | 日程项：日期、行、时间、数量、来源收藏任务、运行状态、上次任务 ID。    |
| `ScheduleRow`              | 日程行（如“任务 1”）。                                                 |
| `ScheduleState`            | 日程状态：rows、items、activeWeekStart、modalOpen、runningWeekStarts。 |
| `ScheduleCompletionAction` | 日程项完成动作：`waiting` / `done` / `supplement` / `error`。          |

### 5.5 存储与导出类型

| 类型                                    | 说明                                              |
| --------------------------------------- | ------------------------------------------------- |
| `StoredImage`                           | IndexedDB 中的原图记录。                          |
| `StoredImageThumbnail`                  | IndexedDB 中的缩略图记录。                        |
| `ExportData`                            | ZIP 备份里的 `manifest.json` 结构（当前版本 3）。 |
| `WorkspaceTab` / `WorkspaceTabGroup`    | 多工作区标签页和分组。                            |
| `WordLibraryGroup` / `WordLibraryEntry` | 词库分组与词条。                                  |
| `WatermarkLayer` / `WatermarkPreset`    | 水印图层与预设。                                  |

---

## 6. 关键函数与业务流程

### 6.1 应用初始化

入口：`src/App.tsx`

1. 读取 URL query，通过 `buildSettingsFromUrlParams` 生成设置补丁。
2. 如果 URL 中包含设置参数，调用 `clearUrlSettingParams` 清理地址栏。
3. 如果默认 API URL 指向可导入配置，调用 `loadCustomProviderSettingsFromUrl` 并 `mergeImportedSettings`。
4. 使用 `window.__storeInitialized` 防止 React StrictMode 下重复调用 `initStore()`。
5. Electron 下检查是否需要提示恢复备份或创建首次备份。
6. Electron 下每 7 天自动导出一次 ZIP 备份到桌面。

### 6.2 画廊任务提交

入口：`submitTask()` / `submitTaskWithData()`。

核心步骤：

1. 从当前工作区标签页读取 prompt、参数、输入图、遮罩草稿。
2. 通过 `validateApiProfile` 校验 API 配置。
3. 处理复用任务 API 配置、图片引用、遮罩顺序和参数兼容。
4. 创建 `TaskRecord`，状态为 `running`，`progressStage` 为 `queued`。
5. 调用 `executeTask(taskId)`。
6. 成功后将返回图片经 `processAndStoreGeneratedImage` 后处理并写入 IndexedDB，更新 `outputImages`、`actualParams`、`actualParamsByImage`、`revisedPromptByImage`。
7. 失败时记录错误；如果部分成功则保留成功项和单项错误。
8. Electron 环境下异步保存图片、任务 JSON、prompt 文本。

### 6.3 API 调用与并发重试

入口：`callImageApi()` → `executeTask()`。

分派规则：

- `profile.provider === 'fal'`：调用 `callFalAiImageApi`。
- 其他情况：调用 `callOpenAICompatibleImageApi`，其中 `provider === 'openai'` 走内置 OpenAI 兼容逻辑，自定义 provider 走 manifest 映射。

`executeTask` 内部使用 `executeInBatches`：

- 并发数来自 `profile.maxConcurrent`，默认 5，最大 999。
- 重试次数来自 `profile.maxRetries`，默认 3，最大 10。
- 仅对 429、5xx、rate limit、timeout、network、常见 ECONN 错误重试。
- 指数退避上限 30 秒。
- 多图请求按 `apiMaxN` 分批（Images API 最大 10，Responses API 最大 1）。
- 文件夹模式：n 张图循环使用文件夹内图片作为参考图，每张独立请求。

### 6.4 本地后处理

入口：`processAndStoreGeneratedImage()` → `postprocessGeneratedImage()`。

- 若 `postprocess_resize_enabled` 为 true，按 `postprocess_size` 解析宽高并在 Canvas 上缩放。
- 若 `postprocess_compress_enabled` 为 true，按 `postprocess_format` / `postprocess_max_size_kb` 重新编码；JPEG/WebP 使用二分法质量控制。
- 输出格式与实际尺寸回写为 `actualParams`，与原 API 实际参数合并展示。

### 6.5 Agent 对话提交

入口：`submitAgentMessage()`。

核心步骤：

1. 创建用户消息和新 `AgentRound`。
2. 根据当前活动轮次构造对话路径，保证分支上下文正确。
3. 解析 prompt 中的图片引用，替换为 `<ref id="...">` 或 `<removed_ref>`。
4. 调用 `callAgentResponsesApi`，传入 Responses API tools。
5. 流式解析文本、图像、function_call 和 function_call_output。
6. 遇到 `generate_image_batch` 时调用 `callBatchImageSingle` 并把结果转为画廊任务。
7. 写回 `AgentConversation`，同步 output task ids。
8. 使用 `AbortController` 支持 `stopAgentResponse()`。

### 6.6 Agent 分支

关键函数：

| 函数                                     | 说明                                        |
| ---------------------------------------- | ------------------------------------------- |
| `getAgentRoundPath()`                    | 从根到指定轮次生成一条活动路径。            |
| `getActiveAgentRounds()`                 | 获取当前对话 active round 对应路径。        |
| `deleteAgentRoundFromConversation()`     | 删除某一轮及其子分支，并修复 active round。 |
| `getAgentSiblingRounds()`                | 获取同父轮次分支。                          |
| `getAgentBranchLeafId()`                 | 从任一轮次找到其分支叶子节点。              |
| `remapAgentRoundMentionsForPathChange()` | 分支切换时修正文本中的轮次图片引用。        |

### 6.7 日程自动化执行

入口：`runScheduleItem()`。

1. 校验来源收藏任务存在且为收藏状态。
2. 从原任务恢复输入图、文件夹、遮罩。
3. 通过 `resolveScheduleOutputTarget` 决定输出路径（显式路径 > 收藏夹子目录）。
4. 以 `submitTaskWithData` 提交，n 为日程项数量。
5. 更新日程项状态、`lastRunKey`、`lastTaskIds`。
6. `ScheduleRunner` 组件周期性调用 `getDueScheduleItemIds` 检测到期项并触发执行。

### 6.8 IndexedDB 存储

关键函数：

| 函数                                                         | 说明                                        |
| ------------------------------------------------------------ | ------------------------------------------- |
| `storeImage(dataUrl, source)`                                | 计算 hash，去重写入原图，并尝试生成缩略图。 |
| `getImage()` / `putImage()` / `deleteImage()`                | 原图 CRUD。                                 |
| `getImageThumbnail()` / `putImageThumbnail()`                | 缩略图读写。                                |
| `getAllTasks()` / `putTask()` / `batchPutTasks()`            | 任务读写。                                  |
| `getAllAgentConversations()` / `replaceAgentConversations()` | Agent 对话读写。                            |
| `getWordLibraryState()` / `putWordLibraryState()`            | 词库存储。                                  |
| `batchDeleteImages()` / `batchGetImages()`                   | 批量图片操作。                              |

### 6.9 导入导出

导出：

1. 从 IndexedDB 读取任务和图片。
2. 从 store 读取 settings、Agent 对话、收藏夹、词库、日程。
3. 将图片转为 `images/{id}.{ext}`，缩略图转为 `thumbnails/{id}.{ext}`。
4. 生成 `manifest.json`，当前 manifest 版本为 3。
5. 使用 `fflate.zipSync` 生成 ZIP。
6. 浏览器端触发下载；Electron 端可保存到指定路径。

导入：

1. 使用 `fflate.unzipSync` 解压 ZIP。
2. 解析 `manifest.json`。
3. 恢复图片、缩略图、任务、Agent 对话、日程。
4. 通过 `mergeImportedSettings` 合并配置，避免重复 profile 和 provider。
5. 合并词库、收藏夹、工作区标签。

---

## 7. 依赖关系

### 7.1 生产依赖

| 依赖                                           | 用途                           |
| ---------------------------------------------- | ------------------------------ |
| `react` / `react-dom`                          | UI 框架。                      |
| `zustand`                                      | 全局状态管理与持久化。         |
| `@fal-ai/client`                               | fal.ai 图像服务调用。          |
| `electron-updater`                             | Electron 自动更新。            |
| `fflate`                                       | ZIP 导入、导出、备份。         |
| `react-markdown` / `remark-gfm` / `streamdown` | Markdown 和流式文本渲染。      |
| `core-js`                                      | `Array.at` 等旧环境 polyfill。 |

### 7.2 开发依赖

| 依赖                                                     | 用途                             |
| -------------------------------------------------------- | -------------------------------- |
| `vite` / `@vitejs/plugin-react`                          | 前端构建与开发服务器。           |
| `vite-plugin-electron` / `vite-plugin-electron-renderer` | Electron 主进程和 preload 构建。 |
| `typescript`                                             | 类型检查。                       |
| `tailwindcss` / `postcss` / `autoprefixer`               | 样式构建。                       |
| `vitest`                                                 | 单元测试。                       |
| `electron` / `electron-builder`                          | 桌面端运行与打包。               |

### 7.3 内部依赖图

```text
App.tsx
  -> store.ts
    -> lib/api.ts
      -> lib/openaiCompatibleImageApi.ts
      -> lib/falAiImageApi.ts
      -> lib/imageApiShared.ts
    -> lib/agentApi.ts
      -> lib/agentImageReferences.ts
      -> lib/agentWebSearch.ts
    -> lib/apiProfiles.ts
    -> lib/db.ts
    -> lib/localSave.ts
      -> window.electronAPI
        -> electron/preload.ts
          -> electron/ipc-handlers.ts
    -> lib/promptImageMentions.ts
    -> lib/promptGenerator.ts
    -> lib/mask.ts
    -> lib/canvasImage.ts
    -> lib/paramCompatibility.ts
    -> lib/imagePostprocess.ts
    -> lib/schedule.ts
    -> lib/generationStats.ts
    -> lib/taskProgressDisplay.ts
    -> lib/watermarkWorkbench.ts

components/*
  -> useStore selectors/actions
  -> lib/* small helpers

hooks/*
  -> browser APIs or electronAPI wrappers
```

---

## 8. 数据存储与持久化

### 8.1 浏览器 IndexedDB

`src/lib/db.ts` 使用原生 IndexedDB，主要 store：

- `tasks`：画廊任务。
- `images`：原始图片 data URL 及元数据。
- `thumbnails`：列表缩略图。
- `agentConversations`：Agent 对话。
- `wordLibrary`：词库分组与词条。

图片 ID 使用 data URL 的 SHA-256 hash。若浏览器 crypto 不可用，代码包含降级 hash。

### 8.2 Zustand persist

`src/store.ts` 中的 store 使用 Zustand persist 存储设置、UI 状态、工作区、词库、日程、收藏夹等。大型图片和任务主体主要放 IndexedDB，避免 localStorage 过大。

### 8.3 Electron 文件系统

Electron 环境下额外保存：

- `tasks/{taskId}.json`
- `prompts/{taskId}.txt`
- `agent/{conversationId}.md`
- 自动备份 JSON / ZIP
- 素材库（Electron；库根 = `localSavePath` 设置值，默认 `userData/local-saves`）：
  - `cache-images/` 内容寻址原图（文件名 = SHA-256 内容哈希，一份原图多处引用）
  - `db/asset-kernel.sqlite` SQLite 权威目录（启动时自动从旧 `userData` 位置迁入，完整性校验通过才移动）
  - `thumbs/` 磁盘缩略图缓存（可重建；读取顺序 磁盘 → IndexedDB → 生成，懒迁移双写）
  - `backups/` ZIP 备份默认位置（导出对话框默认打开此处）
  - `library.json` 库元数据（布局版本、迁移标记）

库根是一个自包含文件夹：**退出应用后复制它 = 完整备份素材库**。所有库数据路径统一收敛在 `electron/library-paths.ts`（`getLibraryPaths`）；应用配置（`local-settings.json`、`gpt-image-playground.json`、`asset-api.json` 等）仍留在 `userData`。

`fs:write-json-text` 采用 `.tmp` 写入后 rename，并在写入前保留 `.bak`。它还会按 `backupInterval` 节流创建 `backups/` 快照，最多保留最近 30 个备份槽位。IPC 层通过 `assertAllowedPath` 限制可写路径在 userData、desktop、documents、downloads、pictures 以及用户配置的 localSavePath 内。ZIP 备份导出对话框默认打开库根 `backups/`（`getBackupExportDefaultPath`）。

### 8.4 跨版本数据连续性（旧版数据自动迁移）

> 数据韧性说明：IndexedDB 的大值记录（图片 dataUrl、缩略图）由 Chromium 以磁盘 blob 文件存放（`IndexedDB/<origin>.indexeddb.blob/`）。若 blob 文件缺失（磁盘清理、不完整备份恢复等），读取对应记录会报 `Data lost due to missing file. Affected record should be considered irrecoverable`——该记录不可恢复。`src/lib/db.ts` 对图片/缩略图的单条与批量读取做了容错：这类记录按"缺失"跳过（`getImage` 返回 `undefined`、`batchGetImages` 跳过该条、迁移游标继续），避免单条坏记录让素材索引补齐、备份导出等整条链路中断；非 blob 类错误仍正常抛出。

`userData` 目录名跟随打包后 `productName`（当前 `DOUPAO V2`），历史上曾使用「豆泡」「gpt-image-playground」等名称。若用户从旧名称版本升级，新版本会在全新 userData 下启动，词条库、标签工作区、收藏夹等在界面上会"全部消失"（数据实际仍在旧目录）。

主进程启动早期（窗口创建前）执行 `electron/legacy-data-migration.ts` 的一次性迁移：

- `migrateLegacyAppDataIfNeeded()`：当前 userData 缺少可读状态文件时，从 `%APPDATA%` 下的旧版本目录（`豆泡`/`doupao`/`gpt-image-playground` 等，取状态文件最新者）**复制**（只复制不移动）状态文件、`local-settings.json`、`local-saves/`、旧布局 `asset-kernel.sqlite*`、`IndexedDB/`、`Local Storage/`、`backups/` 到当前 userData；各项目仅当目标缺失时才复制；成功后写 `.legacy-data-migrated.json` 标记，之后不再执行。
- `ensureStateFileReadable()`：状态文件与 `.bak` 均缺失/损坏时，从 `userData/backups/` 最近一次快照恢复，避免单次写坏导致界面"空数据"。

渲染端持久化存储路径由 `fs:get-state-file-path`（固定 `userData/gpt-image-playground.json`）提供，不再依赖对默认库根路径的字符串裁剪，防止未来库根语义变化导致状态文件漂移。

---

## 9. 项目运行方式

### 9.1 环境要求

- Node.js 建议 18+。
- npm。
- 桌面端打包需要对应平台的 Electron builder 环境。

### 9.2 安装依赖

```bash
npm install
```

### 9.3 Web 开发

```bash
npm run dev
```

Vite 默认端口通常为 `5173`。开发服务器配置了 `host: true`，允许局域网访问。

### 9.4 本地 CORS 代理

复制示例配置：

```bash
cp dev-proxy.config.example.json dev-proxy.config.json
```

编辑 `dev-proxy.config.json` 后重启 `npm run dev`。前端开启 API 代理后，请求会通过 `/api-proxy/*` 转发到目标 API。

### 9.5 Mock 图像 API

```bash
npm run mock:api
```

对应说明在 `docs/mock-image-api.md`。

### 9.6 生产构建

```bash
npm run build
```

构建命令实际执行：

```bash
tsc -b && vite build
```

产物输出到 `dist/`。

### 9.7 Electron 开发与打包

```bash
npm run electron:dev
npm run electron:preview
npm run electron:build
```

`package.json` 中的 Electron builder 配置：

- Windows：`nsis` 和 `portable`，x64。
- macOS：`dmg`。
- Linux：`AppImage`。
- 发布目标：GitHub Releases，`owner: nideyilian`，`repo: doupao`。

### 9.8 发布脚本

```bash
npm run release
npm run release:dry
```

`release` 会执行 Electron 打包并尝试发布；`release:dry` 只打包不发布。

---

## 10. 测试与质量保障

### 10.1 测试命令

```bash
npm test
```

或：

```bash
npm run test:watch
```

### 10.2 类型检查

```bash
npx tsc --noEmit
```

### 10.3 已覆盖的测试文件

当前仓库包含以下 Vitest 测试（部分列举）：

- `src/store.test.ts`
- `src/lib/agentApi.test.ts`
- `src/lib/agentImageReferences.test.ts`
- `src/lib/api.test.ts`
- `src/lib/apiProfiles.test.ts`
- `src/lib/chunkRecovery.test.ts`
- `src/lib/customProviderConfigUrl.test.ts`
- `src/lib/devProxy.test.ts`
- `src/lib/falAiImageApi.test.ts`
- `src/lib/generationStats.test.ts`
- `src/lib/imagePostprocess.test.ts`
- `src/lib/mask.test.ts`
- `src/lib/maskPreprocess.test.ts`
- `src/lib/paramCompatibility.test.ts`
- `src/lib/promptGenerator.test.ts`
- `src/lib/promptImageMentions.test.ts`
- `src/lib/schedule.test.ts`
- `src/lib/size.test.ts`
- `src/lib/taskGridWindow.test.ts`
- `src/lib/taskProgressDisplay.test.ts`
- `src/lib/theme.test.ts`
- `src/lib/updateReleaseNotes.test.ts`
- `src/lib/urlSettings.test.ts`
- `src/lib/viewportTransform.test.ts`
- `src/lib/watermarkWorkbench.test.ts`
- `src/components/ViewportTooltip.test.ts`

测试重点集中在纯逻辑模块、API 参数兼容、提示词解析、遮罩、尺寸、dev proxy、Agent API、日程、后处理、水印、store 迁移/辅助逻辑。UI 组件和 Electron IPC 目前缺少自动化测试。

---

## 11. 优缺点评述

### 11.1 优点

1. **功能完整度高**  
   项目不仅是一个简单生图表单，而是覆盖了配置管理、画廊、收藏、批量、遮罩、Agent、日程、后处理/水印、导入导出、桌面端本地保存和自动更新。

2. **API 适配能力强**  
   内置 OpenAI 兼容和 fal.ai，同时用 `CustomProviderDefinition` 支持声明式 HTTP provider，适合接入不同图像服务。

3. **本地优先的数据设计**  
   图片和任务默认保存在 IndexedDB，Electron 下还会落盘，隐私和离线可用性较好。

4. **性能意识明确**  
   原图和缩略图分离、内存 LRU 缓存、缩略图回填、懒加载重组件、并发限制和重试策略都说明项目已经考虑真实使用场景。

5. **类型系统覆盖核心领域**  
   `types.ts` 定义了任务、配置、Agent、日程、导出格式、自定义 provider 等关键结构，方便维护者理解数据边界。

6. **测试覆盖了不少关键纯逻辑**  
   API profile、prompt、mask、Agent 引用、dev proxy、store 辅助逻辑、schedule、postprocess、watermark 都有测试。

### 11.2 缺点与风险

1. **`store.ts` 过大**  
   `store.ts` 已超过 6.8k 行，承担了状态、业务编排、数据迁移、Agent、导入导出、本地保存、日程、后处理等大量职责。维护成本高，局部修改容易影响远处逻辑。

2. **大组件偏多**  
   `SettingsModal.tsx`、`InputBar.tsx`、`FavoriteCollections.tsx`、`AgentWorkspace.tsx`、`DetailModal.tsx`、`PostprocessWorkspace.tsx` 都超过千行。UI 状态、表单逻辑和展示逻辑耦合较强，后续功能扩展会变慢。

3. **Electron 安全取舍需要注意**  
   主窗口配置了 `webSecurity: false`，这能缓解跨域和图片加载问题，但扩大了桌面端攻击面。虽然 `contextIsolation: true` 和 `nodeIntegration: false` 保留了基础隔离，仍建议审视远程内容和外链处理。

4. **错误与用户文案混杂在业务逻辑里**  
   许多中文提示、错误转换、toast 文案直接散落在 store 和 API 模块中，不利于统一维护、国际化或文案审校。

5. **Electron IPC 路径约束仍偏宽松**  
   IPC 层提供通用读写能力，虽然已有 `assertAllowedPath` 白名单，但白名单包含多个用户目录。对未来插件或远程内容能力需要更细粒度的作用域校验。

6. **UI 自动化测试不足**  
   当前测试主要是纯逻辑。对遮罩编辑器、任务流、设置导入、Agent 分支、日程执行等复杂交互缺少端到端验证。

---

## 12. 维护建议

1. **拆分 `store.ts`**  
   优先按领域拆出任务、Agent、图片缓存、导入导出、收藏夹、工作区标签、词库、日程、后处理等 slice 或 action 模块。先移动纯函数和独立 action，不急着重构状态结构。

2. **拆分超大组件**  
   `InputBar` 可拆为 prompt 输入、参考图管理、参数面板、文件夹批量、后处理、遮罩入口；`SettingsModal` 可按 tab 拆分；`PostprocessWorkspace` 可按水印编辑器/预设/分发拆分。

3. **强化 Electron IPC 边界**  
   对保存、备份、恢复路径做 workspace/userData/customSavePath 范围校验；避免未来引入远程页面或插件后出现任意文件写入风险。

4. **给关键用户流程补 E2E 测试**  
   建议覆盖：创建任务、导入导出、设置 profile、自定义 provider 导入、遮罩编辑、Agent 图片引用、日程执行、水印导出。

5. **建立文档维护规则**  
   当修改 `types.ts`、`store.ts`、`lib/apiProfiles.ts`、`lib/openaiCompatibleImageApi.ts`、`lib/agentApi.ts`、日程/后处理/水印模块或 Electron IPC 时，同步更新本 Code Wiki。

6. **抽离文案与错误映射**  
   将 toast、错误标题、自动更新友好提示集中到独立模块，减少业务逻辑噪声。

---

## 快速导航

| 需求              | 优先阅读                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 了解应用启动      | `src/main.tsx`、`src/App.tsx`                                                                                                 |
| 修改画廊任务流程  | `src/store.ts` 的 `submitTask*`、`executeTask`、`src/lib/api.ts`                                                              |
| 接入新图像服务商  | `src/lib/apiProfiles.ts`、`src/lib/openaiCompatibleImageApi.ts`、`docs/custom-provider-llm-prompt.md`                         |
| 修改 Agent 行为   | `src/lib/agentApi.ts`、`src/lib/agentImageReferences.ts`、`src/store.ts` 的 Agent 区域                                        |
| 修改本地存储      | `src/lib/db.ts`、`src/lib/localSave.ts`、`electron/ipc-handlers.ts`                                                           |
| 修改桌面端        | `electron/main.ts`、`electron/preload.ts`、`package.json` 的 `build` 字段                                                     |
| 修改日程自动化    | `src/lib/schedule.ts`、`src/components/ScheduleModal.tsx`、`src/components/ScheduleRunner.tsx`                                |
| 修改后处理/水印   | `src/lib/imagePostprocess.ts`、`src/lib/watermarkWorkbench.ts`、`src/components/PostprocessWorkspace.tsx`                     |
| 修改任务进度/统计 | `src/lib/taskProgressDisplay.ts`、`src/lib/generationStats.ts`、`src/components/Header.tsx`、`src/components/DetailModal.tsx` |
| 修改 UI           | `src/components/*`，尤其 `InputBar`、`TaskGrid`、`TaskCard`、`SettingsModal`                                                  |
| 排查配置问题      | `src/lib/apiProfiles.ts`、`src/lib/urlSettings.ts`、`src/lib/devProxy.ts`                                                     |

---

## 13. 生成素材库（Generated Asset Library）

> 首版设计：`docs/superpowers/specs/2026-08-14-generated-asset-library-design.md`
> 实施计划：`docs/superpowers/plans/2026-08-14-generated-asset-library.md`（M1–M7）｜产品状态：`PRODUCT.md`

### 13.1 领域模型

- `GeneratedAssetOrigin`（`src/types.ts`）：一张生成图片对应的可管理素材，`id` 与 `StoredImage.id`（内容哈希）一致。
  - `origins[]`：生成来源快照（任务输出槽位、提示词、请求/实际参数、模型、输入图、遮罩、工作区名），任务删除后仍可追溯。
  - 来源快照参数**解耦**：`requestedParams`（任务级请求参数，全图共享）+ `actualParams`（任务级实际差异）+
    `imageActualParams`（图级专属实际差异，来自任务 `actualParamsByImage[imageId]`，任务删除后仍可追溯）
    - `seed`（每槽位专属，回退任务级）——由 `src/lib/generatedAssetOrigin.ts` 的 `buildGeneratedAssetOrigin` 写入、
      `assetLibraryModel.ts` 归一化透传；展示由 `AssetParamBreakdown` 分组呈现（共享 / 专属）。
  - `parentAssetIds`：输入中已是生成素材的图片，构成衍生链。
  - 收藏、评分、项目（`collectionIds`）均为用户元数据，与任务解耦；`tagIds` 为旧标签体系兼容字段（无界面入口，数据保留）。
- `AssetCollection`：虚拟项目，支持多级树（`parentId`，可整体移动层级）；删除项目时子项目提升到父级。
- `AssetTag`：兼容类型（旧标签体系已下线，界面无入口；备份导入仍会写入，数据原样保留）。
- `AssetTombstone`：永久删除墓碑，防止启动回填/迁移让已删除素材复活。
- `AssetUsageEvent`：素材进入真实工作流（参考图、后处理、导出、复用）的行为记录，供推荐与统计。
- 备注：`GeneratedAsset.notes`（纯文本），详情面板防抖保存，并纳入 SQLite FTS 与关键词检索。
- 桌面端扩展：`AssetBlob` / `AssetVersion`（`currentVersionId`、`machineIndex`：文本向量 + 感知哈希），由
  Electron `asset-catalog.ts`（SQLite）管理。

### 13.2 数据流与生命周期（SQLite 权威）

- **权威存储**：Electron 下素材领域（`GeneratedAsset` / `AssetCollection` / `AssetTag` / `AssetTombstone` / blob / 版本 /
  使用记录）以主进程 SQLite（`asset-catalog.ts`）为唯一权威，渲染端所有读写经 IPC（`assetLibraryRepository.ts` 的
  `catalogApi()` 后端；浏览器/测试回退 IndexedDB）。启动时一次性回填旧版 IndexedDB 数据
  （meta 门控 `idb-asset-library-v1`，会话内 `legacySyncDone` 门控）。
- 自动归档：任务写库后经 `src/lib/assetSyncQueue.ts` 串行同步；启动时 `assetReconciliation.ts` 补齐；
  迁移 `generatedAssetLibraryV1`（游标续跑）与 `legacyFavoritesToAssets`（旧收藏 → 收藏/项目）。
- 引用图：`src/lib/imageReferenceGraph.ts` 统一任务、素材、工作区、Agent、SOP、策略、后期/合成等引用；
  `src/lib/assetPurge.ts` 仅当无拥有型（blocking）引用时才允许永久删除，阻断项返回给 UI 展示原因
  （`planPurgeGeneratedAssets` 预览 + `AssetPurgeModal` 确认）；引用图与删除计划基于 `hydrateFull()`
  （SQLite 全量），不再受分页窗口影响。
- 永久删除：`asset-catalog:purge` 在 SQLite 单事务内完成「删素材 + 写墓碑」（FTS/向量/版本级联清理），
  随后同步 IndexedDB 任务输出补丁与旧记录（失败不影响权威结果），最后删除图片字节；墓碑读取走 SQLite，
  崩溃窗口内素材也不会“复活”。
- 删除语义：删除任务不删素材；素材进回收站仍保留原图；清空回收站才释放无引用原图。
- 备份：`hydrateFull()` 从 SQLite 全量导出（`asset-catalog:export-all`），不再受 ≤200 条分页窗口限制；
  `dataExport.ts` / `backupImport.ts` 导出导入素材、项目、墓碑（标签作为兼容数据一并保留）；`version: 5` 写入点统一为常量。

### 13.3 前端结构（`src/features/assetLibrary/`）

> **单一画廊模式**：画廊（gallery）不再区分「图片 / 生成批次」两个互斥模式——`galleryViewMode` 仅作为主 store
> 的兼容字段保留（无 UI 入口，不再驱动路由）。画廊永远渲染 `AssetLibraryWorkspace`，其中「图片」与「生成批次」
> 是同一模式下的两种**展现方式**（`viewStyle: 'images' | 'batch'`，持久化）：图片样式内含网格/列表
> （`viewMode`），批次样式把当前查询结果按生成批次分组（`AssetBatchView`）。

- `store.ts`：独立 Zustand store（资产元数据来自仓库水合（Electron 下为 SQLite），仅 UI 偏好持久化；
  含 `moveCollection`、`emptyTrashAssets`、`selectAllVisibleAssets`、`replaceSelection`、`similarToAssetId`、
  `viewMode`（grid/list）、`viewStyle`（images/batch）、`includeSubcollections`（「包含子文件夹」递归查询，默认关）、
  `batchFocusTaskId`（批次视图聚焦任务，不持久化）、
  `openViewer/setViewerAsset/closeViewer`（全屏查看器状态）、
  `savedFilters`（智能文件夹：addSavedFilter/removeSavedFilter/applySavedFilter，保存 scope+query+filters 快照，随 UI 偏好持久化））。
- `query.ts`：纯函数 `queryAssets`（范围、搜索、筛选（含 `colorLabel` 颜色标签、`collectionIds` 递归项目列表）、
  五种排序、侧栏计数，万级性能测试）。
- `AssetLibraryWorkspace.tsx`：三栏工作区（左侧栏 / 图片网格或列表或批次视图 / 右侧停靠详情），窄屏 Drawer，Ctrl+A 全选；
  按 `viewStyle` 切换 `AssetBatchView` / （`viewMode` 切换 `AssetGrid` / `AssetListView`），双击素材均进入全屏查看器；
  **「包含子文件夹」**：项目 scope 且开关开启时，把自身与全部后代集合 id 展开为 `filters.collectionIds`
  （`collectionDescendantIds`，同时用于内存查询与 SQLite 查询），母文件夹内容 = 整棵子树素材；
  **子文件夹区块**（`SubfolderStrip.tsx`）：进入文件夹且有直接子文件夹时，内容区顶部展示子文件夹封面卡片
  （封面缩略图 + 名称 + 素材数，点击进入），与开关正交（两种状态下都保留，搜索/筛选时隐藏）；
  开关默认关闭 → 先看子文件夹结构 + 本文件夹图片，开启后图片区递归展开全部下级素材；
  **Eagle 式全局快捷键**（`src/hooks/useAssetLibraryShortcuts.ts`）：空格/Enter 打开查看器（焦点在素材元素上时由
  元素自身处理）、Esc 取消选择、Delete/Backspace 选中素材移入回收站（回收站视图不响应）、1–5/0 评分、F 收藏、
  C 轮换颜色标签（`cycleColorLabel`：无→红→…→灰→无）、Ctrl/Cmd+F 聚焦搜索框；查看器内 Esc/空格 关闭、
  ←/→ 切换、1–5/0 评分、F 收藏、C 轮换颜色。
- `AssetParamBreakdown.tsx`：**参数解耦展示**——素材详情/查看器的参数区分两组：① 任务级共享参数
  （模型/配置、尺寸、质量、格式、压缩、参考模式、数量、后处理、审核、合规，来自 `origin.requestedParams` +
  任务级 `origin.actualParams` 差异徽章）；② 本图专属参数（seed、图级实际生效差异 `origin.imageActualParams`
  （来自任务 `actualParamsByImage[imageId]`，如并发多图中单图尺寸/seed）、文件名信息）。只读展示、不依赖任务存活。
- `src/lib/assetAutoArchive.ts`：**批次 → 项目文件夹自动归档**——把词库（提示词库）树状文件夹镜像到素材库
  「项目」树：批次快照 `promptGroup` → `getFolderPath` 得到根到叶的名称路径 → `ensureFolderChain` 在项目树
  逐级查找/创建同名文件夹（复用不重复，`order` 追加）→ 该批次产出素材（快照 taskIds/batchIds → 任务输出，
  任务已删除的按 origins 反查）自动加入最深层文件夹（幂等，只追加不删改）；触发：素材库水合完成后的启动补齐
  （`autoArchiveBatchAssets`，有新增时 toast）+ 批次任务同步后的即时归档（`archiveTaskToBatchFolder`，轻量路径）。
- `AssetBatchView.tsx`：**生成批次展现方式**——把当前查询结果按「SOP 批次 → 任务 → 已删除任务」三级聚合
  （纯函数 `src/lib/assetBatchGrouping.ts`：`buildAssetBatchGroups(assets, tasksById, snapshotsById)`、
  顶部 `buildAssetBatchOverview` 状态速览：分组/任务/素材数 + 完成/生成中/失败，替代已移除的任务导航概览）；
  提供**两种展现形式**（`groupedViewStyle`，工具栏「视图」下拉的「分组 / 任务卡片」两项，分别对应 tiles / cards）：
  - **cards（任务卡片）**：固定卡高 200px + 响应式列数的绝对定位虚拟化网格（`getTaskCardColumns`）——
    SOP 批次聚合为一张 `SopBatchTaskCard`（SOP 名、进度摘要、封面图、查看批次/重跑/删除），普通任务沿用原
    `TaskCard`（提示词、参数徽章、重试/复用/编辑输出/删除），任务已删除的素材归入「任务已删除」组
    （`OrphanBatchCard`：封面图 + 提示词摘要 + 工作区，点击/Enter 打开查看器）。**交互沿用发布版**：
    单击任务卡 → `setDetailTaskId(task.id)` 打开全局 `DetailModal`（展示该任务全部生成图片）、单击 SOP 批次卡 →
    打开 `SopBatchDetailModal`（展示全部提示词与生成图片）、单击孤儿卡 → 打开全屏查看器；Ctrl/⌘ 点击切换组选择。
  - **tiles（图片砖·列表行）**：组头（标题 + 状态徽章 + 复用/编辑输出/再次生成/删除 + `TaskParamSummary`
    参数摘要行）+ 组内图片砖网格（同一套 `AssetTile`，列数固定「标准」密度）或列表行（`AssetListRow`，随
    `viewMode` 切换）。
    操作：批次详情（`SopBatchDetailModal`）/任务详情、复用配置、编辑输出、重跑批次、删除任务（删除确认沿用主
    store `setConfirmDialog`）；「查看来源任务」经 `setViewStyle('batch') + setBatchFocusTaskId(taskId)` 定位并高亮
    分组（3 秒后自动清除）；选择与图片网格一致：**整卡/整组作为框选视觉单元**（`useDragSelect` 的
    `getItemIds`（卡片形式：命中卡片 = 组内全部素材）/ `getItemId`（图片砖形式：单张砖）），Ctrl/⌘ 点击切换组
    选择，点击空白清除选择；两种形式都不随紧凑/标准/大图密度变化（列数只随视口宽度自适应），工具栏「布局」下拉
    （紧凑/标准/大图/列表，由原密度 + 网格/列表两个控件合并）在图片视图提供全部四项、分组视图仅提供网格/列表、
    任务卡片视图隐藏。
- `AssetGrid.tsx`：虚拟瀑布流（只加载缩略图，hover 防抖加载全图预览），`useDragSelect` 框选 + Ctrl/⌘ 连选；
  双击打开大图；方向键/Home/End 键盘导航；三档密度（紧凑/标准/大图，`gridDensity` 持久化）；
  卡片**本体不设 draggable**（保证从卡片上按下即可圈选多选），拖出改为右上角 hover **拖拽手柄**
  （`data-drag-handle`，`asset-image:${imageId}` 数据，可拖入生成输入框作为参考图或拖到侧栏项目归档）；
  Eagle 式 hover 快捷栏（收藏星标、七色标签点、加入参考图）；颜色标签以卡片左上角圆点呈现。
- `AssetListView.tsx`：Eagle 式列表视图（固定 64px 行高绝对定位虚拟滚动 + 列头：预览/提示词/尺寸/模型/评分/生成时间，
  行内显示收藏、颜色圆点；双击查看器、右键菜单、Enter/空格键操作）。
- `AssetViewer.tsx`：Eagle 式全屏查看器（滚轮缩放 1–8×、拖拽平移、双击缩放切换、←/→/Esc 键、顶部计数；
  底部「类似图片」条（`recommend`）、右侧信息面板（评分、收藏、七色标签、元数据、
  `NotesEditor`、提示词、`DerivedChain`），窄屏「信息」开关切换；打开时清空选区）。
- `AssetBatchBar.tsx`：批量收藏、评分、颜色标签、项目、下载、回收站 / 恢复 / 永久删除。
- `AssetPurgeModal.tsx`：永久删除确认，预览并展示引用冲突。
- `AssetCardMenu.tsx`：右键菜单（大图、详情、复制、收藏、评分、项目、参考图、后处理、复用、下载、回收站）。
- `AssetDetailPanel.tsx`：大图、评分、收藏、来源快照、项目、来源任务定位（切批次视图并聚焦）、打开文件位置；
  支持前后切换（桌面端嵌入 `WordLibrarySidebar` 的“详情”标签，窄屏为工作区 Drawer）；导出
  `NotesEditor` / `DerivedChain` 供查看器复用。
- 词条库侧栏（`WordLibrarySidebar.tsx`）：**仅保留「词条 / 详情」两个 Tab**——「任务导航」Tab 已移除
  （`GalleryTaskNavigator.tsx` 删除，任务列表/状态速览由批次视图承担；失效的 `galleryActiveTaskId` 状态一并清理），
  「查看来源任务」入口（素材详情/查看器）与「任务导航」跳转职责统一由批次视图 + `batchFocusTaskId` 承担。
- `AssetLibrarySidebar.tsx`：素材库左侧导航——**头部标题 + 条目筛选框**（本地过滤系统范围/智能文件夹/项目，
  命中父节点保留整棵子树，纯函数 `src/lib/assetSidebarUtils.ts`：`filterCollectionTree`）；
  系统范围导航（NavList）+ **智能文件夹**（可折叠，点击应用、hover 删除）+ 项目树
  （颜色圆点、行内色板、多级创建）；项目节点计数在「包含子文件夹」开启时显示**递归计数**
  （`computeRecursiveCollectionCounts`：直接数 + 全部后代数，母文件夹可见子文件夹体量）；树节点**右键菜单**
  （新建子项/重命名/移动到…/设置颜色/删除，与 hover「更多」按钮共用 `TreeItemMenuItems`）；**拖放归档**：
  素材卡片（`text/plain` = `asset-image:${id}`，`effectAllowed='copyMove'`，从文件夹 scope 拖出时经
  `ASSET_SOURCE_DATA_TYPE` 携带源文件夹 id）拖到项目节点 = **移动（剪切）**：移除源文件夹归属并加入目标
  （`applyAssetsToCollection`，保留其他归类）；从全部/最近等非文件夹视图拖出 = 添加到项目（合并去重 + toast）；
  **目标文件夹已有相同内容**（imageId 相同，含同一素材已在目标）时弹确认框三选一：仍然添加 / 跳过重复 /
  替换（移除目标内同 imageId 旧素材的该文件夹归属再放入新素材，`findDuplicateAssetIds` + `commitDrop`）；
  拖到输入框作参考图仍为复制语义（`InputBar` 全局 dragover 设 `dropEffect='copy'`）；激活态与 NavList 统一（`--ds-color-selection-*` + 左侧强调条）；
  **宽度拖拽**（右缘把手，208–400px，`localStorage` 持久化 `--asset-library-panel-width`）；项目折叠状态持久化；
  空状态虚线按钮；`buildCollectionTree` 仍从本文件导出（测试兼容）。
- `AssetLibraryToolbar.tsx`：搜索、筛选（收藏/评分/方向/来源/服务商/模型/日期/宽度/**颜色标签**）、排序、
  **「视图」下拉**（`ViewPresetControl`：图片 / 分组 / 任务卡片，合并原「不分组/分组」与「任务卡片/图片」两个控件）、
  **「布局」下拉**（`LayoutPresetControl`：紧凑 / 标准 / 大图 / 列表，合并原密度与网格/列表两个控件，任务卡片视图下隐藏）、
  **「包含子文件夹」开关**（`IncludeSubcollectionsSwitch`，仅项目 scope 显示，Eagle 式 toggle，持久化，默认关）、
  **保存为智能文件夹**（`SaveFilterButton`）、全选/清空回收站/导入图片/查重。
- `AssetPickerModal.tsx`：跨工作区选择历史素材作为参考图（画廊 / Agent / SOP / 合成）。
- `src/lib/assetCommands.ts`：素材动作服务（参考图、后处理、复用配置、导出、衍生记录），桌面端可被
  Electron `asset-mcp.ts` / `asset-api-server.ts` 的外部命令驱动。
- 旧版画廊（`TaskGrid` / `SearchBar` / `FavoriteCollectionsView`）不再由路由挂载：其数据（任务、SOP 批次快照、
  收藏夹、词库树）全部原样保留，任务管理能力（详情、复用、编辑输出、重跑、删除）已并入批次视图；
  `galleryViewMode` 字段与持久化值保留不动（兼容，不迁移、不清理）。

### 13.4 双端差异

- 浏览器 / PWA：IndexedDB 全量元数据水合，`queryAssets` 内存查询；语义推荐条不可用。PWA 资源（sw.js/manifest）已随 Electron 化移除。
- Electron：`assetCatalogQuery` 走 SQLite（FTS + 文本向量 + 感知哈希混合检索、游标分页、侧栏计数缓存），
  并记录 `AssetUsageEvent` 支持上下文推荐与「找相似图片」（`similarToAssetId`，右键菜单/详情入口）；
  `openInExplorer`、流式 ZIP、安全删除仅桌面端可用。
- Electron 原生增强（IPC，见 `electron/ipc-handlers.ts` 与 `electron/preload.ts`）：
  - `storage:get-disk-usage`：cache-images 原图、库根 backups 与 thumbs 的真实磁盘字节统计（`getDiskStorageUsage`），
    替代浏览器 `navigator.storage.estimate` 的失真数据；
  - `clipboard:write-image`：主进程 `nativeImage` + `clipboard.writeImage`，无浏览器剪贴板权限限制；
  - `notification:show`：主进程原生系统通知，点击聚焦窗口；
  - `fs:select-save-path`：通用原生保存对话框（单图下载）；
  - `backup:read-zip-manifest` / `backup:read-zip-entry`：备份流式导入（`electron/backup-zip-reader.ts`，
    只读 EOCD + 中央目录，按条目解压并做 CRC 校验与路径安全检查），渲染端不再整包载入 ZIP；
  - `asset-catalog:export-all`：SQLite 全量导出（`hydrateFull`），修复桌面端备份只含 ≤200 条素材的问题；
  - `app:get/set-close-to-tray` + 托盘（`electron/main.ts`）：关闭窗口最小化到系统托盘，后台任务继续运行；
  - 素材批量下载在 Electron 下打包为原生 ZIP（`exportZipToPath`），保存位置由用户选择。

### 13.5 集成层（Phase 2/3）

- **`doupao://` 深链接**（`electron/main.ts`）：`open?assetId=` 打开素材详情、`search?q=` 执行搜索、`import?path=` 导入本地图片；
  Windows/Linux 经 `setAsDefaultProtocolClient` + `second-instance` argv，macOS 经 `open-url` 事件，`app:deep-link` 分发到渲染端。
- **本地 HTTP API 写能力**（`electron/asset-api-server.ts`，token 鉴权）：新增
  `GET/POST /v1/collections`、`GET /v1/tags`、`POST /v1/imports`；
  写操作经 `runCommand` 由渲染端执行（`ExternalAssetCommand` 扩展 createCollection/importExternalFiles）。
- **MCP**（`electron/asset-mcp.ts`）：`run_asset_command` 工具枚举同步扩展（组织/导入命令 + 可选参数 name/parentId/color/paths）。
- **外部图片导入**（`src/lib/externalAssetImport.ts`）：工具栏「导入图片」与网格拖拽（或深链接/API 路径）→ 内容哈希去重、
  以 `origins: []` 的独立素材入库（含缩略图与磁盘原图）；`AssetDuplicateModal`（感知哈希 Hamming ≤ 8bit 分组，
  保留一张、其余一键回收站，`asset-catalog:near-duplicates`）。
- **衍生链**（详情面板）：`asset-catalog:derived-assets`（上游 parentAssetIds + 下游产物缩略图链，点击跳转）。

### 13.6 后续候选

- Eagle 式时间线视图（按生成/整理时间流式浏览）；
- 智能集合树（保存筛选为虚拟树节点/嵌套）；
- 项目树同级拖拽排序；
- 批量改名、版本对比视图、目录监视（chokidar 常驻）、XMP sidecar；
- Eagle 库导入、`cache-images` 物理目录迁移、云同步与团队共享（不进入当前数据迁移承诺）。
