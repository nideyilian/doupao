# DOUPAO 自包含素材库（库根收敛）实施计划

> 对应设计：`docs/superpowers/specs/2026-08-20-self-contained-library-design.md`  
> 实施方法：测试先行；每个里程碑结束时应用都必须可构建、可启动、可读取旧数据。  
> 技术栈：React 19、TypeScript、Zustand、IndexedDB、Electron（node:sqlite）、Vitest

## 0. 实施约束

- 不改变内容寻址与 SHA-256 去重；磁盘原图文件名永远是 `{id}.{ext}`。
- 不改变备份 v6/v7 ZIP 格式与导入流程；旧备份继续可导入。
- 不删除旧位置残留数据（迁移成功后默认保留，仅提供可选清理动作）。
- 迁移只发生在单实例锁内、SQLite 关闭后；任何失败必须回退旧路径且可再次尝试。
- 浏览器/PWA 的 IndexedDB 路径完全不动；Electron 迁移逻辑与浏览器代码隔离。
- 素材重命名只写元数据，禁止同步改磁盘文件名。
- 每个里程碑结束：`npx tsc -b && npx vitest run && npm run build` 必须全绿。

## 1. 里程碑与交付顺序

```text
L1 库根配置与目录骨架
  → L2 DB 迁入库根
    → L3 缩略图磁盘缓存
      → L4 备份目录收编与路径引用刷新
        → L5 元数据 JSONL 导出与库完整性校验
          → L6 设置 UI 与收口
```

L1 是后续所有里程碑的地基（路径解析收敛）；L2/L3/L4 相互独立，可并行验证；L5 不依赖 L3。

## 2. L1：库根配置与目录骨架

### Task 1.1：收敛路径解析

**新增：**

- `electron/library-paths.ts`：`getLibraryPaths()`（库根 + `db` / `cache-images` / `thumbs` / `backups`）、`ensureLibraryLayout()`（幂等建目录）、`readLibraryMeta()/writeLibraryMeta()`（`library.json` 读写，含 `version` 字段）。

**修改：**

- `electron/ipc-handlers.ts:223`（`cache-images` 路径）改走 `getLibraryPaths()`。
- `electron/asset-kernel.ts:96`（sqlite 路径）改走 `getLibraryPaths().db`（位置迁移在 L2）。
- `electron/ipc-handlers.ts:287`（backups 路径）改走 `getLibraryPaths().backups`（位置迁移在 L4）。

**测试：**

- `electron/library-paths.test.ts`：库根缺省回退、子目录拼接、`library.json` 幂等读写、`ensureLibraryLayout` 幂等。
- `electron/ipc-handlers.test.ts` 既有用例保持全绿（路径解析变化不改变 IPC 行为）。

**验证：**

```powershell
npx vitest run electron/library-paths.test.ts electron/ipc-handlers.test.ts
npx tsc -b
```

### Task 1.2：设置项语义升级

**修改：**

- `electron/ipc-handlers.ts` 设置读写：`localSavePath` 语义升级为"库根"，保留字段名；新增 `libraryVersion: number`（默认 1）。
- 设置 UI（`src/` 设置页）：文案"本地保存路径"→"素材库位置"，说明"复制此文件夹即备份整个素材库（退出应用后复制）"。
- `library.json` 与设置文件在启动时对齐版本号。

**测试：**

- 设置读写单测：旧设置文件（无 `libraryVersion`）升级为 1；`localSavePath` 字段兼容旧值。

**验证：**

```powershell
npx vitest run electron/ipc-handlers.test.ts
npm run build
```

## 3. L2：DB 迁入库根

### Task 2.1：启动迁移时序

**修改：**

- `electron/asset-kernel.ts`：构造前调用迁移函数 `migrateCatalogIntoLibrary()`（单实例锁内、DB 未打开时执行）。

**新增：**

- `electron/catalog-migration.ts`：
  1. 库根 `db/asset-kernel.sqlite` 存在 → 直接使用。
  2. 否则 `userData/asset-kernel.sqlite` 存在 → `PRAGMA integrity_check` 通过后**移动**（含 `-wal`/`-shm`）到库根 `db/`，写 `library.json` 迁移标记。
  3. 都无 → 全新初始化于库根 `db/`。

**测试：**

- 三分支单测：已就位 / 可迁移 / 全新；`integrity_check` 失败时回退旧路径且不删除源文件；迁移标记写入。

**验证：**

```powershell
npx vitest run electron/catalog-migration.test.ts
npx tsc -b
```

### Task 2.2：手工迁移（修改库根）

**修改：**

- 设置变更保存流程：库根变化时执行整库移动——关闭 DB → 移动 `db/` → 移动 `backups/` → 重启内核；失败回退原路径并报错。

**测试：**

- 迁移成功 / 中途失败回退 / 目标已存在同名目录冲突处理。

**验证：**

```powershell
npx vitest run
npm run build
```

## 4. L3：缩略图磁盘缓存

### Task 3.1：磁盘缩略图 IPC

**修改：**

- `electron/preload.ts`、`electron/ipc-handlers.ts`：新增 `thumb:read`（按 id 读 `thumbs/`，命中返回 dataURL 与尺寸）、`thumb:save`（写盘 webp，串行队列防抖）。
- `src/lib/db.ts` 与 `src/store.ts` 缩略图管线：读取顺序改为 磁盘 → IndexedDB → 生成；生成/命中时写盘（懒迁移 + 双写，决策点 D2）。

**测试：**

- IPC 单测：读写往返、目录不存在自动创建、版本不匹配视为未命中。
- `src/store.test.ts` 既有缩略图用例保持全绿（浏览器环境走 IndexedDB 分支不变）。

**验证：**

```powershell
npx vitest run src/store.test.ts electron/ipc-handlers.test.ts
npm run build
```

### Task 3.2：存储统计纳入 thumbs

**修改：**

- `src/lib/storageStats.ts`：Electron 磁盘统计增加 `thumbs/` 字节与数量；设置区存储概览文案更新（"缩略图缓存（可重建）"）。

**测试：**

- `storageStats.test.ts` 更新断言（thumbs 计入磁盘字节，IndexedDB 计数不再重复计入）。

**验证：**

```powershell
npx vitest run src/lib/storageStats.test.ts
```

## 5. L4：备份目录收编与路径引用刷新

### Task 4.1：备份默认位置

**修改：**

- 备份写入与导入打开路径改走 `getLibraryPaths().backups`；旧 `userData/backups` 仅保留"打开旧备份目录"入口（导入是文件级操作，不受位置影响）。
- `storageStats.ts` 备份统计路径同步更新。

**测试：**

- 备份/导入既有用例全绿；新备份落库根、旧备份仍可导入。

**验证：**

```powershell
npx vitest run electron/ipc-handlers.test.ts src/lib/backupImport.test.ts src/lib/dataExport.test.ts
```

### Task 4.2：全量路径引用审计

**修改：**

- 全仓 grep `userData` 相关路径拼接（`asset-kernel.sqlite`、`backups`、`cache-images`），凡属库数据的全部改走 `getLibraryPaths()`；属应用配置的（窗口状态、`asset-api.json`、诊断）保持不动。
- "打开文件位置"/`openInExplorer` 的素材路径校验随库根更新。

**验证：**

```powershell
npx tsc -b && npx vitest run && npm run build
```

## 6. L5：元数据 JSONL 导出与库完整性校验

### Task 5.1：元数据 JSONL 导出

**新增：**

- `src/lib/assetMetadataExport.ts`：一行一素材（字段对齐 `GeneratedAsset`，见设计 §4.5），流式写出，Electron 走保存对话框，浏览器走下载。

**测试：**

- 导出内容与 `hydrate()` 数据一致；空库输出空文件；字段含 `undefined` 时降级为 `null`/省略。

### Task 5.2：库完整性校验

**新增：**

- `src/lib/libraryIntegrityCheck.ts` + Electron IPC：`PRAGMA integrity_check`；对 `cache-images` 抽样重算 SHA-256 与素材 ID 比对；孤儿/缺失文件报告（复用 `store:reconcile-cache-images` 引用集合）。

**测试：**

- 构造损坏/缺失/孤儿三类场景，校验报告分类正确、不误报、不触发任何写操作。

**验证：**

```powershell
npx vitest run src/lib/assetMetadataExport.test.ts src/lib/libraryIntegrityCheck.test.ts
npx tsc -b
```

## 7. L6：设置 UI 与收口

### Task 6.1：数据管理设置区

**修改：**

- 设置 → 数据管理：库根路径展示与修改入口（含"复制即备份"指引）、打开备份目录、导出元数据 JSONL、运行库完整性校验、可选"清理旧位置残留"（决策点 D6，默认隐藏/二次确认）。
- 帮助（HelpModal/README/Code Wiki）补库根与备份说明。

### Task 6.2：回归与发布

- 全量回归：`npx tsc -b && npx vitest run && npm run build`；Electron 手工冒烟：升级安装（旧 userData 数据自动迁移）、修改库根、复制库根到新位置打开、缩略图重建、备份导入。

## 8. 后续候选（不在本计划内）

- **P2**：素材重命名元数据化（`GeneratedAsset.name`，见设计 §4.6 与决策点 D7）；快照式在线备份（SQLite 在线备份 API）。
- **P3**：多库切换、目录监视自动入库、Eagle 库导入、增量同步。
