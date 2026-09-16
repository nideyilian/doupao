# DOUPAO 性能诊断报告

> 诊断日期：2026-09-16　代码基线：v0.8.18（`d365b2e`）
> 范围：界面卡顿、图片加载耗时、操作响应延迟
> 方法：静态代码走查 + 数据通路上机核验；第七节的每一项都补了**真机量测**
> （临时 Electron 装置跑生产模块本体 + 本机真实库样本，非复刻实现；见修复 6/7/8 各自的实测小节）

---

## 一、结论摘要

当前项目**已经做过一轮针对性的性能工程**，且做对了最关键的两件事：

1. 高频瞬态进度被移出主 store（`src/stores/runtimeStore.ts`），避免进度 tick 重建 `tasks` 数组；
2. SQLite 目录查询跑在 UtilityProcess（`electron/catalog-client.ts`），主进程不被 `DatabaseSync` 同步阻塞。

因此**问题不在「架构没考虑性能」，而在三条具体链路仍保留了早期实现，没有跟上后来的优化**：

| 类别       | 首要症结                                             | 一句话结论                                                    |
| ---------- | ---------------------------------------------------- | ------------------------------------------------------------- |
| 界面卡顿   | 主进程同步 fs（92 处）+ 批量目录读取无上限           | 卡的不是 React，是 Electron 主进程事件循环被同步 I/O 占住     |
| 图片加载慢 | 全图统一经 base64 data URL，单张经历 5 次字节复制    | 已有更优的 `doupao://` 磁盘协议，任务输出图却完全没接上       |
| 操作延迟   | `getNextTaskFilenameBatch` 三层嵌套扫描 + 跨进程双写 | 每张图命名都要做一次三层嵌套查找；单张图落库要跨 4 次进程边界 |

**最高性价比的单项修复**：`listCompositeImageFiles`（`electron/ipc-handlers.ts:740`）——它没有任何上限地同步读满整个目录，是唯一能一次操作就冻住整个应用的路径。**修复只需给读取加上限并改异步，不动任何业务语义。**

> **报告修订（2026-09-16，实施阶段）**
> 着手修复时发现两处初版结论需要修正，已在下文对应章节标注：
>
> 1. **B2（grid 缩略图通道）并非「约 2 行」**。主进程与 preload 确实已把 `variant` 铺好，但**渲染进程从来没有写过 grid 文件**，所以只补读参数只会永远未命中。真正的接通需要「生成侧补写小图 + 缓存/订阅按 variant 分键 + 消费方逐个切换」，而缩略图子系统（`store.ts:692-1120` 的闸门/优先级/回填/等待者队列）全部按 `id` 分键，改动会渗透整层。初版把它评为「极低成本」是**误判**，已改为 P1，并已于同日按 P1-4 分步方案**落地完成**（见第七节「修复 6」）。
> 2. **A3 中 `updateTaskInStore` 被高估**。它的 `tasks.map` 与 tab 扫描虽为线性，但常数极小（千级任务实测在 1ms 以内），并不构成卡顿主因；A3 真正的二次方量级问题只有 `getNextTaskFilenameBatch` 一处，已修复。

---

## 二、问题诊断结论

### A. 界面卡顿

#### A1【严重】主进程同步 fs 阻塞 —— 全局卡顿的根因

**证据**

- `electron/ipc-handlers.ts` 内共 92 处同步 fs 调用（`readFileSync` / `writeFileSync` / `existsSync` / `statSync` / `readdirSync`）。
- `fs:read-file-buffer`（`electron/ipc-handlers.ts:1266`）：
  ```ts
  const buffer = readFileSync(safeFilePath)                                  // 同步读，阻塞
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, ...)            // 再整份复制
  ```
- `composite:read-image-file` → `readImageFilePayload`（`electron/ipc-handlers.ts:731`）：同步读 + `buffer.toString('base64')`。
- `fs:save-image`（`electron/ipc-handlers.ts:1287`）：`writeFileSync` 同步写整张图。

**根因**

Electron 主进程是唯一的：窗口消息、菜单、托盘、所有 IPC 分发、自定义协议都在它的同一个事件循环上。任何一次同步 I/O 都会让**整个应用**（包括拖窗口、滚动、鼠标响应）停等。渲染进程层面的 React 优化再到位，也救不了主进程被卡住的这一段。

一张 8MB 的 PNG：`readFileSync` 约 5–20ms（视磁盘），`buffer.slice()` 再 memcpy 8MB 约 3–8ms，合计单次 10–30ms 纯主线程占用。批量查看时按张累加。

**同类问题**：`electron/ipc-handlers.ts:753` 的 `readImageFilePayload` 是「读盘 + base64」写在一行，属于双重代价。

---

#### A2【严重】批量目录读取无数量上限 —— 最可能造成「操作后整个界面卡死」

**证据**（`electron/ipc-handlers.ts:740`）

```ts
function listCompositeImageFiles(dirPath: string) {
  const safeDirPath = assertAllowedPath(dirPath)
  if (!existsSync(safeDirPath) || !statSync(safeDirPath).isDirectory()) return []
  return readdirSync(safeDirPath)
    .map((name) => path.join(safeDirPath, name))
    .filter((filePath) => {
      try {
        return statSync(filePath).isFile() && isCompositeImagePath(filePath)
      } catch {
        return false
      }
    })
    .map((filePath) => {
      const buffer = readFileSync(filePath) // 逐张同步读全图
      return {
        path: filePath,
        name: path.basename(filePath),
        dataUrl: `data:${mimeFromImagePath(filePath)};base64,${buffer.toString('base64')}`,
      } // 逐张 base64
    })
}
```

**没有任何数量上限、分页或节流**，且全程同步。一旦目录里有 N 张图，主进程需要：

1. `statSync` N 次；
2. `readFileSync` + `toString('base64')` N 次（每次都是完整的图 + 33% 膨胀）；
3. 最后把这 N 个 data URL 作为**一个数组**结构化克隆回渲染进程。

**触发场景（均为日常操作）**

| 调用方                       | 位置                                                                  | 场景                                             |
| ---------------------------- | --------------------------------------------------------------------- | ------------------------------------------------ |
| `composite:list-image-files` | `ipc-handlers.ts:1190`                                                | 掩码/合成选择图片文件夹                          |
| `composite:pick-image-file`  | `ipc-handlers.ts:1224`                                                | 从文件夹抽一张图（**为了抽一张而读完整个目录**） |
| `listImageFiles`             | `src/lib/agentBatchExecution.ts:11`                                   | Agent 批量执行，加载参考图文件夹                 |
| `listImageFiles`             | `src/features/requirementPrototype/knowledgeAnalysis.ts:148`          | 知识分析读取本地素材                             |
| `listImageFiles`             | `src/features/strategy/adapters/RequirementStrategyWorkspace.tsx:385` | 策略工作区                                       |

**量级估算**：200 张 × 4MB 的参考图文件夹 → 主进程同步读 800MB、生成约 1.07GB base64 字符串、再尝试把 1.07GB 结构化克隆过 IPC。表现就是**界面完全冻结数十秒，内存冲高，严重时 OOM 或渲染进程崩溃**。`composite:pick-image-file` 更荒谬：只为随机取一张，却读了全部。

---

#### A3【高】任务数组的 O(n) / O(n²) 全量扫描

**证据**

1. `getNextTaskFilenameBatch`（`src/store.ts:426`）——**三层嵌套，本项唯一真正的二次方量级问题**：

   ```ts
   const unownedTasks = state.tasks.filter(
     (task) => !state.workspaceTabs.some((item) => item.tasks.some((c) => c.id === task.id)) && ...
   )
   ```

   无目标 tab 时复杂度约 O(任务数 × 标签页数 × 每页任务数)。5000 任务 × 30 标签页 × 100 任务/页 ≈ **1500 万次比较**，而它在「保存到本地」链路里被**每张图命名时各调用一次**，批量出图时反复触发。

2. `setTasks`（`src/store.ts:3349`）——每次调用都全量统计：

   ```ts
   setTasks: (tasks) => set(() => ({
     tasks,
     ...(countSuccessfulOutputImages(tasks) <= SUPPORT_PROMPT_IMAGE_THRESHOLD ? {...} : {}),
   }))
   ```

   `countSuccessfulOutputImages`（`src/store.ts:1147`）是 `tasks.reduce` 全量遍历，只为判断是否超过 50 张阈值。

3. `updateTaskInStore`（`src/store.ts:10451`）——`tasks.map` 全量重建 + 对每个 tab 做一次 `findIndex`。
   **实测不构成卡顿主因**（修订：初版把它列为「每次操作重建整个数组」的严重项，属高估）：
   千级任务下 `map` 本身在 1ms 以内，tab 扫描的常数也极小。它是「结构上不够优雅」，但在真实量级下不是可感知的延迟来源，列为 P2 而非 P1。

**根因**：store 采用扁平数组 + 线性查找。项目已把「高频进度」移出主 store，但状态**结构**没变，凡是改动任务的操作仍触发全量扫描——只是绝大多数扫描的常数都足够小，
真正会造成可感知卡顿的只有 `getNextTaskFilenameBatch` 这一处二次方量级实现。

---

#### A4【中】大组件订阅整个 `tasks` 数组

**证据**：`src/` 内共 **396 个** `useStore((s) => ...)` 订阅点，其中 **19 处**直接订阅整个 `s.tasks`：

- `src/components/InputBar.tsx:730`（该组件 5503 行，单文件订阅 51 个选择器，同时订阅 `tasks` + `workspaceTabs` + `agentConversations` + `wordLibraryEntries`）
- `src/components/Header.tsx:106`
- `src/components/Lightbox.tsx:27`
- `src/components/DetailModal.tsx:57`
- `src/components/FavoriteCollections.tsx:447 / 743 / 1274`
- `src/components/ScheduleModal.tsx:80`
- `src/components/AgentWorkspace.tsx:517`
- `src/components/AgentBatchPlannerModal.tsx:124`
- `src/components/SopBatchDetailModal.tsx:207`

`tasks` 数组引用在任何任务变更时都会换新（`updateTaskInStore` 用 `map` 重建），于是这些组件**全部重渲染**——包括它们内部整棵子树和未 memo 的计算。

**值得肯定的是**：走查未发现「返回新对象/新数组引用」的不稳定选择器（这类会造成每次 `set` 都重渲染），也没有裸 `useStore()`。订阅纪律整体良好，问题集中在「订阅粒度太粗」而非「订阅方式错误」。

---

#### A5【中】渲染进程主线程上的图像处理

**证据**

1. `decodeDataUrlToBytes`（`src/lib/imageFingerprint.ts:35`）：

   ```ts
   const binary = atob(data)
   const bytes = new Uint8Array(binary.length)
   for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) // 纯 JS 逐字符循环
   ```

   5MB 图 → `atob` 出 5M 字符字符串，再跑 500 万次 `charCodeAt`。这是**完全阻塞主线程**的同步循环，单张量级数十毫秒。而它被 `computeContentHash`（`imageFingerprint.ts:58`）调用，`computeContentHash` 又在 `storeImage`（`src/lib/db.ts:1064`）里对**每一张新图**调用。

2. `createImageThumbnail`（`src/lib/db.ts:1400`）：`loadImage` → `canvas.drawImage` → `canvas.toDataURL('image/webp', 0.82)`。WebP 编码开销大，且发生在渲染主线程（并发上限 4，见 `MAX_THUMBNAIL_BACKFILL_CONCURRENT`）。

两者叠加：**批量生成或批量导入图片时，渲染主线程被连续的 base64 编解码与 WebP 编码占满**，表现为界面整体掉帧。

---

### B. 图片加载耗时

#### B1【严重】全图统一走 base64 data URL，单张经历 5 次字节复制

**链路**（`src/store.ts:734` `loadAndCacheImage` → `src/store.ts:744`）

见文首链路图。一张盘上 5MB 的图，要走完：

1. 主进程 `readFileSync` —— 同步阻塞主进程（A1）
2. `buffer.buffer.slice(...)` —— 整图再 memcpy 一份
3. 结构化克隆跨 IPC —— 第三份
4. `new Blob([data])` —— 第四份
5. `FileReader.readAsDataURL` —— base64 编码，5MB → 6.7M 字符字符串
6. `<img src="data:...">` —— 浏览器**再把 base64 解码回字节**，然后才解码图像

即约 30MB 内存流量换一次看图，其中第 1、2、6 步分别在主进程与渲染主线程上同步执行。

**关键点：项目已经有更优通道，只是没接上。**

- `doupao://` 协议已注册为特权协议：`standard: true, secure: true, supportFetchAPI: true`（`electron/asset-kernel.ts:537`），并在 `electron/main.ts:155` 启动时注册。
- 已实现磁盘流式下发 + 强缓存（`electron/asset-kernel.ts:433`）：
  ```ts
  const data = await readFile(details.blob.localPath) // 异步，不阻塞
  return new Response(data, {
    headers: {
      'Content-Type': safeMime,
      'Cache-Control': 'private, max-age=31536000, immutable', // 浏览器原生缓存
      'X-Content-Type-Options': 'nosniff',
    },
  })
  ```
- CSP 也已放行：`img-src 'self' data: blob: doupao:`（`electron/main.ts:493`）。
- 但目前 `doupao://` 只服务**素材库**，渲染进程里仅两处引用（`AssetLibrarySidebar.tsx:779` 的深链接、`localSave.ts:202` 的注释），**任务输出图完全没有走这条路**。

把有 `localPath` 的输出图改成 `<img src="doupao://...">`，可以一次性消掉第 1–6 步的全部冗余：浏览器原生加载、原生解码、原生 HTTP 缓存，渲染进程零拷贝。这是本报告**收益最大的一项结构性改进**。

> **✅ 已实施（2026-09-16）**：新增 `doupao://image/` 主机名，展示路径已接入。实施与实测结论见第七节「修复 5」。
>
> **实测得到的两条硬约束（后续改动必须遵守）**：
>
> 1. **协议图会污染 canvas**。实测 `drawImage(协议图)` 后 `getImageData()` 抛 `SecurityError`。因此协议地址**只能进 `<img src>`**；任何需要像素的路径（遮罩合成、导出、上传接口、剪贴板）必须继续用 `ensureImageCached` 的 dataUrl。
> 2. **`fetch('doupao://...')` 被 CSP 拦掉**（`connect-src` 不含 `doupao:`，实测 `TypeError: Failed to fetch`）。这是刻意保留的纵深防御：该协议只能作为图片来源，无法被用来把本地文件读成文本外传。

---

#### B2【高】网格磁贴读的是 1024px 大缩略图 —— `grid` 通道是死代码

**这是一个「设施已就绪、只差接通」的问题。**

代码里为缩略图设计了两条独立通道：

| 通道   | 文件名              | 尺寸          | 支持位置                   |
| ------ | ------------------- | ------------- | -------------------------- |
| `full` | `{id}.v5.webp`      | 最长边 1024px | 默认                       |
| `grid` | `{id}.v5.grid.webp` | 网格小图      | 需显式传 `variant: 'grid'` |

支持情况一应俱全：

- 主进程 `thumbFilePath(id, version, variant = 'full')`（`electron/ipc-handlers.ts:430`）：`const suffix = variant === 'grid' ? '.grid' : ''`
- 主进程 `readThumbnailFile(id, version, variant)`（`electron/ipc-handlers.ts:438`）与 `writeThumbnailFile(..., variant)` 都收 variant
- `fs:read-thumbnail` handler 已做归一化：`payload.variant === 'grid' ? 'grid' : 'full'`（`electron/ipc-handlers.ts:1539`）
- preload 已暴露：`readThumbnail: (id, version, variant?)` / `writeThumbnail: (id, version, dataUrl, variant?)`（`electron/preload.ts:104-106`）
- `deleteThumbnailsFromDisk` 已按 full + grid 两条线清理（`electron/ipc-handlers.ts` 注释明确写了「grid 小图与 full 大图是两条独立版本线」）
- `src/lib/localSave.ts:238-246` 的类型定义也带 `variant?: 'grid'`

**但渲染进程调用时从不传 variant：**

```ts
// src/lib/localSave.ts:1080
export async function readThumbnailFromDisk(id, version) {
  return await api.readThumbnail(id, version) // ← 缺 variant，永远走 full
}
// src/lib/localSave.ts:1094
export async function writeThumbnailToDisk(id, version, dataUrl) {
  return await api.writeThumbnail(id, version, dataUrl) // ← 缺 variant，永远写 full
}
```

**后果**：200–300px 的网格磁贴，每次都从磁盘读 1024px / quality 0.82 的 WebP（约 150–400KB），经主进程 `bytes.toString('base64')`（`electron/ipc-handlers.ts:450`）转成 200–530KB 字符串，过 IPC，再由渲染进程 `<img>` 解码。滚动 1 万张的图库时，每条缩略图都是这个量级 —— **读取量比实际需要大 3–5 倍**。

> **✅ 已实施（2026-09-16，见第七节「修复 6」）**。实施方案与本文建议有两处偏差，均由实测数据修正：
>
> 1. **grid 尺寸取 512px（本文建议 288px）**。288 的前提是「网格磁贴 200–300px」，
>    但图库磁贴边长由用户可选列数（3–6 列）决定，3 列 + 宽屏下 CSS 尺寸可达 ~500–700px，
>    288px 会明显发虚；历史 grid 文件实测也集中在 512 长边。
> 2. **收益量级需要下修**：本文估的「单张 200–530KB」偏高——full(v5) 实测均值 **76.7KB**（p90 123KB）。
>    512 长边 grid 实测均值 **26.7KB**，即读取量降到约 **1/3**（不是本文估的 1/3–1/5 那一档里更乐观的数）。
>    真实收益仍成立：解码位图内存降到约 1/4，同预算内存缓存可多放约 3 倍张数。

**修订：修复成本不是「约 2 行」**（初版判断有误，原因是只核对了 `variant` 是否被透传，没有核对 grid 文件是否被**写入**——结论是从来没写过）：

| 环节   | 现状                                    | 需要做的事                                                                                 |
| ------ | --------------------------------------- | ------------------------------------------------------------------------------------------ |
| 生成侧 | 只生成并写入 `full`（1024px）           | 补一条 grid（约 256–320px）生成 + 写盘，且要对**存量库**做懒回填，否则老用户永远看不到收益 |
| 读参数 | `localSave.ts:1080/1094` 不传 `variant` | 加参数透传（这一步确实是 2 行）                                                            |
| 读缓存 | `thumbnailCache` 按 `id` 单一分键       | 缓存 / 订阅 / 闸门 / 等待者 / 回填队列全部要按 `id:variant` 分键                           |
| 消费方 | 18 处调用 `ensureImageThumbnailCached`  | 逐处判断该用 grid 还是 full（详情页 / Lightbox 必须留 full）                               |

因此这是一次**缩略图子系统级的改造**，不是接通一个已就绪的开关；风险点在于 `THUMBNAIL_VERSION` 落盘守卫与滚动闸门语义不能被破坏。建议单独一个变更集完成，并补上「无 grid 文件时回退 full」的兜底。

> **实测复核（2026-09-16，本机真实库 `D:\AI生图2`，thumbs 目录 2678 个文件）**
>
> | 通道   | 磁盘上存在的版本        | 数量 | 说明                       |
> | ------ | ----------------------- | ---- | -------------------------- |
> | `grid` | 仅 v1（203）+ v2（120） | 323  | **当前版本 v5 一个都没有** |
> | `full` | v5（2267）+ v3（88）    | 2355 | v5 为当前版本              |
>
> 即：grid 通道在 v1/v2 时期确实被写过，但版本升到 v5 时写入路径被丢弃，只剩历史残留。
> 「只补读参数」会 **100% miss**，上面「必须补生成侧」的判断得到实证。

---

#### B3【中】内存缓存预算与被缓存对象的真实大小严重不匹配

**证据**

```ts
// src/store.ts:286
const imageCache = new ByteLruCache<string, string>(128 * 1024 * 1024)
const thumbnailCache = new ByteLruCache<string, {dataUrl: string; ...}>(64 * 1024 * 1024)
// src/store.ts:410 / 708 —— 计费口径是 base64 字符串长度 × 2
imageCache.set(id, dataUrl, dataUrl.length * 2)
thumbnailCache.set(id, thumbnail, thumbnail.dataUrl.length * 2)
```

`ByteLruCache` 本身实现正确（LRU + 按字节淘汰，`src/lib/byteLruCache.ts`），问题在**计费口径与实际占用脱节**：

| 缓存             | 单张计费                              | 实际上限 | 可容纳张数                    |
| ---------------- | ------------------------------------- | -------- | ----------------------------- |
| `imageCache`     | base64 长度 × 2 ≈ **原图字节 × 2.67** | 128MB    | 5MB 原图约 **9–10 张**        |
| `thumbnailCache` | base64 长度 × 2                       | 64MB     | 1024px 缩略图约 **60–160 张** |

而 `dataUrl.length * 2` 的 `× 2` 是「JS 字符串按 UTF-16 算 2 字节/字符」，但 base64 字符串长度本身已经是原始字节的 4/3。两个系数相乘导致计费偏高约 2.67 倍。

**后果**：1 万张图库来回滚动，`thumbnailCache` 命中率极低，几乎每次都要回磁盘 + IPC；查看器里上一张/下一张必然重新走完整链路（B1）。

---

#### B4【低】缩略图缺失时的回填代价

`startThumbnailLoad`（`src/store.ts:802`）未命中时走 `scheduleThumbnailBackfill` → `getImageThumbnail`（`src/lib/db.ts:850`）→ `getImage(id)` **读出完整图片记录** → `safeCreateImageThumbnail`（`db.ts:913`）现场生成。

另外磁盘缩略图命中时，还会额外执行一次 `getImage(id)` **只为拿原图宽高**（`src/store.ts:826-836`）：

```ts
if (fromDisk) {
  const image = await getImage(id) // 一次完整记录读取，只为 width/height
}
```

Electron 下图片记录的 `dataUrl` 已置空（`db.ts:1082` `dataUrl: localPath ? undefined : dataUrl`），所以这次读取本身不算大，但仍是**每个磁贴一次多余的 IPC 往返**。根因是磁盘缩略图文件命名里没有携带原图尺寸。

此外 `THUMBNAIL_VERSION = 5`（`src/lib/db.ts:51`）：每次版本 bump 都会让全库缩略图作废并重建（历史上 512→1024 升级过一次），重建期本身就是一次可感知的卡顿窗口。

---

### C. 操作响应延迟

#### C1【高】单次状态变更的跨进程往返次数过多

以「生成一张图」为例，链路里的跨进程往返：

| 步骤                       | 位置                              | 跨进程代价                                 |
| -------------------------- | --------------------------------- | ------------------------------------------ |
| `computeContentHash`       | `db.ts:1064`                      | 无（渲染主线程阻塞，见 A5）                |
| `saveRawCacheImageToLocal` | `db.ts:1073` → `localSave.ts:548` | ① IPC 传整张 base64 字符串给主进程解码写盘 |
| `safeCreateImageThumbnail` | `db.ts:1078`                      | 无（渲染主线程 canvas WebP 编码）          |
| `putImage`                 | `db.ts:1079`                      | ② 渲染→主进程→UtilityProcess→SQLite        |
| `putImageThumbnail`        | `db.ts:1085`                      | ③ 同上，再来一次                           |
| `putTask`                  | `store.ts:495` / `db.ts:491`      | ④ 同上，再来一次                           |

**一张图 = 4 次以上跨进程写往返**，每次都带完整 JSON 序列化。批量出 8 张，就是 30 多次。

#### C2【中】持久化采用整表替换

- Agent 对话：`replaceStoredAgentConversations(conversations)` 整表替换 + 500ms 防抖（`src/store.ts:4377`）
- 词库：`replaceStoredWordLibrary(...)` 整表替换 + 300ms 防抖（`src/store.ts:4412`）

防抖确实压制了频率，但**单次成本随数据量线性增长**，对话/词库积累到一定规模后会形成周期性卡顿尖峰（每 300–500ms 一次大写入）。增量 upsert 更合适。

#### C3【低】`ByteLruCache.get` 在读取路径上做 Map 重排

`byteLruCache.ts` 的 `get()` 执行 `delete` + `set` 以维护 LRU 顺序，每次命中都有两次 Map 操作。在滚动时每帧数百次读缓存的热路径上属于常数级开销，影响有限，列出仅供完整。

---

## 三、严重程度评估

| 编号 | 问题                                                        | 影响面                               | 严重度 | 修复成本                   | 优先级                                                           |
| ---- | ----------------------------------------------------------- | ------------------------------------ | ------ | -------------------------- | ---------------------------------------------------------------- |
| A2   | `listCompositeImageFiles` 无上限同步读 + base64             | 主进程全局冻结 / 内存冲高 / 可能 OOM | 严重   | 低                         | **P0** ✅已修                                                    |
| A1   | 主进程同步 fs（热点路径）                                   | 全局卡顿（含拖窗、滚动）             | 高     | 低                         | **P0** ✅已修                                                    |
| B1   | 全图 base64 data URL 链路（5 次复制）                       | 查看器 / 详情页 / 悬停全图           | 严重   | 中                         | **P1** ✅已修                                                    |
| B2   | `grid` 缩略图通道未启用                                     | 全图库滚动加载量 ×3–5                | 高     | **高**（原评「极低」有误） | **P1** ✅已修                                                    |
| A3   | `getNextTaskFilenameBatch` 三层嵌套                         | 批量出图时的命名链路                 | 中     | 低                         | **P1** ✅已修                                                    |
| C1   | 单次生成 4+ 次跨进程写                                      | 操作响应延迟                         | 中     | 中                         | **P3**（原评 P1 有误：实测只省 0.1–0.4ms/张，见修复 8）          |
| 🔴   | **缩略图同步编码**（`canvas.toDataURL` 阻塞主线程 71ms/张） | 生成期掉帧 / 批量出图叠加            | 高     | 低                         | **P1** ✅已修（修复 8 量测中发现，修复 9 处理）                   |
| A5   | `computeContentHash` 主线程 atob 循环                       | 批量导入/生成期卡顿                  | 中     | 低                         | **P2** ✅已修（真机实测降到 4.7ms/张，不再是大头）               |
| B3   | 缓存计费口径偏差，命中率低                                  | 缓存利用率偏低                       | 中     | 低                         | **P2**（刻意保守高估，需先定内存预算）                           |
| A4   | 大组件订阅整个 `tasks`                                      | 重渲染                               | 中     | 中                         | **P3**（前提弱化：高频进度已走 `runtimeStore`，见修复 8 未做表） |
| C2   | 整表替换式持久化                                            | 周期性写入尖峰                       | 中     | 中                         | **P3**（真实库实测数据量 0.3KB，无可测收益）                     |
| A3b  | `updateTaskInStore` 线性重建                                | 可忽略（实测 <1ms）                  | 低     | 中                         | **P3**                                                           |
| B4   | 缩略图回填 + 多余宽高读取                                   | 首屏 / 库搬家后                      | 低     | 低                         | **P3**                                                           |
| C3   | LRU 读路径 Map 重排                                         | 常数级                               | 低     | 低                         | **P3**                                                           |

---

## 四、优化建议（按优先级）

### P0 —— 建议立刻处理

**P0-1　给批量目录读取加上限 + 改异步（A2）** ✅**已修**（见第七节）

- `listCompositeImageFiles` 增加 `limit`（建议 200）与分页参数；`readdirSync` → `fsPromises.readdir`，`readFileSync` → `fsPromises.readFile`。
- ~~**不要返回 dataUrl**，只返回 `{ path, name, size }`，让渲染进程按需逐张取~~
  → **实施时未采用**：4 个调用方（`agentBatchExecution` / `knowledgeAnalysis` / `RequirementStrategyWorkspace` / 合成工作区）都确实需要全部图片内容，
  改契约会牵动 4 条业务链路且无法在单次变更里充分回归。改为「保留契约 + 加数量/体积上限 + 异步 + 受控并发」，先消除冻结，契约优化另立变更。
- ✅ `composite:pick-image-file` 改为先列名、再只读被选中的那一张。
- 目录规模预检做成**主进程告警日志**（超限时打印总张数），未加入弹窗确认 UI。

**P0-2　让任务输出图走 `doupao://` 协议（B1）**

- 在 `asset-kernel` 的 `protocol.handle` 里增加一条路由：`doupao://local/<encoded-path>` 或复用 `doupao://assets/`，服务**任意已授权库根下的图片文件**（`assertAllowedPath` 已有，直接复用）。
- `GalleryImageTile` / `Lightbox` / `DetailModal` / `useCoverThumbnail` 里，凡是有 `localPath` 的图直接 `<img src="doupao://...">`，不再走 `readFileBuffer` → Blob → FileReader。
- 给协议注册补上 `stream: true`（当前 `electron/asset-kernel.ts:541` 的 privileges 里没有），大图可流式传输。
- 兜底：保留 data URL 路径给没有 `localPath` 的图（浏览器端 / 未落盘的图）。
- 需要同步确认 CSP 的 `connect-src` 是否也要放行 `doupao:`（`img-src` 已放行）。

**P1-4　接通 `grid` 缩略图通道（B2）—— 降级自 P0，见第二节 B2 的修订说明** ✅**已修**（实现与实测见第七节「修复 6」；
下面第 2 步原写「288」，实施时按实测改成 **512**，第 5 步的清单也做了细化）

改动量低于预期，但**不是接通开关，而是子系统改造**。建议按下面顺序做，每步都可独立回归：

1. `writeThumbnailToDisk` / `readThumbnailFromDisk`（`src/lib/localSave.ts:1080,1094`）加 `variant` 参数并透传（这一步确实是 2 行）。
2. **生成侧补写**：`persistThumbnailToDisk`（`src/lib/db.ts:809`）与 `store.ts:817` 写 full 之后，用 `createImageThumbnailDataUrl(dataUrl, 288, 0.8)`
   （`src/lib/canvasImage.ts:55`，已存在、可直接复用）生成 grid 并写入 `variant: 'grid'`。放在 `void ...catch(() => {})` 的既有 fire-and-forget 分支里，不进入关键路径。
3. **懒回填**：`startThumbnailLoad` 里 grid 未命中时回退 full，同时在后台补写 grid —— 否则存量图库永远不会生成 grid 文件。
4. **缓存分键**：`thumbnailCache` / `thumbnailSubscribers` / `thumbnailWaiters` / `pendingThumbnailIds` / `thumbnailBackfillIds` / `aheadThumbnailIds` 全部从 `id` 改为 `${id}:${variant}`。
   建议让 `ensureImageThumbnailCached(id, priority, variant = 'full')` 带默认值，这样 18 个存量消费方**零改动即可编译通过**，再逐处把网格类消费方（`GalleryImageTile`、`AssetTile`、`AgentImageGrid`、`SubfolderStrip`）切到 `'grid'`。
5. **必须保留 full 的消费方**：`AssetViewer`、`AssetDetailPanel`、`Lightbox`、`DetailModal`、`AssetDuplicateModal`、`SopImageStack`。

预期（实施后实测值，见修复 6）：单张读取量 79.9KB → 26.7KB（x2.99），解码位图内存 2.36MB/张 → 0.59MB/张（约 1/4）。
~~原估 200–530KB → 40–90KB、4.2MB → 0.26MB~~ 是基于偏高的 full 体积与 288px 口径得出的，已按实测修正。
**回归重点**：`THUMBNAIL_VERSION` 落盘守卫（旧版本缩略图不得以新版本标签落盘）、滚动闸门语义、磁盘占用统计（`getDiskStorageUsage` 的 `thumbsBytes/thumbsCount` 会把 grid 一起算进去，属预期）。

---

### P1 —— 建议本迭代内处理

**P1-1　消除主进程同步 fs（A1）**

- ✅ `fs:read-file-buffer`（`ipc-handlers.ts:1266`）的 `readFileSync` 已改 `fsPromises.readFile`（修复 1），
  并保留 `buffer.buffer.slice(...)`（异步 Buffer 仍可能来自共享内存池）。
- ✅ `fs:save-image` / `composite:save-image` 已改 `fsPromises.writeFile`，且**解码整体移出主进程**
  （渲染进程原生 base64 解码 → IPC 传字节，见修复 7）。实测效果比原方案更好：主进程侧不再有
  6.7M 字符的同步解码，IPC 载荷也比 base64 字符串小 1/3。
- ⏳ 加一条 lint/审查约定：`electron/ipc-handlers.ts` 内禁止新增 `*Sync` 调用（存量逐步替换）。
  存量仍有 90 余处同步 fs（多数是低频率的设置/存在性检查，不在出图热点上），单独一个变更集处理。

**P1-2　任务索引化（A3）**

- 在 store 内维护 `tasksById: Map<string, TaskRecord>`，让 `updateTaskInStore` 从「全量 map」变为「按 id 替换 + 仅重建被引用数组」。若必须保持数组引用语义，至少把 `find` 换成 Map 查询。
- `setTasks` 里的 `countSuccessfulOutputImages` 改为增量维护的计数器，避免每次全量 reduce。
- ✅ `getNextTaskFilenameBatch`（`store.ts:426`）的三层嵌套已改为一次 O(总任务数) 建 `Set<taskId>` 索引，过滤退化成 O(1) 查表（见第七节）。
  ~~每个 tab 变更时重建一次~~ → 实施为每次调用重建：`Set` 的构建成本远低于原来的嵌套查找，且避免了跨变更的缓存失效问题。
- ⏳ `tasksById: Map` 索引化未做（经实测收益不足，见 A3 修订）。

**P1-3　合并生成期的跨进程写（C1）**

- 新增 `app-data:put-many` 已是现成能力（`asset-kernel.ts:284`），把「图片记录 + 缩略图记录」合并成一次 `putMany` 提交。
- 缩略图生成从 `storeImage` 主路径剥离成后台异步任务：图片记录先落库并返回，缩略图稍后补齐（UI 已有「缩略图就绪后再上报宽高」的机制，天然支持）。
- `putTask` 在批量出图场景改为批量提交。

**P1-5　缩略图编码搬离主线程（修复 8 量测中新发现）** ✅**已修**（见第七节「修复 9」）

- 原「候选方案①」就是最终实施：`canvas.toBlob` 替代 `canvas.toDataURL`，编码交给 Chromium 的后台编码线程。
- 真机帧探针实测：5 张连续缩略图编码的主线程冻结 **553.8ms → 32ms**，总耗时与产出字节均不变。
- 同批量测顺带纠正了修复 8 的「`toBlob` 产出更小」误读（那是 base64 膨胀导致的 4/3 口径差，不是编码器差异）。

---

### P2 —— 结构性优化

- **P2-1（A5）**：✅ `decodeDataUrlToBytes` 已加 `Uint8Array.fromBase64` 原生快路径（Chromium 133+ / Electron 43+ 命中，Node 22 测试环境自动走 atob 兜底，见第七节）。
  ⏳ `computeContentHash` 整体挪到 Worker 未做 —— 原生解码后单张的剩余成本主要是 SHA-256 本身（已由 `crypto.subtle` 异步执行），优先级下降。
- **P2-2（B3）**：统一缓存计费口径 —— 计 `dataUrl.length * 2`（UTF-16）**或** `原图字节 × 4/3`，不要两者相乘。同时考虑按「解码后像素字节数」计费，更贴近真实内存占用。修正后同样 128MB 能多装约 2.7 倍。
- **P2-3（A4）**：`InputBar`（5503 行 / 51 个订阅）、`Header`、`Lightbox` 等改为派生选择器 + `useShallow`，或拆分子组件让订阅下沉；优先处理订阅了整个 `tasks` 的 19 处。
- **P2-4（C2）**：Agent 对话与词库持久化由 `replace` 整表改为增量 upsert（`putMany` + `deleteMany`）。
- **P2-5（B4）**：磁盘缩略图文件名带上原图尺寸，消掉 `startThumbnailLoad` 里那次「只为宽高」的 `getImage`。

---

## 五、建议的验证方式

修复后建议按以下顺序量化验证（都是可复现的操作，不需要额外造数据）：

1. **主进程阻塞**：DevTools 主进程性能面板 + 一张 8MB 图的 `fs:read-file-buffer`，对比 `readFileSync` → `fsPromises.readFile` 的主进程长任务时长。
2. **图片加载**：1 万张图库，网格快速滚动 10 秒，记录 IPC 调用次数与总传输字节（主进程打点统计 `fs:read-thumbnail` / `fs:read-file-buffer`）。
3. **首屏出图**：库根 `thumbs/` 清空后冷启动，测量首屏 100 张缩略图的 `ready` 时刻。
4. **操作响应**：批量出 8 张图，测「点击生成 → 任务卡出现」的 P95 延迟，以及期间主进程长任务数量。
5. **渲染主线程冻结**（修复 9 的指标）：DevTools 渲染进程性能面板挂一次录制，批量出 5 张图，看是否有 >50ms 的长任务落在
   `createImageThumbnail` 区间。改前每张约 110ms 同步编码会明确留下一个长任务；改后应只剩 30ms 级。
   仅看总耗时是看不出来的 —— 修复 9 前后总耗时都是 556ms，差别只在主线程有没有被占住。
6. **回归**：`npm run verify` + `npm run electron:preview`（按 AGENTS.md 的发布前流程）。

---

## 六、附：已做得好的部分（勿回退）

排查中确认以下优化已到位，修复其他问题时应避免破坏它们：

- `runtimeStore` 把高频进度 tick 与主 store 分离（`src/stores/runtimeStore.ts`），并在任务终态清理 `taskProgress`（`store.ts:10477`）。
- SQLite 目录跑在 UtilityProcess，主进程不被 `DatabaseSync` 阻塞（`electron/catalog-client.ts`、`asset-kernel.ts:120`）。
- `TaskGrid` 的虚拟化 + `useDeferredValue` + 宽高比按帧批量上报（`TaskGrid.tsx:74-95`）：这层已经很扎实，滚动掉帧的锅不在它。
- 缩略图滚动闸门与 visible/background 优先级队列（`store.ts:865-995`）+ `scrollActivity.ts` 的滚动期抑制。
- 图片/缩略图读取的并发去重（`imageLoadPromises` / `thumbnailLoadPromises`）。
- 订阅选择器无「返回新引用」的反模式，无裸 `useStore()`。
- `ByteLruCache` 按字节淘汰 + `dispose` 钩子，实现本身正确。
- `THUMBNAIL_VERSION` 的落盘守卫（防止旧版本缩略图以新版本标签落盘），以及 `assertJsonSerializable` 对 Blob 静默损坏的主动拦截。
- 缩略图编码走 `canvasToWebpDataUrl`（修复 9）：**别改回同步的 `canvas.toDataURL`**。两者的编码量与总耗时一样，
  唯一区别是主线程有没有被占满 —— 一旦回到 `toDataURL`，每张缩略图会重新引入 ~110ms 的同步冻结。
  `toBlob` 不可用时它自带回退，不需要调用方兜底。

---

## 七、已完成的修复（2026-09-16，代码基线 v0.8.18）

本轮共 9 项，全部为**不改变业务语义**的性能修复。验证方式：`npm run verify`
（双端类型检查 + lint + format:check + 全量测试）—— **235 个测试文件 / 2247 个用例全部通过**。

> 修复 8 与前 7 项性质不同：它是**量测驱动的自我纠错** —— 实测下来原评 P1 的 C1 只值 0.1–0.4ms/张，
> 同期量出的真正热点是缩略图同步编码（`storeImage` 单张 160–200ms 里它占 44%）。数字与判断都在修复 8 里。
> 修复 9 就是这条新热点的落地，它把 5 张连encode的主线程冻结从 **553.8ms 压到 32ms**。

### 修复 1｜主进程图片读取改异步 + 批量读取加保护（A2 / A1，P0）

`electron/ipc-handlers.ts`

| 位置                                                       | 改动                                                                                                                                                                                |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `:1308` `fs:read-file-buffer`                              | `readFileSync` → `await fsPromises.readFile`；以 `stat().isFile()` 替代 `existsSync` 保持返回值语义不变。保留 `buffer.buffer.slice(...)`（异步 Buffer 仍可能来自共享内存池）        |
| `:740` `readImageFilePayload`                              | 改 async；新增可选 `maxBytes` 上限（超限跳过并告警）                                                                                                                                |
| `:763` `listCompositeImagePaths`（新增）                   | 只做 `readdir` + 扩展名过滤 + 排序，**不读文件内容**，供抽取场景复用                                                                                                                |
| `:780` `listCompositeImageFiles`                           | 全异步；`readdir` 后按 `MAX_COMPOSITE_LIST_FILES = 300` 截断、单张按 `MAX_COMPOSITE_IMAGE_BYTES = 24MB` 跳过、`COMPOSITE_READ_CONCURRENCY = 4` 受控并发；超限时打印告警（含总张数） |
| `composite:pick-image-file`                                | **改为只列名再读抽中的一张** —— 原实现为随机取一张而把整个目录读成 dataUrl                                                                                                          |
| `composite:read-image-file` / `composite:list-image-files` | 补 `await`，使异常真正落进各自的 `try/catch`（原来 Promise 拒绝会逃逸）                                                                                                             |

效果：目录列举不再占用主进程事件循环，200 张 4MB 图的冻结路径与 1GB base64 峰值内存被同时消除；
`pick-image-file` 的单次读取量从「整个目录」降到「一张」。

### 修复 2｜图片指纹解码走原生 base64（A5，P2）

`src/lib/imageFingerprint.ts:34-63` —— 新增 `getNativeFromBase64()`，`decodeDataUrlToBytes` 优先调用平台原生
`Uint8Array.fromBase64`（Chromium 133+ / Electron 43 命中；**真机实测** Electron 43 = Chromium 150 / V8 15 下
`typeof Uint8Array.fromBase64 === 'function'`，见修复 7 的实测表），抛错或不可用时回退到原 `atob` + 逐字符循环（Node 22 测试环境即走此路径）。
消除的是一张 4MB 图约 **530 万次 `charCodeAt`** 的纯 JS 同步循环，而它位于「每张新图都要算一次 `contentHash`」的热路径上（含流式 partial 落库）。
惰性读取而非模块加载期捕获，既避免拿到过期实现，也让两条路径都可测。

### 修复 3｜任务命名链路去掉二次方扫描（A3，P1）

`src/store.ts:428-437` —— `getNextTaskFilenameBatch` 原在 `filter` 回调里对每个任务再扫一遍所有标签页
（O(任务数 × 标签页数 × 每页任务数)）。改为**一次 O(总任务数) 建 `Set<taskId>` 索引**，过滤退化为 O(1) 查表。
5000 任务 / 30 标签页的估算量级从约 1500 万次比较降到约 5000 次 + 集合查找。语义完全等价。

### 修复 4｜新增回归测试

- `electron/ipc-handlers.test.ts` 新增 4 个用例：扩展名过滤与稳定排序、目录不存在/非目录返回空、24MB 超限跳过、305 张截断为 300 张。
- `src/lib/imageFingerprint.test.ts` 新增 3 个用例：原生实现被优先调用、原生抛错时回退且结果一致、无原生实现时走 `atob`。

### 修复 5｜输出图接入 `doupao://` 本地图片协议（B1，本次最高收益项）

**新增文件**

| 文件                                    | 职责                                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `electron/local-image-protocol.ts`      | `doupao://image/` 主机名实现：路径校验 → 扩展名白名单 → 异步读取 → 带 `immutable` 强缓存下发                            |
| `src/lib/localImageUrl.ts`              | 渲染进程侧地址构造（`buildLocalImageUrl` / `isLocalImageUrl`），含「不在服务范围内就不发 URL」的前置过滤                |
| `src/store.ts` `resolveImageDisplaySrc` | 展示用地址解析：优先协议 URL，否则回退 `ensureImageCached` 的 dataUrl（去重 + 与 `loadAndCacheImage` 同口径的目录兜底） |

**接入点**：`Lightbox`（查看器）、`GalleryImageTile`（悬停原图）、`DetailModal`（输出图预览）、
`TaskCard`（封面兜底）、`AgentWorkspace`（聊天缩略图）、`SopImageStack`（悬停预览）。
每处都配 `onError` 回退——文件被外部删除时协议返回 404，渲染层自动换回 dataUrl，不会破图。

**安全边界**（刻意收窄，比复用 `ipc-handlers` 的通用允许根更严）：

1. 只服务库根下的 `cache-images/` 与 `thumbs/`，不开放任意路径；
2. 扩展名 + MIME 双重白名单 + `nosniff`，目录内即便混入 `.html` 也不会被当成可执行内容下发；
3. `connect-src` 不含 `doupao:`，协议只能作图片来源。

**实测验证（真实 Electron + 真实库 + 生产 CSP，非单测）**

| 探测                             | 结果                                      |
| -------------------------------- | ----------------------------------------- |
| 真实原图 463KB PNG（路径含中文） | ✅ 加载为 1080×952                        |
| 真实缩略图 `.v5.webp`            | ✅ 加载为 576×1024                        |
| 库根下 `library.json`            | ❌ 404（目录边界生效）                    |
| `cache-images\fake.html`         | ❌ 404（扩展名白名单）                    |
| `cache-images\..\library.json`   | ❌ 404（路径穿越被拦）                    |
| `doupao://assets/…`              | ❌ 404（分流未抢资产分支）                |
| `fetch('doupao://…')`            | 🚫 被 CSP 拦（符合设计）                  |
| `data:` 图                       | ✅ 正常（既有路径无回归）                 |
| `drawImage` + `getImageData`     | ⚠️ `SecurityError` → **协议图会污染画布** |

最后一条是本次最重要的实测结论：**协议地址只能用于 `<img>`**。`Lightbox` 的遮罩合成
（`createMaskPreviewDataUrl`）因此在合成前显式取回 dataUrl —— 若省略这一步，打开带遮罩的图会直接抛错。

**衍生风险与处置（引入协议地址必然带来的一类新坑）**

协议地址是个「不可 fetch 的 src」。把它交给任何需要**字节**的消费方都会静默失败：

| 消费方                        | 原实现                                                              | 后果                              | 处置                                                            |
| ----------------------------- | ------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------- |
| `downloadImages.getImageBlob` | 对非 `data:`/`http(s):` 的输入直接 `fetch(src)`                     | 下载/保存失败（CSP 拦）           | 识别协议地址 → 还原路径 → `readFileBuffer` 读字节 → 自组 `Blob` |
| `clipboard` 写图              | 主进程 `nativeImage.createFromDataURL`，只认 data URL               | 复制图片报「写入剪贴板失败」      | 入口统一过 `localImageUrlToDataUrl` 转回 dataUrl                |
| `store.addImageFromUrl`       | `fetch(src)`                                                        | 「添加为参考图」失败              | 协议地址走 IPC 读回 dataUrl，其余路径保持原样                   |
| 右键菜单的 id 解析            | 两处 `<img>` 缺 `data-image-id`，只能回退用 `img.src`（现为协议址） | 菜单的下载/复制/加参考图全部退化  | 给这两处补上 `data-image-id`，让 id 路径优先                    |
| canvas（遮罩合成/导出）       | 直接 `drawImage(src)`                                               | `getImageData` 抛 `SecurityError` | 保持 dataUrl，不动（已在 `Lightbox`/`DetailModal` 显式分流）    |

新增的统一入口 `localImageUrlToDataUrl()`（`src/lib/localImageUrl.ts`）把「协议地址 → dataUrl」
收敛成一处可测转换；非协议地址原样返回，因此浏览器环境与既有路径行为完全不变。

**测试**：

| 文件                                    | 新增 | 覆盖                                                                     |
| --------------------------------------- | ---- | ------------------------------------------------------------------------ |
| `electron/local-image-protocol.test.ts` | 8    | 白名单、路径穿越、畸形输入、目录非文件、404、413、各扩展名 MIME          |
| `src/lib/localImageUrl.test.ts`         | 12   | 地址构造与编码、非 Electron 回退、服务范围外过滤、路径还原、dataUrl 反解 |
| `src/lib/downloadImages.test.ts`        | 2    | 协议地址经 IPC 读字节保存、文件缺失记为失败而非抛错                      |
| `src/store.test.ts`                     | 4    | 协议地址、dataUrl 回退、库根外路径、非 Electron                          |

`npm run verify` 全绿：**234 个测试文件 / 2215 个用例**（双端 tsc + lint + format:check + vitest）。

### 修复 6｜接通 `grid` 缩略图通道（B2，P1-4）

按 P1-4 的分步方案实施，五步全部落地。

**1) 通道参数透传**（原来是「永远走 full」）

| 位置                                        | 改动                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| `src/types.ts`                              | 新增 `ThumbnailVariant = 'full' \| 'grid'`（单一真源，主/渲染共用）     |
| `electron/preload.ts`                       | `variant?: 'grid'` → `'full' \| 'grid'`（IPC 侧原本就已归一化，零风险） |
| `src/lib/localSave.ts`                      | `readThumbnailFromDisk` / `writeThumbnailToDisk` 加 `variant` 并透传    |
| `src/lib/db.ts` `getFreshThumbnailFromDisk` | 加 `variant`（默认 `'full'`）                                           |

**2) 生成侧补写 grid**：新增 `buildGridThumbnail(id, fullThumbnailDataUrl)`（`src/lib/db.ts`）——
由 **full 缩略图**（≤1024px webp）再缩一次，而不是解码原图：目标只有 512px，二次缩放画质损失
可忽略，却省掉一次 2K/4K 原图解码。写盘失败仍返回 dataUrl（内存缓存已可用）。

**3) 存量库懒回填（关键）**：`startThumbnailLoad` 里 grid 未命中时

```
grid 磁盘未命中 → 排一个后台回填任务 → 立刻用 full 兜底返回（观感与改动前完全一致）
                 ↘ 回填完成：由 full 现出小图 → 写盘 + 入内存缓存
```

两条兜底顺序是**内存 → 磁盘 → IndexedDB**：页面级预取往往已经把 full 读进内存，先查内存可省一次磁盘往返。
`THUMBNAIL_VERSION` 无需升级——老库的 grid 会随手被补齐，不会作废全库缩略图。

**4) 缓存分键**：`thumbnailCache` / `thumbnailLoadPromises` / `thumbnailSubscribers` / `thumbnailWaiters` /
`pendingThumbnailIds` / `aheadThumbnailIds` / `thumbnailBackfillIds` / `thumbnailBackfillRunningIds`
全部从 `id` 改为 `${id}:${variant}`（统一走 `thumbnailKey()`）。删除路径收敛成 `clearCachedThumbnail(id)`
一次清两条通道，避免漏删导致「删图后仍能滚出旧缩略图」。

**5) 消费方切换**：`GRID_THUMBNAIL_VARIANT` 常量统一表达意图，网格类消费方切到 `'grid'`：

| 切到 grid                                | 保持 full（不许切）                                                              |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| `GalleryImageTile`（图库磁贴，主热路径） | `AssetViewer` / `AssetDetailPanel`（查看器、详情）                               |
| `AssetTile`（素材网格）                  | `Lightbox` / `DetailModal`（大图查看）                                           |
| `AgentImageGrid`（Agent 网格）           | `TaskCard` 封面（`useCoverThumbnail`）——**要显示原图分辨率徽章，不能用小图宽高** |
| `SubfolderStrip`（文件夹封面 160×96）    | `SopImageStack` / `SopCoverImage` / `ScheduleModal` / `GallerySopBatchModal`     |

预取通道必须与真正渲染的消费方一致，否则预热的是另一条通道、磁贴仍要各读一次盘：
`AssetGrid` / `AssetBatchView` / `AssetLibraryWorkspace` 的 `prefetchImageThumbnails` 已同步改传 `'grid'`；
`AssetListView` / `AssetPickerModal` 仍是 `'full'`（它们的磁贴未切换）。

**尺寸取 512px 而非本文建议的 288px —— 依据实测**

| 证据（本机真实库 `D:\AI生图2\thumbs`，2267 个 v5 文件） | 数值                                              |
| ------------------------------------------------------- | ------------------------------------------------- |
| full(v5) 文件体积                                       | 均值 **76.7KB**，p50 74.7KB，p90 123KB，max 307KB |
| 历史 grid 文件尺寸分布（v1 203 个 / v2 120 个）         | 512×288、320×180、384×512 → **长边 512**          |
| 图库磁贴 CSS 边长（3–6 列可选 × 内容宽度）              | 约 290–700px；2x DPR 需 ~580–1400 设备像素        |

即：288px 在 3 列布局 + 宽屏下会明显发虚（2.5–3.5x 上采样），512px 与历史 grid 口径一致。

**真机实测（生产 `buildGridThumbnail` + 真实 v5 full 缩略图，40 张均匀取样 / 共 2267 张）**

| 指标         | 数值                                                                 |
| ------------ | -------------------------------------------------------------------- |
| 输出尺寸     | 长边恒为 512（实测出现 512×288、342×512、512×512、288×512、384×512） |
| 通道/版本    | 全部 `variant=grid`、`version=5`（命名空间与版本线正确）             |
| full 均值    | **79.9KB**（与全库 2267 张的均值 76.7KB 吻合，样本无偏）             |
| grid 均值    | **26.7KB**，p50 25.7KB，max 87.0KB                                   |
| 缩量         | 整体 **x2.99**，逐张中位 x2.90，区间 x2.30–x3.61                     |
| 解码位图内存 | 1024×576×4 ≈ 2.36MB → 512×288×4 ≈ 0.59MB，约 **1/4**                 |

注：若把 `GRID_THUMBNAIL_MAX_SIZE` 降到 384，缩量约可到 x5，代价是 3 列宽屏下磁贴明显发虚——
这是一个可调的常量，按观感再定即可。

**反闪烁取舍**：grid 缺失而用 full 兜底显示时，回填完成**只入缓存/落盘、不推送订阅方**
（`ThumbnailBackfillRequest.silent`）。同一张图在同一个 `<img>` 上二次换 `src` 会白闪一下，
收益仅为提前释放 1MB 内存，不划算；下次挂载或缓存淘汰后自然用上小图。
只有「连 full 都取不到」的场景才推送——否则卡片会一直停在占位。

**新增/更新测试**

| 文件                        | 新增 | 覆盖                                                                                        |
| --------------------------- | ---- | ------------------------------------------------------------------------------------------- |
| `src/store.test.ts`         | 3    | 两条通道分键互不覆盖、grid 未命中回退 full 且不污染 grid 缓存、存量库懒回填 + silent 不推送 |
| `src/lib/db.test.ts`        | 2    | `variant` 透传（默认 full）、`buildGridThumbnail` 以 `variant='grid'` 命名空间写盘          |
| `src/lib/localSave.test.ts` | 2    | 读写通道的 `variant` 透传                                                                   |
| 4 个组件测试                | —    | store mock 补 `GRID_THUMBNAIL_VARIANT`（mock 模块缺导出会直接抛错，属必要维护）             |

**回归重点已覆盖**：`THUMBNAIL_VERSION` 落盘守卫（旧版本缩略图不得以当前版本标签落盘）在两条通道上都保留；
滚动闸门语义不变（同一队列，仅键值从 `id` 变为 `id:variant`）；`getDiskStorageUsage` 的
`thumbsBytes/thumbsCount` 会把 grid 一起算进去，属预期。

### 修复 7｜写整张图的路径去掉主进程同步解码 + 同步写盘（A1 / P1-1）

原链路每落一张图，主进程要做两件阻塞事件循环的事：`Buffer.from(base64, 'base64')` 解整张图
（5MB 图 ≈ **6.7M 字符**，跨窗口消息与其它 IPC 一起卡）+ `writeFileSync` 同步写盘。

| 位置                                                       | 改动                                                                                                                                                |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `electron/ipc-handlers.ts` `imageBytesFromPayload`（新增） | 统一载荷解码：`bytes` 走零拷贝视图（`Buffer.from(bytes.buffer, byteOffset, byteLength)`，子视图不会带出整个池），`dataUrl` 保留回退                 |
| `fs:save-image`                                            | `writeFileSync` → `await fsPromises.writeFile`；`mkdir` 同步 → 异步；接受 `bytes` 或 `dataUrl`                                                      |
| `composite:save-image`                                     | 同上。导出成图常有 **10MB+**，是这套改动里单次收益最大的一处                                                                                        |
| `electron/preload.ts`                                      | 新增 `saveImageBytes` / `saveCompositeImageBytes`，IPC 只搬字节（比 base64 字符串小 1/3）                                                           |
| `src/lib/localSave.ts` `saveImageViaApi`（新增）           | 渲染进程用 `decodeDataUrlToBytes`（原生 `Uint8Array.fromBase64`，见修复 2）解码后走字节通道；**通道缺失或抛错时回退 dataUrl**，保持改动前的容错行为 |
| `src/lib/localSave.ts` `saveCompositeImage`                | 同策略，但显式接收调用方注入的 `electronAPI`（合成图导出运行时自带 api，不读全局）                                                                  |
| `src/features/composite/lib/compositeExportRuntime.ts:252` | 改调 `saveCompositeImage(api, ...)`                                                                                                                 |

**为什么解码放渲染进程**：`Uint8Array.fromBase64` 是原生实现（Chromium 133+ / Electron 43 命中），
在渲染进程跑不占主进程事件循环；主进程只剩一次异步写盘。窗口卡顿的根因是主进程被占，
把解码从主进程挪走比在主进程里换异步 API 更彻底。

**新增测试（11 个用例）**

| 文件                            | 新增 | 覆盖                                                                                                                                                                              |
| ------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `electron/ipc-handlers.test.ts` | 5    | 载荷解码四种形态（含带偏移子视图不越界、字节优先于 dataUrl）、真实 handler 异步写盘 + 自动建目录、dataUrl 回退、缺数据/路径越界返回 false 不落盘、`composite:save-image` 字节通道 |
| `src/lib/localSave.test.ts`     | 6    | 字节优先且不再走 dataUrl 通道、字节通道抛错回退、旧 preload 无通道直接走 dataUrl、非 Electron 返回 false；导出成图的字节优先与回退                                                |

主进程侧用例走的是**真实注册的 handler**（`registerIpcHandlers()` → 捕获 `fs:save-image` /
`composite:save-image` 监听器），因此发送方校验（`assertTrustedSender`）与路径守卫
（`assertAllowedPath`）都在测试覆盖内，而不是只测一个抽出来的纯函数。

**真机实测（真实 Electron 43 = Chromium 150 / V8 15 + 生产 preload + 生产 IPC handler）**

| 探测                                                | 结果                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `typeof Uint8Array.fromBase64`（渲染进程）          | ✅ `function` → **原生解码在生产环境真实生效**（Node 22 测试环境无此 API，走 `atob` 回退） |
| `Object.prototype.toString.call(fromBase64(...))`   | `[object Uint8Array]`（不是普通对象/数组）                                                 |
| `saveImageBytes` / `saveCompositeImageBytes` 存在性 | ✅ 均为 `function`（contextBridge 已暴露新通道）                                           |
| 渲染进程解码 → IPC 传 Uint8Array → 主进程写盘       | ✅ 返回 `true`，落盘字节 `1,2,3,4,5` 与源一致                                              |
| 旧调用方只传 dataUrl                                | ✅ 返回 `true`，落盘字节正确（回退通道未破）                                               |

这条实测覆盖了单测无法覆盖的部分：**`Uint8Array` 经 contextBridge 的结构化克隆**，以及
`import.meta.url` 之外的真实发送方校验。V8 15 的原生 base64 同时确认了修复 2 的收益在生产环境成立。

### 修复 8｜合并生成期的跨命名空间记录写（C1，P1-3）—— 实测收益远低于本文评级，已降级

**结论先行：做了，但它的收益是 0.1–0.4ms/张。本文把 C1 评为 P1 是错的，实测后降为 P3。**
真正值得处理的换成了在这次量测中冒出来的缩略图同步编码（见「新发现」）。

#### 实测数据（真实 Electron 43 + 生产 kernel + catalog-worker + SQLite）

装置：`AssetKernelManager.initialize()` 起真实 `app-data:*` handler，渲染侧用真实 preload 通道，
记录体量按本机真实库对齐（`thumbnails` 记录实测均值 117KB / p90 208KB / max 329KB）。

| 缩略图记录体积 | 2 次 `appDataPut`（改前） | 1 次 `appDataPutBatch`（改后） | 每张省                |
| -------------- | ------------------------- | ------------------------------ | --------------------- |
| 156KB          | 0.592ms                   | 0.516ms                        | 0.076ms               |
| 333KB          | 0.828ms                   | 0.868ms                        | **−0.04ms（噪声内）** |
| 468KB          | 1.260ms                   | 0.884ms                        | 0.376ms               |

**这个量级说明：一次跨进程写的成本约 0.1–0.6ms，成本主要由载荷序列化决定而不是往返次数。**
记录写单次成本对 468KB 载荷也只有 ~1ms —— 合并两次往返最多省 0.4ms。

#### 顺带量到的真正热点：`storeImage` 单张 160–200ms，其中记录写占 0.3%

同一装置里直接调生产 `storeImage(dataUrl, 'generated')`，源为真实库中一张 3.6MB / 1672×941 的 PNG：

| 环节                                                        | 实测       | 占 `storeImage` |
| ----------------------------------------------------------- | ---------- | --------------- |
| `computeContentHash`（原生 `fromBase64` + `crypto.subtle`） | 4.7ms      | 3%              |
| 原图落盘（`saveRawCacheImageToLocal`，3.6MB）               | 14.7ms     | 9%              |
| 缩略图：`<img>` 冷解码 + `drawImage`                        | ~9ms       | 6%              |
| 缩略图：`canvas.toDataURL('image/webp', 0.82)` **同步编码** | **71.4ms** | **44%**         |
| 记录写（本次修复的对象）                                    | ~0.5ms     | **0.3%**        |
| 其它（余量，含画布回读等）                                  | ~60ms      | 37%             |

即 **C1 想优化的东西只占这张图入库耗时的千分之三**；`storeImage` 90% 的时间在「原图写盘 + 缩略图解码编码」，
而其中最大的一块是 `canvas.toDataURL` 的**同步** WebP 编码（主线程被占 71ms，批量出 8 张就是 ~570ms 掉帧）。

对照量测（同一 canvas、同参数）：

| 写法                    | 耗时                                | 是否阻塞主线程 |
| ----------------------- | ----------------------------------- | -------------- |
| `canvas.toDataURL(...)` | 71.4ms                              | **是（同步）** |
| `canvas.toBlob(...)`    | 69.6ms                              | 否（异步调度） |
| 产出体积                | 350.9KB / 263.1KB（dataUrl / blob） | ——             |

#### 为什么还是保留了这次改动

1. **原子性**：`images` 与 `thumbnails` 现在是单事务提交，不再存在「图有了、缩略图没有」的半提交状态。
2. **批量任务写**：收藏夹批量增删 / 导入恢复原本 `Promise.all(tasks.map(putTask))` 是 N 次往返，现为一次 `put-many`。
3. 成本为零（有回退、有测试），顺手把 P1-3 的这一条从清单上划掉。

#### 改动

| 层                           | 内容                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `electron/app-data-store.ts` | 新增 `putBatch(entries)`：单事务写入多条**不同 namespace** 的记录                                                   |
| `electron/asset-catalog.ts`  | `appDataPutBatch` 透传                                                                                              |
| `electron/catalog-client.ts` | 同名 Promise 化方法（worker 侧动态派发，无需改 `catalog-worker`）                                                   |
| `electron/asset-kernel.ts`   | 新增 `app-data:put-batch` handler + `appDataBatchEntries` 载荷校验（沿用命名空间白名单）                            |
| `electron/preload.ts`        | 暴露 `appDataPutBatch`                                                                                              |
| `src/lib/db.ts`              | `putImageRecords(image, thumbnail)` 合并写 + `putTasks(tasks)` 批量写；均带逐级回退                                 |
| `src/store.ts`               | `storeImage` 两次写改一次；`putTasks` 包装（保留「先落盘再排素材同步」语义）并替换 4 处 `Promise.all(map(putTask))` |

#### 新增测试（9 个用例）

| 文件                              | 新增 | 覆盖                                                                                                                                                                                   |
| --------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `electron/app-data-store.test.ts` | 3    | 跨命名空间单事务写入、任一条不可序列化时**整批回滚**（不留半提交）、空批次 no-op                                                                                                       |
| `src/lib/db.test.ts`              | 6    | 图片 + 缩略图合并为一次提交且不再逐条写、只写图片时的载荷形状、两条都空时不调通道、旧 preload 无 `put-batch` 时回退逐条、`putTasks` 走一次 `put-many`（N 条不是 N 次）、空任务数组不写 |

守卫也在真机装置里验过：伪造 `namespace: 'evil'` 的批量载荷被主进程拒绝
（`invalid app data namespace`），白名单没有被这条新通道绕过。

#### 新发现｜缩略图同步编码才是生成期渲染主线程的最大单点（已在修复 9 处理）

- 位置：`src/lib/db.ts` 的 `createImageThumbnail` → `canvas.toDataURL('image/webp', THUMBNAIL_QUALITY)`。
- 影响：每生成一张图，主线程被同步占用 ~71ms（4K 大图更高）；批量出图时叠加。
- 候选方案（按收益/风险排序）：① `toBlob` + 转 dataUrl（改动最小，拿回主线程阻塞）；
  ② `createImageBitmap` + `OffscreenCanvas` 放进 Worker（把解码与编码整体移出主线程，改动最大）；
  ③ 生成期先用 `THUMBNAIL_MAX_SIZE/2` 出小图让任务卡立刻可显示，闲时再补全尺寸。
  **采纳①**，见修复 9（②③作为后续候选保留）。
- ⚠️ 本小节当时写的「产出体积反而更小」是**误读**：两处量到的差额（263KB vs 351KB）恰好是 3/4，
  那是 dataURL 的 base64 膨胀，不是编码器差异 —— `toBlob` 与 `toDataURL` 产出的是同一份 WebP 字节。
  收益只有「不阻塞主线程」这一条，修复 9 已用帧探针重新量准。

### 修复 9｜缩略图编码搬离主线程（新 P1）

**一句话**：把 `canvas.toDataURL` 换成 `canvas.toBlob`。编码量没变、总耗时没变，但 5 张连续缩略图
编码时主线程的冻结从 **553.8ms** 降到 **32ms**（0 个 >50ms 冻结帧）。

| 文件                    | 改动                                                                                                                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/canvasImage.ts` | 新增 `blobToDataUrl`（`blob.arrayBuffer()` + 原生 `Uint8Array.prototype.toBase64`，回退分块 `btoa`）与 `canvasToWebpDataUrl`（优先 `toBlob`；不支持/编码失败回退 `toDataURL`，保持原语义）；`createImageThumbnailDataUrl` 改走后者，`grid` 通道一并受益 |
| `src/lib/db.ts`          | `createImageThumbnail` 的 `canvas.toDataURL('image/webp', THUMBNAIL_QUALITY)` → `await canvasToWebpDataUrl(canvas, THUMBNAIL_QUALITY)`                                                                                    |

**真机量测**（`%TEMP%\doupao-encode-probe`，Electron 43 / Chromium 150）：1024×1024 源图（渐变 + 像素噪声
+ 600 条高频线条，避免纯色被 WebP 压到失真），`q0.82`，5 个独立 canvas 样本，编码前各预热一次。
除耗时外**挂了 rAF 帧探针**记录主线程最长冻结 —— 这才是用户能感知的量。

| 口径                        | 改前 `toDataURL`                            | 改后 `toBlob`                         |
| --------------------------- | ------------------------------------------- | ------------------------------------- |
| 单次编码耗时（均值 / 极值） | 110.7ms（109.4–111.3）                      | 109.5ms（108.9–110.1）                |
| 5 张连续编码的主线程冻结    | **553.8ms**（整个循环一次冻结，1 个冻结帧） | **32.0ms**（21 帧内让出，0 个冻结帧） |
| 端到端（含转 dataURL）      | 555.6ms，最长冻结 555.7ms                   | 556.1ms，最长 31.8ms                  |
| 产出 WebP 字节              | 378,412 B                                   | 378,412 B（同一份字节）               |

`blob → dataURL` 这一步单独量过，两条实现同量级但原生路径快一半，故取后者：

| 实现                                   | 单次均值（极值）    |
| -------------------------------------- | ------------------- |
| `FileReader.readAsDataURL`             | 1.04ms（0.8–1.3）   |
| `blob.arrayBuffer()` + 原生 `toBase64` | **0.56ms**（0.4–0.7） |

**要纠正修复 8 的一处误读**：那里写「`toBlob` 产出更小（263KB vs 351KB）」把 base64 膨胀当成了编码器优势。
实测同一 canvas 两种写法产出的是**同一份 WebP 字节**（378,412B），差额恰好 4/3。真实收益只有一条：不阻塞主线程。

其余判断：

- 单张仍有 ~32ms 残余停顿（`toBlob` 回调调度 + blob 落地取字节），低于两帧，不再构成可感知冻结；比改前的 110ms/张好一个数量级。
- `Uint8Array.prototype.toBase64` 与修复 2 用的 `fromBase64` 同代（Chromium 133+），真机确认存在；Node 22 测试环境没有，走分块 `btoa` 回退，两条路径都有测试。
- 未采用方案②（`OffscreenCanvas` + Worker）：解码到缩略图这一步已被 `grid` 通道（修复 6）化解为「读 512px webp 再缩」，Worker 化的迁移成本与缩略图子系统耦合度不相称。

**新增测试**：`src/lib/canvasImage.test.ts`（5 个用例）—— 优先 `toBlob` 且编码参数为 webp、`toBlob` 给不出 blob / 直接抛错时回退 `toDataURL`、
`toBlob` 静默降级成 PNG 时 dataURL 前缀跟随真实 mime（不谎报 webp）、`blobToDataUrl` 的 base64 正确性。

### 未做（明确留作下一变更集）

| 项                                   | 原因 / 实测依据                                                                                                                                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-1 尾项（lint 约定 / 存量同步 fs） | 出图热点已全部异步化（修复 1、7）。存量 90 余处 `*Sync` 多为低频设置/存在性检查，不在热点路径上，单独变更集处理                                                                                                       |
| B2/B4 尾项                           | ✅ 通道已接通（修复 6）。B4「磁盘缩略图文件名不带原图尺寸 → 每次命中多一次 `getImage`」实测同装置下单次读 ~0.2ms，且 `grid` 通道 4 个消费方里只有 `GalleryImageTile` 用到宽高（且只用于宽高比），收益亚毫秒，不建议动 |
| C1 合并生成期跨进程写（原 P1）       | ✅ 已做（修复 8），但**实测只省 0.1–0.4ms/张**，本文原评 P1 有误，已降为 P3                                                                                                                                           |
| B3 缓存计费口径                      | 属**保守高估**而非缺陷（`× 2` 是 UTF-16 上界的刻意冗余），改动会直接抬高实际内存占用，需先定预算再动                                                                                                                  |
| A4 大组件订阅下沉（原 P2）           | 前提已弱化：高频进度走 `runtimeStore`（修复批次已做），`tasks` 只在真实状态变更时换引用，19 处订阅大多是条件挂载的弹窗；量级无法与上面的缩略图编码相比，降级                                                          |
| C2 整表替换式持久化（原 P2）         | 本机真实库实测 `agentConversations` 0.1KB / `wordLibrary` 0.2KB（各 1 条记录），当前**没有可测收益**；属"数据长大后"的假想问题，留待真实体量出现再议                                                                  |
| A3b `updateTaskInStore` 索引化       | 实测不构成卡顿，收益不足                                                                                                                                                                                              |
| C3 `ByteLruCache.get` Map 重排       | 常数级，收益不足                                                                                                                                                                                                      |

### 后续验证建议（对应第五节）

本轮改动可直接用第五节第 1、4、5 项验证：主进程长任务时长、批量出图时的「点击生成 → 任务卡出现」P95，以及
`npm run verify` + `npm run electron:preview` 的功能等效确认。
