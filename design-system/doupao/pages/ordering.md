# 下单工作台（ordering）

> 只记录与 `../MASTER.md` 不同的规则。没有差异的章节删除。

## 页面

- 名称：下单工作台（RequirementOrderingWorkspace）
- 用户主任务：新建素材需求并触发生成，查看和管理已下单任务
- 主行动：`OrderingCreate` 提交生成；`OrderingHistory` 取消/重试单元、打开任务文件夹
- 进入条件：`appMode === 'ordering'`，被 `RequirementPrototypeShell` 包裹；导出 `RequirementOrderingCreatePage`/`HistoryPage` 同时被需求中心 `order`/`orders` 路由复用

## 必须覆盖的全局规则

| 全局规则 | 页面覆盖 | 业务理由 | 删除条件 |
| --- | --- | --- | --- |
| 4.7 内容宽度 | `max-w-[1600px]`（比 strategy 窄，比 gallery `max-w-7xl` 宽），非全宽 | 表单与列表需约束阅读宽度 | 改全宽 |
| 2.8 结构 | 非三栏：页头（`PageHeader`+角色 `nav`）+ 单页双视图（`view`：`create`/`history`）切换 | 下单是线性流程而非树编辑 | — |
| 4.6 角色权限 | 按角色控制可见：优化师可见新建/我的任务，管理员为全部任务；非 optimizer 默认进 history | 需求中心强角色依赖 | 权限模型移除 |
| 6.2 快捷键 | 无页面专属快捷键、无框选、无画布 | 流程化操作 | — |
| 6.8 桌面端 | `OrderingHistory` "打开任务文件夹"用系统原生 `openInExplorer`；路径可复制显示 | 定位产物 | — |

## 页面状态

- 初始：`create` 视图（优化师）或 `history` 视图（其他角色）。
- 加载：历史列表异步加载显示 `Spinner`/`Skeleton`。
- 空：无订单显示 `EmptyState`。
- 成功：订单行用 `StatusIndicator` + 状态色；失败单元可单独重试。
- 可恢复错误：提交失败 Toast 报摘要并保留表单。
- 不可用：未登录/角色不符由 AppShell 拦截。

## 响应式差异

- 375px：双视图堆叠；`create` 表单单列；历史表格横向滚动。
- 768px：双视图并列或堆叠，按内容。
- 1024px：`max-w-[1600px]` 居中。
- 1440px：同 1024，宽屏利用。
- 粗指针：所有下拉/菜单用真实按钮，无悬停依赖。

## 验收

- [ ] 覆盖项均有业务理由。
- [ ] 未复制全局规范。
- [ ] 已验证浅色、深色、键盘、减少动态和极端内容。
- [ ] 角色切换时可见功能正确收敛。
- [ ] `order`/`orders` 路由复用与 `ordering` 内部 `view` 切换视觉一致。
