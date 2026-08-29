# 需求中心壳（requirementPrototype）

> 只记录与 `../MASTER.md` 不同的规则。没有差异的章节删除。

## 页面

- 名称：需求中心壳（RequirementPrototypeShell / AppShell）
- 用户主任务：在统一壳层内登录、按角色导航到策略/下单/知识沉淀/管理，并包裹传统工具
- 主行动：登录；顶部 `nav` 切换路由（order/orders/strategy/knowledge/admin/legacy）
- 进入条件：应用外层始终挂载；未登录显 `LoginPage`，登录后显壳层导航

## 必须覆盖的全局规则

| 全局规则 | 页面覆盖 | 业务理由 | 删除条件 |
| --- | --- | --- | --- |
| 4.7 应用壳与主导航 | 引入独立顶部 sticky 导航（`PageHeader` + 角色 `navConfig`），与 legacy `Header` 的 `SegmentedControl` 是**两套并存**切换机制（admin 可在两者间跳转） | 需求中心需要角色化导航 | 导航统一为一套 |
| 4.4 / 4.6 登录与权限 | 独立登录态与角色模型（optimizer/strategist/admin，密码 demo123），未登录拦截所有子页 | 企业内多角色协作 | 权限模型移除 |
| 4.7 内容宽度 | 不同路由不同宽度：`strategy` 路由 `main p-0` 全宽，其余 `max-w-[1600px] p-5` | 策略编辑需全宽，其他需约束 | 统一宽度 |
| 4.7 嵌套 | 完整 legacy 工作区（含 `WorkspaceTabBar`、`Header`、`TaskGrid`、`InputBar`、各 `appMode`、全局弹窗）作为 `legacy` prop 传入；仅 `route==='legacy'` 且 admin 时渲染 `requirement-legacy-shell` 包裹传统工具 | 平滑迁移，传统工具保留在壳内 | legacy 通道移除 |
| 6.6 / 全局弹窗 | 全局弹窗（`DetailModal`/`Lightbox`/`Toast` 等）由 App 根挂载，壳层与 legacy 共用，不重复挂载 | 单一弹窗源 | — |
| 2.8 复用一致性 | `strategy`/`order`/`orders` 在壳内复用 `StrategyWorkspace`、`RequirementOrderingCreatePage`/`HistoryPage`，需保证壳内（无 docked-panels 留白）与 legacy 独立运行视觉一致 | 避免双套实现漂移 | — |

## 页面状态

- 初始：未登录显 `LoginPage`；登录后按角色默认路由（optimizer→order，strategist→strategy，admin→admin）。
- 加载：壳层与子页各自加载指示。
- 空：知识沉淀/管理页无数据时 `EmptyState`。
- 成功：子页正常渲染。
- 可恢复错误：子页失败由各自 `ErrorState`/Toast 处理。
- 不可用/无权限：未登录或角色不符拦截并引导登录。

## 响应式差异

- 375px：壳层顶部导航折叠为菜单；子页按各自规则（见 strategy/ordering 文档）。
- 768px：导航可横向滚动或折叠。
- 1024px：`max-w-[1600px]` 居中。
- 1440px：全宽子页（strategy）或 `max-w-[1600px]`。
- 粗指针：导航与所有下拉用真实按钮；无悬停依赖。

## 验收

- [ ] 覆盖项均有业务理由。
- [ ] 未复制全局规范。
- [ ] 已验证浅色、深色、键盘、减少动态和极端内容。
- [ ] 壳层导航与 legacy `SegmentedControl` 切换互不破坏状态。
- [ ] 角色权限正确收敛可见功能；未登录拦截生效。
- [ ] 复用的 strategy/ordering 页面在壳内与 legacy 下视觉一致。
