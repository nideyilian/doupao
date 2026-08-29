# 工作区标签感知备份与恢复设计

## 目标

完整 ZIP 备份必须保存画廊工作区的标签页、标签分组和任务归属。完整恢复后，每个任务回到备份时所属的标签页，不再因归属信息缺失而集中进入“恢复的历史任务”。

## 备份格式

备份格式从 v4 升级为 v5，并在 `manifest.json` 中增加 `workspaceState`：

```ts
type WorkspaceBackupState = {
  tabs: Array<{
    id: string
    name: string
    groupId: string | null
    prompt: string
    inputImageIds: string[]
    inputImageFolder: InputImageFolder | null
    params: TaskParams
    maskDraft: MaskDraft | null
    maskEditorImageId: string | null
    customOutputPath: string
    taskIds: string[]
    createdAt: number
    updatedAt: number
    order: number
  }>
  groups: WorkspaceTabGroup[]
  activeTabId: string | null
}
```

任务和图片仍按 ID 在备份中各保存一份。标签页只保存任务及输入图片的 ID 引用，不复制任务或图片内容。

仅当导出包含配置时写入工作区结构；仅当导出包含任务时写入每个标签页的 `taskIds`。完整备份同时包含配置、任务和图片，因此具有完整恢复标签归属所需的全部信息。

## 完整恢复语义

满足以下条件时执行完整覆盖恢复：

- 备份版本为 v5 或更高；
- 备份包含 `workspaceState`；
- 用户同时选择导入配置和任务。

完整覆盖恢复执行以下操作：

1. 校验工作区结构以及所有任务引用。
2. 以备份任务集合替换当前任务集合。
3. 以备份中的 Agent 对话替换当前 Agent 对话。
4. 使用备份任务和图片引用重建每个工作区标签页。
5. 恢复标签分组、标签顺序和当前活动标签。
6. 一次性提交状态；校验失败时不修改当前任务或工作区。

完整恢复后，当前本地但不在备份中的任务和标签页不会保留，也不会被放入“恢复的历史任务”。

## 选择性导入

以下情况继续使用现有合并语义：

- 只导入配置；
- 只导入任务；
- 导入 v1–v4 旧备份；
- 备份不包含 `workspaceState`。

旧备份没有标签页归属信息，因此无法保证恢复原标签结构；继续使用当前默认标签或“恢复的历史任务”兜底逻辑。

## 校验与错误处理

完整恢复前必须验证：

- 标签页 ID 唯一；
- 标签分组 ID 唯一；
- `groupId` 指向存在的分组或为 `null`；
- `activeTabId` 指向存在的标签页或为 `null`；
- 每个 `taskId` 都存在于备份任务集合；
- 每个输入图片 ID 都存在于备份图片集合；
- 同一任务最多属于一个画廊标签页。

任一校验失败时，导入返回失败提示，不修改当前任务、标签页或标签分组。空标签页允许恢复。

## 测试

- v5 导出包含标签页、标签分组、活动标签和任务 ID 映射。
- 多个标签页恢复后任务归属与备份一致。
- 空标签页和标签分组可以恢复。
- 缺失任务、重复标签 ID、无效分组引用会拒绝恢复。
- 完整恢复会删除不在备份中的当前任务和标签页。
- 选择性导入继续合并，不覆盖当前工作区。
- v1–v4 备份继续按旧逻辑导入。
- 完整测试套件和生产构建通过。

## 非目标

- 不按标签页重复保存任务或图片文件。
- 不尝试从旧备份推断原标签归属。
- 不改变自动 JSON 状态备份格式。
- 不修改标签页界面或增加新的恢复选项。
