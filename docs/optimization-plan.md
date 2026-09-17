# DOUPAO 优化落地方案

> 依据：`docs/project-health-audit.md`（全仓体检报告）
> 基线：`v0.8.19`（`edc7db4`），`src/` 174,356 行、`electron/` 11,854 行、234 测试文件
> 原则：**能一行修的不搞重构，能加门闩的不加框架**。每一项都必须带可量化的验收口径。

---

## 0. 分级字典与阅读方式

| 级别 | 定义 | 响应要求 |
| --- | --- | --- |
| **致命（P0）** | 用户数据丢失 / 不可恢复 / 可执行任意代码 | 立即修，发 hotfix |
| **高（P1）** | 有可观测后果：卡顿、静默失败、对外承诺未兑现 | 本轮必做 |
| **中（P2）** | 明显该修，当前量级下后果可控，但会持续放大 | 排进 1–2 个迭代 |
| **低（P3）** | 纵深防御 / 洁癖 / 未来可能出事 | 有余力再做 |

**结论概览**：本次体检 **未发现 P0**。
**P1 只有 2 条**，且互为因果 —— `O-1` 是没落地的功能，`O-2` 是让它能悄悄溜过 CI 的门禁缺口。
其余 **8 条 P2**（O-3〜O-10）、**9 条 P3**（O-11〜O-19）。

**与体检报告的编号映射**（便于对照，非一一对应 —— 方案侧做了合并与降级）：

| 体检报告 | 本方案 | 变化 |
| --- | --- | --- |
| P1-1 | O-1 | 提升为第 1 顺位，补充了「虚标」证据链 |
| P1-2 | O-3 | 独立成条，排在性能主线之后收尾 |
| P2-10（门禁） | **O-2**（升 P1） | **升级**：它是 O-1 能溜过 CI 的根因 |
| P2-4（静默失败） | O-6 | 降成本：中 → 低（发现 `App.tsx:95-106` 已有带节流的监听器） |
| P2-8（组件巨型化） | **O-17**（降 P3） | **降级**：「文件大」本身不是问题，痛点已在 O-5 覆盖，不建议单独立项 |
| P2-9（产物卫生） | O-10 | 保持 |

**带 ℹ 标记处为「待确认项」**，共 13 条，需要杰哥拍板或补 measured data 才能定。**未确认前不要动手。**

---

# 一、P1 —— 本轮必做

## O-1 图片入库主路径仍未异步化缩略图编码（对外承诺未兑现）

**等级**：P1 ｜ **成本**：低（约 1 行改动 + 1 条测试 + 1 次真机验证）｜ **优先级**：**第 1 顺位**

### 现状

- `src/lib/db.ts:1521` 是 `thumbnailDataUrl: canvas.toDataURL('image/webp', THUMBNAIL_QUALITY)`，同步占满主线程。
- 该函数 `createImageThumbnail`（`db.ts:1506-1524`）由 `storeImage`（`db.ts:1163`）在 `db.ts:1181` 调用，**是每张图入库的唯一路径**。
- `storeImage` 全仓 **19 个调用点 / 9 个文件**：`InputBar.tsx`、`MaskEditorModal.tsx`、`src/lib/agentBatchExecution.ts`、`assetDerivation.ts`、`externalAssetImport.ts`、`store.ts`、`features/strategy/adapters/RequirementStrategyWorkspace.tsx`、`lib/migrations/legacyImageFoldersToCollections.ts`、`db.ts`。
- 已异步化的只有 grid 显示通道（`db.ts:872` → `createImageThumbnailDataUrl` → `canvasToWebpDataUrl`）。

### 根因

`72706a7`（v0.8.19 的性能提交）**声称**改了 `src/lib/db.ts`，但 `git show 72706a7 -- src/lib/db.ts` 的 diff 中
**只有 `+import { canvasToWebpDataUrl, createImageThumbnailDataUrl } from './canvasImage'`（落到 `db.ts:31`），
没有任何 `- thumbnailDataUrl: canvas.toDataURL(...)`**。调用点从未被替换。
`db.ts:31` 那个 `canvasToWebpDataUrl` 至今**全文件未被调用**，是这个半成品留下的化石。

### 改法

```ts
// src/lib/db.ts:1521   （函数已在 src/lib/canvasImage.ts:164 就绪并已测）
-  thumbnailDataUrl: canvas.toDataURL('image/webp', THUMBNAIL_QUALITY),
+  thumbnailDataUrl: await canvasToWebpDataUrl(canvas, THUMBNAIL_QUALITY),
```

配套两件事：
1. **补结构性断言测试**（不能只测工具函数本身，那样 O-1 这次就没测出来）：
   在 `src/lib/db.test.ts` 里给 `storeImage` / `createImageThumbnail` 打桩 `HTMLCanvasElement.prototype.toDataURL`
   为「被调用即抛/记 flag」，断言 **一张图入库后 `toDataURL` 未被触碰**。
   这条测试是 O-1 的回归防线 —— 将来谁改回同步，测试立刻红。
2. **核实 `RELEASE.md` 措辞**（见文末待确认 ℹ-1）。

### 预期收益

- **性能**：每张图落库不再冻结主线程。已实测同规格（1024px webp q0.82）`toDataURL` 71–110ms/张；
  换成 `toBlob` 后 grid 通道实测 5 张连续编码主线程冻结 **553.8ms → 32ms**。本次验收目标一致：**≤50ms**。
- **正确性**：兑现 `RELEASE.md` v0.8.19 对用户的承诺「生成完成那一刻不再卡界面」。

### 风险与副作用

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 返回值语义变化 | `canvasToWebpDataUrl` 内部先 `toBlob` 再转 dataUrl，产物 base64 应与 `toDataURL` 等价 | 现有 `canvasImage.test.ts` 已覆盖 base64 正确性；再加一条「两者对同一 canvas 产出同一份字节」的对比断言 |
| 回退路径被走到 | `canvasToWebpDataUrl` 在 `toBlob` 不可用/抛错时回退 `toDataURL`（`canvasImage.ts:167-169`） | 这正是设计意图；Electron 43（Chromium 150）确定支持，回退仅兜底 |
| 缩略图 md/hash 变化 | 若编码字节有任何差异，会影响依赖缩略图内容的去重/指纹逻辑 | ℹ-2：**需确认是否存在以缩略图 dataUrl 做 hash 的路径**。目前已知 `storeImage` 的 id 用的是**原图** `computeContentHash(dataUrl)`（`db.ts:1170`），不依赖缩略图，故判断无影响 |

### 依赖

无前置依赖。但**建议与 O-2 同时做**，否则再次出现「声称改了没落地」时依然无人拦截。

### 验收标准（必须全部满足）

1. `npx eslint src/lib/db.ts` 零告警 —— **且 `canvasToWebpDataUrl` 从"未使用的 import"变成实际被调用**。
2. 新增的结构性测试通过：`storeImage` 一张 1672×941 PNG 图时 `toDataURL` 调用次数 = **0**。
3. `npm test` 全绿；缩略图相关回归测试（含 grid 双通道、`THUMBNAIL_VERSION` 守卫）无新增失败。
4. **真机帧探针**（照 `%TEMP%\doupao-encode-probe`）：连续入库 5 张图，**主线程最长任务 ≤ 50ms**（基线 553.8ms）。
5. ⚠️ **不要按"总耗时"验收** —— `toBlob` 与 `toDataURL` 编码量相同，总耗时几乎不变，比总耗时会得出「改动无效」的错误结论。

---

## O-2 验证门禁拦不住「声称已改但没落地」

**等级**：P1 ｜ **成本**：低〜中 ｜ **优先级**：**第 2 顺位**

### 现状

- `tsconfig.json:19-20`：`"noUnusedLocals": false`、`"noUnusedParameters": false`
- `eslint.config.js:46`：`'@typescript-eslint/no-unused-vars': 'off'`
- 实测：`npx eslint src/lib/db.ts` 对一个明确的死 import（`db.ts:31`）**退出码 0，零告警**。

### 根因

O-1 之所以能一路通过 `npm run verify`（235 测试文件 / 2247 用例全绿）并被写进 `RELEASE.md`，
是因为**没有任何一道卡能把它揪出来**：类型检查不管死符号，lint 显式关闭，测试只覆盖了新增的工具函数
（`canvasImage.test.ts`），没覆盖「主路径是否真的换了调用点」。
这是**流程缺陷**，不是代码缺陷 —— 同样的坑会重复发生。

### 改法（分两步，先观察后收紧）

**Step 1（立即，零风险）**
```js
// eslint.config.js:46
-  '@typescript-eslint/no-unused-vars': 'off',
+  '@typescript-eslint/no-unused-vars': ['warn', {
+    args: 'none',                 // 不对函数形参报错（回调/接口实现噪音太大）
+    ignoreRestSiblings: true,
+    caughtErrors: 'none',         // 不强制消费 catch 变量
+  }],
```
先用 `warn`：既能立刻把 `db.ts:31` 这类化石暴露出来，又不会在午饭点把 `npm run verify` 打成红的。

**Step 2（观察 1–2 个迭代后）**
存量清理干净后把 `warn` 改成 `error`，并对 `src/**`、`electron/**` 生效。
可以顺带给 `tsconfig.json:19` 试试开 `noUnusedLocals`（ℹ-3：**先跑一次看存量错误量**，超过 ~50 处就维持 `false`）。

**Step 3（针对本类事故的通用防线）**
把「工具函数改了，调用点必须跟着变」的验收写进习惯：
凡涉公用设施的性能/行为修复，**除了一条针对"调用点是否真的换了"的结构性断言测试，不算完成**。

### 预期收益

- **稳定性/流程**：让「文档说做完了、代码没做」这类事故在 CI 里变红，而不是靠人复核。
- **可维护性**：持续清掉随时间累积的死 import / 死变量。

### 风险与副作用

| 风险 | 缓解 |
| --- | --- |
| 存量告警洪水导致大家习惯性忽略 | Step 1 只开 `warn`；Step 2 前必须先清存量。ℹ-3 需先量一次存量 |
| `ignoreRestSiblings`/`args: none` 放得太松，漏掉真问题 | 保留最小收窄规则即可，别一上来就全开 |
| CI 因 lint 失败中断发版 | 用 `warn` 阶段不阻塞；切 `error` 要单独立一次 PR 并先清存量 |

### 依赖

**无前置依赖，建议与 O-1 同 Wave。**

### 验收标准

1. 改完后立即：lint 输出里**出现 `src/lib/db.ts:31` 的 `canvasToWebpDataUrl` 未使用告警**。
2. O-1 落地后：该告警消失。
3. `npm run lint` 的告警总数记录在 PR 描述里，作为后续清存量的基线数字。
4. `npm run verify` 仍全绿（`warn` 不阻塞 CI）。

---

# 二、P2 —— 排进 1–2 个迭代

## O-3 文件夹导入：bytes → dataUrl → bytes 双向浪费 + 串行入库

**等级**：P2（生图高峰期等价 P1）｜ **成本**：中 ｜ **优先级**：第 3 顺位

### 现状（`src/components/InputBar.tsx:2455-2485`）

```ts
for (const fileName of toRead) {
  const result = await readFileBuffer(filePath)          // 已经是字节
  const bytes = new Uint8Array(result.data)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {       // 主线程逐 chunk 拼字符串
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  const dataUrl = `data:${mime};base64,${btoa(binary)}`  // 主线程同步 base64
  const id = await computeContentHash(dataUrl)           // 又要把 dataUrl 解回字节
  await storeImage(dataUrl)                              // ← 内含 O-1 的同步编码
  imageIds.push(id)
}
```

### 根因

项目**已有**字节通道（`electron/preload.ts:46` `saveImageBytes` + 主进程 `imageBytesFromPayload` 零拷贝 +
`fsPromises.writeFile`，2026-09-16 就落地了），但**这条导入路径绕过它**，把已拿到的字节又转成 dataUrl 绕一圈：
preload 回来的是 `ArrayBuffer` → 拼串 → `btoa` → `storeImage` 内部再解码 → 写盘。
三次转换里 **两次在主线程**，且整个循环严格串行（`await` 在循环体内）。

### 改法

1. 给 `storeImage`（`src/lib/db.ts:1163`）增加**可选的字节入口**，避免 dataUrl 往返：

```ts
export async function storeImage(
  dataUrl: string,
  source: NonNullable<StoredImage['source']> = 'upload',
  bytes?: Uint8Array,          // 新增：调用方已有字节时直传，跳过重复解码
): Promise<string>
```
   内部：`computeContentHash` 与 `saveRawCacheImageToLocal` 在有 `bytes` 时直接用字节，不再走 dataUrl 解码。
   **`dataUrl` 签名保持不动 → 19 个调用点零改动**，新入参只给新路径用（避免一次性大改）。

2. `InputBar.tsx:2455-2485` 改为：去掉 `String.fromCharCode` 拼串 + `btoa` 整段；把 `result.data` 的 `Uint8Array` 直传。
3. 循环改限并发（`Promise.all` 控制窗口 3–4），把 IPC / IO 等待重叠起来。
   ⚠️ 并发后要确认 SQLite 侧幂等：`storeImage` 按内容哈希去重（`db.ts:1170`），**同一张图并发写入是否安全**
   属于 ℹ-4 **待确认项**（需要确认 `putImageRecords` 是否有 upsert 语义）。

### 预期收益

- **性能**：去掉每张图 2 次主线程转换（3MB 图约数十 ms/张）+ N 张串行改并发。
  叠加 O-1 后，导入 50 张文件夹的体感应从「明显卡住」降到「后台进行」。
- **一致性**：与 2026-09-16 已落地的字节优先写盘对齐，不再有「同一件事两套做法」。

### 风险与副作用

| 风险 | 缓解 |
| --- | --- |
| `storeImage` 加参数后行为分叉（有 bytes / 无 bytes 两条路） | 保持旧签名完全不变，`bytes` 缺省走原路径；两条路都加测试 |
| 并发写库触发竞态 | ℹ-4；若 `putImageRecords` 无 upsert 语义，降级为「并发读 + 串行写」 |
| `MAX_FOLDER_IMAGES` 上限语义变化 | 保持上限不变，只改执行方式 |

### 依赖

**依赖 O-1**（否则并发后每张仍在同步编码，收益被抵消）。建议在 O-1 之后。

### 验收标准

1. `InputBar.tsx` 中 `btoa(` 与 `String.fromCharCode` 出现次数 = **0**（在该代码块内）。
2. 真机：**导入 50 张文件夹（每张 2–4MB）**，主线程最长任务 **≤ 80ms**（改动前会连续出现 100ms+ 长任务，需先量基线）。
3. 端到端：导入后图片的 id、缩略图、去重结果与改动前**逐张一致**（跑同一批样本做 id 对比）。
4. `npm test` 全绿，新增「字节入口与原 dataUrl 入口产出同一 id」的等价性测试。

---

## O-4 composite 导出整图同步编码

**等级**：P2 ｜ **成本**：中 ｜ **优先级**：第 4 顺位

### 现状

- `src/features/composite/lib/compositeRenderer.ts:198`：`return canvas.toDataURL('image/jpeg', quality)`
- `src/features/composite/lib/compositeRendererV2.ts:317`：`return canvas.toDataURL('image/jpeg', input.quality ?? 0.9)`

合成成品图常达 **10MB+**（远超 1024px 缩略图），批量导出时这是单次最重的主线程冻结。

### 改法

优先产出 Blob，再按调用方需要转 dataUrl：

```ts
export async function renderCompositePresetToDataUrl(preset, quality = 0.92) {
  const canvas = document.createElement('canvas')
  await renderCompositePresetToCanvas(preset, canvas)
  return blobToDataUrl(await canvasToBlob(canvas, 'image/jpeg', quality))  // 复用 canvasImage.ts 已有实现
}
```
更彻底的做法是 `OffscreenCanvas` + Worker，但那要改 MCP 与渲染链路，**本轮不建议**（见「不做的事」）。

ℹ-5 **待确认**：这两个函数的返回值是否被直接喂给需要 dataUrl 的下游
（exporter / 预览 / 剪贴板）。若下游支持 Blob，连 `blobToDataUrl` 都能省掉。

### 预期收益

- **性能**：批量导出时每次 → 每次编码不再独占主线程；10MB+ 成品图的收益远大于缩略图那点。

### 风险与副作用

| 风险 | 缓解 |
| --- | --- |
| jpeg 编码器选择泄漏到调用方 | 保持函数返回类型不变（仍返回 dataUrl 字符串），调用方零改动 |
| 大 canvas 的 `toBlob` 内存峰值 | `toBlob` 与 `toDataURL` 编码量一致，差异只在主线程占用；内存峰值基本持平 |

### 依赖

无强依赖，可与 O-1 同 Wave（改法同构）。

### 验收标准

1. 两处 `canvas.toDataURL` = **0**。
2. 真机：**连续导出 5 张合成图**，主线程最长任务较基线下降 ≥ 80%（需先量基线）。
3. 导出产物与改动前**逐字节一致**（同一样本同 quality 下比对 sha256）。

---

## O-5 收藏/集合状态双真相源 + 主 store 反向依赖 feature

**等级**：P2（改字段时会变 P1）｜ **成本**：**高** ｜ **优先级**：第 5 顺位

### 现状

- 主 store：`favoriteCollections`（`src/store.ts:1937`），`ALL_FAVORITES_COLLECTION_ID` 在 `src/store.ts:282`。
- assetLibrary store：`collections: AssetCollection[]`（`src/features/assetLibrary/store.ts:77`）。
- 桥接：`src/store.ts:487` 直接 `useAssetLibraryStore.getState().collections` 读取。
- 两套持久化 schema：主 store persist **v4**（`store.ts:4531`）vs assetLibrary persist **v6**（`assetLibrary/store.ts:2036`）。
- 依赖方向错误：`src/store.ts:118` import `useAssetLibraryStore`；`:279` import `useRequirementPrototype`；`:280` import `sopAiRevision`。
  而 feature 组件又 import 主 store（如 `AssetLibrarySidebar.tsx:46`）→ 双向纠缠。

### 根因

feature 拆分时没有把「收藏域」的所有权划清，主 store 保留了旧字段，feature store 又建立了新字段，
靠跨 store 直读维持兼容 —— 典型"半迁移"状态（`AGENTS.md` 的架构一致性要求里明令 `#半迁移=0`）。

### 改法（分三步，每步可独立发版）

1. **定所有权**：明确保留 assetLibrary store 为收藏域唯一真相源，主 store 的 `favoriteCollections` 降级为
   「只读派生视图」（通过 selector 读，不落盘）。
2. **断反向依赖**：`src/store.ts` 不再 import feature store。feature 需要主 store 的数据时，
   通过**回调/参数注入**或己存在的 event bus（`window.dispatchEvent` 模式在本仓已在用，
   如 `AGENT_BATCH_QUEUE_UPDATED_EVENT`）反向通知，而不是直接 import。
3. **迁移**：给主 store persist 写一次性迁移，把 `favoriteCollections` 的内容合并写入 assetLibrary，
   然后 `partialize` 里剔除该字段。

ℹ-6 **待确认**：`FavoriteCollections.tsx`（1717 行）目前**具体读的是哪一边**？
这决定了第 1 步能否「先切读、后迁数据」而不影响 UI。需要读该组件确认消费方。

### 预期收益

- **可维护性**：消灭双 schema / 双迁移。当前给收藏加一个字段要改两处 + 写两批迁移，漏一处就是静默不一致。
- **可测试性**：feature 可脱离主 store 独立测试。

### 风险与副作用

| 风险 | 缓解 |
| --- | --- |
| **用户已有收藏数据（最高优先级风险）** | 迁移前必须在**真实老库**上验证，且 `electron/legacy-data-*.ts` 已有 `.bak` 备份机制要对这条路径生效 |
| 分步改动期间出现不一致中间态 | 每步可独立发版；第 1 步保证 UI 不变，只有第 3 步动数据 |
| 主 store 断依赖后需要调整 8+ 处调用 | 范围内明确；建议单独立一个 PR |

### 依赖

无前置依赖，但它是本方案里**唯一的高成本项**。建议放在 O-1~O-4 之后，**不要与它们混在同一个 PR**。

### 验收标准

1. `grep -n "useAssetLibraryStore" src/store.ts` = **0**（反向依赖消失）。
2. 收藏字段在两份 persist schema 中**只出现一次**。
3. **用真实老库样本跑升级**：升级前后收藏集合的 id / 名称 / 成员逐一相等（脚本比对，不能肉眼看）。
4. UI 行为不变：新增、删除、重命名、拖拽排序、展开/收起等操作全部手动回归一遍。
5. `npm test` 全绿且**无新增 mock**（这条为了保证是真行为断言）。

---

## O-6 持久化写失败被静默吞掉

**等级**：P2 ｜ **成本**：**低**（基础设施已就绪，实际是改 4 行）｜ **优先级**：第 6 顺位

### 现状

```ts
// src/store.ts:416
function enqueueLocalImageSave(operation: () => Promise<void>): Promise<void> {
  const queued = localImageSaveQueue.catch(() => {}).then(operation)   // 前一项失败不传递
  localImageSaveQueue = queued
  return queued
}
```

同类：`src/store.ts:910`、`src/store.ts:950` 的 `void writeThumbnailToDisk(...).catch(() => {})`。

### 根因

`.catch(() => {})` 的原意是「不让单个失败毒化整条队列」——**这个意图是对的**。
问题是它没有区分「隔离失败」与「告知调用方」：队列后续项继续跑（✅），
但**调用方 `await enqueueLocalImageSave(...)` 无论是否真落盘都会 resolve**（❌）。
磁盘满 / 权限拒绝时，上层以为图已存好，用户可能在清理目录后才发现图没了。

### 改法

**好消息：上报基础设施已经存在且已经有监听端。** 不需要新建任何东西：

- `src/App.tsx:95-106` 已注册 `doupao:persist-error` 监听器，**并且自带 5 秒节流**
  （`if (now - lastShownAt < 5000) return`），监听后直接 `showToast('本地状态保存失败，程序正在自动重试', 'error')`。
- `src/lib/desktopJsonStorage.ts:58` 与 `src/store.ts:1833` 已在用这条通道。

所以改动只是「别再静默，补一次 dispatch」：

```ts
// src/store.ts:416
function enqueueLocalImageSave(operation: () => Promise<void>): Promise<void> {
  const queued = localImageSaveQueue
    .catch(() => {})                                   // 队列隔离：保留原语义（前项失败不毒化后续）
    .then(operation)
    .catch((error) => {
      // 新增：复用 App.tsx 已在监听的既有通道（自带 5s 节流，不会 Toast 洪水）
      window.dispatchEvent(
        new CustomEvent('doupao:persist-error', { detail: { namespace: 'localImage' } }),
      )
      throw error                                      // 新增：让本项调用方感知失败
    })
  localImageSaveQueue = queued.catch(() => {})         // 队列链条独立吞错，后续项照常执行
  return queued
}
```

需要顺带核对的是 Toast 文案：现有文案写的是「本地状态保存失败，程序正在自动重试」，
但对图片写盘来说「自动重试」这句并不成立（ℹ-13：**待确认是否需要按 namespace 区分文案**）。

缩略图那两处（`store.ts:910`、`store.ts:950`）建议保持静默 —— 缩略图可从原图重算，属于可接受降级，
但建议至少改成 `console.warn` 留痕。

### 预期收益

- **稳定性**：磁盘满 / 只读目录 / U 盘拔出等场景下，用户在**第一次**失败时就能感知，而不是事后丢数据才发现。
- **成本极低**：不用新建设施、不用新接 listener，改动约 4 行。

### 风险与副作用

| 风险 | 缓解 |
| --- | --- |
| 调用方没处理新抛出的错误 → 未捕获异常 | 必须同时排查 `enqueueLocalImageSave` 的全部调用点是否 `await`；ℹ-7 **待确认调用点数量与是否有未 await 的** |
| ~~Toast 洪水（批量导入失败 50 张）~~ | **此项风险不成立**：`App.tsx:98-101` 已内置 5 秒节流窗口。复核对即可，无需额外处理 |
| 文案「程序正在自动重试」对图片写盘不准确 | ℹ-13 待确认是否按 `namespace` 区分文案 |

### 依赖

建议先做 O-2（门禁）以便 CI 能抓住遗漏的 `await`；但不强依赖，**成本本就只有 4 行，可随时插队做**。

### 验收标准

1. 人为制造写入失败（把库目录设为只读 / 塞满临时卷），**必须出现用户可见的错误提示**，且原图 UI 状态不被标为"已保存"。
2. 批量导入 50 张时 Toast **不超过 1 条**（汇总），而不是 50 条。
3. `npm test` 全绿，新增「写失败仍通知」用例；队列不中毒的既有用例仍通过。

---

## O-7 库根迁移 `moveLibraryData` 跨卷半途失败 = 半迁移态

**等级**：P2 ｜ **成本**：中 ｜ **优先级**：第 7 顺位

### 现状与根因（精确到「为什么会停在半途」）

```ts
// electron/catalog-migration.ts:97-122
for (const pair of pairs) {                       // db / thumbs / backups 三对
  if (!existsSync(pair.source)) continue
  if (existsSync(pair.target)) {
    moveDirContents(pair.source, pair.target)      // 合并语义：目标已有同名文件则跳过
  } else {
    try {
      renameSync(pair.source, pair.target)
    } catch {
      moveDirContents(pair.source, pair.target)    // 跨卷：逐文件复制
      rmSync(pair.source, { recursive: true, force: true })
    }
  }
}
```

`moveDirContents`（`catalog-migration.ts:80-89`）逐文件 move/copy，**无完整性校验、无已移动清单、无法回滚**。
跨卷复制在**第 k 个文件失败**时：

1. 异常向外抛 → `rmSync` **不执行**（好消息：源不会被删，没错删风险）；
2. 目标已有一份部分副本，源也还在 → **两份都有文件**；
3. `ipc-handlers.ts:80` 的 catch 调反向 `moveLibraryData(normalizedNext, previous)` 回滚，
   此时**旧目录因为还有部分残留文件而 `existsSync(target)` 为真 → 走合并分支**，
   而合并分支对「目标已存在的文件」是 `continue`（`:86`）→ **等于什么都没搬回来**；
4. 最终：新库根留下一份残缺副本，旧库根恢复使用。下次再切到这个库根时，
   `moveLibraryData` 会命中合并分支或 `:100` 的冲突判断 → 行为取决于残缺副本内容。

**根因一句话**：失败回滚依赖"反向再搬一次"，而合并语义使反向搬移在部分失败场景下变成 no-op。

### 改法

把「看运气合并」改成「**先复制、校验、再删除，且记录已移动清单**」：

1. `moveDirContents` 返回**实际移动的文件清单** `string[]`，并把 `statSync(from).isFile()` 的
   `continue` 分支（`:85`）单独记账（非文件条目应明确处理而不是静默跳过）。
2. 跨卷路径改为三段：① 复制全部文件并记录清单 → ② **逐个校验目标文件存在且 size 与源一致** →
   ③ 校验全过才 `rmSync` 源；任一步失败，按清单**回滚删除已复制的目标文件**。
3. `changeLibraryRoot`（`ipc-handlers.ts:58-100`）的回滚用同一份清单做**精确回滚**，而不是反向再搬一次。
4. 顺手把 `moveLibraryData` 保持同步 `void` 语义不变（调用方无需改）或改为返回清单由调用方持有 ——
   ℹ-8 **待确认**：`db` 是第一个被移动的 pair，若把它放在最后，最坏情况是 db 没动、只有 thumbs/backups 残缺，
   恢复成本更低。**是否调整 pair 顺序**要杰哥拍板（涉及现有测试期望）。

### 预期收益

- **稳定性**：跨卷切换库根中断后不再停在两边各一半的状态，也不再出现"反向回滚什么都没搬回来"的假回滚。

### 风险与副作用

| 风险 | 缓解 |
| --- | --- |
| 加了 size 校验，跨卷迁移变慢 | 只对 file 条目做 `statSync` size 对比，成本远低于重试一次迁移；超大库可接受 |
| 改动触及已有测试期望（`catalog-migration.test.ts`） | 现有测试需同步更新；改动前后行为对用户一致 |
| 精确回滚清单本身写错 → 误删新库根文件 | 回滚只删"本次已复制到目标"的文件，且加 `TRY=/record` dry-run 测试覆盖 |

### 依赖

无强依赖。建议与 O-6 同 Wave（都是"失败要可感知/可恢复"）。

### 验收标准

1. 新增测试：模拟复制到第 k 个文件失败 → **断言旧库根文件完整无缺、新库根无残留孤儿文件**。
2. 真机：**跨卷**（如 `D:\` → `E:\` 或 U 盘）切换库根，中途杀进程，**旧库根数据完整、能正常打开**。
3. `catalog-migration.test.ts` 与 `library-*.test.ts` 全绿。
4. 正常路径（同卷 rename）行为与改动前一致，无明显耗时增加（±10% 内）。

---

## O-8 重复实现收敛：6 份 sanitize + 4 份 escapeHtml + 2 份 dataUrlToBlob

**等级**：P2 ｜ **成本**：中（机械降噪但要逐个验） ｜ **优先级**：第 8 顺位

### 现状

**6 份近似的文件名/路径净化**：
`sanitizePathPart`（`agentBatchPlanner.ts:88`）、`sanitizePathSegment`（`features/composite/lib/compositePathTemplates.ts:23`）、
`sanitizeFileNamePart`（`downloadImages.ts:372`）、`sanitizeGeneratedImageFilenamePart`（`generatedImageFilename.ts:13`）、
`sanitizeFolderName`（`localSave.ts:540`）、`sanitizeFileName`（`watermarkWorkbench.ts:153`）。

**4 份 `escapeHtml`**（且**语义不一致**）：
- `InputBar.tsx:362`：转义 `& < > "`（**不转义 `'`**）
- `features/composite/components/PresetNamingFields.tsx:47`：转义 `& < > "`（**不转义 `'`**）
- `features/requirementPrototype/manifests.ts:15`：委派给 `escapeXml`（XML 场景，字符集不同，合理独立）
- `lib/promptImageMentions.ts:95/99`：`escapePromptHtmlText`（`& < >`）+ `escapePromptHtmlAttribute`（再补 `" '`）

**2 份 `dataUrlToBlob`**：`src/lib/blobDataUrl.ts:33`（同步、Node+浏览器通用，应为真相源）vs
`src/lib/canvasImage.ts:75`（async + `fetch`，仅浏览器）。

### 根因

缺少单一出口工具层；每遇到新需求就近写一个。
**当前各自的使用场合恰好都安全**（用到前两处的都是双引号属性 / 文本内容），属于「刚好没出事」，不是「设计上不会出事」。

### 改法

1. **escapeHtml → 统一到 `src/lib/promptImageMentions.ts` 已有的两个函数**
   （`escapePromptHtmlText` 用于文本内容、`escapePromptHtmlAttribute` 用于属性值），
   因为它们**语义最清晰且已有单测**（`promptImageMentions.test.ts:124`）。
   `manifests.ts` 那份保留（XML/xlsx 场景，字符集不同，**不属于同一领域，不要强行合并**）。
2. **sanitize → 抽 `src/lib/sanitizeFileName.ts` 单一出口**，但要**逐个核对 6 处的语义差异**
   （保留字符集、截断长度、处理 `.`/空格的行为可能不同）。
   ⚠️ **不要无脑合并**：`downloadImages.ts` 与 `generatedImageFilename.ts` 的规则看起来就有差异
   （后者带正则替换）。合并前必须逐个列差异表。
   ℹ-9 **待确认**：这 6 处的截断长度与保留字符集是否真的相同？不同则保留两个函数但抽出公共内核。
3. **`dataUrlToBlob` → 统一到 `src/lib/blobDataUrl.ts:33`**，删 `canvasImage.ts:75` 的实现改为 re-export。

### 预期收益

- **可维护性**：一处修 bug，处处生效。
- **安全性**：消除「某一份漏转义」导致 XSS 的隐患；把「刚好没出事」变成「结构保证」。

### 风险与副作用

| 风险 | 缓解 |
| --- | --- |
| **无脑合并导致文件名行为变化（最高风险）** | 严禁无脑合并；先列 6 处差异表逐个确认；每处替换配一条「改前后同一输入产出同一结果」的对照测试 |
| escapeHtml 合并后属性/文本上下文混用导致漏转义 | 保留两个语义明确的函数名（Text / Attribute），不合并成一个含糊的 `escapeHtml` |
| 触及面广（至少 12 个文件） | 批量替换并使用项目规定的检查流程；建议分 3 个 PR（escape / sanitize / blob） |

### 依赖

建议**在 O-2（打开 `no-unused-vars`）之后**做，清理出来的死实现会被 lint 直接标记出来。

### 验收标准

1. `escapeHtml` 自定义实现数量：**4 → 1（+ manifests.ts 那一份按领域独立保留）**。
2. 每处替换都有对应的「旧实现 vs 新实现对同一组输入产出一致」的测试（输入样本至少包含
   `<script>`、`'`、`"`、`&`、`../`、中文、emoji、Windows 保留字符）。
3. `InputBar.tsx` / `PresetNamingFields.tsx` 的 innerHTML 渲染**视觉与 DOM 结构不变**（快照测试或直接 diff）。
4. `npm run verify` 全绿。

---

## O-9 分层反向依赖：`lib/` import `components/`

**等级**：P2 ｜ **成本**：**低** ｜ **优先级**：第 9 顺位（可与 Wave 1 顺手做掉）

### 现状

`src/lib/paramDisplay.tsx:3`：`import ViewportTooltip from '../components/ViewportTooltip'`。

### 根因

展示层组件被下沉工具层反向引用，破坏了"lib 是纯工具层"的前提。

### 改法

把 `ViewportTooltip` 下沉到 `src/lib/` 或 `src/design-system/`（后者更符合项目既有约定 ——
`AGENTS.md` 明确设计组件放 `src/design-system/`），然后所有引用方统一改 import 路径。
纯路径调整，**零行为变化**。

ℹ-10 **待确认**：`ViewportTooltip` 有多少个引用方？（决定挪动成本；若只有 1–2 处，10 分钟能做完。）

### 预期收益

- **可测试性**：`lib/` 不再依赖 React 组件树，可在 node 环境单测。
- **架构**：恢复单向依赖 `components → lib → 无`。

### 风险与副作用

| 风险 | 缓解 |
| --- | --- |
| 挪动公共组件导致 import 路径失效 | 全仓 import 一次替换；TS 编译会捕获遗漏 |
| `design-system` 目录有合规测试（tokensContract / compliance）可能对新成员有要求 | 若进 `design-system/`，需过 `src/design-system/` 下测试 |

### 依赖

无。

### 验收标准

1. `grep -rn "from '\.\./components/" src/lib/` = **0**。
2. `npx tsc -b` 通过；`npm test` 全绿；`src/design-system/` 下测试全绿。

---

## O-10 仓库与产物卫生：`release/` 残留 v0.8.11

**等级**：P2 ｜ **成本**：**低** ｜ **优先级**：第 10 顺位（随时可做）

### 现状

`release/` 里是 **v0.8.11** 的两个安装包（合计约 **262MB**）+ blockmap + `latest.yml`（写着 `version: 0.8.11`），
当前版本已是 **v0.8.19**。违反 `AGENTS.md` 明文约定「`release/` 只保留**最新版本**的安装包」。
另有 `release-0.8.14/`、`electron-dist/`、`dist-verify/`、`NVIDIA Corporation/` 等残留在工作区。

`.gitignore` 已覆盖这些目录、`git status` 干净 → **不构成泄露风险**，纯粹是磁盘占用与"下次发版可能搞混产物"。

### 改法

手工清理（涉及删除文件，但全部是**已列入 gitignore 的构建产物**，不在 Source Control 下）。
**为稳妥，按上面的安全约束处理：先列清单确认，不清空任何不受版本控制的个人目录。**
具体：删除 `release/` 下非当前版本的包、`release-0.8.14/`、`electron-dist/`、`dist-verify/`。
需要历史版本包时从 GitHub Releases 下载（`AGENTS.md` 已写明这条）。

### 预期收益

- 收回约 **262MB+** 磁盘；消除发版时误上传旧包的可能性。

### 风险与副作用

| 风险 | 缓解 |
| --- | --- |
| 误删尚未发布的当前版本包 | 删除前先列完整清单与时间戳；本次要删的都是 v0.8.11/v0.8.14，与 v0.8.19 无关 |
| 删掉马上要用的中间产物 | ℹ-11 **待确认**：`dist-verify/`、`electron-dist/` 是否还有在用？需杰哥一句话确认 |

### 依赖

无。

### 验收标准

1. `release/` 下只剩当前版本（v0.8.19）的 Setup + portable + blockmap + latest.yml。
2. 磁盘空间回收 ≥ 250MB。
3. 清理后 `npm run electron:preview` 能正常起（证明没删到运行时依赖）。

---

# 三、P3 —— 有余力再做

| ID | 问题 | 位置 | 改法 | 触发条件 |
| --- | --- | --- | --- | --- |
| O-11 | 写类 IPC handler 用 `assertAllowedPath`（不 realpath），理论符号链接逃逸 | `electron/ipc-handlers.ts:245`，涉及 `fs:save-image`(1355)、`fs:save-json`(1154)、`fs:save-text`(1167)、`fs:write-json-text`(1437)、`fs:link-file`(1138)、`fs:ensure-dir`(1180) | 写类统一改用 `assertAllowedRealPath`（删除/分发/导出类 **已经在用**，见 933/1040/1692/1721） | 需攻击者先在被允许根内植入 junction，**远程网页无法独立完成**；优先级低但改动小，可搭车 O-7 一起做 |
| O-12 | 解密后的 API 密钥经 IPC 明文回传渲染进程 | `electron/main.ts:553`、`asset-kernel.ts:510` | 改为「主进程持 Key 代发请求」而非下发明文；或至少加一次性句柄 | 仅当渲染进程遭 XSS 时才有意义；`safeStorage`(DPAPI) 存储本身是对的 |
| O-13 | 本地 API token 文件 `asset-api.json`（mode 0o600，明文随机值）可被同用户进程读取 | `electron/asset-api-server.ts:143`、`asset-kernel.ts:485` | 迁到 `safeStorage` 或加读取限制 | 已绑 `127.0.0.1` + Bearer token（`timingSafeEqual`）+ Origin 白名单，**远程与 DNS-rebinding 都挡住了**；同用户恶意软件本来就能直接读文件，边际收益有限 |
| O-14 | `partialize` 忽略 `version` 形参 | `src/store.ts:4530` | 显式接收并使用 `version`，迁移函数按版本号分派 | 未来加 v5 时才会踩；建议随 O-5 顺手改 |
| O-15 | `AssetBatchView` 的批次组内列表未切片 | `AssetBatchView.tsx:1192,1222` | 复用 `AssetGrid.tsx:390` 已有的窗口化 | 批次组超大时才有体感；**先量实际组大小再决定是否动**（ℹ-12） |
| O-16 | `electron-builder ^26.15.3` 配 `electron ^43.4.0` | `package.json:62-63` | 下次 `npm run release:dry` 时确认是否输出 "Electron version not supported" 类告警 | **未联网核实，不构成缺陷断言**；`release/` 最后一次成功产物是 v0.8.11，建议真跑一次确认 |
| O-17 | 巨型组件拆分：`InputBar.tsx`(5503) / `SettingsModal.tsx`(5375) / `GallerySopBatchModal.tsx`(4110) | — | 按 tab/modal 拆子组件；`renderVariablePrompt/parseVariablePrompt` 有 4 处重复引用可合并 | **不建议单独立项**。见「不做的事」 |
| O-18 | `features/` 下只有 2 个 `index.ts`，跨 feature 深引内部实现 | `strategy/adapters/storeSopGeneration.ts:8,20`、`requirementPrototype/knowledgeAnalysis.ts:3` | 给每个 feature 建 barrel 公共出口 | 洁癖级；收益在"下次大改期"才体现 |
| O-19 | 主进程 God object：`ipc-handlers.ts`(1877)、`asset-catalog.ts`(1286) | — | 按 IPC 域拆分 handler | 洁癖级；风险高于收益 |

---

# 四、执行顺序与依赖图

```
Wave 0（当天可做，全部低成本）
  ├─ O-1  db.ts:1521 一行 → 补结构断言 → 帧探针验收      ★最高优先级
  ├─ O-9  lib/ 反向依赖（纯路径调整）      ┐ 互相独立
  └─ O-10 产物清理（手工）                ┘ 可并行

Wave 1（稳定性 + 门禁）
  ├─ O-2  打开 no-unused-vars（warn → error）   ← 建议与 O-1 同批，互为防线
  ├─ O-6  持久化写失败可感知
  └─ O-7  库迁移精确回滚                        ← O-6/O-7 都是「失败要可感知/可恢复」，可同 PR

Wave 2（性能主线收尾）
  ├─ O-3  导入字节化 + 限并发    ← 依赖 O-1（否则并发后仍在同步编码）
  └─ O-4  composite 导出异步化   ← 依赖无

Wave 3（结构重构，唯一高成本）
  ├─ O-5  收藏域归一 + 断主 store 反向依赖   ← 建议等 Wave 0-2 稳定后再动
  └─ O-8  重复实现收敛                       ← 建议在 O-2 之后（lint 能标记死实现）

有余力
  └─ O-11 ~ O-19（P3，搭车）
```

**硬性partial order（不能违反）**：
- `O-1 ⟵ O-3`（O-3 依赖 O-1）
- `O-2 ⟵ O-8`（O-8 依赖 O-2 的 lint 能力）
- `O-1 ⟵ O-2`（**建议**，非技术依赖：让 O-1 的验收有一条纪律保障）

**可以并行**：O-1 / O-9 / O-10；O-6 / O-7；O-3 / O-4。

---

# 五、验收矩阵总表

| ID | 可量化验收标准 | 通过线 |
| --- | --- | --- |
| O-1 | ① 新增结构测试：入库一张 1672×941 PNG 时 `toDataURL` 调用次数 | **= 0** |
| | ② 真机帧探针：连续入库 5 张，主线程最长任务 | **≤ 50ms**（基线 553.8ms） |
| | ③ `db.ts:31` 的 `canvasToWebpDataUrl` import 状态 | **已使用**（配合 O-2 时 lint 无告警） |
| O-2 | ① 改完立即 lint 是否报出 `db.ts:31` | **必须报出** |
| | ② O-1 落地后该告警 | **消失** |
| | ③ `npm run verify` | **全绿**（warn 不阻塞） |
| O-3 | ① 代码块内 `btoa(` / `String.fromCharCode` 出现次数 | **= 0** |
| | ② 真机导入 50 张（2–4MB/张）主线程最长任务 | **≤ 80ms**（需先量基线） |
| | ③ 同一批样本的 id 与改动前 | **逐张一致** |
| O-4 | ① 两处 `canvas.toDataURL` | **= 0** |
| | ② 连续导出 5 张合成图，主线程最长任务降幅 | **≥ 80%** |
| | ③ 导出产物字节 | **与改动前完全一致**（sha256） |
| O-5 | ① `grep "useAssetLibraryStore" src/store.ts` | **= 0** |
| | ② 真实老库升级前后收藏数据 | **脚本比对逐条相等** |
| | ③ `npm test` 新增 mock 数 | **= 0**（保证是真行为断言） |
| O-6 | ① 制造写入失败是否出现可见提示 | **必须出现** |
| | ② 批量导入 50 张失败时 Toast 数 | **≤ 1 条**（汇总） |
| O-7 | ① 模拟第 k 个文件失败：旧库根完整性 + 新库根孤儿文件 | **完整 / 0 个** |
| | ② 真机跨卷切换中途杀进程 | **旧库根数据完整、可正常打开** |
| O-8 | ① 自定义 `escapeHtml` 实现数 | **4 → 1**（+ manifests 按领域独立） |
| | ② 每个替换点的「新旧同输入同输出」对照测试 | **全部通过** |
| | ③ InputBar / PresetNamingFields 的 innerHTML DOM | **结构不变** |
| O-9 | ① `grep "from '../components/" src/lib/` | **= 0** |
| O-10 | ① `release/` 内非当前版本包 | **= 0** |
| | ② 磁盘回收 | **≥ 250MB** |

---

# 六、待确认项清单（需杰哥拍板或补 measured data）

| ℹ | 事项 | 影响 | 谁来定 |
| --- | --- | --- | --- |
| ℹ-1 | `RELEASE.md` v0.8.19「生成完成那一刻不再卡界面」这句**是否需要修正措辞** | 对外文案准确性 | 杰哥 |
| ℹ-2 | 是否存在**以缩略图 dataUrl 做 hash/指纹**的路径 | O-1 是否有副作用 | 我可再查一轮（当前判断：无，因 id 用原图 `computeContentHash`） |
| ℹ-3 | 打开 `noUnusedLocals` 后的**存量错误量** | O-2 Step 2 是否可行 | 跑一次 `tsc` 才知道 |
| ℹ-4 | `putImageRecords` 是否具备 **upsert 语义** | O-3 能否真并发；若无则降级为「并发读 + 串行写」 | 我可再查一轮 |
| ℹ-5 | composite 两个渲染函数的**返回值下游是否需要 dataUrl** | O-4 能否彻底去掉 `blobToDataUrl` | 我可再查一轮 |
| ℹ-6 | `FavoriteCollections.tsx`（1717 行）**读的是主 store 还是 assetLibrary store** | O-5 第 1 步能否「先切读后迁数据」 | 我可再查一轮 |
| ℹ-7 | `enqueueLocalImageSave` 的全部调用点**是否有未 `await` 的** | O-6 抛错后是否会引入未捕获异常 | 我可再查一轮 |
| ℹ-8 | `moveLibraryData` 的 **pair 顺序是否调整**（把 `db` 放最后） | O-7 最坏情况的恢复成本 | 杰哥（涉及现有测试期望） |
| ℹ-9 | 6 份 sanitize 的**截断长度与保留字符集是否一致** | O-8 能否合并成一个函数，还是只抽公共内核 | 我可再查一轮 |
| ℹ-10 | `ViewportTooltip` 的**引用方数量** | O-9 的成本 | 我可再查一轮 |
| ℹ-11 | `dist-verify/`、`electron-dist/` **是否还在用** | O-10 删除范围 | 杰哥一句话 |
| ℹ-12 | `AssetBatchView` 批次组的**实际最大规模** | O-15 是否值得做 | 用量测回答 |
| ℹ-13 | `App.tsx:104` 的持久化错误 Toast 文案「本地状态保存失败，程序正在自动重试」对**图片写盘**是否准确（不会自动重试） | O-6 是否需要按 `namespace` 分发不同文案 | 杰哥 |

---

# 七、明确「不做的事」（防止过度工程）

1. **不建议单独立项再拆一次 `src/store.ts`（12,978 行）**。
   「文件大」本身不是问题；它现在的痛点是**双真相源和反向依赖**（O-5）。
   正确做法是**随 O-5 的收藏域归一切一刀**，而不是开一个"大重构"专项——后者风险高、验收难。
2. **不建议现在给 `agentBatchQueue` 加并发锁**。
   我复核过：所有调用点（`AgentBatchPlannerModal.tsx:411/441/447/466/491/498`、
   `AgentBatchQueueRunner.tsx:38-57`）都是单次 UI 触发的串行 await 链，
   grep `Promise.all/allSettled` 在这批文件里 **0 命中** → 当前无并发写入者，加了是无效复杂度。
   **触发条件**：真正引入并发那天再做。
3. **不建议把 composite 渲染搬进 OffscreenCanvas + Worker**。
   本轮 `toBlob` 就能拿到绝大部分收益；Worker 化要改 MCP 与渲染链路，收益/风险比不划算。
4. **不建议统一 4 份 `escapeHtml` 里的 `manifests.ts` 那一份**。
   它是 XML/xlsx 场景，属于不同领域，强行合并反而危险。
5. **不建议立刻升级 `electron-builder` 版本**。
   O-16 未联网核实，不构成缺陷断言。真遇到告警再改。

---

## 方案的自我约束（诚实声明）

- 本方案的**成本估算为相对量级**（低/中/高），不是人天。真正的排期需要杰哥自己判断。
- O-3 / O-4 / O-7 的**性能验收需要先量改动前基线**，本轮没有做真机复测，所以给的是目标值而非比例。
- O-5 是唯一可能**触及用户已有收藏数据**的改动，务必在真实老库上验证后再发版。
- 报告中标注 ℹ 的 12 项，**在确认前不要动手**，否则方案会从"可落地"变成"想当然"。
