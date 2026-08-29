# DOUPAO V2 代码优化与改进分析报告

> 审计日期：2026-08-10 ｜ 版本：0.7.56 ｜ 规模：`src` 99,632 行 + `electron` 约 6 万行，合计约 11.2 万行 TS/TSX
> 方法：5 路并行深审（状态层 / Electron 与 IPC / 持久化层 / 渲染性能 / 依赖与工程化）+ 人工复核关键结论
> 验证：全量测试 163 文件 / 1133 用例全绿（约 22 秒），构建产物与源码交叉核对

---

## 一、总体评价

先说结论：**这是一个工程质量明显高于同规模个人项目的代码库**，许多方面做得相当好：

- 状态分层合理：持久化大状态（`store.ts`）与高频瞬态（`stores/runtimeStore.ts`：流式预览、Agent 流式文本）分离；
- 持久化策略克制：`partialize` 只持久化设置与草稿，任务/图片/对话全部进 IndexedDB，Electron 下用 coalesced JSON 落盘 + 防抖 + 备份轮转；
- 渲染优化已有基础：任务网格/瀑布流手写虚拟化（`TaskGrid.tsx`）、`TaskCard`/`GalleryImageTile` 自定义 memo 比较器、`content-visibility: auto`、LRU 字节缓存（128MB 原图 + 64MB 缩略图）、缩略图回填并发上限 4；
- 架构无环：`store.ts` 居中、feature 只依赖中心，无循环导入；
- 稳健性设计：迁移三态日志 + 游标续跑、渲染进程崩溃恢复与安全模式、chunk 加载失败恢复（`chunkRecovery.ts`）、IPC 路径白名单与真实路径校验、URL 对象成对 revoke；
- 测试文化：154+ 测试文件、1133 用例全绿；文档里还有带截图证据的交互审计（`docs/audits/`）。

**本报告聚焦"还可以更好"的地方**，按影响面排序。所有行号以当前仓库为准。

---

## 二、优先级总览

| 优先级 | 主题 | 关键位置 | 影响 |
|---|---|---|---|
| P0 | Agent 流式输出引发整树高频重渲染（含 InputBar） | `store.ts:4973-4987`、`AgentWorkspace.tsx:568`、`InputBar.tsx:530` | 打字/出图期间持续卡顿 |
| P0 | 任意任务更新 → tasks/workspaceTabs 全量数组重建 | `store.ts:8178-8206` | 8+ 个常驻组件每 tick 重渲染 |
| P0 | Electron 路径白名单可被渲染进程任意绕过 | `ipc-handlers.ts:111-115,403-429,504-536` | 任意文件读写风险 |
| P0 | 无导航/弹窗防护（will-navigate / setWindowOpenHandler） | `main.ts` | 远程页面获得完整 preload 能力 |
| P0 | 浏览器端导出/导入全内存 ZIP（OOM） | `store.ts:9043-9148,9497-9500` | 大库直接崩溃 |
| P0 | 图片以 base64 入库 + 按字符串哈希去重（去重失效） | `db.ts:478-517,425-427` | 存储膨胀、去重形同虚设 |
| P0 | 恢复轮询把已停止任务"复活"为 done 并重启已停止的 Agent 轮次 | `store.ts:3967-3995,8977-9005` | 用户停止操作被覆盖（数据正确性） |
| P0 | FAL/custom 恢复轮询可并发双轮询，重复存储/覆盖图片 | `store.ts:3850-3856,3997-4011` | 重复写图 + 输出被先后覆盖 |
| P0 | `completeAgentImageTask` TOCTOU：停止后迟到成功仍写 done | `store.ts:6314-6342` | 与失败路径守卫不对称 |
| P1 | persist 每次 setState 全量 partialize + JSON.stringify（Web 直接写 localStorage） | `store.ts:3402-3434` | 生成期每秒多次序列化数百 KB |
| P1 | executeTask 无任务级 AbortController，取消后仍在途提交 | `store.ts:7221-8161` | 无法中止在途请求；取消后图片落库成孤儿 |
| P1 | submitAgentMessage 双重提交 TOCTOU（守卫在 await 之前） | `store.ts:5971-5974,6059-6084` | 双击并行两个 running 轮次 |
| P1 | purge 与素材同步队列 TOCTOU，墓碑失效 | `assetLibraryRepository.ts:223-230`、`db.ts:904-917` | 已删素材复活 |
| P1 | asset-kernel 镜像无重试、仅 count 比对 | `assetLibraryRepository.ts:73-81,163-184` | 主备库静默不一致 |
| P1 | 主进程 node:sqlite 同步阻塞 + 全表扫描 | `asset-catalog.ts:236-342` | 主线程卡顿 |
| P1 | 图片网格 tile 总是加载原图、无解码并发上限 | `GalleryImageTile.tsx:54-57,85` | 100-300MB 峰值内存 |
| P1 | 无单实例锁、console-message 签名过时、preload 双源漂移 | `main.ts:166-170`、`electron/preload.cjs` vs `preload.ts` | 双开竞态 / 主进程异常噪音 / dev-prod 不一致 |
| P1 | 无 CSP + api:fetch 无主机白名单 + 远程字体 | `index.html`、`api-transport.ts:31-60`、`src/index.css:1-2` | XSS 放大面、隐私外泄 |
| P2 | 无 ESLint/Prettier、CI 不跑测试、electron 无类型检查 | 仓库根、`.github/workflows/release.yml` | 回归全靠自觉 |
| P2 | 巨型单文件（store.ts 9801 行等 15 个 100KB+ 文件） | 见 §六 | 维护成本高 |
| P2 | 编码损坏（mojibake）5 处，含用户可见错误串 | `src/lib/imagePostprocess.ts:195` 等 | 用户看到乱码 |
| P3 | 死依赖（zundo、framer-motion、lenis）、死文件（test-zundo.ts） | 根目录、package.json | 包体积与混淆 |

---

## 三、性能

### 3.1 渲染热点（React）

1. **【高】Agent 流式输出重渲染整棵消息树 + InputBar 每 80ms 全量重渲染**
   - `AgentWorkspace.tsx:568` 订阅整个 `agentStreamingTexts` Map；`store.ts:4979` 每个文本 chunk 重建该 Map → 每 chunk 全量重渲染消息树；
   - `store.ts:4985` 每 80ms flush 重建整个 `agentConversations` 数组 → `AgentWorkspace.tsx:336` 与 `InputBar.tsx:530`（3904 行组件，含 contenteditable 提示词编辑器）以 ~12.5 次/秒重渲染；
   - 消息列表内联渲染（`AgentWorkspace.tsx:1121-1396`），无 memo 消息组件；每条消息渲染期还遍历全部 tasks。
   - **建议**：流式文本改字符串选择器（同 `TaskCard.tsx:86` 的窄选择模式）；消息拆 `React.memo(MessageBubble)` 并把流式合并移入气泡内部；InputBar 对 agentConversations 只订阅活动对话对象。

2. **【高】`updateTaskInStore` 每次 patch 全量重建数组 → 常驻大组件高频重渲染**
   - `store.ts:8178-8206`：每次进度更新 `tasks.map()` + `workspaceTabs.map()` 建新数组（O(n)），生成期间高频触发（progressStage 各阶段、每图 outputImages、streamPartialImageIds）；
   - 订阅方：TaskGrid、InputBar、DetailModal（常驻）、Header、AgentWorkspace、Lightbox、WorkspaceTabBar、GallerySopBatchModal（每 tab 一个 portal 实例）；
   - `store.ts:8200` 每次 patch 还跑 O(n) `countSuccessfulOutputImages`，其唯一用途 `maybeOpenSupportPrompt` 已是 no-op（`:718-721`）。
   - **建议**：高频进度字段（progressStage/progressUpdatedAt/streamPartialImageIds）拆独立高频 store；常驻组件关闭态不订阅全量数据（事件里用 `getState()`）；删除每次 patch 的 O(n) 统计调用（立即可做）。

3. **【高】TaskGrid 每次任务 patch 全量重筛 + 全量瀑布流布局**
   - `TaskGrid.tsx:91-97` 每次 tasks 引用变化全量 filter+sort，且每任务 `JSON.stringify(params)`（`lib/galleryTaskFilter.ts:21-22,45`）；`:103` 平铺全部输出图；`:159-168` 对全部图片（含屏外）重排瀑布流。
   - **建议**：筛选与布局做模块级缓存/selector（key 为 tasks 引用 + 筛选参数）；瀑布流只计算可见区 ± overscan，屏外用估算高度占位。

4. **【高】图片 tile 总是加载并显示原图，缩略图被绕过**
   - `GalleryImageTile.tsx:54-57` 每个可见 tile 无条件 `ensureImageCached` 全尺寸原图；`:85` `imageSrc = fullImageSrc || thumbnailSrc` 原图优先；`:113` `loading="eager"`；原图解码无并发上限（缩略图有 4）。约 20-40 个可见 tile × 2K base64（3-8MB）≈ 100-300MB 内存。`DetailModal.tsx:280-291` 打开时对全部输出图（可达 30+ 张）全量加载原图。
   - **建议**：网格只用缩略图，原图按需加载（打开详情/Lightbox 时）；为 `ensureImageCached` 增加并发上限；缓存改 Blob URL + `img.decode()` 后再换 src。

5. **【中】TaskCard 每张可见卡片订阅整个 settings**
   - `TaskCard.tsx:84` 订阅 `s.settings`，实际只用 `settings.alwaysShowRetryButton`。主题/皮肤等任何设置变化 → 所有可见卡片重渲染（memo 拦不住 store 订阅更新）。
   - **建议**：改 `useStore((s) => s.settings.alwaysShowRetryButton)`（5 分钟可完成）。

6. **【中】常驻挂载的大弹窗未 memo、关闭时仍订阅全量数据**
   - `DetailModal.tsx:34-47,90` 常驻挂载（`App.tsx:311`），订阅 tasks/workspaceTabs/settings/wordLibraryEntries，`if (!task) return null` 之后 hooks 仍执行；`Lightbox.tsx:27` 同理；`SettingsModal.tsx:401` 订阅整个 settings。
   - **建议**：常驻 modal 包 `React.memo` + 窄选择，或改为打开时才挂载。

7. **【中】InputBar 全量订阅 + 渲染期重复 O(n) 计算**
   - `InputBar.tsx:513,526-530,538` 全量订阅 settings/tasks/workspaceTabs/favoriteCollections/agentConversations/wordLibraryEntries；`:761-778` 渲染期对全部任务 sort+filter（与 TaskGrid 重复）；`:782-796` 每收藏夹跑 `getFavoriteCollectionTasksForBatch` → O(收藏夹数×任务数)。
   - **建议**：过滤/计数移入 memo 化 lib 或 store selector；大子树拆 memo 子组件。

8. **【中】Header 统计条：每次任务更新 + 每秒 O(n) 统计**
   - `Header.tsx:99-114` 订阅 tasks+workspaceTabs，运行期间每秒 `setNow`；`getGenerationStats`（`lib/generationStats.ts:32,42`）每次任务更新且每秒都全量重算（useMemo 因 tasks 引用每次都变等于没缓存）。
   - **建议**：统计在 store 内维护增量 totals，范围切换时才重算。

9. **【中】DetailModal 悬停预览 onPointerMove 每帧 setState**
   - `DetailModal.tsx:742,124-145` 鼠标在输出图 tile 上滑动时每帧 setState 重渲染整个模态。
   - **建议**：rAF 节流，或 hover 浮层用 ref 直接操作 DOM 不进 React 渲染。

10. **【低/中】GallerySopBatchModal 隐藏实例仍执行全部计算**
    - `InputBar.tsx:3885-3924` 每 tab 常驻 portal；`GallerySopBatchModal.tsx:2578` `if (!visible) return null` 位于全部 hooks/useMemo 之后；隐藏实例仍订阅 tasks/workspaceTabs 并在每次任务更新重算 `runImageSummaryById`（`:435-447` 遍历全部任务）。
    - **建议**：后台自动流程移出渲染层（store action / 模块级 runner），弹窗只渲染。

11. **【低】多个组件各自跑 1Hz 时钟**：`TaskCard.tsx:248`、`Header.tsx:110`、`DetailModal.tsx:202`、`SopBatchTaskCard.tsx:108`、`AssistantActionBar.tsx:226`、`SopManagementCenter.tsx:268` 各 `setInterval(setNow, 1000)`。运行中任务多时每秒 6+ 组件重渲染。**建议**：共享全局时钟（模块级订阅或 context）。
12. **【低】其它渲染小项**：TaskGrid 框选拖拽每次 mousemove 都 `querySelectorAll` + `getBoundingClientRect` 遍历可见卡片（`TaskGrid.tsx:313-348,415-442`，可用布局缓存代替 DOM 读取）；DetailModal 每张图 `onLoad` 单独 setState 写 `imageRatios/imageSizes`（`DetailModal.tsx:744`，可批量合并）；SopManagementCenter 打开期间每次 tasks patch 全量过滤封面候选（`sopCover.ts:11-25`）。

### 3.2 数据层与内存（详见 §五）

- 每次 IndexedDB 操作重新 `openDB()`，连接从不关闭、无 `onversionchange` 处理；`getStorageRecordCounts` 一次开 9 个连接（`db.ts:100-127,630-643`）；
- 浏览器模式下整图 base64 入库（4/3 膨胀 + UTF-16 双倍驻留），`getAllImages` 全表即数 GB 峰值；`compositeAssets.ts:61` 已示范正确的原生 Blob 存储；
- 导出/导入全内存 ZIP（见 §五）；
- 删除路径缓存失效依赖调用方自觉，`initStore` 孤立清理走 `batchDeleteImages` 无缓存失效（`store.ts:4391`）；
- `ByteLruCache` 驱逐永不降到 1 条以下（单条超大项长期驻留，`byteLruCache.ts:59-65`）。

### 3.3 Electron 主进程

- **【高】node:sqlite 全同步阻塞主进程**：`asset-catalog.ts:79-83,155-216`（upsert）、`236-288`（query）、`326-342`（getCounts 每次查询都全表 SUM + 两趟 json_each 全表分组）、`362-389`（recommend 最多取 2000 行逐行 JSON.parse）。图片生成应用高频 upsert/query → 主线程持续卡顿。**建议**：catalog 访问移入 utilityProcess（与 indexer 同构），getCounts 加缓存；
- **【高】主线程同步扫描 + 全量解码取尺寸**：`ipc-handlers.ts:364-468` `listCompositeBackgroundFiles` 递归版对每个文件 `nativeImage.createFromPath` 全量解码，全同步阻塞，上千张图卡死数秒~数十秒，且逐文件 console.log。**建议**：只解析文件头取尺寸（PNG IHDR/JPEG SOF），移入 utilityProcess，加节流与取消；
- **【中】感知哈希与向量回退在主线程**：`asset-kernel.ts:31-51,95,193` 每张图 nativeImage 解码。**建议**：移入 indexer utilityProcess；
- **【中】图片/base64/大文件整体走 IPC**：`ipc-handlers.ts:331-362` 每文件整读 + base64(+33%) 经 invoke 返回；`composite:list-image-files` 一次返回目录内全部图片（数百 MB 常见）；`fs:read-file-buffer`、`fs:save-zip-buffer`、`fs:export-zip` 均整块结构化克隆（内存 ×2）。**建议**：图片经 `doupao://` 协议或受控流式加载。

### 3.4 启动与包体

- 主 chunk `dist/assets/index-*.js` 1.27MB minified，无 vendor 拆分（`manualChunks`）；Workspace/Modal 与 markdown 渲染已正确懒加载（这点很好）；
- CSS 产物 279KB（design-system 54KB + index.css 40KB + strategy 40KB + 皮肤体系）；
- `src/index.css:1-2` 运行时从两个第三方 CDN 加载 HarmonyOS Sans SC —— 与项目自己的皮肤规范（"禁止远程 @import"）矛盾：离线 Electron 回退系统字体、Web 每次加载依赖第三方、且字体请求泄露 IP（与"纯本地化"卖点冲突）。**建议**：WOFF2 随应用打包（`font-display: swap`）或直接用系统字体栈。

---

## 四、安全（Electron + Web）

1. **【高】路径白名单可被渲染进程任意绕过**：`authorizeCompositeOutputDirectory` 只校验"是绝对路径"即加入允许根（`ipc-handlers.ts:111-115`）；`scanEnteredCompositeBackgroundFolder` 对任意存在的目录直接 `addAllowedRoot`（`:403-429`）；`distributeCompositeFile` 目标目录不在白名单时自动加入（`:504-536`）。渲染进程一旦被注入即可把 `C:\Windows\System32` 等任意路径加入白名单，再借 `fs:read-file-buffer`、`fs:save-text/save-image` 读写任意文件。**建议**：删除这三个自动加根通道；根目录只允许通过系统对话框加入。
2. **【高】无导航/弹窗防护**：全库无 `setWindowOpenHandler` / `will-navigate` / `web-contents-created`。AI 生成的 markdown 链接（react-markdown 渲染）被点击后主窗口可导航到任意 http(s) 页面，而 preload 挂在 webContents 上、`electronAPI` 依旧可用 → 远程页面获得全部 fs/store IPC 能力。**建议**：`will-navigate` 拒绝非白名单 URL；`setWindowOpenHandler` 对 https 走 `shell.openExternal` 后 deny。
3. **【高】IPC 处理器无发送方校验**：`ipc-handlers.ts:538-968` 约 60 个 handler 均不检查 `event.senderFrame`；仅 `asset-kernel.ts:77-80` 有 `trusted()` 且只比对 sender.id。**建议**：封装 `validateSender(event)` 统一套用。
4. **【中】无 CSP**：源与产物 `index.html` 均无 Content-Security-Policy。**建议**：加 CSP（script-src 'self'；img-src 'self' data: blob: doupao:；connect-src 'self' https: http://127.0.0.1:*；object-src 'none'；frame-ancestors 'none'），`session.webRequest.onHeadersReceived` 下发。
5. **【中】`api:fetch` 是无主机白名单的 CORS-free HTTP 代理**：`api-transport.ts:31-60` 仅校验 http/https 协议，主进程 Node fetch 可请求任意地址（含 `http://127.0.0.1:<port>` 本地服务），绕过渲染端 CORS。**建议**：主进程维护 API 域名白名单，至少禁止非白名单回环端口。
6. **【低-中】`doupao://` 协议以 DB 中 mimeType 原样下发且不校验请求方**（`asset-kernel.ts:171-192`）。**建议**：mimeType 白名单（仅 image/*）+ 校验发起方。
7. **【中，发布质量】Windows 无代码签名、updater 无签名验证、mac 未配置公证**：`package.json:97` `signAndEditExecutable: false`；electron-updater 在 Windows 只做 sha512 完整性、不做发布者签名验证。**建议**：配置签名证书；至少文档明示风险。
8. **【低】preload 暴露面过大**：约 60 个方法，含 `path-join`、`readDir`、`saveZipBuffer`、`exportZipToPath` 等宽泛原语。正面：未暴露 `shell.openExternal`（用 `openPath`/`showItemInFolder`）。**建议**：按最小权限收敛。
9. **【低】`sortOrder` 直接拼 SQL**（`asset-catalog.ts:265,280`）。**建议**：`['asc','desc'].includes()` 枚举校验。
10. **正面**：contextIsolation + sandbox + webSecurity 全开、devTools 关闭、renderer-crash 60s 窗口恢复、dev server 钉死 127.0.0.1:41731、路径真实路径校验（`ipc-handlers.ts:131-170`）——基础安全姿态良好。

---

## 五、可靠性 / 数据一致性

1. **【高】purge 与素材同步队列 TOCTOU，已删素材可能"复活"**：`upsertFromTask`（`assetLibraryRepository.ts:208-232`）先取墓碑快照再异步写入；若 purge 事务（`db.ts:904-917`，墓碑与删素材同一事务）在其间提交，同步队列随后写入的素材绕过墓碑检查。**建议**：墓碑检查与素材写入同一 IDB 事务，或 purge 与同步队列共用互斥锁，或墓碑加 `blockUntil` 时间窗。
2. **【高】渲染进程 ↔ SQLite asset-kernel 镜像不一致且无重试**：`persistIdentityAndMirror`（`assetLibraryRepository.ts:163-184`）先写 IDB（3 个独立事务）再 IPC；IPC 失败被 `?.` 吞掉，无重试无队列；`hydrate` 只按 count 比对，count 一致但内容落后时永不修复。**建议**：镜像写入走持久化队列（失败重试、带校验）；`hydrate` 增加内容级校验（如 max(updatedAt)）。
3. **【中高】`deleteGeneratedAsset` 孤儿 blob 清理竞态 + 两次全表扫描**（`assetLibraryRepository.ts:281-291`）：blob 按 contentHash 去重可被多资产共享，并发写入时可能误删仍在引用的 blob；SQLite 侧已用 `ON DELETE CASCADE` + 事务内 GC 正确处理，渲染端是更差的重复实现。**建议**：删除渲染端手动 GC，改为单事务实现或引用计数。
4. **【高】浏览器端导出/导入全内存 ZIP**：`generateExportZipBuffer`（`store.ts:9043-9148`）`getAllImages()` 全表 → 逐图转字节 → `zipSync` 同步压缩，峰值内存 ≈ 3-4× 库大小，几千张 4K 图即 OOM；导入 `unzipSync` 同理（`:9497-9500`）。**建议**：浏览器端用 fflate 流式/异步压缩（`Zip` 类逐文件写入、降压缩级别），或引导用户用 Electron 流式导出（该路径设计正确）。
5. **【中】导入无整体原子性**：`importData` 分多步提交（任务、快照、对话、素材、设置），中途任一步失败留下"半导入"状态无回滚。**建议**：先完整校验再单事务提交，失败提供"撤销导入"。
6. **【中】图片存储迁移单张失败卡死整条迁移**：`migrateLegacyImages`（`imageStorageMigration.ts:19-26`）遇单张保存失败即整体 throw，每次启动重试都卡在同一张坏图。**建议**：失败项跳过 + 记录失败清单，结束后统一告警；checkpoint 存实际游标而非计数（`:4047`）。
7. **【中】配额耗尽无处理**：全库无 `QuotaExceededError` 分支、无 `navigator.storage.estimate` 预警；`storeImage`（`db.ts:514-528`）先写本地文件再写 DB，`putImage` 配额失败时缓存文件成孤儿。**建议**：捕获配额错误 → 提示 + 触发迁移/清理；写 DB 失败回滚刚写的本地文件。
8. **【中】coalescedJsonStorage 静默丢写**（`coalescedJsonStorage.ts:58-89`）：`adapter.write` 失败被 catch 吞掉，waiters 仍 resolve —— 调用方以为已保存；`getItem` 读不到尚未 flush 的 pending 写。**建议**：失败向 waiters reject；`getItem` 优先返回 pending 内容。
9. **【中】`console-message` 签名过时**：`main.ts:166-170` 用 `(_event, level, message)`，Electron 30+ 已改为 `(event, messageDetails)`，`message` 恒为 undefined，`message.includes(...)` 抛 TypeError —— 渲染进程每次 console 输出都触发主进程 uncaughtException。**建议**：改 `(_event, details)` 用 `details.message`。
10. **【中】无单实例锁**：全库无 `app.requestSingleInstanceLock()`，双开时两个进程并发写同一 sqlite（WAL）与设置文件。**建议**：启动加锁，失败则 focus 主窗口后退出。
11. **【中】崩溃恢复无退避上限，safeMode 不改变行为**：`renderer-crash-recovery.ts:8-20` 恒返回 `reload:true`，60s 窗口外可无限循环；safeMode 无人消费。**建议**：按 60s 内崩溃次数分级，>2 次显示错误页，oom 先不 reload。
12. **【低】`before-quit` 不等待 sqlite 关闭**（`main.ts:262-265` `void assetKernel?.close()`）。**建议**：preventDefault → await → exit。
13. **【低】无 pagehide/beforeunload flush**：agentConversations 500ms 防抖写 IDB、wordLibrary 同理 —— 防抖窗口内关闭应用会丢最后一次修改。**建议**：`pagehide`/`before-quit` 时 flush。
14. **【低】`new Promise(async (resolve,reject)=>{...})` 反模式**（`streaming-zip.ts:37`）执行器内同步抛错使外层 Promise 永不 settle。**建议**：标准 executor + 显式 try/catch。
15. **【低】本地文件删除失败被吞**：`localSave.ts:662-670` 对 `{ deleted, failed }` 失败部分不处理，长期累积孤儿文件。**建议**：失败计数 + 启动对账（`reconcileCacheImages` 已存在）。
16. **【低】默认导出不含图片，恢复时图片引用被静默剔除且不提示**（`store.ts:9238`、`backupImport.ts:34-70`）。**建议**：导入时展示被省略数量，导出默认勾选图片。
17. **【低】`getImageThumbnail` 热路径双读 + 可能整图解码**（`db.ts:330-393`）；导出循环逐图调用（`store.ts:9089,9305`）。**建议**：导出走批量读取，缺失缩略图统一走 idle 回填队列。
18. **【低】`batchGetGeneratedAssetsByImageIds` 用 `index.get()` 只返回同 imageId 第一条**（`db.ts:794-811`），备份合并产生的重复素材会被静默漏掉。**建议**：`index.getAll(imageId)` 并归一。
19. **【低】IPC 错误被吞**：`ipc-handlers.ts:574-612,664-671,731-742` 等一律 `catch { return false/null/[] }`，渲染端无法区分失败原因。**建议**：统一 `{ok:false, code, message}` 错误码序列化。
20. **【低】IPC 参数校验风格不统一**：部分通道（如 `fs:path-join`、`fs:read-dir`）直接信任渲染端类型。**建议**：统一参数校验 helper。
21. **【低】主进程同步整目录拷贝**（`ipc-handlers.ts:42-62,788-794`）与**索引 15s 超时静默降级**（`asset-kernel.ts:162-165` 返回 [] 无日志）。**建议**：异步化 + 进度事件；超时/降级记 warning。（正面：全库无 fs.watch/chokidar，无 watcher 泄漏。）
22. **【低】窗口状态不持久化**：`main.ts:132-150` 固定 1400x900，无 bounds/maximized 记忆。**建议**：保存/恢复窗口 bounds。
23. **【低】更新流程边界**：`update:install` 恒返回成功（未下载时 `quitAndInstall` 会抛错）；下载完静默安装，渲染进程未落盘状态可能丢失；`allowPrerelease=true` 是 406 变通。**建议**：install 前校验 downloaded；安装前通知渲染层 flush。
24. **【低】未启用 Electron fuses 加固**（未禁用 `ELECTRON_RUN_AS_NODE`、无 asarIntegrity）；release 目录堆积 0.7.52-0.7.56 旧产物。**建议**：打包脚本启用 fuses + 清理旧产物。

### 5.2 状态层专项（`store.ts` 9800 行深审 + 各 feature store）

**A. 恢复/停止路径的竞态与状态复核缺口（正确性 bug，建议优先修）**

25. **【高】恢复轮询把已停止/已取消的任务"复活"为 done，并自动重启已停止的 Agent 轮次**：`completeRecoveredFalTask`（`store.ts:3967-3995`）开头只挡 `status === 'done'`，await 图片处理后 `:3980` **无条件**写 `status:'done'`，`:3993` 还 `continueRecoveredAgentRound` 重启轮次；custom 同构（`:8977-9005`）；而 `markAgentRoundTasksStopped`（`:4870-4888`）把任务置 error 却**不清恢复定时器**。用户点停止 → 恢复轮询随后把任务/轮次状态覆盖。**建议**：恢复 apply 前要求 `latest.status === 'running'`（且 recoverable 标志仍为 true）；停止路径统一 `clearFalRecoveryTimer`/`clearCustomRecoveryTimer`；`updateTaskInStore` 增加可选前置状态参数。
26. **【高】FAL/custom 恢复轮询可并发双轮询**：`store.ts:3850-3856` 定时器回调先自删 map 项再执行，`recoverFalTask` 无在途标志；网络查询数十秒期间再次触发会排第二个定时器 → 两个轮询并发通过开头检查，各自整批写图（重复存储）+ 先后覆盖 outputImages。**建议**：`recoveryInFlight: Set<string>` 在途去重；状态复核移到所有 await 之后。
27. **【高】`completeAgentImageTask` TOCTOU**：`store.ts:6314-6342` 开头只跳过 done，await `processAndStoreGeneratedImage` 后无条件写 done；调用方在发起请求前检查过 `signal.aborted`，但 abort 可发生在检查后、写入前。对比失败路径 `failAgentImageTask`（`:6344-6361`）有 `status !== 'running'` 守卫——两处不对称。**建议**：写前重读任务，仅 running 才写 done；或校验 `controller.signal.aborted`。
28. **【中】任务删除/批量清除不清理恢复定时器与 watchdog**：`removeMultipleTasks`（`:8752-8796`）、`removeTask`、`clearFailedTasks` 均未调 `clearFalRecoveryTimer`/`clearCustomRecoveryTimer`/`clearOpenAIWatchdogTimer`；在途恢复完成时图片已写 IDB，随后 updateTaskInStore 对已删任务 no-op → **孤儿图片**（启动清理须过期 7 天）。**建议**：删除路径显式清理三个定时器；complete* 逐图存储前再次确认任务存在，否则回滚。
29. **【中】`submitAgentMessage` 双重提交 TOCTOU**：`:5971-5974` 守卫（检查有无 running 轮次）在多个 await（mask 校验、storeImage）之前，`:6059-6084` 才插入 running 轮次——双击落在间隙会创建两个 running 轮次，`agentRoundControllers.set` 只覆盖不 abort，旧轮次无法停止。**建议**：守卫与插入合并进同一函数式 `setState`（updater 内再校验），或模块级去重集合。
30. **【中】`runWithConcurrencyAndRetry` 及批量重试不回传 signal**（`lib/imageApiShared.ts:274-312`）：退避 sleep 不监听 abort，停止响应最长延迟 15s。**建议**：增加可选 signal 并透传。
31. **【中】`executeTask`（手动生图）无任务级 AbortController**：全文件 `new AbortController()` 仅 Agent 路径（`:6215`）；编排主循环（`:7825-7862`）从不读 store 判断任务是否仍 running——watchdog/启动中断把任务置 error 后循环仍继续 submit，图片在状态检查前已 `commitGeneratedImage`（`:7641`）落库成孤儿。**建议**：`taskAbortControllers: Map<taskId, AbortController>` + `stopTask()`；主循环每轮读状态，非 running 直接 break；signal 透传 API 调用。
32. **【中】备份/导入/导出无忙标志**：`exportData`（`:9238`）、`exportDataToPath`（`:9394`）、`importData`（`:9497`）均可并发执行——两次导入交错 `commitImportedRecords`（`db.ts:656` clear 后 put）可能丢数据。**建议**：模块级单飞 Promise 复用。
33. **【中】每周自动备份在导出完成前就推进 `lastAutoBackupAt`**（`App.tsx:240-260`）：失败仅 console.warn，一周内不再重试；且整段只在挂载时执行一次。**建议**：成功后再推进时间戳；改为 interval/启动检查。
34. **【中】`importData` 无陈旧性检查**：`validateBackupArchive` 只校验 version，不比较 `exportedAt` 与当前数据新旧；replace 路径 `commitImportedRecords({ replaceTasks: true })` 清空任务库——旧备份可静默覆盖新数据。**建议**：replace 前比较时间戳，旧备份弹确认。
35. **【中】仅导入任务（importTasks && !importConfig）后内存 tasks 不刷新**（`:9581-9613`）：界面显示旧任务直到重启。**建议**：分支末尾 `setTasks(await getAllTasks())`。
36. **【中】`submitTaskWithData` 先写内存后 `putTask`**（`:4775-4802`）：IDB 写失败时任务卡 running 永不变。**建议**：先 putTask 成功再 setTasks，或失败置 error。
37. **【低】`runScheduleItem` 无 per-item 互斥**（`:2732-2806`）：手动立即执行与 tick 可重复提交（ScheduleRunner 的 `runningRef` 只防 tick 自重叠）。**建议**：按 item.id 缓存 in-flight Promise。
38. **【低】fire-and-forget 缺口**：`void flushAgentConversationsToIndexedDB()`（`:3478,3524`）无 .catch（IDB 失败 → unhandled rejection）；多处 `void saveTaskToLocalFS(...)` 前序 await 在 try 之外可 reject；`updateTaskProgress` 丢弃 putTask promise。**建议**：统一 `.catch` 或函数内吞错。

**B. persist 写放大与状态驻留**

39. **【高/中】persist 每次 setState 全量 partialize + JSON.stringify**：Zustand 5 `persist` 中间件在每次 set 后立即 `setItem()`（`node_modules/zustand/middleware.js:366-374`），无 diff 跳过；`getPersistedState`（`:1151-1213`）含 settings（含全部 profile 与 apiKey）、schedule、workspaceTabs（含 `_taskIds` 全量任务 id）、agentInputDrafts——生成期每秒多次序列化数百 KB；Web 构建直接同步写 localStorage（`:3415`），Electron 的 coalescedJsonStorage 只能对**已序列化字符串**去重，省不掉 stringify。**建议**：高频瞬态字段迁 runtimeStore；任务类更新 300ms 合并再 setState；自定义 storage 序列化前结构化浅比较短路。
40. **【中】持久化 `_taskIds` 线性膨胀且只增不减**（`:1200-1202`）：10k 任务时每次 persist 序列化 10k 个 id，删除任务后旧 id 残留到下次启动。**建议**：持久化只存 tab 布局，任务归属由任务字段重建（`getAssetTaskContext` `:3555-3563` 已有先例）。
41. **【中】`setSettings` 每次部分更新整体替换 settings 对象身份，且 API Key 明文持久化**（`:2232-2273`、`:1155`）：profiles 数组全量重建 + 每次全量归一化（`apiProfiles.ts:596-707`）；apiKey 明文落 localStorage/JSON 文件（备份导出有脱敏，持久化本体没有）。**建议**：setSettings 浅比较无变化返回原 state；API Key 单独加密存储或至少不落明文。
42. **【中】compositeV2 `setWithHistory` 每键击对全状态 `structuredClone` ×2 + JSON.stringify 深比较**（`storeV2.ts:361-390,833-865`）：文本图层每次键击克隆全部 presets/groups + 全量 persist 写入。**建议**：只克隆受影响子集；引用级比较；undo 快照降采样（合并 1200ms 窗口）。
43. **【中】任务数据双份驻留**（`tasks` + `workspaceTabs[].tasks`）：`updateTaskInStore`/`updateTasksFavoriteCollections` 同时重建两份（`:8178-8205,8352-8380`），内存翻倍 + 每 tick 双份 O(n)，且存在发散风险（如 3.11 仅导入任务不刷新）。**建议**：workspaceTabs 只存 taskId 引用（持久化已用 `_taskIds` 思路），渲染层按需取 tasks Map。
44. **【中】启动全量载入所有任务并永久驻留 zustand 状态**（`initStore` `:4093-4175`）：渲染层 TaskGrid 已虚拟化，状态层没有——10k 任务（含 prompt/params/outputImages）常驻内存且每次更新全量重建。**建议**：引入 `taskById` Map 索引，避免全量数组替换；资产库 `hydrate()` 同理（100k 图全量载入 `assetsById`）。
45. **【中】流式 partial 每帧全量 SHA-256 + 缩略图生成 + IDB 图片写 + 任务重写**（`:5357-5378,7744-7750`）：对比 Agent 路径只持久化每请求首帧（`:6843-6845`）；每 4 帧还 `buildStoreImageReferenceGraph` 全量建图。**建议**：executeTask 与 Agent 路径一致只持久化首帧；引用图增量维护；超大图先降采样再哈希。
46. **【中】`putTask` 写放大**：单次生成 10~30+ 次整任务重写（persist() 闭包 + 进度/partial 更新），每次含 `rawResponsePayload` 大字符串单事务写 IDB，且 `getPersistableTask`（`:3535-3552`）每次 put 都 JSON.parse + pretty-stringify payload。**建议**：按 taskId 300-400ms 合并最新 patch 写一次（复用 `flushAgentConversationsToIndexedDB` 的单飞+排队模式 `:3449-3466`）；payload 按引用缓存。
47. **【中】`replaceAgentConversations` 全量 clear+rewrite**（`db.ts:228-241`）：N 个对话每次变更全部重写，虽有 500ms debounce + 单飞收敛。**建议**：按 id diff 只 upsert 变更对话。
48. **【低】`QueueRunner` 每次 tasks 身份变更全量 `syncTasks`（O(orders×units)）**（`QueueRunner.tsx:25-27`）：生成期每次进度 tick 触发，且 syncTasks 返回新 orders 时 effect 再触发 → 级联扫描。**建议**：降频/浅比较（id+status 哈希）。
49. **【低】assetLibrary `applyAssetsToState` 每次 upsert 全量复制 assetsById（O(n)）**（`store.ts:67-75`）：每个任务完成都 upsert → 100k-key 对象全量复制。**建议**：Map + 不可变补丁；删除类操作改游标式批量。
50. **【低】assetLibrary `setQuery`/`setFilters` 每键击触发 persist 写入**（`features/assetLibrary/store.ts:135-136`）。**建议**：查询词本地 state + debounce 后入 store。

**C. 水合/迁移与耦合**

51. **【中】migrate 函数不按版本门控**：`migratePersistedState`（`:926-975`）、`requirementPrototype/store.ts:124-139`（version 5 忽略版本参数）、`storeV2.ts:296-334` 都恒执行同一变换——无法表达"仅旧版本执行"的迁移。**建议**：按 persisted version 分派，version 递增只追加新步骤。
52. **【中】god store ↔ feature store 双向依赖，靠动态 import 规避循环**：`store.ts` 静态 import 三个 feature store；反向 `features/assetLibrary/store.ts` 与 `lib/assetCommands.ts` 用 `await import('../../store')` 调 `getState().showToast/purge...`——事实上的隐式全局单例网络，测试与 HMR 下易碎。**建议**：抽取共享服务（toast/purge）注入，消除 store 间直接 getState。
53. **【低】`normalizeAgentRound` 会把 running 翻转为 error**（`:733-737`），且同一份持久化数据在 `mergePersistedState`/`initStore` 被归一化 2-3 次——对持久化数据合理，若未来误用于实时状态会静默篡改。**建议**：各只归一化一次并复用；归一化函数加 `forPersisted` 开关。
54. **【低】死代码/重复实现**：`countResponseToolCalls` 与 `countResponseImageCalls` 函数体逐字相同（`:5628-5634`）；`filterAgentRoundResponseOutputForInput` 是 `return output` 空转（`:5511-5515`）；`generateExportZipBuffer`（`:9043-9149`）与 `executeInBatches`（`:7278-7453`）全仓无调用点。**建议**：删除。
55. **【低】`updateAgentConversation` 无条件重建数组**（`:4837-4843`）：updater 返回原对象也触发全量通知（如 `markAgentRoundStopped` 对非 running 轮次）。**建议**：全部未变则返回原 state。
56. **【低】多处 `set()` 返回空对象 `{}` 造成无意义通知**（`storeV2.ts:401,417`、`store.ts:704`）。**建议**：无操作统一 `return state`。
57. **【中】`agentStreamingTexts` 键值永不清理 + 陈旧 flush 定时器**：`setAgentStreamingText` 每次流式 chunk 写 `${conversationId}:${messageId}`（`runtimeStore.ts:37-42`），`clearAgentStreamingText` 全仓仅 2 处调用（`store.ts:4904,5049`）——正常完成（`:7127-7154`）、出错（`:7176-7211`）、删除会话（`:2478-2496`）路径都不清理 → 每条消息的流式文本键值永久驻留内存；`agentTextFlushTimers` 在完成/出错路径不 flush/clear，陈旧 80ms flush 会把残缺 delta 追加到错误消息后（`:4956-4971`）。**建议**：完成/出错/删除路径统一 flush + clear。

**正面确认（状态层）**：图片字节只在 IndexedDB 按 SHA-256 去重、zustand 只存 id（`getPersistedState` 不持久化 tasks、dataUrl 置空）；瞬时流式数据独立 runtimeStore；executeTask 对迟到结果有状态复核；Agent 轮次有 AbortController 且 map 在 finally 清理；批量编排用 `resultCommitLock` 串行化提交；迁移有 journal + checkpoint；缩略图订阅 37 处均成对 unsubscribe 无泄漏。

---

## 六、代码质量与可维护性

1. **巨型单文件**（>100KB，均为单一组件/模块的"god file"）：

   | 文件 | 规模 | 行数 |
   |---|---|---|
   | `src/store.ts` | 417KB | 9801 |
   | `src/components/SettingsModal.tsx` | 224KB | 3730 |
   | `src/components/InputBar.tsx` | 183KB | 3904 |
   | `src/features/strategy/adapters/GallerySopBatchModal.tsx` | 171KB | 3131 |
   | `src/features/strategy/SopManagementCenter.tsx` | 75KB | ~1600 |
   | `src/components/AgentWorkspace.tsx` | 74KB | ~1600 |
   | `src/lib/agentApi.ts` | 74KB | 1795 |
   | `src/components/DetailModal.tsx` | 66KB | ~1500 |
   | `src/components/FavoriteCollections.tsx` | 64KB | ~1300 |

   这些文件同时是上面性能问题的温床（订阅与计算无法局部化）。**建议**：按"组件壳 + 子组件 + lib"渐进拆分，优先拆 InputBar 与 SettingsModal；拆分过程同步做窄选择优化，一举两得。

2. **无 ESLint / Prettier / Biome**：11.2 万行代码零门禁；非测试代码中 `any` 51 处（全 src 103 处 + electron 3 处）；`src/features/composite/components/BatchExportTab.tsx:236` 有 `eslint-disable-next-line react-hooks/exhaustive-deps` 死指令（插件根本没装）。**建议**：先上 Prettier（零成本格式化），再上 eslint + typescript-eslint 核心规则集（no-explicit-any、react-hooks/exhaustive-deps 最有价值）。
3. **Electron 层不在任何类型检查范围**：根 tsconfig 只 include src；`electron/tsconfig.json` 存在但未被 `tsc -b` 引用，且 include 列表过时（缺 asset-catalog/asset-kernel/asset-mcp/api-transport/asset-api-server 等 5 个现存文件）；`electron:build` 直接 vite build（esbuild 不做类型检查）——`console-message` 这类签名错误 CI 拦不住。**建议**：建 tsconfig.node.json 纳入 `tsc -b` 项目引用，或 build 加 `tsc -p electron/tsconfig.json --noEmit`，并更新过时 include。
4. **CI 不跑测试**：`.github/workflows/release.yml` 只有 `npm run build`（类型检查），`npm test` 从未执行；打 tag 即 `--publish always` 发布；mac/linux 目标声明了但 CI 只有 Windows job。**建议**：CI 增加 test + lint 门禁（PR workflow），发布前跑完整验证，补 mac/linux job 或移除未维护目标。
5. **编码损坏（mojibake）2 处（已修复 1 处）**：
   - `src/lib/imagePostprocess.ts:195` —— **用户可见错误串** `'鍥剧墖瀵煎嚭澶辫触'`（应为"图片导出失败"），FileReader 失败时用户看到乱码。**已修复**；
   - `src/types.ts:114` —— `apiTransportMode` 的 JSDoc 注释乱码。**已修复**。
   - （注：审计初稿误报了 main.tsx / tailwind.config.js / storage-features-feasibility.md 为乱码，经 ripgrep 复核确认是控制台编码显示假象，文件本身完好。）
6. **死代码/死依赖**：根目录 `test-zundo.ts` 实验残留；`zundo` 依赖 0 处导入；`framer-motion` + `lenis` 只被永不渲染的 `ui/demo.tsx` 引用（已被 tree-shake，但依赖应删）；`electron/preload.cjs` 是过时产物（与 `preload.ts` 内容不一致：cjs 有 `removeEmptyDir` 无 assetCatalog* 系列，dev 加载它 → dev/prod 行为漂移）——应删除仓库内 preload.cjs，dev/prod 统一用构建产物。
7. **测试覆盖缺口**：hooks 10 个 0 测试、ordering 6 文件 0 测试、components 52 个文件仅 16 个测试文件；无 Electron 层测试（ipc-handlers 有部分）、无 E2E；无统一 vitest 配置（环境靠 23 个文件头 `@vitest-environment` 注释，无 setupFiles/coverage）。已覆盖的部分质量不错（lib 74/90、db.test.ts 断言事务 abort 回滚、AssetGrid 万条布局测试）。**建议**：优先补 hooks（useDragSelect、useTooltip、useMediaQuery）与 ordering/requirementPrototype 纯逻辑（planner.ts、knowledgeAnalysis.ts、manifests.ts）；加 vitest.config.ts；对主流程（生图→画廊→详情→导出）引入 Playwright 冒烟。
8. **重复实现**：`formatDateKey` 在 `schedule.ts:12` 与 `agentBatchPlanner.ts:110` 逐字重复；另有 formatDateVariable / formatDateToken / formatGeneratedImageDate / formatExportFileTime / formatBytes vs formatStorageBytes 等 5+ 份日期/字节格式化。**建议**：抽 `lib/datetime.ts` + `lib/format.ts` 统一。
9. **生产代码残留**：`electron/main.ts:128-130` debug console.log、`ipc-handlers.ts:383,452` 逐文件 `[image-size]` 日志（且是主线程卡顿的一部分）；src 中 console.log 为 0（正面）；组件中纯注释代码块 116 行（InputBar 36、Lightbox 22）。**建议**：清理或引入 electron-log。
10. **打包细节**：打包后窗口图标路径失效（`main.ts:23-24` 找 `app.asar/public/app-icon.png`，实际产物在 `dist/app-icon.png`）；win-unpacked asar 达 171MB（纯渲染依赖被打进 app.asar，可把可 bundle 依赖移 devDependencies）；未启用 Electron fuses/asarIntegrity；SW 缓存名仍是 v0.6.17。

---

## 七、依赖与构建

- **overrides 合理**：mermaid/dompurify 未直接导入，是 streamdown 的传递依赖安全钉版（mermaid 产物 330KB chunk 实为 streamdown 懒加载，只有渲染 mermaid 代码块时才加载）——无需处理；建议为每个 override 加注释说明对应 CVE/原因；
- **主 chunk 1.27MB**：vite 配置无任何 `manualChunks`，建议拆 vendor（`react-vendor` / `zustand` / `icons`），Web 部署（Vercel/GH Pages）首屏可感知；
- **依赖清理**：
  - `zundo` 完全未使用（0 处导入）——删除；根目录 `test-zundo.ts` 是 UTF-16LE 编码的实验残留，删除；
  - `framer-motion` + `lenis` 只被永不渲染的 `src/components/ui/demo.tsx` → `images-scrolling-animation.tsx` 引用，已确认被 tree-shake 出产物——删除这 2 个文件与依赖（或先真正接入滚动动画再保留）；
  - `core-js` 仅 `src/main.tsx:1` 一处 `Array.at` polyfill——手写 3 行替代后删除；
  - `tailwind-merge` 版本分裂（应用 ^2.6.1，streamdown 用 ^3.4.0，node_modules 两份）——应用升级 ^3.x 对齐；
- **孤儿配置**：`vite.web.config.ts` 无任何脚本引用，删除或并入 vite.config.ts 条件分支；
- **CODE_WIKI.md 过期**：自述版本 0.6.18（实际 0.7.56），测试清单只列 26 个文件（实际 162+）——补生成脚本或人工更新。

---

## 八、快速见效清单（合计约 1-2 天工作量）

1. `TaskCard.tsx:84` settings 改窄选择（5 分钟）；
2. 删除 `updateTaskInStore` 内每次 patch 的 O(n) `countSuccessfulOutputImages` 调用（10 分钟）；
3. 修复 `main.ts:166-170` console-message 签名（10 分钟）；
4. 修复 `src/lib/imagePostprocess.ts:195` 乱码错误串（1 分钟）；
5. `main.ts:23-24` 图标路径改 `../dist/app-icon.png`（5 分钟）；
6. 删除 `test-zundo.ts`、仓库内 `preload.cjs`；卸载 `zundo`（10 分钟）；
7. CI 增加 `npm test`（30 分钟）；
8. `asset-catalog.ts:265,280` sortOrder 枚举校验（10 分钟）；
9. `before-quit` await assetKernel.close + `app.requestSingleInstanceLock()`（30 分钟）；
10. Agent 流式文本改字符串选择器 + 消息气泡 memo（半天，收益最大）。

## 九、中期路线图（1-2 周）

1. **渲染**：高频字段拆独立 store；InputBar/DetailModal 常驻组件窄订阅 + memo；网格只显示缩略图 + Blob URL 缓存；TaskGrid 筛选/瀑布流缓存化；
2. **数据**：`openDB()` 连接复用 + onversionchange；storeImage 改内容哈希（解码字节）去重 + 查重前置；浏览器模式 Blob 入库；
3. **安全**：S1-S5（白名单收紧、导航防护、sender 校验、CSP、api:fetch 白名单）一次性做完；
4. **一致性**：purge 事务化 + 同步队列互斥；asset-kernel 镜像重试队列 + 内容级校验；导入原子化；
5. **工程化**：Prettier + ESLint + electron 类型检查进 CI；巨型文件拆分（InputBar → SettingsModal → store.ts 顺序）；
6. **主进程**：asset-catalog 与解码扫描移入 utilityProcess。

## 十、长期架构演进（1-2 个月）

1. **store.ts 拆分**：按领域切片（tasks、settings、agent、gallery、favorites、wordLibrary）为多个 zustand store + 模块级 action，保留现有 selector 兼容层；
2. **生成管线与 UI 解耦**：把批量编排（`imageBatchOrchestrator`）、后台队列（`ScheduleRunner`、`AgentBatchQueueRunner`、策略批量）从组件/`store.ts` 中提出为模块级 runner，UI 只订阅快照；
3. **图片管线下沉**：统一走 `doupao://` 协议 + Blob URL + 解码并发池，渲染层不再持有大 base64 字符串；
4. **桌面端能力差异化**：Electron 路径（本地保存、asset-kernel、流式导出）与 Web 路径（IndexedDB Blob、流式 zip）明确分叉，减少"一个实现迁就两个平台"的妥协；
5. **可观测性**：关键路径埋点（生成耗时、队列长度、渲染长任务），用 Performance/日志数据驱动后续优化（团队已有"先测量再优化"的纪律，见 `docs/skin-export-jank-analysis.md`，继续保持）。

---

---

## 修复进度（2026-08-10 逐步实施，每阶段全量测试验证）

### ✅ Phase 1 — 快速见效（已完成，163/1133 测试通过）

| # | 修复 | 文件 |
|---|---|---|
| 1 | `console-message` 事件双形态兼容处理（修复 Electron 32+ 下主进程 TypeError） | `electron/main.ts` |
| 2 | 打包后窗口图标路径 `../public/` → `../dist/` | `electron/main.ts` |
| 3 | 单实例锁（`requestSingleInstanceLock` + `second-instance` 唤起窗口） | `electron/main.ts` |
| 4 | `before-quit` 等待 sqlite 关闭（更新安装流程除外，避免破坏 electron-updater） | `electron/main.ts` |
| 5 | 删除生产 debug console.log | `electron/main.ts` |
| 6 | 乱码错误串"图片导出失败" | `src/lib/imagePostprocess.ts` |
| 7 | 乱码 JSDoc 注释 | `src/types.ts` |
| 8 | TaskCard `s.settings` → `s.settings.alwaysShowRetryButton` 窄选择 | `src/components/TaskCard.tsx` |
| 9 | `updateTaskInStore` 移除每次 patch 的 O(n) `countSuccessfulOutputImages` + 死函数 `maybeOpenSupportPrompt` | `src/store.ts` |
| 10 | 删除死依赖 zundo/framer-motion/lenis/core-js 与死文件 test-zundo.ts、ui/demo.tsx、ui/images-scrolling-animation.tsx（同步移除 catalog.ts 条目）、孤儿配置 vite.web.config.ts、过时 preload.cjs（dev/prod 统一用构建产物） | 多处 |
| 11 | CI 测试门禁（release.yml 增加 test + electron 类型检查；新增 ci.yml PR 工作流） | `.github/workflows/` |
| 12 | electron 层接入类型检查（tsconfig 覆盖全部 11 个文件、ESM 模块解析、node:sqlite 最小声明、修复暴露的 8 处类型错误：streaming-zip 联合类型、preload spread、export-zip 条目） | `electron/`、`package.json` |
| 13 | sortOrder SQL 注入面枚举校验 | `electron/asset-catalog.ts` |

### ✅ Phase 2 — 恢复/停止路径正确性（已完成，163/1133 测试通过）

| # | 修复 | 文件 |
|---|---|---|
| 1 | `updateTaskInStore` 增加前置状态条件参数 `expected?: (task) => boolean`，await 后迟到结果无法覆盖已停止任务 | `src/store.ts` |
| 2 | 恢复轮询在途集合 `falRecoveryInFlight`/`customRecoveryInFlight`，杜绝并发双轮询；`scheduleFalRecovery` 在途检查 | `src/store.ts` |
| 3 | `completeRecoveredFalTask/CustomTask` 开头与写库双守卫（`falRecoverable/customRecoverable === true`），停止/删除后不得"复活"为 done | `src/store.ts` |
| 4 | 恢复入口拒绝非 recoverable 任务；恢复可重试错误先移出在途再调度（避免重试永久停止） | `src/store.ts` |
| 5 | `completeAgentImageTask` 写 done 前要求 `status === 'running'`（与失败路径守卫对齐） | `src/store.ts` |
| 6 | `updateTaskInStore` 集中清理：任务变不可恢复（done / recoverable=false）自动清恢复定时器与 watchdog | `src/store.ts` |
| 7 | 删除路径（removeTask/removeMultipleTasks/clearFailedTasks/clearData）显式清三个定时器 + 在途集合 | `src/store.ts` |
| 8 | `submitAgentMessage` 双重提交：updater 内二次校验（关闭 await 间隙），被拦截时提示并返回 | `src/store.ts` |

### ✅ Phase 3 — 泄漏与连接复用（已完成，163/1133 测试通过，构建通过）

| # | 修复 | 文件 |
|---|---|---|
| 1 | Agent 流式状态清理：轮次完成/出错/删除对话时统一 `clearAgentTextFlushTimer` + `clearAgentStreamingText`，防止 `agentStreamingTexts` 键值永久驻留与陈旧 80ms flush 把残缺 delta 追加到终态消息 | `src/store.ts` |
| 2 | IndexedDB 连接复用：模块级缓存（按 `indexedDB` 全局引用为键，测试 stubGlobal 自动失效）；`onversionchange` 自动关闭重置；`indexedDB` 不可用时返回已拒绝 Promise（绝不同步抛错，修复了缓存引入的未处理拒绝） | `src/lib/db.ts` |

### ✅ Phase 4 — Electron 安全加固（已完成，163/1133 测试通过，构建通过）

| # | 修复 | 文件 |
|---|---|---|
| 1 | **IPC 发送方校验**：新增 `ipc-guard.ts`（`assertTrustedSender`：主窗口主 frame + 自身源校验），`ipc-handlers.ts` 约 60 个 handler 全部经 `handleChecked`/`onChecked` 包装；`api-transport.ts` 两个 api:fetch 通道、`main.ts` 自有 5 个 handler、`asset-kernel.ts` 的 trusted() 一并接入 | `electron/ipc-guard.ts`（新）、`ipc-handlers.ts`、`api-transport.ts`、`main.ts`、`asset-kernel.ts` |
| 2 | **导航/弹窗防护**：`will-navigate` 拒绝非白名单 URL（dev 仅 dev server、prod 仅 file://）；`setWindowOpenHandler` 一律 deny，http(s) 链接交系统浏览器；`web-contents-created` 全局施加 | `electron/main.ts` |
| 3 | **CSP（打包版）**：`onHeadersReceived` 下发（script-src 'self'、object-src 'none'、base-uri/frame-ancestors/form-action 收紧；style/img/font/connect 按功能放宽并注明原因）；dev 模式不启用避免破坏 HMR | `electron/main.ts` |
| 4 | **doupao:// 协议 MIME 白名单**：仅 `image/*` 按原类型下发，其余一律 `application/octet-stream`（防 DB 中被替换为 HTML 后在 secure 源执行脚本） | `electron/asset-kernel.ts` |
| 5 | **路径白名单收紧（部分）**：移除 `distributeCompositeFile` 的目标目录自动加根（分发目标必为已授权来源目录的子目录，功能不受影响）；`scanEnteredCompositeBackgroundFolder`/`authorizeCompositeOutputDirectory` 的自动加根保留（用户输入目录/输出根目录的产品流程依赖，已在报告中标注残余风险，彻底方案需改为系统对话框流程） | `electron/ipc-handlers.ts` |

**仍待处理（安全）**：api:fetch 主机白名单（S5，需基于配置文件的 baseUrl 构建主进程白名单）；Windows 代码签名/updater 签名校验（S7，发布流程事项）。

### ✅ Phase 5 — 写盘合并与缩略图优先（已完成，163/1133 测试通过，构建通过）

| # | 修复 | 文件 |
|---|---|---|
| 1 | **瞬态字段写盘合并**：`updateTaskInStore` 中仅含瞬态字段（progressStage/progressMessage/progressUpdatedAt/streamPartialImageIds）的 patch 走 300ms 合并写盘（单飞+排队，写盘时读取当前内存状态），非瞬态 patch（status/outputImages/error 等）保持立即写盘；`pagehide` 时尽力 flush——单次生成 10~30+ 次整任务 IDB 重写收敛为少量合并写 | `src/store.ts` |
| 2 | **workspaceTabs 身份保持**：任务不属于任何 tab 时不再重建数组，订阅者不随进度 tick 无谓重渲染 | `src/store.ts` |
| 3 | **网格缩略图优先**：`GalleryImageTile` 挂载只加载缩略图，原图改为 `pointerenter`（hover 交互意图）按需加载——消除可见区 20-40 个 tile 同时解码 2K/4K 原图的 100-300MB 峰值内存；更新对应交互测试为新行为 | `src/components/GalleryImageTile.tsx` + 测试 |
| 4 | **高频进度字段拆分 runtimeStore**：`updateTaskProgress` 只写 `useRuntimeStore.taskProgress`（带相等短路），不再重建 tasks 数组、不触发 s.tasks 订阅者重渲染、不写 IndexedDB；`taskProgressDisplay`/`TaskCard`/`DetailModal`/`GalleryTaskNavigator` 读取实时进度（任务对象字段仅作兼容回退）；任务 done/删除时清理避免泄漏；相关测试更新为断言 runtimeStore | `src/stores/runtimeStore.ts`、`src/store.ts`、`src/lib/taskProgressDisplay.ts`、`TaskCard.tsx`、`DetailModal.tsx`、`GalleryTaskNavigator.tsx`、`store.test.ts` |

### ✅ Phase 6 — 网格重算缓存化 + 内容哈希去重（已完成，163/1133 测试通过，构建通过）

| # | 修复 | 文件 |
|---|---|---|
| 1 | **瀑布流布局内容戳记缓存**：`buildGalleryMasonryLayout` 以（aspectRatios 数值序列 + columns/width/gap）为键做单槽缓存——瞬态更新（streamPartialImageIds 每帧）不改变这些输入时直接复用布局对象，下游 `visibleMasonryItems` useMemo 短路；避免每帧 O(images × columns) 重排 + 大量对象分配。正确性论证：布局位置只取决于 ratios 序列，图片增删导致 ratios 变化即自动重算 | `src/lib/galleryMasonryLayout.ts` |
| 2 | **筛选 JSON.stringify 去重**：`filterGalleryTasks` 引入 per-task `WeakMap` 的 params 字符串缓存（任务对象引用不变则复用）——每次任务更新不再对全部任务重复 JSON.stringify(params)。**注意**：审计初拟的"筛选结果引用稳定缓存"方案因会让下游卡片拿到过期任务对象而被否决，改为保留全量重算 + 消除最贵单项 | `src/lib/galleryTaskFilter.ts` |
| 3 | **storeImage 内容哈希去重**：去重 id 从"base64 字符串哈希"改为"解码字节 SHA-256"（`imageFingerprint.computeContentHash`）——同图重新编码/重新压缩/换 MIME 后字节一致仍能去重；重复上传且已有本地文件时跳过冗余文件写入（查重前置到写文件之前）；`InputBar`/`compositeExportRuntime` 的引用 id 同步切换，删除废弃的 `hashDataUrl`（含旧 fallback）；旧字符串哈希 id 记录无需迁移 | `src/lib/db.ts`、`src/components/InputBar.tsx`、`src/features/composite/lib/compositeExportRuntime.ts` |

### ✅ Phase 7 — 浏览器端流式 ZIP 导出/导入（已完成，163/1133 测试通过，构建通过）

| # | 修复 | 文件 |
|---|---|---|
| 1 | **导出改流式 ZIP**：`exportData` 浏览器分支不再 `getAllImages()` 全表 + 全量字节驻留 + `zipSync` 同步压缩；改为 `getAllImageIds` + `batchGetImages`（16 条一批，批间让出事件循环）+ fflate `Zip` 增量写入——图片/缩略图/合成资源用 `ZipPassThrough`（存储模式：本身已是压缩格式，避免压缩内存翻倍），manifest 用 `ZipDeflate`；峰值内存从 ≈3-4× 库大小降为 zip 输出 + 单批图片；条目 mtime 加 1980-2099 合法性校验 | `src/store.ts`、`src/lib/db.ts`（新增 `batchGetImageThumbnails`） |
| 2 | **导入改两遍流式解压**：`importData` 不再 `unzipSync` 全量展开——第一遍 `scanZipArchive` 只解压 manifest + 收集条目路径清单（未 start() 的条目不解压不驻留）；`validateBackupArchive` 改为路径清单校验（新增 `archivePaths` 参数）；第二遍逐条目解压，图片/缩略图 ≤32/64 条一批 `commitImportedRecords` 落库后即弃，合成资源保留给 restoreCompositeBackup；`bytesToDataUrl` 改分块转换；删除死代码 `generateExportZipBuffer`（审计确认无调用者）；`unzipSync`/`zipSync` 依赖移除 | `src/store.ts`、`src/lib/backupImport.ts` |
| 3 | **语义说明**：导入原子性由"单事务全量"降为"逐批提交"（审计已指出导入本无整体原子性），失败时已落库图片保留、任务不提交；旧版 zipSync 备份（deflate 条目）与新备份（stored 条目）均可正常导入（UnzipInflate + UnzipPassThrough 双注册） | — |

### ✅ Phase 8 — purge TOCTOU 事务化 + 墓碑批量查询（已完成，164 文件 / 1136 用例通过，构建通过）

| # | 修复 | 文件 |
|---|---|---|
| 1 | **素材写锁（TOCTOU 修复核心）**：新增 `assetWriteLock.ts`（promise 链互斥，不可重入）；`upsertFromTask` 的"读墓碑快照 → 构建 → 写素材"、`executeAssetPurge` 的"删素材 + 写墓碑"事务、`deleteGeneratedAsset` 的"删资产 + 孤儿 blob GC"、`putGeneratedAsset(s)` 全部持有同一把锁——purge 提交后同步队列不可能再用旧墓碑快照把已删素材"复活"；`persistIdentityAndMirror` 拆出 Unlocked 内部实现避免嵌套死锁（设计约定：嵌套持锁场景由最外层统一持锁）；附锁单元测试（串行化/失败不卡死/排队不放行） | `src/lib/assetWriteLock.ts`（新）+ 测试、`src/lib/assetLibraryRepository.ts`、`src/lib/assetPurge.ts` |
| 2 | **墓碑按 imageId 批量查询**：DB_VERSION 12→13 迁移（新建/旧库均补 `imageId` 索引）；新增 `batchGetAssetTombstones(imageIds)` 走索引查询，替代 `upsertFromTask` 每次同步的全表扫描（几十个候选槽位 vs 全表）；测试 mock 同步更新 | `src/lib/db.ts`、`src/lib/assetLibraryRepository.ts`、相关测试 mock |
| 3 | **deleteGeneratedAsset 竞态修复**：孤儿 blob 清理（按引用推断）纳入写锁，与并发 `persistIdentityAndMirror` 串行，不再误删共享 blob | `src/lib/assetLibraryRepository.ts` |

### ✅ Phase 9 — 任务取消 + 镜像一致性 + 主进程减负 + ESLint 门禁（已完成，164 文件 / 1136 用例通过，构建通过）

| # | 修复 | 文件 |
|---|---|---|
| 1 | **executeTask 任务级 AbortController**：`taskAbortControllers` Map + `stopTask()`（中止在途请求 + 清理恢复定时器）；signal 透传 `CallApiOptions`（新增字段）→ `callImageApi` → OpenAI 兼容（3 处请求路径经 `linkTaskSignal` 链接到超时 controller）与 fal（步骤间检查）；`runWithConcurrencyAndRetry`/`retryTransientRequest`/`retryWithBackoff` 支持 signal 且退避等待可中止；编排主循环每轮检查；AbortError 在 catch 中收敛为"任务已停止"（保留已生成图片）；finally 释放控制器 | `src/store.ts`、`src/lib/imageApiShared.ts`、`src/lib/api.ts`、`openaiCompatibleImageApi.ts`、`falAiImageApi.ts` |
| 2 | **asset-kernel 镜像重试队列 + 内容级校验**：`persistIdentityAndMirrorUnlocked` 的 `assetCatalogUpsert` 与 `deleteGeneratedAsset` 的 `assetCatalogDelete` 失败不再静默，进入带退避的重试队列（上限 5 次，超限记日志）；`hydrate` 在 count 一致时新增内容级校验——比较最近 200 条（updatedAt 倒序，IndexedDB 索引 vs SQLite 查询）是否一致，捕捉"数量相同但内容落后"的镜像漂移 | `src/lib/assetLibraryRepository.ts`、`src/lib/db.ts`（新增 `getRecentGeneratedAssets`） |
| 3 | **主进程减负（低风险先行）**：`AssetCatalog.getCounts` 加 5s TTL 缓存（写入路径失效）——query/recommend 不再每次全表 SUM + 两趟 json_each 分组；背景图扫描 `getImageSizeSync` 改为**文件头解析**（PNG IHDR / JPEG SOF / WEBP VP8/VP8L/VP8X），替代 `nativeImage.createFromPath` 全量解码（上千张图不再阻塞主进程数秒），删除逐文件 console.log | `electron/asset-catalog.ts`、`electron/ipc-handlers.ts` |
| 4 | **ESLint/Prettier 门禁**：新增 `eslint.config.js`（flat config：js + typescript-eslint recommended + react-hooks；rules-of-hooks 为 error，exhaustive-deps / no-explicit-any 为 warn，存量噪音规则降级 warn）、`.prettierrc`、`.prettierignore`、`lint`/`format`/`format:check` scripts；**顺带修复 3 个真实问题**：① DetailModal 在 early return 后调用 hook（rules-of-hooks error，hook 移到 return 之前）② streaming-zip 的 async Promise executor 反模式（审计 R5，改 sync executor + async run() + catch(fail)）③ WorkspaceTabManagerModal 的 require() 改动态 import；`eslint --fix` 自动清理可修复项；CI（ci.yml + release.yml）增加 lint 步骤；当前 **0 errors / 189 warnings**（any 51 处等存量待后续收敛） | `eslint.config.js`（新）、`.prettierrc`（新）、`package.json`、`.github/workflows/`、`DetailModal.tsx`、`streaming-zip.ts`、`WorkspaceTabManagerModal.tsx`、`GalleryImageTile.tsx`、`InputBar.tsx` 等 |

### ✅ Phase 10 — Prettier 全量格式化 + ESLint 存量收敛 + 发布质量三项（已完成，164 文件 / 1136 用例通过，构建通过）

| # | 修复 | 文件 |
|---|---|---|
| 1 | **Prettier 全量格式化**：`npm run format` 统一 364 个文件的风格（单引号/无分号/120 宽），`format:check` 可作 CI 门禁；格式化后 tsc/eslint/tests 全绿 | 全仓 + `.prettierrc`/`.prettierignore` |
| 2 | **ESLint 存量收敛**：清零并**重新收紧为 error** 三条规则——`no-useless-escape`（runner.ts 正则字符类、agentBatchImport.ts `[/-]`）、`preserve-caught-error`（8 处错误补 `{ cause }`：agentApi 超时×3、imageApiShared×3、storeSopGeneration、falAiImageApi）、`no-control-regex`（7 处文件名控制字符剥离为刻意行为，加豁免注释）；当前 **0 errors / 162 warnings**（no-explicit-any 111、exhaustive-deps 37、no-useless-assignment 14 待后续收敛） | `eslint.config.js`、runner.ts、agentBatchImport.ts、agentApi.ts、imageApiShared.ts、falAiImageApi.ts、storeSopGeneration.ts 等 |
| 3 | **窗口状态持久化**：窗口 bounds（位置/尺寸）在 resize/move 防抖 500ms 保存、关闭时落盘 `userData/window-state.json`，启动时恢复（校验数值范围，minWidth/minHeight 兜底） | `electron/main.ts` |
| 4 | **渲染进程崩溃恢复退避**：60s 内 ≥3 次崩溃停止自动 reload（原为无限循环），加载内置错误提示页；`decideRendererRecovery` 返回 `{reload:false}` 分支 + 测试覆盖 | `electron/renderer-crash-recovery.ts` + 测试、`electron/main.ts` |
| 5 | **Electron fuses 加固**：`@electron/fuses` 在打包产物上禁用 RunAsNode / Node 选项环境变量 / CLI inspect，启用 Cookie 加密 + asar 完整性校验 + 仅从 asar 加载；`scripts/apply-fuses.mjs` 自动探测 win/mac/linux 产物，接入 `electron:build`（无产物时安全跳过） | `scripts/apply-fuses.mjs`（新）、`package.json` |

### 📋 utilityProcess 化 asset-catalog 评估（含运行期修正）

- **现状**：asset-catalog 全同步 node:sqlite 仍在主进程；本轮已通过 getCounts 缓存 + 文件头取尺寸显著缓解主线程阻塞；索引（FTS/向量）已跑在 indexer utilityProcess；
- **运行期确认（2026-08-16）**：**utility process 的 electron 模块不提供 `nativeImage` 导出**（实测 SyntaxError）——感知哈希等需要图像解码的计算**无法**移入 utilityProcess；
- **剩余主线程成本**：感知哈希 `perceptualHash(record.localPath)`（`asset-kernel.ts`）仍在主进程；
- **可行替代路径**：① 渲染进程计算感知哈希（renderer 已有 `imageFingerprint.ts` 的像素管线，素材 dataUrl 本就驻留渲染端）后随 `assetCatalogUpsert` 上报；② 保持主进程计算但按需触发（如仅对缺失 hash 的素材、批量导入时降采样后再哈希）；③ 完整 catalog RPC 化（node:sqlite 移入 utilityProcess）仍可行（sqlite 不依赖 nativeImage），改动面大，建议在有实测瓶颈数据后再做。

### ✅ Phase 11 — 感知哈希尝试移入 indexer（已回退）+ Prettier CI + any 清零 + 签名工程化（已完成，164 文件 / 1137 用例通过，构建通过）

> ⚠️ **运行期回退记录（2026-08-16）**：第 1 项「感知哈希移入 indexer」在实机运行时报 `SyntaxError: The requested module 'electron' does not provide an export named 'nativeImage'` —— **Electron utility process 的 electron 模块不提供 `nativeImage` 导出**（已核实：indexer 由 `utilityProcess.fork` 以 Node ESM 加载，无法使用主进程的 nativeImage）。已回退：`perceptualHash` 恢复在主进程计算（`asset-kernel.ts`），indexer 恢复纯文本向量（`asset-indexer.ts`），消息不再携带 localPath。**结论**：感知哈希迁移的可行路径是「渲染进程计算（renderer 已有 imageFingerprint 像素管线）后随 upsert 上报」或「主进程保留 + 异步化」，utilityProcess 方案不可行。

| # | 修复 | 文件 |
|---|---|---|
| 1 | **感知哈希移入 indexer（已回退）**：尝试将 `perceptualHash` 移至 `asset-indexer.ts` 并在主进程取消逐图解码——运行时确认 utility process 不支持 `nativeImage`（SyntaxError），**已回退**；恢复主进程计算，代码中留注释记录限制 | `electron/asset-indexer.ts`、`electron/asset-kernel.ts`（回退后） |
| 2 | **Prettier CI 门禁**：`format:check` 接入 ci.yml 与 release.yml | `.github/workflows/` |
| 3 | **no-explicit-any 源码清零**：非测试源码 55 → **0**（19 个文件 57 处：`as any` → 精确类型、`catch (error: any)` → instanceof 收窄、`errJson: any` → Record 收窄、store.ts 13 处冗余断言直接删除，连带修正 Select.onChange 收紧后的 2 处调用方）；剩余 57 处全在测试文件（mock 惯用法，按要求保留）；eslint 总量从 162 warnings 降至 **0 errors / 108 warnings** | 19 个源码文件 |
| 4 | **签名工程化**：`electron-builder.config.cjs` 取代 package.json 静态 build 块——Windows 有 `CSC_LINK`/`CSC_KEY_PASSWORD` 时自动签名（`signAndEditExecutable` 条件化）+ `publisherName` 写入（electron-updater Windows 发布者校验）；mac 有 `APPLE_ID` 时自动公证（hardenedRuntime + notarize）；配置头注释文档化无签名风险；`scripts/apply-fuses.mjs` 已对 win-unpacked 产物实测生效 | `electron-builder.config.cjs`（新）、`package.json` |
| 5 | **exhaustive-deps 评估结论**：37 处多为有意的 mount-once 效果或行为敏感项（盲加依赖有死循环/行为回归风险），保持 warn 待人工逐处评审；`no-useless-assignment` 14 处同理（多为防御性初始化） | — |
| 6 | **构建产物损坏修复（运行检测发现）**：preload.cjs 曾出现内容交错 + 非法 `export default`（SyntaxError: Unexpected token ':'）——根因是 dev server 进程被强杀时 vite-plugin-electron 半写构建产物；`npm run build` 重新生成后 `node --check` 通过。**注意**：dev 模式下强杀进程后若遇 preload 报错，重建即可 | `dist-electron/`（重建产物） |

### 🖥️ 运行检测（2026-08-16 复跑全量验证 + 实机启动）

| 检测项 | 结果 |
|---|---|
| 全量验证管线（tests / tsc×2 / eslint / build） | ✅ 164 文件 / 1137 用例、0 类型错误、0 lint 错误 |
| Vite dev server（127.0.0.1:41731） | ✅ 309ms ready，HTTP 200，main.tsx 正常转换 |
| 浏览器端实际渲染（无头截图 `app-screenshot.png`） | ✅ 工作区标签/统计栏/提示词输入/生成设置/词条库/日程表完整渲染，无白屏无报错 |
| 打包版 Electron（fuses 加固后 `release/win-unpacked/DOUPAO V2.exe`） | ✅ 成功启动（main/GPU/renderer/utility 四进程），窗口标题 DOUPAO Image，内存 ~121MB |
| 打包版数据层 | ✅ 桌面截图确认素材库显示 7 张真实素材、项目（APP/短剧）——IndexedDB + asset-kernel SQLite 工作正常 |
| **单实例锁实证** | ✅ 二次启动被拦截正确退出（exit 0，聚焦已有窗口） |
| 崩溃诊断 | ✅ `diagnostics/renderer-crashes.jsonl` 不存在 = 运行期间零渲染进程崩溃 |
| 清理 | ✅ 应用实例与 dev server 均已停止（证据截图保留：`app-screenshot.png`、`desktop-capture.png`） |

### ⏳ 待后续阶段（见 §八/§九）

- 高频字段（progress/streamPartialImageIds）拆独立 store、`tasks` Map 索引化、InputBar/常驻弹窗窄订阅 + memo（渲染 §三.1）
- `executeTask` 任务级 AbortController（§五.2-31）
- persist 序列化合并、`putTask` 写放大合并（§五.2-39/46）
- 浏览器端流式 ZIP 导出/导入（§五-4）
- api:fetch 主机白名单（§四 S5，需基于配置 baseUrl 构建主进程白名单）；Windows 代码签名/updater 签名校验（S7，发布流程事项）
- purge TOCTOU 事务化、asset-kernel 镜像重试（§五-1/2）
- ESLint/Prettier 引入（§六-2）

---

*附：本报告结论来自 5 路并行审计（状态层、Electron/IPC、持久化层、渲染性能）+ 依赖与工程化审计，关键结论经人工复核。测试全量 163 文件 / 1133 用例通过。*
