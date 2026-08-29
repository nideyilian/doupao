# 存储管理功能可行性分析报告

> 针对 GPT Image Playground (豆泡) 提出的四项存储管理功能进行技术可行性评估。

---

## 1. 现有存储架构概览

### 1.1 存储层级

| 存储层级          | 技术实现                  | 数据内容                                             | 持久化位置                                 |
| ----------------- | ------------------------- | ---------------------------------------------------- | ------------------------------------------ |
| **内存缓存**      | `Map<string, string>`     | 图片 dataUrl、缩略图                                 | 运行时内存                                 |
| **IndexedDB**     | 原生 IDB API              | 任务、图片、缩略图、Agent 对话                       | 浏览器/ Electron 内部                      |
| **本地文件系统**  | Electron IPC + Node.js fs | 任务元数据(JSON)、图片、提示词、Agent Markdown、备份 | `%APPDATA%/豆泡/local-saves/`              |
| **Zustand Store** | persist 中间件            | 应用设置、状态                                       | `%APPDATA%/豆泡/gpt-image-playground.json` |

### 1.2 IndexedDB 结构 (`src/lib/db.ts`)

```
数据库: gpt-image-playground (v3)
├── store: tasks                # TaskRecord[]
├── store: images               # StoredImage { id, dataUrl, source, width, height, createdAt }
├── store: thumbnails           # StoredImageThumbnail { id, thumbnailDataUrl, width, height, thumbnailVersion }
└── store: agentConversations   # AgentConversation[]
```

### 1.3 本地文件结构 (`src/lib/localSave.ts`)

```
local-saves/
├── images/           # 按任务保存的输出图片
├── tasks/            # 任务元数据 JSON
├── prompts/          # 提示词文本
└── agent/            # Agent 对话 Markdown
```

### 1.4 关键已有机制

- **图片去重**: `hashDataUrl()` 使用 SHA-256 对 dataUrl 哈希，相同图片只存一份。
- **孤立图片清理**: `deleteUnreferencedImageIds()` 遍历所有任务、Agent 对话、输入草稿，删除未被引用的图片。
- **缩略图管理**: 独立 store，版本控制 (`THUMBNAIL_VERSION = 2`)，启动时自动回补。
- **批量删除**: `batchDeleteImages(ids)` 支持事务批量删除图片+缩略图。

---

## 2. 功能可行性分析

### 2.1 功能一：存储空间显示

**需求**: 查看总占用空间、各类数据（图片/任务/对话/备份）数量和空间分布。

#### 可行性: ✅ 高

**实现路径**:

| 数据源               | 获取方式                                  | 空间计算                                 |
| -------------------- | ----------------------------------------- | ---------------------------------------- |
| IndexedDB 图片       | `getAllImages()`                          | `dataUrl.length * 0.75` (base64 → bytes) |
| IndexedDB 缩略图     | `getAllImageIds()` + 遍历 thumbnail store | 同上                                     |
| IndexedDB 任务       | `getAllTasks()`                           | `JSON.stringify(task).length`            |
| IndexedDB Agent 对话 | `getAllAgentConversations()`              | `JSON.stringify(conversation).length`    |
| 本地文件             | Electron IPC 新增 `get-folder-size`       | Node.js `fs.statSync()` 递归累加         |
| 备份文件             | 已有 `listBackups()` + `statSync`         | 直接读取文件 size                        |

**建议实现**:

```typescript
// src/lib/storageStats.ts
export interface StorageStats {
  totalBytes: number
  categories: {
    images: { count: number; bytes: number }
    thumbnails: { count: number; bytes: number }
    tasks: { count: number; bytes: number }
    agentConversations: { count: number; bytes: number }
    localFiles: { count: number; bytes: number }
    backups: { count: number; bytes: number }
  }
}

export async function calculateStorageStats(): Promise<StorageStats> {
  const images = await getAllImages()
  const imageBytes = images.reduce((sum, img) => sum + (img.dataUrl.length * 0.75), 0)

  const tasks = await getAllTasks()
  const taskBytes = tasks.reduce((sum, t) => sum + JSON.stringify(t).length, 0)

  // ... 其他类别类似

  return { totalBytes: imageBytes + taskBytes + ..., categories: { ... } }
}
```

**UI 建议**: 在设置弹窗「数据管理」Tab 中新增「存储空间」卡片，用进度条展示各类别占比。

**注意事项**:

- IndexedDB 空间计算为近似值（base64 解码比例 0.75）。
- 大量图片时遍历可能耗时，建议加缓存（每 5 分钟刷新或手动触发）。

---

### 2.2 功能二：一键清理过期图片

**需求**: 按时间范围清理过期和孤立图片。

#### 可行性: ✅ 高

**已有基础**:

- `deleteUnreferencedImageIds()` 已实现孤立图片检测逻辑。
- `batchDeleteImages()` 支持批量删除。
- 图片和任务都有 `createdAt` 时间戳。

**建议实现**:

```typescript
// src/lib/storageCleanup.ts
export interface CleanupOptions {
  /** 清理 N 天前的数据 */
  olderThanDays: number
  /** 是否仅清理孤立图片 */
  orphanOnly: boolean
  /** 是否包含已删除任务的本地文件 */
  includeLocalFiles: boolean
}

export async function cleanupExpiredImages(options: CleanupOptions): Promise<{
  deletedImages: number
  deletedThumbnails: number
  deletedLocalFiles: number
  freedBytes: number
}> {
  const cutoff = Date.now() - options.olderThanDays * 24 * 60 * 60 * 1000
  const images = await getAllImages()
  const tasks = await getAllTasks()

  // 构建被引用的图片 ID 集合
  const referencedIds = new Set<string>()
  for (const t of tasks) {
    for (const id of t.inputImageIds) referencedIds.add(id)
    for (const id of t.outputImages) referencedIds.add(id)
    // ... mask, streamPartial 等
  }

  const toDelete: string[] = []
  for (const img of images) {
    const isOld = (img.createdAt ?? 0) < cutoff
    const isOrphan = !referencedIds.has(img.id)

    if (options.orphanOnly) {
      if (isOrphan && isOld) toDelete.push(img.id)
    } else {
      if (isOld) toDelete.push(img.id)
    }
  }

  await batchDeleteImages(toDelete)
  // ... 返回统计
}
```

**UI 建议**:

- 在「数据管理」Tab 中新增「清理工具」区域。
- 提供时间范围选择（7天/30天/90天/自定义）。
- 先执行「预览」模式（显示将删除的数量和大小），确认后再执行。

**注意事项**:

- 清理前必须重新计算引用关系，避免误删当前任务正在使用的图片。
- 若清理了本地文件 (`local-saves/images/`)，需同步清理 IndexedDB 中的记录，或反之。
- 建议先备份再清理（复用现有备份机制）。

---

### 2.3 功能三：存储配额管理

**需求**: 设置最大空间限制和警告阈值，接近上限时提醒用户。

#### 可行性: ⚠️ 中等

**技术约束**:

| 约束           | 说明                                                           |
| -------------- | -------------------------------------------------------------- |
| IndexedDB 配额 | 由浏览器/Electron 自动管理，应用层无法直接设置硬上限           |
| 本地文件系统   | 可通过应用层逻辑限制 `local-saves` 目录大小                    |
| 精确控制难度   | 图片生成前难以精确预估最终大小（API 返回的格式、尺寸可能变化） |

**建议实现（软限制方案）**:

```typescript
// src/types.ts 新增设置字段
export interface AppSettings {
  // ... 现有字段
  storageQuotaMB: number // 0 = 无限制
  storageWarningPercent: number // 默认 80%
}

// src/lib/storageQuota.ts
export async function checkStorageQuota(): Promise<{
  usedBytes: number
  quotaBytes: number
  percent: number
  isWarning: boolean
  isExceeded: boolean
}> {
  const stats = await calculateStorageStats()
  const quotaBytes = settings.storageQuotaMB * 1024 * 1024
  const percent = quotaBytes > 0 ? (stats.totalBytes / quotaBytes) * 100 : 0

  return {
    usedBytes: stats.totalBytes,
    quotaBytes,
    percent,
    isWarning: percent >= settings.storageWarningPercent,
    isExceeded: percent >= 100,
  }
}

// 在提交任务前检查
export function canAcceptNewTask(estimatedImageCount: number, estimatedSizePerImage = 5 * 1024 * 1024): boolean {
  const quota = useStore.getState().settings.storageQuotaMB
  if (quota <= 0) return true

  const stats = await calculateStorageStats()
  const projected = stats.totalBytes + estimatedImageCount * estimatedSizePerImage
  return projected < quota * 1024 * 1024
}
```

**触发点**:

1. 应用启动时检查配额状态。
2. 每次生成任务提交前预估空间（粗略按 `n * 5MB` 估算）。
3. 达到警告阈值时显示 Toast 提示。
4. 达到上限时阻止新任务提交，引导用户清理。

**注意事项**:

- 这是「软限制」，无法阻止其他功能（如导入备份）导致超配额。
- 预估大小不准确，实际以生成后为准。
- 建议配额设置只针对 IndexedDB + 本地文件的总和。

---

### 2.4 功能四：数据压缩优化

**需求**: 支持 WebP/JPEG/PNG 格式压缩，减少存储占用。

#### 可行性: ⚠️ 中等偏低（有复杂度）

**技术方案对比**:

| 方案                       | 实现方式                       | 优点                     | 缺点                                                     |
| -------------------------- | ------------------------------ | ------------------------ | -------------------------------------------------------- |
| **A. Canvas 前端压缩**     | `canvas.toBlob(type, quality)` | 无需新增依赖，纯前端实现 | 大图片可能阻塞主线程；压缩率有限                         |
| **B. Electron 主进程压缩** | Node.js `sharp` 库             | 压缩率高，不阻塞渲染进程 | 需新增原生依赖（sharp 有 node_modules 体积和构建复杂度） |
| **C. 服务端压缩**          | 调用外部 API                   | 不占用本地资源           | 需要网络，与离线使用场景冲突                             |

**推荐方案 A（Canvas 前端压缩）**:

```typescript
// src/lib/imageCompression.ts
export interface CompressionOptions {
  format: 'webp' | 'jpeg' | 'png'
  quality: number // 0-1
  maxWidth?: number
  maxHeight?: number
}

export async function compressImageDataUrl(dataUrl: string, options: CompressionOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      let { width, height } = img

      if (options.maxWidth && width > options.maxWidth) {
        height = (height * options.maxWidth) / width
        width = options.maxWidth
      }
      if (options.maxHeight && height > options.maxHeight) {
        width = (width * options.maxHeight) / height
        height = options.maxHeight
      }

      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)

      const mime = `image/${options.format}`
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('压缩失败'))
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result as string)
          reader.readAsDataURL(blob)
        },
        mime,
        options.quality,
      )
    }
    img.onerror = reject
    img.src = dataUrl
  })
}
```

**应用场景**:

1. **生成后自动压缩**: 在 `executeTask` 收到图片后、存入 IndexedDB 前，根据用户设置进行压缩。
2. **批量压缩已有图片**: 遍历 `images` store，对未压缩的大图片重新处理。
3. **导出时压缩**: 导出 ZIP 前压缩，减少传输体积。

**注意事项**:

- **质量损失**: JPEG/WebP 是有损压缩，用户需明确知晓。
- **性能问题**: 大图片（4K+）Canvas 压缩会阻塞 UI，建议使用 Web Worker 或分片处理。
- **格式兼容性**: 部分 API 返回 PNG，若用户设置压缩为 JPEG，需转换格式。
- **缩略图影响**: 压缩原图后，缩略图需重新生成。
- **重复压缩**: 需标记图片是否已压缩，避免多次压缩导致质量持续下降。

---

## 3. 实施优先级建议

| 优先级 | 功能             | 工作量 | 用户价值 | 技术风险            |
| ------ | ---------------- | ------ | -------- | ------------------- |
| P0     | 存储空间显示     | 小     | 高       | 低                  |
| P1     | 一键清理过期图片 | 中     | 高       | 低                  |
| P2     | 存储配额管理     | 中     | 中       | 中（软限制体验）    |
| P3     | 数据压缩优化     | 大     | 中       | 高（质量/性能权衡） |

---

## 4. 关键实现建议

### 4.1 统一存储统计模块

建议新建 `src/lib/storageStats.ts`，集中所有存储统计逻辑：

```typescript
export async function getStorageStats(): Promise<StorageStats>
export async function getOrphanImageIds(): Promise<string[]>
export async function getExpiredImageIds(days: number): Promise<string[]>
export async function estimateTaskSize(params: TaskParams): Promise<number>
```

### 4.2 设置项扩展

在 `AppSettings` 中新增：

```typescript
export interface AppSettings {
  // ... 现有
  storageQuotaMB: number // 默认 0（无限制）
  storageWarningPercent: number // 默认 80
  autoCleanupEnabled: boolean // 默认 false
  autoCleanupDays: number // 默认 30
  imageCompressionFormat: 'original' | 'webp' | 'jpeg' | 'png'
  imageCompressionQuality: number // 默认 0.9
}
```

### 4.3 UI 位置建议

在 `SettingsModal` 的「数据管理」Tab 中新增区域：

- **存储概览**: 总空间、各类别饼图/进度条、刷新按钮。
- **清理工具**: 时间范围选择、预览模式、执行清理按钮。
- **配额设置**: 最大空间输入、警告阈值滑块。
- **压缩设置**: 格式选择、质量滑块、仅对新图片生效开关。

### 4.4 需要新增的 IPC 通道

```typescript
// electron/preload.ts 暴露给前端
export async function getFolderSize(dirPath: string): Promise<number>
export async function deleteLocalFile(filePath: string): Promise<boolean>
```

---

## 5. 风险与注意事项

| 风险                 | 影响 | 缓解措施                                 |
| -------------------- | ---- | ---------------------------------------- |
| 误删用户数据         | 高   | 清理前强制预览 + 确认对话框；先自动备份  |
| 压缩导致图片质量下降 | 中   | 默认关闭压缩；用户手动开启；提供质量预览 |
| 大图片压缩阻塞 UI    | 中   | 使用 Web Worker；分批处理；显示进度条    |
| IndexedDB 遍历性能差 | 低   | 图片数量大时分批读取；缓存统计结果       |
| 配额软限制被绕过     | 低   | 明确告知用户这是建议值；导入备份时豁免   |

---

_本报告基于项目当前架构（v0.6.9）分析，所有功能在技术上均可实现，建议按 P0→P3 优先级分阶段实施。_
