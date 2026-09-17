# DOUPAO 全仓体检报告

> 范围：`src/`（174,356 行 / 550 文件）+ `electron/`（11,854 行 / 51 文件）+ 构建与仓库卫生
> 版本基线：`v0.8.19`（`edc7db4`）
> 方法：静态审计 + 逐条源码复核。所有结论均附 `文件:行号`，未核实的标「需实测」。

---

## 结论先行

**这个项目的工程纪律是偏上的。** 先说好话，因为是硬数据：

| 健康度指标 | 实测 |
| --- | --- |
| `TODO` / `FIXME` / `HACK` | **0** |
| `@ts-ignore` / `@ts-expect-error` | **0** |
| `any` 使用 | **2**（均在 `electron/ipc-guard.ts`） |
| `eslint-disable` | **15**，分布在 13 个文件，无集中滥用 |
| 被跳过的测试（`.skip`/`.todo`/`xit`） | **0** |
| 测试文件数 | **234**（约 2,247 个用例） |
| 安全面（IPC 守卫 / 路径遍历 / Zip Slip / CSP / contextIsolation / 密钥加密） | **全部通过，无 P0** |
| 死 import / 死符号检查 | ❌ **全网关闭**（`tsconfig.json:19-20`、`eslint.config.js:46`） |

所以**不用担心的是**：代码脏、类型逃逸、格式混乱、测试是假的。这几项在同体量项目里都属于上游水平。

**但有一条必须先摆在前面**：

> **v0.8.19 对外宣称的「生成完成那一刻不再卡界面」（`RELEASE.md`）在实际代码里没有落地。**
> 缩略图异步编码只对 grid 显示通道生效，**图片入库主路径 `src/lib/db.ts:1521` 仍是同步 `canvas.toDataURL`**，
> 而它服务 `storeImage` 的全部 **19 个**调用点 —— 每张图落库都要冻结一次主线程。
> 证据是 `git show 72706a7 -- src/lib/db.ts`：diff 里只新增了 import，**没有替换调用点**。
> 而 `db.ts:31` 那个从未被调用的 `canvasToWebpDataUrl` import，就是"改到一半"留下的化石。

除了这条，剩下值钱的是三类：① 状态所有权分裂；② 若干静默失败路径；③ 仓库与构建产物卫生。

**最高性价比的一件事**：`src/lib/db.ts:1521` 改一行。它连带影响 **19 处** 图片入库调用点，
且改动所需的基础设施（`canvasToWebpDataUrl`）已经就绪并已测过。

---

# 一、P1 —— 必修（有可观测后果）

## P1-1 v0.8.19 对外宣称的「生成完成不再卡界面」没有真正落地 —— 主入库路径仍是同步 `toDataURL`

这是本次体检**最需要立刻处理的一条**，因为它不是"还没做"，而是**已经写成"做完了"却实际没落地**。

**现场**（`src/lib/db.ts:1506-1524`，`git status` 干净，即 HEAD = `edc7db4` 的真实内容）：

```ts
async function createImageThumbnail(dataUrl: string): Promise<Omit<StoredImageThumbnail, 'id'>> {
  ...
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  return {
    thumbnailDataUrl: canvas.toDataURL('image/webp', THUMBNAIL_QUALITY),  // ← 1521 行，同步，未改
    width, height, thumbnailVersion: THUMBNAIL_VERSION,
  }
}
```

**证据链（三步，可自行复核）**

1. **_commit message_ 说了改**：`git show 72706a7` 的提交正文第 4 条
   「缩略图编码改 `canvas.toBlob`（移出渲染主线程）… 真机帧探针实测 5 张连续编码的主线程冻结 553.8ms → 32ms」。
2. **但 diff 里只有 import**：`git show 72706a7 -- src/lib/db.ts | grep toDataURL`
   命中的只有 `+import { canvasToWebpDataUrl, createImageThumbnailDataUrl } from './canvasImage'`（新增于 `db.ts:31`），
   **没有任何一行 `- thumbnailDataUrl: canvas.toDataURL(...)`**。调用点从未被替换。
3. **化石还在**：`src/lib/db.ts:31` 至今 import 了 `canvasToWebpDataUrl`，而全文件仅在 `872` 行用了另一个函数
   `createImageThumbnailDataUrl` —— **`canvasToWebpDataUrl` 是一个从头到尾没被调用过的死 import**，
   它正是"改到一半"留下的指纹。

**为什么这件事严重**：这是 `storeImage` 的唯一入库路径（`db.ts:1181`）：

```ts
if (!existing) {
  const thumbnail = await safeCreateImageThumbnail(dataUrl)   // ← 每张新图必调 → 1521 同步编码
  await putImageRecords({ id, dataUrl: localPath ? undefined : dataUrl, ... })
}
```

`storeImage(` 全仓有 **19 个调用点**，分布在 9 个文件：`InputBar.tsx`、`MaskEditorModal.tsx`、
`src/lib/agentBatchExecution.ts`、`assetDerivation.ts`、`externalAssetImport.ts`、`store.ts`、
`src/features/strategy/adapters/RequirementStrategyWorkspace.tsx`、`src/lib/migrations/legacyImageFoldersToCollections.ts`。
**换句话说：生成落库、遮罩编辑、外部导入、批量派生的每一张图，都还在主线程同步编码一次缩略图。**

受影响的正是杰哥那段给用户的文案（`RELEASE.md` v0.8.19）：
> 「生成完成那一刻不再卡界面：缩略图的 WebP 编码从渲染主线程移到后台线程。」

这句对 **grid 显示通道**成立（`db.ts:872` 走 `createImageThumbnailDataUrl` → `canvasToWebpDataUrl`，确实异步了），
但对**用户感知最强的"生成完成那一刻"**（= 图片入库）**不成立**。

**量级**：2026-09-16/17 真机实测，1024px webp q0.82 —— `toDataURL` 71–110ms/张主线程冻结，
每来一张图冻结一次，批量出图叠加。

**修复（一行）** —— 工具函数已存在且签名正好匹配（`src/lib/canvasImage.ts:164`）：

```ts
// src/lib/db.ts:1521
-  thumbnailDataUrl: canvas.toDataURL('image/webp', THUMBNAIL_QUALITY),
+  thumbnailDataUrl: await canvasToWebpDataUrl(canvas, THUMBNAIL_QUALITY),
```

改完顺手验证 `db.ts:31` 的死 import 变成活的了。

⚠️ **验收方式必须注意**：改前后**总耗时几乎一样**（`toBlob` 与 `toDataURL` 的编码量相同），
按"总耗时"比会得出"这个改动没用"的错误结论。**必须挂 rAF 帧探针看主线程长任务**
（照 `%TEMP%\doupao-encode-probe` 的做法）。这个项目已经因为同样的误判绕过一次，别再绕第二次。

**影响**：批量生成、文件夹批量导入、批量派生素材时，每来一张图主线程冻结一次 ~70–110ms。
这不是"感觉慢"，是 UI 会真实掉帧、输入框卡顿、进度条跳帧。

**修复（一行）** —— 工具函数已经存在且签名正好匹配（`src/lib/canvasImage.ts:164`）：

```ts
// db.ts:1521
-  thumbnailDataUrl: canvas.toDataURL('image/webp', THUMBNAIL_QUALITY),
+  thumbnailDataUrl: await canvasToWebpDataUrl(canvas, THUMBNAIL_QUALITY),
```

注意：**改完不能按"总耗时"验收**——改前后总耗时几乎一样。**必须挂 rAF 帧探针看主线程长任务**，
否则会得出"这个改动没用"的错误结论（这个坑项目里踩过一次，详见 `%TEMP%\doupao-encode-probe` 的做法）。

---

## P1-2 文件夹导入：bytes → dataUrl → bytes 的双向浪费 + 串行入库

**位置**：`src/components/InputBar.tsx:2455-2485`

```ts
for (const fileName of toRead) {
  const result = await readFileBuffer(filePath)     // 已经是字节了
  const bytes = new Uint8Array(result.data)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {  // 主线程逐 chunk 拼串
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  const dataUrl = `data:${mime};base64,${btoa(binary)}`   // 主线程同步 base64
  const id = await computeContentHash(dataUrl)            // 又要把 dataUrl 解回去
  await storeImage(dataUrl)                               // ← 内含 P1-1 的同步缩略图编码
  imageIds.push(id)
}
```

**三重浪费**：
1. `readFileBuffer` 已经返回字节，却拼串再 `btoa` 造 dataUrl —— 这一步对 3MB 图是 ~几十 ms 纯主线程；
2. `computeContentHash` / `storeImage` 拿到 dataUrl 后又要解回字节才能算 hash 与落盘；
3. 整个循环是严格串行（`await` 在循环体里），N 张图 = N 次串行 + N 次冻结。

**对照事实**：项目**已经有了字节通道**——`electron/preload.ts:46` 的 `saveImageBytes`、
主进程 `imageBytesFromPayload` 零拷贝建视图 + `fsPromises.writeFile`。
也就是说「写整张图」早就字节化过一遍了（2026-09-16），但**这条导入路径绕过它、重新绕回 dataUrl**。

**修复**：给 `storeImage` 增加可选的字节入参，让 readFileBuffer 的 `Uint8Array` 直达落盘与 hash，
不再经过 dataUrl 往返；循环改为限并发（`Promise.all` 控制在 3–4 路），把 I/O 等待重叠起来。

---

# 二、P2 —— 明显该修

## P2-1 主 store 反向依赖 feature，且收藏数据有两个真相源

- `src/store.ts:118` import `useAssetLibraryStore`；`:279` import `useRequirementPrototype`；`:280` import `sopAiRevision`。
  主 store 依赖 feature，feature 组件又 import 主 store（如 `AssetLibrarySidebar.tsx:46`）→ **双向纠缠**，feature 无法独立测试/复用。
- 收藏/集合双份状态：主 store 的 `favoriteCollections`（`src/store.ts:1937`，`ALL_FAVORITES_COLLECTION_ID` 在 `:282`）
  与 `src/features/assetLibrary/store.ts:77` 的 `collections: AssetCollection[]` 并存，
  靠 `src/store.ts:487` 直接 `useAssetLibraryStore.getState().collections` 桥接读取。

**后果（不是形容词）**：收藏字段有两套持久化 schema（主 store persist v4 vs assetLibrary persist v6）。
以后给收藏加一个字段，**必须同步改两处 + 写两批迁移**，漏一处就是数据静默不一致。

## P2-2 God Store + 三份持久化各自为政

- `src/store.ts` **12,978 行**、1,838 个顶层函数/常量、276 处操作缩略图子系统、8 处 IPC 调用；
  被 **96 个非测试文件**（含测试 113 个）import。
- 三份 store 各自独立 persist：`store.ts:4531`（v4）、`assetLibrary/store.ts:2036`（v6）、`composite/storeV2.ts:992`（v3），**没有共享持久化层**。
- 双引已落地：`ExportStatusWatcher.tsx:2-3`、`PresetManagementTab.tsx:21-22`，`compositeExportQueue.ts:3-4` 一个文件里改写两套 store。

**注意**：`AGENTS.md` 已经写了「store.ts 已过大，勿继续膨胀」，但没拆。这不是新问题，是**持续恶化的存量债**。

✅ 已核实**不是**问题的部分（别重复优化）：`TaskGrid.tsx:40-43` selector 返回稳定引用（`s.tasks` / `EMPTY_TASKS` 常量），
`filteredTasks` 有 `useMemo`，没有「selector 返回新对象」的重渲反模式；`partialize`（`store.ts:1904/1913/1924`）
刻意把 `dataUrl` 置空，**不存在把 base64 图写进本地存储导致每次 state 变更全量序列化几十 MB** 的情况。

## P2-3 库迁移 `moveLibraryData` 无事务、跨卷半途崩溃 = 半迁移态

`electron/catalog-migration.ts:97-122`：`moveLibraryData` 整体包一层 copy + delete，没有事务也没有快照回滚，
调用方 `changeLibraryRoot` 才负责回滚。好在 `catalog-migration.ts:39-50,65-68` 迁移前有 `PRAGMA integrity_check`，
`electron/legacy-data-migration.ts:232,285-330` 也有 `.bak` + `userData/backups/` 快照。
**缺口在于跨卷复制**： `moveLibraryData` 走到一半断电/退程，用户会停在两边各一半的库。

## P2-4 写盘队列吞错后继续推进

`src/store.ts:416`：

```ts
function enqueueLocalImageSave(operation: () => Promise<void>): Promise<void> {
  const queued = localImageSaveQueue.catch(() => {}).then(operation)   // ← 前一项失败也不传递
  localImageSaveQueue = queued
  return queued
}
```

`.catch(() => {})` 的本意（不让单个失败污染整条队列）是对的，但副作用是：
**调用方 `await enqueueLocalImageSave(...)` 无论是否真落盘都会 resolve**。
磁盘满 / 权限拒绝时，上层会以为图已存好并继续后续流程，用户可能在卸载目录后才发现图没了。

同类：`src/store.ts:910`、`src/store.ts:950` 的 `void writeThumbnailToDisk(...).catch(() => {})`
——缩略图可重算，这条影响较小，但同样无感知。

## P2-5 composite 导出整图同步 `toDataURL`

`src/features/composite/lib/compositeRenderer.ts:198` 与 `compositeRendererV2.ts:317`：
`canvas.toDataURL('image/jpeg')` 在渲染主线程编码**整张成品图**（远大于 1024px 缩略图）。
批量导出时这是比 P1-1 更重的一次性冻结。修法同 P1-1：`toBlob` / `OffscreenCanvas`。

## P2-6 重复实现：6 份路径清理 + 4 份 HTML 转义

**6 份近似的文件名/路径净化**（grep 实证）：
`sanitizePathPart`（`agentBatchPlanner.ts:88`）、`sanitizePathSegment`（`composite/lib/compositePathTemplates.ts:23`）、
`sanitizeFileNamePart`（`downloadImages.ts:372`）、`sanitizeGeneratedImageFilenamePart`（`generatedImageFilename.ts:13`）、
`sanitizeFolderName`（`localSave.ts:540`）、`sanitizeFileName`（`watermarkWorkbench.ts:153`）。

**4 份 `escapeHtml`**：`InputBar.tsx:362`、`features/composite/components/PresetNamingFields.tsx:47`、
`features/requirementPrototype/manifests.ts:15`、`lib/promptImageMentions.ts:95/99`。

值得留意的是它们**语义不一致**：`InputBar.tsx:362` 与 `PresetNamingFields.tsx:47` 转义 `"` 但不转义 `'`；
`promptImageMentions.ts:99` 两个都转义。**当前各自的使用场合（双引号属性 / 文本内容）恰好都安全**，
但这是"刚好没出事"，不是"设计上不会出事"。

## P2-7 分层反向依赖

`src/lib/paramDisplay.tsx:3` → `import ViewportTooltip from '../components/ViewportTooltip'`。
`lib/` 反向依赖 `components/`，破坏了「lib 是纯工具层」的前提，也让 lib 无法在非渲染环境下单测。

## P2-8 组件巨型化到影响可改动性

| 文件 | 行数 | 实证问题 |
| --- | --- | --- |
| `src/components/InputBar.tsx` | 5,503 | 634 个顶层函数、内嵌 2 个 Modal；`renderVariablePrompt`/`parseVariablePrompt` 有 4 处重复引用 |
| `src/components/SettingsModal.tsx` | 5,375 | 单文件塞进全部设置子面板 |
| `src/features/strategy/adapters/GallerySopBatchModal.tsx` | 4,110 | 内嵌 3 个 Modal |

后果是具体的：**改一处 prompt 变量解析，要在 InputBar 内部同步多处**。
`src/features/` 下只有 **2 个 `index.ts`**（barrel 出口形同虚设），跨 feature 直接深引内部实现
（`strategy/adapters/storeSopGeneration.ts:8,20`、`requirementPrototype/knowledgeAnalysis.ts:3` 直引主 store）。

## P2-9 仓库根目录卫生：release 目录残留旧版本产物

`release/` 里是 **v0.8.11** 的安装包（两个 exe 合计 ~262MB，`latest.yml` 也写着 `version: 0.8.11`），
而当前版本已经 **v0.8.19**。`AGENTS.md` 明确写了「`release/` 只保留**最新版本**的安装包」。
另有 `release-0.8.14/`、`electron-dist/`、`dist-verify/`、`NVIDIA Corporation/` 等目录残留在工作区。
`gitignore` 已覆盖这些目录，均未提交进库（`git status` 干净，只有 1 项未跟踪），所以**不构成泄露风险**，
属于磁盘占用与「下次打包/发版时容易搞混产物」的实际隐患。

## P2-10 验证门禁拦不住「改动没落地」 —— 死 import、死符号全网放行

这是 P1-1 能一路混过 `npm run verify` 并写进 `RELEASE.md` 的**直接原因**，属于流程层面的缺陷。

实证：

- `src/lib/db.ts:31` import 了 `canvasToWebpDataUrl`，全文件从未调用 → 标准的死 import。
- 单独跑 `npx eslint src/lib/db.ts`：**退出码 0，零告警**。
- 根因是两处显式关闭：
  - `tsconfig.json:19-20`：`"noUnusedLocals": false`、`"noUnusedParameters": false`
  - `eslint.config.js:46`：`'@typescript-eslint/no-unused-vars': 'off'`

**后果**：一个「改了一半」的性能修复，因为没有上帝视角的测试、也没有死符号检查，
可以在 `verify` 全绿（235 测试文件 / 2247 用例）的状态下被写成"已完成"发布出去。
这不是个别失误，是**门禁的形状问题**：当前的 CI 能证伪"代码坏了"，但不能证伪"声称的改动没落地"。

**建议**（成本很低，收益直接对准本次事故）：
1. 把 `@typescript-eslint/no-unused-vars` 从 `off` 改为 `warn`（先进一段观察期），
   或直接对 `src/**` 与 `electron/**` 开 `error`；
2. 给「改了一半」这类性能修复补一条**结构性断言测试**，而不是只测工具函数本身 ——
   例如断言 `createImageThumbnail` 在 `canvas.toDataURL` 被打桩时不该被调用到。
   这样以后再有"声称改了但没改"的情况，测试会直接红。

---

# 三、P3 —— 可选 / 纵深防御

| # | 问题 | 位置 | 说明 |
| --- | --- | --- | --- |
| 3-1 | 写类 handler 不解析真实路径 | `electron/ipc-handlers.ts:245` | `assertAllowedPath` 不 realpath，删除/导出类已用 `assertAllowedRealPath`。**需攻击者先在被允许的根目录内植入符号链接**，远程网页无法独立完成 → 理论风险。写类统一切 `assertAllowedRealPath` 即可闭合 |
| 3-2 | 解密后的 API 密钥经 IPC 明文回传渲染进程 | `electron/main.ts:553` | `safeStorage`（Windows DPAPI，绑定本机用户）本身是对的✅，密钥**未明文落盘**、拷走数据目录≠泄露。仅当渲染进程被攻破时可取到明文 key |
| 3-3 | 本地 API token 同用户可读 | `electron/asset-api-server.ts:143` + `asset-kernel.ts:485` | 已绑 `127.0.0.1` ✅ + Bearer token（`timingSafeEqual`）+ Origin 白名单 ✅，DNS-rebinding 与远程网页都挡住了。仅同用户恶意进程可读该 token 后经 `/v1/imports` 读任意本地文件——但同用户恶意软件本来就能直接读文件，边际收益有限 |
| 3-4 | `agentBatchQueue` 读改写 | `src/lib/agentBatchQueue.ts:119-126` | load→map→save 全量覆盖写。**复核后降为 P3**：所有调用点（`AgentBatchPlannerModal.tsx:411/441/447/466/491/498`、`AgentBatchQueueRunner.tsx:38-57`）都是单次 UI 触发的串行 await 链，**实际不存在并发写入者**（grep `Promise.all/allSettled` 在这批文件里 0 命中）。真正引入并发那天才会爆 |
| 3-5 | `partialize` 忽略 `version` 形参 | `src/store.ts:4530` | 未来加 v5 时所有旧版仍走同一 `migratePersistedState`，必须持续保证幂等 |
| 3-6 | 未切片的长列表 | `src/features/assetLibrary/AssetBatchView.tsx:1192,1222` | `group.assets.map` 不分片；批次组超大时才需要处理 |
| 3-7 | `dataUrlToBlob` 双实现 | `src/lib/blobDataUrl.ts:33`（真相源）vs `src/lib/canvasImage.ts:75` | 统一到前者 |
| 3-8 | `electron-builder ^26.15.3` 配 `electron ^43.4.0` | `package.json:62-63` | **未联网核实，不妄断**。`release/` 里最后一次成功产物是 v0.8.11，建议下次本地 `npm run release:dry` 时确认 builder 是否输出 "Electron version not supported" 类告警 |
| 3-9 | `electron/ipc-handlers.ts` 1877 行、`asset-catalog.ts` 1286 行 | 主进程侧 God object | 按 IPC 域拆分 handler |

---

# 四、✅ 已核查并确认安全（不必再查）

避免重复劳动，以下均已**源码级复核通过**：

- **IPC 信任边界**：全部 `ipcMain.handle/on` 都经 `handleChecked`/`onChecked` → `assertTrustedSender`
  （`ipc-guard.ts:8` 比对 `frame.url` 且要求 `frame === sender.mainFrame`，拒绝 iframe；
  URL 由 Chromium 设定，渲染 JS 不可伪造）+ `will-navigate` 拦截（`main.ts:204`）→ 无绕过 handler。
- **路径遍历**：`local-image-protocol.ts:69-88` 拒绝 `..`/绝对路径/等同目录，限定 `cache-images`/`thumbs`，
  扩展名白名单 + `nosniff`，出错返回 404 不泄露真实路径。
- **Zip Slip**：`backup-zip-reader.ts:76`（`assertSafeZipPath` 拒绝对路径/`..`/盘符，仅返回内存字节不落盘）、
  `streaming-zip.ts:16`（强制 `images/|thumbnails/|composite-assets/` 前缀）均无此问题。
- **文件名注入**：`image-folder-export.ts:31` 剥离 `<>:"|?*` 及控制字符并截断 220；`project-tree-export.ts:26-73` 双重校验。
- **Electron 配置**（`main.ts:354-361`）：`contextIsolation: true`、`nodeIntegration: false`、
  `sandbox: true`、`webSecurity: true`、`devTools: false`；`setWindowOpenHandler` 全拒，
  `shell.openExternal` 仅 `http(s)`；CSP 生产环境 `script-src 'self'`、无 `unsafe-eval`、
  `base-uri/frame-ancestors 'none'`。
- **preload**（`preload.ts:37-218`）：仅暴露具名封装函数，**没有裸透 `ipcRenderer`/`invoke`**，contextIsolation 未失效。
- **XSS**：`InputBar.tsx:2834`、`PromptVariableEditor.tsx:124` 的 `innerHTML` 与
  `PresetNamingFields.tsx:234` 的 `dangerouslySetInnerHTML`，其 html 均经过 `escapePromptHtmlText/Attribute`
  或 `escapeHtml` 处理；行内的颜色值来自固定调色板 `VARIABLE_COLORS[i % len]`
  （`src/lib/promptVariableColors.ts:23`），**非用户可控** → 无注入面。
- **密钥存储**：`secure-api-secrets.ts:70,85` 用 Electron `safeStorage`（DPAPI）加解密，
  `api-secrets.bin` 非明文；`scrubLegacyStateFiles`（`:134-145`）主动清理旧配置里的 `apiKey`。
  数据目录被拷走 ≠ 密钥泄露。
- **日志泄露**：仓库内有 `build.log`/`release.log` 等，但 `git ls-files | grep '\.log$'` 为 0 —— **未入库**。
- **内存泄漏**：`ResizeObserver`/`IntersectionObserver` 均有 `disconnect` 清理；
  `imageCache`/`thumbnailCache` 为有界 ByteLruCache（128MB）；`imageLoadPromises` 在 `.finally` 中删除。
- **测试有效性**：234 个测试文件、0 个被跳过、`src/store.test.ts` 155 个用例仅 4 处 `vi.mock`
  （全仓约 10 处）——**是真实行为断言，mock 不重**。

---

# 五、优先修复建议

按「改一处 / 收益」排序，前三条是同一条图片读写主线：

| 优先级 | 动作 | 位置 | 预期收益 | 验收方式 |
| --- | --- | --- | --- | --- |
| **①** | 补齐声称已做但没落的改动：`canvas.toDataURL` → `await canvasToWebpDataUrl(canvas, THUMBNAIL_QUALITY)`；顺带核实 `RELEASE.md` v0.8.19 是否需要修正措辞 | `src/lib/db.ts:1521` | 19 个入库调用点全部解除主线程冻结；`db.ts:31` 的死 import 转为活用 | **帧探针看主线程长任务**，不要比总耗时 |
| **②** | 打开 `no-unused-vars`（至少 `warn`），并给这类修复补结构性断言测试 | `eslint.config.js:46`、`tsconfig.json:19-20` | 让「声称做了但没落地」下次无法混过 CI | 改完跑 `npm run lint`，确认不引入假阳性洪泛 |
| **③** | 文件夹导入走字节通道 + 限并发 | `src/components/InputBar.tsx:2455-2485` | 去掉 dataUrl 双向转换，N 张并行 | 导入 50 张文件夹，测主线程最大任务时长 |
| **④** | composite 导出整图改 `toBlob`/OffscreenCanvas | `compositeRenderer.ts:198`、`compositeRendererV2.ts:317` | 批量导出不再单次长冻结 | 帧探针 |
| **⑤** | 收藏/集合状态归一到一个 store，删除跨 store 桥接 | `store.ts:487` + `assetLibrary/store.ts:77` | 消灭双 schema / 双迁移 | 迁移测试 + 老库升级验证 |
| **⑥** | 给持久化加「写失败必须上抛/上报」的显式通道 | `store.ts:416`（保留防止队列中毒的字面量意图，改为记录标志位） | 磁盘满时用户能感知 | 人为制造写入失败验证 Toast |
| **⑦** | `moveLibraryData` 加事务/快照回滚 | `electron/catalog-migration.ts:97-122` | 跨卷迁移中断后不再停在半迁移态 | 跨卷切换库根、中途杀进程验证 |
| **⑧** | 6 份 sanitize → 1 份；4 份 escapeHtml → 1 份 | 见 P2-6 | 消除语义不一致隐患 | 逐个替换 + 对应单测 |
| **⑨** | 清理 `release/`、工作区残留旧产物 | `release/`、`release-0.8.14/` 等 | 收回 ~262MB + 避免发版搞混产物 | 手工确认 |
| **⑩** | 写类 IPC handler 切 `assertAllowedRealPath` | `electron/ipc-handlers.ts:245` | 闭合符号链接理论缺口 | 现有测试回归 |

**不建议现在动**：`agentBatchQueue` 的并发锁（P3-4，当前无并发写入者，加了是无效复杂度）；
以及单独立项再拆一次 `store.ts` —— 建议随着 **⑤** 的收藏域归一顺带切分，而不是独立开一个大重构。

---

## 已知限制 / 未验证项

- 本报告全部基于**静态源码复核**，没有跑 `npm run verify`，也没有做真机性能复测。
  P1-1 的 `~70–110ms/张` 是 2026-09-16 的实测值，本次未重测（编码本身没变，但该结论会随图片分辨率变化）。
- `electron-builder` 与 Electron 43 的兼容性（P3-8）**未联网核实**，只作为待办事项列出，不构成缺陷断言。
- `store.ts` 的 1,838 个顶层符号、 `InputBar.tsx` 的 634 个顶层函数，是按正则统计的近似值，可能存在少量误差。
- 未覆盖：CDN 资源加载链路、CI workflow 本身的安全性（超出本次范围）。
