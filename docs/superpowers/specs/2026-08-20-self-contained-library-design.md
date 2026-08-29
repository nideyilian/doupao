# DOUPAO 自包含素材库（库根收敛）设计方案

> 日期：2026-08-20
> 状态：待确认后实施
> 目标版本：素材库 V2（数据管理）
> 适用端：Electron（主）；浏览器/PWA 不受影响
> 对应计划：`docs/superpowers/plans/2026-08-20-self-contained-library.md`

## 1. 方案结论

将 DOUPAO 在 Electron 端散落在多个根目录的素材数据，收敛为一个**自包含的「库根」目录**，对齐 Eagle 数据管理的核心心智：**复制一个文件夹 = 整个素材库**。

- 库根默认为现有 `localSavePath`（默认 `userData/local-saves`），不改变默认行为；用户可在设置中修改库根位置。
- 库根内统一收编：素材原图（现 `cache-images`）、SQLite 权威目录（现 `userData/asset-kernel.sqlite`）、备份目录（现 `userData/backups`）、新增磁盘缩略图缓存（现 IndexedDB `thumbnails`）。
- 应用级配置（窗口状态、API token、诊断日志等）**留在 `userData`**，不随库移动。
- 浏览器/PWA 继续使用 IndexedDB，架构不变；本方案只影响 Electron 端。

不做的事（明确边界）：

- 不改变内容寻址、SHA-256 去重、Asset→Blob→Version→Origin 数据模型。
- 不改变备份 v6/v7 ZIP 格式与导入流程（整库文件夹拷贝备份仅作为用户指引与 P2 候选）。
- 不重命名物理原图文件（磁盘文件永远是 `{id}.{ext}`，用户文件名是元数据）。
- 不为"像 Eagle"而引入 items.jsonl 替代 SQLite（SQLite 保留为唯一权威存储；JSONL 仅作为导出/校验工具输出）。

## 2. 当前架构基线

### 2.1 现状：数据散在三个根

| 数据 | 当前位置 | 代码证据 |
| --- | --- | --- |
| SQLite 权威目录 | `userData/asset-kernel.sqlite`（+ WAL） | `electron/asset-kernel.ts:96` |
| API 鉴权配置 | `userData/asset-api.json` | `electron/asset-kernel.ts:97` |
| 素材原图（内容寻址） | `<localSavePath>/cache-images`，文件名为 `{sha256}.{ext}` | `electron/ipc-handlers.ts:223`、`src/lib/localSave.ts:419-421` |
| 备份 ZIP | `userData/backups` | `electron/ipc-handlers.ts:287` |
| 缩略图缓存 | IndexedDB `thumbnails`（webp dataURL + 版本号） | `src/lib/db.ts` `STORE_THUMBNAILS` |
| 本地设置 | `userData`（`LOCAL_SETTINGS_FILE`） | `electron/ipc-handlers.ts:82` |

问题：用户无法通过"复制一个文件夹"完成搬家/备份/换机；库的物理位置分散且部分不可配置。

### 2.2 已对齐 Eagle、必须保留的部分

- **内容寻址原图**：`cache-images/{sha256}.{ext}`，等价于 Eagle 的 `images/{id}.{ext}`，且 SHA-256 更强。
- **一份原图多处引用**：`collectionIds` / `tagIds` / `colorLabel` 均为元数据，不复制文件（`src/types.ts:919`）。
- **软删除 + 墓碑 + 引用图保护 + 清理计划器**：比 Eagle 的删除标记更安全。
- **生成追溯**：Origin 快照与衍生链（`parentAssetIds`），Eagle 完全没有。
- **备份 v6/v7**：manifest + 流式导入 + CRC 校验。
- **SQLite FTS5 + 可重建机器索引**（`docs/asset-kernel.md`）。

### 2.3 本次要修正的边界

1. 库不是自包含文件夹（§2.1）。
2. 缩略图不在磁盘上：复制库目录带不走缩略图；Electron 下 IndexedDB 体积持续增长。
3. 元数据不可人工检查/修复：缺一个"元数据导出 / 库完整性校验"工具。
4. 素材重命名尚未元数据化：当前 `GeneratedAsset` 无用户文件名字段（文件名由 `origin.generatedFileNameBase` 派生，`src/lib/assetCommands.ts:73`）。**禁止**在重命名时改动磁盘文件（内容寻址会被破坏）。

## 3. 目标态

### 3.1 库根目录结构

```text
<库根>（默认 userData/local-saves，设置中可改）
├── db/
│   └── asset-kernel.sqlite      ← 从 userData 迁入（含 -wal / -shm）
├── cache-images/                ← 保留现有目录名与命名，物理位置不变（已是库根内）
├── thumbs/                      ← 新增磁盘缩略图缓存（可重建、随库移动）
├── backups/                     ← 从 userData 迁入
└── library.json                 ← 库级元数据（版本、库 ID、最近迁移时间）
```

说明：

- `cache-images` **保留原名**（见决策点 D1），避免大规模改动现有引用与迁移代码。
- `db/` 与 `backups/` 从 `userData` 迁入；`asset-api.json`（含 token）留在 `userData`（决策点 D3）。
- `library.json` 记录库版本号，为将来的多库切换（P3）预留扩展点。

### 3.2 不变项

- 原图命名 `{sha256}.{ext}`；素材 ID = 图片内容哈希。
- `GeneratedAsset` / `AssetBlob` / `AssetVersion` / `AssetTombstone` 模型与 SQLite schema（P2 的 `name` 字段除外）。
- 备份 v6/v7 格式与导入路径。
- REST API（`asset-api.json` 位置不变）与 MCP 接口行为。
- 浏览器/PWA 的 IndexedDB 路径。
- 单实例锁（`electron/main.ts:71`）与退出前 SQLite 关闭时序（`electron/main.ts:561`）。

## 4. 分项设计

### 4.1 库根配置与初始化

- 设置项 `localSavePath` 语义升级为"库根"，保留字段名（兼容旧数据），文案改为"素材库位置"。
- 新增设置项 `libraryVersion`（整数，当前 = 1），写入 `userData` 设置文件；`library.json` 同时记录。
- 启动时 `ensureLibraryLayout()`：确保库根下 `db/`、`thumbs/`、`backups/` 存在（`ensureDir` 幂等）。
- 库根修改流程复用现有 `ensureImageStorageMigrated` 模式（`electron/ipc-handlers.ts:971` 的 `copyCacheImageDirectory`），扩展为"整库移动"：DB 关闭 → 移动 `db/` → 移动 `backups/` → 更新设置 → 重启内核。

### 4.2 DB 迁入库根（L2）

- 路径解析收敛为单一函数：`getLibraryPaths()`（库根 + `db` / `cache-images` / `thumbs` / `backups`），替换 `electron/asset-kernel.ts:96`、`electron/ipc-handlers.ts:287` 等散落的 `path.join(app.getPath('userData'), ...)`。
- 迁移时序（启动时、单实例锁内、SQLite 关闭后）：
  1. 若库根 `db/asset-kernel.sqlite` 已存在 → 直接使用，完成。
  2. 否则若 `userData/asset-kernel.sqlite` 存在 → **移动**（非复制）到库根 `db/`，迁移标记写入 `library.json`。
  3. 两者都不存在 → 全新初始化于库根 `db/`。
- 失败回退：移动前先做完整性检查（`PRAGMA integrity_check`）；失败则保留旧文件、报错并继续用旧路径（库根设置不变）。
- 旧路径数据不删除：迁移成功后，旧 `userData/asset-kernel.sqlite` 由用户决定是否清理（设置区提供"清理旧位置残留"可选动作，默认不做）。

### 4.3 缩略图磁盘缓存（L3）

- 新增 `thumbs/{id}.{ext}`（webp，文件名含 `THUMBNAIL_VERSION` 前缀或独立版本标记文件），复用现有 `safeCreateImageThumbnail` 生成管线（`src/lib/db.ts:872`）。
- Electron 端新增 IPC：`thumb:read`（按 id 读盘，命中返回 dataURL）与 `thumb:save`（写盘，批量/串行队列防抖）。浏览器端行为不变（IndexedDB）。
- 读取顺序：磁盘缓存 → IndexedDB → 生成（现有 backfill 管线，`src/store.ts` `scheduleThumbnailBackfillTick`）。
- 写入策略（决策点 D2）：**懒迁移 + 双写**——生成/命中缩略图时写盘；存量 IndexedDB 缩略图按需回填，不一次性搬迁。
- 缩略图视为可重建缓存：`thumbs/` 可整体删除，下次浏览自动重建；存储统计纳入 `thumbs/` 磁盘字节（`src/lib/storageStats.ts`）。

### 4.4 备份目录收编（L4）

- 新备份默认写入库根 `backups/`；旧 `userData/backups` 内已有备份不迁移（导入是文件级操作，不受位置影响），设置区提供"打开备份目录"。
- 存储统计（`storageStats.ts`）路径更新为库根 `backups/`。
- 用户指引（设置区 + README）：备份库 = 复制库根文件夹（退出应用后执行，保证 SQLite 一致性，决策点 D4）；ZIP 导出仍是跨端/迁移的权威格式。

### 4.5 元数据 JSONL 导出与库完整性校验（L5）

在现有「设置 → 数据管理」区（`docs/asset-kernel.md`）新增两项工具：

1. **导出元数据 JSONL**：每个素材一行 JSON，字段对齐 `GeneratedAsset`（id、imageId、blobId、status、favorite、rating、colorLabel、collectionIds、tagIds、notes、origins、parentAssetIds、width/height/mimeType/byteSize、createdAt/updatedAt/trashedAt）。用途：人工检查、diff、应急恢复参考（与 items.jsonl 同构，但**不**作为权威存储）。
2. **库完整性校验**：`PRAGMA integrity_check` + 原图哈希抽查（对 `cache-images` 采样文件重算 SHA-256 与素材 ID 比对）+ 孤儿/缺失文件报告（复用 `store:reconcile-cache-images` 的引用集合逻辑）。

### 4.6 素材重命名元数据化（P2，随本方案定原则）

- `GeneratedAsset` 新增 `name?: string`（用户可见文件名；缺省回退到现有 `getAssetFileName` 派生逻辑）。
- 重命名 = 只写 `name` 字段，**绝不触碰磁盘文件**（内容寻址不变）；下载/导出/"打开文件位置"使用该名字。
- 明确否决"Electron 端同步改磁盘文件名"的方案（`docs/eagle-interaction-gap-analysis.md` §3.10 的旧建议）。

## 5. 迁移与回退

| 场景 | 行为 |
| --- | --- |
| 升级安装（旧数据在 userData） | 启动时按 §4.2 顺序自动迁移，任务/素材/收藏零丢失 |
| 迁移中途失败 | 旧文件保留、报错、继续用旧路径；不进入半迁移状态 |
| 用户修改库根 | 整库移动（DB 关闭 → 移动 → 重启内核），失败回退原路径 |
| 复制库根做备份/换机 | 退出应用后复制文件夹；新机设置库根指向该目录即可 |
| 缩略图缓存损坏/丢失 | 自动重建，不影响任何用户数据 |
| 回滚旧版本 | 旧版本读到 userData 无 DB 时，按旧逻辑重新初始化；数据不丢（库根内 DB 仍在，旧版不识别属预期，建议升级而非回滚） |

## 6. 兼容性与安全

- **单实例锁**保证迁移期间无并发写（`main.ts:71` 已有）。
- **SQLite WAL 一致性**：迁移与移动只发生在 DB 关闭后；备份文件夹拷贝指引要求先退出应用。
- **路径安全**：所有新路径仍走现有 IPC 白名单与真实路径校验（`electron/ipc-handlers.ts`），不新增任意路径写入面。
- **token 不随库移动**：`asset-api.json` 留在 `userData`。
- **PWA 不变**：浏览器端继续 IndexedDB；备份导入/导出兼容双向。
- **回归护栏**：`src/store.test.ts`（110 用例）、`src/features/assetLibrary/store.test.ts`（77 用例）、`electron/ipc-handlers.test.ts` 全绿；`npx tsc -b && npx vitest run && npm run build` 每里程碑通过。

## 7. 决策点

| # | 决策 | 推荐 | 理由 |
| --- | --- | --- | --- |
| D1 | `cache-images` 是否改名 `originals/` | **保留原名** | 改动面最小；现有迁移/核对/统计代码与测试零破坏，改名可后续机械替换 |
| D2 | 缩略图磁盘化策略 | 懒迁移 + 双写 | 存量不一次性搬迁，按需回填；失败自动回退 IndexedDB |
| D3 | `asset-api.json` 是否随库 | 留在 `userData` | 含 bearer token，随文件夹移动扩大暴露面 |
| D4 | "复制文件夹"备份的一致性 | 指引退出应用后复制；快照式在线备份列为 P2 候选（SQLite 在线备份 API） | 避免拷贝进行中 WAL 数据不一致 |
| D5 | 库根默认值 | 维持 `userData/local-saves` 不变 | 默认行为零变化，降低升级风险 |
| D6 | 旧位置残留清理 | 默认不删，设置区提供可选动作 | 尊重"不能静默丢失数据"原则 |
| D7 | 素材重命名字段 | `GeneratedAsset.name`（P2 实施） | 一等字段比改写 origin 更清晰，导出/下载统一取用 |

## 8. 范围外（P3 候选）

- 多库切换（库根即库，天然支持：`library.json` + 库根切换入口）。
- 目录监视自动入库（chokidar 常驻）。
- Eagle 库直接导入（解析 items.jsonl + images/）。
- 快照式在线备份（SQLite 在线备份 API）与增量同步。
- 智能文件夹树形化、时间线视图等（交互域，另立文档）。

## 9. 完成后预期效果（用户视角）

### 9.1 一句话总结

> 你的整个素材库 = 一个文件夹。**退出豆泡 → 复制这个文件夹 → 换台电脑指过去，原图、收藏、评分、标签、项目、备注、生成记录全部原样可用。**

### 9.2 现在 vs 完成后

| 场景 | 现在 | 完成后 |
| --- | --- | --- |
| 备份素材库 | 只能用「导出备份 ZIP」，还要记着勾选内容 | 复制库根文件夹即完整备份；ZIP 导出保留为跨端/分享格式 |
| 换电脑 / 重装系统 | 导出 ZIP → 新机导入，步骤多且容易漏 | 拷贝文件夹 → 设置指向库根 → 打开即用 |
| 网盘 / 移动硬盘同步 | 需要自己找出散落的图片目录 | 把库根直接放进网盘同步目录，整库自动同步 |
| 查看素材元数据 | 数据库是二进制的，看不到、修不了 | 一键导出元数据清单（文本，每行一个素材），可搜索、可核对、可交付分析 |
| 怀疑库有问题 | 只能靠备份整体恢复 | 一键「库完整性校验」：数据库健康 + 原图抽查 + 孤儿/缺失文件报告 |
| 换机后缩略图 | 要重新生成（缩略图不在库文件夹里） | 缩略图随库文件夹一起搬走；损坏/丢失自动重建 |
| 给素材改名 | 无 | （P2）改名即时生效、可撤销，不碰磁盘原图、不影响去重 |

### 9.3 分场景说明

**① 备份与换机（本次最大的体验变化）**
升级后首次启动，旧的数据库会自动挪进库根，全程无感；失败自动回退，数据不丢。之后用户的心智变成 Eagle 式的："我的库在哪儿，我复制哪儿"。改库根位置 = 整库搬家，同样可回退。

**② 数据透明可检查**
设置 → 数据管理新增两项工具：导出元数据清单（JSONL，字段含评分/收藏/标签/项目/备注/生成来源快照，可与备份一起留存）与库完整性校验（不产生任何写操作，只报告）。用户第一次能"看见"自己的素材库内部长什么样、有没有异常。

**③ 迁移零风险、默认行为不变**
老用户升级后什么都不用做；默认库根位置与现在一致，界面与交互不变（本方案只动数据层）。

**④ 浏览器版不受影响**
PWA 用户继续用 IndexedDB + ZIP 备份，与 Electron 端备份双向兼容。

**⑤ 远期预留（不在本次交付内）**
多库切换（工作库/归档库）、目录监视自动入库、Eagle 库导入——库根结构天然支持，届时无需重构。

### 9.4 明确不做（避免误解）

- 不改素材库界面与交互（本方案只动数据管理，M9–M19 的交互成果原样保留）。
- 不重命名磁盘原图（内容寻址与去重保持）。
- 不引入云端/账号体系。

### 9.5 验收标准

1. 从旧版本升级后首次启动，素材/项目/标签/评分/备注/回收站与迁移前完全一致，无任何手工操作。
2. 退出应用 → 复制库根文件夹 → 在新机器设置指向该目录 → 打开后内容与原来一致（含缩略图）。
3. 库完整性校验对正常库零误报；对构造的损坏/缺失/孤儿场景能准确报告。
4. 元数据 JSONL 导出可被文本编辑器打开，字段与素材详情一致。
5. ZIP 备份导出/导入（v6/v7）行为不变，浏览器与 Electron 双向兼容。
