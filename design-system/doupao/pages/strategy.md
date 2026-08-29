# 策略工作台（strategy）

> 只记录与 `../MASTER.md` 不同的规则。没有差异的章节删除。

## 页面

- 名称：策略工作台（RequirementStrategyWorkspace）
- 用户主任务：管理产品/素材类型/策略三级结构，编辑并发布文生图与图生图·SOP 策略
- 主行动：在 `StrategyEditor` 保存草稿、提交审核、审核发布
- 进入条件：`appMode === 'strategy'`，且被 `RequirementPrototypeShell` 包裹（route `strategy`）；也被需求中心 `strategy` 路由复用

## 必须覆盖的全局规则

| 全局规则 | 页面覆盖 | 业务理由 | 删除条件 |
| --- | --- | --- | --- |
| 4.7 内容宽度 | 全宽三栏，`main p-0`，固定高度 `h-[calc(100vh-64px)]`，无 `max-w` 居中 | 策略编辑需要最大横向空间 | 改为居中容器 |
| 2.8 树+列表+编辑器工作台 | 三栏 `StrategyTree`（导航）→ `StrategyGrid`（中栏）→ `StrategyEditor`（右栏/弹窗），遵循 MASTER 2.8 配方 | 经典管理台结构 | — |
| 6.2 快捷键 | 专属 `Ctrl/Cmd+C` 复制策略、`Ctrl/Cmd+V` 粘贴策略（全局 keydown，输入框内不触发）；登记于此，不占全局保留字 | 快速复用策略 | 快捷键移除 |
| 6.3 选择 | 网格卡片支持选中、重命名、复制、粘贴、归档；行内重命名 Enter 提交/Esc 取消 | 批量管理 | — |
| 6.4 拖拽 | 树节点支持拖拽移动；提供菜单/按钮移动等价 | 组织策略层级 | 改用纯菜单 |
| 4.6 数据隔离 | 数据来自 `useRequirementPrototype` store（`strategyAssets`），与 gallery `tasks` 隔离 | 需求中心独立数据域 | — |

## 页面状态

- 初始：加载策略树，默认选中根节点展示其下策略网格。
- 加载：树/网格异步加载显示 `Skeleton` 或 `Spinner`。
- 空：某节点无策略显示 `EmptyState`。
- 成功：策略卡片含封面（`StoreStrategyImage`）、状态标签（草稿/待审核/已发布）、模式标签。
- 可恢复错误：保存失败 Toast 报摘要并保留草稿。
- 不可用：未登录/无权限时由外层 AppShell 拦截（见 requirement-prototype.md）。

## 响应式差异

- 375px：三栏折叠为单栏逐级下钻（导航转 Drawer）。
- 768px：两栏（导航转 Drawer，列表+编辑器）。
- 1024px：三栏完整。
- 1440px：三栏全宽。
- 粗指针：拖拽移动策略改用菜单/按钮；行内重命名保留。

## 验收

- [ ] 覆盖项均有业务理由。
- [ ] 未复制全局规范。
- [ ] 已验证浅色、深色、键盘、减少动态和极端内容。
- [ ] `Ctrl+C/V` 在输入框内不触发，且不与其他工作区冲突。
- [ ] 编辑器未保存内容离开前确认或自动存草稿。
- [ ] 在壳内（route=strategy）与 legacy 独立运行视觉一致。
